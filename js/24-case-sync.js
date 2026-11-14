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
   A pull decides the same thing from the same number and used to keep nothing: the guard in syncPull()
   makes it rescue what it overrules instead, because that number is a claim about a date, not a proof
   that the server's copy knows more.

   A refusal has two quite different meanings and each has to be answered differently. 409 says the
   register holds a newer version of this case, which is why syncRescue() keeps ours and takes the
   server's. 403 and 400 say the register does not hold it at all and will not take it from this device,
   so nothing has been sent — which is why such a case is written into sp.sync.blocked instead of
   sp.sync.sent. A case that is only on one device is a fact about that device's data, and saying "synced"
   over it is how work goes quietly missing when a second computer signs in with the same account.
*/

const SYNC_SENT = 'sp.sync.sent',
  SYNC_SINCE = 'sp.sync.since',
  SYNC_RESCUE = 'sp.sync.rescued',
  SYNC_BLOCK = 'sp.sync.blocked',
  SYNC_HELD = 'sp.sync.held';

const SYNC = { timer: 0, busy: false, waiting: false, denied: '' };

const syncSentMap = () => {
  try {
    return JSON.parse(ST.g(SYNC_SENT) || '{}') || {};
  } catch {
    return {};
  }
};

/* What the server would not take, and the sentence it said when it refused. Kept beside the sent map
   rather than inside it, because "sent" is a claim about the register and must stay true. */
const syncBlockedMap = () => {
  try {
    return JSON.parse(ST.g(SYNC_BLOCK) || '{}') || {};
  } catch {
    return {};
  }
};

function syncBlockWrite(map) {
  ST.s(SYNC_BLOCK, JSON.stringify(map));
}

function syncBlock(id, error) {
  const map = syncBlockedMap();
  map[id] = { at: Date.now(), why: (error && error.message) || 'the server would not take it' };
  syncBlockWrite(map);
}

function syncUnblock(id) {
  const map = syncBlockedMap();
  if (map[id]) {
    delete map[id];
    syncBlockWrite(map);
  }
}

/* What this device was made to set aside, per case, and for as long as the register has not been given
   that work back. See the guard in syncPull(): the server's copy won on its stamp, our version went
   into sp.sync.rescued, and neither of those facts is something a surveyor can see on the case page —
   so they are written down here rather than being said once and then believed solved.

   Kept out of sp.sync.sent and sp.sync.blocked, which both describe what the register did with a
   version this device tried to send. This describes a version it never tried, because the code did not
   ask it to. */
const syncHeldMap = () => {
  try {
    return JSON.parse(ST.g(SYNC_HELD) || '{}') || {};
  } catch {
    return {};
  }
};

function syncHold(id) {
  const map = syncHeldMap();
  map[id] = { at: Date.now() };
  ST.s(SYNC_HELD, JSON.stringify(map));
}

/* Only a push that landed clears it: that is the one event proving the register now holds the work. A
   newer copy arriving from elsewhere proves nothing about ours, so a pull never clears it. */
function syncUnhold(id) {
  const map = syncHeldMap();
  if (map[id]) {
    delete map[id];
    ST.s(SYNC_HELD, JSON.stringify(map));
  }
}

const syncSignedIn = () => {
  const auth = window.SurveyAuth && window.SurveyAuth.readAuth();
  return Boolean(auth && auth.user);
};

const stampOf = (value) => Number(value && value.u) || 0;

/* Recomputed from the data every time, so nothing can be forgotten by the code that changed it. */
function syncQueue() {
  const sent = syncSentMap(),
    blocked = syncBlockedMap(),
    edit = [],
    remove = [],
    refused = [];
  Object.keys(DB).forEach((id) => {
    if (stampOf(DB[id]) <= Number(sent[id] || 0)) return;
    (blocked[id] ? refused : edit).push(id);
  });
  Object.keys(sent).forEach((id) => {
    if (!DB[id]) remove.push(id);
  });
  return { edit, remove, refused };
}

function syncRecordSent(id, u) {
  const sent = syncSentMap();
  sent[id] = Number(u) || 0;
  ST.s(SYNC_SENT, JSON.stringify(sent));
  /* Reaching this line is the proof the refusal no longer stands, wherever it came from: a push that
     landed, a copy taken down, or a rescue that agreed the server's version. */
  syncUnblock(id);
}

/* What the surveyor would have to say to an administrator about a case that did not get through: the
   case they can see on their own screen, and the server's own reason in its own words.

   The number is the one every other screen reads, and it lives inside the answers, not beside them:
   this used to look for c.cn and c.n, which no case object has ever carried, so each notice named the
   case by its id — the one string in the app a surveyor has never been shown. */
const syncCaseLabel = (id) => {
  const c = DB[id] || {};
  return String((c.f && c.f.case_claimNo) || c.cn || id).trim() || id;
};

function syncRefusedNote(refused) {
  const map = syncBlockedMap();
  const row = map[refused[0]] || {};
  const more = refused.length > 1 ? `, and ${refused.length - 1} more` : '';
  const why = String(row.why || 'it would not accept it').replace(/[.\s]+$/, '');
  return (
    `“${syncCaseLabel(refused[0])}”${more} is saved on this device but the server would not take it. ` +
    `The server said: ${why}. ` +
    'No other computer signed in to this account can see it until that is settled.'
  );
}

/* The sentence for a case the register overruled on paper: what happened to each of the two versions,
   and the one action that puts the lost work back where it belongs. */
function syncHeldNote(held) {
  const more = held.length > 1 ? `, and ${held.length - 1} more` : '';
  return (
    `“${syncCaseLabel(held[0])}”${more} was changed here after the version on the register was last ` +
    'updated there, so the register has the newer date and its copy is the one on screen. Your version ' +
    'is kept on this device and the server has never seen it. Open the case and write those answers in ' +
    'again: the next save goes to the server and clears this notice.'
  );
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
  const held = Object.keys(syncHeldMap()).filter((id) => DB[id]);
  if (SYNC.busy) {
    el.textContent = '⟳ Syncing…';
    el.title = 'Sending and receiving cases.';
  } else if (waiting.refused.length) {
    el.textContent = `⚠ ${waiting.refused.length} not on the server`;
    el.title =
      syncRefusedNote(waiting.refused) +
      (SYNC.denied
        ? ' The server would not let this account read the register either: ' + SYNC.denied
        : '');
  } else if (SYNC.denied) {
    el.textContent = '⚠ Server will not share cases';
    el.title =
      SYNC.denied +
      ' — the cases on this device stay on this device, and the cases on the server stay out of sight. Ask an administrator what this account is allowed to see.';
  } else if (SYNC.waiting) {
    el.textContent = `⚠ ${n} not synced`;
    el.title =
      'SurveyPro could not reach the server. The cases are saved on this device and will be sent again.';
  } else if (held.length) {
    /* Ahead of both "to sync" and "Synced", because a case the register overruled is not queued and
       nothing else on this device is pending — so of those two, the label would have picked "Synced"
       and said it over the one piece of work that never reached the server. */
    el.textContent = `⚠ ${held.length} local ${held.length === 1 ? 'copy' : 'copies'} kept`;
    el.title = syncHeldNote(held);
  } else if (n) {
    el.textContent = `→ ${n} to sync`;
    el.title = 'Saved here, waiting to be sent.';
  } else {
    el.textContent = '✓ Synced';
    el.title = 'Every case on this device is also on the server.';
  }
}

async function syncRefreshNow() {
  if (!syncSignedIn() || !window.SurveyAuth) return;

  try {
    await syncPull({ full: true });
  } catch (error) {
    if (error && (error.status === 403 || error.status === 400)) {
      SYNC.denied = error.message || 'The server would not let this account read the register.';
    } else {
      SYNC.waiting = true;
    }
  }

  try {
    await syncFlush({ retry: true });
  } catch {
    SYNC.waiting = true;
  }

  syncPaint();
}

function syncSchedule(delay = 5000) {
  clearTimeout(SYNC.timer);
  SYNC.timer = setTimeout(() => {
    if (syncSignedIn()) syncRefreshNow();
  }, delay);
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

/* `retry` marks the moments when the server's answer may genuinely have changed — a session starting, a
   person asking — and a case refused earlier is then offered again. The timed flushes do not retry,
   because a refusal will not soften by being asked about every half minute. */
async function syncFlush({ retry = false } = {}) {
  if (!syncSignedIn() || SYNC.busy || !window.SurveyAuth) return;
  const request = (path, options) => window.SurveyAuth.request(path, options);
  clearTimeout(SYNC.timer);

  const queue = syncQueue(),
    was = syncBlockedMap(),
    send = queue.edit.concat(retry ? queue.refused : []);
  if (!send.length && !queue.remove.length) {
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

  let newlyRefused = 0;
  for (const id of send) {
    const body = DB[id];
    if (!body) {
      syncUnblock(id);
      continue;
    }
    try {
      await request(`/api/cases/${encodeURIComponent(id)}`, { method: 'PUT', body });
      syncRecordSent(id, body.u);
      syncUnblock(id);
      /* The register now holds this device's work, which is what the held notice was about. */
      syncUnhold(id);
    } catch (error) {
      if (error.code === 'case_conflict') {
        syncRescue(id, body);
        /* Marking it sent is what stops the same older copy being pushed again on every retry; the
           version that won is then fetched so the two devices agree from here on. */
        syncRecordSent(id, error.serverModifiedAt ? Date.parse(error.serverModifiedAt) : body.u);
        syncUnblock(id);
        await syncTake(id);
      } else if (error.status === 403 || error.status === 400) {
        /* The register does not hold this case and will not take it from this device, so nothing has
           been sent — and the stamp that says it has is the one thing that must not be written here.
           The case keeps its place, on this device, with the server's reason kept beside it. */
        syncBlock(id, error);
        if (!was[id]) newlyRefused += 1;
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
  if (newlyRefused && window.toast)
    window.toast(
      `${newlyRefused} case${newlyRefused === 1 ? '' : 's'} on this device could not be sent to the server — see the sync status at the top`,
      '⚠ '
    );
  syncPaint();
  const left = syncQueue();
  if (left.edit.length || left.remove.length || syncSignedIn()) syncSchedule(30000);
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
    const clean = incoming && typeof incoming === 'object' ? incoming : {};
    clean.f = clean.f || {};
    clean.x = clean.x || {};
    clean.b = clean.b || { a: [], b: [] };
    clean.tps = Array.isArray(clean.tps) ? clean.tps : [];
    clean.hist = Array.isArray(clean.hist)
      ? clean.hist
      : [{ s: clean.st || 'Intimation', t: clean.cr || Date.now() }];
    if (!mine || stampOf(incoming) >= stampOf(mine)) {
      DB[id] = clean;
      ST.s('sp.db', JSON.stringify(DB));
      syncRecordSent(id, clean.u);
      if (cur === id) load(id);
      else if (window.drawDash) drawDash();
    }
  } catch {
    /* A pull that failed changes nothing; the local copy is already correct for this device. */
  }
}

/* What the register said this account may see, for as long as this page holds that session.
   Only a full pull answers it: a differential one lists what changed, not what is allowed.

   The screen that scopes a Staff account to its own cases used to decide that from the name written
   in the case's surveyor box. The server decides it from three facts — the case was opened by this
   account, this account's name is the one it was assigned to, or somebody handed this account a task
   on it — and the third of those is nowhere in the case at all. So a staff member whose work had been
   handed to them in the Assignments screen received the rows from the register, stored them, and then
   drew an empty dashboard over them. Keeping the server's answer is smaller than teaching the browser
   to reason about tasks, and it cannot leak: these ids are only ever what this account was told. */
let SYNC_SCOPE = { user: '', ids: [] };

function syncScopeOf(rows) {
  const auth = window.SurveyAuth && window.SurveyAuth.readAuth();
  SYNC_SCOPE = { user: (auth && auth.user && auth.user.id) || '', ids: rows.map((row) => row.id) };
}

/* Belongs to this session's account because the register handed it over. */
function syncScoped(id) {
  return SYNC_SCOPE.ids.indexOf(id) >= 0;
}

/* `full` asks the register for every case this account may see rather than only the ones touched
   since this device last spoke to it. The watermark is worth trusting inside one working session, and
   is not worth trusting across two: it quietly assumes this device already holds every case older than
   the last contact, and that is untrue on a computer that was switched off when the case was opened,
   on a shared computer where somebody else has since signed in, and on a case this device was once
   told no about. In all three the answer used to be "nothing to bring down", the dashboard stayed as
   it was, and the label still read Synced. */
async function syncPull({ full = false } = {}) {
  const since = full ? '' : ST.g(SYNC_SINCE);
  const query = since ? `?payload=1&since=${encodeURIComponent(since)}` : '?payload=1';
  const payload = await window.SurveyAuth.request(`/api/cases${query}`);
  const rows = Array.isArray(payload.cases) ? payload.cases : [];
  if (full) syncScopeOf(rows);
  const queue = syncQueue(),
    neverSent = queue.edit.concat(queue.refused),
    serverIds = new Set(rows.map((row) => row.id));

  /* A case that is still on this device but does not appear in the server's current list is a delete
     from the shared source of truth, unless it is still queued as a local creation or a local edit the
     device has not been able to send. Local-only work stays on device so the surveyor can keep it and
     send it later; server-side deletion should not come back on refresh. */
  const toRemove = Object.keys(DB).filter((id) => {
    if (serverIds.has(id)) return false;
    if (queue.edit.includes(id) || queue.refused.includes(id) || queue.remove.includes(id))
      return false;
    return true;
  });
  if (toRemove.length) {
    toRemove.forEach((id) => {
      delete DB[id];
      if (cur === id) cur = null;
    });
  }

  /* Which of this device's cases the register has never accepted, read before anything is overwritten.

     Two shapes put a case in that list while the register still wins the date: the ordinary one, where
     the same case was worked on two computers and the other one sent first, and the one that was
     never meant to happen — the build fixed in #132 re-stamped a case every time it was opened, so the
     register could hold a row dated after a surveyor's own copy while holding fewer answers than it.
     Comparing dates alone then buried that afternoon of work: the audit trail kept the write but no
     version of the answers, so nothing on either side of the network could have shown it or brought it
     back. Both shapes now keep what they displaced. */
  let changed = 0;
  if (toRemove.length) changed += toRemove.length;
  rows.forEach((row) => {
    const incoming = row.payload;
    if (!incoming) return;
    /* Anything this device still holds that is at least as recent is already the newer version — and
       a case waiting to be pushed has the same stamp as the register's copy only because the register
       is about to be told, not because somebody else wrote it. */
    const mine = DB[row.id];
    if (mine && stampOf(mine) >= stampOf(incoming)) return;
    /* The register's date still wins, and that is right: ours would be refused on every push while
       its own is later, so putting ours on screen instead would lock this case out of syncing for
       good. What changes is that the copy giving way is kept and said out loud rather than dropped —
       syncRescue() stores it here, and syncHold() keeps the notice up until a save from this device
       puts those answers back on the register. */
    if (mine && neverSent.indexOf(row.id) >= 0) {
      syncRescue(row.id, mine);
      syncHold(row.id);
    }
    const clean = incoming && typeof incoming === 'object' ? incoming : {};
    clean.f = clean.f || {};
    clean.x = clean.x || {};
    clean.b = clean.b || { a: [], b: [] };
    clean.tps = Array.isArray(clean.tps) ? clean.tps : [];
    clean.hist = Array.isArray(clean.hist)
      ? clean.hist
      : [{ s: clean.st || 'Intimation', t: clean.cr || Date.now() }];
    DB[row.id] = clean;
    syncRecordSent(row.id, clean.u);
    changed += 1;
  });
  if (changed) ST.s('sp.db', JSON.stringify(DB));
  if (payload.serverTime) ST.s(SYNC_SINCE, payload.serverTime);
  if (changed && cur && !DB[cur]) {
    if (Object.keys(DB).length) {
      cur = Object.keys(DB)[0];
      load(cur);
    } else {
      cur = null;
      if (typeof window.showDash === 'function') window.showDash();
    }
  }
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
  SYNC.denied = '';
  syncPaint();
  let changed = 0;
  try {
    changed = await syncPull({ full: true });
  } catch (error) {
    /* A refusal to read the register is not a lost connection, and the two need different answers: one
       is worth waiting for, the other is a conversation with an administrator. */
    if (error && (error.status === 403 || error.status === 400))
      SYNC.denied = error.message || 'The server would not let this account read the register.';
    else SYNC.waiting = true;
  }
  SYNC.busy = false;
  /* Sending follows reading, but it is not gated on it. A device whose account may file cases but not
     browse the register still has to get its own cases onto the server, and until now a pull that was
     refused stopped every push behind it, so a whole computer's work never left that computer. */
  try {
    /* A session is where an administrator's decision can arrive, so a case this device was told no
       about is offered again here rather than on a timer. */
    await syncFlush({ retry: true });
  } catch {
    SYNC.waiting = true;
  }
  syncPaint();
  /* The screens were first drawn from whatever this device held, before the register had answered. A
     full pull can change what belongs on them without changing a single case, because for a scoped
     account the answer itself is the list — so the answer alone is a reason to draw again. */
  if (changed || SYNC_SCOPE.ids.length) {
    if (cur && DB[cur]) load(cur);
    else if (window.drawDash) drawDash();
  }
  const left = syncQueue();
  if (syncSignedIn()) syncSchedule(20000);
  else if (left.edit.length || left.remove.length) syncSchedule(20000);
}

addEventListener('online', () => syncSchedule(500));
addEventListener('offline', syncPaint);
window.addEventListener('focus', () => {
  if (syncSignedIn()) syncSchedule(500);
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && syncSignedIn()) syncSchedule(500);
});

window.syncSchedule = syncSchedule;
window.syncSessionReady = syncSessionReady;
window.syncScoped = syncScoped;
