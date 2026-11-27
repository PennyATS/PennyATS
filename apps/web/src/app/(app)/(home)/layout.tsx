import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { ViewsRail } from "./views-rail";

export default async function HomeLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const views = [
    { href: "/", label: "Home" },
    ...(can(user, "dashboards.executive") ? [{ href: "/dashboards/executive", label: "Executive dashboard" }] : []),
    { href: "/dashboards/jobs", label: "Jobs dashboard" },
  ];
  return (
    <div className="grid gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
      <ViewsRail views={views} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
