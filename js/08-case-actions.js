/* Workflow stages, withCase(), show dashboard, new case dialog
   Loaded as a classic script: everything here shares the global scope. Order of <script> tags in index.html matters. */

const STG = [
    'Intimation',
    'Initial Review',
    'Physical Inspection',
    'Preliminary Report',
    'Document Collection',
    'Final Assessment',
    'Final Report Preparation',
    'Submission',
    'Rectification',
    'Resubmission',
    'Survey Complete',
  ],
  STC = [
    '#0b7fa5',
    '#0b5fa5',
    '#7c3aed',
    '#0f766e',
    '#c2410c',
    '#1d4ed8',
    '#6d28d9',
    '#2563eb',
    '#b45309',
    '#b91c1c',
    '#15803d',
  ],
  OLDMAP = {
    Assigned: 'Intimation',
    'Survey scheduled': 'Initial Review',
    'Inspection done': 'Physical Inspection',
    'Documents pending': 'Document Collection',
    'Report drafted': 'Final Report Preparation',
    'Report submitted': 'Submission',
    'Insurer query': 'Rectification',
    Settled: 'Survey Complete',
    Closed: 'Survey Complete',
  },
  today = () => {
    const d = new Date();
    return (
      d.getFullYear() +
      '-' +
      String(d.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(d.getDate()).padStart(2, '0')
    );
  },
  act = (c) => c.st !== 'Survey Complete';

let FL = { q: '', t: '', s: '' },
  view = 'dash';

function withCase(c, fn) {
  const o = [Dd, MOD, SECS, FM, ALL];
  Dd = c;
  MOD = MODS[c.mod] || MODS.motor;
  SECS = MOD.SECS;
  FM = MOD.FM;
  ALL = MOD.ALL;
  try {
    return fn();
  } finally {
    [Dd, MOD, SECS, FM, ALL] = o;
  }
}

function showDash() {
  view = 'dash';
  if (cur && DB[cur]) sv(1);
  $('#dash').hidden = false;
  $('#dash').classList.remove('dash-cases');
  $('.app').hidden = true;
  ['#cs', '#del', '#dx'].forEach((s) => ($(s).hidden = true));
  $('#cm').hidden = true;
  $('#ct').hidden = true;
  if (!document.querySelector('#side .mi.on')) setMenu('db');
  drawDash();
  window.scrollTo(0, 0);
  rememberPlace();
}

function showAllCases() {
  view = 'cases';
  $('#dash').hidden = false;
  $('#dash').classList.add('dash-cases');
  $('.app').hidden = true;
  ['#cs', '#del', '#dx'].forEach((s) => ($(s).hidden = true));
  $('#cm').hidden = true;
  $('#ct').hidden = true;
  $('#dash').replaceChildren(renderAllCasesView());
  setMenu('mc');
  window.scrollTo(0, 0);
  rememberPlace();
}

function openNew() {
  $('#nc').value = '';
  $('#nf').value = '';
  $('#nm').textContent = '';
  $('#nd').showModal();
}

function impOpen() {
  $('#dt').value = '';
  $('#dm').textContent = '';
  $('#dlg').showModal();
}

$('#nk').onclick = () => {
  const cn = $('#nc').value.trim();
  const c = blank(document.querySelector('[name=ty]:checked').value);
  if (cn) c.f.case_claimNo = cn;
  c.due = $('#nf').value;
  DB[c.id] = c;
  $('#nd').close();
  openCase(c.id);
};

$('#nq').onclick = () => $('#nd').close();
