"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";
const storageKey = "pennyats:theme";

export function ThemeToggle({ className = "" }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystemChange = () => {
      try {
        if (localStorage.getItem(storageKey)) return;
      } catch {
        // The current page can still follow the system when storage is unavailable.
      }
      const next = media.matches ? "dark" : "light";
      document.documentElement.dataset.theme = next;
      setTheme(next);
    };
    media.addEventListener("change", onSystemChange);
    return () => media.removeEventListener("change", onSystemChange);
  }, []);

  function toggle() {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    setTheme(next);
    try {
      localStorage.setItem(storageKey, next);
    } catch {
      // A session-only choice still works when storage is unavailable.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      aria-pressed={theme === "dark"}
      className={`inline-flex min-h-8 items-center gap-2 rounded-md border border-current/30 px-2.5 text-xs font-medium text-current hover:bg-white/10 ${className}`}
    >
      <span aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span>
      <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span>
    </button>
  );
}
