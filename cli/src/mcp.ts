import {
  createTodoRequestSchema,
  listTodosQuerySchema,
  todoSchema,
} from "@ai-tutor/todo-api-schema";
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import {
  ApiError,
  addTodo,
  listTodos,
  requireToken,
  setTodoDone,
} from "./api.js";

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

/**
 * Every tool shares this shape for failure: `requireToken()` throws
 * `NotAuthenticated` before any of them touch the network, and a call already
 * in flight can still 401 if the session was revoked mid-session — either way
 * the caller sees a tool execution error (`isError: true`), never a thrown
 * exception, so the model can read the message and tell the user to run
 * `ai-tutor login` instead of the call just failing silently.
 */
function errorResult(error: unknown) {
  const message =
    error instanceof ApiError
      ? error.message
      : error instanceof Error
        ? error.message
        : String(error);
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

/**
 * Starts unconditionally, whether or not anyone is logged in — only a tool
 * *call* needs a session, and reporting that at call time (via `errorResult`)
 * gives the model a chance to relay it to the user, where refusing to start
 * the server at all would not.
 */
export async function runMcpServer(): Promise<void> {
  const server = new McpServer({ name: "ai-tutor", version: "0.0.0" });

  server.registerTool(
    "list",
    {
      description:
        "List the signed-in user's to-do items, both open and done, oldest " +
        "first. Optionally filter to items whose title contains some text.",
      inputSchema: listTodosQuerySchema,
    },
    async ({ filter }) => {
      try {
        const todos = await listTodos(requireToken(), filter);
        if (todos.length === 0) {
          return textResult("Nothing on the list.");
        }
        return textResult(
          todos
            .map(
              (todo) =>
                `${todo.done ? "[x]" : "[ ]"} ${todo.title}  (${todo.id})`,
            )
            .join("\n"),
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "add",
    {
      description: "Add a new item to the signed-in user's to-do list.",
      inputSchema: createTodoRequestSchema,
    },
    async ({ title }) => {
      try {
        const todo = await addTodo(requireToken(), title);
        return textResult(`Added: ${todo.title} (${todo.id})`);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "done",
    {
      description:
        "Mark one of the signed-in user's to-do items done, by id (as " +
        "reported by the list tool).",
      inputSchema: z.object({ id: todoSchema.shape.id }),
    },
    async ({ id }) => {
      try {
        const todo = await setTodoDone(requireToken(), id);
        return textResult(`Done: ${todo.title}`);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Only stderr from here on — stdout is the JSON-RPC wire.
  console.error("ai-tutor MCP server running on stdio");
}
