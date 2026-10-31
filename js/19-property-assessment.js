/* Property loss assessment (BOQ): calculator, three tables, data-entry screen
   Loaded as a classic script: everything here shares the global scope. Order of <script> tags in index.html matters. */

function ev(s) {
  s = String(s == null ? '' : s).trim();
  if (!s) return NaN;
  let i = 0;
  const ws = () => {
      while (s[i] === ' ') i++;
    },
    pe = () => {
      let v = pt();
      ws();
      while (s[i] === '+' || s[i] === '-') {
        const o = s[i++],
          r = pt();
        v = o === '+' ? v + r : v - r;
        ws();
      }
      return v;
    },
    pt = () => {
      let v = pf();
      ws();
      while (s[i] === '*' || s[i] === '/' || s[i] === 'x' || s[i] === 'X') {
        const o = s[i++],
          r = pf();
        v = o === '/' ? v / r : v * r;
        ws();
      }
      return v;
    },
    pf = () => {
      ws();
      if (s[i] === '(') {
        i++;
        const v = pe();
        ws();
        if (s[i] !== ')') throw 0;
        i++;
        return v;
      }
      if (s[i] === '-') {
        i++;
        return -pf();
      }
      const j = i;
      while (i < s.length && '0123456789.,'.includes(s[i])) i++;
      const t = s.slice(j, i).split(',').join('');
      if (!t || isNaN(+t)) throw 0;
      return +t;
    };
  try {
    const v = pe();
    ws();
    return i === s.length && isFinite(v) ? v : NaN;
  } catch (e) {
    return NaN;
  }
}

const nv = (s) => {
    const v = ev(s);
    return isNaN(v) ? 0 : v;
  },
  n2 = (x) =>
    (+x || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  ng = (x) => (x < -0.004 ? '(' + n2(-x) + ')' : n2(x));

function qOf(m) {
  m = m || {};
  const q = String(m.q == null ? '' : m.q).trim();
  if (q !== '') {
    const v = ev(q);
    return isNaN(v) ? 0 : v;
  }
  const d = ['l', 'b', 'h'].map((k) => ev(m[k])).filter((v) => !isNaN(v));
  if (!d.length) return 0;
  const n = ev(m.n);
  return d.reduce((a, b) => a * b, isNaN(n) ? 1 : n);
}

const isFormula = (q) => {
    q = String(q || '').trim();
    return q !== '' && isNaN(+q.split(',').join(''));
  },
  hasM = (m) =>
    !!m &&
    (String(m.q || '') !== '' || ['n', 'l', 'b', 'h'].some((k) => String(m[k] || '') !== ''));

const newM = () => ({ n: '', l: '', b: '', h: '', q: '' }),
  newPR = (k) => ({ k, d: '', u: '', c: newM(), a: newM(), same: true, cr: '', ar: '' }),
  newPG = () => ({ t: '', rows: [newPR('i')] }),
  newSG = () => ({ t: '', u: 'kg', lines: [{ d: '', q: '' }], pct: '100', rate: '' });

function pa() {
  const P = (Dd.pa = Dd.pa || {});
  P.g = P.g || [];
  P.salv = P.salv || [];
  if (P.excess === undefined) P.excess = g('pol_ex') || '';
  if (P.round === undefined) P.round = '100000';
  if (P.profit === undefined) P.profit = '';
  if (P.under === undefined) P.under = '';
  if (P.unote === undefined) P.unote = 'insured sum has been checked/verified adequate';
  return P;
}

const plaHas = () => {
  const P = Dd.pa;
  return !!(P && P.g && P.g.some((G) => G.rows.some((r) => r.d)));
};

function plaCalc() {
  const P = pa(),
    out = { groups: [] };
  let gC = 0,
    gA = 0;
  P.g.forEach((G, gi) => {
    const items = [],
      rows = [];
    let it = null,
      sc = 0,
      sa = 0;
    G.rows.forEach((r) => {
      if (r.k === 't') {
        rows.push({ r, sub: true, tc: sc, ta: sa });
        sc = 0;
        sa = 0;
        return;
      }
      const c = qOf(r.c),
        a = r.same ? c : qOf(r.a);
      if (r.k === 'i' || !it) {
        it = { sn: items.length + 1, r, cq: 0, aq: 0, lines: 0 };
        items.push(it);
        sc = 0;
        sa = 0;
      }
      it.cq += c;
      it.aq += a;
      it.lines++;
      sc += c;
      sa += a;
      rows.push({ r, c, a, it });
    });
    items.forEach((x) => {
      x.cr = nv(x.r.cr);
      x.ar = nv(x.r.ar);
      x.camt = x.cq * x.cr;
      x.aamt = x.aq * x.ar;
    });
    const cs = items.reduce((a, x) => a + x.camt, 0),
      as = items.reduce((a, x) => a + x.aamt, 0);
    gC += cs;
    gA += as;
    out.groups.push({ L: String.fromCharCode(65 + gi), t: G.t, G, items, rows, cs, as });
  });
  out.gC = gC;
  out.gA = gA;
  out.profit = nv(P.profit);
  out.under = nv(P.under);
  out.afterU = gA - out.profit - out.under;
  out.salv = P.salv.map((S) => {
    const tq = S.lines.reduce((a, l) => a + nv(l.q), 0),
      cq = (tq * nv(S.pct)) / 100;
    return { S, tq, cq, rate: nv(S.rate), amt: cq * nv(S.rate) };
  });
  out.salvTot = out.salv.reduce((a, x) => a + x.amt, 0);
  out.net1 = out.afterU - out.salvTot;
  out.excess = nv(P.excess);
  out.net2 = out.net1 - out.excess;
  const ru = nv(P.round) || 1;
  out.rounded = Math.round(out.net2 / ru) * ru;
  return out;
}

const E = esc;

function plaT1(C) {
  const th = (t) => `<th>${E(t)}</th>`,
    dims = (m) =>
      isFormula(m.q)
        ? `<td></td><td colspan='3' style='text-align:left'>${E(m.q)}</td>`
        : `<td>${E(m.n)}</td><td>${E(m.l)}</td><td>${E(m.b)}</td><td>${E(m.h)}</td>`,
    emp = `<td colspan='4'></td>`;
  let o = `<h3>Claim and Assessment Quantity</h3><table class='sm'><colgroup>${[4, 24, 5, 3.5, 7, 7, 7, 9, 3.5, 7, 7, 7, 9].map((w) => `<col style='width:${w}%'>`).join('')}</colgroup><tr><th></th><th></th><th></th><th colspan='5'>Claim</th><th colspan='5'>Assessment</th></tr><tr>${['Sn', 'Description', 'Unit', 'No', 'Length', 'Breadth', 'Height', 'Quantity', 'No', 'Length', 'Breadth', 'Height', 'Quantity'].map(th).join('')}</tr>`;
  C.groups.forEach((G) => {
    o += `<tr><th>${G.L}</th><th colspan='12' style='text-align:left'>${E(G.t)}</th></tr>`;
    let cur = null;
    G.rows.forEach((R, ri) => {
      const r = R.r;
      if (R.sub) {
        o += `<tr><td></td><td style='text-align:right'>Subtotal</td><td></td>${emp}<td>${n2(R.tc)}</td>${emp}<td>${n2(R.ta)}</td></tr>`;
      } else {
        if (r.k === 'i' || !cur) cur = R.it;
        const hs = hasM(r.c),
          A = r.same ? r.c : r.a;
        o += `<tr><td>${r.k === 'i' ? R.it.sn : ''}</td><td>${E(r.d)}</td><td>${E(r.k === 'i' ? r.u : '')}</td>${hs ? dims(r.c) : emp}<td>${hs ? n2(R.c) : ''}</td>${hs ? dims(A) : emp}<td>${hs ? n2(R.a) : ''}</td></tr>`;
      }
      const nx = G.rows[ri + 1];
      if ((!nx || nx.r.k === 'i') && cur && cur.lines > 1) {
        o += `<tr><td></td><td style='text-align:right'>Total</td><td>${E(cur.r.u)}</td>${emp}<td>${n2(cur.cq)}</td>${emp}<td>${n2(cur.aq)}</td></tr>`;
        cur = null;
      }
    });
  });
  return o + '</table>';
}

function plaT2(C) {
  const th = (t) => `<th>${E(t)}</th>`;
  let o = `<h3>Claim and Assessment Summary</h3><table class='sm'><colgroup>${[4, 26, 6, 11, 8, 13, 11, 8, 13].map((w) => `<col style='width:${w}%'>`).join('')}</colgroup><tr><th></th><th></th><th></th><th colspan='3'>Claim</th><th colspan='3'>Assessment</th></tr><tr>${['Sn', 'Description', 'Unit', 'Quantity', 'Rate', 'Amount', 'Quantity', 'Rate', 'Amount'].map(th).join('')}</tr><tr><th></th><th colspan='8' style='text-align:left'>Gross Loss Assessment</th></tr>`;
  C.groups.forEach((G) => {
    o +=
      `<tr><th>${G.L}</th><th colspan='8' style='text-align:left'>${E(G.t)}</th></tr>` +
      G.items
        .map(
          (x) =>
            `<tr><td>${x.sn}</td><td>${E(x.r.d)}</td><td>${E(x.r.u)}</td><td>${n2(x.cq)}</td><td>${n2(x.cr)}</td><td>${n2(x.camt)}</td><td>${n2(x.aq)}</td><td>${n2(x.ar)}</td><td>${n2(x.aamt)}</td></tr>`
        )
        .join('') +
      `<tr><td></td><td style='text-align:right'>Subtotal</td><td></td><td></td><td></td><th>${n2(G.cs)}</th><td></td><td></td><th>${n2(G.as)}</th></tr>`;
  });
  return (
    o +
    `<tr><th></th><th style='text-align:left'>Gross Loss Assessed</th><th></th><th></th><th></th><th>${n2(C.gC)}</th><th></th><th></th><th>${n2(C.gA)}</th></tr></table>`
  );
}

function plaT3(C) {
  const P = Dd.pa,
    r6 = (a, b, c, d, e, f, B) => {
      const t = B ? 'th' : 'td';
      return `<tr><${t}>${E(a)}</${t}><${t} style='text-align:left'>${E(b)}</${t}><${t}>${E(c)}</${t}><${t}>${d}</${t}><${t}>${e}</${t}><${t}>${f}</${t}></tr>`;
    },
    amt = (x) => n2(x);
  let L = 0,
    o = `<h3>Net Loss Assessment</h3><table class='sm'><colgroup>${[5, 38, 8, 15, 10, 24].map((w) => `<col style='width:${w}%'>`).join('')}</colgroup>`;
  o +=
    r6('', 'Gross Loss Assessed', '', '', '', amt(C.gA), 1) +
    r6('', 'Net Loss Assessment', '', '', '', '', 1) +
    r6('', 'Gross loss assessed above', '', '', '', amt(C.gA)) +
    r6(
      '',
      'Less profit (assessment above is without profit)',
      '',
      '',
      '',
      C.profit ? ng(-C.profit) : '-'
    );
  if (C.under) o += r6('', 'Less underinsurance adjustment', '', '', '', ng(-C.under));
  o += r6(
    '',
    'Loss after applying underinsurance clause (' + (P.unote || '') + ')',
    '',
    '',
    '',
    amt(C.afterU)
  );
  if (C.salv.length) {
    o += r6('', 'Less salvage (recommended/negotiable)', '', 'Quantity', 'Rate', '', 1);
    C.salv.forEach((x) => {
      const u = x.S.u || '';
      x.S.lines.forEach((l) => {
        if (l.d || l.q)
          o += r6(String.fromCharCode(65 + L++), l.d, u, l.q === '' ? '' : n2(nv(l.q)), '', '');
      });
      o += r6('', 'Total in ' + u, u, n2(x.tq), '', '');
      o += r6(
        '',
        'Considering ' +
          nv(x.S.pct) +
          '% quantity for salvage consideration (Rs ' +
          nv(x.S.rate) +
          '/' +
          u +
          ')',
        '',
        n2(x.cq),
        n2(x.rate),
        ng(-x.amt)
      );
    });
  }
  o +=
    r6('', 'Net loss after salvage but before policy excess', '', '', '', amt(C.net1), 1) +
    r6('', 'Less policy excess', '', '', '', ng(-C.excess)) +
    r6('', 'Recommended Net Loss', '', '', '', amt(C.net2)) +
    r6('', 'Recommended Net Loss after deductions (rounded)', '', '', '', amt(C.rounded), 1);
  return o + `</table><p><i>Table # Gross and Net Loss amount Assessment</i></p>`;
}

const plaHTML = () => {
  const C = plaCalc();
  return plaT1(C) + plaT2(C) + plaT3(C);
};

function plaText() {
  const C = plaCalc();
  return (
    '## Loss assessment (bill of quantities)\nClaimed gross loss: ' +
    n2(C.gC) +
    '\nAssessed gross loss: ' +
    n2(C.gA) +
    '\nLess profit: ' +
    n2(C.profit) +
    '; underinsurance adjustment: ' +
    n2(C.under) +
    '\nSalvage deduction: ' +
    n2(C.salvTot) +
    '\nNet loss before policy excess: ' +
    n2(C.net1) +
    '\nPolicy excess: ' +
    n2(C.excess) +
    '\nRecommended net loss: ' +
    n2(C.net2) +
    '\nRecommended net loss (rounded): ' +
    n2(C.rounded) +
    '\nSections: ' +
    C.groups.map((G) => G.L + ' ' + G.t).join('; ')
  );
}

function secBody(body) {
  const S = secBlocks(body);
  if (MOD === MODS.property && plaHas())
    S.push({ t: 'Loss assessment', h: '<h2>Loss assessment</h2>' + plaHTML() });
  return S;
}

function plaUI(m) {
  const P = pa(),
    gbox = h('div'),
    sbox = h('div'),
    pv = h('div', { class: 'plv' }),
    ups = [];
  const refresh = () => {
      ups.forEach((f) => f());
      const C = plaCalc();
      pv.innerHTML = plaT1(C) + plaT2(C) + plaT3(C);
      sv();
    },
    inp = (o, k, ph, ty, cls) => {
      const e = h('input', { placeholder: ph || '' });
      if (ty === 'n') {
        e.inputMode = 'decimal';
      }
      e.value = o[k] || '';
      if (cls) e.className = cls;
      e.oninput = () => {
        o[k] = e.value;
        refresh();
      };
      e.onblur = () => sv(1);
      return e;
    };
  const mcell = (r, w, k, ph) => {
    const e = h('input', { placeholder: ph, inputMode: 'decimal' });
    e.value = r[w][k] || '';
    e.oninput = () => {
      r[w][k] = e.value;
      if (w === 'c' && r.same) r.a[k] = e.value;
      refresh();
    };
    e.onblur = () => sv(1);
    return e;
  };
  const drawG = () => {
    gbox.replaceChildren(
      ...P.g.map((G, gi) => {
        const tb = h('tbody'),
          card = h('section', { class: 'card' }),
          tt = inp(G, 't', 'Section title, e.g. Retaining wall 34\u2019 part');
        const draw = () => {
          tb.replaceChildren();
          let sn = 0;
          G.rows.forEach((r, ri) => {
            const tr = h('tr', { class: r.k === 't' ? 'st' : '' }),
              isI = r.k === 'i',
              isT = r.k === 't';
            tr.append(h('td', { class: 'sn' }, isI ? ++sn : isT ? '\u03a3' : ''));
            const d = inp(
              r,
              'd',
              isT ? 'Subtotal' : isI ? 'Item description' : 'Sub-line description'
            );
            if (isT) {
              d.readOnly = true;
              d.value = 'Subtotal';
            }
            tr.append(h('td', {}, d));
            const u = inp(r, 'u', 'unit');
            if (!isI) {
              u.disabled = true;
              u.value = '';
            }
            tr.append(h('td', {}, u));
            const cs = ['n', 'l', 'b', 'h', 'q'];
            const cin = cs.map((k) =>
              mcell(r, 'c', k, k === 'q' ? 'qty / formula' : k.toUpperCase())
            );
            const ain = cs.map((k) =>
              mcell(r, 'a', k, k === 'q' ? 'qty / formula' : k.toUpperCase())
            );
            cin.forEach((e) => {
              if (isT) e.disabled = true;
              tr.append(h('td', {}, e));
            });
            const ck = h('input', { type: 'checkbox', title: 'Assessment same as claim' });
            ck.checked = !!r.same;
            ck.onchange = () => {
              r.same = ck.checked;
              if (r.same) cs.forEach((k) => (r.a[k] = r.c[k]));
              ain.forEach((e, i) => {
                e.value = r.a[cs[i]] || '';
                e.disabled = r.same;
              });
              refresh();
              sv(1);
            };
            if (isT) ck.disabled = true;
            tr.append(h('td', { class: 'sn' }, ck));
            ain.forEach((e) => {
              e.disabled = isT || r.same;
              tr.append(h('td', {}, e));
            });
            const rc = inp(r, 'cr', 'rate'),
              ra = inp(r, 'ar', 'rate');
            if (!isI) {
              rc.disabled = ra.disabled = true;
              rc.value = ra.value = '';
            }
            tr.append(h('td', {}, rc), h('td', {}, ra));
            ups.push(() => {
              if (!isT) {
                const q = qOf(r.c),
                  a = r.same ? q : qOf(r.a);
                cin[4].title = '= ' + n2(q);
                ain[4].title = '= ' + n2(a);
                if (!r.c.q) cin[4].placeholder = hasM(r.c) ? n2(q) : 'qty / formula';
                if (!r.a.q) ain[4].placeholder = hasM(r.same ? r.c : r.a) ? n2(a) : 'qty / formula';
              }
            });
            tr.append(
              h(
                'td',
                { class: 'sn' },
                h(
                  'button',
                  {
                    class: 'b xb',
                    type: 'button',
                    title: 'Delete row',
                    onclick: () => {
                      G.rows.splice(ri, 1);
                      if (!G.rows.length) G.rows.push(newPR('i'));
                      drawG();
                      refresh();
                    },
                  },
                  '\u2715'
                )
              )
            );
            tb.append(tr);
          });
          refresh0();
        };
        const refresh0 = () => {
          ups.forEach((f) => f());
        };
        const hd = [
          'Sn',
          'Description',
          'Unit',
          'No',
          'L',
          'B',
          'H',
          'Qty',
          '=',
          'No',
          'L',
          'B',
          'H',
          'Qty',
          'Rate (claim)',
          'Rate (assess.)',
          '',
        ];
        draw();
        card.append(
          h(
            'div',
            { class: 'bar', style: 'margin-top:0' },
            h('h3', { style: 'margin:0' }, 'Section ' + String.fromCharCode(65 + gi)),
            tt,
            h(
              'button',
              {
                class: 'b',
                type: 'button',
                onclick: () => {
                  P.g.splice(gi, 1);
                  drawG();
                  refresh();
                },
              },
              'Delete section'
            )
          ),
          h(
            'p',
            { class: 'mu', style: 'margin:2px 0' },
            'Claim: No \u00d7 L \u00d7 B \u00d7 H, or type a quantity / formula such as (111.59/35.28)*7850*.02 in Qty. Tick \u201c=\u201d when the assessment equals the claim. Rates go on item rows.'
          ),
          h(
            'div',
            { class: 'scr' },
            h(
              'table',
              { class: 'xl', style: 'min-width:1250px' },
              h(
                'colgroup',
                {},
                ...[34, 230, 54, 48, 60, 60, 60, 110, 34, 48, 60, 60, 60, 110, 84, 84, 34].map(
                  (w) => h('col', { style: 'width:' + w + 'px' })
                )
              ),
              h(
                'thead',
                {},
                h(
                  'tr',
                  {},
                  h('th', { colspan: '3' }, ''),
                  h('th', { colspan: '5' }, 'Claim'),
                  h('th', {}, ''),
                  h('th', { colspan: '5' }, 'Assessment'),
                  h('th', { colspan: '3' }, '')
                ),
                h('tr', {}, ...hd.map((x) => h('th', {}, x)))
              ),
              tb
            )
          ),
          h(
            'div',
            { class: 'bar' },
            h(
              'button',
              {
                class: 'b',
                type: 'button',
                onclick: () => {
                  G.rows.push(newPR('i'));
                  draw();
                  refresh();
                },
              },
              '+ Item'
            ),
            h(
              'button',
              {
                class: 'b',
                type: 'button',
                onclick: () => {
                  G.rows.push(newPR('s'));
                  draw();
                  refresh();
                },
              },
              '+ Sub-line'
            ),
            h(
              'button',
              {
                class: 'b',
                type: 'button',
                onclick: () => {
                  G.rows.push(newPR('t'));
                  draw();
                  refresh();
                },
              },
              '+ Subtotal row'
            )
          )
        );
        return card;
      })
    );
  };
  const drawS = () => {
    sbox.replaceChildren(
      ...P.salv.map((S, si) => {
        const lb = h('div'),
          card = h('div', { class: 'ivc' });
        const dl = () => {
          lb.replaceChildren(
            ...S.lines.map((l, li) =>
              h(
                'div',
                { class: 'bar', style: 'margin:4px 0' },
                inp(l, 'd', 'Salvage item description'),
                inp(l, 'q', 'Quantity', 'n'),
                h(
                  'button',
                  {
                    class: 'b xb',
                    type: 'button',
                    onclick: () => {
                      S.lines.splice(li, 1);
                      if (!S.lines.length) S.lines.push({ d: '', q: '' });
                      dl();
                      refresh();
                    },
                  },
                  '\u2715'
                )
              )
            )
          );
        };
        dl();
        card.append(
          h(
            'div',
            { class: 'ivh' },
            h('div', { class: 'fld' }, h('label', {}, 'Unit (kg, cft\u2026)'), inp(S, 'u', 'kg')),
            h(
              'div',
              { class: 'fld' },
              h('label', {}, '% of quantity considered'),
              inp(S, 'pct', '70', 'n')
            ),
            h(
              'div',
              { class: 'fld' },
              h('label', {}, 'Salvage rate (Rs per unit)'),
              inp(S, 'rate', '25', 'n')
            )
          ),
          lb,
          h(
            'div',
            { class: 'bar' },
            h(
              'button',
              {
                class: 'b',
                type: 'button',
                onclick: () => {
                  S.lines.push({ d: '', q: '' });
                  dl();
                },
              },
              '+ Add salvage line'
            ),
            h(
              'button',
              {
                class: 'b',
                type: 'button',
                onclick: () => {
                  P.salv.splice(si, 1);
                  drawS();
                  refresh();
                },
              },
              'Delete this salvage group'
            )
          )
        );
        return card;
      })
    );
  };
  drawG();
  drawS();
  const ng_ = h(
    'div',
    { class: 'grid' },
    ...[
      ['Less profit (amount)', 'profit'],
      ['Underinsurance adjustment (amount, if any)', 'under'],
      ['Underinsurance note', 'unote'],
      ['Policy excess (amount)', 'excess'],
      ['Round recommended net loss to nearest', 'round'],
    ].map(([l, k]) =>
      h('div', { class: 'fld' }, h('label', {}, l), inp(P, k, '', k === 'unote' ? '' : 'n'))
    )
  );
  m.append(
    h(
      'p',
      { class: 'mu' },
      'Property loss assessment in the format of a bill of quantities. The three tables below the entry area are built from this data and are added to the report automatically.'
    ),
    gbox,
    h(
      'div',
      { class: 'bar' },
      h(
        'button',
        {
          class: 'b p',
          type: 'button',
          onclick: () => {
            P.g.push(newPG());
            drawG();
            refresh();
          },
        },
        '+ Add section (A, B, C\u2026)'
      )
    ),
    h(
      'section',
      { class: 'card' },
      h('h3', {}, 'Net loss: profit, underinsurance, salvage and policy excess'),
      ng_,
      h('h4', { style: 'margin:12px 0 4px' }, 'Salvage'),
      sbox,
      h(
        'div',
        { class: 'bar' },
        h(
          'button',
          {
            class: 'b',
            type: 'button',
            onclick: () => {
              P.salv.push(newSG());
              drawS();
              refresh();
            },
          },
          '+ Add salvage group'
        )
      )
    ),
    h(
      'section',
      { class: 'card' },
      h('h3', {}, 'Tables as they appear in the report'),
      h('div', { class: 'scr' }, pv)
    )
  );
  refresh();
}
