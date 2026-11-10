/* End-to-end check of the case registry — brief §5's foundation and §9D's duplicate detection —
   against the live server on 3000.

   The suites that came before this one stop at accounts and permissions; this one is the first to
   put rows in a business table, so it is written to leave nothing behind: every case it makes is
   deleted by id, every audit row naming a probe is removed, and the final count of probe users,
   probe cases and probe audit entries is printed rather than assumed.

   Everything runs on throwaway accounts under @example.invalid. */
const db = require('../db/index.js');
const argon2 = require('argon2');

const BASE = process.env.RBAC_BASE || 'http://127.0.0.1:3000';
const PASSWORD = 'Case-Probe-2026!';
const results = [];
const record = (name, ok, detail) => results.push({ name, ok: Boolean(ok), detail });

const call = async (pathname, { method = 'GET', cookie, body } = {}) => {
  const res = await fetch(BASE + pathname, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Origin: BASE,
      ...(cookie ? { Cookie: `surveypro_session=${cookie}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
};

const mint = (userId) =>
  db.createSessionForUser(userId, { metadata: { browserName: 'case-probe' } });

const stamp = Date.now();
const email = (who) => `case-${who}-${stamp}@example.invalid`;

/* The shape the browser actually sends: the case object with its flat f map. Only the fields the
   server indexes are filled here, plus one custom key (x) that must survive untouched. */
const caseBody = (over = {}) => ({
  id: over.id || `probe${stamp}${Math.random().toString(36).slice(2, 7)}`,
  mod: over.mod || 'motor',
  cr: over.cr || stamp - 60000,
  u: over.u || stamp,
  st: over.st || 'Intimation',
  due: over.due || '',
  owner: over.owner || '',
  x: over.x || { marker: 'kept-verbatim' },
  f: {
    case_claimNo: over.claimNo || '',
    case_policyNo: over.policyNo || '',
    case_company: over.insurer || '',
    pol_insured: over.insured || '',
    case_insReg: over.reg || '',
    pol_chs: over.chassis || '',
    pol_eng: over.engine || '',
    case_acc: over.accident || '',
    case_survey: over.survey || '',
    case_surveyor: over.surveyor || '',
    ...(over.f || {}),
  },
});

(async () => {
  /* A run that crashed part-way leaves its probes behind, and one stale case with the same plate is
     enough to make an assertion about the duplicate check read wrongly. Everything this suite writes
     carries its own address prefix and its own four names, so the sweep cannot reach another suite's
     rows — the ownership probes are 'ow-', the account probes are 'rbac-probe@'. */
  const sweep = `email LIKE 'case-%@example.invalid'`;
  const mine = `owner_user_id IN (SELECT id FROM users WHERE ${sweep})
     OR lower(coalesce(assigned_surveyor, '')) IN
        ('case probe surveyor', 'case probe staff', 'named probe surveyor', 'case probe admin')`;
  await db.query(`DELETE FROM cases WHERE ${mine}`);
  await db.query(
    `DELETE FROM audit_logs WHERE actor_user_id IN (SELECT id FROM users WHERE ${sweep})`
  );
  await db.query(`DELETE FROM users WHERE ${sweep}`);

  const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
  const make = async (who, role, fullName) => {
    const user = await db.createUser({
      fullName,
      firstName: fullName.split(' ')[0],
      lastName: fullName.split(' ').slice(1).join(' ') || null,
      email: email(who),
      passwordHash: hash,
      provider: 'email',
      role,
      emailVerified: true,
    });
    await db.query('UPDATE users SET notification_preferences = $2::jsonb WHERE id = $1', [
      user.id,
      JSON.stringify({ securityAlerts: false }),
    ]);
    return user;
  };

  const surveyor = await make('surveyor', 'SURVEYOR', 'Case Probe Surveyor');
  const staff = await make('staff', 'STAFF', 'Case Probe Staff');
  const named = await make('named', 'STAFF', 'Named Probe Surveyor');
  const admin = await make('admin', 'ADMIN', 'Case Probe Admin');

  const cookieSurveyor = await mint(surveyor.id);
  const cookieStaff = await mint(staff.id);
  const cookieNamed = await mint(named.id);
  const cookieAdmin = await mint(admin.id);

  const caseIds = [];
  const putCase = async (cookie, body) => {
    caseIds.push(body.id);
    return call(`/api/cases/${body.id}`, { method: 'PUT', cookie, body });
  };

  /* 1. create, and what the server read out of the payload */
  const own = {
    claimNo: 'CLM-1001',
    policyNo: 'POL-2026-0001',
    insurer: 'Himalayan Everest Insurance',
    insured: 'Ramesh Shrestha',
    reg: 'BA-12-3456',
    chassis: 'CHS99887766',
    engine: 'ENG-5544',
    accident: '2026-09-14',
    survey: '2026-09-21',
    surveyor: 'Case Probe Surveyor',
  };
  const created = await putCase(cookieSurveyor, caseBody(own));
  record(
    'PUT /api/cases/:id opens a new case for a surveyor',
    created.status === 200 && created.json.created === true,
    { status: created.status, code: created.json?.code }
  );
  const row = created.json?.case || {};
  record(
    'the indexed columns come from the fields the form actually writes',
    row.caseNumber === 'CLM-1001' &&
      row.policyNumber === 'POL-2026-0001' &&
      row.insurer === 'Himalayan Everest Insurance' &&
      row.insuredName === 'Ramesh Shrestha' &&
      row.vehicleRegistration === 'BA-12-3456' &&
      row.chassisNumber === 'CHS99887766' &&
      row.engineNumber === 'ENG-5544' &&
      row.accidentDate === '2026-09-14' &&
      row.surveyDate === '2026-09-21' &&
      row.stage === 'Intimation' &&
      row.assignedSurveyor === 'Case Probe Surveyor',
    {
      caseNumber: row.caseNumber,
      insurer: row.insurer,
      assignedSurveyor: row.assignedSurveyor,
      stage: row.stage,
    }
  );
  record(
    'the client timestamps are kept as instants rather than re-invented',
    row.createdAt === new Date(stamp - 60000).toISOString() &&
      row.modifiedAt === new Date(stamp).toISOString(),
    { createdAt: row.createdAt, modifiedAt: row.modifiedAt }
  );
  record('the case is owned by the account that opened it', row.ownerUserId === surveyor.id, {
    owner: row.ownerUserId,
    expected: surveyor.id,
  });

  /* 2. the payload is stored verbatim — the server does not edit fields */
  const opened = await call(`/api/cases/${created.json.case.id}`, { cookie: cookieSurveyor });
  record(
    'GET returns the case object exactly as it was pushed',
    opened.status === 200 &&
      opened.json.case?.payload?.x?.marker === 'kept-verbatim' &&
      opened.json.case?.payload?.f?.case_claimNo === 'CLM-1001',
    { status: opened.status, x: opened.json.case?.payload?.x }
  );

  /* 3. edit the same row, and check the newer copy landed */
  const editedBody = caseBody({ ...own, id: row.id, st: 'Report Submission', u: stamp + 5000 });
  const edited = await call(`/api/cases/${row.id}`, {
    method: 'PUT',
    cookie: cookieSurveyor,
    body: editedBody,
  });
  record(
    'a second save updates rather than duplicates',
    edited.status === 200 &&
      edited.json.created === false &&
      edited.json.case.stage === 'Report Submission',
    { status: edited.status, created: edited.json?.created, stage: edited.json?.case?.stage }
  );

  /* 4. the conflict rule: an older push is refused, and the server keeps what it has */
  const stale = caseBody({
    ...own,
    id: row.id,
    claimNo: 'OVERWRITTEN',
    st: 'Intimation',
    u: stamp - 1,
  });
  const conflict = await call(`/api/cases/${row.id}`, {
    method: 'PUT',
    cookie: cookieSurveyor,
    body: stale,
  });
  record(
    'a push older than the server copy is refused rather than applied',
    conflict.status === 409 && conflict.json.code === 'case_conflict',
    { status: conflict.status, code: conflict.json?.code }
  );
  const afterConflict = await call(`/api/cases/${row.id}`, { cookie: cookieSurveyor });
  record(
    'the refused push changed nothing',
    afterConflict.json.case?.caseNumber === 'CLM-1001' &&
      afterConflict.json.case?.stage === 'Report Submission',
    { caseNumber: afterConflict.json.case?.caseNumber, stage: afterConflict.json.case?.stage }
  );

  /* 5. validation */
  const badId = await call('/api/cases/not%20an%20id', {
    method: 'PUT',
    cookie: cookieSurveyor,
    body: caseBody({}),
  });
  record(
    'a case id that is not the browser format is rejected',
    badId.status === 400 && badId.json.code === 'invalid_case_id',
    { status: badId.status, code: badId.json?.code }
  );
  const mismatch = caseBody({ claimNo: 'X' });
  caseIds.push(mismatch.id);
  const mismatched = await call(`/api/cases/${mismatch.id}`, {
    method: 'PUT',
    cookie: cookieSurveyor,
    body: { ...mismatch, id: `other${stamp}` },
  });
  record(
    'a body naming a different case than the URL is rejected',
    mismatched.status === 400 && mismatched.json.code === 'case_id_mismatch',
    { status: mismatched.status, code: mismatched.json?.code }
  );
  const unauth = await call('/api/cases');
  record('the register is not readable without a session', unauth.status === 401, {
    status: unauth.status,
  });

  /* 6. scope: a staff member with the default thirteen keys sees nothing that is not theirs */
  const staffList = await call('/api/cases', { cookie: cookieStaff });
  record(
    'a staff account lists only cases that name them',
    staffList.status === 200 &&
      staffList.json.scope === 'own' &&
      !staffList.json.cases.some((c) => c.id === row.id),
    {
      status: staffList.status,
      scope: staffList.json?.scope,
      n: (staffList.json?.cases || []).length,
    }
  );
  const staffOpen = await call(`/api/cases/${row.id}`, { cookie: cookieStaff });
  record(
    'a staff account cannot open someone else’s case',
    staffOpen.status === 403 && staffOpen.json.code === 'case_forbidden',
    { status: staffOpen.status, code: staffOpen.json?.code }
  );
  const staffEdit = await call(`/api/cases/${row.id}`, {
    method: 'PUT',
    cookie: cookieStaff,
    body: caseBody({ ...own, id: row.id, u: stamp + 9000, claimNo: 'HIJACKED' }),
  });
  record(
    'edit_case_details does not extend to a case the account is not on',
    staffEdit.status === 403 && staffEdit.json.code === 'case_forbidden',
    { status: staffEdit.status, code: staffEdit.json?.code }
  );
  const staffNew = await putCase(cookieStaff, caseBody({ claimNo: 'STAFF-NEW' }));
  record(
    'a staff account cannot open a new case without create_case',
    staffNew.status === 403 &&
      staffNew.json.code === 'permission_denied' &&
      staffNew.json.permission === 'create_case',
    { status: staffNew.status, permission: staffNew.json?.permission }
  );

  /* 7. being named as the surveyor is what the assignment list keys on */
  const namedCase = await putCase(
    cookieSurveyor,
    caseBody({ claimNo: 'CLM-1002', surveyor: 'Named Probe Surveyor' })
  );
  const namedList = await call('/api/cases', { cookie: cookieNamed });
  record(
    'a staff member named as the surveyor gets the case in their list',
    namedCase.status === 200 &&
      namedList.json.cases.some((c) => c.id === namedCase.json.case.id) &&
      (namedList.json.cases || []).length === 1,
    { status: namedList.status, ids: (namedList.json?.cases || []).map((c) => c.id) }
  );
  const namedEdit = await call(`/api/cases/${namedCase.json.case.id}`, {
    method: 'PUT',
    cookie: cookieNamed,
    body: caseBody({
      id: namedCase.json.case.id,
      claimNo: 'CLM-1002',
      surveyor: 'Named Probe Surveyor',
      st: 'Physical Inspection',
      u: Date.now(),
    }),
  });
  record(
    'and may edit it',
    namedEdit.status === 200 && namedEdit.json.case.stage === 'Physical Inspection',
    { status: namedEdit.status, code: namedEdit.json?.code }
  );

  /* 8. view_all_cases is what separates the register from the to-do list */
  const adminList = await call('/api/cases', { cookie: cookieAdmin });
  record(
    'an administrator sees the whole register',
    adminList.status === 200 &&
      adminList.json.scope === 'all' &&
      [row.id, namedCase.json.case.id].every((id) => adminList.json.cases.some((c) => c.id === id)),
    {
      status: adminList.status,
      scope: adminList.json?.scope,
      n: (adminList.json?.cases || []).length,
    }
  );

  /* 9. the delta pull the sync will use */
  const delta = await call(
    `/api/cases?since=${encodeURIComponent(new Date(Date.now() + 60000).toISOString())}`,
    {
      cookie: cookieAdmin,
    }
  );
  record(
    '?since returns nothing newer than the cut-off',
    delta.status === 200 && delta.json.cases.length === 0,
    { status: delta.status, n: delta.json?.cases?.length }
  );
  const allDelta = await call(
    `/api/cases?since=${encodeURIComponent(new Date(stamp - 10000).toISOString())}`,
    {
      cookie: cookieAdmin,
    }
  );
  record(
    '?since returns the cases touched after an older cut-off',
    allDelta.status === 200 && allDelta.json.cases.length >= 2,
    { status: allDelta.status, n: allDelta.json?.cases?.length }
  );
  const badSince = await call('/api/cases?since=not-a-date', { cookie: cookieAdmin });
  record(
    'a since that cannot be read is a 400 rather than an unfiltered list',
    badSince.status === 400,
    { status: badSince.status }
  );

  /* 9b. the merge pull asks for payloads by name, so one request is enough */
  const bare = await call('/api/cases', { cookie: cookieAdmin });
  const withPayload = await call('/api/cases?payload=1', { cookie: cookieAdmin });
  record(
    'the register does not carry case fields unless the caller asks for them',
    bare.status === 200 &&
      bare.json.cases.every((c) => c.payload === undefined) &&
      withPayload.json.cases.every((c) => c.payload && c.payload.f !== undefined),
    {
      bareKeys: Object.keys(bare.json.cases[0] || {}).length,
      hasPayload: withPayload.json.cases[0]?.payload?.f?.case_claimNo,
    }
  );
  record(
    'a payload pull returns the case object the device sent, fields and all',
    withPayload.json.cases.some((c) => c.id === row.id && c.payload?.x?.marker === 'kept-verbatim'),
    { ids: withPayload.json.cases.map((c) => c.id) }
  );

  /* 10. §9D duplicate detection across the register */
  const twin = await putCase(
    cookieSurveyor,
    caseBody({
      claimNo: 'CLM-2002',
      policyNo: 'POL-2026-9999',
      insurer: 'Himalayan Everest Insurance',
      insured: 'Sita Maharjan',
      /* same vehicle written the other way the form allows */
      reg: 'ba123456',
      chassis: 'chs-9988-7766',
      engine: 'eng5544',
      accident: '2026-09-14',
      surveyor: 'Case Probe Surveyor',
    })
  );
  const similar = await call(`/api/cases/${twin.json.case.id}/similar`, { cookie: cookieSurveyor });
  const match = (similar.json?.cases || []).find((c) => c.id === row.id);
  record(
    'a case with the same vehicle written differently is found',
    twin.status === 200 &&
      similar.status === 200 &&
      Boolean(match) &&
      /vehicle registration/.test(match.matchedOn) &&
      /chassis number/.test(match.matchedOn) &&
      /engine number/.test(match.matchedOn),
    {
      status: similar.status,
      matchedOn: match?.matchedOn,
      hits: (similar.json?.cases || []).length,
    }
  );
  record(
    'the case being checked is not reported as its own duplicate',
    !(similar.json?.cases || []).some((c) => c.id === twin.json.case.id),
    { ids: (similar.json?.cases || []).map((c) => c.id) }
  );
  const unrelated = await putCase(
    cookieSurveyor,
    caseBody({ claimNo: 'CLM-3003', insurer: 'Necolet Insurance', insured: 'No Relation' })
  );
  const noneSimilar = await call(`/api/cases/${unrelated.json.case.id}/similar`, {
    cookie: cookieSurveyor,
  });
  record(
    'an empty field never matches another empty field',
    noneSimilar.status === 200 && (noneSimilar.json?.cases || []).length === 0,
    { status: noneSimilar.status, hits: (noneSimilar.json?.cases || []).length }
  );
  const similarScoped = await call(`/api/cases/${row.id}/similar`, { cookie: cookieStaff });
  record(
    'the duplicate check does not become a way to read cases a staff account cannot open',
    similarScoped.status === 403,
    { status: similarScoped.status }
  );

  /* 11. delete_case is an administration key */
  const staffDelete = await call(`/api/cases/${row.id}`, { method: 'DELETE', cookie: cookieStaff });
  record(
    'a staff account cannot delete a case',
    staffDelete.status === 403 && staffDelete.json.permission === 'delete_case',
    { status: staffDelete.status, permission: staffDelete.json?.permission }
  );
  const adminDelete = await call(`/api/cases/${unrelated.json.case.id}`, {
    method: 'DELETE',
    cookie: cookieAdmin,
  });
  const goneAfter = await call(`/api/cases/${unrelated.json.case.id}`, { cookie: cookieAdmin });
  record(
    'an administrator deletes a case and it stays deleted',
    adminDelete.status === 200 && goneAfter.status === 404,
    { status: adminDelete.status, after: goneAfter.status }
  );

  /* 12. the audit trail names who opened, changed and removed what */
  const audit = await db.query(
    `SELECT action, details FROM audit_logs
     WHERE actor_user_id = $1 AND action LIKE 'case_%'`,
    [surveyor.id]
  );
  const actions = audit.rows.map((r) => r.action);
  record(
    'every write to the register is in the audit log',
    actions.filter((a) => a === 'case_created').length >= 4 &&
      actions.includes('case_updated') &&
      (
        await db.query(
          "SELECT 1 FROM audit_logs WHERE actor_user_id = $1 AND action = 'case_deleted'",
          [admin.id]
        )
      ).rowCount === 1,
    { surveyorActions: actions }
  );
  const auditCarriesId = audit.rows.every((r) => typeof r.details.caseId === 'string');
  record('the audit entry names the case rather than only the actor', auditCarriesId, {
    sample: audit.rows[0]?.details,
  });

  /* ---------- cleanup ---------- */
  const ids = [surveyor, staff, named, admin].map((u) => u.id);
  /* Every case this suite made, including the one whose write was refused and the ones owned by an
     account about to be removed, plus anything left addressed to a probe id. */
  const casesGone = await db.query(
    `DELETE FROM cases WHERE ${mine} OR id = ANY($1::text[]) RETURNING id`,
    [caseIds]
  );
  await db.query(
    `WITH probe AS (SELECT unnest($1::uuid[]) AS id)
     DELETE FROM audit_logs a
     WHERE EXISTS (SELECT 1 FROM probe p WHERE p.id = a.actor_user_id OR p.id = a.target_user_id)`,
    [ids]
  );
  const removed = await db.query('DELETE FROM users WHERE id = ANY($1) RETURNING id', [ids]);

  const leftovers = await db.query(
    `SELECT
       (SELECT count(*)::int FROM users WHERE ${sweep}) AS users,
       (SELECT count(*)::int FROM cases WHERE ${mine}) AS cases,
       (SELECT count(*)::int FROM audit_logs
         WHERE action LIKE 'case_%'
           AND details->>'caseId' LIKE 'probe%') AS audit`
  );
  const left = leftovers.rows[0];
  record(
    'the suite leaves the register and the log exactly as it found them',
    left.users === 0 && left.cases === 0 && left.audit === 0,
    left
  );

  console.log(
    JSON.stringify(
      {
        passed: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        total: results.length,
        cleaned: { cases: casesGone.rowCount, users: removed.rowCount },
        leftovers: left,
        failures: results.filter((r) => !r.ok),
      },
      null,
      1
    )
  );
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})().catch((error) => {
  console.log(
    JSON.stringify({ fatal: String(error && error.message), stack: error && error.stack })
  );
  process.exit(1);
});
