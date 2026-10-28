"use server";

import { requireRole } from "@/lib/auth";
import { DbError } from "@/lib/db";
import { createStaffAccount, StaffInputError } from "@/lib/staffAdmin";

export type AddStaffState =
  | { status: "idle" }
  | { status: "done"; email: string }
  | { status: "error"; message: string };

const textOf = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
};

export async function addStaffAction(
  _previous: AddStaffState,
  formData: FormData,
): Promise<AddStaffState> {
  const { user, allowed } = await requireRole("ADMIN");
  if (!allowed) return { status: "error", message: "Only an admin can create staff accounts." };

  const email = textOf(formData, "email");
  const fullName = textOf(formData, "fullName");
  const department = textOf(formData, "department");
  const password = textOf(formData, "password");
  const roles = formData.getAll("role").filter((v): v is string => typeof v === "string" && v !== "");

  if (!email) return { status: "error", message: "Email is required." };
  if (!fullName) return { status: "error", message: "Full name is required." };
  if (!department) return { status: "error", message: "Department is required." };
  if (roles.length === 0) return { status: "error", message: "Select at least one role." };
  if (!password) return { status: "error", message: "Password is missing." };

  try {
    const result = await createStaffAccount({ email, fullName, department, roles, password });
    return { status: "done", email: result.email };
  } catch (caught) {
    if (caught instanceof StaffInputError) return { status: "error", message: caught.message };
    if (caught instanceof DbError) return { status: "error", message: `${caught.message} Reference ${caught.errorId}.` };
    throw caught;
  }
}
