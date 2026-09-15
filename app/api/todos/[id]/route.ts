import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { setTodoDoneRequestSchema } from "@/lib/todo-api-schema";
import { setTodoDoneFor } from "@/lib/todo-tools";

/**
 * Mark one item done or reopen it — the REST equivalent of the tutor's
 * `setTodoDone` tool, over the same shared query. A 404 covers both "no such
 * item" and "not this caller's item": setTodoDoneFor filters by userId, so a
 * stolen id is indistinguishable from one that never existed. Reads
 * `request.headers` directly (rather than next/headers) so the handler is
 * callable outside a real Next.js request, which is what makes it testable.
 */
export async function PATCH(
  request: Request,
  ctx: RouteContext<"/api/todos/[id]">,
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = setTodoDoneRequestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: "invalid request" }, { status: 400 });
  }

  const { id } = await ctx.params;
  const todo = await setTodoDoneFor(db, session.user.id, id, parsed.data.done);
  if (!todo) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  return Response.json({ todo });
}
