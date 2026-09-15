// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { betterAuth } from "better-auth";
import { bearer, type TestHelpers, testUtils } from "better-auth/plugins";
import { migrate } from "drizzle-orm/libsql/migrator";
import { drizzle } from "drizzle-orm/libsql/node";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";

import { authOptions } from "@/lib/auth-config";
import * as schema from "@/lib/schema";
import { todos, user } from "@/lib/schema";

// app/api/todos/ imports @/lib/auth and @/lib/db, both `server-only` and bound
// to DATABASE_URL, so both are replaced with a real betterAuth instance and a
// real drizzle connection over a throwaway file — same trick as
// tests/unit/copilotkit-route.test.ts, but backed by genuine sessions instead
// of a stub, since the bearer flow below needs a real token to verify. Plugins
// go through a function (rather than a plain object literal assigned to a
// `let`) so TypeScript keeps inferring `ctx.test` — see tests/unit/auth.test.ts.
function createTestAuth(database: ReturnType<typeof drizzle>) {
  return betterAuth({
    ...authOptions(database),
    secret: "test-secret-at-least-32-characters-long",
    baseURL: "http://localhost:3000",
    plugins: [bearer(), testUtils()],
  });
}

let dir: string;
let db: ReturnType<typeof drizzle<typeof schema>>;
let auth: ReturnType<typeof createTestAuth>;
let helpers: TestHelpers;
let GET: typeof import("@/app/api/todos/route").GET;
let POST: typeof import("@/app/api/todos/route").POST;
let PATCH: typeof import("@/app/api/todos/[id]/route").PATCH;

vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/auth", () => ({ auth }));

const params = (id: string) => Promise.resolve({ id });

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "ai-tutor-todos-api-"));
  db = drizzle({ connection: { url: `file:${join(dir, "test.db")}` }, schema });
  await migrate(db, { migrationsFolder: "./drizzle" });

  auth = createTestAuth(db);
  helpers = (await auth.$context).test;

  await db
    .insert(user)
    .values({ id: "user-ada", name: "Ada", email: "ada@example.com" });

  ({ GET, POST } = await import("@/app/api/todos/route"));
  ({ PATCH } = await import("@/app/api/todos/[id]/route"));
});

afterAll(async () => {
  db.$client.close();
  await rm(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  await db.delete(todos);
});

describe("without a token", () => {
  test("GET /api/todos is unauthorized", async () => {
    const response = await GET(new Request("http://localhost/api/todos"));
    expect(response.status).toBe(401);
  });

  test("POST /api/todos is unauthorized", async () => {
    const response = await POST(
      new Request("http://localhost/api/todos", {
        method: "POST",
        body: JSON.stringify({ title: "Buy milk" }),
      }),
    );
    expect(response.status).toBe(401);
  });

  test("PATCH /api/todos/:id is unauthorized", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/todos/anything", {
        method: "PATCH",
        body: JSON.stringify({ done: true }),
      }),
      { params: params("anything") },
    );
    expect(response.status).toBe(401);
  });
});

test("a minted bearer token can add, list, complete, and re-list filtered", async () => {
  const { token } = await helpers.login({ userId: "user-ada" });
  const authHeaders = { Authorization: `Bearer ${token}` };

  const created = await POST(
    new Request("http://localhost/api/todos", {
      method: "POST",
      headers: { ...authHeaders, "content-type": "application/json" },
      body: JSON.stringify({ title: "Buy milk" }),
    }),
  );
  expect(created.status).toBe(201);
  const { todo } = (await created.json()) as { todo: { id: string } };
  expect(todo.id).toEqual(expect.any(String));

  const listed = await GET(
    new Request("http://localhost/api/todos", { headers: authHeaders }),
  );
  expect(await listed.json()).toEqual({
    todos: [{ id: todo.id, title: "Buy milk", done: false }],
  });

  const completed = await PATCH(
    new Request(`http://localhost/api/todos/${todo.id}`, {
      method: "PATCH",
      headers: { ...authHeaders, "content-type": "application/json" },
      body: JSON.stringify({ done: true }),
    }),
    { params: params(todo.id) },
  );
  expect(await completed.json()).toEqual({
    todo: { id: todo.id, title: "Buy milk", done: true },
  });

  const filteredMatch = await GET(
    new Request("http://localhost/api/todos?filter=milk", {
      headers: authHeaders,
    }),
  );
  expect(await filteredMatch.json()).toEqual({
    todos: [{ id: todo.id, title: "Buy milk", done: true }],
  });

  const filteredMiss = await GET(
    new Request("http://localhost/api/todos?filter=eggs", {
      headers: authHeaders,
    }),
  );
  expect(await filteredMiss.json()).toEqual({ todos: [] });
});
