"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Left "Views" rail shared by Home and the dashboards. */
export function ViewsRail({ views }: { views: { href: string; label: string }[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Views" className="lg:sticky lg:top-24">
      <div className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Views</div>
      <ul className="flex gap-1 overflow-x-auto lg:flex-col">
        {views.map((v) => {
          const active = pathname === v.href;
          return (
            <li key={v.href}>
              <Link
                href={v.href}
                aria-current={active ? "page" : undefined}
                className={`relative block whitespace-nowrap rounded-md px-3 py-2 text-[13px] ${
                  active ? "bg-[var(--surface)] font-semibold text-[var(--text)] shadow-[0_0_0_1px_var(--border)]" : "text-[#4d6153] hover:bg-[#e9f1eb]"
                }`}
              >
                {active && <span aria-hidden="true" className="absolute inset-y-1.5 left-0 w-[3px] rounded-r bg-[var(--accent)]" />}
                {v.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
