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

  const result = await getPool().query('SELECT * FROM users WHERE email = $1 LIMIT 1', [
    normalized,
  ]);
  return result.rowCount ? result.rows[0] : null;
}

async function findUserByGoogleSub(googleSub) {
  const normalized = (googleSub || '').trim();
  if (!normalized) return null;

  const result = await getPool().query('SELECT * FROM users WHERE google_sub = $1 LIMIT 1', [
    normalized,
  ]);
  return result.rowCount ? result.rows[0] : null;
}

async function findUserById(id) {
  if (!id) return null;

  const result = await getPool().query('SELECT * FROM users WHERE id = $1 LIMIT 1', [id]);
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
         updated_at = NOW()
     WHERE id = $5
     RETURNING *`,
    [googleSub, avatarUrl || null, provider, Boolean(isVerified), userId]
  );

  return result.rowCount ? result.rows[0] : null;
}

async function createUser({
  fullName,
  email,
  passwordHash,
  provider = 'email',
  role = 'ASSISTANT',
  googleSub = null,
  avatarUrl = null,
  emailVerified = false,
}) {
  const result = await getPool().query(
    `INSERT INTO users (full_name, email, password_hash, provider, google_sub, avatar_url, role, is_verified, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      (fullName || '').trim() || (email || '').split('@')[0],
      (email || '').trim().toLowerCase(),
      passwordHash,
      provider,
      googleSub || null,
      avatarUrl || null,
      role,
      Boolean(emailVerified),
      true,
    ]
  );

  return result.rows[0];
}

async function updateUserProfile(userId, profile = {}) {
  const updates = [];
  const values = [];

  const fields = {
    full_name: profile.fullName,
    phone_number: profile.phoneNumber,
    designation: profile.designation,
    profile_image_url: profile.profileImageUrl,
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

async function updatePasswordHash(userId, passwordHash) {
  const result = await getPool().query(
    'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
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
  if (!userId) return null;

  const result = await getPool().query(
    `INSERT INTO login_activity (user_id, login_method, event_type, status, browser_name, device_name, ip_address, user_agent, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      userId,
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

async function getUserSessions(userId) {
  const result = await getPool().query(
    `SELECT * FROM sessions
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId]
  );
  return result.rows;
}

async function revokeSessionById(sessionId, reason = 'manual') {
  const result = await getPool().query(
    `UPDATE sessions
     SET revoked_at = NOW(), revoked_reason = $1, last_seen_at = NOW()
     WHERE id = $2 AND revoked_at IS NULL
     RETURNING *`,
    [reason, sessionId]
  );
  return result.rowCount ? result.rows[0] : null;
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
  const tokenHash = await argon2.hash(rawToken, { type: argon2.argon2id });
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

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

async function verifyEmailToken(rawToken) {
  const rows = await getPool().query(
    `SELECT * FROM verification_tokens
     WHERE purpose = 'email_verify' AND expires_at > NOW() AND used_at IS NULL
     ORDER BY created_at DESC`
  );

  for (const row of rows.rows) {
    const matched = await argon2.verify(row.token_hash, rawToken).catch(() => false);
    if (matched) {
      await getPool().query(
        `UPDATE users SET is_verified = TRUE, updated_at = NOW() WHERE id = $1`,
        [row.user_id]
      );
      await getPool().query('UPDATE verification_tokens SET used_at = NOW() WHERE id = $1', [
        row.id,
      ]);
      return await findUserById(row.user_id);
    }
  }

  return null;
}

async function verifyEmailChangeToken(rawToken) {
  const rows = await getPool().query(
    `SELECT * FROM verification_tokens
     WHERE purpose = 'email_change' AND expires_at > NOW() AND used_at IS NULL
     ORDER BY created_at DESC`
  );

  for (const row of rows.rows) {
    const matched = await argon2.verify(row.token_hash, rawToken).catch(() => false);
    if (matched && row.email_address) {
      const target = await findUserById(row.user_id);
      if (target && target.pending_email === row.email_address) {
        await getPool().query(
          `UPDATE users
           SET email = $1,
               pending_email = NULL,
               email_change_pending = FALSE,
               email_change_requested_at = NULL,
               is_verified = TRUE,
               updated_at = NOW()
           WHERE id = $2`,
          [row.email_address, row.user_id]
        );
        await getPool().query('UPDATE verification_tokens SET used_at = NOW() WHERE id = $1', [
          row.id,
        ]);
        return await findUserById(row.user_id);
      }
    }
  }

  return null;
}

async function createResetTokenForUser(userId) {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = await argon2.hash(rawToken, { type: argon2.argon2id });
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

  await getPool().query('DELETE FROM reset_tokens WHERE user_id = $1', [userId]);
  await getPool().query(
    `INSERT INTO reset_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, tokenHash, expiresAt]
  );

  return { rawToken, expiresAt };
}

async function handleResetToken(rawToken, newPasswordHash) {
  const rows = await getPool().query(
    `SELECT * FROM reset_tokens
     WHERE expires_at > NOW() AND used_at IS NULL
     ORDER BY created_at DESC`
  );

  for (const row of rows.rows) {
    const matched = await argon2.verify(row.token_hash, rawToken).catch(() => false);
    if (matched) {
      await getPool().query(
        `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
        [newPasswordHash, row.user_id]
      );
      await getPool().query('DELETE FROM reset_tokens WHERE id = $1', [row.id]);
      await getPool().query(
        'UPDATE sessions SET revoked_at = NOW(), last_seen_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL',
        [row.user_id]
      );
      return await findUserById(row.user_id);
    }
  }

  return null;
}

async function createSessionForUser(userId) {
  const sessionToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = await argon2.hash(sessionToken, { type: argon2.argon2id });
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  await getPool().query(
    `INSERT INTO sessions (user_id, session_token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, tokenHash, expiresAt]
  );

  return sessionToken;
}

async function validateSessionToken(rawToken) {
  const rows = await getPool().query(
    `SELECT * FROM sessions
     WHERE revoked_at IS NULL AND expires_at > NOW()
     ORDER BY created_at DESC`
  );

  for (const row of rows.rows) {
    const matched = await argon2.verify(row.session_token_hash, rawToken).catch(() => false);
    if (matched) {
      await getPool().query('UPDATE sessions SET last_seen_at = NOW() WHERE id = $1', [row.id]);
      const user = await findUserById(row.user_id);
      return { user, sessionId: row.id };
    }
  }

  return null;
}

async function revokeSessionToken(rawToken) {
  const rows = await getPool().query(
    `SELECT * FROM sessions
     WHERE revoked_at IS NULL AND expires_at > NOW()
     ORDER BY created_at DESC`
  );

  for (const row of rows.rows) {
    const matched = await argon2.verify(row.session_token_hash, rawToken).catch(() => false);
    if (matched) {
      await getPool().query('UPDATE sessions SET revoked_at = NOW() WHERE id = $1', [row.id]);
      return true;
    }
  }

  return false;
}

async function revokeSessionsForUser(userId) {
  await getPool().query(
    'UPDATE sessions SET revoked_at = NOW(), last_seen_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL',
    [userId]
  );
}

module.exports = {
  pool,
  query,
  initializeDatabase,
  findUserByEmail,
  findUserByGoogleSub,
  findUserById,
  linkGoogleIdentity,
  createUser,
  updateUserProfile,
  updatePasswordHash,
  setAccountNotificationPreferences,
  updateLastLogin,
  recordLoginActivity,
  getLoginActivityForUser,
  getUserSessions,
  revokeSessionById,
  recordAuditLog,
  getAuditLogs,
  createVerificationTokenForUser,
  verifyEmailToken,
  verifyEmailChangeToken,
  createResetTokenForUser,
  handleResetToken,
  createSessionForUser,
  validateSessionToken,
  revokeSessionToken,
  revokeSessionsForUser,
};
