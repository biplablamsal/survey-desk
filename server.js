const express = require('express');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const argon2 = require('argon2');
const nodemailer = require('nodemailer');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const { OAuth2Client } = require('google-auth-library');
const {
  query,
  POLICY,
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
  insertNotifications,
  listNotifications,
  unreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
  deadlineRows,
  recentNoticeKeys,
  openDeadlineNotices,
  deleteNotifications,
  insertCaseComment,
  listCaseComments,
  findCaseCommentById,
  markCaseCommentsRead,
  caseCommentUnreadCounts,
  caseCommentAudience,
  listThirdPartyParties,
  upsertThirdPartyParty,
  getThirdPartyDashboard,
  listThirdPartyClaims,
  upsertThirdPartyClaim,
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

/* Gemini answers 503 "high demand" and sometimes stalls without responding at all. An unbounded fetch
   leaves the report screen spinning until the browser gives up, so each attempt is capped and only
   capacity errors are retried — a revoked key or exhausted quota fails identically every time. */
const aiTimeoutMs = Number(process.env.GEMINI_TIMEOUT_MS || 120000);
const aiRetries = Number(process.env.GEMINI_RETRIES || 2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callGemini(resolvedModel, payload) {
  const url = `https://generativelanguage.googleapis.com/v1beta/${resolvedModel}:generateContent?key=${encodeURIComponent(apiKey)}`;
  let last = { status: 502, note: 'Gemini request failed' };
  for (let attempt = 1; attempt <= aiRetries + 1; attempt++) {
    if (attempt > 1) await sleep(1500 * (attempt - 1));
    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(aiTimeoutMs),
      });
    } catch (e) {
      last = {
        status: 504,
        note: `Gemini did not answer within ${Math.round(aiTimeoutMs / 1000)}s${
          e && e.name === 'TimeoutError' ? ' (request aborted)' : ''
        }`,
      };
      continue;
    }
    const data = await response.json().catch(() => ({}));
    if (response.ok) return { status: response.status, note: '', data };
    last = {
      status: response.status,
      note:
        (data && data.error && data.error.message) || `Gemini request failed (${response.status})`,
      data,
    };
    if (response.status !== 429 && response.status !== 503) return last;
  }
  return last;
}

/* The two name fields are authoritative for anything the user edits; full_name stays as the single
   display string that the JWT, exports and surveyor autofill already read. */
const displayName = (user) =>
  user.full_name ||
  [user.first_name, user.last_name]
    .map((v) => String(v || '').trim())
    .filter(Boolean)
    .join(' ') ||
  (user.email || '').split('@')[0];

const accountStatusOf = (user) =>
  !user.is_active ? 'disabled' : user.is_verified ? 'active' : 'pending_verification';

const sanitizeUser = (user) => ({
  id: user.id,
  email: user.email,
  name: displayName(user),
  fullName: displayName(user),
  firstName: user.first_name || null,
  lastName: user.last_name || null,
  phoneNumber: user.phone_number || null,
  designation: user.designation || null,
  provider: user.provider || 'email',
  /* The role a session carries is the one in the database row, folded onto the three tiers the
     product uses. ASSISTANT was the only non-admin value an older build could write, so it reads
     back as STAFF rather than needing a data migration. */
  role: normalizeRole(user.role),
  mustChangePassword: Boolean(user.must_change_password),
  emailVerified: Boolean(user.is_verified),
  emailVerifiedAt: user.email_verified_at || null,
  accountStatus: accountStatusOf(user),
  hasPassword: Boolean(user.password_hash),
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

const LICENCE_RE = /^[0-9A-Za-z/-]{3,40}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/* The surveyor credentials live in their own table, so they are joined onto the same user object
   the client already reads instead of adding a second endpoint to keep in step. */
const withSurveyor = async (user) => {
  const row = await getSurveyorProfile(user.id);
  return {
    ...sanitizeUser(user),
    licenceNumber: row ? row.licence_number : null,
    licenceExpiryDate: row ? row.licence_expiry_date : null,
    address: row ? row.address : null,
  };
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
  if (/Android/.test(userAgent)) deviceName = 'Android';
  else if (/iPad|iPhone|iPod/.test(userAgent)) deviceName = 'iPhone / iPad';
  else if (/Mobile/.test(userAgent)) deviceName = 'Mobile';

  let osName = 'Unknown';
  if (/Windows NT 10/.test(userAgent)) osName = 'Windows';
  else if (/Windows/.test(userAgent)) osName = 'Windows';
  else if (/Android/.test(userAgent)) osName = 'Android';
  else if (/iPhone|iPad|iPod/.test(userAgent)) osName = 'iOS';
  else if (/Mac OS X/.test(userAgent)) osName = 'macOS';
  else if (/CrOS/.test(userAgent)) osName = 'ChromeOS';
  else if (/Linux/.test(userAgent)) osName = 'Linux';

  return { userAgent, browserName, deviceName, osName, ipAddress };
};

const SESSION_COOKIE = 'surveypro_session';

/* The session identifier lives only in an HttpOnly cookie: never in localStorage, never in the URL.
   "Keep me logged in" picks the longer of the two server-side lifetimes, it does not weaken the
   storage of the token. */
const issueSessionCookie = (res, sessionToken, { persistent = false } = {}) => {
  const maxAgeMs = persistent
    ? POLICY.rememberMeDays * 24 * 60 * 60 * 1000
    : POLICY.sessionHours * 60 * 60 * 1000;

  res.cookie(SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: maxAgeMs,
    path: '/',
  });
};

const clearSessionCookie = (res) => res.clearCookie(SESSION_COOKIE, { path: '/' });

/* Everything that has to happen when an identity is accepted: a brand-new session row (a fresh
   identifier each time, so nothing a previous request set can be replayed), the last-login stamp,
   and an activity entry that calls out a device this account has not been seen on before. */
const beginAuthenticatedSession = async ({ req, res, user, method, persistent = false }) => {
  const meta = getClientMetadata(req);
  const knownDevice = await findLatestActiveSession(user.id, meta);
  const sessionToken = await createSessionForUser(user.id, { persistent, metadata: meta });
  issueSessionCookie(res, sessionToken, { persistent });

  await updateLastLogin(user.id, { ipAddress: meta.ipAddress, userAgent: meta.userAgent });
  await recordLoginActivity({
    userId: user.id,
    loginMethod: method,
    eventType: knownDevice ? 'login' : 'new_device_login',
    status: 'success',
    browserName: meta.browserName,
    deviceName: meta.deviceName,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: {
      app: 'survey-desk',
      provider: method,
      new_device: !knownDevice,
      persistent: Boolean(persistent),
    },
  });

  const alerts = user.notification_preferences || {};
  if (!knownDevice && alerts.securityAlerts !== false) {
    try {
      await sendNewDeviceMail(user.email, {
        ...buildMailData(req, user),
        device: meta.deviceName,
        browser: meta.browserName,
        os: meta.osName,
        ip: meta.ipAddress,
      });
    } catch (error) {
      console.error('[auth] new device notification failed', error.message);
    }
  }

  return meta;
};

const buildGoogleCallbackUrl = (req = null) => {
  const explicit = String(process.env.GOOGLE_CALLBACK_URL || '')
    .trim()
    .replace(/\/$/, '');
  if (explicit) return explicit;

  const base = buildLandingUrl(req).replace(/\/$/, '');
  return `${base}/api/auth/google/callback`;
};

/* Google returns the browser to a server route, so the handover back into the app is a plain
   redirect: the session identifier stays in the HttpOnly cookie and nothing about the user is put
   into a URL that history, logs or a shoulder could read. */
const renderAuthSuccessHtml = (req, res) => {
  res.redirect(`${buildLandingUrl(req)}/index.html`);
};

const renderAuthErrorHtml = (message, req = null) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>SurveyPro Sign-in Error</title>
  </head>
  <body style="font-family: Arial, sans-serif; display:grid; place-items:center; min-height:100dvh; background:#f4f7fb; color:#1b2430; margin:0; padding:16px; box-sizing:border-box;">
    <div style="max-width:520px; background:#fff; border-radius:12px; padding:32px; box-shadow:0 12px 28px rgba(0,0,0,.08);">
      <h2 style="margin-top:0;">Google sign-in failed</h2>
      <p>${escMail(message)}</p>
      <p><a href="${escMail(`${buildLandingUrl(req)}/index.html`)}">Return to SurveyPro</a></p>
    </div>
  </body>
</html>`;

const smtpConfigured = Boolean(
  process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS
);

/* With no SMTP configured nodemailer buffers the message instead of delivering it, so the link is
   handed back to the caller for local testing. As soon as real mail is enabled that preview is
   switched off, because a live activation or reset token must never travel in an API response. */
const mailPreviewEnabled = !smtpConfigured && process.env.MAIL_PREVIEW !== 'off';

const createMailer = () => {
  if (smtpConfigured) {
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

const MAIL_LOGO = path.join(__dirname, 'assets', 'icons', 'icon-192.png');
const mailBrand = 'SurveyPro';
const escMail = (value) =>
  String(value || '').replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]
  );

/* One branded shell for every message SurveyPro sends, so activation, reset and security notices
   look like the same product and every link is also offered as plain text for blocked images. */
const mailShell = ({ greeting, intro, ctaLabel, ctaUrl, expiryNote, extraNote = '' }) => `
<div style="margin:0;padding:24px 16px;background:#f4f7fb;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:14px;border:1px solid #e3e9f2;overflow:hidden;">
    <tr>
      <td style="padding:22px 26px;border-bottom:1px solid #eef2f7;">
        <img src="cid:surveypro-logo" alt="${mailBrand}" width="56" height="56" style="display:block;border:0;border-radius:12px;" />
        <div style="margin-top:10px;font-size:18px;font-weight:bold;color:#0b3463;">${mailBrand}</div>
        <div style="font-size:12px;color:#5d6b7d;">Insurance claim survey &amp; loss assessment</div>
      </td>
    </tr>
    <tr>
      <td style="padding:24px 26px;color:#1b2430;font-size:15px;line-height:1.6;">
        ${greeting}
        ${intro}
        ${
          ctaLabel && ctaUrl
            ? `<p style="margin:26px 0;">
            <a href="${escMail(ctaUrl)}" style="display:inline-block;background:#0b5fa5;color:#ffffff;text-decoration:none;padding:13px 26px;border-radius:10px;font-weight:bold;">${escMail(
              ctaLabel
            )}</a></p>`
            : ''
        }
        ${
          ctaUrl
            ? `<p style="font-size:13px;color:#5d6b7d;word-break:break-all;">
            If the button does not work, copy this link into your browser:<br />
            <a href="${escMail(ctaUrl)}" style="color:#0b5fa5;">${escMail(ctaUrl)}</a></p>`
            : ''
        }
        ${expiryNote ? `<p style="font-size:13px;color:#8a3231;margin:18px 0 0;">${escMail(expiryNote)}</p>` : ''}
        ${extraNote ? `<p style="font-size:13px;color:#5d6b7d;margin:14px 0 0;">${escMail(extraNote)}</p>` : ''}
      </td>
    </tr>
    <tr>
      <td style="padding:18px 26px;background:#f8fafd;border-top:1px solid #eef2f7;font-size:12px;color:#5d6b7d;line-height:1.6;">
        Security notice: ${mailBrand} will never ask you for your password by email. If you did not
        request this, please sign in and change your password, or contact your administrator.
      </td>
    </tr>
  </table>
</div>`;

const deliverMail = async ({ to, subject, shell, text }) => {
  const mailOptions = {
    from: process.env.SMTP_FROM || `${mailBrand} <noreply@localhost>`,
    to,
    subject,
    html: shell,
    text,
  };
  if (fs.existsSync(MAIL_LOGO)) {
    mailOptions.attachments = [
      {
        filename: 'surveypro-logo.png',
        path: MAIL_LOGO,
        cid: 'surveypro-logo',
        contentType: 'image/png',
      },
    ];
  }

  const info = await createMailer().sendMail(mailOptions);
  return { messageId: info?.messageId || null };
};

/* A mailbox that is briefly unreachable is not a reason to lose a registration, an already-created
   activation token, or someone's sign-in. The message is logged and the flow continues; the user can
   always ask for a new link from the sign-in screen. */
const sendMailQuietly = async (label, send) => {
  try {
    await send();
    return true;
  } catch (error) {
    console.error(`[mail] ${label} delivery failed:`, error.message);
    return false;
  }
};

const mailGreeting = (firstName) =>
  `<p style="margin:0 0 14px;">Hello${firstName ? ` ${escMail(firstName)}` : ''},</p>`;

const sendVerificationMail = async (email, token, options = {}) => {
  const verifyLink = buildVerifyLink(token, options.req);
  const firstName = options.firstName || '';
  return deliverMail({
    to: email,
    subject: `Activate your ${mailBrand} account`,
    shell: mailShell({
      greeting: mailGreeting(firstName),
      intro: `<p style="margin:0;">Thank you for registering with ${mailBrand}. Click the button
        below to confirm this email address and activate your account. Your account stays
        inactive until you verify it.</p>`,
      ctaLabel: 'Activate my account',
      ctaUrl: verifyLink,
      expiryNote: `This activation link expires in ${POLICY.verifyTokenHours} hours and can be used only once.`,
      extraNote: 'You can request a new activation link from the sign-in screen at any time.',
    }),
    text: `Hello${firstName ? ` ${firstName}` : ''},

Thank you for registering with ${mailBrand}. Open the link below to activate your account:

${verifyLink}

This link expires in ${POLICY.verifyTokenHours} hours and can be used only once.

${mailBrand} will never ask you for your password by email.`,
  });
};

const sendEmailChangeMail = async (email, token, options = {}) => {
  const changeLink = buildEmailChangeLink(token, options.req);
  const firstName = options.firstName || '';
  return deliverMail({
    to: email,
    subject: `Confirm your new ${mailBrand} email address`,
    shell: mailShell({
      greeting: mailGreeting(firstName),
      intro: `<p style="margin:0;">Someone asked to move a ${mailBrand} account to this email
        address. Confirm it is yours by using the button below. Your old address stays in use until
        you confirm.</p>`,
      ctaLabel: 'Confirm this email address',
      ctaUrl: changeLink,
      expiryNote: `This confirmation link expires in ${POLICY.verifyTokenHours} hours and works only once.`,
      extraNote: 'If you did not ask to change your email address, you can ignore this message.',
    }),
    text: `Hello${firstName ? ` ${firstName}` : ''},

Confirm this email address for your ${mailBrand} account:

${changeLink}

The link expires in ${POLICY.verifyTokenHours} hours and can be used only once. If you did not request
this change, ignore this message.`,
  });
};

const sendResetMail = async (email, token, options = {}) => {
  const resetLink = buildResetLink(token, options.req);
  const firstName = options.firstName || '';
  return deliverMail({
    to: email,
    subject: `Reset your ${mailBrand} password`,
    shell: mailShell({
      greeting: mailGreeting(firstName),
      intro: `<p style="margin:0;">We received a request to reset the password for your ${mailBrand}
        account. Use the button below to choose a new password.</p>`,
      ctaLabel: 'Reset my password',
      ctaUrl: resetLink,
      expiryNote: `For your security this link expires in ${POLICY.resetTokenMinutes} minutes and works only once.`,
      extraNote:
        'If you did not request a password reset, no action is needed and your password stays unchanged.',
    }),
    text: `Hello${firstName ? ` ${firstName}` : ''},

We received a request to reset your ${mailBrand} password. Open this link to choose a new one:

${resetLink}

The link expires in ${POLICY.resetTokenMinutes} minutes and can be used only once.
If you did not request this, your password remains unchanged.`,
  });
};

const sendPasswordChangedMail = async (email, options = {}) => {
  const firstName = options.firstName || '';
  const when = options.when || new Date().toLocaleString();
  return deliverMail({
    to: email,
    subject: `Your ${mailBrand} password was changed`,
    shell: mailShell({
      greeting: mailGreeting(firstName),
      intro: `<p style="margin:0;">This is a security notification that the password for your
        ${mailBrand} account was changed on ${escMail(when)}${
          options.browser ? ` from ${escMail(options.browser)}` : ''
        }${options.ip ? ` (IP ${escMail(options.ip)})` : ''}. All other sessions were signed out.</p>`,
      ctaLabel: '',
      ctaUrl: '',
      extraNote:
        'If this was not you, sign in with a reset link immediately and contact your administrator.',
    }),
    text: `Your ${mailBrand} password was changed on ${when}${
      options.ip ? ` from IP ${options.ip}` : ''
    }. All other sessions were signed out. If this was not you, reset your password immediately.`,
  });
};

const sendNewDeviceMail = async (email, options = {}) => {
  const firstName = options.firstName || '';
  const when = options.when || new Date().toLocaleString();
  return deliverMail({
    to: email,
    subject: `New ${mailBrand} sign-in on a different device`,
    shell: mailShell({
      greeting: mailGreeting(firstName),
      intro: `<p style="margin:0;">Your ${mailBrand} account was signed in from a device we have not
        seen before: ${escMail(options.device || 'Unknown device')}, ${escMail(
          options.browser || 'Unknown browser'
        )}, ${escMail(options.os || 'Unknown operating system')} (IP ${escMail(options.ip || 'unknown')})
        on ${escMail(when)}.</p>`,
      ctaLabel: '',
      ctaUrl: '',
      extraNote:
        'If this was not you, change your password from Account → Security and sign out other devices.',
    }),
    text: `New ${mailBrand} sign-in: ${options.device} / ${options.browser} / ${options.os} from ${options.ip} on ${when}. If this was not you, change your password.`,
  });
};

const buildMailData = (req, user) => ({
  req,
  firstName: user ? displayName(user).split(' ')[0] : '',
});

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

/* Mail-sending endpoints get their own tighter budget: they are the cheapest way to make the server
   spam a mailbox, and a locked-out caller is told how long to wait. */
const mailRequestLimiter = (max) =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: 'Too many email requests from this device. Please try again in 15 minutes.',
      code: 'rate_limited',
    },
  });

const activationMailLimiter = mailRequestLimiter(5);
const resetMailLimiter = mailRequestLimiter(5);

const requireAuth = async (req, res, next) => {
  try {
    const cookieToken = req.cookies ? req.cookies[SESSION_COOKIE] : null;
    const session = cookieToken ? await validateSessionToken(cookieToken) : null;
    const user = session ? session.user : null;

    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!user.is_active) {
      return res.status(403).json({ error: 'Your account is disabled. Contact an administrator.' });
    }

    /* A registration that has not been activated is not a usable account, so it is stopped here
       rather than relying on each screen to ask. */
    if (!user.is_verified) {
      return res.status(403).json({
        error: 'Please verify your email address to activate your account.',
        code: 'email_not_verified',
      });
    }

    req.user = user;
    req.sessionId = session.sessionId;
    req.sessionPersistent = Boolean(session.persistent);

    if (user.must_change_password && !PASSWORD_CHANGE_ROUTES.has(req.path)) {
      return res.status(403).json({
        error: 'Set a new password before using SurveyPro.',
        code: 'password_change_required',
      });
    }

    next();
  } catch (error) {
    return res.status(500).json({ error: 'Authentication failed' });
  }
};

/* The three tiers an account can hold. The role is read from the signed session's database row,
   never from anything the client sends, and STAFF is the tier an administrator assigns when the
   member has no account of their own yet. */
const ROLES = { ADMIN: 'ADMIN', SURVEYOR: 'SURVEYOR', STAFF: 'STAFF' };
const normalizeRole = (role) => {
  const value = String(role || '').toUpperCase();
  if (value === ROLES.ADMIN) return ROLES.ADMIN;
  if (value === ROLES.SURVEYOR || value === 'PRINCIPAL_SURVEYOR') return ROLES.SURVEYOR;
  return ROLES.STAFF;
};

/* A role says who someone is; a permission says whether this particular action is allowed, and the
   brief wants the second question asked per action so one person can be widened or narrowed without
   inventing a fourth role. The set is resolved lazily and cached on the request, because the
   screens a member uses about their own account — profile, settings, security — never ask it. */
const loadPermissions = async (user) => resolvePermissions(user.id, normalizeRole(user.role));

const requirePermission = (permissionKey) => async (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  try {
    if (!req.permissions) req.permissions = new Set(await loadPermissions(req.user));
    if (!req.permissions.has(permissionKey)) {
      return res.status(403).json({
        error: 'Your account is not permitted to do that.',
        code: 'permission_denied',
        permission: permissionKey,
      });
    }
    return next();
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Authorization check failed.' });
  }
};

/* Brief §15 is about administrators specifically rather than about any account holding a
   permission, so these three routes keep a role check. Every other authorization question goes
   through requirePermission(). */
const requireAdmin = async (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  if (normalizeRole(req.user.role) !== ROLES.ADMIN) {
    return res
      .status(403)
      .json({ error: 'Only an administrator can do that.', code: 'admin_required' });
  }
  return next();
};

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const strongPasswordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{12,}$/;

/* Accounts are opened by an administrator with a password the member has not chosen. Until that
   password is replaced the account is only allowed to prove it can change it; everything else on
   the API would be working with a credential that has already travelled through someone else's
   screen. */
const PASSWORD_CHANGE_ROUTES = new Set([
  '/api/auth/me',
  '/api/auth/logout',
  '/api/account/change-password',
]);

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
/* Same-origin only. Reflecting every Origin with credentials:true let any website read a
   signed-in surveyor's /api responses through the browser; nothing in this app makes a
   cross-origin call, so no CORS grant is issued at all. Only the Origin header is judged —
   never Referer — because a top-level navigation (Google's callback back to /api/auth/google/callback)
   carries no Origin and must keep working. Cross-site form posts are already cookie-less thanks
   to SameSite=lax; this is the explicit second check. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
/* localhost, 127.0.0.1 and [::1] are one machine under three names, and a proxy can rewrite the
   Host header while the browser keeps the address that was typed. Comparing the two strings
   exactly turned every save from http://localhost:3000 into a cross-origin request when the Host
   said 127.0.0.1:3000. A site is therefore matched as alias-normalised host plus explicit port:
   another port, another machine or another name still refuses. Default ports resolve to "" on both
   sides, so https://host and a Host header of host agree. */
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1']);
const siteKey = (value, hasScheme) => {
  let url;
  try {
    url = new URL(hasScheme ? value : 'http://' + String(value).trim());
  } catch (error) {
    return null;
  }
  const name = url.hostname.replace(/^\[|\]$/g, '');
  return (LOOPBACK.has(name) ? 'loopback' : name) + ':' + url.port;
};
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!origin || SAFE_METHODS.has(req.method)) return next();
  const wanted = siteKey(origin, true);
  const served = siteKey(req.headers.host || '', false);
  if (!wanted || !served) return res.status(403).json({ error: 'Invalid Origin header.' });
  if (wanted !== served) {
    return res.status(403).json({ error: 'Cross-origin requests are not allowed.' });
  }
  next();
});
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser(sessionSecret));
/* The repo root is not a web root. It also holds .env, data/ (user records and tokens), db/,
   server logs and node_modules, and a blanket express.static(__dirname) used to hand any of them
   over on request — /data/users.json was downloadable. What the client actually loads is served
   explicitly; everything else falls through to the single-page route below and returns the app,
   never a file. */
const CLIENT_DIRS = ['js', 'css', 'vendor', 'assets'];
CLIENT_DIRS.forEach((dir) => {
  app.use(
    '/' + dir,
    express.static(path.join(__dirname, dir), {
      index: false,
      dotfiles: 'ignore',
      fallthrough: true,
    })
  );
});
['/index.html', '/sw.js', '/manifest.webmanifest'].forEach((file) => {
  app.get(file, (_req, res) => res.sendFile(path.join(__dirname, file.slice(1))));
});

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
    const firstName = String(payload.given_name || '').trim();
    const lastName = String(payload.family_name || '').trim();
    const fullName = String(payload.name || firstName || email.split('@')[0]).trim();
    const avatarUrl = String(payload.picture || '').trim();

    /* One email, one account: the Google subject is looked up first, then the verified email, and
       only an address that exists nowhere is allowed to become a new user. */
    let user = await findUserByGoogleSub(googleSub);
    if (!user) {
      user = await findUserByEmail(email);
    }

    if (!user) {
      user = await createUser({
        fullName,
        firstName,
        lastName,
        email,
        passwordHash: null,
        provider: 'google',
        role: ROLES.STAFF,
        googleSub,
        avatarUrl,
        emailVerified: true,
      });

      if (!user) {
        /* Lost a race with a manual registration on the same address: fall back to that account and
           link the Google identity to it, which is safe because Google verified the mailbox. */
        user = await findUserByEmail(email);
      }
    }

    if (!user) {
      return res
        .status(500)
        .send(renderAuthErrorHtml('Your account could not be prepared. Please try again.', req));
    }

    if (!user.is_active) {
      return res
        .status(403)
        .send(
          renderAuthErrorHtml('This account is disabled. Please contact an administrator.', req)
        );
    }

    if (user.email !== email) {
      return res
        .status(409)
        .send(
          renderAuthErrorHtml('A different account already exists for this Google email.', req)
        );
    }

    if (!user.google_sub) {
      user = await linkGoogleIdentity(user.id, {
        googleSub,
        avatarUrl,
        provider: user.password_hash ? user.provider : 'google',
        isVerified: true,
      });
    }

    await beginAuthenticatedSession({ req, res, user, method: 'google' });
    return renderAuthSuccessHtml(req, res);
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
  return res.json({ user: await withSurveyor(user) });
});

app.patch('/api/profile/me', requireAuth, async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const fullName = String(body.fullName || body.name || '')
      .trim()
      .slice(0, 255);
    const phoneNumber = String(body.phoneNumber || '').trim();
    const designation = String(body.designation || '').trim();
    const profileImageUrl = String(body.profileImageUrl || '').trim();

    const user = await findUserById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    let firstName = user.first_name;
    let lastName = user.last_name;
    let displayNameFromBody = fullName || user.full_name;

    if ('firstName' in body || 'lastName' in body) {
      firstName = String(body.firstName || '')
        .trim()
        .slice(0, 120);
      lastName = String(body.lastName || '')
        .trim()
        .slice(0, 120);
      if (!firstName) return res.status(400).json({ error: 'Enter your first name.' });
      if (!lastName) return res.status(400).json({ error: 'Enter your last name.' });
      displayNameFromBody = `${firstName} ${lastName}`;
    }

    const sendsSurveyor = ['licenceNumber', 'licenceExpiryDate', 'address'].some((k) => k in body);
    if (sendsSurveyor) {
      const licenceNumber = String(body.licenceNumber || '').trim();
      if (!LICENCE_RE.test(licenceNumber)) {
        return res.status(400).json({
          error: 'Surveyor licence number is required: 3-40 letters, digits, / or -.',
        });
      }
      const licenceExpiryDate = String(body.licenceExpiryDate || '').trim();
      if (licenceExpiryDate && !ISO_DATE_RE.test(licenceExpiryDate)) {
        return res
          .status(400)
          .json({ error: 'Licence expiry date must be a calendar date (YYYY-MM-DD).' });
      }
      await upsertSurveyorProfile(req.user.id, {
        licenceNumber,
        licenceExpiryDate: licenceExpiryDate || null,
        address:
          String(body.address || '')
            .trim()
            .slice(0, 500) || null,
      });
    }

    const updatePayload = {
      firstName,
      lastName,
      fullName: displayNameFromBody,
      phoneNumber: phoneNumber || user.phone_number || null,
      designation: designation || user.designation || null,
      profileImageUrl: profileImageUrl || user.profile_image_url || user.avatar_url || null,
    };

    const updated = await updateUserProfile(req.user.id, updatePayload);
    await recordAuditLog({
      actorUserId: req.user.id,
      targetUserId: req.user.id,
      action: 'profile_update',
      details: {
        updatedFields: Object.keys(updatePayload),
        surveyor: sendsSurveyor,
      },
    });

    return res.json({
      user: await withSurveyor(updated),
      message: 'Profile updated successfully.',
    });
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

/* Changing a password, or establishing the first one on a Google-only account. Both need a signed-in
   user, because setting a password on an account that has none is only safe once the identity has
   already been proven — for Google that is the OAuth assertion, not an email address. */
app.post('/api/account/change-password', requireAuth, async (req, res) => {
  try {
    const user = await findUserById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');
    const confirmPassword = String(req.body?.confirmPassword || '');

    if (!newPassword || !confirmPassword) {
      return res.status(400).json({ error: 'New password and confirmation are required.' });
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

    const establishing = !user.password_hash;
    /* A staff member's first change is already authenticated — login verified the temporary password
       moments ago, and making them retype it would mean holding on to a credential handed to them
       once in a dialog that disappears. */
    const forcedFirstChange = Boolean(user.must_change_password);

    if (establishing && user.provider !== 'google') {
      return res.status(400).json({ error: 'Current password is required.' });
    }
    if (!establishing && !forcedFirstChange) {
      if (!currentPassword) return res.status(400).json({ error: 'Current password is required.' });
      const currentMatches = await argon2
        .verify(user.password_hash, currentPassword)
        .catch(() => false);
      if (!currentMatches) {
        await recordLoginActivity({
          userId: user.id,
          loginMethod: 'email',
          eventType: 'password_change',
          status: 'failure',
          ...getClientMetadata(req),
          metadata: { app: 'survey-desk', reason: 'wrong_current_password' },
        });
        return res.status(401).json({ error: 'Current password is incorrect.' });
      }
    }

    const meta = getClientMetadata(req);
    const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
    await updatePasswordHash(user.id, passwordHash);
    await clearLoginFailures(user.id);
    const revokedOthers = await revokeOtherSessions(user.id, req.sessionId, 'password_change');

    await recordLoginActivity({
      userId: user.id,
      loginMethod: 'email',
      eventType: establishing ? 'password_created' : 'password_change',
      status: 'success',
      browserName: meta.browserName,
      deviceName: meta.deviceName,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { app: 'survey-desk', sessions_revoked: revokedOthers },
    });
    await recordAuditLog({
      actorUserId: user.id,
      targetUserId: user.id,
      action: establishing ? 'password_created' : 'password_changed',
      details: { method: 'self_service' },
    });

    try {
      await sendPasswordChangedMail(user.email, {
        ...buildMailData(req, user),
        browser: `${meta.browserName} on ${meta.osName}`,
        ip: meta.ipAddress,
      });
    } catch (error) {
      console.error('[auth] password change notification failed', error.message);
    }

    return res.json({
      ok: true,
      message: establishing
        ? 'A password has been added to your account. You can now sign in with Google or with your email and password.'
        : 'Password changed successfully.',
      sessionsSignedOut: revokedOthers,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Password change failed.' });
  }
});

/* A Google-only account asking to recover a password it never set is guided from the two places
   that already know the answer without turning this server into an email-enumeration oracle: the
   409 from registration ("use Continue with Google") and the google_only code from a password
   sign-in. Adding a password afterwards happens in Account → Security, once the Google session has
   proven the identity. */

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

    await sendMailQuietly('email change confirmation', () =>
      sendEmailChangeMail(newEmail, verification.rawToken, buildMailData(req, user))
    );
    await recordAuditLog({
      actorUserId: req.user.id,
      targetUserId: req.user.id,
      action: 'email_change_requested',
      details: { newEmail },
    });

    return res.json({
      ok: true,
      message: 'A confirmation email has been sent to your new address.',
      ...(mailPreviewEnabled
        ? { previewUrl: buildEmailChangeLink(verification.rawToken, req) }
        : {}),
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
  const sessions = await getActiveSessionsForUser(req.user.id, 5);
  return res.json({
    sessions: sessions.map((session) => ({
      id: session.id,
      browserName: session.browser_name || 'Unknown',
      deviceName: session.device_name || 'Unknown',
      osName: session.os_name || 'Unknown',
      ipAddress: session.ip_address || 'Unknown',
      persistent: Boolean(session.persistent),
      createdAt: session.created_at,
      lastActiveAt: session.last_active_at || session.last_seen_at,
      expiresAt: session.expires_at,
      isCurrent: Boolean(req.sessionId) && session.id === req.sessionId,
    })),
    policy: {
      sessionHours: POLICY.sessionHours,
      rememberMeDays: POLICY.rememberMeDays,
    },
  });
});

app.get('/api/security/login-activity', requireAuth, async (req, res) => {
  const entries = await getLoginActivityForUser(req.user.id, 5);
  return res.json({
    entries: entries.map((entry) => ({
      id: entry.id,
      eventType: entry.event_type,
      loginMethod: entry.login_method,
      status: entry.status,
      browserName: entry.browser_name || 'Unknown',
      deviceName: entry.device_name || 'Unknown',
      ipAddress: entry.ip_address || 'Unknown',
      createdAt: entry.created_at,
      metadata: entry.metadata || {},
    })),
  });
});

app.post('/api/security/logout-others', requireAuth, async (req, res) => {
  const revoked = await revokeOtherSessions(req.user.id, req.sessionId, 'logout_others');
  await recordAuditLog({
    actorUserId: req.user.id,
    targetUserId: req.user.id,
    action: 'other_sessions_revoked',
    details: { count: revoked },
  });

  return res.json({
    ok: true,
    revokedCount: revoked,
    message: revoked ? 'Other sessions have been signed out.' : 'No other sessions were active.',
  });
});

app.post('/api/security/revoke-session/:id', requireAuth, async (req, res) => {
  if (req.params.id === req.sessionId) {
    return res.status(400).json({
      error: 'Use Sign out to end the session you are in.',
      code: 'current_session',
    });
  }

  const session = await revokeSessionById(req.params.id, req.user.id, 'user_revoke');
  if (!session) {
    return res.status(404).json({ error: 'Session not found or already revoked.' });
  }

  await recordLoginActivity({
    userId: req.user.id,
    loginMethod: req.user.provider || 'email',
    eventType: 'session_terminated',
    status: 'success',
    ...getClientMetadata(req),
    metadata: { app: 'survey-desk', target_session: session.id },
  });

  return res.json({ ok: true, message: 'Session signed out.' });
});

/* The Audit Log screen has been asking for this route since it was written, but it never existed, so
   the rows have only ever accumulated. Capped rather than paginated: it is a review screen, and the
   newest entries are the ones anybody reads. */
app.get(
  '/api/admin/audit-logs',
  requireAuth,
  requirePermission('view_audit_log'),
  async (req, res) => {
    const requested = Number.parseInt(req.query?.limit, 10);
    const limit = Math.min(Math.max(Number.isFinite(requested) ? requested : 50, 1), 200);
    return res.json({ logs: await getAuditLogs(limit) });
  }
);

app.get('/api/admin/users', requireAuth, requirePermission('manage_users'), async (req, res) => {
  const result = await query(
    `SELECT id, full_name, email, role, provider, is_active, is_verified, created_at, last_login_at,
            must_change_password, admin_remarks
     FROM users
     WHERE deleted_at IS NULL
     ORDER BY created_at DESC`
  );

  return res.json({ users: result.rows });
});

/* A temporary password that has to satisfy the same strength rule as a chosen one. It is handed to
   the administrator once, never mailed, and the account refuses every other API call until the
   member replaces it, so the shared value is short-lived by design. */
const ALPHABETS = [
  'ABCDEFGHJKLMNPQRSTUVWXYZ',
  'abcdefghijkmnopqrstuvwxyz',
  '23456789',
  '!@#$%*-_=+',
];
const generateTemporaryPassword = () => {
  const pick = (set) => set[crypto.randomInt(set.length)];
  const chars = ALPHABETS.map(pick);
  while (chars.length < 14) chars.push(pick(ALPHABETS.join('')));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
};

app.post('/api/admin/users', requireAuth, requirePermission('manage_users'), async (req, res) => {
  try {
    const fullName = String(req.body?.fullName || '')
      .trim()
      .slice(0, 240);
    const email = String(req.body?.email || '')
      .trim()
      .toLowerCase();
    const phoneNumber = String(req.body?.phoneNumber || '')
      .trim()
      .slice(0, 40);
    const designation = String(req.body?.designation || '')
      .trim()
      .slice(0, 120);
    const remarks = String(req.body?.remarks || '')
      .trim()
      .slice(0, 2000);
    const role = normalizeRole(req.body?.role);
    const supplied = req.body?.temporaryPassword ? String(req.body.temporaryPassword) : '';
    const temporaryPassword = supplied || generateTemporaryPassword();

    if (!fullName) return res.status(400).json({ error: 'Enter the full name.' });
    if (!email || !emailRegex.test(email)) {
      return res.status(400).json({ error: 'Enter a valid email address.' });
    }
    if (!strongPasswordRegex.test(temporaryPassword)) {
      return res.status(400).json({
        error:
          'Temporary password must be at least 12 characters, include upper and lower case, a number, and a symbol.',
      });
    }

    if (await findUserByEmail(email)) {
      return res.status(409).json({ error: 'An account already uses that email address.' });
    }

    const passwordHash = await argon2.hash(temporaryPassword, { type: argon2.argon2id });
    const names = fullName.split(/\s+/);
    const user = await createUser({
      fullName,
      firstName: names.shift() || null,
      lastName: names.join(' ') || null,
      email,
      passwordHash,
      provider: 'email',
      role,
      /* An administrator opening the account is the activation; there is no inbox ownership to
         prove to a stranger, and forcing the link would leave the member locked out of the
         credentials they were just handed. */
      emailVerified: true,
    });

    if (!user) {
      return res.status(409).json({ error: 'An account already uses that email address.' });
    }

    await query(
      `UPDATE users
       SET phone_number = $2, designation = $3, admin_remarks = $4, must_change_password = TRUE,
           updated_at = NOW()
       WHERE id = $1`,
      [user.id, phoneNumber || null, designation || null, remarks || null]
    );

    await recordAuditLog({
      actorUserId: req.user.id,
      targetUserId: user.id,
      action: 'user_created',
      details: { email, role },
    });

    return res.status(201).json({
      ok: true,
      user: sanitizeUser({
        ...user,
        phone_number: phoneNumber,
        designation,
        must_change_password: true,
      }),
      temporaryPassword,
      message: `${displayName(user)} can sign in with this password. They will be asked to replace it.`,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'User creation failed.' });
  }
});

app.patch(
  '/api/admin/users/:id',
  requireAuth,
  requirePermission('manage_users'),
  async (req, res) => {
    const target = await findUserById(req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found.' });

    const fields = [];
    const values = [];
    const push = (column, value) => {
      values.push(value);
      fields.push(`${column} = $${values.length}`);
    };
    const before = { role: target.role, is_active: target.is_active };

    if (req.body?.role !== undefined) push('role', normalizeRole(req.body.role));
    if (req.body?.isActive !== undefined) push('is_active', Boolean(req.body.isActive));
    if (req.body?.remarks !== undefined) {
      push('admin_remarks', String(req.body.remarks).trim().slice(0, 2000) || null);
    }
    if (!fields.length) return res.status(400).json({ error: 'Nothing to change.' });

    push('updated_at', new Date());
    values.push(target.id);
    const result = await query(
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${values.length} RETURNING *`,
      values
    );

    await recordAuditLog({
      actorUserId: req.user.id,
      targetUserId: target.id,
      action: 'user_updated',
      details: {
        email: target.email,
        before,
        after: { role: result.rows[0].role, is_active: result.rows[0].is_active },
      },
    });

    /* Changing a role or disabling an account must not leave a session that still holds the old one. */
    if (before.role !== result.rows[0].role || before.is_active !== result.rows[0].is_active) {
      await revokeSessionsForUser(target.id, 'account_changed');
    }

    /* §12's account notice, in both directions. Being switched off is the one event in this list that
       the person cannot see coming from their own work, so the sentence has to arrive in the bell
       rather than as a failed sign-in; and a member who was suspended and reinstated would otherwise
       conclude from the same silence that they are still suspended. A role change is told as a changed
       assignment because that is what it changes: what can be handed to them from now on.

       The admin's own note about the account is deliberately not carried into the sentence: the screen
       that collects it calls it "a note for your own records", so it is an internal remark, and a
       remark written about a member is not something to hand to that member. */
    const nowActive = Boolean(result.rows[0].is_active);
    if (before.is_active !== nowActive) {
      await notify([target.id], {
        type: 'account_suspended',
        message: nowActive
          ? `${displayName(req.user)} reactivated this account. Sign in as usual.`
          : `${displayName(req.user)} deactivated this account. Contact an administrator to have it reopened.`,
        actorUserId: req.user.id,
      });
    }
    if (before.role !== result.rows[0].role) {
      await notify([target.id], {
        type: 'assignment_changed',
        message: `${displayName(req.user)} changed this account's role to ${
          result.rows[0].role
        }. Sign in again to see what that allows.`,
        actorUserId: req.user.id,
      });
    }

    return res.json({ ok: true, user: sanitizeUser(result.rows[0]) });
  }
);

app.post(
  '/api/admin/users/:id/reset-password',
  requireAuth,
  requirePermission('manage_users'),
  async (req, res) => {
    const target = await findUserById(req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found.' });

    const supplied = req.body?.temporaryPassword ? String(req.body.temporaryPassword) : '';
    const temporaryPassword = supplied || generateTemporaryPassword();
    if (!strongPasswordRegex.test(temporaryPassword)) {
      return res.status(400).json({
        error:
          'Temporary password must be at least 12 characters, include upper and lower case, a number, and a symbol.',
      });
    }

    const passwordHash = await argon2.hash(temporaryPassword, { type: argon2.argon2id });
    await updatePasswordHash(target.id, passwordHash);
    await query('UPDATE users SET must_change_password = TRUE, updated_at = NOW() WHERE id = $1', [
      target.id,
    ]);
    await clearLoginFailures(target.id);
    const revoked = await revokeSessionsForUser(target.id, 'password_reset');

    await recordAuditLog({
      actorUserId: req.user.id,
      targetUserId: target.id,
      action: 'password_reset_by_admin',
      details: { email: target.email, sessions_revoked: revoked },
    });

    /* The notice says that a password was reset and that another is needed, and never carries the
       temporary one: the bell is stored in a table, the password is shown once on the administrator's
       screen, and putting the second inside the first would make every past reset readable to anyone
       who can read an inbox. */
    await notify([target.id], {
      type: 'password_reset_requested',
      message: `${displayName(
        req.user
      )} reset this account's password. Sign in with the temporary password and replace it.`,
      actorUserId: req.user.id,
    });

    /* The administrator never sees the stored value and the member never sees the old one; only the
     replacement is shown, once. */
    return res.json({ ok: true, temporaryPassword, sessionsSignedOut: revoked });
  }
);

/* ---------- permissions ----------

   Nothing here is cached in the session. A permission is read from the database on every request
   that asks for it, so an administrator's change bites immediately and a member who was just
   restricted cannot finish a long open tab on the authority they had when it loaded. */

app.get('/api/auth/permissions', requireAuth, async (req, res) => {
  const role = normalizeRole(req.user.role);
  return res.json({ role, permissions: await resolvePermissions(req.user.id, role) });
});

/* The catalogue with each role's default, so the admin screen can say what a switch changes instead
   of keeping a second copy of the list in the browser that drifts from the first. */
app.get(
  '/api/permissions',
  requireAuth,
  requirePermission('manage_permissions'),
  async (req, res) => {
    return res.json({ permissions: await listPermissionCatalog() });
  }
);

app.get(
  '/api/admin/users/:id/permissions',
  requireAuth,
  requirePermission('manage_permissions'),
  async (req, res) => {
    const target = await findUserById(req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found.' });

    const role = normalizeRole(target.role);
    return res.json({
      user: { id: target.id, fullName: displayName(target), email: target.email, role },
      matrix: await getPermissionMatrix(target.id, role),
    });
  }
);

app.put(
  '/api/admin/users/:id/permissions',
  requireAuth,
  requirePermission('manage_permissions'),
  async (req, res) => {
    const target = await findUserById(req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found.' });

    const role = normalizeRole(target.role);
    if (role === ROLES.ADMIN) {
      return res.status(400).json({
        error: 'An administrator holds every permission, so there is nothing to override.',
      });
    }

    const changes = Array.isArray(req.body?.permissions) ? req.body.permissions : null;
    if (!changes) {
      return res.status(400).json({ error: 'Send the permissions as a list of { key, granted }.' });
    }
    if (!changes.length) return res.status(400).json({ error: 'Nothing to change.' });

    const known = new Set((await listPermissionCatalog()).map((row) => row.key));
    for (const change of changes) {
      const key = String(change?.key || '');
      if (!known.has(key)) {
        return res.status(400).json({ error: `Unknown permission: ${key.slice(0, 64)}` });
      }
      if (change.granted !== null && typeof change.granted !== 'boolean') {
        return res
          .status(400)
          .json({ error: `Permission ${key.slice(0, 64)} must be allowed, denied or cleared.` });
      }
    }

    await replaceUserPermissionOverrides(
      target.id,
      changes.map((change) => ({ key: change.key, granted: change.granted })),
      req.user.id
    );

    await recordAuditLog({
      actorUserId: req.user.id,
      targetUserId: target.id,
      action: 'user_permissions_updated',
      details: {
        email: target.email,
        role,
        changed: changes.map((change) => ({ key: change.key, granted: change.granted })),
      },
    });

    return res.json({
      ok: true,
      matrix: await getPermissionMatrix(target.id, role),
      message: 'Permissions saved.',
    });
  }
);

/* ---------- removing an administrator and handing the system over (brief §15) ----------

   This is the one place the app destroys its own control plane, so it is the one place that refuses
   to run while it would leave nobody in charge. The account is anonymized in place rather than
   deleted: the staff it opened, the records it touched and the audit rows naming it all stay. */

const DELETE_CONFIRMATION_PHRASE = 'DELETE MY ACCOUNT';

/* The password has to be retyped for both of these, and the check is the same, so it lives once.
   A Google-only administrator has no hash to check; for them the session itself is the proof, which
   is the same exception the password screens already make. */
const verifyCurrentPassword = async (user, candidate) => {
  if (!user.password_hash) return user.provider === 'google';
  if (!candidate) return false;
  return argon2.verify(user.password_hash, candidate).catch(() => false);
};

app.get('/api/admin/account-removal', requireAuth, requireAdmin, async (req, res) => {
  const summary = await getAccountRemovalSummary();
  const otherAdmins = summary.admins.filter((admin) => admin.id !== req.user.id);
  return res.json({
    activeUsers: summary.active_users,
    activeAdmins: summary.active_admins,
    otherAdmins,
    /* The count the warning screen shows for cases cannot come from here: they still live in this
       browser's storage, so the page reads them locally until task #21 puts them in Postgres. */
    mayDelete: otherAdmins.length > 0,
    message:
      otherAdmins.length > 0
        ? `${otherAdmins.length} other administrator${otherAdmins.length === 1 ? '' : 's'} will keep control.`
        : 'You are currently the only active administrator of SurveyPro. You must transfer administrative ownership to another eligible user before deleting your account.',
  });
});

/* An eligible successor is an active, verified Principal Surveyor — or an administrator, for the
   case where two of them want to rearrange who is in charge. Inactive and unverified accounts are
   refused outright, because handing the system to an account nobody can sign in with is worse than
   no handover at all. */
app.post('/api/admin/ownership-transfer', requireAuth, requireAdmin, async (req, res) => {
  if (!(await verifyCurrentPassword(req.user, String(req.body?.password || '')))) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }

  const target = await findUserById(req.body?.toUserId);
  if (!target) return res.status(404).json({ error: 'That user no longer exists.' });
  if (target.id === req.user.id) {
    return res.status(400).json({ error: 'You already hold administrative ownership.' });
  }
  if (!target.is_active) {
    return res
      .status(400)
      .json({ error: 'That account is disabled, so it cannot take ownership.' });
  }
  if (!target.is_verified) {
    return res.status(400).json({
      error: 'That account has not verified its email address, so it cannot take ownership.',
    });
  }
  const role = normalizeRole(target.role);
  if (role !== ROLES.SURVEYOR && role !== ROLES.ADMIN) {
    return res.status(400).json({
      error:
        'Only a Principal Surveyor or an existing administrator can take administrative ownership.',
    });
  }

  const outstanding = await findPendingOwnershipTransferForUser(target.id);
  if (outstanding) {
    return res.status(409).json({
      error: 'That user already has an ownership offer waiting for them.',
      code: 'transfer_pending',
    });
  }

  const transfer = await createOwnershipTransfer(req.user.id, target.id);
  await recordAuditLog({
    actorUserId: req.user.id,
    targetUserId: target.id,
    action: 'ownership_transfer_created',
    details: { to: target.email, transferId: transfer.id },
  });

  return res.status(201).json({
    ok: true,
    transfer: {
      id: transfer.id,
      toUser: { id: target.id, fullName: target.full_name, email: target.email, role },
    },
    message: `${target.full_name} has been asked to accept administrative ownership. Nothing changes until they do.`,
  });
});

/* The nominee's side. They may be a Principal Surveyor who is not an administrator, so this cannot
   sit behind requireAdmin — it is gated on being the person the offer was addressed to. */
app.get('/api/ownership-transfer/pending', requireAuth, async (req, res) => {
  const transfer = await findPendingOwnershipTransferForUser(req.user.id);
  return res.json({ transfer: transfer || null });
});

app.post('/api/ownership-transfer/:id/accept', requireAuth, async (req, res) => {
  const transfer = await findOwnershipTransferById(req.params.id);
  if (!transfer || transfer.status !== 'pending') {
    return res.status(404).json({ error: 'That ownership offer is no longer open.' });
  }
  if (transfer.to_user_id !== req.user.id) {
    return res.status(403).json({ error: 'That offer was addressed to someone else.' });
  }

  const successor = await findUserById(transfer.to_user_id);
  if (!successor || !successor.is_active || !successor.is_verified) {
    return res.status(400).json({
      error: 'Your account is not active and verified, so it cannot take administrative ownership.',
    });
  }

  const promoted = await query(
    `UPDATE users SET role = 'ADMIN', updated_at = NOW()
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING *`,
    [successor.id]
  );
  if (!promoted.rowCount) return res.status(404).json({ error: 'That user no longer exists.' });

  await resolveOwnershipTransfer(transfer.id, 'accepted');
  await recordAuditLog({
    actorUserId: successor.id,
    targetUserId: transfer.from_user_id,
    action: 'ownership_transfer_accepted',
    details: { transferId: transfer.id, promoted_to: 'ADMIN' },
  });

  return res.json({
    ok: true,
    user: sanitizeUser(promoted.rows[0]),
    message:
      'Administrative ownership is now yours. The previous administrator may remove their account.',
  });
});

app.post('/api/ownership-transfer/:id/decline', requireAuth, async (req, res) => {
  const transfer = await findOwnershipTransferById(req.params.id);
  if (!transfer || transfer.status !== 'pending') {
    return res.status(404).json({ error: 'That ownership offer is no longer open.' });
  }
  if (transfer.to_user_id !== req.user.id) {
    return res.status(403).json({ error: 'That offer was addressed to someone else.' });
  }

  await resolveOwnershipTransfer(transfer.id, 'declined');
  await recordAuditLog({
    actorUserId: req.user.id,
    targetUserId: transfer.from_user_id,
    action: 'ownership_transfer_declined',
    details: { transferId: transfer.id },
  });

  return res.json({ ok: true, message: 'The offer was declined and the administrator was told.' });
});

app.post('/api/admin/delete-my-account', requireAuth, requireAdmin, async (req, res) => {
  const confirmation = String(req.body?.confirmText || '').trim();
  if (confirmation !== DELETE_CONFIRMATION_PHRASE) {
    return res.status(400).json({
      error: `Type ${DELETE_CONFIRMATION_PHRASE} exactly to confirm.`,
      code: 'confirmation_required',
    });
  }
  if (!(await verifyCurrentPassword(req.user, String(req.body?.password || '')))) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }

  const summary = await getAccountRemovalSummary();
  if (summary.active_admins <= 1) {
    return res.status(409).json({
      error:
        'You are currently the only active administrator of SurveyPro. You must transfer administrative ownership to another eligible user before deleting your account.',
      code: 'last_administrator',
    });
  }

  const removed = await softDeleteAccount(req.user.id, req.user.id);
  if (!removed) return res.status(404).json({ error: 'That account no longer exists.' });

  /* Recorded before the sessions go, while the actor row still describes what happened. The id
       survives as a tombstone, so the entry stays attributable instead of becoming a NULL. */
  await recordAuditLog({
    actorUserId: req.user.id,
    targetUserId: req.user.id,
    action: 'admin_account_deleted',
    details: { remainingAdmins: summary.active_admins - 1 },
  });
  await revokeSessionsForUser(req.user.id, 'account_deleted');

  return res.json({
    ok: true,
    message:
      'Your administrator account has been removed. Cases, staff accounts and records were left untouched.',
  });
});

/* ---------------------------------------------------------------------------
   Case registry (§5)
   --------------------------------------------------------------------------- */

/* A case id is the browser's own — 'c' plus the base-36 timestamp of the moment it was created.
   Keeping it as the primary key rather than issuing a UUID is what makes every existing IndexedDB
   photograph key, localStorage key and JSON export continue to name the same case. */
const CASE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const caseText = (value) => {
  const text = value === null || value === undefined ? '' : String(value).trim();
  return text === '' ? null : text;
};

/* Absent values become NULL, not '', because §9D must never treat two cases as similar because
   neither of them has a chassis number filled in. */
const caseKey = (value) => {
  const text = caseText(value);
  if (!text) return null;
  const norm = text.toLowerCase().replace(/[^a-z0-9]/g, '');
  return norm === '' ? null : norm;
};

/* Epoch milliseconds from the client or an ISO string from an older export. Anything unreadable
   becomes null so the caller decides what a missing timestamp means. */
const caseInstant = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const ms = Number(value);
  const date = Number.isFinite(ms) && ms > 0 ? new Date(ms) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

/* The browser owns the shape of a case and the whole object travels in payload; these columns are
   only the ones something else has to filter, join or enforce — the duplicate check, the
   assignment list, the readiness rule. The vehicle identity is recorded on the policy section and
   again on the third-party section, so whichever has it wins rather than one being declared right. */
function indexCase(payload, ownerUserId) {
  const f = payload.f || {};
  const field = (key) => caseText(f[key]);
  return {
    id: payload.id,
    ownerUserId,
    module: caseText(payload.mod) || 'motor',
    caseNumber: field('case_claimNo'),
    policyNumber: field('case_policyNo'),
    insurer: field('case_company'),
    insuredName: field('pol_insured'),
    vehicleRegistration: field('case_insReg'),
    chassisNumber: field('pol_chs') || field('fp_chs'),
    engineNumber: field('pol_eng') || field('fp_eng'),
    accidentDate: field('case_acc'),
    surveyDate: field('case_survey'),
    stage: caseText(payload.st),
    priority: caseText(payload.pri),
    assignedSurveyor: field('case_surveyor'),
    dueDate: caseText(payload.due),
    createdAt: caseInstant(payload.cr),
    modifiedAt: caseInstant(payload.u),
    payload,
  };
}

const samePerson = (left, right) => {
  const a = caseText(left),
    b = caseText(right);
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
};

/* Which cases an account may list at all. Without either key the answer is none, and the route says
   so rather than quietly returning an empty register that looks like nobody has filed anything. */
const caseVisibility = (permissions) =>
  permissions.has('view_all_cases') ? 'all' : permissions.has('view_assigned_cases') ? 'own' : null;

/* Listing and opening follow the same rule: an administrator answers for every file, anyone holding
   view_all_cases reads the register, and otherwise the case has to be theirs — created under their
   account, naming them as the surveyor, or holding open work on it. The last is the §5 assignment:
   a member told to collect the photographs of a claim they cannot open has been given a task that
   cannot be done, so an open task is itself a reason the file is theirs. */
async function canAccessCase(row, user, permissions) {
  if (normalizeRole(user.role) === ROLES.ADMIN) return true;
  if (permissions.has('view_all_cases')) return true;
  if (row.owner_user_id === user.id) return true;
  if (samePerson(row.assignedSurveyor, displayName(user))) return true;
  return await isTaskAssigneeOnCase(row.id, user.id);
}

/* A refusal a screen never shows is a refusal nobody can find afterwards. The register is the place a
   case either is or is not, so every door of it notes on the server's own log who was turned away, from
   where, and under which rule — which is exactly the question "why does the other computer show
   nothing" asks. Nothing here decides anything: it only writes down what was already decided. */
const logCaseRefusal = (req, route, reason, caseId) => {
  const user = req.user || {};
  console.warn(
    `[cases] ${route} refused (${reason}) case=${caseId || '-'} user=${user.id || 'none'} role=${
      user.role || '-'
    } ip=${req.ip || '-'}`
  );
};

app.get('/api/cases', requireAuth, async (req, res) => {
  const permissions = req.permissions || new Set(await loadPermissions(req.user));
  const scope = caseVisibility(permissions);
  if (!scope) {
    logCaseRefusal(
      req,
      'GET /api/cases',
      'no case-view permission (needs view_all_cases or view_assigned_cases)'
    );
    return res.status(403).json({
      error: 'Your account is not permitted to view cases.',
      code: 'permission_denied',
      permission: 'view_assigned_cases',
    });
  }

  let since = null;
  if (req.query.since) {
    since = caseInstant(req.query.since);
    if (!since) return res.status(400).json({ error: 'The since value is not a valid timestamp.' });
  }

  const rows = await listCases({
    userId: scope === 'own' ? req.user.id : null,
    /* The same widening canAccessCase applies to one case, answered for the whole register at once
       rather than by asking the task table about every row that comes back. */
    alsoCaseIds: scope === 'own' ? await caseIdsAssignedAsTasks(req.user.id) : [],
    since,
    /* A device pulling the register to merge does not want to make one request per case, so it asks
       for the payloads it needs with the rows. Nothing else does, and nothing else gets them. */
    includePayload: req.query.payload === '1',
  });
  /* §11's unread marker belongs on the row that takes you to the thread, so the register carries the
     count with the case rather than making the screen open forty threads to find the two that changed.
     One query for the whole list, and only the ids this account was just allowed to see. */
  const commentUnread = await caseCommentUnreadCounts(
    req.user.id,
    rows.map((row) => row.id)
  );
  return res.json({
    scope,
    serverTime: new Date().toISOString(),
    cases: rows,
    commentUnread,
  });
});

app.get('/api/cases/:id', requireAuth, async (req, res) => {
  if (!CASE_ID_PATTERN.test(req.params.id)) {
    return res.status(400).json({ error: 'Unknown case.', code: 'case_not_found' });
  }
  const row = await findCaseById(req.params.id, { includePayload: true });
  if (!row) return res.status(404).json({ error: 'Unknown case.', code: 'case_not_found' });

  req.permissions = req.permissions || new Set(await loadPermissions(req.user));
  if (!(await canAccessCase(row, req.user, req.permissions))) {
    logCaseRefusal(req, 'GET /api/cases/:id', 'case outside this account', req.params.id);
    return res
      .status(403)
      .json({ error: 'That case is not yours to open.', code: 'case_forbidden' });
  }
  return res.json({ case: row });
});

/* One route covers a first save and every later one. An id that does not exist yet is a new case
   and needs create_case; an existing one is an edit and needs edit_case_details. The body is the
   browser's own case object, so the server indexes what it needs and stores the rest verbatim —
   it never edits a field, which is what would turn a sync into a place where information changes. */
app.put('/api/cases/:id', requireAuth, async (req, res) => {
  const id = req.params.id;
  if (!CASE_ID_PATTERN.test(id)) {
    return res.status(400).json({ error: 'That is not a case id.', code: 'invalid_case_id' });
  }
  const payload = req.body;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return res
      .status(400)
      .json({ error: 'The case body must be an object.', code: 'invalid_case' });
  }
  /* The id in the URL owns the row. A body naming a different case would let one request write two
     files, and a body with no id would be a case nothing can later address. */
  if (payload.id !== undefined && payload.id !== id) {
    return res
      .status(400)
      .json({ error: 'The case id in the body differs from the URL.', code: 'case_id_mismatch' });
  }

  req.permissions = req.permissions || new Set(await loadPermissions(req.user));
  const existing = await findCaseById(id);
  const creating = !existing;
  const permission = creating ? 'create_case' : 'edit_case_details';
  if (!req.permissions.has(permission)) {
    logCaseRefusal(req, 'PUT /api/cases/:id', `account lacks ${permission}`, id);
    return res.status(403).json({
      error: creating
        ? 'Your account is not permitted to open new cases.'
        : 'Your account is not permitted to edit case details.',
      code: 'permission_denied',
      permission,
    });
  }
  if (existing && !(await canAccessCase(existing, req.user, req.permissions))) {
    logCaseRefusal(req, 'PUT /api/cases/:id', 'case outside this account', id);
    return res
      .status(403)
      .json({ error: 'That case is not yours to edit.', code: 'case_forbidden' });
  }

  const record = indexCase({ ...payload, id }, creating ? req.user.id : existing.owner_user_id);
  /* A save that arrives with no usable timestamp is stamped by the server rather than refused: the
     browser is the one that knows when it last touched the case, but an export from a file with no
     modified time is still the same case, and dropping it would lose work. */
  if (!record.modifiedAt) record.modifiedAt = new Date().toISOString();

  const written = await upsertCase(record);
  if (!written) {
    const current = await findCaseById(id);
    return res.status(409).json({
      error: 'A newer version of this case is already on the server, so your copy was not applied.',
      code: 'case_conflict',
      serverModifiedAt: current ? current.modifiedAt : null,
      case: current,
    });
  }

  await recordAuditLog({
    actorUserId: req.user.id,
    action: creating ? 'case_created' : 'case_updated',
    details: { caseId: id, caseNumber: record.caseNumber, modifiedAt: record.modifiedAt },
  });

  return res.json({ ok: true, created: creating, case: await findCaseById(id) });
});

app.delete('/api/cases/:id', requireAuth, requirePermission('delete_case'), async (req, res) => {
  if (!CASE_ID_PATTERN.test(req.params.id)) {
    return res.status(400).json({ error: 'That is not a case id.', code: 'invalid_case_id' });
  }
  const existing = await findCaseById(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: 'Unknown case.', code: 'case_not_found' });
  }
  const removed = await deleteCase(req.params.id);
  if (!removed) return res.status(404).json({ error: 'Unknown case.', code: 'case_not_found' });

  await recordAuditLog({
    actorUserId: req.user.id,
    action: 'case_deleted',
    details: {
      caseId: req.params.id,
      caseNumber: existing.caseNumber,
      ownerUserId: existing.owner_user_id,
    },
  });
  return res.json({ ok: true });
});

/* §9D: candidates for a human to look at, never an automatic merge. Anything with the keys filled
   in is compared; the case being checked is excluded from its own results. */
app.get('/api/cases/:id/similar', requireAuth, async (req, res) => {
  if (!CASE_ID_PATTERN.test(req.params.id)) {
    return res.status(400).json({ error: 'Unknown case.', code: 'case_not_found' });
  }
  const row = await findCaseById(req.params.id);
  if (!row) return res.status(404).json({ error: 'Unknown case.', code: 'case_not_found' });

  req.permissions = req.permissions || new Set(await loadPermissions(req.user));
  if (!(await canAccessCase(row, req.user, req.permissions))) {
    return res
      .status(403)
      .json({ error: 'That case is not yours to open.', code: 'case_forbidden' });
  }

  const matches = await findSimilarCases({
    id: row.id,
    policyNumber: row.policyNumber,
    caseNumber: row.caseNumber,
    regNorm: caseKey(row.vehicleRegistration),
    chassisNorm: caseKey(row.chassisNumber),
    engineNorm: caseKey(row.engineNumber),
    insurer: row.insurer,
    accidentDate: row.accidentDate,
  });
  return res.json({ cases: matches });
});

/* ---------------------------------------------------------------------------
   Assignments and the approval workflow (§5, §6)

   One table holds both because the §5 assignment form is the thing that creates a task: case, staff,
   type, priority, dates and instructions. §16 names case_assignments and tasks separately, and an
   assignment with no task beside it would be a row nobody can act on.

   Every rule that decides whether a button may be pressed is answered here and not in the browser.
   §18 is explicit that a staff member must never gain a privilege by editing a request, so the
   permission keys, the assignee and the current status are read from the database on every call.
   --------------------------------------------------------------------------- */

const TASK_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* Spelled as §5 spells them, because these words are what an administrator reads on the form and
   what the history groups by. The database CHECKs the same list. */
const ASSIGNMENT_TYPES = [
  'Physical Inspection',
  'Document Collection',
  'Vehicle Information Entry',
  'Inspection Checklist',
  'Photograph Collection',
  'Repair Bill Collection',
  'Legal Document Collection',
  'Other',
];

/* The four words the dashboard already ranks work by (pri() in js/11-dashboard.js), so a task and
   the case it sits on are sorted with one vocabulary. */
const TASK_PRIORITIES = ['Urgent', 'High', 'Medium', 'Normal'];

/* The eight names from §6, the same list the database CHECKs. A task in none of them would be work
   nobody can act on, so this is the filter on the list route as well as the target of every move. */
const TASK_STATUSES = [
  'Assigned',
  'Accepted',
  'In Progress',
  'Submitted for Review',
  'Correction Required',
  'Resubmitted',
  'Approved',
  'Cancelled',
];

/* §6's workflow written as data: where each move can come from, who is allowed to make it, and what
   permission the maker must hold. Kept in one table because the seven routes that use it would
   otherwise each re-state a piece of it slightly differently — which is how a rule about approving
   your own work ends up missing from one of them. past is the word the message and the audit entry
   use, because the seven verbs do not take -ed in a way worth generating.

   by: 'assignee' — only the member the work was given to.
       'reviewer' — anyone holding the approval permission, except that member. §6: staff must not
                    mark a task as approved themselves, and the check is on the person, not the role,
                    so a principal surveyor who approves their own submission is refused too.
       'assigner' — the member who created the assignment, an administrator, or anyone who can
                    reassign: work that can be moved can be called back. */
const TASK_MOVES = {
  accept: { to: 'Accepted', from: ['Assigned'], by: 'assignee', past: 'accepted' },
  start: {
    to: 'In Progress',
    from: ['Assigned', 'Accepted', 'Correction Required'],
    by: 'assignee',
    past: 'started',
  },
  submit: {
    to: 'Submitted for Review',
    from: ['Assigned', 'Accepted', 'In Progress'],
    by: 'assignee',
    permission: 'submit_tasks',
    past: 'submitted',
  },
  resubmit: {
    to: 'Resubmitted',
    from: ['Correction Required'],
    by: 'assignee',
    permission: 'submit_tasks',
    past: 'resubmitted',
  },
  approve: {
    to: 'Approved',
    from: ['Submitted for Review', 'Resubmitted'],
    by: 'reviewer',
    permission: 'approve_task',
    past: 'approved',
  },
  reject: {
    to: 'Correction Required',
    from: ['Submitted for Review', 'Resubmitted'],
    by: 'reviewer',
    permission: 'approve_task',
    reason: true,
    past: 'returned for correction',
  },
  cancel: {
    to: 'Cancelled',
    from: [
      'Assigned',
      'Accepted',
      'In Progress',
      'Submitted for Review',
      'Correction Required',
      'Resubmitted',
    ],
    by: 'assigner',
    permission: 'assign_case',
    reason: true,
    past: 'withdrawn',
  },
};

const taskField = (value, max) => {
  const text = value === null || value === undefined ? '' : String(value).trim();
  if (text === '') return null;
  return text.slice(0, max);
};

/* A date the way the case registry keeps one: text, because a Nepali BS calendar string is not a
   valid Gregorian date and coercing it would be the "do not silently modify information" rule broken
   at the door. The shape is checked only enough to keep a stray payload out of a deadline column. */
const taskDate = (value) => {
  const text = taskField(value, 32);
  if (!text) return null;
  return /^[0-9A-Za-z-]{1,32}$/.test(text) ? text : undefined;
};

/* The task and the case it belongs to, with the rules that let this account act on it resolved in one
   place: an assignee always reaches their own work, and otherwise the case rules answer — the same
   canAccessCase that governs the file, so a task cannot become a side door into a case nobody may
   open. Returns null only after the answer has already been sent. */
async function loadTaskForAction(req, res) {
  if (!TASK_ID_PATTERN.test(req.params.id)) {
    res.status(404).json({ error: 'Unknown task.', code: 'task_not_found' });
    return null;
  }
  const task = await findTaskById(req.params.id);
  if (!task) {
    res.status(404).json({ error: 'Unknown task.', code: 'task_not_found' });
    return null;
  }
  const permissions = req.permissions || new Set(await loadPermissions(req.user));
  if (task.assigneeUserId === req.user.id) return { task, permissions };
  const caseRow = await findCaseById(task.caseId);
  if (!caseRow || !(await canAccessCase(caseRow, req.user, permissions))) {
    res.status(403).json({ error: 'That task is not yours to see.', code: 'task_forbidden' });
    return null;
  }
  return { task, permissions };
}

/* The same question the seven routes answer, asked before a button is drawn: may this account press
   this verb on this task as it stands? Null means yes; otherwise the exact response the route would
   have sent. One table answers both, so a screen cannot offer a transition the API is about to refuse,
   and the two cannot drift into disagreeing about who may approve what. §7's "do not rely on frontend
   button visibility for security" still holds — the route runs this again, and the requirement for a
   reason is deliberately not here, because that is about the payload rather than the person. */
function taskRefusal(task, action, { userId, permissions, isAdmin }) {
  const move = TASK_MOVES[action];
  if (!move)
    return { status: 400, body: { error: 'Unknown task action.', code: 'invalid_action' } };
  const isAssignee = task.assigneeUserId === userId;

  if (move.by === 'assignee' && !isAssignee) {
    return {
      status: 403,
      body: {
        error: 'Only the member this work was assigned to can do that.',
        code: 'task_not_yours',
      },
    };
  }
  if (move.by === 'reviewer' && isAssignee) {
    return {
      status: 403,
      body: {
        error: 'A task cannot be approved or returned by the member who did the work.',
        code: 'self_approval_forbidden',
      },
    };
  }
  if (
    move.by === 'assigner' &&
    !isAdmin &&
    task.assignedByUserId !== userId &&
    !permissions.has('reassign_case')
  ) {
    return {
      status: 403,
      body: {
        error:
          'Only the member who assigned this work, or one that can reassign it, can call it back.',
        code: 'task_not_yours',
      },
    };
  }
  if (move.permission && !permissions.has(move.permission)) {
    return {
      status: 403,
      body: {
        error: `Your account is not permitted to ${action} assigned work.`,
        code: 'permission_denied',
        permission: move.permission,
      },
    };
  }
  if (!move.from.includes(task.status)) {
    return {
      status: 409,
      body: {
        error: `Work that is ${task.status.toLowerCase()} cannot be ${move.past}.`,
        code: 'task_not_ready',
        status: task.status,
        allowed: move.from,
      },
    };
  }
  return null;
}

/* The verbs this account may press on this task, which is what every list below attaches to its rows.
   `reason` is not part of the answer: the client is asked for one when it presses, not before. */
const taskActions = (task, ctx) =>
  Object.keys(TASK_MOVES)
    .filter((action) => !taskRefusal(task, action, ctx))
    .map((action) => ({ action, requiresReason: Boolean(TASK_MOVES[action].reason) }));

const taskCtx = (req, permissions) => ({
  userId: req.user.id,
  permissions,
  isAdmin: normalizeRole(req.user.role) === ROLES.ADMIN,
});

/* The two things a task screen offers that are not status transitions: editing the brief and moving
   the work to somebody else. Mirrored from the PATCH and reassign routes' own conditions, for the same
   reason as above — and the deadline of a finished task is not offered because the route refuses it:
   a task must keep the deadline it was judged against. */
const taskCraft = (task, ctx) => ({
  edit:
    (ctx.isAdmin || task.assignedByUserId === ctx.userId || ctx.permissions.has('reassign_case')) &&
    task.status !== 'Approved' &&
    task.status !== 'Cancelled',
  reassign: ctx.permissions.has('reassign_case') && task.status !== 'Approved',
});

/* A task, or a list of them, with the buttons that would be legal for the account asking. Returned
   from the API rather than re-derived in the browser so the two cannot drift apart. */
const withActions = (taskOrRows, ctx) => {
  const rows = Array.isArray(taskOrRows) ? taskOrRows : [taskOrRows];
  const painted = rows.map((row) => ({
    ...row,
    actions: taskActions(row, ctx),
    craft: taskCraft(row, ctx),
  }));
  return Array.isArray(taskOrRows) ? painted : painted[0];
};

/* Every transition in one handler. The status is read from the row, not from the request, so the
   only thing a client can choose is which button it pressed. */
async function moveTask(req, res, action) {
  const loaded = await loadTaskForAction(req, res);
  if (!loaded) return;
  const { task, permissions } = loaded;
  const ctx = taskCtx(req, permissions);
  const isAssignee = task.assigneeUserId === req.user.id;

  const refusal = taskRefusal(task, action, ctx);
  if (refusal) return res.status(refusal.status).json(refusal.body);
  const move = TASK_MOVES[action];

  const reason = taskField(req.body && req.body.reason, 1000);
  /* §6 step 8: if rejected, the reviewer must provide a reason. A return with no reason is the member
     being told to do it again without being told what was wrong, so it is refused rather than
     accepted with an empty note. */
  if (move.reason && !reason) {
    return res.status(400).json({
      error: 'A reason is required when work is returned for correction.',
      code: 'reason_required',
    });
  }

  const updated = await moveTaskStatus({
    id: task.id,
    from: [task.status],
    to: move.to,
    action: move.past.split(' ')[0],
    actorUserId: req.user.id,
    reason,
  });
  /* null means the guarded UPDATE found nothing: somebody moved it between the read above and this
     statement. The task is re-read rather than assumed, because what the member is told next is what
     the status actually is now. */
  if (!updated) {
    const fresh = await findTaskById(task.id);
    return res.status(409).json({
      error: 'That task changed while you were acting on it. It has been reloaded.',
      code: 'task_changed',
      status: fresh && fresh.status,
    });
  }

  await recordAuditLog({
    actorUserId: req.user.id,
    targetUserId: isAssignee ? req.user.id : task.assigneeUserId,
    action: `task_${move.past.split(' ')[0]}`,
    details: {
      taskId: updated.id,
      caseId: updated.caseId,
      from: task.status,
      to: updated.status,
      reason,
    },
  });

  /* Four of the seven moves are §12 events, and the three that are not — accept, start, and a member's
     own submission reaching their own board — are the ones where the person moving already knows. What
     a move has to tell somebody is the answer to a question they asked by handing the work out: is it
     done, is it coming, and if it is not good enough, what exactly is wrong with it. The reason is
     carried into the notice rather than left behind in the task, because a member who is told to do it
     again without being told what was wrong has to open the case to find out, which is how a rejection
     becomes a delay. */
  const reviewer = task.assignedByUserId || (await caseOwnerOf(updated.caseId));
  const workName = `"${updated.assignmentType}" on case ${updated.caseId}`;
  const who = displayName(req.user);
  if (action === 'approve' || action === 'reject') {
    await notify([task.assigneeUserId], {
      type: action === 'approve' ? 'task_approved' : 'correction_requested',
      message:
        action === 'approve'
          ? `${who} approved ${workName}.`
          : `${who} returned ${workName} for correction: ${reason}`,
      actorUserId: req.user.id,
      caseId: updated.caseId,
      taskId: updated.id,
    });
  } else if (action === 'submit' || action === 'resubmit') {
    await notify([reviewer], {
      type: 'work_submitted',
      message: `${who} submitted ${workName} for review.`,
      actorUserId: req.user.id,
      caseId: updated.caseId,
      taskId: updated.id,
    });
  } else if (action === 'cancel') {
    await notify([task.assigneeUserId, reviewer], {
      type: 'assignment_changed',
      message: `${who} withdrew ${workName}.${reason ? ` Reason: ${reason}` : ''}`,
      actorUserId: req.user.id,
      caseId: updated.caseId,
      taskId: updated.id,
    });
  }

  /* The task as it now stands, with the verbs that are legal from here: approving work changes what
     the same screen may offer next, and the answer has to come from the same table that refused the
     button a moment ago. */
  return res.json({ ok: true, task: withActions(updated, ctx) });
}

app.get('/api/tasks', requireAuth, async (req, res) => {
  const permissions = req.permissions || new Set(await loadPermissions(req.user));
  const ctx = taskCtx(req, permissions);
  const scope = req.query.scope || 'mine';
  const openOnly = req.query.open === '1';
  const status = taskField(req.query.status, 30);
  if (status && !TASK_STATUSES.includes(status)) {
    return res
      .status(400)
      .json({ error: 'Unknown task status.', code: 'invalid_status', allowed: TASK_STATUSES });
  }

  if (scope === 'mine') {
    const tasks = await listTasks({ assigneeUserId: req.user.id, openOnly, status });
    return res.json({
      scope,
      counts: await countTasksForUser(req.user.id),
      tasks: withActions(tasks, ctx),
    });
  }
  if (scope === 'assigned') {
    const tasks = await listTasks({ assignedByUserId: req.user.id, openOnly, status });
    return res.json({ scope, tasks: withActions(tasks, ctx) });
  }
  if (scope === 'case') {
    const caseId = taskField(req.query.case, 64);
    if (!caseId || !CASE_ID_PATTERN.test(caseId)) {
      return res.status(400).json({ error: 'Unknown case.', code: 'case_not_found' });
    }
    const row = await findCaseById(caseId);
    if (!row) return res.status(404).json({ error: 'Unknown case.', code: 'case_not_found' });
    const reachable =
      (await canAccessCase(row, req.user, permissions)) ||
      (await isTaskAssigneeOnCase(caseId, req.user.id));
    if (!reachable) {
      return res
        .status(403)
        .json({ error: 'That case is not yours to open.', code: 'case_forbidden' });
    }
    const tasks = await listTasks({ caseId, openOnly, status });
    return res.json({ scope, case: row, tasks: withActions(tasks, ctx) });
  }
  if (scope === 'all') {
    if (!ctx.isAdmin && !permissions.has('view_all_cases')) {
      return res.status(403).json({
        error: 'Your account is not permitted to see every task.',
        code: 'permission_denied',
        permission: 'view_all_cases',
      });
    }
    const tasks = await listTasks({ openOnly, status });
    return res.json({ scope, tasks: withActions(tasks, ctx) });
  }
  return res.status(400).json({ error: 'Unknown task scope.', code: 'invalid_scope' });
});

app.get('/api/tasks/:id', requireAuth, async (req, res) => {
  const loaded = await loadTaskForAction(req, res);
  if (!loaded) return;
  const events = await listTaskEvents(loaded.task.id);
  return res.json({
    task: withActions(loaded.task, taskCtx(req, loaded.permissions)),
    events,
  });
});

app.post('/api/tasks', requireAuth, requirePermission('assign_case'), async (req, res) => {
  const body = req.body || {};
  const caseId = taskField(body.caseId, 64);
  if (!caseId || !CASE_ID_PATTERN.test(caseId)) {
    return res.status(400).json({ error: 'Unknown case.', code: 'case_not_found' });
  }
  const assignmentType = taskField(body.assignmentType, 40);
  if (!ASSIGNMENT_TYPES.includes(assignmentType)) {
    return res.status(400).json({
      error: 'Choose one of the assignment types.',
      code: 'invalid_assignment_type',
      allowed: ASSIGNMENT_TYPES,
    });
  }
  const priority = taskField(body.priority, 10) || 'Normal';
  if (!TASK_PRIORITIES.includes(priority)) {
    return res.status(400).json({
      error: 'Choose one of the priorities.',
      code: 'invalid_priority',
      allowed: TASK_PRIORITIES,
    });
  }
  const dueDate = taskDate(body.dueDate);
  if (dueDate === undefined) {
    return res.status(400).json({ error: 'That is not a date.', code: 'invalid_due_date' });
  }

  const permissions = req.permissions || new Set(await loadPermissions(req.user));
  const row = await findCaseById(caseId);
  if (!row) return res.status(404).json({ error: 'Unknown case.', code: 'case_not_found' });
  if (!(await canAccessCase(row, req.user, permissions))) {
    return res
      .status(403)
      .json({ error: 'That case is not yours to open.', code: 'case_forbidden' });
  }

  const assigneeId = taskField(body.assigneeUserId, 64);
  const assignee = assigneeId ? await findUserById(assigneeId) : null;
  if (!assignee) {
    return res
      .status(400)
      .json({ error: 'Choose a member to assign the work to.', code: 'invalid_assignee' });
  }
  /* Deactivating an account is how §15 suspends a person; a task addressed to one would sit there
     unclaimed and look like neglect. must_change_password is the same story in milder form — the
     account cannot reach the API yet, so the work could not be started. */
  if (!assignee.is_active) {
    return res.status(400).json({
      error: 'That member is deactivated and cannot be given work.',
      code: 'assignee_inactive',
    });
  }

  try {
    const task = await createTask({
      caseId,
      assignmentType,
      instructions: taskField(body.instructions, 4000),
      priority,
      assigneeUserId: assignee.id,
      assignedByUserId: req.user.id,
      dueDate,
    });
    await recordAuditLog({
      actorUserId: req.user.id,
      targetUserId: assignee.id,
      action: 'task_assigned',
      details: { taskId: task.id, caseId, assignmentType, assigneeUserId: assignee.id },
    });
    /* §12's first two bullets, from the one act that produces both. The member is told what they have
       been given and by when, because the deadline is the part of an assignment that cannot be found
       again without opening the task; the owner of the file is told that somebody else now has work on
       their case, which is the only way an assignment made by an administrator reaches the surveyor who
       is answerable for the claim. */
    await notify([assignee.id], {
      type: 'task_assigned',
      message: `${displayName(req.user)} assigned you "${assignmentType}" on case ${
        row.caseNumber || caseId
      }${dueDate ? `, due ${dueDate}.` : '.'}`,
      actorUserId: req.user.id,
      caseId,
      taskId: task.id,
    });
    if (row.ownerUserId && row.ownerUserId !== assignee.id) {
      await notify([row.ownerUserId], {
        type: 'case_assigned',
        message: `${displayName(req.user)} gave ${displayName(
          assignee
        )} work on case ${row.caseNumber || caseId}: ${assignmentType}.`,
        actorUserId: req.user.id,
        caseId,
        taskId: task.id,
      });
    }
    return res.status(201).json({ ok: true, task: withActions(task, taskCtx(req, permissions)) });
  } catch (error) {
    /* The unique open-task index. An honest 409 beats a second identical task: this member has
       already been asked for that inspection, and the button was pressed twice. */
    if (error && error.code === '23505') {
      return res.status(409).json({
        error: 'That member already holds an open task of this kind on this case.',
        code: 'task_duplicate',
      });
    }
    throw error;
  }
});

/* The four fields §5 lists as changeable afterwards — instructions, priority, deadline, and the kind
   of work. Opening a task is not editing it, so this never touches the status; that is what the
   seven moves below are for. */
app.patch('/api/tasks/:id', requireAuth, async (req, res) => {
  const loaded = await loadTaskForAction(req, res);
  if (!loaded) return;
  const { task, permissions } = loaded;
  const isAdmin = normalizeRole(req.user.role) === ROLES.ADMIN;
  if (!isAdmin && task.assignedByUserId !== req.user.id && !permissions.has('reassign_case')) {
    return res.status(403).json({
      error: 'Only the member who assigned this work can change it.',
      code: 'task_not_yours',
    });
  }

  const changes = {};
  if (req.body.assignmentType !== undefined) {
    const value = taskField(req.body.assignmentType, 40);
    if (!ASSIGNMENT_TYPES.includes(value)) {
      return res
        .status(400)
        .json({ error: 'Unknown assignment type.', code: 'invalid_assignment_type' });
    }
    changes.assignmentType = value;
  }
  if (req.body.priority !== undefined) {
    const value = taskField(req.body.priority, 10);
    if (!TASK_PRIORITIES.includes(value)) {
      return res.status(400).json({ error: 'Unknown priority.', code: 'invalid_priority' });
    }
    changes.priority = value;
  }
  if (req.body.dueDate !== undefined) {
    const value = taskDate(req.body.dueDate);
    if (value === undefined) {
      return res.status(400).json({ error: 'That is not a date.', code: 'invalid_due_date' });
    }
    changes.dueDate = value;
  }
  if (req.body.instructions !== undefined)
    changes.instructions = taskField(req.body.instructions, 4000);

  const updated = await updateTaskDetails(task.id, changes);
  if (!updated) {
    return res.status(409).json({
      error: 'That task is finished and its record is closed.',
      code: 'task_closed',
      status: task.status,
    });
  }

  await recordAuditLog({
    actorUserId: req.user.id,
    targetUserId: updated.assigneeUserId,
    action: 'task_updated',
    details: { taskId: updated.id, caseId: updated.caseId, changed: Object.keys(changes) },
  });
  /* §12 draws the line between the two notices by what changed, not by who changed it: rewritten
     instructions are an instruction, and a moved deadline or a new priority is a changed assignment. A
     call that did both sends both sentences, because the member has to be able to tell which of the
     two they are reading an answer to. */
  if (changes.instructions !== undefined) {
    await notify([updated.assigneeUserId], {
      type: 'admin_instruction',
      message: `${displayName(req.user)} rewrote the instructions for "${
        updated.assignmentType
      }" on case ${updated.caseId}.`,
      actorUserId: req.user.id,
      caseId: updated.caseId,
      taskId: updated.id,
    });
  }
  if (changes.dueDate !== undefined || changes.priority !== undefined) {
    await notify([updated.assigneeUserId], {
      type: 'assignment_changed',
      message: `${displayName(req.user)} changed ${
        changes.dueDate !== undefined && changes.priority !== undefined
          ? 'the deadline and priority'
          : changes.dueDate !== undefined
            ? 'the deadline'
            : 'the priority'
      } of "${updated.assignmentType}" on case ${updated.caseId}${
        changes.dueDate ? ` to ${changes.dueDate}` : ''
      }.`,
      actorUserId: req.user.id,
      caseId: updated.caseId,
      taskId: updated.id,
    });
  }
  return res.json({ ok: true, task: withActions(updated, taskCtx(req, permissions)) });
});

/* §5's reassign. Deliberately a different permission from assign_case: a member with assign_case may
   hand out work, and §2 forbids them moving it between people — which is what a reassignment is, and
   is why staff cannot transfer their own assignments to a colleague. */
app.post(
  '/api/tasks/:id/reassign',
  requireAuth,
  requirePermission('reassign_case'),
  async (req, res) => {
    const loaded = await loadTaskForAction(req, res);
    if (!loaded) return;
    const { task, permissions } = loaded;
    if (task.status === 'Approved') {
      return res.status(409).json({
        error: 'Approved work stays with the member who did it.',
        code: 'task_approved',
      });
    }
    const reason = taskField(req.body && req.body.reason, 1000);

    const assigneeId = taskField(req.body && req.body.assigneeUserId, 64);
    const assignee = assigneeId ? await findUserById(assigneeId) : null;
    if (!assignee) {
      return res
        .status(400)
        .json({ error: 'Choose a member to move the work to.', code: 'invalid_assignee' });
    }
    if (!assignee.is_active) {
      return res.status(400).json({
        error: 'That member is deactivated and cannot be given work.',
        code: 'assignee_inactive',
      });
    }

    try {
      const updated = await reassignTask({
        id: task.id,
        assigneeUserId: assignee.id,
        actorUserId: req.user.id,
        reason,
      });
      if (!updated) {
        return res.status(409).json({
          error: 'That task changed while you were moving it. It has been reloaded.',
          code: 'task_changed',
        });
      }
      await recordAuditLog({
        actorUserId: req.user.id,
        targetUserId: assignee.id,
        action: 'task_reassigned',
        details: {
          taskId: updated.id,
          caseId: updated.caseId,
          fromUserId: task.assigneeUserId,
          toUserId: assignee.id,
          reason,
        },
      });
      /* Both halves of §12's "an assignment is changed", in the same call, because the two people
         involved need opposite sentences: one is being handed work they did not ask for and has to know
         why, and the other is having work taken away and must not find out by opening a board that no
         longer shows it. */
      const movedWork = `"${updated.assignmentType}" on case ${updated.caseId}`;
      const who = displayName(req.user);
      await notify([assignee.id], {
        type: 'assignment_changed',
        message: `${who} moved ${movedWork} to you${reason ? `: ${reason}` : '.'}`,
        actorUserId: req.user.id,
        caseId: updated.caseId,
        taskId: updated.id,
      });
      await notify([task.assigneeUserId], {
        type: 'assignment_changed',
        message: `${who} took ${movedWork} away and gave it to ${displayName(
          assignee
        )}${reason ? `: ${reason}` : '.'}`,
        actorUserId: req.user.id,
        caseId: updated.caseId,
        taskId: updated.id,
      });
      return res.json({
        ok: true,
        task: withActions(updated, taskCtx(req, permissions)),
      });
    } catch (error) {
      if (error && error.code === '23505') {
        return res.status(409).json({
          error: 'That member already holds an open task of this kind on this case.',
          code: 'task_duplicate',
        });
      }
      throw error;
    }
  }
);

/* §5's "view assignment history" for the case screen: the work on the case and every move it has
   had, in one call, behind the same case rule as the case itself. */
app.get('/api/cases/:id/assignments', requireAuth, async (req, res) => {
  if (!CASE_ID_PATTERN.test(req.params.id)) {
    return res.status(400).json({ error: 'Unknown case.', code: 'case_not_found' });
  }
  const row = await findCaseById(req.params.id);
  if (!row) return res.status(404).json({ error: 'Unknown case.', code: 'case_not_found' });
  const permissions = req.permissions || new Set(await loadPermissions(req.user));
  if (!(await canAccessCase(row, req.user, permissions))) {
    return res
      .status(403)
      .json({ error: 'That case is not yours to open.', code: 'case_forbidden' });
  }
  return res.json({
    case: row,
    tasks: withActions(await listTasks({ caseId: row.id }), taskCtx(req, permissions)),
    history: await listTaskHistoryForCase(row.id),
  });
});

/* §5's form names the member the work goes to, so the assigner has to be able to pick a person out of
   the roster — which is wider than what §2 lets a staff account see, so this is gated on the same
   permission as the API that uses it. Deliberately not the admin table: an assigner chooses somebody to
   give a job to, not somebody to manage, so there is no email, no last login and nothing here a
   performance report could be built from. `designation` is the only disambiguator, and it is there
   because two surveyors with the same name are not unusual. */
app.get('/api/members', requireAuth, requirePermission('assign_case'), async (req, res) => {
  const result = await query(
    `SELECT id, full_name AS "fullName", role, designation,
            must_change_password AS "mustChangePassword"
     FROM users
     WHERE deleted_at IS NULL AND is_active = TRUE
     ORDER BY full_name`
  );
  return res.json({ members: result.rows });
});

Object.keys(TASK_MOVES).forEach((action) => {
  app.post(`/api/tasks/:id/${action}`, requireAuth, (req, res) => moveTask(req, res, action));
});

/* ---------------------------------------------------------------------------
   §8 DOCUMENT VERIFICATION — a file the server can see, and the decision about it
   ---------------------------------------------------------------------------
   A document becomes a record with bytes behind it, which is a new kind of thing for this server:
   until now every byte the field produced stayed in the browser that captured it. That is also why
   verification could not be built before this — an administrator cannot verify a scan that only
   exists on the phone that took it.

   The bytes are registered in two steps because the two halves fail separately. A phone with no
   signal can still say "I photographed the policy", and that fact is worth recording even when the
   upload has to wait; the reverse, bytes with no record of who sent them or under what name, is
   worthless. A row therefore exists as soon as the metadata does, with status 'Uploaded' and no
   file, and the arrival of the bytes is what moves it to 'Pending Verification'.

   A replacement never touches the old row. §8 asks for previous versions to be preserved, so the new
   file is a new version in the same thread and the superseded one keeps its bytes, its status and
   whoever verified it; the history of a document is then readable from the rows themselves rather
   than reconstructed from an audit trail.
   --------------------------------------------------------------------------- */

const DOCUMENT_ID_PATTERN = TASK_ID_PATTERN;

/* Spelled as §8 spells them, and CHECKed by the database the same way. 'Reports' stays separate from
   'Legal Documents' because the readiness check in §10 counts them differently. */
const DOC_CATEGORIES = [
  'Policy',
  'Intimation',
  'Inspection Photos',
  'Estimates',
  'Bills',
  'Legal Documents',
  'Reports',
  'Other Documents',
];
const DOC_STATUSES = [
  'Uploaded',
  'Pending Verification',
  'Verified',
  'Rejected',
  'Replacement Required',
];

/* The three decisions §8 names, as data rather than as three near-identical handlers: what each one
   moves the document to, what it may move from, and whether it has to be explained. Verification is
   only ever a step forward from 'Pending Verification' — a document with no bytes cannot be looked
   at, and one that has been sent back is settled by its replacement, not by pressing verify again. */
const DOC_DECISIONS = {
  verify: { to: 'Verified', from: ['Pending Verification'], past: 'verified', audit: 'verified' },
  reject: {
    to: 'Rejected',
    from: ['Pending Verification'],
    reason: true,
    past: 'rejected',
    audit: 'rejected',
  },
  request_replacement: {
    to: 'Replacement Required',
    from: ['Pending Verification'],
    reason: true,
    past: 'asked to be replaced',
    audit: 'replacement_requested',
  },
};

/* What a file may actually be, read from its first bytes rather than from a filename or a
   Content-Type header, both of which say whatever the sender wants them to say. A document here is
   something a person photographs or scans, so the list is the four formats the field produces, and
   anything else is refused before it reaches the disk. */
const DOC_FORMATS = [
  {
    mime: 'application/pdf',
    ext: 'pdf',
    looksLike: (head) => head.subarray(0, 5).toString('latin1') === '%PDF-',
  },
  {
    mime: 'image/jpeg',
    ext: 'jpg',
    looksLike: (head) => head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff,
  },
  {
    mime: 'image/png',
    ext: 'png',
    looksLike: (head) => head.subarray(0, 8).toString('hex') === '89504e470d0a1a0a',
  },
  {
    mime: 'image/webp',
    ext: 'webp',
    looksLike: (head) =>
      head.subarray(0, 4).toString('latin1') === 'RIFF' &&
      head.subarray(8, 12).toString('latin1') === 'WEBP',
  },
];

const DOC_MAX_BYTES = (() => {
  const configured = Number(process.env.DOCUMENT_MAX_BYTES);
  return Number.isFinite(configured) && configured >= 1024 * 1024
    ? Math.min(configured, 100 * 1024 * 1024)
    : 25 * 1024 * 1024;
})();

/* The words a document screen is allowed to offer, taken from the same lists the routes refuse with. A
   browser that kept its own copy of the eight categories would be a second place to change them, and
   §9's limit is set by the environment rather than by whoever last edited the frontend. */
const DOC_VOCAB = {
  categories: DOC_CATEGORIES,
  statuses: DOC_STATUSES,
  formats: DOC_FORMATS.map((format) => format.mime),
  maxBytes: DOC_MAX_BYTES,
};

/* Not in CLIENT_DIRS, deliberately: uploads/ is not a web root. Nothing in it is reachable without a
   session, a case rule and a document id, and the name on disk is the document id rather than
   anything the uploader called it. */
const UPLOAD_ROOT = path.join(__dirname, 'uploads');
const UUID_SHAPE = TASK_ID_PATTERN;

/* The path is built from two values that are each matched against a grammar that cannot contain a
   separator — the case id rule from §25 and a uuid — so there is no string a client can put in the
   database that would walk out of uploads/. */
const documentPath = (doc) =>
  CASE_ID_PATTERN.test(String(doc.caseId)) && UUID_SHAPE.test(String(doc.id))
    ? path.join(UPLOAD_ROOT, String(doc.caseId), String(doc.id))
    : null;

const readRawBody = (req, limit) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let received = 0;
    req.on('data', (chunk) => {
      received += chunk.length;
      if (received > limit) {
        reject(Object.assign(new Error('Document is larger than the limit.'), { tooLarge: true }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

/* Written to a side name and renamed, so an upload that dies halfway — a phone that loses signal is
   the ordinary case here — cannot leave a half-file that later reads as a document. */
const writeDocumentFile = async (filePath, buffer) => {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const temp = filePath + '.part';
  await fs.promises.writeFile(temp, buffer);
  await fs.promises.rename(temp, filePath);
};

const removeDocumentFile = (filePath) =>
  filePath ? fs.promises.rm(filePath, { force: true }).catch(() => {}) : Promise.resolve();

/* What the uploader's device called the file is kept, because that is often the only clue to which
   scan is which, but every character is checked by code point rather than by a pattern so there is
   no doubt about what survives: printable, no double quote (it would break the download header), no
   forward or backward slash (it would look like a path). */
const documentFilename = (value) => {
  const kept = [];
  for (const character of String(value === null || value === undefined ? '' : value)) {
    const code = character.codePointAt(0);
    if (code < 32 || code === 127 || code === 34 || code === 47 || code === 92) continue;
    kept.push(character);
  }
  const text = kept.join('').trim();
  return text ? text.slice(0, 180) : null;
};

/* The document and the case behind it, with the reachability rule already applied: a document cannot
   become a side door into a case the account may not open, which is the same rule a task is held to.
   Returns null only after the answer has been sent. */
async function loadDocumentForAction(req, res, id = req.params.id) {
  if (!DOCUMENT_ID_PATTERN.test(String(id))) {
    res.status(404).json({ error: 'Unknown document.', code: 'document_not_found' });
    return null;
  }
  const doc = await findDocumentById(id);
  if (!doc) {
    res.status(404).json({ error: 'Unknown document.', code: 'document_not_found' });
    return null;
  }
  const permissions = req.permissions || new Set(await loadPermissions(req.user));
  const caseRow = await findCaseById(doc.caseId);
  if (!caseRow || !(await canAccessCase(caseRow, req.user, permissions))) {
    res
      .status(403)
      .json({ error: 'That document is not yours to see.', code: 'document_forbidden' });
    return null;
  }
  return { doc, caseRow, permissions };
}

/* §7's rule, applied to documents the way it is applied to tasks: the answer to "may this account
   press this button on this file" comes from the server, so the screen that draws the button and the
   route that honours it cannot drift into disagreeing about who may verify what. */
function docRefusal(doc, action, ctx) {
  const superseded = {
    status: 409,
    body: { error: 'That version is already superseded.', code: 'document_superseded' },
  };

  if (action === 'remove') {
    /* §8: a verified document, or one a report rests on, is not something normal operations undo. The
       permission for the ordinary case is deliberately narrower than the permission to upload, and it
       only ever points at the uploader's own unverified file. */
    if (!doc.isCurrent) return superseded;
    if (ctx.isAdmin) return null;
    if (doc.status === 'Verified')
      return {
        status: 403,
        body: {
          error: 'A verified document is not deleted by normal operations.',
          code: 'document_verified',
        },
      };
    if (doc.uploadedBy !== ctx.userId)
      return {
        status: 403,
        body: {
          error: 'Only the member who uploaded it can remove it.',
          code: 'document_not_yours',
        },
      };
    if (doc.reportRelated)
      return {
        status: 403,
        body: {
          error: 'A report-related document is not deleted by normal operations.',
          code: 'document_report_related',
        },
      };
    if (!ctx.permissions.has('delete_own_unverified_uploads'))
      return {
        status: 403,
        body: {
          error: 'Your account is not permitted to remove an upload.',
          code: 'permission_denied',
          permission: 'delete_own_unverified_uploads',
        },
      };
    return null;
  }

  const decision = DOC_DECISIONS[action];
  if (decision) {
    if (!ctx.isAdmin && !ctx.permissions.has('verify_documents'))
      return {
        status: 403,
        body: {
          error: 'Verifying a document needs a separate permission from holding one.',
          code: 'permission_denied',
          permission: 'verify_documents',
        },
      };
    if (!doc.isCurrent) return superseded;
    if (!doc.hasFile)
      return {
        status: 409,
        body: {
          error: 'Nothing has been uploaded for this document yet.',
          code: 'document_no_file',
        },
      };
    if (!decision.from.includes(doc.status))
      return {
        status: 409,
        body: {
          error:
            'A document that is ' +
            String(doc.status).toLowerCase() +
            ' cannot be ' +
            decision.past +
            '.',
          code: 'document_not_ready',
          status: doc.status,
          allowed: decision.from,
        },
      };
    return null;
  }

  if (action === 'replace' || action === 'edit') {
    if (!doc.isCurrent) return superseded;
    if (ctx.isAdmin) return null;
    if (action === 'replace') {
      /* A verified file is the one a report already relies on, so swapping it is a decision rather
         than a correction and belongs to whoever may make decisions about documents. */
      if (doc.status === 'Verified')
        return {
          status: 403,
          body: {
            error: 'A verified document is replaced by whoever may verify it, not by an upload.',
            code: 'document_verified',
          },
        };
      if (!ctx.permissions.has('upload_documents'))
        return {
          status: 403,
          body: {
            error: 'Your account is not permitted to upload documents.',
            code: 'permission_denied',
            permission: 'upload_documents',
          },
        };
      return null;
    }
    if (
      ctx.permissions.has('verify_documents') ||
      (doc.uploadedBy === ctx.userId && ctx.permissions.has('upload_documents'))
    )
      return null;
    return {
      status: 403,
      body: { error: 'That document is not yours to change.', code: 'document_not_yours' },
    };
  }

  if (action === 'file') {
    /* The bytes belong to whoever registered the record, until somebody has made a decision about
       them; after that they are evidence, and only a replacement moves them. */
    if (!doc.isCurrent) return superseded;
    if (doc.hasFile)
      return {
        status: 409,
        body: {
          error: 'That document already has its file. Replace it to send another.',
          code: 'document_has_file',
        },
      };
    if (ctx.isAdmin || doc.uploadedBy === ctx.userId) return null;
    return {
      status: 403,
      body: {
        error: 'Only the member who registered this document can send its file.',
        code: 'document_not_yours',
      },
    };
  }

  return { status: 400, body: { error: 'Unknown document action.', code: 'invalid_action' } };
}

const docActions = (doc, ctx) =>
  Object.keys(DOC_DECISIONS)
    .filter((action) => !docRefusal(doc, action, ctx))
    .map((action) => ({ action, requiresReason: Boolean(DOC_DECISIONS[action].reason) }));

/* The five things a document screen offers that are not decisions about its status. `file` is here
   because a record with no bytes yet has nothing to open, and a list that offers a thumbnail for it
   would be showing a broken image. `send` is the same record seen from the other side — the screen that
   has to say "this one is still waiting for its file, and you are the one who owes it" cannot work that
   out from a boolean about bytes, and must not re-derive the rule either. */
const docCraft = (doc, ctx) => ({
  file: Boolean(doc.hasFile),
  send: !docRefusal(doc, 'file', ctx),
  replace: !docRefusal(doc, 'replace', ctx),
  edit: !docRefusal(doc, 'edit', ctx),
  remove: !docRefusal(doc, 'remove', ctx),
});

const withDocActions = (docOrRows, ctx) => {
  const rows = Array.isArray(docOrRows) ? docOrRows : [docOrRows];
  const painted = rows.map((row) => ({
    ...row,
    actions: docActions(row, ctx),
    craft: docCraft(row, ctx),
  }));
  return Array.isArray(docOrRows) ? painted : painted[0];
};

const docCtx = (req, permissions) => ({
  userId: req.user.id,
  permissions,
  isAdmin: normalizeRole(req.user.role) === ROLES.ADMIN,
});

/* The two answers §8 asks for are separate calls because they fail separately: a record that exists
   with no file is honest ("it was photographed, it has not arrived"), and a file that arrives with no
   record of who sent it and under what name is worthless. */
app.post('/api/documents', requireAuth, requirePermission('upload_documents'), async (req, res) => {
  const body = req.body || {};
  const caseId = typeof body.case === 'string' ? body.case.trim() : '';
  if (!CASE_ID_PATTERN.test(caseId)) {
    return res.status(400).json({ error: 'Unknown case.', code: 'case_not_found' });
  }
  const caseRow = await findCaseById(caseId);
  if (!caseRow) {
    return res.status(404).json({ error: 'Unknown case.', code: 'case_not_found' });
  }
  const permissions = req.permissions || new Set(await loadPermissions(req.user));
  if (!(await canAccessCase(caseRow, req.user, permissions))) {
    return res
      .status(403)
      .json({ error: 'That case is not yours to add documents to.', code: 'case_forbidden' });
  }

  const category = DOC_CATEGORIES.includes(body.category) ? body.category : null;
  if (!category) {
    return res.status(400).json({
      error: 'Every document needs one of the §8 categories.',
      code: 'invalid_category',
      allowed: DOC_CATEGORIES,
    });
  }
  const filename = documentFilename(body.filename);
  if (!filename) {
    return res.status(400).json({
      error: 'Give the document the name it arrived with.',
      code: 'invalid_filename',
    });
  }

  const doc = await createDocument({
    caseId,
    category,
    originalFilename: filename,
    status: 'Uploaded',
    reportRelated: body.reportRelated === true,
    uploadedBy: req.user.id,
  });
  await recordAuditLog({
    actorUserId: req.user.id,
    targetUserId: null,
    action: 'document_registered',
    details: { documentId: doc.id, caseId, category, filename },
  });
  return res.status(201).json({ document: withDocActions(doc, docCtx(req, permissions)) });
});

/* A replacement is a new row in the same thread, and the old one keeps everything it had: §8 asks for
   the previous versions to be preserved and the complete history recorded, which a row cannot do once
   its bytes have been overwritten. */
app.post('/api/documents/:id/replace', requireAuth, async (req, res) => {
  const loaded = await loadDocumentForAction(req, res);
  if (!loaded) return null;
  const ctx = docCtx(req, loaded.permissions);
  const refusal = docRefusal(loaded.doc, 'replace', ctx);
  if (refusal) return res.status(refusal.status).json(refusal.body);

  const body = req.body || {};
  const previous = loaded.doc;
  const category =
    body.category === undefined || DOC_CATEGORIES.includes(body.category)
      ? body.category === undefined
        ? previous.category
        : body.category
      : null;
  if (!category) {
    return res.status(400).json({
      error: 'Every document needs one of the §8 categories.',
      code: 'invalid_category',
      allowed: DOC_CATEGORIES,
    });
  }
  /* The name carries over unless the sender says otherwise, because a re-photograph of the same bill
     is the same document — the point of the thread is that it reads as one thing with two versions. */
  const filename =
    body.filename === undefined ? previous.originalFilename : documentFilename(body.filename);
  if (!filename) {
    return res
      .status(400)
      .json({ error: 'Give the document the name it arrived with.', code: 'invalid_filename' });
  }

  const doc = await replaceDocument(
    previous,
    {
      caseId: previous.caseId,
      category,
      originalFilename: filename,
      status: 'Uploaded',
      reportRelated:
        body.reportRelated === undefined ? previous.reportRelated : body.reportRelated === true,
      uploadedBy: req.user.id,
    },
    req.user.id
  );
  if (!doc) {
    return res.status(409).json({
      error: 'That document was replaced a moment ago.',
      code: 'document_superseded',
    });
  }
  await recordAuditLog({
    actorUserId: req.user.id,
    targetUserId: previous.uploadedBy,
    action: 'document_replaced',
    details: {
      documentId: doc.id,
      previousDocumentId: previous.id,
      caseId: previous.caseId,
      version: doc.version,
    },
  });
  /* No notice here, deliberately. A replacement record with no bytes behind it is a promise rather
     than an answer, and the queue a verifier works from lists documents that are waiting to be checked
     — so telling them now would send them to a document that is not on their list yet. The bell rings
     when the file lands, in the route below. */
  return res.status(201).json({ document: withDocActions(doc, ctx) });
});

/* The bytes themselves: read from the stream rather than from a JSON field, because a scan is not a
   string and the app's 2 MB JSON ceiling exists for the payloads that are. The kind of file is
   decided from its first bytes, the size is counted rather than trusted from a header, and the hash
   is computed here so the duplicate question in §9 has an answer a renamed file cannot dodge. */
app.put('/api/documents/:id/file', requireAuth, async (req, res) => {
  const loaded = await loadDocumentForAction(req, res);
  if (!loaded) return null;
  const ctx = docCtx(req, loaded.permissions);
  const refusal = docRefusal(loaded.doc, 'file', ctx);
  if (refusal) return res.status(refusal.status).json(refusal.body);

  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > DOC_MAX_BYTES) {
    return res.status(413).json({
      error: 'That file is larger than the server accepts.',
      code: 'document_too_large',
      maxBytes: DOC_MAX_BYTES,
    });
  }

  let buffer;
  try {
    buffer = await readRawBody(req, DOC_MAX_BYTES);
  } catch (error) {
    if (error && error.tooLarge) {
      return res.status(413).json({
        error: 'That file is larger than the server accepts.',
        code: 'document_too_large',
        maxBytes: DOC_MAX_BYTES,
      });
    }
    return res
      .status(400)
      .json({ error: 'The upload could not be read.', code: 'document_body_unreadable' });
  }

  if (!buffer.length) {
    return res.status(400).json({ error: 'That file arrived empty.', code: 'document_empty' });
  }
  const format = DOC_FORMATS.find((candidate) => candidate.looksLike(buffer));
  if (!format) {
    return res.status(415).json({
      error: 'A document must be a PDF, JPEG, PNG or WebP file.',
      code: 'document_type_unsupported',
      allowed: DOC_FORMATS.map((candidate) => candidate.mime),
    });
  }

  const filePath = documentPath(loaded.doc);
  if (!filePath) {
    return res.status(409).json({
      error: 'This document cannot be stored.',
      code: 'document_storage_refused',
    });
  }
  await writeDocumentFile(filePath, buffer);

  const updated = await attachDocumentFile(loaded.doc.id, {
    actorUserId: req.user.id,
    mimeType: format.mime,
    byteSize: buffer.length,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
  });
  if (!updated) {
    /* The row went away under the upload — a delete from another tab, most likely. The bytes are the
       only thing left, and an untracked file on the server is exactly what §2 was written to avoid. */
    await removeDocumentFile(filePath);
    return res.status(404).json({ error: 'Unknown document.', code: 'document_not_found' });
  }

  await recordAuditLog({
    actorUserId: req.user.id,
    targetUserId: updated.uploadedBy,
    action: 'document_uploaded',
    details: {
      documentId: updated.id,
      caseId: updated.caseId,
      category: updated.category,
      byteSize: updated.byteSize,
      sha256: updated.sha256,
    },
  });
  /* §12's "staff submits work", for the one submission the field really makes. A first upload is
     already visible to whoever checks documents because it is on their queue, so it needs no notice;
     a replacement is different, because the person who wrote the reason the uploader is answering has
     no way of seeing that the thread moved on without one. The name to tell is read off the version
     that was sent back, which is the row that carries the decision. */
  if (updated.supersedesDocumentId && updated.status === 'Pending Verification') {
    const previous = await findDocumentById(updated.supersedesDocumentId);
    const askedBy = previous && (previous.rejectedBy || previous.verifiedBy);
    await notify([askedBy], {
      type: 'work_submitted',
      message: `${displayName(req.user)} replaced ${updated.category.toLowerCase()} "${
        updated.originalFilename
      }" on case ${updated.caseId}; version ${updated.version} is ready to be checked.`,
      actorUserId: req.user.id,
      caseId: updated.caseId,
      documentId: updated.id,
    });
  }
  return res.json({ document: withDocActions(updated, ctx) });
});

/* Which cases this account may read documents for at all: null means the whole register, because the
   account is an administrator or holds view_all_cases, and an array means exactly the cases the case
   rules already allow open — including the ones held only by an open task. The list comes from
   listCases rather than a second copy of the rule, so a document can never widen what a case allows
   and the two cannot drift apart. */
async function visibleCaseIdsForDocuments(req, permissions) {
  if (normalizeRole(req.user.role) === ROLES.ADMIN || permissions.has('view_all_cases'))
    return null;
  const rows = await listCases({
    userId: req.user.id,
    alsoCaseIds: await caseIdsAssignedAsTasks(req.user.id),
  });
  return rows.map((row) => row.id);
}

/* Three questions a screen actually asks, and no more than the case rules already answer:
     scope=case   every document on one case, current versions unless asked otherwise
     scope=queue  the documents waiting for a decision, which needs verify_documents
     scope=mine   what this account sent, their own records whatever the case says
   A document with no visible case and no upload by this account is not reachable by guessing an id,
   because every single-document route runs the same case rule. */
app.get('/api/documents', requireAuth, async (req, res) => {
  const permissions = req.permissions || new Set(await loadPermissions(req.user));
  const ctx = docCtx(req, permissions);
  /* A query that names a case means the documents of that case: a screen that asks for one case and
     silently gets "whatever this account uploaded, everywhere" would be reading something else. */
  const scope = req.query.scope || (req.query.case ? 'case' : 'mine');
  const status = req.query.status ? String(req.query.status).slice(0, 30) : null;
  if (status && !DOC_STATUSES.includes(status)) {
    return res.status(400).json({
      error: 'Unknown document status.',
      code: 'invalid_status',
      allowed: DOC_STATUSES,
    });
  }
  const category = req.query.category ? String(req.query.category).slice(0, 40) : null;
  if (category && !DOC_CATEGORIES.includes(category)) {
    return res.status(400).json({
      error: 'Unknown document category.',
      code: 'invalid_category',
      allowed: DOC_CATEGORIES,
    });
  }
  const currentOnly = req.query.allVersions !== '1';

  if (scope === 'case') {
    const caseId = req.query.case ? String(req.query.case).trim() : '';
    if (!CASE_ID_PATTERN.test(caseId)) {
      return res.status(400).json({ error: 'Unknown case.', code: 'case_not_found' });
    }
    const caseRow = await findCaseById(caseId);
    if (!caseRow || !(await canAccessCase(caseRow, req.user, permissions))) {
      return res
        .status(403)
        .json({ error: 'That case is not yours to open.', code: 'case_forbidden' });
    }
    return res.json({
      scope,
      vocab: DOC_VOCAB,
      case: caseRow,
      documents: withDocActions(
        await listDocuments({ caseId, status, category, currentOnly }),
        ctx
      ),
      /* The same five tiles the other scopes get, counted for this claim alone: on the case tab they
         answer "what is still owed here", which is the question the tab is opened to ask. */
      counts: await countDocumentsByStatus({ caseIds: [caseId] }),
    });
  }

  if (scope === 'queue') {
    if (!ctx.isAdmin && !permissions.has('verify_documents')) {
      return res.status(403).json({
        error: 'Your account does not verify documents.',
        code: 'permission_denied',
        permission: 'verify_documents',
      });
    }
    const caseIds = await visibleCaseIdsForDocuments(req, permissions);
    const rows = await listDocuments({
      caseIds,
      status: status || 'Pending Verification',
      category,
      currentOnly,
    });
    return res.json({
      scope,
      vocab: DOC_VOCAB,
      documents: withDocActions(rows, ctx),
      counts: await countDocumentsByStatus({ caseIds }),
    });
  }

  if (scope === 'mine') {
    const rows = await listDocuments({
      uploaderUserId: req.user.id,
      status,
      category,
      currentOnly,
    });
    return res.json({
      scope,
      vocab: DOC_VOCAB,
      documents: withDocActions(rows, ctx),
      counts: await countDocumentsByStatus({ uploaderUserId: req.user.id }),
    });
  }

  return res.status(400).json({ error: 'Unknown document scope.', code: 'invalid_scope' });
});

/* One document, its versions and its story — the panel §8's "record the complete history" needs, in
   the one call that opens it. A superseded version is returned with the rest rather than hidden,
   because a replacement that cannot be compared with what it replaced is not a history. */
app.get('/api/documents/:id', requireAuth, async (req, res) => {
  const loaded = await loadDocumentForAction(req, res);
  if (!loaded) return null;
  const ctx = docCtx(req, loaded.permissions);
  return res.json({
    document: withDocActions(loaded.doc, ctx),
    case: loaded.caseRow,
    versions: withDocActions(await listDocumentVersions(loaded.doc.threadId), ctx),
    events: await listDocumentEvents(loaded.doc.id),
  });
});

/* The bytes, behind the same case rule as the record. They are served with the type the server
   decided from the file itself rather than anything the client said it was, never sniffed by the
   browser, and never as something that can run: a photograph is displayed, not executed. */
app.get('/api/documents/:id/file', requireAuth, async (req, res) => {
  const loaded = await loadDocumentForAction(req, res);
  if (!loaded) return null;
  const { doc } = loaded;
  const filePath = documentPath(doc);
  if (!doc.hasFile || !filePath) {
    return res.status(409).json({
      error: 'Nothing has been uploaded for this document yet.',
      code: 'document_no_file',
    });
  }
  const format = DOC_FORMATS.find((candidate) => candidate.mime === doc.mimeType);
  if (!format) {
    /* The row predates the whitelist, or was written by something other than this route. Serving it
       with an unknown type would be the browser's guess about a file the server did not check. */
    return res.status(415).json({
      error: 'This file is not in a format the server records.',
      code: 'document_type_unsupported',
    });
  }

  let size;
  try {
    size = (await fs.promises.stat(filePath)).size;
  } catch (error) {
    return res.status(410).json({
      error: 'The stored file is no longer on this server.',
      code: 'document_file_missing',
    });
  }

  res.setHeader('Content-Type', format.mime);
  res.setHeader('Content-Length', size);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  /* inline so a scan opens in the page rather than downloading on a phone in the field. The name was
     stripped of quotes and separators when the document was registered, so it needs no escaping
     here — one rule, applied where the value enters the system. */
  res.setHeader('Content-Disposition', 'inline; filename="' + doc.originalFilename + '"');
  res.setHeader('Cache-Control', 'private, max-age=86400, immutable');
  fs.createReadStream(filePath).pipe(res);
});

/* One handler for the three decisions, because §8 describes them as one thing: somebody with the
   right to check documents says what the file is. The reason is required where the answer is no, and
   it is required by the route rather than by the screen — a rejection nobody can read about later is
   the difference between a decision and a disappearance. */
async function decideDocument(req, res, action) {
  const loaded = await loadDocumentForAction(req, res);
  if (!loaded) return null;
  const ctx = docCtx(req, loaded.permissions);
  const refusal = docRefusal(loaded.doc, action, ctx);
  if (refusal) return res.status(refusal.status).json(refusal.body);
  const move = DOC_DECISIONS[action];

  const reason = taskField((req.body || {}).reason, 2000);
  if (move.reason && !reason) {
    return res.status(400).json({
      error: 'Say what is wrong with the document before sending it back.',
      code: 'reason_required',
    });
  }

  const updated = await moveDocumentStatus({
    id: loaded.doc.id,
    actorUserId: req.user.id,
    fromStatuses: move.from,
    toStatus: move.to,
    reason,
  });
  if (!updated) {
    const fresh = await findDocumentById(loaded.doc.id);
    return res.status(409).json({
      error: 'That document changed while you were deciding.',
      code: 'document_changed',
      status: fresh && fresh.status,
    });
  }

  /* §8's "notify the uploader when a document is rejected or needs replacement" is this bullet of §12,
     written once. The uploader is the only person who can act on it — the file is theirs and the
     reason is now a sentence attached to it — so the notice goes to them and to nobody else, and the
     reason is carried into the message rather than left for them to discover by opening the case. */
  const decider = displayName(req.user);
  if (action === 'reject' || action === 'request_replacement') {
    await notify([updated.uploadedBy], {
      type: action === 'reject' ? 'document_rejected' : 'correction_requested',
      message: `${decider} ${
        action === 'reject' ? 'rejected' : 'asked for a new copy of'
      } ${updated.category.toLowerCase()} "${updated.originalFilename}" on case ${
        updated.caseId
      }${reason ? `: ${reason}` : '.'}`,
      actorUserId: req.user.id,
      caseId: updated.caseId,
      documentId: updated.id,
    });
  }
  await recordAuditLog({
    actorUserId: req.user.id,
    targetUserId: updated.uploadedBy,
    action: 'document_' + move.audit,
    details: {
      documentId: updated.id,
      caseId: updated.caseId,
      category: updated.category,
      from: loaded.doc.status,
      to: updated.status,
      reason,
    },
  });
  return res.json({ ok: true, document: withDocActions(updated, ctx) });
}

Object.keys(DOC_DECISIONS).forEach((action) => {
  app.post(`/api/documents/:id/${action}`, requireAuth, (req, res) =>
    decideDocument(req, res, action)
  );
});

/* Filing a document under the wrong category is a correction to the record, not a new version: the
   bytes are the same file, and §8's version history is about the file. The report-related flag lives
   here for the same reason, and it is the flag that later protects the row from a routine delete. */
app.patch('/api/documents/:id', requireAuth, async (req, res) => {
  const loaded = await loadDocumentForAction(req, res);
  if (!loaded) return null;
  const ctx = docCtx(req, loaded.permissions);
  const refusal = docRefusal(loaded.doc, 'edit', ctx);
  if (refusal) return res.status(refusal.status).json(refusal.body);

  const body = req.body || {};
  const changes = {};
  if (body.category !== undefined) {
    if (!DOC_CATEGORIES.includes(body.category)) {
      return res.status(400).json({
        error: 'Unknown document category.',
        code: 'invalid_category',
        allowed: DOC_CATEGORIES,
      });
    }
    changes.category = body.category;
  }
  if (body.filename !== undefined) {
    const filename = documentFilename(body.filename);
    if (!filename) {
      return res
        .status(400)
        .json({ error: 'Give the document the name it arrived with.', code: 'invalid_filename' });
    }
    changes.originalFilename = filename;
  }
  if (body.reportRelated !== undefined) changes.reportRelated = body.reportRelated === true;
  if (!Object.keys(changes).length) {
    return res.status(400).json({
      error: 'Say what to change about the document.',
      code: 'document_no_changes',
    });
  }

  const updated = await updateDocumentDetails(loaded.doc.id, req.user.id, changes);
  if (!updated) {
    return res.status(409).json({
      error: 'That version is already superseded.',
      code: 'document_superseded',
    });
  }
  await recordAuditLog({
    actorUserId: req.user.id,
    targetUserId: null,
    action: 'document_updated',
    details: { documentId: updated.id, caseId: updated.caseId, changes },
  });
  return res.json({ document: withDocActions(updated, ctx) });
});

/* The removal §8 allows: the uploader's own file, before anybody has verified it, and never one a
   report rests on. The bytes go with the row and the audit entry keeps what no longer has a record of
   its own — the name, the hash, the case and who removed it — which is as far as a deletion of an
   unverified upload should reach. */
app.delete('/api/documents/:id', requireAuth, async (req, res) => {
  const loaded = await loadDocumentForAction(req, res);
  if (!loaded) return null;
  const ctx = docCtx(req, loaded.permissions);
  const refusal = docRefusal(loaded.doc, 'remove', ctx);
  if (refusal) return res.status(refusal.status).json(refusal.body);

  const { doc } = loaded;
  const removed = await deleteDocumentRow(doc.id);
  if (!removed) {
    return res.status(404).json({ error: 'Unknown document.', code: 'document_not_found' });
  }
  await removeDocumentFile(documentPath(doc));
  await recordAuditLog({
    actorUserId: req.user.id,
    targetUserId: doc.uploadedBy,
    action: 'document_deleted',
    details: {
      documentId: doc.id,
      caseId: doc.caseId,
      category: doc.category,
      filename: doc.originalFilename,
      sha256: doc.sha256,
      version: doc.version,
      status: doc.status,
    },
  });
  return res.json({ ok: true, id: doc.id });
});

/* ---------------------------------------------------------------------------
   Case comments and notifications (§11, §12)
   ---------------------------------------------------------------------------
   Two halves of one promise. §11 is the conversation about a claim — what was said, by whom, when, in
   reply to what, with which file attached — and §12 is the answer to "how does anyone find out that
   something was said?" A thread nobody reads and a bell nobody can act on are both decoration, so both
   live here, on the same case rule, and both are written by the events that already happen elsewhere in
   this file rather than by anything a browser has to remember to call.

   Nothing in either half is deletable. §11 closes with communications being "preserved in its activity
   history", which is a rule about the record rather than a preference about the interface, so there is
   no DELETE route for a comment and no edit: the thread is append-only and a correction is a reply. The
   same holds for a notification — read is the only thing that can change about one, which is why the
   two routes below both end in /read.

   The audience for a comment notice is the case rule seen from the other side: whoever owns the file,
   whoever holds open work on it, and whoever can see every case. That list, and not a name typed into
   an @box, decides who is told — because a person mentioned in a claim they cannot open would receive a
   notice that leads to a door that will not open for them, and §2 says a staff member's register is
   their own work. The writer is told which of their @tokens did that, in the response, rather than
   finding out weeks later that nobody read the instruction.
   --------------------------------------------------------------------------- */

const COMMENT_ID_PATTERN = TASK_ID_PATTERN;
const COMMENT_MAX_CHARS = 4000;

/* §12's twelve events, spelled once. The thirteenth is not in that list: §11 says a mention sends a
   notification and a reply tells the person being answered, and neither of those is any of the twelve —
   dressing a colleague's reply up as an admin instruction would put words in the bell that the office
   did not say. */
const NOTIFICATION_TYPES = [
  'case_assigned',
  'task_assigned',
  'deadline_approaching',
  'deadline_missed',
  'document_rejected',
  'task_approved',
  'correction_requested',
  'admin_instruction',
  'work_submitted',
  'assignment_changed',
  'account_suspended',
  'password_reset_requested',
  'case_comment',
];

/* How far ahead of a deadline the bell starts saying something. §12 asks for "approaching" without a
   number; the dashboard's own preliminary/final warning window is three days (js/11-dashboard.js), so
   the bell and the board count down with the same clock. */
const DEADLINE_NOTICE_DAYS = (() => {
  const configured = Number(process.env.DEADLINE_NOTICE_DAYS);
  return Number.isFinite(configured) && configured >= 0 && configured <= 90
    ? Math.floor(configured)
    : 3;
})();

/* One writer for every notice in the application. Two things make it worth having rather than twelve
   insert calls: a notification is a courtesy, not a transaction — the rejection that failed to tell
   anybody is still a rejection, so a notice that cannot be written is logged and dropped instead of
   turning a successful action into a 500 — and the recipient list always loses the person who caused
   the event, because nobody needs to be told about the button they just pressed.

   The try/catch is also what keeps this from becoming an unhandled rejection when a caller decides not
   to await it, which is the only way a notice is ever fire-and-forget: a route that has already sent
   its answer cannot be failed by a bell. */
async function notify(
  userIds,
  {
    type,
    message,
    actorUserId = null,
    caseId = null,
    taskId = null,
    documentId = null,
    commentId = null,
  }
) {
  try {
    if (!NOTIFICATION_TYPES.includes(type)) {
      console.error('[notify] unknown notification type', String(type));
      return [];
    }
    const text = taskField(message, 500);
    if (!text) return [];
    const recipients = [...new Set((userIds || []).filter(Boolean))].filter(
      (id) => id !== actorUserId
    );
    if (!recipients.length) return [];
    return await insertNotifications(
      null,
      recipients.map((userId) => ({
        userId,
        actorUserId,
        type,
        message: text,
        caseId,
        taskId,
        documentId,
        commentId,
      }))
    );
  } catch (error) {
    console.error('[notify] notification write failed', error.message);
    return [];
  }
}

/* The person answerable for a file, for the notices that are meant for whoever owns the case rather
   than for everybody who can see it. Null is a real answer — a case imported without an owner exists —
   and notify() drops it rather than inventing a recipient. */
async function caseOwnerOf(caseId) {
  const row = await findCaseById(caseId);
  return row ? row.ownerUserId : null;
}

/* The two notices the calendar produces, and the only part of the bell that is not written by an event.
   The rule is re-read on every inbox call — a due date moved since yesterday must not leave "due
   tomorrow" hanging on the bell — and then three cases are compared against what is already there: a
   deadline that is still exactly as it was is left alone, one whose sentence has changed replaces the
   row it superseded, and one that has gone away is dropped. What is deliberately never touched is a
   notice that has been read: that row is the record of what the person was told, and re-raising it is
   the job of the window below rather than of this comparison. */
const DEADLINE_TYPES = ['deadline_approaching', 'deadline_missed'];

/* Writing the sentence is the whole of the notice — a bell entry that says "deadline" without a date
   and without naming the work is not something a person can act on from where they are standing. */
const deadlineMessage = (row) => {
  const what = row.taskId
    ? `${row.subject || 'Assigned work'}${row.caseNumber ? ` on case ${row.caseNumber}` : ''}`
    : `Case ${row.caseNumber || row.caseId}`;
  return row.type === 'deadline_missed'
    ? `${what} was due on ${row.dueDate} and is ${-row.days} day${
        -row.days === 1 ? '' : 's'
      } overdue.`
    : `${what} is due on ${row.dueDate}${
        row.days === 0 ? ' — today.' : ` — ${row.days} day${row.days === 1 ? '' : 's'} away.`
      }`;
};

async function refreshDeadlineNotices(userId) {
  const current = await deadlineRows(userId, { soonDays: DEADLINE_NOTICE_DAYS });
  /* A backlog of old dates must not become a wall of text on somebody's first morning: the nearest
     twenty are what the bell holds, and the rest are still on the case list. */
  const wanted = current.slice(0, 20).map((row) => {
    const notice = {
      userId,
      actorUserId: null,
      type: row.type,
      message: deadlineMessage(row),
      caseId: row.caseId,
      taskId: row.taskId,
    };
    return { key: `${row.type}|${row.caseId || ''}|${row.taskId || ''}`, notice };
  });
  const wantedByKey = new Map(wanted.map((entry) => [entry.key, entry]));

  const open = await openDeadlineNotices(userId, DEADLINE_TYPES);
  const openByKey = new Map(open.map((row) => [`${row.type}|${row.caseId}|${row.taskId}`, row]));
  const superseded = open
    .filter((row) => {
      const next = wantedByKey.get(`${row.type}|${row.caseId}|${row.taskId}`);
      return !next || next.notice.message !== row.message;
    })
    .map((row) => row.id);
  if (superseded.length) await deleteNotifications(userId, superseded);

  const dismissed = new Set(
    await recentNoticeKeys(userId, { types: DEADLINE_TYPES, withinDays: 1 })
  );
  const fresh = wanted
    .filter((entry) => !openByKey.has(entry.key))
    .filter((entry) => !dismissed.has(entry.key))
    .map((entry) => entry.notice);
  if (!fresh.length) return 0;
  return (await insertNotifications(null, fresh)).length;
}

/* @tokens are read out of the message the way a reader reads them, and a token is only a mention if the
   sentence actually contains it. That is what stops a payload naming people who were never mentioned,
   and it is why the client sends candidate strings rather than a list of ids it decided on: who exists
   is a question for the database, and resolveMentions answers it — a token matching two accounts or
   none tells nobody, because a guess about who was meant is a notice sent to the wrong person. */
function mentionTokens(body, claimed) {
  const lower = String(body || '').toLowerCase();
  const found = new Set();
  const claims = (Array.isArray(claimed) ? claimed : [])
    .slice(0, 20)
    .map((candidate) =>
      String(candidate || '')
        .trim()
        .toLowerCase()
    )
    .filter(Boolean);
  claims.forEach((token) => {
    if (lower.includes('@' + token)) found.add(token);
  });
  /* A sentence ends with a full stop, and an address does not: the token is read up to the last
     character that could belong to an account, so "@note-worker. And" names a person rather than
     inventing one whose address ends in a period. */
  (String(body || '').match(/@([\w][\w.@-]{0,63})/g) || []).forEach((token) => {
    const name = token
      .slice(1)
      .toLowerCase()
      .replace(/[.@_-]+$/, '');
    if (!name) return;
    /* A two-word name written in full is one mention, not two. "@Kiran Shrestha" is the whole of the
       address and the screen said so; the word the regular expression could reach is its first name
       alone, and reporting that as a stranger would tell the writer that nobody was notified in the
       same breath as the sentence naming the person who was. */
    if (
      claims.some(
        (claim) => claim !== name && claim.startsWith(name) && lower.includes('@' + claim)
      )
    )
      return;
    found.add(name);
  });
  return [...found];
}

/* The thread and the case it hangs on, decided by the one case rule the whole server uses — the same
   canAccessCase that governs the file and the task, so a comment cannot become a side door into a
   claim somebody may not open, and cannot be hidden from a member who is entitled to the case. */
async function loadCaseForComments(req, res) {
  const caseId = req.params.id;
  if (!CASE_ID_PATTERN.test(caseId)) {
    res.status(400).json({ error: 'That is not a case id.', code: 'invalid_case_id' });
    return null;
  }
  const caseRow = await findCaseById(caseId);
  if (!caseRow) {
    res.status(404).json({ error: 'Unknown case.', code: 'case_not_found' });
    return null;
  }
  const permissions = req.permissions || new Set(await loadPermissions(req.user));
  if (!(await canAccessCase(caseRow, req.user, permissions))) {
    res.status(403).json({ error: 'That case is not yours to open.', code: 'case_forbidden' });
    return null;
  }
  return { caseRow, permissions };
}

app.get('/api/cases/:id/comments', requireAuth, async (req, res) => {
  const loaded = await loadCaseForComments(req, res);
  if (!loaded) return undefined;
  const thread = await listCaseComments(loaded.caseRow.id, req.user.id);
  const can = {
    comment: loaded.permissions.has('add_case_comments'),
    /* "Admin adds instructions" is §12's words for the same act §11 describes as a comment, so an
       instruction is a flag on a comment rather than a second kind of message — and the flag is held
       by the people who may hand out work, which is who an instruction comes from. */
    instruct: loaded.permissions.has('assign_case'),
  };
  return res.json({
    caseId: loaded.caseRow.id,
    can,
    maxChars: COMMENT_MAX_CHARS,
    unread: thread.filter((row) => row.unread).length,
    comments: thread,
  });
});

/* A new note, or a reply to one. The three things the route decides, rather than the screen: the words
   are the writer's, who they were said about is the database's, and who is told about it is the case's. */
app.post(
  '/api/cases/:id/comments',
  requireAuth,
  requirePermission('add_case_comments'),
  async (req, res) => {
    const loaded = await loadCaseForComments(req, res);
    if (!loaded) return undefined;
    const { caseRow, permissions } = loaded;
    const body = req.body || {};

    const text = taskField(body.body, COMMENT_MAX_CHARS);
    if (!text) {
      return res.status(400).json({
        error: 'Write something before posting it.',
        code: 'comment_empty',
        maxChars: COMMENT_MAX_CHARS,
      });
    }

    let parent = null;
    if (body.replyTo !== undefined && body.replyTo !== null && body.replyTo !== '') {
      if (!COMMENT_ID_PATTERN.test(String(body.replyTo))) {
        return res.status(400).json({ error: 'Unknown comment.', code: 'comment_not_found' });
      }
      parent = await findCaseCommentById(body.replyTo);
      if (!parent) {
        return res.status(404).json({ error: 'Unknown comment.', code: 'comment_not_found' });
      }
      /* A reply belongs to the conversation it continues, so it lives on the parent's case whatever the
       request path said — and a request that mixes two cases is refused rather than quietly filed
       under the other one. */
      if (parent.caseId !== caseRow.id) {
        return res.status(400).json({
          error: 'That reply is for a comment on a different case.',
          code: 'comment_case_mismatch',
        });
      }
    }

    /* §11's "attach supporting files" is a pointer at §8's document, not a second upload: a file quoted
     in a conversation is a file that has a category, a hash and a verifier, and the comment says which
     one. It has to be a file on this case, or the attachment would be a way of reading somebody
     else's claim through a comment box. */
    let attached = null;
    if (body.documentId !== undefined && body.documentId !== null && body.documentId !== '') {
      if (!DOCUMENT_ID_PATTERN.test(String(body.documentId))) {
        return res.status(400).json({ error: 'Unknown document.', code: 'document_not_found' });
      }
      attached = await findDocumentById(body.documentId);
      if (!attached) {
        return res.status(404).json({ error: 'Unknown document.', code: 'document_not_found' });
      }
      if (attached.caseId !== caseRow.id) {
        return res.status(403).json({
          error: 'That document belongs to a different case.',
          code: 'document_case_mismatch',
        });
      }
    }

    const instruction = body.instruction === true;
    if (instruction && !permissions.has('assign_case')) {
      return res.status(403).json({
        error: 'Only the members who hand out work can post an instruction.',
        code: 'instruction_forbidden',
        permission: 'assign_case',
      });
    }

    const resolved = await resolveMentions(mentionTokens(text, body.mentions));
    const audience = new Set(await caseCommentAudience(caseRow.id));
    if (parent && parent.authorUserId) audience.add(parent.authorUserId);
    audience.delete(req.user.id);

    const mentions = { notified: [], unknown: [], notOnCase: [] };
    const told = new Set();
    resolved.resolved.forEach((person) => {
      if (!audience.has(person.id)) {
        mentions.notOnCase.push({ token: person.token, fullName: person.fullName });
        return;
      }
      if (told.has(person.id) || person.id === req.user.id) return;
      told.add(person.id);
      mentions.notified.push({ id: person.id, fullName: person.fullName });
    });
    mentions.unknown = resolved.unresolved;

    const comment = await insertCaseComment({
      caseId: caseRow.id,
      authorUserId: req.user.id,
      parentCommentId: parent ? parent.id : null,
      body: text,
      mentions: [...told],
      documentId: attached ? attached.id : null,
      isInstruction: instruction,
    });

    /* Who the bell has to ring for, which is not everybody who can read the thread. A comment that names
     nobody is a note in a conversation, and §11 gave that its own mechanism — the unread marker on the
     case, which the thread screen and the register both show. What has to arrive unasked is a sentence
     addressed to you: a mention, the reply that answers yours, or an instruction, which is the one kind
     of comment whose point is that somebody acts on it. */
    const recipients = new Set(told);
    if (parent && parent.authorUserId) recipients.add(parent.authorUserId);
    if (instruction) audience.forEach((id) => recipients.add(id));
    recipients.delete(req.user.id);

    const who = displayName(req.user);
    const summary = text.length > 90 ? `${text.slice(0, 90).trimEnd()}…` : text;
    const message = instruction
      ? `${who} instructed on case ${caseRow.caseNumber || caseRow.id}: ${summary}`
      : parent
        ? `${who} replied on case ${caseRow.caseNumber || caseRow.id}: ${summary}`
        : `${who} mentioned you on case ${caseRow.caseNumber || caseRow.id}: ${summary}`;
    await notify([...recipients], {
      type: instruction ? 'admin_instruction' : 'case_comment',
      message,
      actorUserId: req.user.id,
      caseId: caseRow.id,
      commentId: comment.id,
    });

    return res.status(201).json({
      ok: true,
      comment: {
        ...comment,
        authorName: who,
        authorRole: normalizeRole(req.user.role),
        documentFilename: attached ? attached.originalFilename : null,
        documentStatus: attached ? attached.status : null,
        unread: false,
      },
      mentions,
    });
  }
);

/* Opening the thread is what makes it read. The marker is a separate call rather than a side effect of
   GET because the screen refreshes the thread while a person is typing, and a list request that
   silently clears somebody's unread count on every keystroke would be a bug the database keeps. */
app.post('/api/cases/:id/comments/read', requireAuth, async (req, res) => {
  const loaded = await loadCaseForComments(req, res);
  if (!loaded) return undefined;
  await markCaseCommentsRead(req.user.id, loaded.caseRow.id);
  return res.json({ ok: true });
});

/* The bell. §12 asks for type, message, related case, related task, created date and read status, and
   every one of those is a column on the row rather than something the screen has to work out — which
   is also why the actor's name travels with it: "Biplab asked for a replacement" is a thing a person
   can act on, and "a replacement was asked for" is a riddle. */
app.get('/api/notifications', requireAuth, async (req, res) => {
  let limit = 40;
  if (req.query.limit !== undefined) {
    const asked = Number(req.query.limit);
    if (!Number.isInteger(asked) || asked < 1 || asked > 200) {
      return res.status(400).json({ error: 'That is not a page size.', code: 'invalid_limit' });
    }
    limit = asked;
  }
  const unreadOnly = req.query.unread === '1';

  /* The calendar is consulted first, so the deadline rows below are the ones this moment produces
     rather than the ones somebody's last visit produced. */
  await refreshDeadlineNotices(req.user.id);
  const rows = await listNotifications(req.user.id, { unreadOnly, limit });
  const count = await unreadNotificationCount(req.user.id);

  return res.json({
    notifications: rows,
    unread: count.unread,
    latest: count.latest,
    types: NOTIFICATION_TYPES,
    deadlineDays: DEADLINE_NOTICE_DAYS,
  });
});

/* The header count without the list: the dashboard polls this, and it should not have to carry forty
   messages to say that there are none. */
app.get('/api/notifications/count', requireAuth, async (req, res) => {
  await refreshDeadlineNotices(req.user.id);
  const count = await unreadNotificationCount(req.user.id);
  return res.json({ unread: count.unread, latest: count.latest });
});

app.post('/api/notifications/:id/read', requireAuth, async (req, res) => {
  if (!TASK_ID_PATTERN.test(String(req.params.id))) {
    return res.status(404).json({ error: 'Unknown notification.', code: 'notification_not_found' });
  }
  /* The recipient's own id is part of the UPDATE, so naming somebody else's notification changes
     nothing about theirs — and says so rather than reporting a success nobody earned. */
  const marked = await markNotificationRead(req.user.id, req.params.id);
  if (!marked) {
    return res.status(404).json({ error: 'Unknown notification.', code: 'notification_not_found' });
  }
  const count = await unreadNotificationCount(req.user.id);
  return res.json({ ok: true, unread: count.unread });
});

app.post('/api/notifications/read-all', requireAuth, async (req, res) => {
  const marked = await markAllNotificationsRead(req.user.id);
  return res.json({ ok: true, marked, unread: 0 });
});

/* The three ways an address can already be taken, each answered the way the user needs to hear it
   rather than with one generic "duplicate" that hides what to do next. */
const describeExistingAccount = (existing, res) => {
  if (!existing.is_verified) {
    return res.status(200).json({
      ok: true,
      code: 'verification_pending',
      accountStatus: 'pending_verification',
      message:
        'This email is already registered but not activated yet. Use Resend activation email to get a new link.',
    });
  }

  if (!existing.password_hash) {
    return res.status(409).json({
      ok: false,
      code: 'google_account_exists',
      message:
        'An account for this email already exists and is secured with Google. Use "Continue with Google" to sign in.',
    });
  }

  return res.status(409).json({
    ok: false,
    code: 'account_exists',
    message: 'An account for this email already exists. Sign in, or use Forgot password?',
  });
};

app.post('/api/auth/signup', authRequestLimiter, async (req, res) => {
  try {
    const firstName = String(req.body?.firstName || '')
      .trim()
      .slice(0, 120);
    const lastName = String(req.body?.lastName || '')
      .trim()
      .slice(0, 120);
    const email = String(req.body?.email || '')
      .trim()
      .toLowerCase();
    /* Not trimmed: a password is exactly what was typed, spaces included. */
    const password = String(req.body?.password || '');
    const confirmPassword = String(req.body?.confirmPassword || req.body?.confirm || '');

    if (!firstName) return res.status(400).json({ error: 'Enter your first name.' });
    if (!lastName) return res.status(400).json({ error: 'Enter your last name.' });
    if (!email || !emailRegex.test(email)) {
      return res.status(400).json({ error: 'Enter a valid email address.' });
    }
    if (!password || !strongPasswordRegex.test(password)) {
      return res.status(400).json({
        error:
          'Password must be at least 12 characters, include upper and lower case, a number, and a symbol.',
      });
    }
    if (password !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match.' });
    }

    const existingUser = await findUserByEmail(email);
    if (existingUser) return describeExistingAccount(existingUser, res);

    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    let user = await createUser({
      firstName,
      lastName,
      fullName: [firstName, lastName].filter(Boolean).join(' '),
      email,
      passwordHash,
      provider: 'email',
      role: 'STAFF',
    });

    if (!user) {
      /* A second submission of the same email won the UNIQUE race a moment ago; that is still the
         same answer as the ordinary duplicate case. */
      const raced = await findUserByEmail(email);
      if (raced) return describeExistingAccount(raced, res);
      return res
        .status(500)
        .json({ error: 'Your account could not be created. Please try again.' });
    }

    const verification = await createVerificationTokenForUser(user.id);
    await sendMailQuietly('activation', () =>
      sendVerificationMail(email, verification.rawToken, buildMailData(req, user))
    );
    await recordLoginActivity({
      userId: user.id,
      loginMethod: 'email',
      eventType: 'account_created',
      status: 'success',
      ...getClientMetadata(req),
      metadata: { app: 'survey-desk', activation_sent: true },
    });
    await recordAuditLog({
      actorUserId: user.id,
      targetUserId: user.id,
      action: 'account_created',
      details: { email },
    });

    return res.status(201).json({
      ok: true,
      code: 'verification_sent',
      accountStatus: 'pending_verification',
      message:
        'Your registration has been received. Please check your email and click the activation link to activate your SurveyPro account.',
      ...(mailPreviewEnabled ? { previewUrl: buildVerifyLink(verification.rawToken, req) } : {}),
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Signup failed.' });
  }
});

app.post('/api/auth/resend-verification', activationMailLimiter, async (req, res) => {
  try {
    const email = String(req.body?.email || '')
      .trim()
      .toLowerCase();
    if (!email || !emailRegex.test(email)) {
      return res.status(400).json({ error: 'Enter a valid email address.' });
    }

    const user = await findUserByEmail(email);
    const generic = {
      ok: true,
      message: 'If this email has an unactivated account, a new activation link has been sent.',
    };
    if (!user || user.is_verified) return res.json(generic);

    const verification = await createVerificationTokenForUser(user.id);
    await sendMailQuietly('activation resend', () =>
      sendVerificationMail(user.email, verification.rawToken, buildMailData(req, user))
    );
    await recordLoginActivity({
      userId: user.id,
      loginMethod: 'email',
      eventType: 'verification_resent',
      status: 'success',
      ...getClientMetadata(req),
      metadata: { app: 'survey-desk' },
    });

    return res.json({
      ...generic,
      ...(mailPreviewEnabled ? { previewUrl: buildVerifyLink(verification.rawToken, req) } : {}),
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
    const password = String(req.body?.password || '');
    const persistent = Boolean(req.body?.rememberMe ?? req.body?.remember);

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const meta = getClientMetadata(req);
    const user = await findUserByEmail(email);

    if (!user) {
      await recordLoginActivity({
        userId: null,
        loginMethod: 'email',
        eventType: 'login',
        status: 'failure',
        browserName: meta.browserName,
        deviceName: meta.deviceName,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { app: 'survey-desk', reason: 'unknown_email' },
      });
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
      const wait = Math.max(1, Math.ceil((new Date(user.locked_until) - Date.now()) / 60000));
      return res.status(423).json({
        error: `Too many failed attempts. Try again in ${wait} minute${wait === 1 ? '' : 's'}.`,
        code: 'account_locked',
      });
    }

    if (!user.password_hash) {
      return res.status(401).json({
        error: 'This account uses Google sign-in. Use "Continue with Google" to sign in.',
        code: 'google_only',
      });
    }

    const passwordValid = await argon2.verify(user.password_hash, password).catch(() => false);
    if (!passwordValid) {
      const state = await registerLoginFailure(user.id);
      await recordLoginActivity({
        userId: user.id,
        loginMethod: 'email',
        eventType: 'login',
        status: 'failure',
        browserName: meta.browserName,
        deviceName: meta.deviceName,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: {
          app: 'survey-desk',
          reason: 'bad_password',
          attempts: state ? state.failed_login_attempts : null,
        },
      });
      return res.status(401).json({
        error:
          state && state.locked_until
            ? `Invalid email or password. This account is locked for ${POLICY.lockoutMinutes} minutes after ${POLICY.maxFailedLogins} failed attempts.`
            : 'Invalid email or password.',
      });
    }

    if (!user.is_active) {
      return res.status(403).json({ error: 'Your account is disabled. Contact an administrator.' });
    }

    if (!user.is_verified) {
      await recordLoginActivity({
        userId: user.id,
        loginMethod: 'email',
        eventType: 'login',
        status: 'failure',
        browserName: meta.browserName,
        deviceName: meta.deviceName,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { app: 'survey-desk', reason: 'email_not_verified' },
      });
      return res.status(403).json({
        error:
          'Your email address is not activated yet. Please use the link in the activation email.',
        code: 'email_not_verified',
      });
    }

    await clearLoginFailures(user.id);
    await beginAuthenticatedSession({ req, res, user, method: 'email', persistent });

    return res.json({
      user: sanitizeUser(user),
      message: 'Login successful.',
      session: {
        persistent,
        expiresInMinutes: persistent ? POLICY.rememberMeDays * 24 * 60 : POLICY.sessionHours * 60,
      },
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Login failed.' });
  }
});

app.post('/api/auth/forgot-password', resetMailLimiter, async (req, res) => {
  const generic = {
    ok: true,
    message: 'If an account exists with this email address, a password reset link has been sent.',
  };

  try {
    const email = String(req.body?.email || '')
      .trim()
      .toLowerCase();
    if (!email) return res.status(400).json({ error: 'Email is required.' });

    const user = await findUserByEmail(email);
    if (!user) return res.json(generic);

    const meta = getClientMetadata(req);
    /* A Google-only account has no password to reset, and a disabled account must not be given a
       link that would hand its owner a way back in. Either way the caller sees the same answer. */
    if (!user.password_hash || !user.is_active) {
      await recordLoginActivity({
        userId: user.id,
        loginMethod: 'email',
        eventType: 'password_reset_requested',
        status: 'failure',
        browserName: meta.browserName,
        deviceName: meta.deviceName,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: {
          app: 'survey-desk',
          reason: user.password_hash ? 'account_disabled' : 'google_only',
        },
      });
      return res.json(generic);
    }

    const reset = await createResetTokenForUser(user.id);
    await sendMailQuietly('password reset', () =>
      sendResetMail(user.email, reset.rawToken, buildMailData(req, user))
    );
    await recordLoginActivity({
      userId: user.id,
      loginMethod: 'email',
      eventType: 'password_reset_requested',
      status: 'success',
      browserName: meta.browserName,
      deviceName: meta.deviceName,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { app: 'survey-desk' },
    });
    /* §12's password-reset notice, worth storing even though an email went out as well: the row in the
       bell is how somebody finds out that their password was asked for by a person who knows their
       address, on a device they are not holding. The answer to the caller stays generic either way, so
       this tells the account and nobody else — which is why it is written after the success branch and
       not before the check for a disabled or Google-only account. */
    await notify([user.id], {
      type: 'password_reset_requested',
      message: `A password reset was requested for this account${
        meta.ipAddress ? ` from ${meta.ipAddress}` : ''
      }${
        meta.deviceName ? ` on ${meta.deviceName}` : ''
      }. If that was not you, change your password before signing in again.`,
    });

    return res.json({
      ...generic,
      ...(mailPreviewEnabled ? { previewUrl: buildResetLink(reset.rawToken, req) } : {}),
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Password reset failed.' });
  }
});

app.post('/api/auth/reset-password', authRequestLimiter, async (req, res) => {
  try {
    const token = String(req.body?.token || '').trim();
    const password = String(req.body?.password || '');
    const confirmPassword = String(req.body?.confirmPassword || req.body?.confirm || '');

    if (!token) return res.status(400).json({ error: 'Reset token is required.' });
    if (!password || !confirmPassword) {
      return res.status(400).json({ error: 'New password and confirmation are required.' });
    }
    if (password !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match.' });
    }
    /* The password is checked before the token is consumed. A link whose owner merely typed a weak
       password must stay usable so they can correct it, exactly as a mismatched confirmation does. */
    if (!strongPasswordRegex.test(password)) {
      return res.status(400).json({
        error:
          'Password must be at least 12 characters, include upper and lower case, a number, and a symbol.',
      });
    }

    const { state, row } = await consumeResetToken(token);
    if (state === 'expired') {
      return res.status(400).json({
        error: 'This reset link has expired. Please request a new one.',
        code: 'reset_expired',
      });
    }
    if (state === 'used') {
      return res.status(400).json({
        error: 'This reset link has already been used. Please request a new one.',
        code: 'reset_used',
      });
    }
    if (state !== 'valid') {
      return res.status(400).json({
        error: 'This reset link is not valid. Please request a new one.',
        code: 'reset_invalid',
      });
    }

    const user = await findUserById(row.user_id);
    const meta = getClientMetadata(req);
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

    await updatePasswordHash(user.id, passwordHash);
    await clearLoginFailures(user.id);
    await revokeSessionsForUser(user.id, 'password_reset');
    clearSessionCookie(res);

    await recordLoginActivity({
      userId: user.id,
      loginMethod: 'email',
      eventType: 'password_reset',
      status: 'success',
      browserName: meta.browserName,
      deviceName: meta.deviceName,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { app: 'survey-desk', sessions_revoked: true },
    });
    await recordAuditLog({
      actorUserId: user.id,
      targetUserId: user.id,
      action: 'password_reset',
      details: { email: user.email },
    });

    try {
      await sendPasswordChangedMail(user.email, {
        ...buildMailData(req, user),
        browser: `${meta.browserName} on ${meta.osName}`,
        ip: meta.ipAddress,
      });
    } catch (error) {
      console.error('[auth] password change notification failed', error.message);
    }

    return res.json({
      ok: true,
      message: 'Your password has been reset. You can now log in to SurveyPro.',
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Password update failed.' });
  }
});

app.post('/api/auth/verify-email', authRequestLimiter, async (req, res) => {
  try {
    const token = String(req.body?.token || '').trim();
    if (!token) return res.status(400).json({ error: 'Verification token is required.' });

    const { state, row } = await consumeVerificationToken(token, 'email_verify');
    if (state !== 'valid') {
      const messages = {
        expired: 'This activation link has expired. Request a new one to continue.',
        used: 'This activation link has already been used. Sign in, or request a new link.',
        unknown: 'This activation link is not valid. Request a new one to continue.',
      };
      return res.status(400).json({
        error: messages[state],
        code: state === 'expired' ? 'verification_expired' : 'verification_invalid',
      });
    }

    const user = await markEmailVerified(row.user_id);
    const meta = getClientMetadata(req);
    await recordLoginActivity({
      userId: row.user_id,
      loginMethod: 'email',
      eventType: 'account_activated',
      status: 'success',
      browserName: meta.browserName,
      deviceName: meta.deviceName,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { app: 'survey-desk' },
    });
    await recordAuditLog({
      actorUserId: row.user_id,
      targetUserId: row.user_id,
      action: 'email_verified',
      details: { email: user ? user.email : null },
    });

    return res.json({
      ok: true,
      message: 'Your email has been successfully verified. You can now log in to SurveyPro.',
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Email verification failed.' });
  }
});

app.post('/api/auth/logout', requireAuth, async (req, res) => {
  const sessionToken = req.cookies ? req.cookies[SESSION_COOKIE] : null;
  if (sessionToken) await revokeSessionToken(sessionToken);
  clearSessionCookie(res);

  await recordLoginActivity({
    userId: req.user.id,
    loginMethod: req.user.provider || 'email',
    eventType: 'logout',
    status: 'success',
    ...getClientMetadata(req),
    metadata: { app: 'survey-desk' },
  });

  return res.json({ ok: true, message: 'Logged out.' });
});

app.post('/api/generate', requireAuth, requirePermission('use_ai_assistance'), async (req, res) => {
  try {
    const prompt = String(req.body?.prompt || '').trim();
    if (!prompt) {
      return res.status(400).json({ error: 'prompt is required' });
    }
    if (!apiKey) {
      return res.status(500).json({ error: 'GEMINI_API_KEY is not configured on the server.' });
    }

    const resolvedModel = normalizeModel(modelName);
    console.log(`[AI] generating with model=${resolvedModel} promptChars=${prompt.length}`);
    const result = await callGemini(resolvedModel, {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.25,
        topP: 0.95,
        maxOutputTokens:
          Number.isFinite(maxOutputTokens) && maxOutputTokens > 0 ? maxOutputTokens : 6000,
      },
    });

    if (result.status !== 200) {
      return res.status(result.status).json({ error: result.note });
    }

    const data = result.data;

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
