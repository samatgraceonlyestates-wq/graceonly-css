import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell/AppShell";
import { currentUser } from "@/lib/sampleData";

// Every signed-in screen (02 to 08) lives under this group and gets the shell.
// TODO: read the user from the session once auth exists.
export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppShell user={currentUser}>{children}</AppShell>;
}
