import { aiEnabled } from "@pennyats/ai";
import { BRAND } from "@/lib/brand";

export const dynamic = "force-dynamic";

export default function Dashboard() {
  const ai = aiEnabled();

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
      <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
        {BRAND.tagline}
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {[
          { label: "Open jobs", value: "0" },
          { label: "Active candidates", value: "0" },
          { label: "AI features", value: ai ? "On" : "Off" },
        ].map((card) => (
          <div
            key={card.label}
            className="rounded-xl border p-5"
            style={{ borderColor: "var(--border)", background: "var(--surface)" }}
          >
            <div className="text-sm" style={{ color: "var(--muted)" }}>
              {card.label}
            </div>
            <div className="mt-2 text-3xl font-semibold">{card.value}</div>
          </div>
        ))}
      </div>

      {!ai && (
        <p className="mt-6 text-sm" style={{ color: "var(--muted)" }}>
          AI is off. Set AI_PROVIDER and AI_API_KEY in your environment to turn it on.
        </p>
      )}
    </div>
  );
}
