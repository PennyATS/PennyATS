import Link from "next/link";
import { BRAND } from "@/lib/brand";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-2xl p-6 md:py-12">
      <header className="mb-8">
        <Link href="/careers" className="text-lg font-semibold tracking-tight">
          {BRAND.name}
        </Link>
      </header>
      <main>{children}</main>
    </div>
  );
}
