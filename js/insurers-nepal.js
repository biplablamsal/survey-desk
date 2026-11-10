/* Central insurer master list for Nepal — non-life and micro non-life licences only.
   Loaded as a classic script; shared global scope, so every module can read NIA_NONLIFE.

   Source: Nepal Insurance Authority (nia.gov.np) business statistics published 09 Oct 2026
   ("Monthly non life & micro non life insurance business", Bhadra 2083), which names exactly
   14 non-life and 4 micro non-life (लघु बीमा) licensees. Life, micro-life and reinsurance
   companies are deliberately absent — a surveyor never files a motor or property damage claim
   against them.

   Nepal drove a sector-wide merger wave to meet the NPR 2.5 arba paid-up capital rule, so names
   kept in older lists are wrong: Sagarmatha and Lumbini General are now one company, as are
   IME General + Prudential, United + Ajod, Himalayan General + Everest, Sanima General + GICN and
   Siddhartha + Premier. `a` carries the merged-away names purely so that typing an old name still
   finds the surviving licensee; the old names are never offered as values.

   Legal-name suffixes ("Limited" vs "Company Limited") follow NIA's own workbooks. */

const NIA_NONLIFE = [
  { m: 'NLG', n: 'NLG Insurance Company Limited', s: 'NLG', c: 'nl', a: ['nepal lg', 'nlgi'] },
  {
    m: 'Nepal Insurance (NICL)',
    n: 'Nepal Insurance Company Limited',
    s: 'NICL',
    c: 'nl',
    a: ['nicl', 'nic', 'nepal insurance', 'the nepal insurance'],
  },
  {
    m: 'National',
    n: 'National Insurance Company Limited',
    s: 'NICLL',
    c: 'nl',
    a: ['national insurance', 'nicll'],
  },
  {
    m: 'Oriental',
    n: 'The Oriental Insurance Company Limited',
    s: 'ORIENTAL',
    c: 'nl',
    a: ['oriental insurance', 'the oriental'],
  },
  {
    m: 'Rastriya Beema (RBCL)',
    n: 'Rastriya Beema Company Limited',
    s: 'RBCL',
    c: 'nl',
    a: ['rbcl', 'rashtriya', 'rastriya', 'national beema', 'govt insurance'],
  },
  { m: 'Neco', n: 'Neco Insurance Limited', s: 'NIL', c: 'nl', a: ['neco', 'nil', 'chowk group'] },
  { m: 'Prabhu', n: 'Prabhu Insurance Limited', s: 'PRIN', c: 'nl', a: ['prabhu', 'prin'] },
  {
    m: 'Shikhar',
    n: 'Shikhar Insurance Company Limited',
    s: 'SICL',
    c: 'nl',
    a: ['shikhar', 'sicl', 'shikhar insurance'],
  },
  {
    m: 'Himalayan Everest',
    n: 'Himalayan Everest Insurance Limited',
    s: 'HEI',
    c: 'nl',
    a: ['hei', 'himalayan', 'everest', 'hgic', 'eic', 'himalayan general'],
  },
  {
    m: 'Sanima GIC',
    n: 'Sanima GIC Insurance Limited',
    s: 'SGIC',
    c: 'nl',
    a: ['sanima', 'sgic', 'gic', 'general insurance company nepal'],
  },
  {
    m: 'Siddhartha Premier',
    n: 'Siddhartha Premier Insurance Limited',
    s: 'SPIL',
    c: 'nl',
    a: ['spil', 'siddhartha', 'premier', 'sid', 'siddhartha insurance'],
  },
  {
    m: 'Sagarmatha Lumbini (SALICO)',
    n: 'Sagarmatha Lumbini Insurance Company Limited',
    s: 'SALICO',
    c: 'nl',
    a: ['salico', 'sagarmatha', 'lumbini', 'lgil', 'sbib'],
  },
  {
    m: 'IGI Prudential',
    n: 'IGI Prudential Insurance Limited',
    s: 'IGI',
    c: 'nl',
    a: ['igi', 'prudential', 'ime general', 'picl', 'igi prudential'],
  },
  {
    m: 'United Ajod',
    n: 'United Ajod Insurance Limited',
    s: 'UAIL',
    c: 'nl',
    a: ['uail', 'united', 'ajod', 'united insurance nepal'],
  },
  {
    m: 'Nepal Micro',
    n: 'Nepal Micro Insurance Company Limited',
    s: 'NMIC',
    c: 'mn',
    a: ['nmic', 'nepal micro', 'micro nepal', 'bagmati micro'],
  },
  {
    m: 'Star Micro',
    n: 'Star Micro Insurance Company Limited',
    s: 'SMIC',
    c: 'mn',
    a: ['smic', 'star micro', 'madhesh micro'],
  },
  {
    m: 'Protective Micro',
    n: 'Protective Micro Insurance Limited',
    s: '',
    c: 'mn',
    a: ['protective', 'protective micro', 'sudurpashchim micro', 'dhangadhi micro'],
  },
  {
    m: 'Trust Micro',
    n: 'Trust Micro Insurance Limited',
    s: '',
    c: 'mn',
    a: ['trust', 'trust micro', 'lumbini micro', 'tilottama micro'],
  },
];

/* NIA category codes expanded once, for labels and for the "Non-life / Micro non-life" badge. */
const NIA_CAT = {
  nl: { t: 'Non-life', long: 'Non-life (general) insurer' },
  mn: { t: 'Micro non-life', long: 'Micro non-life insurer (लघु बीमा)' },
};

const ns = (s) =>
    String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, ''),
  /* Ranked so the closest label wins, and an exact symbol beats a partial name hit. */
  niq = (q) => {
    const needle = (q || '').trim().toLowerCase();
    if (!needle) return NIA_NONLIFE.map((x) => ({ x, rank: 3 }));
    const tight = ns(needle);
    return NIA_NONLIFE.map((x) => {
      const labels = [x.m, x.n, x.s, ...x.a].filter(Boolean).map((y) => y.toLowerCase());
      const hit =
        labels.some((y) => y === needle) || ns(x.m) === tight || ns(x.n) === tight
          ? 0
          : labels.some((y) => y.startsWith(needle)) || ns(x.n).startsWith(tight)
            ? 1
            : labels.some((y) => y.includes(needle)) || ns(x.n).includes(tight)
              ? 2
              : -1;
      return { x, rank: hit };
    })
      .filter((r) => r.rank >= 0)
      .sort((a, b) => a.rank - b.rank || a.x.m.localeCompare(b.x.m));
  };

/* Legal names in licence order, for the fields that offer insurers as a dropdown. Kept here so the
   form schema never carries its own copy of the master list. */
const insurerNames = () => NIA_NONLIFE.map((x) => x.n);
