/* Case comments (§11): the conversation that hangs on one claim — who said what, when, to whom, about
   which filed document, and which of it this person has not yet read. Loaded as a classic script after
   26-documents.js and before 99-main.js. What it borrows: h()/$ from 01, DB and cur from 03,
   toast()/mayUse()/setMenu()/getCurrentAuthUser()/normalizeServerRole()/SERVER_ROLE_LABELS from 11,
   openCase()/showDash from 08 and 11, syncTake() from 24, dvFileUrl()/DV_TONE from 26 and
   SurveyAuth.request() from auth.js.

   Four rules, each of them the screen obeying something that already exists rather than adding a fifth.

   The server decides who may write. `can.comment` and `can.instruct` arrive with the thread from the same
   permission set the POST route checks, so this page never offers a box the route is about to refuse —
   and the route asks the question again on every press, which is what §7's "do not rely on frontend
   button visibility for security" actually means.

   Nobody's words are ever HTML. A comment body is whatever a person typed, including the case number of
   somebody else's claim and any angle brackets they pasted in, so every one of them goes through h() as a
   text node. There is no innerHTML in this file.

   Unread is a fact about the reader, not about the message. It arrives per row because the database
   compares each comment against *this* account's own marker, so the dot here means "you have not seen
   this", not "somebody else has not seen this".

   An attachment is a pointer, not a copy. §11's "attach supporting files" quotes a document §8 already
   registered, so the picker lists this case's filed documents rather than taking a second upload — a
   comment cannot smuggle an unregistered file into a claim, and the file keeps its category, hash and
   verifier wherever it is quoted. */

const cmState = {
  caseId: '',
  rows: [],
  can: { comment: false, instruct: false },
  maxChars: 4000,
  unread: 0,
  docs: [],
  docsError: '',
  loading: false,
  sending: false,
  error: '',
  notice: '',
  replyTo: null,
  jumpTo: '',
  mentioned: [],
  root: null,
  area: null,
  select: null,
  instruct: null,
  count: null,
  send: null,
  chips: null,
};

const cmMay = (key, fallback) => (typeof mayUse === 'function' ? mayUse(key, fallback) : fallback);

const cmMe = () => (typeof getCurrentAuthUser === 'function' ? getCurrentAuthUser() : null);

const cmTime = (value) =>
  value
    ? new Date(value).toLocaleString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

/* The claim number comes from the local record. The thread API answers with the case id and nothing
   else, because the case row belongs to the case routes; and this page is only reachable from an open
   case or from a notice that fetched the case first, so the number is here whenever the thread is. */
const cmClaim = (caseId) => {
  const row = typeof DB !== 'undefined' && DB ? DB[caseId] : null;
  return (row && row.f && row.f.case_claimNo) || caseId;
};

/* The people worth tagging are the ones who have already spoken on this claim. This screen has no
   permission to list the register — that is an administrator's page — and the audience that matters is
   the one the server will notify, which is built from the case, not from every account in the firm. */
function cmPeople() {
  const me = cmMe();
  const mine = me && me.fullName ? String(me.fullName).toLowerCase() : '';
  const seen = new Set();
  const names = [];
  cmState.rows.forEach((row) => {
    const name = String(row.authorName || '').trim();
    const key = name.toLowerCase();
    if (!name || key === mine || seen.has(key)) return;
    seen.add(key);
    names.push(name);
  });
  return names;
}

/* ── reading and writing the thread ──────────────────────────────────────────────────────── */

async function cmLoad() {
  if (!cmState.caseId) return;
  cmState.loading = true;
  cmState.error = '';
  cmPaint();
  try {
    const payload = await window.SurveyAuth.request(
      `/api/cases/${encodeURIComponent(cmState.caseId)}/comments`
    );
    cmState.rows = Array.isArray(payload.comments) ? payload.comments : [];
    cmState.can = payload.can || cmState.can;
    cmState.maxChars = Number(payload.maxChars) || cmState.maxChars;
    cmState.unread = Number(payload.unread) || 0;
    cmState.loading = false;
    cmPaint();
    cmComposeIfMissing();
    cmFillChips();
    /* Opening the thread is what reads it, but only after the markers have been shown: a page that
       cleared them before painting would leave the person looking at a thread they had just been told
       was unread. */
    if (cmState.unread) await cmMarkRead();
    if (cmState.can.comment) cmDocs();
    /* A notice that named one comment is scrolled to it after the paint that shows it. A timer set when
       the page opens cannot know how long the fetch takes, so the highlight would land on a thread that
       is not there yet and the notice would read as a link that goes nowhere. */
    if (cmState.jumpTo) {
      const wanted = cmState.jumpTo;
      cmState.jumpTo = '';
      cmJumpTo(wanted);
    }
  } catch (error) {
    cmState.loading = false;
    cmState.error = cmWhy(error);
    cmPaint();
    cmComposeIfMissing();
  }
}

async function cmMarkRead() {
  try {
    await window.SurveyAuth.request(
      `/api/cases/${encodeURIComponent(cmState.caseId)}/comments/read`,
      { method: 'POST', body: {} }
    );
  } catch {
    /* A marker that did not clear is a dot that stays on; the thread itself was read and is shown. */
  }
}

/* The documents the composer may quote — this case's own files, from the same list the verification
   screen shows, so a person attaches what they can see rather than what they have to remember the id of. */
async function cmDocs() {
  try {
    const payload = await window.SurveyAuth.request(
      `/api/documents?scope=case&case=${encodeURIComponent(cmState.caseId)}`
    );
    cmState.docs = Array.isArray(payload.documents) ? payload.documents : [];
    cmState.docsError = '';
  } catch (error) {
    cmState.docs = [];
    cmState.docsError =
      error.status === 401 ? cmWhy(error) : 'The filed documents could not be listed.';
  }
  cmFillDocs();
}

/* One refusal, said the way the person needs to hear it. The server's own sentence is used whenever it
   has one, because the reason a comment was refused — nobody matches that name, that case is not yours,
   the box was empty — is information only the route has. */
function cmWhy(error) {
  if (error.status === 401) return 'Sign in to read the conversation on this claim.';
  if (error.status === 403)
    return error.message || 'This account is not permitted to open that thread.';
  if (error.status === 404 || error.code === 'case_not_found')
    return 'That case is not on the server yet, so it has no conversation to read.';
  if (error.status === 0 || (error.message || '').indexOf('fetch') !== -1)
    return 'SurveyPro could not be reached. This conversation lives on the server, so it will appear when it answers.';
  return error.message || 'SurveyPro could not read the conversation.';
}

function cmMentionNotice(mentions) {
  if (!mentions) return '';
  const bits = [];
  const names = (list) => (list || []).map((m) => m.fullName || m.token || m).join(', ');
  if (mentions.notified && mentions.notified.length)
    bits.push(`${names(mentions.notified)} will see this in their notifications.`);
  if (mentions.unknown && mentions.unknown.length)
    bits.push(
      `No account matches ${mentions.unknown.map((t) => '@' + t).join(', ')}, so nobody was told.`
    );
  if (mentions.notOnCase && mentions.notOnCase.length)
    bits.push(`${names(mentions.notOnCase)} is not on this case, so they were not told.`);
  return bits.join(' ');
}

async function cmPost() {
  if (cmState.sending || !cmState.can.comment) return;
  const text = (cmState.area.value || '').trim();
  if (!text) {
    cmState.notice = 'Write something before posting it.';
    cmPaint();
    cmState.area.focus();
    return;
  }
  cmState.sending = true;
  cmState.notice = '';
  cmPaint();
  try {
    const body = { body: text };
    if (cmState.replyTo) body.replyTo = cmState.replyTo.id;
    if (cmState.select.value) body.documentId = cmState.select.value;
    if (cmState.instruct.checked) body.instruction = true;
    /* The names travel beside the text. A bare "@Kiran Shrestha" cannot be recognised by a token that
       stops at the space, so the screen says which words it meant as a mention and the server still
       checks that each one really appears in the body before it tells anybody. */
    if (cmState.mentioned.length) body.mentions = cmState.mentioned.slice();
    const payload = await window.SurveyAuth.request(
      `/api/cases/${encodeURIComponent(cmState.caseId)}/comments`,
      { method: 'POST', body }
    );
    cmState.area.value = '';
    cmTyped();
    cmState.replyTo = null;
    cmState.mentioned = [];
    cmState.instruct.checked = false;
    cmState.notice = cmMentionNotice(payload.mentions);
    if (typeof toast === 'function') toast('Posted to the case.');
  } catch (error) {
    /* The words stay in the box. A person who typed a paragraph and lost it to a dropped connection has
       been taught not to write one. */
    cmState.error = cmWhy(error);
  }
  cmState.sending = false;
  await cmLoad();
  if (cmState.error && typeof toast === 'function') toast(cmState.error);
}

/* ── the composer ────────────────────────────────────────────────────────────────────────── */

/* Built once per page, never rebuilt by cmPaint: the thread behind it refreshes while a person is
   typing, and a repaint that replaced the box would throw away the half-written sentence with it. */
function cmCompose() {
  const root = cmState.root;
  if (!root) return;
  const slot = root.querySelector('.cm-compose-slot');
  if (!slot) return;
  if (!cmState.can.comment) {
    slot.replaceChildren(
      h(
        'p',
        { class: 'cm-plain mu' },
        'This account may read the conversation on this claim but not add to it.'
      )
    );
    return;
  }

  cmState.area = h('textarea', {
    class: 'cm-area',
    rows: '3',
    maxlength: String(cmState.maxChars),
    placeholder: 'Say something about this claim…',
    'aria-label': 'New comment',
    oninput: cmTyped,
    onkeydown: (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        cmPost();
      }
    },
  });

  cmState.chips = h('div', {
    class: 'cm-chips',
    'aria-label': 'Tag somebody on this case',
  });

  cmState.select = h(
    'select',
    { class: 'cm-attach', 'aria-label': 'Attach a filed document' },
    h('option', { value: '' }, 'No document')
  );

  cmState.instruct = h('input', { id: 'cm-instruct', type: 'checkbox' });

  cmState.count = h('span', { class: 'cm-count mu' }, '');

  cmState.send = h(
    'button',
    { class: 'b p cm-send', type: 'button', onclick: () => cmPost() },
    'Post'
  );

  slot.replaceChildren(
    h(
      'div',
      { class: 'cm-compose' },
      h('div', { class: 'cm-area-row' }, cmState.area),
      cmState.chips,
      h(
        'div',
        { class: 'cm-tools' },
        h('label', { class: 'cm-attach-lbl' }, 'Attach', cmState.select),
        cmState.can.instruct
          ? h(
              'label',
              { class: 'cm-inst-lbl' },
              cmState.instruct,
              h('span', {}, 'Post as an instruction')
            )
          : null,
        cmState.count
      ),
      h('div', { class: 'cm-reply-slot' }),
      h('div', { class: 'cm-notice-slot' }),
      h('div', { class: 'bar cm-send-bar' }, cmState.send)
    )
  );
  cmFillChips();
  cmFillDocs();
  cmTyped();
}

/* The composer is built once per page, not once per load. cmLoad refreshes the thread after a post and
   whenever the page is opened, and a box rebuilt by that refresh would throw away the sentence a person
   is still writing along with the answer the last post earned. */
function cmComposeIfMissing() {
  const slot = cmState.root && cmState.root.querySelector('.cm-compose-slot');
  if (slot && !slot.childElementCount) cmCompose();
}

/* The chips are the one part of the composer that the thread itself changes: the people worth tagging
   are the ones who have spoken, and the first of them has usually just spoken. */
function cmFillChips() {
  if (!cmState.chips) return;
  cmState.chips.replaceChildren(
    ...cmPeople().map((name) =>
      h(
        'button',
        { class: 'cm-chip', type: 'button', title: `Mention ${name}`, onclick: () => cmTag(name) },
        '@' + name
      )
    )
  );
}

function cmFillDocs() {
  if (!cmState.select) return;
  const keep = cmState.select.value;
  const current = cmState.docs.filter((d) => d.isCurrent !== false);
  cmState.select.replaceChildren(
    h('option', { value: '' }, current.length ? 'No document' : 'Nothing filed on this case'),
    ...current.map((d) =>
      h('option', { value: d.id }, `${d.originalFilename} · ${d.category} · ${d.status}`)
    )
  );
  if (keep && current.some((d) => d.id === keep)) cmState.select.value = keep;
  const note = cmState.root && cmState.root.querySelector('.cm-docs-note');
  if (note) note.textContent = cmState.docsError || '';
}

/* Inserted at the cursor, not appended: a mention belongs where the sentence wants it, and a person who
   has written "cc " and then tapped a name expects the name to land after the space. */
function cmTag(name) {
  const area = cmState.area;
  const token = '@' + name;
  const start = area.selectionStart == null ? area.value.length : area.selectionStart;
  const end = area.selectionEnd == null ? start : area.selectionEnd;
  const gap = start === 0 || /[\s(]$/.test(area.value.slice(start - 1, start)) ? '' : ' ';
  area.value = area.value.slice(0, start) + gap + token + ' ' + area.value.slice(end);
  const caret = start + gap.length + token.length + 1;
  area.focus();
  area.setSelectionRange(caret, caret);
  if (!cmState.mentioned.includes(name)) cmState.mentioned.push(name);
  cmTyped();
}

function cmTyped() {
  if (!cmState.area) return;
  const length = cmState.area.value.length;
  cmState.count.textContent = length
    ? `${length} / ${cmState.maxChars}`
    : `${cmState.maxChars} characters`;
  cmState.count.classList.toggle('over', length >= cmState.maxChars);
  /* Only the label and the counter move while a person types. Repainting the thread on every keystroke
     would throw away their place in it. */
  if (cmState.send && !cmState.sending)
    cmState.send.textContent = cmState.replyTo ? 'Reply' : 'Post';
}

/* ── the thread ──────────────────────────────────────────────────────────────────────────── */

/* Two levels are all the panel describes, but a reply to a reply must still be findable, so the tree is
   built by parent id and rendered recursively — nothing in it can be lost the way a fixed two-pass list
   would lose a third-generation answer. */
function cmTree(rows) {
  const nodes = new Map(rows.map((row) => [row.id, { row, replies: [] }]));
  const top = [];
  rows.forEach((row) => {
    const node = nodes.get(row.id);
    const parent = row.parentCommentId ? nodes.get(row.parentCommentId) : null;
    if (parent && parent !== node) parent.replies.push(node);
    else top.push(node);
  });
  return top;
}

function cmHead(row) {
  const role = row.authorRole ? SERVER_ROLE_LABELS[normalizeServerRole(row.authorRole)] : '';
  const who = h(
    'span',
    { class: 'cm-who' },
    h('b', {}, row.authorName || 'A former member'),
    role ? h('span', { class: 'cm-role mu' }, role) : null
  );
  return h(
    'div',
    { class: 'cm-by' },
    who,
    h('span', { class: 'cm-when mu' }, cmTime(row.createdAt)),
    row.unread ? h('span', { class: 'cm-new' }, 'new') : null,
    row.isInstruction ? h('span', { class: 'pill cm-inst' }, 'Instruction') : null
  );
}

function cmFile(row) {
  if (!row.documentId) return null;
  return h(
    'a',
    {
      class: 'cm-file',
      href: dvFileUrl(row.documentId),
      target: '_blank',
      rel: 'noopener',
      title: 'Open the attached document',
    },
    h('span', {}, '📎 ' + (row.documentFilename || 'document')),
    h(
      'span',
      { class: 'pill ' + (DV_TONE[row.documentStatus] || 'dv-plain') },
      row.documentStatus || 'Filed'
    )
  );
}

function cmNode(node, depth) {
  const row = node.row;
  return [
    h(
      'article',
      {
        class: 'cm-item' + (depth ? ' cm-child' : '') + (row.unread ? ' cm-unread' : ''),
        id: 'cm-' + row.id,
      },
      cmHead(row),
      h('p', { class: 'cm-text' }, row.body),
      cmFile(row),
      cmState.can.comment
        ? h(
            'div',
            { class: 'cm-acts' },
            h(
              'button',
              {
                class: 'b',
                type: 'button',
                onclick: () => {
                  cmState.replyTo = { id: row.id, name: row.authorName || 'this comment' };
                  cmState.area.focus();
                  cmPaint();
                },
              },
              'Reply'
            )
          )
        : null
    ),
    ...node.replies.map((child) => cmNode(child, depth + 1)),
  ];
}

function cmBody() {
  if (cmState.loading && !cmState.rows.length)
    return h('div', { class: 'cm-empty' }, 'Reading the conversation…');
  if (cmState.error && !cmState.rows.length)
    return h('div', { class: 'cm-empty bad' }, cmState.error);
  if (!cmState.rows.length)
    return h(
      'div',
      { class: 'cm-empty' },
      'Nothing has been said on this claim yet. The first note is usually the one that says what is missing.'
    );
  const nodes = cmTree(cmState.rows);
  return h(
    'div',
    { class: 'cm-list' },
    ...nodes.flatMap((node) => cmNode(node, 0)),
    cmState.error ? h('p', { class: 'cm-plain bad' }, cmState.error) : null
  );
}

function cmPaint() {
  if (!cmState.root) return;
  const box = cmState.root.querySelector('.cm-body');
  if (box) box.replaceChildren(cmBody());
  const count = cmState.root.querySelector('.cm-unread-pill');
  if (count) {
    count.textContent = cmState.unread ? `${cmState.unread} unread` : '';
    count.hidden = !cmState.unread;
  }
  const reply = cmState.root.querySelector('.cm-reply-slot');
  if (reply)
    reply.replaceChildren(
      cmState.replyTo
        ? h(
            'div',
            { class: 'cm-replying' },
            h('span', {}, 'Replying to ' + cmState.replyTo.name),
            h(
              'button',
              {
                class: 'b',
                type: 'button',
                onclick: () => {
                  cmState.replyTo = null;
                  cmPaint();
                },
              },
              'Cancel'
            )
          )
        : h('span', { hidden: true })
    );
  const notice = cmState.root.querySelector('.cm-notice-slot');
  if (notice)
    notice.replaceChildren(
      cmState.notice ? h('p', { class: 'cm-plain' }, cmState.notice) : h('span', { hidden: true })
    );
  if (cmState.send) {
    cmState.send.disabled = cmState.sending;
    cmState.send.textContent = cmState.sending ? 'Posting…' : cmState.replyTo ? 'Reply' : 'Post';
  }
  const docsNote = cmState.root.querySelector('.cm-docs-note');
  if (docsNote && cmState.docsError) docsNote.textContent = cmState.docsError;
}

function cmJumpTo(commentId) {
  if (!commentId) return;
  const target = cmState.root && cmState.root.querySelector('#cm-' + CSS.escape(String(commentId)));
  if (!target) return;
  target.scrollIntoView({ block: 'center' });
  target.classList.add('cm-landed');
  setTimeout(() => target.classList.remove('cm-landed'), 2400);
}

/* ── the page ────────────────────────────────────────────────────────────────────────────── */

function renderCommentsView() {
  const caseId = cmState.caseId;
  const claim = cmClaim(caseId);
  const root = h('div', { class: 'case-directory cm2' });
  cmState.root = root;
  root.append(
    h(
      'div',
      { class: 'dh cm-head' },
      h(
        'div',
        { class: 'cm-head-t' },
        h('h1', {}, 'Comments on this claim'),
        h('p', { class: 'mu cm-sub' }, `The conversation recorded against claim ${claim}.`)
      ),
      h(
        'div',
        { class: 'bar' },
        h('span', { class: 'pill cm-unread-pill', hidden: true }),
        h(
          'button',
          { class: 'b', type: 'button', onclick: () => openCase(caseId) },
          'Open the case'
        ),
        h('button', { class: 'b', type: 'button', onclick: showDash }, 'Dashboard')
      )
    ),
    h('div', { class: 'cm-compose-slot' }),
    h('p', { class: 'cm-docs-note mu', hidden: false }),
    h('div', { class: 'cm-body' }, cmBody())
  );
  cmLoad();
  return root;
}

function showComments(options = {}) {
  if (options.caseId) cmState.caseId = options.caseId;
  if (!cmState.caseId && typeof cur !== 'undefined' && cur) cmState.caseId = cur;
  if (!cmState.caseId) {
    if (typeof toast === 'function') toast('Open a case to read its comments.');
    return;
  }
  cmState.replyTo = null;
  cmState.jumpTo = options.commentId || '';
  cmState.mentioned = [];
  cmState.notice = '';
  cmState.error = '';
  cmState.docs = [];
  cmState.docsError = '';
  view = 'comments';
  $('#dash').hidden = false;
  $('#dash').classList.add('dash-cases');
  $('.app').hidden = true;
  ['#cs', '#del', '#dx', '#ta', '#td', '#tc'].forEach((sel) => {
    const el = $(sel);
    if (el) el.hidden = true;
  });
  $('#cm').hidden = true;
  $('#ct').hidden = true;
  /* The thread belongs to one case, so it has no place of its own in the navigation groups; nothing is
     lit in the sidebar and the head's "Open the case" is how back works. */
  setMenu('');
  $('#dash').replaceChildren(renderCommentsView());
  window.scrollTo(0, 0);
  rememberPlace();
}

/* A notice that names a case this device has never held — the ordinary case for a mention on a claim
   somebody else opened. The same fetch every other screen uses, and the same honest failure. */
async function cmOpenNotice(row) {
  const caseId = row.caseId || '';
  if (!caseId) {
    if (typeof showTasks === 'function') showTasks();
    return;
  }
  if (typeof DB !== 'undefined' && !DB[caseId] && typeof syncTake === 'function') {
    await syncTake(caseId);
    if (!DB[caseId]) {
      if (typeof toast === 'function')
        toast('That case could not be fetched from SurveyPro. The notice is marked read.');
      return;
    }
  }
  if (row.documentId && typeof showDocuments === 'function') {
    showDocuments({ caseId, tab: 'case' });
    return;
  }
  showComments({ caseId, commentId: row.commentId || '' });
}

/* ── wiring ──────────────────────────────────────────────────────────────────────────────── */

const cmCaseBtn = document.getElementById('tc');
if (cmCaseBtn)
  cmCaseBtn.onclick = () => {
    if (cur) showComments({ caseId: cur });
    if (typeof closeSideMenu === 'function') closeSideMenu();
  };
