import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { betterAuth } from "better-auth";
import { testUtils } from "better-auth/plugins";
import { migrate } from "drizzle-orm/libsql/migrator";
import { drizzle } from "drizzle-orm/libsql/node";
// The app's own DB adapter config, reused rather than re-derived — same
// pattern as tests/unit/auth.test.ts, one directory further from repo root.
import { authOptions } from "../../lib/auth-config.js";

export const repoRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
export const cliDir = join(repoRoot, "cli");
export const cliBin = join(cliDir, "dist", "index.js");

export const seededUser = {
  id: "cli-test-user",
  name: "CLI Tester",
  email: "cli-test@example.com",
};

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

/** Rebuilds cli/dist so every test drives the current source, not a stale build. */
export function buildCli(): void {
  execFileSync("npm", ["run", "build"], { cwd: cliDir, stdio: "inherit" });
}

export type TestServer = {
  baseUrl: string;
  dataDir: string;
  configDir: string;
  /** Mints a session for the seeded user via testUtils — no password, no browser. */
  login: () => Promise<{ token: string }>;
  stop: () => Promise<void>;
};

/**
 * The one test server both cli.integration.test.ts and mcp.integration.test.ts
 * drive: a real `next dev` on a free port, over a fresh temp database with one
 * seeded user, plus a testUtils-backed betterAuth instance on that same
 * database for minting that user's sessions directly. `distDirSuffix` must be
 * unique per test file so two suites can run without fighting over one
 * `next dev` lock file.
 */
export async function startTestServer(
  distDirSuffix: string,
): Promise<TestServer> {
  const dataDir = await mkdtemp(join(tmpdir(), "ai-tutor-cli-db-"));
  const configDir = join(dataDir, "config");
  const databaseUrl = `file:${join(dataDir, "test.db")}`;

  const testDb = drizzle({ connection: { url: databaseUrl } });
  await migrate(testDb, { migrationsFolder: join(repoRoot, "drizzle") });

  const testAuth = createTestAuth(testDb);
  await (await testAuth.$context).internalAdapter.createUser(seededUser, {
    method: "email-password",
  });

  const port = await getFreePort();
  const baseUrl = `http://localhost:${port}`;

  const server = spawn(
    join(repoRoot, "node_modules", ".bin", "next"),
    ["dev", "--port", String(port)],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        NEXT_DIST_DIR: distDirSuffix,
        DATABASE_URL: databaseUrl,
        BETTER_AUTH_URL: baseUrl,
      },
      stdio: "pipe",
    },
  );

  await waitForServer(baseUrl, Date.now() + 60_000);

  return {
    baseUrl,
    dataDir,
    configDir,
    async login() {
      const helpers = (await testAuth.$context).test;
      return helpers.login({ userId: seededUser.id });
    },
    async stop() {
      server.kill();
      testDb.$client.close();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}
