(function () {
  const AUTH_KEY = 'survey-desk-auth';
  const AUTH_SOURCE_KEY = 'survey-desk-auth-source';
  const API_BASE = (() => {
    const host = window.location.hostname || 'localhost';
    return `http://${host}:3000`;
  })();
  const STRONG_PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{12,}$/;

  function isStrongPassword(password) {
    return typeof password === 'string' && STRONG_PASSWORD_REGEX.test(password);
  }

  function parseAuthPayload(raw) {
    if (!raw) return null;
    try {
      const data = JSON.parse(raw);
      if (data && data.token && data.user) return data;
    } catch {
      // ignored
    }
    return null;
  }

  function persistAuth(data, source = 'stored') {
    const serialized = JSON.stringify(data);
    try {
      localStorage.setItem(AUTH_KEY, serialized);
    } catch {
      // ignored
    }
    try {
      sessionStorage.setItem(AUTH_KEY, serialized);
    } catch {
      // ignored
    }
    try {
      sessionStorage.setItem(AUTH_SOURCE_KEY, source);
    } catch {
      // ignored
    }
  }

  function readAuth() {
    const candidates = [];

    try {
      const sessionRaw = sessionStorage.getItem(AUTH_KEY);
      if (sessionRaw) candidates.push(sessionRaw);
    } catch {
      // ignored
    }

    try {
      const localRaw = localStorage.getItem(AUTH_KEY);
      if (localRaw) candidates.push(localRaw);
    } catch {
      // ignored
    }

    for (const raw of candidates) {
      const data = parseAuthPayload(raw);
      if (data) {
        persistAuth(data, 'stored');
        return data;
      }
    }

    try {
      const params = new URLSearchParams(window.location.search);
      const authValue = params.get('auth');
      if (!authValue) return null;
      const data = parseAuthPayload(authValue);
      if (data) {
        persistAuth(data, 'redirect');
        const url = new URL(window.location.href);
        url.searchParams.delete('auth');
        window.history.replaceState({}, document.title, url.toString());
        return data;
      }
    } catch {
      // ignored
    }

    return null;
  }

  function writeAuth(data, source = 'login') {
    persistAuth(data, source);
  }

  function clearAuth() {
    try {
      localStorage.removeItem(AUTH_KEY);
    } catch {
      // ignored
    }
    try {
      sessionStorage.removeItem(AUTH_KEY);
    } catch {
      // ignored
    }
    try {
      sessionStorage.removeItem(AUTH_SOURCE_KEY);
    } catch {
      // ignored
    }
  }

  function renderUserStatus() {
    const auth = readAuth();
    const badge = document.getElementById('auth-user-badge');
    const logoutBtn = document.getElementById('logout-btn');
    const sidebarLogout = document.getElementById('logout-btn-sidebar');
    const user = auth && auth.user ? auth.user : null;

    if (badge) {
      if (user) {
        badge.textContent = `Signed in: ${user.email || user.name || 'User'}`;
        badge.hidden = false;
      } else {
        badge.textContent = '';
        badge.hidden = true;
      }
    }

    [logoutBtn, sidebarLogout].forEach((btn) => {
      if (btn) {
        btn.hidden = !user;
      }
    });
  }

  async function logout() {
    try {
      const auth = readAuth();
      if (auth && auth.token) {
        await request('/api/auth/logout', { method: 'POST' }).catch(() => null);
      }
    } finally {
      clearAuth();
      renderUserStatus();
      document.body.classList.add('auth-locked');
      const authShell = document.getElementById('auth-shell') || buildShell();
      authShell.style.display = 'flex';
      if (!document.body.contains(authShell)) {
        document.body.appendChild(authShell);
      }
      if (window.showDash) {
        try {
          window.showDash();
        } catch {
          // ignored
        }
      }
      if (typeof window.location !== 'undefined') {
        window.location.reload();
      }
    }
  }

  function showApp() {
    document.body.classList.remove('auth-locked');
    renderUserStatus();
  }

  function hideApp() {
    document.body.classList.add('auth-locked');
  }

  function parseResetToken() {
    const params = new URLSearchParams(window.location.search);
    return params.get('reset');
  }

  function parseVerifyToken() {
    const params = new URLSearchParams(window.location.search);
    return params.get('verify');
  }

  async function request(path, options = {}) {
    const auth = readAuth();
    const headers = { ...(options.headers || {}) };
    const isFormData = options.body instanceof FormData;
    if (!isFormData && !headers['Content-Type'] && options.body) {
      headers['Content-Type'] = 'application/json';
    }
    if (auth && auth.token) {
      headers.Authorization = `Bearer ${auth.token}`;
    }

    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
      body: options.body && !isFormData ? JSON.stringify(options.body) : options.body,
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || payload.message || 'Request failed');
    }

    return payload;
  }

  function showMessage(el, text, kind = 'error') {
    if (!el) return;
    el.textContent = text;
    el.className = 'auth-message ' + kind;
  }

  function notifyAuthOutcome(message, isSuccess) {
    const label = isSuccess ? 'info' : 'warn';
    if (typeof console !== 'undefined') {
      console[label](message);
    }
    if (typeof window !== 'undefined' && typeof window.alert === 'function') {
      window.alert(message);
    }
  }

  function buildShell() {
    const existing = document.getElementById('auth-shell');
    if (existing) return existing;

    const root = document.createElement('div');
    root.id = 'auth-shell';
    root.className = 'auth-shell';
    root.innerHTML = `
      <div class="auth-layout">
        <aside class="auth-visual" aria-label="SurveyDesk branding">
          <div class="auth-visual-inner">
            <img src="assets/survey-desk-logo.svg" alt="Survey Desk" class="auth-logo-art" />
          </div>
        </aside>

        <div class="auth-card">
          <div class="auth-brand" aria-label="SurveyDesk branding">
            <div class="auth-brand-mark">SD</div>
            <div class="auth-brand-copy">
              <strong>Survey Desk</strong>
              <span>Secure field reporting</span>
            </div>
          </div>

          <div class="auth-mode-switch" role="tablist" aria-label="Authentication mode">
            <button type="button" class="auth-mode-btn is-active" data-mode="login">Sign in</button>
            <button type="button" class="auth-mode-btn" data-mode="signup">Create account</button>
          </div>

          <form id="auth-form" class="auth-form" novalidate>
            <div class="auth-form-head">
              <h1 id="auth-form-title">Welcome back</h1>
              <p id="auth-form-subtitle">Use your work email to access Survey Desk.</p>
            </div>

            <div class="auth-grid" id="auth-name-row" hidden>
              <div class="fld">
                <label for="auth-full-name">Full name</label>
                <input id="auth-full-name" name="fullName" placeholder="Alex Morgan" autocomplete="name" />
              </div>
            </div>

            <div class="fld">
              <label for="auth-email">Work email</label>
              <input id="auth-email" type="email" name="email" placeholder="you@company.com" autocomplete="email" required />
            </div>

            <div class="fld" id="auth-password-wrap">
              <label for="auth-password">Password</label>
              <div class="password-field">
                <input id="auth-password" type="password" name="password" placeholder="Minimum 12 characters" autocomplete="current-password" required />
                <button type="button" class="password-toggle" aria-label="Show password">Show</button>
              </div>
            </div>

            <div class="fld" id="auth-confirm-wrap" hidden>
              <label for="auth-confirm">Confirm password</label>
              <div class="password-field">
                <input id="auth-confirm" type="password" name="confirmPassword" placeholder="Repeat your password" autocomplete="new-password" />
                <button type="button" class="password-toggle" aria-label="Show confirm password">Show</button>
              </div>
            </div>

            <div class="auth-inline-row">
              <label class="auth-remember">
                <input type="checkbox" id="auth-remember-me" />
                <span>Keep me signed in</span>
              </label>
              <button type="button" class="auth-link" id="auth-forgot-link">Forgot password?</button>
            </div>

            <button type="submit" class="auth-btn" id="auth-submit-btn">Sign in</button>

            <div class="auth-divider"><span>or continue with</span></div>

            <button type="button" class="auth-btn secondary" id="gmail-login-btn">
              <span class="google-mark" aria-hidden="true">G</span>
              Continue with Google
            </button>

            <p class="auth-footer">
              <span id="auth-footer-text">Need an account?</span>
              <button type="button" class="auth-link inline" id="auth-toggle-link">Create one</button>
            </p>

            <p id="auth-message" class="auth-message" aria-live="polite"></p>
            <button type="button" class="auth-link back-link" id="auth-back-link" hidden>Back to sign in</button>
          </form>
        </div>
      </div>
    `;

    document.body.appendChild(root);
    return root;
  }

  function attachHandlers(root) {
    const form = root.querySelector('#auth-form');
    const message = root.querySelector('#auth-message');
    const title = root.querySelector('#auth-form-title');
    const subtitle = root.querySelector('#auth-form-subtitle');
    const emailField = root.querySelector('#auth-email');
    const passwordField = root.querySelector('#auth-password');
    const confirmField = root.querySelector('#auth-confirm');
    const nameRow = root.querySelector('#auth-name-row');
    const confirmWrap = root.querySelector('#auth-confirm-wrap');
    const submitBtn = root.querySelector('#auth-submit-btn');
    const forgotLink = root.querySelector('#auth-forgot-link');
    const backLink = root.querySelector('#auth-back-link');
    const toggleLink = root.querySelector('#auth-toggle-link');
    const footerText = root.querySelector('#auth-footer-text');
    const modeButtons = root.querySelectorAll('[data-mode]');
    const gmailBtn = root.querySelector('#gmail-login-btn');
    const rememberField = root.querySelector('#auth-remember-me');
    const passwordToggles = root.querySelectorAll('.password-toggle');

    const state = { mode: 'login' };

    function setMode(mode) {
      state.mode = mode;
      const isSignup = mode === 'signup';
      const isForgot = mode === 'forgot';
      const isReset = mode === 'reset';
      const isLogin = !isSignup && !isForgot && !isReset;

      nameRow.hidden = !isSignup;
      confirmWrap.hidden = !isSignup;
      submitBtn.textContent = isForgot
        ? 'Send reset link'
        : isSignup
          ? 'Create account'
          : isReset
            ? 'Set new password'
            : 'Sign in';

      title.textContent = isForgot
        ? 'Reset your password'
        : isReset
          ? 'Choose a new password'
          : isSignup
            ? 'Create your account'
            : 'Welcome back';

      subtitle.textContent = isForgot
        ? 'Enter the email linked to your Survey Desk account.'
        : isReset
          ? 'Create a strong password to finish resetting access.'
          : isSignup
            ? 'Set up secure access for your claim workflows.'
            : 'Use your work email to view cases, reports, and insights.';

      passwordField.required = !isForgot && !isReset;
      confirmField.required = isSignup;
      forgotLink.hidden = isForgot || isReset;
      backLink.hidden = !isForgot && !isReset;
      rememberField.closest('.auth-inline-row').style.display =
        isForgot || isReset ? 'none' : 'flex';
      footerText.textContent = isSignup ? 'Already have an account?' : 'Need an account?';
      toggleLink.textContent = isSignup ? 'Sign in' : 'Create one';
      toggleLink.hidden = isForgot || isReset;
      modeButtons.forEach((button) => {
        const active = button.dataset.mode === mode;
        button.classList.toggle('is-active', active);
      });

      if (isForgot || isReset) {
        passwordField.value = '';
        confirmField.value = '';
      }

      if (isSignup) {
        emailField.focus();
      } else if (isLogin) {
        emailField.focus();
      } else if (isForgot) {
        emailField.focus();
      }
    }

    modeButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const nextMode = button.dataset.mode;
        setMode(nextMode);
        if (nextMode === 'login') {
          showMessage(message, '', 'success');
        }
      });
    });

    forgotLink.addEventListener('click', () => {
      setMode('forgot');
      showMessage(message, 'Enter your email to receive a reset link.', 'success');
      emailField.focus();
    });

    backLink.addEventListener('click', () => {
      setMode('login');
      showMessage(message, '', 'success');
      emailField.focus();
    });

    toggleLink.addEventListener('click', () => {
      setMode(state.mode === 'signup' ? 'login' : 'signup');
      showMessage(message, '', 'success');
    });

    passwordToggles.forEach((toggle) => {
      toggle.addEventListener('click', () => {
        const field = toggle.previousElementSibling;
        if (!field) return;
        const isHidden = field.type === 'password';
        field.type = isHidden ? 'text' : 'password';
        toggle.textContent = isHidden ? 'Hide' : 'Show';
        toggle.setAttribute('aria-label', isHidden ? 'Hide password' : 'Show password');
      });
    });

    gmailBtn.addEventListener('click', () => {
      setMode('login');
      gmailBtn.disabled = true;
      showMessage(message, 'Redirecting to Google sign-in…', 'success');

      try {
        window.location.href = `${API_BASE}/api/auth/google/start`;
      } catch (error) {
        gmailBtn.disabled = false;
        showMessage(message, error.message || 'Google sign-in is unavailable right now.', 'error');
      }
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const email = emailField.value.trim();
      const fullName = root.querySelector('#auth-full-name').value.trim();
      const password = passwordField.value;
      const confirm = confirmField.value;

      if (!email) {
        showMessage(message, 'Please enter your email address.', 'error');
        return;
      }

      if (state.mode === 'forgot') {
        try {
          const response = await request('/api/auth/forgot-password', {
            method: 'POST',
            body: { email },
          });
          const previewText = response.previewUrl
            ? `Reset link ready: ${response.previewUrl}`
            : 'Password reset instructions have been sent to your email.';
          showMessage(message, previewText, 'success');
          setMode('login');
        } catch (error) {
          showMessage(message, error.message, 'error');
        }
        return;
      }

      if (state.mode === 'reset') {
        const resetToken = document.getElementById('auth-reset-token')?.value || null;
        if (!resetToken) {
          showMessage(message, 'Missing password reset token.', 'error');
          return;
        }
        if (!isStrongPassword(password)) {
          showMessage(
            message,
            'Choose a password with at least 12 characters, including upper/lower case, a number, and a symbol.',
            'error'
          );
          return;
        }
        try {
          const response = await request('/api/auth/reset-password', {
            method: 'POST',
            body: { token: resetToken, password, confirmPassword: password },
          });
          clearAuth();
          showMessage(
            message,
            response.message || 'Password reset successful. Please log in.',
            'success'
          );
          setMode('login');
          form.reset();
          history.replaceState({}, document.title, window.location.pathname);
        } catch (error) {
          showMessage(message, error.message, 'error');
        }
        return;
      }

      if (state.mode === 'signup') {
        if (!isStrongPassword(password)) {
          showMessage(
            message,
            'Password must be at least 12 characters, include upper and lower case, a number, and a symbol.',
            'error'
          );
          return;
        }
        if (password !== confirm) {
          showMessage(message, 'Passwords do not match.', 'error');
          return;
        }
      }

      if (!isStrongPassword(password)) {
        showMessage(
          message,
          'Password must be at least 12 characters, include upper and lower case, a number, and a symbol.',
          'error'
        );
        return;
      }

      try {
        const route = state.mode === 'signup' ? '/api/auth/signup' : '/api/auth/login';
        const payload =
          state.mode === 'signup' ? { email, password, name: fullName } : { email, password };

        const response = await request(route, { method: 'POST', body: payload });

        if (state.mode === 'signup') {
          showMessage(
            message,
            response.message ||
              `Account created for ${email}. Please verify your email before signing in.`,
            'success'
          );
          form.reset();
          setMode('login');
          return;
        }

        writeAuth({ token: response.token, user: response.user });
        const successText = `Login successful. Welcome back, ${response.user.email}.`;
        showMessage(message, successText, 'success');
        notifyAuthOutcome(successText, true);
        showApp();
        const authShell = document.getElementById('auth-shell');
        if (authShell) authShell.remove();
        if (window.showDash) {
          window.showDash();
        }
      } catch (error) {
        showMessage(message, error.message, 'error');
      }
    });

    const verifyToken = parseVerifyToken();
    if (verifyToken) {
      request('/api/auth/verify-email', {
        method: 'POST',
        body: { token: verifyToken },
      })
        .then((payload) => {
          showMessage(message, payload.message || 'Email verified successfully.', 'success');
          setMode('login');
          history.replaceState({}, document.title, window.location.pathname);
        })
        .catch((error) => {
          showMessage(message, error.message, 'error');
        });
    }

    const resetToken = parseResetToken();
    if (resetToken) {
      setMode('reset');
      showMessage(message, 'Password reset token detected. Set a new password below.', 'success');
      const pendingField = document.createElement('div');
      pendingField.className = 'fld';
      pendingField.innerHTML = `
        <label for="auth-reset-token">Reset token</label>
        <input id="auth-reset-token" value="${resetToken}" readonly />
      `;
      form.insertBefore(pendingField, submitBtn);
    }

    root.querySelector('#auth-email').focus();
  }

  function init() {
    const shell = buildShell();
    attachHandlers(shell);
    const logoutBtn = document.getElementById('logout-btn');
    const sidebarLogout = document.getElementById('logout-btn-sidebar');
    [logoutBtn, sidebarLogout].forEach((btn) => {
      if (btn) {
        btn.onclick = () => logout();
      }
    });
    hideApp();

    const auth = readAuth();
    if (auth && auth.token) {
      const hydrated = { token: auth.token, user: auth.user || auth.userData || null };

      try {
        persistAuth(hydrated, 'stored');
      } catch {
        // ignored
      }

      const source = (() => {
        try {
          return sessionStorage.getItem(AUTH_SOURCE_KEY) || 'stored';
        } catch {
          return 'stored';
        }
      })();

      if (source === 'redirect' || source === 'login') {
        const successMessage =
          hydrated.user && hydrated.user.email
            ? `Login successful. Welcome back, ${hydrated.user.email}.`
            : 'Login successful.';
        notifyAuthOutcome(successMessage, true);
      }

      try {
        sessionStorage.setItem(AUTH_SOURCE_KEY, 'stored');
      } catch {
        // ignored
      }

      showApp();
      if (window.showDash) {
        window.showDash();
      }
      shell.remove();
      return;
    }

    shell.style.display = 'flex';
    renderUserStatus();
  }

  window.SurveyAuth = {
    init,
    readAuth,
    writeAuth,
    clearAuth,
    request,
  };
})();
