import Link from "next/link";
import { logoutAction } from "@/app/(auth)/actions";
import type { SessionUser } from "@/lib/auth";
import { BRAND } from "@/lib/brand";
import { canManageUsers } from "@/lib/permissions";

export function Sidebar({ user }: { user: SessionUser }) {
  const nav = [
    { href: "/", label: "Dashboard" },
    { href: "/jobs", label: "Jobs" },
    { href: "/candidates", label: "Candidates" },
    ...(canManageUsers(user.role)
      ? [
          { href: "/settings/users", label: "Users" },
          { href: "/settings/privacy", label: "Privacy" },
        ]
      : []),
    { href: "/careers", label: "Careers page" },
  ];

  return (
    <aside
      className="flex shrink-0 flex-wrap items-center gap-2 border-b p-4 md:w-56 md:flex-col md:items-stretch md:border-b-0 md:border-r"
      style={{ borderColor: "var(--border)", background: "var(--surface)" }}
    >
      <div className="mr-4 text-lg font-semibold tracking-tight md:mb-4 md:mr-0">{BRAND.name}</div>
      <nav className="flex flex-wrap gap-1 text-sm md:flex-col">
        {nav.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="rounded-md px-3 py-2 hover:bg-black/5 dark:hover:bg-white/10"
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="ml-auto text-sm md:ml-0 md:mt-auto md:pt-6">
        <div className="truncate">{user.name}</div>
        <div className="muted mb-2 text-xs capitalize">{user.role}</div>
        <form action={logoutAction}>
          <button type="submit" className="link text-xs">
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
