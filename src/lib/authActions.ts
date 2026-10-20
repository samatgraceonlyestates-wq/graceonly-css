"use server";

// Sign out. A server action: a POST that Next protects against cross-site forgery
// (it compares Origin and Host), so another site cannot sign someone out.
import { redirect } from "next/navigation";
import { authService, clearSessionCookie, currentToken } from "./auth.ts";

export async function signOutAction(): Promise<void> {
  const token = await currentToken();
  // Revoke the ROW first. Clearing only the cookie would leave a working token
  // in the wild for anyone who had copied it.
  await authService.logout(token);
  await clearSessionCookie();
  redirect("/login");
}
