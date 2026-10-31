/* Settings (cfg), deadlines, KPIs, case tracking, dashboard, autofill, delete case
   Loaded as a classic script: everything here shares the global scope. Order of <script> tags in index.html matters. */

const cfg = Object.assign(
    { role: 'Admin', me: 'Surveyor', pd: 15, fd: 60, cnt: 'cal' },
    (() => {
      try {
        return JSON.parse(ST.g('sp.cfg') || '{}');
      } catch {
        return {};
      }
    })()
  ),
  saveCfg = () => ST.s('sp.cfg', JSON.stringify(cfg));

Object.values(DB).forEach((c) => {
  if (!STG.includes(c.st)) c.st = OLDMAP[c.st] || 'Intimation';
  c.owner = c.owner || cfg.me;
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

const dN = (s) => Math.floor(Date.parse(s) / 864e5),
  iso = (n) => new Date(n * 864e5).toISOString().slice(0, 10),
  tdN = () => dN(today()),
  vc = () => Object.values(DB).filter((c) => cfg.role !== 'Staff' || c.owner === cfg.me);

function addD(s, n) {
  let d = dN(s);
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

const KP = [
    ['tot', 'Total cases', '#0b5fa5', (c) => true],
    ['act', 'Active cases', '#1d4ed8', act],
    ['new', 'New intimations', '#0b7fa5', (c) => c.st === 'Intimation'],
    [
      'insp',
      'Inspections due',
      '#7c3aed',
      (c) => ['Initial Review', 'Physical Inspection'].includes(c.st),
    ],
    ['doc', 'Documents pending', '#c2410c', (c) => c.st === 'Document Collection'],
    ['pp', 'Preliminary reports pending', '#0f766e', (c) => pend(c, 'p')],
    ['fp', 'Final reports pending', '#2563eb', (c) => pend(c, 'f')],
    ['rect', 'Rectifications pending', '#b45309', (c) => c.st === 'Rectification'],
    [
      'od',
      'Overdue cases',
      '#b91c1c',
      (c) => act(c) && ((pend(c, 'p') && dl(c, 'p').od) || (pend(c, 'f') && dl(c, 'f').od)),
    ],
  ],
  FT = {};

KP.forEach(([k, , , t]) => (FT[k] = t));

['p', 'f'].forEach((k) => {
  FT[k + '_up'] = (c) => pend(c, k) && !dl(c, k).od;
  FT[k + '_soon'] = (c) =>
    pend(c, k) && !dl(c, k).od && dl(c, k).left != null && dl(c, k).left <= 3;
  FT[k + '_od'] = (c) => pend(c, k) && dl(c, k).od;
  FT[k + '_ok'] = (c) => !!(k === 'p' ? c.pSub : c.fSub);
});

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
      {},
      h('b', {}, `Preliminary (${cfg.pd} d): `),
      h('span', { class: 'pill ' + p.cl }, p.txt),
      p.due ? ` due ${dtf(p.due)}` : '',
      '   ',
      h('b', {}, `Final (${cfg.fd} d): `),
      h('span', { class: 'pill ' + fl.cl }, fl.txt),
      fl.due ? ` due ${dtf(fl.due)}` : ''
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
  $('#del').hidden = cfg.role === 'Staff';
  $('#cm').hidden = false;
  setMenu('');
  load(id);
  sec = 'case';
  hdr();
  sv(1);
  render();
}

let dashOnce = 0,
  chartPeriod = 'month',
  allCasesState = { q: '', stage: 'all', type: 'all', owner: 'all', sort: 'priority' };

function monthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function weekKey(d) {
  const copy = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = copy.getUTCDay();
  const diff = (day + 6) % 7;
  copy.setUTCDate(copy.getUTCDate() - diff);
  return `${copy.getUTCFullYear()}-${String(copy.getUTCMonth() + 1).padStart(2, '0')}-${String(copy.getUTCDate()).padStart(2, '0')}`;
}

function caseArrivalDate(c) {
  return new Date(c.asg || c.cr || c.u || Date.now());
}

function buildCasesTrendChart(V, period = chartPeriod, months = 6) {
  const buckets = new Map();
  const now = new Date();
  const data = [];

  const makeLabel = (date, key) => {
    if (period === 'week') {
      return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    }
    return date.toLocaleDateString('en-GB', { month: 'short' });
  };

  if (period === 'week') {
    for (let i = months * 4 - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i * 7);
      const start = new Date(d);
      start.setHours(0, 0, 0, 0);
      const k = weekKey(start);
      buckets.set(k, { key: k, label: makeLabel(start, k), value: 0, start });
    }
  } else {
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const k = monthKey(d);
      buckets.set(k, { key: k, label: makeLabel(d, k), value: 0, start: d });
    }
  }

  V.forEach((r) => {
    const d = caseArrivalDate(r.c);
    const key = period === 'week' ? weekKey(d) : monthKey(d);
    const entry = buckets.get(key);
    if (entry) entry.value += 1;
  });

  for (const x of buckets.values()) data.push(x);

  const values = data.map((x) => x.value);
  const highest = Math.max(...values, 1);
  const width = 560,
    height = 200,
    left = 22,
    right = 12,
    top = 18,
    bottom = 26,
    plotW = width - left - right,
    plotH = height - top - bottom,
    stepX = data.length > 1 ? plotW / (data.length - 1) : plotW;

  const points = data.map((item, idx) => {
    const x = left + idx * stepX;
    const y = height - bottom - (item.value / highest) * (plotH - 8);
    return { ...item, x, y };
  });

  const poly = points.map((p) => `${p.x},${p.y}`).join(' ');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('class', 'chart-svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Cases received trend');

  const grid = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  grid.setAttribute('x1', left);
  grid.setAttribute('x2', width - right);
  grid.setAttribute('y1', height - bottom);
  grid.setAttribute('y2', height - bottom);
  grid.setAttribute('stroke', '#dfe6ee');
  grid.setAttribute('stroke-width', '1');
  svg.append(grid);

  for (let i = 1; i <= 3; i++) {
    const y = height - bottom - (plotH / 3) * i;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', left);
    line.setAttribute('x2', width - right);
    line.setAttribute('y1', y);
    line.setAttribute('y2', y);
    line.setAttribute('stroke', '#edf2f7');
    line.setAttribute('stroke-width', '1');
    svg.append(line);
  }

  const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  line.setAttribute('points', poly);
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', '#0b5fa5');
  line.setAttribute('stroke-width', '3');
  line.setAttribute('stroke-linejoin', 'round');
  line.setAttribute('stroke-linecap', 'round');
  svg.append(line);

  points.forEach((p) => {
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('cx', p.x);
    dot.setAttribute('cy', p.y);
    dot.setAttribute('r', p.value ? '4.2' : '2.5');
    dot.setAttribute('fill', p.value ? '#0b5fa5' : '#cbd5e1');
    svg.append(dot);

    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', p.x);
    label.setAttribute('y', height - 8);
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('fill', '#586577');
    label.setAttribute('font-size', '10');
    label.textContent = p.label;
    svg.append(label);

    if (p.value) {
      const val = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      val.setAttribute('x', p.x);
      val.setAttribute('y', Math.max(18, p.y - 10));
      val.setAttribute('text-anchor', 'middle');
      val.setAttribute('fill', '#0b5fa5');
      val.setAttribute('font-size', '10');
      val.setAttribute('font-weight', '700');
      val.textContent = p.value;
      svg.append(val);
    }
  });

  const controls = h(
    'div',
    { class: 'chart-toggle' },
    h(
      'button',
      {
        type: 'button',
        class: 'mini ' + (period === 'month' ? 'on' : ''),
        onclick: () => {
          chartPeriod = 'month';
          drawDash();
        },
      },
      'Month'
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'mini ' + (period === 'week' ? 'on' : ''),
        onclick: () => {
          chartPeriod = 'week';
          drawDash();
        },
      },
      'Week'
    )
  );

  return h(
    'div',
    { class: 'chart-card' },
    h('div', { class: 'chart-head' },
      h('h3', {}, 'Cases per ' + (period === 'week' ? 'week' : 'month')),
      controls
    ),
    svg,
    h('small', { class: 'mu' }, `${V.length} case${V.length === 1 ? '' : 's'} in current filter`)
  );
}

function buildStageDonutChart(V) {
  const counts = STG.map((stage) => ({ stage, count: V.filter((r) => r.c.st === stage).length }));
  const total = counts.reduce((sum, item) => sum + item.count, 0) || 1;
  const cx = 78,
    cy = 78,
    r = 52,
    circumference = 2 * Math.PI * r,
    colors = STC;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 180 180');
  svg.setAttribute('class', 'chart-svg donut');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Cases by stage');

  let offset = 0;
  counts
    .filter((item) => item.count)
    .forEach((item) => {
      const ratio = item.count / total;
      const dash = Math.max(6, ratio * circumference);
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', cx);
      circle.setAttribute('cy', cy);
      circle.setAttribute('r', r);
      circle.setAttribute('fill', 'none');
      circle.setAttribute('stroke', STC[STG.indexOf(item.stage)] || '#94a3b8');
      circle.setAttribute('stroke-width', '16');
      circle.setAttribute('stroke-dasharray', `${dash} ${circumference - dash}`);
      circle.setAttribute('stroke-dashoffset', -offset);
      circle.setAttribute('stroke-linecap', 'round');
      circle.setAttribute('transform', `rotate(-90 ${cx} ${cy})`);
      svg.append(circle);
      offset += dash;
    });

  const inner = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  inner.setAttribute('cx', cx);
  inner.setAttribute('cy', cy);
  inner.setAttribute('r', 28);
  inner.setAttribute('fill', '#fff');
  inner.setAttribute('stroke', '#e5e7eb');
  inner.setAttribute('stroke-width', '1');
  svg.append(inner);

  const totalText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  totalText.setAttribute('x', cx);
  totalText.setAttribute('y', cy - 3);
  totalText.setAttribute('text-anchor', 'middle');
  totalText.setAttribute('font-size', '18');
  totalText.setAttribute('font-weight', '700');
  totalText.setAttribute('fill', '#0f172a');
  totalText.textContent = total;
  svg.append(totalText);

  const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  label.setAttribute('x', cx);
  label.setAttribute('y', cy + 16);
  label.setAttribute('text-anchor', 'middle');
  label.setAttribute('font-size', '10');
  label.setAttribute('fill', '#586577');
  label.textContent = 'cases';
  svg.append(label);

  const legend = h(
    'div',
    { class: 'chart-legend' },
    ...counts
      .filter((item) => item.count)
      .map((item) =>
        h(
          'div',
          { class: 'chart-legend-item' },
          h('span', { class: 'legend-dot', style: 'background:' + (STC[STG.indexOf(item.stage)] || '#94a3b8') }),
          h('span', { class: 'legend-label' }, `${item.stage} (${item.count})`)
        )
      )
  );

  return h(
    'div',
    { class: 'chart-card' },
    h('div', { class: 'chart-head' }, h('h3', {}, 'Workflow split'), h('span', { class: 'mu' }, 'Active cases')),
    h('div', { class: 'donut-wrap' }, svg),
    legend
  );
}

function caseDirectoryRows() {
  return vc().map((c) => ({
    c,
    ...withCase(c, () => ({
      id: g('case_claimNo') || 'Untitled case',
      who: g('pol_insured') || '—',
      ref: (c.mod === 'property' ? g('case_loc') : g('case_insReg')) || '—',
      sv: g('case_surveyor') || c.owner || '—',
    })),
  }));
}

function renderAllCasesView() {
  const rows = caseDirectoryRows(),
    owners = ['all', ...new Set(rows.map((r) => (r.c.owner || r.sv || 'Unassigned')).filter(Boolean))],
    stageOptions = ['all', ...STG],
    typeOptions = ['all', 'motor', 'property'];

  const filtered = rows
    .filter((r) => {
      const q = allCasesState.q.trim().toLowerCase();
      const matchesQuery =
        !q ||
        [r.id, r.who, r.ref, r.sv, r.c.st, r.c.mod].join(' ').toLowerCase().includes(q);
      const matchesStage = allCasesState.stage === 'all' || r.c.st === allCasesState.stage;
      const matchesType = allCasesState.type === 'all' || r.c.mod === allCasesState.type;
      const matchesOwner =
        allCasesState.owner === 'all' || (r.c.owner || r.sv || 'Unassigned') === allCasesState.owner;
      return matchesQuery && matchesStage && matchesType && matchesOwner;
    })
    .map((r) => ({ ...r, p: pri(r.c), d: dueOf(r.c) }))
    .sort((a, b) => {
      if (allCasesState.sort === 'recent') return (b.c.u || b.c.cr || 0) - (a.c.u || a.c.cr || 0);
      if (allCasesState.sort === 'claim') return (a.id || '').localeCompare(b.id || '');
      if (allCasesState.sort === 'stage') return STG.indexOf(a.c.st) - STG.indexOf(b.c.st);
      if (allCasesState.sort === 'owner')
        return (a.c.owner || a.sv || '').localeCompare(b.c.owner || b.sv || '');
      return a.p[2] - b.p[2] || ((a.d || '9') < (b.d || '9') ? -1 : 1);
    });

  const total = rows.length,
    active = rows.filter((r) => act(r.c)).length,
    overdue = rows.filter((r) => act(r.c) && ((pend(r.c, 'p') && dl(r.c, 'p').od) || (pend(r.c, 'f') && dl(r.c, 'f').od))).length,
    dueSoon = rows.filter((r) => act(r.c) && ((pend(r.c, 'p') && !dl(r.c, 'p').od && dl(r.c, 'p').left != null && dl(r.c, 'p').left <= 3) || (pend(r.c, 'f') && !dl(r.c, 'f').od && dl(r.c, 'f').left != null && dl(r.c, 'f').left <= 3))).length;

  const statCards = [
    ['Total', total, 'var(--ac)'],
    ['Active', active, 'var(--ac)'],
    ['Overdue', overdue, 'var(--er)'],
    ['Due soon', dueSoon, 'var(--wn)'],
  ].map(([label, value, color]) =>
    h(
      'div',
      { class: 'card', style: 'padding:12px 14px;border-top:4px solid ' + color },
      h('b', { style: 'display:block;font-size:22px;line-height:1.2' }, value),
      h('span', { class: 'mu' }, label)
    )
  );

  const filterBar = h(
    'div',
    { class: 'bar case-toolbar' },
    h('input', {
      type: 'search',
      placeholder: 'Search claim no., insured, location, surveyor…',
      value: allCasesState.q,
      oninput: (e) => {
        allCasesState.q = e.target.value;
        $('#dash').replaceChildren(renderAllCasesView());
      },
    }),
    h(
      'select',
      {
        onchange: (e) => {
          allCasesState.stage = e.target.value;
          $('#dash').replaceChildren(renderAllCasesView());
        },
      },
      ...stageOptions.map((x) => h('option', { value: x, selected: x === allCasesState.stage }, x === 'all' ? 'All stages' : x))
    ),
    h(
      'select',
      {
        onchange: (e) => {
          allCasesState.type = e.target.value;
          $('#dash').replaceChildren(renderAllCasesView());
        },
      },
      ...typeOptions.map((x) => h('option', { value: x, selected: x === allCasesState.type }, x === 'all' ? 'All types' : x === 'motor' ? 'Motor' : 'Property'))
    ),
    h(
      'select',
      {
        onchange: (e) => {
          allCasesState.owner = e.target.value;
          $('#dash').replaceChildren(renderAllCasesView());
        },
      },
      ...owners.map((x) => h('option', { value: x, selected: x === allCasesState.owner }, x === 'all' ? 'All owners' : x))
    ),
    h(
      'select',
      {
        onchange: (e) => {
          allCasesState.sort = e.target.value;
          $('#dash').replaceChildren(renderAllCasesView());
        },
      },
      ...[
        ['priority', 'Priority'],
        ['recent', 'Recently updated'],
        ['claim', 'Claim number'],
        ['stage', 'Stage'],
        ['owner', 'Owner'],
      ].map(([value, label]) => h('option', { value, selected: value === allCasesState.sort }, label))
    ),
    h(
      'button',
      {
        class: 'b',
        type: 'button',
        onclick: () => {
          allCasesState = { q: '', stage: 'all', type: 'all', owner: 'all', sort: 'priority' };
          $('#dash').replaceChildren(renderAllCasesView());
        },
      },
      'Reset'
    )
  );

  const cards = filtered.length
    ? h(
        'div',
        { class: 'case-grid' },
        ...filtered.map((r) => {
          const c = r.c,
            i = STG.indexOf(c.st),
            stageColor = STC[i] || '#64748b';
          return h(
            'article',
            {
              class: 'case-card',
              style: '--c:' + stageColor,
              onclick: () => openCase(c.id),
            },
            h(
              'div',
              { class: 'case-card-head' },
              h('div', {}, h('b', {}, r.id), h('small', { class: 'mu' }, r.c.mod === 'property' ? 'Property' : 'Motor')),
              h('span', { class: 'pill', style: 'color:' + stageColor }, c.st)
            ),
            h('div', { class: 'case-meta' }, h('strong', {}, 'Insured:'), ' ' + r.who),
            h('div', { class: 'case-meta' }, h('strong', {}, 'Reference:'), ' ' + r.ref),
            h('div', { class: 'case-meta' }, h('strong', {}, 'Surveyor:'), ' ' + r.sv),
            h('div', { class: 'case-meta' }, h('strong', {}, 'Next step:'), ' ' + NXT[i]),
            h('div', { class: 'case-meta row4' }, chip(dl(c, 'p')), chip(dl(c, 'f'))),
            h('div', { class: 'case-meta' }, h('strong', {}, 'Priority:'), ' ' + h('span', { class: 'pill ' + r.p[1] }, r.p[0]))
          );
        })
      )
    : h('p', { class: 'mu' }, 'No cases match the current filters.');

  return h(
    'div',
    { class: 'case-directory' },
    h(
      'div',
      { class: 'dh' },
      h('div', {}, h('h1', {}, 'All cases'), h('span', { class: 'mu' }, 'Complete case directory and quick navigation')),
      h(
        'div',
        { class: 'bar' },
        h('button', { class: 'b', onclick: showDash }, '← Dashboard'),
        h('button', { class: 'b p', onclick: openNew }, '+ New case')
      )
    ),
    h('div', { class: 'row4' }, ...statCards),
    h('div', { class: 'card' }, filterBar, cards)
  );
}

function drawDash() {
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
    V = vc().map((c) => ({
      c,
      ...withCase(c, () => ({
        id: g('case_claimNo') || 'Untitled case',
        who: g('pol_insured') || '—',
        ref: (c.mod === 'property' ? g('case_loc') : g('case_insReg')) || '—',
        sv: g('case_surveyor') || c.owner || '—',
      })),
    }));
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
    const q = FL.q.toLowerCase();
    return V.filter(
      (r) =>
        (!FL.s || r.c.st === FL.s) &&
        (!FL.k || FT[FL.k](r.c)) &&
        (FL.k === 'tot' || FL.s === 'Survey Complete' || act(r.c)) &&
        (!q || (r.id + r.who + r.ref).toLowerCase().includes(q))
    )
      .map((r) => ({ ...r, p: pri(r.c), d: dueOf(r.c) }))
      .sort((a, b) => a.p[2] - b.p[2] || ((a.d || '9') < (b.d || '9') ? -1 : 1));
  };
  const tbl = () => {
    const R = rowsF();
    return R.length
      ? h(
          'table',
          { class: 'at' },
          h(
            'thead',
            {},
            h(
              'tr',
              {},
              ...[
                'Case no.',
                'Vehicle / location',
                'Insured',
                'Current stage',
                'Next required action',
                'Prelim. report',
                'Final report',
                'Priority',
                'Due date',
                '',
              ].map((x) => h('th', {}, x))
            )
          ),
          h(
            'tbody',
            {},
            ...R.map((r) => {
              const c = r.c,
                i = STG.indexOf(c.st);
              return h(
                'tr',
                { class: 'rw', onclick: () => openCase(c.id) },
                h('td', {}, h('b', {}, r.id)),
                h('td', {}, r.ref),
                h('td', {}, r.who),
                h('td', {}, h('span', { class: 'pill', style: 'color:' + STC[i] }, c.st)),
                h('td', {}, NXT[i]),
                h('td', {}, chip(dl(c, 'p'))),
                h('td', {}, chip(dl(c, 'f'))),
                h('td', {}, h('span', { class: 'pill ' + r.p[1] }, r.p[0])),
                h('td', {}, r.d ? dtf(r.d) : '—'),
                h('td', {}, cfg.role === 'Staff' ? '' : delBtn(c))
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
      placeholder: 'Search case no., insured, vehicle / location…',
      value: FL.q,
    }),
    tw = h('div', { class: 'tbs' }, tbl());
  sq.oninput = () => {
    FL.q = sq.value;
    tw.replaceChildren(tbl());
  };
  const dm = (k, t, days) => {
    const pn = V.filter((r) => pend(r.c, k)),
      ct = (n, l, cl, key) =>
        h(
          'button',
          { class: 'ct ' + cl, onclick: () => setF(FL.k === key ? '' : key, '') },
          h('b', {}, n),
          l
        );
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
      )
    );
  };
  const rc = [...V].sort((a, b) => (b.c.u || b.c.cr || 0) - (a.c.u || a.c.cr || 0)).slice(0, 6),
    fs = (l, i) => h('div', { class: 'fld' }, h('label', {}, l), i),
    ro = cfg.role !== 'Admin',
    rs = h(
      'select',
      {},
      ...['Admin', 'Principal Surveyor', 'Staff'].map((x) => h('option', { value: x }, x))
    ),
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
  nmI.value = cfg.me;
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
        h(
          'span',
          { class: 'mu' },
          new Date().toLocaleDateString('en-GB', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          }) + ' · '
        ),
        h(
          'span',
          { class: 'pill pr-m' },
          cfg.role + ' · ' + cfg.me + (cfg.role === 'Staff' ? ' (own cases)' : ' (all cases)')
        ),
        h(
          'span',
          { class: 'ai-status ' + (window.SURVEY_AI ? 'live' : 'offline') },
          window.SURVEY_AI ? 'Gemini live' : 'AI offline'
        )
      ),
      h(
        'div',
        { class: 'bar' },
        h('button', { class: 'b', onclick: impOpen }, 'Import case'),
        h('button', { class: 'b p', onclick: openNew }, '+ New case')
      )
    ),
    h(
      'div',
      { class: 'kp' },
      ...KP.map(([k, l, c, t]) =>
        h(
          'div',
          {
            class: 'k' + (FL.k === k ? ' on' : ''),
            style: '--c:' + c,
            onclick: () => setF(FL.k === k ? '' : k, ''),
          },
          h('b', {}, V.filter((r) => t(r.c)).length),
          h('span', {}, l)
        )
      )
    ),
    h(
      'div',
      { class: 'chart-grid' },
      buildCasesTrendChart(rowsF(), chartPeriod),
      buildStageDonutChart(V)
    ),
    h(
      'div',
      { class: 'g2' },
      h(
        'div',
        { class: 'card' },
        h('h3', {}, 'Claim settlement workflow'),
        h(
          'ul',
          { class: 'rail' },
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
                onclick: () => setF('', FL.s === s ? '' : s),
              },
              h('span', { class: 'dt' }),
              s,
              h('b', {}, L.length)
            );
          })
        ),
        h(
          'small',
          { class: 'mu' },
          '● current  ● overdue  ● complete  ○ none – click a stage to list its cases'
        )
      ),
      h(
        'div',
        {},
        h('h3', {}, 'Report deadline monitoring'),
        h(
          'div',
          { class: 'dm' },
          dm('p', 'Preliminary report', cfg.pd),
          dm('f', 'Final report', cfg.fd)
        ),
        h(
          'p',
          { class: 'mu' },
          `Deadlines count from each case’s intimation / assignment date. Submitted reports show their submission date instead of a countdown.`
        )
      )
    ),
    h(
      'div',
      { class: 'card' },
      h(
        'div',
        { class: 'bar', style: 'margin-top:0' },
        h('h3', { style: 'margin:0' }, 'Action required' + (fl ? ' – ' + fl : '')),
        fl ? h('button', { class: 'b', onclick: () => setF('', '') }, '✕ Clear filter') : '',
        sq
      ),
      tw
    ),
    h(
      'div',
      { class: 'card' },
      h('h3', {}, 'Recent cases'),
      rc.length
        ? h(
            'div',
            { class: 'cg' },
            ...rc.map((r) => {
              const c = r.c;
              return h(
                'article',
                {
                  class: 'cc',
                  style: '--c:' + STC[STG.indexOf(c.st)] + ';cursor:pointer',
                  onclick: () => openCase(c.id),
                },
                h(
                  'div',
                  { class: 'ch' },
                  h('span', { class: 'tb' }, c.mod === 'property' ? '🏠 Property' : '🚗 Motor'),
                  h(
                    'span',
                    { class: 'mu' },
                    'Updated ' + dtf(new Date(c.u || c.cr || Date.now()).toISOString().slice(0, 10))
                  )
                ),
                h('h4', {}, r.id),
                h('p', { class: 'mu' }, r.who + ' · ' + r.ref),
                h(
                  'div',
                  {},
                  h('span', { class: 'pill', style: 'color:' + STC[STG.indexOf(c.st)] }, c.st)
                ),
                h('div', { class: 'row4' }, chip(dl(c, 'p')), chip(dl(c, 'f'))),
                h('small', { class: 'mu' }, 'Surveyor: ' + r.sv),
                cfg.role === 'Staff' ? '' : delBtn(c)
              );
            })
          )
        : h('p', { class: 'mu' }, 'No cases yet.')
    ),
    h(
      'details',
      { class: 'card' },
      h('summary', {}, 'Role & settings'),
      h(
        'div',
        { class: 'grid' },
        fs('View as (demo role)', rs),
        fs('My name (cases assigned to me)', nmI),
        fs('Preliminary report deadline (days)', pdI),
        fs('Final report deadline (days)', fdI),
        fs('Counting rule', cn),
        signUI()
      ),
      h(
        'p',
        { class: 'mu' },
        'Admin: all cases, deadline settings, delete. Principal Surveyor: all cases and reassignment. Staff: only cases assigned to them. This role switch changes what is shown on this device only; real access control needs a signed-in backend.'
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
  acc_vehicles: 'Third-party tick box',
  d1_med: 'Bills & expenses',
  d2_med: 'Bills & expenses',
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
  $('#sv').textContent = '✓ Case deleted';
  hdr();
  drawDash();
}
