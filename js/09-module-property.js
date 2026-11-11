/* Property claim module: schema, rules, narrative, registration in MODS
   Loaded as a classic script: everything here shares the global scope. Order of <script> tags in index.html matters. */

/* Property claims follow the same five workflow stages; "Incident & inspection" replaces
   "Accident & inspection" because fire, flood and earthquake are not accidents. */
const WF_GROUPS_P = [
  { n: 'Case registration', k: ['case', 'pol', 'risk'] },
  { n: 'Incident & inspection', k: ['inc', 'dmg', 'photos', 'spot'] },
  { n: 'Preliminary assessment', k: ['est', 'prelim'] },
  { n: 'Final assessment', k: ['pla', 'concl'] },
  { n: 'Report & verification', k: ['report', 'final'] },
];

function norm(S) {
  S.forEach((s) => {
    s.g = s.g.map(([t, f, note]) => ({ t, f, note }));
    s.F = s.g.flatMap((x) => x.f);
    s.F.forEach((f) => (f.k = s.k + '_' + f.n));
  });
  const fm = {};
  S.forEach((s) => s.F.forEach((f) => (fm[f.k] = f)));
  return {
    SECS: S,
    FM: fm,
    ALL: wfOrder(
      [
        ...S,
        { k: 'pla', t: 'Loss assessment (BOQ)' },
        { k: 'photos', t: 'Photos & annexes' },
        { k: 'report', t: 'Data review' },
        { k: 'spot', t: 'Spot report' },
        { k: 'prelim', t: 'Preliminary report' },
        { k: 'final', t: 'Final report' },
      ],
      WF_GROUPS_P
    ),
  };
}

const PCT = [
  'Fire',
  'Flood / inundation',
  'Earthquake / landslide',
  'Lightning',
  'Burglary / theft',
  'Explosion',
  'Storm / wind',
  'Other',
];

const PS = [
  {
    k: 'case',
    t: 'Case information',
    g: [
      [
        'General case information',
        [
          F('claimNo', 'Insurance claim no.', T, { r: 1, ...NO }),
          F('policyNo', 'Policy number', T, { r: 1, ...NO }),
          F('company', 'Insurance company', LST, { r: 1, o: insurerNames }),
          F('surveyor', 'Surveyor name', T, { r: 1 }),
          F('lic', 'Surveyor licence no.', T, { r: 1 }),
          F('survey', 'Survey date', D_, { r: 1 }),
          F('acc', 'Date of loss', D_, { r: 1 }),
          F('loc', 'Loss / risk location', T, { r: 1 }),
          sel('ctype', 'Cause of loss', PCT, { r: 1 }),
          sel('hasTP', 'Is any third party involved?', ['Yes', 'No'], {
            r: 1,
            h: 'No keeps the third-party answers out of this case; Yes opens them.',
          }),
        ],
      ],
    ],
  },
  {
    k: 'pol',
    t: 'Policy details',
    g: [
      [
        'Policy particulars',
        [
          sel(
            'type',
            'Policy type',
            [
              'Fire & special perils',
              'Burglary / theft',
              'Property all risk',
              'Engineering / contractors',
              'Other',
            ],
            { r: 1 }
          ),
          F('issue', 'Issue date', D_, { r: 1 }),
          F('start', 'Commencement date', D_, { r: 1 }),
          F('end', 'Expiry date', D_, { r: 1 }),
          F('insured', 'Name of insured', T, { r: 1 }),
          F('addr', 'Address of insured'),
          F('tel', 'Contact number', P),
          F('sumB', 'Sum insured – building (NPR)', M),
          F('sumC', 'Sum insured – contents / stock (NPR)', M),
          F('ex', 'Excess / deductible (NPR)', M),
          F('bank', 'Bank / mortgagee interest'),
          F('endors', 'Endorsements / special conditions', A),
        ],
      ],
      [
        'Policy verification',
        [
          sel('v1', 'Policy document', ['Obtained', 'Pending', 'Not available'], { r: 1 }),
          sel('v2', 'Policy period checked', VER),
          sel('v3', 'Insured name', VER),
          sel('v4', 'Risk address matches policy', VER),
        ],
      ],
    ],
  },
  {
    k: 'risk',
    t: 'Insured property',
    g: [
      [
        'Property / risk details',
        [
          sel(
            'kind',
            'Property type',
            [
              'Residential building',
              'Commercial building',
              'Industrial plant',
              'Warehouse / stock',
              'Machinery / equipment',
              'Other',
            ],
            { r: 1 }
          ),
          F('addr', 'Risk location address', T, { r: 1 }),
          sel('constr', 'Construction', [
            'RCC frame',
            'Load-bearing masonry',
            'Steel / PEB',
            'Timber / mud',
            'Other',
          ]),
          F('floors', 'Number of floors', N, { min: 0, max: 200, int: 1 }),
          F('area', 'Built-up area (sq. ft)', N, { min: 0 }),
          F('year', 'Year of construction', N, {
            min: 1900,
            max: new Date().getFullYear(),
            int: 1,
          }),
          F('occ', 'Occupancy / use'),
          sel('own', 'Occupancy status', ['Owner occupied', 'Tenant', 'Vacant']),
          F('prot', 'Fire / security protections'),
          sel('prev', 'Previous damage', ['None', 'Yes']),
          F('prevD', 'Previous damage description', A),
        ],
      ],
      [
        'Owner / occupant',
        [
          nm('oName', 'Owner / occupant name', { r: 1 }),
          F('oTel', 'Contact number', P),
          F('rel', 'Relationship to insured'),
        ],
      ],
    ],
  },
  {
    k: 'inc',
    t: 'Incident details',
    g: [
      [
        'Incident particulars',
        [
          F('time', 'Time of loss', H),
          F('cause', 'Reported cause of loss', T, { r: 1 }),
          F('origin', 'Origin / point of loss'),
          sel('auth', 'Fire brigade / police informed', YNP),
          F('authR', 'Authority and report no.'),
          sel('wit', 'Witnesses available', YN),
          sel('media', 'Photos / videos available', YN),
          F('mitig', 'Salvage / mitigation steps taken', A),
          F('narr', 'Brief incident narrative', A, { gen: 'n', r: 1 }),
        ],
      ],
    ],
  },
  {
    k: 'dmg',
    t: 'Damage assessment',
    g: [
      [
        'Damage summary',
        [
          F('date', 'Date of inspection', D_, { r: 1 }),
          sel('sev', 'Overall damage severity', SEV, { r: 1 }),
          F('extent', 'Extent of damage', A, { r: 1 }),
          F('bldg', 'Building / structure damage', A),
          F('cont', 'Contents / stock damage', A),
          F('mach', 'Machinery damage', A),
          F('areas', 'Areas affected'),
          sel('safe', 'Property safe to occupy', YNP),
          sel('more', 'Further inspection required', YN),
          F('rem', 'Remarks', A),
        ],
      ],
    ],
  },
  {
    k: 'est',
    t: 'Loss estimate',
    g: [
      [
        'Estimated loss (NPR)',
        [
          F('bld', 'Building / structure', M, { r: 1 }),
          F('cont', 'Contents', M),
          F('mach', 'Machinery / equipment', M),
          F('stk', 'Stock', M),
          F('oth', 'Other (debris removal, fees)', M),
          F('t', 'TOTAL ESTIMATED LOSS', C, { sum: ['bld', 'cont', 'mach', 'stk', 'oth'] }),
        ],
        'Preliminary estimate only. Apply excess, salvage, average and policy terms after verification.',
      ],
    ],
  },
  {
    k: 'concl',
    t: 'Conclusion',
    g: [
      ['Preliminary conclusion', [F('text', 'Conclusion', A, { gen: 'c', r: 1, rows: 6 })]],
      [
        'Surveyor sign-off',
        [
          nm('name', 'Surveyor name', { r: 1 }),
          F('lic', 'Licence no.', T, { r: 1 }),
          F('date', 'Date', D_, { r: 1 }),
        ],
      ],
    ],
  },
];

function Xp() {
  const o = [],
    a = (k, m, w) => o.push({ k, m, w }),
    dd = (k) => (/^\d{4}-\d{2}-\d{2}$/.test(g(k)) ? dt(g(k)) : null),
    n = (k) => Number(g(k)) || 0,
    ad = dd('case_acc'),
    c = dd('pol_start'),
    e = dd('pol_end'),
    sd = dd('case_survey'),
    di = dd('dmg_date');
  if (c && e && e <= c) a('pol_end', 'Expiry must be after commencement');
  if (ad && c && e && (ad < c || ad > e))
    a('case_acc', 'Loss date is outside the policy period – verify cover');
  if (sd && ad && sd < ad) a('case_survey', 'Survey date is before the date of loss');
  if (sd && sd > new Date()) a('case_survey', 'Survey date is in the future', 1);
  if (di && ad && di < ad) a('dmg_date', 'Inspection is before the date of loss');
  const si = n('pol_sumB') + n('pol_sumC');
  if (si && n('est_t') > si)
    a('est_t', 'Estimate exceeds total sum insured – check limits / underinsurance', 1);
  return o;
}

function narrP() {
  return `The loss occurred on ${dtf(g('case_acc')) || '[date]'}${g('inc_time') ? ' at ' + t12(g('inc_time')) : ''} at ${g('case_loc') || '[location]'}. Reported cause: ${Lw(g('inc_cause')) || Lw(g('case_ctype')) || '[cause]'}${g('inc_origin') ? ', originating at ' + g('inc_origin') : ''}. Authorities informed: ${Lw(g('inc_auth')) || 'not recorded'}${g('inc_authR') ? ' (' + g('inc_authR') + ')' : ''}.${g('inc_mitig') ? ' Mitigation: ' + g('inc_mitig') : ''}`;
}

function concP() {
  return `Based on the preliminary inspection, the insured ${Lw(g('risk_kind')) || 'property'}${g('risk_addr') ? ' at ' + g('risk_addr') : ''} sustained ${Lw(g('dmg_sev')) || '[severity]'} damage due to ${Lw(g('inc_cause')) || Lw(g('case_ctype')) || 'the reported cause'}. The total preliminary estimated loss is ${money(g('est_t'))}, subject to supporting documents, verification of quantities and values, and applicable policy terms, conditions and excess.`;
}

MODS.property = {
  name: 'Property claim survey',
  title: 'PROPERTY PRELIMINARY SURVEY REPORT',
  ...norm(PS),
  X: Xp,
  narr: narrP,
  concl: concP,
  pc: ['cov', 'est', 'acc', 'iv', 'oth'],
  pn: {
    cov: 'Cover photo (insured property)',
    est: 'Contractor / repair estimate',
    acc: 'Loss scene photographs',
    iv: 'Damaged property photographs',
    oth: 'Other documents',
  },
};
