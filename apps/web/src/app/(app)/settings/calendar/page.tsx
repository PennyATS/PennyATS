import { ActionForm, SubmitButton } from "@/components/form";
import { requireUser } from "@/lib/auth";
import { calendarConnectionState, googleCalendarConfigured } from "@/lib/google-calendar";
import { disconnectCalendarAction, saveWorkingHoursAction, testCalendarAction } from "./actions";

export default async function CalendarSettingsPage({ searchParams }: {
  searchParams: Promise<{ status?: string }>;
}) {
  const user = await requireUser();
  const connection = await calendarConnectionState(user.id);
  const configured = googleCalendarConfigured();
  const { status } = await searchParams;
  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold tracking-tight">Google Calendar</h1>
      <p className="muted mt-1 text-sm">Connect your calendar to show interviewer availability and send interview invitations. Manual scheduling works without a connection.</p>
      {status === "connected" && <p role="status" className="mt-4 text-sm">Google Calendar connected.</p>}
      {status === "error" && <p role="alert" className="error mt-4 text-sm">The Google connection could not be completed. Try again.</p>}
      <section className="card mt-6 space-y-4">
        <div>
          <h2 className="font-semibold">Your connection</h2>
          <p className="muted mt-1 text-sm">{connection ? `Connected ${connection.connectedAt.toLocaleDateString()}` : "Not connected"}</p>
          {connection?.lastError && <p role="alert" className="error mt-1 text-sm">{connection.lastError}</p>}
        </div>
        {!configured ? (
          <p className="muted text-sm">An administrator must set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on this install before calendars can connect.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            <a href="/api/google-calendar/connect" className="btn">{connection ? "Reconnect Google Calendar" : "Connect Google Calendar"}</a>
            {connection && <ActionForm action={testCalendarAction}><SubmitButton variant="secondary">Test availability</SubmitButton></ActionForm>}
          </div>
        )}
        {connection && <ActionForm action={disconnectCalendarAction}>
          <SubmitButton variant="secondary">Disconnect</SubmitButton>
        </ActionForm>}
      </section>
      {connection && <section className="card mt-6 space-y-4">
        <div>
          <h2 className="font-semibold">Booking hours</h2>
          <p className="muted mt-1 text-sm">Candidate booking slots stay within these hours and your Google Calendar availability.</p>
        </div>
        <ActionForm action={saveWorkingHoursAction} resetKey={`${connection.workingTimeZone}-${connection.workStartMinute}-${connection.workEndMinute}-${connection.workingDays.join(",")}`} className="space-y-4">
          <div><label htmlFor="working-zone" className="label">Time zone</label>
            <input id="working-zone" name="timeZone" className="input" required defaultValue={connection.workingTimeZone} />
          </div>
          <fieldset><legend className="label">Working days</legend><div className="flex flex-wrap gap-3 text-sm">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label, day) =>
              <label key={day} className="flex items-center gap-1"><input type="checkbox" name="day" value={day}
                defaultChecked={connection.workingDays.includes(day)} />{label}</label>)}
          </div></fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label htmlFor="work-start" className="label">Start</label><input id="work-start" name="start" type="time" className="input" required
              defaultValue={`${String(Math.floor(connection.workStartMinute / 60)).padStart(2, "0")}:${String(connection.workStartMinute % 60).padStart(2, "0")}`} /></div>
            <div><label htmlFor="work-end" className="label">End</label><input id="work-end" name="end" type="time" className="input" required
              defaultValue={`${String(Math.floor(connection.workEndMinute / 60)).padStart(2, "0")}:${String(connection.workEndMinute % 60).padStart(2, "0")}`} /></div>
          </div>
          <SubmitButton>Save booking hours</SubmitButton>
        </ActionForm>
      </section>}
      <p className="muted mt-3 text-xs">Disconnecting stops future calendar updates. Invitations already sent remain on Google Calendar.</p>
    </div>
  );
}
