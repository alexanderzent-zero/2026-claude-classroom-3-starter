import "server-only";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { bearer, deviceAuthorization } from "better-auth/plugins";
import { authOptions } from "@/lib/auth-config";
import { db } from "@/lib/db";

export const auth = betterAuth({
  ...authOptions(db),
  // bearer lets the REST API in app/api/todos/ accept `Authorization: Bearer
  // <token>` from a CLI in place of the session cookie — getSession verifies
  // either the same way, against the same session row. deviceAuthorization is
  // how cli/ signs in: it mints the bearer token that ends up in that header,
  // and app/device/ is where a signed-in user approves the code it prints.
  // nextCookies mirrors Set-Cookie into next/headers, so it must stay last.
  plugins: [
    bearer(),
    deviceAuthorization({ verificationUri: "/device" }),
    nextCookies(),
  ],
});
