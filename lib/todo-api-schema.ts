import { z } from "zod";

/**
 * Request and response shapes for the /api/todos REST API — the one module a
 * future CLI in this repo imports instead of retyping them. Kept separate from
 * lib/todo-tools.ts's own tool schemas: those describe what the model may
 * pass, these describe the wire format for an external client.
 */

export const todoSchema = z.object({
  id: z.string(),
  title: z.string(),
  done: z.boolean(),
});
export type Todo = z.infer<typeof todoSchema>;

export const listTodosQuerySchema = z.object({
  filter: z.string().trim().min(1).optional(),
});
export type ListTodosQuery = z.infer<typeof listTodosQuerySchema>;

export const listTodosResponseSchema = z.object({
  todos: z.array(todoSchema),
});
export type ListTodosResponse = z.infer<typeof listTodosResponseSchema>;

export const createTodoRequestSchema = z.object({
  title: z.string().trim().min(1),
});
export type CreateTodoRequest = z.infer<typeof createTodoRequestSchema>;

export const createTodoResponseSchema = z.object({ todo: todoSchema });
export type CreateTodoResponse = z.infer<typeof createTodoResponseSchema>;

export const setTodoDoneRequestSchema = z.object({ done: z.boolean() });
export type SetTodoDoneRequest = z.infer<typeof setTodoDoneRequestSchema>;

export const setTodoDoneResponseSchema = z.object({ todo: todoSchema });
export type SetTodoDoneResponse = z.infer<typeof setTodoDoneResponseSchema>;

export const errorResponseSchema = z.object({ error: z.string() });
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
