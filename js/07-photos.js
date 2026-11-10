/* Photos & annexes: IndexedDB storage, upload UI, categories
   Loaded as a classic script: everything here shares the global scope. Order of <script> tags in index.html matters. */

const PCALL = [
    ['cov', 'Cover photo (insured vehicle)'],
    ['est', 'Workshop estimate'],
    ['acc', 'Accident scene photographs'],
    ['iv', 'Insured vehicle condition'],
    ['tv', 'Third-party condition – vehicle, property or injury'],
    ['oth', 'Other documents'],
  ],
  PC = [],
  RM = ['I', 'II', 'III', 'IV', 'V'];

let PH = [],
  /* The saved-photo list on the page, so the camera block can refresh it after a burst is filed
     without rebuilding the page (and restarting the viewfinder) around it. */
  PHDRAW = null;

function syncPC() {
  PC.length = 0;
  PC.push(
    ...PCALL.filter(([c]) => (MOD.pc ? MOD.pc.includes(c) : c !== 'tv' || hasTP())).map(
      ([c, t]) => [c, (MOD.pn && MOD.pn[c]) || t]
    )
  );
}

const IDBP = new Promise((r) => {
  try {
    const q = indexedDB.open('sp-photos', 1);
    q.onupgradeneeded = () => q.result.createObjectStore('p', { keyPath: 'id' });
    q.onsuccess = () => r(q.result);
    q.onerror = () => r(null);
  } catch {
    r(null);
  }
});

const pdb = async (mode, fn) => {
  const d = await IDBP;
  if (!d) throw 0;
  return new Promise((res, rej) => {
    const t = d.transaction('p', mode),
      q = fn(t.objectStore('p'));
    t.oncomplete = () => res(q && q.result);
    t.onerror = t.onabort = () => rej(t.error);
  });
};

const put = (p) => pdb('readwrite', (s) => s.put(p)),
  del = (id) => pdb('readwrite', (s) => s.delete(id));

async function loadPH() {
  try {
    PH = ((await pdb('readonly', (s) => s.getAll())) || [])
      .filter((p) => p.cid === cur)
      .sort((a, b) => a.t - b.t);
  } catch {
    PH = [];
  }
}

/* ---------- cover photograph ----------

   One photo per case is designated as its cover and the designation is stored on the case record
   (c.cover) — the same store the rest of the case lives in, so a cover travels with the case
   export and needs no second copy of the image. Lists and reports read it through
   coverPhotoFor()/coverIn() so the same photo is always the cover everywhere. */
let PHIDX = null,
  PHLOAD = null,
  PHGEN = 0;

function invalidatePhotoIndex() {
  PHIDX = null;
  PHLOAD = null;
  PHGEN++;
}

async function buildPhotoIndex() {
  let all = [];
  try {
    all = (await pdb('readonly', (s) => s.getAll())) || [];
  } catch {
    all = [];
  }
  const ix = {};
  for (const p of all) (ix[p.cid] = ix[p.cid] || []).push(p);
  Object.values(ix).forEach((L) => L.sort((a, b) => a.t - b.t));
  return ix;
}

/* One pass over IndexedDB, shared by every case row on screen. The pending read is cached as well
   as its result, so a page full of covers asks the store once instead of once per row, and a photo
   saved while a read was in flight makes the waiting callers re-read rather than paint from an
   index that never contained it. */
function photoIndex() {
  if (PHIDX) return Promise.resolve(PHIDX);
  if (!PHLOAD) {
    const gen = PHGEN;
    PHLOAD = buildPhotoIndex().then((ix) => {
      if (gen !== PHGEN) return photoIndex();
      PHIDX = ix;
      PHLOAD = null;
      return ix;
    });
  }
  return PHLOAD;
}

/* The designated photo, or the oldest one filed under the cover category so cases photographed
   before designation existed still show a cover. Never an arbitrary photo. */
function coverIn(cid, list) {
  const L = list || (PHIDX && PHIDX[cid]) || [];
  const c = DB[cid];
  const designated = c && c.cover ? L.find((p) => p.id === c.cover) : null;
  return designated || L.find((p) => p.cat === 'cov') || null;
}

/* Same lookup for callers outside the photo screen, which have no list of their own and may be
   the first thing on the page to need photographs at all. */
async function coverPhotoFor(cid) {
  if (!PHIDX) await photoIndex();
  return coverIn(cid);
}

/* Only the surveyor who owns a case — or a role that sees every case — may change its cover. */
async function setCaseCover(cid, photoId) {
  const c = DB[cid];
  if (!c) return false;
  if (cfg.role === 'Staff' && !isMine(c)) {
    toast('Only the surveyor assigned to this case can change its cover photo.');
    return false;
  }
  c.cover = photoId || '';
  c.u = Date.now();
  sv(1);
  invalidatePhotoIndex();
  return true;
}

/* ---------- cover thumbnail and preview, shared by every screen that lists cases ---------- */

let PV_EL = null,
  PV_KEY = null;

function closePhotoPreview() {
  if (!PV_EL) return;
  PV_EL.remove();
  PV_EL = null;
  removeEventListener('keydown', PV_KEY);
  PV_KEY = null;
}

/* A dialog, not a link: opening the cover must never navigate away from the list. */
async function openPhotoPreview(cid, label) {
  const p = await coverPhotoFor(cid);
  if (!p) {
    toast('No cover photograph is designated for this case yet.');
    return;
  }
  closePhotoPreview();
  const close = h(
    'button',
    { class: 'b', type: 'button', onclick: closePhotoPreview, 'aria-label': 'Close preview' },
    'Close'
  );
  const card = h(
    'div',
    { class: 'pv-card', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Cover photograph' },
    h('div', { class: 'pv-bar' }, h('b', {}, String(label || 'Cover photograph')), close),
    h('img', { src: p.img, alt: 'Cover photograph' }),
    p.cap ? h('p', { class: 'pv-cap' }, p.cap) : null
  );
  PV_EL = h(
    'div',
    {
      class: 'pv',
      onclick: (e) => {
        if (e.target === PV_EL) closePhotoPreview();
      },
    },
    card
  );
  PV_KEY = (e) => {
    if (e.key === 'Escape') closePhotoPreview();
  };
  addEventListener('keydown', PV_KEY);
  document.body.append(PV_EL);
  close.focus();
}

/* SVG needs its own namespace, which h() does not set. */
function covSvg(tag, attrs) {
  const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.keys(attrs).forEach((k) => e.setAttribute(k, attrs[k]));
  return e;
}

/* The camera glyph, sized by the caller: it stands for "photograph" both in an empty cover slot on a
   case card and on the closed viewfinder's open button. */
function covCamIcon(size) {
  const s = covSvg('svg', {
    viewBox: '0 0 24 24',
    width: String(size || 30),
    height: String(size || 30),
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.7',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  });
  s.append(
    covSvg('path', {
      d: 'M3 9.4A2.2 2.2 0 0 1 5.2 7.2h1.9l1.3-2.2h7.2l1.3 2.2h1.9A2.2 2.2 0 0 1 21 9.4v8A2.2 2.2 0 0 1 18.8 19.6H5.2A2.2 2.2 0 0 1 3 17.4z',
    }),
    covSvg('circle', { cx: '12', cy: '13.4', r: '3.4' })
  );
  return s;
}

/* The cell paints itself once the photo store answers, so a long list never blocks on IndexedDB,
   and a case with no cover keeps a fixed-size placeholder instead of collapsing the row. */
function coverThumb(cid, label, cls) {
  const covCls = 'cov' + (cls ? ' ' + cls : ''),
    empty = () =>
      covCls.includes('cov-lg')
        ? h('span', { class: 'cov-ph cov-ph-lg' }, covCamIcon(), 'No cover photo')
        : h('span', { class: 'cov-ph' }, '—');
  const cell = h(
    'button',
    {
      type: 'button',
      class: covCls,
      title: 'View cover photograph',
      'aria-label': 'View cover photograph for ' + (label || 'this case'),
      onclick: (e) => {
        e.stopPropagation();
        openPhotoPreview(cid, label);
      },
    },
    empty()
  );
  (async () => {
    const p = await coverPhotoFor(cid);
    cell.replaceChildren(p ? h('img', { src: p.img, alt: '' }) : empty());
    cell.classList.toggle('is-set', Boolean(p));
  })();
  return cell;
}

const shrink = (f, mx) =>
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
        res(c.toDataURL('image/jpeg', 0.78));
      };
      im.onerror = rej;
      im.src = fr.result;
    };
    fr.onerror = rej;
    fr.readAsDataURL(f);
  });

/* Shared by the Photos screen and the camera block: review captions and categories for a batch,
   then commit to IndexedDB. onDone receives the saved count.

   The rows array is the single state the dialog reads and writes: discarding a photo splices it
   out of the live rows, of the caller's batch, and (for the camera burst) of CAP.shots, then
   redraws - so the count, the thumbnails and the Save button always describe the same set of
   photos that will actually be stored. */
const reviewBatch = async (items, onDone) => {
  const batch = items || [];
  let rows = batch
    .filter((it) => it && it.img)
    .map((it) => ({ it, cap: it.caption || '', cat: it.category }));
  const total = rows.length;
  if (!total) return;

  const drop = (r) => {
    rows = rows.filter((x) => x !== r);
    const i = batch.indexOf(r.it);
    if (i >= 0) batch.splice(i, 1);
    /* The burst strip under the camera shows the same objects, so it has to drop the shot too. */
    if (batch === CAP.shots && CAP.sync) CAP.sync();
    draw();
  };

  const dlg = h('dialog'),
    wrap = h('div', { style: 'min-width:min(720px, 88vw);max-width:88vw' }),
    count = h('span', { class: 'mu' }),
    body = h('div', { style: 'display:grid;gap:10px;max-height:70vh;overflow:auto;' }),
    saveBtn = h('button', { class: 'b p', type: 'button', onclick: save }, 'Save photos');

  dlg.appendChild(wrap);

  const rowEl = (r, i) => {
    const capIn = h('input', { placeholder: 'Optional caption', maxlength: '120', value: r.cap }),
      catIn = h('select', {}, ...PC.map(([k, n]) => h('option', { value: k }, n))),
      chk = h(
        'label',
        { class: 'mu', style: 'display:flex;align-items:center;gap:6px;' },
        h('input', { type: 'checkbox', checked: !!r.cap }),
        'Keep this caption'
      );
    catIn.value = r.cat;
    capIn.oninput = () => {
      r.cap = capIn.value;
      chk.querySelector('input').checked = !!r.cap.trim();
    };
    catIn.onchange = () => {
      r.cat = catIn.value;
    };
    const row = h('div', {
      style:
        'display:grid;grid-template-columns:110px 1fr;gap:10px;padding:10px;border:1px solid var(--bd);border-radius:10px;background:var(--bg);',
    });
    row.append(
      h('img', {
        src: r.it.img,
        alt: '',
        style:
          'width:100%;height:110px;object-fit:cover;border-radius:8px;border:1px solid var(--bd);',
      }),
      h(
        'div',
        { style: 'display:grid;gap:8px;' },
        h(
          'div',
          { class: 'bar', style: 'margin:0;justify-content:space-between' },
          h('span', { class: 'mu' }, `${i + 1}. ${r.it.name || 'Photo'}`),
          h('button', { class: 'b x', type: 'button', onclick: () => drop(r) }, 'Discard')
        ),
        capIn,
        h('div', { class: 'fld' }, h('label', {}, 'Category'), catIn),
        chk
      )
    );
    return row;
  };

  function draw() {
    body.replaceChildren(...rows.map(rowEl));
    count.textContent =
      rows.length === total
        ? `${total} photo${total === 1 ? '' : 's'}`
        : `${rows.length} of ${total} kept`;
    saveBtn.textContent = `Save ${rows.length} photo${rows.length === 1 ? '' : 's'}`;
    saveBtn.disabled = !rows.length;
  }

  async function save() {
    let saved = 0;
    for (const r of rows) {
      const p = {
        id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + saved,
        /* Every photo carries the case it belongs to; nothing is filed under the case that
           happens to be open when the write lands. */
        cid: r.it.cid || cur,
        cat: r.cat,
        cap: r.cap.trim(),
        img: r.it.img,
        t: Date.now() + saved / 1000,
      };
      await put(p);
      PH.push(p);
      saved++;
    }
    if (saved) invalidatePhotoIndex();
    dlg.close();
    if (onDone) onDone(saved);
  }

  wrap.append(
    h(
      'div',
      { class: 'bar', style: 'margin-top:0' },
      h('h3', { style: 'margin:0' }, 'Review photos before saving'),
      count,
      h('button', { class: 'b', type: 'button', onclick: () => dlg.close() }, 'Close')
    ),
    body,
    h(
      'div',
      { class: 'bar', style: 'margin-bottom:0;justify-content:flex-end' },
      h('button', { class: 'b', type: 'button', onclick: () => dlg.close() }, 'Cancel'),
      saveBtn
    )
  );
  draw();
  document.body.append(dlg);
  dlg.showModal();
};

function photosUI(m) {
  Dd.lay = Dd.lay || {};
  const msg = h('p', { class: 'mu' }),
    cat = h('select', {}, ...PC.map(([c, t]) => h('option', { value: c }, t))),
    cap = h('input', {
      placeholder: 'Optional caption for every photo in this batch',
      maxlength: '120',
    }),
    nmx = h('input', { type: 'checkbox', id: 'nmx' }),
    fi = h('input', { type: 'file', accept: 'image/*', multiple: 'multiple' }),
    fiOne = h('input', { type: 'file', accept: 'image/*', capture: 'environment' }),
    dz = h(
      'div',
      { class: 'dz' },
      'Drag & drop photos here, or click to choose (bulk upload supported)'
    ),
    list = h('div'),
    quick = h(
      'div',
      { class: 'bar', style: 'margin-top:8px;margin-bottom:0;flex-wrap:wrap' },
      h('button', { class: 'b', type: 'button', onclick: () => fiOne.click() }, 'Add one photo'),
      h('button', { class: 'b', type: 'button', onclick: () => fi.click() }, 'Bulk upload')
    );
  const save = async (p) => {
    try {
      await put(p);
      invalidatePhotoIndex();
    } catch {
      msg.textContent = 'Could not save (browser storage unavailable or full)';
    }
  };
  const draw = () => {
    /* The photo screen already holds this case's photos, so it resolves the cover from them rather
       than waiting on the directory-wide index. */
    const coverId = (coverIn(cur, PH) || {}).id || '';
    list.replaceChildren(
      ...PC.map(([c, t]) => {
        const L = PH.filter((p) => p.cat === c);
        if (!L.length) return '';
        const lc = h(
          'select',
          { title: 'Photos per row in the report' },
          ...[1, 2, 3].map((n) => h('option', { value: n }, n + ' per row'))
        );
        lc.value = Dd.lay[c] || (c === 'est' ? 1 : 2);
        lc.onchange = () => {
          Dd.lay[c] = +lc.value;
          sv(1);
        };
        return h(
          'section',
          { class: 'card' },
          h('div', { class: 'bar' }, h('h3', { style: 'margin:0' }, `${t} (${L.length})`), lc),
          h(
            'div',
            { class: 'th' },
            ...L.map((p, i) => {
              const ci = h('input', { placeholder: 'Caption (optional)', maxlength: '120' }),
                ms = h('select', {}, ...PC.map(([k, n]) => h('option', { value: k }, n)));
              ci.value = p.cap || '';
              ms.value = p.cat;
              ci.onblur = () => {
                p.cap = ci.value.trim();
                save(p);
              };
              ms.onchange = () => {
                p.cat = ms.value;
                save(p);
                draw();
                paint();
              };
              const sw = async (j) => {
                const q = L[j];
                if (!q) return;
                [p.t, q.t] = [q.t, p.t];
                await save(p);
                await save(q);
                PH.sort((a, b) => a.t - b.t);
                draw();
              };
              return h(
                'div',
                { class: p.id === coverId ? 'is-cover' : '' },
                h(
                  'b',
                  {},
                  (c === 'est' ? 'Page ' : 'Photo ') + (i + 1),
                  p.id === coverId ? h('span', { class: 'cov-flag' }, 'Cover') : null
                ),
                h('img', { src: p.img, alt: '' }),
                ci,
                ms,
                h(
                  'div',
                  { class: 'bar' },
                  h(
                    'button',
                    { class: 'b', type: 'button', title: 'Move earlier', onclick: () => sw(i - 1) },
                    '▲'
                  ),
                  h(
                    'button',
                    { class: 'b', type: 'button', title: 'Move later', onclick: () => sw(i + 1) },
                    '▼'
                  ),
                  h(
                    'button',
                    {
                      class: 'b',
                      type: 'button',
                      title: 'Use this photograph as the case cover',
                      onclick: async () => {
                        if (await setCaseCover(cur, p.id)) {
                          draw();
                          paint();
                        }
                      },
                    },
                    p.id === coverId ? 'Cover photo' : 'Set as cover'
                  ),
                  h(
                    'button',
                    {
                      class: 'b',
                      type: 'button',
                      onclick: async () => {
                        try {
                          await del(p.id);
                        } catch {}
                        invalidatePhotoIndex();
                        PH = PH.filter((x) => x.id !== p.id);
                        draw();
                        paint();
                      },
                    },
                    'Remove'
                  )
                )
              );
            })
          )
        );
      })
    );
  };

  const up = async (files) => {
    files = [...files];
    let ok = 0,
      bad = 0,
      batch = [];
    for (const f of files) {
      msg.textContent = `Checking ${ok + bad + 1} of ${files.length}…`;
      if (!f.type.startsWith('image/') || f.size > 20e6) {
        bad++;
        continue;
      }
      try {
        const img = await shrink(f, cat.value === 'est' ? 2000 : 1400),
          nmv = f.name.split('.').slice(0, -1).join('.') || f.name;
        batch.push({
          img,
          name: nmv,
          cid: cur,
          category: cat.value,
          caption: nmx.checked ? nmv.slice(0, 120) : cap.value.trim(),
        });
        ok++;
      } catch {
        bad++;
      }
    }

    if (batch.length) {
      msg.textContent = `Review ${batch.length} photo${batch.length === 1 ? '' : 's'} before saving.`;
      await reviewBatch(batch, (saved) => {
        msg.textContent = `${saved} photo${saved === 1 ? '' : 's'} ready for the report.`;
        draw();
        paint();
      });
      return;
    }

    msg.textContent = bad
      ? `${bad} skipped (not a supported image, over 20 MB, or browser storage unavailable)`
      : 'No photos were added.';
  };
  fi.onchange = () =>
    up(fi.files).then(() => {
      fi.value = '';
    });
  fiOne.onchange = () =>
    up(fiOne.files).then(() => {
      fiOne.value = '';
    });
  const dragStop = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  dz.onclick = () => fi.click();
  dz.ondragenter = dragStop;
  dz.ondragover = (e) => {
    dragStop(e);
    dz.classList.add('on');
  };
  dz.ondragleave = () => dz.classList.remove('on');
  dz.ondrop = (e) => {
    dragStop(e);
    dz.classList.remove('on');
    up(e.dataTransfer.files);
  };
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const help = h(
    'p',
    { class: 'mu' },
    'Choose a category and add one or many images (JPG, PNG, WebP). Captions are optional: set one for the whole batch, use file names, or edit each photo afterwards before it is used in the report. Each category becomes a numbered annex in the report. Workshop estimates must be uploaded as images (PDFs cannot be embedded). Photos stay in this browser and are not part of the JSON export.'
  );
  dz.textContent = coarse
    ? 'Tap to choose photos (bulk upload supported)'
    : 'Drag & drop photos here, or click to choose (bulk upload supported)';
  const helpBox = h('details', { class: 'help' }, h('summary', {}, 'What to photograph'), help);
  if (!coarse) helpBox.open = true;
  m.append(
    /* The field camera is part of this page, not a screen of its own: shoot, upload and check the
       saved annexes without leaving it. See camUI() / capSwitchUI() in js/20-quick-capture.js. */
    camUI(),
    h(
      'section',
      { class: 'card' },
      h('h3', {}, 'Add photos / estimate pages'),
      helpBox,
      h(
        'div',
        { class: 'grid' },
        h('div', { class: 'fld' }, h('label', {}, 'Category'), cat),
        h(
          'div',
          { class: 'fld' },
          h('label', {}, 'Caption (optional)'),
          cap,
          h('label', { for: 'nmx' }, nmx, ' Use file name as caption')
        )
      ),
      dz,
      quick,
      h('div', { class: 'vhide' }, fi, fiOne),
      msg
    ),
    list,
    capSwitchUI()
  );
  PHDRAW = draw;
  draw();
}

function annexHTML() {
  if (window.NOANX) return '';
  let o = '',
    k = 0;
  const ref = claimRef();
  PC.forEach(([c, t]) => {
    const L = PH.filter((p) => p.cat === c);
    if (!L.length || c === 'cov') return;
    const n = (Dd.lay && Dd.lay[c]) || (c === 'est' ? 1 : 2),
      w = c === 'est' ? 'Page' : 'Photo';
    o +=
      `<div class=annex><h2>Annex ${RM[k++]} – ${esc(t)}</h2><p class=ai>${esc(ref)} · ${L.length} ${w.toLowerCase()}(s)</p><div class='pg n${n}' style='grid-template-columns:repeat(${n},1fr)'>` +
      L.map(
        (p, i) =>
          `<figure><img src='${p.img}' alt=''><figcaption><b>${w} ${i + 1}</b>${p.cap ? ' – ' + esc(p.cap) : ''}</figcaption></figure>`
      ).join('') +
      '</div></div>';
  });
  return o;
}
