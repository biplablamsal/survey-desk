/* Where the person was, so that a refresh does not send them back to the beginning
   Loaded as a classic script: everything here shares the global scope. Order of <script> tags in index.html matters. */

/* This app has no router: a screen is a function that paints over #dash and says so by setting `view`.
   Nothing in the address bar records that choice, so it survived neither a reload nor the Google round
   trip, and every way into a session ended at window.showDash() in auth.js. What is stored here is the
   one fact the screens already announce — which function painted, and what it was pointed at — written
   under the signed-in user's id so a second account on the same browser does not open in somebody
   else's case.

   It is a memory rather than a state machine: nothing consults it while the app is running, and a place
   that cannot be honoured falls back to the dashboard instead of inventing a screen. The case list,
   the section rail and the document and task tabs are all reached through the functions recorded here,
   so every route into a screen — a sidebar click, a notification, a card — writes the same note without
   being asked to. */

const PLACE_KEY = 'sp.place';

const placeUserId = () => {
  const user = getCurrentAuthUser();
  return user && user.id ? String(user.id) : '';
};

/* The screens keep their own state and set `view` as they paint, so the writer reads that state rather
   than being told what each of them decided; the account page, which has no state of its own, passes
   the section it was asked for. */
function currentPlace() {
  const place = { v: view || 'dash' };
  /* Which saved view of the case list is on screen. The page keeps that in sessionStorage as well, but
     the store is empty in a newly opened tab or a cold PWA start, and the view is part of where the
     person was standing. */
  if (view === 'cases') place.view = allCasesState.view;
  if (view === 'case') {
    place.caseId = cur || '';
    place.sec = sec;
  }
  if (view === 'comments') place.caseId = cmState.caseId || cur || '';
  if (view === 'documents') {
    place.tab = dvState.tab;
    if (dvState.tab === 'case') place.caseId = dvState.caseId || cur || '';
  }
  if (view === 'tasks') place.tab = tkState.tab;
  return place;
}

function rememberPlace(extra) {
  const by = placeUserId();
  /* Nothing to remember without a session: a place painted by a guest is not one anybody can be
     returned to, and writing it would leave it for whoever signs in next. */
  if (!by) return;
  const note = extra || {};
  /* A caller that names a screen other than the one still recorded in `view` — the profile sections
     share showProfilePage and set no view of their own — wants that screen remembered, not whatever
     was on screen a moment ago, so the previous screen's case and section are dropped rather than
     carried into this place. */
  const place = note.v && note.v !== view ? { v: note.v } : currentPlace();
  ST.s(PLACE_KEY, JSON.stringify(Object.assign(place, note, { by })));
}

function readPlace() {
  const by = placeUserId();
  if (!by) return null;
  let place = null;
  try {
    place = JSON.parse(ST.g(PLACE_KEY) || 'null');
  } catch {
    return null;
  }
  if (!place || place.by !== by || typeof place.v !== 'string') return null;
  return place;
}

/* Called once, by auth.js, where showDash() used to be called unconditionally. */
function resumeApp() {
  const place = readPlace();
  if (!place) return showDash();
  if (place.v === 'cases') {
    if (place.view) allCasesState.view = place.view;
    showAllCases();
    /* The four Case operations shortcuts and All cases paint the same screen, so the screen cannot say
       which entry was pressed; acView() falls back to the first view for a key this build does not
       have, and the sidebar lights whatever the page ended up showing. */
    const op = OP_VIEWS.find(([, k]) => k === allCasesState.view);
    setMenu(op ? op[0] : 'mc');
    return;
  }
  if (place.v === 'page') return showInsurerMaster();
  if (place.v === 'account') return showProfilePage(place.section || 'profile');
  if (place.v === 'tasks') return showTasks({ tab: place.tab });
  /* The tab is not checked here: showDocuments drops one this account cannot ask for and showTasks
     maps an unknown one onto a scope the server will answer, which is the same correction they already
     make for a state left over from an earlier screen in this page load. */
  if (place.v === 'documents') return showDocuments({ tab: place.tab, caseId: place.caseId });
  if (place.v === 'case') {
    if (!place.caseId || !DB[place.caseId]) return showDash();
    openCase(place.caseId);
    /* The section list is built when the case is loaded — NAV is empty until syncNav() has run — so
       the remembered section is checked after openCase, not before, and only a section this case's
       module actually has is applied. These are the same three steps acOpen() takes from a directory
       deep link, with the case already open. */
    if (place.sec && NAV.some((s) => s.k === place.sec)) {
      sec = place.sec;
      /* render() repaints and records, so the note says the section that is now on screen rather than
         the first page openCase() opened it on. */
      render();
    }
    return;
  }
  if (place.v === 'comments') {
    if (place.caseId && DB[place.caseId]) return showComments({ caseId: place.caseId });
    return showDash();
  }
  return showDash();
}
