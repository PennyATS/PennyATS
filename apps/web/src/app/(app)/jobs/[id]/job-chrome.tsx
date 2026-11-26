"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

type RailItem = { href: string; label: string; view?: string; count?: number };

/** Left sub-navigation for one job, like a folder of its pages. */
export function JobRail({ jobId, activity, admin }: { jobId: string; activity: RailItem[]; admin: RailItem[] }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const isActive = (item: RailItem) => {
    if (item.view !== undefined) return pathname === `/jobs/${jobId}` && (params.get("view") ?? "") === item.view;
    return pathname === item.href;
  };
  const group = (title: string, items: RailItem[]) =>
    items.length > 0 && (
      <div>
        <div className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">{title}</div>
        <ul className="flex gap-1 overflow-x-auto lg:flex-col">
          {items.map((item) => {
            const active = isActive(item);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`relative flex items-center justify-between gap-2 whitespace-nowrap rounded-md px-3 py-2 text-[13px] ${
                    active ? "bg-[var(--surface)] font-semibold shadow-[0_0_0_1px_var(--border)]" : "text-[#4d6153] hover:bg-[#e9f1eb]"
                  }`}
                >
                  {active && <span aria-hidden="true" className="absolute inset-y-1.5 left-0 w-[3px] rounded-r bg-[var(--accent)]" />}
                  {item.label}
                  {item.count !== undefined && <span className="muted text-[11px] tabular-nums">{item.count}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    );
  return (
    <nav aria-label="Job" className="space-y-5 lg:sticky lg:top-24">
      {group("Activity", activity)}
      {group("Admin", admin)}
    </nav>
  );
}

/**
 * Right-side drawer with the job's details, opened with `?details=1` so it can be linked to.
 * Escape or the close button closes it; focus moves in on open and back out on close.
 */
export function JobDrawer({ title, children }: { title: string; children: React.ReactNode }) {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const open = params.get("details") === "1";
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);

  const close = () => {
    const next = new URLSearchParams(params);
    next.delete("details");
    router.replace(next.size ? `${pathname}?${next}` : pathname, { scroll: false });
  };

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "Tab" && panel.current) {
        // Keep focus inside the drawer while it's open.
        const focusable = [...panel.current.querySelectorAll<HTMLElement>("a[href], button, [tabindex]:not([tabindex='-1'])")];
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      (opener.current as HTMLElement | null)?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <button type="button" aria-label="Close details" tabIndex={-1} onClick={close} className="absolute inset-0 bg-[#0d2e24]/25" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={`${title} details`}
        tabIndex={-1}
        className="absolute inset-y-0 right-0 flex w-full max-w-2xl flex-col border-l border-[var(--border)] bg-[var(--surface)] shadow-2xl outline-none"
      >
        <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-6 py-4">
          <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
          <button type="button" onClick={close} className="btn btn-secondary btn-icon" aria-label="Close">×</button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

/** Opens the details drawer on top of whatever view of the job is showing. */
export function DetailsButton({ className, children }: { className: string; children: React.ReactNode }) {
  const params = useSearchParams();
  const pathname = usePathname();
  const next = new URLSearchParams(params);
  next.set("details", "1");
  return (
    <Link href={`${pathname}?${next}`} scroll={false} className={className}>
      {children}
    </Link>
  );
}
