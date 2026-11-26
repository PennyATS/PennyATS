"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { loadNotifications, markRead } from "@/lib/notifications";
import { isUuid } from "@/lib/validation";

/** Mark one notification read and go to what it's about. */
export async function openNotificationAction(id: string): Promise<void> {
  const user = await requireUser();
  if (!isUuid(id)) return;
  await markRead(user.id, id);
  const { rows } = await loadNotifications(user.id, 200);
  revalidatePath("/", "layout");
  redirect(rows.find((r) => r.id === id)?.href ?? "/notifications");
}

export async function markAllReadAction(): Promise<void> {
  const user = await requireUser();
  await markRead(user.id, null);
  revalidatePath("/", "layout");
}
