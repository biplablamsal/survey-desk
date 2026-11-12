/* Third parties as records, not as one column of the form.
   The case answers one question – "Is any third party involved?" – and then says, for each of the
   three categories, how many parties there are. That number is answered by that many individual
   records, each with its own questions: three vehicles means three vehicle forms, not one form
   with three sets of dashes in it.
   A record is a flat object in Dd.tps carrying its category in `kind`, and the "No. involved"
   figure shown for a category is the count of that category's records, so a number and the data it
   stands for can never disagree. Passengers live inside their vehicle, an owner can be shared by
   several records, and a person who was a passenger can be linked instead of typed twice.
   Older cases are kept whole. While a case holds no records at all, the detailed "3rd party" and
   "third-party loss" pages are read and reported exactly as they always were; the panel offers to
   move those answers into records, and only does so when asked. Going back to No, or lowering a
   count, hides or archives – it never deletes, and a record whose report has been submitted needs
   the authorised removal process rather than a button.
   Loaded as a classic script: shares the global scope, order of <script> tags in index.html matters. */

/* ------------------------------------------------------------------ what a record holds */

const TP_ONE = { veh: 'Vehicle', inj: 'Person', prop: 'Property' },
  TP_GROUP = { veh: 'Vehicles', inj: 'Persons', prop: 'Properties' },
  TP_FUEL = ['Petrol', 'Diesel', 'Electric', 'Hybrid', 'CNG / LPG', 'Other'],
  TP_CHARGE = ['Home charger', 'Public charging', 'Portable cable', 'Not recorded'],
  TP_OTYPE = ['Individual', 'Organisation'],
  TP_GENDER = ['Male', 'Female', 'Other'],
  TP_INJURY = ['Not injured', 'Minor', 'Moderate', 'Serious', 'Fatal', 'Under assessment'],
  TP_TREAT = [
    'Outpatient',
    'Admitted',
    'Discharged',
    'Under treatment',
    'Referred',
    'Not treated',
    'Pending',
  ],
  /* The category a person falls into. The words the older injury page used are in here too, so a
     migrated record keeps the answer its surveyor actually gave. */
  TP_PCAT = [
    'Pedestrian',
    'Cyclist',
    'Two-wheeler rider',
    'Motorcyclist',
    'Driver',
    'Passenger',
    'Person at the roadside',
    'Other',
  ],
  TP_PRCAT = [
    'Residential building',
    'Commercial building',
    'Industrial building',
    'Boundary wall',
    'Land',
    'Road / infrastructure',
    'Machinery / equipment',
    'Furniture / contents',
    'Stock / inventory',
    'Other',
  ],
  TP_CONS = [
    'RCC framed',
    'Concrete',
    'Brick & mortar',
    'Timber',
    'Steel / tin shed',
    'Mud & stone',
    'Not applicable',
    'Other',
  ],
  TP_IDDOC = [
    'Citizenship certificate',
    'Passport',
    'Driving licence',
    'National ID',
    'Taxpayer registration',
    'Company registration',
    'Voter ID',
    'Other',
  ],
  /* Identity answered once and read through the reference by every record that shares it – one
     owner with two vehicles and a damaged wall is one owner, not three strangers with the same
     name. */
  TP_OWNER_KEYS = [
    'ownType',
    'oName',
    'oContact',
    'oAddr',
    'oIdType',
    'oIdNo',
    'oVerified',
    'ownRem',
  ],
  /* A driver ticked as the owner is answered by the owner block, and the report says so rather
     than printing an empty licence row. */
  TP_DRV_FROM_OWN = { dName: 'oName', dContact: 'oContact', dAddr: 'oAddr' };

/* sh = only asked when that answer was given, st = the answer changes the questions below it,
   w = take the whole width. */
const fl = (k, l, t, o = null, x = {}) => ({ k, l, t, o, ...x }),
  tpEv = (r) => ['Electric', 'Hybrid'].includes(r.fuel),
  tpCng = (r) => r.fuel === 'CNG / LPG',
  tpInjOf = (r) => !!r.injury && r.injury !== 'Not injured',
  tpNotDrv = (r) => r.dSame !== 'Yes',
  tpOcc = (r) => r.occDiff === 'Yes',
  tpOwnNew = (r) => !r.ownerRef,
  tpBuilt = (r) =>
    [
      'Residential building',
      'Commercial building',
      'Industrial building',
      'Boundary wall',
      'Road / infrastructure',
    ].includes(r.prCat);

const TP_VEH_F = [
  fl('reg', 'Registration number', 't', null, { ph: 'BA 1234' }),
  fl('vtype', 'Vehicle type', 'dl', VT),
  fl('make', 'Make / brand', 't'),
  fl('model', 'Model', 't'),
  fl('colour', 'Colour', 't'),
  fl('year', 'Manufacturing year', 'y'),
  fl('eng', 'Engine number', 't'),
  fl('chs', 'Chassis number', 't'),
  fl('fuel', 'Fuel type', 'sel', TP_FUEL, { st: 1 }),
  fl('batt', 'Battery / traction pack', 't', null, { sh: tpEv }),
  fl('chg', 'Charging', 'sel', TP_CHARGE, { sh: tpEv }),
  fl('cyl', 'Cylinder / fuel system', 't', null, { sh: tpCng }),
  fl('insco', 'Insurance company', 'dl', insurerNames),
  fl('policy', 'Policy number', 't'),
  fl('curLoc', 'Where the vehicle is now', 't'),
  fl('run', 'Running condition', 'sel', RC),
];

const TP_OWNER_F = [
  fl('ownerRef', 'Owner already recorded as', 'sel', tpOwnerChoices, { st: 1 }),
  fl('ownType', 'Owner type', 'sel', TP_OTYPE, { sh: tpOwnNew }),
  fl('oName', 'Name', 't', null, { sh: tpOwnNew }),
  fl('oContact', 'Contact number', 'p', null, { sh: tpOwnNew }),
  fl('oAddr', 'Address', 'a', null, { sh: tpOwnNew, w: 1 }),
  fl('oIdType', 'Other identification', 'sel', TP_IDDOC, { sh: tpOwnNew }),
  fl('oIdNo', 'Identification number', 't', null, { sh: tpOwnNew }),
  fl('oVerified', 'Ownership documents', 'sel', VER),
  fl('ownRem', 'Remarks', 'a', null, { w: 1 }),
];

const TP_DRV_F = [
  fl('dSame', 'Driver is the owner', 'chk', null, { st: 1 }),
  fl('dName', 'Driver name', 't', null, { sh: tpNotDrv }),
  fl('dContact', 'Contact number', 'p', null, { sh: tpNotDrv }),
  fl('dAddr', 'Address', 'a', null, { sh: tpNotDrv, w: 1 }),
  fl('dlNo', 'Licence number', 't', null, { sh: tpNotDrv }),
  fl('dlCat', 'Licence category', 'sel', LC, { sh: tpNotDrv }),
  fl('dlExp', 'Licence validity', 'd', null, { sh: tpNotDrv }),
  fl('dlVer', 'Licence verification', 'sel', VER, { sh: tpNotDrv }),
  fl('rel', 'Relationship to the owner', 't'),
  fl('stmt', 'Statement obtained', 'sel', YN),
  fl('dRem', 'Remarks', 'a', null, { w: 1 }),
];

const TP_VEH_DMG = [
  fl('inspDate', 'Date of inspection', 'd'),
  fl('inspPlace', 'Place of inspection', 't'),
  fl('inspected', 'Physically inspected', 'sel', YN),
  fl('photos', 'Photographs obtained', 'sel', YN),
  fl('sev', 'Extent of damage', 'sel', SEV),
  fl('dmg', 'Damage observed', 'a', null, { w: 1 }),
  fl('mech', 'Mechanical damage', 'sel', MD),
  fl('struct', 'Structural damage', 'sel', MD),
  fl('vEst', 'Repair estimate (NPR)', 'm'),
  fl('estBy', 'Estimate obtained from', 't'),
  fl('docs', 'Documents held', 'a', null, { w: 1 }),
  fl('vRem', 'Remarks', 'a', null, { w: 1 }),
];

const TP_PERSON_F = [
  fl('pName', 'Full name', 't'),
  fl('pCat', 'Category', 'sel', TP_PCAT),
  fl('age', 'Age', 'n'),
  fl('gender', 'Gender', 'sel', TP_GENDER),
  fl('contact', 'Contact number', 'p'),
  fl('addr', 'Address', 'a', null, { w: 1 }),
  fl('idType', 'Identification document', 'sel', TP_IDDOC),
  fl('idNo', 'Identification number', 't'),
  /* A passenger who is also a party in their own right is linked to the vehicle they came out of,
     so the same person is not registered twice on one case. */
  fl('paxOf', 'Already recorded as a passenger of', 'sel', tpPaxHosts, { st: 1 }),
];

const TP_INJ_F = [
  fl('injury', 'Injury status', 'sel', TP_INJURY, { st: 1 }),
  fl('injNature', 'Nature of injury', 'a', null, { sh: tpInjOf, w: 1 }),
  fl('hosp', 'Hospital / treatment centre', 't', null, { sh: tpInjOf }),
  fl('treat', 'Treatment status', 'sel', TP_TREAT, { sh: tpInjOf }),
  fl('medDocs', 'Supporting medical documents', 'a', null, { sh: tpInjOf, w: 1 }),
  fl('med', 'Medical expenses (NPR)', 'm', null, { sh: tpInjOf }),
  fl('claimed', 'Claimed amount (NPR)', 'm'),
];

const TP_PERSON_MORE = [fl('further', 'Further relevant information', 'a', null, { w: 1 })];

const TP_PROP_F = [
  fl('prCat', 'Category', 'sel', TP_PRCAT, { st: 1 }),
  fl('prDesc', 'Description of the property', 'a', null, { w: 1 }),
  fl('prWhere', 'Where it stands / was kept', 'a', null, { w: 1 }),
  fl('cons', 'Construction type', 'sel', TP_CONS, { sh: tpBuilt }),
  fl('prAge', 'Approximate age', 't'),
  fl('prUse', 'How it was used', 't'),
  fl('pIns', 'Covered by any insurance of its own', 'sel', YNP),
];

const TP_OCC_F = [
  fl('occDiff', 'Occupant differs from the owner', 'chk', null, { st: 1 }),
  fl('occName', 'Occupant name', 't', null, { sh: tpOcc }),
  fl('occContact', 'Contact number', 'p', null, { sh: tpOcc }),
  fl('occAddr', 'Address', 'a', null, { sh: tpOcc, w: 1 }),
  fl('occUse', 'How the occupant used it', 't', null, { sh: tpOcc }),
];

const TP_PROP_DMG = [
  fl('inspDate', 'Date of inspection', 'd'),
  fl('inspected', 'Physically inspected', 'sel', YN),
  fl('photos', 'Photographs obtained', 'sel', YN),
  fl('sev', 'Extent of damage', 'sel', SEV),
  fl('dmg', 'Damage observed', 'a', null, { w: 1 }),
  fl('prEst', 'Repair or replacement estimate (NPR)', 'm'),
  fl('estBy', 'Estimate obtained from', 't'),
  fl('docs', 'Documents held', 'a', null, { w: 1 }),
  fl('prRem', 'Remarks', 'a', null, { w: 1 }),
];

const TP_PAX_F = [
  fl('name', 'Full name', 't'),
  fl('age', 'Age', 'n'),
  fl('gender', 'Gender', 'sel', TP_GENDER),
  fl('contact', 'Contact number', 'p'),
  fl('addr', 'Address', 'a', null, { w: 1 }),
  fl('injury', 'Injury status', 'sel', TP_INJURY, { st: 1 }),
  fl('injNature', 'Nature of injury', 'a', null, { sh: tpInjOf, w: 1 }),
  fl('hosp', 'Hospital / treatment centre', 't', null, { sh: tpInjOf }),
  fl('treat', 'Treatment status', 'sel', TP_TREAT, { sh: tpInjOf }),
  fl('medDocs', 'Supporting medical documents', 'a', null, { sh: tpInjOf, w: 1 }),
];

/* The blocks a record is built from, in the order the surveyor answers them. Passengers are a
   block of their own because they repeat, not a row of a fixed form. */
const TP_BLOCKS = {
  veh: [
    { t: 'A. Vehicle details', f: TP_VEH_F },
    { t: 'B. Owner details', f: TP_OWNER_F },
    { t: 'C. Driver details', f: TP_DRV_F },
    { t: 'D. Passengers', pax: 1 },
    { t: 'E. Inspection, damage and estimate', f: TP_VEH_DMG },
  ],
  inj: [
    { t: 'A. Person details', f: TP_PERSON_F },
    { t: 'B. Injury and treatment', f: TP_INJ_F },
    { t: 'C. Further information', f: TP_PERSON_MORE },
  ],
  prop: [
    { t: 'A. Property details', f: TP_PROP_F },
    { t: 'B. Owner details', f: TP_OWNER_F },
    { t: 'C. Occupant / tenant', f: TP_OCC_F },
    { t: 'D. Damage, inspection and estimate', f: TP_PROP_DMG },
  ],
};

/* Every key one category holds – what a record is emptied to when it is created, and what counts
   as "somebody means this as a party". */
const TP_KEYS = Object.fromEntries(
  TP_KINDS.map(([c]) => [c, TP_BLOCKS[c].flatMap((b) => b.f || []).map((f) => f.k)])
);

/* ------------------------------------------------------------------ reading the records */

const tpNewId = () => 'tp' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
  tpBlank = (c) => {
    const r = { id: tpNewId(), kind: c };
    TP_KEYS[c].forEach((k) => (r[k] = ''));
    if (c === 'veh') r.pax = [];
    return r;
  },
  tpRows = () => (Array.isArray(Dd.tps) ? Dd.tps : []),
  tpCats = () => Dd.tpc || {},
  tpCatOn = (c) => tpCats()[c] === 1,
  tpOfKind = (c) => tpRows().filter((r) => r.kind === c),
  tpFind = (id) => tpRows().find((r) => r.id === id),
  tpSeq = (r) => tpOfKind(r.kind).indexOf(r) + 1,
  tpLabel = (r) =>
    r.legacy ? 'Third party 1' : TP_ONE[r.kind] + ' ' + String(tpSeq(r)).padStart(2, '0'),
  /* A record is somebody's party once any question on it has an answer. */
  tpPaxHas = (p) => TP_PAX_F.some((f) => (p[f.k] || '').trim()),
  tpRecHas = (r) =>
    !!TP_KEYS[r.kind] &&
    (TP_KEYS[r.kind].some((k) => (r[k] || '').trim()) || tpPaxOf(r).some(tpPaxHas)),
  tpPaxOf = (r) => (r.pax = Array.isArray(r.pax) ? r.pax : []),
  tpPaxNew = () => {
    const p = { id: tpNewId() };
    TP_PAX_F.forEach((f) => (p[f.k] = ''));
    return p;
  },
  /* Whatever identifies the party in a sentence. */
  tpWho = (r) =>
    r.legacy
      ? [g('tp_reg') || g('case_tpReg'), g('tp_oName') || g('tp_dName')].filter(Boolean).join(' · ')
      : r.kind === 'veh'
        ? [r.reg, tpEff(r, 'oName') || tpEff(r, 'dName')].filter(Boolean).join(' · ')
        : r.kind === 'inj'
          ? [tpEff(r, 'pName'), tpEff(r, 'pCat')].filter(Boolean).join(' · ')
          : [tpEff(r, 'prDesc'), tpEff(r, 'oName')].filter(Boolean).join(' · '),
  /* The answer a record gives, read through a shared owner or the driver-is-the-owner tick rather
     than repeating either. */
  tpEff = (r, k) => {
    const v = String(r[k] || '').trim();
    if (v) return v;
    if (TP_OWNER_KEYS.includes(k) && r.ownerRef) {
      const o = tpFind(r.ownerRef);
      return o ? String(o[k] || '').trim() : '';
    }
    if (r.dSame === 'Yes' && TP_DRV_FROM_OWN[k]) return tpEff(r, TP_DRV_FROM_OWN[k]);
    return v;
  };

/* The owners a later record can point at: a record that names an owner itself, in a category that
   has one. */
function tpOwnerChoices(r) {
  return tpRows()
    .filter(
      (x) => x !== r && !x.legacy && TP_KEYS[x.kind].includes('oName') && (x.oName || '').trim()
    )
    .map((x) => [x.id, tpLabel(x) + ' – ' + x.oName.trim()]);
}

/* Vehicles with a named passenger, for a person record that is the same human being. */
function tpPaxHosts() {
  const out = [];
  tpRows()
    .filter((r) => r.kind === 'veh')
    .forEach((r) =>
      tpPaxOf(r).forEach((p) => {
        if ((p.name || '').trim())
          out.push([r.id + ':' + p.id, tpLabel(r) + ' – ' + p.name.trim()]);
      })
    );
  return out;
}

/* Records worth counting: an empty one is a form being filled in, not a third party. */
const tpFilledRecs = (c) => tpRows().filter((r) => tpRecHas(r) && (!c || r.kind === c));

/* One party's kinds, whichever shape holds it. A migrated row that named several kinds at once is
   one record per kind by then, so a record has exactly one. */
const tpKindCodes = (s) => {
    const labels = new Set(
      String(s || '')
        .split(',')
        .map((x) => x.trim())
    );
    return TP_KINDS.filter(([, l]) => labels.has(l)).map(([c]) => c);
  },
  tpKindsOf = (p) => (p.legacy ? tpKindCodes(p.kind) : [p.kind]),
  tpStatedP = (p) => (p.legacy ? tpKindCodes(p.kind).length > 0 : true),
  /* A party that says nothing is read the way this form always read one: a vehicle, with the
     driver's injury asked about on the damage page and nothing else. That is what keeps a case
     entered before any of this existed reporting the questions it was filled in with. */
  tpKindsEffP = (p) => (tpStatedP(p) ? tpKindsOf(p) : ['veh', 'inj']);

/* The parties of the case. In the older shape the one party the form could hold is described by the
   detailed pages and there is no record for it; it still counts, and still reads as it always did. */
function tpParties() {
  const R = tpRows().filter(tpRecHas);
  return R.length || !hasTP() ? R : [{ legacy: 1, kind: Dd.f.tp_kind || '', id: 'legacy' }];
}

/* The parties as indexes, kept for the callers that have always counted this way: 0 is the first
   party, whether it lives in a record or in the detailed pages. */
const tpIdx = () => tpParties().map((_, i) => i),
  tpPartyAt = (i) => tpParties()[i],
  tpCount = () => tpParties().length,
  tpFilled = () => tpParties(),
  tpKinds = (i) => {
    const p = tpPartyAt(i);
    return p ? tpKindsOf(p) : [];
  },
  tpHasKind = (i, code) => tpKinds(i).includes(code),
  tpSome = (code) => tpParties().some((p) => tpKindsEffP(p).includes(code)),
  /* …and did somebody actually say so? A case entered before any of this answers nothing, so a
     warning built on this cannot appear on a case nobody has re-visited. */
  tpSomeStated = (code) => tpParties().some((p) => tpStatedP(p) && tpKindsOf(p).includes(code)),
  /* How many of the parties are vehicles: a three-party case where one party was a pedestrian
     involved two vehicles, not three, and that is what the accident page has to say. */
  tpVehCount = () => tpParties().filter((p) => tpKindsEffP(p).includes('veh')).length,
  /* Whether a field tagged with the kinds it describes still applies, the detailed pages being
     about the first party. The tag is one kind or a list of them, as the schema wrote it. */
  tpKindOk = (f) => {
    const p = tpPartyAt(0);
    return !!p && [].concat(f.ks).some((c) => tpKindsEffP(p).includes(c));
  },
  /* Only modules with a detailed third-party section get the panel – a property claim has no
     opposing vehicle to list. */
  tpSchema = () => SECS.some((s) => s.k === 'tp');

/* ------------------------------------------------------------------ tidying what a case holds */

/* A record read from a case saved by an older build: give it the keys its category has today, and
   settle its category from whatever the older row called it. */
function tpAdoptKeys(r) {
  const codes = tpKindCodes(r.kind),
    kind = TP_ONE[r.kind] ? r.kind : codes.length ? codes[0] : 'veh',
    out = tpBlank(kind),
    s = (k) => String(r[k] || '');
  out.id = r.id || tpNewId();
  /* Not a question the surveyor answers but the record's standing in the case, so it survives a
     rebuild the way the answers do. */
  if (r.sub) out.sub = r.sub;
  TP_KEYS[kind].forEach((k) => (out[k] = s(k)));
  /* The words the first list of parties used, before a category decided the questions. */
  if (kind === 'veh') {
    if (!out.oName) out.oName = s('name');
    if (!out.oContact) out.oContact = s('contact');
    if (!out.oAddr) out.oAddr = s('addr');
    if (!out.vRem) out.vRem = s('desc');
  }
  if (kind === 'inj') {
    if (!out.pName) out.pName = s('name');
    if (!out.contact) out.contact = s('contact');
    if (!out.hosp) out.hosp = s('hosp');
    if (!out.med) out.med = s('med');
    if (!out.pCat) out.pCat = s('role');
    if (!out.further) out.further = s('desc');
    if (!out.injury && (out.hosp || out.med)) out.injury = 'Under assessment';
  }
  if (kind === 'prop') {
    if (!out.prDesc) out.prDesc = s('propWhat') || s('desc');
    if (!out.prEst) out.prEst = s('propEst');
    if (!out.oName) out.oName = s('name');
    if (!out.oContact) out.oContact = s('contact');
  }
  out.pax = Array.isArray(r.pax)
    ? r.pax.map((p) => {
        const q = tpPaxNew();
        q.id = p.id || tpNewId();
        TP_PAX_F.forEach((f) => (q[f.k] = String(p[f.k] || '')));
        return q;
      })
    : [];
  return out;
}

/* One row that answered several kinds becomes one record per kind: a party that was a vehicle and
   the person in it is two records now, and each is asked its own questions. An empty record is
   never dropped here – a form set up for tomorrow is the surveyor's decision, not this function's. */
function tpNormalize() {
  const out = [];
  (Array.isArray(Dd.tps) ? Dd.tps : []).forEach((r) => {
    const codes = tpKindCodes(r.kind);
    if (codes.length > 1) {
      const parts = codes.map((c, j) => {
        const part = tpAdoptKeys(Object.assign({}, r, { kind: c }));
        /* A copied row must not carry a copied id, or two records would share one and every
           lookup would answer with the wrong one. */
        if (j) part.id = tpNewId();
        return part;
      });
      /* Only the kinds that were actually answered split off; the rest would be empty forms
         nobody asked for, and the count would stop matching the party. */
      const worth = parts.filter(tpRecHas);
      (worth.length ? worth : parts.slice(0, 1)).forEach((p) => out.push(p));
    } else out.push(tpAdoptKeys(codes.length ? Object.assign({}, r, { kind: codes[0] }) : r));
  });
  Dd.tps = out;
  /* A case that holds parties is a case with a third party, whatever the flag reads. An import or a
     pull from the server can carry the records without the answer, and the load-time default of No
     would then hide work nobody can reach. Only an answer the surveyor never gave is corrected – a
     deliberate No stays theirs, and it keeps the records out of the report without deleting them. */
  if (!hasTP() && out.length && !(Dd.man || {})['case_hasTP']) Dd.f.case_hasTP = 'Yes';
  /* The categories ticked, from the records the case ended up with plus any the older panel had
     been asked for. */
  const cats = {};
  out.forEach((r) => (cats[r.kind] = 1));
  if (Dd.tpc && typeof Dd.tpc === 'object')
    TP_KINDS.forEach(([c]) => {
      if (Dd.tpc[c]) cats[c] = 1;
    });
  if (!Object.keys(cats).length && hasTP()) {
    const stated = tpKindCodes(Dd.f.tp_kind || '');
    (stated.length ? stated : ['veh']).forEach((c) => (cats[c] = 1));
  }
  Dd.tpc = cats;
  if (!Array.isArray(Dd.tparch)) Dd.tparch = [];
}

/* ------------------------------------------------------------------ quantity rules */

function tpGrow(c, n) {
  const rows = tpRows();
  for (let j = 0; j < n; j++) rows.push(tpBlank(c));
  Dd.tps = rows;
  Dd.tpc = Object.assign({}, tpCats(), { [c]: 1 });
  sv(1);
  syncNav();
  render({ preserveScroll: true });
}

const tpNames = (list) => list.map(tpLabel).join(' and ');

/* Fewer than there are records never means "throw the last ones away": an empty form goes, a form
   with an answer in it is asked about first and then archived where it can be read back. */
function tpShrink(c, want) {
  const excess = tpOfKind(c).slice(want),
    locked = excess.filter(tpLocked);
  if (!excess.length) return;
  if (locked.length) {
    tpDialog(
      'A submitted record cannot be removed here',
      h(
        'p',
        {},
        tpNames(locked) +
          ' already ' +
          (locked.length === 1 ? 'carries' : 'carry') +
          ' a submitted report or assessment. Records like that are part of the ' +
          'case history and can only be withdrawn through the authorised process, not from this ' +
          'page, so the count stays where it is.'
      ),
      'OK',
      () => {
        render({ preserveScroll: true });
      },
      null
    );
    return;
  }
  const filled = excess.filter(tpRecHas);
  if (!filled.length) {
    tpDropRecs(excess);
    return;
  }
  tpDialog(
    'Archive ' +
      filled.length +
      ' filled ' +
      TP_ONE[c].toLowerCase() +
      (filled.length === 1 ? ' record' : ' records') +
      '?',
    h(
      'div',
      {},
      h(
        'p',
        {},
        'Lowering the number of ' +
          TP_GROUP[c].toLowerCase() +
          ' to ' +
          want +
          ' leaves these records over:'
      ),
      h(
        'ul',
        {},
        ...excess.map((r) => h('li', {}, tpLabel(r) + ' – ' + (tpWho(r) || 'no details')))
      ),
      h(
        'p',
        {},
        'Nothing is deleted. Filled records move to the archive at the bottom of this page, where ' +
          'they can be restored; empty forms are simply dropped.'
      )
    ),
    'Archive them',
    () => {
      tpArchive(filled);
      tpDropRecs(excess.filter((r) => !filled.includes(r)));
    },
    null
  );
}

/* A record whose report has gone in is history, not a draft. Nothing sets this flag yet – the
   submission step does, and until it does every record stays removable. */
const tpLocked = (r) => r.sub === 'Yes';

function tpArchive(list) {
  Dd.tparch = (Array.isArray(Dd.tparch) ? Dd.tparch : []).concat(
    list.map((r) => ({ rec: r, cat: r.kind, when: today(), label: tpLabel(r) }))
  );
  tpDropRecs(list);
  toast(
    list.length + ' record' + (list.length === 1 ? '' : 's') + ' archived – restore them below'
  );
}

function tpDropRecs(list) {
  Dd.tps = tpRows().filter((r) => !list.includes(r));
  sv(1);
  syncNav();
  render({ preserveScroll: true });
}

function tpRestore(entry) {
  Dd.tparch = (Dd.tparch || []).filter((x) => x !== entry);
  Dd.tps = tpRows().concat(tpAdoptKeys(entry.rec));
  Dd.tpc = Object.assign({}, tpCats(), { [entry.cat]: 1 });
  sv(1);
  syncNav();
  render({ preserveScroll: true });
}

function tpRemoveRec(r) {
  if (tpLocked(r)) {
    toast('This record belongs to a submitted report and needs the authorised removal process.');
    return;
  }
  if (!tpRecHas(r)) {
    tpDropRecs([r]);
    return;
  }
  tpDialog(
    'Remove ' + tpLabel(r) + '?',
    h(
      'p',
      {},
      'The answers on this record move to the archive and stay readable there. To take every ' +
        'third party out of the case, answer the third-party question on the case page instead.'
    ),
    'Archive the record',
    () => {
      tpArchive([r]);
    },
    null
  );
}

function tpCatToggle(c, on) {
  const cats = Object.assign({}, tpCats());
  if (on) {
    cats[c] = 1;
    Dd.tpc = cats;
    if (!tpOfKind(c).length) tpGrow(c, 1);
    else render({ preserveScroll: true });
    return;
  }
  /* Unticking hides the category; the records behind it stay exactly where they are. */
  delete cats[c];
  Dd.tpc = cats;
  sv(1);
  render({ preserveScroll: true });
}

/* ------------------------------------------------------------------ dialogs */

/* The shape every other dialog in the app uses – a form method="dialog", a .bar footer, removed on
   close – so a confirmation looks like the rest of the app and behaves like it too. */
function tpDialog(title, body, okLabel, onOk, note) {
  const dlg = h('dialog', { class: 'tk-dlg', 'aria-labelledby': 'tp-dlg-title' });
  dlg.append(
    h(
      'form',
      { method: 'dialog' },
      h('h3', { id: 'tp-dlg-title' }, title),
      note ? h('p', { class: 'mu' }, note) : null,
      body,
      h(
        'div',
        { class: 'bar' },
        h('button', { class: 'b', type: 'button', onclick: () => dlg.close() }, 'Cancel'),
        h(
          'button',
          {
            class: 'b p',
            type: 'submit',
            onclick: (e) => {
              e.preventDefault();
              dlg.close();
              if (onOk) onOk();
            },
          },
          okLabel
        )
      )
    )
  );
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
  return dlg;
}

/* ------------------------------------------------------------------ the panel on the case page */

function tpSummaryUI() {
  if (!tpSchema() || !hasTP()) return '';
  return h(
    'section',
    { class: 'card tp-snapshot' },
    h('h3', {}, 'Third-party categories'),
    h(
      'p',
      { class: 'mu' },
      'Tick the kind of party this case involved and say how many of each. SurveyPro prepares that ' +
        'many individual forms below – a form for each vehicle, each person, each property – and ' +
        'they can be completed later or added to after registration.'
    ),
    h('div', { class: 'grid tp-snapshot-grid' }, ...TP_KINDS.map(([c]) => tpCatCard(c))),
    tpMigrateUI()
  );
}

function tpCatCard(c) {
  const all = tpOfKind(c),
    filled = tpFilledRecs(c).length,
    box = h('input', { type: 'checkbox' });
  box.checked = tpCatOn(c) || all.length > 0;
  box.onchange = () => tpCatToggle(c, box.checked);
  const qty = h('input', {
    id: 'tpq_' + c,
    type: 'number',
    min: '0',
    step: '1',
    value: String(all.length),
    onchange: (e) => {
      const n = Math.max(0, Math.floor(Number(e.target.value) || 0));
      if (n === all.length) return;
      if (n > all.length) {
        Dd.tpc = Object.assign({}, tpCats(), { [c]: 1 });
        tpGrow(c, n - all.length);
      } else tpShrink(c, n);
    },
  });
  return h(
    'div',
    { class: 'card tp-snapshot-card' },
    h('label', { class: 'mc' }, box, ' ', TP_ONE[c]),
    h('div', { class: 'fld' }, h('label', { for: 'tpq_' + c }, 'No. involved'), qty),
    h(
      'p',
      { class: 'mu' },
      all.length
        ? filled + ' of ' + all.length + ' ' + TP_GROUP[c].toLowerCase() + ' filled in'
        : 'No ' + TP_GROUP[c].toLowerCase() + ' recorded yet'
    )
  );
}

/* A case entered on the detailed pages can be moved into records without losing the answers, and
   only when the surveyor asks for it – opening an old case must not rewrite it. */
function tpMigrateUI() {
  if (tpRows().length || !hasTP()) return '';
  const has = SECS.filter((s) => s.k === 'tp' || s.k === 'd2').some((s) =>
    s.g.some((x) => x.f.some((f) => (Dd.f[f.k] || '').trim()))
  );
  if (!has) return '';
  return h(
    'div',
    { class: 'tp-migrate' },
    h(
      'p',
      { class: 'mu' },
      'This case describes its third party in the flat forms – on this page and on the Damage – 3rd ' +
        'party page. Those pages stay as they are, and nothing here changes them. Moving the answers ' +
        'into records lets the case hold more than one party, and each party is then asked only its ' +
        'own questions.'
    ),
    h(
      'button',
      { class: 'b p', type: 'button', onclick: () => tpMigrate() },
      'Move the existing details into records'
    )
  );
}

function tpMigrate() {
  const g2 = (k) => String(Dd.f[k] || '').trim(),
    kinds = tpKindCodes(Dd.f.tp_kind || ''),
    use = kinds.length ? kinds : ['veh', 'inj'],
    out = [];
  if (use.includes('veh')) {
    const v = tpBlank('veh');
    Object.assign(v, {
      reg: g2('tp_reg') || g2('case_tpReg'),
      vtype: g2('tp_type'),
      make: g2('tp_mm'),
      colour: g2('tp_colour'),
      year: g2('tp_year'),
      eng: g2('tp_eng'),
      chs: g2('tp_chs'),
      curLoc: g2('tp_loc'),
      run: g2('tp_run'),
      inspDate: g2('d2_date'),
      inspPlace: g2('d2_place'),
      inspected: g2('d2_insp'),
      photos: g2('d2_photos'),
      sev: g2('d2_sev'),
      dmg: g2('d2_area'),
      mech: g2('d2_mech'),
      struct: g2('d2_struct'),
      ownType:
        g2('tp_oType') === 'Individual' ? 'Individual' : g2('tp_oType') ? 'Organisation' : '',
      oName: g2('tp_oName'),
      oContact: g2('tp_tel'),
      oAddr: g2('tp_addr'),
      oIdNo: g2('tp_ownDoc'),
      oVerified: g2('tp_ownVer'),
      ownRem: [g2('tp_oRem'), g2('tp_rem')].filter(Boolean).join('\n'),
      dName: g2('tp_dName'),
      dContact: g2('tp_dTel'),
      dAddr: g2('tp_dAddr'),
      dlNo: g2('tp_dlNo'),
      dlCat: g2('tp_dlCat'),
      dlExp: g2('tp_dlExp'),
      dlVer: g2('tp_dlVer'),
      rel: g2('tp_rel'),
      stmt: g2('tp_stmt'),
      dRem: g2('tp_dRem'),
      vRem: g2('d2_rem'),
    });
    out.push(v);
  }
  if (use.includes('inj')) {
    const p = tpBlank('inj');
    Object.assign(p, {
      pName: g2('d2_pName'),
      pCat: g2('d2_pWho'),
      injury:
        g2('d2_inj') === 'Yes' ? 'Under assessment' : g2('d2_inj') === 'No' ? 'Not injured' : '',
      injNature: g2('d2_desc'),
      hosp: g2('d2_hosp'),
      med: g2('d2_med'),
    });
    /* Injury money already counted on the loss page would otherwise look like a figure nobody
       answered the first question about. */
    if (!p.injury && (p.hosp || p.med || p.injNature)) p.injury = 'Under assessment';
    out.push(p);
  }
  if (use.includes('prop')) {
    const q = tpBlank('prop'),
      own = out.find((r) => r.kind === 'veh' && r.oName);
    Object.assign(q, {
      prCat: g2('tp_pType'),
      prDesc: [g2('tp_pWhat'), g2('tp_pType')].filter(Boolean).join(' – '),
      prWhere: [g2('tp_pWhere'), g2('d2_pLoc')].filter(Boolean).join('. '),
      prUse: g2('tp_pUse'),
      pIns: g2('tp_pIns'),
      sev: g2('d2_pSev'),
      photos: g2('d2_pPhotos'),
      prRem: [g2('tp_pRem'), g2('d2_pRem')].filter(Boolean).join('\n'),
      ownerRef: own ? own.id : '',
    });
    if (!own)
      Object.assign(q, {
        oName: g2('tp_oName'),
        oContact: g2('tp_tel'),
        oAddr: g2('tp_addr'),
        oVerified: g2('tp_ownVer'),
      });
    out.push(q);
  }
  Dd.tps = out;
  Dd.tpc = {};
  out.forEach((r) => (Dd.tpc[r.kind] = 1));
  sv(1);
  syncNav();
  render({ preserveScroll: true });
  toast(
    out.length +
      ' third-party record' +
      (out.length === 1 ? '' : 's') +
      ' created from the details already entered'
  );
}

function tpListUI() {
  if (!tpSchema() || !hasTP()) return '';
  const groups = TP_KINDS.filter(([c]) => tpCatOn(c) || tpRows().some((r) => r.kind === c)).map(
    ([c]) =>
      h(
        'div',
        { class: 'card tpgroup' },
        h(
          'div',
          { class: 'bar' },
          h('h3', {}, TP_GROUP[c]),
          h(
            'button',
            {
              class: 'b',
              type: 'button',
              onclick: () => {
                tpGrow(c, 1);
              },
            },
            '+ Add ' + TP_ONE[c].toLowerCase()
          )
        ),
        tpOfKind(c).length
          ? tpOfKind(c).map((r) => tpRecordCard(r))
          : h(
              'p',
              { class: 'mu' },
              'No ' + TP_GROUP[c].toLowerCase() + ' form yet. Add one, or set the number above.'
            )
      )
  );
  return h(
    'section',
    { class: 'card' },
    h('h3', {}, 'Third-party information'),
    groups.length
      ? groups
      : h(
          'p',
          { class: 'mu' },
          'Tick a category above to prepare the individual forms this case needs.'
        ),
    tpFindUI(),
    tpArchiveUI()
  );
}

function tpRecordCard(r) {
  return h(
    'div',
    { class: 'tpcard' },
    h(
      'div',
      { class: 'bar', id: 'tpb_' + r.id },
      h('b', {}, tpLabel(r)),
      ...tpHeadPills(r),
      h('span', { class: 'mu' }, tpWho(r) || 'Nothing entered yet'),
      h('button', { class: 'b', type: 'button', onclick: () => tpRemoveRec(r) }, 'Remove')
    ),
    ...TP_BLOCKS[r.kind].map((b) => (b.pax ? tpPaxBlock(r) : tpBlockUI(r, b)))
  );
}

function tpHeadPills(r) {
  const dup = tpDuplicateOf(r);
  return [
    r.sub === 'Yes' ? h('span', { class: 'pill ok' }, 'Report submitted') : null,
    dup ? h('span', { class: 'pill wn' }, 'Possible duplicate of ' + tpLabel(dup)) : null,
  ].filter(Boolean);
}

/* The heading of a record says who it is and whether the same party is already on the case. Both
   answers change while the record is being typed, and redrawing the whole page each time a field
   is left would throw away the field the surveyor has just tabbed into. */
function tpPaintHead(r) {
  const bar = document.getElementById('tpb_' + r.id);
  if (!bar) return;
  const mu = bar.querySelector('.mu');
  [...bar.querySelectorAll('.pill')].forEach((p) => p.remove());
  tpHeadPills(r).forEach((p) => bar.insertBefore(p, mu));
  mu.textContent = tpWho(r) || 'Nothing entered yet';
}

/* The same party twice over is a claim paid twice; say so where it is typed rather than in a report
   nobody reads until afterwards. */
function tpDuplicateOf(r) {
  if (!tpRecHas(r)) return null;
  const key = (x) =>
    (r.kind === 'veh'
      ? (x.reg || '').trim().toLowerCase()
      : r.kind === 'inj'
        ? (x.pName || '').trim().toLowerCase() + '|' + (x.contact || '').trim()
        : (x.prDesc || '').trim().toLowerCase() + '|' + tpEff(x, 'oName').toLowerCase()) || '';
  const mine = key(r);
  if (!mine) return null;
  return tpRows().find((x) => x !== r && x.kind === r.kind && key(x) === mine) || null;
}

function tpBlockUI(r, b) {
  const other = r.ownerRef ? tpFind(r.ownerRef) : null;
  return h(
    'div',
    { class: 'tpblock' },
    h('h4', {}, b.t),
    r.ownerRef
      ? h(
          'p',
          { class: 'mu' },
          other
            ? 'Owner shared with ' +
                tpLabel(other) +
                '. Editing those answers changes them for both.'
            : 'The owner this record pointed at is no longer in the case.'
        )
      : '',
    h('div', { class: 'grid' }, ...b.f.filter((f) => !f.sh || f.sh(r)).map((f) => tpFieldUI(r, f)))
  );
}

function tpPaxBlock(r) {
  const list = tpPaxOf(r);
  return h(
    'div',
    { class: 'tpblock' },
    h('h4', {}, 'D. Passengers'),
    h(
      'p',
      { class: 'mu' },
      'Each passenger belongs to this vehicle. A passenger who is a party in their own right is ' +
        'linked from their person record instead of being entered twice.'
    ),
    ...(list.length
      ? list.map((p, j) => tpPaxCard(r, p, j))
      : [h('p', { class: 'mu' }, 'No passenger recorded for this vehicle.')]),
    h(
      'button',
      {
        class: 'b',
        type: 'button',
        onclick: () => {
          list.push(tpPaxNew());
          sv(1);
          render({ preserveScroll: true });
        },
      },
      '+ Add passenger'
    )
  );
}

function tpPaxCard(r, p, j) {
  const drop = () => {
    r.pax = tpPaxOf(r).filter((x) => x !== p);
    sv(1);
    render({ preserveScroll: true });
  };
  return h(
    'div',
    { class: 'tpcard tp-sub' },
    h(
      'div',
      { class: 'bar' },
      h('b', {}, 'Passenger ' + (j + 1) + (p.name ? ' – ' + p.name : '')),
      h(
        'button',
        {
          class: 'b',
          type: 'button',
          onclick: () => {
            if (tpPaxHas(p))
              tpDialog(
                'Remove this passenger?',
                h(
                  'p',
                  {},
                  'Passenger ' +
                    (j + 1) +
                    ' already has answers on it. Remove it from this vehicle?'
                ),
                'Remove the passenger',
                drop,
                null
              );
            else drop();
          },
        },
        'Remove'
      )
    ),
    h(
      'div',
      { class: 'grid' },
      ...TP_PAX_F.filter((f) => !f.sh || f.sh(p)).map((f) => tpFieldUI(p, f))
    )
  );
}

/* ------------------------------------------------------------------ searching for a party already known */

function tpFindUI() {
  const out = h('div', { class: 'tp-find-list' });
  const box = h('input', {
    type: 'search',
    placeholder: 'Name, contact number or registration number of a party already recorded',
    maxlength: '80',
    oninput: () => tpFindRender(box.value.trim(), out),
  });
  return h(
    'div',
    { class: 'tp-find' },
    h('h4', {}, 'Search recorded third parties'),
    h(
      'p',
      { class: 'mu' },
      'Checked against every case on this machine, so a party seen before is copied rather than ' +
        'retyped. Only identity and contact come across – never another accident’s estimate.'
    ),
    box,
    out
  );
}

function tpFindRender(q, out) {
  out.innerHTML = '';
  if (q.length < 2) return;
  const hits = tpSearch(q);
  out.append(
    hits.length
      ? hits.map((x) =>
          h(
            'div',
            { class: 'bar tp-find-row' },
            h('span', {}, x.label + ' · ' + (x.claimNo || x.caseId)),
            h(
              'button',
              {
                class: 'b',
                type: 'button',
                onclick: () => {
                  tpCopyFrom(x.rec, x.kind);
                },
              },
              'Copy into this case'
            )
          )
        )
      : h('p', { class: 'mu' }, 'No recorded party matches that.')
  );
}

function tpSearch(q) {
  const want = q.toLowerCase(),
    out = [];
  Object.keys(DB).forEach((id) => {
    const c = DB[id];
    (Array.isArray(c.tps) ? c.tps : []).forEach((r) => {
      if (!TP_ONE[r.kind]) return;
      const hay = [
        r.reg,
        r.oName,
        r.dName,
        r.pName,
        r.contact,
        r.oContact,
        r.prDesc,
        (r.pax || []).map((p) => p.name).join(' '),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (hay.includes(want))
        out.push({
          caseId: id,
          claimNo: (c.f || {}).case_claimNo || '',
          kind: r.kind,
          rec: r,
          label: TP_ONE[r.kind] + ' – ' + (r.reg || r.pName || r.oName || r.prDesc || 'unnamed'),
        });
    });
  });
  return out.slice(0, 12);
}

/* Identity across, nothing else: an estimate belongs to the accident it was made for. */
function tpCopyFrom(src, kind) {
  const r = tpBlank(kind),
    keys = {
      veh: ['reg', 'vtype', 'make', 'model', 'colour', 'year', 'fuel', 'insco', 'policy'],
      inj: ['pName', 'pCat', 'age', 'gender', 'contact', 'addr', 'idType', 'idNo'],
      prop: ['prCat', 'prDesc', 'prWhere', 'cons', 'prAge', 'prUse'],
    }[kind];
  keys.forEach((k) => (r[k] = String(src[k] || '')));
  TP_OWNER_KEYS.forEach((k) => (r[k] = String(src[k] || '')));
  ['dName', 'dContact', 'dAddr', 'dlNo', 'dlCat', 'dlExp'].forEach(
    (k) => (r[k] = String(src[k] || ''))
  );
  Dd.tps = tpRows().concat(r);
  Dd.tpc = Object.assign({}, tpCats(), { [kind]: 1 });
  sv(1);
  syncNav();
  render({ preserveScroll: true });
  toast('Copied as ' + tpLabel(r) + '. Check the details before using them.');
}

function tpArchiveUI() {
  const list = Array.isArray(Dd.tparch) ? Dd.tparch : [];
  if (!list.length) return '';
  return h(
    'div',
    { class: 'tpblock' },
    h('h4', {}, 'Archived third-party records'),
    h(
      'p',
      { class: 'mu' },
      'Records taken out of the case when a count was lowered. They are not part of the report ' +
        'while they sit here, and restoring one puts it back as it was.'
    ),
    ...list.map((e) =>
      h(
        'div',
        { class: 'bar tp-find-row' },
        h('span', {}, (e.label || TP_ONE[e.cat] || 'Record') + ' · archived ' + (e.when || '')),
        h('button', { class: 'b', type: 'button', onclick: () => tpRestore(e) }, 'Restore')
      )
    )
  );
}

/* ------------------------------------------------------------------ one field of a record */

function tpFieldUI(o, f) {
  const id = 'ftp_' + o.id + '_' + f.k,
    opts = () => {
      const raw = typeof f.o === 'function' ? f.o(o) : f.o || [];
      /* A case saved before an option list existed still has an answer of its own; keeping it
         listed is what lets the surveyor change it instead of losing it. */
      const cur = String(o[f.k] || '');
      if (f.t === 'sel' && cur && !raw.some((x) => (Array.isArray(x) ? x[0] : x) === cur))
        return [[cur, cur + ' (saved earlier)']].concat(raw);
      return raw;
    },
    put = (v, redraw) => {
      o[f.k] = v;
      sv(1);
      toast(f.l + ' saved', '✓ ');
      if (redraw) render({ preserveScroll: true });
      else if (o.kind) tpPaintHead(o);
    };
  let i;
  if (f.t === 'a') i = h('textarea', { id, rows: '2', maxlength: '3000' });
  else if (f.t === 'm') {
    i = h('input', { id, type: 'number', step: 'any', min: '0' });
    i.inputMode = 'decimal';
  } else if (f.t === 'n') i = h('input', { id, type: 'number', step: '1', min: '0', max: '120' });
  else if (f.t === 'y')
    i = h('input', {
      id,
      type: 'number',
      step: '1',
      min: '1980',
      max: String(new Date().getFullYear() + 1),
    });
  else if (f.t === 'p') i = h('input', { id, type: 'tel', maxlength: '20' });
  else if (f.t === 'd') {
    i = h('input', { id, type: 'text' });
    i.readOnly = true;
    i.placeholder = 'Pick date (AD / BS)';
    i.style.cursor = 'pointer';
    i.onclick = () => openDP(i);
  } else if (f.t === 'sel') {
    i = h('select', { id }, h('option', { value: '' }, 'Select…'));
    opts().forEach((op) => {
      const [v, l] = Array.isArray(op) ? op : [op, op];
      i.append(h('option', { value: v }, l));
    });
    i.value = o[f.k] || '';
  } else if (f.t === 'chk') {
    i = h('input', { id, type: 'checkbox' });
    i.checked = o[f.k] === 'Yes';
  } else
    i = h('input', {
      id,
      type: 'text',
      maxlength: '160',
      ...(f.t === 'dl' ? { list: 'tdl_' + o.id + '_' + f.k } : {}),
      ...(f.ph ? { placeholder: f.ph } : {}),
    });
  if (f.t === 'chk')
    i.onchange = () => {
      put(i.checked ? 'Yes' : '', true);
    };
  else if (f.t === 'sel') i.onchange = () => put(i.value, true);
  else {
    i.value = o[f.k] || '';
    i.oninput = () => {
      o[f.k] = i.value;
      sv();
    };
    /* A date is answered in one go, the same as a dropdown; anything typed is settled on leaving. */
    if (f.t === 'd') i.onchange = () => put(i.value, f.st);
    else
      i.onblur = () => {
        const was = i._v,
          moved = typeof was === 'string' && String(i.value).trim() !== was;
        o[f.k] = String(i.value).trim();
        i.value = o[f.k];
        sv(1);
        /* The notice belongs to a box that actually changed, so tabbing through a form nobody edited
           stays quiet; the save itself has been keeping up with the typing already. */
        if (moved) toast(f.l + ' saved', '✓ ');
        /* The heading names this party and warns about a duplicate, so it is refreshed here rather
           than waiting for something else to redraw the page. */
        if (f.st) render({ preserveScroll: true });
        else if (o.kind) tpPaintHead(o);
      };
    i.onfocus = () => (i._v = i.value);
  }
  return h(
    'div',
    { class: 'fld' + (f.w || f.t === 'a' ? ' wide' : '') },
    h('label', { for: id }, f.l),
    i,
    f.t === 'dl'
      ? h(
          'datalist',
          { id: 'tdl_' + o.id + '_' + f.k },
          ...opts().map((op) => h('option', { value: Array.isArray(op) ? op[0] : op }))
        )
      : '',
    f.k === 'paxOf' && o.paxOf ? tpPaxLinkNote(o) : '',
    f.t === 'd' && o[f.k] ? h('small', { class: 'mu' }, bsStr(o[f.k])) : ''
  );
}

function tpPaxLinkNote(p) {
  const [vehId, paxId] = String(p.paxOf).split(':'),
    v = tpFind(vehId),
    q = v && tpPaxOf(v).find((x) => x.id === paxId);
  if (!q)
    return h(
      'small',
      { class: 'mu' },
      'The vehicle or passenger this was linked to is no longer here.'
    );
  return h(
    'div',
    {},
    h('small', { class: 'mu' }, 'Same person as ' + q.name + ', passenger of ' + tpLabel(v) + '.'),
    h(
      'button',
      {
        class: 'b',
        type: 'button',
        onclick: () => {
          tpAdopt(p, v, q);
        },
      },
      'Copy the passenger’s details here'
    )
  );
}

/* Bringing a passenger's answers across, so linking them does not mean typing them again. */
function tpAdopt(p, v, q) {
  [
    ['name', 'pName'],
    ['age', 'age'],
    ['gender', 'gender'],
    ['contact', 'contact'],
    ['addr', 'addr'],
    ['injury', 'injury'],
    ['injNature', 'injNature'],
    ['hosp', 'hosp'],
    ['treat', 'treat'],
    ['medDocs', 'medDocs'],
  ].forEach(([from, to]) => {
    if (!p[to] && q[from]) p[to] = q[from];
  });
  sv(1);
  render({ preserveScroll: true });
  toast('Details copied from ' + tpLabel(v) + '. Add anything this person answers differently.');
}

/* ------------------------------------------------------------------ how the parties read */

/* What was hit, with whatever identifies it. The second argument asks for the vehicle's movement
   as well, which only the accident narrative wants, and it belongs inside the vehicle part of the
   sentence rather than at the end of the list, so a case that hit a car and a person does not say
   the person was travelling south. */
function tpPartyText(i, dir) {
  const p = tpPartyAt(typeof i === 'number' ? i : 0);
  if (!p) return 'a third party';
  const k = tpKindsEffP(p),
    bits = [];
  if (p.legacy) {
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
  } else if (p.kind === 'veh')
    bits.push(
      `a third-party ${Lw(tpEff(p, 'vtype')) || 'vehicle'}${p.reg ? ' (' + p.reg + ')' : ''}`
    );
  else if (p.kind === 'inj')
    bits.push(
      `a third-party ${Lw(tpEff(p, 'pCat')) || 'person'}${
        tpEff(p, 'pName') ? ' (' + tpEff(p, 'pName') + ')' : ''
      }`
    );
  else
    bits.push(`third-party property${tpEff(p, 'prDesc') ? ' (' + tpEff(p, 'prDesc') + ')' : ''}`);
  /* One part reads as the sentence always did; several are listed, and the comma before the last
     one keeps a direction of travel from running into the next thing that was hit. */
  return bits.length > 1
    ? bits.slice(0, -1).join(', ') + ', and ' + bits[bits.length - 1]
    : bits[0] || 'a third party';
}

/* Only a vehicle has a direction of travel to report, so the sentence does not offer one for a
   pedestrian or a gate. */
const tpMoving = () => {
    const p = tpPartyAt(0);
    return !!p && tpKindsEffP(p).includes('veh');
  },
  tpContact = () => (tpMoving() ? 'collided with' : 'came into contact with'),
  tpCollision = () => (tpMoving() ? 'a collision with' : 'contact with');

/* The first party is described in detail; the rest are counted. "plus", not "and": the party
   already named can itself be several things joined with "and", and a second "and" would read as
   another thing it hit. */
const tpMore = () => {
  const extra = tpCount() - 1;
  return extra > 0 ? `, plus ${extra} further third ${extra === 1 ? 'party' : 'parties'}` : '';
};

/* ------------------------------------------------------------------ what the report prints */

function tpSummaryReportHTML() {
  const P = tpParties();
  if (!P.length) return '';
  const n = (c) => P.filter((p) => tpKindsEffP(p).includes(c)).length,
    pax = tpRows()
      .filter((r) => r.kind === 'veh')
      .reduce((a, r) => a + tpPaxOf(r).filter(tpPaxHas).length, 0);
  return (
    '<h4>Third-party summary</h4>' +
    '<table>' +
    `<tr><th>Recorded parties</th><td>${P.length}</td></tr>` +
    `<tr><th>Vehicle impacts</th><td>${n('veh')}</td></tr>` +
    `<tr><th>Persons</th><td>${n('inj')}</td></tr>` +
    `<tr><th>Passengers on those vehicles</th><td>${pax}</td></tr>` +
    `<tr><th>Property impacts</th><td>${n('prop')}</td></tr>` +
    '</table>'
  );
}

/* One block per party, and only the rows that party's category asks for: a three-party collision
   is not one table of six columns, and a pedestrian has no registration number to put in a column. */
function tpTableHTML() {
  const P = tpParties();
  /* A case still in the old shape prints its one party on the detailed pages above this, and has
     nothing to add here. */
  if (P.length === 1 && P[0].legacy) return '';
  return (
    `<h4>Third parties (${P.length})</h4>` +
    P.map(
      (p, i) =>
        `<h4>${esc(tpLabel(p))} – ${esc(tpPartyText(i))}</h4><table>${tpRecRowsHTML(p)}</table>`
    ).join('')
  );
}

/* The rows a record actually answers, block by block. */
function tpRecRowsHTML(r) {
  let o = '';
  TP_BLOCKS[r.kind].forEach((b) => {
    if (b.pax) {
      o += tpPaxOf(r)
        .filter(tpPaxHas)
        .map(
          (p, j) =>
            `<tr><th>Passenger ${j + 1}</th><td>${esc(
              TP_PAX_F.filter((f) => (!f.sh || f.sh(p)) && (p[f.k] || '').trim())
                .map((f) => f.l + ': ' + String(p[f.k]).trim())
                .join('; ')
            )}</td></tr>`
        )
        .join('');
      return;
    }
    b.f
      .filter((f) => !f.sh || f.sh(r))
      .forEach((f) => {
        const row = tpReportRow(r, f);
        if (!row) return;
        o += `<tr><th>${esc(row.l)}</th><td>${
          row.t === 'm'
            ? esc(money(row.v))
            : row.t === 'd'
              ? esc(dtf(row.v))
              : esc(row.v).replace(/\n/g, '<br>')
        }</td></tr>`;
      });
  });
  return o || '<tr><td>No details recorded for this party.</td></tr>';
}

/* One row of that table, or nothing when the answer is empty. Two of them store a pointer to another
   record rather than an answer, and a reader has no use for an identifier – the report says who the
   party shares an owner with, or which passenger they are. */
function tpReportRow(r, f) {
  if (f.k === 'ownerRef') {
    const o = tpFind(r.ownerRef);
    return o ? { l: 'Owner', v: 'as recorded for ' + tpLabel(o), t: 't' } : null;
  }
  if (f.k === 'paxOf') {
    const [vehId, paxId] = String(r.paxOf).split(':'),
      v = tpFind(vehId),
      q = v && tpPaxOf(v).find((x) => x.id === paxId);
    return q
      ? { l: 'Same person as', v: (q.name || 'unnamed') + ', passenger of ' + tpLabel(v), t: 't' }
      : null;
  }
  const v = tpEff(r, f.k);
  return v ? { l: f.l, v, t: f.t } : null;
}

/* Plain text of the same thing, for the material a report is drafted from. */
function tpRecordsText() {
  const P = tpParties();
  /* The same rule as the printed tables: a case still in the old shape has its party on the pages
     this is added to, and saying it twice would only give the drafter two versions of one party. */
  if (!P.length || (P.length === 1 && P[0].legacy)) return '';
  return (
    '## Third-party records\n' +
    P.map((p, i) => {
      if (p.legacy) return tpLabel(p) + ': ' + tpPartyText(i);
      const rows = TP_BLOCKS[p.kind].flatMap((b) =>
        b.pax
          ? tpPaxOf(p)
              .filter(tpPaxHas)
              .map((q) => 'Passenger: ' + (q.name || 'unnamed'))
          : b.f
              .filter((f) => !f.sh || f.sh(p))
              .map((f) => {
                const row = tpReportRow(p, f);
                return row ? `${row.l}: ${row.v}` : '';
              })
      );
      return `${tpLabel(p)} – ${tpPartyText(i)}\n` + rows.filter(Boolean).join('\n');
    }).join('\n\n')
  );
}

/* ------------------------------------------------------------------ the flag and the verbs */

/* The surveyor's own answer, so the claim-type guess in MOD.links must not overwrite it later –
   same manual-override marker the tick box used. */
function tpFlag(yes) {
  Dd.f.case_hasTP = yes ? 'Yes' : 'No';
  (Dd.man = Dd.man || {})['case_hasTP'] = 1;
  if (cur && DB[cur]) {
    DB[cur].f = DB[cur].f || {};
    DB[cur].f.case_hasTP = yes ? 'Yes' : 'No';
    (DB[cur].man = DB[cur].man || {})['case_hasTP'] = 1;
  }
  sv(1);
}

/* The banner on the Not Applicable page asks for one party; the panel then decides what kind. */
function tpAdd() {
  if (!hasTP()) tpFlag(true);
  if (!tpRows().length) tpGrow('veh', 1);
  else if (!tpCatOn('veh')) tpCatToggle('veh', true);
  else {
    sv(1);
    syncNav();
    render({ preserveScroll: true });
  }
}

/* Answering No hides the third-party pages and their report sections. It deletes nothing: the
   records stay in the case, and answering Yes again brings them back. */
function tpDropFirst() {
  tpFlag(false);
  sv(1);
  syncNav();
  render({ preserveScroll: true });
}

function tpDrop(i) {
  const r = tpRows()[i];
  if (r) tpRemoveRec(r);
}

/* ------------------------------------------------------------------ importing a case */

/* An import is somebody else's JSON: keep the categories a record claims, drop the keys it
   invented, and re-key every row so two imports can never share an id. */
function tpImportRows(list) {
  const out = [];
  (Array.isArray(list) ? list : []).slice(0, 60).forEach((r, i) => {
    if (!r || typeof r !== 'object') return;
    const codes = tpKindCodes(r.kind),
      kind = TP_ONE[r.kind] ? r.kind : codes[0] || 'veh',
      rec = tpBlank(kind),
      spec = Object.fromEntries(TP_BLOCKS[kind].flatMap((b) => b.f || []).map((f) => [f.k, f.t]));
    rec.id = 'tp' + Date.now().toString(36) + i;
    TP_KEYS[kind].forEach((k) => {
      const t = spec[k];
      rec[k] = String(r[k] ?? '').slice(
        0,
        t === 'a' ? 3000 : t === 'm' || t === 'n' || t === 'y' ? 20 : 160
      );
    });
    rec.pax = (Array.isArray(r.pax) ? r.pax : []).slice(0, 30).map((p, j) => {
      const q = tpPaxNew();
      q.id = rec.id + 'p' + j;
      TP_PAX_F.forEach((f) => {
        q[f.k] = String(p[f.k] ?? '').slice(0, f.t === 'a' ? 3000 : f.t === 'n' ? 20 : 160);
      });
      return q;
    });
    if (tpRecHas(rec) || i === 0) out.push(rec);
  });
  return out;
}

/* The legacy standalone Third-Party Management page is gone: a third party is a record on the case
   it belongs to, and the case page is where it is entered, checked and reported. */
