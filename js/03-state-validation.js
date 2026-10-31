/* Case database (DB), blank case, load/save, formatting helpers, field validation chk()
   Loaded as a classic script: everything here shares the global scope. Order of <script> tags in index.html matters. */

let DB = {},
  cur,
  Dd,
  sec = 'case',
  SHOW = false,
  TCH = new Set();

try {
  DB = JSON.parse(ST.g('sp.db') || '{}');
} catch {
  DB = {};
}

const blank = (mod = 'motor') => ({
  id: 'c' + Date.now().toString(36),
  mod,
  cr: Date.now(),
  u: Date.now(),
  owner: cfg.me,
  st: 'Intimation',
  asg: today(),
  due: '',
  note: '',
  pSub: '',
  fSub: '',
  hist: [{ s: 'Intimation', t: Date.now() }],
  x: {},
  f: {},
  b: { a: [{ no: '', amt: '' }], b: [{ no: '', amt: '' }] },
});

function load(id) {
  cur = DB[id] ? id : Object.keys(DB)[0];
  if (!cur) {
    const c = blank();
    DB[c.id] = c;
    cur = c.id;
  }
  Dd = DB[cur];
  Dd.b = Dd.b || { a: [], b: [] };
  Dd.x = Dd.x || {};
  Dd.rep = Dd.rep || {};
  MOD = MODS[Dd.mod] || MODS.motor;
  SECS = MOD.SECS;
  FM = MOD.FM;
  ALL = MOD.ALL;
  syncNav();
  recalc();
  PH = [];
  loadPH().then(() => paint());
  TCH = new Set();
  SHOW = false;
}

const g = (k) => (Dd.f[k] || '').trim(),
  nz = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, ''),
  dt = (v) => new Date(v + 'T00:00:00');

const dtf = (v) =>
  v ? dt(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

const money = (n) => 'NPR ' + (Number(n) || 0).toLocaleString('en-IN'),
  Lw = (s) => (s || '').toLowerCase();

let st;

function sv(now) {
  if (Dd && Dd === DB[cur]) Dd.u = Date.now();
  clearTimeout(st);
  $('#sv').textContent = 'Unsaved changes…';
  const fn = () => {
    const ok = ST.s('sp.db', JSON.stringify(DB));
    ST.s('sp.cur', cur);
    $('#sv').textContent = ok
      ? '✓ Saved ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : 'Storage blocked – export your data';
  };
  now ? fn() : (st = setTimeout(fn, 4000));
}

addEventListener('pagehide', () => sv(1));

document.addEventListener('visibilitychange', () => {
  if (document.hidden) sv(1);
});

function recalc() {
  SECS.forEach((s) =>
    s.F.forEach((f) => {
      if (f.t === C) {
        const v = f.sum.reduce(
          (a, n) => a + (hid(FM[s.k + '_' + n] || {}) ? 0 : Number(Dd.f[s.k + '_' + n]) || 0),
          0
        );
        Dd.f[f.k] = String(v);
        const e = document.getElementById('f_' + f.k);
        if (e) e.value = v;
      }
    })
  );
}

const SKIP = /^(pending|na|n\/a|none|nil)$/i;

function chk(f, v) {
  v = (v || '').trim();
  if (f.t === C) return '';
  if (!v) return f.r ? 'Required' : '';
  if (f.t === D_) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(dt(v))) return 'Enter a valid date';
    const y = +v.slice(0, 4);
    return y < 1990 || y > 2100 ? 'Year looks wrong' : '';
  }
  if (f.t === N || f.t === M) {
    const n = Number(v);
    if (!isFinite(n)) return 'Numbers only';
    if (f.min != null && n < f.min) return 'Minimum ' + f.min;
    if (f.max != null && n > f.max) return 'Maximum ' + f.max;
    if (f.t === M && n < 0) return 'Cannot be negative';
    if (f.int && !Number.isInteger(n)) return 'Whole number only';
    return '';
  }
  if (f.t === S) return f.o.includes(v) ? '' : 'Choose a listed option';
  if (f.t === A) return v.length > 3000 ? 'Too long (3000 max)' : '';
  if (SKIP.test(v) && !f.r) return '';
  if (f.t === P && !/^(9[6-8]\d{8}|0\d{1,2}-?\d{6,7})$/.test(v.replace(/\s/g, '')))
    return 'Use a 10-digit mobile (96/97/98…) or landline with area code';
  if (f.rx && !f.rx.test(v)) return f.e || 'Invalid format';
  return v.length > 150 ? 'Too long' : '';
}
