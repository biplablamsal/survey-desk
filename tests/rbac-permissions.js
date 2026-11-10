/* End-to-end check of the permission layer against the live server on 3000.

   Sessions are minted directly in the database for both the administrator and the throwaway staff
   account, so no password is involved and the forced-change screen is not in the way — this script
   is about authorization, not authentication. Everything it creates is deleted at the end. */
const db = require('../db/index.js');

const BASE = 'http://127.0.0.1:3000';
const PROBE_EMAIL = 'perm-probe-20261106@example.invalid';
const results = [];
const record = (name, ok, detail) => results.push({ name, ok: Boolean(ok), detail });

const call = async (pathname, { method = 'GET', cookie, body } = {}) => {
  const res = await fetch(BASE + pathname, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Origin: BASE,
      ...(cookie ? { Cookie: `surveypro_session=${cookie}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
};

const mint = async (userId) =>
  db.createSessionForUser(userId, { metadata: { browserName: 'perm-probe' } });

(async () => {
  const admins = await db.query(
    "SELECT id FROM users WHERE role = 'ADMIN' ORDER BY created_at LIMIT 1"
  );
  if (!admins.rowCount) throw new Error('no ADMIN row to test with');
  const adminCookie = await mint(admins.rows[0].id);

  /* 1. the catalogue and its role defaults */
  const catalog = await call('/api/permissions', { cookie: adminCookie });
  const rows = catalog.json?.permissions || [];
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
  /* Compared with the seeded table rather than with a number written into the test: the promise the
     screen makes is that every switch the database knows about is offered, and a frozen count turns
     each new permission into a failing suite that says nothing true. */
  const seeded = await db.query('SELECT count(*)::int AS n FROM permissions');
  record(
    'GET /api/permissions returns the whole seeded catalogue, including the document switch §8 needs',
    catalog.status === 200 &&
      rows.length === seeded.rows[0].n &&
      Boolean(byKey.verify_documents) &&
      byKey.verify_documents?.group === 'Workflow' &&
      byKey.verify_documents?.staff_default === false,
    {
      status: catalog.status,
      count: rows.length,
      seeded: seeded.rows[0].n,
      verifyDocuments: byKey.verify_documents || null,
    }
  );
  record(
    'staff default is the restrictive list',
    byKey.view_assigned_cases?.staff_default === true,
    {
      staffKeys: rows.filter((r) => r.staff_default).length,
    }
  );
  const staffAdminKeys = rows
    .filter((r) => r.staff_default && r.group === 'Administration')
    .map((r) => r.key);
  record(
    'the only administration switch staff gets by default is AI help',
    staffAdminKeys.length === 1 && staffAdminKeys[0] === 'use_ai_assistance',
    {
      staffAdminKeys,
    }
  );
  record('approve_task is not a staff default', byKey.approve_task?.staff_default === false, {
    approve_task: byKey.approve_task,
  });

  /* 2. a staff account, and what its session can see */
  const created = await call('/api/admin/users', {
    method: 'POST',
    cookie: adminCookie,
    body: { fullName: 'Permission Probe', email: PROBE_EMAIL, role: 'STAFF' },
  });
  const staffId = created.json?.user?.id;
  record('staff probe created', created.status === 201 && Boolean(staffId), {
    status: created.status,
  });

  /* The account arrives flagged for its first password, and that flag is what #89 verified. Here it
     would answer every call below with password_change_required before the permission check ever
     ran, so it is cleared to keep this script about authorization. */
  await db.query('UPDATE users SET must_change_password = FALSE WHERE id = $1', [staffId]);

  const staffCookie = await mint(staffId);
  const staffPerms = await call('/api/auth/permissions', { cookie: staffCookie });
  const keys = staffPerms.json?.permissions || [];
  record(
    'staff resolves the role defaults',
    staffPerms.status === 200 && keys.includes('view_assigned_cases'),
    {
      role: staffPerms.json?.role,
      count: keys.length,
    }
  );
  record('staff does not resolve manage_users', !keys.includes('manage_users'), { keys });

  const denied = await call('/api/admin/users', { cookie: staffCookie });
  record(
    'staff blocked from the user list by the server',
    denied.status === 403 && denied.json?.code === 'permission_denied',
    {
      status: denied.status,
      code: denied.json?.code,
      permission: denied.json?.permission,
    }
  );

  /* 3. the matrix an admin reads before flipping a switch */
  const matrix = await call(`/api/admin/users/${staffId}/permissions`, { cookie: adminCookie });
  const mrows = matrix.json?.matrix || [];
  const manageRow = mrows.find((r) => r.key === 'manage_users');
  record(
    'matrix shows role default, override and effective separately',
    matrix.status === 200 &&
      manageRow?.role_default === false &&
      manageRow?.override === null &&
      manageRow?.effective === false,
    {
      status: matrix.status,
      manageRow,
    }
  );

  /* 4. granting one permission to one person — and it bites without a re-login */
  const grant = await call(`/api/admin/users/${staffId}/permissions`, {
    method: 'PUT',
    cookie: adminCookie,
    body: { permissions: [{ key: 'manage_users', granted: true }] },
  });
  record(
    'PUT records the override',
    grant.status === 200 &&
      grant.json?.matrix?.find((r) => r.key === 'manage_users')?.effective === true,
    {
      status: grant.status,
      row: grant.json?.matrix?.find((r) => r.key === 'manage_users'),
    }
  );

  const nowAllowed = await call('/api/admin/users', { cookie: staffCookie });
  record('the same live session gains the route immediately', nowAllowed.status === 200, {
    status: nowAllowed.status,
    code: nowAllowed.json?.code,
  });

  /* 5. and taking one away */
  const revoke = await call(`/api/admin/users/${staffId}/permissions`, {
    method: 'PUT',
    cookie: adminCookie,
    body: { permissions: [{ key: 'view_assigned_cases', granted: false }] },
  });
  const afterRevoke = await call('/api/auth/permissions', { cookie: staffCookie });
  record(
    'an override can deny what the role allows',
    revoke.status === 200 && !(afterRevoke.json?.permissions || []).includes('view_assigned_cases'),
    {
      stillHas: (afterRevoke.json?.permissions || []).includes('view_assigned_cases'),
      count: (afterRevoke.json?.permissions || []).length,
    }
  );

  /* 6. clearing the override returns the member to their role */
  const clear = await call(`/api/admin/users/${staffId}/permissions`, {
    method: 'PUT',
    cookie: adminCookie,
    body: {
      permissions: [
        { key: 'view_assigned_cases', granted: null },
        { key: 'manage_users', granted: null },
      ],
    },
  });
  const afterClear = await call('/api/auth/permissions', { cookie: staffCookie });
  const cleared = afterClear.json?.permissions || [];
  record(
    'a cleared override falls back to the role',
    clear.status === 200 &&
      cleared.includes('view_assigned_cases') &&
      !cleared.includes('manage_users'),
    {
      count: cleared.length,
    }
  );

  /* 7. the guards */
  const onAdmin = await call(`/api/admin/users/${admins.rows[0].id}/permissions`, {
    method: 'PUT',
    cookie: adminCookie,
    body: { permissions: [{ key: 'manage_users', granted: false }] },
  });
  record('an administrator cannot be overridden', onAdmin.status === 400, {
    status: onAdmin.status,
    error: onAdmin.json?.error,
  });

  const unknown = await call(`/api/admin/users/${staffId}/permissions`, {
    method: 'PUT',
    cookie: adminCookie,
    body: { permissions: [{ key: 'drop_production_database', granted: true }] },
  });
  record('an unknown permission key is refused', unknown.status === 400, {
    status: unknown.status,
    error: unknown.json?.error,
  });

  const notStaff = await call(`/api/admin/users/${staffId}/permissions`, {
    method: 'PUT',
    cookie: staffCookie,
    body: { permissions: [{ key: 'approve_task', granted: true }] },
  });
  record('the staff member cannot edit their own permissions', notStaff.status === 403, {
    status: notStaff.status,
    code: notStaff.json?.code,
  });

  /* 8. the audit trail */
  const audit = await db.query(
    "SELECT action, details FROM audit_logs WHERE target_user_id = $1 AND action = 'user_permissions_updated' ORDER BY created_at",
    [staffId]
  );
  record('each save is audited', audit.rowCount === 3, {
    count: audit.rowCount,
    actions: audit.rows.map((r) => r.details?.changed),
  });

  /* teardown */
  await db.query(
    `WITH probe AS (SELECT $1::uuid AS id)
     DELETE FROM audit_logs a WHERE EXISTS (SELECT 1 FROM probe p WHERE p.id = a.actor_user_id OR p.id = a.target_user_id)`,
    [staffId]
  );
  await db.query(
    `UPDATE sessions SET revoked_at = NOW(), revoked_reason = 'probe_finished', last_active_at = NOW(), last_seen_at = NOW()
      WHERE browser_name = 'perm-probe'`
  );
  const removed = await db.query('DELETE FROM users WHERE id = $1 RETURNING email', [staffId]);

  const failed = results.filter((r) => !r.ok);
  console.log(
    JSON.stringify(
      {
        passed: results.length - failed.length,
        total: results.length,
        removedAccount: removed.rows.map((r) => r.email),
        failures: failed,
      },
      null,
      2
    )
  );
  process.exit(failed.length ? 1 : 0);
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
