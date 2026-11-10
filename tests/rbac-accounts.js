/* End-to-end check of the admin create-staff slice against the live server on 3000.
   It mints a session for the existing administrator directly in the database rather than signing in
   with a password, because a real login would fire the new-device email and depend on a credential
   nobody should paste into a script. The staff account it creates is deleted at the end. */
const db = require('../db/index.js');

const BASE = 'http://127.0.0.1:3000';
const ORIGIN = BASE;
const TEST_EMAIL = 'rbac-probe-20261106@example.invalid';
const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok), detail });
};

const call = async (pathname, { method = 'GET', cookie, body } = {}) => {
  const res = await fetch(BASE + pathname, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Origin: ORIGIN,
      ...(cookie ? { Cookie: `surveypro_session=${cookie}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch (error) {
    json = null;
  }
  return { status: res.status, json };
};

(async () => {
  /* 1. an administrator session, minted the way login would mint it */
  const admins = await db.query(
    "SELECT id, email FROM users WHERE role = 'ADMIN' ORDER BY created_at LIMIT 1"
  );
  if (!admins.rowCount) throw new Error('no ADMIN row to test with');
  const adminId = admins.rows[0].id;
  const adminCookie = await db.createSessionForUser(adminId, { browserName: 'probe' });

  const me = await call('/api/auth/me', { cookie: adminCookie });
  record('admin /api/auth/me', me.status === 200 && me.json.user.role === 'ADMIN', {
    status: me.status,
    role: me.json?.user?.role,
  });

  /* 2. create a staff account with a generated temporary password */
  const created = await call('/api/admin/users', {
    method: 'POST',
    cookie: adminCookie,
    body: {
      fullName: 'Rbac Probe',
      email: TEST_EMAIL,
      role: 'STAFF',
      phoneNumber: '9800000000',
      remarks: 'test row',
    },
  });
  const tempPassword = created.json?.temporaryPassword;
  const staffId = created.json?.user?.id;
  record(
    'POST /api/admin/users returns 201 + one-time password',
    created.status === 201 && Boolean(tempPassword),
    {
      status: created.status,
      tempPasswordLen: tempPassword ? tempPassword.length : 0,
    }
  );
  record(
    'created account is flagged must_change_password',
    created.json?.user?.mustChangePassword === true,
    {
      mustChangePassword: created.json?.user?.mustChangePassword,
    }
  );
  record(
    'response never leaks the password hash',
    !JSON.stringify(created.json || {}).includes('$argon2'),
    {
      keys: Object.keys(created.json || {}),
    }
  );

  /* 3. the stored role and flag, read straight from the row */
  const row = await db.query(
    'SELECT role, is_verified, is_active, must_change_password, admin_remarks, phone_number, left(password_hash, 12) AS hash_prefix FROM users WHERE id = $1',
    [staffId]
  );
  record(
    'row holds STAFF + verified + forced-change',
    row.rows[0].role === 'STAFF' &&
      row.rows[0].is_verified &&
      row.rows[0].is_active &&
      row.rows[0].must_change_password,
    {
      role: row.rows[0].role,
      is_verified: row.rows[0].is_verified,
      is_active: row.rows[0].is_active,
      must_change_password: row.rows[0].must_change_password,
      phone_number: row.rows[0].phone_number,
    }
  );
  record(
    'stored credential is an argon2id hash, not the temporary password',
    String(row.rows[0].hash_prefix).startsWith('$argon2id$') &&
      !String(row.rows[0].hash_prefix).includes(tempPassword),
    {
      hashPrefix: row.rows[0].hash_prefix,
    }
  );

  /* 4. duplicate address is refused */
  const dupe = await call('/api/admin/users', {
    method: 'POST',
    cookie: adminCookie,
    body: { fullName: 'Rbac Probe', email: TEST_EMAIL, role: 'STAFF' },
  });
  record('duplicate email -> 409', dupe.status === 409, {
    status: dupe.status,
    error: dupe.json?.error,
  });

  /* 5. weak admin-supplied password is refused */
  const weak = await call('/api/admin/users', {
    method: 'POST',
    cookie: adminCookie,
    body: {
      fullName: 'Weak',
      email: 'weak-probe@example.invalid',
      role: 'STAFF',
      temporaryPassword: 'short',
    },
  });
  record('weak temporary password -> 400', weak.status === 400, { status: weak.status });

  /* 6. staff signs in with the temporary password */
  const login = await call('/api/auth/login', {
    method: 'POST',
    body: { email: TEST_EMAIL, password: tempPassword },
  });
  record(
    'staff login with temporary password -> 200 + flag',
    login.status === 200 && login.json?.user?.mustChangePassword === true,
    {
      status: login.status,
      role: login.json?.user?.role,
      mustChangePassword: login.json?.user?.mustChangePassword,
    }
  );

  /* The login cookie is HttpOnly, so the probe mints its own session for the same row instead of
     reading one back; validateSessionToken sees both identically. */
  let staffSession = null;
  if (staffId)
    staffSession = await db.createSessionForUser(staffId, { browserName: 'probe-staff' });

  /* 7. the pending account is locked out of everything except proving it can change the password */
  const blocked = await call('/api/admin/users', { cookie: staffSession });
  record(
    'forced-change account blocked from admin list',
    blocked.status === 403 &&
      (blocked.json?.code === 'password_change_required' ||
        blocked.json?.error?.includes('Set a new password')),
    {
      status: blocked.status,
      code: blocked.json?.code,
      error: blocked.json?.error,
    }
  );
  const allowlisted = await call('/api/auth/me', { cookie: staffSession });
  record('forced-change account can still read /api/auth/me', allowlisted.status === 200, {
    status: allowlisted.status,
  });

  /* 8. a staff account is never an administrator, even after changing the password */
  const changed = await call('/api/account/change-password', {
    method: 'POST',
    cookie: staffSession,
    body: {
      currentPassword: tempPassword,
      newPassword: 'Rotated-Probe-2026!',
      confirmPassword: 'Rotated-Probe-2026!',
    },
  });
  record('password change accepted', changed.status === 200, {
    status: changed.status,
    error: changed.json?.error,
  });
  const afterChange = await db.query('SELECT must_change_password FROM users WHERE id = $1', [
    staffId,
  ]);
  record(
    'must_change_password cleared after change',
    afterChange.rows[0].must_change_password === false,
    afterChange.rows[0]
  );
  const staffAdminList = await call('/api/admin/users', { cookie: staffSession });
  record('STAFF cannot list users -> 403', staffAdminList.status === 403, {
    status: staffAdminList.status,
    error: staffAdminList.json?.error,
  });
  const staffCreate = await call('/api/admin/users', {
    method: 'POST',
    cookie: staffSession,
    body: { fullName: 'Escalation', email: 'escalation-probe@example.invalid', role: 'ADMIN' },
  });
  record('STAFF cannot create an ADMIN -> 403', staffCreate.status === 403, {
    status: staffCreate.status,
  });

  /* 9. the old password no longer works */
  const replay = await call('/api/auth/login', {
    method: 'POST',
    body: { email: TEST_EMAIL, password: tempPassword },
  });
  record('temporary password rejected after change', replay.status === 401, {
    status: replay.status,
  });

  /* 10. admin resets it and every staff device is signed out */
  const reset = await call(`/api/admin/users/${staffId}/reset-password`, {
    method: 'POST',
    cookie: adminCookie,
  });
  record(
    'admin reset returns a new one-time password',
    reset.status === 200 && Boolean(reset.json?.temporaryPassword),
    {
      status: reset.status,
      sessionsSignedOut: reset.json?.sessionsSignedOut,
    }
  );
  const afterReset = await call('/api/admin/users', { cookie: staffSession });
  record(
    'reset signs the staff device out and re-arms forced change',
    afterReset.status === 401 || afterReset.json?.code === 'password_change_required',
    {
      status: afterReset.status,
      code: afterReset.json?.code,
    }
  );

  /* 11. audit trail */
  const audit = await db.query(
    'SELECT action FROM audit_logs WHERE target_user_id = $1 ORDER BY created_at',
    [staffId]
  );
  record(
    'audit trail records create and reset',
    audit.rows.some((r) => r.action === 'user_created') &&
      audit.rows.some((r) => r.action === 'password_reset_by_admin'),
    {
      actions: audit.rows.map((r) => r.action),
    }
  );

  /* 12. cleanup: the probe account and every session it or the admin minted here */
  await db.query('DELETE FROM sessions WHERE user_id = $1', [staffId]);
  await db.query('DELETE FROM login_activity WHERE user_id = $1', [staffId]);
  await db.query('DELETE FROM audit_logs WHERE target_user_id = $1 OR actor_user_id = $1', [
    staffId,
  ]);
  await db.query('DELETE FROM users WHERE id = $1', [staffId]);
  await db.query(
    'UPDATE sessions SET revoked_at = NOW(), revoked_reason = $2 WHERE session_token_hash = $1',
    [db.hashToken(adminCookie), 'probe_finished']
  );
  await db.query(
    'UPDATE sessions SET revoked_at = NOW(), revoked_reason = $2 WHERE session_token_hash = $1',
    [db.hashToken(staffSession), 'probe_finished']
  );
  const gone = await db.query('SELECT COUNT(*)::int AS n FROM users WHERE id = $1', [staffId]);
  const leftovers = await db.query(
    "SELECT COUNT(*)::int AS n FROM users WHERE email LIKE 'rbac-probe%' OR email LIKE 'weak-probe%' OR email LIKE 'escalation-probe%'"
  );
  record('probe account deleted', gone.rows[0].n === 0, gone.rows[0]);
  record('no probe accounts left', leftovers.rows[0].n === 0, leftovers.rows[0]);

  const failed = results.filter((r) => !r.ok);
  console.log(
    JSON.stringify(
      {
        passed: results.length - failed.length,
        failed: failed.length,
        total: results.length,
        failures: failed,
      },
      null,
      1
    )
  );
  process.exit(failed.length ? 1 : 0);
})().catch(async (error) => {
  console.log(JSON.stringify({ fatal: String(error && error.message), results }, null, 1));
  process.exit(1);
});
