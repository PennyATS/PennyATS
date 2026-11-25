import { TopNav } from "@/components/top-nav";
import { requireUser } from "@/lib/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Pages and server actions also check auth themselves; a layout check alone isn't enough.
  const user = await requireUser();
  return (
    <div className="flex min-h-screen flex-col">
      <TopNav user={{ name: user.name, role: user.role }} />
      <main className="min-w-0 flex-1 p-6 md:p-10">{children}</main>
    </div>
  );
}
