/* Sign-in, registration, activation, and password recovery.

   The session is an HttpOnly cookie that the server issues and validates. Nothing that looks like a
   credential is written to localStorage or sessionStorage, and no token is ever rendered into the
   page — activation, reset, and email-change tokens arrive as query parameters, are read once into
   memory, and are stripped from the address bar before anything else can copy them. */
(function () {
  /* The API is the server that served this page. The absolute http://host:3000 was there so the
     frontend also worked when opened straight from disk or from a static server on another port,
     but on any other port it made every call cross-origin — and the server now only answers
     same-origin requests. Opening index.html from disk still reaches the default dev server. */
  const API_BASE = (() => {
    const { protocol, hostname } = window.location;
    if (protocol === 'http:' || protocol === 'https:') return window.location.origin;
    return `http://${hostname || 'localhost'}:3000`;
  })();

  const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  /* Mirrors strongPasswordRegex on the server. Kept as a list so the form can show which rule is
     still unsatisfied instead of one vague "too weak". */
  const PASSWORD_RULES = [
    { label: 'At least 12 characters', test: (v) => v.length >= 12 },
    { label: 'One uppercase letter', test: (v) => /[A-Z]/.test(v) },
    { label: 'One lowercase letter', test: (v) => /[a-z]/.test(v) },
    { label: 'One number', test: (v) => /\d/.test(v) },
    { label: 'One symbol', test: (v) => /[^A-Za-z0-9]/.test(v) },
  ];
  const isStrongPassword = (value) =>
    typeof value === 'string' && PASSWORD_RULES.every((rule) => rule.test(value));

  const COPY = {
    registrationReceived:
      'Your registration has been received. Please check your email and click the activation link to activate your SurveyPro account.',
    emailVerified: 'Your email has been successfully verified. You can now log in to SurveyPro.',
    passwordReset: 'Your password has been reset. You can now log in to SurveyPro.',
    passwordRules:
      'Password must be at least 12 characters, include upper and lower case, a number, and a symbol.',
  };

  const TITLES = {
    login: ['Welcome back', 'Use your work email to view cases, reports, and insights.'],
    signup: ['Create your account', 'First name, last name, email and password are required.'],
    forgot: ['Reset your password', 'Enter the email linked to your SurveyPro account.'],
    reset: ['Choose a new password', 'Create a strong password to finish resetting access.'],
    setpassword: [
      'Set your own password',
      'This account was opened for you with a temporary password. Replace it before you continue.',
    ],
    pending: ['Activation email sent', 'Open your inbox and click the activation link.'],
  };
  const SUBMIT_LABEL = {
    login: 'Sign in',
    signup: 'Create account',
    forgot: 'Send reset link',
    reset: 'Reset password',
    setpassword: 'Save password',
  };
  const BUSY_LABEL = {
    login: 'Signing in…',
    signup: 'Creating account…',
    forgot: 'Sending…',
    reset: 'Saving…',
    setpassword: 'Saving…',
  };

  /* In-memory only, and only ever the sanitized profile the server volunteers. */
  const session = { user: null, permissions: null };
  let busy = false;
  let mode = 'login';
  let pendingResetToken = null;

  function readAuth() {
    return session;
  }

  /* Legacy builds kept a JWT in these keys. The cookie replaced it, so they are dropped on every
     boot instead of being left readable to anything else on this origin. */
  function purgeStoredCredentials() {
    ['survey-desk-auth', 'survey-desk-auth-source'].forEach((key) => {
      try {
        localStorage.removeItem(key);
      } catch {
        // storage can be blocked (private mode); nothing sensitive is written either way
      }
      try {
        sessionStorage.removeItem(key);
      } catch {
        // ignored
      }
    });
  }

  async function request(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    const isFormData = options.body instanceof FormData;
    if (!isFormData && !headers['Content-Type'] && options.body) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
      credentials: 'include',
      body: options.body && !isFormData ? JSON.stringify(options.body) : options.body,
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || payload.message || 'Request failed');
      error.code = payload.code;
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  /* The one call whose body is not JSON. A scanned document is sent as the bytes it is — the server
     reads the file type from them rather than from anything said about them — so nothing here may
     stringify. Same base, same cookie, same error shape, so a refusal from the route still arrives with
     its code and status. */
  async function requestBytes(path, options = {}) {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/octet-stream', ...(options.headers || {}) },
      credentials: 'include',
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || payload.message || 'Request failed');
      error.code = payload.code;
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  /* A static preview server — VS Code's, or the app opened on a port that is not the one Express
     listens on — serves index.html and every script happily, but has no /api behind it, so the
     Google button navigates the whole page onto a bare "Cannot GET". One request answers the
     question the surveyor cannot answer from the screen, and the two ways it can go wrong need
     different advice: a server that answers but is not ours means "wrong address", one that does
     not answer at all means "not started yet". */
  async function apiWhere() {
    try {
      const response = await fetch(`${API_BASE}/health`, { credentials: 'include' });
      const payload = await response.json().catch(() => ({}));
      return response.ok && payload.ok === true ? 'ours' : 'other';
    } catch {
      return 'down';
    }
  }

  function setHint(el, text, kind) {
    if (!el) return;
    el.textContent = text || '';
    el.className = 'auth-hint' + (kind ? ' is-' + kind : '');
  }

  function setFormMessage(el, text, kind = 'error') {
    if (!el) return;
    el.textContent = text || '';
    el.className = 'auth-message' + (text ? ' ' + kind : '');
  }

  /* What the two ways of not reaching the API each need said, and the one action that fixes the
     common one. The message element is text-only, so the address is added as a node — a link,
     because typing a port into the address bar is how this happened in the first place. */
  function showNoServer(el, where) {
    setFormMessage(
      el.message,
      where === 'down'
        ? `No SurveyPro server answered ${API_BASE}. Start it with npm start, then reload this page.`
        : `This page came from ${API_BASE}, which serves the files but not the SurveyPro API.`,
      'error'
    );
    if (el.gmail) el.gmail.disabled = false;
    if (where !== 'other') return;
    const go = document.createElement('a');
    go.href = `${location.protocol}//localhost:3000/`;
    go.textContent = 'Open SurveyPro at http://localhost:3000';
    el.message.append(' ', go);
  }

  function clearFieldErrors(root) {
    root.querySelectorAll('.auth-hint').forEach((hint) => setHint(hint, '', ''));
  }

  function readUrlToken(name) {
    const value = new URLSearchParams(window.location.search).get(name);
    if (!value) return null;
    const url = new URL(window.location.href);
    url.searchParams.delete(name);
    window.history.replaceState({}, document.title, url.toString());
    return value;
  }

  function normalizeEmail(value) {
    return String(value || '')
      .trim()
      .toLowerCase();
  }

  /* previewUrl is only present while SMTP is unconfigured; it is the only way to finish a link test
     on a machine with no mailbox. */
  function withPreview(payload, fallback = '') {
    const message = payload.message || fallback;
    return payload.previewUrl ? `${message} (Dev preview: ${payload.previewUrl})` : message;
  }

  function renderUserStatus() {
    const user = session.user;
    const badge = document.getElementById('auth-user-badge');
    if (badge) {
      badge.textContent = user ? `Signed in: ${user.name || user.email}` : '';
      badge.hidden = !user;
    }
    /* The header is built before /api/auth/me answers, so the name has to be written here too or a
       signed-in surveyor keeps the "Guest" label until the next reload. */
    const who = document.getElementById('who-name');
    if (who) who.textContent = (user && (user.fullName || user.name || user.email)) || 'Guest';
    ['logout-btn', 'logout-btn-sidebar'].forEach((id) => {
      const btn = document.getElementById(id);
      if (btn) btn.hidden = !user;
    });
  }

  /* The permission set is fetched with the profile and held in memory for this page load only. It
     decides what a person is *offered*, never what they are allowed: every route resolves it again
     from the database, so a browser holding a stale copy can display a control it will be refused. */
  async function loadPermissions() {
    try {
      const payload = await request('/api/auth/permissions');
      session.permissions = Array.isArray(payload.permissions) ? payload.permissions : null;
    } catch {
      /* No set means the screens fall back to the role, which is what they used before this existed. */
      session.permissions = null;
    }
  }

  async function showApp() {
    if (session.user && session.user.mustChangePassword) {
      requireNewPassword();
      return;
    }
    await loadPermissions();
    document.body.classList.remove('auth-locked');
    const shell = document.getElementById('auth-shell');
    if (shell) shell.remove();
    renderUserStatus();
    /* Where the person was standing when this page last closed, rather than the dashboard every time.
       resumeApp() falls back to showDash() itself when there is nothing remembered, so a first session
       and a stale note both land where they used to. */
    if (typeof window.resumeApp === 'function') window.resumeApp();
    else if (typeof window.showDash === 'function') window.showDash();
    /* The register is only worth consulting once there is a session to consult it with, and this is
       the one place every route to a usable app passes: a stored cookie, a password login, a Google
       return. Nothing here waits for it — the dashboard is already drawn from local data. */
    if (typeof window.syncSessionReady === 'function') window.syncSessionReady();
  }

  /* An account that still holds a password somebody else chose never reaches the dashboard — the
     server refuses every other API call until it is replaced — so the shell stays locked in front of
     the app and offers only the change form, with no tabs or Google button to step around it. */
  function requireNewPassword() {
    const shell = buildShell();
    shell.hidden = false;
    document.body.classList.add('auth-locked');
    const el = shell.el;
    setMode(el, 'setpassword');
    setFormMessage(el.message, 'Choose a new password to continue.', 'success');
    el.password.focus();
  }

  /* ---------- shell markup ---------- */

  function buildShell() {
    const existing = document.getElementById('auth-shell');
    if (existing && existing.el) return existing;

    const root = document.createElement('div');
    root.id = 'auth-shell';
    root.className = 'auth-shell';
    root.innerHTML = [
      '<div class="auth-layout">',
      '<aside class="auth-visual" aria-label="SurveyPro branding">',
      '<div class="auth-visual-inner">',
      '<img src="assets/survey-desk-logo.svg" alt="SurveyPro" class="auth-logo-art" />',
      '<div class="auth-visual-copy">',
      '<h2>SurveyPro</h2>',
      '<p>Claim survey and loss assessment desk</p>',
      '</div>',
      '</div>',
      '</aside>',
      '<div class="auth-card">',
      '<div class="auth-brand">',
      '<div class="auth-brand-mark" aria-hidden="true">SP</div>',
      '<div class="auth-brand-copy">',
      '<strong>SurveyPro</strong>',
      '<span>Secure field reporting</span>',
      '</div>',
      '</div>',
      '<div class="auth-mode-switch" role="tablist" aria-label="Authentication mode">',
      '<button type="button" class="auth-mode-btn is-active" data-mode="login" role="tab">Sign in</button>',
      '<button type="button" class="auth-mode-btn" data-mode="signup" role="tab">Create account</button>',
      '</div>',
      '<form id="auth-form" class="auth-form" novalidate>',
      '<div class="auth-form-head">',
      '<h1 id="auth-form-title">Welcome back</h1>',
      '<p id="auth-form-subtitle"></p>',
      '</div>',
      '<div class="auth-grid" id="auth-name-row" hidden>',
      '<div class="fld">',
      '<label for="auth-first-name">First name</label>',
      '<input id="auth-first-name" name="firstName" placeholder="Aakash" autocomplete="given-name" maxlength="120" />',
      '<p class="auth-hint" id="auth-first-name-hint"></p>',
      '</div>',
      '<div class="fld">',
      '<label for="auth-last-name">Last name</label>',
      '<input id="auth-last-name" name="lastName" placeholder="Shrestha" autocomplete="family-name" maxlength="120" />',
      '<p class="auth-hint" id="auth-last-name-hint"></p>',
      '</div>',
      '</div>',
      '<div class="fld" id="auth-email-wrap">',
      '<label for="auth-email">Email address</label>',
      '<input id="auth-email" type="email" name="email" placeholder="you@company.com" autocomplete="email" />',
      '<p class="auth-hint" id="auth-email-hint"></p>',
      '</div>',
      '<div class="fld" id="auth-password-wrap">',
      '<label for="auth-password">Password</label>',
      '<div class="password-field">',
      '<input id="auth-password" type="password" name="password" placeholder="Minimum 12 characters" autocomplete="current-password" />',
      '<button type="button" class="password-toggle" aria-label="Show password">Show</button>',
      '</div>',
      '<ul class="pw-rules" id="auth-password-rules" hidden></ul>',
      '<div class="pw-meter" id="auth-password-meter" hidden><span id="auth-password-meter-fill"></span></div>',
      '<p class="auth-hint" id="auth-password-hint"></p>',
      '</div>',
      '<div class="fld" id="auth-confirm-wrap" hidden>',
      '<label for="auth-confirm">Confirm password</label>',
      '<div class="password-field">',
      '<input id="auth-confirm" type="password" name="confirmPassword" placeholder="Repeat your password" autocomplete="new-password" />',
      '<button type="button" class="password-toggle" aria-label="Show confirm password">Show</button>',
      '</div>',
      '<p class="auth-hint" id="auth-confirm-hint"></p>',
      '</div>',
      '<div class="auth-inline-row" id="auth-login-options">',
      '<label class="auth-remember">',
      '<input type="checkbox" id="auth-remember-me" name="rememberMe" />',
      '<span>Keep me logged in</span>',
      '</label>',
      '<button type="button" class="auth-link" id="auth-forgot-link">Forgot password?</button>',
      '</div>',
      '<div class="auth-pending" id="auth-pending-panel" hidden>',
      '<p id="auth-pending-text"></p>',
      '<button type="button" class="auth-btn secondary" id="auth-resend-btn">Resend activation email</button>',
      '</div>',
      '<button type="submit" class="auth-btn" id="auth-submit-btn">Sign in</button>',
      '<div class="auth-divider" id="auth-google-divider"><span>or continue with</span></div>',
      '<button type="button" class="auth-btn secondary" id="gmail-login-btn">',
      '<span class="google-mark" aria-hidden="true">G</span>',
      'Continue with Google',
      '</button>',
      '<p class="auth-footer" id="auth-footer-row">',
      '<span id="auth-footer-text">Need an account?</span>',
      '<button type="button" class="auth-link inline" id="auth-toggle-link">Create one</button>',
      '</p>',
      '<p id="auth-message" class="auth-message" role="status" aria-live="polite"></p>',
      '<button type="button" class="auth-link back-link" id="auth-back-link" hidden>Back to sign in</button>',
      '<button type="button" class="auth-link back-link" id="auth-new-link-btn" hidden>Request a new link</button>',
      '</form>',
      '</div>',
      '</div>',
    ].join('');

    document.body.appendChild(root);

    const q = (selector) => root.querySelector(selector);
    const el = {
      root,
      form: q('#auth-form'),
      title: q('#auth-form-title'),
      subtitle: q('#auth-form-subtitle'),
      nameRow: q('#auth-name-row'),
      firstName: q('#auth-first-name'),
      lastName: q('#auth-last-name'),
      firstNameHint: q('#auth-first-name-hint'),
      lastNameHint: q('#auth-last-name-hint'),
      emailWrap: q('#auth-email-wrap'),
      email: q('#auth-email'),
      emailHint: q('#auth-email-hint'),
      passwordWrap: q('#auth-password-wrap'),
      password: q('#auth-password'),
      passwordLabel: q('label[for="auth-password"]'),
      passwordHint: q('#auth-password-hint'),
      passwordRules: q('#auth-password-rules'),
      passwordMeter: q('#auth-password-meter'),
      passwordMeterFill: q('#auth-password-meter-fill'),
      confirmWrap: q('#auth-confirm-wrap'),
      confirm: q('#auth-confirm'),
      confirmLabel: q('label[for="auth-confirm"]'),
      confirmHint: q('#auth-confirm-hint'),
      loginOptions: q('#auth-login-options'),
      modeSwitch: q('.auth-mode-switch'),
      remember: q('#auth-remember-me'),
      forgotLink: q('#auth-forgot-link'),
      pendingPanel: q('#auth-pending-panel'),
      pendingText: q('#auth-pending-text'),
      resendBtn: q('#auth-resend-btn'),
      submit: q('#auth-submit-btn'),
      googleDivider: q('#auth-google-divider'),
      gmail: q('#gmail-login-btn'),
      footerRow: q('#auth-footer-row'),
      footerText: q('#auth-footer-text'),
      toggleLink: q('#auth-toggle-link'),
      message: q('#auth-message'),
      backLink: q('#auth-back-link'),
      newLinkBtn: q('#auth-new-link-btn'),
      modeButtons: root.querySelectorAll('[data-mode]'),
    };

    root.el = el;
    attachHandlers(el);
    return root;
  }

  /* ---------- panes ---------- */

  function paneVisibility(el, next) {
    const isSignup = next === 'signup';
    const isForgot = next === 'forgot';
    const isReset = next === 'reset';
    const isSetPassword = next === 'setpassword';
    const isPending = next === 'pending';
    const collectsPassword = isSignup || isReset || isSetPassword;
    const bareForm = isForgot || isReset || isPending || isSetPassword;

    el.nameRow.hidden = !isSignup;
    el.emailWrap.hidden = isReset || isPending || isSetPassword;
    el.passwordWrap.hidden = isForgot || isPending;
    el.confirmWrap.hidden = !collectsPassword;
    el.passwordRules.hidden = !collectsPassword;
    el.passwordMeter.hidden = !collectsPassword;
    el.loginOptions.hidden = next !== 'login';
    el.pendingPanel.hidden = !isPending;
    el.submit.hidden = isPending;
    el.googleDivider.hidden = bareForm;
    el.gmail.hidden = bareForm;
    el.footerRow.hidden = bareForm;
    el.backLink.hidden = !bareForm || isSetPassword;
    el.forgotLink.hidden = next !== 'login';
    el.modeSwitch.hidden = isSetPassword;

    el.passwordLabel.textContent = isReset || isSetPassword ? 'New password' : 'Password';
    el.confirmLabel.textContent =
      isReset || isSetPassword ? 'Confirm new password' : 'Confirm password';
    el.submit.textContent = SUBMIT_LABEL[next] || SUBMIT_LABEL.login;
    el.title.textContent = TITLES[next][0];
    el.subtitle.textContent = TITLES[next][1];

    el.footerText.textContent = isSignup ? 'Already have an account?' : 'Need an account?';
    el.toggleLink.textContent = isSignup ? 'Sign in' : 'Create one';

    el.modeButtons.forEach((button) => {
      button.classList.toggle('is-active', button.dataset.mode === next);
    });

    if (isForgot || isReset || isSetPassword) {
      el.password.value = '';
      el.confirm.value = '';
    }
    if (collectsPassword) renderPasswordRules(el, el.password.value);
  }

  function setMode(el, next, options = {}) {
    mode = next;
    paneVisibility(el, next);
    if (!options.keepMessage) {
      setFormMessage(el.message, '', 'error');
      el.newLinkBtn.hidden = true;
    }
    if (!options.keepHints) clearFieldErrors(el.root);
    el.gmail.classList.remove('is-suggested');
    syncSubmitState(el);
  }

  /* ---------- validation ---------- */

  function renderPasswordRules(el, value) {
    el.passwordRules.textContent = '';
    let met = 0;
    PASSWORD_RULES.forEach((rule) => {
      const ok = Boolean(value) && rule.test(value);
      if (ok) met += 1;
      const li = document.createElement('li');
      li.textContent = rule.label;
      if (ok) li.className = 'is-ok';
      el.passwordRules.appendChild(li);
    });
    const ratio = value ? met / PASSWORD_RULES.length : 0;
    el.passwordMeterFill.style.width = `${Math.round(ratio * 100)}%`;
    el.passwordMeter.className =
      'pw-meter' + (ratio === 1 ? ' is-ok' : ratio >= 0.6 ? ' is-mid' : ' is-low');
  }

  /* Runs on every keystroke so a mismatch is visible under Confirm Password before submit. */
  function syncConfirmState(el) {
    if (!el.confirm.value) {
      setHint(el.confirmHint, '', '');
      el.confirm.classList.remove('is-ok', 'is-error');
      return;
    }
    if (el.password.value === el.confirm.value) {
      setHint(el.confirmHint, 'Passwords match.', 'ok');
      el.confirm.classList.add('is-ok');
      el.confirm.classList.remove('is-error');
    } else {
      setHint(el.confirmHint, 'Passwords do not match.', 'error');
      el.confirm.classList.add('is-error');
      el.confirm.classList.remove('is-ok');
    }
  }

  function validateNames(el) {
    if (mode !== 'signup') return true;
    let ok = true;
    const check = (field, hint, which) => {
      const value = field.value.trim();
      if (!value) {
        setHint(hint, `Enter your ${which} name.`, 'error');
        ok = false;
      } else if (value.length < 2) {
        setHint(hint, 'Use at least 2 characters.', 'error');
        ok = false;
      } else {
        setHint(hint, '', '');
      }
    };
    check(el.firstName, el.firstNameHint, 'first');
    check(el.lastName, el.lastNameHint, 'last');
    return ok;
  }

  function validateEmail(el) {
    if (mode === 'reset' || mode === 'setpassword' || mode === 'pending') return true;
    const raw = el.email.value.trim();
    if (!raw) {
      if (mode !== 'login') setHint(el.emailHint, 'Enter your email address.', 'error');
      return false;
    }
    if (!EMAIL_PATTERN.test(normalizeEmail(raw))) {
      setHint(el.emailHint, 'Enter a valid email address.', 'error');
      return false;
    }
    setHint(el.emailHint, '', '');
    return true;
  }

  /* The button stays disabled while the form cannot possibly succeed, so a mismatched confirmation
     is felt before the user reaches for it. */
  function formReady(el) {
    const email = normalizeEmail(el.email.value);
    if (mode === 'forgot') return Boolean(email);
    if (mode === 'reset' || mode === 'setpassword') {
      return isStrongPassword(el.password.value) && el.password.value === el.confirm.value;
    }
    if (mode === 'signup') {
      return Boolean(
        el.firstName.value.trim() &&
        el.lastName.value.trim() &&
        EMAIL_PATTERN.test(email) &&
        isStrongPassword(el.password.value) &&
        el.password.value === el.confirm.value
      );
    }
    return Boolean(email && el.password.value);
  }

  function syncSubmitState(el) {
    el.submit.disabled = busy || !formReady(el);
  }

  function setBusy(el, value, kind) {
    busy = value;
    el.submit.classList.toggle('is-busy', value);
    el.submit.setAttribute('aria-busy', value ? 'true' : 'false');
    /* The idle caption comes from the mode the pane is actually in, not from the flow that finished:
       a successful sign-in can hand the form over to the forced password screen, and a finished reset
       leaves the login pane behind, so the flow's own label would be wrong the moment it returns. */
    el.submit.textContent = value
      ? BUSY_LABEL[kind] || 'Please wait…'
      : SUBMIT_LABEL[mode] || SUBMIT_LABEL.login;
    el.gmail.disabled = value;
    el.resendBtn.disabled = value;
    syncSubmitState(el);
  }

  /* ---------- flows ---------- */

  function showPending(el, message) {
    setMode(el, 'pending', { keepMessage: true });
    el.pendingText.textContent = message;
    if (!normalizeEmail(el.email.value)) revealEmailField(el);
  }

  function revealEmailField(el) {
    el.emailWrap.hidden = false;
    setHint(el.emailHint, 'Enter the address you registered with.', 'error');
  }

  async function resendActivation(el) {
    const email = normalizeEmail(el.email.value);
    if (!EMAIL_PATTERN.test(email)) {
      revealEmailField(el);
      return;
    }
    el.resendBtn.disabled = true;
    try {
      const payload = await request('/api/auth/resend-verification', {
        method: 'POST',
        body: { email },
      });
      el.pendingText.textContent = withPreview(payload);
    } catch (error) {
      setFormMessage(el.message, error.message, 'error');
    } finally {
      el.resendBtn.disabled = false;
    }
  }

  function handleAuthError(el, error, kind) {
    const code = error.code;
    if (code === 'google_account_exists' || code === 'google_only') {
      setFormMessage(el.message, error.message, 'error');
      el.gmail.classList.add('is-suggested');
      return;
    }
    if (code === 'account_exists') {
      setMode(el, 'login', { keepMessage: true });
      el.password.value = '';
      setFormMessage(el.message, error.message, 'success');
      return;
    }
    if (code === 'email_not_verified') {
      showPending(el, `${error.message} Use Resend activation email to get a new link.`);
      return;
    }
    if (
      (kind === 'reset' || kind === 'verify') &&
      (code === 'reset_expired' ||
        code === 'reset_used' ||
        code === 'reset_invalid' ||
        code === 'verification_expired' ||
        code === 'verification_invalid')
    ) {
      pendingResetToken = null;
      setFormMessage(el.message, error.message, 'error');
      el.newLinkBtn.hidden = false;
      return;
    }
    setFormMessage(el.message, error.message, 'error');
  }

  async function submitForm(el, event) {
    event.preventDefault();
    if (busy) return;

    const email = normalizeEmail(el.email.value);
    const password = el.password.value;
    const confirm = el.confirm.value;

    if (mode === 'forgot') {
      if (!email) {
        setHint(el.emailHint, 'Enter your email address.', 'error');
        return;
      }
      setBusy(el, true, 'forgot');
      try {
        const payload = await request('/api/auth/forgot-password', {
          method: 'POST',
          body: { email },
        });
        setMode(el, 'login', { keepMessage: true });
        el.email.value = email;
        setFormMessage(el.message, withPreview(payload), 'success');
      } catch (error) {
        setFormMessage(el.message, error.message, 'error');
      } finally {
        setBusy(el, false, 'forgot');
      }
      return;
    }

    if (mode === 'reset') {
      if (!pendingResetToken) {
        setFormMessage(el.message, 'This reset link is missing its token.', 'error');
        el.newLinkBtn.hidden = false;
        return;
      }
      if (!isStrongPassword(password)) {
        setHint(el.passwordHint, COPY.passwordRules, 'error');
        return;
      }
      if (password !== confirm) {
        setHint(el.confirmHint, 'Passwords do not match.', 'error');
        syncSubmitState(el);
        return;
      }
      setBusy(el, true, 'reset');
      try {
        const payload = await request('/api/auth/reset-password', {
          method: 'POST',
          body: { token: pendingResetToken, password, confirmPassword: confirm },
        });
        pendingResetToken = null;
        setMode(el, 'login', { keepMessage: true });
        el.password.value = '';
        el.confirm.value = '';
        setFormMessage(el.message, withPreview(payload, COPY.passwordReset), 'success');
      } catch (error) {
        handleAuthError(el, error, 'reset');
      } finally {
        setBusy(el, false, 'reset');
      }
      return;
    }

    if (mode === 'setpassword') {
      if (!isStrongPassword(password)) {
        setHint(el.passwordHint, COPY.passwordRules, 'error');
        return;
      }
      if (password !== confirm) {
        setHint(el.confirmHint, 'Passwords do not match.', 'error');
        syncSubmitState(el);
        return;
      }
      setBusy(el, true, 'setpassword');
      try {
        const payload = await request('/api/account/change-password', {
          method: 'POST',
          body: { newPassword: password, confirmPassword: confirm },
        });
        /* The server clears the order together with the hash, but the in-memory profile decides where
           showApp() goes next, so it has to be told as well. */
        if (session.user) session.user.mustChangePassword = false;
        el.password.value = '';
        el.confirm.value = '';
        showApp();
        if (window.toast) window.toast(withPreview(payload, 'Password changed successfully.'));
      } catch (error) {
        handleAuthError(el, error, 'setpassword');
      } finally {
        setBusy(el, false, 'setpassword');
      }
      return;
    }

    if (mode === 'signup') {
      if (!validateNames(el)) return;
      if (!validateEmail(el)) return;
      if (!isStrongPassword(password)) {
        setHint(el.passwordHint, COPY.passwordRules, 'error');
        return;
      }
      if (password !== confirm) {
        setHint(el.confirmHint, 'Passwords do not match.', 'error');
        return;
      }
      setBusy(el, true, 'signup');
      try {
        const payload = await request('/api/auth/signup', {
          method: 'POST',
          body: {
            firstName: el.firstName.value.trim(),
            lastName: el.lastName.value.trim(),
            email,
            password,
            confirmPassword: confirm,
          },
        });
        el.password.value = '';
        el.confirm.value = '';
        showPending(el, withPreview(payload, COPY.registrationReceived));
      } catch (error) {
        handleAuthError(el, error, 'signup');
      } finally {
        setBusy(el, false, 'signup');
      }
      return;
    }

    if (!validateEmail(el)) return;
    if (!password) {
      setHint(el.passwordHint, 'Enter your password.', 'error');
      return;
    }
    setBusy(el, true, 'login');
    try {
      const payload = await request('/api/auth/login', {
        method: 'POST',
        body: { email, password, rememberMe: el.remember.checked },
      });
      session.user = payload.user || null;
      el.password.value = '';
      showApp();
    } catch (error) {
      handleAuthError(el, error, 'login');
      el.password.value = '';
    } finally {
      setBusy(el, false, 'login');
    }
  }

  /* ---------- wiring ---------- */

  function attachHandlers(el) {
    el.root.querySelectorAll('.password-toggle').forEach((toggle) => {
      toggle.addEventListener('click', () => {
        const field = toggle.previousElementSibling;
        if (!field) return;
        const hidden = field.type === 'password';
        field.type = hidden ? 'text' : 'password';
        toggle.textContent = hidden ? 'Hide' : 'Show';
        toggle.setAttribute('aria-label', hidden ? 'Hide password' : 'Show password');
      });
    });

    el.modeButtons.forEach((button) => {
      button.addEventListener('click', () => setMode(el, button.dataset.mode));
    });

    el.toggleLink.addEventListener('click', () =>
      setMode(el, mode === 'signup' ? 'login' : 'signup')
    );

    el.forgotLink.addEventListener('click', () => setMode(el, 'forgot'));

    el.backLink.addEventListener('click', () => setMode(el, 'login'));

    el.newLinkBtn.addEventListener('click', () => {
      const remembered = normalizeEmail(el.email.value);
      pendingResetToken = null;
      setMode(el, 'forgot');
      el.email.value = remembered;
    });

    el.resendBtn.addEventListener('click', () => resendActivation(el));

    [el.firstName, el.lastName].forEach((field) => {
      field.addEventListener('input', () => {
        validateNames(el);
        syncSubmitState(el);
      });
    });

    el.email.addEventListener('input', () => {
      validateEmail(el);
      if (mode === 'pending' && EMAIL_PATTERN.test(normalizeEmail(el.email.value))) {
        el.emailWrap.hidden = true;
        setHint(el.emailHint, '', '');
      }
      syncSubmitState(el);
    });

    el.password.addEventListener('input', () => {
      setHint(el.passwordHint, '', '');
      if (mode === 'signup' || mode === 'reset' || mode === 'setpassword') {
        renderPasswordRules(el, el.password.value);
        syncConfirmState(el);
      }
      syncSubmitState(el);
    });

    el.confirm.addEventListener('input', () => {
      syncConfirmState(el);
      syncSubmitState(el);
    });

    el.gmail.addEventListener('click', async () => {
      if (busy) return;
      el.gmail.disabled = true;
      setFormMessage(el.message, 'Redirecting to Google sign-in…', 'success');
      const where = await apiWhere();
      if (where === 'ours') {
        window.location.href = `${API_BASE}/api/auth/google/start`;
        return;
      }
      showNoServer(el, where);
    });

    el.form.addEventListener('submit', (event) => submitForm(el, event));

    setMode(el, 'login');
  }

  async function logout() {
    try {
      await request('/api/auth/logout', { method: 'POST' });
    } catch {
      // the cookie is revoked server-side; a failed round trip must not strand the shell
    }
    session.user = null;
    window.location.reload();
  }

  /* Email links land on index.html with a token in the query string. Each is read into memory,
     exchanged over POST, and rewritten out of the address bar. */
  async function consumeUrlTokens() {
    const verifyToken = readUrlToken('verify');
    if (verifyToken) {
      try {
        const payload = await request('/api/auth/verify-email', {
          method: 'POST',
          body: { token: verifyToken },
        });
        return { message: withPreview(payload, COPY.emailVerified), kind: 'success' };
      } catch (error) {
        return { message: error.message, kind: 'error', action: 'resend', mode: 'login' };
      }
    }

    const resetToken = readUrlToken('reset');
    if (resetToken) {
      pendingResetToken = resetToken;
      return { message: 'Set a new password for your account.', kind: 'success', mode: 'reset' };
    }

    const emailChangeToken = readUrlToken('email-change');
    if (emailChangeToken) {
      try {
        const payload = await request('/api/account/confirm-email-change', {
          method: 'POST',
          body: { token: emailChangeToken },
        });
        return { message: payload.message, kind: 'success' };
      } catch (error) {
        return { message: error.message, kind: 'error' };
      }
    }

    return null;
  }

  async function init() {
    purgeStoredCredentials();
    const shell = buildShell();
    const el = shell.el;

    ['logout-btn', 'logout-btn-sidebar'].forEach((id) => {
      const btn = document.getElementById(id);
      if (btn) btn.onclick = () => logout();
    });

    document.body.classList.add('auth-locked');
    shell.hidden = false;

    let notice = null;
    try {
      notice = await consumeUrlTokens();
    } catch (error) {
      notice = { message: error.message, kind: 'error' };
    }

    if (notice && notice.mode) setMode(el, notice.mode);

    let signedIn = false;
    try {
      const payload = await request('/api/auth/me');
      session.user = payload.user || null;
      signedIn = Boolean(session.user);
    } catch (error) {
      session.user = null;
      if (!notice) notice = { message: error.message, kind: 'error' };
      /* A 404 or a refused connection is not a failed sign-in — it is this page having no API
         behind it, which is a different thing to tell the surveyor. The ordinary 401 of a
         signed-out browser is left exactly as it was. */
      if (error.status === 404 || !error.status) {
        const where = await apiWhere();
        if (where !== 'ours') notice = { message: '', kind: 'error', noServer: where };
      }
    }

    if (signedIn) {
      showApp();
      if (notice && window.toast) window.toast(notice.message);
      return;
    }

    renderUserStatus();
    if (notice) {
      if (notice.noServer) showNoServer(el, notice.noServer);
      else setFormMessage(el.message, notice.message, notice.kind);
      if (notice.action === 'resend') el.newLinkBtn.hidden = false;
    }
  }

  window.SurveyAuth = {
    init,
    readAuth,
    request,
    requestBytes,
    /* The same origin every call is made to, for the one thing that cannot be a fetch: an <img> or a
       link to a stored file, which the server only answers with the session cookie attached. */
    apiBase: API_BASE,
    logout,
  };
})();
