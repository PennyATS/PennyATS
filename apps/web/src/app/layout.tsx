import type { Metadata } from "next";
import "./globals.css";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: BRAND.name,
  description: BRAND.tagline,
};

// Apply the saved preference before CSS paints, while still following the OS on a first visit.
const themeScript = `try {
  const saved = localStorage.getItem("pennyats:theme");
  const dark = saved === "dark" || (saved !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
} catch {
  document.documentElement.dataset.theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
