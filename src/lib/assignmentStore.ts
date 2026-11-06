// The PostgreSQL side of "Assign to staff": read a case's assignments, and record
// one (the local log of CSS's outbound action, migration 020). Every query goes
// through db.ts; nothing here opens a connection.
//
// SERVER-ONLY (db.ts throws if loaded in a browser).
//
// This table logs CSS's OUTBOUND action only; it holds no complaint data (rule 2).
import { query, sql, transaction as dbTransaction } from "./db.ts";
import type { CaseAssignmentView } from "./assignments.ts";

/** A case's assignments, newest first, with the name of whoever did the assigning. */
export async function loadAssignments(caseId: string): Promise<CaseAssignmentView[]> {
  const { rows } = await query<{
    id: string;
    assignee_email: string;
    assignee_name: string;
    priority: string | null;
    task_link: string | null;
    assigned_at: Date;
    assigned_by_name: string | null;
  }>(sql`
    SELECT a.id, a.assignee_email, a.assignee_name, a.priority, a.task_link, a.assigned_at,
           s.full_name AS assigned_by_name
      FROM case_staff_assignments a
      LEFT JOIN staff s ON s.id = a.assigned_by
     WHERE a.case_id = ${caseId}
     ORDER BY a.assigned_at DESC, a.id`);
  return rows.map((row) => ({
    id: row.id,
    assigneeName: row.assignee_name,
    assigneeEmail: row.assignee_email,
    priority: row.priority,
    taskLink: row.task_link,
    assignedAt: row.assigned_at,
    assignedByName: row.assigned_by_name,
  }));
}

/** True if the case already has at least one assignment (drives the confirm-before-repeat rule). */
export async function hasAssignment(caseId: string): Promise<boolean> {
  const { rows } = await query<{ exists: boolean }>(
    sql`SELECT EXISTS (SELECT 1 FROM case_staff_assignments WHERE case_id = ${caseId}) AS exists`,
  );
  return rows[0]?.exists === true;
}

export interface RecordAssignmentInput {
  id: string;
  caseId: string;
  assigneeEmail: string;
  assigneeName: string;
  priority: string | null;
  taskId: string;
  taskLink: string | null;
  assignedBy: string;
  /** For the audit row only: whether the staff portal replayed an existing task. */
  replayed: boolean;
}

/** Writes the assignment row and one audit_log row (ids/codes only, never complaint data). */
export async function recordAssignment(input: RecordAssignmentInput): Promise<void> {
  await dbTransaction(async (tx) => {
    await tx.query(sql`
      INSERT INTO case_staff_assignments
        (id, case_id, assignee_email, assignee_name, priority, task_id, task_link, assigned_by)
      VALUES
        (${input.id}, ${input.caseId}, ${input.assigneeEmail}, ${input.assigneeName}, ${input.priority},
         ${input.taskId}, ${input.taskLink}, ${input.assignedBy})`);
    await tx.query(sql`
      INSERT INTO audit_log (actor_staff_id, entity, entity_id, action, before, after)
      VALUES (${input.assignedBy}, ${"case_staff_assignment"}, ${input.id}, ${"CREATE"}, NULL,
              ${JSON.stringify({ caseId: input.caseId, taskId: input.taskId, priority: input.priority, replayed: input.replayed })}::jsonb)`);
  });
}
