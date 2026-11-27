import Link from "next/link";
import { BRAND } from "@/lib/brand";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="careers-public mx-auto max-w-2xl px-4 py-6 sm:px-6 md:py-12">
      <a href="#careers-main" className="careers-skip">
        Skip to content
      </a>
      <header className="mb-8">
        <Link href="/careers" className="text-lg font-semibold tracking-tight">
          {BRAND.name}
        </Link>
      </header>
      <main id="careers-main">{children}</main>
    </div>
  );
}
