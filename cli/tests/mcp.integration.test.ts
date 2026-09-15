import { Client } from "@modelcontextprotocol/client";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/client/stdio";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { saveToken } from "../src/config.js";
import {
  buildCli,
  cliBin,
  startTestServer,
  type TestServer,
} from "./test-server.js";

// Drives the *built* `ai-tutor mcp --stdio` over the real MCP client SDK,
// against the same kind of test server cli.integration.test.ts uses (real
// `next dev`, temp database, temp config dir) — its own dist dir so the two
// suites' `next dev` instances never fight over one lock file.
let server: TestServer;

function textOf(result: {
  content: Array<{ type: string; text?: string }>;
}): string {
  const block = result.content.find((item) => item.type === "text");
  return block?.text ?? "";
}

async function connectClient(
  configDir: string,
): Promise<{ client: Client; close: () => Promise<void> }> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cliBin, "mcp", "--stdio"],
    env: {
      ...getDefaultEnvironment(),
      AI_TUTOR_SERVER_URL: server.baseUrl,
      AI_TUTOR_CONFIG_DIR: configDir,
    },
  });
  const client = new Client({ name: "ai-tutor-mcp-test", version: "0.0.0" });
  await client.connect(transport);
  return { client, close: () => client.close() };
}

beforeAll(async () => {
  buildCli();
  server = await startTestServer(".next-mcp-test");
}, 120_000);

afterAll(async () => {
  await server?.stop();
});

describe("logged in", () => {
  let client: Client;
  let close: () => Promise<void>;

  beforeAll(async () => {
    // Pre-populate a valid login, in exactly the file `ai-tutor login` would
    // have written — this suite isn't testing the device-code flow itself
    // (cli.integration.test.ts already does), just that the MCP tools use
    // whatever session is already on disk.
    const { token } = await server.login();
    const previousConfigDir = process.env.AI_TUTOR_CONFIG_DIR;
    process.env.AI_TUTOR_CONFIG_DIR = server.configDir;
    saveToken(token);
    if (previousConfigDir === undefined) {
      delete process.env.AI_TUTOR_CONFIG_DIR;
    } else {
      process.env.AI_TUTOR_CONFIG_DIR = previousConfigDir;
    }

    ({ client, close } = await connectClient(server.configDir));
  });

  afterAll(async () => {
    await close?.();
  });

  test("lists the list, add, and done tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "add",
      "done",
      "list",
    ]);
  });

  test("add, list (with and without a filter), and done round-trip", async () => {
    const added = await client.callTool({
      name: "add",
      arguments: { title: "Buy milk" },
    });
    expect(added.isError).toBeFalsy();
    const addedText = textOf(added);
    expect(addedText).toContain("Added: Buy milk");
    const id = addedText.match(/\(([^)]+)\)/)?.[1];
    expect(id).toBeTruthy();

    const listed = await client.callTool({ name: "list", arguments: {} });
    expect(textOf(listed)).toContain("[ ] Buy milk");

    const filteredMatch = await client.callTool({
      name: "list",
      arguments: { filter: "milk" },
    });
    expect(textOf(filteredMatch)).toContain("Buy milk");

    const filteredMiss = await client.callTool({
      name: "list",
      arguments: { filter: "eggs" },
    });
    expect(textOf(filteredMiss)).toBe("Nothing on the list.");

    const done = await client.callTool({ name: "done", arguments: { id } });
    expect(done.isError).toBeFalsy();
    expect(textOf(done)).toBe("Done: Buy milk");

    const listedAfter = await client.callTool({ name: "list", arguments: {} });
    expect(textOf(listedAfter)).toContain("[x] Buy milk");
  });
});

test("without a login, every tool call errors and points at `ai-tutor login`", async () => {
  const { client, close } = await connectClient(`${server.dataDir}-no-login`);

  try {
    for (const call of [
      { name: "list", arguments: {} },
      { name: "add", arguments: { title: "Buy milk" } },
      { name: "done", arguments: { id: "anything" } },
    ]) {
      const result = await client.callTool(call);
      expect(result.isError).toBe(true);
      expect(textOf(result)).toBe(
        "Not logged in, or the session expired. Run `ai-tutor login`.",
      );
    }
  } finally {
    await close();
  }
});
