/* The PDF a surveyor is handed, questioned without anybody opening the app.

   `node tests/pdf-qa.js <file.pdf …>` reads the files and asks what the brief asks of a finished
   report: is every sheet A4, does the page tree count the sheets the layout measured, is any page
   blank, does each page's raster actually cover the paper it is printed on, were the images saved the
   way the design says, and does the file itself say which design version built it.

   The checks are js/29-report-qa.js, which the exporter runs over its own bytes the moment it writes
   them - so the same rules are applied by the app and by this runner, and a report cannot pass here
   and fail there. That is the part that makes it automated rather than manual: nothing here needs a
   person, and nothing here needs a browser, because a finished PDF states all of this about itself.

   With no file named it reads samples/pdf/, where the sample reports of each report type and each
   module are kept. They are output, not source: the exporter writes them and they are not in git, so
   a design change is checked by exporting them again rather than by editing a file nobody made. */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SAMPLES = path.join(ROOT, 'samples', 'pdf');

/* The design is one literal in one file. Reading it here, rather than restating its numbers in a
   test, is the whole point of a central configuration - and it fails loudly if that file stops
   holding it. */
const DESIGN = (() => {
  const src = fs.readFileSync(path.join(ROOT, 'js/13-report-layout-helpers.js'), 'utf8');
  const m = /const PDF_DESIGN = (\{[\s\S]*?\n\});/.exec(src);
  if (!m) throw new Error('PDF_DESIGN was not found in js/13-report-layout-helpers.js');
  return new Function('return ' + m[1])();
})();

/* The same source the browser loads. It is plain functions over bytes, so it needs nothing from the
   page to run. */
const QA = new Function(
  'PDF_DESIGN',
  fs.readFileSync(path.join(ROOT, 'js/29-report-qa.js'), 'utf8') + '\nreturn pdfFileQA;'
)(DESIGN);

const results = [];
const record = (name, ok, detail) => results.push({ name, ok: !!ok, detail });

/* One file, every check of it named, so a failure says which sheet of which report. */
function qaFile(p) {
  const buf = fs.readFileSync(p);
  const r = QA(buf, null, DESIGN);
  r.checks.forEach((c) => record(path.basename(p) + ' — ' + c.name, c.ok, c.detail));
  return r;
}

(async () => {
  const need =
    'Put a sample here by exporting it from the app (Reports → Export selected → PDF), or name the files: node tests/pdf-qa.js <file.pdf …>';
  const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (files.length) {
    files.forEach((f) => qaFile(f));
  } else {
    if (!fs.existsSync(SAMPLES)) {
      console.error('no files named and no samples/pdf directory.\n' + need);
      process.exit(2);
    }
    const pdfs = fs.readdirSync(SAMPLES).filter((f) => f.endsWith('.pdf'));
    if (!pdfs.length) {
      console.error('samples/pdf holds no PDF.\n' + need);
      process.exit(2);
    }
    pdfs.forEach((f) => qaFile(path.join(SAMPLES, f)));
  }
  if (!results.length) record('a report to read', false, 'nothing was inspected');

  const bad = results.filter((r) => !r.ok);
  bad.forEach((r) => console.error('  FAIL  ' + r.name + '  ' + r.detail));
  console.log(
    JSON.stringify(
      {
        design: DESIGN.version,
        passed: results.length - bad.length,
        failed: bad.length,
        total: results.length,
        failures: bad,
      },
      null,
      1
    )
  );
  process.exit(bad.length ? 1 : 0);
})().catch((e) => {
  console.log(JSON.stringify({ fatal: String(e && e.message), stack: e && e.stack }));
  process.exit(1);
});
