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

async function docBuild(kind, body, anx, nums) {
  await ensureFont();
  const sig = await getA('sig'),
    stp = await getA('stp'),
    secs = secBody(body),
    ann = anx ? await annexBlocks() : [],
    PHT = 1010;
  const el = h('div', { class: 'dc' });
  el.style.cssText = 'position:fixed;left:-10000px;top:0;width:165mm';
  el.innerHTML = '<style>' + dcss('.dc ') + '</style>';
  document.body.append(el);
  const wr = document.createElement('div');
  wr.innerHTML = await coverHTML(kind, sig, stp);
  el.append(wr.firstElementChild);
  const footerHtml = () => {
    const sg = sig ? `<img src='${sig}' alt='' style='max-width:150px;max-height:60px;object-fit:contain;'>` : '';
    const st = stp ? `<img src='${stp}' alt='' style='max-width:90px;max-height:90px;object-fit:contain;'>` : '';
    return `<div class='report-footer'><div class='rf-left'>${sg}${st}</div><div class='rf-right'><div>${esc(g('case_surveyor') || 'Licensed Surveyor')}</div><div>${esc(g('case_lic') ? 'Licence no. ' + g('case_lic') : 'Surveyor')}</div></div></div>`;
  };
  const mk = () => {
    const d = h('div', { class: 'pb pgx' });
    d.style.cssText = 'height:' + PHT + 'px;overflow:hidden;position:relative;padding-bottom:72px;';
    d.insertAdjacentHTML('beforeend', footerHtml());
    el.append(d);
    return d;
  };
  const tocP = mk(),
    dP = mk();
  dP.innerHTML = discInner(kind);
  let cur = mk();
  const full = () => cur.scrollHeight > cur.clientHeight + 1,
    KD = ['TABLE', 'UL', 'OL'],
    fresh = () => {
      cur = mk();
    };
  const split = (bl) => {
    const tb = bl.tagName === 'TABLE',
      rows = [...(tb ? bl.querySelectorAll('tr') : bl.children)],
      mkc = () => {
        const c = bl.cloneNode(false);
        if (tb) c.append(h('tbody'));
        return c;
      };
    let c = mkc(),
      hd = tb ? c.firstChild : c;
    bl.replaceWith(c);
    rows.forEach((r) => {
      hd.append(r);
      if (full() && hd.children.length > 1) {
        hd.removeChild(r);
        fresh();
        c = mkc();
        hd = tb ? c.firstChild : c;
        cur.append(c);
        hd.append(r);
      }
    });
  };
  const put = (bl) => {
    cur.append(bl);
    if (!full()) return;
    if (cur.children.length > 1) {
      cur.removeChild(bl);
      const pv = cur.lastElementChild;
      let mv = [bl];
      if (pv && /^H[2-4]$/.test(pv.tagName) && cur.children.length > 1) {
        cur.removeChild(pv);
        mv = [pv, bl];
      }
      fresh();
      mv.forEach((x) => cur.append(x));
      if (full() && KD.includes(bl.tagName)) split(bl);
    } else if (KD.includes(bl.tagName)) split(bl);
  };
  const heads = [];
  secs.forEach((s) => {
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
  });
  if (!cur.children.length) cur.remove();
  const annP = [];
  ann.forEach((b) => {
    const a = mk();
    a.style.height = 'auto';
    a.style.overflow = 'visible';
    a.dataset.fit = '1';
    a.innerHTML = b.h;
    if (b.t) annP.push([b.t, a]);
  });
  const dv = [...el.children].filter((c) => c.tagName === 'DIV'),
    num = (n) => dv.indexOf(n.closest ? n.closest('.pb') : n),
    ents = [['Disclaimer', dP], ...heads, ...annP].map(([t, n]) => [t, num(n)]);
  tocP.innerHTML =
    '<h2>Table of Contents</h2><table class="nb toc" style="width:100%">' +
    ents
      .map(
        ([t, n]) =>
          `<tr><td>${esc(t)}</td><td class='n' style='text-align:right;width:60px'>${n}</td></tr>`
      )
      .join('') +
    '</table>';
  return { el, inner: el.innerHTML };
}
