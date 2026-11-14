/* Excel-style bill tables, bills HTML/text, safeName, softWrap, fitTable
   Loaded as a classic script: everything here shares the global scope. Order of <script> tags in index.html matters. */

const ivT = (iv, k) => iv.rows.reduce((b, r) => b + (+r[k] > 0 ? +r[k] : 0), 0),
  newRow = () => ({ d: '', qty: '', rate: '', amt: '', as: '', rm: '' }),
  newInv = () => ({ no: '', date: '', vendor: '', rows: [newRow()] });

function bn(q) {
  Dd.b = Dd.b || {};
  const L = (Dd.b[q] = Dd.b[q] || []);
  for (let i = 0; i < L.length; i++) {
    const x = L[i];
    if (!x.rows)
      L[i] = {
        no: x.no || '',
        date: '',
        vendor: x.d || '',
        rows: [{ d: x.d || '', qty: '', rate: '', amt: x.amt || '', as: x.as || '', rm: '' }],
      };
  }
  return L;
}

function billIssues() {
  const o = [],
    seen = {},
    Q = Object.keys(BT).filter(bq);
  Q.forEach((q) =>
    bn(q).forEach((iv, i) => {
      const n = nz(iv.no);
      if (n) (seen[n] = seen[n] || []).push(q + i);
    })
  );
  Q.forEach((q) =>
    bn(q).forEach((iv, i) => {
      const n = nz(iv.no),
        any = iv.rows.some((r) => r.d || r.amt || r.as || r.qty || r.rate);
      if (!n && !any && !iv.vendor) return;
      const p = BT[q] + ' \u2013 bill ' + (i + 1),
        id = 'iv_' + q + '_' + i;
      if (!n) o.push({ w: 0, m: p + ': invoice no. missing', b: id });
      else if (seen[n].length > 1)
        o.push({
          w: 1,
          m: `${p}: invoice ${iv.no} appears ${seen[n].length}\u00d7 \u2013 check for duplicates`,
          b: id,
        });
      iv.rows.forEach((r, j) => {
        [
          ['qty', 'quantity'],
          ['rate', 'rate'],
          ['amt', 'billed amount'],
          ['as', 'assessed amount'],
        ].forEach(([k, l]) => {
          const v = String(r[k] || '').trim();
          if (v !== '' && (!isFinite(v) || +v < 0))
            o.push({ w: 0, m: `${p}, row ${j + 1}: ${l} must be a non-negative number`, b: id });
        });
        if (+r.as > 0 && +r.amt > 0 && +r.as > +r.amt)
          o.push({ w: 1, m: `${p}, row ${j + 1}: assessed amount is higher than billed`, b: id });
      });
    })
  );
  return o;
}

function pb() {
  autofill();
  Object.keys(BT).forEach((q) => {
    const e = $('#bt_' + q);
    if (e)
      e.textContent = `Billed: ${money(sbl(q, 'amt'))} \u00b7 Assessed: ${money(sbl(q, 'as'))}`;
  });
  const is = billIssues();
  document.querySelectorAll('.ivc.bad').forEach((r) => r.classList.remove('bad'));
  is.forEach((i) => {
    const r = document.getElementById(i.b);
    if (r) r.classList.add('bad');
  });
  const bi = $('#bi');
  if (bi)
    bi.replaceChildren(
      ...is.map((i) => h('p', { class: i.w ? 'wn' : 'er' }, (i.w ? '\u26a0 ' : '\u2716 ') + i.m))
    );
  const fc = $('#fc');
  if (fc) fc.innerHTML = '<h3>Surveyor\u2019s final calculation (live preview)</h3>' + finTable();
  nav();
}

function ivCard(q, L, i, redraw) {
  const iv = L[i],
    card = h('div', { class: 'ivc', id: `iv_${q}_${i}` }),
    COL = [
      ['d', 'Description of item / service', 'text', '34%'],
      ['qty', 'Qty', 'number', '8%'],
      ['rate', 'Rate', 'number', '11%'],
      ['amt', 'Billed amount', 'number', '14%'],
      ['as', 'Assessed amount', 'number', '14%'],
      ['rm', 'Remarks', 'text', '15%'],
    ];
  const hf = (l, k, dt) => {
    const e = h('input', { placeholder: l });
    e.value = iv[k] || '';
    if (dt) {
      e.readOnly = true;
      e.style.cursor = 'pointer';
      e.onclick = () => openDP(e);
      e.onchange = () => {
        iv[k] = e.value;
        sv(1);
      };
    } else {
      e.oninput = () => {
        iv[k] = e.value;
        pb();
        sv();
      };
      e.onblur = () => sv(1);
    }
    return h('div', { class: 'fld' }, h('label', {}, l), e);
  };
  const tb = h('tbody'),
    tf = h('tfoot'),
    foot = () =>
      tf.replaceChildren(
        h(
          'tr',
          {},
          h('td', { colspan: '4' }, 'Total'),
          h('td', {}, money(ivT(iv, 'amt'))),
          h('td', {}, money(ivT(iv, 'as'))),
          h('td', { colspan: '2' })
        )
      );
  const draw = () => {
    tb.replaceChildren();
    iv.rows.forEach((r, ri) => {
      const tr = h('tr', {}),
        ins = {};
      tr.append(h('td', { class: 'sn' }, ri + 1));
      COL.forEach(([k, ph, ty], ci) => {
        const e = h('input', { placeholder: ph });
        if (ty === 'number') {
          e.type = 'number';
          e.step = 'any';
          e.min = '0';
        }
        e.value = r[k] || '';
        ins[k] = e;
        e.oninput = () => {
          r[k] = e.value;
          if (
            (k === 'qty' || k === 'rate') &&
            r.qty !== '' &&
            r.rate !== '' &&
            isFinite(r.qty) &&
            isFinite(r.rate)
          ) {
            r.amt = String(Math.round(+r.qty * +r.rate * 100) / 100);
            ins.amt.value = r.amt;
          }
          foot();
          pb();
          sv();
        };
        e.onblur = () => sv(1);
        e.onkeydown = (ev) => {
          const go = (d) => {
            ev.preventDefault();
            const t = ri + d;
            if (t < 0) return;
            if (t >= iv.rows.length) {
              iv.rows.push(newRow());
              draw();
              foot();
            }
            const nx = tb.rows[t];
            if (nx) nx.querySelectorAll('input')[ci].focus();
          };
          if (ev.key === 'Enter' || ev.key === 'ArrowDown') go(1);
          else if (ev.key === 'ArrowUp') go(-1);
        };
        e.onpaste = (ev) => {
          const t = (ev.clipboardData || window.clipboardData).getData('text');
          if (t.indexOf('\t') < 0 && t.indexOf('\n') < 0) return;
          ev.preventDefault();
          const ls = t
            .split('\n')
            .map((x) => x.split('\r').join(''))
            .filter((x, ix, a) => x !== '' || ix < a.length - 1);
          ls.forEach((ln, li) => {
            const row = iv.rows[ri + li] || (iv.rows.push(newRow()), iv.rows[ri + li]);
            ln.split('\t').forEach((cv, cj) => {
              const c = COL[ci + cj];
              if (c) row[c[0]] = cv.trim();
            });
          });
          draw();
          foot();
          pb();
          sv(1);
        };
        tr.append(h('td', {}, e));
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
                iv.rows.splice(ri, 1);
                if (!iv.rows.length) iv.rows.push(newRow());
                draw();
                foot();
                pb();
                sv(1);
              },
            },
            '\u2715'
          )
        )
      );
      tb.append(tr);
    });
  };
  draw();
  foot();
  const dl = h('button', { class: 'b', type: 'button' }, '\ud83d\uddd1 Delete this bill');
  dl.onclick = () => {
    const billRef = (iv.no || 'this bill').trim() || 'this bill';
    confirmDeleteDialog({
      title: 'Delete bill',
      message: `Are you sure you want to delete ${billRef}? This cannot be undone.`,
      onConfirm: () => {
        L.splice(i, 1);
        if (!L.length) L.push(newInv());
        redraw();
        sv(1);
      },
    });
  };
  card.append(
    h(
      'div',
      { class: 'ivh' },
      hf('Invoice / bill no.', 'no'),
      hf('Invoice date', 'date', 1),
      hf('Workshop / supplier / hospital', 'vendor')
    ),
    h(
      'div',
      { class: 'scr' },
      h(
        'table',
        { class: 'xl' },
        h(
          'colgroup',
          {},
          h('col', { style: 'width:34px' }),
          ...COL.map((c) => h('col', { style: 'width:' + c[3] })),
          h('col', { style: 'width:34px' })
        ),
        h(
          'thead',
          {},
          h('tr', {}, h('th', {}, '#'), ...COL.map((c) => h('th', {}, c[1])), h('th', {}, ''))
        ),
        tb,
        tf
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
            iv.rows.push(newRow());
            draw();
            foot();
            sv(1);
          },
        },
        '+ Add row'
      ),
      h(
        'button',
        {
          class: 'b',
          type: 'button',
          onclick: () => {
            iv.rows.forEach((r) => {
              if (r.amt && !r.as) r.as = r.amt;
            });
            draw();
            foot();
            pb();
            sv(1);
          },
        },
        'Assess in full'
      ),
      dl
    )
  );
  return card;
}

function billsUI(m) {
  Dd.b = Dd.b || {};
  Object.keys(BT)
    .filter(bq)
    .forEach((q) => {
      const L = bn(q);
      if (!L.length) L.push(newInv());
      const box = h('div'),
        draw = () => {
          box.replaceChildren(...L.map((iv, i) => ivCard(q, L, i, draw)));
          pb();
        };
      draw();
      m.append(
        h(
          'section',
          { class: 'card' },
          h('h3', {}, BT[q]),
          h(
            'p',
            { class: 'mu' },
            'One table per invoice. Press Enter to add a row, or paste rows copied from Excel.'
          ),
          box,
          h(
            'div',
            { class: 'bar' },
            h(
              'button',
              {
                class: 'b p',
                type: 'button',
                onclick: () => {
                  L.push(newInv());
                  draw();
                  sv(1);
                },
              },
              '+ Add bill / invoice table'
            ),
            h('b', { id: 'bt_' + q })
          )
        )
      );
    });
  m.append(h('div', { id: 'bi' }), h('section', { class: 'card', id: 'fc' }));
  pb();
}

function billsHTML() {
  return Object.keys(BT)
    .filter(bq)
    .map((q) => {
      const L = bn(q).filter((iv) => iv.no || iv.rows.some((r) => r.d || r.amt || r.as));
      if (!L.length) return '';
      return (
        `<h3>${BT[q]}</h3>` +
        L.map(
          (iv) =>
            `<h4>Invoice ${esc(iv.no || '(no. not entered)')}${iv.vendor ? ' \u2013 ' + esc(iv.vendor) : ''}${iv.date ? ' \u00b7 ' + esc(dtf(iv.date)) : ''}</h4><table><colgroup><col style='width:6%'><col style='width:30%'><col style='width:7%'><col style='width:13%'><col style='width:14%'><col style='width:14%'><col style='width:16%'></colgroup><tr><th>S.N.</th><th>Description</th><th>Qty</th><th>Rate</th><th>Billed</th><th>Assessed</th><th>Remarks</th></tr>${iv.rows
              .filter((r) => r.d || r.amt || r.as)
              .map(
                (r, j) =>
                  `<tr><td>${j + 1}</td><td>${esc(r.d || '')}</td><td>${esc(r.qty || '')}</td><td>${r.rate ? esc(money(r.rate)) : ''}</td><td>${esc(money(r.amt))}</td><td>${esc(money(r.as))}</td><td>${esc(r.rm || '')}</td></tr>`
              )
              .join(
                ''
              )}<tr><th colspan='4'>Total</th><th>${esc(money(ivT(iv, 'amt')))}</th><th>${esc(money(ivT(iv, 'as')))}</th><th></th></tr></table>`
        ).join('') +
        `<p><b>Total:</b> billed ${esc(money(sbl(q, 'amt')))}, assessed ${esc(money(sbl(q, 'as')))}</p>`
      );
    })
    .join('');
}

function billsText() {
  return Object.keys(BT)
    .filter(bq)
    .map(
      (q) =>
        BT[q] +
        ':\n' +
        (bn(q)
          .filter((iv) => iv.no || iv.rows.some((r) => r.d || r.amt || r.as))
          .map(
            (iv) =>
              'Invoice ' +
              (iv.no || '(no. not entered)') +
              (iv.vendor ? ' from ' + iv.vendor : '') +
              (iv.date ? ' dated ' + iv.date : '') +
              '\n' +
              iv.rows
                .filter((r) => r.d || r.amt || r.as)
                .map(
                  (r) =>
                    `  - ${r.d || 'item'} | qty ${r.qty || '-'} | rate ${r.rate || '-'} | billed ${money(r.amt)} | assessed ${money(r.as)}${r.rm ? ' | ' + r.rm : ''}`
                )
                .join('\n')
          )
          .join('\n') || '- none entered')
    )
    .join('\n\n');
}

function safeName(t) {
  return (
    String(t)
      .split('')
      .map((c) => ('\\/:*?"<>|'.includes(c) || c.charCodeAt(0) < 32 ? '-' : c))
      .join('')
      .trim() || 'case'
  );
}

function softWrap(root) {
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT),
    ns = [];
  while (w.nextNode()) ns.push(w.currentNode);
  ns.forEach((n) => {
    const t = n.nodeValue;
    if (!t) return;
    n.nodeValue = t
      .split(' ')
      .map((x) => (x.length > 16 ? x.match(/.{1,12}/g).join('\u200b') : x))
      .join(' ');
  });
}

function fitTable(t) {
  if (t.querySelector('colgroup')) return;
  const rows = [...t.querySelectorAll('tr')];
  if (!rows.length) return;
  const nc = Math.max(
      ...rows.map((r) => [...r.children].reduce((a, c) => a + +(c.getAttribute('colspan') || 1), 0))
    ),
    wt = Array(nc).fill(8);
  rows.forEach((r) => {
    let ci = 0;
    [...r.children].forEach((c) => {
      const sp = +(c.getAttribute('colspan') || 1);
      if (sp === 1)
        wt[ci] = Math.max(
          wt[ci],
          Math.min(36, c.textContent.trim().length + (c.tagName === 'TH' ? 6 : 0))
        );
      ci += sp;
    });
  });
  const sum = wt.reduce((a, b) => a + b, 0),
    cg = document.createElement('colgroup');
  wt.forEach((x) => {
    const c = document.createElement('col');
    c.style.width = ((100 * x) / sum).toFixed(1) + '%';
    cg.append(c);
  });
  t.prepend(cg);
  t.style.width = '100%';
}
