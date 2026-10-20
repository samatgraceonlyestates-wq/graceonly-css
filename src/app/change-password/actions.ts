"use server";

import { redirect } from "next/navigation";
import { authService, currentIp, requireSession, safeNext, setSessionCookie } from "@/lib/auth";
import { validateNewPassword } from "@/lib/authPolicy";
import { DbError } from "@/lib/db";

// Nothing typed is ever returned: only a message.
export type ChangePasswordState = { error: string | null };

// The only action a person who must change their password may call
// (allowPasswordChange). A wrong current password counts as a failed password
// check, the same lock as signing in.
export async function changePasswordAction(
  _previous: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const user = await requireSession({ allowPasswordChange: true });

  const current = formData.get("current");
  const next = formData.get("new");
  const confirm = formData.get("confirm");
  const destination = safeNext(formData.get("next"));

  if (typeof current !== "string" || current.length === 0) return { error: "Enter your current password." };
  const weak = validateNewPassword(next, current);
  if (weak !== null) return { error: weak };
  if (next !== confirm) return { error: "The two new passwords do not match." };

  let result;
  try {
    result = await authService.changePassword({
      staffId: user.staffId,
      currentPassword: current,
      newPassword: next,
      ip: await currentIp(),
    });
  } catch (error) {
    if (error instanceof DbError) return { error: `${error.message} Reference ${error.errorId}.` };
    throw error;
  }
  if (!result.ok) return { error: result.message };

  // Every older session ended; this is the replacement.
  await setSessionCookie(result.token);
  redirect(destination);
}
