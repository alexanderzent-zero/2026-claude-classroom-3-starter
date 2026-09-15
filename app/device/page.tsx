import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { DeviceApproval } from "@/components/device-approval";
import { SignOutButton } from "@/components/sign-out-button";
import { PageHeader } from "@/components/ui/page-header";
import { auth } from "@/lib/auth";

/**
 * Where `cli/`'s `ai-tutor login` sends a user: enter the device code it
 * printed, then approve or deny the command-line client asking for it. Gated
 * the same way `/` is — an unauthenticated visitor bounces to `/login`, which
 * sends them back here once signed in, code and all.
 */
export default async function DevicePage({
  searchParams,
}: PageProps<"/device">) {
  const params = await searchParams;
  const userCode =
    typeof params.user_code === "string" ? params.user_code : undefined;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    const redirectTo = userCode
      ? `/device?user_code=${encodeURIComponent(userCode)}`
      : "/device";
    redirect(`/login?redirect=${encodeURIComponent(redirectTo)}`);
  }

  return (
    <>
      <PageHeader title="Bartholomew" subtitle={session.user.name}>
        <SignOutButton />
      </PageHeader>
      <DeviceApproval initialUserCode={userCode} />
    </>
  );
}
