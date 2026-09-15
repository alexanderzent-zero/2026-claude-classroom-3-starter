import "server-only";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { bearer } from "better-auth/plugins";
import { authOptions } from "@/lib/auth-config";
import { db } from "@/lib/db";

export const auth = betterAuth({
  ...authOptions(db),
  // bearer lets the REST API in app/api/todos/ accept `Authorization: Bearer
  // <token>` from a CLI in place of the session cookie — getSession verifies
  // either the same way, against the same session row. nextCookies mirrors
  // Set-Cookie into next/headers, so it must stay last.
  plugins: [bearer(), nextCookies()],
});
