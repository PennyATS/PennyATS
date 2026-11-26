"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { logoutAction } from "@/app/(auth)/actions";
import { markAllReadAction, openNotificationAction } from "@/app/(app)/notifications/actions";
import type { SessionUser } from "@/lib/auth";
import { BRAND } from "@/lib/brand";
import { canManageHiring, canManageUsers } from "@/lib/permissions";
import { ThemeToggle } from "@/components/theme-toggle";

type IconName =
  | "home" | "jobs" | "candidates" | "templates" | "reports" | "settings" | "careers"
  | "chevron" | "menu" | "plus" | "search" | "dashboard" | "history" | "bell";

function Icon({ name, className = "size-4" }: { name: IconName; className?: string }) {
  const paths: Record<IconName, React.ReactNode> = {
    home: <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V10Z" /><path d="M9 21v-8h6v8" /></>,
    jobs: <><rect x="3" y="6" width="18" height="15" rx="2" /><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M3 12h18" /></>,
    candidates: <><circle cx="9" cy="8" r="3" /><path d="M3 20v-2a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v2M16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 4v2" /></>,
    templates: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>,
    reports: <><path d="M4 20V4M4 20h17M8 16l4-5 3 2 5-6" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></>,
    careers: <><path d="M4 7h16v13H4zM8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M4 12h16" /></>,
    chevron: <path d="m6 9 6 6 6-6" />,
    menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
    dashboard: <><rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" /></>,
    history: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></>,
    bell: <><path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8" /><path d="M10.3 20a1.9 1.9 0 0 0 3.4 0" /></>,
  };
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
}

type Item = { href: string; label: string; icon?: IconName; note?: string };
type Folder = { label: string; icon: IconName; match: (path: string) => boolean; items: Item[] };

/**
 * A nav folder: a button that opens a menu of links. Enter / Space / ↓ open it, ↑ ↓ move,
 * Escape closes and returns focus, and clicking outside closes it.
 */
function Menu({
  label,
  icon,
  active,
  items,
  align = "left",
  variant = "nav",
  children,
  badge,
  ariaLabel,
  menuClassName = "min-w-52",
}: {
  label: string;
  icon?: IconName;
  active?: boolean;
  items?: Item[];
  align?: "left" | "right";
  variant?: "nav" | "button";
  children?: React.ReactNode;
  /** Shown after the label, e.g. an unread count. */
  badge?: React.ReactNode;
  /** Accessible name when it differs from the visible label. */
  ariaLabel?: string;
  menuClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const links = () => [...(root.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape" && open) {
      setOpen(false);
      button.current?.focus();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        requestAnimationFrame(() => links()[0]?.focus());
        return;
      }
      const list = links();
      const at = list.indexOf(document.activeElement as HTMLElement);
      list[(at + (e.key === "ArrowDown" ? 1 : -1) + list.length) % list.length]?.focus();
    }
  }

  const triggerClass =
    variant === "nav"
      ? `flex items-center gap-1.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors ${
          active || open ? "bg-white/15 text-white" : "text-[#c8ddd2] hover:bg-white/10 hover:text-white"
        }`
      : "flex h-8 items-center gap-1.5 rounded-md border border-[#48715c] px-3 text-xs font-medium text-white transition-colors hover:bg-white/10";

  return (
    <div ref={root} className="relative" onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        className={triggerClass}
      >
        {icon && <Icon name={icon} className={`size-[15px] shrink-0 ${variant === "nav" && label ? "hidden xl:block" : ""}`} />}
        {label}
        {badge}
        {label && <Icon name="chevron" className={`size-3 transition-transform ${open ? "rotate-180" : ""}`} />}
      </button>
      {open && (
        <div
          role="menu"
          aria-label={label}
          className={`absolute ${align === "right" ? "right-0" : "left-0"} top-[calc(100%+8px)] z-50 ${menuClassName} rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1.5 text-[var(--text)] shadow-xl`}
        >
          {items?.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              role="menuitem"
              aria-current={pathname === item.href ? "page" : undefined}
              className="flex items-start gap-2.5 rounded-md px-3 py-2 text-sm outline-none hover:bg-[var(--table-hover)] hover:text-[var(--accent)] focus-visible:bg-[var(--table-hover)]"
            >
              {item.icon && <Icon name={item.icon} className="mt-0.5 size-4 shrink-0 text-[var(--muted)]" />}
              <span>
                <span className="block">{item.label}</span>
                {item.note && <span className="block text-xs text-[var(--muted)]">{item.note}</span>}
              </span>
            </Link>
          ))}
          {children}
        </div>
      )}
    </div>
  );
}

/** Pages visited recently in this tab, shown as a trail under the nav. */
function useRecent(pathname: string) {
  const [recent, setRecent] = useState<{ href: string; label: string }[]>([]);
  useEffect(() => {
    // Wait a tick so the new page's heading has rendered.
    const t = setTimeout(() => {
      const label = document.querySelector("main h1")?.textContent?.trim();
      if (!label) return;
      const href = window.location.pathname + window.location.search;
      try {
        const saved: { href: string; label: string }[] = JSON.parse(sessionStorage.getItem("pennyats:recent") ?? "[]");
        const next = [...saved.filter((r) => r.href !== href && r.label !== label), { href, label: label.slice(0, 60) }].slice(-7);
        sessionStorage.setItem("pennyats:recent", JSON.stringify(next));
        setRecent(next);
      } catch {
        /* Storage is optional. */
      }
    }, 50);
    return () => clearTimeout(t);
  }, [pathname]);
  return recent;
}

type Inbox = { unread: number; rows: { id: string; text: string; read: boolean; at: string }[] };

function ago(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

function NotificationsMenu({ inbox }: { inbox: Inbox }) {
  return (
    <Menu
      label=""
      icon="bell"
      ariaLabel={`Notifications${inbox.unread ? `, ${inbox.unread} unread` : ""}`}
      align="right"
      menuClassName="w-80"
      badge={
        inbox.unread > 0 ? (
          <span aria-hidden="true" className="-ml-1 rounded-full bg-[#f2b84b] px-1.5 text-[10px] font-bold leading-4 text-[#0d2e24]">
            {inbox.unread > 99 ? "99+" : inbox.unread}
          </span>
        ) : null
      }
    >
      <div className="flex items-center justify-between border-b border-[#e7eee9] px-3 pb-2 pt-1">
        <span className="text-sm font-semibold">Notifications</span>
        {inbox.unread > 0 && (
          <form action={markAllReadAction}>
            <button type="submit" role="menuitem" className="text-xs font-medium text-[#176b4d] hover:underline">Mark all read</button>
          </form>
        )}
      </div>
      {inbox.rows.length === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-[#617267]">No notifications yet.</p>
      ) : (
        <ul className="max-h-96 overflow-y-auto py-1">
          {inbox.rows.map((n) => (
            <li key={n.id}>
              <form action={openNotificationAction.bind(null, n.id)}>
                <button type="submit" role="menuitem" className="flex w-full gap-2.5 rounded-md px-3 py-2 text-left text-[13px] outline-none hover:bg-[#e7f4eb] focus-visible:bg-[#e7f4eb]">
                  <span aria-hidden="true" className={`mt-1.5 size-1.5 shrink-0 rounded-full ${n.read ? "" : "bg-[#176b4d]"}`} />
                  <span className="min-w-0">
                    <span className={n.read ? "text-[#4d6153]" : "font-medium"}>{n.text}</span>
                    <span className="block text-[11px] text-[#617267]">{ago(n.at)}</span>
                  </span>
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
      <Link href="/notifications" role="menuitem" className="block border-t border-[#e7eee9] px-3 pb-1 pt-2 text-center text-xs font-medium text-[#176b4d] hover:underline">
        See all notifications
      </Link>
    </Menu>
  );
}

export function TopNav({ user, notifications }: { user: Pick<SessionUser, "name" | "role">; notifications: Inbox }) {
  const pathname = usePathname();
  const router = useRouter();
  const canHire = canManageHiring(user.role);
  const canAdmin = canManageUsers(user.role);
  const initials = user.name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "P";
  const recent = useRecent(pathname);

  const folders: Folder[] = [
    {
      label: "Dashboards",
      icon: "dashboard",
      match: (p) => p === "/" || p.startsWith("/dashboards"),
      items: [
        { href: "/", label: "Home", icon: "home", note: "Your interviews, feedback, and jobs" },
        ...(canHire ? [{ href: "/dashboards/executive", label: "Executive dashboard", icon: "reports" as const, note: "Hires, interviews, open jobs" }] : []),
        { href: "/dashboards/jobs", label: "Jobs dashboard", icon: "jobs", note: "Every open job by stage" },
      ],
    },
    {
      label: "Jobs",
      icon: "jobs",
      match: (p) => p.startsWith("/jobs"),
      items: [
        { href: "/jobs", label: "All jobs", icon: "jobs" },
        { href: "/dashboards/jobs", label: "Job pipelines", icon: "dashboard" },
        ...(canHire ? [{ href: "/jobs/new", label: "New job", icon: "plus" as const }] : []),
        { href: "/careers", label: "Careers page", icon: "careers" },
      ],
    },
    {
      label: "Candidates",
      icon: "candidates",
      match: (p) => p.startsWith("/candidates") || p.startsWith("/templates"),
      items: [
        { href: "/candidates", label: "All candidates", icon: "candidates" },
        { href: "/candidates?status=active", label: "Active", icon: "candidates", note: "In a pipeline now" },
        { href: "/candidates?status=rejected", label: "Archived", icon: "history", note: "Rejected, notes kept" },
        ...(canHire ? [{ href: "/templates", label: "Email templates", icon: "templates" as const }] : []),
      ],
    },
    ...(canHire
      ? [
          {
            label: "Reports",
            icon: "reports" as const,
            match: (p: string) => p.startsWith("/reports"),
            items: [
              { href: "/reports", label: "Hiring reports", icon: "reports" as const, note: "Funnel, sources, time in stage" },
              { href: "/dashboards/executive", label: "Executive dashboard", icon: "dashboard" as const },
            ],
          },
        ]
      : []),
    {
      label: canAdmin ? "Admin" : "More",
      icon: "settings",
      match: (p) => p.startsWith("/settings"),
      items: [
        { href: "/settings/calendar", label: "Google Calendar", icon: "settings" },
        ...(canAdmin
          ? [
              { href: "/settings/users", label: "Users", icon: "candidates" as const },
              { href: "/settings/privacy", label: "Privacy", icon: "settings" as const },
              { href: "/settings/ai", label: "AI", icon: "settings" as const },
              { href: "/settings/email", label: "Email", icon: "settings" as const },
            ]
          : []),
      ],
    },
  ];
  const addItems: Item[] = canHire
    ? ([
        { href: "/jobs/new", label: "Job", icon: "jobs" },
        { href: "/templates/new", label: "Email template", icon: "templates" },
        { href: "/settings/users", label: "Teammate invite", icon: "candidates" },
      ] satisfies Item[]).filter((i) => canAdmin || i.href !== "/settings/users")
    : [];

  function search(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = new FormData(e.currentTarget).get("q")?.toString().trim();
    router.push(q ? `/candidates?q=${encodeURIComponent(q)}` : "/candidates");
  }

  return (
    <header className="sticky top-0 z-40 border-b border-[#275343] bg-[#0d2e24] text-white shadow-[0_2px_12px_#08221920]">
      <div className="flex h-14 items-stretch gap-2 px-3 sm:px-5">
        {/* Left: brand and nav folders (Ashby-style; reverses #49, see #89). */}
        <Link href="/" aria-label={`${BRAND.name} home`} className="flex shrink-0 items-center gap-2.5 pr-2">
          <span aria-hidden="true" className="flex size-10 items-center justify-center rounded-sm bg-[#176b4d] text-[29px] font-bold leading-none tracking-[-0.08em] text-white shadow-[inset_0_1px_0_#ffffff30]">P</span>
          <span className="text-sm font-bold tracking-tight text-white lg:hidden xl:inline">{BRAND.name}</span>
        </Link>

        <nav aria-label="Main navigation" className="hidden min-w-0 items-center gap-0.5 lg:flex">
          {folders.map((folder) => (
            <Menu key={folder.label} label={folder.label} icon={folder.icon} active={folder.match(pathname)} items={folder.items} />
          ))}
        </nav>

        {/* Right: search, add, notifications, user. */}
        <div className="ml-auto hidden shrink-0 items-center gap-2 lg:flex">
          <form role="search" onSubmit={search} className="relative">
            <label htmlFor="nav-search" className="sr-only">Search candidates</label>
            <Icon name="search" className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[#9fbcad]" />
            <input
              id="nav-search"
              name="q"
              key={pathname}
              placeholder="Search candidates"
              className="h-8 w-36 rounded-md border border-[#36614b] bg-white/10 pl-8 pr-2 text-xs text-white placeholder:text-[#9fbcad] focus:w-56 focus:bg-white/15 xl:w-48 xl:focus:w-64"
              style={{ transition: "width 150ms" }}
            />
          </form>
          {addItems.length > 0 && <Menu label="Add" icon="plus" variant="button" items={addItems} align="right" />}
          <NotificationsMenu inbox={notifications} />
          <Menu
            label={user.name.split(" ")[0] ?? user.name}
            ariaLabel={`Account: ${user.name}`}
            align="right"
            badge={<span aria-hidden="true" className="order-first flex size-7 shrink-0 items-center justify-center rounded-full bg-[#d9eee2] text-[10px] font-bold text-[#14533b]">{initials}</span>}
          >
            <div className="border-b border-[var(--border)] px-3 pb-2 pt-1 text-xs text-[var(--muted)]">
              <span className="block font-semibold text-[var(--text)]">{user.name}</span>
              <span className="capitalize">{user.role}</span>
            </div>
            <form action={logoutAction}>
              <button type="submit" role="menuitem" className="mt-1 w-full rounded-md px-3 py-2 text-left text-sm hover:bg-[var(--table-hover)]">Sign out</button>
            </form>
            <ThemeToggle className="mt-1 w-full justify-center" />
          </Menu>
        </div>

        {/* Mobile: notifications and one menu with everything, on the right. */}
        <Link
          href="/notifications"
          aria-label={`Notifications${notifications.unread ? `, ${notifications.unread} unread` : ""}`}
          className="ml-auto flex items-center gap-1 px-2 lg:hidden"
        >
          <Icon name="bell" className="size-5" />
          {notifications.unread > 0 && <span aria-hidden="true" className="rounded-full bg-[#f2b84b] px-1.5 text-[10px] font-bold text-[#0d2e24]">{notifications.unread}</span>}
        </Link>
        <details key={`mobile-${pathname}`} className="group lg:hidden">
          <summary aria-label="Open navigation menu" className="flex h-full cursor-pointer list-none items-center gap-2 rounded-md px-2 [&::-webkit-details-marker]:hidden">
            <Icon name="menu" className="size-5" />
            <span aria-hidden="true" className="flex size-7 items-center justify-center rounded-full bg-[#d9eee2] text-[10px] font-bold text-[#14533b]">{initials}</span>
          </summary>
          <nav aria-label="Mobile navigation" className="absolute left-0 right-0 top-full max-h-[calc(100dvh-3.5rem)] overflow-y-auto border-t border-[#275343] bg-[#123a2e] p-3 shadow-xl">
            <form role="search" onSubmit={search} className="mb-3">
              <label htmlFor="mobile-search" className="sr-only">Search candidates</label>
              <input id="mobile-search" name="q" placeholder="Search candidates" className="h-9 w-full rounded-md border border-[#36614b] bg-white/10 px-3 text-sm text-white placeholder:text-[#9fbcad]" />
            </form>
            <div className="grid gap-3 sm:grid-cols-2">
              {folders.map((folder) => (
                <div key={folder.label}>
                  <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[#9fbcad]">{folder.label}</div>
                  {folder.items.map((item) => (
                    <Link key={item.href} href={item.href} className="block rounded-md px-3 py-2 text-[13px] text-[#e2efe7] hover:bg-white/10">
                      {item.label}
                    </Link>
                  ))}
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-[#36614b] px-3 pt-3 text-xs">
              <span className="truncate text-[#c8ddd2]">{user.name} · <span className="capitalize">{user.role}</span></span>
              <form action={logoutAction}><button type="submit" className="ml-3 whitespace-nowrap font-medium text-white hover:underline">Sign out</button></form>
            </div>
            <ThemeToggle className="mt-3 w-full justify-center text-white" />
          </nav>
        </details>
      </div>
      {recent.length > 1 && (
        <nav aria-label="Recently viewed" className="hidden border-t border-[var(--border)] bg-[var(--surface)] px-5 lg:block">
          <ol className="flex h-8 items-center gap-1.5 overflow-hidden text-[11px] text-[var(--muted)]">
            <li aria-hidden="true"><Icon name="history" className="size-3.5" /></li>
            {recent.slice(0, -1).reverse().map((r, i) => (
              <li key={r.href} className="flex min-w-0 items-center gap-1.5">
                {i > 0 && <span aria-hidden="true">•</span>}
                <Link href={r.href} className="truncate font-medium text-[var(--accent)] hover:underline">{r.label}</Link>
              </li>
            ))}
          </ol>
        </nav>
      )}
    </header>
  );
}
