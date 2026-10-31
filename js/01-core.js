/* Core helpers (DOM helper h(), esc, storage), field-type constants, option lists
   Loaded as a classic script: everything here shares the global scope. Order of <script> tags in index.html matters. */

const $ = (s) => document.querySelector(s);

const h = (t, a = {}, ...c) => {
  const e = document.createElement(t);
  for (const k in a) {
    k === 'class'
      ? (e.className = a[k])
      : k.startsWith('on')
        ? (e[k] = a[k])
        : e.setAttribute(k, a[k]);
  }
  c.flat().forEach((x) => e.append(x && x.nodeType ? x : document.createTextNode(x ?? '')));
  return e;
};

const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
  );

const mem = {},
  ST = {
    g(k) {
      try {
        return localStorage.getItem(k);
      } catch {
        return mem[k] ?? null;
      }
    },
    s(k, v) {
      try {
        localStorage.setItem(k, v);
        return true;
      } catch {
        mem[k] = v;
        return false;
      }
    },
  };

const T = 't',
  N = 'n',
  M = 'm',
  D_ = 'd',
  S = 's',
  A = 'a',
  P = 'p',
  H = 'h',
  C = 'c',
  IT = {
    t: 'text',
    n: 'number',
    m: 'number',
    d: 'text',
    p: 'tel',
    h: 'hidden',
    c: 'text',
    k: 'checkbox',
  };

const F = (n, l, t = T, o = {}) => ({ n, l, t, ...o });

const YN = ['Yes', 'No'],
  YNP = ['Yes', 'No', 'Pending'],
  VER = ['Verified', 'Pending', 'Not verified', 'Not applicable'];

const VT = [
  'Motorcycle',
  'Scooter',
  'Car',
  'Jeep / SUV',
  'Van / Microbus',
  'Bus / Minibus',
  'Truck',
  'Container',
  'Tipper',
  'Tractor',
  'Three-wheeler',
  'Other',
];

const RC = ['Running – satisfactory', 'Running but not satisfactory', 'Not running / towed'],
  LC = ['A', 'B', 'C', 'C1', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'Other'];

const SEV = ['Minor', 'Moderate', 'Severe', 'Total loss'],
  OWN = ['Individual', 'Company', 'Financial institution', 'Government', 'Other'];

const MD = ['No', 'Yes', 'Yes – further inspection required'],
  MOV = ['Straight', 'Overtaking', 'Turning', 'Reversing', 'Stationary', 'Parking', 'Other'];

const NAME = { rx: /^[A-Za-z][A-Za-z .'’-]+$/, e: 'Letters only' },
  REG = {
    rx: /^(?=.*[A-Za-z])(?=.*\d).{6,}$/,
    e: 'Enter the full registration no. (letters + digits)',
  },
  ENG = { rx: /^[A-Za-z0-9\- ]{6,25}$/, e: '6–25 letters/digits' };

const NO = {},
  DL = { rx: /^[\d\-\/ ]{6,20}$/, e: 'Digits, dashes or slashes (6–20 chars)' };

const CT = [
  'Own damage – accident',
  'Own damage + third-party damage',
  'Third-party liability',
  'Theft / total loss',
  'Fire / explosion',
  'Natural calamity (flood, landslide)',
  'Glass / partial damage',
  'Other',
];

const YR = { min: 1980, max: new Date().getFullYear() + 1, int: 1 };

const nm = (n, l, o = {}) => F(n, l, T, { ...NAME, ...o }),
  sel = (n, l, o, x = {}) => F(n, l, S, { o, ...x });

const mv = (q) => [
  F('dir' + q, 'Direction of travel'),
  F('lane' + q, 'Lane / road position'),
  sel('mv' + q, 'Movement before accident', MOV),
  F('spd' + q, 'Approx. speed (km/h)', T, { h: 'e.g. 30–40' }),
  F('imp' + q, 'Point of impact'),
  F('aft' + q, 'Movement / damage after impact', A),
];
