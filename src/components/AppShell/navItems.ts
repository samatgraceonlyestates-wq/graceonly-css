export type NavItem = { label: string; href: string };

const BASE_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Visits", href: "/visits" },
  { label: "Complaints", href: "/complaints" },
  { label: "Documents", href: "/documents" },
  { label: "Attendance", href: "/attendance" },
];

export function navItemsFor(roles: string[]): NavItem[] {
  const isAdmin = roles.includes("ADMIN") || roles.includes("SUPER_ADMIN");
  return isAdmin ? [...BASE_ITEMS, { label: "Admin", href: "/admin/staff" }] : BASE_ITEMS;
}

export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
