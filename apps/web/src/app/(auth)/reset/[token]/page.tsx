import { and, eq, gt } from "drizzle-orm";
import { MIN_PASSWORD_LENGTH, passwordResets, users } from "@pennyats/db";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { hashToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { isResetToken } from "@/lib/password";
import { resetPasswordAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [reset] = isResetToken(token)
    ? await db()
        .select({ userId: passwordResets.userId })
        .from(passwordResets)
        .innerJoin(users, eq(users.id, passwordResets.userId))
        .where(and(
          eq(passwordResets.tokenHash, hashToken(token)),
          gt(passwordResets.expiresAt, new Date()),
          eq(users.active, true),
        ))
    : [];

  if (!reset) {
    return (
      <>
        <h1 className="text-xl font-semibold">Reset link not valid</h1>
        <p className="muted mt-1 text-sm">This link has expired or was already used. Ask an admin for a new one.</p>
      </>
    );
  }

  return (
    <>
      <h1 className="text-xl font-semibold">Set a new password</h1>
      <p className="muted mb-4 mt-1 text-sm">Your other sessions will be signed out.</p>
      <ActionForm action={resetPasswordAction.bind(null, token)}>
        <Field label={`Password (${MIN_PASSWORD_LENGTH}+ characters)`} name="password" type="password" autoComplete="new-password" required />
        <Field label="Confirm password" name="confirm" type="password" autoComplete="new-password" required />
        <SubmitButton>Reset password</SubmitButton>
      </ActionForm>
    </>
  );
}
