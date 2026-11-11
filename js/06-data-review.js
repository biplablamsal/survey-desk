/* Data review screen and the data-based report draft (reportHTML)
   Loaded as a classic script: everything here shares the global scope. Order of <script> tags in index.html matters. */

function show(f) {
  const v = g(f.k);
  if (!v) return '<span style="color:#888">—</span>';
  return f.t === H
    ? esc(t12(v))
    : f.t === D_
      ? esc(dtf(v)) + ' (BS ' + esc(bsStr(v)) + ')'
      : f.t === M || f.t === C
        ? esc(money(v))
        : f.t === A
          ? esc(v).replace(/\n/g, '<br>')
          : esc(v);
}

function reportHTML() {
  const f = (k) => esc(g(k) || '—'),
    dr = issues().some((i) => !i.w);
  let o = `<div class="mu">${dr ? 'DRAFT – validation issues pending' : ''}</div><h1>${esc(MOD.title)}</h1><table><tr><th>Insurance claim no.</th><td>${f('case_claimNo')}</td><th>Policy number</th><td>${f('case_policyNo')}</td></tr><tr><th>Submitted by</th><td>${f('case_surveyor')}</td><th>Submitted to</th><td>${f('case_company')}</td></tr><tr><th>Survey date</th><td>${esc(dtf(g('case_survey')) || '—')}</td><th>Settlement stage</th><td>${esc(Dd.st || '—')}</td></tr></table>`;
  if (typeof tpSummaryReportHTML === 'function') {
    const tpSummary = tpSummaryReportHTML();
    if (tpSummary) o += tpSummary;
  }
  SECS.filter(vis).forEach((s, i) => {
    o += `<h2>${i + 1}. ${esc(s.t)}</h2>`;
    s.g.forEach((x) => {
      const vf = x.f.filter((y) => !hid(y));
      if (!vf.length) return;
      o +=
        `<h4>${esc(x.t)}</h4><table>` +
        vf.map((y) => `<tr><th>${esc(y.l)}</th><td>${show(y)}</td></tr>`).join('') +
        '</table>' +
        (x.note ? `<p><i>${esc(x.note)}</i></p>` : '');
    });
    const cx = ((Dd.x || {})[s.k] || []).filter((r) => r.l || r.v);
    if (cx.length)
      o +=
        '<h4>Additional information</h4><table>' +
        cx.map((r) => `<tr><th>${esc(r.l)}</th><td>${esc(r.v)}</td></tr>`).join('') +
        '</table>';
    if (s.k === 'tp') o += tpTableHTML();
  });
  /* Once the case keeps its third parties as records the detailed pages step aside, so the parties
     are printed here instead – the numbered sections above no longer carry them. */
  if (!SECS.some((s) => s.k === 'tp' && vis(s))) o += tpTableHTML();
  // (the old 'Annexure – medical bills' block was removed: bills now live in js/18-bills-ui.js)
  return (
    o +
    '<p><i>This form is for preliminary data collection and preparation of a motor vehicle survey report. All information, assessments and estimates must be verified against documents, inspection findings and policy terms before finalisation.</i></p>' +
    annexHTML()
  );
}

function go(i) {
  sec = i.s;
  render();
  const e = i.k && document.getElementById('f_' + i.k);
  if (e) {
    e.focus();
    e.scrollIntoView({ block: 'center' });
  }
}

function reportUI(m) {
  SHOW = true;
  const is = issues(),
    er = is.filter((i) => !i.w),
    wr = is.length - er.length,
    r = h('div', { class: 'rep', id: 'rep' });
  r.innerHTML = reportHTML();
  m.append(
    h(
      'section',
      { class: 'card noprint' },
      h('h3', {}, 'Validation review'),
      h(
        'p',
        { class: er.length ? 'er' : 'ok' },
        er.length
          ? `${er.length} issue(s) to fix before the report is final` +
              (wr ? ` · ${wr} warning(s)` : '')
          : 'All required checks passed' + (wr ? ` – ${wr} warning(s) to review` : '')
      ),
      h(
        'ul',
        { class: 'il' },
        ...is.map((i) =>
          h(
            'li',
            { class: i.w ? 'wn' : 'er' },
            h(
              'a',
              {
                href: '#',
                onclick: (e) => {
                  e.preventDefault();
                  go(i);
                },
              },
              i.m
            )
          )
        )
      )
    ),
    h(
      'div',
      { class: 'bar noprint' },
      h(
        'button',
        {
          class: 'b p',
          onclick: () => {
            try {
              window.print();
            } catch {}
          },
        },
        'Print / Save as PDF'
      ),
      h(
        'button',
        {
          class: 'b',
          id: 'cp',
          onclick: async () => {
            const t = $('#rep').innerText;
            try {
              await navigator.clipboard.writeText(t);
              $('#cp').textContent = 'Copied ✓';
            } catch {
              const rg = document.createRange();
              rg.selectNodeContents($('#rep'));
              const s = getSelection();
              s.removeAllRanges();
              s.addRange(rg);
              $('#cp').textContent = 'Selected – press Ctrl/Cmd+C';
            }
          },
        },
        'Copy report text'
      )
    ),
    r
  );
}
