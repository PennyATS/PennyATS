import { notFound } from "next/navigation";
import { availabilityContext } from "@/lib/availability";
import { AvailabilityForm } from "../availability-form";

export default async function AvailabilityPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const context = await availabilityContext(token, "availability_link");
  if (!context) notFound();
  return <AvailabilityForm token={token} source="availability_link" candidateName={context.candidate.fullName}
    jobTitle={context.job.title} stageName={context.stageName} />;
}
