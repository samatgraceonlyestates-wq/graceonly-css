// "Assign to staff": the PURE rules and shapes behind the action, kept out of the
// store (SQL) and the client module (staffPortal.ts) so they can be unit-tested.
//
// A CSS user assigns a complaint/dispute to a colleague; CSS creates a task in the
// STAFF portal (staffPortal.ts) and logs HERE that it did (assignmentStore.ts).
// This module builds the task's title and description and the request body, and
// carries the view types the screen renders. It stores NO complaint data (rule 2):
// the complaint is read live from the client portal; only ids and the staff-portal
// assignee are kept.
//
// No imports: pure, browser-safe, and the test runs it directly.

/**
 * The priorities the dialog offers. These are the staff portal's OWN set
 * (team-api PRIORITIES = ["Low", "Medium", "High"]); the UI is restricted to
 * exactly them because the portal silently DEFAULTS any off-list value to
 * "Medium" rather than refusing it — so a value the desk cannot pick can never be
 * stored by surprise.
 */
export const ASSIGNMENT_PRIORITIES = ["Low", "Medium", "High"] as const;
export type AssignmentPriority = (typeof ASSIGNMENT_PRIORITIES)[number];

export function isAssignmentPriority(value: string): value is AssignmentPriority {
  return (ASSIGNMENT_PRIORITIES as readonly string[]).includes(value);
}

/** One recorded assignment, as the complaint detail screen lists it. */
export interface CaseAssignmentView {
  id: string;
  assigneeName: string;
  assigneeEmail: string;
  priority: string | null;
  taskLink: string | null;
  assignedAt: Date;
  assignedByName: string | null;
}

/** The case facts the task is built from (all from the client portal's case detail). */
export interface AssignmentCase {
  id: string;
  subject: string;
  reference: string;
  description: string | null;
  kind: string;
  typeText: string | null;
}

/** "Dispute: <subject> (<reference>)" — what the colleague sees as the task's title. */
export function assignmentTitle(caseInfo: Pick<AssignmentCase, "subject" | "reference">): string {
  const subject = caseInfo.subject.trim() || "(no subject)";
  return `Dispute: ${subject} (${caseInfo.reference})`;
}

/** The task's body: the complaint's own description plus the facts a colleague needs. */
export function assignmentDescription(caseInfo: AssignmentCase): string {
  const header = `Complaint ${caseInfo.reference} (${caseInfo.kind}${caseInfo.typeText ? `, ${caseInfo.typeText}` : ""}), assigned from CSS.`;
  const body = caseInfo.description?.trim();
  return body ? `${header}\n\n${body}` : header;
}

export interface BuildTaskInput {
  caseInfo: AssignmentCase;
  assigneeEmail: string;
  idempotencyKey: string;
  /** CSS's public origin for the deep link, or null to omit sourceUrl. */
  publicOrigin: string | null;
  priority: AssignmentPriority | null;
}

export interface TaskBody {
  idempotencyKey: string;
  assigneeEmail: string;
  title: string;
  description: string;
  source: "css";
  sourceRef: string;
  sourceUrl?: string;
  priority?: string;
}

/** The deep link back to the complaint in CSS, or null when no origin is configured. */
export function complaintDeepLink(publicOrigin: string | null, caseId: string): string | null {
  if (!publicOrigin) return null;
  return `${publicOrigin.replace(/\/+$/, "")}/complaints/${encodeURIComponent(caseId)}`;
}

/** Builds the POST /api/team/v1/tasks body. Pure: no clock, no randomness (caller supplies the key). */
export function buildTaskBody(input: BuildTaskInput): TaskBody {
  const sourceUrl = complaintDeepLink(input.publicOrigin, input.caseInfo.id);
  return {
    idempotencyKey: input.idempotencyKey,
    assigneeEmail: input.assigneeEmail,
    title: assignmentTitle(input.caseInfo),
    description: assignmentDescription(input.caseInfo),
    source: "css",
    sourceRef: input.caseInfo.id,
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(input.priority ? { priority: input.priority } : {}),
  };
}
