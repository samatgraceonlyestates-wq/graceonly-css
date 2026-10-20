import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell/AppShell";
import { requireSession } from "@/lib/auth";

// Every signed-in screen (02 to 08) lives under this group and gets the shell.
//
// This is NOT where access is decided. A layout is not re-run when you move
// between pages inside it, and a server action never passes through it, so every
// page and every action calls requireSession() itself, in the code that loads
// the data. This call is here for the shell's own need: the signed-in name.
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireSession();
  return <AppShell user={{ name: user.fullName }}>{children}</AppShell>;
}
