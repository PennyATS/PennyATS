import { and, asc, desc, gt, isNull } from "drizzle-orm";
import { invites, users } from "@pennyats/db";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ROLES, canManageUsers } from "@/lib/permissions";
import { createInviteAction, revokeInviteAction, updateUserAction } from "./actions";

export default async function UsersPage() {
  await requireUser(canManageUsers);
  const [people, pending] = await Promise.all([
    db().select().from(users).orderBy(asc(users.name)),
    db()
      .select()
      .from(invites)
      .where(and(isNull(invites.acceptedAt), gt(invites.expiresAt, new Date())))
      .orderBy(desc(invites.createdAt)),
  ]);
  const activeAdmins = people.filter((u) => u.active && u.role === "admin").length;

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Users</h1>

      <table className="table mt-6">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th>Status</th>
            <th>Access</th>
          </tr>
        </thead>
        <tbody>
          {people.map((u) => (
            <tr key={u.id}>
              <td>{u.name}</td>
              <td>{u.email}</td>
              <td>
                <ActionForm action={updateUserAction.bind(null, u.id)} resetKey={u.role} className="space-y-1">
                  <input type="hidden" name="intent" value="role" />
                  <label className="sr-only" htmlFor={`role-${u.id}`}>Role for {u.name}</label>
                  <div className="flex flex-wrap items-center gap-2">
                    <select id={`role-${u.id}`} name="role" className="input" defaultValue={u.role}>
                      {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                    <SubmitButton variant="secondary">Save</SubmitButton>
                  </div>
                </ActionForm>
              </td>
              <td>{u.active ? "Active" : "Deactivated"}</td>
              <td>
                {u.active && u.role === "admin" && activeAdmins === 1 ? (
                  <span className="muted text-sm">Last active admin</span>
                ) : (
                  <ActionForm action={updateUserAction.bind(null, u.id)} resetKey={String(u.active)} className="space-y-2">
                    <input type="hidden" name="intent" value={u.active ? "deactivate" : "reactivate"} />
                    {u.active && (
                      <label className="flex items-center gap-1 text-xs">
                        <input type="checkbox" name="confirm" /> Confirm
                      </label>
                    )}
                    <SubmitButton variant="secondary">{u.active ? "Deactivate" : "Reactivate"}</SubmitButton>
                  </ActionForm>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="mt-10 text-lg font-semibold">Invite someone</h2>
      <p className="muted mb-3 text-sm">
        Admins manage everything. Recruiters manage jobs and candidates. Interviewers see only jobs
        they are on the hiring team for.
      </p>
      <ActionForm action={createInviteAction} className="card max-w-md space-y-4 break-all">
        <Field label="Email" name="email" type="email" required />
        <div>
          <label className="label" htmlFor="role">
            Role
          </label>
          <select id="role" name="role" className="input" defaultValue="recruiter">
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <SubmitButton>Create invite link</SubmitButton>
      </ActionForm>

      {pending.length > 0 && (
        <>
          <h2 className="mt-10 text-lg font-semibold">Pending invites</h2>
          <table className="table mt-3">
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th>Expires</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {pending.map((i) => (
                <tr key={i.id}>
                  <td>{i.email}</td>
                  <td className="capitalize">{i.role}</td>
                  <td>{i.expiresAt.toLocaleDateString()}</td>
                  <td>
                    <form action={revokeInviteAction.bind(null, i.id)}>
                      <button type="submit" className="link">
                        Revoke
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}
