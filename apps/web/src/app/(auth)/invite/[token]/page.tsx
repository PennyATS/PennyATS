import { and, eq, gt, isNull } from "drizzle-orm";
import { MIN_PASSWORD_LENGTH, invites } from "@pennyats/db";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { hashToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { acceptInviteAction } from "../../actions";

export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [invite] = await db()
    .select({ email: invites.email, role: invites.role })
    .from(invites)
    .where(
      and(
        eq(invites.tokenHash, hashToken(token)),
        isNull(invites.acceptedAt),
        gt(invites.expiresAt, new Date()),
      ),
    );

  if (!invite) {
    return (
      <>
        <h1 className="text-xl font-semibold">Invite not valid</h1>
        <p className="muted mt-1 text-sm">This link has expired or was already used. Ask an admin for a new one.</p>
      </>
    );
  }

  return (
    <>
      <h1 className="text-xl font-semibold">Join your team</h1>
      <p className="muted mb-4 mt-1 text-sm">
        Creating the {invite.role} account for {invite.email}.
      </p>
      <ActionForm action={acceptInviteAction.bind(null, token)}>
        <Field label="Your name" name="name" autoComplete="name" required />
        <Field label={`Password (${MIN_PASSWORD_LENGTH}+ characters)`} name="password" type="password" autoComplete="new-password" required />
        <Field label="Confirm password" name="confirm" type="password" autoComplete="new-password" required />
        <SubmitButton>Create account</SubmitButton>
      </ActionForm>
    </>
  );
}
