"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutAction } from "@/app/(auth)/actions";
import type { SessionUser } from "@/lib/auth";
import { BRAND } from "@/lib/brand";
import { canManageHiring, canManageUsers } from "@/lib/permissions";

function NavLink({ href, label, round = false }: { href: string; label: string; round?: boolean }) {
  const pathname = usePathname();
  const active = pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex h-[42px] shrink-0 items-center gap-3 rounded-[9px] px-3 text-sm transition-colors ${
        active
          ? "bg-[#F0EEFA] font-semibold text-[#4D3F9D]"
          : "font-medium text-[#555867] hover:bg-[#F6F7FA] hover:text-[var(--text)]"
      }`}
    >
      <span
        aria-hidden="true"
        className={`size-2 shrink-0 ${round ? "rounded-full" : "rounded-[2px]"} ${
          active ? "bg-[#6253B5]" : "border-[1.5px] border-[#9295A4]"
        }`}
      />
      {label}
    </Link>
  );
}

export function Sidebar({ user }: { user: Pick<SessionUser, "name" | "role"> }) {
  const workspace = [
    { href: "/", label: "Dashboard" },
    { href: "/jobs", label: "Jobs" },
    { href: "/candidates", label: "Candidates", round: true },
    ...(canManageHiring(user.role) ? [{ href: "/reports", label: "Reports" }] : []),
  ];
  const manage = [
    ...(canManageUsers(user.role)
      ? [
          { href: "/settings/users", label: "Users", round: true },
          { href: "/settings/privacy", label: "Privacy" },
          { href: "/settings/ai", label: "AI" },
        ]
      : []),
    { href: "/careers", label: "Careers page" },
  ];
  const initials = user.name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return (
    <aside className="flex shrink-0 flex-col border-b border-[var(--border)] bg-[var(--surface)] px-4 py-5 md:sticky md:top-0 md:h-screen md:w-[232px] md:border-r md:border-b-0 md:pt-7 md:pb-6">
      <div className="flex items-center justify-between gap-3 px-3 pb-5 md:pb-8">
        <Link href="/" className="flex items-center gap-3" aria-label={`${BRAND.name} home`}>
          <span aria-hidden="true" className="flex size-8 items-center justify-center rounded-[9px] bg-[var(--accent)] text-xl font-bold text-white">P</span>
          <span className="text-lg font-bold tracking-[-0.04em]">{BRAND.name}</span>
        </Link>
        <form action={logoutAction} className="md:hidden">
          <button type="submit" className="text-xs text-[var(--muted)] hover:text-[var(--accent)]">Sign out</button>
        </form>
      </div>

      <nav aria-label="Main navigation" className="flex gap-5 overflow-x-auto md:flex-col md:gap-0 md:overflow-visible">
        <div className="flex shrink-0 items-center gap-1 md:flex-col md:items-stretch">
          <div className="hidden px-3 pt-2.5 pb-3 text-[11px] font-bold tracking-[0.12em] text-[#8A8D9B] md:block">WORKSPACE</div>
          {workspace.map((item) => <NavLink key={item.href} {...item} />)}
        </div>
        <div className="flex shrink-0 items-center gap-1 md:flex-col md:items-stretch">
          <div className="hidden px-3 pt-[30px] pb-3 text-[11px] font-bold tracking-[0.12em] text-[#8A8D9B] md:block">MANAGE</div>
          {manage.map((item) => <NavLink key={item.href} {...item} />)}
        </div>
      </nav>

      <div className="mt-auto hidden border-t border-[var(--border)] px-2.5 pt-4 md:block">
        <div className="flex items-center gap-2.5">
          <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#DCD7F5] text-xs font-bold text-[#4D3F9D]">{initials || "P"}</span>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold">{user.name}</div>
            <div className="text-[11px] capitalize text-[#8A8D9B]">{user.role}</div>
          </div>
        </div>
        <form action={logoutAction} className="mt-3 pl-[42px]">
          <button type="submit" className="text-xs text-[var(--muted)] hover:text-[var(--accent)]">Sign out</button>
        </form>
      </div>
    </aside>
  );
}
