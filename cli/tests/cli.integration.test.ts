import {
  type ChildProcessWithoutNullStreams,
  execFileSync,
  spawn,
} from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { betterAuth } from "better-auth";
import { testUtils } from "better-auth/plugins";
import { migrate } from "drizzle-orm/libsql/migrator";
import { drizzle } from "drizzle-orm/libsql/node";
import { afterAll, beforeAll, expect, test } from "vitest";
// The app's own DB adapter config, reused rather than re-derived — same
// pattern as tests/unit/auth.test.ts, one directory further from repo root.
import { authOptions } from "../../lib/auth-config.js";

// This drives the *built* CLI (cli/dist/index.js) as a real subprocess against
// a real `next dev`, on a temp database and a redirected config dir — nothing
// here touches the developer's own login or data/app.db. The device code is
// approved via Better Auth's testUtils, never a browser: `helpers.login`
// mints a session for a seeded user directly against the same database file
// the spawned server reads, and that session's bearer token is then used to
// call the live server's own /device endpoints exactly as app/device/ would.
const testDir = dirname(fileURLToPath(import.meta.url));
const cliDir = resolve(testDir, "..");
const repoRoot = resolve(cliDir, "..");
const cliBin = join(cliDir, "dist", "index.js");

const seededUser = {
  id: "cli-test-user",
  name: "CLI Tester",
  email: "cli-test@example.com",
};

let dataDir: string;
let configDir: string;
let server: ChildProcessWithoutNullStreams;
let baseUrl: string;
let testAuth: ReturnType<typeof createTestAuth>;
let testDb: ReturnType<typeof drizzle>;

// Only testUtils — claiming and approving the device code happens over real
// HTTP against the spawned server below, which already has bearer() and
// deviceAuthorization() registered, exactly like a browser would use them.
// Plugins go through a function (see tests/unit/auth.test.ts) so TypeScript
// keeps inferring `ctx.test` instead of widening to plain `BetterAuthOptions`.
function createTestAuth(database: ReturnType<typeof drizzle>) {
  return betterAuth({
    ...authOptions(database),
    secret: "test-secret-at-least-32-characters-long",
    baseURL: "http://localhost:3000",
    plugins: [testUtils()],
  });
}

function getFreePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.listen(0, () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : null;
      probe.close(() =>
        port
          ? resolvePort(port)
          : reject(new Error("could not find a free port")),
      );
    });
    probe.on("error", reject);
  });
}

async function waitForServer(url: string, deadline: number) {
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/api/auth/get-session`);
      if (response.ok) {
        return;
      }
    } catch {
      // Not accepting connections yet.
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Server at ${url} never became ready`);
}

function runCli(args: string[]) {
  return new Promise<{ stdout: string; stderr: string; code: number | null }>(
    (resolvePromise) => {
      const child = spawn(process.execPath, [cliBin, ...args], {
        env: {
          ...process.env,
          AI_TUTOR_SERVER_URL: baseUrl,
          AI_TUTOR_CONFIG_DIR: configDir,
        },
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.on("close", (code) => resolvePromise({ stdout, stderr, code }));
    },
  );
}

function spawnCli(args: string[]) {
  const child = spawn(process.execPath, [cliBin, ...args], {
    env: {
      ...process.env,
      AI_TUTOR_SERVER_URL: baseUrl,
      AI_TUTOR_CONFIG_DIR: configDir,
    },
  });
  let stdout = "";
  const exited = new Promise<number | null>((resolvePromise) => {
    child.on("close", (code) => resolvePromise(code));
  });
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  return { exited, stdout: () => stdout };
}

async function waitForMatch(
  getText: () => string,
  pattern: RegExp,
  timeoutMs = 10_000,
): Promise<RegExpMatchArray> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = getText().match(pattern);
    if (match) {
      return match;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Timed out waiting for ${pattern} in:\n${getText()}`);
}

beforeAll(async () => {
  execFileSync("npm", ["run", "build"], { cwd: cliDir, stdio: "inherit" });

  dataDir = await mkdtemp(join(tmpdir(), "ai-tutor-cli-db-"));
  configDir = join(dataDir, "config");
  const databaseUrl = `file:${join(dataDir, "test.db")}`;

  // Kept open (and closed in afterAll) rather than closed here: testAuth
  // keeps using this same connection later, to mint the approver's session.
  testDb = drizzle({ connection: { url: databaseUrl } });
  await migrate(testDb, { migrationsFolder: join(repoRoot, "drizzle") });

  testAuth = createTestAuth(testDb);
  await (await testAuth.$context).internalAdapter.createUser(seededUser, {
    method: "email-password",
  });

  const port = await getFreePort();
  baseUrl = `http://localhost:${port}`;

  server = spawn(
    join(repoRoot, "node_modules", ".bin", "next"),
    ["dev", "--port", String(port)],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        NEXT_DIST_DIR: ".next-cli-test",
        DATABASE_URL: databaseUrl,
        BETTER_AUTH_URL: baseUrl,
      },
      stdio: "pipe",
    },
  );

  await waitForServer(baseUrl, Date.now() + 60_000);
}, 120_000);

afterAll(async () => {
  server?.kill();
  testDb?.$client.close();
  await rm(dataDir, { recursive: true, force: true });
});

test("login, whoami, add, list, done, logout, and whoami fails afterwards", async () => {
  const login = spawnCli(["login"]);

  const codeMatch = await waitForMatch(
    login.stdout,
    /^\s*([A-Z0-9]{4}-[A-Z0-9]{4})\s*$/m,
  );
  const userCode = codeMatch[1].replace("-", "");

  // The web app's /device flow, driven directly instead of through a browser:
  // a real session for the seeded user (minted by testUtils), used to claim
  // and then approve the code the CLI printed.
  const helpers = (await testAuth.$context).test;
  const { token: approverToken } = await helpers.login({
    userId: seededUser.id,
  });
  const approverHeaders = { authorization: `Bearer ${approverToken}` };

  const verify = await fetch(
    `${baseUrl}/api/auth/device?user_code=${userCode}`,
    {
      headers: approverHeaders,
    },
  );
  expect(verify.ok).toBe(true);

  const approve = await fetch(`${baseUrl}/api/auth/device/approve`, {
    method: "POST",
    headers: { ...approverHeaders, "content-type": "application/json" },
    body: JSON.stringify({ userCode }),
  });
  expect(approve.ok).toBe(true);

  const loginExitCode = await login.exited;
  expect(loginExitCode).toBe(0);
  expect(login.stdout()).toContain(`Logged in as ${seededUser.email}.`);

  const whoami = await runCli(["whoami"]);
  expect(whoami.code).toBe(0);
  expect(whoami.stdout.trim()).toBe(seededUser.email);

  const add = await runCli(["add", "Buy milk"]);
  expect(add.code).toBe(0);
  expect(add.stdout).toContain("Added: Buy milk");
  const addedId = add.stdout.match(/\(([^)]+)\)/)?.[1];
  expect(addedId).toBeTruthy();

  const list = await runCli(["list"]);
  expect(list.code).toBe(0);
  expect(list.stdout).toContain("[ ] Buy milk");

  const filteredMatch = await runCli(["list", "--filter", "milk"]);
  expect(filteredMatch.stdout).toContain("Buy milk");
  const filteredMiss = await runCli(["list", "--filter", "eggs"]);
  expect(filteredMiss.stdout).toContain("Nothing on the list.");

  const done = await runCli(["done", addedId as string]);
  expect(done.code).toBe(0);
  expect(done.stdout).toContain("Done: Buy milk");

  const listAfterDone = await runCli(["list"]);
  expect(listAfterDone.stdout).toContain("[x] Buy milk");

  const logout = await runCli(["logout"]);
  expect(logout.code).toBe(0);
  expect(logout.stdout).toContain("Logged out.");

  const whoamiAfterLogout = await runCli(["whoami"]);
  expect(whoamiAfterLogout.code).toBe(1);
  expect(whoamiAfterLogout.stderr).toContain("Not logged in");
});
