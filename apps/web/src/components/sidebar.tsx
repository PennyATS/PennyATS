import Link from "next/link";
import { BRAND } from "@/lib/brand";

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/jobs", label: "Jobs" },
  { href: "/candidates", label: "Candidates" },
];

export function Sidebar() {
  return (
    <aside
      className="hidden w-56 shrink-0 flex-col border-r p-4 md:flex"
      style={{ borderColor: "var(--border)", background: "var(--surface)" }}
    >
      <div className="mb-6 text-lg font-semibold tracking-tight">{BRAND.name}</div>
      <nav className="flex flex-col gap-1 text-sm">
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="rounded-md px-3 py-2 transition-colors hover:bg-black/5 dark:hover:bg-white/10"
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
