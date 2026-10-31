/* Motor claim form schema (SECS), navigation list, module registry (MODS)
   Loaded as a classic script: everything here shares the global scope. Order of <script> tags in index.html matters. */

let SECS = [
  {
    k: 'case',
    t: 'Case information',
    g: [
      [
        'General case information',
        [
          F('claimNo', 'Insurance claim no.', T, { r: 1, ...NO }),
          F('policyNo', 'Policy number', T, { r: 1, ...NO }),
          F('company', 'Insurance company', T, { r: 1 }),
          F('surveyor', 'Surveyor name', T, { r: 1 }),
          F('lic', 'Surveyor licence no.', T, { r: 1, h: 'e.g. 1266/078/79' }),
          F('survey', 'Survey date', D_, { r: 1 }),
          F('acc', 'Accident date (AD)', D_, { r: 1 }),
          F('accBS', 'Accident date (BS)', T, {
            rx: /^20\d\d[-\/](0[1-9]|1[0-2])[-\/](0[1-9]|[12]\d|3[0-2])$/,
            e: 'Use YYYY-MM-DD, e.g. 2083-06-18',
            h: 'YYYY-MM-DD',
          }),
          F('loc', 'Accident location', T, { r: 1 }),
          F('insReg', 'Insured vehicle reg. no. (policy)', T, { r: 1, ...REG }),
          F('tpReg', 'Third-party vehicle reg. no.', T, REG),
          sel(
            'status',
            'Survey status',
            ['Preliminary Survey', 'Final Survey', 'Spot Survey', 'Re-inspection'],
            { r: 1 }
          ),
          sel('ctype', 'Claim / loss type', CT, { r: 1 }),
          F('ctypeO', 'If other, describe'),
          F(
            'hasTP',
            'Third party involved (tick to add third-party details to the form and report)',
            'k'
          ),
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
          F('branch', 'Branch / office'),
          sel(
            'type',
            'Policy type',
            ['Full insurance (comprehensive)', 'Third-party only', 'Other'],
            { r: 1 }
          ),
          F('issue', 'Issue date', D_, { r: 1 }),
          F('start', 'Commencement date', D_, { r: 1 }),
          F('end', 'Expiry date', D_, { r: 1 }),
          F('insured', 'Name of insured', T, { r: 1 }),
          F('addr', 'Address of insured'),
          F('tel', 'Contact number', P),
          F('sum', 'Sum insured (NPR)', M, { r: 1 }),
          F('idv', 'Insured declared value, IDV (NPR)', M, { r: 1 }),
          F('exC', 'Compulsory excess (NPR)', M),
          F('exO', 'Optional excess (NPR)', M),
          F('endors', 'Additional covers / endorsements', A),
          F('limits', 'Geographical limits / use restrictions', A),
        ],
      ],
      [
        'Insured vehicle as per policy',
        [
          F('reg', 'Registration no.', T, { r: 1, ...REG }),
          sel('vtype', 'Vehicle type', VT, { r: 1 }),
          F('make', 'Make', T, { r: 1 }),
          F('model', 'Model'),
          F('year', 'Manufacturing year', N, YR),
          F('eng', 'Engine no.', T, ENG),
          F('chs', 'Chassis no.', T, ENG),
          F('seats', 'Seating capacity', N, { min: 1, max: 100, int: 1 }),
          sel('use', 'Use / purpose', ['Private', 'Commercial', 'Hire', 'Goods carrier', 'Other']),
          F('acs', 'Declared accessories'),
        ],
      ],
      [
        'Policy verification',
        [
          sel('v1', 'Policy document', ['Obtained', 'Pending', 'Not available'], { r: 1 }),
          sel('v2', 'Policy period checked', VER),
          sel('v3', 'Insured name', VER),
          sel('v4', 'Registration no.', VER),
          sel('v5', 'Engine / chassis', VER),
          sel('v6', 'Endorsements', VER),
          sel('v7', 'Discrepancies identified', YN),
          F('v8', 'Details of discrepancies', A),
        ],
      ],
    ],
  },
  {
    k: 'fp',
    t: '1st party – insured',
    g: [
      [
        'Insured vehicle',
        [
          F('reg', 'Registration no.', T, { r: 1, ...REG }),
          F('prevReg', 'Previous reg. no. (if re-registered)', T, REG),
          sel('type', 'Vehicle type', VT, { r: 1 }),
          F('mm', 'Make and model', T, { r: 1 }),
          F('colour', 'Colour'),
          F('year', 'Manufacturing year', N, YR),
          F('eng', 'Engine no.', T, { r: 1, ...ENG }),
          F('chs', 'Chassis no.', T, { r: 1, ...ENG }),
          F('loc', 'Current vehicle location'),
          sel('run', 'Running condition', RC, { r: 1 }),
          sel('avail', 'Available for inspection', YN),
          sel('blue', 'Bluebook available', YNP),
          sel('photos', 'Photographs taken', YN),
          sel('prev', 'Previous damage', ['None', 'Yes']),
          F('prevD', 'Previous damage description', A),
        ],
      ],
      [
        'Registered owner / insured',
        [
          nm('oName', 'Owner / insured name', { r: 1 }),
          sel('oType', 'Owner type', OWN),
          F('perm', 'Permanent address'),
          F('cur', 'Current address'),
          F('tel', 'Contact number', P, { r: 1 }),
          F('verAg', 'Ownership verified against'),
          F('rel', 'Relationship to policyholder'),
        ],
      ],
      [
        'Driver',
        [
          nm('dName', 'Driver name', { r: 1 }),
          F('dTel', 'Contact number', P),
          F('dAddr', 'Address'),
          F('dlNo', 'Driving licence no.', T, { r: 1, ...DL }),
          F('dlCat', 'Licence categories (tick all held)', 'mc', { o: LC }),
          F('dlIssue', 'Licence issue date', D_),
          F('dlExp', 'Licence expiry date', D_),
          sel('dlVer', 'Licence verification', VER),
          F('dRel', 'Relationship to owner'),
          sel('dPres', 'Present during inspection', YN),
          sel('dStmt', 'Statement obtained', YN),
          F('dStmtR', 'Statement reference / remarks'),
        ],
      ],
    ],
  },
  {
    k: 'tp',
    t: '3rd party',
    g: [
      [
        'Third-party vehicle',
        [
          F('reg', 'Registration no.', T, REG),
          sel('type', 'Vehicle type', VT),
          F('mm', 'Make and model'),
          F('colour', 'Colour'),
          F('year', 'Manufacturing year', N, YR),
          F('eng', 'Engine no.', T, ENG),
          F('chs', 'Chassis no.', T, ENG),
          F('loc', 'Current location'),
          sel('run', 'Running condition', RC),
          sel('insp', 'Physically inspected', YN),
          sel('photos', 'Photographs obtained', YN),
          sel('blue', 'Bluebook available', YNP),
          sel('est', 'Repair estimate available', YNP),
          sel('prev', 'Previous damage observed', YN),
          F('rem', 'Remarks', A),
        ],
      ],
      [
        'Third-party owner',
        [
          nm('oName', 'Owner name'),
          sel('oType', 'Owner type', OWN),
          F('addr', 'Address'),
          F('tel', 'Contact number', P),
          sel('ownVer', 'Ownership verified', YNP),
          F('ownDoc', 'Ownership document'),
          F('oRem', 'Remarks', A),
        ],
      ],
      [
        'Third-party driver',
        [
          nm('dName', 'Driver name'),
          F('dTel', 'Contact number', P),
          F('dAddr', 'Address'),
          F('dlNo', 'Driving licence no.', T, DL),
          F('dlCat', 'Licence categories (tick all held)', 'mc', { o: LC }),
          F('dlExp', 'Licence expiry date', D_),
          sel('dlVer', 'Licence verification', VER),
          F('rel', 'Relationship to owner'),
          sel('stmt', 'Statement obtained', YN),
          F('dRem', 'Remarks', A),
        ],
      ],
    ],
  },
  {
    k: 'acc',
    t: 'Accident background',
    g: [
      [
        'Accident particulars',
        [
          F('time', 'Accident time', H),
          F('place', 'Exact location', T, { r: 1 }),
          F('muni', 'Municipality / district', T, { r: 1 }),
          F('road', 'Road name / highway'),
          sel('roadT', 'Road type', ['Urban', 'Rural', 'Highway']),
          sel('surf', 'Road surface', ['Asphalt', 'Concrete', 'Gravel', 'Earthen', 'Other']),
          sel('cond', 'Road condition', ['Dry', 'Wet', 'Slippery', 'Under repair']),
          sel('wx', 'Weather', ['Clear', 'Rain', 'Fog', 'Cloudy']),
          sel('vis', 'Visibility', ['Good', 'Moderate', 'Poor']),
          sel('light', 'Lighting', [
            'Daylight',
            'Dusk / dawn',
            'Night – street lit',
            'Night – unlit',
          ]),
          F('vehicles', 'Vehicles involved', N, { r: 1, min: 1, max: 20, int: 1 }),
          F('injured', 'Injured persons', N, { min: 0, max: 200, int: 1 }),
          F('fatal', 'Fatalities', N, { min: 0, max: 200, int: 1 }),
          sel('police', 'Police informed', YN),
          F('station', 'Police station'),
          F('reportNo', 'Police report no.'),
          sel('reportAvail', 'Police report available', YNP),
          sel('witness', 'Witnesses available', YN),
          sel('media', 'Photos / videos available', YN),
        ],
      ],
      ['Movement – insured vehicle', mv('I')],
      ['Movement – third-party vehicle', mv('T')],
      [
        'Statements and findings',
        [
          F('vI', 'Insured driver’s version', A),
          F('vT', 'Third-party driver’s version', A),
          F('wit', 'Witness statement', A),
          F('pol', 'Police report / record', A),
          F('phys', 'Physical evidence observed', A),
          F('obs', 'Surveyor’s independent observations', A),
          F('cause', 'Reported cause of accident', T, { r: 1 }),
          sel('further', 'Further investigation required', YN),
          F('furtherD', 'Details of further investigation', A),
          F('narr', 'Brief accident narrative', A, { gen: 'n', r: 1 }),
        ],
      ],
    ],
  },
  {
    k: 'd1',
    t: 'Damage – 1st party',
    g: [
      [
        'Insured vehicle damage',
        [
          F('date', 'Date of inspection', D_, { r: 1 }),
          F('place', 'Place of inspection'),
          sel('itype', 'Inspection type', ['Physical', 'Photo-based', 'Workshop', 'Remote']),
          sel('sev', 'Overall damage severity', SEV, { r: 1 }),
          F('area', 'Main impact area'),
          sel('mech', 'Mechanical damage suspected', MD),
          sel('struct', 'Structural damage suspected', MD),
          sel('airbag', 'Airbag deployed', YN),
          sel('photos', 'Photographs reference', YN),
          sel('est', 'Workshop estimate available', YNP),
          sel('more', 'Additional inspection required', YN),
          F('rem', 'Remarks', A),
        ],
      ],
      [
        'Insured driver injury',
        [
          sel('inj', 'Injury reported', YN),
          nm('name', 'Driver name'),
          F('desc', 'Injury description'),
          F('hosp', 'Hospital / treatment centre'),
          sel('medRep', 'Medical report available', YNP),
          F('med', 'Medical expenses claimed (NPR)', M),
          F('docs', 'Supporting documents'),
          F('rem2', 'Remarks', A),
        ],
      ],
    ],
  },
  {
    k: 'd2',
    t: 'Damage – 3rd party',
    g: [
      [
        'Third-party vehicle damage',
        [
          F('date', 'Inspection date', D_),
          F('place', 'Inspection location'),
          sel('insp', 'Physically inspected', YN),
          sel('sev', 'Overall damage severity', SEV),
          F('area', 'Main impact area'),
          sel('mech', 'Mechanical damage suspected', MD),
          sel('struct', 'Structural damage suspected', MD),
          sel('photos', 'Photographs obtained', YN),
          sel('est', 'Repair estimate', ['Available', 'Not required', 'Pending']),
          sel('indep', 'Independent inspection required', YN),
          F('rem', 'Remarks', A),
        ],
      ],
      [
        'Third-party driver injury',
        [
          sel('inj', 'Injury reported', YN),
          F('desc', 'Injury description'),
          F('hosp', 'Hospital / treatment centre'),
          F('med', 'Medical expenses (NPR)', M),
        ],
      ],
    ],
  },
  {
    k: 'loss',
    t: 'Loss estimate',
    g: [
      [
        'First-party estimated loss (NPR)',
        [
          F('veh', 'Insured vehicle damage', M, { r: 1 }),
          F('oth', 'Other insured property damage', M),
          F('med', 'Driver injury (medical)', M),
          F('pax', 'Passenger injury, if covered', M),
          F('t1', 'TOTAL FIRST-PARTY LOSS', C, { sum: ['veh', 'oth', 'med', 'pax'] }),
        ],
      ],
      [
        'Third-party estimated loss (NPR)',
        [
          F('tveh', 'Third-party vehicle', M),
          F('tinj', 'Third-party driver injury', M),
          F('tpax', 'Third-party passenger injury', M),
          F('toth', 'Other third-party property', M),
          F('t2', 'TOTAL THIRD-PARTY LOSS', C, { sum: ['tveh', 'tinj', 'tpax', 'toth'] }),
        ],
      ],
      [
        'Combined',
        [F('t3', 'TOTAL COMBINED ESTIMATED LOSS', C, { sum: ['t1', 't2'] })],
        'Preliminary estimate and final admissible claim differ. Apply policy terms, deductions and adjustments only after verification.',
      ],
    ],
  },
  {
    k: 'fin',
    t: 'Final assessment',
    g: [
      [
        'Surveyor’s assessment inputs (NPR)',
        [
          F('dep', 'Depreciation / betterment deduction', M),
          F('salv', 'Salvage value', M),
          F('oth', 'Other deductions', M),
          F('basis', 'Basis of assessment (parts, labour, rates, policy conditions)', A),
          F('rem', 'Surveyor’s remarks / recommendation', A),
        ],
        'Repair and medical bills are entered under “Bills & expenses”. Policy excess is taken from the policy details. Used in the final report.',
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

SECS.forEach((s) => {
  s.g = s.g.map(([t, f, note]) => ({ t, f, note }));
  s.F = s.g.flatMap((x) => x.f);
  s.F.forEach((f) => (f.k = s.k + '_' + f.n));
});

let FM = {};

SECS.forEach((s) => s.F.forEach((f) => (FM[f.k] = f)));

let ALL = [
  ...SECS,
  { k: 'photos', t: 'Photos & annexes' },
  { k: 'bills', t: 'Bills & expenses' },
  { k: 'report', t: 'Data review' },
  { k: 'prelim', t: 'Preliminary report' },
  { k: 'final', t: 'Final report' },
];

const NAV = [];

const hasTP = () => g('case_hasTP') === 'Yes',
  TPK = new Set([
    'case_tpReg',
    'loss_tveh',
    'loss_tinj',
    'loss_tpax',
    'loss_toth',
    'loss_t2',
    'acc_vT',
    'acc_dirT',
    'acc_laneT',
    'acc_mvT',
    'acc_spdT',
    'acc_impT',
    'acc_aftT',
  ]),
  hid = (f) => f.k === 'case_accBS' || (TPK.has(f.k) && !hasTP());

SECS.forEach((s) => {
  if (s.k === 'tp' || s.k === 'd2') s.show = hasTP;
});

const vis = (s) => !s.show || s.show();

function syncNav() {
  NAV.length = 0;
  NAV.push(...ALL.filter(vis));
  syncPC();
  if (!NAV.some((s) => s.k === sec)) sec = 'case';
}

const MODS = {
  motor: {
    name: 'Motor claim survey',
    title: 'MOTOR VEHICLE PRELIMINARY SURVEY REPORT',
    SECS,
    FM,
    ALL,
    // wrappers are resolved at call time because these functions live in later script files
    X: () => X(),
    narr: () => narr(),
    concl: () => concl(),
  },
};

let MOD = MODS.motor;
