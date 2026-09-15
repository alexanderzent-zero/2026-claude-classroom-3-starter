#!/usr/bin/env node
import { Command } from "commander";
import {
  ApiError,
  addTodo,
  fetchSession,
  listTodos,
  NotAuthenticated,
  pollDeviceToken,
  requestDeviceCode,
  setTodoDone,
  signOut,
} from "./api.js";
import {
  clearToken,
  DEFAULT_SERVER_URL,
  loadToken,
  saveToken,
} from "./config.js";

const program = new Command();

program
  .name("ai-tutor")
  .description(
    [
      "Command-line client for the ai-tutor to-do list.",
      "",
      `Talks to the server at $AI_TUTOR_SERVER_URL, or ${DEFAULT_SERVER_URL} if that isn't set.`,
      "Run `ai-tutor login` first; every other command needs a stored session.",
    ].join("\n"),
  )
  .version("0.0.0");

/** Wraps a command action so every command reports errors the same way. */
function action<Args extends unknown[]>(fn: (...args: Args) => Promise<void>) {
  return async (...args: Args) => {
    try {
      await fn(...args);
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error);
      console.error(message);
      process.exitCode = 1;
    }
  };
}

function requireToken(): string {
  const token = loadToken();
  if (!token) {
    throw new NotAuthenticated();
  }
  return token;
}

/** "ABCD1234" -> "ABCD-1234", purely for the user to read back off a screen. */
function formatUserCode(code: string): string {
  const mid = Math.floor(code.length / 2);
  return code.length >= 6 ? `${code.slice(0, mid)}-${code.slice(mid)}` : code;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

program
  .command("login")
  .description(
    "Sign in with a device code: requests a one-time code, prints it together " +
      "with a URL, and waits for you to enter the code and approve it there " +
      "while signed in to the web app. Never opens a browser itself. On " +
      "success, stores the session token in the user's config directory " +
      "(owner-only file permissions, never the repo).",
  )
  .action(
    action(async () => {
      const deviceCode = await requestDeviceCode();

      console.log("First copy your one-time code:\n");
      console.log(`    ${formatUserCode(deviceCode.user_code)}\n`);
      console.log("Then open this URL and enter the code:\n");
      console.log(`    ${deviceCode.verification_uri}\n`);
      console.log("Waiting for you to approve it…");

      let interval = deviceCode.interval;
      const deadline = Date.now() + deviceCode.expires_in * 1000;

      while (Date.now() < deadline) {
        await sleep(interval * 1000);
        const result = await pollDeviceToken(deviceCode.device_code);

        if ("access_token" in result) {
          saveToken(result.access_token);
          const session = await fetchSession(result.access_token);
          console.log(
            session ? `Logged in as ${session.user.email}.` : "Logged in.",
          );
          return;
        }

        switch (result.error) {
          case "authorization_pending":
            continue;
          case "slow_down":
            interval += 5;
            continue;
          case "access_denied":
            throw new ApiError("The request was denied.");
          default:
            throw new ApiError(
              result.error_description ||
                'The code expired before it was approved. Run "ai-tutor login" to try again.',
            );
        }
      }

      throw new ApiError(
        'The code expired before it was approved. Run "ai-tutor login" to try again.',
      );
    }),
  );

program
  .command("whoami")
  .description("Print the signed-in user's email, or fail if not logged in.")
  .action(
    action(async () => {
      const token = requireToken();
      const session = await fetchSession(token);
      if (!session) {
        throw new NotAuthenticated();
      }
      console.log(session.user.email);
    }),
  );

program
  .command("logout")
  .description(
    "Invalidate the stored session on the server and remove it from disk.",
  )
  .action(
    action(async () => {
      const token = loadToken();
      if (token) {
        await signOut(token).catch(() => {
          // The server is unreachable or the session is already gone either
          // way — clearing the local file is still the right outcome.
        });
      }
      clearToken();
      console.log("Logged out.");
    }),
  );

program
  .command("add")
  .argument("<title>", 'The item\'s text, e.g. "Buy milk"')
  .description("Add a new item to the to-do list.")
  .action(
    action(async (title: string) => {
      const token = requireToken();
      const todo = await addTodo(token, title);
      console.log(`Added: ${todo.title} (${todo.id})`);
    }),
  );

program
  .command("list")
  .description(
    "List to-do items, both open and done, oldest first (same order as the app).",
  )
  .option(
    "-f, --filter <text>",
    "Only items whose title contains this text (case-insensitive)",
  )
  .action(
    action(async (options: { filter?: string }) => {
      const token = requireToken();
      const todos = await listTodos(token, options.filter);
      if (todos.length === 0) {
        console.log("Nothing on the list.");
        return;
      }
      for (const todo of todos) {
        console.log(`${todo.done ? "[x]" : "[ ]"} ${todo.title}  (${todo.id})`);
      }
    }),
  );

program
  .command("done")
  .argument("<id>", "The item's id, as printed by `ai-tutor list`")
  .description("Mark a to-do item done.")
  .action(
    action(async (id: string) => {
      const token = requireToken();
      const todo = await setTodoDone(token, id);
      console.log(`Done: ${todo.title}`);
    }),
  );

program.addHelpText(
  "after",
  [
    "",
    "Environment variables:",
    `  AI_TUTOR_SERVER_URL   Base URL of the ai-tutor server (default: ${DEFAULT_SERVER_URL})`,
    "  AI_TUTOR_CONFIG_DIR   Directory the session token is stored in (default: gh-style config dir)",
    "",
    "Examples:",
    "  $ ai-tutor login",
    "  $ ai-tutor whoami",
    '  $ ai-tutor add "Buy milk"',
    "  $ ai-tutor list --filter milk",
    "  $ ai-tutor done 3f9c1e2a-2b7e-4b0a-9c1a-1b2c3d4e5f60",
    "  $ ai-tutor logout",
  ].join("\n"),
);

await program.parseAsync();
