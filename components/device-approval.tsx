"use client";

import { type FormEvent, useState } from "react";
import { AuthCard } from "@/components/ui/auth-card";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormError } from "@/components/ui/form-error";
import { authClient } from "@/lib/auth-client";

type Step =
  | { name: "enter-code" }
  | { name: "review"; userCode: string; clientId?: string }
  | { name: "done"; outcome: "approved" | "denied" };

// Mirrors the server's own normalization (strip punctuation, uppercase) so a
// code copied with a dash in it still validates.
function normalizeCode(raw: string) {
  return raw.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

/**
 * What `cli/`'s `ai-tutor login` sends a user here to do: type the code it
 * printed, then approve or deny the command-line client it names. Three
 * steps, each its own `AuthCard` — a device code is entered once, reviewed
 * once, and the outcome is final, so there is no shared state worth lifting
 * above the step union.
 */
export function DeviceApproval({
  initialUserCode,
}: {
  initialUserCode?: string;
}) {
  const [step, setStep] = useState<Step>({ name: "enter-code" });
  const [code, setCode] = useState(initialUserCode ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onValidate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const userCode = normalizeCode(code);
    const { data, error: apiError } = await authClient.device({
      query: { user_code: userCode },
    });
    setPending(false);

    if (apiError || !data) {
      setError(
        "That code isn't valid, or it has expired. Check it and try again.",
      );
      return;
    }
    if (data.status !== "pending") {
      setError("This code was already approved or denied.");
      return;
    }
    setStep({ name: "review", userCode, clientId: data.client_id });
  }

  async function onApprove() {
    if (step.name !== "review") return;
    setPending(true);
    const { error: apiError } = await authClient.device.approve({
      userCode: step.userCode,
    });
    setPending(false);
    if (apiError) {
      setError(
        "Could not approve the request — it may have expired. Run the command again on the command line.",
      );
      return;
    }
    setStep({ name: "done", outcome: "approved" });
  }

  async function onDeny() {
    if (step.name !== "review") return;
    setPending(true);
    await authClient.device.deny({ userCode: step.userCode });
    setPending(false);
    setStep({ name: "done", outcome: "denied" });
  }

  if (step.name === "done") {
    return (
      <AuthCard
        title={
          step.outcome === "approved" ? "Device approved" : "Request denied"
        }
        footer={null}
      >
        <p className="text-base text-ink-soft">
          {step.outcome === "approved"
            ? "Go back to the command line — it will sign in on its own."
            : "The command line will report that the request was denied."}
        </p>
      </AuthCard>
    );
  }

  if (step.name === "review") {
    return (
      <AuthCard title="Approve this device?" footer={null}>
        <p className="text-base text-ink-soft">
          Code <span className="font-semibold text-ink">{step.userCode}</span>{" "}
          is signing in as{" "}
          <span className="font-semibold text-ink">
            {step.clientId ?? "a command-line client"}
          </span>
          . Only approve this if you just ran that command yourself.
        </p>
        <FormError message={error} />
        <div className="flex gap-3">
          <Button type="button" disabled={pending} onClick={onApprove}>
            {pending ? "Approving…" : "Approve"}
          </Button>
          <Button
            type="button"
            disabled={pending}
            className="border border-edge bg-transparent text-ink hover:bg-raised"
            onClick={onDeny}
          >
            {pending ? "Denying…" : "Deny"}
          </Button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Enter your device code"
      onSubmit={onValidate}
      footer={null}
    >
      <Field
        id="user_code"
        label="Code"
        value={code}
        onChange={(event) => setCode(event.target.value)}
        placeholder="ABCD-1234"
        autoComplete="off"
        autoFocus
        required
      />
      <FormError message={error} />
      <Button type="submit" disabled={pending || code.trim().length === 0}>
        {pending ? "Checking…" : "Continue"}
      </Button>
    </AuthCard>
  );
}
