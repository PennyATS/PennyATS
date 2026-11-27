import { redirect } from "next/navigation";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { getCurrentUser } from "@/lib/auth";
import { DEMO_LOGINS, DEMO_PASSWORD, isDemoMode } from "@/lib/demo";
import { isSetupComplete } from "@/lib/instance";
import { loginAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (!(await isSetupComplete())) redirect("/setup");
  if (await getCurrentUser()) redirect("/");

  return (
    <>
      <h1 className="mb-4 text-xl font-semibold">Sign in</h1>
      {isDemoMode() && (
        <div className="inset mb-4 text-sm">
          <p className="font-medium">Demo accounts</p>
          <ul className="mt-1 space-y-0.5">
            {DEMO_LOGINS.map((l) => (
              <li key={l.email}>
                {l.role}: <code>{l.email}</code>
              </li>
            ))}
          </ul>
          <p className="mt-1">
            Password: <code>{DEMO_PASSWORD}</code>
          </p>
        </div>
      )}
      <ActionForm action={loginAction}>
        <Field label="Email" name="email" type="email" autoComplete="email" required />
        <Field label="Password" name="password" type="password" autoComplete="current-password" required />
        <SubmitButton>Sign in</SubmitButton>
      </ActionForm>
    </>
  );
}
