/* AD/BS calendar conversion and the scrolling date picker
   Loaded as a classic script: everything here shares the global scope. Order of <script> tags in index.html matters. */

const BSD =
    '243432221213334333212122334432212122343432221123243432221213334333212122334432212122343432221123333433122113334333212122334432212122343432221123333433122122334333212122334432212122343432221123333433122122334333212122343432212122343432221213333433212122334333212122343432221122343432221213333433212122334333212122343432221123243432221213334333212122334342212122343432221123243432221213334333212122334432212122343432221123243433122113334333212122334432212122343432221123333433122113334333212122334432212122343432221123333433122122334333212122343432212122343432221123333433212122334333212122343432221122343432221213333433212122334333212122343432221122343432221213334333212122334342212122343432221123243432221213334333212122334432212122343432221123243433121213334333212122334432212122343432221123333433122113334333212122334432212122343432221123333433122122334333212122343432212122343432221123333433212122334333212122343432221122343432221213333433212122334333212122343432221122343432221213334333212122334333212122343432221123243432221213334333212122334333221222234423221222243432221222243432221222',
  BSMN = [
    'Baisakh',
    'Jestha',
    'Ashadh',
    'Shrawan',
    'Bhadra',
    'Ashwin',
    'Kartik',
    'Mangsir',
    'Poush',
    'Magh',
    'Falgun',
    'Chaitra',
  ],
  ADMN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  BREF = Date.UTC(1943, 3, 14) / 864e5,
  p2 = (n) => String(n).padStart(2, '0');

const bsLen = (y, m) => 28 + +BSD[(y - 2000) * 12 + m - 1],
  bsYL = (y) => {
    let s = 0;
    for (let m = 1; m <= 12; m++) s += bsLen(y, m);
    return s;
  };

function ad2bs(iso) {
  let n = Math.floor(Date.parse(iso) / 864e5) - BREF;
  if (!(n >= 0)) return null;
  let y = 2000;
  for (;;) {
    if (y > 2090) return null;
    const L = bsYL(y);
    if (n < L) break;
    n -= L;
    y++;
  }
  let m = 1;
  while (n >= bsLen(y, m)) {
    n -= bsLen(y, m);
    m++;
  }
  return [y, m, n + 1];
}

function bs2ad(y, m, d) {
  let n = 0;
  for (let i = 2000; i < y; i++) n += bsYL(i);
  for (let i = 1; i < m; i++) n += bsLen(y, i);
  return new Date((BREF + n + d - 1) * 864e5).toISOString().slice(0, 10);
}

function bsStr(iso) {
  const r = ad2bs(iso);
  return r ? `${r[0]}-${p2(r[1])}-${p2(r[2])} (${BSMN[r[1] - 1]})` : 'out of BS range';
}

let DP = null;

const dpMax = () => (DP.mode === 'AD' ? new Date(DP.y, DP.m, 0).getDate() : bsLen(DP.y, DP.m)),
  dpISO = () => {
    const d = Math.min(DP.d, dpMax());
    return DP.mode === 'AD' ? `${DP.y}-${p2(DP.m)}-${p2(d)}` : bs2ad(DP.y, DP.m, d);
  };

function dpSet(iso) {
  if (DP.mode === 'AD') {
    const a = iso.split('-').map(Number);
    DP.y = a[0];
    DP.m = a[1];
    DP.d = a[2];
  } else {
    const r = ad2bs(iso) || ad2bs(today());
    DP.y = r[0];
    DP.m = r[1];
    DP.d = r[2];
  }
}

function wheel(el, items, sel, pick) {
  el.replaceChildren(
    ...items.map(([v, l], j) => {
      const x = h('div', {}, l);
      if (v === sel) x.classList.add('sel');
      x.onclick = () => el.scrollTo({ top: j * 36, behavior: 'smooth' });
      return x;
    })
  );
  el.scrollTop =
    Math.max(
      0,
      items.findIndex((i) => i[0] === sel)
    ) * 36;
  let t;
  el.onscroll = () => {
    clearTimeout(t);
    t = setTimeout(() => {
      const i = Math.max(0, Math.min(items.length - 1, Math.round(el.scrollTop / 36)));
      [...el.children].forEach((c, j) => c.classList.toggle('sel', j === i));
      pick(items[i][0]);
    }, 90);
  };
}

function dpDay() {
  const mx = dpMax();
  DP.d = Math.min(DP.d, mx);
  wheel(
    $('#wd'),
    Array.from({ length: mx }, (_, i) => [i + 1, String(i + 1)]),
    DP.d,
    (v) => {
      DP.d = v;
      dpPv();
    }
  );
}

function dpPv() {
  const iso = dpISO();
  $('#dpv').innerHTML = `<b>AD:</b> ${iso} &nbsp; <b>BS:</b> ${bsStr(iso)}`;
}

function dpBuild() {
  const AD = DP.mode === 'AD',
    y0 = AD ? 1990 : 2047,
    y1 = AD ? 2033 : 2089,
    ys = [];
  for (let y = y0; y <= y1; y++) ys.push([y, String(y)]);
  DP.y = Math.min(y1, Math.max(y0, DP.y));
  wheel($('#wy'), ys, DP.y, (v) => {
    if (v !== DP.y) {
      DP.y = v;
      dpDay();
      dpPv();
    }
  });
  wheel(
    $('#wm'),
    (AD ? ADMN : BSMN).map((n, i) => [i + 1, p2(i + 1) + ' · ' + n]),
    DP.m,
    (v) => {
      if (v !== DP.m) {
        DP.m = v;
        dpDay();
        dpPv();
      }
    }
  );
  dpDay();
  dpPv();
  $('#dpa').classList.toggle('on', AD);
  $('#dpb').classList.toggle('on', !AD);
}

function openDP(inp) {
  DP = { inp, mode: 'AD', y: 2026, m: 1, d: 1 };
  const v = inp.value,
    okd = v && v.length === 10 && !isNaN(Date.parse(v));
  dpSet(okd ? v : today());
  $('#dp').showModal();
  dpBuild();
}

function dpMode(m) {
  if (DP.mode === m) return;
  const iso = dpISO();
  DP.mode = m;
  dpSet(iso);
  dpBuild();
}

$('#dpa').onclick = () => dpMode('AD');

$('#dpb').onclick = () => dpMode('BS');

$('#dpt').onclick = () => {
  dpSet(today());
  dpBuild();
};

$('#dpx').onclick = () => $('#dp').close();

const dpApply = (v) => {
  DP.inp.value = v;
  DP.inp.dispatchEvent(new Event('change', { bubbles: true }));
  if (DP.inp.id) TCH.add(DP.inp.id.slice(2));
  $('#dp').close();
};

$('#dps').onclick = () => dpApply(dpISO());

$('#dpc').onclick = () => dpApply('');
