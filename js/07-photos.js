/* Photos & annexes: IndexedDB storage, upload UI, categories
   Loaded as a classic script: everything here shares the global scope. Order of <script> tags in index.html matters. */

const PCALL = [
    ['cov', 'Cover photo (insured vehicle)'],
    ['est', 'Workshop estimate'],
    ['acc', 'Accident scene photographs'],
    ['iv', 'Insured vehicle condition'],
    ['tv', 'Third-party vehicle condition'],
    ['oth', 'Other documents'],
  ],
  PC = [],
  RM = ['I', 'II', 'III', 'IV', 'V'];

let PH = [];

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
    } catch {
      msg.textContent = 'Could not save (browser storage unavailable or full)';
    }
  };
  const draw = () => {
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
                {},
                h('b', {}, (c === 'est' ? 'Page ' : 'Photo ') + (i + 1)),
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
                      onclick: async () => {
                        try {
                          await del(p.id);
                        } catch {}
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
  const reviewBatch = async (items) => {
    const validItems = (items || []).filter((it) => it && it.img);
    if (!validItems.length) return;

    const dlg = h('dialog', { open: 'open' });
    const wrap = h('div', { style: 'min-width:min(720px, 88vw);max-width:88vw' });
    const hdr = h(
      'div',
      { class: 'bar', style: 'margin-top:0' },
      h('h3', { style: 'margin:0' }, 'Review photos before saving'),
      h('button', { class: 'b', type: 'button', onclick: () => dlg.close() }, 'Close')
    );
    const body = h('div', { style: 'display:grid;gap:10px;max-height:70vh;overflow:auto;' });
    const rowEls = [];

    validItems.forEach((it, idx) => {
      const row = h('div', {
        style:
          'display:grid;grid-template-columns:110px 1fr;gap:10px;padding:10px;border:1px solid var(--bd);border-radius:10px;background:var(--bg);',
      });
      const preview = h('img', {
        src: it.img,
        alt: '',
        style:
          'width:100%;height:110px;object-fit:cover;border-radius:8px;border:1px solid var(--bd);',
      });
      const form = h('div', { style: 'display:grid;gap:8px;' });
      const title = h('div', { class: 'mu' }, `${idx + 1}. ${it.name || 'Photo'}`);
      const capIn = h('input', {
        placeholder: 'Optional caption',
        maxlength: '120',
        value: it.caption || '',
      });
      const catIn = h('select', {}, ...PC.map(([k, n]) => h('option', { value: k }, n)));
      catIn.value = it.category;

      const chk = h(
        'label',
        { class: 'mu', style: 'display:flex;align-items:center;gap:6px;' },
        h('input', { type: 'checkbox', checked: !!it.caption }),
        'Keep this caption'
      );

      capIn.oninput = () => {
        chk.querySelector('input').checked = !!capIn.value.trim();
      };

      rowEls.push({ row, capIn, catIn });
      form.append(title, capIn, h('div', { class: 'fld' }, h('label', {}, 'Category'), catIn), chk);
      row.append(preview, form);
      body.append(row);
    });

    const actions = h(
      'div',
      { class: 'bar', style: 'margin-bottom:0;justify-content:flex-end' },
      h('button', { class: 'b', type: 'button', onclick: () => dlg.close() }, 'Cancel'),
      h(
        'button',
        {
          class: 'b p',
          type: 'button',
          onclick: async () => {
            let saved = 0;
            for (let idx = 0; idx < validItems.length; idx++) {
              const item = validItems[idx];
              const { capIn, catIn } = rowEls[idx];
              const p = {
                id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + idx,
                cid: cur,
                cat: catIn.value,
                cap: capIn.value.trim(),
                img: item.img,
                t: Date.now() + saved / 1000,
              };
              await put(p);
              PH.push(p);
              saved++;
            }
            msg.textContent = `${saved} photo${saved === 1 ? '' : 's'} ready for the report.`;
            draw();
            paint();
            dlg.close();
          },
        },
        'Save photos'
      )
    );

    wrap.append(hdr, body, actions);
    dlg.append(wrap);
    document.body.append(dlg);
    dlg.showModal();
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
      await reviewBatch(batch);
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
  m.append(
    h(
      'section',
      { class: 'card' },
      h('h3', {}, 'Add photos / estimate pages'),
      h(
        'p',
        { class: 'mu' },
        'Choose a category and add one or many images (JPG, PNG, WebP). Captions are optional: set one for the whole batch, use file names, or edit each photo afterwards before it is used in the report. Each category becomes a numbered annex in the report. Workshop estimates must be uploaded as images (PDFs cannot be embedded). Photos stay in this browser and are not part of the JSON export.'
      ),
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
      fi,
      fiOne,
      msg
    ),
    list
  );
  draw();
}

function annexHTML() {
  if (window.NOANX) return '';
  let o = '',
    k = 0;
  const ref = `Claim no. ${esc(g('case_claimNo') || '—')} · ${esc(g('fp_reg') || g('case_insReg') || '—')}`;
  PC.forEach(([c, t]) => {
    const L = PH.filter((p) => p.cat === c);
    if (!L.length || c === 'cov') return;
    const n = (Dd.lay && Dd.lay[c]) || (c === 'est' ? 1 : 2),
      w = c === 'est' ? 'Page' : 'Photo';
    o +=
      `<div class=annex><h2>Annex ${RM[k++]} – ${esc(t)}</h2><p class=ai>${ref} · ${L.length} ${w.toLowerCase()}(s)</p><div class='pg n${n}' style='grid-template-columns:repeat(${n},1fr)'>` +
      L.map(
        (p, i) =>
          `<figure><img src='${p.img}' alt=''><figcaption><b>${w} ${i + 1}</b>${p.cap ? ' – ' + esc(p.cap) : ''}</figcaption></figure>`
      ).join('') +
      '</div></div>';
  });
  return o;
}
