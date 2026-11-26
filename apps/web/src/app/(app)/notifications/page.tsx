import { requireUser } from "@/lib/auth";
import { loadNotifications } from "@/lib/notifications";
import { LocalTime } from "@/components/local-time";
import { markAllReadAction, openNotificationAction } from "./actions";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const user = await requireUser();
  const { rows, unread } = await loadNotifications(user.id, 100);
  return (
    <div className="max-w-3xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] leading-[34px] font-bold tracking-[-0.04em]">Notifications</h1>
          <p className="muted mt-1 text-sm">{unread} unread</p>
        </div>
        {unread > 0 && (
          <form action={markAllReadAction}>
            <button type="submit" className="btn btn-secondary">Mark all read</button>
          </form>
        )}
      </div>
      <section className="card mt-5 !p-0">
        {rows.length === 0 ? (
          <p className="muted p-6 text-sm">Nothing yet. You&apos;ll hear about new applicants, stage moves on your jobs, and interviews you&apos;re assigned to.</p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {rows.map((n) => (
              <li key={n.id}>
                <form action={openNotificationAction.bind(null, n.id)}>
                  <button type="submit" className="flex w-full items-start gap-3 px-5 py-3.5 text-left text-sm hover:bg-[#f3f7f4]">
                    <span aria-hidden="true" className={`mt-1.5 size-2 shrink-0 rounded-full ${n.read ? "bg-transparent" : "bg-[var(--accent)]"}`} />
                    <span className="min-w-0 flex-1">
                      <span className={n.read ? "" : "font-medium"}>{n.text}</span>
                      {!n.read && <span className="sr-only"> (unread)</span>}
                      <span className="muted block text-xs"><LocalTime iso={n.createdAt.toISOString()} /></span>
                    </span>
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
