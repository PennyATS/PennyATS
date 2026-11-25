import { redirect } from "next/navigation";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { getCurrentUser } from "@/lib/auth";
import { isSetupComplete } from "@/lib/instance";
import { loginAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (!(await isSetupComplete())) redirect("/setup");
  if (await getCurrentUser()) redirect("/");

  return (
    <>
      <h1 className="mb-4 text-xl font-semibold">Sign in</h1>
      <ActionForm action={loginAction}>
        <Field label="Email" name="email" type="email" autoComplete="email" required />
        <Field label="Password" name="password" type="password" autoComplete="current-password" required />
        <SubmitButton>Sign in</SubmitButton>
      </ActionForm>
    </>
  );
}
