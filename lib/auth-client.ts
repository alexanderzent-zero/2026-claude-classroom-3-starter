import { deviceAuthorizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

// Same-origin, so the client needs no baseURL. deviceAuthorizationClient is
// for app/device/, where a signed-in user approves or denies the code cli/
// printed.
export const authClient = createAuthClient({
  plugins: [deviceAuthorizationClient()],
});
