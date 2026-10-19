// "Attendance" is the person's own attendance (07). The admin Attendance
// Register (08) is a separate role-gated route and is not listed here.
// TODO: role gate for the register route; roles are not built yet.
export const NAV_ITEMS = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Visits", href: "/visits" },
  { label: "Complaints", href: "/complaints" },
  { label: "Attendance", href: "/attendance" },
] as const;

export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
