/* xUI (custom fields), pager, render(), header, menu and dialog event wiring
   Loaded as a classic script: everything here shares the global scope. Order of <script> tags in index.html matters. */

function xUI(s) {
  const L = ((Dd.x = Dd.x || {})[s.k] = Dd.x[s.k] || []),
    tb = h('div');
  const draw = () => {
    tb.replaceChildren(
      ...L.map((r, i) => {
        const a = h('input', { placeholder: 'Field name', maxlength: '80' }),
          b = h('input', { placeholder: 'Value', maxlength: '500' });
        a.value = r.l;
        b.value = r.v;
        a.oninput = () => {
          r.l = a.value;
          sv();
        };
        b.oninput = () => {
          r.v = b.value;
          sv();
        };
        a.onblur = b.onblur = () => sv(1);
        return h(
          'div',
          { class: 'bar' },
          a,
          b,
          h(
            'button',
            {
              class: 'b',
              type: 'button',
              title: 'Remove',
              onclick: () => {
                L.splice(i, 1);
                draw();
                sv(1);
              },
            },
            '✕'
          )
        );
      })
    );
  };
  draw();
  return h(
    'section',
    { class: 'card' },
    h('h3', {}, 'Additional fields (this survey only)'),
    h(
      'p',
      { class: 'mu' },
      'Record anything this claim needs that the standard form lacks. It appears in the report.'
    ),
    tb,
    h(
      'button',
      {
        class: 'b',
        type: 'button',
        onclick: () => {
          L.push({ l: '', v: '' });
          draw();
        },
      },
      '+ Add field'
    )
  );
}

function pager() {
  const i = NAV.findIndex((x) => x.k === sec);
  return h(
    'div',
    { class: 'bar pager' },
    i > 0
      ? h(
          'button',
          {
            class: 'b',
            onclick: () => {
              sec = NAV[i - 1].k;
              render();
            },
          },
          '← ' + NAV[i - 1].t
        )
      : h('span'),
    i < NAV.length - 1
      ? h(
          'button',
          {
            class: 'b p',
            onclick: () => {
              sec = NAV[i + 1].k;
              render();
            },
          },
          NAV[i + 1].t + ' →'
        )
      : h('span')
  );
}

function render() {
  const m = $('#main'),
    s = NAV.find((x) => x.k === sec);
  autofill();
  m.replaceChildren(
    h(
      'div',
      { class: 'crumb' },
      h(
        'a',
        {
          href: '#',
          onclick: (e) => {
            e.preventDefault();
            showDash();
          },
        },
        'Dashboard'
      ),
      ' › ' + (g('case_claimNo') || 'Untitled case') + ' · ' + (MOD.name || '')
    ),
    h('h2', {}, s.t),
    sec === 'case' ? trackUI(Dd) : '',
    MOD.links && s.F && MOD.links.some((l) => l[0].startsWith(s.k + '_'))
      ? h(
          'div',
          { class: 'bar' },
          h(
            'small',
            { class: 'mu' },
            'Fields marked ↺ were filled from earlier entries – edit them freely.'
          ),
          h(
            'button',
            {
              class: 'b',
              type: 'button',
              onclick: () => {
                MOD.links.forEach((l) => {
                  const t = l[0];
                  if (t.startsWith(s.k + '_')) {
                    delete Dd.man[t];
                    Dd.auto[t] = Dd.f[t] || '';
                  }
                });
                autofill();
                render();
              },
            },
            '↺ Re-apply auto-fill (overwrites)'
          )
        )
      : ''
  );
  if (sec === 'pla') plaUI(m);
  else if (sec === 'prelim' || sec === 'final') genUI(m, sec);
  else if (sec === 'photos') photosUI(m);
  else if (sec === 'bills') billsUI(m);
  else if (sec === 'report') reportUI(m);
  else
    s.g.forEach((x) => {
      const gr = h('div', { class: 'grid' });
      x.f.filter((y) => !hid(y)).forEach((y) => gr.append(fld(y)));
      if (gr.children.length)
        m.append(
          h(
            'section',
            { class: 'card' },
            h('h3', {}, x.t),
            gr,
            x.note ? h('p', { class: 'mu' }, x.note) : ''
          )
        );
    });
  if (s.g) m.append(xUI(s));
  m.append(pager());
  paint();
  window.scrollTo(0, 0);
}

function hdr() {
  const s = $('#cs');
  s.replaceChildren(
    ...Object.values(DB).map((c) =>
      h(
        'option',
        { value: c.id },
        (c.f.case_claimNo || 'Untitled case') + ' · ' + (c.f.case_insReg || '—')
      )
    )
  );
  s.value = cur;
}

$('#cs').onchange = (e) => {
  load(e.target.value);
  sv();
  render();
};

$('#nw').onclick = () => {
  openNew();
  closeSideMenu();
};

$('#db').onclick = () => {
  FL.k = '';
  FL.s = '';
  FL.q = '';
  showDash();
  setMenu('db');
  closeSideMenu();
};

$('#mc').onclick = () => {
  showAllCases();
  setMenu('mc');
  closeSideMenu();
};

$('#profile-btn').onclick = () => {
  if (typeof showProfilePage === 'function') {
    showProfilePage('profile');
    setMenu('profile-btn');
  }
  closeSideMenu();
};

$('#account-btn').onclick = () => {
  if (typeof showProfilePage === 'function') {
    showProfilePage('account');
    setMenu('account-btn');
  }
  closeSideMenu();
};

$('#security-btn').onclick = () => {
  if (typeof showProfilePage === 'function') {
    showProfilePage('security');
    setMenu('security-btn');
  }
  closeSideMenu();
};

$('#activity-btn').onclick = () => {
  if (typeof showProfilePage === 'function') {
    showProfilePage('activity');
    setMenu('activity-btn');
  }
  closeSideMenu();
};

$('#user-admin-btn').onclick = () => {
  if (typeof showProfilePage === 'function') {
    showProfilePage('admin-users');
    setMenu('user-admin-btn');
  }
  closeSideMenu();
};

$('#audit-btn').onclick = () => {
  if (typeof showProfilePage === 'function') {
    showProfilePage('admin-audit');
    setMenu('audit-btn');
  }
  closeSideMenu();
};

$('#ms').onclick = () => {
  showDash();
  setMenu('ms');
  closeSideMenu();
  setTimeout(() => {
    const d = document.querySelector('#dash details');
    if (d) {
      d.open = true;
      d.scrollIntoView({ behavior: 'smooth' });
    }
  }, 150);
};

$('#mi').onclick = () => {
  impOpen();
  closeSideMenu();
};

function setSideMenuOpen(open) {
  const side = $('#side');
  const backdrop = document.getElementById('menu-backdrop');
  if (!side) return;
  side.classList.toggle('open', !!open);
  if (backdrop) {
    backdrop.hidden = !open;
    backdrop.setAttribute('aria-hidden', String(!open));
  }
}

function closeSideMenu() {
  setSideMenuOpen(false);
}

$('#hb').onclick = (e) => {
  e.stopPropagation();
  const side = $('#side');
  if (!side) return;
  setSideMenuOpen(!side.classList.contains('open'));
};

document.getElementById('menu-backdrop')?.addEventListener('click', closeSideMenu);
document.addEventListener('click', (event) => {
  const side = $('#side');
  const hb = $('#hb');
  if (!side || !side.classList.contains('open')) return;
  const insideMenu = side.contains(event.target);
  const insideToggle = hb && hb.contains(event.target);
  if (!insideMenu && !insideToggle) closeSideMenu();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeSideMenu();
});

let dc = 0;

$('#del').onclick = (e) => {
  const b = e.target;
  if (!dc) {
    dc = 1;
    b.textContent = 'Confirm delete?';
    setTimeout(() => {
      dc = 0;
      b.textContent = 'Delete';
    }, 3000);
    return;
  }
  delete DB[cur];
  PH.forEach((p) => del(p.id).catch(() => 0));
  dc = 0;
  b.textContent = 'Delete';
  cur = null;
  sv(1);
  showDash();
};

$('#dx').onclick = () => {
  $('#dt').value = JSON.stringify({ v: 2, module: Dd.mod || 'motor', case: Dd }, null, 1);
  $('#dm').textContent = '';
  $('#dlg').showModal();
};

$('#dq').onclick = () => $('#dlg').close();

$('#dc').onclick = async () => {
  try {
    await navigator.clipboard.writeText($('#dt').value);
    $('#dc').textContent = 'Copied ✓';
  } catch {
    $('#dt').select();
  }
};

$('#di').onclick = () => {
  try {
    const o = JSON.parse($('#dt').value),
      c = o.case || o;
    if (!c || typeof c.f !== 'object') throw 0;
    const mi = o.module || c.mod,
      n = blank(MODS[mi] ? mi : 'motor');
    Object.keys(n.mod === 'property' ? MODS.property.FM : MODS.motor.FM).forEach((k) => {
      if (typeof c.f[k] === 'string') n.f[k] = c.f[k].slice(0, 3000);
    });
    ['a', 'b', 'ra', 'rb'].forEach((q) => {
      const rows = Array.isArray(c.b && c.b[q])
        ? c.b[q].slice(0, 200).map((r) =>
            r.rows
              ? {
                  no: String(r.no ?? '').slice(0, 60),
                  date: String(r.date ?? '').slice(0, 10),
                  vendor: String(r.vendor ?? '').slice(0, 120),
                  rows: (Array.isArray(r.rows) ? r.rows : []).slice(0, 300).map((x) => ({
                    d: String(x.d ?? '').slice(0, 160),
                    qty: String(x.qty ?? '').slice(0, 20),
                    rate: String(x.rate ?? '').slice(0, 20),
                    amt: String(x.amt ?? '').slice(0, 20),
                    as: String(x.as ?? '').slice(0, 20),
                    rm: String(x.rm ?? '').slice(0, 160),
                  })),
                }
              : {
                  no: String(r.no ?? '').slice(0, 60),
                  d: String(r.d ?? '').slice(0, 120),
                  amt: String(r.amt ?? '').slice(0, 20),
                  as: String(r.as ?? '').slice(0, 20),
                }
          )
        : [];
      if (rows.length) n.b[q] = rows;
    });
    if (c.x && typeof c.x === 'object')
      Object.keys(c.x)
        .slice(0, 30)
        .forEach((k) => {
          if (Array.isArray(c.x[k]))
            n.x[k] = c.x[k].slice(0, 50).map((r) => ({
              l: String(r.l ?? '').slice(0, 80),
              v: String(r.v ?? '').slice(0, 500),
            }));
        });
    const mid = o.module || c.mod;
    if (STG.includes(c.st) || OLDMAP[c.st]) n.st = STG.includes(c.st) ? c.st : OLDMAP[c.st];
    n.pSub = String(c.pSub || '').slice(0, 10);
    n.fSub = String(c.fSub || '').slice(0, 10);
    n.owner = String(c.owner || n.owner).slice(0, 60);
    n.due = String(c.due || '').slice(0, 10);
    n.asg = String(c.asg || n.asg).slice(0, 10);
    n.note = String(c.note || '').slice(0, 200);
    n.mod = MODS[mid] ? mid : 'motor';
    DB[n.id] = n;
    load(n.id);
    $('#dlg').close();
    openCase(n.id);
  } catch {
    $('#dm').textContent = 'Could not read that data – paste a complete JSON export.';
  }
};
