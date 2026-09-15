import { spawn } from "node:child_process";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
  buildCli,
  cliBin,
  seededUser,
  startTestServer,
  type TestServer,
} from "./test-server.js";

// This drives the *built* CLI (cli/dist/index.js) as a real subprocess against
// a real `next dev`, on a temp database and a redirected config directory —
// nothing here touches the developer's own login or data/app.db. The device
// code is approved via Better Auth's testUtils, never a browser: `server.login()`
// mints a session for the seeded user directly against the same database file
// the spawned server reads, and that session's bearer token is then used to
// call the live server's own /device endpoints exactly as app/device/ would.
let server: TestServer;

function runCli(args: string[]) {
  return new Promise<{ stdout: string; stderr: string; code: number | null }>(
    (resolvePromise) => {
      const child = spawn(process.execPath, [cliBin, ...args], {
        env: {
          ...process.env,
          AI_TUTOR_SERVER_URL: server.baseUrl,
          AI_TUTOR_CONFIG_DIR: server.configDir,
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
      AI_TUTOR_SERVER_URL: server.baseUrl,
      AI_TUTOR_CONFIG_DIR: server.configDir,
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
  buildCli();
  server = await startTestServer(".next-cli-test");
}, 120_000);

afterAll(async () => {
  await server?.stop();
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
  const { token: approverToken } = await server.login();
  const approverHeaders = { authorization: `Bearer ${approverToken}` };

  const verify = await fetch(
    `${server.baseUrl}/api/auth/device?user_code=${userCode}`,
    {
      headers: approverHeaders,
    },
  );
  expect(verify.ok).toBe(true);

  const approve = await fetch(`${server.baseUrl}/api/auth/device/approve`, {
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
