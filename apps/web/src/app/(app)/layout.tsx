import { TopNav } from "@/components/top-nav";
import { requireUser } from "@/lib/auth";
import { loadNotifications } from "@/lib/notifications";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Pages and server actions also check auth themselves; a layout check alone isn't enough.
  const user = await requireUser();
  const inbox = await loadNotifications(user.id, 8);
  return (
    <div className="flex min-h-screen flex-col">
      <TopNav
        user={{ name: user.name, role: user.role, permissions: user.permissions }}
        notifications={{
          unread: inbox.unread,
          rows: inbox.rows.map((n) => ({ id: n.id, text: n.text, read: n.read, at: n.createdAt.toISOString() })),
        }}
      />
      <main className="min-w-0 flex-1 p-6 md:p-10">{children}</main>
    </div>
  );
}
