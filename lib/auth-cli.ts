import { betterAuth } from "better-auth";
import { deviceAuthorization } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/libsql/node";
import { authOptions } from "@/lib/auth-config";

/**
 * Config target for `npm run auth:generate` only. The Better Auth CLI refuses to
 * load a module graph containing `server-only`, which rules out lib/auth.ts, and
 * `generate` never queries the database — hence the throwaway connection.
 * deviceAuthorization is the one plugin here (bearer and nextCookies add no
 * schema) because its `deviceCode` table has to reach the generated schema.
 */
export const auth = betterAuth({
  ...authOptions(drizzle({ connection: { url: ":memory:" } })),
  plugins: [deviceAuthorization({ verificationUri: "/device" })],
});
