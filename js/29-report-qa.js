/* Automated QA of a finished PDF, read from the bytes the file states about itself.

   The paginator can only promise what a page box holds; after that the exporter turns each box into
   one raster and jsPDF writes the file. What the surveyor hands to the insurer is decided in that
   last step, so it is checked in that last step: the media boxes the file states, how many sheets the
   page tree counts, whether the raster of a page covers the sheet it was placed on, what encoding
   those rasters were saved in, and whether the file says which design version built it.

   Nothing here renders or changes a page, and the checks read the file the way a viewer would, so
   they need no browser and no library. That is what lets one function run at export time in the
   browser and afterwards, from tests/pdf-qa.js, over a report somebody has already downloaded. */

/* The bytes of a file as one string, every byte kept as one character. The keywords looked for below
   are all ASCII, and the binary inside a stream must not be reinterpreted on the way. */
function pdfLat1(data) {
  if (typeof data === 'string') return data;
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(data)) return data.toString('latin1');
  return new TextDecoder('latin1').decode(new Uint8Array(data));
}

/* Every indirect object in the file, indexed by its number: `N 0 obj … endobj`. */
function pdfObjects(s) {
  const o = [];
  for (const m of s.matchAll(/(\d+) 0 obj\b/g))
    o[+m[1]] = s.slice(m.index, s.indexOf('endobj', m.index));
  return o;
}

/* The data between `stream` and `endstream`, after the line break the format asks for. Null when the
   object holds no stream, which is how a page without a content stream is found. */
function pdfStream(body) {
  const i = (body || '').search(/stream\r?\n/);
  if (i < 0) return null;
  const e = body.indexOf('endstream', i);
  return e < 0 ? null : body.slice(i + (/stream\r\n/.test(body.slice(i, i + 9)) ? 9 : 8), e);
}

/* The six numbers before a `cm` are the matrix that follows it. The first and the fourth are the
   width and height the image is stretched to, in the points the media box is measured in. */
const pdfPlaceRects = (cs) =>
  [...cs.matchAll(/((?:[-\d.]+[\s]+){5}[-\d.]+)[\s]*cm/g)].map((m) =>
    m[1].trim().split(/\s+/).map(Number)
  );

/* The names a resource dictionary binds to images, so `/I1 Do` can be answered with the object that
   holds its width, its height and its filter. A file can carry an image no page draws - the blank
   sheet the exporter seeds the document with stays behind - and that is dead weight, not a defect,
   so the image checks below run on what the pages actually draw. */
function pdfImageNames(objs) {
  const map = {};
  objs.forEach((b) => {
    const xo = /\/XObject\s*<<([\s\S]*?)>>/.exec(b || '');
    if (!xo) return;
    for (const m of xo[1].matchAll(/\/(\w+)\s+(\d+)\s+0\s+R/g)) map[m[1]] = +m[2];
  });
  return map;
}

/* data: the file. want: {pages} from whoever measured the layout, when they know.
   Every check is {name, ok, detail}, and a detail is written to be read as it stands: a number, a
   page, and what the design asked for. */
function pdfFileQA(data, want, D) {
  D = D || PDF_DESIGN;
  const P = D.page,
    Q = D.qa,
    /* A PDF measures a sheet in points and the design measures it in millimetres. */
    mm = (v) => (v * 25.4) / 72,
    s = pdfLat1(data),
    objs = pdfObjects(s),
    checks = [],
    add = (name, ok, detail) => checks.push({ name, ok: !!ok, detail });

  /* 1. The header every viewer reads first, and the end that says the file was closed. */
  const hdr = /^%PDF-(\d\.\d)/.exec(s);
  add(
    'PDF header',
    !!hdr && /%%EOF/.test(s.slice(-64)),
    hdr ? 'PDF-' + hdr[1] + ', ' + s.length + ' bytes' : 'the file does not begin with %PDF'
  );

  /* 2. The sheet itself, then how many sheets the page tree counts. */
  const pageNums = [];
  objs.forEach((b, n) => {
    if (/\/Type\s*\/Page[\s/]/.test(b || '') && !/\/Type\s*\/Pages\b/.test(b)) pageNums.push(n);
  });
  const tree = objs.find((b) => /\/Type\s*\/Pages\b/.test(b || '')) || '',
    count = +(/\/Count\s+(\d+)/.exec(tree) || [0, 0])[1],
    boxes = pageNums.map((n) => {
      const g = /\/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/.exec(objs[n]);
      /* A page that states no media box has no measurable size, so it is reported as NaN and the
         check below names it; throwing here would lose the report the surveyor asked for. */
      return g ? [+g[3] - +g[1], +g[4] - +g[2]] : [NaN, NaN];
    }),
    off = boxes
      .map((b, i) => ({ i, w: mm(b[0]), h: mm(b[1]) }))
      .filter(
        (b) =>
          !isFinite(b.w) ||
          !isFinite(b.h) ||
          Math.abs(b.w - P.w) > Q.ptTol ||
          Math.abs(b.h - P.h) > Q.ptTol
      );
  add(
    'A4 page size',
    !!boxes.length && !off.length,
    off.length
      ? 'page ' +
          off
            .map((b) => b.i + 1 + ' is ' + b.w.toFixed(1) + '×' + b.h.toFixed(1) + ' mm')
            .join(', ') +
          ', the design says ' +
          P.w +
          '×' +
          P.h
      : boxes.length +
          ' page(s) at ' +
          (boxes[0]
            ? mm(boxes[0][0]).toFixed(2) + '×' + mm(boxes[0][1]).toFixed(2) + ' mm'
            : 'no size')
  );
  add(
    'page count',
    !!pageNums.length &&
      pageNums.length === count &&
      (!want || !want.pages || pageNums.length === want.pages),
    pageNums.length +
      ' page object(s), the tree counts ' +
      count +
      (want && want.pages ? ' and the layout measured ' + want.pages : '')
  );

  /* 3. Nothing drawn, 4. a raster that does not cover its sheet. */
  const names = pdfImageNames(objs),
    /* The content stream of each page, and whether the page names one at all: a sheet that points at
       no stream is blank in the way a viewer sees it, while a sheet whose stream this reader cannot
       open is a file that cannot be measured, and the two are reported apart. */
    refs = pageNums.map((n) => {
      const m = /\/Contents\s+(\d+)/.exec(objs[n]);
      return m ? +m[1] : 0;
    }),
    streams = refs.map((r) => pdfStream(objs[r])),
    blank = [],
    unread = [],
    short = [];
  streams.forEach((cs, i) => {
    if (cs === null) {
      /* No stream to read: either the page never named one, which is a blank sheet, or it named one
         this reader could not open, which is a file that cannot be measured. */
      if (!refs[i]) blank.push(i + 1);
      else unread.push(i + 1);
      return;
    }
    /* Text is shown with Tj or TJ and a picture with Do; a stream with neither is a blank sheet. */
    if (!/\/[\w.]+\s+Do\b|(Tj|TJ)/.test(cs)) blank.push(i + 1);
    pdfPlaceRects(cs).forEach((m) => {
      const fw = Math.abs(m[0]) / (boxes[i][0] || 1),
        fh = Math.abs(m[3]) / (boxes[i][1] || 1);
      /* The exporter clamps a page to whichever side of A4 runs out first, so a page box that really
         is A4 lands at 1.0 on one axis and a hair under on the other. Further than that is a raster
         that does not fill the sheet, and the border of plain paper is what the surveyor sees. */
      if (Math.abs(1 - fw) > Q.fillTol && Math.abs(1 - fh) > Q.fillTol)
        short.push(
          i + 1 + ' (' + (fw * 100).toFixed(1) + '%×' + (fh * 100).toFixed(1) + '% of the sheet)'
        );
    });
  });
  add(
    'blank pages',
    !blank.length,
    blank.length
      ? 'page ' + blank.join(', ') + ' has a content stream that draws nothing'
      : 'none; every page draws something'
  );
  add(
    'raster fills the sheet',
    !short.length,
    short.length
      ? 'page ' + short.join(', ') + ' is placed smaller than the paper it prints on'
      : 'every page raster covers its sheet'
  );
  if (unread.length)
    add(
      'streams readable',
      false,
      'page ' +
        unread.join(', ') +
        ' has no content stream this reader can open, so its geometry was not measured'
    );

  /* 5. The images the pages draw: their shape first, because a stretched page is the defect nobody
         notices until the report is on a desk, then their encoding. */
  const drawn = new Set();
  streams.forEach((cs) => {
    if (!cs) return;
    for (const m of cs.matchAll(/\/([\w.]+)\s+Do\b/g)) if (names[m[1]]) drawn.add(names[m[1]]);
  });
  const imgs = [...drawn].map((n) => ({
    n,
    w: +(/\/Width\s+(\d+)/.exec(objs[n]) || [])[1],
    h: +(/\/Height\s+(\d+)/.exec(objs[n]) || [])[1],
    f: (/\/Filter\s*\[?\s*\/(\w+)/.exec(objs[n]) || [])[1],
  }));
  const skew = imgs.filter(
    (im) => im.w && im.h && Math.abs(im.w / im.h / (P.w / P.h) - 1) > Q.aspectTol
  );
  add(
    'image proportions',
    !!imgs.length && !skew.length,
    imgs.length
      ? skew.length
        ? 'stretched: ' +
          skew
            .map(
              (im) =>
                'object ' +
                im.n +
                ' is ' +
                im.w +
                '×' +
                im.h +
                ' px for a ' +
                P.w +
                '×' +
                P.h +
                ' mm sheet'
            )
            .join(', ')
        : imgs.length +
          ' raster(s) drawn, ' +
          imgs[0].w +
          '×' +
          imgs[0].h +
          ' px on a ' +
          P.w +
          '×' +
          P.h +
          ' mm sheet'
      : 'no page draws an image'
  );
  /* What the design calls JPEG a PDF calls DCTDecode, and PNG it calls FlateDecode. A JPEG goes into
     the file as it came, which is the only reason a nine-page report is megabytes and not hundreds of
     them: measured, the same nine pages written as PNG came out at 289 MB against 3.3 MB. */
  const FILTER = { JPEG: 'DCTDecode', PNG: 'FlateDecode' },
    enc = (D.image || {}).encode || '',
    want_f = FILTER[enc.toUpperCase()],
    wrong = want_f ? imgs.filter((im) => im.f && im.f !== want_f) : [];
  add(
    'image encoding',
    !wrong.length,
    wrong.length
      ? 'saved as ' +
          [...new Set(wrong.map((im) => im.f))].join(', ') +
          ', the design asks ' +
          enc +
          ' (' +
          want_f +
          ')'
      : 'as designed (' + (enc || 'not set') + (want_f ? ', written as ' + want_f : '') + ')'
  );

  /* 6. What the file says about itself. The exporter stamps the design version and the claim into the
         document information dictionary, so a report can be traced back to the design that built it.
         The version in the message shown at export time is gone the moment the tab is. */
  const infoRef = (/\/Info\s+(\d+)/.exec(s) || [])[1],
    info = infoRef ? objs[+infoRef] || '' : '',
    field = (k) => {
      const m = new RegExp('/' + k + '\\s*\\((?:[^()\\\\]|\\\\.)*\\)').exec(info);
      return m ? m[0].replace(/^\/\w+\s*\(/, '').replace(/\)$/, '') : '';
    };
  add(
    'design version in the file',
    field('Subject').includes('v' + D.version),
    field('Subject') ||
      'the file carries no subject line, so nothing in it says which design built it'
  );
  add(
    'report identified in the file',
    !!field('Title') && !!field('Keywords'),
    (field('Title') || 'no title') + ' · ' + (field('Keywords') || 'no keywords')
  );

  /* 7. The one thing every page must carry that the bytes cannot prove on their own: a signature. Each
         page of this design is one raster, so the stamp drawn in the page box is inside that raster;
         what the file can say is that every page has a raster and none of them is empty. */
  add(
    'signature on every page',
    !!pageNums.length && !blank.length && !unread.length && imgs.length >= pageNums.length,
    pageNums.length + ' page(s), each drawn from the page box that carries the stamp footer'
  );

  return {
    bytes: s.length,
    pages: pageNums.length,
    images: imgs.length,
    ok: checks.every((c) => c.ok),
    checks,
  };
}
