"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Previous / next candidate in the list the profile was opened from.
 * Keyboard: k or ↑ for previous, j or ↓ for next, ignored while typing.
 */
export function ReviewNav({
  prevHref,
  nextHref,
  position,
  total,
  listHref,
  listLabel,
}: {
  prevHref: string | null;
  nextHref: string | null;
  position: number | null;
  total: number;
  listHref: string;
  listLabel: string;
}) {
  const router = useRouter();

  useEffect(() => {
    if (prevHref) router.prefetch(prevHref);
    if (nextHref) router.prefetch(nextHref);
  }, [prevHref, nextHref, router]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true'], [role='textbox']")) return;
      const href = event.key === "j" || event.key === "ArrowDown" ? nextHref : event.key === "k" || event.key === "ArrowUp" ? prevHref : null;
      if (!href) return;
      event.preventDefault();
      router.push(href);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prevHref, nextHref, router]);

  const arrow = (href: string | null, label: string, symbol: string, keys: string) =>
    href ? (
      <Link href={href} className="btn btn-secondary btn-icon" aria-label={`${label} candidate (${keys})`} title={`${label} (${keys})`}>
        {symbol}
      </Link>
    ) : (
      <span className="btn btn-secondary btn-icon opacity-40" aria-disabled="true" title={`No ${label.toLowerCase()} candidate`}>
        {symbol}
      </span>
    );

  return (
    <nav aria-label="Review candidates" className="flex items-center gap-2 text-sm">
      <Link href={listHref} className="link mr-1 truncate">{listLabel}</Link>
      {arrow(prevHref, "Previous", "↑", "k or ↑")}
      {arrow(nextHref, "Next", "↓", "j or ↓")}
      <span className="muted tabular-nums" aria-live="polite">
        {position === null ? `Not in this list · ${total}` : `${position} of ${total}`}
      </span>
    </nav>
  );
}
