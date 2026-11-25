"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutAction } from "@/app/(auth)/actions";
import type { SessionUser } from "@/lib/auth";
import { BRAND } from "@/lib/brand";
import { canManageHiring, canManageUsers } from "@/lib/permissions";

type IconName = "home" | "jobs" | "candidates" | "reports" | "settings" | "careers" | "chevron" | "menu" | "plus";

function Icon({ name, className = "size-4" }: { name: IconName; className?: string }) {
  const paths: Record<IconName, React.ReactNode> = {
    home: <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V10Z" /><path d="M9 21v-8h6v8" /></>,
    jobs: <><rect x="3" y="6" width="18" height="15" rx="2" /><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M3 12h18" /></>,
    candidates: <><circle cx="9" cy="8" r="3" /><path d="M3 20v-2a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v2M16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 4v2" /></>,
    reports: <><path d="M4 20V4M4 20h17M8 16l4-5 3 2 5-6" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></>,
    careers: <><path d="M4 7h16v13H4zM8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M4 12h16" /></>,
    chevron: <path d="m6 9 6 6 6-6" />,
    menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
  };

  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
}

function NavLink({ href, label, icon, compact = false }: { href: string; label: string; icon: IconName; compact?: boolean }) {
  const pathname = usePathname();
  const active = pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-2 rounded-md px-3 py-2 text-[13px] font-medium transition-colors ${
        active ? "bg-white/15 text-white" : "text-[#c7c5d7] hover:bg-white/10 hover:text-white"
      } ${compact ? "w-full" : "whitespace-nowrap"}`}
    >
      <Icon name={icon} className="size-[15px] shrink-0" />
      {label}
    </Link>
  );
}

export function TopNav({ user }: { user: Pick<SessionUser, "name" | "role"> }) {
  const pathname = usePathname();
  const canHire = canManageHiring(user.role);
  const canAdmin = canManageUsers(user.role);
  const initials = user.name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "P";
  const primary: { href: string; label: string; icon: IconName }[] = [
    { href: "/", label: "Dashboard", icon: "home" },
    { href: "/jobs", label: "Jobs", icon: "jobs" },
    { href: "/candidates", label: "Candidates", icon: "candidates" },
    ...(canHire ? [{ href: "/reports", label: "Reports", icon: "reports" as const }] : []),
  ];
  const secondary: { href: string; label: string; icon: IconName }[] = [
    ...(canAdmin ? [
      { href: "/settings/users", label: "Users", icon: "candidates" as const },
      { href: "/settings/privacy", label: "Privacy", icon: "settings" as const },
      { href: "/settings/ai", label: "AI", icon: "settings" as const },
    ] : []),
    { href: "/careers", label: "Careers page", icon: "careers" },
  ];
  const manageActive = pathname.startsWith("/settings") || pathname.startsWith("/careers");

  return (
    <header className="sticky top-0 z-40 border-b border-[#343052] bg-[#1d1a35] text-white shadow-[0_2px_12px_#17142b20]">
      <div className="flex h-14 items-stretch px-3 sm:px-5">
        <Link href="/" aria-label={`${BRAND.name} home`} className="flex shrink-0 items-center gap-3 pr-4">
          <span aria-hidden="true" className="flex size-10 items-center justify-center rounded-sm bg-[#5747aa] text-[29px] font-bold leading-none tracking-[-0.08em] text-white shadow-[inset_0_1px_0_#ffffff30]">P</span>
          <span className="hidden text-sm font-bold tracking-tight text-white 2xl:inline">{BRAND.name}</span>
        </Link>

        <nav aria-label="Main navigation" className="hidden min-w-0 items-center gap-0.5 lg:flex">
          {primary.map((item) => <NavLink key={item.href} {...item} />)}
          <details key={`manage-${pathname}`} className="group relative">
            <summary className={`flex cursor-pointer list-none items-center gap-2 rounded-md px-3 py-2 text-[13px] font-medium transition-colors [&::-webkit-details-marker]:hidden ${manageActive ? "bg-white/15 text-white" : "text-[#c7c5d7] hover:bg-white/10 hover:text-white"}`}>
              <Icon name="settings" className="size-[15px]" />
              {canAdmin ? "Admin" : "More"}
              <Icon name="chevron" className="size-3 transition-transform group-open:rotate-180" />
            </summary>
            <div className="absolute left-0 top-[calc(100%+8px)] min-w-48 rounded-lg border border-[#e2e0ed] bg-white p-1.5 text-[#28243d] shadow-xl">
              {secondary.map((item) => (
                <Link key={item.href} href={item.href} className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-[#f1effa] hover:text-[#4d3f9d]">
                  <Icon name={item.icon} className="size-4" />{item.label}
                </Link>
              ))}
            </div>
          </details>
        </nav>

        <div className="ml-auto hidden items-center gap-3 lg:flex">
          {canHire && (
            <Link href="/jobs/new" className="flex h-8 items-center gap-1.5 rounded-md border border-[#514b70] px-3 text-xs font-medium text-white transition-colors hover:bg-white/10">
              <Icon name="plus" className="size-3.5" /> Add job
            </Link>
          )}
          <details key={`user-${pathname}`} className="group relative">
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md px-2 py-1.5 hover:bg-white/10 [&::-webkit-details-marker]:hidden">
              <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#ded9fa] text-[10px] font-bold text-[#4d3f9d]">{initials}</span>
              <span className="max-w-32 text-left leading-tight">
                <span className="block truncate text-xs font-semibold">{user.name}</span>
                <span className="block text-[10px] capitalize text-[#b7b3cc]">{user.role}</span>
              </span>
              <Icon name="chevron" className="size-3 text-[#b7b3cc] transition-transform group-open:rotate-180" />
            </summary>
            <div className="absolute right-0 top-[calc(100%+8px)] min-w-40 rounded-lg border border-[#e2e0ed] bg-white p-1.5 text-[#28243d] shadow-xl">
              <form action={logoutAction}>
                <button type="submit" className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-[#f1effa]">Sign out</button>
              </form>
            </div>
          </details>
        </div>

        <details key={`mobile-${pathname}`} className="group ml-auto lg:hidden">
          <summary aria-label="Open navigation menu" className="flex h-full cursor-pointer list-none items-center gap-2 rounded-md px-2 [&::-webkit-details-marker]:hidden">
            <span aria-hidden="true" className="flex size-7 items-center justify-center rounded-full bg-[#ded9fa] text-[10px] font-bold text-[#4d3f9d]">{initials}</span>
            <Icon name="menu" className="size-5" />
          </summary>
          <nav aria-label="Mobile navigation" className="absolute left-0 right-0 top-full max-h-[calc(100dvh-3.5rem)] overflow-y-auto border-t border-[#343052] bg-[#211e3b] p-3 shadow-xl">
            <div className="grid gap-1 sm:grid-cols-2">
              {primary.map((item) => <NavLink key={item.href} {...item} compact />)}
              {secondary.map((item) => <NavLink key={item.href} {...item} compact />)}
              {canHire && <NavLink href="/jobs/new" label="Add job" icon="plus" compact />}
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-[#46415f] px-3 pt-3 text-xs">
              <span className="truncate text-[#c7c5d7]">{user.name} · <span className="capitalize">{user.role}</span></span>
              <form action={logoutAction}><button type="submit" className="ml-3 whitespace-nowrap font-medium text-white hover:underline">Sign out</button></form>
            </div>
          </nav>
        </details>
      </div>
    </header>
  );
}
