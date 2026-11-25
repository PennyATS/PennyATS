import { notFound } from "next/navigation";
import { availabilityContext } from "@/lib/availability";
import { AvailabilityForm } from "@/app/availability/availability-form";

export default async function SuggestTimesPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const context = await availabilityContext(token, "booking_fallback");
  if (!context) notFound();
  return <AvailabilityForm token={token} source="booking_fallback" candidateName={context.candidate.fullName}
    jobTitle={context.job.title} stageName={context.stageName} />;
}
