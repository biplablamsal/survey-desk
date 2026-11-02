/* Final-assessment calculation, AI prompt, report text editor (genUI), autofill links
   Loaded as a classic script: everything here shares the global scope. Order of <script> tags in index.html matters. */

const BT = {
    ra: 'First-party repair & maintenance bills',
    rb: 'Third-party repair & maintenance bills',
    a: 'First-party medical expenses',
    b: 'Third-party medical expenses',
  },
  bq = (q) => q === 'ra' || q === 'a' || hasTP(),
  sbl = (q, k) =>
    bn(q).reduce((a, iv) => a + iv.rows.reduce((b, r) => b + (+r[k] > 0 ? +r[k] : 0), 0), 0);

function finCalc() {
  const n = (k) => Number(g(k)) || 0,
    ex = n('pol_exC') + n('pol_exO'),
    rep = sbl('ra', 'as'),
    dep = n('fin_dep'),
    sal = n('fin_salv'),
    oth = n('fin_oth'),
    net = Math.max(0, rep - dep - sal - ex - oth),
    m1 = sbl('a', 'as'),
    tp = hasTP(),
    r3 = tp ? sbl('rb', 'as') : 0,
    m3 = tp ? sbl('b', 'as') : 0,
    t = net + m1 + r3 + m3;
  return {
    t,
    rows: [
      ['First-party repair & maintenance – billed', sbl('ra', 'amt')],
      ['First-party repair & maintenance – assessed (admissible)', rep],
      ['Less: depreciation / betterment', -dep],
      ['Less: salvage value', -sal],
      ['Less: policy excess (compulsory + optional)', -ex],
      ['Less: other deductions', -oth],
      ['Net first-party own damage', net],
      ['First-party medical expenses – billed', sbl('a', 'amt')],
      ['First-party medical expenses – assessed', m1],
      ...(tp
        ? [
            ['Third-party repair & maintenance – billed', sbl('rb', 'amt')],
            ['Third-party repair & maintenance – assessed', r3],
            ['Third-party medical expenses – billed', sbl('b', 'amt')],
            ['Third-party medical expenses – assessed', m3],
          ]
        : []),
      ['TOTAL ASSESSED LIABILITY', t],
    ],
  };
}

function finTable() {
  return (
    "<table class='bt'>" +
    finCalc()
      .rows.map((r) => {
        const b = r[0].startsWith('Net') || r[0].startsWith('TOTAL');
        return `<tr${b ? " style='font-weight:700'" : ''}><td>${esc(r[0])}</td><td style='text-align:right;white-space:nowrap'>${r[1] < 0 ? '(' + esc(money(-r[1])) + ')' : esc(money(r[1]))}</td></tr>`;
      })
      .join('') +
    '</table>'
  );
}

function clean(s) {
  const d = new DOMParser().parseFromString(String(s).replace(/```[a-z]*/g, ''), 'text/html'),
    ok = new Set([
      'H1',
      'H2',
      'H3',
      'H4',
      'P',
      'UL',
      'OL',
      'LI',
      'TABLE',
      'THEAD',
      'TBODY',
      'TR',
      'TH',
      'TD',
      'B',
      'STRONG',
      'I',
      'EM',
      'U',
      'BR',
      'DIV',
      'SPAN',
      'FIGURE',
      'FIGCAPTION',
    ]);
  const w = (n) =>
    [...n.children].forEach((c) => {
      if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'IMG'].includes(c.tagName)) {
        c.remove();
        return;
      }
      w(c);
      if (!ok.has(c.tagName)) c.replaceWith(...c.childNodes);
      else [...c.attributes].forEach((a) => c.removeAttribute(a.name));
    });
  w(d.body);
  return d.body.innerHTML;
}

function dataText() {
  const o = [];
  SECS.filter(vis).forEach((s) => {
    const rows = [];
    s.g.forEach((x) =>
      x.f
        .filter((f) => !hid(f))
        .forEach((f) => {
          const v = g(f.k);
          if (v) rows.push(`${f.l}: ${f.t === M || f.t === C ? money(v) : f.t === H ? t12(v) : v}`);
        })
    );
    const cx = ((Dd.x || {})[s.k] || []).filter((r) => r.l || r.v).map((r) => `${r.l}: ${r.v}`);
    if (rows.length || cx.length) o.push(`## ${s.t}\n` + [...rows, ...cx].join('\n'));
  });
  return o.concat(MOD === MODS.property && plaHas() ? [plaText()] : []).join('\n\n');
}

function aiPrompt(kind) {
  const P = kind === 'prelim',
    mo = MOD === MODS.motor,
    sec_ = P
      ? '1 Reference and case summary; 2 Policy details and verification; 3 Insured property/vehicle, owner and driver; 4 Circumstances of the accident/loss with narrative; 5 Damage observations and evidence; 6 Preliminary assessment and estimated loss; 7 Observations, pending documents and next steps; 8 Preliminary conclusion with insurer-ready summary'
      : mo
        ? '1 Reference and case summary; 2 Policy details and verification; 3 Circumstances of loss and narrative; 4 Damage findings and inspection observations; 5 Repair and maintenance bills, first party' +
          (hasTP() ? ' and third party' : '') +
          ' with billed vs assessed details and remarks; 6 Medical expenses with billed vs assessed details; 7 Surveyor’s final calculation and assessment (reproduce the computed table exactly); 8 Observations, deductions and policy conditions applied; 9 Final conclusion, recommendation and follow-up actions'
        : '1 Reference and case summary; 2 Policy details; 3 Circumstances of loss and narrative; 4 Damage findings and inspection observations; 5 Assessment of loss; 6 Surveyor’s final calculation and assessment; 7 Observations, deductions and policy conditions applied; 8 Final conclusion and recommendation';
  return `You are an experienced licensed insurance surveyor in Nepal drafting a ${P ? 'PRELIMINARY' : 'FINAL'} ${MOD.name.replace(' survey', '')} survey report for the insurer.\nRules: use ONLY the facts in the data below. Never invent facts, names, numbers or dates; write "Not provided" where data is missing. Do not do your own arithmetic: use the computed figures given. Formal, neutral, detailed and insurer-ready tone. Amounts in NPR.\nGoal: produce a complete, well-structured survey report, not a short overview. Include every important fact, summary, narration, and calculation. Do not omit relevant details.\nRequired format: clean HTML only (no markdown, no code fences, no html/body tags): one h1 title, numbered h2 section headings, rich paragraphs and short narrative summaries, bulleted lists where helpful, and tables with th/td for financial or factual breakdowns. No images, styles or attributes.\nWrite in a detailed professional style: start with a case summary, then explain the background, policy position, observed loss, assessment reasoning, supporting tables, and final conclusion. Include both summary and narrative writing. Use paragraphs for explanation and tables for amounts, schedules, and comparisons.\nDo not compress it into a brief abstract. The report should read like a complete surveyor’s narrative and summary report used by an insurer.\nSections: ${sec_}.\n\nCASE DATA:\n${dataText()}\n\n${
    !P && mo
      ? 'BILLS AND ASSESSMENT:\n' +
        billsText() +
        '\n\nCOMPUTED FINAL CALCULATION:\n' +
        finCalc()
          .rows.map((r) => r[0] + ': ' + money(r[1]))
          .join('\n') +
        '\n\n'
      : ''
  }PHOTO ANNEXES (captions): ${PH.map((p) => p.cat + (p.cap ? ': ' + p.cap : '')).join('; ') || 'none'}`;
}

function draftHTML(kind) {
  window.NOANX = true;
  let o;
  try {
    o = reportHTML();
  } finally {
    window.NOANX = false;
  }
  return kind === 'final'
    ? o.split('PRELIMINARY').join('FINAL') +
        (MOD === MODS.motor ? '<h2>Bills and final assessment</h2>' + billsHTML() + finTable() : '')
    : o;
}

function genUI(m, kind) {
  const P = kind === 'prelim',
    R = Dd.rep[kind] || (Dd.rep[kind] = {}),
    msg = h(
      'p',
      { class: 'mu' },
      R.t ? 'Last saved ' + new Date(R.t).toLocaleString() : 'Nothing saved yet'
    ),
    ed = h('div', {
      class: 'rep edt',
      contenteditable: 'true',
      'data-ph':
        'No report yet. Generate one with AI (or use the data-based draft), then edit, save and export.',
    });
  let dirty = false,
    tm,
    armed = false;
  ed.innerHTML = R.html || '';
  const sd = () => {
    dirty = false;
    R.html = clean(ed.innerHTML);
    R.t = Date.now();
    msg.textContent = 'Saved ' + new Date().toLocaleTimeString();
    sv(1);
  };
  ed.oninput = () => {
    dirty = true;
    msg.textContent = 'Unsaved edits…';
    clearTimeout(tm);
    tm = setTimeout(sd, 1500);
  };
  ed.onblur = () => {
    if (dirty) {
      clearTimeout(tm);
      sd();
    }
  };
  const gen = h('button', { class: 'b p', type: 'button' }, '✨ Generate with AI'),
    dr = h('button', { class: 'b', type: 'button' }, 'Use data-based draft (no AI)'),
    status = h(
      'span',
      {
        class: 'ai-status ' + (window.SURVEY_AI ? 'live' : 'offline'),
      },
      window.SURVEY_AI ? 'Gemini live' : 'AI offline'
    );
  const ok = () => {
    if (ed.textContent.trim() && !armed) {
      armed = true;
      msg.textContent = 'This replaces the current text. Click again to confirm.';
      setTimeout(() => (armed = false), 4000);
      return false;
    }
    armed = false;
    return true;
  };
  gen.onclick = async () => {
    if (!ok()) return;
    const ai = window.SURVEY_AI;
    if (!ai) {
      msg.textContent = 'AI is not available in this view. Use the data-based draft.';
      return;
    }
    gen.disabled = true;
    msg.textContent = 'Calling Gemini… starting the detailed report generation…';
    try {
      const r = await ai(aiPrompt(kind), {
        onText: ({ text }) => {
          const words = (text.match(/\S+/g) || []).length;
          msg.textContent = 'Gemini is writing… ' + words + ' words received so far';
        },
      });
      const words = (String(r.text || '').match(/\S+/g) || []).length;
      ed.innerHTML = clean(r.text);
      sd();
      msg.textContent =
        'Generated and saved — ' +
        words +
        ' words at ' +
        new Date().toLocaleTimeString() +
        '. Review and edit before exporting.';
    } catch (e) {
      msg.textContent =
        'AI generation failed' +
        (e && e.code ? ' (' + e.code + ')' : '') +
        '. You can use the data-based draft.';
    }
    gen.disabled = false;
  };
  dr.onclick = () => {
    if (!ok()) return;
    ed.innerHTML = clean(draftHTML(kind));
    sd();
  };
  const cmd = (c, l) =>
      h(
        'button',
        {
          class: 'b',
          type: 'button',
          onmousedown: (e) => {
            e.preventDefault();
            document.execCommand(c);
          },
        },
        l
      ),
    cd = h('input', { type: 'checkbox', id: 'xd' }),
    cp = h('input', { type: 'checkbox', id: 'xp' }),
    ca = h('input', { type: 'checkbox', id: 'xa' }),
    cm = h('input', { type: 'checkbox', id: 'xm' }),
    m2 = h('p', { class: 'mu' }),
    sb = h(
      'button',
      {
        class: 'b',
        type: 'button',
        onclick: () => {
          clearTimeout(tm);
          sd();
        },
      },
      'Save report'
    );
  cd.checked = cp.checked = ca.checked = true;
  m.append(
    h(
      'section',
      { class: 'card' },
      h('h3', {}, P ? 'Preliminary report' : 'Final report'),
      h(
        'p',
        { class: 'mu' },
        P
          ? 'Generated from the data entered so far. Edit the draft, save it, then export.'
          : 'Adds repair & maintenance bills, medical expenses (first and third party) and the surveyor’s final calculation. Enter these under “Bills & expenses” and “Final assessment” first.'
      ),
      h('div', { class: 'bar' }, status, gen, dr, sb),
      msg
    ),
    h(
      'div',
      { class: 'tl' },
      cmd('bold', 'B'),
      cmd('italic', 'I'),
      cmd('underline', 'U'),
      cmd('insertUnorderedList', '• List'),
      cmd('undo', 'Undo'),
      cmd('redo', 'Redo')
    ),
    ed,
    h(
      'section',
      { class: 'card', style: 'margin-top:14px' },
      h('h3', {}, 'Export'),
      h(
        'div',
        { class: 'bar' },
        h('label', {}, cd, ' Word (.docx)'),
        h('label', {}, cp, ' PDF'),
        h('label', {}, cm, ' Markdown (.md)'),
        h('label', {}, ca, ` Attach annexes (${PH.length} photo(s) / estimate page(s))`)
      ),
      h(
        'button',
        {
          class: 'b p',
          type: 'button',
          onclick: () => {
            clearTimeout(tm);
            if (dirty) sd();
            doExport(kind, ed, { d: cd.checked, p: cp.checked, m: cm.checked, a: ca.checked }, m2);
          },
        },
        'Export selected'
      ),
      h(
        'button',
        {
          class: 'b',
          type: 'button',
          onclick: () => {
            clearTimeout(tm);
            if (dirty) sd();
            previewDoc(kind, ed, ca.checked, m2);
          },
        },
        'Preview layout'
      ),
      m2
    )
  );
  m.append(pager());
}

MODS.motor.links = [
  ['pol_reg', 'case_insReg'],
  ['fp_reg', 'pol_reg', 'case_insReg'],
  ['fp_type', 'pol_vtype'],
  ['fp_mm', () => [g('pol_make'), g('pol_model')].filter(Boolean).join(' ')],
  ['fp_year', 'pol_year'],
  ['fp_eng', 'pol_eng'],
  ['fp_chs', 'pol_chs'],
  ['fp_oName', 'pol_insured'],
  ['fp_tel', 'pol_tel'],
  ['fp_perm', 'pol_addr'],
  ['tp_reg', 'case_tpReg'],
  [
    'case_hasTP',
    () =>
      ['Third-party liability', 'Own damage + third-party damage'].includes(g('case_ctype'))
        ? 'Yes'
        : '',
  ],
  ['acc_place', 'case_loc'],
  ['acc_vehicles', () => (hasTP() ? '2' : '1')],
  ['d1_date', 'case_survey'],
  ['d1_place', 'fp_loc'],
  ['d1_name', 'fp_dName'],
  [
    'd1_med',
    () => {
      const s = sbl('a', 'amt');
      return s > 0 ? String(s) : '';
    },
  ],
  ['d2_date', 'case_survey'],
  ['d2_place', 'tp_loc'],
  [
    'd2_med',
    () => {
      const s = sbl('b', 'amt');
      return s > 0 ? String(s) : '';
    },
  ],
  ['loss_med', 'd1_med'],
  ['loss_tinj', 'd2_med'],
  ['concl_name', 'case_surveyor'],
  ['concl_lic', 'case_lic'],
];

MODS.property.links = [
  ['risk_addr', 'case_loc'],
  ['risk_oName', 'pol_insured'],
  ['risk_oTel', 'pol_tel'],
  ['inc_cause', 'case_ctype'],
  ['dmg_date', 'case_survey'],
  ['concl_name', 'case_surveyor'],
  ['concl_lic', 'case_lic'],
];
