const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const argon2 = require('argon2');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const { OAuth2Client } = require('google-auth-library');
const {
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
} = require('./db');

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3000);
const apiKey = process.env.GEMINI_API_KEY;
const defaultModelName = 'gemini-3.8-flash';
const modelName = (process.env.GEMINI_MODEL || defaultModelName).trim();
const maxOutputTokens = Number(process.env.GEMINI_MAX_TOKENS || 6000);
const authSecret = process.env.JWT_SECRET || 'survey-desk-dev-secret-change-me';
const sessionSecret = process.env.SESSION_SECRET || authSecret;
const dataDir = path.join(__dirname, 'data');
const googleClientId = process.env.GOOGLE_CLIENT_ID || '';
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
const googleCallbackUrl =
  process.env.GOOGLE_CALLBACK_URL ||
  `${(process.env.APP_URL || 'http://localhost:4173').replace(/\/$/, '')}/api/auth/google/callback`;
const googleOAuthClient =
  googleClientId && googleClientSecret
    ? new OAuth2Client({
        clientId: googleClientId,
        clientSecret: googleClientSecret,
        redirectUri: googleCallbackUrl,
      })
    : null;
const oauthStateStore = new Map();

const pruneOauthStateStore = () => {
  const now = Date.now();
  for (const [state, timestamp] of oauthStateStore.entries()) {
    if (now - timestamp > 10 * 60 * 1000) {
      oauthStateStore.delete(state);
    }
  }
};

const normalizeModel = (name) => {
  const raw = String(name || defaultModelName)
    .trim()
    .replace(/^models\//i, '');
  const legacyMap = {
    'gemini-2.0-flash': 'gemini-3.8-flash',
    'gemini-2.5-flash': 'gemini-3.8-flash',
    'gemini-1.5-flash': 'gemini-3.8-flash',
  };
  const resolved = legacyMap[raw] || raw || defaultModelName;
  return `models/${resolved}`;
};

const sanitizeUser = (user) => ({
  id: user.id,
  email: user.email,
  name: user.full_name || user.name || user.email.split('@')[0],
  fullName: user.full_name || user.name || user.email.split('@')[0],
  phoneNumber: user.phone_number || null,
  designation: user.designation || null,
  provider: user.provider || 'email',
  role: user.role || 'ASSISTANT',
  emailVerified: Boolean(user.is_verified),
  isActive: Boolean(user.is_active),
  avatarUrl: user.avatar_url || user.avatarUrl || user.profile_image_url || null,
  profileImageUrl: user.profile_image_url || user.avatar_url || user.avatarUrl || null,
  googleSub: user.google_sub || user.googleSub || null,
  createdAt: user.created_at || user.createdAt,
  lastLogin: user.last_login_at || user.lastLogin,
  lastLoginIp: user.last_login_ip || null,
  lastLoginUserAgent: user.last_login_user_agent || null,
  notificationPreferences: user.notification_preferences || {},
  pendingEmail: user.pending_email || null,
  emailChangePending: Boolean(user.email_change_pending),
});

const makeToken = (user) =>
  jwt.sign(
    { sub: user.id, email: user.email, name: user.full_name || user.name, role: user.role },
    authSecret,
    { expiresIn: '7d' }
  );

const verifyToken = (token) => {
  try {
    return jwt.verify(token, authSecret);
  } catch {
    return null;
  }
};

const buildLandingUrl = (req = null) => {
  const explicit = String(process.env.APP_URL || '')
    .trim()
    .replace(/\/$/, '');
  if (explicit) return explicit;

  if (req) {
    const forwardedProto = req.headers['x-forwarded-proto'];
    const forwardedHost = req.headers['x-forwarded-host'];
    const proto = Array.isArray(forwardedProto)
      ? String(forwardedProto[0] || 'http')
      : String(forwardedProto || req.protocol || 'http');
    const host = String(forwardedHost || req.headers.host || 'localhost:4173');
    const normalized = host.split(',')[0].trim();
    return `${proto.split(',')[0].trim()}://${normalized}`.replace(/\/$/, '');
  }

  return 'http://localhost:4173';
};

const buildResetLink = (token, req = null) =>
  `${buildLandingUrl(req).replace(/\/$/, '')}/index.html?reset=${encodeURIComponent(token)}`;
const buildVerifyLink = (token, req = null) =>
  `${buildLandingUrl(req).replace(/\/$/, '')}/index.html?verify=${encodeURIComponent(token)}`;
const buildEmailChangeLink = (token, req = null) =>
  `${buildLandingUrl(req).replace(/\/$/, '')}/index.html?email-change=${encodeURIComponent(token)}`;

const getClientMetadata = (req) => {
  const userAgent = String(req.get('user-agent') || '');
  const ipAddress =
    String(
      (req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.ip || 'unknown').split(
        ','
      )[0]
    ).trim() || 'unknown';

  let browserName = 'Unknown';
  if (/Edg\//.test(userAgent)) browserName = 'Edge';
  else if (/Chrome\//.test(userAgent)) browserName = 'Chrome';
  else if (/Firefox\//.test(userAgent)) browserName = 'Firefox';
  else if (/Safari\//.test(userAgent) && !/Chrome\//.test(userAgent)) browserName = 'Safari';

  let deviceName = 'Desktop';
  if (/Android|iPhone|iPad|Mobile/.test(userAgent)) deviceName = 'Mobile';

  return { userAgent, browserName, deviceName, ipAddress };
};

const buildGoogleCallbackUrl = (req = null) => {
  const explicit = String(process.env.GOOGLE_CALLBACK_URL || '')
    .trim()
    .replace(/\/$/, '');
  if (explicit) return explicit;

  const base = buildLandingUrl(req).replace(/\/$/, '');
  return `${base}/api/auth/google/callback`;
};

const renderAuthRedirectHtml = (token, user, req = null) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>SurveyPro Redirecting…</title>
  </head>
  <body>
    <script>
      try {
        const auth = { token: ${JSON.stringify(token)}, user: ${JSON.stringify(sanitizeUser(user))} };
        const landingUrl = ${JSON.stringify(`${buildLandingUrl(req)}/index.html`)};
        const url = new URL(landingUrl);
        url.searchParams.set('auth', JSON.stringify(auth));
        try {
          localStorage.setItem('survey-desk-auth', JSON.stringify(auth));
          sessionStorage.setItem('survey-desk-auth', JSON.stringify(auth));
        } catch (storageError) {
          console.warn('SurveyPro auth session persistence failed', storageError);
        }
        window.location.replace(url.toString());
      } catch (e) {
        console.error('SurveyPro auth redirect failed', e);
        window.location.replace(${JSON.stringify(`${buildLandingUrl(req)}/index.html`)});
      }
    </script>
  </body>
</html>`;

const renderAuthErrorHtml = (message, req = null) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>SurveyPro Sign-In Error</title>
  </head>
  <body style="font-family: Arial, sans-serif; display:grid; place-items:center; min-height:100vh; background:#f4f7fb; color:#1b2430;">
    <div style="max-width:520px; background:#fff; border-radius:12px; padding:32px; box-shadow:0 12px 28px rgba(0,0,0,.08);">
      <h2 style="margin-top:0;">Google sign-in failed</h2>
      <p>${String(message).replace(/[<>]/g, '')}</p>
      <p><a href="${buildLandingUrl(req)}/index.html">Return to SurveyPro</a></p>
    </div>
  </body>
</html>`;

const createMailer = () => {
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT || 587) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }

  return nodemailer.createTransport({
    streamTransport: true,
    newline: 'unix',
    buffer: true,
  });
};

const sendResetMail = async (email, token) => {
  const transporter = createMailer();
  const resetLink = buildResetLink(token);
  const info = await transporter.sendMail({
    from: process.env.SMTP_FROM || 'Survey Desk <noreply@localhost>',
    to: email,
    subject: 'Reset your Survey Desk password',
    html: `
      <div>
        <p>You requested a password reset for your Survey Desk account.</p>
        <p><a href="${resetLink}">Reset your password</a></p>
        <p>If the link does not work, copy this into your browser:</p>
        <p>${resetLink}</p>
      </div>
    `,
  });

  return { messageId: info?.messageId || null, previewUrl: resetLink };
};

const sendVerificationMail = async (email, token) => {
  const transporter = createMailer();
  const verifyLink = buildVerifyLink(token);
  const info = await transporter.sendMail({
    from: process.env.SMTP_FROM || 'Survey Desk <noreply@localhost>',
    to: email,
    subject: 'Verify your Survey Desk account',
    html: `
      <div>
        <p>Thanks for creating your Survey Desk account.</p>
        <p><a href="${verifyLink}">Verify your email address</a></p>
        <p>If the link does not work, copy this into your browser:</p>
        <p>${verifyLink}</p>
      </div>
    `,
  });

  return { messageId: info?.messageId || null, previewUrl: verifyLink };
};

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again later.' },
});

const authRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a few minutes and try again.' },
});

const getBearerToken = (req) => {
  const authorization = String(req.headers.authorization || '');
  return authorization.startsWith('Bearer ') ? authorization.slice(7) : null;
};

const requireAuth = async (req, res, next) => {
  try {
    const bearerToken = getBearerToken(req);
    const cookieToken =
      req.cookies && req.cookies.surveypro_session ? req.cookies.surveypro_session : null;

    let user = null;

    if (bearerToken) {
      const decoded = verifyToken(bearerToken);
      if (decoded && decoded.sub) {
        user = await findUserById(decoded.sub);
      }
    }

    if (!user && cookieToken) {
      const session = await validateSessionToken(cookieToken);
      user = session && session.user ? session.user : null;
    }

    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!user.is_active) {
      return res.status(403).json({ error: 'Your account is disabled. Contact an administrator.' });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(500).json({ error: 'Authentication failed' });
  }
};

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const strongPasswordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{12,}$/;

const legacyDataFiles = [
  path.join(dataDir, 'users.json'),
  path.join(dataDir, 'reset-tokens.json'),
  path.join(dataDir, 'verify-tokens.json'),
];

legacyDataFiles.forEach((target) => {
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (!fs.existsSync(target)) {
      fs.writeFileSync(target, target.endsWith('users.json') ? '[]' : '{}');
    }
  } catch (error) {
    console.error('[auth] legacy data init failed', error.message);
  }
});

app.use(helmet({ crossOriginResourcePolicy: false, contentSecurityPolicy: false }));
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser(sessionSecret));
app.use(express.static(__dirname));

app.get('/health', (_req, res) => {
  res.json({ ok: true, model: modelName, auth: 'enabled' });
});

app.get('/api/auth/google/start', (req, res) => {
  const callbackUrl = buildGoogleCallbackUrl(req);
  if (!googleClientId || !googleClientSecret || !callbackUrl) {
    return res.status(500).json({ error: 'Google OAuth is not configured on this server.' });
  }

  pruneOauthStateStore();
  const state = crypto.randomBytes(32).toString('hex');
  oauthStateStore.set(state, Date.now());

  const googleAuthUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  googleAuthUrl.searchParams.set('client_id', googleClientId);
  googleAuthUrl.searchParams.set('redirect_uri', callbackUrl);
  googleAuthUrl.searchParams.set('response_type', 'code');
  googleAuthUrl.searchParams.set('scope', 'openid email profile');
  googleAuthUrl.searchParams.set('access_type', 'online');
  googleAuthUrl.searchParams.set('prompt', 'select_account');
  googleAuthUrl.searchParams.set('state', state);

  return res.redirect(googleAuthUrl.toString());
});

app.get('/api/auth/google/callback', async (req, res) => {
  try {
    const callbackUrl = buildGoogleCallbackUrl(req);
    const { code, state, error, error_description } = req.query;
    pruneOauthStateStore();

    if (error) {
      return res
        .status(400)
        .send(renderAuthErrorHtml(error_description || 'Google sign-in was cancelled.', req));
    }

    if (!code || !state || !oauthStateStore.has(String(state))) {
      return res
        .status(400)
        .send(renderAuthErrorHtml('Invalid OAuth state. Please try again.', req));
    }

    oauthStateStore.delete(String(state));

    if (!googleClientId || !googleClientSecret) {
      return res
        .status(500)
        .send(renderAuthErrorHtml('Google OAuth is not configured on this server.', req));
    }

    const oauthClient = new OAuth2Client({
      clientId: googleClientId,
      clientSecret: googleClientSecret,
      redirectUri: callbackUrl,
    });

    const { tokens } = await oauthClient.getToken({
      code: String(code),
      redirect_uri: callbackUrl,
    });

    if (!tokens || !tokens.id_token) {
      return res
        .status(400)
        .send(renderAuthErrorHtml('Google did not return a valid identity token.', req));
    }

    const ticket = await oauthClient.verifyIdToken({
      idToken: tokens.id_token,
      audience: googleClientId,
    });

    const payload = ticket.getPayload();
    if (!payload || !payload.email || payload.email_verified !== true) {
      return res
        .status(403)
        .send(
          renderAuthErrorHtml(
            'Google email verification failed. Please use a verified Google account.',
            req
          )
        );
    }

    const googleSub = String(payload.sub || '').trim();
    const email = String(payload.email || '')
      .trim()
      .toLowerCase();
    const fullName = String(payload.name || payload.given_name || email.split('@')[0]).trim();
    const avatarUrl = String(payload.picture || '').trim();

    let user = await findUserByGoogleSub(googleSub);
    if (!user) {
      user = await findUserByEmail(email);
    }

    if (!user) {
      const passwordHash = await argon2.hash(`google-${crypto.randomBytes(24).toString('hex')}`, {
        type: argon2.argon2id,
      });
      user = await createUser({
        fullName,
        email,
        passwordHash,
        provider: 'google',
        role: 'ASSISTANT',
        googleSub,
        avatarUrl,
        emailVerified: true,
      });
    } else {
      if (!user.is_active) {
        return res
          .status(403)
          .send(
            renderAuthErrorHtml('This account is disabled. Please contact an administrator.', req)
          );
      }

      if (!user.google_sub) {
        user = await linkGoogleIdentity(user.id, {
          googleSub,
          avatarUrl,
          provider: 'google',
          isVerified: true,
        });
      }

      if (user.email !== email) {
        return res
          .status(409)
          .send(
            renderAuthErrorHtml('A different account already exists for this Google email.', req)
          );
      }
    }

    const sessionToken = await createSessionForUser(user.id);
    const jwtToken = makeToken(user);
    const clientMeta = getClientMetadata(req);
    await updateLastLogin(user.id, {
      ipAddress: clientMeta.ipAddress,
      userAgent: clientMeta.userAgent,
    });
    await recordLoginActivity({
      userId: user.id,
      loginMethod: 'google',
      eventType: 'login',
      status: 'success',
      browserName: clientMeta.browserName,
      deviceName: clientMeta.deviceName,
      ipAddress: clientMeta.ipAddress,
      userAgent: clientMeta.userAgent,
      metadata: { app: 'survey-desk', provider: 'google_oauth' },
    });

    res.cookie('surveypro_session', sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });

    return res.type('html').send(renderAuthRedirectHtml(jwtToken, user, req));
  } catch (error) {
    return res
      .status(500)
      .send(renderAuthErrorHtml(error.message || 'Google sign-in failed.', req));
  }
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  const user = await findUserById(req.user.id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  return res.json({ user: sanitizeUser(user) });
});

app.get('/api/profile/me', requireAuth, async (req, res) => {
  const user = await findUserById(req.user.id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  return res.json({ user: sanitizeUser(user) });
});

app.patch('/api/profile/me', requireAuth, async (req, res) => {
  try {
    const fullName = String(req.body?.fullName || req.body?.name || '').trim();
    const phoneNumber = String(req.body?.phoneNumber || '').trim();
    const designation = String(req.body?.designation || '').trim();
    const profileImageUrl = String(req.body?.profileImageUrl || '').trim();

    const user = await findUserById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const updatePayload = {
      fullName: fullName || user.full_name,
      phoneNumber: phoneNumber || user.phone_number || null,
      designation: designation || user.designation || null,
      profileImageUrl: profileImageUrl || user.profile_image_url || user.avatar_url || null,
    };

    const updated = await updateUserProfile(req.user.id, updatePayload);
    await recordAuditLog({
      actorUserId: req.user.id,
      targetUserId: req.user.id,
      action: 'profile_update',
      details: { updatedFields: Object.keys(updatePayload) },
    });

    return res.json({ user: sanitizeUser(updated), message: 'Profile updated successfully.' });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Profile update failed.' });
  }
});

app.get('/api/account/settings', requireAuth, async (req, res) => {
  const user = await findUserById(req.user.id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  return res.json({
    user: sanitizeUser(user),
    googleConnected: Boolean(user.google_sub || user.provider === 'google'),
    notifications: user.notification_preferences || {},
    role: user.role,
  });
});

app.patch('/api/account/settings', requireAuth, async (req, res) => {
  try {
    const payload = req.body && typeof req.body === 'object' ? req.body : {};
    const notifications = payload.notifications || payload.notificationPreferences || {};
    const user = await setAccountNotificationPreferences(req.user.id, notifications);
    await recordAuditLog({
      actorUserId: req.user.id,
      targetUserId: req.user.id,
      action: 'notification_preferences_updated',
      details: { notifications },
    });

    return res.json({
      ok: true,
      message: 'Preferences updated successfully.',
      user: sanitizeUser(user),
      notifications: user.notification_preferences || {},
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Unable to update preferences.' });
  }
});

app.post('/api/account/change-password', requireAuth, async (req, res) => {
  try {
    const currentPassword = String(req.body?.currentPassword || '').trim();
    const newPassword = String(req.body?.newPassword || '').trim();
    const confirmPassword = String(req.body?.confirmPassword || '').trim();

    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({ error: 'Current and new passwords are required.' });
    }
    if (newPassword !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match.' });
    }
    if (!strongPasswordRegex.test(newPassword)) {
      return res.status(400).json({
        error:
          'Password must be at least 12 characters, include upper and lower case, a number, and a symbol.',
      });
    }

    const user = await findUserById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const currentMatches = await argon2
      .verify(user.password_hash, currentPassword)
      .catch(() => false);
    if (!currentMatches) {
      return res.status(401).json({ error: 'Current password is incorrect.' });
    }

    const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
    await updatePasswordHash(req.user.id, passwordHash);
    await revokeSessionsForUser(req.user.id);
    res.clearCookie('surveypro_session', { path: '/' });
    await recordAuditLog({
      actorUserId: req.user.id,
      targetUserId: req.user.id,
      action: 'password_changed',
      details: { method: 'self_service' },
    });

    return res.json({ ok: true, message: 'Password changed successfully.' });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Password change failed.' });
  }
});

app.post('/api/account/request-email-change', requireAuth, async (req, res) => {
  try {
    const newEmail = String(req.body?.newEmail || '')
      .trim()
      .toLowerCase();
    if (!newEmail || !emailRegex.test(newEmail)) {
      return res.status(400).json({ error: 'Enter a valid new email address.' });
    }

    const existing = await findUserByEmail(newEmail);
    if (existing && existing.id !== req.user.id) {
      return res.status(409).json({ error: 'That email address is already in use.' });
    }

    const verification = await createVerificationTokenForUser(req.user.id, {
      purpose: 'email_change',
      emailAddress: newEmail,
    });

    const user = await findUserById(req.user.id);
    const updatedUser = await updateUserProfile(req.user.id, {
      pendingEmail: newEmail,
      emailChangePending: true,
      emailChangeRequestedAt: new Date().toISOString(),
      fullName: user.full_name,
      phoneNumber: user.phone_number,
      designation: user.designation,
      profileImageUrl: user.profile_image_url || user.avatar_url || null,
    });

    await sendVerificationMail(newEmail, verification.rawToken);
    await recordAuditLog({
      actorUserId: req.user.id,
      targetUserId: req.user.id,
      action: 'email_change_requested',
      details: { newEmail },
    });

    return res.json({
      ok: true,
      message: 'A verification email has been sent to your new address.',
      previewUrl: buildEmailChangeLink(verification.rawToken),
      user: sanitizeUser(updatedUser),
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Unable to request email change.' });
  }
});

app.post('/api/account/confirm-email-change', requireAuth, async (req, res) => {
  try {
    const token = String(req.body?.token || '').trim();
    if (!token) {
      return res.status(400).json({ error: 'Verification token is required.' });
    }

    const verifiedUser = await verifyEmailChangeToken(token);
    if (!verifiedUser || verifiedUser.id !== req.user.id) {
      return res.status(400).json({ error: 'This change request is invalid or expired.' });
    }

    await recordAuditLog({
      actorUserId: req.user.id,
      targetUserId: req.user.id,
      action: 'email_change_confirmed',
      details: { newEmail: verifiedUser.email },
    });

    return res.json({ ok: true, message: 'Your email address was updated successfully.' });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Email change could not be confirmed.' });
  }
});

app.get('/api/security/sessions', requireAuth, async (req, res) => {
  const sessions = await getUserSessions(req.user.id);
  return res.json({ sessions });
});

app.get('/api/security/login-activity', requireAuth, async (req, res) => {
  const entries = await getLoginActivityForUser(req.user.id, 50);
  return res.json({ entries });
});

app.post('/api/security/logout-others', requireAuth, async (req, res) => {
  const currentSession =
    req.cookies && req.cookies.surveypro_session ? req.cookies.surveypro_session : null;
  const sessions = await getUserSessions(req.user.id);

  for (const session of sessions) {
    if (currentSession && session.session_token_hash) {
      const matched = await argon2
        .verify(session.session_token_hash, currentSession)
        .catch(() => false);
      if (matched) continue;
    }
    await revokeSessionById(session.id, 'logout_others');
  }

  return res.json({ ok: true, message: 'Other sessions have been revoked.' });
});

app.post('/api/security/revoke-session/:id', requireAuth, async (req, res) => {
  const session = await revokeSessionById(req.params.id, 'user_revoke');
  if (!session) {
    return res.status(404).json({ error: 'Session not found or already revoked.' });
  }
  return res.json({ ok: true, message: 'Session revoked.' });
});

app.get('/api/admin/users', requireAuth, async (req, res) => {
  if (req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const result = await query(
    `SELECT id, full_name, email, role, provider, is_active, is_verified, created_at, last_login_at
     FROM users
     ORDER BY created_at DESC`
  );

  return res.json({ users: result.rows });
});

app.post('/api/admin/users/:id/toggle-status', requireAuth, async (req, res) => {
  if (req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const target = await findUserById(req.params.id);
  if (!target) {
    return res.status(404).json({ error: 'User not found.' });
  }

  const nextStatus = !Boolean(target.is_active);
  const updated = await query(
    'UPDATE users SET is_active = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
    [nextStatus, req.params.id]
  );

  await recordAuditLog({
    actorUserId: req.user.id,
    targetUserId: target.id,
    action: nextStatus ? 'user_enabled' : 'user_disabled',
    details: { email: target.email },
  });

  return res.json({
    ok: true,
    user: sanitizeUser(updated.rows[0]),
    message: `${nextStatus ? 'Enabled' : 'Disabled'} user account.`,
  });
});

app.get('/api/admin/audit-logs', requireAuth, async (req, res) => {
  if (req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  const logs = await getAuditLogs(100);
  return res.json({ logs });
});

app.post('/api/auth/signup', authRequestLimiter, async (req, res) => {
  try {
    const fullName = String(req.body?.fullName || req.body?.name || '').trim();
    const email = String(req.body?.email || '')
      .trim()
      .toLowerCase();
    const password = String(req.body?.password || '').trim();

    if (!email || !emailRegex.test(email)) {
      return res.status(400).json({ error: 'Enter a valid email address.' });
    }

    if (!password || !strongPasswordRegex.test(password)) {
      return res.status(400).json({
        error:
          'Password must be at least 12 characters, include upper and lower case, a number, and a symbol.',
      });
    }

    const existingUser = await findUserByEmail(email);
    if (existingUser) {
      return res.status(409).json({ error: 'An account for this email already exists.' });
    }

    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await createUser({
      fullName: fullName || email.split('@')[0],
      email,
      passwordHash,
      provider: 'email',
      role: 'ASSISTANT',
    });

    const verification = await createVerificationTokenForUser(user.id);
    await sendVerificationMail(email, verification.rawToken);

    return res.status(201).json({
      ok: true,
      message: 'Account created. Please verify your email before signing in.',
      previewUrl: buildVerifyLink(verification.rawToken),
      user: sanitizeUser(user),
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Signup failed.' });
  }
});

app.post('/api/auth/resend-verification', authRequestLimiter, async (req, res) => {
  try {
    const email = String(req.body?.email || '')
      .trim()
      .toLowerCase();
    if (!email || !emailRegex.test(email)) {
      return res.status(400).json({ error: 'Enter a valid email address.' });
    }

    const user = await findUserByEmail(email);
    if (!user) {
      return res.json({
        ok: true,
        message: 'If an account exists, a verification email has been sent.',
      });
    }

    if (user.is_verified) {
      return res.json({ ok: true, message: 'This account is already verified.' });
    }

    const verification = await createVerificationTokenForUser(user.id);
    await sendVerificationMail(user.email, verification.rawToken);

    return res.json({
      ok: true,
      message: 'A new verification email has been sent.',
      previewUrl: buildVerifyLink(verification.rawToken),
    });
  } catch (error) {
    return res
      .status(500)
      .json({ error: error.message || 'Verification email could not be sent.' });
  }
});

app.post('/api/auth/login', loginLimiter, async (req, res) => {
  try {
    const email = String(req.body?.email || '')
      .trim()
      .toLowerCase();
    const password = String(req.body?.password || '').trim();

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const user = await findUserByEmail(email);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const passwordValid = await argon2.verify(user.password_hash, password).catch(() => false);
    if (!passwordValid) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    if (!user.is_active) {
      return res.status(403).json({ error: 'Your account is disabled. Contact an administrator.' });
    }

    if (!user.is_verified) {
      return res.status(403).json({ error: 'Please verify your email before signing in.' });
    }

    const clientMeta = getClientMetadata(req);
    const sessionToken = await createSessionForUser(user.id);
    const jwtToken = makeToken(user);
    await updateLastLogin(user.id, {
      ipAddress: clientMeta.ipAddress,
      userAgent: clientMeta.userAgent,
    });
    await recordLoginActivity({
      userId: user.id,
      loginMethod: 'email',
      eventType: 'login',
      status: 'success',
      browserName: clientMeta.browserName,
      deviceName: clientMeta.deviceName,
      ipAddress: clientMeta.ipAddress,
      userAgent: clientMeta.userAgent,
      metadata: { app: 'survey-desk' },
    });

    res.cookie('surveypro_session', sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });

    return res.json({ token: jwtToken, user: sanitizeUser(user), message: 'Login successful.' });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Login failed.' });
  }
});

app.post('/api/auth/google', async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const email = String(req.body?.email || '')
      .trim()
      .toLowerCase();

    if (!email || !emailRegex.test(email)) {
      return res.status(400).json({ error: 'A valid Gmail address is required.' });
    }

    let user = await findUserByEmail(email);
    if (!user) {
      const passwordHash = await argon2.hash(`gmail-${crypto.randomBytes(24).toString('hex')}`, {
        type: argon2.argon2id,
      });
      user = await createUser({
        fullName: name || email.split('@')[0],
        email,
        passwordHash,
        provider: 'google',
        role: 'ASSISTANT',
        emailVerified: true,
      });
    }

    if (!user.is_active) {
      return res.status(403).json({ error: 'This account is disabled.' });
    }

    const clientMeta = getClientMetadata(req);
    const sessionToken = await createSessionForUser(user.id);
    const jwtToken = makeToken(user);
    await updateLastLogin(user.id, {
      ipAddress: clientMeta.ipAddress,
      userAgent: clientMeta.userAgent,
    });
    await recordLoginActivity({
      userId: user.id,
      loginMethod: 'google',
      eventType: 'login',
      status: 'success',
      browserName: clientMeta.browserName,
      deviceName: clientMeta.deviceName,
      ipAddress: clientMeta.ipAddress,
      userAgent: clientMeta.userAgent,
      metadata: { app: 'survey-desk', provider: 'google' },
    });

    res.cookie('surveypro_session', sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });

    return res.json({ token: jwtToken, user: sanitizeUser(user) });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Google sign-in failed.' });
  }
});

app.post('/api/auth/forgot-password', authRequestLimiter, async (req, res) => {
  try {
    const email = String(req.body?.email || '')
      .trim()
      .toLowerCase();
    if (!email) {
      return res.status(400).json({ error: 'Email is required.' });
    }

    const user = await findUserByEmail(email);
    if (!user) {
      return res.json({
        ok: true,
        message: 'If an account exists, a password reset email has been sent.',
      });
    }

    const reset = await createResetTokenForUser(user.id);
    await sendResetMail(user.email, reset.rawToken);

    return res.json({
      ok: true,
      message: 'If an account exists, a password reset email has been sent.',
      previewUrl: buildResetLink(reset.rawToken),
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Password reset failed.' });
  }
});

app.post('/api/auth/reset-password', authRequestLimiter, async (req, res) => {
  try {
    const token = String(req.body?.token || '').trim();
    const password = String(req.body?.password || '').trim();
    const confirmPassword = String(req.body?.confirmPassword || req.body?.confirm || '').trim();

    if (!token) {
      return res.status(400).json({ error: 'Reset token is required.' });
    }
    if (!password || !confirmPassword) {
      return res.status(400).json({ error: 'New password and confirmation are required.' });
    }
    if (password !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match.' });
    }
    if (!strongPasswordRegex.test(password)) {
      return res.status(400).json({
        error:
          'Password must be at least 12 characters, include upper and lower case, a number, and a symbol.',
      });
    }

    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await handleResetToken(token, passwordHash);
    if (!user) {
      return res.status(400).json({ error: 'Password reset token is invalid or expired.' });
    }

    await revokeSessionsForUser(user.id);
    res.clearCookie('surveypro_session', { path: '/' });

    return res.json({ ok: true, message: 'Password updated successfully. You can now sign in.' });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Password update failed.' });
  }
});

app.post('/api/auth/verify-email', authRequestLimiter, async (req, res) => {
  try {
    const token = String(req.body?.token || '').trim();
    if (!token) {
      return res.status(400).json({ error: 'Verification token is required.' });
    }

    const user = await verifyEmailToken(token);
    if (!user) {
      return res.status(400).json({ error: 'This verification link is invalid or expired.' });
    }

    return res.json({ ok: true, message: 'Email verified successfully. You can now sign in.' });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Email verification failed.' });
  }
});

app.post('/api/auth/logout', requireAuth, async (req, res) => {
  const sessionToken =
    req.cookies && req.cookies.surveypro_session ? req.cookies.surveypro_session : null;
  if (sessionToken) {
    await revokeSessionToken(sessionToken);
  }
  res.clearCookie('surveypro_session', { path: '/' });
  return res.json({ ok: true, message: 'Logged out.' });
});

app.post('/api/generate', requireAuth, async (req, res) => {
  try {
    const prompt = String(req.body?.prompt || '').trim();
    if (!prompt) {
      return res.status(400).json({ error: 'prompt is required' });
    }
    if (!apiKey) {
      return res.status(500).json({ error: 'GEMINI_API_KEY is not configured on the server.' });
    }

    const resolvedModel = normalizeModel(modelName);
    const url = `https://generativelanguage.googleapis.com/v1beta/${resolvedModel}:generateContent?key=${encodeURIComponent(apiKey)}`;
    console.log(`[AI] generating with model=${resolvedModel} promptChars=${prompt.length}`);
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.25,
          topP: 0.95,
          maxOutputTokens:
            Number.isFinite(maxOutputTokens) && maxOutputTokens > 0 ? maxOutputTokens : 6000,
        },
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message = data?.error?.message || 'Gemini request failed';
      return res.status(response.status).json({ error: message });
    }

    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p?.text || '').join('') || '';

    if (!text) {
      return res.status(502).json({ error: 'Gemini returned an empty response.' });
    }

    const words = (text.match(/\S+/g) || []).length;
    console.log(`[AI] done model=${resolvedModel} chars=${text.length} words=${words}`);
    return res.json({ text });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Server error' });
  }
});

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'index.html'));
});

async function startServer() {
  try {
    await initializeDatabase();
    app.listen(port, '0.0.0.0', () => {
      console.log(`Survey Desk server running on http://0.0.0.0:${port}`);
    });
  } catch (error) {
    console.error('Database initialization failed:', error);
    process.exit(1);
  }
}

startServer();
