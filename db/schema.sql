CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name VARCHAR(255) NOT NULL,
  email VARCHAR(320) NOT NULL UNIQUE,
  phone_number VARCHAR(40),
  designation VARCHAR(120),
  profile_image_url TEXT,
  profile_image_position VARCHAR(40) NOT NULL DEFAULT '50% 50%',
  password_hash VARCHAR(255) NOT NULL,
  provider VARCHAR(50) NOT NULL DEFAULT 'email',
  google_sub VARCHAR(255),
  avatar_url TEXT,
  role VARCHAR(40) NOT NULL DEFAULT 'ASSISTANT',
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  last_login_at TIMESTAMPTZ,
  last_login_ip VARCHAR(64),
  last_login_user_agent TEXT,
  email_change_pending BOOLEAN NOT NULL DEFAULT FALSE,
  pending_email VARCHAR(320),
  email_change_requested_at TIMESTAMPTZ,
  notification_preferences JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS verification_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose VARCHAR(40) NOT NULL DEFAULT 'email_verify',
  email_address VARCHAR(320),
  token_hash VARCHAR(255) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_token_hash VARCHAR(255) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  revoked_reason VARCHAR(100),
  user_agent TEXT,
  browser_name VARCHAR(80),
  device_name VARCHAR(80),
  ip_address VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS login_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  login_method VARCHAR(20) NOT NULL DEFAULT 'email',
  event_type VARCHAR(30) NOT NULL DEFAULT 'login',
  status VARCHAR(20) NOT NULL DEFAULT 'success',
  browser_name VARCHAR(80),
  device_name VARCHAR(80),
  ip_address VARCHAR(64),
  user_agent TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS surveyor_profile (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  licence_number VARCHAR(40),
  licence_expiry_date DATE,
  address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  target_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(100) NOT NULL,
  details JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_number VARCHAR(40);
ALTER TABLE users ADD COLUMN IF NOT EXISTS designation VARCHAR(120);
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_image_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_image_position VARCHAR(40) NOT NULL DEFAULT '50% 50%';
ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_email VARCHAR(320);
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_change_pending BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_change_requested_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_preferences JSONB NOT NULL DEFAULT '{}';
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_ip VARCHAR(64);
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_user_agent TEXT;

/* Names are captured as two fields at registration, but full_name stays and is written from them on
   every insert so older screens and exports keep working without a second source of truth. */
ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name VARCHAR(120);
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name VARCHAR(120);
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;

/* Accounts that an administrator opens arrive with a temporary password chosen on the user's behalf,
   so the row has to remember that the member has not replaced it yet. Remarks is the only free-text
   note the admin keeps about a staff account; nothing in it is ever shown to the staff member. */
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_remarks TEXT;

/* A Google-only account has no SurveyPro password, so the column has to be allowed to stay empty
   rather than holding a random value nobody knows. */
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
UPDATE users SET password_hash = NULL WHERE provider = 'google' AND google_sub IS NOT NULL;

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS os_name VARCHAR(80);
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS persistent BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE users SET
  first_name = NULLIF(split_part(full_name, ' ', 1), ''),
  last_name = NULLIF(trim(substr(full_name, position(' ' in full_name) + 1)), '')
WHERE first_name IS NULL AND NULLIF(TRIM(full_name), '') IS NOT NULL;

UPDATE users SET email_verified_at = COALESCE(updated_at, created_at)
WHERE is_verified AND email_verified_at IS NULL;

/* Sign-up, look-up and the Google callback all compare lowercased addresses, so a row saved by an
   older build with capitals in it would be invisible to them and a second account for the same
   person could be created. Fold those rows onto the same form the app writes today, but only where
   nothing already occupies the lowercase address, so the migration can never violate UNIQUE. */
UPDATE users SET email = LOWER(email)
WHERE email <> LOWER(email)
  AND NOT EXISTS (SELECT 1 FROM users other WHERE other.email = LOWER(users.email));

UPDATE sessions SET last_active_at = COALESCE(last_seen_at, created_at)
WHERE last_active_at IS NULL;

/* Failed logins for an address that has no account are still worth recording, so the actor column
   has to accept NULL. */
ALTER TABLE login_activity ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE verification_tokens ADD COLUMN IF NOT EXISTS purpose VARCHAR(40) NOT NULL DEFAULT 'email_verify';
ALTER TABLE verification_tokens ADD COLUMN IF NOT EXISTS email_address VARCHAR(320);
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS revoked_reason VARCHAR(100);
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_agent TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS browser_name VARCHAR(80);
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS device_name VARCHAR(80);
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS ip_address VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_verification_user ON verification_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_verification_purpose ON verification_tokens(purpose);
CREATE INDEX IF NOT EXISTS idx_reset_user ON reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_revoked ON sessions(revoked_at);
CREATE INDEX IF NOT EXISTS idx_login_activity_user ON login_activity(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(target_user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_lookup ON sessions(session_token_hash);
CREATE INDEX IF NOT EXISTS idx_verification_hash ON verification_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_reset_hash ON reset_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_active ON sessions(user_id, revoked_at, expires_at);

/* ---------------------------------------------------------------------------
   Granular permissions.

   Three tables, one question. `permissions` is the catalogue the code knows how to check — it is
   owned by the application, so re-running this file refreshes the labels but never invents or drops
   a key an override already refers to. `role_permissions` is what a role gets by default, and
   `user_permissions` is the individual switch an admin flips on top of it; a row there means "this
   person differs from their role", which is why it stores a boolean rather than living as two
   tables of grants and denials. Resolution is role defaults first, then the person's overrides,
   and ADMIN holds everything without needing rows — the check short-circuits on the role so a
   mis-seeded catalogue can never lock the administrators out of their own system.

   Seeds use ON CONFLICT DO NOTHING throughout: an administrator who tightens a role default in the
   database must not find it widened again by the next boot.
   --------------------------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS permissions (
  key VARCHAR(64) PRIMARY KEY,
  label VARCHAR(160) NOT NULL,
  group_name VARCHAR(64) NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role VARCHAR(20) NOT NULL CHECK (role IN ('ADMIN', 'SURVEYOR', 'STAFF')),
  permission_key VARCHAR(64) NOT NULL REFERENCES permissions(key) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (role, permission_key)
);

CREATE TABLE IF NOT EXISTS user_permissions (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_key VARCHAR(64) NOT NULL REFERENCES permissions(key) ON DELETE CASCADE,
  granted BOOLEAN NOT NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, permission_key)
);

CREATE INDEX IF NOT EXISTS idx_role_permissions_permission ON role_permissions(permission_key);
CREATE INDEX IF NOT EXISTS idx_user_permissions_user ON user_permissions(user_id);

INSERT INTO permissions (key, label, group_name, description) VALUES
  ('view_assigned_cases',           'See cases assigned to them',      'Case access',  'The only case list a staff member gets by default.'),
  ('view_all_cases',                'See every case',                  'Case access',  'Opens the full register, not just their own work.'),
  ('view_activity_history',         'See case history',                'Case access',  'Stage changes and comments recorded on cases they can open.'),
  ('edit_case_details',             'Edit case details',               'Case editing', 'Intimation, policy and claim reference fields.'),
  ('edit_vehicle_details',          'Edit vehicle details',            'Case editing', 'Make, model, registration, chassis and year.'),
  ('edit_insured_details',          'Edit insured details',            'Case editing', 'The insured party block.'),
  ('edit_third_party_details',      'Edit third-party details',        'Case editing', 'Third parties and their vehicles.'),
  ('enter_repair_bill_information', 'Enter repair and bill figures',   'Case editing', 'Garage estimates, parts and labour costs.'),
  ('complete_inspection_checklist', 'Complete the inspection checklist','Case editing','Answers the survey checklist items.'),
  ('upload_inspection_photos',      'Upload inspection photos',        'Case editing', 'Camera captures attached to the inspection.'),
  ('upload_documents',              'Upload documents',                'Case editing', 'Policy, FIR, bills and annexes.'),
  ('delete_own_unverified_uploads', 'Delete their own unverified upload','Case editing','Only their own file, and only before anyone has verified it.'),
  ('create_case',                   'Create a case',                   'Workflow',     'Open a new file rather than work one they were given.'),
  ('assign_case',                   'Assign a case to a member',       'Workflow',     'Give a case to someone.'),
  ('reassign_case',                 'Reassign a case',                 'Workflow',     'Move a case between members.'),
  ('submit_tasks',                  'Submit assigned tasks',           'Workflow',     'Hand work back for review.'),
  ('approve_task',                  'Approve or reject a task',        'Workflow',     'A staff member must never approve their own submission.'),
  ('verify_documents',              'Verify or reject a document',     'Workflow',     'Accept a document as checked, or send it back with a reason.'),
  ('validate_case',                 'Validate a case',                 'Workflow',     'Quality validation of a finished file.'),
  ('add_case_comments',             'Add case comments',               'Workflow',     'Notes visible to the rest of the team.'),
  ('export_case_report',            'Export a case report',            'Workflow',     'Produce the finished document.'),
  ('delete_case',                   'Delete a case',                   'Administration','Irreversible removal of a case and its attachments.'),
  ('manage_users',                  'Create and change accounts',      'Administration','Open staff accounts, change roles, reset passwords.'),
  ('manage_permissions',            'Change permissions',              'Administration','Flip the individual switches on top of a role.'),
  ('view_audit_log',                'See the audit log',               'Administration','Who changed what, across the whole system.'),
  ('manage_insurer_master',         'Maintain the insurer master',     'Administration','Edit the central list of insurers.'),
  ('manage_system_settings',        'Change system settings',          'Administration','Deadlines, counting rule and other global defaults.'),
  ('use_ai_assistance',             'Use AI assistance',               'Administration','Call the description and report generators.')
ON CONFLICT (key) DO UPDATE SET
  label = EXCLUDED.label,
  group_name = EXCLUDED.group_name,
  description = EXCLUDED.description;

/* What each role is allowed before an admin touches anything. Staff is deliberately the short list:
   they do the survey and hand it back, they do not approve, validate, reassign or administer. */
INSERT INTO role_permissions (role, permission_key)
SELECT 'STAFF', key FROM permissions WHERE key IN (
  'view_assigned_cases', 'view_activity_history', 'edit_case_details', 'edit_vehicle_details',
  'edit_insured_details', 'edit_third_party_details', 'enter_repair_bill_information',
  'complete_inspection_checklist', 'upload_inspection_photos', 'upload_documents',
  'delete_own_unverified_uploads', 'submit_tasks', 'add_case_comments', 'use_ai_assistance'
)
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role, permission_key)
SELECT 'SURVEYOR', key FROM permissions WHERE key IN (
  'view_assigned_cases', 'view_all_cases', 'view_activity_history', 'edit_case_details',
  'edit_vehicle_details', 'edit_insured_details', 'edit_third_party_details',
  'enter_repair_bill_information', 'complete_inspection_checklist', 'upload_inspection_photos',
  'upload_documents', 'delete_own_unverified_uploads', 'create_case', 'assign_case',
  'reassign_case', 'submit_tasks', 'approve_task', 'verify_documents', 'validate_case',
  'add_case_comments',
  'export_case_report', 'use_ai_assistance'
)
ON CONFLICT DO NOTHING;

/* Recorded rather than relied on — the check lets ADMIN through on the role itself. */
INSERT INTO role_permissions (role, permission_key)
SELECT 'ADMIN', key FROM permissions
ON CONFLICT DO NOTHING;

/* An administrator who removes themselves is not deleted outright. Their id is still referenced by
   the staff accounts they opened, by the sessions and audit rows they acted through, and by the
   history the brief insists must survive — so the row stays and the identifying columns are
   replaced. deleted_at is what every lookup filters on; deleted_by records who pressed the button,
   which for a self-deletion is the same person. */
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id) ON DELETE SET NULL;

/* Ownership has to be offered before it is taken: the nominee's acceptance is a separate action from
   the transfer, so the offer is stored rather than applied to the role directly. Only one can be
   outstanding to a person at a time, which the route checks rather than the database, because the
   constraint is about a workflow and not about the shape of the row. */
CREATE TABLE IF NOT EXISTS ownership_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ownership_transfers_to ON ownership_transfers(to_user_id, status);
CREATE INDEX IF NOT EXISTS idx_ownership_transfers_from ON ownership_transfers(from_user_id, status);

/* ---------------------------------------------------------------------------
   Cases on the server (brief §16, task #21)
   ---------------------------------------------------------------------------
   The whole case object used to exist only in this browser's localStorage, which meant the server
   could not say anything about a case at all — no assignment, no task, no verification and no
   comment could point at one. This table is the registry the rest of the brief hangs from.

   The primary key is deliberately the client's own case id rather than a new UUID. Every photograph
   in IndexedDB, every key in the local DB map and every export already names a case by that id, so
   adopting it keeps existing records addressable instead of forcing a translation layer onto every
   read. It is text, unique per device by construction, and the sync treats a collision as the same
   case edited in two places rather than as two cases.

   The columns that are pulled out of the payload are exactly the ones something else has to filter,
   join or enforce on — the duplicate detection in §9D, the assignment list in §5, the readiness
   check in §10 — and everything else travels in payload untouched so the editor keeps owning its own
   shape. There is one case-number column rather than a case number and a claim number because the
   form has one field for both, "Insurance claim no."; §9D's claim-number check runs against it.
   Dates stay as the strings the form writes (YYYY-MM-DD, or the BS calendar text) rather than being
   coerced into DATE, because a Nepali BS date is not a valid Gregorian one and silently converting
   would be the "do not silently modify information" rule broken at the door. */
CREATE TABLE IF NOT EXISTS cases (
  id TEXT PRIMARY KEY,
  owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  module VARCHAR(20) NOT NULL DEFAULT 'motor',
  case_number TEXT,
  policy_number TEXT,
  insurer TEXT,
  insured_name TEXT,
  vehicle_registration TEXT,
  chassis_number TEXT,
  engine_number TEXT,
  accident_date TEXT,
  survey_date TEXT,
  stage TEXT,
  priority TEXT,
  assigned_surveyor TEXT,
  due_date TEXT,
  created_at TIMESTAMPTZ,
  modified_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload JSONB NOT NULL DEFAULT '{}'
);

/* Normalised for the duplicate checks, which compare registration and serial numbers the way the
   form writes them — with or without dashes and in either case. The lower() is inside
   regexp_replace() rather than around it because the character class deletes everything it does not
   recognise, capitals included: folded afterwards, "BA-12-3456" would become "123456" and a plate
   would only ever match the digits of another. */
ALTER TABLE cases ADD COLUMN IF NOT EXISTS reg_norm TEXT GENERATED ALWAYS AS
  (regexp_replace(lower(coalesce(vehicle_registration, '')), '[^a-z0-9]', '', 'g')) STORED;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS chassis_norm TEXT GENERATED ALWAYS AS
  (regexp_replace(lower(coalesce(chassis_number, '')), '[^a-z0-9]', '', 'g')) STORED;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS engine_norm TEXT GENERATED ALWAYS AS
  (regexp_replace(lower(coalesce(engine_number, '')), '[^a-z0-9]', '', 'g')) STORED;

/* The order above is also the fix for a database built while it was the other way round. A generated
   column's expression cannot be rewritten in place, so the three columns that still carry the old
   shape are dropped and added back; dropping one drops its index, and the indexes below are created
   again in the same run. It fires on the expression, not on every boot, so a table with real rows in
   it is only rebuilt once. */
DO $$
DECLARE
  pair RECORD;
BEGIN
  FOR pair IN
    SELECT wanted.column_name, wanted.source
    FROM (VALUES
      ('reg_norm', 'vehicle_registration'),
      ('chassis_norm', 'chassis_number'),
      ('engine_norm', 'engine_number')
    ) AS wanted(column_name, source)
    WHERE EXISTS (
      SELECT 1
      FROM information_schema.columns c
      WHERE c.table_name = 'cases'
        AND c.column_name = wanted.column_name
        AND c.generation_expression LIKE 'lower(regexp_replace%'
    )
  LOOP
    EXECUTE format('ALTER TABLE cases DROP COLUMN %I', pair.column_name);
    EXECUTE format(
      'ALTER TABLE cases ADD COLUMN %I TEXT GENERATED ALWAYS AS
         (regexp_replace(lower(coalesce(%I, %L)), %L, %L, %L)) STORED',
      pair.column_name, pair.source, '', '[^a-z0-9]', '', 'g'
    );
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_cases_owner ON cases(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_cases_case_number ON cases(case_number);
CREATE INDEX IF NOT EXISTS idx_cases_policy ON cases(policy_number) WHERE policy_number IS NOT NULL AND policy_number <> '';
/* No claim-number index: case_number is that column, and idx_cases_case_number already covers it. */
CREATE INDEX IF NOT EXISTS idx_cases_reg_norm ON cases(reg_norm) WHERE reg_norm <> '';
CREATE INDEX IF NOT EXISTS idx_cases_chassis_norm ON cases(chassis_norm) WHERE chassis_norm <> '';
CREATE INDEX IF NOT EXISTS idx_cases_engine_norm ON cases(engine_norm) WHERE engine_norm <> '';
CREATE INDEX IF NOT EXISTS idx_cases_insurer_accident ON cases(insurer, accident_date);
CREATE INDEX IF NOT EXISTS idx_cases_modified ON cases(modified_at);

/* ---------------------------------------------------------------------------
   Assignments and the approval workflow (§5, §6)

   §16 lists case_assignments and tasks as separate entities. They are one table here because the
   assignment form in §5 is the thing that creates a task: its fields are case, staff, type,
   priority, dates and instructions, which is exactly a task. Two tables would hold the same eight
   columns, and every reassignment would have to keep both in step. What §5 calls "multiple staff
   members working on different tasks within one case" is then simply several rows with the same
   case_id, which is also how the deadlines and the assignment history are read.

   The status column carries the eight names from §6 and nothing else, because the workflow steps
   are those names — the buttons a member sees are derived from the current one, so a status outside
   the list would be a task nobody can act on. Text rather than an enum so adding a ninth stays a
   CHECK constraint and not a migration of the type.

   due_date stays TEXT like every other date in this database: the form writes either a Gregorian
   YYYY-MM-DD or a BS calendar string, and the second is not a valid DATE. The deadline monitoring
   that already exists treats them as text.

   assigned_by is nullable because the person who opened a task may have deleted their own account
   since — §15 requires the work to survive that — while assignee is not, because a task addressed to
   an account that no longer exists has nobody left to do it.
   --------------------------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  assignment_type VARCHAR(40) NOT NULL CHECK (assignment_type IN
    ('Physical Inspection', 'Document Collection', 'Vehicle Information Entry',
     'Inspection Checklist', 'Photograph Collection', 'Repair Bill Collection',
     'Legal Document Collection', 'Other')),
  instructions TEXT,
  priority VARCHAR(10) NOT NULL DEFAULT 'Normal' CHECK (priority IN
    ('Urgent', 'High', 'Medium', 'Normal')),
  status VARCHAR(30) NOT NULL DEFAULT 'Assigned' CHECK (status IN
    ('Assigned', 'Accepted', 'In Progress', 'Submitted for Review', 'Correction Required',
     'Resubmitted', 'Approved', 'Cancelled')),
  assignee_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  due_date TEXT,
  accepted_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ,
  reviewed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  review_reason TEXT,
  cancelled_at TIMESTAMPTZ,
  cancelled_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

/* One open task per member per kind of work on a case. Without it, a double-pressed button or a
   retry from a phone that lost signal puts two identical inspections on the same person, and the
   second is invisible to the reviewer until both are submitted. Only open work is constrained: a
   task that finished or was withdrawn is history, and a member may legitimately do the same kind of
   job again on the same claim later. */
CREATE UNIQUE INDEX IF NOT EXISTS uq_tasks_open
  ON tasks(case_id, assignee_user_id, assignment_type)
  WHERE status NOT IN ('Approved', 'Cancelled');

CREATE INDEX IF NOT EXISTS idx_tasks_case ON tasks(case_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_user_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_by ON tasks(assigned_by_user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

/* §6: every transition must be recorded. task_events is that record, and it is separate from
   audit_logs on purpose — audit_logs answers "who touched this account, this password, this
   permission" for a security review, while this answers "what happened to this piece of work" for
   the member, the reviewer and the performance views in §13. The two are read with different
   questions and kept for different lengths, and the row here is the one that has to be complete:
   every move writes one, including the ones that also produce an audit entry.

   from_status and to_status are plain text rather than a foreign key into a status table because a
   status that was renamed out of existence must still be readable in the history of a task that was
   moved years ago. */
CREATE TABLE IF NOT EXISTS task_events (
  id BIGSERIAL PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(40) NOT NULL,
  from_status TEXT,
  to_status TEXT,
  reason TEXT,
  details JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_events_task ON task_events(task_id, id);
CREATE INDEX IF NOT EXISTS idx_task_events_actor ON task_events(actor_user_id);

/* ---------------------------------------------------------------------------
   §8 DOCUMENT VERIFICATION
   ---------------------------------------------------------------------------
   Until now a document was only a base64 photograph inside this browser's IndexedDB, so the server
   knew nothing about the policy copy or the bill that a report is supposed to rest on. §8 asks for a
   document to be a record with an uploader, a verifier, a status, a reason for every rejection and a
   version history, and none of that can exist in a browser that the next person cannot see.

   One row is one file, not one document slot. A replacement inserts a second row that points at the
   first through supersedes_document_id and takes over the thread, which is what makes "preserve
   previous versions" a fact of the schema instead of a promise in the UI: the superseded row keeps
   its bytes, its status and its verifier, and the only thing that changes on it is is_current.

   thread_id is the version chain — the id of the first row in it. It is set by the server on insert
   (its own id for a new document, the parent's thread for a replacement) rather than defaulted,
   because a column cannot reference its own row in a DEFAULT. The partial unique index is the guard
   that makes two simultaneous replacements of the same document impossible to both stick.

   sha256 is computed by the server from the bytes it received, never taken from the client, so the
   duplicate detection in §9 and "is this really a different scan?" have something to compare that a
   renamed file cannot defeat. Where the bytes live is not a column: it is derived from the case id and
   this row's id, so no stored string is ever a path, and has_file says only whether they have landed. */
CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  supersedes_document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  is_current BOOLEAN NOT NULL DEFAULT TRUE,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  category VARCHAR(40) NOT NULL CHECK (category IN
    ('Policy', 'Intimation', 'Inspection Photos', 'Estimates', 'Bills',
     'Legal Documents', 'Reports', 'Other Documents')),
  original_filename TEXT NOT NULL,
  mime_type VARCHAR(100),
  byte_size BIGINT,
  sha256 CHAR(64),
  has_file BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(30) NOT NULL DEFAULT 'Pending Verification' CHECK (status IN
    ('Uploaded', 'Pending Verification', 'Verified', 'Rejected', 'Replacement Required')),
  report_related BOOLEAN NOT NULL DEFAULT FALSE,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verified_by UUID REFERENCES users(id) ON DELETE SET NULL,
  verified_at TIMESTAMPTZ,
  rejected_by UUID REFERENCES users(id) ON DELETE SET NULL,
  rejected_at TIMESTAMPTZ,
  rejection_reason TEXT,
  superseded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

/* Two columns the first draft of this table had and the design no longer wants. storage_key held the
   location of the bytes, which is now derived from the case id and the row id — so that nothing stored
   can ever be read as a path. superseded_by pointed at a user while the code that wrote it meant a
   version, and the version chain is already carried by supersedes_document_id on the newer row. A
   column that no code writes correctly is a column someone will later read and trust, so an existing
   database has them removed, the same way the cases normalisation columns are rebuilt above. */
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'documents' AND column_name = 'storage_key'
  ) THEN
    ALTER TABLE documents DROP COLUMN storage_key;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'documents' AND column_name = 'superseded_by'
  ) THEN
    ALTER TABLE documents DROP COLUMN superseded_by;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_documents_current_version
  ON documents(thread_id)
  WHERE is_current;

CREATE INDEX IF NOT EXISTS idx_documents_case ON documents(case_id, is_current);
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
CREATE INDEX IF NOT EXISTS idx_documents_uploader ON documents(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_documents_thread ON documents(thread_id, version);
CREATE INDEX IF NOT EXISTS idx_documents_sha ON documents(sha256);

/* The history §8 asks for is kept the same way task work is kept: a separate, append-only record of
   what happened to this thing, with who and when, so the document list stays one row per file and the
   story of that file stays queryable. details carries the before/after of a category or filename
   change, which is the only place a renamed document is still readable. */
CREATE TABLE IF NOT EXISTS document_events (
  id BIGSERIAL PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(40) NOT NULL,
  from_status TEXT,
  to_status TEXT,
  reason TEXT,
  details JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_document_events_document ON document_events(document_id, id);
CREATE INDEX IF NOT EXISTS idx_document_events_actor ON document_events(actor_user_id);

/* ────────────────────────────────────────────────────────────────────────────────────────────
   §11 CASE COMMENTS AND COMMUNICATION — one row is one thing somebody said about a case
   ──────────────────────────────────────────────────────────────────────────────────────────── */

/* Append-only on purpose. §11 closes with "all communications must be linked to the relevant case and
   preserved in its activity history", which is a rule against editing the record rather than a
   preference, so there is no deleted_at and no UPDATE of body from the API. A reply is a second row
   that points at the first through parent_comment_id — the thread is data, not a rendering trick, so
   an unread reply is still findable when its parent is years old.

   mentions holds user ids the server resolved out of the body's @tokens, never the raw text a client
   typed: who was told is a fact about the database, and a name that matches nobody must not silently
   become a notification to whoever shares it. document_id is §11's "attach supporting files" answered
   with §28's documents table rather than a second file store — a file attached to a comment is a
   document filed under the case, with a category, a hash and a verifier, and the comment points at it. */
CREATE TABLE IF NOT EXISTS case_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  author_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  parent_comment_id UUID REFERENCES case_comments(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  mentions JSONB NOT NULL DEFAULT '[]',
  document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  is_instruction BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_case_comments_case ON case_comments(case_id, created_at);
CREATE INDEX IF NOT EXISTS idx_case_comments_parent ON case_comments(parent_comment_id);
CREATE INDEX IF NOT EXISTS idx_case_comments_author ON case_comments(author_user_id);

/* Read/unread for a thread is one number per person per case, not one row per comment: "what I have not
   read" is every comment after this timestamp, which stays true for comments written while the person
   was looking at the list, and does not need a sweep to catch up. */
CREATE TABLE IF NOT EXISTS case_comment_reads (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, case_id)
);

/* ────────────────────────────────────────────────────────────────────────────────────────────
   §12 NOTIFICATION SYSTEM — one row is one thing somebody had to be told
   ──────────────────────────────────────────────────────────────────────────────────────────── */

/* Written by the event that earns it, from one function — the §12 bullets are a vocabulary rather than
   twelve call sites inventing their own wording.

   The two deadline types are the exception in where the rule comes from, not in where the row lives: a
   deadline is a fact about the clock, so the sentence is re-read from the calendar every time the list
   is opened, and an unread notice whose date has since moved is replaced rather than left beside the
   new one. The row is still stored, because a notice nobody can mark read is not a notice but a badge,
   and the bell in §12 has a read status on every entry. What keeps a still-overdue case from becoming a
   drumbeat is that a notice which has been read is only raised again a day later — the calendar does
   not re-ask a question that has already been answered today.

   A thirteenth type is not in §12's list. §11 asks that a mention "send notifications", and a reply
   tells the person being answered, neither of which is any of the twelve events; those notices carry
   case_comment and the comment that provoked them, which keeps one vocabulary in the bell instead of
   dressing a reply up as an admin instruction.

   The reference columns are separate rather than one polymorphic target_id, so the bell can say
   "case BA-9 · document policy-certificate.png" without a join that has to guess which table the id
   belongs to, and so deleting a case takes its notifications with it while deleting a user does not
   take the notice they were sent. */
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  type VARCHAR(40) NOT NULL,
  message TEXT NOT NULL CHECK (char_length(message) BETWEEN 1 AND 500),
  case_id TEXT REFERENCES cases(id) ON DELETE CASCADE,
  task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  comment_id UUID REFERENCES case_comments(id) ON DELETE SET NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

/* The list of types is a constraint the code has to be able to grow: §11 added case_comment after the
   first cut of this table, and a CHECK written inline in the CREATE above is not re-checked against an
   existing database. Dropping and re-adding the same statement every run keeps the live database and
   a fresh one on one list, which is the reason the vocabulary is written out in exactly one place. */
DO $$
BEGIN
  ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
  ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN
    ('case_assigned', 'task_assigned', 'deadline_approaching', 'deadline_missed',
     'document_rejected', 'task_approved', 'correction_requested', 'admin_instruction',
     'work_submitted', 'assignment_changed', 'account_suspended', 'password_reset_requested',
     'case_comment'));
END
$$;

CREATE INDEX IF NOT EXISTS idx_notifications_inbox ON notifications(user_id, read_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_case ON notifications(case_id);
CREATE INDEX IF NOT EXISTS idx_notifications_actor ON notifications(actor_user_id);
/* The deadline refresh asks one question of the whole inbox at once — what has this person already
   been told about this case and this work — and this is the index that answers it without a scan. */
CREATE INDEX IF NOT EXISTS idx_notifications_user_type ON notifications(user_id, type, case_id, task_id);

/* ---------------------------------------------------------------------------
   Third-party management module
   ---------------------------------------------------------------------------
   A party master lives once per person or organisation, while the relationship between that party and
   a particular case is carried in the role table. This keeps a historical case record even when the
   master data changes, which matches the brief's requirement that the case still preserve who was on
   it when the event happened. */
CREATE TABLE IF NOT EXISTS third_party_parties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  party_type VARCHAR(20) NOT NULL DEFAULT 'Individual' CHECK (party_type IN ('Individual', 'Organisation')),
  name VARCHAR(200) NOT NULL,
  contact_number VARCHAR(60),
  address TEXT,
  email VARCHAR(320),
  citizenship_number VARCHAR(60),
  pan_vat_number VARCHAR(60),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS third_party_party_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id UUID NOT NULL REFERENCES third_party_parties(id) ON DELETE CASCADE,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  role VARCHAR(40) NOT NULL CHECK (role IN (
    'Owner', 'Driver', 'Claimant', 'Property Owner', 'Tenant', 'Employer', 'Contractor',
    'Injured Person', 'Legal Representative', 'Other'
  )),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (party_id, case_id, role)
);

CREATE INDEX IF NOT EXISTS idx_third_party_parties_case ON third_party_parties(case_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_third_party_roles_party ON third_party_party_roles(party_id);
CREATE INDEX IF NOT EXISTS idx_third_party_roles_case ON third_party_party_roles(case_id);

CREATE TABLE IF NOT EXISTS third_party_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  claim_reference VARCHAR(80) NOT NULL UNIQUE,
  claimant_party_id UUID REFERENCES third_party_parties(id) ON DELETE SET NULL,
  claim_type VARCHAR(60) NOT NULL,
  damaged_asset VARCHAR(200),
  claimed_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  claim_date DATE,
  claim_description TEXT,
  status VARCHAR(40) NOT NULL DEFAULT 'Registered' CHECK (status IN (
    'Registered', 'Documents Pending', 'Inspection Pending', 'Under Assessment', 'Assessment Completed',
    'Report Submitted', 'Rectification Required', 'Resubmitted', 'Closed', 'Withdrawn'
  )),
  workflow_status VARCHAR(40) NOT NULL DEFAULT 'Registered' CHECK (workflow_status IN (
    'Registered', 'Documents Pending', 'Inspection Pending', 'Under Assessment', 'Assessment Completed',
    'Report Submitted', 'Rectification Required', 'Resubmitted', 'Closed', 'Withdrawn'
  )),
  insurance_company VARCHAR(200),
  policy_number VARCHAR(120),
  policy_period VARCHAR(120),
  insurance_verification_status VARCHAR(30) NOT NULL DEFAULT 'Pending Verification' CHECK (
    insurance_verification_status IN ('Verified', 'Pending Verification', 'Not Available')
  ),
  accident_description TEXT,
  police_report_available BOOLEAN NOT NULL DEFAULT FALSE,
  police_report_number VARCHAR(80),
  investigation_findings TEXT,
  liability_status VARCHAR(30) NOT NULL DEFAULT 'Undetermined' CHECK (
    liability_status IN ('Undetermined', 'Under Investigation', 'Disputed', 'Findings Recorded')
  ),
  surveyor_remarks TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS third_party_claim_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id UUID NOT NULL REFERENCES third_party_claims(id) ON DELETE CASCADE,
  asset_type VARCHAR(40) NOT NULL CHECK (asset_type IN ('Vehicle', 'Property', 'Machinery/Equipment', 'Person')),
  asset_data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS third_party_claim_inspections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id UUID NOT NULL REFERENCES third_party_claims(id) ON DELETE CASCADE,
  inspection_date DATE,
  inspection_location TEXT,
  inspected_by VARCHAR(200),
  inspection_status VARCHAR(40) NOT NULL DEFAULT 'Inspection Pending' CHECK (
    inspection_status IN (
      'Physical inspection completed', 'Inspection pending', 'Third party unavailable',
      'Inspection refused', 'Asset already repaired'
    )
  ),
  damage_description TEXT,
  surveyor_observations TEXT,
  photographs JSONB NOT NULL DEFAULT '[]',
  inspection_remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS third_party_claim_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id UUID NOT NULL REFERENCES third_party_claims(id) ON DELETE CASCADE,
  assessment_type VARCHAR(60) NOT NULL DEFAULT 'Motor Damage Assessment',
  claimed_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  assessed_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  admissible_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  settled_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  items JSONB NOT NULL DEFAULT '[]',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS third_party_activity_history (
  id BIGSERIAL PRIMARY KEY,
  claim_id UUID NOT NULL REFERENCES third_party_claims(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(80) NOT NULL,
  details JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_third_party_claims_case ON third_party_claims(case_id, workflow_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_third_party_claims_party ON third_party_claims(claimant_party_id);
CREATE INDEX IF NOT EXISTS idx_third_party_claim_assets_claim ON third_party_claim_assets(claim_id);
CREATE INDEX IF NOT EXISTS idx_third_party_claim_inspections_claim ON third_party_claim_inspections(claim_id, inspection_date);
CREATE INDEX IF NOT EXISTS idx_third_party_claim_assessments_claim ON third_party_claim_assessments(claim_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_third_party_activity_claim ON third_party_activity_history(claim_id, created_at DESC);
