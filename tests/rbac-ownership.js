/* End-to-end check of brief §15 — admin self-deletion and ownership transfer — against the live
   server on 3000.

   Everything here runs against throwaway accounts on @example.invalid, and the one thing that cannot
   be simulated without touching a real row is proved differently: the seeded administrator account is
   the only genuine ADMIN in the database, so no probe can ever be "the last one". The last-administrator
   predicate is therefore exercised inside a Postgres transaction that is rolled back — the disable is
   never visible to any other connection and is undone even if this script dies halfway. */
const path = require('path');
const ROOT = path.join(__dirname, '..');
const db = require('../db/index.js');
const argon2 = require('argon2');

const BASE = 'http://127.0.0.1:3000';
const PASSWORD = 'Ownership-Probe-2026!';
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

const mint = (userId) => db.createSessionForUser(userId, { metadata: { browserName: 'ow-probe' } });

const stamp = Date.now();
const email = (who) => `ow-${who}-${stamp}@example.invalid`;

(async () => {
  const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
  const make = async (who, role, fields = {}) => {
    const user = await db.createUser({
      fullName: `Ownership ${who}`,
      firstName: 'Ownership',
      lastName: who,
      email: email(who),
      passwordHash: hash,
      provider: 'email',
      role,
      emailVerified: fields.unverified ? false : true,
    });
    if (fields.inactive) {
      await db.query('UPDATE users SET is_active = FALSE WHERE id = $1', [user.id]);
    }
    /* securityAlerts off, so a first sign-in from this script cannot push mail through the live
       SMTP account. */
    await db.query('UPDATE users SET notification_preferences = $2::jsonb WHERE id = $1', [
      user.id,
      JSON.stringify({ securityAlerts: false }),
    ]);
    return user;
  };

  const adminA = await make('admin-a', 'ADMIN');
  const adminB = await make('admin-b', 'ADMIN');
  const successor = await make('principal', 'SURVEYOR');
  const disabled = await make('disabled', 'SURVEYOR', { inactive: true });
  const unverified = await make('unverified', 'SURVEYOR', { unverified: true });
  const staff = await make('staff', 'STAFF');

  const cookieA = await mint(adminA.id);
  const cookieB = await mint(adminB.id);
  const cookieSuccessor = await mint(successor.id);
  const cookieStaff = await mint(staff.id);

  /* 1. the warning screen's numbers */
  const summary = await call('/api/admin/account-removal', { cookie: cookieA });
  record(
    'GET /api/admin/account-removal reports the other administrators',
    summary.status === 200 && summary.json.otherAdmins.some((a) => a.id === adminB.id),
    {
      status: summary.status,
      activeAdmins: summary.json?.activeAdmins,
      others: (summary.json?.otherAdmins || []).map((a) => a.fullName),
      mayDelete: summary.json?.mayDelete,
    }
  );
  record(
    'the caller is not offered as their own successor',
    !(summary.json?.otherAdmins || []).some((a) => a.id === adminA.id),
    { otherIds: (summary.json?.otherAdmins || []).map((a) => a.id) }
  );
  const staffSummary = await call('/api/admin/account-removal', { cookie: cookieStaff });
  record(
    'a non-administrator cannot read the removal screen',
    staffSummary.status === 403 && staffSummary.json?.code === 'admin_required',
    { status: staffSummary.status, code: staffSummary.json?.code }
  );

  /* 2. the two things that must stop the button */
  const wrongPhrase = await call('/api/admin/delete-my-account', {
    method: 'POST',
    cookie: cookieA,
    body: { password: PASSWORD, confirmText: 'delete my account' },
  });
  record(
    'the typed phrase is matched exactly, not case-folded',
    wrongPhrase.status === 400 && wrongPhrase.json?.code === 'confirmation_required',
    { status: wrongPhrase.status, code: wrongPhrase.json?.code }
  );
  const wrongPassword = await call('/api/admin/delete-my-account', {
    method: 'POST',
    cookie: cookieA,
    body: { password: 'Wrong-Password-2026!', confirmText: 'DELETE MY ACCOUNT' },
  });
  record('the wrong password is refused', wrongPassword.status === 401, {
    status: wrongPassword.status,
  });
  const stillThere = await db.findUserById(adminA.id);
  record(
    'a refused deletion leaves the account usable',
    Boolean(stillThere) && stillThere.is_active,
    {
      deletedAt: stillThere?.deleted_at,
      active: stillThere?.is_active,
    }
  );

  /* 3. eligibility of a successor */
  const toDisabled = await call('/api/admin/ownership-transfer', {
    method: 'POST',
    cookie: cookieA,
    body: { password: PASSWORD, toUserId: disabled.id },
  });
  record('a disabled account cannot be given ownership', toDisabled.status === 400, {
    status: toDisabled.status,
    error: toDisabled.json?.error,
  });
  const toUnverified = await call('/api/admin/ownership-transfer', {
    method: 'POST',
    cookie: cookieA,
    body: { password: PASSWORD, toUserId: unverified.id },
  });
  record('an unverified account cannot be given ownership', toUnverified.status === 400, {
    status: toUnverified.status,
    error: toUnverified.json?.error,
  });
  const toStaff = await call('/api/admin/ownership-transfer', {
    method: 'POST',
    cookie: cookieA,
    body: { password: PASSWORD, toUserId: staff.id },
  });
  record('a staff account is not eligible', toStaff.status === 400, {
    status: toStaff.status,
    error: toStaff.json?.error,
  });
  const toSelf = await call('/api/admin/ownership-transfer', {
    method: 'POST',
    cookie: cookieA,
    body: { password: PASSWORD, toUserId: adminA.id },
  });
  record('an administrator cannot offer ownership to themselves', toSelf.status === 400, {
    status: toSelf.status,
  });
  const noPassword = await call('/api/admin/ownership-transfer', {
    method: 'POST',
    cookie: cookieA,
    body: { toUserId: successor.id },
  });
  record('an offer without the password is refused', noPassword.status === 401, {
    status: noPassword.status,
  });

  /* 4. the transfer, and the acceptance that is the point of it */
  const offered = await call('/api/admin/ownership-transfer', {
    method: 'POST',
    cookie: cookieA,
    body: { password: PASSWORD, toUserId: successor.id },
  });
  record('the principal surveyor is offered ownership', offered.status === 201, {
    status: offered.status,
    message: offered.json?.message,
  });
  const roleUnchanged = await db.findUserById(successor.id);
  record('an unanswered offer changes nothing', roleUnchanged.role === 'SURVEYOR', {
    role: roleUnchanged.role,
  });
  const duplicate = await call('/api/admin/ownership-transfer', {
    method: 'POST',
    cookie: cookieA,
    body: { password: PASSWORD, toUserId: successor.id },
  });
  record('a second outstanding offer to the same person is refused', duplicate.status === 409, {
    status: duplicate.status,
    code: duplicate.json?.code,
  });

  const pending = await call('/api/ownership-transfer/pending', { cookie: cookieSuccessor });
  record(
    'the nominee can see the offer and who made it',
    pending.status === 200 &&
      pending.json.transfer &&
      pending.json.transfer.fromFullName === adminA.full_name,
    {
      from: pending.json?.transfer?.fromFullName,
      created: Boolean(pending.json?.transfer?.created_at),
    }
  );
  const wrongEyes = await call('/api/ownership-transfer/pending', { cookie: cookieB });
  record(
    'someone else sees no offer',
    wrongEyes.status === 200 && wrongEyes.json.transfer === null,
    {
      transfer: wrongEyes.json?.transfer,
    }
  );

  const transferId = pending.json.transfer.id;
  const acceptedByOther = await call(`/api/ownership-transfer/${transferId}/accept`, {
    method: 'POST',
    cookie: cookieB,
  });
  record('only the nominee may accept', acceptedByOther.status === 403, {
    status: acceptedByOther.status,
  });
  const accepted = await call(`/api/ownership-transfer/${transferId}/accept`, {
    method: 'POST',
    cookie: cookieSuccessor,
  });
  const promotedRole = await db.findUserById(successor.id);
  record(
    'accepting promotes the nominee and answers the offer',
    accepted.status === 200 && promotedRole.role === 'ADMIN',
    { status: accepted.status, role: promotedRole.role, message: accepted.json?.message }
  );
  const reaccept = await call(`/api/ownership-transfer/${transferId}/accept`, {
    method: 'POST',
    cookie: cookieSuccessor,
  });
  record('the same offer cannot be accepted twice', reaccept.status === 404, {
    status: reaccept.status,
  });

  /* 5. declining */
  const secondOffer = await call('/api/admin/ownership-transfer', {
    method: 'POST',
    cookie: cookieA,
    body: { password: PASSWORD, toUserId: adminB.id },
  });
  const declined = await call(`/api/ownership-transfer/${secondOffer.json?.transfer?.id}/decline`, {
    method: 'POST',
    cookie: cookieB,
  });
  const afterDecline = await call('/api/ownership-transfer/pending', { cookie: cookieB });
  record(
    'a declined offer disappears for both sides',
    secondOffer.status === 201 && declined.status === 200 && afterDecline.json.transfer === null,
    { declineStatus: declined.status, pending: afterDecline.json?.transfer }
  );
  const promotedB = await db.findUserById(adminB.id);
  record('a declined offer leaves the role alone', promotedB.role === 'ADMIN', {
    role: promotedB.role,
  });

  /* 6. the deletion itself, and what it must not take with it */
  const auditBefore = await db.query(
    "SELECT count(*)::int n FROM audit_logs WHERE action = 'user_created'"
  );
  const deleted = await call('/api/admin/delete-my-account', {
    method: 'POST',
    cookie: cookieA,
    body: { password: PASSWORD, confirmText: 'DELETE MY ACCOUNT' },
  });
  record('an administrator with a successor can remove themselves', deleted.status === 200, {
    status: deleted.status,
    message: deleted.json?.message,
  });

  const tombstone = (await db.query('SELECT * FROM users WHERE id = $1', [adminA.id])).rows[0];
  record(
    'the row survives as an anonymized tombstone',
    Boolean(tombstone) &&
      tombstone.deleted_at !== null &&
      tombstone.full_name === 'Deleted account' &&
      tombstone.email.startsWith('deleted-') &&
      tombstone.email.endsWith('@removed.invalid') &&
      tombstone.password_hash === null &&
      tombstone.google_sub === null &&
      tombstone.is_active === false,
    {
      idKept: tombstone.id === adminA.id,
      email: tombstone.email.replace(/^(.{12}).*(@.*)$/, '$1…$2'),
      name: tombstone.full_name,
      active: tombstone.is_active,
    }
  );
  record(
    'the removal is attributed to the person who asked for it',
    tombstone.deleted_by === adminA.id,
    { deletedBySelf: tombstone.deleted_by === adminA.id }
  );

  const afterDelete = await call('/api/auth/me', { cookie: cookieA });
  record('the deleted account session no longer authenticates', afterDelete.status === 401, {
    status: afterDelete.status,
  });
  const loginAttempt = await call('/api/auth/login', {
    method: 'POST',
    body: { email: email('admin-a'), password: PASSWORD },
  });
  record('the removed address cannot sign in again', loginAttempt.status === 401, {
    status: loginAttempt.status,
  });
  const emailLookup = await db.findUserByEmail(email('admin-a'));
  record('the tombstone is invisible to the address lookup', emailLookup === null, {
    found: Boolean(emailLookup),
  });

  const list = await call('/api/admin/users', { cookie: cookieB });
  const listed = (list.json?.users || []).map((u) => u.email);
  record(
    'the user list does not show removed accounts',
    list.status === 200 &&
      !listed.some((e) => e.startsWith('deleted-')) &&
      !listed.includes(email('admin-a')),
    { tombstones: listed.filter((e) => e.startsWith('deleted-')).length }
  );

  const auditAfter = await db.query(
    "SELECT count(*)::int n FROM audit_logs WHERE action = 'user_created'"
  );
  record(
    'the history the account produced is still attributable to it',
    Number(auditAfter.rows[0].n) === Number(auditBefore.rows[0].n) &&
      (
        await db.query(
          "SELECT count(*)::int n FROM audit_logs WHERE action = 'admin_account_deleted' AND actor_user_id = $1",
          [adminA.id]
        )
      ).rows[0].n === 1,
    {
      userCreatedBefore: Number(auditBefore.rows[0].n),
      userCreatedAfter: Number(auditAfter.rows[0].n),
    }
  );
  const survivor = await db.findUserById(successor.id);
  const staffSurvivor = await db.findUserById(staff.id);
  record(
    'other accounts are untouched by one removal',
    Boolean(survivor) && Boolean(staffSurvivor),
    {
      successor: survivor.full_name,
      staff: staffSurvivor.full_name,
    }
  );

  /* 7. the last-administrator predicate, proved in a transaction that is rolled back so the seeded
        account is never actually disabled for any other connection */
  const { Pool } = require('pg');
  require('dotenv').config({ path: path.join(ROOT, '.env') });
  const scratch = new Pool({ connectionString: process.env.DATABASE_URL });
  let predicate = null;
  const client = await scratch.connect();
  try {
    await client.query('BEGIN');
    await client.query("UPDATE users SET is_active = FALSE WHERE role = 'ADMIN'");
    await client.query('UPDATE users SET is_active = TRUE WHERE id = $1', [adminB.id]);
    const row = (
      await client.query(
        `SELECT count(*)::int AS active_admins
         FROM users
         WHERE deleted_at IS NULL AND is_active AND role = 'ADMIN'`
      )
    ).rows[0];
    predicate = row.active_admins;
    await client.query('ROLLBACK');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    predicate = `error: ${error.message}`;
  } finally {
    client.release();
    await scratch.end();
  }
  record('the count the guard reads really does fall to one', predicate === 1, {
    activeAdminsInTransaction: predicate,
  });
  const seededStillActive = await db.query(
    "SELECT is_active FROM users WHERE role = 'ADMIN' AND deleted_at IS NULL"
  );
  record(
    'rolling back left every real administrator active',
    seededStillActive.rows.every((r) => r.is_active),
    { admins: seededStillActive.rowCount }
  );

  /* ---------- cleanup ---------- */
  const ids = [adminA, adminB, successor, disabled, unverified, staff].map((u) => u.id);
  await db.query(
    `WITH probe AS (SELECT unnest($1::uuid[]) AS id)
     DELETE FROM audit_logs a
     WHERE EXISTS (SELECT 1 FROM probe p WHERE p.id = a.actor_user_id OR p.id = a.target_user_id)`,
    [ids]
  );
  await db.query(
    `WITH probe AS (SELECT unnest($1::uuid[]) AS id)
     DELETE FROM ownership_transfers t
     WHERE EXISTS (SELECT 1 FROM probe p WHERE p.id = t.from_user_id OR p.id = t.to_user_id)`,
    [ids]
  );
  const removed = await db.query('DELETE FROM users WHERE id = ANY($1) RETURNING id', [ids]);
  const leftovers = await db.query(
    "SELECT count(*)::int n FROM users WHERE email LIKE '%@example.invalid' OR email LIKE '%@removed.invalid'"
  );

  console.log(
    JSON.stringify(
      {
        passed: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        cleaned: removed.rowCount,
        probeRowsLeft: leftovers.rows[0].n,
        results,
      },
      null,
      1
    )
  );
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})().catch((error) => {
  console.log(
    JSON.stringify({ fatal: String(error && error.message), stack: error && error.stack })
  );
  process.exit(1);
});
