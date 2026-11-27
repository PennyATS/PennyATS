// Guards for the public demo (#10). The demo reset wipes the database, and the seed adds
// demo logins with a published password, so neither may ever run against a real deployment.
// Pure functions so the rules are unit tested.

/** The settings key demo:reset writes, marking a database as a disposable demo. */
export const DEMO_MARKER_KEY = "demo_instance";
export const DEMO_ADMIN_EMAIL = "admin@example.com";

export type DbState = {
  /** Any users exist. */
  hasUsers: boolean;
  /** Setup has been completed (by /setup or by the seed). */
  setupComplete: boolean;
  /** demo:reset created this database. */
  demoMarker: boolean;
  /** The seed's demo admin exists. */
  hasDemoAdmin: boolean;
};

export function databaseName(url: string): string | null {
  try {
    const name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
    return name || null;
  } catch {
    return null;
  }
}

/** Why demo:reset must not run, or null when it may. */
export function demoResetRefusal(env: Record<string, string | undefined>, state: DbState | null): string | null {
  if (env.DEMO_MODE !== "true") {
    return "demo:reset only runs with DEMO_MODE=true. It deletes every row in the database.";
  }
  const name = env.DATABASE_URL ? databaseName(env.DATABASE_URL) : null;
  if (!name) return "DATABASE_URL is not set or has no database name.";
  if (env.DEMO_RESET_CONFIRM !== name) {
    return `Set DEMO_RESET_CONFIRM=${name} to confirm this database may be wiped.`;
  }
  if (state && state.hasUsers && !state.demoMarker) {
    return "This database has users and was not created by demo:reset, so it may be a real deployment. Refusing to wipe it. Point DATABASE_URL at an empty database for the demo.";
  }
  return null;
}

/** Why the seed must not run, or null when it may. */
export function seedRefusal(state: DbState): string | null {
  // Setup was finished by a person on /setup (not by the seed): a real instance.
  if (state.setupComplete && !state.hasDemoAdmin && !state.demoMarker) {
    return "This database was set up through /setup, so it looks like a real deployment. The seed adds logins with a published password and must not run here.";
  }
  return null;
}
