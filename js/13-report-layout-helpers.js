/* Disclaimer, report stylesheet (dcss), signature/stamp, cover, annex blocks, preview
   Loaded as a classic script: everything here shares the global scope. Order of <script> tags in index.html matters. */

const t12 = (v) => {
  if (!v || !String(v).includes(':')) return v || '';
  const a = String(v).split(':').map(Number);
  return `${a[0] % 12 || 12}:${p2(a[1] || 0)} ${a[0] >= 12 ? 'PM' : 'AM'}`;
};

const DISC = `This report has been prepared by the undersigned licensed surveyor at the request of the insurer, on the basis of the information, documents, statements and inspection findings available at the time of survey. The surveyor has relied on the accuracy and completeness of the information supplied by the insured, the insurer and other parties and has not independently verified it except where stated.\n\nThe observations, assessments and estimates in this {type} report are given without prejudice and do not constitute an admission of liability or a decision on the claim. The liability of the insurer remains subject to the terms, conditions, limits, exclusions and endorsements of the policy and to the insurer’s own decision.\n\nThe surveyor reserves the right to amend or supplement this report if further information, documents or evidence become available. This report is confidential, is prepared solely for the insurer, and may not be relied upon by any other party without the surveyor’s written consent.`;

/* ============================================================================
   CENTRAL PDF DESIGN SYSTEM
   The one place a SurveyPro report's visual language is defined. Report templates decide
   WHAT appears; everything in this object decides HOW it appears. The spot, preliminary and
   final reports all consume it through dcss() and the shared page components below, so a
   change here reaches every report type and no template may carry its own design values.
   ============================================================================ */
const PDF_DESIGN = {
  /* Bumped when the sheet changes: margins, the cover, or anything a finished page is made of.
     Every export stamps this into the file and the QA reader asks for it, so a report can always be
     traced to the design that built it. */
  version: '1.2.0',

  page: {
    size: 'A4',
    orientation: 'portrait',
    w: 210,
    h: 297,
    /* millimetres from the paper edge. The top band carries the running header and the bottom
       band is reserved for the stamp image, so nothing prints under either and everything stays
       inside what a printer can actually reach.
       `left` is the binding edge: a report is filed and bound on its left, so the gutter is wider
       than the outer margin by design, not by accident. Raising it costs content width, which is
       the price of a page that can be read once it is in a ring binder. */
    margin: { top: 25, right: 15, bottom: 20, left: 25 },
  },

  typography: {
    family: '"LM Roman 10","Latin Modern Roman",Georgia,serif',
    title: 22,
    majorHeading: 14,
    subsectionHeading: 12,
    body: 10.5,
    table: 9.5,
    caption: 9,
    footer: 8,
    lineHeight: 1.45,
    /* the readability floor: a report is never squeezed below this size to fit a page limit */
    minimum: 9,
  },

  colors: {
    primary: '#17365D',
    secondary: '#4472C4',
    text: '#252525',
    muted: '#666666',
    border: '#D9E0E8',
    tableHeader: '#EAF0F6',
    background: '#FFFFFF',
  },

  spacing: {
    sectionBefore: 14,
    sectionAfter: 8,
    paragraphAfter: 6,
    tablePadding: 6,
  },

  header: {
    cover: false, // a cover page identifies itself and takes no running header
    annex: true,
    offsetMm: 6, // distance of the header line from the paper edge
    rule: true,
  },

  footer: {
    /* ONLY the stamp and signature images: no surveyor name, licence, claim number, report
       title, page number or branding. The page number belongs to the header band. */
    offsetMm: 5,
    gapMm: 4,
    signature: { w: 42, h: 16 },
    stamp: { w: 16, h: 16 },
  },

  annex: {
    // columns per row -> maximum photograph size in millimetres, so one row never beats a page
    cell: { 1: [158, 205], 2: [78, 66], 4: [50, 43] },
    // rows that fit one page at that column count: this is what keeps an annex to whole pages
    rows: { 1: 1, 2: 3, 4: 4 },
    padMm: 2,
  },

  cover: {
    /* The cover photograph box and the two identification tables. The photograph is sized to what
       the cover box actually leaves, so it never reaches its own max-width and gets squashed. */
    photo: { w: 158, h: 104 },
    metaWidth: 62,
    /* The sign-off block uses the whole printable width - "Submitted By" against the left edge,
       "Submitted To" against the right - and it closes the page: it is pushed to the foot of the
       cover so the reader's eye travels masthead, photograph, identity, date, parties, stamp. The
       clear space it keeps above the stamp band is what stops the names printing under the seal. */
    partyWidth: 100,
    footClearMm: 12,
    /* The cover is read at arm's length, not studied in a table, so its type is larger than body
       text - and larger than it was, which is what made the page look small. */
    type: { title: 25, meta: 11.5, label: 9.5, name: 12.5, date: 10.5 },
  },

  spot: {
    /* A spot survey is what the surveyor writes at the scene, so the whole document - the two
       pages, not counting photographs - has to fit on two sheets. The limit is enforced by the
       paginator, which names the sections that push it past two pages instead of cutting them. */
    maxPages: 2,
    idWidth: 100,
  },

  image: {
    /* The exporter rasterises a finished page box, so scale is the DPI multiplier: 3 is about
       288 dpi, where printed table rules and a signature edge stop looking soft.
       Measured on a 9-page report: JPEG 0.92 gives 3.3 MB, PNG gives 289 MB, because jsPDF can
       only place a JPEG straight into the file (DCTDecode) and inflates a PNG to raw pixels.
       So the page raster is JPEG and the quality is what keeps the text crisp. */
    scale: 3,
    encode: 'JPEG',
    quality: 0.92,
  },

  qa: {
    /* How far a finished file may stray from this design before the deviation is a fault rather
       than rounding. A generated page carries no text objects - the whole sheet is one image - so
       a media box is the only text that is machine-readable, and a page that is a hair narrower
       than A4 is a rounding difference, not a defect. Measured on a two-page spot report: media
       box 595.2756 × 841.8898 pt, the page image drawn 595.2453 × 841.8898 pt at offset 0.0151 pt
       - three hundredths of a point, which is what the exporter's aspect clamp leaves behind.
       ptTol is in points, the other two are fractions of the sheet. */
    ptTol: 0.5,
    fillTol: 0.005,
    aspectTol: 0.01,
  },
};

/* ============================================================================
   ONE CONFIGURATION PER REPORT TYPE
   The three report types are not three templates that each decide their own layout; they are
   three rows of this table. A template says which kind it is and the engine reads everything
   else here - the wording, the file name, whether it opens with a cover and carries a table of
   contents, how many sheets it may run to, and what must never appear in it. Adding a fourth
   report type means adding a row, not editing the paginator.
   `noHead` is the exclusion rule: a heading that matches one of these is reported to the
   surveyor, never quietly deleted, because a report that silently lost a section is worse than
   one that says it is too long.
   `maxPages` for the spot report is read from PDF_DESIGN rather than repeated here: how many
   sheets a report may run to is a page rule, and a page rule has one home.
   ============================================================================ */
const REPORT_KINDS = {
  spot: {
    label: 'Spot report',
    title: 'SPOT',
    word: 'spot',
    file: 'spot',
    cover: false,
    toc: false,
    discPage: false,
    maxPages: PDF_DESIGN.spot.maxPages,
    /* Named sections, not loose words: 'assessment' alone would also strike a legitimate
       "damage assessment" paragraph out of an on-scene record. */
    noHead: ['final calculation', 'final assessment', 'bills', 'medical expenses'],
    help: 'The on-scene record: what was seen, what was said and what was photographed. No bills, no medical expenses, no final assessment - those belong to the final report.',
  },
  prelim: {
    label: 'Preliminary report',
    title: 'PRELIMINARY',
    word: 'preliminary',
    file: 'preliminary',
    cover: true,
    toc: true,
    discPage: true,
    maxPages: 0,
    noHead: ['final calculation', 'final assessment', 'bills', 'medical expenses'],
    help: 'Generated from the data entered so far. Edit the draft, save it, then export. The surveyor’s final assessment and the bills belong to the final report, so they are not carried here.',
  },
  final: {
    label: 'Final report',
    title: 'FINAL',
    word: 'final',
    file: 'final',
    cover: true,
    toc: true,
    discPage: true,
    maxPages: 0,
    noHead: [],
    /* Only the final report carries the bills and the surveyor's calculation into a draft. */
    bills: true,
    help: 'Adds repair & maintenance bills, medical expenses (first and third party) and the surveyor’s final calculation. Enter these under “Bills & expenses” and “Final assessment” first.',
  },
};

const kindCfg = (k) => REPORT_KINDS[k] || REPORT_KINDS.final;

/* The stylesheet every report surface shares: the offscreen page builder, the on-screen preview
   and the rasteriser. `p` is the scope prefix ('.dc ') so the same tokens style the report
   document and nothing else on the application's own page. */
/* Report pages are laid out in millimetres and measured in CSS pixels, which is what html2canvas
   rasterises; one conversion in one place keeps the design values readable. */
const mmPx = (v) => Math.round((v * 96) / 25.4);

const dcss = (p) => {
  const T = PDF_DESIGN.typography,
    C = PDF_DESIGN.colors,
    S = PDF_DESIGN.spacing,
    P = PDF_DESIGN.page,
    M = P.margin,
    H = PDF_DESIGN.header,
    F = PDF_DESIGN.footer,
    CV = PDF_DESIGN.cover,
    /* The binding gutter, used on the spine edge of a page and on both edges of a cover. */
    gutter = Math.max(M.left, M.right),
    box = `${M.top}mm ${M.right}mm ${M.bottom}mm ${M.left}mm`,
    /* The cover keeps the binding gutter on the spine and the same space on the outer edge: it
       carries no body text, so nothing has to be kept clear of the rings, and an odd-sized side
       padding would sit the whole block off the centre of the sheet. */
    covBox = `${M.top}mm ${gutter}mm ${M.bottom}mm ${gutter}mm`,
    scoped = (s) =>
      s
        .split(',')
        .map((x) => p + x)
        .join(',');
  return [
    ['', `font:${T.body}pt/${T.lineHeight} ${T.family};color:${C.text};background:${C.background}`],
    [
      'h1',
      `font-size:${T.title}pt;color:${C.primary};text-align:center;letter-spacing:.04em;margin:0 0 ${S.sectionBefore * 2}px;line-height:1.25;font-weight:700`,
    ],
    [
      'h2',
      `font-size:${T.majorHeading}pt;color:${C.primary};border-bottom:1.5pt solid ${C.secondary};padding-bottom:3px;margin:${S.sectionBefore}px 0 ${S.sectionAfter}px`,
    ],
    [
      'h3,h4',
      `font-size:${T.subsectionHeading}pt;color:${C.primary};margin:${S.sectionBefore}px 0 4px`,
    ],
    ['p', `margin:0 0 ${S.paragraphAfter}px;text-align:justify;line-height:${T.lineHeight}`],
    ['ul,ol', `margin:0 0 ${S.paragraphAfter + 2}px;padding-left:22px`],
    ['li', 'margin:0 0 3px'],
    [
      'table',
      `border-collapse:collapse;width:100%;max-width:100%;table-layout:fixed;margin:${S.paragraphAfter}px 0;font-size:${T.table}pt`,
    ],
    [
      'th,td',
      `border:1px solid ${C.border};padding:${S.tablePadding}px;text-align:left;vertical-align:top;word-wrap:break-word;overflow-wrap:break-word`,
    ],
    ['th', `background:${C.tableHeader};color:${C.primary};font-weight:700`],
    ['table.nb td,table.nb th', `border:0;background:${C.background}`],
    ['table.toc td', `border:0;border-bottom:1px dotted ${C.border};padding:5px 4px`],
    [
      'table.sm td,table.sm th',
      `font-size:${Math.max(T.minimum, T.table - 1.5)}pt;padding:3px ${S.tablePadding - 2}px`,
    ],
    ['.cap', `font-size:${T.caption}pt;color:${C.muted};text-align:center;margin:2px 0 6px`],
    ['.ai', `font-size:${T.caption}pt;color:${C.muted};margin:0 0 8px`],
    ['img', 'max-width:100%'],
    // one finished page: exactly A4, margins from the design, nothing may escape the box
    [
      '.pb',
      `page-break-before:always;box-sizing:border-box;width:${P.w}mm;height:${P.h}mm;padding:${box};overflow:hidden;position:relative;background:${C.background};color:${C.text}`,
    ],
    [
      '.cover',
      `box-sizing:border-box;display:flex;flex-direction:column;width:${P.w}mm;height:${P.h}mm;padding:${covBox};position:relative;background:${C.background};color:${C.text}`,
    ],
    [
      '.cover h1',
      `font-size:${CV.type.title}pt;color:${C.primary};letter-spacing:.14em;line-height:1.3;margin:0`,
    ],
    // the masthead rule: one weight-bearing line and a hairline under it, centred on the title
    [
      '.cover-rule',
      `width:42mm;border-top:2pt solid ${C.secondary};border-bottom:.75pt solid ${C.border};height:2px;margin:${S.sectionAfter}px auto ${S.sectionBefore * 2}px`,
    ],
    ['.cover-photo', `text-align:center;margin:0 0 ${S.sectionBefore * 2}px`],
    ['.cover-photo img', `border:1px solid ${C.border};vertical-align:bottom`],
    [
      '.cover-noimg',
      `height:${mmPx(CV.photo.h)}px;line-height:${mmPx(CV.photo.h)}px;color:${C.muted};border:1px dashed ${C.border}`,
    ],
    // the two identification rows, held centred on the page between two hairlines
    [
      '.cover-meta',
      `width:${CV.metaWidth}%;margin:0 auto;border-top:.75pt solid ${C.border};border-bottom:.75pt solid ${C.border}`,
    ],
    [
      '.cover-meta td',
      `border:0;text-align:center;padding:${S.tablePadding - 1}px 6px;font-size:${CV.type.meta}pt`,
    ],
    ['.cover-meta td:first-child', `color:${C.muted};letter-spacing:.06em`],
    /* The sign-off block uses the whole printable width so the surveyor sits against the left edge
       and the insurer against the right - the two parties a report stands between. */
    ['.cover-party', `width:${CV.partyWidth}%;margin:auto 0 ${CV.footClearMm}mm`],
    ['.cover-party th,.cover-party td', 'border:0;padding:0'],
    [
      '.cover-party th',
      `font-size:${CV.type.label}pt;color:${C.muted};letter-spacing:.1em;font-weight:400`,
    ],
    [
      '.cover-party td',
      `font-size:${CV.type.name}pt;color:${C.primary};padding-top:3px;line-height:1.35`,
    ],
    ['.cover-party th:last-child,.cover-party td:last-child', 'text-align:right'],
    [
      '.cover-date',
      `text-align:center;font-size:${CV.type.date}pt;color:${C.muted};letter-spacing:.04em;margin:${S.sectionBefore}px 0 0`,
    ],
    /* A spot report has no cover sheet - two pages is the whole document - so this is the cover's
       identification compressed into a heading and one borderless table at the head of page 1. */
    ['.spot-id', `margin:0 0 ${S.sectionBefore * 2}px`],
    [
      '.spot-id h1',
      `font-size:${T.majorHeading}pt;color:${C.primary};letter-spacing:.06em;margin:0 0 ${S.sectionAfter}px;padding-bottom:4px;border-bottom:1.5pt solid ${C.secondary}`,
    ],
    [
      '.spot-meta',
      `width:${PDF_DESIGN.spot.idWidth}%;table-layout:fixed;font-size:${T.table}pt;margin:0`,
    ],
    [
      '.spot-meta th',
      `width:17%;border:0;background:${C.background};color:${C.muted};font-weight:400;text-align:left;padding:2px 4px 2px 0`,
    ],
    ['.spot-meta td', 'width:33%;border:0;padding:2px 8px 2px 0'],
    // the measured content box of a page: everything between the header band and the footer band
    ['.pg-body', `position:relative;height:100%;overflow:hidden`],
    [
      '.rep-header',
      `position:absolute;left:${M.left}mm;right:${M.right}mm;top:${H.offsetMm}mm;display:flex;align-items:baseline;justify-content:space-between;gap:8px;font-size:${T.footer}pt;color:${C.muted};letter-spacing:.03em${H.rule ? `;border-bottom:.5pt solid ${C.border};padding-bottom:2px` : ''}`,
    ],
    ['.rep-header .rh-title', `color:${C.primary};font-weight:700;letter-spacing:.06em`],
    ['.rep-header .rh-ref', 'text-align:right;white-space:nowrap'],
    ['.rep-header .rh-pg', `color:${C.primary};font-weight:700`],
    [
      '.report-footer',
      `position:absolute;right:${M.right}mm;bottom:${F.offsetMm}mm;display:flex;align-items:flex-end;gap:${F.gapMm}mm`,
    ],
    ['.report-footer img', 'display:block;object-fit:contain'],
    [
      '.report-footer .rf-sig',
      // never taller than the bottom band, so a large upload cannot print over the content
      `max-width:${F.signature.w}mm;max-height:${Math.min(F.signature.h, M.bottom - F.offsetMm)}mm`,
    ],
    [
      '.report-footer .rf-stp',
      `max-width:${F.stamp.w}mm;max-height:${Math.min(F.stamp.h, M.bottom - F.offsetMm)}mm`,
    ],
    [
      '.annex-grid td',
      `border:0;padding:${PDF_DESIGN.annex.padMm}mm;text-align:center;vertical-align:top`,
    ],
  ]
    .map(([s, r]) => (s ? scoped(s) : p ? p.trim() : 'body') + '{' + r + '}')
    .join('');
};

/* The two shared page components. Every surface that shows a page uses these, so the footer of
   every page of every report type is the same stamp image and nothing else. Sizes and position
   come from the design, the aspect ratio from the image itself: constraints only, never width
   and height together, so nothing is stretched. */
const reportFooter = (sig, stp) =>
    '<div class="report-footer">' +
    (sig ? `<img class="rf-sig" src='${sig}' alt=''>` : '') +
    (stp ? `<img class="rf-stp" src='${stp}' alt=''>` : '') +
    '</div>',
  reportHeader = (title, ref) =>
    `<div class="rep-header"><span class="rh-title">${esc(title)}</span><span class="rh-ref">${esc(ref || '')}<span class="rh-pg"></span></span></div>`;

/* The one line that says which claim a page belongs to. A vehicle or place that has not been
   recorded is left out instead of printed as a dash, so the header never shows a placeholder as if
   it were data. */
const subjectRef = () => g('fp_reg') || g('pol_reg') || g('case_insReg') || g('case_loc'),
  claimRef = () =>
    [`Claim no. ${g('case_claimNo') || '—'}`, subjectRef()].filter(Boolean).join(' · ');

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
        say(
          v ? '✓ Saved – used in the footer of every report page' : 'Not uploaded yet',
          v ? 'ok' : ''
        );
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
  const C = PDF_DESIGN.cover,
    K = kindCfg(kind),
    cv = coverIn(cur, PH) || PH.find((p) => p.cat === 'iv'),
    e = (k) => esc(g(k) || '—'),
    ph = cv
      ? await imgT(cv.img, mmPx(C.photo.w), mmPx(C.photo.h))
      : `<div class='cover-noimg'>Add a cover photo under Photos &amp; annexes</div>`;
  /* The cover takes the same footer component as every other page, so the stamp is on the first
     page exactly where it is on the last one. The date is part of the heading block and the two
     parties close the page: what a reader looks for first is at the top, who stands at either end
     of the report is at the bottom. */
  return `<div class='cover'><h1>${MOD === MODS.property ? 'PROPERTY' : 'MOTOR VEHICLE'}<br>${K.title} SURVEY</h1><div class='cover-rule'></div><div class='cover-photo'>${ph}</div><table class='nb cover-meta'><tr><td>Insurance Claim No.</td><td>${e('case_claimNo')}</td></tr><tr><td>Policy Number</td><td>${e('case_policyNo')}</td></tr></table><p class='cover-date'>${esc(today())} · BS ${esc(bsStr(today()).split(' ')[0])}</p><table class='nb cover-party'><tr><th>Submitted By</th><th>Submitted To</th></tr><tr><td>${e('case_surveyor')}</td><td>${e('case_company')}</td></tr></table>${reportFooter(sig, stp)}</div>`;
}

/* The spot report has no cover sheet - two pages is the whole document - so the identification
   that a cover would carry becomes a compact block at the head of page 1 and the content starts
   underneath it on the same sheet. Four label/value pairs to a row, because the limit is real. */
async function spotHeadHTML(kind, sig, stp) {
  const K = kindCfg(kind),
    e = (k) => esc(g(k) || '—'),
    mo = MOD === MODS.motor,
    rows = [
      ['Claim no.', e('case_claimNo'), 'Policy no.', e('case_policyNo')],
      [
        mo ? 'Vehicle reg. no.' : 'Location',
        /* The same reference the running header prints, so the two can never disagree. */
        esc(subjectRef() || '—'),
        mo ? 'Make and model' : 'Insured',
        mo ? e('fp_mm') : e('pol_insured'),
      ],
      [
        'Insured',
        e('pol_insured'),
        'Accident date',
        e('case_acc') === '—' ? e('case_accBS') : e('case_acc'),
      ],
      ['Place of loss', e('case_loc'), 'Survey date', e('case_survey')],
      ['Surveyor', e('case_surveyor'), 'Submitted to', e('case_company')],
    ];
  return `<div class='spot-id'><h1>${MOD === MODS.property ? 'PROPERTY' : 'MOTOR VEHICLE'} ${K.title} SURVEY</h1><table class='nb spot-meta'>${rows
    .map((r) => `<tr><th>${r[0]}</th><td>${r[1]}</td><th>${r[2]}</th><td>${r[3]}</td></tr>`)
    .join('')}</table></div>`;
}

function discInner(kind) {
  const t = (cfg.disc || DISC).split('{type}').join(kindCfg(kind).word);
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
    ref = claimRef();
  let k = 0;
  for (const [c, t] of PC) {
    if (c === 'cov') continue;
    const L = PH.filter((p) => p.cat === c);
    if (!L.length) continue;
    const A = PDF_DESIGN.annex,
      n = (Dd.lay && Dd.lay[c]) || (c === 'est' ? 1 : 2),
      rows = A.rows[n] || 3,
      per = n * rows,
      [mw, mh] = A.cell[n] || A.cell[2],
      /* A cell is a share of the printable width, so the design's millimetre box is a maximum that
         can never exceed the column it sits in: an image wider than its cell is clamped by
         max-width while its height attribute is not, and a clamped photograph is the distorted
         annexure image the design exists to prevent. */
      cw =
        Math.min(
          mw,
          PDF_DESIGN.page.w -
            PDF_DESIGN.page.margin.left -
            PDF_DESIGN.page.margin.right -
            A.padMm * n
        ) / n,
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
                `<td style='width:${Math.floor(100 / n)}%'>${await imgT(p.img, mmPx(cw), mmPx(mh))}<div class='cap'><b>${w} ${s + r + j + 1}</b>${p.cap ? ' – ' + esc(p.cap) : ''}</div></td>`
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
          `<table class='nb annex-grid'>${trs}</table>`,
      });
    }
  }
  return out;
}

/* A4 does not fit a phone screen, so the preview is scaled rather than re-flowed: what a person
   sees page by page is what comes out of the printer. */
function fitPreview(pane, sheet) {
  const a4px = mmPx(PDF_DESIGN.page.w);
  sheet.style.zoom = Math.min(1, (pane.clientWidth - 12) / a4px);
  return sheet.style.zoom;
}

async function previewDoc(kind, ed, anx, msg) {
  msg.textContent = 'Building preview…';
  try {
    const built = await docBuild(kind, clean(ed.innerHTML), anx, true),
      w = h('div', { class: 'dc' });
    w.innerHTML = built.el.innerHTML;
    built.el.remove();
    const box = h('div', { class: 'pvw' });
    if (built.warnings.length) {
      const warn = h('div', { class: 'pvwarn' });
      warn.innerHTML =
        '<b>' +
        built.warnings.length +
        ' thing(s) to settle before this report is issued</b><ul>' +
        built.warnings.map((x) => '<li>' + esc(x) + '</li>').join('') +
        '</ul>';
      box.append(warn);
    }
    box.append(w);
    $('#pvb').replaceChildren(box);
    $('#pv').showModal();
    fitPreview($('#pvb'), box);
    msg.textContent = built.warnings.length
      ? built.warnings.length + ' warning(s) above the pages · ' + (built.pages || 'no') + ' pages'
      : 'Preview built · ' + built.pages + ' pages · design v' + PDF_DESIGN.version;
  } catch (e) {
    msg.textContent = 'Preview failed: ' + ((e && e.message) || e);
  }
}

$('#pvx').onclick = () => $('#pv').close();
