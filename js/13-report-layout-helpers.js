/* Disclaimer, report stylesheet (dcss), signature/stamp, cover, annex blocks, preview
   Loaded as a classic script: everything here shares the global scope. Order of <script> tags in index.html matters. */

const t12 = (v) => {
  if (!v || !String(v).includes(':')) return v || '';
  const a = String(v).split(':').map(Number);
  return `${a[0] % 12 || 12}:${p2(a[1] || 0)} ${a[0] >= 12 ? 'PM' : 'AM'}`;
};

const DISC = `This report has been prepared by the undersigned licensed surveyor at the request of the insurer, on the basis of the information, documents, statements and inspection findings available at the time of survey. The surveyor has relied on the accuracy and completeness of the information supplied by the insured, the insurer and other parties and has not independently verified it except where stated.\n\nThe observations, assessments and estimates in this {type} report are given without prejudice and do not constitute an admission of liability or a decision on the claim. The liability of the insurer remains subject to the terms, conditions, limits, exclusions and endorsements of the policy and to the insurer’s own decision.\n\nThe surveyor reserves the right to amend or supplement this report if further information, documents or evidence become available. This report is confidential, is prepared solely for the insurer, and may not be relied upon by any other party without the surveyor’s written consent.`;

const RL = [
    [
      'h1',
      'font-size:26pt;text-align:center;letter-spacing:.04em;margin:30px 0 18px;line-height:1.25',
    ],
    ['h2', 'font-size:14pt;border-bottom:2px solid #000;padding-bottom:3px;margin:0 0 10px'],
    ['h3,h4', 'font-size:11.5pt;margin:12px 0 4px'],
    ['table', 'border-collapse:collapse;width:100%;margin:6px 0'],
    ['th,td', 'border:1px solid #888;padding:3px 6px;text-align:left;vertical-align:top'],
    ['th', 'background:#eee'],
    ['table.nb td,table.nb th', 'border:0;background:#fff'],
    ['table.toc td', 'border:0;border-bottom:1px dotted #999;padding:5px 4px'],
    ['.cap', 'font-size:9pt;text-align:center;margin:2px 0 6px'],
    ['.ai', 'font-size:9pt;color:#444;margin:0 0 8px'],
    ['.pb', 'page-break-before:always'],
    [
      '.report-footer',
      'position:absolute;left:0;right:0;bottom:0;border-top:1px solid #000;padding:8px 12px 4px;display:flex;align-items:flex-end;justify-content:space-between;gap:12px;font-size:8pt;color:#444;background:linear-gradient(to top, rgba(255,255,255,0.94), rgba(255,255,255,0.7));',
    ],
    ['.report-footer .rf-left', 'display:flex;align-items:flex-end;gap:10px;'],
    ['.report-footer .rf-right', 'text-align:right;line-height:1.3;'],
    ['img', 'max-width:100%'],
    ['p', 'margin:0 0 7px;text-align:justify'],
    ['ul,ol', 'margin:0 0 8px;padding-left:22px'],
    ['li', 'margin:0 0 3px'],
    ['table.sm td,table.sm th', 'font-size:8pt;padding:2px 3px'],
    ['table', 'max-width:100%;table-layout:fixed'],
  ],
  dcss = (p) =>
    (p
      ? p.trim() +
        '{font:11pt/1.5 "LM Roman 10","Latin Modern Roman",Georgia,serif;color:#000;background:#fff}'
      : 'body{font:11pt/1.5 "LM Roman 10","Latin Modern Roman",Georgia,serif;color:#000}') +
    RL.map(
      ([s, r]) =>
        s
          .split(',')
          .map((x) => p + x)
          .join(',') +
        '{' +
        r +
        '}'
    ).join('');

const shrinkPng = (f, mx) =>
  new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => {
      const im = new Image();
      im.onload = () => {
        const r = Math.min(1, mx / Math.max(im.width, im.height)),
          c = document.createElement('canvas');
        c.width = Math.round(im.width * r);
        c.height = Math.round(im.height * r);
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
        res(c.toDataURL('image/png'));
      };
      im.onerror = rej;
      im.src = fr.result;
    };
    fr.onerror = rej;
    fr.readAsDataURL(f);
  });

const getA = (k) =>
    pdb('readonly', (s) => s.get('asset_' + k))
      .then((r) => (r && r.img) || '')
      .catch(() => ''),
  setA = (k, img) => put({ id: 'asset_' + k, cid: '_g', img, t: 0 });

function signUI() {
  const mk = (k, l) => {
      const i = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp' }),
        m = h('div', { class: 'upst' }),
        pv = h('img', { class: 'upv', alt: '' }),
        bx = h('div', { class: 'upb' }, pv),
        rm = h('button', { class: 'b', type: 'button' }, 'Remove');
      const say = (t, c) => {
          m.textContent = t;
          m.className = 'upst ' + (c || '');
        },
        show = (v) => {
          pv.src = v || '';
          bx.style.display = v ? 'flex' : 'none';
          rm.style.display = v ? '' : 'none';
        };
      show('');
      say('Checking…');
      getA(k).then((v) => {
        show(v);
        say(v ? '✓ Saved – used on every report cover' : 'Not uploaded yet', v ? 'ok' : '');
      });
      i.onchange = async () => {
        const f = i.files[0];
        if (!f) return;
        if (!f.type.startsWith('image/')) {
          say('✖ Not an image – choose a PNG file', 'er');
          i.value = '';
          return;
        }
        if (f.size > 10e6) {
          say('✖ File is larger than 10 MB', 'er');
          i.value = '';
          return;
        }
        say('Uploading…');
        try {
          const d = await shrinkPng(f, 600);
          await setA(k, d);
          const back = await getA(k);
          if (back !== d) throw 0;
          show(back);
          say('✓ Uploaded and saved (' + f.name + ')', 'ok');
        } catch {
          say('✖ Upload failed – the image could not be read or saved. Try another PNG.', 'er');
        }
        i.value = '';
      };
      rm.onclick = async () => {
        try {
          await setA(k, '');
          show('');
          say('Removed', '');
        } catch {
          say('✖ Could not remove the image', 'er');
        }
      };
      return h('div', { class: 'fld' }, h('label', {}, l), i, bx, m, rm);
    },
    dsT = h('textarea', { rows: 7 });
  dsT.value = cfg.disc || DISC;
  dsT.onblur = () => {
    cfg.disc = dsT.value.trim() === DISC.trim() ? '' : dsT.value.trim();
    saveCfg();
  };
  return [
    mk('sig', 'Surveyor digital signature (PNG, transparent background works best)'),
    mk('stp', 'Surveyor stamp (PNG)'),
    h(
      'div',
      { class: 'fld wide' },
      h(
        'label',
        {},
        'Disclaimer text – page 3 of every report ({type} becomes preliminary / final)'
      ),
      dsT
    ),
  ];
}

const dimOf = (src) =>
  new Promise((r) => {
    const i = new Image();
    i.onload = () => r([i.naturalWidth || 4, i.naturalHeight || 3]);
    i.onerror = () => r([4, 3]);
    i.src = src;
  });

async function imgT(src, mw, mh) {
  const d = await dimOf(src),
    s = Math.min(mw / d[0], mh / d[1], 1);
  return `<img src='${src}' width='${Math.round(d[0] * s)}' height='${Math.round(d[1] * s)}' alt=''>`;
}

async function coverHTML(kind, sig, stp) {
  const P = kind === 'prelim',
    cv = PH.find((p) => p.cat === 'cov') || PH.find((p) => p.cat === 'iv'),
    e = (k) => esc(g(k) || '—'),
    ph = cv
      ? await imgT(cv.img, 520, 400)
      : `<div style='height:260px;line-height:260px;color:#999;border:1px dashed #bbb'>Add a cover photo under Photos &amp; annexes</div>`,
    sg = sig ? await imgT(sig, 230, 90) : '',
    st = stp ? await imgT(stp, 115, 115) : '';
  return `<div class='cover' style='position:relative;height:1000px'><h1>${MOD === MODS.property ? 'PROPERTY' : 'MOTOR VEHICLE'}<br>${P ? 'PRELIMINARY' : 'FINAL'} SURVEY</h1><div style='text-align:center;margin:10px 0 28px'>${ph}</div><table class='nb' style='width:80%;margin:0 auto 18px'><tr><td style='text-align:right;width:50%'>Insurance Claim No.</td><td>${e('case_claimNo')}</td></tr><tr><td style='text-align:right'>Policy Number</td><td>${e('case_policyNo')}</td></tr></table><table class='nb' style='width:80%;margin:0 auto'><tr><td style='text-align:center'>Submitted By</td><td style='text-align:center'>Submitted To</td></tr><tr><td style='text-align:center'>${e('case_surveyor')}</td><td style='text-align:center'>${e('case_company')}</td></tr></table><p style='text-align:center;font-size:9pt;margin-top:26px'>${esc(today())} · BS ${esc(bsStr(today()).split(' ')[0])}</p><table class='nb' style='position:absolute;left:0;bottom:0;width:auto'><tr><td>${sg}</td><td>${st}</td></tr></table></div>`;
}

function discInner(kind) {
  const t = (cfg.disc || DISC).split('{type}').join(kind === 'prelim' ? 'preliminary' : 'final');
  return `<h2>Disclaimer</h2>${t
    .split('\n\n')
    .map((x) => `<p style='text-align:justify'>${esc(x)}</p>`)
    .join(
      ''
    )}<p style='margin-top:30px'><b>${esc(g('case_surveyor') || '')}</b><br>Licensed Surveyor${g('case_lic') ? ' · Licence no. ' + esc(g('case_lic')) : ''}</p>`;
}

function secBlocks(body) {
  const d = new DOMParser().parseFromString(body, 'text/html'),
    out = [],
    intro = [];
  let cur = null;
  [...d.body.childNodes].forEach((n) => {
    if (n.nodeName === 'H1') return;
    if (n.nodeName === 'H2') {
      cur = { t: n.textContent.trim(), a: [n.outerHTML] };
      out.push(cur);
    } else {
      const x = n.outerHTML || esc(n.textContent || '');
      if (cur) cur.a.push(x);
      else if ((n.textContent || '').trim() || n.nodeName === 'TABLE') intro.push(x);
    }
  });
  if (intro.length)
    out.unshift({ t: 'Report reference', a: ['<h2>Report reference</h2>', ...intro] });
  return out.map((s) => ({ t: s.t, h: s.a.join('') }));
}

async function annexBlocks() {
  const RN = ['I', 'II', 'III', 'IV', 'V', 'VI'],
    out = [],
    ref = `Claim no. ${g('case_claimNo') || '—'} · ${g('fp_reg') || g('case_insReg') || g('case_loc') || '—'}`;
  let k = 0;
  for (const [c, t] of PC) {
    if (c === 'cov') continue;
    const L = PH.filter((p) => p.cat === c);
    if (!L.length) continue;
    const n = (Dd.lay && Dd.lay[c]) || (c === 'est' ? 1 : 2),
      rows = n === 1 ? 1 : n === 2 ? 3 : 4,
      per = n * rows,
      [mw, mh] = n === 1 ? [600, 800] : n === 2 ? [295, 255] : [190, 165],
      w = c === 'est' ? 'Page' : 'Photo',
      title = `Annex ${RN[k++]} – ${t}`;
    for (let s = 0; s < L.length; s += per) {
      const grp = L.slice(s, s + per);
      let trs = '';
      for (let r = 0; r < grp.length; r += n) {
        const cells = await Promise.all(
          grp
            .slice(r, r + n)
            .map(
              async (p, j) =>
                `<td style='width:${Math.floor(100 / n)}%;text-align:center;vertical-align:top;padding:4px'>${await imgT(p.img, mw, mh)}<div class='cap'><b>${w} ${s + r + j + 1}</b>${p.cap ? ' – ' + esc(p.cap) : ''}</div></td>`
            )
        );
        while (cells.length < n) cells.push(`<td style='width:${Math.floor(100 / n)}%'></td>`);
        trs += `<tr>${cells.join('')}</tr>`;
      }
      out.push({
        t: s === 0 ? title : '',
        h:
          (s === 0
            ? `<h2>${esc(title)}</h2><p class='ai'>${esc(ref)} · ${L.length} ${w.toLowerCase()}(s)</p>`
            : `<p class='ai'>${esc(title)} (continued)</p>`) +
          `<table class='nb' style='width:100%'>${trs}</table>`,
      });
    }
  }
  return out;
}

async function previewDoc(kind, ed, anx, msg) {
  msg.textContent = 'Building preview…';
  try {
    const { el } = await docBuild(kind, clean(ed.innerHTML), anx, true),
      w = h('div', { class: 'dc' });
    w.innerHTML = el.innerHTML;
    el.remove();
    $('#pvb').replaceChildren(w);
    $('#pv').showModal();
    msg.textContent = '';
  } catch (e) {
    msg.textContent = 'Preview failed: ' + ((e && e.message) || e);
  }
}

$('#pvx').onclick = () => $('#pv').close();
