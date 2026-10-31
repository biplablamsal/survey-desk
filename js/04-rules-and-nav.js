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
  if (g('case_tpReg') && g('tp_reg') && nz(g('case_tpReg')) !== nz(g('tp_reg')))
    a('tp_reg', 'Differs from the third-party reg. no. on the case sheet', 1);
  if (n('acc_vehicles') > 1 && !g('tp_reg') && !g('case_tpReg'))
    a('tp_reg', 'Multi-vehicle accident but no third-party reg. no.', 1);
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

function nav() {
  const n = $('#nav');
  n.replaceChildren();
  const is = issues();
  NAV.forEach((s) => {
    const rs = (s.F || []).filter((f) => f.r),
      d = rs.filter((f) => {
        const v = g(f.k);
        return v && !chk(f, v);
      }).length,
      e = is.filter((i) => i.s === s.k && !i.w).length,
      w = is.filter((i) => i.s === s.k && i.w).length;
    n.append(
      h(
        'button',
        {
          class: 'nv' + (s.k === sec ? ' on' : ''),
          onclick: () => {
            sec = s.k;
            $('#side').classList.remove('open');
            render();
          },
        },
        s.t,
        h(
          'span',
          { class: 'bd' },
          rs.length ? (d === rs.length && !e ? '✓' : d + '/' + rs.length) : '',
          e ? h('b', { class: 'er' }, ' ✖' + e) : '',
          w ? h('b', { class: 'wn' }, ' ⚠' + w) : ''
        )
      )
    );
  });
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
