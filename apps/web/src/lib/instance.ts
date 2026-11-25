import { instance } from "@pennyats/db";
import { db } from "./db";

/** True once the first admin account exists. */
export async function isSetupComplete(): Promise<boolean> {
  const [row] = await db().select().from(instance);
  return row?.setupComplete ?? false;
}
