/* fld(): renders every field type; accident narrative and conclusion drafting for motor
   Loaded as a classic script: everything here shares the global scope. Order of <script> tags in index.html matters. */

function fld(f) {
  let i;
  const k = f.k;
  if (f.t === 'mc') i = h('input', { type: 'hidden' });
  else if (f.t === S)
    i = h(
      'select',
      {},
      h('option', { value: '' }, 'Select…'),
      ...f.o.map((o) => h('option', { value: o }, o))
    );
  else if (f.t === A) i = h('textarea', { rows: f.rows || 3 });
  else {
    i = h('input', { type: IT[f.t] });
    if (f.t === N || f.t === M) {
      i.step = 'any';
      i.inputMode = 'decimal';
      if (f.min != null) i.min = f.min;
    }
    if (f.t === C) i.readOnly = true;
    if (f.t === P) i.placeholder = '98XXXXXXXX';
    if (f.t === LST) {
      /* A datalist, not a select: the free-text value an older case already saved stays valid
         and editable, while the master list appears as suggestions as you type. */
      i.setAttribute('list', 'dl_' + k);
      i.setAttribute('autocomplete', 'off');
      i.placeholder = 'Type, or pick from the list';
    }
    if (f.t === D_) {
      i.readOnly = true;
      i.placeholder = 'Pick date (AD / BS)';
      i.style.cursor = 'pointer';
      i.onclick = () => openDP(i);
    }
  }
  i.id = 'f_' + k;
  if (f.t === 'k') i.checked = Dd.f[k] === 'Yes';
  else i.value = Dd.f[k] || '';
  if (f.t !== C) {
    i.oninput = i.onchange = () => {
      Dd.f[k] = i.type === 'checkbox' ? (i.checked ? 'Yes' : '') : i.value;
      (Dd.man = Dd.man || {})[k] = Dd.auto && Dd.auto[k] === Dd.f[k] ? 0 : 1;
      const nAf = autofill();
      if (nAf) toast(nAf + ' related field' + (nAf > 1 ? 's' : '') + ' updated automatically');
      recalc();
      if (k === 'case_hasTP') syncNav();
      paint();
      sv(i.tagName === 'SELECT' || i.type === 'checkbox');
      if (k === 'case_claimNo') hdr();
      /* What the third party consists of decides which questions below apply, so the page has to be
         built again rather than only re-checked. */
      if (k === 'tp_kind') render();
    };
    i.onblur = () => {
      TCH.add(k);
      paint();
      sv(1);
    };
  }
  const w = h(
    'div',
    { class: 'fld' + (f.t === A ? ' wide' : '') },
    h('label', { for: i.id }, f.l, f.r ? h('b', { class: 'rq' }, ' *') : ''),
    i,
    f.t === LST
      ? h(
          'datalist',
          { id: 'dl_' + k },
          ...(typeof f.o === 'function' ? f.o() : f.o || []).map((o) => h('option', { value: o }))
        )
      : '',
    h('small', { id: 'e_' + k }),
    h('small', { class: 'mu', id: 'au_' + k }),
    f.t === D_ ? h('small', { class: 'mu', id: 'bs_' + k }) : '',
    f.h ? h('small', { class: 'mu' }, f.h) : ''
  );
  if (f.gen)
    w.append(
      h(
        'button',
        {
          class: 'b',
          type: 'button',
          onclick: () => {
            i.value = f.gen === 'n' ? MOD.narr() : MOD.concl();
            Dd.f[k] = i.value;
            TCH.add(k);
            paint();
            sv();
          },
        },
        'Auto-draft from entered data (replaces text)'
      )
    );
  if (f.t === 'mc') {
    const vals = () => (i.value ? i.value.split(', ') : []),
      grp = h(
        'div',
        { class: 'mcg' },
        ...f.o.map((o) => {
          const c = h('input', { type: 'checkbox' });
          c.checked = vals().includes(o);
          c.onchange = () => {
            const s = new Set(vals());
            c.checked ? s.add(o) : s.delete(o);
            i.value = f.o.filter((x) => s.has(x)).join(', ');
            i.dispatchEvent(new Event('change', { bubbles: true }));
          };
          return h('label', { class: 'mc' }, c, ' ' + o);
        })
      );
    w.insertBefore(grp, i);
  }
  if (f.t === H) {
    const tv = (i.value || '').split(':'),
      h24 = tv[0] === '' ? null : +tv[0],
      hs = h(
        'select',
        {},
        h('option', { value: '' }, 'hh'),
        ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => h('option', { value: n }, p2(n)))
      ),
      ms = h(
        'select',
        {},
        h('option', { value: '' }, 'mm'),
        ...Array.from({ length: 60 }, (_, n) => h('option', { value: p2(n) }, p2(n)))
      ),
      ap = h(
        'select',
        {},
        h('option', { value: '' }, 'AM / PM'),
        h('option', { value: 'AM' }, 'AM'),
        h('option', { value: 'PM' }, 'PM')
      );
    if (h24 !== null && !isNaN(h24)) {
      hs.value = String(h24 % 12 || 12);
      ap.value = h24 >= 12 ? 'PM' : 'AM';
      ms.value = tv[1] || '';
    }
    const up = () => {
      if (hs.value && ms.value && ap.value) {
        let q = +hs.value % 12;
        if (ap.value === 'PM') q += 12;
        i.value = p2(q) + ':' + ms.value;
      } else i.value = '';
      i.dispatchEvent(new Event('change', { bubbles: true }));
    };
    [hs, ms, ap].forEach((s) => (s.onchange = up));
    w.insertBefore(h('div', { class: 'bar', style: 'margin:0' }, hs, ms, ap), i);
  }
  return w;
}

function narr() {
  const pl = [g('acc_place'), g('acc_muni')].filter(Boolean).join(', ') || '[location]';
  let t = `As per the information provided, the accident occurred on ${dtf(g('case_acc')) || '[date]'}${g('case_acc') ? ' (' + bsStr(g('case_acc')).split(' ')[0] + ' BS)' : ''}${g('acc_time') ? ' at ' + t12(g('acc_time')) : ''} at ${pl}. The insured ${Lw(g('fp_type')) || 'vehicle'} (${g('fp_reg') || g('case_insReg') || 'reg. no. pending'}) was reportedly ${Lw(g('acc_mvI')) || '[movement]'}${g('acc_dirI') ? ' while travelling ' + g('acc_dirI') : ''}${hasTP() ? ` when it ${tpContact()} ${tpPartyText(0, true)}${tpMore()}` : ''}.`;
  t += ` ${g('acc_vehicles') || '[n]'} vehicle(s) were involved; ${g('acc_injured') || '0'} person(s) reportedly injured and ${g('acc_fatal') || '0'} fatalities. Police informed: ${Lw(g('acc_police')) || 'not recorded'}${g('acc_station') ? ' (' + g('acc_station') + ')' : ''}; police report: ${Lw(g('acc_reportAvail')) || 'not recorded'}.`;
  return t + (g('acc_furtherD') ? ' ' + g('acc_furtherD') : '');
}

function concl() {
  return `Based on the preliminary inspection and information obtained, the insured ${Lw(g('fp_type')) || 'vehicle'} (${g('fp_reg') || g('case_insReg') || 'reg. no. pending'}) sustained damage${hasTP() ? ` in ${tpCollision()} ${tpPartyText(0)}${tpMore()}` : ' in the reported incident'}${g('acc_cause') ? '; reported cause: ' + Lw(g('acc_cause')) : ''}. ${hasTP() ? `The estimated first-party loss is ${money(g('loss_t1'))} and the third-party loss is ${money(g('loss_t2'))}, giving a total preliminary estimated loss of ${money(g('loss_t3'))}` : `The total preliminary estimated loss is ${money(g('loss_t3'))}`}, subject to supporting documents, verification of medical expenses and applicable policy terms and conditions.`;
}
