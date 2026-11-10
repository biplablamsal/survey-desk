/* All Cases directory: header, KPI cards, search, quick and advanced filters, saved views,
   sortable sticky table, pagination, row actions and CSV export.
   Loaded as a classic script (after 20-quick-capture.js). Everything it needs already exists:
   caseDirectoryRows()/vc()/act()/pend()/dl()/pri()/chip()/STG/STC/NXT from 08-11, openCase()/
   openNew()/showAllCases(), delBtn(), NIA_NONLIFE/niq()/ns() from insurers-nepal.js.
   Cases live in the browser store (sp.db) — there is no case API in server.js, so filtering and
   paging run over the full local set, never over one page of records. */

const AC_DEF = () => ({
    q: '',
    stage: 'all',
    type: 'all',
    ins: '',
    owner: 'all',
    from: '',
    to: '',
    view: 'all',
    sortK: 'priority',
    sortD: 1,
    page: 1,
    per: 25,
    xInsp: '',
    xDoc: '',
    xRep: '',
    xDl: '',
    xLoc: '',
    xMk: '',
    xAssess: '',
    xMin: '',
    xMax: '',
    cols: {},
  }),
  AC_KEYS = [
    'q',
    'stage',
    'type',
    'ins',
    'owner',
    'from',
    'to',
    'xInsp',
    'xDoc',
    'xRep',
    'xDl',
    'xLoc',
    'xMk',
    'xAssess',
    'xMin',
    'xMax',
  ];

let allCasesState = (() => {
  const d = AC_DEF();
  try {
    const s = JSON.parse(sessionStorage.getItem('sp.ac') || 'null');
    if (s && typeof s === 'object') Object.assign(d, s, { cols: Object.assign({}, s.cols) });
  } catch {
    /* a corrupt or unavailable session store must not stop the page opening */
  }
  d.page = 1;
  return d;
})();

const acPersist = () => {
  try {
    sessionStorage.setItem('sp.ac', JSON.stringify(allCasesState));
  } catch {}
};

/* Saved views and KPI cards share their predicates, so a count and its filter can never drift. */
const AC_VIEWS = [
  { k: 'all', t: 'All Cases', f: () => true },
  { k: 'active', t: 'Active', f: (r) => act(r.c), kpi: 1 },
  {
    k: 'od',
    t: 'Overdue',
    f: (r) => act(r.c) && (r.P.od || r.F.od),
  },
  {
    k: 'soon',
    t: 'Due soon',
    f: (r) =>
      act(r.c) &&
      ((pend(r.c, 'p') && !r.P.od && r.P.left != null && r.P.left <= 3) ||
        (pend(r.c, 'f') && !r.F.od && r.F.left != null && r.F.left <= 3)),
  },
  { k: 'mine', t: 'My Cases', f: (r) => isMine(r.c), hideStaff: 1 },
  { k: 'unassigned', t: 'Unassigned', f: (r) => !r.c.owner },
  { k: 'insp', t: 'Inspections Pending', f: (r) => r.insp !== 'done' && act(r.c) },
  { k: 'docs', t: 'Documents Pending', f: (r) => r.c.st === 'Document Collection' },
  { k: 'prelim', t: 'Preliminary Pending', f: (r) => pend(r.c, 'p') },
  { k: 'final', t: 'Final Report Pending', f: (r) => pend(r.c, 'f') },
  {
    k: 'rect',
    t: 'Rectification',
    f: (r) => r.c.st === 'Rectification' || r.c.st === 'Resubmission',
  },
  { k: 'done', t: 'Completed', f: (r) => !act(r.c) },
];

/* The nine columns the directory is built around: the designated cover photograph first, then the
   identity of the claim, the risk, the people responsible for it and where it stands. Type,
   intimation and deadline stay available in the column menu because filters and saved views use
   them, but they are off by default so the default view matches the columns below. */
const AC_COLS = [
  { k: 'cover', t: 'Cover Photograph', lock: 1, noSort: 1 },
  { k: 'id', t: 'Case Number', lock: 1 },
  { k: 'ins', t: 'Insurer' },
  { k: 'who', t: 'Insured Name' },
  { k: 'vrn', t: 'Vehicle Registration Number' },
  { k: 'acc', t: 'Accident Date' },
  { k: 'sv', t: 'Assigned Surveyor' },
  { k: 'st', t: 'Current Status' },
  { k: 'upd', t: 'Last Updated' },
  { k: 'type', t: 'Type', off: 1 },
  { k: 'ad', t: 'Intimation', off: 1 },
  { k: 'ref', t: 'Vehicle reg. / location', off: 1 },
  { k: 'dl', t: 'Deadline', off: 1 },
];

const AC_COL_BY_KEY = AC_COLS.reduce((m, c) => ((m[c.k] = c), m), {});

/* A column left off by default only disappears until the operator turns it on, so the stored
   choice always wins over the default. */
const acColOn = (k) => {
  const stored = allCasesState.cols[k];
  return stored === undefined ? !AC_COL_BY_KEY[k]?.off : !stored;
};

const AC_SORT = {
  priority: (a, b) =>
    a.pri[2] - b.pri[2] || (a.due || '9999-12-31').localeCompare(b.due || '9999-12-31'),
  id: (a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }),
  ad: (a, b) => String(a.ad).localeCompare(String(b.ad)),
  who: (a, b) => a.who.localeCompare(b.who),
  ref: (a, b) => a.ref.localeCompare(b.ref),
  vrn: (a, b) => String(a.vrn).localeCompare(String(b.vrn)),
  acc: (a, b) => String(a.acc).localeCompare(String(b.acc)),
  upd: (a, b) => (a.upd || 0) - (b.upd || 0),
  ins: (a, b) => a.ins.localeCompare(b.ins),
  type: (a, b) => a.c.mod.localeCompare(b.c.mod),
  sv: (a, b) => a.sv.localeCompare(b.sv),
  stage: (a, b) => a.stx - b.stx,
  due: (a, b) => (a.due || '9999').localeCompare(b.due || '9999'),
};

const AC_REP = [
  ['pp', 'Preliminary pending', (r) => pend(r.c, 'p')],
  ['ps', 'Preliminary submitted', (r) => !!r.c.pSub],
  ['fp', 'Final pending', (r) => pend(r.c, 'f')],
  ['fs', 'Final submitted', (r) => !!r.c.fSub],
  ['rp', 'Rectification pending', (r) => r.c.st === 'Rectification'],
  ['sp', 'Resubmission pending', (r) => r.c.st === 'Resubmission'],
];

const AC_DLV = [
  ['od', 'Overdue', (r) => act(r.c) && (r.P.od || r.F.od)],
  ['td', 'Due today', (r) => act(r.c) && (r.P.left === 0 || r.F.left === 0)],
  [
    'd7',
    'Due within 7 days',
    (r) => act(r.c) && [r.P, r.F].some((d) => d.left >= 0 && d.left <= 7),
  ],
  [
    'd15',
    'Due within 15 days',
    (r) => act(r.c) && [r.P, r.F].some((d) => d.left >= 0 && d.left <= 15),
  ],
  ['ok', 'Within deadline', (r) => act(r.c) && !r.P.od && !r.F.od],
];

/* One source for the layout tiers. The media queries in css/styles.css stop at the same widths, so
   the markup the directory builds and the CSS that shapes it can never disagree about where the
   phone layout ends and the tablet layout begins. */
const AC_BP = { phone: 860, tablet: 1080 };

const acMob = () => window.matchMedia(`(max-width: ${AC_BP.phone}px)`).matches;

/* h() forwards every key to setAttribute, and boolean attributes are present-or-absent, so a
   conditional one has to be omitted — passing null would render hidden="null" and stay on. */
const cond = (on, name) => (on ? { [name]: name } : {});

/* A chosen master label ("Nepal Insurance (NICL)") is not a substring of the recorded company
   string, so match against every name that master entry is known by. */
const acInsMatch = (recorded, query) => {
  if (!query) return true;
  const v = ns(recorded);
  const q = ns(query);
  if (v.includes(q)) return true;
  const m = NIA_NONLIFE.find((x) => ns(x.m) === q || ns(x.n) === q);
  return m ? [m.m, m.n, m.s, ...m.a].some((k) => k && v.includes(ns(k))) : false;
};

const acText = (r) =>
  [
    r.id,
    r.pol,
    r.who,
    r.ref,
    r.ins,
    r.sv,
    r.sy,
    r.mk,
    r.mdl,
    r.loc,
    r.br,
    r.vt,
    r.clt,
    r.sys,
    r.c.st,
    r.c.mod === 'property' ? 'property' : 'motor',
    r.c.owner,
    r.c.note,
  ]
    .join(' ')
    .toLowerCase();

const acView = () => AC_VIEWS.find((v) => v.k === allCasesState.view) || AC_VIEWS[0];

function acHas(r) {
  const s = allCasesState;
  if (!acView().f(r)) return false;
  if (s.stage !== 'all' && r.c.st !== s.stage) return false;
  if (s.type !== 'all' && r.c.mod !== s.type) return false;
  if (s.owner === '—') {
    if (r.c.owner) return false;
  } else if (s.owner !== 'all' && r.sv !== s.owner) return false;
  if (s.ins && !acInsMatch(r.ins, s.ins)) return false;
  if (s.from && (!r.ad || r.ad < s.from)) return false;
  if (s.to && (!r.ad || r.ad > s.to)) return false;
  if (s.xInsp && r.insp !== s.xInsp) return false;
  if (s.xDoc && r.docs !== s.xDoc) return false;
  if (s.xRep) {
    const x = AC_REP.find((y) => y[0] === s.xRep);
    if (x && !x[2](r)) return false;
  }
  if (s.xDl) {
    const x = AC_DLV.find((y) => y[0] === s.xDl);
    if (x && !x[2](r)) return false;
  }
  if (s.xLoc && !ns(r.loc).includes(ns(s.xLoc))) return false;
  if (s.xMk) {
    const q = ns(s.xMk);
    if (!ns(r.mk + ' ' + r.mdl).includes(q)) return false;
  }
  if (s.xAssess === 'done' && !r.amt) return false;
  if (s.xAssess === 'todo' && r.amt) return false;
  if (s.xMin && r.amt < Number(s.xMin)) return false;
  if (s.xMax && r.amt > Number(s.xMax)) return false;
  if (s.q) {
    const words = s.q.toLowerCase().split(/\s+/).filter(Boolean);
    const hay = acText(r);
    if (!words.every((w) => hay.includes(w))) return false;
  }
  return true;
}

function acFilterCount() {
  const s = allCasesState;
  return (
    AC_KEYS.filter((k) => {
      const v = s[k];
      if (k === 'stage' || k === 'type' || k === 'owner') return v !== 'all';
      return v !== '' && v != null;
    }).length + (s.view !== 'all' ? 1 : 0)
  );
}

function acClearAll() {
  const per = allCasesState.per;
  // Drop a debounced keystroke, otherwise it lands after the reset and silently re-adds a filter.
  clearTimeout(acDebounce);
  acPendingSet = null;
  Object.assign(allCasesState, AC_DEF(), { per });
  acRebuild();
}

/* Rows are rebuilt on every paint: the case store is local and can change while the page is open. */
function acData() {
  const rows = caseDirectoryRows();
  return {
    rows,
    hits: rows
      .filter(acHas)
      .slice()
      .sort(
        (a, b) => (AC_SORT[allCasesState.sortK] || AC_SORT.priority)(a, b) * allCasesState.sortD
      ),
    views: AC_VIEWS.filter((v) => !v.kpi && (!v.hideStaff || cfg.role !== 'Staff')).map((v) => ({
      v,
      n: rows.filter(v.f).length,
    })),
    kpi: ['all', 'active', 'od', 'soon'].map((k) => {
      const v = AC_VIEWS.find((x) => x.k === k);
      return { v, n: rows.filter(v.f).length };
    }),
  };
}

let acLast = null;

const acIcon = (d) => h('svg', { viewBox: '0 0 20 20', 'aria-hidden': 'true' }, h('path', { d }));

const AC_IC = {
  all: 'M3 4.5h14M3 10h14M3 15.5h9',
  active: 'M10 2.5a7.5 7.5 0 100 15 7.5 7.5 0 000-15zm0 3.5v4l2.6 1.6',
  od: 'M10 2.8l7 12.4H3zm0 4.3v4m0 2.2v.1',
  soon: 'M5.5 3.5h9v13h-9zm2 3h5m-5 3h5m-5 3h3',
};

function acKpis(data) {
  const tone = { all: 'pr', active: 'bl', od: 'rd', soon: 'am' };
  return h(
    'div',
    { class: 'ac2-kpi' },
    ...data.kpi.map(({ v, n }) =>
      h(
        'button',
        {
          type: 'button',
          class: 'ac2-stat ' + tone[v.k] + (allCasesState.view === v.k ? ' on' : ''),
          'aria-pressed': allCasesState.view === v.k ? 'true' : 'false',
          title: 'Filter: ' + v.t,
          onclick: () => {
            allCasesState.view = allCasesState.view === v.k ? 'all' : v.k;
            allCasesState.page = 1;
            acRefresh();
          },
        },
        h('span', { class: 'ac2-stat-ic' }, acIcon(AC_IC[v.k])),
        h('span', { class: 'ac2-stat-tx' }, h('b', {}, String(n)), h('span', {}, v.t))
      )
    )
  );
}

/* One control factory, used inline on desktop and inside the drawer on mobile, so the two
   layouts can never disagree about what a filter does. */
function acCtl(kind, inDrawer) {
  const s = allCasesState,
    set = (patch) => {
      Object.assign(s, patch, { page: 1 });
      acRefresh();
    };
  if (kind === 'stage')
    return h(
      'label',
      { class: 'ac2-fld' + (inDrawer ? ' wide' : '') },
      h('span', {}, 'Case status'),
      h(
        'select',
        {
          value: s.stage,
          onchange: (e) => set({ stage: e.target.value }),
        },
        ...['all', ...STG].map((x) =>
          h(
            'option',
            { value: x, ...cond(x === s.stage, 'selected') },
            x === 'all' ? 'Any status' : x
          )
        )
      )
    );
  if (kind === 'type')
    return h(
      'label',
      { class: 'ac2-fld' + (inDrawer ? ' wide' : '') },
      h('span', {}, 'Claim type'),
      h(
        'select',
        { value: s.type, onchange: (e) => set({ type: e.target.value }) },
        ...[
          ['all', 'Any type'],
          ['motor', 'Motor'],
          ['property', 'Property'],
        ].map(([v, t]) => h('option', { value: v, ...cond(v === s.type, 'selected') }, t))
      )
    );
  if (kind === 'owner') {
    const names = [...new Set(acLast.rows.map((r) => r.sv).filter((x) => x && x !== '—'))].sort();
    return h(
      'label',
      { class: 'ac2-fld' + (inDrawer ? ' wide' : '') },
      h('span', {}, 'Assigned surveyor'),
      h(
        'select',
        { value: s.owner, onchange: (e) => set({ owner: e.target.value }) },
        h('option', { value: 'all', ...cond(s.owner === 'all', 'selected') }, 'Any surveyor'),
        ...names.map((x) => h('option', { value: x, ...cond(x === s.owner, 'selected') }, x)),
        h('option', { value: '—', ...cond(s.owner === '—', 'selected') }, 'Unassigned')
      )
    );
  }
  if (kind === 'range')
    return h(
      'label',
      { class: 'ac2-fld ac2-range' + (inDrawer ? ' wide' : '') },
      h('span', {}, 'Intimation date'),
      h('span', { class: 'ac2-range-in' }, [
        h('input', {
          type: 'date',
          'aria-label': 'Intimation from',
          value: s.from,
          onchange: (e) => set({ from: e.target.value }),
        }),
        h('em', {}, '→'),
        h('input', {
          type: 'date',
          'aria-label': 'Intimation to',
          value: s.to,
          onchange: (e) => set({ to: e.target.value }),
        }),
      ])
    );
  if (kind === 'ins') return acCombo(inDrawer);
}

const acInsData = () => [...new Set(acLast.rows.map((r) => r.ins).filter((x) => x && x !== '—'))];

/* Searchable insurer picker: the NIA master list first, then any value already recorded on a case
   so a filter can still reach a name that is spelled differently or is out of date. */
function acCombo(inDrawer) {
  const s = allCasesState,
    listId = inDrawer ? 'ac-ins-list-d' : 'ac-ins-list',
    inpId = inDrawer ? 'ac-ins-d' : 'ac-ins',
    sel_ = { open: false, i: -1, items: [] };

  const inp = h('input', {
    id: inpId,
    type: 'text',
    role: 'combobox',
    autocomplete: 'off',
    'aria-expanded': 'false',
    'aria-controls': listId,
    'aria-autocomplete': 'list',
    placeholder: 'Type insurer, e.g. Shikhar, NLG, IGI…',
    value: s.ins,
  });

  const list = h('div', {
    id: listId,
    class: 'ac2-list',
    role: 'listbox',
    'aria-label': 'Insurer options',
    hidden: 'hidden',
  });

  const choices = (q) => {
    const hits = niq(q).map((x, i) => ({
      v: x.x.m,
      sub: x.x.n + (x.x.s ? ' · ' + x.x.s : ''),
      tag: NIA_CAT[x.x.c].t,
      r: x.rank,
      m: i === 0 && q ? 1 : 0,
    }));
    if (!q) return hits;
    const extra = acInsData()
      .filter((v) => ns(v).includes(ns(q)) && !hits.some((x) => ns(x.v).includes(ns(v))))
      .map((v) => ({ v, sub: 'Recorded on cases in this workspace', tag: 'In your data', r: 9 }));
    return [...hits, ...extra];
  };

  const paint = () => {
    const q = inp.value.trim();
    sel_.items = choices(q);
    sel_.i = -1;
    list.replaceChildren(
      ...sel_.items.map((x, i) =>
        h(
          'div',
          {
            class: 'ac2-opt' + (x.tag === 'In your data' ? ' local' : ''),
            role: 'option',
            id: listId + '-' + i,
            'aria-selected': 'false',
            onmousedown: (e) => {
              e.preventDefault();
              pick(x.v);
            },
          },
          h('b', {}, x.v),
          h('span', {}, x.sub),
          h('em', {}, x.tag)
        )
      ),
      sel_.items.length
        ? ''
        : h(
            'div',
            { class: 'ac2-opt none' },
            'No licensed insurer matches — press Enter to filter on the text you typed'
          ),
      q || !sel_.items.length
        ? ''
        : h('div', { class: 'ac2-listnote' }, 'Non-life and micro non-life licensees, NIA 2026')
    );
    move();
  };

  const open = () => {
    sel_.open = true;
    list.hidden = false;
    inp.setAttribute('aria-expanded', 'true');
    paint();
  };
  const close = () => {
    sel_.open = false;
    list.hidden = true;
    inp.setAttribute('aria-expanded', 'false');
    inp.removeAttribute('aria-activedescendant');
  };
  const mark = () => {
    [...list.children].forEach(
      (el, i) =>
        el.getAttribute &&
        el.getAttribute('role') === 'option' &&
        el.setAttribute('aria-selected', i === sel_.i ? 'true' : 'false')
    );
  };
  const move = () => {
    if (sel_.i >= 0 && list.children[sel_.i])
      inp.setAttribute('aria-activedescendant', listId + '-' + sel_.i);
    else inp.removeAttribute('aria-activedescendant');
    mark();
  };
  const pick = (v) => {
    s.ins = v;
    inp.value = v;
    clr.hidden = false;
    close();
    s.page = 1;
    acRefresh();
  };

  inp.oninput = () => {
    s.ins = inp.value.trim();
    s.page = 1;
    clr.hidden = !inp.value.trim();
    if (!sel_.open) open();
    else paint();
    acRefreshSoon();
  };
  inp.onfocus = open;
  inp.onblur = () => setTimeout(close, 120);
  inp.onkeydown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!sel_.open) return open();
      e.preventDefault();
      sel_.i =
        sel_.i < 0
          ? e.key === 'ArrowDown'
            ? 0
            : sel_.items.length - 1
          : (sel_.i + (e.key === 'ArrowDown' ? 1 : -1) + sel_.items.length) % sel_.items.length;
      move();
      const el = list.children[sel_.i];
      if (el) el.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (sel_.open && sel_.i >= 0 && sel_.items[sel_.i]) pick(sel_.items[sel_.i].v);
      else {
        s.ins = inp.value.trim();
        clr.hidden = !s.ins;
        close();
        s.page = 1;
        acRefresh();
      }
    } else if (e.key === 'Escape') {
      close();
    }
  };

  const clr = h(
    'button',
    {
      type: 'button',
      class: 'ac2-x',
      title: 'Clear insurer filter',
      'aria-label': 'Clear insurer filter',
      ...cond(!s.ins, 'hidden'),
      onclick: () => {
        s.ins = '';
        inp.value = '';
        acRefresh();
      },
    },
    '×'
  );

  return h(
    'label',
    { class: 'ac2-fld ac2-combo' + (inDrawer ? ' wide' : '') },
    h('span', {}, 'Insurer'),
    h('span', { class: 'ac2-combo-wrap' }, inp, clr, list)
  );
}

let acDebounce;
let acPendingSet = null;
const acRefreshSoon = () => {
  clearTimeout(acDebounce);
  acDebounce = setTimeout(acRefresh, 200);
};

function acSearch() {
  const s = allCasesState;
  /* A phone shows only the first few words of the desktop hint, which reads as a truncated
     interface rather than a hint, and the "/" shortcut does not exist without a keyboard — so the
     narrow layout gets a short placeholder and no key chip instead of CSS shrinking them. */
  const mob = acMob();
  /* At 320px the field shares its row with Filters and only ~80px of text space is left after the
     icon and clear-button padding, so even "Search cases…" is cut off — the shortest hint fits. */
  const tiny = window.matchMedia('(max-width: 360px)').matches;
  const inp = h('input', {
    id: 'ac-q',
    type: 'search',
    role: 'searchbox',
    'aria-label': 'Search all cases',
    placeholder: tiny
      ? 'Search…'
      : mob
        ? 'Search cases…'
        : 'Search claim no., policy no., insured, vehicle reg., insurer, surveyor, garage, location…',
    value: s.q,
    oninput: (e) => {
      s.q = e.target.value;
      clrS.hidden = !s.q.trim();
      s.page = 1;
      acRefreshSoon();
    },
    onkeydown: (e) => {
      if (e.key === 'Escape') {
        s.q = '';
        e.target.value = '';
        acRefresh();
      }
    },
  });
  const clrS = h(
    'button',
    {
      type: 'button',
      class: 'ac2-x',
      'aria-label': 'Clear search',
      ...cond(!s.q, 'hidden'),
      onclick: () => {
        s.q = '';
        inp.value = '';
        inp.focus();
        acRefresh();
      },
    },
    '×'
  );
  return h(
    'div',
    { class: 'ac2-search' + (mob ? ' is-mob' : '') },
    acIcon(
      'M9 2.5a6.5 6.5 0 015 10.6l4.4 4.4-1.4 1.4-4.4-4.4A6.5 6.5 0 119 2.5zm0 2a4.5 4.5 0 100 9 4.5 4.5 0 000-9z'
    ),
    inp,
    mob ? null : h('kbd', { 'aria-hidden': 'true', title: 'Press / to search' }, '/'),
    clrS
  );
}

function acQuickBar() {
  const mob = acMob();
  return h(
    'div',
    { class: 'ac2-quick' },
    ...(mob
      ? [
          h(
            'button',
            {
              type: 'button',
              class: 'b ac2-filterbtn',
              'aria-haspopup': 'dialog',
              onclick: acOpenDrawer,
            },
            'Filters',
            h('span', { class: 'ac2-badge' }, String(acFilterCount()))
          ),
        ]
      : [
          acCtl('stage'),
          acCtl('type'),
          acCtl('ins'),
          acCtl('owner'),
          acCtl('range'),
          h(
            'button',
            { type: 'button', class: 'b', 'aria-haspopup': 'dialog', onclick: acOpenDrawer },
            'Advanced filters',
            h('span', { class: 'ac2-badge' }, String(acFilterCount()))
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'b',
              ...cond(!acFilterCount(), 'disabled'),
              onclick: acClearAll,
            },
            'Clear all'
          ),
        ])
  );
}

function acViews(data) {
  const strip = h(
    'div',
    { class: 'ac2-views', role: 'tablist', 'aria-label': 'Saved case views' },
    ...data.views.map(({ v, n }) =>
      h(
        'button',
        {
          type: 'button',
          role: 'tab',
          class: 'ac2-chip' + (allCasesState.view === v.k ? ' on' : ''),
          'aria-selected': allCasesState.view === v.k ? 'true' : 'false',
          onclick: () => {
            allCasesState.view = v.k;
            allCasesState.page = 1;
            acRefresh();
          },
        },
        v.t,
        h('b', {}, String(n))
      )
    )
  );
  /* The active view is picked out of the strip the moment it is drawn: a view chosen from a KPI card
     or a keyboard shortcut can well be off-screen in a strip narrower than its own content, and a
     tab the user cannot see is not a tab they can trust as current. */
  setTimeout(() => {
    const on = strip.querySelector('.ac2-chip.on');
    if (!on) return;
    const sr = strip.getBoundingClientRect(),
      cr = on.getBoundingClientRect();
    if (cr.right > sr.right || cr.left < sr.left) strip.scrollLeft += cr.left - sr.left - 8;
  }, 0);
  return strip;
}

function acDeadlineCell(r) {
  return h(
    'div',
    { class: 'ac2-dl' },
    h('span', { class: 'ac2-dlrow' }, h('i', {}, 'P'), chip(r.P)),
    h('span', { class: 'ac2-dlrow' }, h('i', {}, 'F'), chip(r.F))
  );
}

function acDots(r) {
  return h(
    'button',
    {
      type: 'button',
      class: 'ac2-dots',
      'aria-haspopup': 'menu',
      'aria-expanded': 'false',
      'aria-label': 'Actions for ' + r.id,
      onclick: (e) => {
        e.stopPropagation();
        acMenu(e.currentTarget, r);
      },
    },
    '⋮'
  );
}

function acRow(r) {
  const s = allCasesState,
    i = r.stx,
    show = acColOn;
  const cells = [];
  if (show('cover')) cells.push(h('td', { class: 'c-cov' }, coverThumb(r.c.id, r.id)));
  if (show('id'))
    cells.push(h('td', { class: 'c-id' }, h('b', {}, r.id), h('span', { class: 'mu' }, r.pol)));
  if (show('ins')) cells.push(h('td', { class: 'c-ins' }, r.ins));
  if (show('who')) cells.push(h('td', {}, r.who));
  if (show('vrn')) cells.push(h('td', { class: 'c-ref' }, r.vrn));
  if (show('acc')) cells.push(h('td', {}, r.acc ? dtf(r.acc) : '—'));
  if (show('sv')) cells.push(h('td', {}, r.sv));
  if (show('st'))
    cells.push(
      h(
        'td',
        {},
        h('span', { class: 'pill ac2-stage', style: 'color:' + (STC[i] || '#64748b') }, r.c.st)
      )
    );
  if (show('upd')) cells.push(h('td', {}, r.upd ? new Date(r.upd).toLocaleDateString() : '—'));
  if (show('type'))
    cells.push(
      h(
        'td',
        {},
        h('span', { class: 'ac2-tag ' + r.c.mod }, r.c.mod === 'property' ? 'Property' : 'Motor')
      )
    );
  if (show('ad')) cells.push(h('td', {}, r.ad ? dtf(r.ad) : '—'));
  if (show('ref')) cells.push(h('td', { class: 'c-ref' }, r.ref));
  if (show('dl')) cells.push(h('td', {}, acDeadlineCell(r)));
  cells.push(h('td', { class: 'c-act' }, acDots(r)));
  return h(
    'tr',
    {
      class: 'rw',
      tabindex: '0',
      onclick: () => acOpen(r.c.id, 'case'),
      onkeydown: (e) => {
        if (e.key === 'Enter') acOpen(r.c.id, 'case');
      },
    },
    ...cells
  );
}

function acTable(hits) {
  const s = allCasesState,
    cols = AC_COLS.filter((c) => acColOn(c.k));
  return h(
    'div',
    { class: 'ac2-scroll' },
    h(
      'table',
      { class: 'at ac2-tbl' },
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          ...cols.map((c) =>
            h(
              'th',
              {
                scope: 'col',
                'aria-sort': c.noSort
                  ? undefined
                  : s.sortK === c.k
                    ? s.sortD === 1
                      ? 'ascending'
                      : 'descending'
                    : 'none',
                onclick: c.noSort
                  ? null
                  : () => {
                      if (s.sortK === c.k) s.sortD = -s.sortD;
                      else {
                        s.sortK = c.k;
                        s.sortD = 1;
                      }
                      acRefresh();
                    },
              },
              h('span', {}, c.t),
              c.noSort
                ? null
                : h(
                    'i',
                    { 'aria-hidden': 'true' },
                    s.sortK === c.k ? (s.sortD === 1 ? '▲' : '▼') : '↕'
                  )
            )
          ),
          h('th', { scope: 'col', class: 'c-act' }, '')
        )
      ),
      h('tbody', {}, ...hits.map(acRow))
    )
  );
}

/* Phone layout: one card per case, split half cover photograph / half record. The photo is what a
   surveyor recognises a vehicle by in the field, so it gets its own column instead of a 56px chip in
   the header; the other column carries every field the desktop table shows, and a value that is
   genuinely absent reads as a missing record instead of an unexplained dash. */
const acPh = (t) => h('span', { class: 'ac2-ph' }, t);

function acRepCell(d) {
  return h(
    'span',
    { class: 'ac2-card-rep' },
    chip(d),
    d.due ? h('em', {}, 'due ' + dtf(d.due)) : null
  );
}

function acCard(r, open) {
  const col = STC[r.stx] || '#64748b';
  return h(
    'li',
    {
      class: 'ac2-card',
      style: '--c:' + col,
      tabindex: '0',
      onclick: () => open(r.c.id),
      onkeydown: (e) => {
        if (e.key === 'Enter') open(r.c.id);
      },
    },
    /* The cover keeps its column down to the report deadlines: a bounded thumbnail over the full
       height of the record beside it left nothing under it but whitespace. */
    h(
      'div',
      { class: 'ac2-card-cov' },
      coverThumb(r.c.id, r.id, 'cov-lg'),
      h(
        'dl',
        { class: 'ac2-card-facts ac2-card-reps' },
        h('dt', {}, 'Preliminary report'),
        h('dd', {}, acRepCell(r.P)),
        h('dt', {}, 'Final report'),
        h('dd', {}, acRepCell(r.F))
      )
    ),
    h(
      'div',
      { class: 'ac2-card-main' },
      h(
        'div',
        { class: 'ac2-card-h' },
        h(
          'div',
          { class: 'ac2-card-t' },
          h('b', { class: 'ac2-card-no' }, r.id),
          h('span', { class: 'pill ac2-stage', style: 'color:' + col }, r.c.st)
        ),
        acDots(r)
      ),
      h(
        'dl',
        { class: 'ac2-card-facts' },
        h('dt', {}, 'Insured name'),
        h('dd', {}, r.who === '—' ? acPh('Not recorded') : r.who),
        h('dt', {}, 'Vehicle reg. no.'),
        h(
          'dd',
          {},
          r.vrn === '—'
            ? acPh(r.c.mod === 'property' ? 'Not applicable — property claim' : 'Not recorded')
            : r.vrn
        ),
        h('dt', {}, 'Insurer'),
        h('dd', {}, r.ins === '—' ? acPh('Insurer not recorded') : r.ins),
        h('dt', {}, 'Accident date'),
        h('dd', {}, r.acc ? dtf(r.acc) : acPh('No accident date recorded')),
        h('dt', {}, 'Assigned surveyor'),
        h('dd', {}, r.sv === '—' ? acPh('Unassigned') : r.sv),
        h('dt', {}, 'Intimation date'),
        h('dd', {}, r.ad ? dtf(r.ad) : acPh('Not recorded'))
      )
    )
  );
}

function acList(hits) {
  return h('ul', { class: 'ac2-cards' }, ...hits.map((r) => acCard(r, (id) => acOpen(id, 'case'))));
}

function acPager(data, hits) {
  const s = allCasesState,
    pages = Math.max(1, Math.ceil(hits.length / s.per)),
    win = [];
  for (let p = 1; p <= pages; p++)
    if (p === 1 || p === pages || Math.abs(p - s.page) <= 1) win.push(p);
  const nums = [];
  let prev = 0;
  win.forEach((p) => {
    if (prev && p - prev > 1) nums.push(h('span', { class: 'ac2-ell' }, '…'));
    nums.push(
      h(
        'button',
        {
          type: 'button',
          class: 'ac2-pg' + (p === s.page ? ' on' : ''),
          ...(p === s.page ? { 'aria-current': 'page' } : {}),
          onclick: () => {
            s.page = p;
            acRefresh();
          },
        },
        String(p)
      )
    );
    prev = p;
  });
  return h(
    'div',
    { class: 'ac2-foot' },
    h(
      'span',
      { class: 'mu', 'aria-live': 'polite' },
      hits.length
        ? `Showing ${(s.page - 1) * s.per + 1}–${Math.min(s.page * s.per, hits.length)} of ${hits.length}` +
            (acFilterCount() || s.view !== 'all' ? ` filtered from ${data.rows.length}` : '')
        : `0 of ${data.rows.length} cases`
    ),
    h(
      'label',
      { class: 'ac2-per' },
      'Rows',
      h(
        'select',
        {
          value: String(s.per),
          onchange: (e) => {
            s.per = Number(e.target.value);
            s.page = 1;
            acRefresh();
          },
        },
        ...[10, 25, 50, 100].map((n) =>
          h('option', { value: n, ...cond(n === s.per, 'selected') }, String(n))
        )
      )
    ),
    h(
      'div',
      { class: 'ac2-pgs' },
      h(
        'button',
        {
          type: 'button',
          class: 'b',
          ...cond(s.page <= 1, 'disabled'),
          onclick: () => {
            s.page--;
            acRefresh();
          },
        },
        '← Prev'
      ),
      ...nums,
      h(
        'button',
        {
          type: 'button',
          class: 'b',
          ...cond(s.page >= pages, 'disabled'),
          onclick: () => {
            s.page++;
            acRefresh();
          },
        },
        'Next →'
      )
    )
  );
}

const acColPop = { el: null };

function acClosePops() {
  if (acColPop.el) {
    acColPop.el.remove();
    acColPop.el = null;
  }
  document.querySelectorAll('.ac2-menu').forEach((x) => x.remove());
  document.querySelectorAll('[aria-expanded="true"]').forEach((x) => {
    if (x.classList.contains('ac2-dots') || x.classList.contains('ac2-colbtn'))
      x.setAttribute('aria-expanded', 'false');
  });
}

/* Both popovers — the Columns picker and the row/card action menu — dismiss on a click outside
   them. Only the Columns picker had this listener, so a menu opened on a phone stayed over the
   list until its own button was tapped again. */
addEventListener('click', (e) => {
  const t = e.target;
  if (!(t instanceof Element)) return;
  if (t.closest('.ac2-menu') || t.closest('.ac2-colbtn') || t.closest('.ac2-dots')) return;
  acClosePops();
});

function acColumnsBtn() {
  return h(
    'button',
    {
      type: 'button',
      class: 'b ac2-colbtn',
      'aria-haspopup': 'true',
      'aria-expanded': 'false',
      onclick: (e) => {
        const was = !!acColPop.el;
        acClosePops();
        if (was) return;
        const box = h(
          'div',
          { class: 'ac2-menu ac2-cols', role: 'group', 'aria-label': 'Table columns' },
          ...AC_COLS.filter((c) => !c.lock).map((c) =>
            h(
              'label',
              { class: 'ac2-colrow' },
              h('input', {
                type: 'checkbox',
                ...cond(acColOn(c.k), 'checked'),
                onchange: (ev) => {
                  /* Both directions are stored explicitly: a column that is off by default must
                     remember being switched on, and one that is on by default must remember being
                     switched off. */
                  allCasesState.cols[c.k] = ev.target.checked ? 0 : 1;
                  acRefresh();
                },
              }),
              c.t
            )
          ),
          h('p', { class: 'mu' }, 'Cover photograph and case number are always shown.')
        );
        e.currentTarget.parentElement.append(box);
        acColPop.el = box;
        e.currentTarget.setAttribute('aria-expanded', 'true');
      },
    },
    'Columns'
  );
}

function acMenu(btn, r) {
  const wasOpen = btn.getAttribute('aria-expanded') === 'true';
  acClosePops();
  if (wasOpen) return;
  const keys = (MODS[r.c.mod].ALL || []).map((s) => s.k),
    go = (k) => {
      acClosePops();
      acOpen(r.c.id, k);
    },
    items = [
      h(
        'button',
        { type: 'button', role: 'menuitem', onclick: () => go('report') },
        'View case summary'
      ),
      h('button', { type: 'button', role: 'menuitem', onclick: () => go('case') }, 'Edit details'),
    ];
  if (keys.includes('photos'))
    items.push(
      h(
        'button',
        { type: 'button', role: 'menuitem', onclick: () => go('photos') },
        'Upload photos / documents'
      )
    );
  if (keys.includes('prelim'))
    items.push(
      h(
        'button',
        {
          type: 'button',
          role: 'menuitem',
          ...cond(r.c.pSub, 'disabled'),
          onclick: () => go('prelim'),
        },
        r.c.pSub ? 'Preliminary submitted' : 'Preliminary report'
      )
    );
  if (keys.includes('final'))
    items.push(
      h(
        'button',
        { type: 'button', role: 'menuitem', onclick: () => go('final') },
        r.c.fSub ? 'Final report submitted' : 'Final report'
      )
    );
  if (cfg.role !== 'Staff') {
    items.push(
      h(
        'button',
        { type: 'button', role: 'menuitem', onclick: () => acAssign(r) },
        'Assign surveyor'
      )
    );
    items.push(delBtn(r.c));
  }
  const pop = h('div', { class: 'ac2-menu', role: 'menu' }, ...items);
  btn.parentElement.append(pop);
  btn.setAttribute('aria-expanded', 'true');
}

function acAssign(r) {
  acClosePops();
  const dlg = h('dialog', { class: 'ac2-dlg', 'aria-labelledby': 'ac-as-t' }),
    inp = h('input', {
      type: 'text',
      maxlength: '60',
      value: r.c.owner || '',
      placeholder: 'Surveyor name',
      'aria-label': 'Assigned surveyor',
    });
  dlg.append(
    h(
      'form',
      { method: 'dialog' },
      h('h3', { id: 'ac-as-t' }, 'Assign surveyor'),
      h('p', { class: 'mu' }, r.id + ' · currently ' + r.sv),
      inp,
      h(
        'div',
        { class: 'bar' },
        h('button', { class: 'b', type: 'button', onclick: () => dlg.close() }, 'Cancel'),
        h(
          'button',
          {
            class: 'b p',
            type: 'submit',
            onclick: () => {
              r.c.owner = inp.value.trim();
              sv(1);
            },
          },
          'Save'
        )
      )
    )
  );
  document.body.append(dlg);
  dlg.addEventListener('close', () => {
    dlg.remove();
    acRefresh();
  });
  dlg.showModal();
  inp.focus();
}

const acCsv = (v) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
};

async function acExport() {
  const hits = acData().hits,
    head = [
      'Case no.',
      'Claim type',
      'Intimation date',
      'Accident date',
      'Insured',
      'Vehicle reg. no.',
      'District / place',
      'Insurer',
      'Policy no.',
      'Assigned surveyor',
      'Current status',
      'Prelim due',
      'Prelim status',
      'Final due',
      'Final status',
      'Assessed / estimated loss (NPR)',
      'Next action',
      'Last updated',
    ],
    body = hits.map((r) =>
      [
        r.id,
        r.c.mod === 'property' ? 'Property' : 'Motor',
        r.ad,
        r.acc,
        r.who,
        r.vrn,
        r.loc,
        r.ins,
        r.pol,
        r.sv,
        r.c.st,
        r.P.due,
        r.P.txt,
        r.F.due,
        r.F.txt,
        r.amt || '',
        r.c.note || NXT[r.stx] || '',
        r.upd ? new Date(r.upd).toLocaleString() : '',
      ]
        .map(acCsv)
        .join(',')
    );
  if (!body.length) return;
  const dls = await claude.use('downloads'),
    blob = new Blob(['\ufeff' + [head.map(acCsv).join(','), ...body].join('\r\n')], {
      type: 'text/csv;charset=utf-8',
    });
  dls.save({ filename: 'survey-desk-cases-' + today() + '.csv', data: blob });
}

function acResults(data) {
  const hits = data.hits,
    from = (allCasesState.page - 1) * allCasesState.per;
  const slice = hits.slice(from, from + allCasesState.per);
  /* Counted separately from the view name, because "2 of 7 cases" is the difference between a
     directory and a filtered result and the operator needs to see which one they are looking at. */
  const count =
    hits.length === data.rows.length
      ? `${hits.length} case${hits.length === 1 ? '' : 's'}`
      : `${hits.length} of ${data.rows.length} cases`;
  const head = h(
    'div',
    { class: 'ac2-reshead' },
    h(
      'div',
      { class: 'ac2-reshead-t' },
      h('strong', {}, acView().t),
      h('span', { class: 'ac2-reshead-n' }, count)
    ),
    h(
      'div',
      { class: 'ac2-reshead-a' },
      acColumnsBtn(),
      h(
        'button',
        { type: 'button', class: 'b', onclick: acExport },
        /* The long label needs two lines at 320px, which makes the row ragged; the count line
           above already says how many rows the export covers. */
        acMob() ? 'Export CSV' : 'Export filtered (CSV)'
      )
    )
  );
  if (!data.rows.length)
    return h(
      'div',
      {},
      head,
      h(
        'div',
        { class: 'ac2-state' },
        acIcon(AC_IC.all),
        h('b', {}, 'No cases yet'),
        h(
          'p',
          { class: 'mu' },
          'Create the first case to start tracking intimations, inspections and reports.'
        ),
        h('button', { class: 'b p', type: 'button', onclick: openNew }, '+ New case')
      )
    );
  if (!hits.length)
    return h(
      'div',
      {},
      head,
      h(
        'div',
        { class: 'ac2-state' },
        acIcon(
          'M9 2.5a6.5 6.5 0 015 10.6l4.4 4.4-1.4 1.4-4.4-4.4A6.5 6.5 0 119 2.5zm0 2a4.5 4.5 0 100 9 4.5 4.5 0 000-9z'
        ),
        h('b', {}, 'No cases match your search'),
        h('p', { class: 'mu' }, 'Nothing found for the current search, view and filters.'),
        h('button', { class: 'b', type: 'button', onclick: acClearAll }, 'Clear search and filters')
      )
    );
  return h('div', {}, head, acMob() ? acList(slice) : acTable(slice), acPager(data, hits));
}

const AC_ADV = [
  [
    'A. Case information',
    [
      ['xLoc', 'District / location', 'text', 'e.g. Chitwan, Birgunj'],
      ['xMk', 'Vehicle make / model', 'text', 'e.g. BMI, Toyota'],
    ],
  ],
  [
    'B. Inspection',
    [
      [
        'xInsp',
        'Inspection',
        'sel',
        [
          ['', 'Any'],
          ['pending', 'Pending'],
          ['scheduled', 'Scheduled'],
          ['done', 'Completed'],
        ],
      ],
    ],
  ],
  [
    'C. Documents',
    [
      [
        'xDoc',
        'Document collection',
        'sel',
        [
          ['', 'Any'],
          ['pending', 'Not started'],
          ['partial', 'In collection'],
          ['complete', 'Beyond collection'],
        ],
      ],
    ],
  ],
  [
    'D. Reports',
    [['xRep', 'Report status', 'sel', [['', 'Any'], ...AC_REP.map((x) => [x[0], x[1]])]]],
  ],
  ['E. Deadlines', [['xDl', 'Deadline', 'sel', [['', 'Any'], ...AC_DLV.map((x) => [x[0], x[1]])]]]],
  [
    'F. Assessment',
    [
      [
        'xAssess',
        'Assessment',
        'sel',
        [
          ['', 'Any'],
          ['done', 'Assessed'],
          ['todo', 'Assessment pending'],
        ],
      ],
      ['xMin', 'Assessed amount from (NPR)', 'num', ''],
      ['xMax', 'Assessed amount to (NPR)', 'num', ''],
    ],
  ],
];

function acDrawer() {
  const dlg = h('dialog', {
    class: 'ac2-drawer',
    id: 'ac-drawer',
    'aria-labelledby': 'ac-drawer-t',
  });
  const s = allCasesState;
  const fld = ([key, label, kind, opts]) => {
    const set = (v) => {
      s[key] = v;
      s.page = 1;
      acRefresh();
    };
    if (kind === 'sel')
      return h(
        'label',
        { class: 'ac2-fld wide' },
        h('span', {}, label),
        h(
          'select',
          { value: s[key] || '', onchange: (e) => set(e.target.value) },
          ...opts.map(([v, t]) =>
            h('option', { value: v, ...cond((s[key] || '') === v, 'selected') }, t)
          )
        )
      );
    if (kind === 'num')
      return h(
        'label',
        { class: 'ac2-fld' },
        h('span', {}, label),
        h('input', {
          type: 'number',
          min: '0',
          step: '1000',
          value: s[key] || '',
          oninput: (e) => acRefreshSoonSet(() => set(e.target.value)),
        })
      );
    return h(
      'label',
      { class: 'ac2-fld wide' },
      h('span', {}, label),
      h('input', {
        type: 'text',
        placeholder: opts || '',
        value: s[key] || '',
        oninput: (e) => acRefreshSoonSet(() => set(e.target.value)),
      })
    );
  };
  dlg.append(
    h(
      'div',
      { class: 'ac2-drawer-body' },
      h(
        'div',
        { class: 'ac2-drawer-head' },
        h('h3', { id: 'ac-drawer-t' }, 'Filters'),
        h(
          'button',
          { type: 'button', class: 'b', 'aria-label': 'Close filters', onclick: () => dlg.close() },
          'Close'
        )
      ),
      acMob()
        ? h(
            'div',
            { class: 'ac2-group' },
            h('h4', {}, 'Quick filters'),
            h(
              'div',
              { class: 'ac2-grid' },
              acCtl('stage', 1),
              acCtl('type', 1),
              acCtl('ins', 1),
              acCtl('owner', 1),
              acCtl('range', 1)
            )
          )
        : '',
      ...AC_ADV.map(([t, list]) =>
        h(
          'div',
          { class: 'ac2-group' },
          h('h4', {}, t),
          h('div', { class: 'ac2-grid' }, ...list.map(fld))
        )
      ),
      h(
        'p',
        { class: 'mu ac2-note' },
        'Inspection, document and report progress is read from the workflow stage, the submitted-report dates and the assessment totals already on each case.'
      ),
      h(
        'div',
        { class: 'ac2-drawer-foot' },
        h('span', { class: 'mu' }, String(acFilterCount()) + ' filters active'),
        h(
          'div',
          { class: 'row4' },
          h('button', { type: 'button', class: 'b', onclick: acClearAll }, 'Clear all'),
          h('button', { type: 'button', class: 'b p', onclick: () => dlg.close() }, 'Show results')
        )
      )
    )
  );
  dlg.addEventListener('close', () => {
    acFlush();
    acRebuild();
  });
  return dlg;
}

let acDrawerEl = null;

function acOpenDrawer() {
  acClosePops();
  if (!acDrawerEl || !acDrawerEl.isConnected) {
    acDrawerEl = acDrawer();
    $('#dash').append(acDrawerEl);
  } else {
    acDrawerEl.replaceWith((acDrawerEl = acDrawer()));
  }
  acDrawerEl.showModal();
  const first = acDrawerEl.querySelector('select, input');
  if (first) first.focus();
}

function acRebuild() {
  const el = $('#dash');
  el.replaceChildren(renderAllCasesView());
}

function acRefresh() {
  acPersist();
  /* A view chosen from a tab or a KPI card never repaints the screen, so this is where the place the
     app resumes from learns about it — otherwise a reload would go back to the view first opened. */
  if (view === 'cases') rememberPlace();
  const kpi = $('.ac2-kpi'),
    views = $('.ac2-views'),
    results = $('.ac2-res'),
    quick = $('.ac2-quick');
  if (!kpi || !results) return acRebuild();
  let data;
  try {
    data = acData();
  } catch (e) {
    return acError(e);
  }
  acLast = data;
  const pages = Math.max(1, Math.ceil(data.hits.length / allCasesState.per));
  if (allCasesState.page > pages) allCasesState.page = pages;
  const vNode = acViews(data);
  views && views.replaceChildren(...vNode.children);
  kpi.replaceChildren(...acKpis(data).children);
  const bar = quick && quick.querySelector('.ac2-badge');
  if (bar) bar.textContent = String(acFilterCount());
  if (quick) {
    const clr = [...quick.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === 'Clear all'
    );
    if (clr) clr.disabled = !acFilterCount();
  }
  results.replaceChildren(acResults(data));
}

function acRefreshSoonSet(fn) {
  clearTimeout(acDebounce);
  acPendingSet = fn;
  acDebounce = setTimeout(() => {
    acPendingSet = null;
    fn();
  }, 250);
}

/* Typing is debounced, so a filter typed milliseconds before "Show results" would be lost.
   Commit anything still pending before the drawer closes or the filters are cleared. */
function acFlush() {
  clearTimeout(acDebounce);
  if (acPendingSet) {
    const f = acPendingSet;
    acPendingSet = null;
    f();
  }
}

function acErrorNode(e) {
  return h(
    'div',
    { class: 'card' },
    h('h3', { class: 'er' }, 'Could not load the case directory'),
    h('p', { class: 'mu' }, String((e && e.message) || e)),
    h('button', { class: 'b p', type: 'button', onclick: acRebuild }, 'Retry')
  );
}

function acError(e) {
  $('#dash').replaceChildren(acErrorNode(e));
}

function acOpen(id, secKey) {
  openCase(id);
  if (secKey) {
    sec = secKey;
    /* openCase() repainted for the case's first page; this repaint is the section the directory deep
       link asked for, and render() records which page of the case is on screen. */
    render();
  }
}

function renderAllCasesView() {
  const root = h('div', { class: 'case-directory ac2' });
  let data;
  try {
    data = acData();
  } catch (e) {
    return acErrorNode(e);
  }
  acLast = data;
  root.append(
    h(
      'div',
      { class: 'dh ac2-head' },
      h(
        'div',
        { class: 'ac2-head-t' },
        h('h1', {}, 'All Cases'),
        h('p', { class: 'mu' }, 'Manage, search and track all insurance survey cases.')
      ),
      h(
        'div',
        { class: 'bar' },
        h('button', { class: 'b', type: 'button', onclick: acExport }, 'Export'),
        h('button', { class: 'b', type: 'button', onclick: showDash }, 'Dashboard'),
        h('button', { class: 'b p', type: 'button', onclick: openNew }, '+ New case')
      )
    ),
    acKpis(data),
    h('div', { class: 'ac2-panel' }, acSearch(), acQuickBar()),
    acViews(data),
    h(
      'div',
      { class: 'card ac2-res' },
      h('div', { class: 'ac2-skel' }, ...[0, 1, 2, 3, 4].map(() => h('div', {})))
    )
  );
  // A timer, not requestAnimationFrame: rAF never fires while the tab is hidden, which would leave
  // the skeleton stuck on screen when the app resumes in the background. The delay is what makes the
  // loading state visible at all on a fast local store.
  setTimeout(() => {
    const box = root.querySelector('.ac2-res');
    if (box && box.querySelector('.ac2-skel')) {
      try {
        box.replaceChildren(acResults(acData()));
      } catch (e) {
        acError(e);
      }
    }
  }, 120);
  return root;
}

/* "/" focuses search, as long as the user is not already typing somewhere. */
document.addEventListener('keydown', (e) => {
  if (e.key !== '/' || view !== 'cases' || document.querySelector('dialog[open]')) return;
  const t = e.target;
  if (
    t &&
    (t.tagName === 'INPUT' ||
      t.tagName === 'TEXTAREA' ||
      t.tagName === 'SELECT' ||
      t.isContentEditable)
  )
    return;
  const s = document.getElementById('ac-q');
  if (!s) return;
  e.preventDefault();
  s.focus();
  s.select();
});

window.matchMedia(`(max-width: ${AC_BP.phone}px)`).addEventListener('change', () => {
  if (view === 'cases') acRebuild();
});

addEventListener('pagehide', acPersist);
