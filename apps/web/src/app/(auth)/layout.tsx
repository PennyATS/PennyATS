import { BRAND } from "@/lib/brand";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center p-6">
      <div className="mb-6 text-lg font-semibold tracking-tight">{BRAND.name}</div>
      {children}
    </main>
  );
}
