"""Smoke test: loads the app in headless Chromium, creates a motor case and a property case with
photos, runs the Word / PDF / Markdown exports and checks that real files are produced.

Requirements:  pip install playwright && playwright install chromium
Run from the project root:  python tests/smoke_test.py
"""
import http.server, json, os, socketserver, sys, threading
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 5199


def serve():
    os.chdir(ROOT)
    handler = lambda *a, **k: http.server.SimpleHTTPRequestHandler(*a, directory=ROOT, **k)
    socketserver.TCPServer.allow_reuse_address = True
    srv = socketserver.TCPServer(('127.0.0.1', PORT), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


BODY = ('<h1>T</h1><h2>1. Reference</h2><p>' + 'Test paragraph. ' * 40 + '</p>'
        '<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>'
        '<h2>2. Conclusion</h2><p>Done.</p>')

SEED = """async (sample) => {
  const mk = (w, h, col, t) => { const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d'); x.fillStyle = col; x.fillRect(0, 0, w, h); x.fillStyle = '#fff';
    x.font = 'bold 60px sans-serif'; x.fillText(t, 40, h / 2); return c.toDataURL('image/jpeg', .8); };
  const cs = blank(sample.mod); Object.assign(cs.f, sample.case.f);
  if (sample.case.pa) cs.pa = sample.case.pa; if (sample.case.b) cs.b = sample.case.b;
  DB[cs.id] = cs; openCase(cs.id); await new Promise(r => setTimeout(r, 300));
  const ph = [['cov','Cover','#2255aa'],['est','Estimate p1','#aa5522'],['acc','Scene 1','#228855'],['iv','Front','#555599']];
  for (let i = 0; i < ph.length; i++) await put({ id: sample.mod + i, cid: cs.id, cat: ph[i][0], cap: ph[i][1], img: mk(1200, 900, ph[i][2], ph[i][1]), t: Date.now() + i });
  await loadPH();
  return cs.id;
}"""

EXPORT = """async ([kind, body]) => {
  const msg = document.createElement('p');
  await doExport(kind, { innerHTML: body }, { d: true, p: true, m: true, a: true }, msg);
  return msg.textContent;
}"""


def main():
    srv = serve(); ok = True
    samples = {'motor': 'samples/test-case-valid.json', 'property': 'samples/test-case-property-assessment.json'}
    with sync_playwright() as p:
        b = p.chromium.launch(); ctx = b.new_context(accept_downloads=True)
        pg = ctx.new_page(); errors = []; files = []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.on('download', lambda d: files.append(d))
        pg.goto(f'http://127.0.0.1:{PORT}/index.html'); pg.wait_for_timeout(500)
        for mod, path in samples.items():
            sample = json.load(open(os.path.join(ROOT, path))); sample['mod'] = mod
            pg.evaluate(SEED, sample)
            n0 = len(files)
            msg = pg.evaluate(EXPORT, ['final', BODY]); pg.wait_for_timeout(800)
            got = files[n0:]
            print(f'[{mod}] {msg}')
            for d in got:
                path_ = d.path(); size = os.path.getsize(path_); head = open(path_, 'rb').read(4)
                good = size > 2000 and ((d.suggested_filename.endswith('.pdf') and head == b'%PDF') or
                                        (d.suggested_filename.endswith('.docx') and head[:2] == b'PK') or
                                        d.suggested_filename.endswith('.md'))
                ok &= good
                print(f'   {d.suggested_filename:55s} {size:>9,} bytes  {"OK" if good else "FAIL"}')
            ok &= len(got) == 3
        b.close()
    srv.shutdown()
    if errors: ok = False; print('PAGE ERRORS:', errors)
    print('RESULT:', 'PASS' if ok else 'FAIL'); sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
