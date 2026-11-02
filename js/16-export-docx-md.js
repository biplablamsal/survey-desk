/* Word (.docx) and Markdown builders (docx library) and first export function
   Loaded as a classic script: everything here shares the global scope. Order of <script> tags in index.html matters. */

const u8 = (d) => {
    const b = atob(d.split(',')[1]),
      a = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
    return a;
  },
  imgType = (d) =>
    d.startsWith('data:image/png') ? 'png' : d.startsWith('data:image/gif') ? 'gif' : 'jpg';

async function dImg(src, mw, mh) {
  const d = await dimOf(src),
    s = Math.min(mw / d[0], mh / d[1], 1);
  return new docx.ImageRun({
    data: u8(src),
    transformation: {
      width: Math.max(8, Math.round(d[0] * s)),
      height: Math.max(8, Math.round(d[1] * s)),
    },
    type: imgType(src),
  });
}

function dRuns(n, st) {
  st = st || {};
  const o = [];
  n.childNodes.forEach((c) => {
    if (c.nodeType === 3) {
      const t = c.textContent.replace(/\s+/g, ' ');
      if (t.trim() || t === ' ')
        o.push(
          new docx.TextRun({
            text: t,
            size: st.sz,
            bold: st.b ? true : undefined,
            italics: st.i ? true : undefined,
            underline: st.u ? {} : undefined,
          })
        );
    } else if (c.nodeType === 1) {
      const t = c.tagName;
      if (t === 'BR') o.push(new docx.TextRun({ break: 1 }));
      else
        o.push(
          ...dRuns(c, {
            sz: st.sz,
            b: st.b || t === 'B' || t === 'STRONG' || t === 'TH',
            i: st.i || t === 'I' || t === 'EM',
            u: st.u || t === 'U',
          })
        );
    }
  });
  return o;
}

function dTable(tb) {
  const D = docx,
    rows = [...tb.querySelectorAll('tr')].filter((r) => r.children.length);
  if (!rows.length) return new D.Paragraph({ children: [] });
  const kv = rows.every((r) => r.children.length === 2 && r.children[0].tagName === 'TH'),
    nc = Math.max(
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
  const sm = tb.classList.contains('sm') || nc >= 9,
    TW = 9300,
    sum = wt.reduce((a, b) => a + b, 0),
    cp = [...tb.querySelectorAll('col')].map((c) => parseFloat(c.style.width) || 0),
    cw = kv
      ? [Math.round(TW * 0.35), Math.round(TW * 0.65)]
      : cp.length === nc && cp.every((x) => x > 0)
        ? cp.map((x) => Math.round((TW * x) / 100))
        : wt.map((x) => Math.max(500, Math.round((TW * x) / sum)));
  return new D.Table({
    layout: D.TableLayoutType.FIXED,
    width: { size: TW, type: D.WidthType.DXA },
    columnWidths: cw,
    rows: rows.map((r) => {
      let ci = 0;
      return new D.TableRow({
        cantSplit: true,
        children: [...r.children].map((c) => {
          const hd = c.tagName === 'TH',
            sp = +(c.getAttribute('colspan') || 1),
            w = cw.slice(ci, ci + sp).reduce((a, b) => a + b, 0);
          ci += sp;
          return new D.TableCell({
            columnSpan: sp,
            width: { size: w, type: D.WidthType.DXA },
            shading: hd ? { fill: 'EEF1F5' } : undefined,
            margins: { top: 30, bottom: 30, left: sm ? 30 : 80, right: sm ? 30 : 80 },
            children: [
              new D.Paragraph({
                spacing: { after: 0 },
                children: dRuns(c, { b: hd, sz: sm ? 14 : undefined }),
              }),
            ],
          });
        }),
      });
    }),
  });
}

function dConv(el, pbk) {
  const D = docx,
    P = D.Paragraph,
    HL = D.HeadingLevel,
    t = el.tagName;
  if (t === 'H2')
    return [new P({ heading: HL.HEADING_1, pageBreakBefore: !!pbk, children: dRuns(el) })];
  if (t === 'H3') return [new P({ heading: HL.HEADING_2, keepNext: true, children: dRuns(el) })];
  if (t === 'H4' || t === 'H5')
    return [new P({ heading: HL.HEADING_3, keepNext: true, children: dRuns(el) })];
  if (t === 'UL' || t === 'OL')
    return [...el.children]
      .filter((x) => x.tagName === 'LI')
      .map(
        (li, i) =>
          new P(
            t === 'UL'
              ? { bullet: { level: 0 }, spacing: { after: 60 }, children: dRuns(li) }
              : {
                  indent: { left: 540, hanging: 300 },
                  spacing: { after: 60 },
                  children: [new D.TextRun(i + 1 + '. '), ...dRuns(li)],
                }
          )
      );
  if (t === 'TABLE') return [dTable(el), new P({ children: [] })];
  const r = dRuns(el);
  return r.length
    ? [new P({ spacing: { after: 120 }, alignment: D.AlignmentType.JUSTIFIED, children: r })]
    : [];
}

async function docxBuild(kind, body, anx) {
  const D = docx,
    P = D.Paragraph,
    R = D.TextRun,
    C = D.AlignmentType.CENTER,
    HL = D.HeadingLevel,
    W = D.WidthType,
    mo = MOD !== MODS.property,
    sg = await getA('sig'),
    stp = await getA('stp'),
    cv = PH.find((p) => p.cat === 'cov') || PH.find((p) => p.cat === 'iv'),
    nb = D.TableBorders.NONE;
  const kv = (a, b) =>
    new D.TableRow({
      children: [
        new D.TableCell({
          width: { size: 45, type: W.PERCENTAGE },
          children: [
            new P({ alignment: D.AlignmentType.RIGHT, children: [new R({ text: a, size: 26 })] }),
          ],
        }),
        new D.TableCell({
          width: { size: 55, type: W.PERCENTAGE },
          children: [new P({ children: [new R({ text: '   ' + (b || '—'), size: 26 })] })],
        }),
      ],
    });
  const cover = [
    new P({
      alignment: C,
      spacing: { before: 400, after: 300 },
      children: [
        new R({ text: mo ? 'MOTOR VEHICLE' : 'PROPERTY', bold: true, size: 52 }),
        new R({
          text: (kind === 'prelim' ? 'PRELIMINARY' : 'FINAL') + ' SURVEY',
          bold: true,
          size: 52,
          break: 1,
        }),
      ],
    }),
    new P({
      alignment: C,
      spacing: { after: 300 },
      children: cv
        ? [await dImg(cv.img, 420, 330)]
        : [
            new R({
              text:
                '[Insured ' +
                (mo ? 'vehicle' : 'property') +
                ' photograph – add one under Photos & annexes]',
              italics: true,
              color: '888888',
            }),
          ],
    }),
    new D.Table({
      width: { size: 90, type: W.PERCENTAGE },
      alignment: C,
      borders: nb,
      rows: [
        kv('Insurance Claim No.', g('case_claimNo')),
        kv('Policy Number', g('case_policyNo')),
        kv('Submitted By', g('case_surveyor')),
        kv('Submitted To', g('case_company')),
      ],
    }),
    new P({
      alignment: C,
      spacing: { before: 300 },
      children: [new R({ text: today() + ' · BS ' + bsStr(today()).split(' ')[0], size: 18 })],
    }),
  ];
  if (sg || stp)
    cover.push(
      new P({
        spacing: { before: 700 },
        children: [
          ...(sg ? [await dImg(sg, 230, 90)] : []),
          new R({ text: '   ' }),
          ...(stp ? [await dImg(stp, 115, 115)] : []),
        ],
      })
    );
  const main = [
    new P({
      spacing: { after: 200 },
      children: [new R({ text: 'Table of Contents', bold: true, size: 34 })],
    }),
    new D.TableOfContents('Table of Contents', { hyperlink: true, headingStyleRange: '1-1' }),
    new P({
      children: [
        new R({
          text: 'If page numbers are blank, right-click the contents and choose Update Field.',
          italics: true,
          size: 18,
          color: '777777',
        }),
      ],
    }),
  ];
  const disc = (cfg.disc || DISC)
    .split('{type}')
    .join(kind === 'prelim' ? 'preliminary' : 'final')
    .split('\n\n');
  main.push(
    new P({ heading: HL.HEADING_1, pageBreakBefore: true, children: [new R('Disclaimer')] }),
    ...disc.map(
      (x) =>
        new P({
          alignment: D.AlignmentType.JUSTIFIED,
          spacing: { after: 140 },
          children: [new R(x)],
        })
    ),
    new P({
      spacing: { before: 400 },
      children: [
        new R({ text: g('case_surveyor') || '', bold: true }),
        new R({
          text: 'Licensed Surveyor' + (g('case_lic') ? ' · Licence no. ' + g('case_lic') : ''),
          break: 1,
        }),
      ],
    })
  );
  let first = true;
  for (const s of secBody(body)) {
    const d = new DOMParser().parseFromString(s.h, 'text/html');
    [...d.body.children].forEach((el) => {
      main.push(...dConv(el, first && el.tagName === 'H2'));
      if (el.tagName === 'H2') first = false;
    });
  }
  if (anx) {
    const RN = ['I', 'II', 'III', 'IV', 'V', 'VI'];
    let k = 0;
    for (const [c, t] of PC) {
      if (c === 'cov') continue;
      const L = PH.filter((p) => p.cat === c);
      if (!L.length) continue;
      const n = (Dd.lay && Dd.lay[c]) || (c === 'est' ? 1 : 2),
        rows = n === 1 ? (c === 'est' ? 1 : 2) : n === 2 ? 3 : 4,
        per = n * rows,
        mw = Math.floor(600 / n) - 16,
        mh = c === 'est' ? 800 : Math.floor(800 / rows) - 36,
        w = c === 'est' ? 'Page' : 'Photo',
        title = 'Annex ' + RN[k++] + ' – ' + t;
      for (let s = 0; s < L.length; s += per) {
        const grp = L.slice(s, s + per),
          trs = [];
        for (let r = 0; r < grp.length; r += n) {
          const cells = [];
          for (let j = 0; j < n; j++) {
            const p = grp[r + j];
            cells.push(
              new D.TableCell({
                width: { size: Math.floor(100 / n), type: W.PERCENTAGE },
                children: p
                  ? [
                      new P({ alignment: C, children: [await dImg(p.img, mw, mh)] }),
                      new P({
                        alignment: C,
                        children: [
                          new R({ text: w + ' ' + (s + r + j + 1), bold: true, size: 18 }),
                          new R({ text: p.cap ? ' – ' + p.cap : '', size: 18 }),
                        ],
                      }),
                    ]
                  : [new P({ children: [] })],
              })
            );
          }
          trs.push(new D.TableRow({ cantSplit: true, children: cells }));
        }
        main.push(
          s === 0
            ? new P({ heading: HL.HEADING_1, pageBreakBefore: true, children: [new R(title)] })
            : new P({
                pageBreakBefore: true,
                children: [new R({ text: title + ' (continued)', italics: true, size: 20 })],
              }),
          new D.Table({ width: { size: 100, type: W.PERCENTAGE }, borders: nb, rows: trs })
        );
      }
    }
  }
  const hs = (id, nm, sz) => ({
    id,
    name: nm,
    basedOn: 'Normal',
    next: 'Normal',
    quickFormat: true,
    run: { size: sz, bold: true, color: '0A2A5E', font: 'LM Roman 10' },
    paragraph: { spacing: { before: 0, after: 160 } },
  });
  return new D.Document({
    creator: 'Survey Desk',
    title: 'Survey report',
    features: { updateFields: true },
    styles: {
      default: { document: { run: { font: 'LM Roman 10', size: 22 } } },
      paragraphStyles: [
        hs('Heading1', 'Heading 1', 30),
        hs('Heading2', 'Heading 2', 24),
        hs('Heading3', 'Heading 3', 22),
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 720, bottom: 720, left: 720, right: 720 },
          },
        },
        children: cover,
      },
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 720, bottom: 720, left: 720, right: 720 },
            pageNumbers: { start: 1, formatType: D.NumberFormat.DECIMAL },
          },
        },
        footers: {
          default: new D.Footer({
            children: [
              new P({
                alignment: C,
                spacing: { before: 0, after: 0 },
                children: [
                  ...(sg ? [await dImg(sg, 180, 70)] : []),
                  new R({ text: '   ' }),
                  ...(stp ? [await dImg(stp, 90, 90)] : []),
                ],
              }),
              new P({
                alignment: C,
                children: [
                  new R({ text: g('case_surveyor') || 'Licensed Surveyor', bold: true, size: 18 }),
                  new R({
                    text: g('case_lic') ? ' · Licence no. ' + g('case_lic') : '',
                    size: 18,
                    break: 1,
                  }),
                ],
              }),
            ],
          }),
        },
        children: main,
      },
    ],
  });
}

function mdIn(n) {
  let s = '';
  n.childNodes.forEach((c) => {
    if (c.nodeType === 3) s += c.textContent.replace(/\s+/g, ' ');
    else if (c.nodeType === 1) {
      const t = c.tagName;
      if (t === 'BR') s += '  \n';
      else {
        const x = mdIn(c);
        s +=
          t === 'B' || t === 'STRONG' || t === 'TH'
            ? x.trim()
              ? '**' + x.trim() + '**'
              : ''
            : t === 'I' || t === 'EM'
              ? x.trim()
                ? '*' + x.trim() + '*'
                : ''
              : x;
      }
    }
  });
  return s;
}

function mdBlk(el) {
  const t = el.tagName,
    tx = () => mdIn(el).trim();
  if (t === 'H2') return '## ' + el.textContent.trim();
  if (t === 'H3') return '### ' + el.textContent.trim();
  if (t === 'H4' || t === 'H5') return '#### ' + el.textContent.trim();
  if (t === 'UL' || t === 'OL')
    return [...el.children]
      .filter((x) => x.tagName === 'LI')
      .map((li, i) => (t === 'UL' ? '- ' : i + 1 + '. ') + mdIn(li).trim())
      .join('\n');
  if (t === 'TABLE') {
    const rows = [...el.querySelectorAll('tr')].map((r) =>
      [...r.children].map((c) => mdIn(c).trim().split('|').join('/'))
    );
    if (!rows.length) return '';
    const n = Math.max(...rows.map((r) => r.length)),
      pad = (r) => {
        const a = [...r];
        while (a.length < n) a.push('');
        return '| ' + a.join(' | ') + ' |';
      },
      kv = [...el.querySelectorAll('tr')].every(
        (r) => r.children.length === 2 && r.children[0].tagName === 'TH'
      ),
      hd = kv ? ['Item', 'Details'] : rows[0],
      bd = kv ? rows : rows.slice(1);
    return [pad(hd), '|' + Array(n).fill('---').join('|') + '|', ...bd.map(pad)].join('\n');
  }
  return tx();
}

async function mdBuild(kind, body, anx) {
  const mo = MOD !== MODS.property,
    o = [
      '# ' +
        (mo ? 'MOTOR VEHICLE ' : 'PROPERTY ') +
        (kind === 'prelim' ? 'PRELIMINARY' : 'FINAL') +
        ' SURVEY',
      '',
      PH.find((p) => p.cat === 'cov') || PH.find((p) => p.cat === 'iv')
        ? '[IMAGE PLACEHOLDER: Cover photo – insured ' + (mo ? 'vehicle' : 'property') + ']'
        : '[IMAGE PLACEHOLDER: Cover photo]',
      '',
      '| Item | Details |',
      '|---|---|',
      '| Insurance claim no. | ' + (g('case_claimNo') || '—') + ' |',
      '| Policy number | ' + (g('case_policyNo') || '—') + ' |',
      '| Submitted by | ' + (g('case_surveyor') || '—') + ' |',
      '| Submitted to | ' + (g('case_company') || '—') + ' |',
      '| Date | ' + today() + ' |',
      '',
      '---',
      '',
      '## Disclaimer',
      '',
      ...(cfg.disc || DISC)
        .split('{type}')
        .join(kind === 'prelim' ? 'preliminary' : 'final')
        .split('\n\n')
        .flatMap((x) => [x, '']),
      '---',
      '',
    ];
  for (const s of secBody(body)) {
    const d = new DOMParser().parseFromString(s.h, 'text/html');
    [...d.body.children].forEach((el) => {
      const x = mdBlk(el);
      if (x) o.push(x, '');
    });
    o.push('---', '');
  }
  if (anx) {
    const RN = ['I', 'II', 'III', 'IV', 'V', 'VI'];
    let k = 0;
    for (const [c, t] of PC) {
      if (c === 'cov') continue;
      const L = PH.filter((p) => p.cat === c);
      if (!L.length) continue;
      o.push('## Annex ' + RN[k++] + ' – ' + t, '');
      L.forEach((p, i) =>
        o.push(
          '[IMAGE PLACEHOLDER: ' +
            (c === 'est' ? 'Page ' : 'Photo ') +
            (i + 1) +
            (p.cap ? ' – ' + p.cap : '') +
            ']',
          ''
        )
      );
      o.push('---', '');
    }
  }
  return o.join('\n');
}

async function doExport(kind, ed, fm, msg) {
  const dl = window.claude ? await claude.use('downloads') : null;
  if (!dl) {
    msg.textContent = 'Saving files is unavailable in this view – open the page inside claude.ai.';
    return;
  }
  const body = clean(ed.innerHTML),
    base =
      safeName(g('case_claimNo') || 'case') +
      (kind === 'prelim' ? '_preliminary' : '_final') +
      '_report',
    out = [];
  const er = (l, e) =>
    out.push(
      l +
        ': ' +
        (e === 'lib' ? 'export library did not load' : (e && (e.code || e.message)) || 'failed')
    );
  if (fm.d) {
    try {
      if (typeof docx === 'undefined') throw 'lib';
      msg.textContent = 'Building Word file…';
      await dl.save({
        filename: base + '.docx',
        data: await docx.Packer.toBlob(await docxBuild(kind, body, fm.a)),
      });
      out.push('Word file saved');
    } catch (e) {
      er('Word', e);
    }
  }
  if (fm.m) {
    try {
      await dl.save({ filename: base + '.md', data: await mdBuild(kind, body, fm.a) });
      out.push('Markdown saved');
    } catch (e) {
      er('Markdown', e);
    }
  }
  if (fm.p) {
    const wrap = h('div');
    wrap.style.cssText =
      'position:fixed;left:0;top:0;z-index:-1;pointer-events:none;background:#fff';
    try {
      if (typeof html2pdf === 'undefined') throw 'lib';
      msg.textContent = 'Building report layout…';
      const { el } = await docBuild(kind, body, fm.a, true),
        blocks = [...el.children].filter((c) => c.tagName === 'DIV');
      el.remove();
      document.body.append(wrap);
      const sc = 1.5,
        sty = '<style>' + dcss('.dc ') + '</style>',
        opt = {
          margin: [8, 12, 8, 12],
          image: { type: 'jpeg', quality: 0.9 },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        };
      let pdf = null,
        done = 0;
      const sx0 = window.scrollX,
        sy0 = window.scrollY;
      window.scrollTo(0, 0);
      for (const blk of blocks) {
        msg.textContent = 'Rendering section ' + ++done + ' of ' + blocks.length + '…';
        const w = h('div', { class: 'dc' });
        w.style.cssText = 'width:210mm;min-height:297mm;background:#fff';
        w.innerHTML =
          sty +
          '<style>.dc .pb{page-break-before:auto!important;break-before:auto!important}</style>' +
          blk.outerHTML;
        wrap.replaceChildren(w);
        await new Promise((r) => setTimeout(r, 40));
        const cv = await html2pdf()
            .set({
              margin: [8, 12, 8, 12],
              html2canvas: { scale: sc, backgroundColor: '#ffffff', scrollX: 0, scrollY: 0 },
            })
            .from(w)
            .toCanvas()
            .get('canvas'),
          pw = cv.width,
          sl = Math.round((pw * 297) / 210),
          HH = Math.min(cv.height, Math.round(w.offsetHeight * sc)),
          fit = blk.dataset.fit === '1',
          n = fit ? 1 : Math.max(1, Math.ceil((HH - 3 * sc) / sl));
        for (let s = 0; s < n; s++) {
          const c2 = document.createElement('canvas');
          c2.width = pw;
          c2.height = fit ? HH : Math.min(sl, HH - s * sl);
          const cx = c2.getContext('2d');
          cx.fillStyle = '#fff';
          cx.fillRect(0, 0, pw, c2.height);
          cx.drawImage(cv, 0, s * sl, pw, c2.height, 0, 0, pw, c2.height);
          if (!pdf) pdf = await html2pdf().set(opt).from(c2, 'canvas').toPdf().get('pdf');
          else {
            pdf.addPage();
            {
              let wm = 210,
                hm = (c2.height * 210) / pw;
              if (hm > 297) {
                wm = (210 * 297) / hm;
                hm = 297;
              }
              pdf.addImage(c2.toDataURL('image/jpeg', 0.9), 'JPEG', 5 + (210 - wm) / 2, 10, wm, hm);
            }
          }
        }
      }
      const np = pdf.internal.getNumberOfPages(),
        PW = pdf.internal.pageSize.getWidth(),
        PH_ = pdf.internal.pageSize.getHeight();
      for (let i = 2; i <= np; i++) {
        pdf.setPage(i);
        pdf.setFontSize(9);
        pdf.text(String(i - 1), 112.5, PH_ - 5, { align: 'center' });
      }
      window.scrollTo(sx0, sy0);
      await dl.save({ filename: base + '.pdf', data: pdf.output('arraybuffer') });
      out.push('PDF saved (' + np + ' pages)');
    } catch (e) {
      er('PDF', e);
    }
    wrap.remove();
  }
  msg.textContent = out.join(' · ') || 'Tick at least one format.';
}
