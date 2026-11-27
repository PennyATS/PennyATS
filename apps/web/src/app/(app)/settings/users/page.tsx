import { and, asc, desc, eq, gt, isNull } from "drizzle-orm";
import { invites, roles, users } from "@pennyats/db";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ROLE_PRESETS, ROLES, canAssignRole, can, isRole, roleName, type Role } from "@/lib/permissions";
import { createInviteAction, createPasswordResetAction, revokeInviteAction, updateUserAction } from "./actions";

export default async function UsersPage() {
  const me = await requireUser("users.invite");
  const manage = can(me, "users.manage");
  const [peopleRows, pendingRows] = await Promise.all([
    db()
      .select({ id: users.id, name: users.name, email: users.email, active: users.active, role: roles.key })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .orderBy(asc(users.name)),
    db()
      .select({ id: invites.id, email: invites.email, expiresAt: invites.expiresAt, role: roles.key })
      .from(invites)
      .innerJoin(roles, eq(roles.id, invites.roleId))
      .where(and(isNull(invites.acceptedAt), gt(invites.expiresAt, new Date())))
      .orderBy(desc(invites.createdAt)),
  ]);
  const known = <T extends { role: string }>(rows: T[]) => rows.filter((r): r is T & { role: Role } => isRole(r.role));
  const people = known(peopleRows);
  const pending = known(pendingRows);
  const activeAdmins = people.filter((u) => u.active && can({ role: u.role }, "roles.manage")).length;
  const assignable = ROLES.filter((r) => canAssignRole(me, r));

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Users</h1>

      <div className="mt-6 overflow-x-auto">
      <table className="table">
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
                {!manage ? roleName(u.role) : (
                <ActionForm action={updateUserAction.bind(null, u.id)} resetKey={u.role} className="space-y-1">
                  <input type="hidden" name="intent" value="role" />
                  <label className="sr-only" htmlFor={`role-${u.id}`}>Role for {u.name}</label>
                  <div className="flex flex-wrap items-center gap-2">
                    <select id={`role-${u.id}`} name="role" className="input" defaultValue={u.role}>
                      {ROLES.map((r) => <option key={r} value={r}>{roleName(r)}</option>)}
                    </select>
                    <SubmitButton variant="secondary">Save</SubmitButton>
                  </div>
                </ActionForm>
                )}
              </td>
              <td>{u.active ? "Active" : "Deactivated"}</td>
              <td>
                {manage && <div className="space-y-3">
                  {u.active && can({ role: u.role }, "roles.manage") && activeAdmins === 1 ? (
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
                  {u.active && (
                    <ActionForm action={createPasswordResetAction.bind(null, u.id)} className="space-y-1 break-all">
                      <SubmitButton variant="secondary">Send or create reset link</SubmitButton>
                    </ActionForm>
                  )}
                </div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>

      <h2 className="mt-10 text-lg font-semibold">Invite someone</h2>
      <p className="muted mb-3 text-sm">
        Each role is a set of permissions. You can invite people to roles with no more access than your own.
      </p>
      <ActionForm action={createInviteAction} className="card max-w-md space-y-4 break-all">
        <Field label="Email" name="email" type="email" required />
        <div>
          <label className="label" htmlFor="role">
            Role
          </label>
          <select id="role" name="role" className="input" defaultValue={assignable.includes("recruiter") ? "recruiter" : assignable[0]} aria-describedby="role-help">
            {assignable.map((r) => (
              <option key={r} value={r}>
                {roleName(r)}
              </option>
            ))}
          </select>
        </div>
        <SubmitButton>Send or create invite</SubmitButton>
      </ActionForm>

      <h2 className="mt-10 text-lg font-semibold">What each role can do</h2>
      <dl id="role-help" className="mt-3 max-w-2xl space-y-3 text-sm">
        {ROLES.map((r) => (
          <div key={r}>
            <dt className="font-medium">{ROLE_PRESETS[r].name}</dt>
            <dd className="muted">{ROLE_PRESETS[r].description}</dd>
          </div>
        ))}
      </dl>

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
                  <td>{roleName(i.role)}</td>
                  <td>{i.expiresAt.toLocaleDateString()}</td>
                  <td>
                    {canAssignRole(me, i.role) && (
                      <form action={revokeInviteAction.bind(null, i.id)}>
                        <button type="submit" className="link">
                          Revoke
                        </button>
                      </form>
                    )}
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
