const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const argon2 = require('argon2');
const { Pool } = require('pg');

const connectionString =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/surveypro';

let pool = null;

const buildPool = (databaseUrl) =>
  new Pool({
    connectionString: databaseUrl,
    ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : false,
  });

const getPool = () => {
  if (!pool) {
    pool = buildPool(connectionString);
  }
  return pool;
};

const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

const num = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const TOKEN_PEPPER =
  process.env.TOKEN_PEPPER ||
  process.env.SESSION_SECRET ||
  process.env.JWT_SECRET ||
  'survey-desk-dev-secret-change-me';

/* One place to change how long a link or a login is valid; every number can be overridden from .env
   so the policies in the settings screen and the tokens actually issued never drift apart. */
const POLICY = {
  sessionHours: num(process.env.SESSION_HOURS, 8),
  rememberMeDays: num(process.env.REMEMBER_ME_DAYS, 30),
  verifyTokenHours: num(process.env.VERIFY_TOKEN_HOURS, 24),
  resetTokenMinutes: num(process.env.RESET_TOKEN_MINUTES, 30),
  maxFailedLogins: num(process.env.MAX_FAILED_LOGINS, 5),
  lockoutMinutes: num(process.env.LOCKOUT_MINUTES, 15),
};

/* Tokens used to be argon2-hashed, which meant every request replayed the whole sessions table
   through a slow hash. A keyed HMAC of a 256-bit random token is collision-free, indexable and
   still reveals nothing about the token if the database leaks, so lookups become a single SELECT. */
const hashToken = (rawToken) =>
  crypto.createHmac('sha256', TOKEN_PEPPER).update(String(rawToken)).digest('hex');

const expiryFrom = (ms) => new Date(Date.now() + ms).toISOString();

async function ensureDatabaseExists() {
  const targetUrl = new URL(connectionString);
  const targetDatabase = (targetUrl.pathname || '/').replace(/^\//, '') || 'postgres';
  const adminUrl = new URL(connectionString);
  adminUrl.pathname = '/postgres';

  const adminPool = buildPool(adminUrl.toString());
  try {
    const exists = await adminPool.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      targetDatabase,
    ]);
    if (exists.rowCount === 0) {
      await adminPool.query(`CREATE DATABASE "${targetDatabase.replace(/"/g, '""')}"`);
    }
  } finally {
    await adminPool.end();
  }
}

async function initializeDatabase() {
  await ensureDatabaseExists();
  const client = await getPool().connect();

  try {
    await client.query(schemaSql);
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub VARCHAR(255)');
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT');
    await client.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub) WHERE google_sub IS NOT NULL'
    );

    const adminEmail = (process.env.INITIAL_ADMIN_EMAIL || '').trim().toLowerCase();
    const adminPassword = (process.env.INITIAL_ADMIN_PASSWORD || '').trim();

    if (adminEmail && adminPassword) {
      const existing = await client.query('SELECT id FROM users WHERE email = $1', [adminEmail]);
      if (existing.rowCount === 0) {
        const hash = await argon2.hash(adminPassword, { type: argon2.argon2id });
        await client.query(
          `INSERT INTO users (full_name, email, password_hash, provider, role, is_verified, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          ['System Administrator', adminEmail, hash, 'email', 'ADMIN', true, true]
        );
      }
    }
  } finally {
    client.release();
  }
}

async function query(text, params = []) {
  return getPool().query(text, params);
}

async function findUserByEmail(email) {
  const normalized = (email || '').trim().toLowerCase();
  if (!normalized) return null;

  /* A removed account keeps its row so the audit trail stays attributable, which means the tombstone
     has to be invisible to every lookup that decides who may sign in. */
  const result = await getPool().query(
    'SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL LIMIT 1',
    [normalized]
  );
  return result.rowCount ? result.rows[0] : null;
}

async function findUserByGoogleSub(googleSub) {
  const normalized = (googleSub || '').trim();
  if (!normalized) return null;

  const result = await getPool().query(
    'SELECT * FROM users WHERE google_sub = $1 AND deleted_at IS NULL LIMIT 1',
    [normalized]
  );
  return result.rowCount ? result.rows[0] : null;
}

async function findUserById(id) {
  if (!id) return null;

  const result = await getPool().query(
    'SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1',
    [id]
  );
  return result.rowCount ? result.rows[0] : null;
}

async function linkGoogleIdentity(
  userId,
  { googleSub, avatarUrl, provider = 'google', isVerified = false }
) {
  if (!userId || !googleSub) return await findUserById(userId);

  const result = await getPool().query(
    `UPDATE users
     SET google_sub = $1,
         avatar_url = COALESCE($2, avatar_url),
         provider = $3,
         is_verified = $4 OR is_verified,
         email_verified_at = CASE WHEN ($4 OR is_verified) AND email_verified_at IS NULL
                                  THEN NOW() ELSE email_verified_at END,
         updated_at = NOW()
     WHERE id = $5
     RETURNING *`,
    [googleSub, avatarUrl || null, provider, Boolean(isVerified), userId]
  );

  return result.rowCount ? result.rows[0] : null;
}

async function createUser({
  fullName,
  firstName,
  lastName,
  email,
  passwordHash,
  provider = 'email',
  role = 'ADMIN',
  googleSub = null,
  avatarUrl = null,
  emailVerified = false,
}) {
  const normalizedEmail = (email || '').trim().toLowerCase();
  const given = (firstName || '').trim();
  const family = (lastName || '').trim();
  /* full_name stays populated from the two fields: it is what the JWT, exports and the autofill of
     "Surveyor Name" already read, so keeping it written here avoids a second name to reconcile. */
  const displayName =
    (fullName || '').trim() ||
    [given, family].filter(Boolean).join(' ') ||
    normalizedEmail.split('@')[0];

  try {
    const result = await getPool().query(
      `INSERT INTO users (full_name, first_name, last_name, email, password_hash, provider, google_sub, avatar_url,
                          role, is_verified, is_active, email_verified_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, TRUE, CASE WHEN $10 THEN NOW() ELSE NULL END)
       RETURNING *`,
      [
        displayName,
        given || null,
        family || null,
        normalizedEmail,
        passwordHash,
        provider,
        googleSub || null,
        avatarUrl || null,
        role,
        Boolean(emailVerified),
      ]
    );
    return result.rows[0];
  } catch (error) {
    /* Two simultaneous submissions of the same email: the UNIQUE index decides, and the loser is
       reported back as a duplicate instead of a 500. */
    if (error && error.code === '23505') return null;
    throw error;
  }
}

async function markEmailVerified(userId) {
  const result = await getPool().query(
    `UPDATE users
     SET is_verified = TRUE, email_verified_at = COALESCE(email_verified_at, NOW()), updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [userId]
  );
  return result.rowCount ? result.rows[0] : null;
}

/* Records the outcome of a login attempt on the account itself so the lockout survives a restart. */
async function registerLoginFailure(userId) {
  const result = await getPool().query(
    `UPDATE users
     SET failed_login_attempts = failed_login_attempts + 1,
         locked_until = CASE WHEN failed_login_attempts + 1 >= $2
                             THEN NOW() + ($3 || ' minutes')::INTERVAL
                             ELSE locked_until END,
         updated_at = NOW()
     WHERE id = $1
     RETURNING failed_login_attempts, locked_until`,
    [userId, POLICY.maxFailedLogins, String(POLICY.lockoutMinutes)]
  );
  return result.rowCount ? result.rows[0] : null;
}

async function clearLoginFailures(userId) {
  await getPool().query(
    'UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = $1',
    [userId]
  );
}

async function updateUserProfile(userId, profile = {}) {
  const updates = [];
  const values = [];

  const fields = {
    full_name: profile.fullName,
    first_name: profile.firstName,
    last_name: profile.lastName,
    phone_number: profile.phoneNumber,
    designation: profile.designation,
    profile_image_url: profile.profileImageUrl,
    profile_image_position: profile.profileImagePosition,
    pending_email: profile.pendingEmail,
    email_change_pending: profile.emailChangePending,
    email_change_requested_at: profile.emailChangeRequestedAt,
    notification_preferences: profile.notificationPreferences,
  };

  Object.entries(fields).forEach(([key, value]) => {
    if (value === undefined) return;
    values.push(value);
    updates.push(`${key} = $${values.length}`);
  });

  if (!updates.length) {
    return await findUserById(userId);
  }

  values.push(userId);
  const result = await getPool().query(
    `UPDATE users
     SET ${updates.join(', ')}, updated_at = NOW()
     WHERE id = $${values.length}
     RETURNING *`,
    values
  );

  return result.rowCount ? result.rows[0] : await findUserById(userId);
}

/* licence_expiry_date is read as text: pg hands a DATE back as a Date at local midnight, and any
   toISOString() on it steps a day backwards east of Greenwich. */
async function getSurveyorProfile(userId) {
  const result = await getPool().query(
    `SELECT user_id,
            licence_number,
            to_char(licence_expiry_date, 'YYYY-MM-DD') AS licence_expiry_date,
            address
     FROM surveyor_profile
     WHERE user_id = $1`,
    [userId]
  );
  return result.rows[0] || null;
}

/* Identity columns (name, email, phone, photo) stay on users; this row holds only the surveying
   credentials, so a licence number never has two places to disagree about. */
async function upsertSurveyorProfile(userId, { licenceNumber, licenceExpiryDate, address } = {}) {
  const result = await getPool().query(
    `INSERT INTO surveyor_profile (user_id, licence_number, licence_expiry_date, address)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id) DO UPDATE
     SET licence_number = EXCLUDED.licence_number,
         licence_expiry_date = EXCLUDED.licence_expiry_date,
         address = EXCLUDED.address,
         updated_at = NOW()
     RETURNING *`,
    [userId, licenceNumber || null, licenceExpiryDate || null, address || null]
  );
  return result.rows[0] || null;
}

async function updatePasswordHash(userId, passwordHash) {
  /* Writing a hash is the moment the account holds a password the member chose, so any outstanding
     order to replace a temporary one is discharged here rather than in each of the three callers. */
  const result = await getPool().query(
    `UPDATE users
     SET password_hash = $1, must_change_password = FALSE, updated_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [passwordHash, userId]
  );
  return result.rowCount ? result.rows[0] : null;
}

async function setAccountNotificationPreferences(userId, preferences = {}) {
  const result = await getPool().query(
    'UPDATE users SET notification_preferences = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
    [JSON.stringify(preferences || {}), userId]
  );
  return result.rowCount ? result.rows[0] : null;
}

async function updateLastLogin(userId, metadata = {}) {
  await getPool().query(
    `UPDATE users
     SET last_login_at = NOW(),
         last_login_ip = COALESCE($1, last_login_ip),
         last_login_user_agent = COALESCE($2, last_login_user_agent),
         updated_at = NOW()
     WHERE id = $3`,
    [metadata.ipAddress || null, metadata.userAgent || null, userId]
  );
}

async function recordLoginActivity({
  userId,
  loginMethod = 'email',
  eventType = 'login',
  status = 'success',
  browserName = null,
  deviceName = null,
  ipAddress = null,
  userAgent = null,
  metadata = {},
}) {
  const result = await getPool().query(
    `INSERT INTO login_activity (user_id, login_method, event_type, status, browser_name, device_name, ip_address, user_agent, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      userId || null,
      loginMethod,
      eventType,
      status,
      browserName,
      deviceName,
      ipAddress,
      userAgent,
      JSON.stringify(metadata || {}),
    ]
  );

  return result.rowCount ? result.rows[0] : null;
}

async function getLoginActivityForUser(userId, limit = 25) {
  const result = await getPool().query(
    `SELECT * FROM login_activity
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, limit]
  );
  return result.rows;
}

/* The Security screen must not show a device that can no longer be used, so expiry and revocation
   are filtered here rather than in the page. */
async function getActiveSessionsForUser(userId, limit = 5) {
  const result = await getPool().query(
    `SELECT * FROM sessions
     WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
     ORDER BY last_active_at DESC NULLS LAST, created_at DESC
     LIMIT $2`,
    [userId, limit]
  );
  return result.rows;
}

/* Returns the most recent still-valid session row for the device, if any, so a login from a new
   browser can be recognised and recorded instead of guessed at. */
async function findLatestActiveSession(userId, metadata = {}) {
  const result = await getPool().query(
    `SELECT * FROM sessions
     WHERE user_id = $1
       AND revoked_at IS NULL
       AND expires_at > NOW()
       AND COALESCE(browser_name, '') = $2
       AND COALESCE(device_name, '') = $3
       AND COALESCE(os_name, '') = $4
     ORDER BY last_active_at DESC NULLS LAST, created_at DESC
     LIMIT 1`,
    [userId, metadata.browserName || null, metadata.deviceName || null, metadata.osName || null]
  );
  return result.rowCount ? result.rows[0] : null;
}

async function revokeSessionById(sessionId, userId, reason = 'manual') {
  /* The owner is part of the WHERE clause: a session id supplied by the page can only ever revoke a
     session that belongs to the signed-in user. */
  const result = await getPool().query(
    `UPDATE sessions
     SET revoked_at = NOW(), revoked_reason = $1, last_active_at = NOW()
     WHERE id = $2 AND user_id = $3 AND revoked_at IS NULL
     RETURNING *`,
    [reason, sessionId, userId]
  );
  return result.rowCount ? result.rows[0] : null;
}

async function revokeOtherSessions(userId, keepSessionId, reason = 'logout_others') {
  const result = await getPool().query(
    `UPDATE sessions
     SET revoked_at = NOW(), revoked_reason = $1, last_active_at = NOW()
     WHERE user_id = $2 AND revoked_at IS NULL AND expires_at > NOW()
       AND ($3::uuid IS NULL OR id <> $3::uuid)
     RETURNING id`,
    [reason, userId, keepSessionId || null]
  );
  return result.rowCount;
}

async function recordAuditLog({ actorUserId, targetUserId, action, details = {} }) {
  const result = await getPool().query(
    `INSERT INTO audit_logs (actor_user_id, target_user_id, action, details)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [actorUserId || null, targetUserId || null, action, JSON.stringify(details || {})]
  );
  return result.rowCount ? result.rows[0] : null;
}

async function getAuditLogs(limit = 50) {
  const result = await getPool().query(
    `SELECT a.*, u1.full_name AS actor_name, u2.full_name AS target_name
     FROM audit_logs a
     LEFT JOIN users u1 ON u1.id = a.actor_user_id
     LEFT JOIN users u2 ON u2.id = a.target_user_id
     ORDER BY a.created_at DESC
     LIMIT $1`,
    [limit]
  );
  return result.rows;
}

async function createVerificationTokenForUser(userId, options = {}) {
  const purpose = options.purpose || 'email_verify';
  const emailAddress = options.emailAddress || null;
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  const expiresAt = expiryFrom(POLICY.verifyTokenHours * 60 * 60 * 1000);

  await getPool().query('DELETE FROM verification_tokens WHERE user_id = $1 AND purpose = $2', [
    userId,
    purpose,
  ]);
  await getPool().query(
    `INSERT INTO verification_tokens (user_id, purpose, email_address, token_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, purpose, emailAddress, tokenHash, expiresAt]
  );

  return { rawToken, expiresAt, purpose, emailAddress };
}

/* Answers 'valid' | 'used' | 'expired' | 'unknown' and marks the row used in the same locked
   transaction, so a link opened twice can only ever be consumed once and the user is told which of
   the two happened instead of a single generic failure. */
async function consumeVerificationToken(rawToken, purpose) {
  const tokenHash = hashToken(rawToken);
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const rows = await client.query(
      `SELECT * FROM verification_tokens
       WHERE token_hash = $1 AND purpose = $2
       ORDER BY created_at DESC
       LIMIT 1
       FOR UPDATE`,
      [tokenHash, purpose]
    );
    if (!rows.rowCount) {
      await client.query('ROLLBACK');
      return { state: 'unknown', row: null };
    }

    const row = rows.rows[0];
    if (row.used_at) {
      await client.query('ROLLBACK');
      return { state: 'used', row };
    }
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      await client.query('ROLLBACK');
      return { state: 'expired', row };
    }

    await client.query('UPDATE verification_tokens SET used_at = NOW() WHERE id = $1', [row.id]);
    await client.query('COMMIT');
    return { state: 'valid', row };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function verifyEmailChangeToken(rawToken) {
  const { state, row } = await consumeVerificationToken(rawToken, 'email_change');
  if (state !== 'valid' || !row.email_address) return null;

  const target = await findUserById(row.user_id);
  if (!target || target.pending_email !== row.email_address) return null;

  await getPool().query(
    `UPDATE users
     SET email = $1,
         pending_email = NULL,
         email_change_pending = FALSE,
         email_change_requested_at = NULL,
         is_verified = TRUE,
         email_verified_at = COALESCE(email_verified_at, NOW()),
         updated_at = NOW()
     WHERE id = $2`,
    [row.email_address, row.user_id]
  );
  return await findUserById(row.user_id);
}

async function createResetTokenForUser(userId) {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  const expiresAt = expiryFrom(POLICY.resetTokenMinutes * 60 * 1000);

  await getPool().query('DELETE FROM reset_tokens WHERE user_id = $1', [userId]);
  await getPool().query(
    `INSERT INTO reset_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, tokenHash, expiresAt]
  );

  return { rawToken, expiresAt };
}

async function consumeResetToken(rawToken) {
  const tokenHash = hashToken(rawToken);
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const rows = await client.query(
      `SELECT * FROM reset_tokens
       WHERE token_hash = $1
       ORDER BY created_at DESC
       LIMIT 1
       FOR UPDATE`,
      [tokenHash]
    );
    if (!rows.rowCount) {
      await client.query('ROLLBACK');
      return { state: 'unknown', row: null };
    }

    const row = rows.rows[0];
    if (row.used_at) {
      await client.query('ROLLBACK');
      return { state: 'used', row };
    }
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      await client.query('ROLLBACK');
      return { state: 'expired', row };
    }

    await client.query('UPDATE reset_tokens SET used_at = NOW() WHERE id = $1', [row.id]);
    await client.query('COMMIT');
    return { state: 'valid', row };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function createSessionForUser(userId, options = {}) {
  const sessionToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(sessionToken);
  const persistent = Boolean(options.persistent);
  const expiresAt = persistent
    ? expiryFrom(POLICY.rememberMeDays * 24 * 60 * 60 * 1000)
    : expiryFrom(POLICY.sessionHours * 60 * 60 * 1000);
  const meta = options.metadata || {};

  await getPool().query(
    `INSERT INTO sessions (user_id, session_token_hash, expires_at, persistent,
                           browser_name, device_name, os_name, ip_address, user_agent,
                           last_active_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
    [
      userId,
      tokenHash,
      expiresAt,
      persistent,
      meta.browserName || null,
      meta.deviceName || null,
      meta.osName || null,
      meta.ipAddress || null,
      meta.userAgent || null,
    ]
  );

  return sessionToken;
}

async function validateSessionToken(rawToken) {
  const tokenHash = hashToken(rawToken);
  const result = await getPool().query(
    `SELECT * FROM sessions
     WHERE session_token_hash = $1 AND revoked_at IS NULL AND expires_at > NOW()
     LIMIT 1`,
    [tokenHash]
  );
  if (!result.rowCount) return null;

  const row = result.rows[0];
  await getPool().query(
    'UPDATE sessions SET last_seen_at = NOW(), last_active_at = NOW() WHERE id = $1',
    [row.id]
  );
  const user = await findUserById(row.user_id);
  return { user, sessionId: row.id, persistent: row.persistent };
}

async function revokeSessionToken(rawToken) {
  const tokenHash = hashToken(rawToken);
  const result = await getPool().query(
    `UPDATE sessions
     SET revoked_at = NOW(), revoked_reason = 'logout', last_active_at = NOW()
     WHERE session_token_hash = $1 AND revoked_at IS NULL
     RETURNING id`,
    [tokenHash]
  );
  return result.rowCount > 0;
}

async function revokeSessionsForUser(userId, reason = 'password_reset') {
  await getPool().query(
    `UPDATE sessions
     SET revoked_at = NOW(), revoked_reason = $2, last_active_at = NOW()
     WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId, reason]
  );
}

/* ---------- permissions ----------

   The catalogue, the role defaults and the individual switches are three tables, but the application
   only ever asks one question: what may this person do right now. resolvePermissions() answers it,
   and every authorization check in server.js goes through that single function so a route and the
   admin screen can never disagree about what a member is allowed. */

async function listPermissionCatalog() {
  const result = await getPool().query(
    `SELECT p.key, p.label, p.group_name AS "group", p.description,
            COALESCE(bool_or(rp.role = 'STAFF'), FALSE) AS staff_default,
            COALESCE(bool_or(rp.role = 'SURVEYOR'), FALSE) AS surveyor_default
     FROM permissions p
     LEFT JOIN role_permissions rp ON rp.permission_key = p.key
     GROUP BY p.key, p.label, p.group_name, p.description
     ORDER BY p.group_name, p.label`
  );
  return result.rows;
}

async function resolvePermissions(userId, role) {
  /* ADMIN is decided by the role itself, not by rows: if the seed ever failed to run, an empty
     role_permissions table would otherwise lock every administrator out of the account screen. */
  if (role === 'ADMIN') {
    const all = await getPool().query('SELECT key FROM permissions ORDER BY group_name, label');
    return all.rows.map((row) => row.key);
  }

  const result = await getPool().query(
    `SELECT p.key,
            COALESCE(up.granted, rp.permission_key IS NOT NULL) AS allowed
     FROM permissions p
     LEFT JOIN role_permissions rp ON rp.permission_key = p.key AND rp.role = $2
     LEFT JOIN user_permissions up ON up.permission_key = p.key AND up.user_id = $1
     WHERE COALESCE(up.granted, rp.permission_key IS NOT NULL)
     ORDER BY p.group_name, p.label`,
    [userId, role]
  );
  return result.rows.map((row) => row.key);
}

async function getPermissionMatrix(userId, role) {
  const result = await getPool().query(
    `SELECT p.key, p.label, p.group_name AS "group", p.description,
            (rp.permission_key IS NOT NULL) AS role_default,
            up.granted AS override,
            COALESCE(up.granted, rp.permission_key IS NOT NULL, FALSE) AS effective
     FROM permissions p
     LEFT JOIN role_permissions rp ON rp.permission_key = p.key AND rp.role = $2
     LEFT JOIN user_permissions up ON up.permission_key = p.key AND up.user_id = $1
     ORDER BY p.group_name, p.label`,
    [userId, role]
  );
  return result.rows;
}

/* The whole matrix is written as one unit. A half-saved set of switches would leave a member who is
   supposed to be restricted holding whatever the previous save left behind, and the admin would see
   a screen that agrees with the database only by accident. */
async function replaceUserPermissionOverrides(userId, changes, actorUserId) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    for (const change of changes) {
      /* A null is not "off" — it is "this person is not an exception", which is what deletes the row
         and lets the role answer again. Three states, not a boolean pretending to know about
         inheritance. */
      if (change.granted === null || change.granted === undefined) {
        await client.query(
          'DELETE FROM user_permissions WHERE user_id = $1 AND permission_key = $2',
          [userId, change.key]
        );
        continue;
      }
      await client.query(
        `INSERT INTO user_permissions (user_id, permission_key, granted, updated_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, permission_key)
         DO UPDATE SET granted = EXCLUDED.granted, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
        [userId, change.key, Boolean(change.granted), actorUserId ?? null]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/* ---------- account removal and administrative ownership ----------

   Removing a person is the one place where the app does not delete the row. Their id is still the
   actor on audit entries, still the opener of staff accounts, and the brief forbids losing any of
   that, so the account is anonymized in place and hidden from every lookup by deleted_at. */

async function softDeleteAccount(userId, actorUserId) {
  const result = await getPool().query(
    `UPDATE users
     SET deleted_at = NOW(),
         deleted_by = $2,
         full_name = 'Deleted account',
         first_name = NULL,
         last_name = NULL,
         email = 'deleted-' || id::text || '@removed.invalid',
         phone_number = NULL,
         designation = NULL,
         admin_remarks = NULL,
         profile_image_url = NULL,
         avatar_url = NULL,
         password_hash = NULL,
         google_sub = NULL,
         notification_preferences = '{}'::jsonb,
         is_active = FALSE,
         must_change_password = FALSE,
         locked_until = NULL,
         failed_login_attempts = 0,
         pending_email = NULL,
         email_change_pending = FALSE,
         updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING id`,
    [userId, actorUserId ?? null]
  );
  return result.rowCount ? result.rows[0] : null;
}

/* Everything the warning screen has to state before the button is allowed to work. */
async function getAccountRemovalSummary() {
  const result = await getPool().query(
    `SELECT
       (SELECT count(*)::int FROM users WHERE deleted_at IS NULL AND is_active) AS active_users,
       (SELECT count(*)::int FROM users
         WHERE deleted_at IS NULL AND is_active AND role = 'ADMIN') AS active_admins,
       (SELECT coalesce(json_agg(json_build_object('id', id, 'fullName', full_name, 'email', email)
                                 ORDER BY created_at), '[]'::json)
          FROM users
         WHERE deleted_at IS NULL AND is_active AND role = 'ADMIN') AS admins`
  );
  return result.rows[0];
}

async function createOwnershipTransfer(fromUserId, toUserId) {
  const result = await getPool().query(
    `INSERT INTO ownership_transfers (from_user_id, to_user_id)
     VALUES ($1, $2)
     RETURNING *`,
    [fromUserId, toUserId]
  );
  return result.rows[0];
}

async function findOwnershipTransferById(id) {
  if (!id) return null;
  const result = await getPool().query('SELECT * FROM ownership_transfers WHERE id = $1 LIMIT 1', [
    id,
  ]);
  return result.rowCount ? result.rows[0] : null;
}

/* The offer a signed-in user has to answer, with the name of the administrator who made it — the
   acceptance screen cannot ask someone to take control of a system on the strength of a uuid. */
async function findPendingOwnershipTransferForUser(userId) {
  const result = await getPool().query(
    `SELECT t.id, t.created_at, t.from_user_id AS "fromUserId",
            u.full_name AS "fromFullName", u.email AS "fromEmail"
     FROM ownership_transfers t
     JOIN users u ON u.id = t.from_user_id
     WHERE t.to_user_id = $1 AND t.status = 'pending' AND u.deleted_at IS NULL
     ORDER BY t.created_at DESC
     LIMIT 1`,
    [userId]
  );
  return result.rowCount ? result.rows[0] : null;
}

async function resolveOwnershipTransfer(id, status) {
  const result = await getPool().query(
    `UPDATE ownership_transfers
     SET status = $2, resolved_at = NOW()
     WHERE id = $1 AND status = 'pending'
     RETURNING *`,
    [id, status]
  );
  return result.rowCount ? result.rows[0] : null;
}

/* ---------------------------------------------------------------------------
   Case registry
   --------------------------------------------------------------------------- */

/* One statement does both the first save and every later one. The WHERE on the conflict branch is
   the whole conflict policy: a push whose modified_at is older than the row already on the server is
   refused rather than applied, so a device that was offline while someone else edited cannot silently
   roll those edits back by coming online again. The caller learns which happened from rowCount — one
   row means the write landed, zero means the server kept its own copy. */
async function upsertCase(record) {
  const result = await getPool().query(
    `INSERT INTO cases (
        id, owner_user_id, module, case_number, policy_number, insurer, insured_name,
        vehicle_registration, chassis_number, engine_number, accident_date, survey_date, stage,
        priority, assigned_surveyor, due_date, created_at, modified_at, synced_at, payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW(),$19::jsonb)
     ON CONFLICT (id) DO UPDATE SET
        module = EXCLUDED.module,
        case_number = EXCLUDED.case_number,
        policy_number = EXCLUDED.policy_number,
        insurer = EXCLUDED.insurer,
        insured_name = EXCLUDED.insured_name,
        vehicle_registration = EXCLUDED.vehicle_registration,
        chassis_number = EXCLUDED.chassis_number,
        engine_number = EXCLUDED.engine_number,
        accident_date = EXCLUDED.accident_date,
        survey_date = EXCLUDED.survey_date,
        stage = EXCLUDED.stage,
        priority = EXCLUDED.priority,
        assigned_surveyor = EXCLUDED.assigned_surveyor,
        due_date = EXCLUDED.due_date,
        created_at = EXCLUDED.created_at,
        modified_at = EXCLUDED.modified_at,
        synced_at = NOW(),
        payload = EXCLUDED.payload
     WHERE EXCLUDED.modified_at >= cases.modified_at
     RETURNING id`,
    [
      record.id,
      record.ownerUserId ?? null,
      record.module || 'motor',
      record.caseNumber ?? null,
      record.policyNumber ?? null,
      record.insurer ?? null,
      record.insuredName ?? null,
      record.vehicleRegistration ?? null,
      record.chassisNumber ?? null,
      record.engineNumber ?? null,
      record.accidentDate ?? null,
      record.surveyDate ?? null,
      record.stage ?? null,
      record.priority ?? null,
      record.assignedSurveyor ?? null,
      record.dueDate ?? null,
      record.createdAt ?? null,
      record.modifiedAt ?? null,
      JSON.stringify(record.payload || {}),
    ]
  );
  return result.rowCount > 0;
}

/* The list is the summary columns unless the caller says otherwise. A device asking what there is
   should not receive every field of every case as a side effect, and the payload is only carried when
   a case is opened or when a sync pull asks for the changed payloads by name. alsoCaseIds widens a
   scoped list for work that was assigned as a task rather than given to the person as a case; it is
   read from the tasks table by the caller, never from anything a client sent. */
async function listCases({ userId, includePayload = false, since = null, alsoCaseIds = [] } = {}) {
  const columns = `id, module, case_number AS "caseNumber", policy_number AS "policyNumber",
    insurer, insured_name AS "insuredName",
    vehicle_registration AS "vehicleRegistration", chassis_number AS "chassisNumber",
    engine_number AS "engineNumber", accident_date AS "accidentDate", survey_date AS "surveyDate",
    stage, priority, assigned_surveyor AS "assignedSurveyor", due_date AS "dueDate",
    owner_user_id AS "ownerUserId", created_at AS "createdAt", modified_at AS "modifiedAt",
    synced_at AS "syncedAt"`;
  const params = [];
  const where = [];
  const ids = Array.isArray(alsoCaseIds) ? alsoCaseIds.filter((id) => typeof id === 'string') : [];
  if (userId) {
    params.push(userId);
    where.push(
      `(owner_user_id = $${params.length} OR lower(coalesce(assigned_surveyor, '')) =
         lower(coalesce((SELECT full_name FROM users WHERE id = $${params.length}), ''))${
           ids.length ? ` OR id = ANY($${params.length + 1}::text[])` : ''
         })`
    );
    if (ids.length) params.push(ids);
  }
  if (since) {
    params.push(since);
    where.push(`modified_at > $${params.length}`);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const result = await getPool().query(
    `SELECT ${columns}${includePayload ? ', payload' : ''} FROM cases ${clause}
     ORDER BY modified_at DESC NULLS LAST`,
    params
  );
  return result.rows;
}

async function findCaseById(id, { includePayload = false } = {}) {
  if (!id) return null;
  const result = await getPool().query(
    `SELECT id, module, case_number AS "caseNumber", policy_number AS "policyNumber",
            insurer, insured_name AS "insuredName",
            vehicle_registration AS "vehicleRegistration", chassis_number AS "chassisNumber",
            engine_number AS "engineNumber", accident_date AS "accidentDate",
            survey_date AS "surveyDate", stage, priority, assigned_surveyor AS "assignedSurveyor",
            due_date AS "dueDate", owner_user_id AS "ownerUserId", created_at AS "createdAt",
            modified_at AS "modifiedAt", synced_at AS "syncedAt"${includePayload ? ', payload' : ''}
     FROM cases WHERE id = $1 LIMIT 1`,
    [id]
  );
  return result.rowCount ? result.rows[0] : null;
}

async function deleteCase(id) {
  const result = await getPool().query('DELETE FROM cases WHERE id = $1 RETURNING id', [id]);
  return result.rowCount > 0;
}

/* §9D duplicate detection. Each key is matched on its normalised form and only rows that actually
   carry that value are compared, so a case with no chassis number never matches another case with no
   chassis number. §9D asks for a policy number and a claim number as separate keys — this form
   records one "Insurance claim no.", so the case number carries both and the reason says so.
   What comes back is candidates for a person to review — nothing here merges or removes anything,
   which is what the brief forbids.

   The seven candidate values are handed to a one-row CTE rather than referenced from the filters
   directly. A filter is only built from the keys that have a value, so a case with an empty engine
   number would leave $5 nowhere in the statement — and a parameter no part of the query mentions has
   no type Postgres can work out, which is an error rather than an unused argument. Named in the CTE
   once, every key is a typed column and the arms read like the columns they compare against. */
async function findSimilarCases(needle) {
  const values = [
    needle.policyNumber,
    needle.caseNumber,
    needle.regNorm,
    needle.chassisNorm,
    needle.engineNorm,
    needle.insurer,
    needle.accidentDate,
  ];
  const has = (index) => {
    const value = values[index];
    return value !== null && value !== undefined && String(value).trim() !== '';
  };

  const arms = [];
  const reasons = [];
  if (has(0)) {
    arms.push(`n.policy <> '' AND lower(coalesce(c.policy_number, '')) = n.policy`);
    reasons.push('policy number');
  }
  if (has(1)) {
    arms.push(`n.claim <> '' AND lower(coalesce(c.case_number, '')) = n.claim`);
    reasons.push('claim number');
  }
  if (has(2)) {
    arms.push(`n.reg <> '' AND c.reg_norm = n.reg`);
    reasons.push('vehicle registration');
  }
  if (has(3)) {
    arms.push(`n.chassis <> '' AND c.chassis_norm = n.chassis`);
    reasons.push('chassis number');
  }
  if (has(4)) {
    arms.push(`n.engine <> '' AND c.engine_norm = n.engine`);
    reasons.push('engine number');
  }
  if (has(5) && has(6)) {
    arms.push(
      `n.insurer <> '' AND n.accident <> '' AND lower(coalesce(c.insurer, '')) = n.insurer
       AND coalesce(c.accident_date, '') = n.accident`
    );
    reasons.push('insurer and accident date');
  }
  if (!arms.length) return [];

  /* The reason column re-tests each arm per row, so it is built from the same predicates as the
     filter — an arm that was not asked for cannot appear as a reason. */
  const reasonSql = arms
    .map((arm, index) => `CASE WHEN ${arm} THEN '${reasons[index]}' END`)
    .join(', ');
  const result = await getPool().query(
    `WITH n AS (
       SELECT lower(coalesce($1, '')) AS policy, lower(coalesce($2, '')) AS claim,
              lower(coalesce($3, '')) AS reg, lower(coalesce($4, '')) AS chassis,
              lower(coalesce($5, '')) AS engine, lower(coalesce($6, '')) AS insurer,
              coalesce($7, '') AS accident
     )
     SELECT c.id, c.case_number AS "caseNumber", c.insurer, c.insured_name AS "insuredName",
            c.vehicle_registration AS "vehicleRegistration", c.policy_number AS "policyNumber",
            c.chassis_number AS "chassisNumber",
            c.engine_number AS "engineNumber", c.accident_date AS "accidentDate", c.stage,
            c.modified_at AS "modifiedAt",
            nullif(concat_ws(', ', ${reasonSql}), '') AS "matchedOn"
     FROM cases c CROSS JOIN n
     WHERE c.id <> $8::text AND (${arms.join(' OR ')})
     ORDER BY c.modified_at DESC NULLS LAST
     LIMIT 25`,
    [...values, needle.id]
  );
  return result.rows;
}

async function countCasesOwnedBy(userId) {
  const result = await getPool().query(
    'SELECT count(*)::int AS n FROM cases WHERE owner_user_id = $1',
    [userId]
  );
  return result.rows[0].n;
}

/* ---------------------------------------------------------------------------
   Assignments and the approval workflow (§5, §6)
   --------------------------------------------------------------------------- */

/* One list, written twice over — the bare form every INSERT…RETURNING and single-table UPDATE needs,
   the aliased form the joined lists need. Both go to the same camelCase names, because the client
   reads a task from either and must not have to know which query produced it. */
const TASK_FIELDS = [
  ['id'],
  ['case_id', 'caseId'],
  ['assignment_type', 'assignmentType'],
  ['instructions'],
  ['priority'],
  ['status'],
  ['assignee_user_id', 'assigneeUserId'],
  ['assigned_by_user_id', 'assignedByUserId'],
  ['assigned_at', 'assignedAt'],
  ['due_date', 'dueDate'],
  ['accepted_at', 'acceptedAt'],
  ['submitted_at', 'submittedAt'],
  ['reviewed_at', 'reviewedAt'],
  ['reviewed_by_user_id', 'reviewedByUserId'],
  ['review_reason', 'reviewReason'],
  ['cancelled_at', 'cancelledAt'],
  ['cancelled_reason', 'cancelledReason'],
  ['created_at', 'createdAt'],
  ['updated_at', 'updatedAt'],
];
const taskSelect = (alias) =>
  TASK_FIELDS.map(
    ([col, as]) => `${alias ? alias + '.' : ''}${col}${as ? ` AS "${as}"` : ''}`
  ).join(', ');

/* Never called on its own except through a transaction that is already writing the move it belongs
   to: a transition and its record are one fact, and a history that can be skipped is a history that
   will one day be missing the step that matters. */
async function addTaskEvent(
  client,
  { taskId, actorUserId, action, fromStatus, toStatus, reason, details }
) {
  await (client || getPool()).query(
    `INSERT INTO task_events (task_id, actor_user_id, action, from_status, to_status, reason, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [
      taskId,
      actorUserId ?? null,
      action,
      fromStatus ?? null,
      toStatus ?? null,
      reason ?? null,
      JSON.stringify(details || {}),
    ]
  );
}

async function findTaskById(id) {
  if (!id) return null;
  const result = await getPool().query(
    `SELECT ${taskSelect()} FROM tasks WHERE id = $1::uuid LIMIT 1`,
    [id]
  );
  return result.rowCount ? result.rows[0] : null;
}

/* A task is always read with the case it belongs to and the two people named on it. The staff list
   and the review queue are both built from one page, and reaching for the case of every row after the
   fact would turn one query into two hundred. */
async function listTasks({
  assigneeUserId = null,
  assignedByUserId = null,
  caseId = null,
  status = null,
  openOnly = false,
  limit = 200,
} = {}) {
  const params = [];
  const where = [];
  const push = (clause, value) => {
    params.push(value);
    /* A function replacer, not a string: in a replacement string a dollar sign is read for backrefs,
       and the placeholder this is building is exactly a dollar sign followed by a number. */
    where.push(clause.replace('@', () => `$${params.length}`));
  };
  if (assigneeUserId) push('t.assignee_user_id = @', assigneeUserId);
  if (assignedByUserId) push('t.assigned_by_user_id = @', assignedByUserId);
  if (caseId) push('t.case_id = @', caseId);
  if (status) push('t.status = @', status);
  if (openOnly) where.push(`t.status NOT IN ('Approved', 'Cancelled')`);

  const result = await getPool().query(
    `SELECT ${taskSelect('t')},
            c.case_number AS "caseNumber", c.insurer, c.insured_name AS "insuredName",
            c.vehicle_registration AS "vehicleRegistration", c.stage AS "caseStage",
            c.due_date AS "caseDueDate",
            assignee.full_name AS "assigneeName",
            assignee.role AS "assigneeRole",
            assigner.full_name AS "assignedByName"
     FROM tasks t
     JOIN cases c ON c.id = t.case_id
     LEFT JOIN users assignee ON assignee.id = t.assignee_user_id
     LEFT JOIN users assigner ON assigner.id = t.assigned_by_user_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY t.assigned_at DESC, t.id
     LIMIT ${Math.max(1, Math.min(500, Number(limit) || 200))}`,
    params
  );
  return result.rows;
}

/* Creating the assignment and recording it are one unit of work. A member with a task nobody ever
   logged is worse than no task at all for §6's "every transition must be recorded", and the unique
   open-task index is expected to raise here — the caller turns that into a 409, which is the honest
   answer to "you already asked this person for that". */
async function createTask(task) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const inserted = await client.query(
      `INSERT INTO tasks (case_id, assignment_type, instructions, priority, status,
                          assignee_user_id, assigned_by_user_id, due_date)
       VALUES ($1, $2, $3, $4, 'Assigned', $5, $6, $7)
       RETURNING ${taskSelect()}`,
      [
        task.caseId,
        task.assignmentType,
        task.instructions ?? null,
        task.priority || 'Normal',
        task.assigneeUserId,
        task.assignedByUserId ?? null,
        task.dueDate ?? null,
      ]
    );
    const row = inserted.rows[0];
    await addTaskEvent(client, {
      taskId: row.id,
      actorUserId: task.assignedByUserId ?? null,
      action: 'assigned',
      fromStatus: null,
      toStatus: 'Assigned',
      reason: null,
      details: { assignmentType: row.assignmentType, assigneeUserId: row.assigneeUserId },
    });
    await client.query('COMMIT');
    return row;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/* The guard on the status is the whole race story. Two reviewers with two phones and one submitted
   task: whichever UPDATE lands first moves it, and the second finds no row at all because the status
   it expected has already gone. The caller gets null and answers 409 rather than writing a decision
   against work that was settled a moment ago. submitted_at is deliberately left alone on a rejection:
   the work was submitted, and erasing that would make a returned task look never to have been done.
   In Progress stamps nothing — a task started and put down is the same row as one never picked up,
   and no part of the brief asks to tell them apart. */
async function moveTaskStatus({
  id,
  from = [],
  to,
  action,
  actorUserId = null,
  reason = null,
  details = {},
}) {
  const reviewed = to === 'Approved' || to === 'Correction Required';
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const moved = await client.query(
      /* The status arrives as text and is cast in one place only. Left to itself Postgres deduces the
         type separately from the assignment (varchar, from the column) and from the comparisons below
         (text) and refuses to prepare the statement at all — 42P08, "inconsistent types deduced for
         parameter $2". */
      `UPDATE tasks
          SET status = $2::text,
              updated_at = NOW(),
              accepted_at = CASE WHEN $2 = 'Accepted' THEN COALESCE(accepted_at, NOW()) ELSE accepted_at END,
              submitted_at = CASE WHEN $2 IN ('Submitted for Review', 'Resubmitted') THEN NOW()
                                  ELSE submitted_at END,
              reviewed_at = CASE WHEN $2 IN ('Approved', 'Correction Required') THEN NOW() ELSE reviewed_at END,
              reviewed_by_user_id = CASE WHEN $2 IN ('Approved', 'Correction Required') THEN $3
                                         ELSE reviewed_by_user_id END,
              review_reason = CASE WHEN $2 IN ('Approved', 'Correction Required') THEN $4
                                   ELSE review_reason END,
              cancelled_at = CASE WHEN $2 = 'Cancelled' THEN NOW() ELSE cancelled_at END,
              cancelled_reason = CASE WHEN $2 = 'Cancelled' THEN $4 ELSE cancelled_reason END
        WHERE id = $1::uuid AND status = ANY($5::text[])
        RETURNING ${taskSelect()}`,
      [id, to, actorUserId, reason, from]
    );
    if (!moved.rowCount) {
      await client.query('ROLLBACK');
      return null;
    }
    const row = moved.rows[0];
    await addTaskEvent(client, {
      taskId: row.id,
      actorUserId,
      /* The verb the caller pressed, because "submitted" and "resubmitted" are different facts about
         the same status word and the history is read by a person. The status name is the fallback. */
      action:
        action ||
        to
          .toLowerCase()
          .replace(/[^a-z]+/g, '_')
          .replace(/^_|_$/g, ''),
      fromStatus: from.length === 1 ? from[0] : null,
      toStatus: to,
      reason,
      details: { expected: from, reviewed, ...details },
    });
    await client.query('COMMIT');
    return row;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/* Handing the same work to somebody else starts it again: the acceptance, the submission and the
   review of the previous member describe a job that was never done by the new one, so they are
   cleared rather than kept as a story about the wrong person. An approved task is not reassignable —
   the work is finished and the record of who finished it is what makes an approval mean anything. */
async function reassignTask({ id, assigneeUserId, actorUserId, reason }) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const moved = await client.query(
      `UPDATE tasks
          SET assignee_user_id = $2,
              assigned_by_user_id = $3,
              status = 'Assigned',
              accepted_at = NULL,
              submitted_at = NULL,
              reviewed_at = NULL,
              reviewed_by_user_id = NULL,
              review_reason = NULL,
              cancelled_at = NULL,
              cancelled_reason = NULL,
              updated_at = NOW()
        WHERE id = $1::uuid AND status <> 'Approved'
        RETURNING ${taskSelect()}`,
      [id, assigneeUserId, actorUserId]
    );
    if (!moved.rowCount) {
      await client.query('ROLLBACK');
      return null;
    }
    const row = moved.rows[0];
    await addTaskEvent(client, {
      taskId: row.id,
      actorUserId,
      action: 'reassigned',
      fromStatus: null,
      toStatus: 'Assigned',
      reason,
      details: { assigneeUserId },
    });
    await client.query('COMMIT');
    return row;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/* Only the four fields §5 lists as changeable after the fact, and only while the task is open. A
   deadline extended after approval would quietly rewrite a finished record; the reviewer's decision
   belongs to the deadline that was on the page when it was made. */
async function updateTaskDetails(id, changes = {}) {
  const fields = {
    assignment_type: changes.assignmentType,
    instructions: changes.instructions,
    priority: changes.priority,
    due_date: changes.dueDate,
  };
  const sets = [];
  const values = [id];
  Object.entries(fields).forEach(([column, value]) => {
    if (value === undefined) return;
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  });
  if (!sets.length) return await findTaskById(id);
  const result = await getPool().query(
    `UPDATE tasks
        SET ${sets.join(', ')}, updated_at = NOW()
      WHERE id = $1::uuid AND status NOT IN ('Approved', 'Cancelled')
      RETURNING ${taskSelect()}`,
    values
  );
  return result.rowCount ? result.rows[0] : null;
}

async function listTaskEvents(taskId) {
  const result = await getPool().query(
    `SELECT e.id, e.task_id AS "taskId", e.actor_user_id AS "actorUserId",
            e.action, e.from_status AS "fromStatus", e.to_status AS "toStatus",
            e.reason, e.details, e.created_at AS "createdAt",
            u.full_name AS "actorName"
     FROM task_events e
     LEFT JOIN users u ON u.id = e.actor_user_id
     WHERE e.task_id = $1::uuid
     ORDER BY e.id`,
    [taskId]
  );
  return result.rows;
}

/* §5's "view assignment history" reads the whole case at once, so the answers to "who was asked for
   the photograph collection, when, and what happened to it" are one query rather than one per task. */
async function listTaskHistoryForCase(caseId, limit = 100) {
  const result = await getPool().query(
    `SELECT e.id, e.task_id AS "taskId", e.actor_user_id AS "actorUserId",
            e.action, e.from_status AS "fromStatus", e.to_status AS "toStatus",
            e.reason, e.created_at AS "createdAt",
            u.full_name AS "actorName",
            t.assignment_type AS "assignmentType",
            t.assignee_user_id AS "assigneeUserId",
            assignee.full_name AS "assigneeName"
     FROM task_events e
     JOIN tasks t ON t.id = e.task_id
     LEFT JOIN users u ON u.id = e.actor_user_id
     LEFT JOIN users assignee ON assignee.id = t.assignee_user_id
     WHERE t.case_id = $1
     ORDER BY e.id DESC
     LIMIT ${Math.max(1, Math.min(500, Number(limit) || 100))}`,
    [caseId]
  );
  return result.rows;
}

/* §2 gives a staff member "their assigned cases", and an assignment they cannot open is not an
   assignment — a photograph collection with no case behind it cannot be photographed. These two are
   how that reaches the case rules: the EXISTS answers it for one case a member is trying to open, the
   id list answers it for the register they are trying to list, where one query per row would not do.
   Only open work counts: a finished task does not keep the door to the file open forever. */
async function isTaskAssigneeOnCase(caseId, userId) {
  if (!caseId || !userId) return false;
  const result = await getPool().query(
    `SELECT 1 FROM tasks
     WHERE case_id = $1 AND assignee_user_id = $2
       AND status NOT IN ('Approved', 'Cancelled')
     LIMIT 1`,
    [caseId, userId]
  );
  return result.rowCount > 0;
}

async function caseIdsAssignedAsTasks(userId) {
  if (!userId) return [];
  const result = await getPool().query(
    `SELECT DISTINCT case_id FROM tasks
     WHERE assignee_user_id = $1 AND status NOT IN ('Approved', 'Cancelled')`,
    [userId]
  );
  return result.rows.map((row) => row.case_id);
}

async function countTasksForUser(userId) {
  const result = await getPool().query(
    `SELECT count(*) FILTER (WHERE status NOT IN ('Approved', 'Cancelled'))::int AS open,
            count(*) FILTER (WHERE status = 'Submitted for Review' OR status = 'Resubmitted')::int AS awaiting_review,
            count(*) FILTER (WHERE status = 'Correction Required')::int AS corrections,
            count(*) FILTER (WHERE status = 'Approved')::int AS approved
     FROM tasks WHERE assignee_user_id = $1`,
    [userId]
  );
  return result.rows[0];
}

const DOCUMENT_FIELDS = [
  ['id', 'id'],
  ['thread_id', 'threadId'],
  ['version', 'version'],
  ['supersedes_document_id', 'supersedesDocumentId'],
  ['is_current', 'isCurrent'],
  ['case_id', 'caseId'],
  ['category'],
  ['original_filename', 'originalFilename'],
  ['mime_type', 'mimeType'],
  /* byte_size is BIGINT, which a driver hands back as a string; the accepted upload is capped well
     inside an int4, and a screen that shows "2.4 MB" needs a number to do the division with. */
  ['byte_size::int', 'byteSize'],
  ['sha256'],
  ['has_file', 'hasFile'],
  ['status'],
  ['report_related', 'reportRelated'],
  ['uploaded_by', 'uploadedBy'],
  ['uploaded_at', 'uploadedAt'],
  ['verified_by', 'verifiedBy'],
  ['verified_at', 'verifiedAt'],
  ['rejected_by', 'rejectedBy'],
  ['rejected_at', 'rejectedAt'],
  ['rejection_reason', 'rejectionReason'],
  ['superseded_at', 'supersededAt'],
  ['created_at', 'createdAt'],
  ['updated_at', 'updatedAt'],
];
const documentSelect = (alias) =>
  DOCUMENT_FIELDS.map(
    ([col, as]) => `${alias ? alias + '.' : ''}${col}${as ? ` AS "${as}"` : ''}`
  ).join(', ');

/* §8: the record of what happened to a document is written in the same unit of work as the change
   itself, for the same reason task transitions are — a history that can be skipped will one day be
   missing the rejection that matters. */
async function addDocumentEvent(
  client,
  { documentId, actorUserId, action, fromStatus, toStatus, reason, details }
) {
  await (client || getPool()).query(
    `INSERT INTO document_events (document_id, actor_user_id, action, from_status, to_status,
                                 reason, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [
      documentId,
      actorUserId ?? null,
      action,
      fromStatus ?? null,
      toStatus ?? null,
      reason ?? null,
      JSON.stringify(details || {}),
    ]
  );
}

/* A new document is the first version of its own thread and a replacement joins the thread it came
   from, so thread_id is supplied rather than defaulted: a column cannot refer to its own row in a
   DEFAULT. Doing it with one statement and one generated id keeps the id and the thread the same value
   and leaves no window in which a row exists that belongs to nothing. The same shape serves both: a
   thread-less insert takes its own id as the thread and version 1. */
/* has_file is never set here: a row is created from metadata alone and the bytes that make it a
   document arrive through attachDocumentFile, which is also what moves it to 'Pending Verification'. */
async function insertDocumentRow(client, document) {
  const result = await client.query(
    `WITH new AS (SELECT gen_random_uuid() AS id)
     INSERT INTO documents (id, thread_id, version, supersedes_document_id, case_id, category,
                            original_filename, mime_type, byte_size, sha256,
                            status, report_related, uploaded_by)
     SELECT id, COALESCE($1, id), COALESCE($2, 1), $3,
            $4, $5, $6, $7, $8, $9, $10, $11, $12
     FROM new
     RETURNING ${documentSelect()}`,
    [
      document.threadId ?? null,
      document.version ?? null,
      document.supersedesDocumentId ?? null,
      document.caseId,
      document.category,
      document.originalFilename,
      document.mimeType ?? null,
      document.byteSize ?? null,
      document.sha256 ?? null,
      document.status,
      document.reportRelated ? true : false,
      document.uploadedBy ?? null,
    ]
  );
  return result.rows[0];
}

async function createDocument(document) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const row = await insertDocumentRow(client, document);
    await addDocumentEvent(client, {
      documentId: row.id,
      actorUserId: row.uploadedBy,
      action: 'registered',
      fromStatus: null,
      toStatus: row.status,
      reason: null,
      details: {
        category: row.category,
        version: row.version,
        filename: row.originalFilename,
        hasFile: Boolean(row.hasFile),
      },
    });
    await client.query('COMMIT');
    return row;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/* A replacement is a new row and a closed one, in that order, in one transaction. The old version
   keeps its bytes, its status and whoever verified it — §8 asks for the previous versions to be
   preserved, not overwritten — and the partial unique index is what makes a second simultaneous
   replacement of the same thread fail rather than produce two current files. */
async function replaceDocument(oldRow, document, actorUserId) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const closed = await client.query(
      `UPDATE documents
          SET is_current = FALSE, superseded_at = NOW(), updated_at = NOW()
        WHERE thread_id = $1::uuid AND is_current
        RETURNING id`,
      [oldRow.threadId]
    );
    if (!closed.rowCount) {
      await client.query('ROLLBACK').catch(() => {});
      return null;
    }
    const row = await insertDocumentRow(client, {
      ...document,
      threadId: oldRow.threadId,
      version: Number(oldRow.version || 1) + 1,
      supersedesDocumentId: oldRow.id,
    });
    await addDocumentEvent(client, {
      documentId: row.id,
      actorUserId,
      action: 'replaced',
      fromStatus: oldRow.status,
      toStatus: row.status,
      reason: null,
      details: {
        previousVersion: oldRow.version,
        previousId: oldRow.id,
        category: row.category,
        version: row.version,
        filename: row.originalFilename,
      },
    });
    await client.query('COMMIT');
    return row;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function findDocumentById(id) {
  if (!id) return null;
  const result = await getPool().query(
    `SELECT ${documentSelect()} FROM documents WHERE id = $1::uuid LIMIT 1`,
    [id]
  );
  return result.rowCount ? result.rows[0] : null;
}

/* Read with the case and the three people named on it, the same way a task is: the verification queue
   and a case's document list both show who uploaded what and who signed it off, and looking each of
   those up after the fact is one query per row. */
async function listDocuments({
  caseId = null,
  caseIds = null,
  status = null,
  category = null,
  uploaderUserId = null,
  currentOnly = true,
  limit = 200,
} = {}) {
  const params = [];
  const where = [];
  const push = (clause, value) => {
    params.push(value);
    where.push(clause.replace('@', () => `$${params.length}`));
  };
  if (caseId) push('d.case_id = @', caseId);
  if (Array.isArray(caseIds)) push('d.case_id = ANY(@::text[])', caseIds);
  if (status) push('d.status = @', status);
  if (category) push('d.category = @', category);
  if (uploaderUserId) push('d.uploaded_by = @', uploaderUserId);
  if (currentOnly) where.push('d.is_current');

  const result = await getPool().query(
    `SELECT ${documentSelect('d')},
            c.case_number AS "caseNumber", c.insurer, c.insured_name AS "insuredName",
            c.vehicle_registration AS "vehicleRegistration", c.stage AS "caseStage",
            uploader.full_name AS "uploaderName",
            verifier.full_name AS "verifierName",
            rejecter.full_name AS "rejecterName"
     FROM documents d
     JOIN cases c ON c.id = d.case_id
     LEFT JOIN users uploader ON uploader.id = d.uploaded_by
     LEFT JOIN users verifier ON verifier.id = d.verified_by
     LEFT JOIN users rejecter ON rejecter.id = d.rejected_by
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY d.uploaded_at DESC, d.id
     LIMIT ${Math.max(1, Math.min(500, Number(limit) || 200))}`,
    params
  );
  return result.rows;
}

async function listDocumentVersions(threadId) {
  const result = await getPool().query(
    `SELECT ${documentSelect('d')},
            uploader.full_name AS "uploaderName",
            verifier.full_name AS "verifierName",
            rejecter.full_name AS "rejecterName"
     FROM documents d
     LEFT JOIN users uploader ON uploader.id = d.uploaded_by
     LEFT JOIN users verifier ON verifier.id = d.verified_by
     LEFT JOIN users rejecter ON rejecter.id = d.rejected_by
     WHERE d.thread_id = $1::uuid
     ORDER BY d.version DESC`,
    [threadId]
  );
  return result.rows;
}

async function listDocumentEvents(documentId) {
  const result = await getPool().query(
    `SELECT e.id, e.document_id AS "documentId", e.actor_user_id AS "actorUserId",
            e.action, e.from_status AS "fromStatus", e.to_status AS "toStatus",
            e.reason, e.details, e.created_at AS "createdAt",
            u.full_name AS "actorName"
     FROM document_events e
     LEFT JOIN users u ON u.id = e.actor_user_id
     WHERE e.document_id = $1::uuid
     ORDER BY e.id`,
    [documentId]
  );
  return result.rows;
}

/* The file and the record of the file are separate facts, and the offline path makes that real: a
   phone on a hill with no signal can register what it photographed, and the bytes arrive later. Only
   the first landing changes the status, because a document that has already been sent for verification
   must not be silently pulled back a step by a retried upload. The status is read inside the
   transaction so the history records what it actually was, not what the caller assumed. */
async function attachDocumentFile(id, { actorUserId, mimeType, byteSize, sha256 }) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const before = await client.query(
      `SELECT status FROM documents WHERE id = $1::uuid FOR UPDATE`,
      [id]
    );
    if (!before.rowCount) {
      await client.query('ROLLBACK').catch(() => {});
      return null;
    }
    const updated = await client.query(
      `UPDATE documents
          SET mime_type = $2, byte_size = $3, sha256 = $4, has_file = TRUE,
              status = CASE WHEN status = 'Uploaded' THEN 'Pending Verification' ELSE status END,
              updated_at = NOW()
        WHERE id = $1::uuid
        RETURNING ${documentSelect()}`,
      [id, mimeType, byteSize, sha256]
    );
    const row = updated.rows[0];
    await addDocumentEvent(client, {
      documentId: row.id,
      actorUserId,
      action: 'file_attached',
      fromStatus: before.rows[0].status,
      toStatus: row.status,
      reason: null,
      details: { filename: row.originalFilename, byteSize: row.byteSize, sha256: row.sha256 },
    });
    await client.query('COMMIT');
    return row;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/* fromStatus is part of the WHERE clause, exactly as a task move guards its own status: two reviewers
   who both press verify on the same scan get one Verified row and one honest 409, not two decisions
   and one history that cannot say which was first. */
async function moveDocumentStatus({ id, actorUserId, fromStatuses, toStatus, reason }) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const before = await client.query(
      `SELECT status FROM documents WHERE id = $1::uuid FOR UPDATE`,
      [id]
    );
    const guards = [];
    const values = [id];
    (fromStatuses || []).forEach((status) => {
      values.push(status);
      guards.push(`status = $${values.length}`);
    });
    values.push(actorUserId ?? null);
    const actorParam = `$${values.length}::uuid`;
    /* Every parameter has to appear somewhere in the statement: Postgres cannot work out the type of
       one the SQL never mentions, which is why a reason is bound only on the decisions that record
       one. A verify says nothing, so it takes no reason slot. */
    const decided = toStatus === 'Rejected' || toStatus === 'Replacement Required';
    let reasonParam = null;
    if (decided) {
      values.push(reason ?? null);
      reasonParam = `$${values.length}::text`;
    }
    values.push(toStatus);
    const setters = [`status = $${values.length}`, 'updated_at = NOW()'];
    if (toStatus === 'Verified') setters.push(`verified_by = ${actorParam}`, 'verified_at = NOW()');
    /* A document that has been sent back is no longer verified, and leaving the earlier stamp on it
       would let the row claim both at once. */
    if (decided) {
      setters.push(
        `rejected_by = ${actorParam}`,
        'rejected_at = NOW()',
        `rejection_reason = ${reasonParam}`,
        'verified_by = NULL',
        'verified_at = NULL'
      );
    }
    const updated = await client.query(
      `UPDATE documents SET ${setters.join(', ')}
        WHERE id = $1::uuid
          ${guards.length ? `AND (${guards.join(' OR ')})` : ''}
          AND is_current
        RETURNING ${documentSelect()}`,
      values
    );
    const row = updated.rows[0];
    if (!row) {
      await client.query('ROLLBACK').catch(() => {});
      return null;
    }
    await addDocumentEvent(client, {
      documentId: row.id,
      actorUserId,
      action:
        toStatus === 'Verified'
          ? 'verified'
          : toStatus === 'Replacement Required'
            ? 'replacement_requested'
            : 'rejected',
      fromStatus: before.rowCount ? before.rows[0].status : null,
      toStatus,
      reason,
      details: {},
    });
    await client.query('COMMIT');
    return row;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/* A document that is filed under the wrong category is still the same file, so this is a change to
   the row rather than a new version — and it is still history. The before values are read in the same
   transaction and written into the event, so "why does the bill sit under Reports" has an answer with
   a name and a time attached. */
async function updateDocumentDetails(id, actorUserId, changes = {}) {
  const columns = {
    category: ['category', changes.category],
    original_filename: ['originalFilename', changes.originalFilename],
    report_related: ['reportRelated', changes.reportRelated],
  };
  const sets = [];
  const values = [id];
  const asked = [];
  Object.entries(columns).forEach(([column, [key, value]]) => {
    if (value === undefined) return;
    values.push(value);
    sets.push(`${column} = $${values.length}`);
    asked.push([key, column]);
  });
  if (!sets.length) return await findDocumentById(id);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const before = await client.query(
      `SELECT category, original_filename AS "originalFilename",
              report_related AS "reportRelated"
         FROM documents WHERE id = $1::uuid FOR UPDATE`,
      [id]
    );
    if (!before.rowCount) {
      await client.query('ROLLBACK').catch(() => {});
      return null;
    }
    const updated = await client.query(
      `UPDATE documents SET ${sets.join(', ')}, updated_at = NOW()
        WHERE id = $1::uuid AND is_current
        RETURNING ${documentSelect()}`,
      values
    );
    const row = updated.rows[0];
    const changed = asked
      .filter(([key]) => String(before.rows[0][key]) !== String(row[key]))
      .map(([key]) => key);
    await addDocumentEvent(client, {
      documentId: row.id,
      actorUserId,
      action: 'details_changed',
      fromStatus: row.status,
      toStatus: row.status,
      reason: null,
      details: {
        fields: changed,
        from: changed.reduce((acc, key) => ({ ...acc, [key]: before.rows[0][key] }), {}),
        to: changed.reduce((acc, key) => ({ ...acc, [key]: row[key] }), {}),
      },
    });
    await client.query('COMMIT');
    return row;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function deleteDocumentRow(id) {
  const result = await getPool().query('DELETE FROM documents WHERE id = $1::uuid RETURNING id', [
    id,
  ]);
  return result.rowCount > 0;
}

/* §8's rejection notice and the verification queue both need the number of documents waiting, and
   §13 will need what one member has uploaded. Counting a queue in the browser would mean fetching
   every row to learn its length, and counting every document in the system when the caller can only
   see three cases would answer a question nobody asked. */
async function countDocumentsByStatus({ caseIds = null, uploaderUserId = null } = {}) {
  const params = [];
  const where = ['is_current'];
  if (Array.isArray(caseIds)) {
    params.push(caseIds);
    where.push(`case_id = ANY($${params.length}::text[])`);
  }
  if (uploaderUserId) {
    params.push(uploaderUserId);
    where.push(`uploaded_by = $${params.length}`);
  }
  const result = await getPool().query(
    `SELECT status, count(*)::int AS count FROM documents WHERE ${where.join(' AND ')}
     GROUP BY status`,
    params
  );
  const counts = {};
  result.rows.forEach((row) => {
    counts[row.status] = row.count;
  });
  return counts;
}

/* ────────────────────────────────────────────────────────────────────────────────────────────
   §11 case comments and §12 notifications
   ──────────────────────────────────────────────────────────────────────────────────────────── */

const CASE_COMMENT_FIELDS = [
  ['id'],
  ['case_id', 'caseId'],
  ['author_user_id', 'authorUserId'],
  ['parent_comment_id', 'parentCommentId'],
  ['body'],
  ['mentions'],
  ['document_id', 'documentId'],
  ['is_instruction', 'isInstruction'],
  ['created_at', 'createdAt'],
];
const caseCommentSelect = (alias) =>
  CASE_COMMENT_FIELDS.map(
    ([col, as]) => `${alias ? alias + '.' : ''}${col}${as ? ` AS "${as}"` : ''}`
  ).join(', ');

/* Who a body's @tokens mean, decided by the database rather than by the browser that typed them: a
   token that matches exactly one account becomes a notification, and a token that matches nobody — or
   two people — is reported back so the writer can see that nobody was told. Names are matched case
   and space insensitively because people type "@kiran shrestha" when the register says
   "Kiran Shrestha". */
async function resolveMentions(tokens) {
  const wanted = [...new Set((tokens || []).map((t) => String(t).toLowerCase()).filter(Boolean))];
  if (!wanted.length) return { resolved: [], unresolved: [] };
  const result = await getPool().query(
    `SELECT id, full_name AS "fullName", email,
            lower(coalesce(split_part(email, '@', 1), '')) AS local_part,
            lower(regexp_replace(coalesce(full_name, ''), '\\s+', ' ', 'g')) AS name_key
     FROM users
     WHERE is_active
       AND (lower(coalesce(split_part(email, '@', 1), '')) = ANY($1::text[])
            OR lower(regexp_replace(coalesce(full_name, ''), '\\s+', ' ', 'g')) = ANY($1::text[])
            OR id::text = ANY($1::text[]))`,
    [wanted]
  );
  const byToken = new Map();
  result.rows.forEach((row) => {
    [row.local_part, row.name_key, row.id].forEach((key) => {
      if (wanted.includes(key)) {
        const list = byToken.get(key) || [];
        if (!list.some((x) => x.id === row.id)) list.push(row);
        byToken.set(key, list);
      }
    });
  });
  const resolved = [];
  const unresolved = [];
  const seen = new Set();
  wanted.forEach((token) => {
    const matches = byToken.get(token) || [];
    if (matches.length !== 1) {
      if (!matches.length) unresolved.push(token);
      return;
    }
    if (!seen.has(matches[0].id)) {
      seen.add(matches[0].id);
      resolved.push({ id: matches[0].id, fullName: matches[0].fullName, token });
    }
  });
  return { resolved, unresolved };
}

/* One insert, no policy in it: who is told, what the sentence says and which case, task, document or
   comment it is about. Every event that owes a notice calls this, so §12's twelve bullets cannot
   become twelve slightly different wordings written at twelve call sites. */
async function insertNotification(
  client,
  { userId, actorUserId, type, message, caseId, taskId, documentId, commentId }
) {
  if (!userId || !type || !String(message || '').trim()) return null;
  const result = await (client || getPool()).query(
    `INSERT INTO notifications (user_id, actor_user_id, type, message, case_id, task_id,
                               document_id, comment_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      userId,
      actorUserId ?? null,
      type,
      String(message).trim().slice(0, 500),
      caseId ?? null,
      taskId ?? null,
      documentId ?? null,
      commentId ?? null,
    ]
  );
  return result.rows[0].id;
}

async function insertNotifications(client, rows) {
  const ids = [];
  for (const row of rows || []) {
    const id = await insertNotification(client, row);
    if (id) ids.push(id);
  }
  return ids;
}

const NOTIFICATION_FIELDS = [
  ['id'],
  ['user_id', 'userId'],
  ['actor_user_id', 'actorUserId'],
  ['type'],
  ['message'],
  ['case_id', 'caseId'],
  ['task_id', 'taskId'],
  ['document_id', 'documentId'],
  ['comment_id', 'commentId'],
  ['read_at', 'readAt'],
  ['created_at', 'createdAt'],
];

/* The actor's own name travels with the row: "Biplab asked for a replacement" is the sentence a
   notification has to become, and a bell that says only "a replacement was asked for" makes the
   reader open the case to find out who to answer. */
async function listNotifications(userId, { unreadOnly = false, limit = 40 } = {}) {
  const params = [userId];
  const where = ['user_id = $1'];
  if (unreadOnly) where.push('read_at IS NULL');
  params.push(Math.min(Math.max(Number(limit) || 40, 1), 200));
  const result = await getPool().query(
    `SELECT ${NOTIFICATION_FIELDS.map((f) => `n.${f[0]}${f[1] ? ` AS "${f[1]}"` : ''}`).join(', ')},
            coalesce(a.full_name, 'Someone') AS "actorName"
     FROM notifications n
     LEFT JOIN users a ON a.id = n.actor_user_id
     WHERE ${where.join(' AND ')}
     ORDER BY n.created_at DESC, n.id DESC
     LIMIT $${params.length}`,
    params
  );
  return result.rows;
}

async function unreadNotificationCount(userId) {
  const result = await getPool().query(
    `SELECT count(*)::int AS unread, max(created_at) AS latest
     FROM notifications WHERE user_id = $1 AND read_at IS NULL`,
    [userId]
  );
  return result.rows[0];
}

/* Marking one is scoped by the recipient id in the WHERE clause, so a guess at somebody else's
   notification id changes nothing rather than reading their inbox for them. */
async function markNotificationRead(userId, id) {
  const result = await getPool().query(
    `UPDATE notifications SET read_at = NOW()
     WHERE id = $1 AND user_id = $2 AND read_at IS NULL
     RETURNING id`,
    [id, userId]
  );
  return result.rowCount > 0;
}

async function markAllNotificationsRead(userId) {
  const result = await getPool().query(
    `UPDATE notifications SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL`,
    [userId]
  );
  return result.rowCount;
}

async function insertCaseComment({
  caseId,
  authorUserId,
  parentCommentId = null,
  body,
  mentions = [],
  documentId = null,
  isInstruction = false,
}) {
  const result = await getPool().query(
    `INSERT INTO case_comments (case_id, author_user_id, parent_comment_id, body, mentions,
                               document_id, is_instruction)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
     RETURNING ${caseCommentSelect()}`,
    [
      caseId,
      authorUserId ?? null,
      parentCommentId,
      String(body || '').trim(),
      JSON.stringify(mentions || []),
      documentId,
      Boolean(isInstruction),
    ]
  );
  return result.rows[0];
}

/* The whole thread in one read, oldest first, with the author's name and role and whether this
   particular row is newer than the reader's own marker — which is what makes "unread" mean something
   different per person instead of one flag the first reader clears for everyone. */
async function listCaseComments(caseId, forUserId = null) {
  const result = await getPool().query(
    `SELECT ${caseCommentSelect('c')},
            coalesce(u.full_name, 'A former member') AS "authorName",
            coalesce(u.role, '') AS "authorRole",
            d.original_filename AS "documentFilename",
            d.status AS "documentStatus",
            CASE WHEN $2::uuid IS NULL THEN FALSE
                 WHEN c.author_user_id = $2 THEN FALSE
                 ELSE r.read_at IS NULL OR c.created_at > r.read_at END AS unread
     FROM case_comments c
     LEFT JOIN users u ON u.id = c.author_user_id
     LEFT JOIN documents d ON d.id = c.document_id
     LEFT JOIN case_comment_reads r ON r.case_id = c.case_id AND r.user_id = $2
     WHERE c.case_id = $1
     ORDER BY c.created_at, c.id`,
    [caseId, forUserId]
  );
  return result.rows;
}

async function findCaseCommentById(id) {
  const result = await getPool().query(
    `SELECT ${caseCommentSelect()} FROM case_comments WHERE id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

async function markCaseCommentsRead(userId, caseId) {
  await getPool().query(
    `INSERT INTO case_comment_reads (user_id, case_id, read_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (user_id, case_id) DO UPDATE SET read_at = NOW()`,
    [userId, caseId]
  );
  return true;
}

/* How many replies each case is holding for this person, in one query, so a case list can mark the
   cases with news without fetching every thread. */
async function caseCommentUnreadCounts(userId, caseIds) {
  if (!Array.isArray(caseIds) || !caseIds.length) return {};
  const result = await getPool().query(
    `SELECT c.case_id AS "caseId", count(*)::int AS unread
     FROM case_comments c
     LEFT JOIN case_comment_reads r ON r.case_id = c.case_id AND r.user_id = $1
     WHERE c.case_id = ANY($2::text[]) AND c.author_user_id IS DISTINCT FROM $1
       AND (r.read_at IS NULL OR c.created_at > r.read_at)
     GROUP BY c.case_id`,
    [userId, caseIds]
  );
  const counts = {};
  result.rows.forEach((row) => {
    counts[row.caseId] = row.unread;
  });
  return counts;
}

/* §12's two deadline notices are the only ones the calendar rather than a button produces. The rule is
   read afresh on every inbox call — a due date moved yesterday must not leave "due tomorrow" behind —
   but the notice itself is stored, so it can be marked read like every other entry in the bell. What
   keeps a still-overdue case from refilling the inbox is the exclusion in the server, not a flag here.

   A task's deadline is the one an administrator set in §5, and it is the only deadline this app
   promises to hit, so an open task names the work and the case; the case's own due date is the
   follow-up date from the case record and belongs to whoever owns the file. Both columns are text —
   §5 stores a date as the field wrote it, including a Bikram Sambat string that is not a valid
   Gregorian date — so only a value shaped like a Gregorian calendar date is compared, and anything
   else is left out rather than coerced. */
async function deadlineRows(userId, { soonDays = 3 } = {}) {
  const result = await getPool().query(
    `SELECT d."caseId", d."taskId", d."subject", d."caseNumber", d."dueDate", d.type,
            (to_date(d."dueDate", 'YYYY-MM-DD') - CURRENT_DATE)::int AS days
     FROM (
       SELECT t.case_id AS "caseId", t.id AS "taskId", t.assignment_type AS "subject",
              c.case_number AS "caseNumber", t.due_date AS "dueDate",
              CASE WHEN to_date(t.due_date, 'YYYY-MM-DD') < CURRENT_DATE
                   THEN 'deadline_missed' ELSE 'deadline_approaching' END AS type
       FROM tasks t
       JOIN cases c ON c.id = t.case_id
       WHERE t.assignee_user_id = $1
         AND t.status NOT IN ('Approved', 'Cancelled')
         AND t.due_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       UNION ALL
       SELECT c.id, NULL, c.case_number, c.case_number, c.due_date,
              CASE WHEN to_date(c.due_date, 'YYYY-MM-DD') < CURRENT_DATE
                   THEN 'deadline_missed' ELSE 'deadline_approaching' END
       FROM cases c
       WHERE c.owner_user_id = $1
         AND c.due_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     ) d
     WHERE to_date(d."dueDate", 'YYYY-MM-DD') <= CURRENT_DATE + ($2::int * 1)
     ORDER BY d."dueDate"`,
    [userId, Math.max(Number(soonDays) || 3, 0)]
  );
  return result.rows;
}

/* Which deadlines this person has already been told about and answered. Only read rows count as
   answered: an unread one is still on the bell and is replaced below rather than added to. The window
   is what turns a dismissed deadline into a reminder instead of either silence or a drumbeat — a date
   nobody acted on is raised again the next day, not the next minute. */
async function recentNoticeKeys(userId, { types = [], withinDays = 1 } = {}) {
  const since = new Date(Date.now() - Math.max(Number(withinDays) || 1, 0) * 86400000);
  const result = await getPool().query(
    `SELECT type, coalesce(case_id, '') AS "caseId", coalesce(task_id::text, '') AS "taskId"
     FROM notifications
     WHERE user_id = $1 AND read_at IS NOT NULL AND created_at >= $2
       AND type = ANY($3::text[])`,
    [userId, since, types]
  );
  return result.rows.map((row) => `${row.type}|${row.caseId}|${row.taskId}`);
}

/* The notices the calendar is currently holding unread, with their words. The comparison the server
   makes is between the sentence stored and the sentence the calendar produces now, because a due date
   lives in the message rather than in a column of its own — which is the only way a date that moved
   from "in 2 days" to "4 days overdue" is seen as the change it is. */
async function openDeadlineNotices(userId, types) {
  const result = await getPool().query(
    `SELECT id, type, coalesce(case_id, '') AS "caseId", coalesce(task_id::text, '') AS "taskId", message
     FROM notifications
     WHERE user_id = $1 AND read_at IS NULL AND type = ANY($2::text[])`,
    [userId, types]
  );
  return result.rows;
}

/* Removing the notices the calendar no longer produces. Both the recipient and the read marker are in
   the WHERE clause, so a superseded entry can only ever be taken off the bell it is on, and a notice
   somebody has already read stays where they left it — it is the record of what they were told, not a
   rendering. */
async function deleteNotifications(userId, ids) {
  if (!Array.isArray(ids) || !ids.length) return 0;
  const result = await getPool().query(
    `DELETE FROM notifications
     WHERE user_id = $1 AND read_at IS NULL AND id = ANY($2::uuid[])`,
    [userId, ids]
  );
  return result.rowCount;
}

/* Who is entitled to see what is said about a case, which is the §5 case rule read from the other
   side: the file is about its owner, the people holding work on it, and the administrators who answer
   for everything in it. A thread cannot be private to its author — §11's comments are "visible to the
   rest of the team", which is what the add_case_comments permission in the catalogue says — so the
   audience of a notification is this list and nothing else. */
async function caseCommentAudience(caseId) {
  const result = await getPool().query(
    `SELECT c.owner_user_id AS "userId" FROM cases c WHERE c.id = $1
     UNION
     SELECT t.assignee_user_id FROM tasks t
     WHERE t.case_id = $1 AND t.assignee_user_id IS NOT NULL
       AND t.status NOT IN ('Approved', 'Cancelled')
     UNION
     SELECT u.id FROM users u WHERE u.is_active AND u.deleted_at IS NULL AND upper(u.role) = 'ADMIN'`,
    [caseId]
  );
  return result.rows.map((row) => row.userId).filter(Boolean);
}

async function listThirdPartyParties({ caseId = null, q = '' } = {}) {
  const filters = [];
  const params = [];

  if (caseId) {
    params.push(caseId);
    filters.push(`tp.case_id = $${params.length}`);
  }

  if (q && String(q).trim()) {
    const term = `%${String(q).trim()}%`;
    params.push(term, term, term);
    filters.push(
      `(tp.name ILIKE $${params.length - 2} OR tp.contact_number ILIKE $${params.length - 1} OR tp.address ILIKE $${params.length})`
    );
  }

  const where = filters.length ? ` WHERE ${filters.join(' AND ')}` : '';
  const result = await getPool().query(
    `SELECT tp.id, tp.case_id AS "caseId", tp.party_type AS "partyType", tp.name, tp.contact_number AS "contactNumber",
            tp.address, tp.email, tp.citizenship_number AS "citizenshipNumber",
            tp.pan_vat_number AS "panVatNumber", tp.created_at AS "createdAt", tp.updated_at AS "updatedAt"
     FROM third_party_parties tp${where}
     ORDER BY tp.updated_at DESC, tp.name ASC`,
    params
  );

  const rows = result.rows;
  for (const row of rows) {
    const rolesResult = await getPool().query(
      'SELECT role FROM third_party_party_roles WHERE party_id = $1 ORDER BY role',
      [row.id]
    );
    row.roles = rolesResult.rows.map((item) => item.role);
  }
  return rows;
}

async function upsertThirdPartyParty(payload = {}) {
  if (!payload || !payload.caseId || !String(payload.name || '').trim()) {
    throw new Error('A case and party name are required.');
  }

  const id = payload.id || (await getPool().query('SELECT gen_random_uuid() AS id')).rows[0].id;
  const name = String(payload.name || '').trim();
  const contactNumber = payload.contactNumber ? String(payload.contactNumber).trim() : null;
  const email = payload.email ? String(payload.email).trim() : null;
  const partyType = payload.partyType || 'Individual';

  const result = await getPool().query(
    `INSERT INTO third_party_parties (id, case_id, party_type, name, contact_number, address, email,
       citizenship_number, pan_vat_number, created_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
     ON CONFLICT (id) DO UPDATE SET
       case_id = EXCLUDED.case_id,
       party_type = EXCLUDED.party_type,
       name = EXCLUDED.name,
       contact_number = EXCLUDED.contact_number,
       address = EXCLUDED.address,
       email = EXCLUDED.email,
       citizenship_number = EXCLUDED.citizenship_number,
       pan_vat_number = EXCLUDED.pan_vat_number,
       updated_at = NOW()
     RETURNING *`,
    [
      id,
      payload.caseId,
      partyType,
      name,
      contactNumber,
      payload.address ? String(payload.address).trim() : null,
      email,
      payload.citizenshipNumber ? String(payload.citizenshipNumber).trim() : null,
      payload.panVatNumber ? String(payload.panVatNumber).trim() : null,
      payload.createdBy || null,
    ]
  );

  const row = result.rows[0];
  await getPool().query(
    'DELETE FROM third_party_party_roles WHERE party_id = $1 AND case_id = $2',
    [row.id, row.case_id]
  );

  const roles = Array.isArray(payload.roles) ? payload.roles.filter(Boolean) : [];
  if (roles.length) {
    const values = roles.map((role, index) => `($1, $2, $${index + 3}, NOW())`).join(', ');
    await getPool().query(
      `INSERT INTO third_party_party_roles (party_id, case_id, role, created_at) VALUES ${values}`,
      [row.id, row.case_id, ...roles]
    );
  }

  const saved = {
    id: row.id,
    caseId: row.case_id,
    partyType: row.party_type,
    name: row.name,
    contactNumber: row.contact_number,
    address: row.address,
    email: row.email,
    citizenshipNumber: row.citizenship_number,
    panVatNumber: row.pan_vat_number,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    roles,
  };
  return saved;
}

async function getThirdPartyDashboard({ caseId = null } = {}) {
  const base = {};
  const partyResult = await getPool().query(
    'SELECT COUNT(*)::int AS count FROM third_party_parties' +
      (caseId ? ' WHERE case_id = $1' : ''),
    caseId ? [caseId] : []
  );
  base.totalParties = Number(partyResult.rows[0].count || 0);

  const claimResult = await getPool().query(
    'SELECT COUNT(*)::int AS count, COALESCE(SUM(claimed_amount), 0)::numeric AS "totalClaimedAmount" FROM third_party_claims' +
      (caseId ? ' WHERE case_id = $1' : ''),
    caseId ? [caseId] : []
  );
  const claimRow = claimResult.rows[0] || {};
  base.totalClaims = Number(claimRow.count || 0);
  base.totalClaimedAmount = Number(claimRow.totalClaimedAmount || 0);

  const assessmentResult = await getPool().query(
    `SELECT COALESCE(SUM(CASE WHEN assessment_type IS NOT NULL THEN assessed_total ELSE 0 END), 0)::numeric AS "totalAssessedAmount",
            COUNT(*) FILTER (WHERE workflow_status IN ('Inspection Pending', 'Under Assessment', 'Assessment Completed'))::int AS "pendingAssessments",
            COUNT(*) FILTER (WHERE workflow_status = 'Report Submitted')::int AS "reportsPending",
            COUNT(*) FILTER (WHERE workflow_status = 'Rectification Required')::int AS "rectificationPending"
     FROM third_party_claims` + (caseId ? ' WHERE case_id = $1' : ''),
    caseId ? [caseId] : []
  );
  const assessmentRow = assessmentResult.rows[0] || {};
  base.totalAssessedAmount = Number(assessmentRow.totalAssessedAmount || 0);
  base.pendingAssessments = Number(assessmentRow.pendingAssessments || 0);
  base.reportsPending = Number(assessmentRow.reportsPending || 0);
  base.rectificationPending = Number(assessmentRow.rectificationPending || 0);

  const inspectionResult = await getPool().query(
    'SELECT COUNT(*)::int AS count FROM third_party_claim_inspections WHERE inspection_status = $1' +
      (caseId ? ' AND claim_id IN (SELECT id FROM third_party_claims WHERE case_id = $2)' : ''),
    caseId ? ['Inspection pending', caseId] : ['Inspection pending']
  );
  base.pendingInspections = Number(inspectionResult.rows[0].count || 0);

  return base;
}

async function listThirdPartyClaims({ caseId = null } = {}) {
  const filters = [];
  const params = [];

  if (caseId) {
    params.push(caseId);
    filters.push(`tc.case_id = $${params.length}`);
  }

  const where = filters.length ? ` WHERE ${filters.join(' AND ')}` : '';
  const result = await getPool().query(
    `SELECT tc.id, tc.case_id AS "caseId", tc.claim_reference AS "claimReference", tc.claim_type AS "claimType",
            tc.damaged_asset AS "damagedAsset", tc.claimed_amount AS "claimedAmount",
            tc.claim_date AS "claimDate", tc.claim_description AS "description",
            tc.status, tc.workflow_status AS "workflowStatus",
            tp.id AS "claimantPartyId", tp.name AS "claimantName",
            tc.insurance_company AS "insuranceCompany", tc.policy_number AS "policyNumber",
            tc.insurance_verification_status AS "insuranceVerificationStatus",
            tc.accident_description AS "accidentDescription",
            tc.policie_report_number AS "policeReportNumber",
            tc.investigation_findings AS "investigationFindings",
            tc.liability_status AS "liabilityStatus", tc.surveyor_remarks AS "surveyorRemarks",
            tc.created_at AS "createdAt",
            tc.updated_at AS "updatedAt"
     FROM third_party_claims tc
     LEFT JOIN third_party_parties tp ON tp.id = tc.claimant_party_id${where}
     ORDER BY tc.updated_at DESC`,
    params
  );

  const rows = result.rows;
  for (const row of rows) {
    const asset = await getPool().query(
      'SELECT asset_type AS "assetType", asset_data AS "assetData" FROM third_party_claim_assets WHERE claim_id = $1 ORDER BY created_at DESC LIMIT 1',
      [row.id]
    );
    const assessment = await getPool().query(
      'SELECT * FROM third_party_claim_assessments WHERE claim_id = $1 ORDER BY created_at DESC LIMIT 1',
      [row.id]
    );
    const inspection = await getPool().query(
      'SELECT * FROM third_party_claim_inspections WHERE claim_id = $1 ORDER BY created_at DESC LIMIT 1',
      [row.id]
    );
    row.asset = asset.rowCount ? asset.rows[0] : null;
    row.assessment = assessment.rowCount ? assessment.rows[0] : null;
    row.inspection = inspection.rowCount ? inspection.rows[0] : null;
  }

  return rows;
}

async function upsertThirdPartyClaim(payload = {}) {
  if (!payload || !payload.caseId || !payload.claimType) {
    throw new Error('A case and claim type are required.');
  }

  const claimReference =
    payload.claimReference ||
    `TP-${String(Date.now()).slice(-6)}-${String(Math.random()).slice(2, 6).toUpperCase()}`;

  const result = await getPool().query(
    `INSERT INTO third_party_claims (
      case_id, claim_reference, claimant_party_id, claim_type, damaged_asset, claimed_amount, claim_date,
      claim_description, status, workflow_status, insurance_company, policy_number, policy_period,
      insurance_verification_status, accident_description, police_report_available,
      police_report_number, investigation_findings, liability_status, surveyor_remarks, created_by, created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, NOW(), NOW()
    ) RETURNING *`,
    [
      payload.caseId,
      claimReference,
      payload.claimantPartyId || null,
      payload.claimType,
      payload.damagedAsset || null,
      Number(payload.claimedAmount || 0),
      payload.claimDate || null,
      payload.description || null,
      payload.status || 'Registered',
      payload.workflowStatus || 'Registered',
      payload.insuranceCompany || null,
      payload.policyNumber || null,
      payload.policyPeriod || null,
      payload.insuranceVerificationStatus || 'Pending Verification',
      payload.accidentDescription || null,
      Boolean(payload.policeReportAvailable),
      payload.policeReportNumber || null,
      payload.investigationFindings || null,
      payload.liabilityStatus || 'Undetermined',
      payload.surveyorRemarks || null,
      payload.createdBy || null,
    ]
  );

  const row = result.rows[0];

  if (payload.asset) {
    await getPool().query(
      'INSERT INTO third_party_claim_assets (id, claim_id, asset_type, asset_data, created_at) VALUES (gen_random_uuid(), $1, $2, $3::jsonb, NOW())',
      [row.id, payload.asset.assetType || 'Property', JSON.stringify(payload.asset)]
    );
  }

  if (Array.isArray(payload.assessmentItems) && payload.assessmentItems.length) {
    const total = payload.assessmentItems.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    await getPool().query(
      'INSERT INTO third_party_claim_assessments (id, claim_id, assessment_type, claimed_total, assessed_total, admissible_total, settled_total, items, created_by, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7::jsonb, $8, NOW(), NOW())',
      [
        row.id,
        payload.assessmentType || 'Motor Damage Assessment',
        Number(payload.claimedAmount || 0),
        total,
        total,
        Number(payload.settledAmount || 0),
        JSON.stringify(payload.assessmentItems),
        payload.createdBy || null,
      ]
    );
  }

  if (payload.inspection) {
    await getPool().query(
      'INSERT INTO third_party_claim_inspections (id, claim_id, inspection_date, inspection_location, inspected_by, inspection_status, damage_description, surveyor_observations, photographs, inspection_remarks, created_at, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, NOW(), NOW())',
      [
        row.id,
        payload.inspection.inspectionDate || null,
        payload.inspection.inspectionLocation || null,
        payload.inspection.inspectedBy || null,
        payload.inspection.status || 'Inspection pending',
        payload.inspection.damageDescription || null,
        payload.inspection.surveyorObservations || null,
        JSON.stringify(payload.inspection.photographs || []),
        payload.inspection.remarks || null,
      ]
    );
  }

  return listThirdPartyClaims({ caseId: row.case_id }).then(
    (records) =>
      records.find((item) => item.id === row.id) || { ...row, claimReference, caseId: row.case_id }
  );
}

module.exports = {
  pool,
  query,
  POLICY,
  hashToken,
  initializeDatabase,
  findUserByEmail,
  findUserByGoogleSub,
  findUserById,
  linkGoogleIdentity,
  createUser,
  markEmailVerified,
  registerLoginFailure,
  clearLoginFailures,
  updateUserProfile,
  getSurveyorProfile,
  upsertSurveyorProfile,
  updatePasswordHash,
  setAccountNotificationPreferences,
  updateLastLogin,
  recordLoginActivity,
  getLoginActivityForUser,
  getActiveSessionsForUser,
  findLatestActiveSession,
  revokeSessionById,
  revokeOtherSessions,
  recordAuditLog,
  getAuditLogs,
  createVerificationTokenForUser,
  consumeVerificationToken,
  consumeResetToken,
  verifyEmailChangeToken,
  createResetTokenForUser,
  createSessionForUser,
  validateSessionToken,
  revokeSessionToken,
  revokeSessionsForUser,
  listPermissionCatalog,
  resolvePermissions,
  getPermissionMatrix,
  replaceUserPermissionOverrides,
  softDeleteAccount,
  getAccountRemovalSummary,
  createOwnershipTransfer,
  findOwnershipTransferById,
  findPendingOwnershipTransferForUser,
  resolveOwnershipTransfer,
  upsertCase,
  listCases,
  findCaseById,
  deleteCase,
  findSimilarCases,
  countCasesOwnedBy,
  findTaskById,
  listTasks,
  createTask,
  moveTaskStatus,
  reassignTask,
  updateTaskDetails,
  listTaskEvents,
  listTaskHistoryForCase,
  countTasksForUser,
  isTaskAssigneeOnCase,
  caseIdsAssignedAsTasks,
  createDocument,
  replaceDocument,
  findDocumentById,
  listDocuments,
  listDocumentVersions,
  listDocumentEvents,
  attachDocumentFile,
  moveDocumentStatus,
  updateDocumentDetails,
  deleteDocumentRow,
  countDocumentsByStatus,
  resolveMentions,
  insertNotification,
  insertNotifications,
  listNotifications,
  unreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
  insertCaseComment,
  listCaseComments,
  findCaseCommentById,
  markCaseCommentsRead,
  caseCommentUnreadCounts,
  deadlineRows,
  recentNoticeKeys,
  openDeadlineNotices,
  deleteNotifications,
  caseCommentAudience,
  listThirdPartyParties,
  upsertThirdPartyParty,
  getThirdPartyDashboard,
  listThirdPartyClaims,
  upsertThirdPartyClaim,
};
