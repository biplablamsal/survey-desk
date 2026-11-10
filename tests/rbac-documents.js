/* End-to-end check of §8 (document verification) against the live server on 3000 — the third suite
   that writes business rows, and it keeps the rule the other two were written with: nothing it makes
   is left behind, including the bytes on disk. Documents and their events go with the case they hang
   from, the case goes by id, the audit rows go by the probes that wrote them, and the uploaded files
   are removed by the case directory under uploads/.

   Everything runs on throwaway accounts under @example.invalid, with addresses prefixed 'doc-' so
   this sweep cannot reach the case registry's or the task suite's probes. The surveyor opens the two
   cases — STAFF does not hold create_case — and gets the members onto them the way the app does, by
   the name on the case and by assigned work rather than by writing rows by hand.

   Eight documents answer eight different questions, because §8 is a set of rules about a file's life
   rather than one workflow:
     1  staff uploads a policy        the two-step intake: record first, bytes when they land
     2  staff uploads a bill          the type is read from the file, not from what it is called
     3  staff uploads nothing         a record with no bytes cannot be verified
     4  surveyor verifies #1           the decision, who made it and when
     5  surveyor rejects #2 with reason the reason is not optional, and a rejection is not a delete
     6  staff replaces #5              the previous version survives, still downloadable, still rejected
     7  a stranger's case             an id does not open a document on a case you may not see
     8  deletes                        own unverified only, never verified, never report-related
   plus the answers the server gives the screen: which buttons exist on each row. */
const db = require('../db/index.js');
const argon2 = require('argon2');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const BASE = process.env.RBAC_BASE || 'http://127.0.0.1:3000';
const PASSWORD = 'Doc-Probe-2026!';
const UPLOAD_ROOT = path.join(__dirname, '..', 'uploads');
const results = [];
const record = (name, ok, detail) => results.push({ name, ok: Boolean(ok), detail });

const call = async (pathname, { method = 'GET', cookie, body, raw } = {}) => {
  const res = await fetch(BASE + pathname, {
    method,
    headers: {
      ...(raw
        ? { 'Content-Type': 'application/octet-stream' }
        : { 'Content-Type': 'application/json' }),
      Origin: BASE,
      ...(cookie ? { Cookie: `surveypro_session=${cookie}` } : {}),
    },
    body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
};

/* The bytes of a file, kept apart from the JSON calls because they are not JSON. Returns the status
   and the buffer so a test can compare what came back with what went in. */
const sendBytes = async (pathname, buffer, cookie) => {
  const res = await fetch(BASE + pathname, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/octet-stream',
      Origin: BASE,
      ...(cookie ? { Cookie: `surveypro_session=${cookie}` } : {}),
    },
    body: buffer,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
};

const fetchBytes = async (pathname, cookie) => {
  const res = await fetch(BASE + pathname, {
    headers: { Origin: BASE, ...(cookie ? { Cookie: `surveypro_session=${cookie}` } : {}) },
  });
  return {
    status: res.status,
    type: res.headers.get('content-type'),
    body: Buffer.from(await res.arrayBuffer()),
  };
};

const mint = (userId) =>
  db.createSessionForUser(userId, { metadata: { browserName: 'document-probe' } });

const stamp = Date.now();
const email = (who) => `doc-${who}-${stamp}@example.invalid`;

/* A file is identified by the server from its first bytes, so these carry real signatures. The body
   behind the header is a fixed probe string rather than a decoded image: what is being proved is that
   the right kind is recognised, that the bytes are stored unchanged and that a file whose name lies
   about what it is does not get through. */
const probeFile = (kind, label) => {
  const payload = Buffer.from('survey-desk document probe ' + label + ' ' + stamp, 'utf8');
  const heads = {
    pdf: Buffer.from('%PDF-1.4\n', 'latin1'),
    jpg: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
    png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    webp: (() => {
      const head = Buffer.from('RIFF\x00\x00\x00\x00WEBP', 'latin1');
      return head;
    })(),
    txt: Buffer.from('just a text file, not a document\n', 'latin1'),
  };
  return Buffer.concat([heads[kind], payload]);
};

const sha = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

/* The case shape the browser really sends, trimmed to what the registry indexes. */
const caseBody = (over = {}) => ({
  id: over.id || `docprobe${stamp}${Math.random().toString(36).slice(2, 7)}`,
  mod: 'motor',
  cr: stamp - 60000,
  u: stamp,
  st: 'Intimation',
  due: '',
  owner: '',
  x: {},
  f: {
    case_claimNo: over.claimNo || `DOC-${stamp}`,
    case_policyNo: over.policyNo || '',
    case_company: over.insurer || '',
    pol_insured: over.insured || '',
    case_insReg: over.reg || '',
    case_surveyor: over.surveyor || '',
    ...(over.f || {}),
  },
});

(async () => {
  /* A run that crashed part-way leaves both rows and bytes behind, and one stale document is enough to
     make the queue counts or the delete rules read as a bug. The sweep is bounded by the 'doc-' address
     prefix, so it cannot touch another suite's rows. */
  const sweep = `email LIKE 'doc-%@example.invalid'`;
  const myCases = `owner_user_id IN (SELECT id FROM users WHERE ${sweep})`;
  /* The bytes are named by the case id and the document id, so both are read before the rows that
     name them are deleted. */
  const stale = await db.query(
    `SELECT d.id, d.case_id AS "caseId" FROM documents d
     JOIN cases c ON c.id = d.case_id
     JOIN users u ON u.id = c.owner_user_id
     WHERE ${sweep.replace('email', 'u.email')}`
  );
  stale.rows.forEach((row) => {
    fs.rmSync(path.join(UPLOAD_ROOT, String(row.caseId), String(row.id)), { force: true });
  });
  /* A directory can outlive the rows that name it — a run that died between the case sweep and its own
     cleanup leaves bytes whose document id no longer exists anywhere. The ids this suite generates all
     start 'docprobe' and nothing else does, so the orphan directories are found by that shape. */
  const probeCaseId = /^docprobe\d+[a-z0-9]*$/;
  const orphanDirs = fs.existsSync(UPLOAD_ROOT)
    ? fs.readdirSync(UPLOAD_ROOT).filter((name) => probeCaseId.test(name))
    : [];
  orphanDirs.forEach((name) => {
    fs.rmSync(path.join(UPLOAD_ROOT, name), { recursive: true, force: true });
  });
  await db.query(`DELETE FROM documents WHERE case_id IN (SELECT id FROM cases WHERE ${myCases})`);
  await db.query(`DELETE FROM cases WHERE ${myCases}`);
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

  const lead = await make('lead', 'SURVEYOR', 'Document Probe Surveyor');
  const staff = await make('worker', 'STAFF', 'Document Probe Staff');
  const other = await make('other', 'STAFF', 'Document Probe Other');
  const strange = await make('strange', 'STAFF', 'Document Probe Stranger');
  const admin = await make('admin', 'ADMIN', 'Document Probe Admin');
  /* A second surveyor, with the register-wide view taken away. The queue rule is only interesting for
     somebody whose case list is a list rather than the whole register: for them, a document must not
     become a side door into a case they were never given. */
  const scoped = await make('scoped', 'SURVEYOR', 'Document Probe Scoped');

  const cookieLead = await mint(lead.id);
  const cookieStaff = await mint(staff.id);
  const cookieOther = await mint(other.id);
  const cookieStrange = await mint(strange.id);
  const cookieAdmin = await mint(admin.id);
  const cookieScoped = await mint(scoped.id);

  const caseIds = [];
  const openCase = async (cookie, over) => {
    const body = caseBody(over);
    caseIds.push(body.id);
    const res = await call(`/api/cases/${body.id}`, { method: 'PUT', cookie, body });
    return { id: body.id, status: res.status, json: res.json };
  };

  /* The surveyor opens both cases, because STAFF does not hold create_case. The name written on the
     case is what puts a member on it: the uploader on the working case, the stranger on the sealed
     one. Somebody who is neither the owner nor named there is the stranger the rules are for. */
  const primary = await openCase(cookieLead, {
    claimNo: `DOC-MAIN-${stamp}`,
    insurer: 'Nepal Insurance Ltd',
    surveyor: 'Document Probe Staff',
  });
  /* A file nobody else may open: its documents are the test that a document id is not a key. */
  const privateCase = await openCase(cookieLead, {
    claimNo: `DOC-SEALED-${stamp}`,
    surveyor: 'Document Probe Stranger',
  });

  /* Work is how the second member and the scoped surveyor are put on the working case. A task
     assignment is the app's own way of saying "you may see this case", and it is what makes their
     refusals read as "not yours" rather than "not yours to see" — the distinction §8 depends on. */
  const taskIds = [];
  const giveWork = async (assigneeUserId, label) => {
    const res = await call('/api/tasks', {
      method: 'POST',
      cookie: cookieLead,
      body: {
        caseId: primary.id,
        assigneeUserId,
        assignmentType: 'Document Collection',
        instructions: `Collect the outstanding documents for ${label}.`,
      },
    });
    if (res.json && res.json.task) taskIds.push(res.json.task.id);
    return res;
  };
  const workForOther = await giveWork(other.id, 'the second member');
  const workForScoped = await giveWork(scoped.id, 'the scoped surveyor');

  /* Taking the register-wide view away is the permission layer's own route rather than a row written
     by hand, so the suite flips the same switch the admin screen flips. */
  const revoke = await call(`/api/admin/users/${scoped.id}/permissions`, {
    method: 'PUT',
    cookie: cookieAdmin,
    body: { permissions: [{ key: 'view_all_cases', granted: false }] },
  });
  const scopedQueue = await call('/api/documents?scope=queue', { cookie: cookieScoped });

  const register = async (cookie, body) => call('/api/documents', { method: 'POST', cookie, body });
  const upload = async (id, buffer, cookie) =>
    sendBytes(`/api/documents/${id}/file`, buffer, cookie);

  record(
    'the surveyor, the two members, a stranger, an administrator and a surveyor without the register view are in place',
    primary.status === 200 &&
      privateCase.status === 200 &&
      workForOther.status === 201 &&
      workForScoped.status === 201 &&
      revoke.status === 200 &&
      scopedQueue.status === 200,
    {
      primary: primary.status,
      private: privateCase.status,
      work: [workForOther.status, workForScoped.status],
      revoke: revoke.status,
      scopedQueue: scopedQueue.status,
    }
  );

  /* 1. The intake: a record, then the bytes, and the two answers the form gets wrong. */
  const policyBytes = probeFile('pdf', 'policy');
  const billBytes = probeFile('jpg', 'bill');

  const d1 = await register(cookieStaff, {
    case: primary.id,
    category: 'Policy',
    filename: 'policy-front.pdf',
  });
  const d1id = d1.json && d1.json.document && d1.json.document.id;
  record(
    'a record exists before any bytes do, and asks for nothing',
    d1.status === 201 &&
      d1.json.document.status === 'Uploaded' &&
      d1.json.document.hasFile === false &&
      d1.json.document.actions.length === 0 &&
      d1.json.document.craft.file === false,
    { status: d1.status, doc: d1.json && d1.json.document }
  );

  const tooEarly = await call(`/api/documents/${d1id}/verify`, {
    method: 'POST',
    cookie: cookieLead,
    body: {},
  });
  record(
    'nothing can be verified before its file arrives',
    tooEarly.status === 409 && tooEarly.json.code === 'document_no_file',
    tooEarly.json
  );

  const badCategory = await register(cookieStaff, {
    case: primary.id,
    category: 'Invoice',
    filename: 'invoice.pdf',
  });
  const badName = await register(cookieStaff, {
    case: primary.id,
    category: 'Bills',
    filename: '   ',
  });
  record(
    'the eight categories §8 names are the only ones accepted, and a document needs a name',
    badCategory.status === 400 &&
      badCategory.json.code === 'invalid_category' &&
      badCategory.json.allowed.length === 8 &&
      badName.status === 400 &&
      badName.json.code === 'invalid_filename',
    { badCategory: badCategory.json, badName: badName.json }
  );

  /* The name a device reports is kept because it is usually the only clue to which scan is which,
     but it is never allowed to be a path or to break a header. */
  const sneaky = await register(cookieStaff, {
    case: primary.id,
    category: 'Bills',
    filename: '../../etc/"passwd.pdf"',
  });
  const sneakyName = (sneaky.json.document || {}).originalFilename || '';
  record(
    'the filename is stored as text, with the separators and the quotes taken out',
    sneaky.status === 201 &&
      !sneakyName.includes('/') &&
      !sneakyName.includes('\\') &&
      !sneakyName.includes('"') &&
      sneakyName.includes('passwd.pdf'),
    { sneakyName }
  );

  const attached = await upload(d1id, policyBytes, cookieStaff);
  record(
    'the bytes land, and landing is what sends the document for verification',
    attached.status === 200 &&
      attached.json.document.status === 'Pending Verification' &&
      attached.json.document.hasFile === true &&
      attached.json.document.byteSize === policyBytes.length &&
      attached.json.document.sha256 === sha(policyBytes),
    { status: attached.status, doc: attached.json && attached.json.document }
  );

  const roundTrip = await fetchBytes(`/api/documents/${d1id}/file`, cookieStaff);
  record(
    'the file comes back byte for byte, under the type the server read from it',
    roundTrip.status === 200 &&
      Buffer.compare(roundTrip.body, policyBytes) === 0 &&
      roundTrip.type === 'application/pdf',
    { status: roundTrip.status, type: roundTrip.type, bytes: roundTrip.body.length }
  );

  const twice = await upload(d1id, policyBytes, cookieStaff);
  const d3 = await register(cookieStaff, {
    case: primary.id,
    category: 'Estimates',
    filename: 'garage-estimate.png',
  });
  const d3id = d3.json.document.id;
  const emptyUpload = await upload(d3id, Buffer.alloc(0), cookieStaff);
  record(
    'a file already on the record is replaced, not silently overwritten, and an empty upload is refused',
    twice.status === 409 &&
      twice.json.code === 'document_has_file' &&
      emptyUpload.status === 400 &&
      emptyUpload.json.code === 'document_empty',
    { twice: twice.json, emptyUpload: emptyUpload.json }
  );

  /* A bill photographed and sent under a name that lies about it: the name says jpg, the bytes say
     text, and the bytes are what decides. */
  const d2 = await register(cookieStaff, {
    case: primary.id,
    category: 'Bills',
    filename: 'garage-bill.pdf',
  });
  const d2id = d2.json.document.id;
  const lying = await upload(d2id, probeFile('txt', 'bill'), cookieStaff);
  const honest = await upload(d2id, billBytes, cookieStaff);
  record(
    'a file is accepted for what it is, not for what it is called',
    lying.status === 415 &&
      lying.json.code === 'document_type_unsupported' &&
      honest.status === 200 &&
      honest.json.document.mimeType === 'image/jpeg',
    { lying: lying.json, honestType: honest.json.document && honest.json.document.mimeType }
  );

  /* 2. The decision: who may make it, what it has to say, and what it leaves behind. */
  const staffVerify = await call(`/api/documents/${d2id}/verify`, {
    method: 'POST',
    cookie: cookieStaff,
    body: {},
  });
  const staffQueue = await call('/api/documents?scope=queue', { cookie: cookieStaff });
  record(
    'a member who holds the work does not hold the decision',
    staffVerify.status === 403 &&
      staffVerify.json.permission === 'verify_documents' &&
      staffQueue.status === 403,
    { staffVerify: staffVerify.json, staffQueue: staffQueue.status }
  );

  const verified = await call(`/api/documents/${d1id}/verify`, {
    method: 'POST',
    cookie: cookieLead,
    body: {},
  });
  record(
    'the surveyor verifies it, and the row says who and when',
    verified.status === 200 &&
      verified.json.document.status === 'Verified' &&
      verified.json.document.verifiedBy === lead.id &&
      Boolean(verified.json.document.verifiedAt) &&
      verified.json.document.actions.length === 0 &&
      verified.json.document.craft.replace === false,
    { doc: verified.json && verified.json.document }
  );

  const verifyTwice = await call(`/api/documents/${d1id}/verify`, {
    method: 'POST',
    cookie: cookieLead,
    body: {},
  });
  record(
    'a document that is already verified is not verified again',
    verifyTwice.status === 409 &&
      verifyTwice.json.code === 'document_not_ready' &&
      verifyTwice.json.status === 'Verified',
    verifyTwice.json
  );

  const queue = await call('/api/documents?scope=queue', { cookie: cookieLead });
  record(
    'the queue holds the documents waiting for a decision and nothing else',
    queue.status === 200 &&
      queue.json.documents.length > 0 &&
      queue.json.documents.every((row) => row.status === 'Pending Verification') &&
      !queue.json.documents.some((row) => row.id === d1id) &&
      queue.json.documents.some((row) => row.id === d2id) &&
      queue.json.documents.every((row) => row.actions.some((a) => a.action === 'verify')),
    { pending: queue.json.documents.map((row) => [row.category, row.status]) }
  );

  const bareReject = await call(`/api/documents/${d2id}/reject`, {
    method: 'POST',
    cookie: cookieLead,
    body: { reason: '   ' },
  });
  const rejected = await call(`/api/documents/${d2id}/reject`, {
    method: 'POST',
    cookie: cookieLead,
    body: { reason: 'The total on the bill does not match the estimate.' },
  });
  record(
    'a rejection has to say why, and says it in the row',
    bareReject.status === 400 &&
      bareReject.json.code === 'reason_required' &&
      rejected.status === 200 &&
      rejected.json.document.status === 'Rejected' &&
      rejected.json.document.rejectionReason ===
        'The total on the bill does not match the estimate.' &&
      rejected.json.document.rejectedBy === lead.id &&
      Boolean(rejected.json.document.rejectedAt),
    { bareReject: bareReject.json, doc: rejected.json && rejected.json.document }
  );

  const rejectVerified = await call(`/api/documents/${d1id}/reject`, {
    method: 'POST',
    cookie: cookieLead,
    body: { reason: 'Second thoughts.' },
  });
  record(
    'a decision does not reopen a document that has been settled',
    rejectVerified.status === 409 && rejectVerified.json.code === 'document_not_ready',
    rejectVerified.json
  );

  /* 3. The replacement: a new version, and the old one still there, still downloadable, still saying
      what was wrong with it. */
  const replacement = await call(`/api/documents/${d2id}/replace`, {
    method: 'POST',
    cookie: cookieStaff,
    body: { filename: 'garage-bill-signed.pdf' },
  });
  const v2id = replacement.json && replacement.json.document && replacement.json.document.id;
  const v2Uploaded = await upload(v2id, probeFile('jpg', 'signed bill'), cookieStaff);
  record(
    'the replacement is version two of the same document, and the old one keeps what it was',
    replacement.status === 201 &&
      replacement.json.document.version === 2 &&
      replacement.json.document.supersedesDocumentId === d2id &&
      replacement.json.document.threadId &&
      v2Uploaded.status === 200 &&
      v2Uploaded.json.document.status === 'Pending Verification',
    { v2: replacement.json && replacement.json.document }
  );

  const oldRow = await call(`/api/documents/${d2id}`, { cookie: cookieStaff });
  const oldBytes = await fetchBytes(`/api/documents/${d2id}/file`, cookieStaff);
  record(
    'the superseded version is still readable, still rejected, and its file is still there',
    oldRow.status === 200 &&
      oldRow.json.document.isCurrent === false &&
      oldRow.json.document.status === 'Rejected' &&
      oldRow.json.document.rejectionReason ===
        'The total on the bill does not match the estimate.' &&
      Buffer.compare(oldBytes.body, billBytes) === 0,
    {
      current: oldRow.json.document && oldRow.json.document.isCurrent,
      status: oldRow.json.document && oldRow.json.document.status,
      bytes: oldBytes.body.length,
      versions: (oldRow.json.versions || []).length,
    }
  );

  const decideOld = await call(`/api/documents/${d2id}/verify`, {
    method: 'POST',
    cookie: cookieLead,
    body: {},
  });
  const editOld = await call(`/api/documents/${d2id}`, {
    method: 'PATCH',
    cookie: cookieStaff,
    body: { category: 'Bills' },
  });
  record(
    'a superseded version is history: no decision and no edit reaches it',
    decideOld.status === 409 &&
      decideOld.json.code === 'document_superseded' &&
      editOld.status === 409 &&
      editOld.json.code === 'document_superseded',
    { decideOld: decideOld.json, editOld: editOld.json }
  );

  const verifiedTwo = await call(`/api/documents/${v2id}/verify`, {
    method: 'POST',
    cookie: cookieLead,
    body: {},
  });
  record(
    'the replacement is what gets verified, not the argument about the first one',
    verifiedTwo.status === 200 && verifiedTwo.json.document.status === 'Verified',
    verifiedTwo.json
  );

  /* The third decision verb, on a document that has not been settled either way: §8 lists
     'Replacement Required' as a status of its own, so it has to be reachable on its own terms. */
  const d5 = await register(cookieStaff, {
    case: primary.id,
    category: 'Inspection Photos',
    filename: 'chassis-area.jpg',
  });
  const d5id = d5.json.document.id;
  await upload(d5id, probeFile('jpg', 'chassis'), cookieStaff);
  const askedBack = await call(`/api/documents/${d5id}/request_replacement`, {
    method: 'POST',
    cookie: cookieLead,
    body: { reason: 'The chassis plate is not legible in any of these.' },
  });
  record(
    'a document can be sent back for a replacement without being called wrong',
    askedBack.status === 200 &&
      askedBack.json.document.status === 'Replacement Required' &&
      askedBack.json.document.rejectionReason ===
        'The chassis plate is not legible in any of these.' &&
      askedBack.json.document.rejectedBy === lead.id &&
      askedBack.json.document.actions.length === 0,
    askedBack.json.document
      ? {
          status: askedBack.json.document.status,
          actions: askedBack.json.document.actions,
          craft: askedBack.json.document.craft,
        }
      : askedBack.json
  );

  /* A verified version is evidence, so the way a document moves on is another version rather than a
     second thought about the same one: refusing here is what stops the register holding two verdicts
     about one file with no way to say which the report used. */
  const sendBackAgain = await call(`/api/documents/${v2id}/request_replacement`, {
    method: 'POST',
    cookie: cookieLead,
    body: { reason: 'The signature page is cut off.' },
  });
  const replaceVerified = await call(`/api/documents/${v2id}/replace`, {
    method: 'POST',
    cookie: cookieStaff,
    body: { filename: 'garage-bill-signed-again.pdf' },
  });
  record(
    'a verified version is not reopened: neither a second decision nor a fresh upload reaches it',
    sendBackAgain.status === 409 &&
      sendBackAgain.json.code === 'document_not_ready' &&
      sendBackAgain.json.status === 'Verified' &&
      replaceVerified.status === 403 &&
      replaceVerified.json.code === 'document_verified',
    { sendBackAgain: sendBackAgain.json, replaceVerified: replaceVerified.json }
  );

  /* 4. Removal: the uploader's own file, before anybody has verified it, and nothing else. */
  const removeOwn = await call(`/api/documents/${d3id}`, { method: 'DELETE', cookie: cookieStaff });
  const goneRow = await db.query('SELECT id FROM documents WHERE id = $1::uuid', [d3id]);
  record(
    'the uploader may remove their own unverified record, and the row goes with it',
    removeOwn.status === 200 && goneRow.rowCount === 0,
    { status: removeOwn.status, rows: goneRow.rowCount }
  );

  const removeVerified = await call(`/api/documents/${d1id}`, {
    method: 'DELETE',
    cookie: cookieStaff,
  });
  record(
    'a verified document is not removed by normal operations',
    removeVerified.status === 403 && removeVerified.json.code === 'document_verified',
    removeVerified.json
  );

  const d4 = await register(cookieStaff, {
    case: primary.id,
    category: 'Reports',
    filename: 'preliminary-report.pdf',
    reportRelated: true,
  });
  const d4id = d4.json.document.id;
  await upload(d4id, probeFile('pdf', 'report'), cookieStaff);
  const removeOther = await call(`/api/documents/${d4id}`, {
    method: 'DELETE',
    cookie: cookieOther,
  });
  const removeReport = await call(`/api/documents/${d4id}`, {
    method: 'DELETE',
    cookie: cookieStaff,
  });
  record(
    'nobody but the uploader may remove an upload, and a report-related file is not theirs to remove either',
    removeOther.status === 403 &&
      removeOther.json.code === 'document_not_yours' &&
      removeReport.status === 403 &&
      removeReport.json.code === 'document_report_related',
    { removeOther: removeOther.json, removeReport: removeReport.json }
  );

  const listForStaff = await call(`/api/documents?scope=mine`, { cookie: cookieStaff });
  record(
    'the staff list shows the rows with the remove switch that is actually theirs',
    listForStaff.status === 200 &&
      listForStaff.json.documents.length > 0 &&
      listForStaff.json.documents.every((row) => row.uploadedBy === staff.id) &&
      listForStaff.json.documents.every(
        (row) => row.craft.remove === (row.id !== d4id && row.status !== 'Verified')
      ),
    {
      rows: listForStaff.json.documents.map((row) => [row.category, row.status, row.craft.remove]),
    }
  );

  /* 5. Reachability: a document id is not a key into somebody else's file. */
  const sealed = await register(cookieStrange, {
    case: privateCase.id,
    category: 'Intimation',
    filename: 'police-intimation.pdf',
  });
  const sealedid = sealed.json.document.id;
  await upload(sealedid, probeFile('pdf', 'intimation'), cookieStrange);
  const peek = await call(`/api/documents/${sealedid}`, { cookie: cookieStaff });
  const peekBytes = await fetchBytes(`/api/documents/${sealedid}/file`, cookieStaff);
  const peekCase = await call(`/api/documents?case=${privateCase.id}`, { cookie: cookieStaff });
  const ownSealed = await call(`/api/documents/${sealedid}`, { cookie: cookieStrange });
  record(
    'a stranger cannot read a document, its bytes, or the case list it belongs to',
    peek.status === 403 &&
      peek.json.code === 'document_forbidden' &&
      peekBytes.status === 403 &&
      peekCase.status === 403 &&
      ownSealed.status === 200 &&
      ownSealed.json.document.id === sealedid,
    { peek: peek.status, peekBytes: peekBytes.status, peekCase: peekCase.status }
  );

  const scopedInQueue = await call('/api/documents?scope=queue', { cookie: cookieScoped });
  const registerInQueue = await call('/api/documents?scope=queue', { cookie: cookieLead });
  record(
    'a surveyor without the register sees only the cases they were given, and the sealed one is not among them',
    scopedInQueue.status === 200 &&
      scopedInQueue.json.documents.length > 0 &&
      scopedInQueue.json.documents.every(
        (row) => row.caseId === primary.id && row.id !== sealedid
      ) &&
      registerInQueue.json.documents.some((row) => row.id === sealedid),
    {
      scoped: scopedInQueue.json.documents.map((row) => [row.category, row.caseId === primary.id]),
      registerSealed: registerInQueue.json.documents.some((row) => row.id === sealedid),
    }
  );

  /* 6. The category and the flag can be corrected; the file cannot. */
  const recategorised = await call(`/api/documents/${d4id}`, {
    method: 'PATCH',
    cookie: cookieLead,
    body: { category: 'Bills', reportRelated: false },
  });
  const strangerEdit = await call(`/api/documents/${d4id}`, {
    method: 'PATCH',
    cookie: cookieOther,
    body: { category: 'Policy' },
  });
  record(
    'the verifier may refile a document; a member who neither uploaded nor verifies it may not',
    recategorised.status === 200 &&
      recategorised.json.document.category === 'Bills' &&
      recategorised.json.document.reportRelated === false &&
      strangerEdit.status === 403 &&
      strangerEdit.json.code === 'document_not_yours',
    { recategorised: recategorised.json.document, strangerEdit: strangerEdit.json }
  );

  /* 7. History and audit: every step is in the record, with a name and a time. */
  const events = await db.query(
    `SELECT e.action, e.from_status AS "fromStatus", e.to_status AS "toStatus", e.reason
     FROM document_events e
     JOIN documents d ON d.id = e.document_id
     WHERE d.thread_id = (SELECT thread_id FROM documents WHERE id = $1::uuid)
     ORDER BY e.id`,
    [d2id]
  );
  const kinds = events.rows.map((row) => row.action);
  record(
    'the bill thread records every step of its argument, including both files and no second guessing',
    ['registered', 'file_attached', 'rejected', 'replaced', 'verified'].every((kind) =>
      kinds.includes(kind)
    ) &&
      kinds.filter((kind) => kind === 'file_attached').length === 2 &&
      events.rows
        .filter((row) => row.action === 'rejected')
        .every((row) => Boolean(row.reason && row.reason.trim())) &&
      !kinds.includes('replacement_requested'),
    { kinds }
  );

  const detailEvent = await db.query(
    `SELECT details FROM document_events WHERE action = 'details_changed'
     ORDER BY id DESC LIMIT 1`
  );
  record(
    'a refiling records what it was before it was changed',
    detailEvent.rowCount === 1 &&
      detailEvent.rows[0].details.to &&
      detailEvent.rows[0].details.to.category === 'Bills',
    detailEvent.rows[0] && detailEvent.rows[0].details
  );

  const audits = await db.query(
    `SELECT action, details FROM audit_logs
     WHERE actor_user_id = ANY($1::uuid[]) AND action LIKE 'document_%'`,
    [[lead.id, staff.id, other.id, strange.id, admin.id]]
  );
  record(
    'every document action is in the audit log with the document it is about',
    audits.rows.length >= 8 && audits.rows.every((row) => Boolean(row.details.documentId)),
    { rows: audits.rows.length, actions: [...new Set(audits.rows.map((row) => row.action))] }
  );

  const caseList = await call(`/api/documents?case=${primary.id}&allVersions=1`, {
    cookie: cookieStaff,
  });
  record(
    'one case lists its documents, and asks for the superseded versions when told to',
    caseList.status === 200 &&
      caseList.json.documents.length >= 6 &&
      caseList.json.documents.some((row) => row.isCurrent === false) &&
      caseList.json.case.id === primary.id,
    { rows: caseList.json.documents.length }
  );

  /* An administrator is the one operation that does reach a verified file, which is what makes §8's
     sentence about normal staff operations mean something. Last, because it removes rows the other
     checks have been reading. */
  const adminRemovesVerified = await call(`/api/documents/${d1id}`, {
    method: 'DELETE',
    cookie: cookieAdmin,
  });
  record(
    'an administrator can remove a verified document, and the bytes go with the row',
    adminRemovesVerified.status === 200 && !fs.existsSync(path.join(UPLOAD_ROOT, primary.id, d1id)),
    adminRemovesVerified.json
  );

  /* Cleanup. The bytes on disk are only addressable through the rows that name them, so the document
     ids are read before the rows go; the case rows then take the documents and their events with them
     by cascade, the audit rows go by the probes that wrote them, and each probe's own directory under
     uploads/ is removed once nothing is left that could name a file inside it. */
  const ownedRows = await db.query(
    'SELECT id, case_id AS "caseId" FROM documents WHERE case_id = ANY($1::text[])',
    [caseIds]
  );
  const docIds = ownedRows.rows.map((row) => String(row.id));
  await db.query('DELETE FROM cases WHERE id = ANY($1::text[])', [caseIds]);
  const ids = [lead, staff, other, strange, admin, scoped].map((u) => u.id);
  await db.query(
    `WITH probe AS (SELECT unnest($1::uuid[]) AS id)
     DELETE FROM audit_logs a
     WHERE EXISTS (SELECT 1 FROM probe p WHERE p.id = a.actor_user_id OR p.id = a.target_user_id)`,
    [ids]
  );
  /* The accounts go last: the sessions, the permission override and the document rows all name them,
     and the sweep at the top of the next run is only safe because these addresses are prefixed. */
  await db.query('DELETE FROM users WHERE id = ANY($1)', [ids]);
  /* The shape check is the one written above: only a directory this suite could have made is removed. */
  const bytesLeft = caseIds
    .filter((id) => probeCaseId.test(String(id)))
    .map((id) => {
      fs.rmSync(path.join(UPLOAD_ROOT, String(id)), { recursive: true, force: true });
      return fs.existsSync(path.join(UPLOAD_ROOT, String(id)));
    });
  /* Anything the sweep could not name is reported rather than assumed removed. */
  const strayFiles = docIds.filter((id) =>
    caseIds.some((caseId) => fs.existsSync(path.join(UPLOAD_ROOT, String(caseId), String(id))))
  );

  const leftovers = await db.query(
    `SELECT
       (SELECT count(*)::int FROM users WHERE email LIKE 'doc-%@example.invalid') AS users,
       (SELECT count(*)::int FROM cases WHERE id = ANY($1::text[])) AS cases,
       (SELECT count(*)::int FROM documents WHERE case_id = ANY($1::text[])) AS documents,
       (SELECT count(*)::int FROM document_events WHERE document_id = ANY($2::uuid[])) AS events,
       (SELECT count(*)::int FROM tasks WHERE case_id = ANY($1::text[])) AS tasks,
       (SELECT count(*)::int FROM audit_logs WHERE actor_user_id = ANY($3::uuid[])) AS audit`,
    [caseIds, docIds, ids]
  );
  const left = leftovers.rows[0];
  record(
    'the suite leaves the register, the documents, their history, the log and the disk as it found them',
    left.users === 0 &&
      left.cases === 0 &&
      left.documents === 0 &&
      left.events === 0 &&
      left.tasks === 0 &&
      left.audit === 0 &&
      bytesLeft.length === caseIds.length &&
      bytesLeft.every((stillThere) => stillThere === false) &&
      strayFiles.length === 0,
    { ...left, directoriesRemoved: bytesLeft.length, strayFiles }
  );

  const failed = results.filter((r) => !r.ok);
  console.log(
    JSON.stringify(
      {
        suite: 'document verification',
        passed: results.length - failed.length,
        failed: failed.length,
        total: results.length,
        casesRemoved: caseIds.length,
        documentsRemoved: docIds.length,
        workAssignedRemoved: taskIds.length,
        leftovers: left,
        failures: failed.map((f) => ({ name: f.name, detail: f.detail })),
      },
      null,
      2
    )
  );
  process.exit(failed.length ? 1 : 0);
})().catch((error) => {
  /* A run that throws part-way still has to say what it had proved, because the next thing a reader
     needs is which assertion the server broke on — and the startup sweep above takes care of the rows
     and bytes this run could not clean up itself. */
  console.log(
    JSON.stringify(
      {
        suite: 'document verification',
        fatal: error && error.message ? error.message : String(error),
        passed: results.filter((r) => r.ok).length,
        total: results.length,
        checks: results,
      },
      null,
      2
    )
  );
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
