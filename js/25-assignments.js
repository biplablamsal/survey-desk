/* Assignments and the approval workflow: the assigner's form and review queue, and the member's own
   list of work (brief §5, §6).
   Loaded as a classic script, after 24-case-sync.js and before 99-main.js. What it borrows: h()/esc()
   from 01, DB and cur from 03, the case vocabulary and toast()/mayUse()/getCurrentAuthUser()/
   normalizeServerRole()/caseDirectoryRows()/setMenu()/showDash-adjacent helpers from 11, openCase()
   from 08, the BS date picker openDP() from 12, syncTake() from 24, closeSideMenu() from 14 and
   SurveyAuth.request() from auth.js.

   This is the first screen in the app that reads its list from the server rather than from the
   browser's own copy of the cases, and it has to be: an assignment is a statement about one file and
   two people, and the person it was given to is usually on another device. So this screen needs a
   connection, and when there is not one it says so. An empty table would read as "nobody has asked
   you for anything", which is a different fact and a misleading one.

   The buttons on a task are not decided here. Every row arrives with `actions` and `craft`, computed
   by the same table the routes use to refuse requests, so a screen cannot offer a transition the
   server is about to reject. §7's "do not rely on frontend button visibility for security" is
   untouched by that: the route asks the question again on every press. */

const TK_TYPES = [
  'Physical Inspection',
  'Document Collection',
  'Vehicle Information Entry',
  'Inspection Checklist',
  'Photograph Collection',
  'Repair Bill Collection',
  'Legal Document Collection',
  'Other',
];

const TK_PRIORITIES = ['Urgent', 'High', 'Medium', 'Normal'];

/* The two statuses the review queue is made of. §6 separates a first submission from a resubmission
   after a correction, and a reviewer wants both in one place. */
const TK_AWAITING = ['Submitted for Review', 'Resubmitted'];

/* One button label per verb, in the words §6 uses. The verbs themselves are never listed here: they
   arrive with the row, from the server, which is the only place the workflow is written down. */
const TK_LABEL = {
  accept: 'Accept',
  start: 'Start work',
  submit: 'Submit for review',
  resubmit: 'Resubmit',
  approve: 'Approve',
  reject: 'Return for correction',
  cancel: 'Withdraw',
};

/* The same four tones the dashboard and All Cases already use for priority, so a task card and the
   case row above it cannot disagree about what Urgent looks like. */
const TK_TONE = { Urgent: 'pr-u', High: 'pr-h', Medium: 'pr-m', Normal: 'pr-n' };

const TK_STATUS_TONE = {
  Assigned: 'pr-n',
  Accepted: 'pr-n',
  'In Progress': 'pr-m',
  'Submitted for Review': 'pr-h',
  'Correction Required': 'pr-u',
  Resubmitted: 'pr-h',
  Approved: 'pr-n',
  Cancelled: 'pr-n',
};

const TK_EVENT_LABEL = {
  assigned: 'Assigned',
  accepted: 'Accepted',
  started: 'Started',
  submitted: 'Submitted for review',
  returned: 'Returned for correction',
  resubmitted: 'Resubmitted',
  approved: 'Approved',
  withdrawn: 'Withdrawn',
  reassigned: 'Reassigned',
  updated: 'Brief changed',
};

const tkState = { tab: 'mine', rows: [], counts: null, loading: false, error: '', root: null };

/* The permission that guards the API, asked of the server's set — the same two-layer form the rest of
   the app uses, with the role only as the fallback for a session that has no set yet. */
function tkMay(permissionKey, surveyorsToo) {
  if (typeof mayUse !== 'function') return Boolean(surveyorsToo);
  const list =
    window.SurveyAuth &&
    window.SurveyAuth.readAuth &&
    (window.SurveyAuth.readAuth() || {}).permissions;
  if (Array.isArray(list)) return list.includes(permissionKey);
  const user = typeof getCurrentAuthUser === 'function' ? getCurrentAuthUser() : null;
  const role =
    typeof normalizeServerRole === 'function' ? normalizeServerRole(user && user.role) : '';
  return role === 'ADMIN' || (Boolean(surveyorsToo) && role === 'SURVEYOR');
}

const tkDate = (value) =>
  value
    ? new Date(value).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: '2-digit',
      })
    : '';

const tkDateTime = (value) =>
  value
    ? new Date(value).toLocaleString('en-GB', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

/* Priority first, then the deadline, then the kind of work: the list a member reads at seven in the
   morning is a queue of what to do next, not a register. Normal is last because that is what the word
   says, and it would sort first alphabetically. */
function tkSort(rows) {
  const rank = TK_PRIORITIES.reduce((m, p, i) => Object.assign(m, { [p]: i }), {});
  return rows.slice().sort((a, b) => {
    const p = (rank[a.priority] || 0) - (rank[b.priority] || 0);
    if (p) return p;
    const d = String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999'));
    return d || String(a.assignmentType).localeCompare(String(b.assignmentType));
  });
}

async function tkLoad() {
  tkState.loading = true;
  tkState.error = '';
  tkPaint();
  const seesAll = tkMay('view_all_cases', false);
  const scope =
    tkState.tab === 'mine'
      ? 'mine'
      : tkState.tab === 'handed'
        ? 'assigned'
        : tkState.tab === 'all'
          ? 'all'
          : seesAll
            ? 'all'
            : 'assigned';
  try {
    const payload = await SurveyAuth.request('/api/tasks?scope=' + scope);
    const rows = Array.isArray(payload.tasks) ? payload.tasks : [];
    tkState.rows =
      tkState.tab === 'review' ? rows.filter((t) => TK_AWAITING.includes(t.status)) : rows;
    tkState.counts = payload.counts || null;
    tkState.loading = false;
    tkPaint();
  } catch (error) {
    tkState.loading = false;
    tkState.error =
      error.status === 403
        ? 'This account is not permitted to see that list.'
        : error.status === 0 || (error.message || '').indexOf('fetch') !== -1
          ? 'SurveyPro could not be reached. Assignments live on the server, so this list cannot be shown offline.'
          : error.message || 'SurveyPro could not read the task register.';
    tkPaint();
  }
}

function tkTabs() {
  const tabs = [['mine', 'My work']];
  if (tkMay('assign_case', true)) tabs.push(['handed', 'Handed out']);
  tabs.push(['review', 'Waiting for review']);
  if (tkMay('view_all_cases', false)) tabs.push(['all', 'All work']);
  return h(
    'div',
    { class: 'tk-tabs', role: 'tablist', 'aria-label': 'Whose work' },
    ...tabs.map(([key, label]) =>
      h(
        'button',
        {
          class: 'tk-tab' + (tkState.tab === key ? ' on' : ''),
          type: 'button',
          role: 'tab',
          'aria-selected': tkState.tab === key ? 'true' : 'false',
          onclick: () => {
            if (tkState.tab === key) return;
            tkState.tab = key;
            /* A tab chosen here is part of where the person is standing, and it repaints in place
               rather than through showTasks(), so it says so itself. */
            rememberPlace();
            tkLoad();
          },
        },
        label
      )
    )
  );
}

/* §4's staff dashboard in four numbers, straight from countTasksForUser on the server. */
function tkCounts() {
  const c = tkState.counts;
  if (!c) return null;
  return h(
    'div',
    { class: 'tk-counts' },
    ...[
      ['Open', c.open, ''],
      ['Waiting for review', c.awaiting_review, 'am'],
      ['Needs correcting', c.corrections, 'rd'],
      ['Approved', c.approved, 'gn'],
    ].map(([label, value, tone]) =>
      h('div', { class: 'tk-count ' + tone }, h('b', {}, String(value || 0)), h('span', {}, label))
    )
  );
}

/* One case, reached the way every other screen reaches one — but taken from the server first if this
   device has never held it, which is the normal situation for work assigned to somebody by somebody
   else. syncTake() is the existing local-first pull for a single case; only the order is new. */
async function tkOpenCase(caseId) {
  if (!DB[caseId]) {
    await syncTake(caseId);
    if (!DB[caseId]) {
      toast('That case could not be fetched from SurveyPro. The work is still listed here.');
      return;
    }
  }
  openCase(caseId);
}

async function tkSend(pathname, options, ok, then) {
  try {
    await SurveyAuth.request(pathname, options);
    if (ok && typeof toast === 'function') toast(ok);
    if (then) return then();
    return tkLoad();
  } catch (error) {
    /* A 409 is not a dead end here: it means somebody else moved the task first, and what the screen
       must do then is show the status that is true now rather than the one it painted a moment ago.
       So the refusal is said and the list is reloaded anyway. */
    if (typeof toast === 'function') toast(error.message || 'SurveyPro refused that.');
    if (error.status === 409 || error.status === 404) tkLoad();
  }
}

const tkPost = (task, action, body, ok, then) =>
  tkSend('/api/tasks/' + task.id + '/' + action, { method: 'POST', body: body || {} }, ok, then);

function tkActions(task) {
  const buttons = (task.actions || []).map((item) =>
    h(
      'button',
      {
        class: 'b' + (item.action === 'approve' || item.action === 'submit' ? ' p' : ''),
        type: 'button',
        onclick: () =>
          item.requiresReason
            ? tkReasonDialog(task, item.action)
            : tkPost(task, item.action, {}, 'Work updated.'),
      },
      TK_LABEL[item.action] || item.action
    )
  );
  const craft = task.craft || {};
  if (craft.edit)
    buttons.push(
      h('button', { class: 'b', type: 'button', onclick: () => tkBriefDialog(task) }, 'Brief')
    );
  if (craft.reassign)
    buttons.push(
      h('button', { class: 'b', type: 'button', onclick: () => tkReassignDialog(task) }, 'Reassign')
    );
  buttons.push(
    h(
      'button',
      { class: 'b tk-more', type: 'button', onclick: () => tkHistoryDialog(task) },
      'History'
    )
  );
  return h('div', { class: 'tk-acts' }, ...buttons);
}

function tkCard(task) {
  const closed = task.status === 'Approved' || task.status === 'Cancelled';
  const meta = [];
  if (tkState.tab !== 'mine' && task.assigneeName) meta.push('for ' + task.assigneeName);
  if (task.assignedByName) meta.push('handed out by ' + task.assignedByName);
  if (task.assignedAt) meta.push(tkDate(task.assignedAt));
  const detail = [task.insurer, task.vehicleRegistration, task.insuredName, task.caseStage];

  return h(
    'article',
    { class: 'tk-card' + (closed ? ' tk-closed' : '') },
    h(
      'div',
      { class: 'tk-card-top' },
      h('h3', { class: 'tk-type' }, task.assignmentType),
      h(
        'div',
        { class: 'tk-pills' },
        h(
          'span',
          { class: 'pill tk-status ' + (TK_STATUS_TONE[task.status] || 'pr-n') },
          task.status
        ),
        h('span', { class: 'pill ' + (TK_TONE[task.priority] || 'pr-n') }, task.priority),
        task.dueDate ? h('span', { class: 'pill tk-due' }, 'Due ' + task.dueDate) : null
      )
    ),
    h(
      'button',
      {
        class: 'tk-case',
        type: 'button',
        title: 'Open the case',
        onclick: () => tkOpenCase(task.caseId),
      },
      h('b', {}, task.caseNumber || task.caseId),
      h('span', {}, detail.filter(Boolean).join(' · '))
    ),
    meta.length ? h('p', { class: 'mu tk-meta' }, meta.join(' · ')) : null,
    task.instructions ? h('p', { class: 'tk-note' }, task.instructions) : null,
    task.reviewReason
      ? h(
          'p',
          { class: 'tk-why ' + (task.status === 'Approved' ? 'ok' : 'bad') },
          (task.status === 'Approved' ? 'Approved — ' : 'Returned — ') + task.reviewReason
        )
      : null,
    tkActions(task)
  );
}

function tkBody() {
  if (tkState.error) return h('div', { class: 'tk-empty bad' }, tkState.error);
  if (tkState.loading && !tkState.rows.length)
    return h('div', { class: 'tk-empty' }, 'Reading the task register…');
  const rows = tkSort(tkState.rows);
  if (!rows.length)
    return h(
      'div',
      { class: 'tk-empty' },
      tkState.tab === 'review'
        ? 'Nothing is waiting for a decision.'
        : tkState.tab === 'mine'
          ? 'Nothing has been assigned to you.'
          : tkState.tab === 'handed'
            ? 'You have not handed out any work yet.'
            : 'No tasks have been recorded yet.'
    );
  return h('div', { class: 'tk-list' }, ...rows.map(tkCard));
}

function tkPaint() {
  if (!tkState.root) return;
  const box = tkState.root.querySelector('.tk-body');
  if (box) box.replaceChildren(tkBody());
  /* The tab strip carries which one is on, so it is rebuilt from the same state as the list —
     otherwise the card below says "Handed out" while the strip still highlights "My work". */
  const tabs = tkState.root.querySelector('.tk-tabs');
  if (tabs) tabs.replaceChildren(...tkTabs().children);
  const counts = tkState.root.querySelector('.tk-counts-slot');
  if (counts) counts.replaceChildren(tkCounts() || h('span', { hidden: true }));
  const title = tkState.root.querySelector('.tk-title');
  if (title) title.textContent = tkState.tab === 'mine' ? 'My work' : 'Tasks & assignments';
}

function renderTasksView() {
  const root = h('div', { class: 'case-directory tk2' });
  tkState.root = root;
  const assignBtn = h(
    'button',
    { class: 'b p', type: 'button', onclick: () => tkAssignDialog(null) },
    '+ Assign work'
  );
  assignBtn.hidden = !tkMay('assign_case', true);
  root.append(
    h(
      'div',
      { class: 'dh tk-head' },
      h(
        'div',
        { class: 'tk-head-t' },
        h('h1', { class: 'tk-title' }, tkState.tab === 'mine' ? 'My work' : 'Tasks & assignments'),
        h('p', { class: 'mu' }, 'Work assigned across the team, and the approvals waiting on it.')
      ),
      h(
        'div',
        { class: 'bar' },
        assignBtn,
        h('button', { class: 'b', type: 'button', onclick: showDash }, 'Dashboard')
      )
    ),
    tkTabs(),
    h('div', { class: 'tk-counts-slot' }, tkCounts() || h('span', { hidden: true })),
    h('div', { class: 'tk-body' }, tkBody())
  );
  tkLoad();
  return root;
}

function showTasks(options = {}) {
  if (options.tab) tkState.tab = options.tab;
  view = 'tasks';
  $('#dash').hidden = false;
  $('#dash').classList.add('dash-cases');
  $('.app').hidden = true;
  ['#cs', '#del', '#dx', '#ta', '#td', '#tc'].forEach((sel) => {
    const el = $(sel);
    if (el) el.hidden = true;
  });
  $('#cm').hidden = true;
  $('#ct').hidden = true;
  $('#dash').replaceChildren(renderTasksView());
  setMenu('tk');
  window.scrollTo(0, 0);
  rememberPlace();
}

/* ── dialogs ─────────────────────────────────────────────────────────────────────────────── */

/* The dialog shape the rest of the app already uses — a form method="dialog", a .bar footer, removed
   on close — from acAssign() in 21-all-cases.js. onSubmit returning false keeps the dialog open,
   which is what a missing reason or an unfinished picker needs. */
function tkDialog(title, body, submitLabel, onSubmit, note) {
  const dlg = h('dialog', { class: 'tk-dlg', 'aria-labelledby': 'tk-dlg-title' });
  const submit = h(
    'button',
    {
      class: 'b p',
      type: 'submit',
      onclick: (e) => {
        if (onSubmit() === false) e.preventDefault();
        else dlg.close();
      },
    },
    submitLabel
  );
  dlg.append(
    h(
      'form',
      { method: 'dialog' },
      h('h3', { id: 'tk-dlg-title' }, title),
      note ? h('p', { class: 'mu' }, note) : null,
      body,
      h(
        'div',
        { class: 'bar' },
        h('button', { class: 'b', type: 'button', onclick: () => dlg.close() }, 'Cancel'),
        submit
      )
    )
  );
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
  const first = dlg.querySelector('select, input, textarea');
  if (first) first.focus();
  return dlg;
}

const tkField = (label, control) =>
  h('label', { class: 'tk-field' }, h('span', {}, label), control);

const tkSelect = (options, value) => {
  const sel = h('select', {});
  options.forEach((o) => sel.append(h('option', { value: o.v }, o.t)));
  if (value) sel.value = value;
  return sel;
};

const tkArea = (rows, value) => {
  const box = h('textarea', { rows: String(rows), maxlength: '4000' });
  box.value = value || '';
  return box;
};

/* A date the way the rest of the app takes one: read-only, and the BS/AD wheel from
   12-date-picker-bs.js behind the click. The column is TEXT for exactly that reason — a Nepali date
   is not a Gregorian one. */
const tkDateInput = (value) => {
  const inp = h('input', { type: 'text', maxlength: '32', placeholder: 'Pick date (AD / BS)' });
  inp.value = value || '';
  inp.readOnly = true;
  inp.style.cursor = 'pointer';
  inp.onclick = () => openDP(inp);
  return inp;
};

/* The roster for the picker. Names only — an assigner chooses a person to hand a job to, not an
   account to manage, and /api/members is scoped to say so. Choosing yourself is refused here and at
   the route: work you gave yourself is not an assignment, it is a to-do list, and §5's approval step
   would have nobody to approve it. */
async function tkMemberPicker(currentId) {
  const payload = await SurveyAuth.request('/api/members');
  const me = typeof getCurrentAuthUser === 'function' ? getCurrentAuthUser() : null;
  const rows = (Array.isArray(payload.members) ? payload.members : []).filter(
    (m) => m.id !== (me && me.id) && m.id !== currentId
  );
  return {
    members: rows,
    options: rows
      .map((m) => ({
        v: m.id,
        t: [m.fullName, m.designation, m.role === 'STAFF' ? '' : m.role.toLowerCase()]
          .filter(Boolean)
          .join(' · '),
      }))
      .sort((a, b) => a.t.localeCompare(b.t)),
  };
}

/* §5's form, field for field: the case, the member, the kind of work, the priority, the deadline and
   the instructions. Case Number and Assigned By are not inputs. Both are decided here — by which case
   was chosen and by who is signed in — so neither can be mistyped or claimed. */
async function tkAssignDialog(fixedCase) {
  const busy = h('p', { class: 'mu' }, 'Loading the team…');
  const body = h('div', { class: 'tk-form' }, busy);
  const dlg = tkDialog('Assign work', body, 'Assign', () => false, null);
  const form = dlg.querySelector('form');
  const submit = form.querySelector('button[type=submit]');

  /* The directory writes '—' for a field a case does not have, which reads correctly in a table cell
     and like a blank line in a select. A picker shows what is known and nothing else. */
  const tkLabelParts = (parts) => parts.filter((v) => v && v !== '—').join(' · ');
  const cases = (typeof caseDirectoryRows === 'function' ? caseDirectoryRows() : []).map((r) => ({
    v: r.c.id,
    t: tkLabelParts([r.id, r.ins, r.vrn]),
  }));
  if (fixedCase && !cases.some((c) => c.v === fixedCase.id))
    cases.unshift({ v: fixedCase.id, t: [fixedCase.id, fixedCase.t].filter(Boolean).join(' · ') });

  let picked = null;
  try {
    picked = await tkMemberPicker(null);
  } catch (error) {
    busy.textContent = error.message || 'SurveyPro could not load the team.';
    submit.disabled = true;
    return dlg;
  }
  if (!picked.options.length) {
    busy.textContent =
      'There is nobody on the register to hand work to. Accounts are created under Users & Roles.';
    submit.disabled = true;
    return dlg;
  }
  busy.remove();

  const caseSel = tkSelect(cases, fixedCase && fixedCase.id);
  caseSel.disabled = Boolean(fixedCase);
  const memberSel = tkSelect(picked.options);
  const typeSel = tkSelect(TK_TYPES.map((t) => ({ v: t, t })));
  const priSel = tkSelect(
    TK_PRIORITIES.map((t) => ({ v: t, t })),
    'Normal'
  );
  const due = tkDateInput('');
  const note = tkArea(4, '');
  const hint = h('p', { class: 'mu tk-hint' });

  const paintHint = () => {
    const member = picked.members.find((m) => m.id === memberSel.value);
    hint.textContent =
      member && member.mustChangePassword
        ? 'That account has not set its own password yet, so this task will wait for them to sign in.'
        : 'The member is given access to the case for as long as this task stays open.';
  };
  memberSel.onchange = paintHint;
  paintHint();

  form.insertBefore(
    h(
      'div',
      { class: 'tk-form' },
      tkField('Case', caseSel),
      tkField('Assigned staff', memberSel),
      tkField('Assignment type', typeSel),
      tkField('Priority', priSel),
      tkField('Due date', due),
      tkField('Instructions', note),
      hint
    ),
    form.querySelector('.bar')
  );
  submit.onclick = (e) => {
    if (!caseSel.value || !memberSel.value || !typeSel.value) {
      e.preventDefault();
      if (typeof toast === 'function') toast('Choose a case, a member and the kind of work.');
      return;
    }
    const assignedCaseId = caseSel.value;
    tkSend(
      '/api/tasks',
      {
        method: 'POST',
        body: {
          caseId: assignedCaseId,
          assigneeUserId: memberSel.value,
          assignmentType: typeSel.value,
          priority: priSel.value,
          dueDate: due.value.trim() || null,
          instructions: note.value.trim() || null,
        },
      },
      'Work assigned.',
      () => (tkPanelCase === assignedCaseId ? tkCaseDialog(assignedCaseId) : tkLoad())
    );
    dlg.close();
  };
  caseSel.focus();
  return dlg;
}

/* §6 step 8: "if rejected, reviewer must provide a reason". The route refuses an empty one, so this
   refuses it first — sending it would only be a round trip to be told the same thing. */
function tkReasonDialog(task, action) {
  const box = tkArea(4, '');
  return tkDialog(
    action === 'cancel' ? 'Withdraw this assignment' : 'Return for correction',
    h(
      'div',
      { class: 'tk-form' },
      tkField('Reason the member will see', box),
      h('p', { class: 'mu' }, 'Kept on the task and in the work history.')
    ),
    TK_LABEL[action],
    () => {
      const reason = box.value.trim();
      if (!reason) {
        box.focus();
        if (typeof toast === 'function') toast('A reason is required.');
        return false;
      }
      tkPost(task, action, { reason }, 'Done.');
      return true;
    },
    task.assignmentType + ' on ' + (task.caseNumber || task.caseId)
  );
}

function tkBriefDialog(task) {
  const typeSel = tkSelect(
    TK_TYPES.map((t) => ({ v: t, t })),
    task.assignmentType
  );
  const priSel = tkSelect(
    TK_PRIORITIES.map((t) => ({ v: t, t })),
    task.priority
  );
  const due = tkDateInput(task.dueDate || '');
  const note = tkArea(4, task.instructions || '');
  return tkDialog(
    'Change the brief',
    h(
      'div',
      { class: 'tk-form' },
      tkField('Assignment type', typeSel),
      tkField('Priority', priSel),
      tkField('Due date', due),
      tkField('Instructions', note),
      h(
        'p',
        { class: 'mu' },
        'The status does not change here — the buttons on the card are for that.'
      )
    ),
    'Save',
    () => {
      tkSend(
        '/api/tasks/' + task.id,
        {
          method: 'PATCH',
          body: {
            assignmentType: typeSel.value,
            priority: priSel.value,
            dueDate: due.value.trim() || null,
            instructions: note.value.trim() || null,
          },
        },
        'Brief updated.'
      );
      return true;
    },
    task.assignmentType + ' on ' + (task.caseNumber || task.caseId)
  );
}

async function tkReassignDialog(task) {
  const busy = h('p', { class: 'mu' }, 'Loading the team…');
  const body = h('div', { class: 'tk-form' }, busy);
  const dlg = tkDialog('Reassign', body, 'Move the work', () => false, null);
  const form = dlg.querySelector('form');
  const submit = form.querySelector('button[type=submit]');

  let picked = null;
  try {
    picked = await tkMemberPicker(task.assigneeUserId);
  } catch (error) {
    busy.textContent = error.message || 'SurveyPro could not load the team.';
    submit.disabled = true;
    return dlg;
  }
  if (!picked.options.length) {
    busy.textContent = 'There is nobody else on the register to move this work to.';
    submit.disabled = true;
    return dlg;
  }
  busy.remove();
  const to = tkSelect(picked.options);
  const reason = tkArea(3, '');
  form.insertBefore(
    h(
      'div',
      { class: 'tk-form' },
      tkField('Move this work to', to),
      tkField('Why (optional)', reason),
      h(
        'p',
        { class: 'mu' },
        'The task starts again for the new member: the acceptance, the submission and the review of ' +
          'the previous one describe work this person did not do.'
      )
    ),
    form.querySelector('.bar')
  );
  submit.onclick = (e) => {
    e.preventDefault();
    tkPost(
      task,
      'reassign',
      { assigneeUserId: to.value, reason: reason.value.trim() || null },
      'Work reassigned.'
    );
    dlg.close();
  };
  to.focus();
  return dlg;
}

const tkEventList = (events) =>
  h(
    'ul',
    { class: 'tk-events' },
    ...events.map((e) =>
      h(
        'li',
        {},
        h('b', {}, TK_EVENT_LABEL[e.action] || e.action),
        h('span', {}, tkDateTime(e.createdAt)),
        e.actorName ? h('span', { class: 'mu' }, e.actorName) : null,
        e.assignmentType ? h('span', { class: 'mu' }, e.assignmentType) : null,
        e.reason ? h('p', { class: 'tk-why' }, e.reason) : null
      )
    )
  );

/* The work history — §6's "every transition must be recorded" — which answers a different question
   from the audit log: this is "what happened to this inspection", the log is "who touched what". */
function tkHistoryDialog(task) {
  const dlg = tkDialog(
    'Work history',
    h('p', { class: 'mu' }, 'Reading…'),
    'Close',
    () => true,
    task.assignmentType + ' on ' + (task.caseNumber || task.caseId)
  );
  const slot = dlg.querySelector('.tk-form, dialog > form > p');
  SurveyAuth.request('/api/tasks/' + task.id)
    .then((payload) => {
      const events = Array.isArray(payload.events) ? payload.events : [];
      const body = h(
        'div',
        { class: 'tk-form' },
        h('p', { class: 'mu' }, 'Status now: ' + ((payload.task || {}).status || task.status)),
        events.length
          ? tkEventList(events)
          : h('p', { class: 'mu' }, 'No transitions recorded yet.')
      );
      if (slot && slot !== dlg) slot.replaceWith(body);
      else dlg.querySelector('form').insertBefore(body, dlg.querySelector('.bar'));
    })
    .catch((error) => {
      if (typeof toast === 'function')
        toast(error.message || 'SurveyPro could not read the history.');
      dlg.close();
    });
  return dlg;
}

/* ── the case screen ─────────────────────────────────────────────────────────────────────── */

/* One request answers the whole panel: the work on this case and every transition it has been through
   (GET /api/cases/:id/assignments). It is a dialog rather than a new case section because the case
   form is the schema's, and §5's assignments are not a part of a survey report — they are about who
   is doing the work. */
let tkPanelCase = null;

async function tkCaseDialog(caseId) {
  tkPanelCase = caseId;
  let payload;
  try {
    payload = await SurveyAuth.request('/api/cases/' + encodeURIComponent(caseId) + '/assignments');
  } catch (error) {
    tkPanelCase = null;
    if (typeof toast === 'function') toast(error.message || 'SurveyPro could not read this case.');
    return;
  }
  const row = payload.case || {};
  const tasks = tkSort(Array.isArray(payload.tasks) ? payload.tasks : []);
  const history = Array.isArray(payload.history) ? payload.history : [];
  const may = tkMay('assign_case', true);

  const dlg = h('dialog', { class: 'tk-dlg tk-panel' });
  dlg.append(
    h(
      'form',
      { method: 'dialog' },
      h(
        'div',
        { class: 'tk-panel-head' },
        h('h3', {}, 'Work on this case'),
        h(
          'p',
          { class: 'mu' },
          [row.caseNumber, row.insurer, row.vehicleRegistration].filter(Boolean).join(' · ') ||
            caseId
        ),
        may
          ? h(
              'button',
              {
                class: 'b p',
                type: 'button',
                onclick: () => tkAssignDialog({ id: caseId, t: row.caseNumber }),
              },
              '+ Assign work'
            )
          : null
      ),
      tasks.length
        ? h('div', { class: 'tk-list' }, ...tasks.map(tkCard))
        : h(
            'p',
            { class: 'mu' },
            'Nobody has been given work on this case yet' +
              (may ? '.' : ' — and this account cannot assign it.')
          ),
      history.length
        ? h(
            'details',
            { class: 'tk-hist' },
            h('summary', {}, 'Assignment history'),
            tkEventList(history.slice(0, 40))
          )
        : null,
      h('div', { class: 'bar' }, h('button', { class: 'b', type: 'submit' }, 'Close'))
    )
  );
  document.body.append(dlg);
  dlg.addEventListener('close', () => {
    dlg.remove();
    tkPanelCase = null;
    if (tkState.root) tkLoad();
  });
  dlg.showModal();
}

/* ── wiring ──────────────────────────────────────────────────────────────────────────────── */

const tkSidebar = document.getElementById('tk');
if (tkSidebar)
  tkSidebar.onclick = () => {
    showTasks();
    if (typeof closeSideMenu === 'function') closeSideMenu();
  };

/* The Case tools group only shows while a case is open, which is exactly when this belongs there; the
   button follows the same permission rule Export and Delete follow in openCase(). */
const tkCaseBtn = document.getElementById('ta');
if (tkCaseBtn)
  tkCaseBtn.onclick = () => {
    if (cur) tkCaseDialog(cur);
    if (typeof closeSideMenu === 'function') closeSideMenu();
  };
