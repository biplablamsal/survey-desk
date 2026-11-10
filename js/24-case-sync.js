/* Case sync (task #21): the browser keeps owning the case and the server keeps a copy of it.

   Local-first is the whole point, so nothing here may make editing depend on the network. A keystroke
   writes to localStorage exactly as it did before; the push is a separate, later, retryable step. If
   the server is unreachable the case simply has not been sent yet, and "not sent yet" is a fact about
   the data rather than a queue that can be lost — see syncQueue().

   Two copies drift apart by one number: `u`, the moment the browser last changed the case. What is
   stored under sp.sync.sent is the `u` of the version the server last accepted, per case. A case whose
   `u` is greater is one that has not been sent; a case in that map but no longer in DB is one that was
   deleted here. That is the entire model, which is why a reload, a dead battery and three hours in a
   tunnel all need the same handling: none.

   The server refuses a write whose `u` is older than what it already holds, so the newest version wins
   in both directions, and a version the server refused is kept rather than dropped — see syncRescue().
*/

const SYNC_SENT = 'sp.sync.sent',
  SYNC_SINCE = 'sp.sync.since',
  SYNC_RESCUE = 'sp.sync.rescued';

const SYNC = { timer: 0, busy: false, waiting: false };

const syncSentMap = () => {
  try {
    return JSON.parse(ST.g(SYNC_SENT) || '{}') || {};
  } catch {
    return {};
  }
};

const syncSignedIn = () => {
  const auth = window.SurveyAuth && window.SurveyAuth.readAuth();
  return Boolean(auth && auth.user);
};

const stampOf = (value) => Number(value && value.u) || 0;

/* Recomputed from the data every time, so nothing can be forgotten by the code that changed it. */
function syncQueue() {
  const sent = syncSentMap(),
    edit = [],
    remove = [];
  Object.keys(DB).forEach((id) => {
    if (stampOf(DB[id]) > Number(sent[id] || 0)) edit.push(id);
  });
  Object.keys(sent).forEach((id) => {
    if (!DB[id]) remove.push(id);
  });
  return { edit, remove };
}

function syncRecordSent(id, u) {
  const sent = syncSentMap();
  sent[id] = Number(u) || 0;
  ST.s(SYNC_SENT, JSON.stringify(sent));
}

/* The one place the label is written, so a save, a finished flush and a failed one cannot each put a
   different sentence in the same slot. */
function syncPaint() {
  const el = $('#sync');
  if (!el) return;
  if (!syncSignedIn()) {
    el.textContent = '';
    el.title = '';
    return;
  }
  const waiting = syncQueue();
  const n = waiting.edit.length + waiting.remove.length;
  if (SYNC.busy) {
    el.textContent = '⟳ Syncing…';
    el.title = 'Sending and receiving cases.';
  } else if (SYNC.waiting) {
    el.textContent = `⚠ ${n} not synced`;
    el.title =
      'SurveyPro could not reach the server. The cases are saved on this device and will be sent again.';
  } else if (n) {
    el.textContent = `→ ${n} to sync`;
    el.title = 'Saved here, waiting to be sent.';
  } else {
    el.textContent = '✓ Synced';
    el.title = 'Every case on this device is also on the server.';
  }
}

function syncSchedule(delay = 5000) {
  clearTimeout(SYNC.timer);
  SYNC.timer = setTimeout(syncFlush, delay);
}

/* A push the server refused means its copy is newer than ours. Newest wins, so our version is the one
   that goes out of sight — which is exactly the case that must not lose a surveyor's afternoon, so it
   is written down and said out loud rather than quietly dropped. */
function syncRescue(id, body) {
  let list = [];
  try {
    list = JSON.parse(ST.g(SYNC_RESCUE) || '[]');
  } catch {
    list = [];
  }
  list = list.filter((row) => row.id !== id);
  list.unshift({ id, at: Date.now(), case: body });
  ST.s(SYNC_RESCUE, JSON.stringify(list.slice(0, 20)));
  if (window.toast)
    window.toast(
      'The server already held a newer version of this case. The newer one is now on screen; yours is kept on this device.'
    );
}

async function syncFlush() {
  if (!syncSignedIn() || SYNC.busy || !window.SurveyAuth) return;
  const request = (path, options) => window.SurveyAuth.request(path, options);
  clearTimeout(SYNC.timer);

  const queue = syncQueue();
  if (!queue.edit.length && !queue.remove.length) {
    syncPaint();
    return;
  }

  SYNC.busy = true;
  SYNC.waiting = false;
  syncPaint();

  for (const id of queue.remove) {
    try {
      await request(`/api/cases/${encodeURIComponent(id)}`, { method: 'DELETE' });
      syncDropSent(id);
    } catch (error) {
      /* Already gone on the server is the outcome we wanted; a refusal will not change by asking
         again. Both stop this device trying to delete it for ever. */
      if (error.status === 404 || error.code === 'permission_denied') {
        syncDropSent(id);
        if (error.code === 'permission_denied' && window.toast)
          window.toast(
            'That case was removed from this device but not from SurveyPro — deleting cases is not permitted on your account, so it will come back on the next sync.'
          );
      } else {
        SYNC.waiting = true;
      }
    }
  }

  for (const id of queue.edit) {
    const body = DB[id];
    if (!body) continue;
    try {
      await request(`/api/cases/${encodeURIComponent(id)}`, { method: 'PUT', body });
      syncRecordSent(id, body.u);
    } catch (error) {
      if (error.code === 'case_conflict') {
        syncRescue(id, body);
        /* Marking it sent is what stops the same older copy being pushed again on every retry; the
           version that won is then fetched so the two devices agree from here on. */
        syncRecordSent(id, error.serverModifiedAt ? Date.parse(error.serverModifiedAt) : body.u);
        await syncTake(id);
      } else if (error.status === 403 || error.status === 400) {
        /* The server will keep saying no to this one, so it leaves the queue rather than blocking the
           cases behind it. The local copy is untouched either way. */
        syncRecordSent(id, body.u);
      } else {
        /* No answer at all — no signal, no server, a dead battery mid-send. The case stays queued,
           which is the entire point of deriving the queue from the data instead of a list that can be
           lost, and the label says so until the next attempt lands. */
        SYNC.waiting = true;
      }
    }
  }

  SYNC.busy = false;
  /* A push overwrites the register's copy, so the next pull is measured from now: measured from
     before, it would answer with the rows just written and merge them back as newer ones. */
  ST.s(SYNC_SINCE, new Date().toISOString());
  syncPaint();
  const left = syncQueue();
  if (left.edit.length || left.remove.length) syncSchedule(30000);
}

function syncDropSent(id) {
  const sent = syncSentMap();
  delete sent[id];
  ST.s(SYNC_SENT, JSON.stringify(sent));
}

/* One case, straight from the server, when it is the newer of the two. */
async function syncTake(id) {
  try {
    const payload = await window.SurveyAuth.request(`/api/cases/${encodeURIComponent(id)}`);
    const incoming = payload.case && payload.case.payload;
    if (!incoming) return;
    const mine = DB[id];
    if (!mine || stampOf(incoming) >= stampOf(mine)) {
      DB[id] = incoming;
      ST.s('sp.db', JSON.stringify(DB));
      syncRecordSent(id, incoming.u);
      if (cur === id) load(id);
      else if (window.drawDash) drawDash();
    }
  } catch {
    /* A pull that failed changes nothing; the local copy is already correct for this device. */
  }
}

async function syncPull() {
  const since = ST.g(SYNC_SINCE);
  const query = since ? `?payload=1&since=${encodeURIComponent(since)}` : '?payload=1';
  const payload = await window.SurveyAuth.request(`/api/cases${query}`);
  const rows = Array.isArray(payload.cases) ? payload.cases : [];
  let changed = 0;
  rows.forEach((row) => {
    const incoming = row.payload;
    if (!incoming) return;
    /* Anything this device still holds that is at least as recent is already the newer version — and
       a case waiting to be pushed has the same stamp as the register's copy only because the register
       is about to be told, not because somebody else wrote it. */
    const mine = DB[row.id];
    if (mine && stampOf(mine) >= stampOf(incoming)) return;
    DB[row.id] = incoming;
    syncRecordSent(row.id, incoming.u);
    changed += 1;
  });
  if (changed) ST.s('sp.db', JSON.stringify(DB));
  if (payload.serverTime) ST.s(SYNC_SINCE, payload.serverTime);
  return changed;
}

/* The first thing after a session is established: take what the server knows, then send what it does
   not. In that order, because pushing before seeing the newer copy would only produce a conflict, and
   a conflict is the one path where a person has to be told something happened. */
async function syncSessionReady() {
  if (!syncSignedIn() || !window.SurveyAuth) {
    syncPaint();
    return;
  }
  SYNC.busy = true;
  syncPaint();
  let changed = 0;
  try {
    changed = await syncPull();
    SYNC.busy = false;
    await syncFlush();
  } catch {
    /* No register, no server, no signal: everything stays local and the label says so. The data is
       the queue, so the next save, the next bar of signal or the next reload tries again. */
    SYNC.busy = false;
    SYNC.waiting = true;
  }
  syncPaint();
  if (changed) {
    if (cur && DB[cur]) load(cur);
    else if (window.drawDash) drawDash();
  }
  const left = syncQueue();
  if (left.edit.length || left.remove.length) syncSchedule(20000);
}

addEventListener('online', () => syncSchedule(500));
addEventListener('offline', syncPaint);

window.syncSchedule = syncSchedule;
window.syncSessionReady = syncSessionReady;
