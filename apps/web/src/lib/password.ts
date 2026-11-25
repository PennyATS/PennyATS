import { MIN_PASSWORD_LENGTH } from "@pennyats/db";

/** Shared by first-run setup, invites, and password reset. */
export function readPassword(form: FormData): { password: string } | { error: string } {
  const password = form.get("password");
  const confirm = form.get("confirm");
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  if (password.length > 200) return { error: "Password is too long." };
  if (password !== confirm) return { error: "Passwords don't match." };
  return { password };
}

/** A 32-byte base64url token from newToken(). */
export function isResetToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}
