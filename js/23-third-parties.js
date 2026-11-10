/* Several third parties on one case, and a third party is not always a vehicle.
   The first keeps the detailed "3rd party" and "third-party loss" sections it always had; every
   party after that is recorded in the list on the Case information page, because a three-vehicle
   collision cannot be described in one column of the same form.
   The list also owns the third-party flag: the old tick box is gone, so "this case has a third
   party" is a consequence of having one rather than a switch that can disagree with the data.
   Each party then answers what it consists of – a vehicle, a person hit, property that is not a
   vehicle, or any of those together – and only the questions that fit that answer are asked, in the
   form, in the checks, and in the report. A party that says nothing is read as the vehicle the form
   could only ever record, so cases entered before this existed are reported exactly as before.
   Loaded as a classic script: shares the global scope, order of <script> tags in index.html matters. */

const TP_ROLES = [
    'Other vehicle driver',
    'Other vehicle owner',
    'Two-wheeler rider',
    'Cyclist',
    'Pedestrian',
    'Occupant',
    'Property owner / custodian',
    'Other',
  ],
  /* The three kinds a third party can consist of are TP_KINDS in js/01-core.js, alongside the
     other option lists, because the form schema asks for them too. */
  /* key, label, kind ('t' text, 'dl' suggestions, 'm' money, 'a' multiline, 'mc' tick row),
     suggestions, and the party kind the row belongs to (none = asked of every party). */
  TPF = [
    ['name', 'Name', 't', null, null],
    ['role', 'Role in the accident', 'dl', () => TP_ROLES, null],
    ['contact', 'Contact number', 't', null, null],
    ['kind', 'What is involved', 'mc', () => TP_KIND_LABELS, null],
    ['reg', 'Vehicle registration number', 't', null, 'veh'],
    ['vtype', 'Vehicle type', 'dl', () => VT, 'veh'],
    ['insco', 'Insurance company', 'dl', insurerNames, 'veh'],
    ['vEst', 'Vehicle repair estimate (NPR)', 'm', null, 'veh'],
    ['hosp', 'Hospital / treatment centre', 't', null, 'inj'],
    ['med', 'Medical expenses (NPR)', 'm', null, 'inj'],
    ['propWhat', 'What property was damaged', 't', null, 'prop'],
    ['propEst', 'Repair or replacement estimate (NPR)', 'm', null, 'prop'],
    ['desc', 'Description', 'a', null, null],
  ];

const tpExtra = () => Dd.tps || [],
  /* The rows a party is made of: any one of them filled means somebody means it as a party. */
  tpRowFilled = (p) => TPF.some(([k]) => (p[k] || '').trim()),
  tpFilled = () => tpExtra().filter(tpRowFilled),
  tpCount = () => (hasTP() ? 1 : 0) + tpExtra().length,
  /* Only modules with a detailed third-party section get the panel – a property claim has no
     opposing vehicle to list. */
  tpSchema = () => SECS.some((s) => s.k === 'tp'),
  /* Which parties the case actually has, as indexes: 0 is the detailed sections, 1..n the rows. */
  tpIdx = () => {
    const out = hasTP() ? [0] : [];
    tpFilled().forEach((_, i) => out.push(i + 1));
    return out;
  };

/* A party's own answer, whichever half of the model it lives in: the detailed sections keep theirs
   in the tp_kind field, the list keeps it on the row. */
const tpKindCodes = (s) => {
    const labels = new Set((s || '').split(',').map((x) => x.trim()));
    return TP_KINDS.filter(([, l]) => labels.has(l)).map(([c]) => c);
  },
  tpPartyKindStr = (i) => (i === 0 ? Dd.f.tp_kind || '' : (tpFilled()[i - 1] || {}).kind || ''),
  tpKinds = (i) => tpKindCodes(tpPartyKindStr(i)),
  tpStated = (i) => tpKindCodes(tpPartyKindStr(i)).length > 0,
  tpHasKind = (i, code) => tpKinds(i).includes(code),
  /* A party that says nothing is read the way this form always read one: a vehicle, with the
     driver's injury asked about on the damage page and nothing else. That is what keeps a case
     entered before kinds existed showing – and reporting – the questions it was filled in with,
     rather than growing a property block full of dashes. */
  tpKindsEff = (i) => (tpStated(i) ? tpKinds(i) : ['veh', 'inj']),
  /* Does any party on this case consist of that kind? */
  tpSome = (code) => tpIdx().some((i) => tpKindsEff(i).includes(code)),
  /* …and did somebody actually say so? Older cases answer nothing, so a warning built on this
     cannot appear on a case nobody has re-visited. */
  tpSomeStated = (code) => tpIdx().some((i) => tpHasKind(i, code)),
  /* How many of the parties are vehicles: a three-party case where one party was a pedestrian
     involved two vehicles, not three, and that is what the accident page has to say. */
  tpVehCount = () => tpIdx().filter((i) => tpKindsEff(i).includes('veh')).length,
  /* Whether a field tagged with the kinds it describes still applies to party 1, the only party
     the detailed sections talk about. The tag is one kind or a list of them, as the schema wrote it. */
  tpKindOk = (f) => [].concat(f.ks).some((c) => tpKindsEff(0).includes(c));

const tpNew = () => ({
  id: 'tp' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
  name: '',
  role: '',
  contact: '',
  kind: '',
  reg: '',
  vtype: '',
  insco: '',
  vEst: '',
  hosp: '',
  med: '',
  propWhat: '',
  propEst: '',
  desc: '',
});

/* The surveyor's own answer, so the claim-type guess in MOD.links must not overwrite it later –
   same manual-override marker the tick box used. */
function tpFlag(yes) {
  Dd.f.case_hasTP = yes ? 'Yes' : '';
  (Dd.man = Dd.man || {})['case_hasTP'] = 1;
}

function tpAdd() {
  if (hasTP()) Dd.tps = tpExtra().concat(tpNew());
  else {
    tpFlag(true);
    Dd.tps = [];
  }
  sv(1);
  syncNav();
}

/* Dropping party 1 drops the list too: extras are only meaningful next to the detailed sections,
   and a lone "party 3" would leave the report numbering with a hole in it. The detailed fields are
   kept, so changing the answer restores them – only the flag moves. */
function tpDropFirst() {
  tpFlag(false);
  Dd.tps = [];
  sv(1);
  syncNav();
}

function tpDrop(i) {
  Dd.tps = tpExtra().filter((_, j) => j !== i);
  sv(1);
}

/* The rows a party is shown: identity and description always, the rest only under the kinds that
   party is – and all of them while the party has said nothing, which is an older entry. */
const tpRowShows = (f, stated, kinds) => !f[4] || !stated || kinds.includes(f[4]);

function tpInput(p, key, label, kind, opts, id) {
  const dl = 'tdl_' + id + '_' + key;
  let i;
  if (kind === 'a')
    i = h('textarea', { rows: '2', id: 'ftpm_' + id + '_' + key, maxlength: '3000' });
  else if (kind === 'm') {
    i = h('input', { id: 'ftpm_' + id + '_' + key, type: 'number', step: 'any', min: '0' });
    i.inputMode = 'decimal';
  } else if (kind === 'mc') i = h('input', { id: 'ftpm_' + id + '_' + key, type: 'hidden' });
  else
    i = h('input', {
      id: 'ftpm_' + id + '_' + key,
      type: 'text',
      maxlength: kind === 't' ? '120' : '160',
      ...(kind === 'dl' ? { list: dl } : {}),
    });
  const put = (v, redraw) => {
    p[key] = v;
    sv(1);
    if (redraw) render();
  };
  if (kind === 'mc') {
    /* The same tick row the schema fields use (05-form-fields.js), so a party and the detailed
       sections answer the question in the same words and the same stored shape. */
    i.value = p[key] || '';
    const has = new Set(i.value.split(',').map((x) => x.trim()));
    const row = h(
      'div',
      { class: 'mcg' },
      ...opts().map((o) => {
        const c = h('input', { type: 'checkbox' });
        c.checked = has.has(o);
        c.onchange = () => {
          c.checked ? has.add(o) : has.delete(o);
          put(TP_KIND_LABELS.filter((l) => has.has(l)).join(', '), true);
        };
        return h('label', { class: 'mc' }, c, ' ' + o);
      })
    );
    return h(
      'div',
      { class: 'fld wide' },
      h('label', {}, label),
      row,
      i,
      h(
        'small',
        { class: 'mu' },
        'Tick every kind this party covers – a vehicle and the person in it, for instance.'
      )
    );
  }
  i.value = p[key] || '';
  i.oninput = () => {
    p[key] = i.value;
    sv();
  };
  i.onblur = () => {
    p[key] = i.value.trim();
    i.value = p[key];
    sv(1);
  };
  return h(
    'div',
    { class: 'fld' + (kind === 'a' ? ' wide' : '') },
    h('label', { for: i.id }, label),
    i,
    kind === 'dl' ? h('datalist', { id: dl }, ...opts().map((o) => h('option', { value: o }))) : ''
  );
}

/* How a party reads in a sentence: what was hit, with whatever identifies it.
   The second argument asks for the vehicle's movement as well, which only the accident narrative
   wants – and it belongs inside the vehicle part of the sentence, not at the end of the list, so a
   case that hit a car and a person does not say the person was travelling south. */
function tpPartyText(i, dir) {
  const k = tpStated(i) ? tpKinds(i) : ['veh'],
    bits = [];
  if (i === 0) {
    if (k.includes('veh'))
      bits.push(
        `a third-party ${Lw(g('tp_type')) || 'vehicle'}${g('tp_reg') ? ' (' + g('tp_reg') + ')' : ''}${
          dir && g('acc_dirT') ? ', ' + Lw(g('acc_dirT')) : ''
        }`
      );
    if (k.includes('inj'))
      bits.push(
        `a third-party ${Lw(g('d2_pWho')) || 'person'}${g('d2_pName') ? ' (' + g('d2_pName') + ')' : ''}`
      );
    if (k.includes('prop'))
      bits.push(`third-party property${g('tp_pWhat') ? ' (' + g('tp_pWhat') + ')' : ''}`);
  } else {
    const p = tpFilled()[i - 1] || {},
      who = p.name || p.role || '';
    if (k.includes('veh'))
      bits.push(`a third-party ${Lw(p.vtype) || 'vehicle'}${p.reg ? ' (' + p.reg + ')' : ''}`);
    if (k.includes('inj')) bits.push(`a third-party person${who ? ' (' + who + ')' : ''}`);
    if (k.includes('prop'))
      bits.push(`third-party property${p.propWhat ? ' (' + p.propWhat + ')' : ''}`);
  }
  /* One part reads as the sentence always did; several are listed, and the comma before the last
     one keeps a direction of travel from running into the next thing that was hit. */
  if (bits.length > 1) return bits.slice(0, -1).join(', ') + ', and ' + bits[bits.length - 1];
  return bits[0] || 'a third party';
}

/* Only a vehicle has a direction of travel to report, so the sentence does not offer one for a
   pedestrian or a gate. */
const tpMoving = () => tpKindsEff(0).includes('veh'),
  tpContact = () => (tpMoving() ? 'collided with' : 'came into contact with'),
  tpCollision = () => (tpMoving() ? 'a collision with' : 'contact with');

/* The party names as short chips, so the card says what it holds before it is opened. */
const tpKindChips = (codes) =>
  codes.length
    ? codes.map((c) => h('span', { class: 'pill mu' }, TP_KINDS.find(([k]) => k === c)[1]))
    : [h('span', { class: 'mu' }, 'Kind not stated – read as a vehicle')];

function tpPartyCard(p, i) {
  const name = p.name || p.reg,
    codes = tpKindCodes(p.kind),
    stated = codes.length > 0,
    row = h(
      'div',
      { class: 'grid' },
      ...TPF.filter((f) => tpRowShows(f, stated, codes)).map(([k, l, kind, opts]) =>
        tpInput(p, k, l, kind, opts, p.id)
      )
    );
  return h(
    'div',
    { class: 'tpcard' },
    h(
      'div',
      { class: 'bar' },
      h('b', {}, 'Third party ' + (i + 2)),
      name ? '' : h('span', { class: 'mu' }, 'New – fill the details below'),
      h('span', { class: 'bar' }, ...tpKindChips(codes)),
      h(
        'button',
        {
          class: 'b',
          type: 'button',
          onclick: () => {
            tpDrop(i);
            render();
          },
        },
        'Remove'
      )
    ),
    row
  );
}

function tpFirstCard() {
  const who = g('tp_oName') || g('tp_dName'),
    reg = g('tp_reg') || g('case_tpReg'),
    extra = tpExtra().length,
    codes = tpKinds(0);
  return h(
    'div',
    { class: 'tpcard' },
    h(
      'div',
      { class: 'bar' },
      h('b', {}, 'Third party 1'),
      h(
        'span',
        { class: 'mu' },
        who || reg
          ? [who, reg].filter(Boolean).join(' · ') + ' – details in the sections below'
          : 'Details not entered yet'
      ),
      ...tpKindChips(codes),
      h(
        'button',
        {
          class: 'b',
          type: 'button',
          onclick: () => {
            sec = 'tp';
            render();
          },
        },
        '3rd party details →'
      ),
      h(
        'button',
        {
          class: 'b',
          type: 'button',
          onclick: () => {
            tpDropFirst();
            render();
          },
        },
        extra ? 'Remove all ' + (extra + 1) : 'Remove'
      )
    ),
    h(
      'p',
      { class: 'mu' },
      'Party 1 uses the full third-party sections, and those sections ask about a vehicle, an ' +
        'injured person or property according to the answer on the 3rd party page. Removing this ' +
        'party hides those sections and their report pages; the entries you typed are kept in the ' +
        'case in case the answer changes.'
    )
  );
}

/* The written sections describe one party in detail, so the rest are named only as a count.
   "plus", not "and": the party already named can itself be several things joined with "and" (a
   vehicle and the person in it), and a second "and" would read as another thing it hit. */
const tpMore = () => {
  const extra = tpFilled().length;
  return extra > 0 ? `, plus ${extra} further third ${extra === 1 ? 'party' : 'parties'}` : '';
};

/* The further parties as printed report blocks, inserted under the detailed 3rd-party section.
   Each party gets its own rows, and only the rows its answer calls for: a three-party collision is
   not one table of six columns, and a pedestrian has no registration number to put in a column. */
function tpTableHTML() {
  /* An empty row is a party being filled in, not a party to print. */
  const L = tpFilled();
  if (!hasTP() || !L.length) return '';
  return (
    `<h4>Further third parties (${L.length})</h4>` +
    L.map((p, i) => {
      const codes = tpKindCodes(p.kind),
        stated = codes.length > 0,
        rows = TPF.filter((f) => f[0] !== 'kind' && tpRowShows(f, stated, codes)).filter(([k]) =>
          (p[k] || '').trim()
        );
      return (
        `<h4>Third party ${i + 2} – ${esc(tpPartyText(i + 1))}</h4><table>` +
        (rows.length
          ? rows
              .map(([k, l, kind]) => {
                const v = p[k].trim();
                return `<tr><th>${esc(l)}</th><td>${
                  kind === 'm' ? esc(money(v)) : esc(v).replace(/\n/g, '<br>')
                }</td></tr>`;
              })
              .join('')
          : '<tr><td>No details recorded for this party.</td></tr>') +
        '</table>'
      );
    }).join('')
  );
}

function tpListUI() {
  if (!tpSchema()) return '';
  const n = tpCount();
  return h(
    'section',
    { class: 'card' },
    h('h3', {}, 'Third parties' + (n ? ' (' + n + ')' : '')),
    n
      ? h('div', {}, hasTP() ? tpFirstCard() : '', ...tpExtra().map((p, i) => tpPartyCard(p, i)))
      : h(
          'p',
          { class: 'mu' },
          'No third party on this case. Add one to open the third-party sections; each party then ' +
            'says whether it is a vehicle, a person hit, property, or any of those together, and ' +
            'only the questions that fit are asked.'
        ),
    h(
      'div',
      { class: 'bar' },
      h(
        'button',
        {
          class: 'b p',
          type: 'button',
          onclick: () => {
            tpAdd();
            render();
          },
        },
        '+ Add Third Party'
      )
    )
  );
}
