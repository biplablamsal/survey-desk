/* Documents and verification: the per-case file list, the queue of documents waiting for a decision,
   the version history of one document, and the bytes that are still waiting for signal (brief §8).
   Loaded as a classic script, after 25-assignments.js and before 99-main.js. What it borrows: h()/esc()
   and $ from 01, DB and cur from 03, toast()/mayUse()/setMenu()/caseDirectoryRows()/
   getCurrentAuthUser()/normalizeServerRole() from 11, openCase() from 08, syncTake() from 24,
   closeSideMenu() from 14 and SurveyAuth.request()/requestBytes()/apiBase from auth.js.

   Three things had to be true before this screen could exist, and each one is a rule it obeys rather
   than a feature it adds.

   A file had to reach the server. Until §8's backend existed every photograph stayed in the browser
   that took it, so "somebody else checks it" was unimplementable; this screen is the first place a
   scan leaves the device that made it and comes back as somebody else's evidence.

   The buttons are not decided here. Every row arrives with `actions` and `craft` from docRefusal(),
   the same function the routes call to refuse, so a screen cannot offer a transition the server is
   about to reject — and the route asks the question again on every press, which is what §7's "do not
   rely on frontend button visibility for security" actually means.

   Offline is the ordinary case, not the error case. A surveyor on a hill with half a bar of signal can
   still photograph a bill, and losing that photograph because the upload failed is the failure mode
   this whole module exists to avoid. So the bytes are written to IndexedDB *before* anything is tried,
   the queue is what that store contains rather than a list that can be forgotten, and a file that could
   not be sent says so on screen until it can. */

/* One label per verb. The verbs themselves are never listed here: they arrive with the row. */
const DV_LABEL = {
  verify: 'Verify',
  reject: 'Reject',
  request_replacement: 'Ask for a replacement',
};

const DV_TONE = {
  Uploaded: 'dv-plain',
  'Pending Verification': 'dv-wait',
  Verified: 'dv-ok',
  Rejected: 'dv-bad',
  'Replacement Required': 'dv-back',
};

/* The five the queue is counted over, in the order a reader expects them: what is owed, what is
   waiting, what is settled. The list comes from the server's own vocabulary, so a status added to the
   schema appears here without this file being edited — see dvCounts(). */
const DV_COUNT_ORDER = [
  'Uploaded',
  'Pending Verification',
  'Verified',
  'Rejected',
  'Replacement Required',
];

const DV_EVENT_LABEL = {
  registered: 'Registered',
  file_attached: 'File received',
  verified: 'Verified',
  rejected: 'Rejected',
  replacement_requested: 'Replacement asked for',
  replaced: 'Replaced',
  details_changed: 'Details changed',
};

const dvState = {
  tab: 'mine',
  rows: [],
  counts: null,
  vocab: null,
  caseId: '',
  caseRow: null,
  pending: [],
  sending: false,
  loading: false,
  error: '',
  root: null,
};

const dvMay = (key, fallback) => (typeof mayUse === 'function' ? mayUse(key, fallback) : fallback);

const dvMe = () => (typeof getCurrentAuthUser === 'function' ? getCurrentAuthUser() : null);

const dvDate = (value) =>
  value
    ? new Date(value).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: '2-digit',
      })
    : '';

const dvDateTime = (value) =>
  value
    ? new Date(value).toLocaleString('en-GB', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

/* A scan is compared with the limit the server was configured with, so the number a person is told and
   the number that refuses them are the same number. */
const dvSize = (bytes) => {
  const n = Number(bytes) || 0;
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
};

/* The stored file, behind the same session and the same case rule as the record it belongs to. It is a
   URL rather than a fetch because a photograph has to be something an <img> can show and a tap can
   open; the server answers with the type it read from the bytes and nosniff, so the browser is never
   left guessing what a scanned bill is. */
const dvFileUrl = (id) => {
  const base = window.SurveyAuth && window.SurveyAuth.apiBase ? window.SurveyAuth.apiBase : '';
  return `${base}/api/documents/${encodeURIComponent(id)}/file`;
};

const dvIsImage = (doc) => /^image\//.test(String(doc.mimeType || ''));

/* The categories, the limit and the accepted types arrive with the list, from the same lists the routes
   refuse with. A picker written out here would be a second place to change them — but a phone in a
   garage opens this page with nothing arriving, so the last set the server actually sent is kept and
   used until a newer one replaces it. */
const DV_VOCAB_KEY = 'sp.docvocab';

const dvVocab = () => {
  if (dvState.vocab && dvState.vocab.categories) return dvState.vocab;
  try {
    const stored = JSON.parse(localStorage.getItem(DV_VOCAB_KEY) || 'null');
    return stored && Array.isArray(stored.categories) ? stored : {};
  } catch {
    return {};
  }
};

function dvRememberVocab(vocab) {
  if (!vocab || !Array.isArray(vocab.categories)) return;
  try {
    localStorage.setItem(DV_VOCAB_KEY, JSON.stringify(vocab));
  } catch {
    /* A full or private store only means the next offline picker has nothing to remember. */
  }
}

/* ── the bytes that have not been sent yet ───────────────────────────────────────────────── */

/* A second database, not a second store inside sp-photos: a document is a file a person filed, a photo
   is an image of the vehicle, and the two have different lives. Same shape as IDBP in 07-photos.js. */
const DV_DB = new Promise((resolve) => {
  try {
    const q = indexedDB.open('sp-docs', 1);
    q.onupgradeneeded = () => q.result.createObjectStore('d', { keyPath: 'id' });
    q.onsuccess = () => resolve(q.result);
    q.onerror = () => resolve(null);
  } catch {
    resolve(null);
  }
});

const dvDb = async (mode, fn) => {
  const d = await DV_DB;
  if (!d) throw new Error('This device cannot hold the file until the signal comes back.');
  return new Promise((res, rej) => {
    const t = d.transaction('d', mode),
      q = fn(t.objectStore('d'));
    t.oncomplete = () => res(q && q.result);
    t.onerror = t.onabort = () => rej(t.error);
  });
};

/* The queue is the store, so nothing can be forgotten by the code that changed it — the same reason
   syncQueue() compares stamps instead of keeping a list. */
async function dvPendingLoad() {
  try {
    dvState.pending = ((await dvDb('readonly', (s) => s.getAll())) || []).sort(
      (a, b) => a.at - b.at
    );
  } catch {
    dvState.pending = [];
  }
  return dvState.pending;
}

const dvLocalId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : /* A phone reached over a plain http LAN address is not a secure context, where randomUUID does
         not exist. The key only has to be unique inside this device's store. */
      `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/* kind: 'new' registers a record then sends it, 'bytes' is the file for a record that already exists,
   'replace' opens a new version of one. Three kinds because §8's three real situations are three: the
   photograph just taken, the upload that never landed, and the bill that was sent unreadable. */
async function dvHold(row) {
  const held = {
    id: dvLocalId(),
    kind: row.kind,
    docId: row.docId || null,
    replaceOf: row.replaceOf || null,
    caseId: row.caseId,
    category: row.category,
    filename: row.filename,
    size: row.file.size,
    type: row.file.type || '',
    blob: row.file,
    at: Date.now(),
    error: '',
    fatal: false,
  };
  await dvDb('readwrite', (s) => s.put(held));
  dvState.pending.push(held);
  return held;
}

const dvForget = async (id) => {
  try {
    await dvDb('readwrite', (s) => s.delete(id));
  } catch {
    /* Already gone is the outcome wanted. */
  }
  dvState.pending = dvState.pending.filter((row) => row.id !== id);
};

async function dvUpdate(row) {
  try {
    await dvDb('readwrite', (s) => s.put(row));
  } catch {
    /* A store that will not take the row cannot lose the file either; the copy in memory is used for
       this pass and the next read shows what is actually held. */
  }
}

/* One send, in the order the API requires: the record first, then the bytes. A row that arrives without
   a document id is registered here rather than in the dialog, because the dialog may have closed, the
   tab may have been killed, and a phone may have lost signal in between. */
async function dvSendOne(row) {
  const request = window.SurveyAuth.request,
    bytes = window.SurveyAuth.requestBytes;
  try {
    if (row.kind !== 'bytes' && !row.docId) {
      const payload =
        row.kind === 'replace'
          ? await request(`/api/documents/${encodeURIComponent(row.replaceOf)}/replace`, {
              method: 'POST',
              body: { category: row.category, filename: row.filename },
            })
          : await request('/api/documents', {
              method: 'POST',
              body: { case: row.caseId, category: row.category, filename: row.filename },
            });
      row.docId = payload.document.id;
      row.caseId = payload.document.caseId || row.caseId;
      await dvUpdate(row);
    }
    await bytes(`/api/documents/${encodeURIComponent(row.docId)}/file`, {
      method: 'PUT',
      body: row.blob,
    });
    await dvForget(row.id);
    return 'sent';
  } catch (error) {
    /* Bytes already on the server with the same id means the previous attempt landed and this device
       never heard the answer. That is the outcome wanted, not a failure to keep retrying. */
    if (error.code === 'document_has_file') {
      await dvForget(row.id);
      return 'sent';
    }
    /* No signal, no server, a dead battery mid-send: keep it and try again. An answer that says no —
       a refused type, a file over the limit, a case this account may not write to — will keep saying
       no, so it is written down as the reason the file is still here rather than retried forever. */
    const refused = [400, 403, 404, 409, 413, 415].includes(Number(error.status));
    row.fatal = refused;
    /* Only a refusal worth reading is written down. A row that will be tried again keeps no message, so
       the panel says in its own words what is true — the file is here and it will go when the server
       answers — rather than repeating the browser's "Failed to fetch" at somebody in a field. */
    row.error = refused ? error.message : '';
    await dvUpdate(row);
    return refused ? 'stopped' : 'waiting';
  }
}

let dvFlushing = false;

async function dvFlush() {
  if (dvFlushing || !window.SurveyAuth) return;
  await dvPendingLoad();
  const sendable = dvState.pending.filter((row) => !row.fatal);
  if (!sendable.length) {
    dvPaint();
    return;
  }
  dvFlushing = true;
  dvState.sending = true;
  dvPaint();
  let sent = 0;
  for (const row of sendable) {
    const outcome = await dvSendOne(row);
    if (outcome === 'sent') sent += 1;
    if (outcome === 'waiting') break;
  }
  dvFlushing = false;
  dvState.sending = false;
  /* A file that arrived is a new row, not merely a hold that cleared, so the list is read again and the
     document appears where its own status puts it instead of after a manual refresh. */
  if (sent) await dvLoad();
  else {
    await dvPendingLoad();
    dvPaint();
  }
  if (sent && typeof toast === 'function') {
    toast(sent === 1 ? 'The file has been sent to SurveyPro.' : `${sent} files have been sent.`);
  }
  const left = dvState.pending.filter((row) => !row.fatal).length;
  if (left) setTimeout(dvFlush, 30000);
}

/* ── the list ────────────────────────────────────────────────────────────────────────────── */

async function dvLoad() {
  dvState.loading = true;
  dvState.error = '';
  dvPaint();
  await dvPendingLoad();
  if (dvState.tab === 'case' && !dvState.caseId) {
    dvState.loading = false;
    dvState.rows = [];
    dvPaint();
    return;
  }
  try {
    const query =
      dvState.tab === 'case'
        ? `?scope=case&case=${encodeURIComponent(dvState.caseId)}`
        : `?scope=${dvState.tab === 'queue' ? 'queue' : 'mine'}`;
    const payload = await window.SurveyAuth.request(`/api/documents${query}`);
    dvState.rows = Array.isArray(payload.documents) ? payload.documents : [];
    dvState.counts = payload.counts || null;
    dvState.vocab = payload.vocab || dvState.vocab;
    dvRememberVocab(dvState.vocab);
    dvState.caseRow = payload.case || dvState.caseRow;
    dvState.loading = false;
    dvPaint();
  } catch (error) {
    dvState.loading = false;
    dvState.error =
      error.status === 403
        ? 'This account is not permitted to see that list.'
        : error.status === 404 || error.code === 'case_not_found'
          ? 'That case is not on the server yet, so it has no documents to list.'
          : error.status === 0 || (error.message || '').indexOf('fetch') !== -1
            ? /* The rows live on the server, so they genuinely cannot be shown without a connection —
                 but files waiting on this device can, and are shown above this message. */
              'SurveyPro could not be reached. Documents held on this device are listed above; the server’s list will appear when it answers.'
            : error.message || 'SurveyPro could not read the documents.';
    dvPaint();
  }
}

function dvTabs() {
  const tabs = [];
  if (dvMay('verify_documents', normalizeServerRole(dvMe() && dvMe().role) !== 'STAFF'))
    tabs.push(['queue', 'Waiting for verification']);
  tabs.push(['mine', 'My uploads']);
  if (dvState.caseId) tabs.push(['case', 'This case']);
  return h(
    'div',
    { class: 'dv-tabs', role: 'tablist', 'aria-label': 'Which documents' },
    ...tabs.map(([key, label]) =>
      h(
        'button',
        {
          class: 'dv-tab' + (dvState.tab === key ? ' on' : ''),
          type: 'button',
          role: 'tab',
          'aria-selected': dvState.tab === key ? 'true' : 'false',
          onclick: () => {
            if (dvState.tab === key) return;
            dvState.tab = key;
            /* A tab chosen here is part of where the person is standing, and it repaints in place
               rather than through showDocuments(), so it says so itself. */
            rememberPlace();
            dvLoad();
          },
        },
        label
      )
    )
  );
}

/* Straight from countDocumentsByStatus, over the five statuses §8 names, so the numbers on the page are
   the numbers in the table rather than a count of the rows this screen happens to hold. */
function dvCounts() {
  const c = dvState.counts;
  if (!c) return null;
  const tones = {
    Uploaded: '',
    'Pending Verification': 'am',
    Verified: 'gn',
    Rejected: 'rd',
    'Replacement Required': 'rd',
  };
  return h(
    'div',
    { class: 'dv-counts' },
    ...DV_COUNT_ORDER.map((status) =>
      h(
        'div',
        { class: 'dv-count ' + (tones[status] || '') },
        h('b', {}, String(c[status] || 0)),
        h('span', {}, status)
      )
    )
  );
}

/* Files held on this device and not yet on the server. Deliberately not part of the list above: it is
   true when the server cannot be reached at all, which is exactly when it matters most. */
function dvPendingPanel() {
  const rows = dvState.pending;
  if (!rows.length) return null;
  return h(
    'div',
    { class: 'dv-held' },
    h(
      'h2',
      {},
      `Waiting to be sent from this device (${rows.length})`,
      dvState.sending ? h('span', { class: 'dv-sending' }, ' · sending…') : null
    ),
    ...rows.map((row) =>
      h(
        'div',
        { class: 'dv-held-row' + (row.fatal ? ' bad' : '') },
        h('b', {}, row.filename),
        h(
          'span',
          { class: 'mu' },
          [row.category, dvSize(row.size), dvDateTime(row.at)].filter(Boolean).join(' · ')
        ),
        h(
          'p',
          { class: 'dv-held-why' },
          row.fatal
            ? `SurveyPro refused it: ${row.error}`
            : row.error || 'No connection yet. The file is kept here and will be sent again.'
        ),
        h(
          'div',
          { class: 'dv-acts' },
          h('button', { class: 'b', type: 'button', onclick: () => dvFlush() }, 'Try sending now'),
          h(
            'button',
            {
              class: 'b',
              type: 'button',
              onclick: () => dvForgetDialog(row),
            },
            'Forget this copy'
          )
        )
      )
    )
  );
}

function dvThumb(doc) {
  if (!doc.craft || !doc.craft.file) return h('div', { class: 'dv-ph dv-none' }, '—');
  if (dvIsImage(doc))
    return h('img', {
      class: 'dv-ph',
      src: dvFileUrl(doc.id),
      alt: doc.originalFilename,
      loading: 'lazy',
    });
  return h(
    'a',
    { class: 'dv-ph dv-file', href: dvFileUrl(doc.id), target: '_blank', rel: 'noopener' },
    String((doc.originalFilename || '').split('.').pop() || 'file')
      .slice(0, 4)
      .toUpperCase()
  );
}

function dvCard(doc) {
  const held = dvState.pending.some((row) => row.docId === doc.id);
  const meta = [];
  if (doc.uploaderName) meta.push('sent by ' + doc.uploaderName);
  meta.push(dvDate(doc.uploadedAt));
  if (doc.craft && !doc.craft.file && !held) meta.push('no file on this record yet');

  return h(
    'article',
    { class: 'dv-card' + (doc.isCurrent === false ? ' dv-old' : '') },
    h(
      'div',
      { class: 'dv-thumb' },
      dvThumb(doc),
      doc.version > 1 ? h('span', { class: 'dv-version' }, 'v' + doc.version) : null
    ),
    h(
      'div',
      { class: 'dv-main' },
      h(
        'div',
        { class: 'dv-card-top' },
        h('h3', {}, doc.originalFilename),
        h(
          'div',
          { class: 'dv-pills' },
          h('span', { class: 'pill dv-cat' }, doc.category),
          h('span', { class: 'pill dv-status ' + (DV_TONE[doc.status] || 'dv-plain') }, doc.status),
          doc.reportRelated ? h('span', { class: 'pill dv-rep' }, 'In the report') : null
        )
      ),
      dvState.tab !== 'case'
        ? h(
            'button',
            {
              class: 'dv-case',
              type: 'button',
              title: 'Open the case',
              onclick: () => dvOpenCase(doc.caseId),
            },
            h('b', {}, doc.caseNumber || doc.caseId),
            h(
              'span',
              {},
              [doc.insurer, doc.vehicleRegistration, doc.insuredName].filter(Boolean).join(' · ')
            )
          )
        : null,
      h('p', { class: 'mu dv-meta' }, meta.join(' · ')),
      doc.rejectionReason
        ? h(
            'p',
            { class: 'dv-why ' + (doc.status === 'Verified' ? 'ok' : 'bad') },
            `${doc.status === 'Replacement Required' ? 'Replacement asked for' : 'Rejected'} — ${doc.rejectionReason}`
          )
        : null,
      dvActions(doc)
    )
  );
}

/* Every control on the card is the server's answer, not this file's guess: `actions` for the three
   decisions and `craft` for the four things that are not decisions. A row painted for somebody who
   cannot verify it simply has no Verify button, and the route would refuse the press anyway. */
function dvActions(doc) {
  const craft = doc.craft || {};
  const buttons = (doc.actions || []).map((item) =>
    h(
      'button',
      {
        class: 'b' + (item.action === 'verify' ? ' p' : item.action === 'reject' ? ' er' : ''),
        type: 'button',
        onclick: () =>
          item.requiresReason
            ? dvReasonDialog(doc, item)
            : dvAct(doc, item.action, {}, 'The document is verified.'),
      },
      DV_LABEL[item.action] || item.action
    )
  );
  if (craft.send)
    buttons.push(
      h(
        'button',
        {
          class: 'b',
          type: 'button',
          title: 'This record has no file yet; choose it on this device.',
          onclick: () => dvFilePicker({ kind: 'bytes', doc }),
        },
        'Send the file'
      )
    );
  if (craft.replace)
    buttons.push(
      h(
        'button',
        { class: 'b', type: 'button', onclick: () => dvFilePicker({ kind: 'replace', doc }) },
        'Replace'
      )
    );
  if (craft.edit)
    buttons.push(
      h(
        'button',
        { class: 'b', type: 'button', onclick: () => dvEditDialog(doc) },
        'Change details'
      )
    );
  if (craft.remove)
    buttons.push(
      h('button', { class: 'b er', type: 'button', onclick: () => dvRemoveDialog(doc) }, 'Remove')
    );
  buttons.push(
    h(
      'button',
      { class: 'b dv-more', type: 'button', onclick: () => dvHistoryDialog(doc) },
      'History'
    )
  );
  return h('div', { class: 'dv-acts' }, ...buttons);
}

function dvBody() {
  if (dvState.loading && !dvState.rows.length)
    return h('div', { class: 'dv-empty' }, 'Reading the documents…');
  if (dvState.error) return h('div', { class: 'dv-empty bad' }, dvState.error);
  if (!dvState.rows.length)
    return h(
      'div',
      { class: 'dv-empty' },
      dvState.tab === 'queue'
        ? 'Nothing is waiting for a decision.'
        : dvState.tab === 'case'
          ? 'This case has no documents recorded on the server yet.'
          : 'You have not sent any documents yet.'
    );
  return h('div', { class: 'dv-list' }, ...dvState.rows.map(dvCard));
}

function dvPaint() {
  if (!dvState.root) return;
  const box = dvState.root.querySelector('.dv-body');
  if (box) box.replaceChildren(dvBody());
  const held = dvState.root.querySelector('.dv-held-slot');
  if (held) held.replaceChildren(dvPendingPanel() || h('span', { hidden: true }));
  /* The tab strip carries which one is on, so it is rebuilt from the same state as the list — the
     defect §27 recorded for the task screen applies word for word here. */
  const tabs = dvState.root.querySelector('.dv-tabs');
  if (tabs) tabs.replaceChildren(...dvTabs().children);
  const counts = dvState.root.querySelector('.dv-counts-slot');
  if (counts) counts.replaceChildren(dvCounts() || h('span', { hidden: true }));
  const upload = dvState.root.querySelector('.dv-upload');
  if (upload) upload.hidden = !dvMay('upload_documents', true);
  const badge = dvState.root.querySelector('.dv-held-badge');
  if (badge) {
    const owed = dvState.pending.length;
    badge.textContent = owed ? `${owed} to send` : '';
    badge.hidden = !owed;
  }
  const title = dvState.root.querySelector('.dv-title');
  if (title)
    title.textContent =
      dvState.tab === 'queue'
        ? 'Document verification'
        : dvState.tab === 'case'
          ? 'Documents for this case'
          : 'My documents';
  const note = dvState.root.querySelector('.dv-sub');
  if (note)
    note.textContent =
      dvState.tab === 'case' && dvState.caseRow
        ? `The files recorded against claim ${dvState.caseRow.caseNumber || dvState.caseId}.`
        : dvState.tab === 'queue'
          ? 'Documents waiting for somebody with the permission to check them.'
          : 'What this account has sent, and what is still held on this device.';
}

function renderDocumentsView() {
  const root = h('div', { class: 'case-directory dv2' });
  dvState.root = root;
  root.append(
    h(
      'div',
      { class: 'dh dv-head' },
      h(
        'div',
        { class: 'dv-head-t' },
        h('h1', { class: 'dv-title' }, 'My documents'),
        h('p', { class: 'mu dv-sub' }, '')
      ),
      h(
        'div',
        { class: 'bar' },
        h('span', { class: 'pill dv-held-badge', hidden: true }),
        h(
          'button',
          { class: 'b p dv-upload', type: 'button', onclick: () => dvNewDialog() },
          '+ Upload a document'
        ),
        h('button', { class: 'b', type: 'button', onclick: showDash }, 'Dashboard')
      )
    ),
    h('div', { class: 'dv-held-slot' }, dvPendingPanel() || h('span', { hidden: true })),
    dvTabs(),
    h('div', { class: 'dv-counts-slot' }, dvCounts() || h('span', { hidden: true })),
    h('div', { class: 'dv-body' }, dvBody())
  );
  dvLoad();
  return root;
}

function showDocuments(options = {}) {
  if (options.caseId) {
    dvState.caseId = options.caseId;
    dvState.caseRow = null;
  } else if (options.tab && options.tab !== 'case') dvState.caseId = '';
  if (options.tab) dvState.tab = options.tab;
  /* A tab an account cannot ask the server for is not offered and not entered: the strip below only
     ever lists what this session may load, so a stale state cannot produce an empty list nobody asked
     for. */
  if (dvState.tab === 'case' && !dvState.caseId) dvState.tab = 'mine';
  if (
    dvState.tab === 'queue' &&
    !dvMay('verify_documents', normalizeServerRole(dvMe() && dvMe().role) !== 'STAFF')
  )
    dvState.tab = 'mine';
  view = 'documents';
  $('#dash').hidden = false;
  $('#dash').classList.add('dash-cases');
  $('.app').hidden = true;
  ['#cs', '#del', '#dx', '#ta', '#td', '#tc'].forEach((sel) => {
    const el = $(sel);
    if (el) el.hidden = true;
  });
  $('#cm').hidden = true;
  $('#ct').hidden = true;
  $('#dash').replaceChildren(renderDocumentsView());
  setMenu('dv');
  window.scrollTo(0, 0);
  rememberPlace();
}

/* One case, reached the way every other screen reaches one, and fetched first if this device has never
   held it — the normal situation for a document somebody else sent. */
async function dvOpenCase(caseId) {
  if (typeof DB !== 'undefined' && !DB[caseId]) {
    await syncTake(caseId);
    if (!DB[caseId]) {
      if (typeof toast === 'function')
        toast('That case could not be fetched from SurveyPro. The document is still listed here.');
      return;
    }
  }
  if (typeof openCase === 'function') openCase(caseId);
}

/* ── sending a file ──────────────────────────────────────────────────────────────────────── */

async function dvAct(doc, action, body, ok) {
  try {
    await window.SurveyAuth.request(`/api/documents/${encodeURIComponent(doc.id)}/${action}`, {
      method: 'POST',
      body: body || {},
    });
    if (ok && typeof toast === 'function') toast(ok);
    return dvLoad();
  } catch (error) {
    if (typeof toast === 'function') toast(error.message || 'SurveyPro refused that.');
    /* Somebody else decided it first. Show the status that is true now rather than the painted one. */
    if (error.status === 409 || error.status === 404) dvLoad();
  }
}

/* The accepted types arrive from the server, but a phone's file picker needs the extensions as much as
   the media types, so both are offered. Nothing here decides what a document may be: the server reads
   the first bytes and refuses what is not one of them. */
const DV_EXT = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg,.jpeg',
  'image/png': '.png',
  'image/webp': '.webp',
};

const dvAccept = () =>
  (dvVocab().formats || ['application/pdf', 'image/jpeg'])
    .map((mime) => DV_EXT[mime] || mime)
    .join(',');

/* A file is chosen, not typed in, so this is the one dialog whose submit button is a plain button
   rather than a form submit: the picker has to answer before anything can be held. */
function dvFilePicker({ kind, doc }) {
  const vocab = dvVocab();
  const caseId = kind === 'new' ? doc && doc.caseId : doc ? doc.caseId : dvState.caseId;
  const dlg = h('dialog', { class: 'dv-dlg' });
  const chosen = h('input', { type: 'file', accept: dvAccept() });
  const status = h('p', { class: 'mu dv-pick-note' }, 'Choose the photograph, scan or PDF.');
  const submit = h('button', { class: 'b p', type: 'button' }, 'Send it');
  const maxBytes = Number(vocab.maxBytes) || 0;

  const categories = vocab.categories || [];
  /* A new record cannot be filed without a category, and the categories come from the server. Rather
     than hold a file the route will refuse, the picker says what is missing. */
  const noCategories = kind === 'new' && !categories.length;
  const category = h('select', { hidden: kind !== 'new' });
  categories.forEach((name) => category.append(h('option', { value: name }, name)));
  if (kind !== 'new' && doc) category.value = doc.category;
  /* The select opens on its first option, so "nobody has answered it yet" cannot be read from its
     value — it has to be watched. */
  let categoryTouched = false;
  category.addEventListener('change', () => {
    categoryTouched = true;
  });
  if (noCategories)
    status.textContent =
      'This device has not been told the document categories yet. Open the list once with a signal, then a file can be filed.';

  chosen.onchange = () => {
    const file = chosen.files && chosen.files[0];
    if (!file) {
      status.textContent = noCategories
        ? 'This device has not been told the document categories yet. Open the list once with a signal, then a file can be filed.'
        : 'Choose the photograph, scan or PDF.';
      submit.disabled = true;
      return;
    }
    if (maxBytes && file.size > maxBytes) {
      status.textContent = `That file is ${dvSize(file.size)}; SurveyPro accepts up to ${dvSize(
        maxBytes
      )}. Photograph it again, or send it as a smaller scan.`;
      submit.disabled = true;
      return;
    }
    if (noCategories) {
      status.textContent = `${file.name} · ${dvSize(
        file.size
      )} — but this device has not been told the document categories yet, so it cannot file it. Open the list once with a signal.`;
      submit.disabled = true;
      return;
    }
    status.textContent = `${file.name} · ${dvSize(file.size)}${
      /* Only a replacement makes a new version. Attaching bytes to a record that arrived without them
         completes the version that is already on the list, and promising "version 2" here would be a
         different document than the one the verifier then sees. */
      kind === 'replace' ? ` · version ${Number(doc.version) + 1} of this document` : ''
    }`;
    submit.disabled = false;
    if (kind === 'new' && !categoryTouched) {
      /* A name is often the only clue: a file called garage-bill.jpg belongs under Bills. Guessed, and
         the picker can disagree — the select is right above it either way. The stem is matched rather
         than the whole word, because people save one bill as "bill" and one estimate as "estimates". */
      const lower = (file.name || '').toLowerCase();
      const guess = categories.find((name) =>
        lower.includes(String(name).split(' ')[0].toLowerCase().replace(/s$/, ''))
      );
      if (guess) category.value = guess;
    }
  };
  submit.disabled = true;

  submit.onclick = async () => {
    const file = chosen.files && chosen.files[0];
    if (!file) return;
    submit.disabled = true;
    submit.textContent = 'Holding it here…';
    try {
      await dvHold({
        kind,
        docId: kind === 'bytes' ? doc.id : null,
        replaceOf: kind === 'replace' ? doc.id : null,
        caseId: caseId || (doc && doc.caseId),
        category: category.value || (doc && doc.category),
        filename: file.name || 'document',
        file,
      });
      dlg.close();
      await dvPendingLoad();
      dvPaint();
      if (typeof toast === 'function') toast('The file is kept on this device. Sending it now.');
      dvFlush();
    } catch (error) {
      submit.disabled = false;
      submit.textContent = 'Send it';
      status.textContent = error.message || 'This device could not hold the file.';
    }
  };

  dlg.append(
    h(
      'form',
      { method: 'dialog', onsubmit: (e) => e.preventDefault() },
      h(
        'h3',
        {},
        kind === 'new'
          ? 'Upload a document'
          : kind === 'replace'
            ? 'Replace this document'
            : 'Send the file for this record'
      ),
      h(
        'p',
        { class: 'mu' },
        kind === 'replace'
          ? 'The version you sent stays exactly as it was; this becomes the next one.'
          : kind === 'bytes'
            ? 'The record already exists — this is the file that goes with it.'
            : 'A record exists before its bytes do, so a photograph taken with no signal is still a document.'
      ),
      kind === 'new'
        ? h('label', { class: 'dv-field' }, h('span', {}, 'Category'), category)
        : null,
      h('label', { class: 'dv-field' }, h('span', {}, 'File'), chosen),
      status,
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
  chosen.focus();
}

/* A new document from the page rather than from a case: the case has to be named, and the only list of
   cases this device can offer is the directory the rest of the app already uses. */
function dvNewDialog() {
  const cases = (typeof caseDirectoryRows === 'function' ? caseDirectoryRows() : []).map((r) => ({
    v: r.c.id,
    t: [r.id, r.ins, r.vrn].filter((part) => part && part !== '—').join(' · '),
  }));
  if (dvState.caseId && !cases.some((row) => row.v === dvState.caseId))
    cases.unshift({
      v: dvState.caseId,
      t: [dvState.caseRow && dvState.caseRow.caseNumber, 'this case'].filter(Boolean).join(' · '),
    });
  if (!cases.length) {
    if (typeof toast === 'function')
      toast(
        'This device holds no case to file a document against. Open the case first, or sync from SurveyPro.'
      );
    return;
  }
  const dlg = h('dialog', { class: 'dv-dlg' });
  const pick = h('select', {});
  cases.forEach((row) => pick.append(h('option', { value: row.v }, row.t)));
  if (dvState.caseId) pick.value = dvState.caseId;
  dlg.append(
    h(
      'form',
      {
        method: 'dialog',
        onsubmit: (e) => {
          e.preventDefault();
          dlg.close();
          dvFilePicker({ kind: 'new', doc: { caseId: pick.value } });
        },
      },
      h('h3', {}, 'Which case does this document belong to?'),
      h('label', { class: 'dv-field' }, h('span', {}, 'Case'), pick),
      h(
        'div',
        { class: 'bar' },
        h('button', { class: 'b', type: 'button', onclick: () => dlg.close() }, 'Cancel'),
        h('button', { class: 'b p', type: 'submit' }, 'Choose the file')
      )
    )
  );
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
}

/* ── the dialogs that ask one question ───────────────────────────────────────────────────── */

/* The dialog shape the rest of the app uses — form method="dialog", a .bar footer, removed on close,
   returning false from onSubmit keeps it open. */
function dvDialog(title, body, submitLabel, onSubmit, note) {
  const dlg = h('dialog', { class: 'dv-dlg' });
  const submit = h('button', { class: 'b p', type: 'submit' }, submitLabel);
  const form = h(
    'form',
    { method: 'dialog' },
    h('h3', {}, title),
    note ? h('p', { class: 'mu' }, note) : null,
    body,
    h(
      'div',
      { class: 'bar' },
      h('button', { class: 'b', type: 'button', onclick: () => dlg.close() }, 'Cancel'),
      submit
    )
  );
  /* Guarded on the form rather than on the button: Enter in a text field submits a dialog form, and a
     guard that only watched the click would let that close the dialog having sent nothing. */
  form.addEventListener('submit', (event) => {
    if (onSubmit() === false) event.preventDefault();
  });
  dlg.append(form);
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
  const first = dlg.querySelector('select, input, textarea');
  if (first) first.focus();
  return dlg;
}

/* A rejection or a request for a replacement without a reason is a disappearance rather than a
   decision, so the route requires the sentence and this dialog will not close without it. */
function dvReasonDialog(doc, item) {
  const box = h('textarea', { rows: '3', maxlength: '4000' });
  const dlg = dvDialog(
    item.action === 'reject' ? `Reject ${doc.originalFilename}` : `Ask for a replacement`,
    h('label', { class: 'dv-field' }, h('span', {}, 'Why? This goes to whoever sent it.'), box),
    item.action === 'reject' ? 'Reject' : 'Ask for a replacement',
    () => {
      const reason = box.value.trim();
      if (!reason) return false;
      dvAct(doc, item.action, { reason }, 'The uploader has been told what is wrong with it.');
      return true;
    },
    doc.status === 'Pending Verification'
      ? 'The document is waiting for a decision, and this one says no.'
      : null
  );
  dvRequire(dlg, box, 'A rejection without a reason tells the uploader nothing.');
}

/* A press that is going to be refused is not offered. The file picker already works this way, and a
   decision dialog should not look ready while it silently ignores the button. */
function dvRequire(dlg, field, why) {
  const submit = dlg.querySelector('button[type=submit]');
  if (!submit) return;
  const empty = () => !String(field.value || '').trim();
  submit.disabled = empty();
  /* The explanation belongs to the refusal, not to the button: a title on an enabled Save reads as a
     warning about something that is about to work fine. */
  submit.title = submit.disabled ? why : '';
  field.addEventListener('input', () => {
    submit.disabled = empty();
    submit.title = submit.disabled ? why : '';
  });
}

/* Changing the heading is the same file under a different name, which is why it is a change rather
   than a new version — and why the server writes what it was before into the history. */
function dvEditDialog(doc) {
  const categories = dvVocab().categories || [];
  const category = h('select', {});
  categories.forEach((name) => category.append(h('option', { value: name }, name)));
  category.value = doc.category;
  const filename = h('input', { type: 'text', maxlength: '180' });
  filename.value = doc.originalFilename || '';
  const report = h('input', { type: 'checkbox' });
  report.checked = Boolean(doc.reportRelated);

  const dlg = dvDialog(
    'Change how this document is filed',
    h(
      'div',
      {},
      h('label', { class: 'dv-field' }, h('span', {}, 'Category'), category),
      h('label', { class: 'dv-field' }, h('span', {}, 'Name as it arrived'), filename),
      h('label', { class: 'dv-check' }, report, h('span', {}, 'A report rests on this document'))
    ),
    'Save',
    () => {
      if (!filename.value.trim()) return false;
      dvSend(
        `/api/documents/${encodeURIComponent(doc.id)}`,
        {
          method: 'PATCH',
          body: {
            category: category.value,
            filename: filename.value.trim(),
            reportRelated: report.checked,
          },
        },
        'The document is filed differently, and the change is in its history.'
      );
      return true;
    },
    'The file itself does not change, so this is not a new version — but it is still recorded.'
  );
  dvRequire(dlg, filename, 'A document with no name cannot be found again in the history.');
}

function dvRemoveDialog(doc) {
  dvDialog(
    `Remove ${doc.originalFilename}`,
    h(
      'p',
      {
        class: 'mu',
      },
      'The record and the file behind it both go. What stays is the audit entry: the name, the hash, the case and who removed it.'
    ),
    'Remove it',
    () => {
      dvSend(
        `/api/documents/${encodeURIComponent(doc.id)}`,
        { method: 'DELETE' },
        'The document has been removed.'
      );
      return true;
    },
    'Only your own unverified uploads can be removed this way; anything verified is evidence.'
  );
}

/* A file held here and never sent is not a document the team can check. Forgetting the copy is the
   honest option, but it is the one that loses the photograph, so it says which situation the button is
   in before it lets you press it. */
function dvForgetDialog(row) {
  dvDialog(
    `Forget ${row.filename}`,
    h(
      'p',
      { class: 'mu' },
      row.docId
        ? 'The record is on SurveyPro without its file. Forgetting this copy leaves the record empty, and nobody will be able to check it.'
        : 'This copy exists only on this device. Forgetting it loses the file, and nothing on SurveyPro will know it was ever taken.'
    ),
    'Forget this copy',
    () => {
      dvForget(row.id).then(() => {
        dvPaint();
        if (typeof toast === 'function') toast('That copy has been removed from this device.');
      });
      return true;
    }
  );
}

async function dvSend(pathname, options, ok) {
  try {
    await window.SurveyAuth.request(pathname, options);
    if (ok && typeof toast === 'function') toast(ok);
    return dvLoad();
  } catch (error) {
    if (typeof toast === 'function') toast(error.message || 'SurveyPro refused that.');
    if (error.status === 409 || error.status === 404) dvLoad();
  }
}

/* ── the history of one document ─────────────────────────────────────────────────────────── */

/* §8's "record the complete history" in one call: the versions of the file, newest first, each with
   what happened to it, and the events for the version being looked at. A superseded version is shown
   rather than hidden, because a replacement you cannot compare with what it replaced is not a history. */
function dvHistoryDialog(doc) {
  const busy = h('p', { class: 'mu' }, 'Reading the history of this document…');
  const dlg = h('dialog', { class: 'dv-dlg dv-wide' });
  dlg.append(
    h(
      'form',
      { method: 'dialog' },
      h('h3', {}, doc.originalFilename),
      busy,
      h('div', { class: 'bar' }, h('button', { class: 'b', type: 'submit' }, 'Close'))
    )
  );
  document.body.append(dlg);
  dlg.addEventListener('close', () => {
    dlg.remove();
    if (dvState.root) dvLoad();
  });
  dlg.showModal();

  window.SurveyAuth.request(`/api/documents/${encodeURIComponent(doc.id)}`)
    .then((payload) => {
      const versions = Array.isArray(payload.versions) ? payload.versions : [];
      const events = Array.isArray(payload.events) ? payload.events : [];
      const rows = versions.map((version) =>
        h(
          'tr',
          { class: version.id === doc.id ? 'dv-here' : '' },
          h('td', {}, 'v' + version.version),
          h(
            'td',
            {},
            h(
              'span',
              { class: 'pill dv-status ' + (DV_TONE[version.status] || 'dv-plain') },
              version.status
            )
          ),
          h('td', {}, version.uploaderName || '—'),
          h('td', {}, dvDateTime(version.uploadedAt)),
          h(
            'td',
            {},
            version.craft && version.craft.file
              ? h(
                  'a',
                  { href: dvFileUrl(version.id), target: '_blank', rel: 'noopener' },
                  dvSize(version.byteSize)
                )
              : 'no file'
          ),
          h('td', { class: 'mu' }, version.sha256 ? String(version.sha256).slice(0, 8) : '—')
        )
      );
      busy.replaceWith(
        h(
          'div',
          { class: 'dv-story' },
          h(
            'table',
            { class: 'dv-versions' },
            h(
              'thead',
              {},
              h(
                'tr',
                {},
                ...['Version', 'Status', 'Sent by', 'When', 'File', 'Hash'].map((label) =>
                  h('th', {}, label)
                )
              )
            ),
            h('tbody', {}, ...rows)
          ),
          h(
            'p',
            { class: 'mu dv-sha' },
            'Two copies of the same file share a hash, so a re-upload of what is already there is visible rather than silent.'
          ),
          events.length
            ? h(
                'ol',
                { class: 'dv-events' },
                ...events.map((event) =>
                  h(
                    'li',
                    {},
                    h('b', {}, DV_EVENT_LABEL[event.action] || event.action),
                    h(
                      'span',
                      { class: 'mu' },
                      [event.actorName || 'the system', dvDateTime(event.createdAt)].join(' · ')
                    ),
                    event.reason ? h('p', { class: 'dv-why bad' }, event.reason) : null,
                    event.details && event.details.fields && event.details.fields.length
                      ? h(
                          'p',
                          { class: 'mu' },
                          event.details.fields
                            .map(
                              (field) =>
                                `${field} was ${String(
                                  (event.details.from || {})[field] ?? '—'
                                ).slice(0, 60)} → ${String(
                                  (event.details.to || {})[field] ?? '—'
                                ).slice(0, 60)}`
                            )
                            .join(' · ')
                        )
                      : null
                  )
                )
              )
            : h('p', { class: 'mu' }, 'This version has no events recorded.')
        )
      );
    })
    .catch((error) => {
      busy.replaceWith(
        h(
          'div',
          { class: 'dv-empty bad' },
          error.message || 'SurveyPro could not read the history.'
        )
      );
    });
}

/* ── wiring ──────────────────────────────────────────────────────────────────────────────── */

const dvSidebar = document.getElementById('dv');
if (dvSidebar)
  dvSidebar.onclick = () => {
    const queueFirst = dvMay(
      'verify_documents',
      normalizeServerRole(dvMe() && dvMe().role) !== 'STAFF'
    );
    showDocuments({ tab: queueFirst ? 'queue' : 'mine' });
    if (typeof closeSideMenu === 'function') closeSideMenu();
  };

/* The Case tools group only shows while a case is open, which is exactly when this belongs there, and
   openCase() decides whether the button is in it — the same way it decides Export and Delete. */
const dvCaseBtn = document.getElementById('td');
if (dvCaseBtn)
  dvCaseBtn.onclick = () => {
    if (cur) showDocuments({ caseId: cur, tab: 'case' });
    if (typeof closeSideMenu === 'function') closeSideMenu();
  };

addEventListener('online', () => dvFlush());
