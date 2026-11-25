import { asc, eq } from "drizzle-orm";
import { users } from "@pennyats/db";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canManageHiring } from "@/lib/permissions";
import { createJobAction } from "../actions";
import { JobForm } from "../job-form";

export default async function NewJobPage() {
  const user = await requireUser(canManageHiring);
  const people = await db()
    .select({ id: users.id, name: users.name, role: users.role })
    .from(users)
    .where(eq(users.active, true))
    .orderBy(asc(users.name));
  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">New job</h1>
      <JobForm action={createJobAction} people={people} job={{ title: "", department: null, team: null, location: null, region: null, headcount: null, description: null, status: "draft", recruiterId: user.role === "recruiter" ? user.id : null }} submitLabel="Create job" />
      <p className="muted mt-3 text-sm">
        New jobs start with the default stages. You can change them after creating the job.
      </p>
    </>
  );
}
