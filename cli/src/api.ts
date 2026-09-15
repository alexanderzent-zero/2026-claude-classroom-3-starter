import {
  createTodoRequestSchema,
  createTodoResponseSchema,
  listTodosResponseSchema,
  setTodoDoneRequestSchema,
  setTodoDoneResponseSchema,
  type Todo,
} from "@ai-tutor/todo-api-schema";
import { loadToken, serverUrl } from "./config.js";

export type { Todo };

/** The client_id device/code and device/token were both requested with. */
const CLIENT_ID = "ai-tutor-cli";

export class ApiError extends Error {}

/** Thrown wherever a call needs a session and none is present or valid. */
export class NotAuthenticated extends ApiError {
  constructor() {
    super("Not logged in, or the session expired. Run `ai-tutor login`.");
  }
}

/** Shared by every command and MCP tool that needs a session before doing anything else. */
export function requireToken(): string {
  const token = loadToken();
  if (!token) {
    throw new NotAuthenticated();
  }
  return token;
}

function authApiUrl(path: string): URL {
  return new URL(`/api/auth${path}`, serverUrl());
}

export type DeviceCodeResponse = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
};

/** POST /api/auth/device/code — the first leg of RFC 8628. */
export async function requestDeviceCode(): Promise<DeviceCodeResponse> {
  const response = await fetch(authApiUrl("/device/code"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: CLIENT_ID }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error_description?: string;
    } | null;
    throw new ApiError(
      body?.error_description ?? `Could not start login (${response.status}).`,
    );
  }
  return response.json() as Promise<DeviceCodeResponse>;
}

export type DeviceTokenSuccess = {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
};
export type DeviceTokenError = {
  error:
    | "authorization_pending"
    | "slow_down"
    | "expired_token"
    | "access_denied"
    | "invalid_request"
    | "invalid_grant";
  error_description: string;
};

/**
 * POST /api/auth/device/token — always resolves, even on the server's 400s,
 * since `authorization_pending` and `slow_down` are the expected shape of
 * "not yet" and the login command's polling loop switches on `error`.
 */
export async function pollDeviceToken(
  deviceCode: string,
): Promise<DeviceTokenSuccess | DeviceTokenError> {
  const response = await fetch(authApiUrl("/device/token"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: deviceCode,
      client_id: CLIENT_ID,
    }),
  });
  return response.json() as Promise<DeviceTokenSuccess | DeviceTokenError>;
}

export type Session = { user: { id: string; email: string; name: string } };

/** GET /api/auth/get-session — the bearer plugin accepts the device token here. */
export async function fetchSession(token: string): Promise<Session | null> {
  const response = await fetch(authApiUrl("/get-session"), {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    return null;
  }
  const body = (await response.json()) as Session | null;
  return body ?? null;
}

/** POST /api/auth/sign-out — invalidates the session row server-side too. */
export async function signOut(token: string): Promise<void> {
  await fetch(authApiUrl("/sign-out"), {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
}

function todosApiUrl(path = ""): URL {
  return new URL(`/api/todos${path}`, serverUrl());
}

function authHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

async function assertOk(response: Response): Promise<void> {
  if (response.status === 401) {
    throw new NotAuthenticated();
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new ApiError(
      body?.error ?? `Request failed with status ${response.status}.`,
    );
  }
}

export async function listTodos(
  token: string,
  filter?: string,
): Promise<Todo[]> {
  const url = todosApiUrl();
  if (filter) {
    url.searchParams.set("filter", filter);
  }
  const response = await fetch(url, { headers: authHeaders(token) });
  await assertOk(response);
  return listTodosResponseSchema.parse(await response.json()).todos;
}

export async function addTodo(token: string, title: string): Promise<Todo> {
  const response = await fetch(todosApiUrl(), {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(createTodoRequestSchema.parse({ title })),
  });
  await assertOk(response);
  return createTodoResponseSchema.parse(await response.json()).todo;
}

export async function setTodoDone(token: string, id: string): Promise<Todo> {
  const response = await fetch(todosApiUrl(`/${encodeURIComponent(id)}`), {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify(setTodoDoneRequestSchema.parse({ done: true })),
  });
  await assertOk(response);
  return setTodoDoneResponseSchema.parse(await response.json()).todo;
}
