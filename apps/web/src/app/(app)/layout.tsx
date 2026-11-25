import { Sidebar } from "@/components/sidebar";
import { requireUser } from "@/lib/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Pages and server actions also check auth themselves; a layout check alone isn't enough.
  const user = await requireUser();
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar user={{ name: user.name, role: user.role }} />
      <main className="flex-1 p-6 md:p-10">
        {/* Wide enough for the pipeline board; forms cap their own width. */}
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
