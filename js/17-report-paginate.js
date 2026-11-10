/* Font loading (LM Roman 10) and page-by-page report builder docBuild()
   Loaded as a classic script: everything here shares the global scope. Order of <script> tags in index.html matters. */

let fontOK = null;

function ensureFont() {
  return (
    fontOK ||
    (fontOK = (async () => {
      try {
        for (const [k, w, st] of [
          ['r', '400', 'normal'],
          ['b', '700', 'normal'],
          ['i', '400', 'italic'],
          ['bi', '700', 'italic'],
        ]) {
          const bin = atob(LMF[k]),
            a = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
          const f = new FontFace('LM Roman 10', a.buffer, { weight: w, style: st });
          await f.load();
          document.fonts.add(f);
        }
      } catch (e) {}
    })())
  );
}

/* The running header says what the document is and which claim it belongs to. Report templates
   never write this line, so every report type carries the same identification in the same place. */
function reportIdentity(kind) {
  return [
    (MOD === MODS.property ? 'Property survey' : 'Motor vehicle survey') +
      ' · ' +
      kindCfg(kind).label,
    claimRef(),
  ];
}

/* One engine, one page model: every page is a finished A4 box holding the shared header, a
   measured content area and the stamp footer. The exporter makes exactly one PDF page out of each
   box, which is what puts the stamp on every page - cover, contents, disclaimer, content,
   continuation, assessment, annexure and photograph pages alike.
   Which of those pages a given report type gets is not the engine's business: it reads
   REPORT_KINDS. Returns {el, inner, warnings, pages}. Warnings is how a page that is fuller than a
   page - and a spot report that is longer than two sheets - reaches the person who has to shorten
   it, instead of running off the bottom of a sheet nobody opens. */
async function docBuild(kind, body, anx, nums) {
  await ensureFont();
  const K = kindCfg(kind),
    sig = await getA('sig'),
    stp = await getA('stp'),
    P = PDF_DESIGN.page,
    secs = secBody(body),
    ann = anx ? await annexBlocks() : [],
    warnings = [],
    el = h('div', { class: 'dc' });
  if (!sig && !stp)
    warnings.push(
      'No surveyor stamp or signature is on file, so this report is unsigned. The surveyor assigned to this case must upload it under Role & settings before the report is issued.'
    );
  el.style.cssText = 'position:fixed;left:-10000px;top:0;width:' + P.w + 'mm';
  el.innerHTML = '<style>' + dcss('.dc ') + '</style>';
  document.body.append(el);
  if (K.cover) {
    const wr = document.createElement('div');
    wr.innerHTML = await coverHTML(kind, sig, stp);
    el.append(wr.firstElementChild);
  }
  const [idTitle, idRef] = reportIdentity(kind);
  let cur = null;
  const mk = (header) => {
      const d = h('div', { class: 'pb pgx' });
      d.innerHTML =
        (header === false ? '' : reportHeader(idTitle, idRef)) + '<div class="pg-body"></div>';
      d.insertAdjacentHTML('beforeend', reportFooter(sig, stp));
      el.append(d);
      return d;
    },
    flow = () => cur.querySelector('.pg-body'),
    /* A column is full when the last thing drawn in it reaches past its foot. The scroll height
       cannot be the test: it also carries the bottom margin of that last element, so a table that
       ends one pixel short of the foot reports as overflowing by the six pixels of its own margin
       and the page then warns about content nobody can see is missing. */
    over = (f) => {
      const l = f.lastElementChild;
      return !!l && l.offsetTop + l.offsetHeight > f.clientHeight + 1;
    },
    full = () => over(flow()),
    fresh = () => {
      cur = mk();
    };
  cur = mk();
  const tocP = K.toc ? cur : null;
  let dP = null;
  if (K.discPage) {
    /* mk() only appends - cur still points at the previous page, so the disclaimer has to be
       written into dP itself rather than through flow(). */
    dP = mk();
    dP.querySelector('.pg-body').innerHTML = discInner(kind);
    cur = mk();
  } else if (!K.cover) {
    const sh = document.createElement('div');
    sh.innerHTML = await spotHeadHTML(kind, sig, stp);
    flow().append(sh.firstElementChild);
  }
  const KD = ['TABLE', 'UL', 'OL'],
    split = (bl) => {
      const tb = bl.tagName === 'TABLE',
        rows = [...(tb ? bl.querySelectorAll('tr') : bl.children)],
        /* fitTable gives every table its column widths through a colgroup, and a continuation of a
           split table needs the same widths, so the colgroup travels with each part. */
        cg = tb ? bl.querySelector('colgroup') : null,
        /* The header row is the first row made entirely of th cells, whether or not the template
           wrapped it in a thead. A table that carries on to the next sheet arrives there with its
           column labels, because a continuation without them is not readable. */
        hr = tb
          ? [...bl.querySelectorAll('tr')].find(
              (r) => r.children.length && ![...r.children].some((c) => c.tagName !== 'TH')
            )
          : null,
        mkc = (again) => {
          const c = bl.cloneNode(false),
            body = tb ? h('tbody') : null;
          if (cg) c.append(cg.cloneNode(true));
          if (body) c.append(body);
          if (again && hr && body) body.append(hr.cloneNode(true));
          return { c, hd: body || c };
        };
      let { c, hd } = mkc();
      bl.replaceWith(c);
      rows.forEach((r) => {
        hd.append(r);
        if (full() && hd.children.length > 1) {
          hd.removeChild(r);
          fresh();
          const n = mkc(true);
          c = n.c;
          hd = n.hd;
          flow().append(c);
          hd.append(r);
        }
      });
    },
    /* A paragraph that reaches past the foot of a sheet is broken at the last line that fits, the
       way a printed report carries text across pages. Moving the whole paragraph to the next sheet
       leaves a gap at the foot of this one, and a report with a two-page limit has no room for
       gaps: with whole-paragraph moves a spot report ran to three sheets while its sections
       measured only 466 mm against 514 mm of printed column.
       Only a plain-text paragraph is broken; one carrying markup, or one too short to leave two
       lines on either sheet, moves whole instead. Returns the remainder, already on a fresh page. */
    breakP = (bl) => {
      const box = flow(),
        words = (bl.textContent || '').split(/(\s+)/);
      if (bl.children.length || words.length < 16) return null;
      const pr = bl.cloneNode(true),
        top = bl.offsetTop,
        cap = box.clientHeight - top,
        hh = (n) => {
          pr.textContent = words.slice(0, n).join('');
          return pr.offsetHeight;
        };
      box.append(pr);
      const line = hh(3);
      let lo = 3,
        hi = words.length - 1,
        best = 0,
        headH = 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (hh(mid) <= cap) {
          best = mid;
          headH = pr.offsetHeight;
          lo = mid + 1;
        } else hi = mid - 1;
      }
      pr.remove();
      /* headH is taken while the probe is still in the page: once removed it measures nothing. */
      if (best < 8 || headH < line * 2) return null;
      const tail = bl.cloneNode(true);
      bl.textContent = words.slice(0, best).join('');
      tail.textContent = words.slice(best).join('');
      fresh();
      flow().append(tail);
      return tail;
    },
    /* A table or list is broken between rows on the sheet it starts on, so the space left at the
       foot is used; a block that cannot be broken at all moves whole instead. The first row still
       needs room of its own, otherwise the whole block travels to the next sheet with its heading. */
    canBreak = (bl) => {
      /* The first row, which for a table means tr: a table's first element child is the colgroup
         that fitTable adds, and a col is as tall as the whole table, so measuring it makes every
         table look unbreakable and sends heading and table together to the next sheet. */
      const r0 = bl.rows ? bl.rows[0] : bl.children[0];
      return !!r0 && bl.offsetTop + r0.offsetHeight <= flow().clientHeight + 1;
    },
    put = (bl) => {
      flow().append(bl);
      if (bl.tagName === 'P') {
        let last = bl;
        while (full()) {
          const t = breakP(last);
          if (!t) break;
          last = t;
        }
        if (!full()) return;
        bl = last;
      }
      if (!full()) return;
      if (KD.includes(bl.tagName) && canBreak(bl)) {
        split(bl);
        return;
      }
      if (flow().children.length > 1) {
        flow().removeChild(bl);
        const pv = flow().lastElementChild;
        let mv = [bl];
        // a heading alone at the foot of a page moves with the block that follows it
        if (pv && /^H[2-4]$/.test(pv.tagName)) {
          flow().removeChild(pv);
          mv = [pv, bl];
        }
        fresh();
        mv.forEach((x) => flow().append(x));
        if (full() && KD.includes(bl.tagName)) split(bl);
      } else if (KD.includes(bl.tagName)) split(bl);
    };
  const heads = [],
    /* What each section is on its own, in millimetres of the printed column. The page-limit warning
       has to name the section to shorten, and a running total cannot do that: a section that fits
       inside the page it lands on changes the total by nothing, so the three "longest" sections
       would be whatever happened to overflow last. Each section is therefore measured once in a
       column as wide as the page's own, off to the side and never counted as a sheet. */
    cost = [],
    probe = h('div', { class: 'dc' }),
    pm = P.margin;
  probe.style.cssText = 'position:fixed;left:-20000px;top:0;width:' + P.w + 'mm';
  probe.innerHTML =
    '<style>' +
    dcss('.dc ') +
    '</style><div style="position:absolute;left:0;top:0;width:' +
    ((P.w - pm.left - pm.right) * 96) / 25.4 +
    'px"></div>';
  document.body.append(probe);
  const pc = probe.lastChild;
  secs.forEach((s, i) => {
    pc.innerHTML = s.h;
    cost[i] = Math.round((pc.scrollHeight * 25.4) / 96);
    const d = new DOMParser().parseFromString(s.h, 'text/html');
    [...d.body.childNodes].forEach((n) => {
      if (n.nodeType === 1) {
        const x = document.importNode(n, true);
        if (x.tagName === 'TABLE') fitTable(x);
        x.querySelectorAll('table').forEach(fitTable);
        softWrap(x);
        put(x);
        if (x.tagName === 'H2') heads.push([n.textContent.trim(), x]);
      } else if (n.nodeType === 3 && n.textContent.trim()) {
        const p = h('p');
        p.textContent = n.textContent;
        put(p);
      }
    });
    /* The exclusion rule: a section that has no business in this report type is named, not cut. */
    if (K.noHead.some((w) => s.t.toLowerCase().includes(w)))
      warnings.push(
        '“' +
          s.t +
          '” does not belong in a ' +
          K.label.toLowerCase() +
          '. ' +
          K.help +
          ' Nothing was removed - delete the section from the report text if it really should not be here.'
      );
  });
  probe.remove();
  /* A report type with no disclaimer page still carries the disclaimer: it flows onto the end of
     the content like any other section, so the page limit counts it too. */
  if (!K.discPage) {
    const dd = new DOMParser().parseFromString(discInner(kind), 'text/html');
    [...dd.body.childNodes].forEach((n) => {
      if (n.nodeType === 1) {
        const x = document.importNode(n, true);
        softWrap(x);
        put(x);
      }
    });
  }
  if (!flow().children.length) cur.remove();
  const annP = [];
  ann.forEach((b) => {
    const a = mk(PDF_DESIGN.header.annex);
    a.querySelector('.pg-body').innerHTML = b.h;
    if (b.t) annP.push([b.t, a]);
  });
  /* The pages are final now: number them, fill the table of contents from that same numbering,
     then measure every page against what the design says one page can hold. */
  const dv = [...el.children].filter((c) => c.tagName === 'DIV'),
    pages = [...el.querySelectorAll('.pb')],
    /* Every physical sheet counts, cover first, so "Page 5 of 9" is the fifth sheet out of the
       printer and the same number the exporter reports for the whole file. */
    at = (d) => 'Page ' + (dv.indexOf(d) + 1) + ' of ' + dv.length,
    num = (n) => dv.indexOf(n.closest ? n.closest('.pb') : n) + 1;
  pages.forEach((d) => {
    const pg = d.querySelector('.rh-pg');
    if (pg) pg.textContent = '  ·  ' + at(d);
  });
  if (tocP) {
    const ents = [...(dP ? [['Disclaimer', dP]] : []), ...heads, ...annP].map(([t, n]) => [
      t,
      num(n),
    ]);
    tocP.querySelector('.pg-body').innerHTML =
      '<h2>Table of Contents</h2><table class="nb toc" style="width:100%">' +
      ents
        .map(
          ([t, n]) =>
            `<tr><td>${esc(t)}</td><td class='n' style='text-align:right;width:60px'>${n}</td></tr>`
        )
        .join('') +
      '</table>';
  }
  /* The page limit is a design value, so it is checked here rather than in the exporter: the
     preview and the PDF then complain about exactly the same thing. */
  if (K.maxPages && dv.length > K.maxPages) {
    const worst = secs
      .map((s, i) => [s.t, cost[i]])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    warnings.push(
      'A ' +
        K.label.toLowerCase() +
        ' is limited to ' +
        K.maxPages +
        ' pages and this came out as ' +
        dv.length +
        '. The longest sections are ' +
        worst.map(([t, mm]) => '“' + t + '” (' + mm + ' mm)').join(', ') +
        '. Shorten them; nothing was cut to make it fit.'
    );
  }
  pages.forEach((d) => {
    const f = d.querySelector('.pg-body'),
      head = at(d) + ': ';
    if (!f.children.length) warnings.push(head + 'an empty page came out of the layout.');
    if (over(f)) {
      const h2 = [...f.querySelectorAll('h2')].pop();
      warnings.push(
        head +
          'the content is taller than one A4 page' +
          (h2 ? ' (“' + (h2.textContent || '').trim() + '”)' : '') +
          '. Shorten the text or choose fewer photographs; nothing was dropped to make it fit.'
      );
    }
    if (f.scrollWidth > f.clientWidth + 1)
      warnings.push(head + 'a table is wider than the printable area.');
  });
  return { el, inner: el.innerHTML, warnings, pages: dv.length };
}
