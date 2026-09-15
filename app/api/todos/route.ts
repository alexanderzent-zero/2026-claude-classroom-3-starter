import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { createTodoRequestSchema } from "@/lib/todo-api-schema";
import { addTodoFor, listTodosFor } from "@/lib/todo-tools";

/**
 * The list endpoint: the sidebar's own read (session cookie, no query) and a
 * CLI's (bearer token, optional `?filter=`) are the same request to Better
 * Auth's `getSession` — the bearer plugin in lib/auth.ts turns either into the
 * same session lookup, so this needs no branching on how the caller
 * authenticated. Reads `request.headers` directly (rather than next/headers)
 * so the handler is callable outside a real Next.js request, which is what
 * makes it possible to test.
 */
export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const rawFilter = new URL(request.url).searchParams.get("filter");
  return Response.json({
    todos: await listTodosFor(db, session.user.id, {
      filter: rawFilter?.trim() || undefined,
    }),
  });
}

/**
 * Create is CLI/service-only — the app's own pages never write here, the
 * tutor's `addTodo` tool does (see lib/todo-tools.ts's shared `addTodoFor`).
 */
export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = createTodoRequestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: "invalid request" }, { status: 400 });
  }

  const todo = await addTodoFor(db, session.user.id, parsed.data.title);
  return Response.json({ todo }, { status: 201 });
}
