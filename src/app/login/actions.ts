"use server";

import { redirect } from "next/navigation";
import { authService, currentIp, safeNext, setSessionCookie } from "@/lib/auth";
import { DbError } from "@/lib/db";

// What the form needs back. The password is NEVER in it. The email is, so the
// field can be refilled after a failed attempt (React clears a form after an
// action); it goes only back to the browser that just typed it.
export type LoginState = { error: string | null; email: string };

// Sign in. CSS's own: no call to the portal anywhere on this path, so signing in
// works when the portal is down.
export async function loginAction(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const rawEmail = formData.get("email");
  const email = typeof rawEmail === "string" ? rawEmail : "";
  const next = safeNext(formData.get("next"));

  let result;
  try {
    result = await authService.login({ email, password: formData.get("password"), ip: await currentIp() });
  } catch (error) {
    // The database layer's errors are already safe to show: a fixed message and a
    // reference to quote. Anything else is a defect; let Next's error page have it.
    if (error instanceof DbError) return { error: `${error.message} Reference ${error.errorId}.`, email };
    throw error;
  }

  if (!result.ok) return { error: result.message, email };

  await setSessionCookie(result.token);
  redirect(result.mustChangePassword ? `/change-password?next=${encodeURIComponent(next)}` : next);
}
