/* Settings (cfg), deadlines, KPIs, case tracking, dashboard, autofill, delete case
   Loaded as a classic script: everything here shares the global scope. Order of <script> tags in index.html matters. */

const cfg = Object.assign(
    { role: 'Admin', me: 'Surveyor', pd: 15, fd: 60, cnt: 'cal', pn: '', pl: '' },
    (() => {
      try {
        return JSON.parse(ST.g('sp.cfg') || '{}');
      } catch {
        return {};
      }
    })()
  ),
  saveCfg = () => ST.s('sp.cfg', JSON.stringify(cfg));

/* The Full name on the signed-in account's Personal details, cached so the case form can prefill the
   surveyor's name without waiting on the network. cfg.me stays separate on purpose: it is the
   "cases assigned to me" filter, and quietly retargeting it would hide cases already owned. */
function profileName() {
  const u = ((window.SurveyAuth && SurveyAuth.readAuth()) || {}).user || {};
  return String(cfg.pn || u.fullName || u.name || '').trim();
}

function setProfileName(n) {
  n = String(n || '').trim();
  if (!n || n === cfg.pn) return;
  cfg.pn = n;
  saveCfg();
  /* Usually resolves before a case opens; when it lands later, refill the fields that use it. */
  if (Dd && Dd.f && autofill()) paint();
}

/* Same idea for the licence number on the account: cached so the case form can prefill it offline,
   and cleared rather than kept stale when the account no longer has one. */
function profileLicence() {
  const u = ((window.SurveyAuth && SurveyAuth.readAuth()) || {}).user || {};
  return String(cfg.pl || u.licenceNumber || '').trim();
}

function setProfileLicence(n) {
  n = String(n || '').trim();
  if (n === cfg.pl) return;
  cfg.pl = n;
  saveCfg();
  if (Dd && Dd.f && autofill()) paint();
}

let pnSync = false;

async function syncProfile() {
  if (pnSync || !window.SurveyAuth || !(SurveyAuth.readAuth() || {}).user) return;
  pnSync = true;
  try {
    const u = (await SurveyAuth.request('/api/profile/me')).user || {};
    setProfileName(u.fullName);
    setProfileLicence(u.licenceNumber);
  } catch {
    pnSync = false;
    // the cached name, or a blank field the surveyor types into, beats blocking on a failed call
  }
}

Object.values(DB).forEach((c) => {
  if (!STG.includes(c.st)) c.st = OLDMAP[c.st] || 'Intimation';
  c.owner = c.owner || profileName() || cfg.me;
  c.cr = c.cr || c.u || Date.now();
});

const NXT = [
  'Review intimation and assign surveyor',
  'Contact insured and schedule inspection',
  'Complete physical inspection and photographs',
  'Prepare and submit preliminary report',
  'Collect pending documents and bills',
  'Complete final assessment and calculation',
  'Prepare final report',
  'Submit final report to insurer',
  'Address insurer rectification',
  'Resubmit corrected report',
  'None – survey complete',
];

/* A case counts as the surveyor's own when it is assigned to either name they go by: the display
   name in System Settings or the Full Name on the signed-in account. New cases now take the account
   name, older ones may still carry the local one, and matching only one of the two would drop cases
   from the surveyor's own list – or hide them completely under the Staff role. */
const isMine = (c) => {
    const n = (c.owner || '').trim();
    return n === cfg.me.trim() || (!!cfg.pn && n === cfg.pn);
  },
  dN = (s) => Math.floor(Date.parse(s) / 864e5),
  iso = (n) => new Date(n * 864e5).toISOString().slice(0, 10),
  tdN = () => dN(today()),
  vc = () => Object.values(DB).filter((c) => cfg.role !== 'Staff' || isMine(c));

function addD(s, n) {
  let d = dN(s);
  // A stored date can be anything (imported cases, BS-calendar text), and toISOString on a bad
  // one throws; reporting no start date keeps one malformed case from blanking the directory.
  if (!isFinite(d)) return '';
  if (cfg.cnt === 'wk') {
    let k = 0;
    while (k < n) {
      d++;
      if ((d + 4) % 7 !== 6) k++;
    }
    return iso(d);
  }
  return iso(d + n);
}

function dl(c, k) {
  const sub = k === 'p' ? c.pSub : c.fSub,
    due = c.asg ? addD(c.asg, k === 'p' ? cfg.pd : cfg.fd) : '';
  if (sub) return { sub, due, txt: 'Submitted ' + dtf(sub), cl: 'ok', od: false, left: null };
  if (!due) return { due, txt: 'No start date', cl: 'mu', od: false, left: null };
  const left = dN(due) - tdN();
  return {
    due,
    left,
    od: left < 0,
    txt: left < 0 ? -left + ' d overdue' : left === 0 ? 'Due today' : left + ' d left',
    cl: left < 0 ? 'er' : left <= 3 ? 'wn' : '',
  };
}

const pend = (c, k) => act(c) && !(k === 'p' ? c.pSub : c.fSub),
  chip = (d) => h('span', { class: 'pill ' + (d.cl || '') }, d.txt);

function dueOf(c) {
  return (
    [
      ...(pend(c, 'p') ? [dl(c, 'p').due] : []),
      ...(pend(c, 'f') ? [dl(c, 'f').due] : []),
      ...(c.due ? [c.due] : []),
    ]
      .filter(Boolean)
      .sort()[0] || ''
  );
}

function pri(c) {
  if (!act(c)) return ['—', 'pr-n', 9];
  const m = dN(dueOf(c) || '2999-01-01') - tdN();
  return m < 0
    ? ['Urgent', 'pr-u', 0]
    : m <= 2
      ? ['Urgent', 'pr-u', 1]
      : m <= 5
        ? ['High', 'pr-h', 2]
        : m <= 10
          ? ['Medium', 'pr-m', 3]
          : ['Normal', 'pr-n', 4];
}

/* The eight headline counts. Keys double as All Cases filter ids (FT), so a card and the table
   under it always agree. Icons stay text glyphs to match the rest of the shell — no icon set. */
const KP = [
    ['tot', 'Total cases', '#2563eb', '▤', (c) => true],
    ['act', 'Active cases', '#2563eb', '⚡', act],
    ['new', 'New intimations', '#0ea5e9', '✉', (c) => c.st === 'Intimation'],
    ['unas', 'Unassigned cases', '#64748b', '○', (c) => !c.owner],
    [
      'insp',
      'Inspections due',
      '#7c3aed',
      '🔍',
      (c) => ['Initial Review', 'Physical Inspection'].includes(c.st),
    ],
    ['pp', 'Preliminary reports pending', '#d97706', '📝', (c) => pend(c, 'p')],
    ['fp', 'Final reports pending', '#1d4ed8', '📄', (c) => pend(c, 'f')],
    [
      'od',
      'Overdue cases',
      '#dc2626',
      '⏱',
      (c) => act(c) && ((pend(c, 'p') && dl(c, 'p').od) || (pend(c, 'f') && dl(c, 'f').od)),
    ],
  ],
  FT = {};

KP.forEach(([k, , , , t]) => (FT[k] = t));

['p', 'f'].forEach((k) => {
  FT[k + '_up'] = (c) => pend(c, k) && !dl(c, k).od;
  FT[k + '_soon'] = (c) =>
    pend(c, k) && !dl(c, k).od && dl(c, k).left != null && dl(c, k).left <= 3;
  FT[k + '_od'] = (c) => pend(c, k) && dl(c, k).od;
  FT[k + '_ok'] = (c) => !!(k === 'p' ? c.pSub : c.fSub);
});

/* Action Required tabs. All but "Overdue" reuse pri(), the same urgency ranking the Priority
   column shows, so a tab and the badge inside it can never disagree about a case. */
const AT_TABS = [
  ['all', 'All tasks', (r, i) => true],
  ['mine', 'My tasks', (r) => isMine(r.c)],
  ['od', 'Overdue', (r) => (r.P.od || r.F.od) && act(r.c)],
  ['today', 'Due today', (r) => r.p[0] === 'Urgent' && (r.P.left === 0 || r.F.left === 0)],
  ['soon', 'Due soon', (r) => r.p[0] === 'Urgent' || r.p[0] === 'High' || r.p[0] === 'Medium'],
];

/* Secondary row menu: the only place a case can be deleted from the dashboard, because a Delete
   button on every row is one mis-click from a disaster. delBtn carries the two-step confirm and
   the Staff rule is the same one the table already applies. */
function actMenu(btn, r) {
  const wasOpen = btn.getAttribute('aria-expanded') === 'true';
  closeActMenus();
  if (wasOpen) return;
  const pop = h(
    'div',
    { class: 'ac2-menu at-menu', role: 'menu' },
    h(
      'button',
      {
        type: 'button',
        role: 'menuitem',
        onclick: () => {
          pop.remove();
          openCase(r.c.id);
        },
      },
      'View case'
    ),
    ...(cfg.role === 'Staff' ? [] : [delBtn(r.c)])
  );
  btn.parentElement.append(pop);
  btn.setAttribute('aria-expanded', 'true');
}

/* Clicking away or pressing Escape closes the row menu. The toggle in actMenu() reads
   aria-expanded, so it has to be reset here too – otherwise the next click is spent
   re-closing an already-closed menu. */
function closeActMenus() {
  document.querySelectorAll('.at-menu').forEach((p) => p.remove());
  document
    .querySelectorAll('.at-dots[aria-expanded="true"]')
    .forEach((b) => b.setAttribute('aria-expanded', 'false'));
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.at-menu') && !e.target.closest('.at-dots')) closeActMenus();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeActMenus();
});

function ago(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return m + ' min ago';
  const hr = Math.floor(m / 60);
  if (hr < 24) return hr + ' h ago';
  const d = Math.floor(hr / 24);
  return d + (d === 1 ? ' day ago' : ' days ago');
}

/* Recent Activity. c.hist is the only timestamped case log the app keeps: it is seeded with
   "Intimation" when the case is created and appended by setStage() on every change, so each row
   below is a literal reading of it. The name shown is the case's assigned surveyor, not proof of
   who clicked – the app records no actor, and guessing one would be fabrication. */
function activityEntries(V, limit) {
  const out = [];
  V.forEach((r) => {
    const H = r.c.hist || [];
    H.forEach((e, i) => {
      if (e && e.t)
        out.push({
          t: e.t,
          id: r.id,
          cid: r.c.id,
          who: r.c.owner || 'Unassigned',
          txt: i ? 'Moved to ' + e.s : 'Intimation logged',
          cl: !i ? 'new' : e.s === 'Survey Complete' ? 'ok' : '',
        });
    });
    const t = r.c.u || r.c.cr;
    if (!H.length && t)
      out.push({
        t,
        id: r.id,
        cid: r.c.id,
        who: r.c.owner || 'Unassigned',
        txt: 'Case updated',
        cl: '',
      });
  });
  return out.sort((a, b) => b.t - a.t).slice(0, limit);
}

function setStage(c, s) {
  c.st = s;
  const i = STG.indexOf(s);
  (c.hist = c.hist || []).push({ s, t: Date.now() });
  if (i >= 4 && !c.pSub) c.pSub = today();
  if (i >= 7 && !c.fSub) c.fSub = today();
  c.u = Date.now();
  sv(1);
}

function trackUI(c) {
  const root = h('section', { class: 'card' }),
    rf = () => root.replaceWith(trackUI(c)),
    st = h('select', {}, ...STG.map((s) => h('option', { value: s }, s))),
    dI = (v, k) => {
      const i = h('input', {
        type: 'text',
        readonly: 'readonly',
        placeholder: 'Pick date (AD / BS)',
      });
      i.style.cursor = 'pointer';
      i.onclick = () => openDP(i);
      i.value = v || '';
      i.onchange = () => {
        c[k] = i.value;
        c.u = Date.now();
        sv(1);
        rf();
      };
      return i;
    },
    ow = h('input', { maxlength: '60' }),
    nt = h('input', { maxlength: '200', placeholder: 'Next action / follow-up note' });
  st.value = c.st;
  st.onchange = () => {
    setStage(c, st.value);
    rf();
  };
  ow.value = c.owner || '';
  ow.disabled = cfg.role === 'Staff';
  ow.onchange = () => {
    c.owner = ow.value.trim();
    sv(1);
  };
  nt.value = c.note || '';
  nt.onblur = () => {
    c.note = nt.value.trim();
    sv(1);
  };
  const f = (l, i) => h('div', { class: 'fld' }, h('label', {}, l), i),
    p = dl(c, 'p'),
    fl = dl(c, 'f'),
    ci = STG.indexOf(c.st),
    last = (s) => {
      const e = (c.hist || []).filter((x) => x.s === s).pop();
      return e ? dtf(new Date(e.t).toISOString().slice(0, 10)) : '';
    };
  root.append(
    h('h3', {}, 'Claim tracking – settlement cycle'),
    h(
      'div',
      { class: 'grid' },
      f('Settlement stage', st),
      f('Intimation / assignment date (deadline start)', dI(c.asg, 'asg')),
      f('Assigned surveyor', ow),
      f('Next follow-up date', dI(c.due, 'due')),
      f('Preliminary report submitted on', dI(c.pSub, 'pSub')),
      f('Final report submitted on', dI(c.fSub, 'fSub')),
      f('Next action / note', nt)
    ),
    h(
      'p',
      { class: 'dlp' },
      h(
        'span',
        { class: 'dlgrp' },
        h('b', {}, `Preliminary (${cfg.pd} d): `),
        h('span', { class: 'pill ' + p.cl }, p.txt),
        p.due ? ` due ${dtf(p.due)}` : ''
      ),
      h(
        'span',
        { class: 'dlgrp' },
        h('b', {}, `Final (${cfg.fd} d): `),
        h('span', { class: 'pill ' + fl.cl }, fl.txt),
        fl.due ? ` due ${dtf(fl.due)}` : ''
      )
    ),
    h(
      'ul',
      { class: 'tlv' },
      ...STG.map((s, i) => {
        const od = (i === 3 && p.od) || (i >= 6 && i <= 7 && fl.od),
          cl = od ? 'od' : i < ci ? 'dn' : i === ci ? 'cur' : '';
        return h(
          'li',
          { class: cl },
          h('span', { class: 'dt' }),
          s,
          h('span', { class: 'mu' }, od ? 'overdue' : i < ci ? last(s) || '✓' : '')
        );
      })
    )
  );
  return root;
}

function openCase(id) {
  view = 'case';
  $('#dash').hidden = true;
  $('.app').hidden = false;
  ['#cs', '#dx'].forEach((s) => ($(s).hidden = false));
  /* Opening and closing a case is where these are decided, so all ask the server's set: delete_case is
     not in the Principal Surveyor defaults, export_case_report is not in the staff ones, and
     assign_case is held by neither of the accounts that receive work. An administrator can grant any of
     them to a person in the permissions editor. */
  $('#dx').hidden = !mayUse('export_case_report', true);
  $('#del').hidden = !mayUse('delete_case', cfg.role !== 'Staff');
  $('#ta').hidden = !mayUse('assign_case', cfg.role !== 'Staff');
  /* Documents belong to whoever may send one, which is the key the upload route asks for — not to
     whoever may check one, so a member files their scan and never sees a decision button. */
  $('#td').hidden = !mayUse('upload_documents', true);
  /* The thread is the case, so it opens for anyone who may write in it — and add_case_comments is the
     key the posting route asks for. A member who cannot post still gets the button when the role
     default allows reading, which is why the fallback is true and not the key's own grant. */
  $('#tc').hidden = !mayUse('add_case_comments', true);
  $('#cm').hidden = false;
  $('#ct').hidden = false;
  setMenu('');
  load(id);
  sec = 'case';
  hdr();
  sv(1);
  render();
}

let dashOnce = 0,
  chartSpan = 6,
  chartIns = '';

function monthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function caseArrivalDate(c) {
  return new Date(c.asg || c.cr || c.u || Date.now());
}

/* One pass over the role-visible rows to count cases per insurer, highest first.
   Feeds both the chart's filter list and the "by insurer" breakdown, so the two never disagree. */
function insurerBreakdown(rows) {
  const m = new Map();
  rows.forEach((r) => m.set(r.ins, (m.get(r.ins) || 0) + 1));
  return [...m.entries()]
    .map(([name, count]) => ({ name, count, label: name === '—' ? 'Insurer not recorded' : name }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function insurerLabel(name) {
  return name === '—' ? 'Insurer not recorded' : name;
}

/* SVG factory shared by the two dashboard charts, plus the percent format their legends use. */
function svgEl(tag, attrs, text) {
  const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.keys(attrs).forEach((k) => e.setAttribute(k, attrs[k]));
  if (text != null) e.textContent = text;
  return e;
}

function pctStr(n, t) {
  const v = t ? (n / t) * 100 : 0;
  return (v >= 10 ? Math.round(v) : Math.round(v * 10) / 10) + '%';
}

const INS_COLORS = ['#2563eb', '#0ea5e9', '#16a34a', '#d97706', '#7c3aed', '#0f766e'];
const INS_OTHER = '#94a3b8';
const CHART_SPANS = [3, 6, 12];

/* Intimations arriving per month. Bars rather than a line: the series is a discrete count of a
   handful of cases per month, and the reader is counting them, not reading a trend. */
function buildIntimationsChart(rows) {
  const now = new Date();
  const buckets = [];
  for (let i = chartSpan - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({
      key: monthKey(d),
      label: d.toLocaleDateString('en-GB', { month: 'short' }),
      value: 0,
    });
  }
  const at = new Map(buckets.map((b) => [b.key, b]));
  const scoped = chartIns ? rows.filter((r) => r.ins === chartIns) : rows;
  scoped.forEach((r) => {
    const b = at.get(monthKey(caseArrivalDate(r.c)));
    if (b) b.value += 1;
  });
  const inWindow = buckets.reduce((s, b) => s + b.value, 0);
  const older = scoped.length - inWindow;

  const chart = () => {
    if (!inWindow)
      return h(
        'p',
        { class: 'mu' },
        scoped.length
          ? 'Nothing received in this window – the cases in view are older.'
          : 'No cases to count in this view.'
      );
    const width = 560,
      height = 215,
      left = 28,
      right = 12,
      top = 18,
      bottom = 32,
      plotW = width - left - right,
      plotH = height - top - bottom,
      highest = Math.max(...buckets.map((b) => b.value), 1),
      step = plotW / buckets.length,
      bw = Math.min(52, step * 0.58);
    const svg = svgEl('svg', {
      viewBox: `0 0 ${width} ${height}`,
      class: 'chart-svg bars',
      role: 'img',
      'aria-label': 'Intimations received per month',
    });
    /* Thirds of a two-case series are not three different integers, so the tick values are
       deduped – a one-case chart gets one gridline, not three stacked "1"s. */
    [...new Set([1, 2, 3].map((i) => Math.ceil((highest / 3) * i)))].forEach((v) => {
      const y = height - bottom - (v / highest) * plotH;
      svg.append(
        svgEl('line', { x1: left, x2: width - right, y1: y, y2: y, stroke: '#edf2f7' }),
        svgEl(
          'text',
          { x: left - 7, y: y + 3.5, 'text-anchor': 'end', fill: '#586577', 'font-size': '10' },
          v
        )
      );
    });
    svg.append(
      svgEl('line', {
        x1: left,
        x2: width - right,
        y1: height - bottom,
        y2: height - bottom,
        stroke: '#dfe6ee',
      })
    );
    buckets.forEach((b, i) => {
      const x = left + i * step + (step - bw) / 2;
      svg.append(
        svgEl(
          'text',
          {
            x: x + bw / 2,
            y: height - 10,
            'text-anchor': 'middle',
            fill: '#586577',
            'font-size': '10.5',
          },
          b.label
        )
      );
      if (!b.value) return;
      const bh = Math.max(3, (b.value / highest) * plotH);
      const bar = svgEl('rect', {
        x,
        y: height - bottom - bh,
        width: bw,
        height: bh,
        rx: 3,
        fill: '#2563eb',
      });
      bar.append(
        svgEl('title', {}, b.label + ': ' + b.value + ' intimation' + (b.value === 1 ? '' : 's'))
      );
      svg.append(
        bar,
        svgEl(
          'text',
          {
            x: x + bw / 2,
            y: height - bottom - bh - 6,
            'text-anchor': 'middle',
            fill: '#2563eb',
            'font-size': '11',
            'font-weight': '700',
          },
          b.value
        )
      );
    });
    return svg;
  };

  const spanSel = h(
    'select',
    {
      'aria-label': 'Chart period',
      onchange: (e) => {
        chartSpan = Number(e.target.value);
        drawDash();
      },
    },
    ...CHART_SPANS.map((n) => h('option', { value: String(n) }, 'Last ' + n + ' months'))
  );
  spanSel.value = String(chartSpan);

  const mo = new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric' });
  const win =
    mo.format(new Date(now.getFullYear(), now.getMonth() - chartSpan + 1, 1)) +
    ' – ' +
    mo.format(now);

  return h(
    'div',
    { class: 'chart-card' },
    h(
      'div',
      { class: 'chart-head' },
      h('h3', {}, 'Monthly intimations'),
      h('div', { class: 'chart-tools' }, spanSel)
    ),
    chart(),
    h(
      'small',
      { class: 'mu' },
      (chartIns ? insurerLabel(chartIns) + ': ' : '') +
        inWindow +
        ' intimation' +
        (inWindow === 1 ? '' : 's') +
        ' received · ' +
        win +
        (older ? ' · ' + older + ' earlier' : '') +
        (chartIns ? ' · filtered from ' + rows.length + ' in view' : '')
    )
  );
}

/* Ring segment between two angles. */
function wedgePath(cx, cy, ir, r, a0, a1) {
  const P = (rad, ang) => [
    (cx + rad * Math.cos(ang)).toFixed(2),
    (cy + rad * Math.sin(ang)).toFixed(2),
  ];
  const big = a1 - a0 > Math.PI ? 1 : 0;
  const o = P(r, a0),
    i1 = P(r, a1),
    i2 = P(ir, a1),
    i3 = P(ir, a0);
  return (
    'M ' +
    o[0] +
    ' ' +
    o[1] +
    ' A ' +
    r +
    ' ' +
    r +
    ' 0 ' +
    big +
    ' 1 ' +
    i1[0] +
    ' ' +
    i1[1] +
    ' L ' +
    i2[0] +
    ' ' +
    i2[1] +
    ' A ' +
    ir +
    ' ' +
    ir +
    ' 0 ' +
    big +
    ' 0 ' +
    i3[0] +
    ' ' +
    i3[1] +
    ' Z'
  );
}

/* How the caseload splits across insurers. Segments are true arcs, so the ring and the legend
   carry the same numbers; the workflow ring the stage donut used to draw is shown as a pipeline. */
function buildInsurerDonut(V) {
  const list = insurerBreakdown(V);
  const top = list.slice(0, INS_COLORS.length);
  const rest = list.slice(INS_COLORS.length);
  const items = top.map((x, i) => ({ ...x, color: INS_COLORS[i], pick: true }));
  if (rest.length)
    items.push({
      name: null,
      label: 'Other insurers (' + rest.length + ')',
      count: rest.reduce((s, x) => s + x.count, 0),
      color: INS_OTHER,
      pick: false,
      sub: rest.map((x) => x.label + ' ' + x.count).join(', '),
    });
  const dim = (it) =>
    !!chartIns && !(it.pick ? it.name === chartIns : rest.some((x) => x.name === chartIns));

  const cx = 78,
    cy = 78,
    r = 58,
    ir = 37;
  const svg = svgEl('svg', {
    viewBox: '0 0 156 156',
    class: 'chart-svg donut',
    role: 'img',
    'aria-label': 'Cases by insurance company',
  });
  let a = -Math.PI / 2;
  items.forEach((it) => {
    const frac = it.count / V.length;
    /* One insurer holding every case would put the arc's start and end on the same point, which
       draws nothing – that case is a full stroked ring instead. */
    const seg =
      frac >= 0.9999
        ? svgEl('circle', {
            cx,
            cy,
            r: (r + ir) / 2,
            fill: 'none',
            stroke: it.color,
            'stroke-width': r - ir,
          })
        : svgEl('path', {
            d: wedgePath(cx, cy, ir, r, a, a + frac * Math.PI * 2),
            fill: it.color,
          });
    seg.setAttribute('opacity', dim(it) ? '0.3' : '1');
    seg.append(
      svgEl(
        'title',
        {},
        it.label +
          ': ' +
          it.count +
          ' case' +
          (it.count === 1 ? '' : 's') +
          ' · ' +
          pctStr(it.count, V.length)
      )
    );
    if (it.pick) {
      seg.setAttribute('class', 'donut-seg');
      seg.onclick = () => {
        chartIns = chartIns === it.name ? '' : it.name;
        drawDash();
      };
    }
    svg.append(seg);
    a += frac * Math.PI * 2;
  });
  svg.append(
    svgEl('circle', { cx, cy, r: ir - 5, fill: '#fff', stroke: '#e5e7eb' }),
    svgEl(
      'text',
      {
        x: cx,
        y: cy + 2,
        'text-anchor': 'middle',
        'font-size': '22',
        'font-weight': '700',
        fill: '#172033',
      },
      V.length
    ),
    svgEl(
      'text',
      { x: cx, y: cy + 17, 'text-anchor': 'middle', 'font-size': '9.5', fill: '#64748b' },
      'cases'
    )
  );

  const row = (it) =>
    it.pick
      ? h(
          'button',
          {
            type: 'button',
            class: 'chart-legend-item leg-btn' + (chartIns === it.name ? ' on' : ''),
            title: 'Filter the intimations chart to ' + it.label,
            onclick: () => {
              chartIns = chartIns === it.name ? '' : it.name;
              drawDash();
            },
          },
          h('span', { class: 'legend-dot', style: 'background:' + it.color }),
          h('span', { class: 'legend-label' }, it.label),
          h('b', {}, String(it.count)),
          h('span', { class: 'legend-pct' }, pctStr(it.count, V.length))
        )
      : h(
          'span',
          { class: 'chart-legend-item', title: it.sub },
          h('span', { class: 'legend-dot', style: 'background:' + it.color }),
          h('span', { class: 'legend-label' }, it.label),
          h('b', {}, String(it.count)),
          h('span', { class: 'legend-pct' }, pctStr(it.count, V.length))
        );

  const insSel = h(
    'select',
    {
      'aria-label': 'Filter cases by insurance company',
      onchange: (e) => {
        chartIns = e.target.value;
        drawDash();
      },
    },
    h('option', { value: '' }, 'All insurers (' + V.length + ')'),
    ...list.map((x) => h('option', { value: x.name }, x.label + ' (' + x.count + ')'))
  );
  insSel.value = chartIns;

  return h(
    'div',
    { class: 'chart-card' },
    h(
      'div',
      { class: 'chart-head' },
      h('h3', {}, 'Insurer distribution'),
      h('label', { class: 'chart-ins' }, 'Insurance company', insSel)
    ),
    V.length
      ? h('div', { class: 'donut-wrap' }, svg)
      : h('p', { class: 'mu' }, 'No cases to count yet.'),
    V.length ? h('div', { class: 'chart-legend ins-legend' }, ...items.map(row)) : '',
    h(
      'small',
      { class: 'mu' },
      chartIns
        ? insurerLabel(chartIns) +
            ' selected – ' +
            list.length +
            ' insurer' +
            (list.length === 1 ? '' : 's') +
            ' hold' +
            (list.length === 1 ? 's' : '') +
            ' the ' +
            V.length +
            ' case' +
            (V.length === 1 ? '' : 's') +
            ' this role can see.'
        : 'Percentages are of the ' +
            V.length +
            ' case' +
            (V.length === 1 ? '' : 's') +
            ' this role can see. Click a legend row to filter the chart on the left.'
    )
  );
}

/* One pass over every case the current role may see, with the derived columns the directory
   needs. Additive: Quick Capture and the dashboard read the original id/who/ref/sv keys. */
function caseDirectoryRows() {
  const docAt = STG.indexOf('Document Collection'),
    inspAt = STG.indexOf('Physical Inspection');
  return vc().map((c) => {
    const i = STG.indexOf(c.st),
      row = {
        c,
        ...withCase(c, () => ({
          id: g('case_claimNo') || 'Untitled case',
          who: g('pol_insured') || '—',
          ref: (c.mod === 'property' ? g('case_loc') : g('case_insReg')) || '—',
          sv: c.owner || g('case_surveyor') || '—',
          sy: g('case_surveyor') || '',
          ins: g('case_company') || '—',
          pol: g('case_policyNo') || '',
          loc: g('case_loc') || '',
          mk: g('pol_make') || '',
          mdl: g('pol_model') || '',
          br: g('pol_branch') || '',
          vt: g('pol_vtype') || '',
          clt: g('case_ctype') || '',
          sys: c.st || '',
          acc: g('case_acc') || '',
          vrn: c.mod === 'property' ? '—' : g('case_insReg') || '—',
          amt: Number((c.mod === 'property' ? g('dmg_t') : g('acc_t3')) || 0) || 0,
        })),
        stx: i,
        ad: c.asg || '',
        upd: c.u || c.cr || 0,
        P: dl(c, 'p'),
        F: dl(c, 'f'),
        /* Inspection and document progress are workflow positions, not stored flags, so they are
           derived from the stage the case actually sits in. */
        insp: i < inspAt ? 'pending' : i === inspAt ? 'scheduled' : 'done',
        docs: i < docAt ? 'pending' : i === docAt ? 'partial' : 'complete',
      };
    row.due = dueOf(c);
    row.pri = pri(c);
    return row;
  });
}

/* One compact case row, used by the All Cases list on phones: the designated cover photograph
   leads, then identity and stage, party and risk, insurer and dates, with the deadline chips on
   the right so the row lines up with the desktop table. */
function caseListRow(r, open, actions) {
  const col = STC[r.stx] || '#64748b';
  return h(
    'li',
    {
      class: 'cl-row',
      style: '--c:' + col,
      tabindex: '0',
      onclick: () => open(r),
      onkeydown: (e) => {
        if (e.key === 'Enter') open(r);
      },
    },
    coverThumb(r.c.id, r.id, 'is-list'),
    h(
      'div',
      { class: 'cl-main' },
      h(
        'div',
        { class: 'cl-top' },
        h('b', { class: 'cl-id' }, r.id),
        h('span', { class: 'pill cl-stage', style: 'color:' + col }, r.c.st)
      ),
      h('div', { class: 'cl-sub' }, r.who + ' · ' + r.ref),
      h(
        'div',
        { class: 'cl-meta' },
        [
          r.ins === '—' ? 'Insurer not recorded' : r.ins,
          'Intimation ' + (r.ad ? dtf(r.ad) : '—'),
          r.sv,
        ].join(' · ')
      )
    ),
    h('div', { class: 'cl-side' }, chip(r.P), chip(r.F), ...(actions || []))
  );
}

function getCurrentAuthUser() {
  if (!window.SurveyAuth || typeof window.SurveyAuth.readAuth !== 'function') return null;
  const auth = window.SurveyAuth.readAuth();
  return auth && auth.user ? auth.user : null;
}

function getSessionPermissions() {
  if (!window.SurveyAuth || typeof window.SurveyAuth.readAuth !== 'function') return null;
  const auth = window.SurveyAuth.readAuth();
  return auth && Array.isArray(auth.permissions) ? auth.permissions : null;
}

/* Offer a control on the permission that guards its API rather than on the role, so an account
   granted one administration screen but not the others gets exactly the one button. Until that set
   arrives — or if the lookup failed — fall back to the role, because hiding everything from an
   administrator over one slow request is the worse mistake. This is presentation only; the server
   resolves the permission again on every call. */
function mayUse(permissionKey, roleFallback) {
  const list = getSessionPermissions();
  if (!list) return roleFallback;
  return list.includes(permissionKey);
}

const ADMIN_NAV_PERMISSIONS = {
  'user-admin-btn': 'manage_users',
  'audit-btn': 'view_audit_log',
  'ins-master-btn': 'manage_insurer_master',
  ms: 'manage_system_settings',
};

function syncAccountSidebarVisibility() {
  const authUser = getCurrentAuthUser();
  const isAdmin = normalizeServerRole(authUser && authUser.role) === 'ADMIN';
  /* The sidebar, the mobile header and the case-import dialog all open a new file — from scratch or
     from a JSON export — so they follow one key, which the staff defaults do not include. */
  const mayCreate = mayUse(
    'create_case',
    isAdmin || normalizeServerRole(authUser && authUser.role) === 'SURVEYOR'
  );
  ['#nw', '#nw-mob', '#mi', '#mi-mob'].forEach((s) => {
    const btn = $(s);
    if (btn) btn.hidden = !mayCreate;
  });
  let anyAdminScreen = false;
  Object.entries(ADMIN_NAV_PERMISSIONS).forEach(([id, permissionKey]) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    const allowed = mayUse(permissionKey, isAdmin);
    btn.hidden = !allowed;
    if (allowed) anyAdminScreen = true;
  });
  // The cluster heading would otherwise show an empty "Administration" section to non-admins.
  const adminGroup = document.getElementById('admin-group');
  if (adminGroup) adminGroup.hidden = !anyAdminScreen;
}

/* The account's role decides which dashboard this person gets. The "View as" switch stays available
   to an administrator as a preview of what the other roles see, but for a Principal Surveyor or a
   staff account the stored value is overwritten on every render, so editing localStorage by hand
   cannot raise a member's own view. Authorization itself is still the server's job. */
const ROLE_FROM_ACCOUNT = { ADMIN: 'Admin', SURVEYOR: 'Principal Surveyor', STAFF: 'Staff' };
const ROLE_VIEWS = ['Admin', 'Principal Surveyor', 'Staff'];
function applyAccountRole() {
  const authUser = getCurrentAuthUser();
  if (!authUser) return;
  const server = normalizeServerRole(authUser.role);
  if (server === 'ADMIN') {
    if (!ROLE_VIEWS.includes(cfg.role)) cfg.role = 'Admin';
    return;
  }
  cfg.role = ROLE_FROM_ACCOUNT[server];
  /* "My name" is the filter that decides whose cases a member sees, so on a non-admin account it is
     taken from that account's own name rather than left editable: typing a colleague's name into it
     would otherwise show this device the colleague's assignments. */
  const own = (authUser.fullName || authUser.name || '').trim();
  if (own) cfg.me = own;
  cfg.pn = own;
}

/* Only the event types the server actually records are listed here; an unknown kind falls back to
   its raw name rather than to a made-up sentence. */
const SECURITY_EVENT_COPY = {
  login: (entry) => (entry.status === 'failure' ? 'Failed sign-in attempt' : 'Signed in'),
  new_device_login: () => 'New device signed in',
  logout: () => 'Signed out',
  password_change: () => 'Password changed',
  password_reset: () => 'Password reset completed',
  password_reset_requested: () => 'Password reset link requested',
  session_terminated: () => 'Session signed out',
  verification_resent: () => 'Activation link resent',
  account_activated: () => 'Account activated',
  account_created: () => 'Account created',
};

function describeSecurityEvent(entry) {
  const copy = SECURITY_EVENT_COPY[entry.eventType];
  if (copy) return copy(entry);
  return String(entry.eventType || 'Security event').replace(/_/g, ' ');
}

const securityTime = (value) => (value ? new Date(value).toLocaleString() : '—');

const securityDeviceLabel = (item) =>
  [item.browserName, item.osName].filter((part) => part && part !== 'Unknown').join(' on ') ||
  'Unknown device';

/* The same trail is shown on the Security page and on its own Activity page, so it is built once. */
function buildSecurityActivityCard(entries, caption) {
  const rows = entries.map((entry) => {
    const failed = entry.status === 'failure';
    const flagged = failed || entry.eventType === 'new_device_login';
    return h(
      'tr',
      { class: flagged ? `sec-flag ${failed ? 'is-bad' : 'is-warn'}` : '' },
      h(
        'td',
        {},
        h('div', { class: 'sec-device' }, describeSecurityEvent(entry)),
        h('div', { class: 'sec-sub' }, [securityDeviceLabel(entry), entry.ipAddress].join(' · '))
      ),
      h('td', {}, securityTime(entry.createdAt)),
      h(
        'td',
        {},
        h(
          'span',
          { class: 'sec-tag ' + (failed ? 'is-bad' : 'is-ok') },
          failed ? 'Failed' : 'Success'
        )
      )
    );
  });

  return h(
    'div',
    { class: 'account-card' },
    h('h3', {}, 'Login activity'),
    h('p', { class: 'mu' }, caption),
    rows.length
      ? h(
          'table',
          { class: 'account-table sec-table' },
          h(
            'thead',
            {},
            h('tr', {}, h('th', {}, 'Event'), h('th', {}, 'When'), h('th', {}, 'Result'))
          ),
          h('tbody', {}, ...rows)
        )
      : h('p', { class: 'mu' }, 'No login activity recorded yet.')
  );
}

/* The three tiers the product speaks about, folded onto whatever the row actually holds. ASSISTANT
   is what the accounts created before this build were stored with and means the same thing as STAFF,
   so it is read that way rather than migrated. */
const SERVER_ROLE_LABELS = { ADMIN: 'Admin', SURVEYOR: 'Principal Surveyor', STAFF: 'Staff' };
function normalizeServerRole(role) {
  const value = String(role || '').toUpperCase();
  if (value === 'ADMIN') return 'ADMIN';
  if (value === 'SURVEYOR' || value === 'PRINCIPAL_SURVEYOR') return 'SURVEYOR';
  return 'STAFF';
}
const roleSelect = (current) =>
  h(
    'select',
    { class: 'role-pick', 'aria-label': 'Role' },
    ...Object.keys(SERVER_ROLE_LABELS).map((value) => {
      const option = h('option', { value }, SERVER_ROLE_LABELS[value]);
      if (value === normalizeServerRole(current)) option.selected = true;
      return option;
    })
  );

/* Mirrors the server's rule so an administrator who types a password here sees the same verdict the
   database will apply, instead of a 400 after pressing Create. */
const STRONG_PASSWORD_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{12,}$/;
function makeTemporaryPassword() {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#$%*-_=+'];
  const pick = (set) => set[crypto.getRandomValues(new Uint32Array(1))[0] % set.length];
  const chars = sets.map(pick);
  while (chars.length < 14) chars.push(pick(sets.join('')));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

function adminUserTable(list, onPermissions) {
  if (!list || !list.length) return h('p', { class: 'mu' }, 'No users found.');
  const patch = async (id, body) => {
    try {
      await window.SurveyAuth.request(`/api/admin/users/${id}`, { method: 'PATCH', body });
      await showProfilePage('admin-users');
    } catch (error) {
      alert(error.message || 'Unable to update that account.');
    }
  };
  return h(
    'table',
    { class: 'account-table' },
    h(
      'thead',
      {},
      h(
        'tr',
        {},
        h('th', {}, 'Name'),
        h('th', {}, 'Email'),
        h('th', {}, 'Role'),
        h('th', {}, 'Status'),
        h('th', {}, 'Last login'),
        h('th', {}, 'Action')
      )
    ),
    h(
      'tbody',
      {},
      ...list.map((user) => {
        const pick = roleSelect(user.role);
        pick.onchange = () => patch(user.id, { role: pick.value });
        return h(
          'tr',
          {},
          h('td', { 'data-label': 'Name' }, user.full_name || user.email.split('@')[0]),
          h('td', { 'data-label': 'Email' }, user.email),
          h('td', { 'data-label': 'Role' }, pick),
          h(
            'td',
            { 'data-label': 'Status' },
            h(
              'span',
              {
                class:
                  'account-status-pill ' +
                  (user.is_active
                    ? user.must_change_password
                      ? 'pending'
                      : 'active'
                    : 'inactive'),
              },
              !user.is_active
                ? 'Disabled'
                : user.must_change_password
                  ? 'Awaiting first password'
                  : 'Active'
            )
          ),
          h(
            'td',
            { 'data-label': 'Last login' },
            user.last_login_at ? new Date(user.last_login_at).toLocaleString() : 'Never'
          ),
          h(
            'td',
            { 'data-label': 'Action', class: 'row-actions' },
            h(
              'button',
              {
                class: 'b',
                type: 'button',
                title: 'Issue a new temporary password and sign this member out everywhere',
                onclick: async () => {
                  if (
                    !confirm(
                      `Issue a new temporary password for ${user.email}? Their devices sign out.`
                    )
                  )
                    return;
                  try {
                    const result = await window.SurveyAuth.request(
                      `/api/admin/users/${user.id}/reset-password`,
                      { method: 'POST' }
                    );
                    showTemporaryCredentials(
                      { email: user.email, temporaryPassword: result.temporaryPassword },
                      'Password reset'
                    );
                  } catch (error) {
                    alert(error.message || 'Unable to reset that password.');
                  }
                },
              },
              'Reset password'
            ),
            h(
              'button',
              {
                class: 'b' + (user.is_active ? '' : ' p'),
                type: 'button',
                onclick: () => patch(user.id, { isActive: !user.is_active }),
              },
              user.is_active ? 'Disable' : 'Enable'
            ),
            /* An administrator already holds everything, so the screen would only offer ways to
               lock them out of their own system. */
            onPermissions && normalizeServerRole(user.role) !== 'ADMIN'
              ? h(
                  'button',
                  {
                    class: 'b',
                    type: 'button',
                    onclick: () => onPermissions(user),
                  },
                  'Permissions'
                )
              : ''
          )
        );
      })
    )
  );
}

/* A temporary password exists in one server response and nowhere afterwards, so the panel showing it
   is the only copy the administrator ever gets — closing the tab loses it and a reset issues another. */
function showTemporaryCredentials({ email, temporaryPassword }, heading = 'Account created') {
  const box = h(
    'div',
    { class: 'account-card credentials' },
    h('h3', {}, heading),
    h('p', { class: 'mu' }, 'Share these once, in person or over a channel you already trust.'),
    h(
      'dl',
      { class: 'credential-list' },
      h('dt', {}, 'Email'),
      h('dd', {}, h('code', {}, email)),
      h('dt', {}, 'Temporary password'),
      h('dd', {}, h('code', {}, temporaryPassword))
    ),
    h(
      'div',
      { class: 'row-actions' },
      h(
        'button',
        {
          class: 'b p',
          type: 'button',
          onclick: async (event) => {
            const button = event.currentTarget;
            try {
              await navigator.clipboard.writeText(
                `Email: ${email}\nPassword: ${temporaryPassword}`
              );
              button.textContent = 'Copied';
            } catch (error) {
              button.textContent = 'Copy failed — select the text instead';
            }
          },
        },
        'Copy both'
      ),
      h('button', { class: 'b', type: 'button', onclick: () => box.remove() }, 'Done')
    ),
    h(
      'p',
      { class: 'mu' },
      'They must set their own password before SurveyPro will do anything else for them.'
    )
  );
  const host = $('#dash') || document.body;
  host.insertBefore(box, host.firstChild);
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function adminCreateUserForm({ onDone, onClose }) {
  const name = h('input', { type: 'text', maxlength: '160', placeholder: 'Biplab Lamsal' });
  const email = h('input', { type: 'email', maxlength: '320', placeholder: 'name@company.com.np' });
  const phone = h('input', { type: 'tel', maxlength: '40', placeholder: '98XXXXXXXX' });
  const role = roleSelect('STAFF');
  const temp = h('input', {
    type: 'text',
    maxlength: '80',
    placeholder: 'leave empty to generate one',
    spellcheck: 'false',
  });
  const remarks = h('input', {
    type: 'text',
    maxlength: '500',
    placeholder: 'Optional note for your own records',
  });
  const error = h('p', { class: 'er form-error' }, '');
  const submit = h('button', { class: 'b p', type: 'submit' }, 'Create account');

  const fld = (label, control) => h('div', { class: 'fld' }, h('label', {}, label), control);

  return h(
    'form',
    {
      class: 'account-card account-form create-user',
      onsubmit: async (event) => {
        event.preventDefault();
        error.textContent = '';
        const body = {
          fullName: name.value.trim(),
          email: email.value.trim(),
          phoneNumber: phone.value.trim(),
          role: role.value,
          remarks: remarks.value.trim(),
        };
        if (temp.value.trim() && !STRONG_PASSWORD_RE.test(temp.value.trim())) {
          error.textContent =
            'A typed temporary password needs 12 characters with upper and lower case, a number and a symbol — or leave it empty to generate one.';
          return;
        }
        if (temp.value.trim()) body.temporaryPassword = temp.value;
        submit.disabled = true;
        try {
          const result = await window.SurveyAuth.request('/api/admin/users', {
            method: 'POST',
            body,
          });
          onClose();
          await onDone();
          showTemporaryCredentials({
            email: result.user.email,
            temporaryPassword: result.temporaryPassword,
          });
        } catch (requestError) {
          error.textContent = requestError.message || 'Unable to create that account.';
        } finally {
          submit.disabled = false;
        }
      },
    },
    h('h3', {}, 'Add new user'),
    h(
      'div',
      { class: 'account-row' },
      fld('Full name', name),
      fld('Email', email),
      fld('Mobile number', phone),
      fld('Role', role)
    ),
    h(
      'div',
      { class: 'account-row' },
      fld(
        'Temporary password',
        h(
          'div',
          { class: 'field-row' },
          temp,
          h(
            'button',
            {
              class: 'b',
              type: 'button',
              title: 'Use a password nobody else knows',
              onclick: () => {
                temp.value = makeTemporaryPassword();
              },
            },
            'Generate'
          )
        )
      ),
      fld('Remarks', remarks)
    ),
    error,
    h(
      'div',
      { class: 'row-actions' },
      submit,
      h('button', { class: 'b', type: 'button', onclick: onClose }, 'Cancel')
    ),
    h(
      'p',
      { class: 'mu' },
      'New accounts arrive already active: an administrator opening one is the activation. The member sets their own password on first sign-in.'
    )
  );
}

/* One person's switches. Three choices on every line, because "off" and "whatever my role says" are
   different answers and an administrator has to be able to put a line back the way it was. */
async function adminPermissionEditor(user, { onClose }) {
  const error = h('p', { class: 'form-error' });
  const card = h(
    'div',
    { class: 'account-card permissions' },
    h('h3', {}, `Permissions — ${user.full_name || user.email}`),
    h('p', { class: 'mu' }, 'Loading…')
  );

  let matrix;
  try {
    const result = await window.SurveyAuth.request(`/api/admin/users/${user.id}/permissions`);
    matrix = result.matrix;
  } catch (loadError) {
    card.replaceChildren(
      h('h3', {}, `Permissions — ${user.full_name || user.email}`),
      h('p', { class: 'form-error' }, loadError.message || 'Unable to read those permissions.')
    );
    return card;
  }

  const choices = new Map();
  const groups = new Map();
  matrix.forEach((row) => {
    const select = h(
      'select',
      { class: 'perm-choice' },
      h(
        'option',
        { value: 'default' },
        `Role default (${row.role_default ? 'allowed' : 'not allowed'})`
      ),
      h('option', { value: 'allow' }, 'Always allow'),
      h('option', { value: 'deny' }, 'Always deny')
    );
    select.value =
      row.override === null || row.override === undefined
        ? 'default'
        : row.override
          ? 'allow'
          : 'deny';
    select.dataset.key = row.key;
    choices.set(row.key, { select, was: select.value });
    select.onchange = () => countChanges();

    if (!groups.has(row.group)) groups.set(row.group, []);
    groups
      .get(row.group)
      .push(
        h(
          'div',
          { class: 'perm-row' },
          h(
            'div',
            { class: 'perm-text' },
            h('b', {}, row.label),
            row.description ? h('span', { class: 'mu' }, row.description) : ''
          ),
          select
        )
      );
  });

  const summary = h('span', { class: 'mu' }, 'No changes yet.');
  const save = h('button', { class: 'b p', type: 'button' }, 'Save permissions');

  const changed = () =>
    [...choices.values()]
      .filter((entry) => entry.select.value !== entry.was)
      .map((entry) => ({
        key: entry.select.dataset.key,
        granted: entry.select.value === 'default' ? null : entry.select.value === 'allow',
      }));
  function countChanges() {
    const n = changed().length;
    summary.textContent = n ? `${n} change${n === 1 ? '' : 's'} to save.` : 'No changes yet.';
    save.disabled = !n;
  }

  save.onclick = async () => {
    save.disabled = true;
    try {
      await window.SurveyAuth.request(`/api/admin/users/${user.id}/permissions`, {
        method: 'PUT',
        body: { permissions: changed() },
      });
      if (window.toast) window.toast('Permissions saved.');
      onClose();
    } catch (saveError) {
      error.textContent = saveError.message || 'Unable to save those permissions.';
      save.disabled = false;
    }
  };

  card.replaceChildren(
    h('h3', {}, `Permissions — ${user.full_name || user.email}`),
    h(
      'p',
      { class: 'mu' },
      `Held through the ${SERVER_ROLE_LABELS[user.role] || user.role} role. Changing a line here overrides the role for this person only, and it takes effect on their next request — no need to sign them out.`
    ),
    ...[...groups.entries()].map(([name, rows]) =>
      h('div', { class: 'perm-group' }, h('h4', {}, name), ...rows)
    ),
    error,
    h(
      'div',
      { class: 'row-actions' },
      save,
      h('button', { class: 'b', type: 'button', onclick: onClose }, 'Cancel'),
      summary
    )
  );
  countChanges();
  return card;
}

/* ---------- brief §15: removing an administrator and handing the system over ----------

   The screen states what the server is about to do before the button can work. The API re-checks the
   password, the phrase and the administrator count on every call, so none of what is drawn here is
   what actually protects the account — it protects the person from doing it by accident. */

const REMOVAL_WARNING =
  'Deleting your administrator account will permanently remove your access to SurveyPro. Your cases, reports, documents, staff accounts and business records will not automatically be deleted.';

async function ownershipOfferCard() {
  const { transfer } = await window.SurveyAuth.request('/api/ownership-transfer/pending');
  if (!transfer) return null;

  const message = h('p', { class: 'form-error', hidden: true });
  const answer = async (action, button) => {
    button.disabled = true;
    try {
      const result = await window.SurveyAuth.request(
        `/api/ownership-transfer/${transfer.id}/${action}`,
        { method: 'POST' }
      );
      if (window.toast) window.toast(result.message);
      /* Accepting changes this account's own role, so the whole screen has to be rebuilt rather than
         just removing the card. */
      await showProfilePage('account');
    } catch (error) {
      button.disabled = false;
      message.hidden = false;
      message.textContent = error.message || 'That offer could not be answered.';
    }
  };

  const accept = h('button', { class: 'b p', type: 'button' }, 'Accept ownership');
  const decline = h('button', { class: 'b', type: 'button' }, 'Decline');
  accept.onclick = () => answer('accept', accept);
  decline.onclick = () => answer('decline', decline);

  return h(
    'div',
    { class: 'account-card ownership-offer' },
    h('h3', {}, 'Administrative ownership is being offered to you'),
    h(
      'p',
      {},
      `${transfer.fromFullName || 'Another administrator'} (${transfer.fromEmail || 'no address'}) has handed you responsibility for SurveyPro. Accepting makes your account an administrator: you would be able to open and disable staff accounts, change permissions and see the audit log. Declining leaves everything as it is.`
    ),
    message,
    h('div', { class: 'account-actions' }, accept, decline)
  );
}

async function adminRemovalCard() {
  const [summary, roster] = await Promise.all([
    window.SurveyAuth.request('/api/admin/account-removal'),
    window.SurveyAuth.request('/api/admin/users'),
  ]);

  /* Cases are still this device's records, so the count the warning screen quotes has to say where it
     came from — it is the number on this browser, not a number off the server. */
  const localCases = typeof caseDirectoryRows === 'function' ? caseDirectoryRows().length : 0;
  const others = summary.otherAdmins || [];

  const password = h('input', {
    type: 'password',
    name: 'removal-password',
    autocomplete: 'current-password',
    placeholder: 'Your current password',
  });
  const phrase = h('input', {
    type: 'text',
    name: 'removal-phrase',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: 'DELETE MY ACCOUNT',
  });
  const message = h('p', { class: 'form-error', hidden: true });
  const remove = h('button', { class: 'b er', type: 'button' }, 'Delete my admin account');

  const say = (text) => {
    message.hidden = !text;
    message.textContent = text || '';
  };

  remove.onclick = async () => {
    remove.disabled = true;
    try {
      const result = await window.SurveyAuth.request('/api/admin/delete-my-account', {
        method: 'POST',
        body: { password: password.value, confirmText: phrase.value },
      });
      if (window.toast) window.toast(result.message);
      /* The server revoked this session while the account was being removed, so signing out here is
         only the client putting itself back at the door. */
      await window.SurveyAuth.logout();
    } catch (error) {
      remove.disabled = false;
      say(error.message || 'Your account was not deleted.');
    }
  };

  /* An eligible successor is what the server will accept, so the list is filtered by the same three
     rules — active, verified, Principal Surveyor or administrator. */
  const callerId = (getCurrentAuthUser() || {}).id;
  const eligible = (roster.users || []).filter(
    (user) =>
      user.is_active &&
      user.is_verified &&
      user.id !== callerId &&
      ['SURVEYOR', 'PRINCIPAL_SURVEYOR', 'ADMIN'].includes(String(user.role || '').toUpperCase())
  );
  const successor = h(
    'select',
    { name: 'ownership-successor' },
    h('option', { value: '' }, eligible.length ? 'Choose a user…' : 'No eligible user yet'),
    ...eligible.map((user) => h('option', { value: user.id }, `${user.full_name} — ${user.email}`))
  );
  const offer = h('button', { class: 'b', type: 'button' }, 'Offer ownership');
  const offerNote = h('p', { class: 'mu' }, '');

  offer.onclick = async () => {
    if (!successor.value) {
      say('Choose who should take administrative ownership.');
      return;
    }
    offer.disabled = true;
    try {
      const result = await window.SurveyAuth.request('/api/admin/ownership-transfer', {
        method: 'POST',
        body: { password: password.value, toUserId: successor.value },
      });
      say('');
      offerNote.textContent = result.message;
      successor.value = '';
    } catch (error) {
      say(error.message || 'The offer was not made.');
    } finally {
      offer.disabled = false;
    }
  };

  return h(
    'div',
    { class: 'account-card danger-zone' },
    h('h3', {}, 'Delete my admin account'),
    h('p', { class: 'danger-warning' }, REMOVAL_WARNING),
    h(
      'ul',
      { class: 'account-list' },
      h('li', {}, h('span', {}, 'Active users'), h('strong', {}, String(summary.activeUsers))),
      h('li', {}, h('span', {}, 'Cases on this device'), h('strong', {}, String(localCases))),
      h(
        'li',
        {},
        h('span', {}, 'Other administrators'),
        h('strong', {}, others.length ? others.map((admin) => admin.fullName).join(', ') : 'None')
      )
    ),
    h(
      'p',
      { class: 'mu' },
      summary.mayDelete
        ? summary.message
        : 'You are currently the only active administrator of SurveyPro. You must transfer administrative ownership to another eligible user before deleting your account.'
    ),
    h('div', { class: 'fld' }, h('label', {}, 'Confirm with your password'), password),
    h('div', { class: 'fld' }, h('label', {}, 'Type DELETE MY ACCOUNT to confirm'), phrase),
    message,
    h('div', { class: 'account-actions' }, remove),
    h('h4', {}, 'Transfer administrative ownership'),
    h(
      'p',
      { class: 'mu' },
      'Offer the role to a Principal Surveyor. Nothing changes until they sign in and accept, and they can decline.'
    ),
    h('div', { class: 'fld' }, h('label', {}, 'Eligible user'), successor),
    h('div', { class: 'account-actions' }, offer),
    offerNote
  );
}

async function showProfilePage(section = 'profile') {
  const authUser = getCurrentAuthUser();
  if (!authUser) {
    showDash();
    return;
  }

  syncAccountSidebarVisibility();
  const el = $('#dash');
  if (!el) return;

  const nav = h(
    'div',
    { class: 'account-nav' },
    h(
      'button',
      {
        class: 'b' + (section === 'profile' ? ' p' : ''),
        type: 'button',
        onclick: () => showProfilePage('profile'),
      },
      'My Profile'
    ),
    h(
      'button',
      {
        class: 'b' + (section === 'account' ? ' p' : ''),
        type: 'button',
        onclick: () => showProfilePage('account'),
      },
      'Account Settings'
    ),
    h(
      'button',
      {
        class: 'b' + (section === 'security' ? ' p' : ''),
        type: 'button',
        onclick: () => showProfilePage('security'),
      },
      'Security'
    ),
    h(
      'button',
      {
        class: 'b' + (section === 'activity' ? ' p' : ''),
        type: 'button',
        onclick: () => showProfilePage('activity'),
      },
      'Login Activity'
    ),
    h(
      'button',
      {
        class: 'b' + (section === 'admin-users' ? ' p' : ''),
        type: 'button',
        onclick: () => showProfilePage('admin-users'),
        hidden: String(authUser.role || '').toUpperCase() !== 'ADMIN',
      },
      'User Management'
    ),
    h(
      'button',
      {
        class: 'b' + (section === 'admin-audit' ? ' p' : ''),
        type: 'button',
        onclick: () => showProfilePage('admin-audit'),
        hidden: String(authUser.role || '').toUpperCase() !== 'ADMIN',
      },
      'Audit Log'
    ),
    h(
      'button',
      {
        class: 'b',
        type: 'button',
        onclick: showDash,
      },
      '← Dashboard'
    )
  );

  const pageShell = h('div', { class: 'account-page' }, nav);

  const renderLoading = () => {
    pageShell.append(
      h('div', { class: 'card' }, h('p', { class: 'mu' }, 'Loading account details…'))
    );
  };

  el.replaceChildren(pageShell);
  renderLoading();
  /* The section is what this screen was asked for, and it is the screen's only state — the fetch that
     fills it may fail, and a person who reloads on a failed Security page still belongs on Security. */
  rememberPlace({ v: 'account', section });

  try {
    if (section === 'profile') {
      const profile = await window.SurveyAuth.request('/api/profile/me');
      const user = profile.user || {};
      setProfileName(user.fullName || user.name);
      setProfileLicence(user.licenceNumber);
      const form = h(
        'form',
        { class: 'account-form' },
        h(
          'div',
          { class: 'account-grid' },
          h(
            'div',
            { class: 'account-card' },
            h('h3', {}, 'Profile overview'),
            h(
              'div',
              { class: 'account-hero' },
              h(
                'div',
                { class: 'account-avatar' },
                (user.fullName || user.name || user.email || 'U').charAt(0).toUpperCase()
              ),
              h(
                'div',
                {},
                h('h2', {}, user.fullName || user.name || 'Untitled user'),
                h('p', { class: 'mu' }, user.email || 'No email on file'),
                h(
                  'div',
                  { class: 'account-actions' },
                  h(
                    'span',
                    { class: 'pill ' + (user.emailVerified ? 'pr-ok' : 'pr-n') },
                    user.emailVerified ? 'Verified' : 'Unverified'
                  ),
                  h('span', { class: 'pill pr-m' }, user.role || 'User')
                )
              )
            )
          ),
          h(
            'div',
            { class: 'account-card' },
            h('h3', {}, 'Personal details'),
            h(
              'div',
              { class: 'account-row' },
              h(
                'div',
                { class: 'fld' },
                h('label', {}, 'First name'),
                h('input', { name: 'firstName', value: user.firstName || '' })
              ),
              h(
                'div',
                { class: 'fld' },
                h('label', {}, 'Last name'),
                h('input', { name: 'lastName', value: user.lastName || '' })
              ),
              h(
                'div',
                { class: 'fld' },
                h('label', {}, 'Email address'),
                h('input', {
                  name: 'email',
                  value: user.email || '',
                  readonly: 'readonly',
                  title: 'Email is your sign-in identity; change it under Account Settings.',
                }),
                h('small', { class: 'mu' }, 'Sign-in identity – edited under Account Settings.')
              ),
              h(
                'div',
                { class: 'fld' },
                h('label', {}, 'Phone number'),
                h('input', { name: 'phoneNumber', value: user.phoneNumber || '' })
              ),
              h(
                'div',
                { class: 'fld' },
                h('label', {}, 'Designation'),
                h('input', { name: 'designation', value: user.designation || '' })
              ),
              h(
                'div',
                { class: 'fld' },
                h('label', {}, 'Profile image URL'),
                h('input', { name: 'profileImageUrl', value: user.profileImageUrl || '' })
              )
            ),
            h(
              'div',
              { class: 'account-actions' },
              h('button', { class: 'b p', type: 'submit' }, 'Save profile')
            )
          ),
          h(
            'div',
            { class: 'account-card' },
            h('h3', {}, 'Surveyor credentials'),
            h(
              'div',
              { class: 'account-row' },
              h(
                'div',
                { class: 'fld' },
                h('label', {}, 'Surveyor’s licence number *'),
                h('input', {
                  name: 'licenceNumber',
                  required: 'required',
                  maxlength: '40',
                  placeholder: 'e.g. 1266/078/79',
                  value: user.licenceNumber || '',
                }),
                h(
                  'small',
                  { class: 'mu' },
                  'Required. Fills “Surveyor Licence No.” on every new case; you can still override it per case.'
                )
              ),
              h(
                'div',
                { class: 'fld' },
                h('label', {}, 'Licence expiry date'),
                h('input', {
                  type: 'date',
                  name: 'licenceExpiryDate',
                  value: user.licenceExpiryDate || '',
                })
              ),
              h(
                'div',
                { class: 'fld fld-wide' },
                h('label', {}, 'Address'),
                h('textarea', { name: 'address', rows: '3' }, user.address || '')
              )
            ),
            h(
              'div',
              { class: 'account-actions' },
              h('button', { class: 'b p', type: 'submit' }, 'Save profile')
            )
          )
        )
      );
      form.onsubmit = async (event) => {
        event.preventDefault();
        const payload = {};
        [...form.querySelectorAll('input, textarea')].forEach((el) => {
          if (el.name && !el.readOnly) payload[el.name] = el.value;
        });
        try {
          await window.SurveyAuth.request('/api/profile/me', { method: 'PATCH', body: payload });
          await showProfilePage('profile');
        } catch (error) {
          alert(error.message || 'Profile update failed.');
        }
      };
      pageShell.replaceChildren(nav, form);
      return;
    }

    if (section === 'account') {
      const settings = await window.SurveyAuth.request('/api/account/settings');
      const notifications = settings.notifications || {};
      const keys = ['emailAlerts', 'caseUpdates', 'securityAlerts', 'weeklyDigest'];
      const toggles = keys.map((key) =>
        h(
          'label',
          { class: 'account-toggle' },
          h(
            'span',
            {},
            key.replace(/([A-Z])/g, ' $1').replace(/^./, (str) => str.toUpperCase())
          ),
          h('input', { type: 'checkbox', checked: Boolean(notifications[key]) })
        )
      );
      const form = h(
        'form',
        { class: 'account-form' },
        h(
          'div',
          { class: 'account-grid' },
          h(
            'div',
            { class: 'account-card' },
            h('h3', {}, 'Account status'),
            h(
              'ul',
              { class: 'account-list' },
              h(
                'li',
                {},
                h('span', {}, 'Primary email'),
                h('strong', {}, settings.user && settings.user.email ? settings.user.email : '—')
              ),
              h('li', {}, h('span', {}, 'Role'), h('strong', {}, settings.role || 'User')),
              h(
                'li',
                {},
                h('span', {}, 'Google'),
                h('strong', {}, settings.googleConnected ? 'Connected' : 'Not connected')
              )
            )
          ),
          h(
            'div',
            { class: 'account-card' },
            h('h3', {}, 'Notification preferences'),
            h('div', { class: 'account-form' }, ...toggles),
            h(
              'div',
              { class: 'account-actions' },
              h('button', { class: 'b p', type: 'submit' }, 'Save preferences')
            )
          )
        )
      );
      form.onsubmit = async (event) => {
        event.preventDefault();
        const nextNotifications = {};
        keys.forEach((key) => {
          const input = form.querySelectorAll('input[type="checkbox"]')[keys.indexOf(key)];
          nextNotifications[key] = !!(input && input.checked);
        });
        try {
          await window.SurveyAuth.request('/api/account/settings', {
            method: 'PATCH',
            body: { notifications: nextNotifications },
          });
          await showProfilePage('account');
        } catch (error) {
          alert(error.message || 'Unable to update preferences.');
        }
      };
      /* Two more cards, both about who controls the system rather than about this person's own
         preferences, so both are read after the settings form is already on screen and neither may
         take the settings down with it if the lookup fails. */
      const extra = [];
      try {
        const offer = await ownershipOfferCard();
        if (offer) extra.push(offer);
      } catch {
        /* A member with no outstanding offer and no way to read one just sees the settings. */
      }
      if (normalizeServerRole(authUser.role) === 'ADMIN') {
        try {
          extra.push(await adminRemovalCard());
        } catch (error) {
          extra.push(
            h(
              'div',
              { class: 'account-card danger-zone' },
              h('h3', {}, 'Delete my admin account'),
              h(
                'p',
                { class: 'mu' },
                error.message || 'The account-removal check could not be read right now.'
              )
            )
          );
        }
      }
      pageShell.replaceChildren(nav, form, ...extra);
      return;
    }

    if (section === 'security') {
      const [sessionData, activityData] = await Promise.all([
        window.SurveyAuth.request('/api/security/sessions'),
        window.SurveyAuth.request('/api/security/login-activity'),
      ]);
      const sessions = (sessionData && sessionData.sessions) || [];
      const entries = (activityData && activityData.entries) || [];

      const sessionRows = sessions.map((session) =>
        h(
          'tr',
          { class: session.isCurrent ? 'sec-current' : '' },
          h(
            'td',
            {},
            h('div', { class: 'sec-device' }, securityDeviceLabel(session)),
            h('div', { class: 'sec-sub' }, session.ipAddress || 'Unknown'),
            session.isCurrent ? h('span', { class: 'sec-tag is-current' }, 'This device') : null
          ),
          h('td', {}, securityTime(session.createdAt)),
          h('td', {}, securityTime(session.lastActiveAt)),
          h(
            'td',
            { class: 'sec-action' },
            session.isCurrent
              ? h('span', { class: 'mu' }, 'In use')
              : h(
                  'button',
                  {
                    class: 'b',
                    type: 'button',
                    onclick: async () => {
                      try {
                        await window.SurveyAuth.request(
                          `/api/security/revoke-session/${session.id}`,
                          { method: 'POST' }
                        );
                        await showProfilePage('security');
                      } catch (error) {
                        alert(error.message || 'Unable to sign this device out.');
                      }
                    },
                  },
                  'Sign out'
                )
          )
        )
      );

      const policy = (sessionData && sessionData.policy) || {};
      const cards = h(
        'div',
        { class: 'account-grid' },
        h(
          'div',
          { class: 'account-card' },
          h('h3', {}, 'Active sessions'),
          h(
            'p',
            { class: 'mu' },
            policy.sessionHours
              ? `Showing the latest ${sessions.length || 0} of your active sessions. Sessions last ${policy.sessionHours} hours, or ${policy.rememberMeDays} days when you tick Keep me logged in.`
              : 'Showing your latest active sessions.'
          ),
          sessionRows.length
            ? h(
                'table',
                { class: 'account-table sec-table' },
                h(
                  'thead',
                  {},
                  h(
                    'tr',
                    {},
                    h('th', {}, 'Device'),
                    h('th', {}, 'Signed in'),
                    h('th', {}, 'Last active'),
                    h('th', {}, '')
                  )
                ),
                h('tbody', {}, ...sessionRows)
              )
            : h('p', { class: 'mu' }, 'No active sessions found.')
        ),
        h(
          'div',
          { class: 'account-card' },
          h('h3', {}, 'Security controls'),
          h(
            'div',
            { class: 'account-actions' },
            h(
              'button',
              {
                class: 'b p',
                type: 'button',
                onclick: async () => {
                  try {
                    const result = await window.SurveyAuth.request('/api/security/logout-others', {
                      method: 'POST',
                    });
                    toast(result && result.message ? result.message : 'Other sessions signed out.');
                    await showProfilePage('security');
                  } catch (error) {
                    alert(error.message || 'Unable to sign out other devices.');
                  }
                },
              },
              'Sign out of all other devices'
            )
          ),
          h(
            'p',
            { class: 'mu' },
            'Changing your password signs every device out. Sign out ends only this session.'
          )
        )
      );
      const activityCard = buildSecurityActivityCard(
        entries,
        'The latest five security events recorded on this account.'
      );
      pageShell.replaceChildren(nav, cards, activityCard);
      return;
    }

    if (section === 'activity') {
      const activityData = await window.SurveyAuth.request('/api/security/login-activity');
      pageShell.replaceChildren(
        nav,
        buildSecurityActivityCard(
          (activityData && activityData.entries) || [],
          'The latest five security events recorded on this account. Sign-in failures and new devices are highlighted.'
        )
      );
      return;
    }

    if (section === 'admin-users') {
      if (!mayUse('manage_users', normalizeServerRole(authUser.role) === 'ADMIN')) {
        pageShell.replaceChildren(
          nav,
          h(
            'div',
            { class: 'card' },
            h('h3', { class: 'er' }, 'Not permitted'),
            h('p', { class: 'mu' }, 'This account has not been granted access to user management.')
          )
        );
        return;
      }
      const mayEditPermissions = mayUse(
        'manage_permissions',
        normalizeServerRole(authUser.role) === 'ADMIN'
      );
      const users = await window.SurveyAuth.request('/api/admin/users');
      const formSlot = h('div', {});
      const list = h('div', { class: 'account-table-scroll' });
      const refresh = async () => {
        const fresh = await window.SurveyAuth.request('/api/admin/users');
        list.replaceChildren(
          adminUserTable(fresh && fresh.users, mayEditPermissions ? openPermissions : null)
        );
      };
      const closeForm = () => {
        formSlot.replaceChildren();
        toggleBtn.textContent = 'Add new user';
      };

      /* One slot, two forms. Opening either replaces the other, because two half-filled editors
         about different members is how a wrong account gets saved. */
      const openPermissions = async (user) => {
        formSlot.replaceChildren(
          h('div', { class: 'account-card' }, h('p', { class: 'mu' }, 'Loading permissions…'))
        );
        toggleBtn.textContent = 'Cancel';
        formSlot.replaceChildren(await adminPermissionEditor(user, { onClose: closeForm }));
      };

      let panel = null;
      const toggle = () => {
        if (panel) {
          closeForm();
          panel = null;
          return;
        }
        /* Rebuilt every time it opens, so a cancelled form never carries the previous half-typed
           member over to the next one. */
        panel = adminCreateUserForm({
          onDone: refresh,
          onClose: () => {
            closeForm();
            panel = null;
          },
        });
        formSlot.replaceChildren(panel);
        toggleBtn.textContent = 'Cancel';
        const first = formSlot.querySelector('input');
        if (first) first.focus();
      };
      const toggleBtn = h(
        'button',
        { class: 'b p', type: 'button', onclick: toggle },
        'Add new user'
      );
      list.replaceChildren(
        adminUserTable(users && users.users, mayEditPermissions ? openPermissions : null)
      );
      pageShell.replaceChildren(
        nav,
        formSlot,
        h(
          'div',
          { class: 'account-card' },
          h('div', { class: 'account-head' }, h('h3', {}, 'User management'), toggleBtn),
          list
        )
      );
      return;
    }

    if (section === 'admin-audit') {
      if (String(authUser.role || '').toUpperCase() !== 'ADMIN') {
        pageShell.replaceChildren(
          nav,
          h(
            'div',
            { class: 'card' },
            h('h3', { class: 'er' }, 'Admin access required'),
            h('p', { class: 'mu' }, 'This section is available only to administrators.')
          )
        );
        return;
      }
      const audit = await window.SurveyAuth.request('/api/admin/audit-logs');
      const table = h(
        'div',
        { class: 'account-card' },
        h('h3', {}, 'Administrative audit log'),
        audit && audit.logs && audit.logs.length
          ? h(
              'table',
              { class: 'account-table' },
              h(
                'thead',
                {},
                h(
                  'tr',
                  {},
                  h('th', {}, 'When'),
                  h('th', {}, 'Action'),
                  h('th', {}, 'Actor'),
                  h('th', {}, 'Target')
                )
              ),
              h(
                'tbody',
                {},
                ...audit.logs.map((entry) =>
                  h(
                    'tr',
                    {},
                    h(
                      'td',
                      {},
                      entry.created_at ? new Date(entry.created_at).toLocaleString() : '—'
                    ),
                    h('td', {}, entry.action || 'unknown'),
                    h('td', {}, entry.actor_name || 'System'),
                    h('td', {}, entry.target_name || '—')
                  )
                )
              )
            )
          : h('p', { class: 'mu' }, 'No audit entries yet.')
      );
      pageShell.replaceChildren(nav, table);
      return;
    }
  } catch (error) {
    pageShell.replaceChildren(
      nav,
      h(
        'div',
        { class: 'card' },
        h('h3', { class: 'er' }, 'Account page failed to load'),
        h('p', { class: 'mu' }, String(error && error.message ? error.message : error)),
        h(
          'button',
          { class: 'b p', type: 'button', onclick: () => showProfilePage(section) },
          'Retry'
        )
      )
    );
  }
}

/* Read-only admin view of the NIA licensee list that the Insurance company field draws from,
   with each entry's live case count so a master is never edited blind. */
function showInsurerMaster() {
  const el = $('#dash');
  if (!el) return;
  view = 'page';
  el.hidden = false;
  el.classList.remove('dash-cases');
  $('.app').hidden = true;
  ['#cs', '#del', '#dx'].forEach((s) => ($(s).hidden = true));
  $('#cm').hidden = true;
  $('#ct').hidden = true;

  const rows = caseDirectoryRows();
  const used = (x) => rows.filter((r) => acInsMatch(r.c.f ? r.c.f.case_company : '', x.m)).length;
  const licence = (c) => (c === 'nl' ? 'Non-life' : c === 'mn' ? 'Micro non-life' : c);
  const label = h('input', {
    type: 'text',
    placeholder: 'Filter by name, licence or alias…',
    'aria-label': 'Filter insurer master',
    oninput: draw,
  });
  const body = h('tbody');

  function draw() {
    const q = ns(label.value);
    const list = NIA_NONLIFE.filter(
      (x) => !q || [x.m, x.n, x.s, ...(x.a || [])].filter(Boolean).some((k) => ns(k).includes(q))
    );
    body.replaceChildren(
      ...list.map((x) =>
        h(
          'tr',
          {},
          h('td', {}, x.m),
          h('td', {}, x.n),
          h('td', {}, x.s || '—'),
          h('td', {}, licence(x.c)),
          h('td', {}, (x.a || []).join(', ') || '—'),
          h('td', {}, String(used(x)))
        )
      )
    );
    count.textContent = `${list.length} of ${NIA_NONLIFE.length} licensee${
      NIA_NONLIFE.length === 1 ? '' : 's'
    }`;
  }

  const count = h('span', { class: 'mu' });
  el.replaceChildren(
    h(
      'div',
      { class: 'account-page' },
      h(
        'div',
        { class: 'account-nav' },
        label,
        count,
        h('button', { class: 'b', type: 'button', onclick: showDash }, '← Dashboard')
      ),
      h(
        'div',
        { class: 'card' },
        h('h3', { style: 'margin-top:0' }, 'Insurer master'),
        h(
          'p',
          { class: 'mu' },
          'Nepal Insurance Authority licensed non-life and micro non-life companies. This list fills the Insurance company field on every case; it is maintained centrally and is read-only here.'
        ),
        h(
          'table',
          { class: 'at' },
          h(
            'thead',
            {},
            h(
              'tr',
              {},
              ...[
                'Master name',
                'Legal name',
                'Code',
                'Licence',
                'Former / merged names',
                'Cases',
              ].map((t) => h('th', {}, t))
            )
          ),
          body
        )
      )
    )
  );
  draw();
  window.scrollTo(0, 0);
  rememberPlace();
}

function drawDash() {
  applyAccountRole();
  syncAccountSidebarVisibility();
  /* The bell lives in the app shell (22-header.js); 11-dashboard.js loads before it, so the call
     is guarded rather than assumed. */
  if (typeof syncNotifBadge === 'function') syncNotifBadge();
  const el = $('#dash'),
    run = () => {
      try {
        buildDash();
      } catch (e) {
        el.replaceChildren(
          h(
            'div',
            { class: 'card' },
            h('h3', { class: 'er' }, 'Could not load the dashboard'),
            h('p', { class: 'mu' }, String((e && e.message) || e)),
            h('button', { class: 'b p', onclick: drawDash }, 'Retry')
          )
        );
      }
    };
  if (!dashOnce) {
    dashOnce = 1;
    el.replaceChildren(h('div', { class: 'card' }, h('p', { class: 'mu' }, 'Loading dashboard…')));
    setTimeout(run, 40);
  } else run();
}

function buildDash() {
  $('#rl').textContent = cfg.role + ' · ' + cfg.me;
  const el = $('#dash'),
    V = caseDirectoryRows();
  const setF = (k, s) => {
      FL.k = k;
      FL.s = s;
      drawDash();
    },
    fl = FL.k
      ? (KP.find((x) => x[0] === FL.k) || [
          0,
          {
            p_up: 'Preliminary: upcoming',
            p_soon: 'Preliminary: due ≤ 3 days',
            p_od: 'Preliminary: overdue',
            p_ok: 'Preliminary: submitted',
            f_up: 'Final: upcoming',
            f_soon: 'Final: due ≤ 3 days',
            f_od: 'Final: overdue',
            f_ok: 'Final: submitted',
          }[FL.k],
        ])[1]
      : FL.s;
  const rowsF = () => {
    const q = FL.q.toLowerCase(),
      tab = FL.t || 'all';
    return V.map((r) => ({ ...r, p: pri(r.c), d: dueOf(r.c) }))
      .filter(
        (r) =>
          (!FL.s || r.c.st === FL.s) &&
          (!FL.k || FT[FL.k](r.c)) &&
          AT_TABS.find((x) => x[0] === tab)[2](r) &&
          (tab !== 'all' || FL.k === 'tot' || FL.s === 'Survey Complete' || act(r.c)) &&
          (!q || (r.id + r.who + r.ref).toLowerCase().includes(q))
      )
      .sort((a, b) => a.p[2] - b.p[2] || ((a.d || '9') < (b.d || '9') ? -1 : 1));
  };
  /* One label list, used by the header cells and by the data-label attributes the phone layout
     turns into per-row captions – so the two can never drift apart. */
  const AT_H = [
    'Case no.',
    'Insured / vehicle',
    'Current stage',
    'Next required action',
    'Preliminary deadline',
    'Final deadline',
    'Priority',
    'Action',
  ];
  const tbl = () => {
    const R = rowsF();
    return R.length
      ? h(
          'table',
          { class: 'at' },
          h('thead', {}, h('tr', {}, ...AT_H.map((x) => h('th', {}, x)))),
          h(
            'tbody',
            {},
            ...R.map((r) => {
              const c = r.c,
                i = STG.indexOf(c.st),
                td = (n, ...kids) => h('td', { 'data-label': AT_H[n] }, ...kids);
              return h(
                'tr',
                { class: 'rw', onclick: () => openCase(c.id) },
                td(0, coverThumb(r.c.id, r.id), h('b', {}, r.id)),
                td(1, r.who + ' · ' + r.ref),
                td(2, h('span', { class: 'pill', style: 'color:' + STC[i] }, c.st)),
                td(3, NXT[i]),
                td(4, chip(dl(c, 'p'))),
                td(5, chip(dl(c, 'f'))),
                td(6, h('span', { class: 'pill ' + r.p[1] }, r.p[0])),
                td(
                  7,
                  h(
                    'button',
                    {
                      type: 'button',
                      class: 'b',
                      onclick: (e) => {
                        e.stopPropagation();
                        openCase(c.id);
                      },
                    },
                    'View'
                  ),
                  h(
                    'span',
                    { class: 'at-dots-wrap' },
                    h(
                      'button',
                      {
                        type: 'button',
                        class: 'ac2-dots at-dots',
                        'aria-haspopup': 'menu',
                        'aria-expanded': 'false',
                        'aria-label': 'More actions for ' + r.id,
                        onclick: (e) => {
                          e.stopPropagation();
                          actMenu(e.currentTarget, r);
                        },
                      },
                      '⋮'
                    )
                  )
                )
              );
            })
          )
        )
      : h(
          'p',
          { class: 'mu' },
          V.length ? 'No cases match this view.' : 'No cases yet – click “+ New case” to start.'
        );
  };
  const sq = h('input', {
      class: 'at-search',
      placeholder: 'Search case no., insured, vehicle / location…',
      'aria-label': 'Search cases',
      value: FL.q || allCasesState.q,
    }),
    tw = h('div', { class: 'tbs' }, tbl());
  sq.oninput = () => {
    /* One term for both surfaces: the Action list filters live here, All Cases and the header
       re-read it on their next render. */
    FL.q = allCasesState.q = sq.value;
    acPersist();
    tw.replaceChildren(tbl());
  };
  const tabs = h(
    'div',
    { class: 'at-tabs', role: 'tablist', 'aria-label': 'Action required filters' },
    ...AT_TABS.map(([k, l, f]) => {
      const R = V.map((r) => ({ ...r, p: pri(r.c) })).filter((r) => f(r));
      return h(
        'button',
        {
          type: 'button',
          role: 'tab',
          class: 'ac2-chip' + ((FL.t || 'all') === k ? ' on' : ''),
          'aria-selected': String((FL.t || 'all') === k),
          onclick: () => {
            FL.t = FL.t === k ? '' : k;
            drawDash();
          },
        },
        l,
        h('b', {}, String(R.length))
      );
    })
  );
  const dm = (k, t, days) => {
    const ct = (n, l, cl, key) =>
        h(
          'button',
          { class: 'ct ' + cl, onclick: () => setF(FL.k === key ? '' : key, '') },
          h('b', {}, n),
          l
        ),
      /* dl() already ranks the three states, so the list and the four counters above it share one
         source. A submitted report has left=null and drops out: it can never be overdue. */
      near = V.filter((r) => pend(r.c, k) && dl(r.c, k).left != null)
        .sort((a, b) => dl(a.c, k).left - dl(b.c, k).left)
        .slice(0, 3);
    return h(
      'div',
      { class: 'card dmc' },
      h('h4', {}, `${t} · ${days} days${cfg.cnt === 'wk' ? ' (working days)' : ''}`),
      h(
        'div',
        { class: 'row4' },
        ct(V.filter((r) => FT[k + '_up'](r.c)).length, 'Upcoming', '', k + '_up'),
        ct(V.filter((r) => FT[k + '_soon'](r.c)).length, 'Due ≤ 3 d', 'wn', k + '_soon'),
        ct(V.filter((r) => FT[k + '_od'](r.c)).length, 'Overdue', 'er', k + '_od'),
        ct(V.filter((r) => FT[k + '_ok'](r.c)).length, 'Submitted', '', k + '_ok')
      ),
      h(
        'div',
        { class: 'dl-nearest' },
        h('h5', {}, 'Next three deadlines'),
        near.length
          ? h(
              'ul',
              {},
              ...near.map((r) => {
                const d = dl(r.c, k);
                return h(
                  'li',
                  {
                    class: d.od ? 'er' : d.left <= 3 ? 'wn' : '',
                    onclick: () => openCase(r.c.id),
                    title: 'Open ' + r.id,
                  },
                  h('b', {}, r.id),
                  h('span', { class: 'who' }, r.who),
                  h('span', { class: 'stg' }, r.c.st),
                  h('span', { class: 'left' }, d.txt)
                );
              })
            )
          : h('p', { class: 'mu' }, 'No open deadlines.')
      )
    );
  };
  const accountRole = normalizeServerRole((getCurrentAuthUser() || {}).role);
  const fs = (l, i) => h('div', { class: 'setting-field' }, h('label', {}, l), i),
    /* The settings and the preview switch follow the account, not the view being looked at: an
       administrator previewing the staff layout must still be able to edit the deadlines, and a
       staff member must not be able to move either by touching anything here. */
    ro = accountRole !== 'ADMIN',
    rs = h('select', {}, ...ROLE_VIEWS.map((x) => h('option', { value: x }, x))),
    nmI = h('input', { maxlength: '60' }),
    pdI = h('input', { type: 'number', min: '1', max: '365' }),
    fdI = h('input', { type: 'number', min: '1', max: '365' }),
    cn = h(
      'select',
      {},
      h('option', { value: 'cal' }, 'Calendar days'),
      h('option', { value: 'wk' }, 'Working days (excl. Saturday)')
    );
  rs.value = cfg.role;
  rs.disabled = ro;
  nmI.value = cfg.me;
  nmI.disabled = ro;
  pdI.value = cfg.pd;
  fdI.value = cfg.fd;
  cn.value = cfg.cnt;
  pdI.disabled = fdI.disabled = cn.disabled = ro;
  rs.onchange = () => {
    cfg.role = rs.value;
    saveCfg();
    FL.k = FL.s = '';
    hdr();
    drawDash();
  };
  nmI.onchange = () => {
    cfg.me = nmI.value.trim() || 'Surveyor';
    saveCfg();
    drawDash();
  };
  pdI.onchange = () => {
    cfg.pd = Math.min(365, Math.max(1, +pdI.value || 15));
    saveCfg();
    drawDash();
  };
  fdI.onchange = () => {
    cfg.fd = Math.min(365, Math.max(1, +fdI.value || 60));
    saveCfg();
    drawDash();
  };
  cn.onchange = () => {
    cfg.cnt = cn.value;
    saveCfg();
    drawDash();
  };
  el.replaceChildren(
    h(
      'div',
      { class: 'dh' },
      h(
        'div',
        {},
        h('h1', {}, 'Claims dashboard'),
        h('p', { class: 'dh-sub' }, 'Overview of your insurance survey cases'),
        h(
          'div',
          { class: 'dh-meta' },
          h(
            'span',
            { class: 'mu' },
            new Date().toLocaleDateString('en-GB', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            }) +
              ' · ' +
              new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
          ),
          h(
            'span',
            { class: 'pill pr-m' },
            cfg.role + ' · ' + cfg.me + (cfg.role === 'Staff' ? ' (own cases)' : ' (all cases)')
          )
        )
      )
    ),
    h(
      'div',
      { class: 'kp' },
      ...KP.map(([k, l, c, ic, t]) =>
        h(
          'button',
          {
            type: 'button',
            class: 'k' + (FL.k === k ? ' on' : ''),
            style: '--c:' + c,
            title: 'Filter the list below to ' + l.toLowerCase(),
            onclick: () => setF(FL.k === k ? '' : k, ''),
          },
          h(
            'span',
            { class: 'k-top' },
            h('span', { class: 'k-ic' }, ic),
            h('span', { class: 'k-go' }, '→')
          ),
          h('b', {}, V.filter((r) => t(r.c)).length),
          h('span', { class: 'k-l' }, l)
        )
      )
    ),
    h(
      'div',
      { class: 'card' },
      h('h3', { style: 'margin-top:0' }, 'Report deadline monitoring'),
      h(
        'div',
        { class: 'dm' },
        dm('p', 'Preliminary report', cfg.pd),
        dm('f', 'Final report', cfg.fd)
      ),
      h(
        'p',
        { class: 'mu' },
        'Deadlines count from each case’s intimation / assignment date. Submitted reports show their submission date instead of a countdown.'
      )
    ),
    h(
      'div',
      { class: 'card' },
      h(
        'div',
        { class: 'bar', style: 'margin-top:0' },
        h('h3', { style: 'margin:0' }, 'Claim settlement workflow'),
        h(
          'span',
          { class: 'mu' },
          'Filled = cases at this stage · red ring = overdue · click a stage to list its cases'
        )
      ),
      h(
        'div',
        { class: 'wf-scroll' },
        h(
          'ol',
          { class: 'wf' },
          ...STG.map((s, i) => {
            const L = V.filter((r) => r.c.st === s),
              od = L.some(
                (r) =>
                  act(r.c) &&
                  ((pend(r.c, 'p') && dl(r.c, 'p').od) || (pend(r.c, 'f') && dl(r.c, 'f').od))
              );
            return h(
              'li',
              {
                class:
                  (L.length ? (od ? 'od' : i === 10 ? 'dn' : 'cur') : '') +
                  (FL.s === s ? ' on' : ''),
                style: '--c:' + STC[i],
                title: L.length + ' case' + (L.length === 1 ? '' : 's') + ' at ' + s,
                onclick: () => setF('', FL.s === s ? '' : s),
              },
              h('span', { class: 'dot' }, h('b', {}, L.length)),
              h('span', { class: 'lab' }, s)
            );
          })
        )
      )
    ),
    h(
      'div',
      { class: 'at-grid' },
      h(
        'div',
        { class: 'card act-card' },
        h(
          'div',
          { class: 'bar', style: 'margin-top:0' },
          h('h3', { style: 'margin:0' }, 'Action required' + (fl ? ' – ' + fl : '')),
          fl ? h('button', { class: 'b', onclick: () => setF('', '') }, '✕ Clear filter') : '',
          sq
        ),
        tabs,
        tw
      ),
      h(
        'div',
        { class: 'card rv-card' },
        h('h3', { style: 'margin-top:0' }, 'Recent activity'),
        (() => {
          const A = activityEntries(V, 8);
          return h(
            'div',
            {},
            A.length
              ? h(
                  'ul',
                  { class: 'rv-list' },
                  ...A.map((a) =>
                    h(
                      'li',
                      { class: a.cl, onclick: () => openCase(a.cid), title: 'Open ' + a.id },
                      h('span', { class: 'rv-txt' }, a.txt),
                      h('b', {}, a.id),
                      h('span', { class: 'rv-who' }, a.who),
                      h(
                        'span',
                        { class: 'rv-when' },
                        ago(a.t) + ' · ' + dtf(new Date(a.t).toISOString().slice(0, 10))
                      )
                    )
                  )
                )
              : h('p', { class: 'mu' }, 'No stage changes recorded yet.'),
            h(
              'p',
              { class: 'mu rv-note' },
              'From each case’s own stage log. The name is its assigned surveyor – the app does not record who made the change.'
            )
          );
        })()
      )
    ),
    h('div', { class: 'chart-grid' }, buildIntimationsChart(rowsF()), buildInsurerDonut(V)),
    h(
      'details',
      { class: 'card settings-panel' },
      h(
        'summary',
        { class: 'settings-summary' },
        h('span', { class: 'settings-summary-title' }, 'Role & settings'),
        h('span', { class: 'settings-summary-pill' }, 'Preferences')
      ),
      h(
        'div',
        { class: 'settings-body' },
        h(
          'div',
          { class: 'settings-grid' },
          fs(ro ? 'Your role' : 'Preview the layout for', rs),
          fs('My name (cases assigned to me)', nmI),
          fs('Preliminary report deadline (days)', pdI),
          fs('Final report deadline (days)', fdI),
          fs('Counting rule', cn),
          signUI()
        ),
        h(
          'p',
          { class: 'settings-note' },
          ro
            ? 'Your dashboard follows the role on your SurveyPro account, and the server checks it on every request. Ask an administrator to change it.'
            : 'Admin: all cases, deadline settings, delete. Principal Surveyor: all cases and reassignment. Staff: only cases assigned to them. This switch only changes what you see; it does not change anyone else’s access.'
        )
      )
    )
  );
}

function setMenu(k) {
  document.querySelectorAll('#side .mi').forEach((b) => b.classList.toggle('on', b.id === k));
  $('#side').classList.remove('open');
}

const SRCN = {
  fp_mm: 'Policy make & model',
  acc_vehicles: 'Third parties on this case',
  d1_med: 'Bills & expenses',
  d2_med: 'Bills & expenses',
  case_surveyor: 'Your account profile',
  case_lic: 'Your account profile',
};

function autofill() {
  const ch = [];
  Dd.auto = Dd.auto || {};
  Dd.man = Dd.man || {};
  Dd.afn = Dd.afn || {};
  (MOD.links || []).forEach(([t, ...src]) => {
    let v = '',
      w = '';
    for (const x of src) {
      v = String(typeof x === 'function' ? x() : g(x) || '').trim();
      if (v) {
        w = x;
        break;
      }
    }
    const f = FM[t];
    if (!v || !f || hid(f)) return;
    const c = g(t);
    if (Dd.man[t] || (c && c !== Dd.auto[t])) return;
    if (c !== v) {
      const sk = typeof w === 'string' && FM[w] ? w : '',
        sc = sk ? SECS.find((s) => s.k === sk.split('_')[0]) : null,
        sn = sk ? (sc ? sc.t + ' › ' : '') + FM[sk].l : SRCN[t] || 'earlier entries';
      Dd.f[t] = v;
      Dd.auto[t] = v;
      Dd.afn[t] = { s: sn, t: Date.now(), u: !!c };
      ch.push(t);
    }
  });
  ch.forEach((t) => {
    const e = document.getElementById('f_' + t);
    if (e) {
      if (e.type === 'checkbox') e.checked = Dd.f[t] === 'Yes';
      else e.value = Dd.f[t];
      e.classList.add('fup');
      setTimeout(() => e.classList.remove('fup'), 1800);
    }
  });
  if (ch.includes('case_hasTP')) syncNav();
  return ch.length;
}

function toast(t) {
  let e = $('#toast');
  if (!e) {
    e = h('div', { id: 'toast', class: 'toast' });
    document.body.append(e);
  }
  e.textContent = '↺ ' + t;
  e.classList.add('on');
  clearTimeout(e._t);
  e._t = setTimeout(() => e.classList.remove('on'), 2600);
}

function delBtn(c) {
  const b = h('button', { class: 'b', type: 'button', title: 'Delete this case' }, '🗑 Delete');
  let a = 0,
    t;
  b.onclick = (e) => {
    e.stopPropagation();
    if (!a) {
      a = 1;
      b.textContent = 'Confirm delete?';
      b.classList.add('er');
      t = setTimeout(() => {
        a = 0;
        b.textContent = '🗑 Delete';
        b.classList.remove('er');
      }, 3500);
      return;
    }
    clearTimeout(t);
    delCase(c.id);
  };
  return b;
}

async function delCase(id) {
  try {
    const all = (await pdb('readonly', (s) => s.getAll())) || [];
    await Promise.all(all.filter((p) => p.cid === id).map((p) => del(p.id)));
  } catch {}
  delete DB[id];
  if (cur === id) {
    cur = null;
    PH = [];
  }
  ST.s('sp.db', JSON.stringify(DB));
  ST.s('sp.cur', cur || '');
  /* A deletion is a change to send like any other, and this one does not go through sv(). */
  if (window.syncSchedule) syncSchedule(500);
  $('#sv').textContent = '✓ Case deleted';
  hdr();
  drawDash();
}
