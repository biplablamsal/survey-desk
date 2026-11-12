/* Cross-field rules for motor cases X(), issues(), side navigation, live validation paint()
   Loaded as a classic script: everything here shares the global scope. Order of <script> tags in index.html matters. */

function X() {
  const o = [],
    a = (k, m, w) => o.push({ k, m, w }),
    dd = (k) => (/^\d{4}-\d{2}-\d{2}$/.test(g(k)) ? dt(g(k)) : null),
    n = (k) => Number(g(k)) || 0;
  const ad = dd('case_acc'),
    c = dd('pol_start'),
    e = dd('pol_end'),
    i = dd('pol_issue'),
    sv = dd('case_survey'),
    li = dd('fp_dlIssue'),
    le = dd('fp_dlExp');
  if (c && e && e <= c) a('pol_end', 'Expiry must be after commencement');
  if (i && c && c < i) a('pol_start', 'Commencement is before the issue date', 1);
  if (ad && c && e && (ad < c || ad > e))
    a('case_acc', 'Accident is outside the policy period – verify cover');
  if (sv && ad && sv < ad) a('case_survey', 'Survey date is before the accident date');
  if (sv && sv > new Date()) a('case_survey', 'Survey date is in the future', 1);
  if (li && le && le <= li) a('fp_dlExp', 'Expiry must be after issue date');
  if (ad && le && le < ad) a('fp_dlExp', 'Licence had expired on the accident date');
  if (ad && li && li > ad) a('fp_dlIssue', 'Licence issued after the accident date');
  ['d1_date', 'd2_date'].forEach((k) => {
    const d = dd(k);
    if (d && ad && d < ad) a(k, 'Inspection is before the accident date');
  });
  const r = [g('case_insReg'), g('pol_reg')].map(nz).filter(Boolean),
    fr = nz(g('fp_reg')),
    pr = nz(g('fp_prevReg'));
  if (fr && r.some((x) => x !== fr && x !== pr))
    a(
      'fp_reg',
      'Differs from the case / policy registration no. – confirm re-registration or correct',
      1
    );
  if (g('pol_vtype') && g('fp_type') && g('pol_vtype') !== g('fp_type'))
    a('fp_type', 'Differs from the policy vehicle type (' + g('pol_vtype') + ')', 1);
  if (g('pol_eng') && g('fp_eng') && nz(g('pol_eng')) !== nz(g('fp_eng')))
    a('fp_eng', 'Differs from the policy engine no.', 1);
  if (g('pol_chs') && g('fp_chs') && nz(g('pol_chs')) !== nz(g('fp_chs')))
    a('fp_chs', 'Differs from the policy chassis no.', 1);
  if (tpSome('veh') && g('case_tpReg') && g('tp_reg') && nz(g('case_tpReg')) !== nz(g('tp_reg')))
    a('tp_reg', 'Differs from the third-party reg. no. on the case sheet', 1);
  /* Both of these are about a vehicle, so they only say anything when some party on the case is one
     – a claim against a pedestrian has no registration number to be missing. */
  if (tpSome('veh') && n('acc_vehicles') > 1 && !g('tp_reg') && !g('case_tpReg'))
    a('tp_reg', 'Multi-vehicle accident but no third-party reg. no.', 1);
  if (tpSomeStated('inj') && g('acc_injured') === '0')
    a('acc_injured', 'A third party is recorded as injured but injured persons = 0', 1);
  if (g('d1_inj') === 'Yes' && g('acc_injured') === '0')
    a('acc_injured', 'Driver injury reported but injured persons = 0');
  if (g('acc_police') === 'Yes' && !g('acc_station'))
    a('acc_station', 'Police informed but station not recorded', 1);
  if (n('loss_veh') && n('pol_idv') && n('loss_veh') > n('pol_idv'))
    a('loss_veh', 'Estimate exceeds IDV – consider total-loss basis', 1);
  if (g('d1_est') === 'Yes' && !PH.some((p) => p.cat === 'est'))
    a('d1_est', 'Marked available but no estimate uploaded under Photos & annexes', 1);
  if (g('d1_photos') === 'Yes' && !PH.some((p) => p.cat === 'iv'))
    a('d1_photos', 'Marked as taken but no insured-vehicle photos uploaded', 1);
  return o;
}

function issues() {
  const o = [];
  SECS.filter(vis).forEach((s) =>
    s.F.forEach((f) => {
      if (hid(f)) return;
      const e = chk(f, Dd.f[f.k]);
      if (e) o.push({ s: s.k, k: f.k, m: `${f.l}: ${e}`, w: 0 });
    })
  );
  MOD.X()
    .filter((x) => vis(SECS.find((s) => s.k === x.k.split('_')[0])) && !hid(FM[x.k]))
    .forEach((x) => o.push({ s: x.k.split('_')[0], k: x.k, m: `${FM[x.k].l}: ${x.m}`, w: x.w }));
  billIssues()
    .filter((b) => hasTP() || !(b.b || '').startsWith('b'))
    .forEach((b) => o.push({ s: 'bills', k: null, m: b.m, w: b.w }));
  return o;
}

/* Line icons for the workflow sections, all drawn on the same 20x20 grid so the rail reads as one
   set. A section key that is not listed gets the plain document glyph. */
const IC_DOC = 'M6.5 2.8h5.2l2.6 2.6v11.2H6.5zM9 9.5h4.5M9 12.5h4.5',
  SEC_IC = {
    case: IC_DOC,
    pol: 'M10 2.6l6 2.3v4.5c0 3.9-2.5 6.4-6 8-3.5-1.6-6-4.1-6-8V4.9z',
    fp: 'M10 9.6a3.1 3.1 0 100-6.2 3.1 3.1 0 000 6.2zM4.6 16.9c.6-2.9 2.7-4.4 5.4-4.4s4.8 1.5 5.4 4.4',
    tp: 'M7.4 9.4a2.6 2.6 0 100-5.2 2.6 2.6 0 000 5.2zM2.6 16.6c.5-2.5 2.3-3.8 4.8-3.8s4.3 1.3 4.8 3.8M13.4 5.1a2.5 2.5 0 010 4.9M15.2 13.1c1.9.4 3 1.7 3.4 3.5',
    acc: 'M10 3.4l6.8 12.2H3.2zM10 8v3.6M10 13.4v.1',
    d1: 'M3.6 12.4h12.8M4.6 12.4V9.9L6.9 6.6h6.2l2.3 3.3v2.5M6.9 15.2a1.4 1.4 0 100-2.8 1.4 1.4 0 000 2.8zM13.1 15.2a1.4 1.4 0 100-2.8 1.4 1.4 0 000 2.8z',
    d2: 'M3.6 12.4h12.8M4.6 12.4V9.9L6.9 6.6h6.2l2.3 3.3v2.5M6.9 15.2a1.4 1.4 0 100-2.8 1.4 1.4 0 000 2.8zM13.1 15.2a1.4 1.4 0 100-2.8 1.4 1.4 0 000 2.8zM15.6 3.2l-1.8 2.2h2.4l-1.8 2.2',
    photos: 'M3.4 6.6h3l1.4-2h4.4l1.4 2h3v9.8H3.4zM10 13.4a2.7 2.7 0 100-5.4 2.7 2.7 0 000 5.4z',
    loss: 'M5.4 3h9.2v14H5.4zM7.6 6.4h4.8M7.6 10h1.6M11.8 10h1.6M7.6 13.2h1.6M11.8 13.2h1.6',
    prelim: 'M6.5 2.8h5.2l2.6 2.6v11.2H6.5zM8.4 11.6l1.4 1.4 3-3',
    spot: 'M10 2.8c2.6 3 4.6 4.8 4.6 8A4.6 4.6 0 0110 17.2a4.6 4.6 0 01-4.6-6.4c1.2 1 2 .6 2-1.4 0-2.4 1.4-4 2.6-6.6zM8.2 12.6h3.6',
    bills: 'M5 2.8h10v14.4l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4zM8 7h4M8 10.2h4',
    fin: 'M5.4 3h9.2v14H5.4zM7.6 6.4h4.8M8 12.6l1.6 1.6 3.2-3.2',
    concl: 'M4.4 5.4l1.8 1.8 3-3M4.4 11.4l1.8 1.8 3-3M11.6 6.4h4.8M11.6 12.4h4.8',
    report: 'M9.3 3.4a5.9 5.9 0 100 11.8 5.9 5.9 0 000-11.8zM13.6 13.6l3.2 3.2',
    final: 'M6.5 2.8h5.2l2.6 2.6v11.2H6.5zM7.6 11.4l1.8 1.8 3.6-3.6',
    capture: 'M3.4 6.6h3l1.4-2h4.4l1.4 2h3v9.8H3.4zM10 8.4v5M7.5 10.9h5',
    risk: 'M3.6 9.4L10 3.6l6.4 5.8M5.6 10.8v6h8.8v-6M8.6 16.8v-3.6h2.8v3.6',
    inc: 'M10 2.8c2.6 3 4.6 4.8 4.6 8A4.6 4.6 0 0110 17.2a4.6 4.6 0 01-4.6-6.4c1.2 1 2 .6 2-1.4 0-2.4 1.4-4 2.6-6.6z',
    dmg: 'M3.6 9.4L10 3.6l6.4 5.8M5.6 10.8v6h8.8v-6M10 12l1.6 3h-3.2z',
    est: 'M5.4 3h9.2v14H5.4zM7.6 6.4h4.8M10 9.6v4M8 11.6h4',
    pla: 'M4.4 5h11M4.4 9h11M4.4 13h7',
  };

const secIcon = (k) =>
  h(
    'svg',
    { class: 'nv-ic', viewBox: '0 0 20 20', 'aria-hidden': 'true' },
    h('path', { d: SEC_IC[k] || IC_DOC })
  );

/* One workflow row: stage icon, section name and a badge that reflects real validation.
   required = visible required fields (fields hidden by the third-party switch do not count, so a
   section can never look permanently unfinished); filled = required fields that actually validate.
   A section nobody has touched is reported neutrally: the red cross is reserved for work that was
   started and left wrong or unfinished, which is the only kind a surveyor can act on. */
function navRow(s, is) {
  const fs = s.F || [],
    rs = fs.filter((f) => f.r && !hid(f)),
    val = (f) => g(f.k),
    /* chk() answers with an error message, so a field counts as filled only when it says nothing. */
    filled = rs.filter((f) => val(f) && !chk(f, val(f))).length,
    bad = rs.filter((f) => val(f) && chk(f, val(f))).length,
    started = fs.some((f) => !hid(f) && val(f)),
    e = is.filter((i) => i.s === s.k && !i.w).length,
    w = is.filter((i) => i.s === s.k && i.w).length,
    na = !!(s.show && !s.show()),
    done = !!rs.length && filled === rs.length && !e,
    bd = h('span', { class: 'bd' });

  if (na) bd.append(h('b', { class: 'na' }, 'N/A'));
  else if (!rs.length) {
    // Reports, photos and bills have no fields to tally, so only the issues they raise count.
    if (e) bd.append(h('b', { class: 'er' }, '\u2716' + e));
    else if (w) bd.append(h('b', { class: 'wn' }, '\u26a0' + w));
    else bd.append(h('i', { class: 'nt' }));
  } else {
    if (done) bd.append(h('b', { class: 'ok' }, '\u2713'));
    else {
      if (!started) bd.append(h('i', { class: 'nt' }));
      bd.append(h('b', { class: started ? 'nv-ct er' : 'nv-ct' }, filled + '/' + rs.length));
      if (started && (e || bad)) bd.append(h('b', { class: 'er' }, '\u2716' + Math.max(e, bad)));
    }
    if (w) bd.append(h('b', { class: 'wn' }, '\u26a0' + w));
  }

  const hint = na
    ? s.t + ' – not applicable to this case'
    : done
      ? s.t + ' – complete'
      : rs.length
        ? s.t + ' – ' + filled + ' of ' + rs.length + ' required fields complete'
        : s.t;

  return h(
    'button',
    {
      class: 'nv' + (s.k === sec ? ' on' : '') + (na ? ' na' : ''),
      title: hint,
      'aria-label': hint,
      onclick: () => {
        sec = s.k;
        $('#side').classList.remove('open');
        render();
      },
    },
    secIcon(s.k),
    h('span', { class: 'nv-t' }, s.t),
    bd
  );
}

function nav() {
  const n = $('#nav'),
    bar = $('#secbar');
  n.replaceChildren();
  if (bar) bar.replaceChildren();
  const is = issues();
  let stage = null;
  NAV.forEach((s) => {
    // Group headings belong in the rail only; the phone strip stays a single scrollable row.
    if (s.gp && s.gp !== stage) {
      stage = s.gp;
      n.append(h('h6', { class: 'ng' }, stage));
    }
    n.append(navRow(s, is));
    if (bar) bar.append(navRow(s, is));
  });
  if (bar) {
    const on = bar.querySelector('.nv.on');
    if (on) on.scrollIntoView({ inline: 'center', block: 'nearest' });
  }
}

function paint() {
  const xi = {};
  MOD.X().forEach((x) => (xi[x.k] = xi[x.k] || []).push(x));
  document.querySelectorAll('[id^=e_]').forEach((e) => {
    const k = e.id.slice(2),
      f = FM[k];
    if (!f) return;
    const er = TCH.has(k) || SHOW ? chk(f, Dd.f[k]) : '',
      x = xi[k],
      hard = !!er || !!(x && x.some((y) => !y.w));
    const au = document.getElementById('au_' + k);
    if (au)
      au.textContent =
        Dd.auto && Dd.auto[k] !== undefined && !(Dd.man && Dd.man[k]) && g(k) === Dd.auto[k]
          ? Dd.afn && Dd.afn[k]
            ? '↺ ' +
              (Dd.afn[k].u ? 'Updated' : 'Auto-filled') +
              ' from ' +
              Dd.afn[k].s +
              ' · ' +
              new Date(Dd.afn[k].t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : '↺ auto-filled from an earlier entry'
          : '';
    e.parentElement.classList.toggle('filled', !!g(k) && !hard);
    const bsE = document.getElementById('bs_' + k);
    if (bsE) bsE.textContent = g(k).length === 10 ? 'BS: ' + bsStr(g(k)) : '';
    e.className = hard ? 'er' : 'wn';
    e.textContent = er || (x ? x.map((y) => y.m).join(' · ') : '');
    document.getElementById('f_' + k).classList.toggle('bad', hard);
  });
  nav();
}
