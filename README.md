# Survey Desk

Web app for insurance claim surveyors (Nepal context): **motor** and **property** claims.
Plain HTML + CSS + JavaScript. **No build step, no framework, no server needed.**

## Features
- **Dashboard**: KPI cards, 11-stage settlement workflow, report deadline monitor (preliminary 15 days, final 60 days), action-required table, recent cases, role-based view (Admin / Principal Surveyor / Staff).
- **Case forms** driven by a schema: validation, cross-field checks, auto-fill of repeated data, green tick on filled fields, AD/BS scrolling date picker, AM/PM time, multi-select licence categories, "third party involved" switch.
- **Bills & expenses**: one Excel-style table per invoice (paste from Excel, Enter adds a row), claim vs assessed amounts, final calculation.
- **Property loss assessment (BOQ)**: quantity table, rate summary, net loss with salvage, excess and rounding.
- **Photos & annexes**: bulk upload, captions, cover photo, estimate pages, signature and stamp.
- **Reports**: Preliminary and Final. AI draft (optional) or data-based draft, editable text, save. Export **PDF**, **Word (.docx)**, **Markdown**. Cover page, contents, disclaimer, continuous body, annexes, 3 cm binding margin, LM Roman 10 font.

## Run it
Any static web server works (the app uses `localStorage` and `IndexedDB`, so open it over `http://`, not by double-clicking the file).

**VS Code**: install the *Live Server* extension, right-click `index.html` → *Open with Live Server*.
**Terminal**: `npm start` (uses `http-server`) or `python -m http.server 4173` then open http://localhost:4173

All data stays in your browser (see *Data storage*).

## Project layout
```
index.html                 page markup (sidebar, dialogs) + ordered <script> tags
css/styles.css             all styles (app UI + report/preview styles)
js/platform.js             download + AI shim when NOT inside claude.ai
js/ai-config.js            optional: connect "Generate with AI" to your own backend
js/01-core.js              DOM helper h(), esc(), storage, field-type constants, option lists
js/02-schema-motor.js      motor form schema (SECS) and module registry MODS
js/03-state-validation.js  case database, load/save, chk() field validation
js/04-rules-and-nav.js     cross-field rules X(), issues(), navigation, live validation paint()
js/05-form-fields.js       fld(): renders each field type; motor narrative/conclusion text
js/06-data-review.js       Data review screen + data-based report draft
js/07-photos.js            photos & annexes (IndexedDB)
js/08-case-actions.js      workflow stage list, new-case dialog, show dashboard
js/09-module-property.js   property module: schema, rules, narrative, registration in MODS
js/10-bills-final-report.js final calculation, AI prompt, report editor (genUI), auto-fill links
js/11-dashboard.js         settings, deadlines, KPIs, tracking panel, dashboard, auto-fill, delete case
js/12-date-picker-bs.js    AD/BS conversion (BS 2000-2090) + scrolling date picker
js/13-report-layout-helpers.js  disclaimer, report stylesheet (dcss), cover, annex blocks, preview
js/14-app-shell.js         render(), pager, custom fields, header and menu wiring
js/15-fonts-lmroman.js     embedded LM Roman 10 font (base64 WOFF)
js/16-export-docx-md.js    Word (docx lib) and Markdown builders, doExport()
js/17-report-paginate.js   docBuild(): paginated report used by preview and PDF
js/18-bills-ui.js          Excel-style bill tables, bills HTML, text-fitting helpers
js/19-property-assessment.js  BOQ calculator, three report tables, data-entry screen
js/99-main.js              starts the app
vendor/                    html2pdf.js and docx (local copies)
samples/                   sample cases: use "Import case" on the dashboard
tests/smoke_test.py        headless-browser test of the three export formats
```
**Scripts are classic scripts sharing one global scope.** Keep the `<script>` order in `index.html`.
A function declared in a *later* file is not visible to code that runs *at load time* in an earlier file
(that is why `MODS.motor` uses `X: () => X()` wrappers). Code that runs later (event handlers) can call anything.

## Key concepts
**Case record** (`DB[id]`, saved as JSON): `{ id, mod:'motor'|'property', st (workflow stage), asg (intimation date), due, pSub, fSub, owner, hist[], f:{ 'section_field': 'value' }, b:{ra,rb,a,b: [invoice…]}, pa (property assessment), rep:{prelim,final} , x (custom fields) }`.
Dates are stored as AD `YYYY-MM-DD`; BS is computed for display.

**Schema**: sections → groups → fields, built with `F(name, label, type, options)`; field key is `section_name`
(e.g. `case_claimNo`). Types: text, number, money, date, select, textarea, phone, time, calc, checkbox, multi-check.
`chk()` validates one field, `X()` runs cross-field rules, `issues()` combines them.

**Modules**: `MODS = { motor:{ SECS, FM, ALL, X, narr, concl, links… }, property:{…} }`. To add a module
(e.g. engineering/marine): write its schema like `PS` in `09-module-property.js`, call `norm()`, register it in
`MODS`, add it to the *New case* dialog in `index.html`, and add `links` for auto-fill.

**Auto-fill**: `MOD.links = [[target, source…]]`; a target is filled only if empty or still holding its previous auto value.

**Reports**: text is edited in `genUI()` (stored in `case.rep`). Export: `doExport()` → PDF (`docBuild()` paginates, each page is
rendered with html2canvas), Word (`docxBuild()` with the `docx` library), Markdown (`mdBuild()`).
Property loss-assessment tables are appended by `secBody()` at export time.

**Data storage** (browser only): `localStorage` keys `sp.db` (all cases), `sp.cur`, `sp.cfg` (settings, roles, deadlines, disclaimer);
`IndexedDB` database `sp-photos` (photos, signature, stamp). Use *Export / import this case* to back up (photos are not included in the JSON).
Clearing browser data deletes everything.

## Optional: AI report drafting
`window.claude` does not exist outside claude.ai, so AI drafting is off by default; everything else works.
To enable it, run your own backend that calls the Anthropic API (keep the API key on the server) and set
`window.SURVEY_AI_ENDPOINT` in `js/ai-config.js`. The contract is documented in that file.

## Tests
`pip install playwright && playwright install chromium`, then `python tests/smoke_test.py` — creates a motor and a property
case, exports PDF/DOCX/MD and checks the files.

## Known limitations
- Roles (Admin / Principal Surveyor / Staff) only change what is shown on this device. Real access control needs a login and a backend.
- No multi-user sync; data lives in one browser.
- Word contents page: page numbers fill in when Word updates the field (answer *Yes* when Word asks).
- LM Roman 10 is embedded for the PDF; in Word the font name is set, but it only displays if installed on that PC.
- BS conversion covers BS 2000–2090.
