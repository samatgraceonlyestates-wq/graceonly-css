// What a person can trip in the database with what they type or click, and what
// we tell them. ONE table, keyed by constraint name (CLAUDE.md, "Database":
// errors are mapped by constraint name to fixed, app-controlled messages).
//
// Every constraint, unique index and primary key in db/migrations/ is in EXACTLY
// ONE of the two tables below. dbConstraints.test.ts derives the full list from
// the migration files and fails if a name is missing, stale or in both, so a new
// constraint cannot ship without a decision. The decision is:
//
//   CONSTRAINT_RULES       a person can reach it through the UI (or a stale link
//                          or a double click). It gets a message and, where the
//                          message belongs to one form field, that field.
//   UNTRIPPABLE_CONSTRAINTS  only a bug, a forged request or a database edit can
//                          reach it. It has NO message: if it fires, the caller
//                          gets the generic "something went wrong" plus an error
//                          id, and the constraint name is logged so it is noticed.
//                          Each entry says WHY.
//
// The messages are OURS. Nothing from the database error is ever copied into one.
// A message is read by front-desk staff, so it says what to do, not what broke.
//
// NOT NULL has no constraint name on PostgreSQL 10, so it is keyed "table.column"
// in NOT_NULL_RULES. A NOT NULL column that is not listed there is untrippable by
// rule: ids, timestamps, actors taken from the session, and codes chosen from
// dropdowns are all written by the application, never typed.
//
// No imports: dbErrors.ts, the tests and the browser-safe parts of the app can
// all read this file.

export type ConstraintRuleKind = "unique" | "foreign_key" | "check";

export interface ConstraintRule {
  kind: ConstraintRuleKind;
  /** Shown to the person. Fixed text. */
  message: string;
  /** The form field the message belongs to, or null if it is about the whole action. */
  field: string | null;
}

export interface NotNullRule {
  message: string;
  field: string;
}

function rule(kind: ConstraintRuleKind, message: string, field: string | null = null): ConstraintRule {
  return Object.freeze({ kind, message, field });
}

const CODE_FORMAT =
  "A code must start with a capital letter and use only capital letters, digits and underscores.";
const CODE_EXISTS = "That code already exists.";
const VISIT_GONE = "That visit could not be found. Go back to the visit list and try again.";
const NOT_A_CLIENT_VISIT = "Cases can only be raised for clients, and this visit is not a client's.";

export const CONSTRAINT_RULES: Readonly<Record<string, ConstraintRule>> = Object.freeze({
  // ---- staff and devices (Super Admin: user and device management) ----
  staff_email_lower_key: rule("unique", "A staff member with that email address already exists.", "email"),
  staff_email_format_check: rule("check", "Enter a valid email address.", "email"),
  staff_full_name_not_blank_check: rule("check", "Enter the person's full name.", "full_name"),
  staff_department_not_blank_check: rule("check", "Enter the department.", "department"),
  staff_role_pkey: rule("unique", "That person already has that role.", "role"),
  device_label_not_blank_check: rule("check", "Give the device a name.", "label"),

  // ---- visitors (non-clients) ----
  visitor_phone_live_key: rule("unique", "That phone number already belongs to another visitor.", "phone"),
  visitor_phone_e164_check: rule(
    "check",
    "Enter the phone number in international format, for example +2348012345678.",
    "phone",
  ),
  visitor_display_name_not_blank_check: rule("check", "Enter the visitor's name.", "display_name"),
  visitor_not_merged_into_self_check: rule("check", "A visitor cannot be merged into themselves.", "merge_target"),
  visitor_merged_into_id_fkey: rule("foreign_key", "The visitor to merge into could not be found.", "merge_target"),

  // ---- visits ----
  visit_visitor_id_fkey: rule("foreign_key", "That visitor could not be found. Search again.", "visitor"),
  visit_checkout_after_checkin_check: rule("check", "Check-out cannot be earlier than check-in.", "checked_out_at"),
  visit_event_note_needs_body_check: rule("check", "A note cannot be empty.", "body"),
  visit_event_visit_id_fkey: rule("foreign_key", VISIT_GONE),

  // ---- enquiries (a non-client's, CLAUDE.md rule 3) ----
  enquiry_summary_not_blank_check: rule("check", "Describe the enquiry.", "summary"),
  enquiry_visit_is_non_client_fkey: rule(
    "foreign_key",
    "Enquiries can only be logged for visitors who are not clients.",
  ),

  // ---- cases (a client's, raised through the portal, CLAUDE.md rule 2) ----
  case_request_live_key: rule("unique", "A case of that type has already been requested for this visit."),
  case_request_not_realtor_conduct_check: rule("check", "That type of case cannot be raised from CSS."),
  case_request_visit_is_client_fkey: rule("foreign_key", NOT_A_CLIENT_VISIT),
  visit_case_link_visit_is_client_fkey: rule("foreign_key", NOT_A_CLIENT_VISIT),
  visit_case_link_visit_case_key: rule("unique", "That case is already linked to this visit."),

  // ---- attendance ----
  attendance_one_open_shift_key: rule("unique", "That person is already recorded as in. Clock them out first."),
  attendance_clock_out_after_in_check: rule("check", "Clock-out must be after clock-in.", "clock_out_at"),
  attendance_correction_reason_not_blank_check: rule("check", "A correction needs a reason.", "correction_reason"),
  attendance_backdate_reason_not_blank_check: rule("check", "An entry for an earlier day needs a reason.", "backdate_reason"),

  // ---- the movement book (leaving the premises and coming back) ----
  movement_destination_not_blank_check: rule("check", "Enter where they went.", "destination"),
  movement_purpose_not_blank_check: rule("check", "Enter what it was for.", "purpose"),
  movement_returned_after_left_check: rule("check", "The return cannot be earlier than the time they left.", "returned_at"),
  movement_one_open_key: rule("unique", "That person is already recorded as out. Record their return first."),
  movement_attendance_record_id_fkey: rule(
    "foreign_key",
    "That person is not recorded as in for that day. Record their arrival first.",
    "attendance_record",
  ),
  leave_ends_on_or_after_starts_check: rule("check", "Leave cannot end before it starts.", "ends_on"),

  // ---- document handover ----
  handover_visit_id_fkey: rule("foreign_key", VISIT_GONE),
  handover_item_quantity_positive_check: rule("check", "The quantity must be at least 1.", "quantity"),
  handover_item_pkey: rule(
    "unique",
    "Each document type can appear once in a release. Combine the quantities.",
    "document_type",
  ),

  // ---- managed lists (Super Admin: dropdown management, FR-7.2) ----
  // Not `role`: the four roles are fixed by migration 001 and cannot be edited.
  visitor_type_code_format_check: rule("check", CODE_FORMAT, "code"),
  visit_reason_code_format_check: rule("check", CODE_FORMAT, "code"),
  enquiry_topic_code_format_check: rule("check", CODE_FORMAT, "code"),
  leave_kind_code_format_check: rule("check", CODE_FORMAT, "code"),
  document_type_code_format_check: rule("check", CODE_FORMAT, "code"),
  visitor_type_pkey: rule("unique", CODE_EXISTS, "code"),
  visit_reason_pkey: rule("unique", CODE_EXISTS, "code"),
  enquiry_topic_pkey: rule("unique", CODE_EXISTS, "code"),
  leave_kind_pkey: rule("unique", CODE_EXISTS, "code"),
  document_type_pkey: rule("unique", CODE_EXISTS, "code"),
});

const SET_BY_APP = "Set by the application, never typed or chosen by a person.";
const SESSION_STAFF =
  "A staff id taken from the signed-in session. Staff rows are never deleted, so only a forged request can break it.";
const PICKED_STAFF =
  "A staff member picked from a list of staff. Staff are never deleted, so only a forged request can break it.";
const PICKED_CODE =
  "A code picked from a dropdown fed by the same table. Lookup rows are deactivated, never deleted, so only a forged request can break it.";
const APP_ID =
  "An id generated by the application (crypto.randomUUID) for each new row. A collision means a replayed request or a bug, not a mistake a person can make.";
const FIXED_TOGETHER = "Columns the application always writes together; a person never supplies them separately.";

export const UNTRIPPABLE_CONSTRAINTS: Readonly<Record<string, string>> = Object.freeze({
  // ---- CHECKs: values or combinations the application writes ----
  attendance_clock_in_device_kind_valid_check: "The kind is copied from the signed-in session's device. " + SET_BY_APP,
  attendance_clock_out_device_kind_valid_check: "The kind is copied from the signed-in session's device. " + SET_BY_APP,
  attendance_clock_in_device_pair_check: "A device and its kind are written together. " + FIXED_TOGETHER,
  attendance_clock_out_device_pair_check: "A device and its kind are written together. " + FIXED_TOGETHER,
  attendance_clock_out_device_needs_clock_out_check:
    "The clock-out device is written in the same statement as the clock-out time. " + FIXED_TOGETHER,
  audit_log_action_valid_check: "Audit rows are written only by the application. " + SET_BY_APP,
  audit_log_entity_not_blank_check: "Audit rows are written only by the application. " + SET_BY_APP,
  audit_log_before_required_unless_create_check: "Audit rows are written only by the application. " + SET_BY_APP,
  audit_log_after_required_unless_delete_check: "Audit rows are written only by the application. " + SET_BY_APP,
  case_request_state_valid_check: "The request state machine is driven by the portal's answers. " + SET_BY_APP,
  case_request_case_id_matches_confirmed_check:
    "The case id is stored when the portal confirms it. " + SET_BY_APP,
  case_request_settled_at_matches_pending_check:
    "settled_at is stamped when a request leaves PENDING. " + FIXED_TOGETHER,
  case_request_type_code_format_check:
    "The type code comes from the portal's own list of types, never typed. " + SET_BY_APP,
  device_kind_valid_check: "Chosen from a fixed DESK or PERSONAL choice; only a forged request can break it.",
  enquiry_status_valid_check: "OPEN or CLOSED is set by the open and close actions. " + SET_BY_APP,
  enquiry_closed_at_matches_status_check: "Closing stamps the time, the person and the status together. " + FIXED_TOGETHER,
  enquiry_closed_by_matches_status_check: "Closing stamps the time, the person and the status together. " + FIXED_TOGETHER,
  enquiry_closed_after_opened_check: "The close time is the server clock, which cannot precede the open time.",
  handover_gate_answer_valid_check:
    "gate_answer is the portal's release-check answer, mapped by the application. " + SET_BY_APP,
  role_code_format_check: "The four roles are fixed by migration 001 and cannot be created or edited.",
  session_expires_after_created_check: "Session lifetimes are set by the application. " + SET_BY_APP,
  setting_key_format_check:
    "Setting keys are written by application code and migrations. A settings screen edits values only, never keys.",
  staff_password_needs_email_check:
    "A login account is created with its email in the same statement, and a roster person has no password. Only a forged request or a database edit gives one without the other.",
  attendance_signout_missing_pair_check:
    "Marking a shift as never signed out writes the time and the person who marked it together. " + FIXED_TOGETHER,
  attendance_signout_missing_no_clock_out_check:
    "A shift is marked never signed out only while it has no clock-out, and a clock-out is refused for a marked one; the application checks both before writing.",
  attendance_clock_out_entered_by_matches_check:
    "A clock-out writes the time and the person who typed it together. " + FIXED_TOGETHER,
  movement_returned_entered_by_matches_check:
    "A return writes the time and the person who typed it together. " + FIXED_TOGETHER,
  movement_entered_device_kind_valid_check: "The kind is copied from the signed-in session's device. " + SET_BY_APP,
  movement_entered_device_pair_check: "A device and its kind are written together. " + FIXED_TOGETHER,
  staff_active_matches_deactivated_check: "Deactivating sets both columns together. " + FIXED_TOGETHER,
  staff_password_failed_count_nonneg_check: "A counter the application increments and resets. " + SET_BY_APP,
  staff_pin_failed_count_nonneg_check: "A counter the application increments and resets. " + SET_BY_APP,
  visit_checkout_by_needs_checkout_check: "Check-out writes who and when together. " + FIXED_TOGETHER,
  visit_close_reason_matches_checkout_check: "Check-out writes the reason and the time together. " + FIXED_TOGETHER,
  visit_close_reason_valid_check: "The close reason comes from the check-out action. " + SET_BY_APP,
  visit_manual_close_needs_staff_check: "Check-out writes who closed the visit. " + FIXED_TOGETHER,
  visit_client_name_matches_client_check:
    "The logged name is copied from the portal with the client id. " + FIXED_TOGETHER,
  visit_client_name_not_blank_check:
    "The logged name is copied from the portal's display name, not typed. A blank means a bad portal record and is a defect to see, not a form error.",
  visit_identity_exactly_one_check:
    "The application builds the identity from the lookup result: a picked client or a visitor record. A person cannot enter both or neither.",
  visit_lookup_outcome_valid_check: "The outcome comes from the lookup the application ran. " + SET_BY_APP,
  visit_matched_iff_client_check: "The outcome and the client id come from the same lookup. " + FIXED_TOGETHER,
  visit_matched_only_for_client_type_check:
    "Only the Client type searches the portal, so only it can be MATCHED. The form decides that, not the person.",
  visit_case_link_case_id_not_blank_check: "The case id is the portal's answer. " + SET_BY_APP,
  visit_case_link_kind_valid_check: "RAISED_HERE or DISCUSSED is set by the action. " + SET_BY_APP,
  visit_event_kind_valid_check: "The event kind is set by the action that writes the event. " + SET_BY_APP,
  visitor_link_staff_matches_link_check: "Linking a visitor to a portal client writes all three columns. " + FIXED_TOGETHER,
  visitor_link_time_matches_link_check: "Linking a visitor to a portal client writes all three columns. " + FIXED_TOGETHER,

  // ---- foreign keys to staff ----
  attendance_clock_in_entered_by_fkey: SESSION_STAFF,
  attendance_clock_out_entered_by_fkey: SESSION_STAFF,
  attendance_signout_missing_by_fkey: SESSION_STAFF,
  attendance_record_staff_id_fkey: PICKED_STAFF,
  movement_approved_by_fkey: PICKED_STAFF,
  movement_left_entered_by_fkey: SESSION_STAFF,
  movement_returned_entered_by_fkey: SESSION_STAFF,
  audit_log_actor_staff_id_fkey: SESSION_STAFF,
  case_request_requested_by_fkey: SESSION_STAFF,
  device_registered_by_fkey: SESSION_STAFF,
  enquiry_assigned_to_fkey: PICKED_STAFF,
  enquiry_closed_by_fkey: SESSION_STAFF,
  enquiry_opened_by_fkey: SESSION_STAFF,
  handover_released_by_fkey: SESSION_STAFF,
  leave_approved_by_fkey: PICKED_STAFF,
  leave_created_by_fkey: SESSION_STAFF,
  leave_staff_id_fkey: PICKED_STAFF,
  session_staff_id_fkey: SESSION_STAFF,
  setting_updated_by_fkey: SESSION_STAFF,
  staff_role_granted_by_fkey: SESSION_STAFF,
  staff_role_staff_id_fkey: PICKED_STAFF,
  visit_checked_in_by_fkey: SESSION_STAFF,
  visit_checked_out_by_fkey: SESSION_STAFF,
  visit_case_link_linked_by_fkey: SESSION_STAFF,
  visit_event_actor_staff_id_fkey: SESSION_STAFF,
  visitor_created_by_fkey: SESSION_STAFF,
  visitor_linked_by_fkey: SESSION_STAFF,

  // ---- foreign keys to lookup rows and devices ----
  attendance_record_clock_in_device_id_fkey: "The device of the signed-in session, registered before it can be used.",
  attendance_record_clock_out_device_id_fkey: "The device of the signed-in session, registered before it can be used.",
  movement_entered_device_id_fkey: "The device of the signed-in session, registered before it can be used.",
  session_device_id_fkey: "The device of the signed-in session, registered before it can be used.",
  enquiry_topic_code_fkey: PICKED_CODE,
  handover_item_document_type_code_fkey: PICKED_CODE,
  leave_kind_code_fkey: PICKED_CODE,
  staff_role_role_code_fkey: PICKED_CODE,
  visit_reason_code_fkey: PICKED_CODE,
  visit_visitor_type_code_fkey: PICKED_CODE,
  handover_item_handover_id_fkey: "The header row is inserted in the same transaction as its items.",

  // ---- primary keys: application-generated ids ----
  attendance_record_pkey: APP_ID,
  audit_log_pkey: "An identity column the database assigns; nothing supplies a value.",
  case_request_pkey:
    "The id IS the idempotency key. A repeat is a replayed request, which the caller handles (read the existing row, or INSERT ... ON CONFLICT DO NOTHING); it is not a form error.",
  device_pkey: APP_ID,
  enquiry_pkey: APP_ID,
  handover_pkey: APP_ID,
  leave_pkey: APP_ID,
  movement_pkey: APP_ID,
  role_pkey: "The four roles are fixed by migration 001 and cannot be created.",
  session_pkey: APP_ID,
  setting_pkey: "Setting keys are written by application code and migrations, never typed.",
  staff_pkey: APP_ID,
  visit_case_link_pkey: APP_ID,
  visit_event_pkey: APP_ID,
  visit_pkey: APP_ID,
  visitor_pkey: APP_ID,

  // ---- unique constraints that cannot be violated by a person ----
  device_token_hash_key: "A SHA-256 of a random 256-bit token; a collision is not a realistic event.",
  session_token_hash_key: "A SHA-256 of a random 256-bit token; a collision is not a realistic event.",
  visit_id_portal_client_id_key:
    "Includes the primary key (id), so it cannot fail unless visit_pkey does. It exists only as the target of a composite foreign key.",
  visit_id_visitor_id_key:
    "Includes the primary key (id), so it cannot fail unless visit_pkey does. It exists only as the target of a composite foreign key.",
});

const required = (message: string, field: string): NotNullRule => Object.freeze({ message, field });

/** Keyed "table.column". Only columns a person fills in; every other NOT NULL column is untrippable by rule. */
export const NOT_NULL_RULES: Readonly<Record<string, NotNullRule>> = Object.freeze({
  "staff.full_name": required("Enter the person's full name.", "full_name"),
  "staff_role.role_code": required("Choose a role.", "role"),
  "device.label": required("Give the device a name.", "label"),
  "visitor.display_name": required("Enter the visitor's name.", "display_name"),
  "visitor.consent_at": required("Confirm that the visitor agrees to their details being recorded.", "consent"),
  "visit.visitor_type_code": required("Choose who is visiting.", "visitor_type"),
  "visit.reason_code": required("Choose a reason for the visit.", "reason"),
  "enquiry.topic_code": required("Choose a topic.", "topic"),
  "enquiry.summary": required("Describe the enquiry.", "summary"),
  "movement.destination": required("Enter where they went.", "destination"),
  "movement.purpose": required("Enter what it was for.", "purpose"),
  "leave.starts_on": required("Enter the first day of leave.", "starts_on"),
  "leave.ends_on": required("Enter the last day of leave.", "ends_on"),
  "leave.kind_code": required("Choose the kind of leave.", "kind"),
  "handover_item.document_type_code": required("Choose a document type.", "document_type"),
  "handover_item.quantity": required("Enter a quantity.", "quantity"),
  // Managed lists (Super Admin).
  "visitor_type.code": required("Enter a code.", "code"),
  "visitor_type.label": required("Enter a label.", "label"),
  "visit_reason.code": required("Enter a code.", "code"),
  "visit_reason.label": required("Enter a label.", "label"),
  "enquiry_topic.code": required("Enter a code.", "code"),
  "enquiry_topic.label": required("Enter a label.", "label"),
  "leave_kind.code": required("Enter a code.", "code"),
  "leave_kind.label": required("Enter a label.", "label"),
  "document_type.code": required("Enter a code.", "code"),
  "document_type.label": required("Enter a label.", "label"),
});
