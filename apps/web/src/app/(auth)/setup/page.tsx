import { redirect } from "next/navigation";
import { MIN_PASSWORD_LENGTH } from "@pennyats/db";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { isDemoMode } from "@/lib/demo";
import { isSetupComplete } from "@/lib/instance";
import { setupAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if (await isSetupComplete()) redirect("/login");
  // The demo is loaded by demo:reset; nobody may claim it as its first admin.
  if (isDemoMode()) {
    return (
      <>
        <h1 className="text-xl font-semibold">The demo is resetting</h1>
        <p className="muted mt-1 text-sm">Fresh sample data is loading. Try again in a minute.</p>
      </>
    );
  }

  return (
    <>
      <h1 className="text-xl font-semibold">Set up your workspace</h1>
      <p className="muted mb-4 mt-1 text-sm">Create the first admin account. You can invite your team after.</p>
      <ActionForm action={setupAction}>
        <Field label="Your name" name="name" autoComplete="name" required />
        <Field label="Email" name="email" type="email" autoComplete="email" required />
        <Field label={`Password (${MIN_PASSWORD_LENGTH}+ characters)`} name="password" type="password" autoComplete="new-password" required />
        <Field label="Confirm password" name="confirm" type="password" autoComplete="new-password" required />
        <SubmitButton>Create admin account</SubmitButton>
      </ActionForm>
    </>
  );
}
