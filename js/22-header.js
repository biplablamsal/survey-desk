/* Top header: global case search, the notification bell, and the signed-in user's menu.
   Loaded as a classic script after 21-all-cases.js so the directory, views and page helpers exist.
   The header never invents data — the bell is the server's inbox (§12), and the user menu reads the
   signed-in account.

   The one thing here that is not the server's is the fallback. A deadline list computed from the case
   store on this device existed before the inbox did, and it stays: when the server cannot be reached,
   saying "two reports are due" from what is held locally is worth more than saying nothing. That list is
   labelled as local, because the two are different claims and only one of them is the team's.

   Nothing in this file is on a timer. The app refreshes when a person does something, so the inbox is
   re-read when the bell is opened and when the dashboard is drawn, with a short window in which a second
   press reuses what is already held — which is also why a phone on a hill does not spend its data
   polling for news while nobody is looking. */

const NOTIF_MAX = 8;
const NOTIF_FRESH_MS = 30000;

/* One short noun per §12 type, because the sentence the server wrote says what happened and this says
   what kind of thing it was. A type the server knows and this does not is shown without a label rather
   than dropped: the message is the point. */
const NOTIF_KIND = {
  case_assigned: 'Assignment',
  task_assigned: 'Task',
  deadline_approaching: 'Deadline',
  deadline_missed: 'Deadline',
  document_rejected: 'Document',
  task_approved: 'Approval',
  correction_requested: 'Correction',
  admin_instruction: 'Instruction',
  work_submitted: 'Work',
  assignment_changed: 'Assignment',
  account_suspended: 'Account',
  password_reset_requested: 'Security',
  case_comment: 'Comment',
};

const notifState = {
  rows: null,
  unread: 0,
  error: '',
  at: 0,
  onlyUnread: false,
  loading: false,
};

const notifSignedIn = () => {
  if (!window.SurveyAuth || typeof window.SurveyAuth.readAuth !== 'function') return false;
  const auth = window.SurveyAuth.readAuth();
  return Boolean(auth && auth.user);
};

function notifAgo(value) {
  if (!value) return '';
  const mins = Math.round((Date.now() - new Date(value).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(value).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
  });
}

/* The inbox, unless it was read less than a moment ago. `force` is what opening the bell passes, since a
   person who tapped the bell is asking the question now; the dashboard refresh is the one worth
   suppressing. */
async function notifLoad(force) {
  if (!notifSignedIn()) {
    notifState.rows = null;
    notifState.unread = 0;
    notifState.error = '';
    return;
  }
  if (notifState.loading) return;
  if (!force && notifState.rows && Date.now() - notifState.at < NOTIF_FRESH_MS) return;
  notifState.loading = true;
  try {
    const payload = await window.SurveyAuth.request('/api/notifications?limit=40');
    notifState.rows = Array.isArray(payload.notifications) ? payload.notifications : [];
    notifState.unread = Number(payload.unread) || 0;
    notifState.error = '';
    notifState.at = Date.now();
  } catch (error) {
    /* The server's answer is kept when there is one: an inbox that could not be re-read is still the
       last thing the team said, and clearing it would say less than the truth. */
    notifState.error =
      error.status === 0 || (error.message || '').indexOf('fetch') !== -1
        ? 'SurveyPro could not be reached.'
        : error.message || 'SurveyPro could not read your notifications.';
    if (!notifState.rows) notifState.at = Date.now();
  }
  notifState.loading = false;
  paintNotifBadge();
}

/* The count on the bell, from the server whenever this device has heard from it. Overdue deadlines tint
   it red whether or not the inbox answered, because a missed report is red on the dashboard too. */
function paintNotifBadge() {
  const btn = $('#notif-btn');
  if (!btn) return;
  const badge = $('#notif-count');
  const local = notifItems();
  let count = local.list.length;
  let title = local.od
    ? `${local.od} overdue, ${local.soon} due soon`
    : `${local.soon} report deadline(s) due soon`;
  let red = local.od > 0;
  if (notifState.rows) {
    count = notifState.unread;
    title = count ? `${count} unread notification(s)` : 'No unread notifications';
    red =
      local.od > 0 ||
      notifState.rows.some(
        (row) => !row.readAt && (row.type === 'deadline_missed' || row.type === 'task_assigned')
      );
  }
  badge.hidden = !count;
  badge.textContent = String(count);
  badge.classList.toggle('er', red);
  badge.title = title;
}

/* Kept for the dashboard's deadline figures and for the offline bell. */
function notifItems() {
  const V = caseDirectoryRows();
  const odList = V.filter((r) => FT.p_od(r.c) || FT.f_od(r.c));
  const soonList = V.filter((r) => !odList.includes(r) && (FT.p_soon(r.c) || FT.f_soon(r.c)));
  const rank = (r) => (r.P.od || r.F.od ? 0 : dN(dueOf(r.c) || '2999-01-01') - tdN());
  return {
    od: odList.length,
    soon: soonList.length,
    list: [...odList, ...soonList].sort((a, b) => rank(a) - rank(b)),
  };
}

async function notifReadOne(row) {
  if (row.readAt) return;
  try {
    const payload = await window.SurveyAuth.request(
      `/api/notifications/${encodeURIComponent(row.id)}/read`,
      { method: 'POST', body: {} }
    );
    row.readAt = new Date().toISOString();
    notifState.unread = Number(payload.unread) || Math.max(notifState.unread - 1, 0);
  } catch {
    /* A row that could not be marked stays unread. The notice was seen and the page it points at is
       already open; pretending otherwise would clear a reminder somebody has not answered. */
  }
  paintNotifBadge();
}

async function notifReadAll() {
  try {
    await window.SurveyAuth.request('/api/notifications/read-all', { method: 'POST', body: {} });
    (notifState.rows || []).forEach((row) => {
      row.readAt = new Date().toISOString();
    });
    notifState.unread = 0;
  } catch (error) {
    notifState.error = error.message || 'SurveyPro could not mark those as read.';
  }
  renderNotifPop();
  paintNotifBadge();
}

/* One notice, opened the way the rest of the app opens a case: the thread if it names a comment, the
   file if it names a document, the claim otherwise. The fetch-first work belongs to 27-comments.js,
   which owns the page it lands on. */
async function notifJump(row) {
  closePops();
  await notifReadOne(row);
  if (!row.caseId) {
    if (!/^(account_|password_)/.test(String(row.type || '')) && typeof showTasks === 'function')
      showTasks();
    return;
  }
  if (typeof cmOpenNotice === 'function') {
    await cmOpenNotice(row);
    return;
  }
  if (typeof openCase === 'function') openCase(row.caseId);
}

function notifLocalPop() {
  const { od, soon, list } = notifItems();
  return h(
    'div',
    { class: 'pop-list' },
    ...list.slice(0, NOTIF_MAX).map((r) => {
      const d = dl(r.c, pend(r.c, 'p') ? 'p' : 'f');
      return h(
        'button',
        {
          class: 'pop-row',
          type: 'button',
          onclick: () => {
            closePops();
            openCase(r.c.id);
          },
        },
        h('span', { class: 'pop-t' }, h('b', {}, r.id) + ' ' + r.who),
        h('span', { class: 'pop-s mu' }, r.c.st),
        chip(d)
      );
    }),
    od || soon ? null : h('p', { class: 'mu pop-empty' }, 'No pending report deadlines.'),
    h(
      'button',
      {
        class: 'pop-row pop-more',
        type: 'button',
        onclick: () => {
          closePops();
          allCasesState.view = 'od';
          acPersist();
          showAllCases();
        },
      },
      'Open overdue cases'
    )
  );
}

/* The panel is rebuilt on open rather than on every drawDash: an open panel should not be replaced
   mid-read, and the unread markers are the state of this moment. */
function renderNotifPop() {
  const pop = $('#notif-pop');
  if (!notifSignedIn() || notifState.error) {
    pop.replaceChildren(
      h(
        'div',
        { class: 'pop-h' },
        h('b', {}, 'Deadline alerts'),
        h(
          'span',
          { class: 'mu' },
          notifState.error ||
            'Sign in to see the team’s notifications. These deadlines are computed on this device.'
        )
      ),
      notifLocalPop()
    );
    return;
  }
  const rows = notifState.rows || [];
  const shown = notifState.onlyUnread ? rows.filter((row) => !row.readAt) : rows;
  const local = notifItems();
  pop.replaceChildren(
    h(
      'div',
      { class: 'pop-h' },
      h('b', {}, 'Notifications'),
      h(
        'span',
        { class: 'mu' },
        notifState.loading
          ? 'Reading…'
          : notifState.unread
            ? `${notifState.unread} unread`
            : 'Nothing unread' + (local.od ? ` · ${local.od} report deadline(s) overdue` : '')
      )
    ),
    shown.length
      ? h(
          'div',
          { class: 'pop-list' },
          ...shown.slice(0, 12).map((row) => {
            const kind = NOTIF_KIND[row.type] || '';
            return h(
              'button',
              {
                class: 'pop-row pop-notice' + (row.readAt ? '' : ' pop-unread'),
                type: 'button',
                onclick: () => notifJump(row),
              },
              h('span', { class: 'pop-t' }, row.message),
              h(
                'span',
                { class: 'pop-s mu' },
                [kind, notifAgo(row.createdAt)].filter(Boolean).join(' · ')
              )
            );
          })
        )
      : h(
          'p',
          { class: 'mu pop-empty' },
          notifState.onlyUnread ? 'Nothing unread.' : 'No notifications yet.'
        ),
    h(
      'div',
      { class: 'pop-foot' },
      h(
        'button',
        {
          class: 'pop-row',
          type: 'button',
          onclick: () => {
            notifState.onlyUnread = !notifState.onlyUnread;
            renderNotifPop();
          },
        },
        notifState.onlyUnread ? 'Show all' : 'Unread only'
      ),
      notifState.unread
        ? h(
            'button',
            { class: 'pop-row', type: 'button', onclick: () => notifReadAll() },
            'Mark all read'
          )
        : null
    )
  );
}

function syncNotifBadge() {
  /* The dashboard asks for the count; the throttle is what stops that from becoming a poll. A bell whose
     cache is older than the window is refreshed for the price of one request. */
  notifLoad(false);
  paintNotifBadge();
}

const WHO_ITEMS = [
  ['profile', 'My Profile', 'profile-btn'],
  ['account', 'Account Settings', 'account-btn'],
  ['security', 'Security', 'security-btn'],
  ['activity', 'Login Activity', 'activity-btn'],
];

function renderWhoPop() {
  const u = getCurrentAuthUser();
  const pop = $('#who-pop');
  pop.replaceChildren(
    h(
      'div',
      { class: 'pop-h' },
      h('b', {}, (u && (u.fullName || u.name)) || 'Signed out'),
      h('span', { class: 'mu' }, (u && u.email) || 'Local mode – no account')
    ),
    ...(u
      ? WHO_ITEMS.map(([sec, label, btnId]) =>
          h(
            'button',
            {
              class: 'pop-row',
              type: 'button',
              onclick: () => {
                closePops();
                showProfilePage(sec);
                setMenu(btnId);
              },
            },
            label
          )
        )
      : []),
    h(
      'button',
      {
        class: 'pop-row',
        type: 'button',
        onclick: () => {
          closePops();
          showDash();
          setMenu('db');
        },
      },
      'Dashboard'
    ),
    u
      ? h(
          'button',
          {
            class: 'pop-row danger',
            type: 'button',
            onclick: () => {
              closePops();
              /* auth.js owns the logout round-trip and wires #logout-btn; the menu delegates. */
              $('#logout-btn').click();
            },
          },
          'Logout'
        )
      : ''
  );
}

function closePops() {
  ['#notif-pop', '#who-pop'].forEach((s) => ($(s).hidden = true));
  ['#notif-btn', '#who-btn'].forEach((s) => $(s).setAttribute('aria-expanded', 'false'));
}

function togglePop(popSel, btnSel, rebuild) {
  const pop = $(popSel);
  const open = pop.hidden;
  closePops();
  if (!open) return;
  rebuild();
  pop.hidden = false;
  $(btnSel).setAttribute('aria-expanded', 'true');
}

function initHeader() {
  /* Global search drives the All Cases directory, which owns the multi-field matcher. Jumping
     pages on the first keystroke would drop focus, so typing only re-filters an open directory. */
  const gs = $('#gs');
  let gt = 0;
  const focusBack = () => {
    const n = $('#gs');
    n.focus();
    n.setSelectionRange(n.value.length, n.value.length);
  };
  gs.oninput = () => {
    allCasesState.q = gs.value;
    clearTimeout(gt);
    gt = setTimeout(() => {
      /* Persist even when the box is emptied, or a later page load restores a stale filter. */
      acPersist();
      if (!gs.value.trim()) return;
      if (view === 'cases') {
        showAllCases();
        focusBack();
      } else if (gs.value.trim().length >= 3) {
        showAllCases();
        focusBack();
      }
    }, 500);
  };
  gs.onkeydown = (e) => {
    if (e.key !== 'Enter') return;
    clearTimeout(gt);
    allCasesState.q = gs.value;
    acPersist();
    showAllCases();
  };

  $('#notif-btn').onclick = (e) => {
    e.stopPropagation();
    togglePop('#notif-pop', '#notif-btn', renderNotifPop);
    /* The panel opens with whatever the last read left in hand, then says what the server now says —
       a bell that filled itself while a person watched it arrive would be the same delay spent in
       silence. It is only rebuilt if it is still open. */
    if (!$('#notif-pop').hidden) {
      notifLoad(true).then(() => {
        if (!$('#notif-pop').hidden) renderNotifPop();
      });
    }
  };
  $('#who-btn').onclick = (e) => {
    e.stopPropagation();
    togglePop('#who-pop', '#who-btn', renderWhoPop);
  };
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.top-pop')) closePops();
  });
  /* A panel that rebuilds itself detaches its own button before the click reaches the document, and a
     detached button is no longer inside .top-pop — so "Unread only" would read as a click outside and
     shut the panel the person is still looking at. Stopping the event at the panel answers the question
     where it is actually asked: a click inside the bell is not a click away from it. Rows that leave the
     panel close it themselves. */
  ['#notif-pop', '#who-pop'].forEach((sel) => {
    const pop = $(sel);
    if (pop) pop.addEventListener('click', (e) => e.stopPropagation());
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePops();
  });

  $('#mi-mob').onclick = () => impOpen();
  $('#nw-mob').onclick = () => openNew();

  /* The section strip pins itself under this bar, and the bar is a flex row that wraps into two lines
     whenever the window is narrow. A height written into the stylesheet would then either bury the strip
     beneath the bar or leave a gap of scrolling case between them, so the bar publishes the height it
     actually has and the strip reads it from --topH. */
  const topBar = $('header.top');
  if (topBar) {
    const setTopH = () =>
      document.documentElement.style.setProperty(
        '--topH',
        Math.round(topBar.getBoundingClientRect().height) + 'px'
      );
    setTopH();
    if (window.ResizeObserver) new ResizeObserver(setTopH).observe(topBar);
    else addEventListener('resize', setTopH);
  }

  const u = getCurrentAuthUser();
  $('#who-name').textContent = (u && (u.fullName || u.name || u.email)) || 'Guest';
}

initHeader();
