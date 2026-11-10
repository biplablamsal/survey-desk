/* End-to-end check of §11 (case comments) and §12 (notifications) against the live server on 3000 —
   the fourth suite that writes business rows, and it keeps the rule the others were written with:
   nothing it makes is left behind. Comments and their read markers go with the case, notifications go
   with the account, the case goes by id, and the audit rows go by the probes that wrote them.

   Everything runs on throwaway accounts under @example.invalid, prefixed 'note-' so this sweep cannot
   reach the registry's, the task suite's or the document suite's probes.

   The shape of the run is the shape of the two sections. §11 is a conversation, so the first half posts
   notes, replies, mentions, instructions and attachments and asks who can see them and who has not read
   them. §12 is a bell, so the second half makes the events happen — assignments, decisions, submissions,
   a reassignment, a suspension, a reset — and reads the notices back off the inbox rather than off the
   database, because what the section promises is what the member sees.

   The two actions that end a session, resetting a password and deactivating an account, are last, and
   their notices are read from the table instead of through the dead cookie. */
const db = require('../db/index.js');
const argon2 = require('argon2');
const fs = require('fs');
const path = require('path');

/* Documents are attached to the thread, so their bytes land on disk. The ids this suite generates all
   start 'noteprobe' and nothing else does, so the directories are found by that shape rather than by
   rows that may already have been deleted by an interrupted run. */
const UPLOAD_ROOT = path.join(__dirname, '..', 'uploads');
const probeCaseId = /^noteprobe\d+[a-z0-9]*$/;
const removeUploadDirs = () => {
  if (!fs.existsSync(UPLOAD_ROOT)) return;
  fs.readdirSync(UPLOAD_ROOT)
    .filter((name) => probeCaseId.test(name))
    .forEach((name) => fs.rmSync(path.join(UPLOAD_ROOT, name), { recursive: true, force: true }));
};

const BASE = process.env.RBAC_BASE || 'http://127.0.0.1:3000';
const PASSWORD = 'Note-Probe-2026!';
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

/* The bytes are not JSON, and a document only becomes verifiable when they land. */
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
  return { status: res.status, json: await res.json().catch(() => null) };
};

const mint = (userId) =>
  db.createSessionForUser(userId, { metadata: { browserName: 'comment-probe' } });

const stamp = Date.now();
const email = (who) => `note-${who}-${stamp}@example.invalid`;
const tokenOf = (who) => `@note-${who}-${stamp}`;

/* A JPEG signature and a fixed body: enough for the server to recognise the kind and hash the bytes. */
const jpegBytes = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
  Buffer.from('survey-desk comment probe ' + stamp, 'utf8'),
]);

const caseBody = (over = {}) => ({
  id: over.id || `noteprobe${stamp}${Math.random().toString(36).slice(2, 7)}`,
  mod: 'motor',
  cr: stamp - 60000,
  u: stamp,
  st: 'Intimation',
  due: '',
  owner: '',
  x: {},
  f: {
    case_claimNo: over.claimNo || `NOTE-${stamp}`,
    case_policyNo: over.policyNo || '',
    case_company: over.insurer || '',
    pol_insured: over.insured || '',
    case_insReg: over.reg || '',
    case_surveyor: over.surveyor || '',
    ...(over.f || {}),
  },
});

/* A date a number of days from today, in the shape the case registry and §5 store one. */
const dayText = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

/* What the bell holds for this person after the calendar has been consulted — the route does both,
   which is the point of the deadline tests below. */
const inboxOf = async (cookie, query = '') => {
  const res = await call('/api/notifications' + query, { cookie });
  return { status: res.status, json: res.json, rows: (res.json && res.json.notifications) || [] };
};

const ofType = (rows, type) => rows.filter((row) => row.type === type);

(async () => {
  /* A run that crashed part-way leaves a thread and an inbox behind, and a stale notification is enough
     to make the unread count or a deadline suppression read as a defect. */
  const sweep = `email LIKE 'note-%@example.invalid'`;
  const mine = `(SELECT id FROM users WHERE ${sweep})`;
  await db.query(`DELETE FROM notifications WHERE user_id IN ${mine}`);
  await db.query(`DELETE FROM case_comment_reads WHERE user_id IN ${mine}`);
  await db.query(
    `DELETE FROM case_comments WHERE case_id IN (SELECT id FROM cases WHERE owner_user_id IN ${mine})`
  );
  await db.query(
    `DELETE FROM documents WHERE case_id IN (SELECT id FROM cases WHERE owner_user_id IN ${mine})`
  );
  await db.query(
    `DELETE FROM tasks WHERE case_id IN (SELECT id FROM cases WHERE owner_user_id IN ${mine})`
  );
  await db.query(`DELETE FROM cases WHERE owner_user_id IN ${mine}`);
  await db.query(`DELETE FROM audit_logs WHERE actor_user_id IN ${mine}`);
  await db.query(`DELETE FROM users WHERE ${sweep}`);
  removeUploadDirs();

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

  const admin = await make('admin', 'ADMIN', 'Comment Probe Admin');
  const lead = await make('lead', 'SURVEYOR', 'Comment Probe Surveyor');
  const worker = await make('worker', 'STAFF', 'Comment Probe Worker');
  const helper = await make('helper', 'STAFF', 'Comment Probe Helper');
  const strange = await make('strange', 'STAFF', 'Comment Probe Stranger');

  const cookieAdmin = await mint(admin.id);
  const cookieLead = await mint(lead.id);
  const cookieWorker = await mint(worker.id);
  const cookieHelper = await mint(helper.id);
  const cookieStrange = await mint(strange.id);

  const caseIds = [];
  const openCase = async (cookie, over) => {
    const body = caseBody(over);
    caseIds.push(body.id);
    const res = await call(`/api/cases/${body.id}`, { method: 'PUT', cookie, body });
    return { id: body.id, status: res.status, json: res.json };
  };

  /* The surveyor owns both files: STAFF does not hold create_case. The second case belongs to the
     stranger in every way that matters — it is the one a comment must not reach into. */
  const claim = `NOTE-${stamp}`;
  const primary = await openCase(cookieLead, {
    claimNo: `${claim}-A`,
    surveyor: 'Comment Probe Worker',
  });
  const sealed = await openCase(cookieLead, {
    claimNo: `${claim}-B`,
    surveyor: 'Comment Probe Stranger',
  });

  const taskIds = [];
  const giveWork = async (assignee, label, { type = 'Physical Inspection', dueIn = 2 } = {}) => {
    const res = await call('/api/tasks', {
      method: 'POST',
      cookie: cookieAdmin,
      body: {
        caseId: primary.id,
        assigneeUserId: assignee.id,
        assignmentType: type,
        instructions: `Collect the ${label} for ${claim}.`,
        dueDate: dayText(dueIn),
      },
    });
    if (res.json && res.json.task) taskIds.push(res.json.task.id);
    return res;
  };

  /* Work is how the two members are put on the case at all, and it is §12's first event. The admin
     hands it out, so the assignee and the owner of the file are the two people being told. */
  const workToWorker = await giveWork(worker, 'inspection photographs', {
    type: 'Physical Inspection',
    dueIn: 2,
  });
  const workToHelper = await giveWork(helper, 'repair bill', {
    type: 'Repair Bill Collection',
    dueIn: -1,
  });

  const assigned = await inboxOf(cookieWorker);
  const assignment = ofType(assigned.rows, 'task_assigned')[0] || {};
  record(
    '§12 task assigned: the member is told what they have been given and by when',
    workToWorker.status === 201 &&
      workToHelper.status === 201 &&
      assigned.rows.length > 0 &&
      assignment.caseId === primary.id &&
      Boolean(assignment.taskId) &&
      assignment.message.includes('Physical Inspection') &&
      assignment.message.includes(dayText(2)) &&
      assignment.actorName === 'Comment Probe Admin',
    { status: [workToWorker.status, workToHelper.status], assignment }
  );

  const owner = await inboxOf(cookieLead);
  const caseNotice = ofType(owner.rows, 'case_assigned')[0] || {};
  record(
    '§12 case assigned: the member answerable for the file is told somebody else now has work on it',
    ofType(owner.rows, 'case_assigned').length === 2 && caseNotice.caseId === primary.id,
    { notices: ofType(owner.rows, 'case_assigned').length, caseNotice }
  );

  const adminInbox = await inboxOf(cookieAdmin);
  record(
    'nobody is told about the button they just pressed',
    adminInbox.json.unread === 0 &&
      adminInbox.rows.filter((row) => row.type === 'task_assigned').length === 0,
    { unread: adminInbox.json.unread }
  );

  /* 2. The two deadline notices, which the calendar rather than a caller produces. */
  const approaching = ofType(assigned.rows, 'deadline_approaching');
  const missed = ofType(assigned.rows, 'deadline_missed');
  const helperInbox = await inboxOf(cookieHelper);
  record(
    '§12 deadline approaching: an open task due inside the window arrives on the assignee',
    approaching.length === 1 &&
      approaching[0].taskId === assignment.taskId &&
      approaching[0].message.includes(dayText(2)) &&
      missed.length === 0,
    { approaching, missed }
  );
  record(
    '§12 deadline missed: the same calendar reads an overdue task as a different type',
    ofType(helperInbox.rows, 'deadline_missed').length === 1 && missed.length === 0,
    { missed: ofType(helperInbox.rows, 'deadline_missed') }
  );

  const again = await inboxOf(cookieWorker);
  const thirdCall = await inboxOf(cookieWorker);
  record(
    'opening the bell twice does not tell the same deadline twice, and does not rewrite the first',
    ofType(again.rows, 'deadline_approaching').length === 1 &&
      ofType(thirdCall.rows, 'deadline_approaching').length === 1 &&
      ofType(again.rows, 'deadline_approaching')[0].createdAt ===
        ofType(thirdCall.rows, 'deadline_approaching')[0].createdAt,
    {
      second: ofType(again.rows, 'deadline_approaching').length,
      third: ofType(thirdCall.rows, 'deadline_approaching').length,
    }
  );

  /* 3. §11's conversation, started by the member doing the work. */
  const note = await call(`/api/cases/${primary.id}/comments`, {
    method: 'POST',
    cookie: cookieWorker,
    body: { body: 'Vehicle inspection completed. Additional photographs uploaded.' },
  });
  const first = (note.json && note.json.comment) || {};
  record(
    'a comment is kept with the case, said by a named person, at a time',
    note.status === 201 &&
      first.caseId === primary.id &&
      first.body === 'Vehicle inspection completed. Additional photographs uploaded.' &&
      first.authorName === 'Comment Probe Worker' &&
      first.authorRole === 'STAFF' &&
      Boolean(first.createdAt) &&
      first.isInstruction === false,
    { status: note.status, comment: first }
  );

  const empty = await call(`/api/cases/${primary.id}/comments`, {
    method: 'POST',
    cookie: cookieWorker,
    body: { body: '    ' },
  });
  const tooLong = await call(`/api/cases/${primary.id}/comments`, {
    method: 'POST',
    cookie: cookieWorker,
    body: { body: 'x'.repeat(9000) },
  });
  record(
    'an empty note is refused and a long one is kept to the length the table allows',
    empty.status === 400 &&
      empty.json.code === 'comment_empty' &&
      tooLong.status === 201 &&
      tooLong.json.comment.body.length === 4000,
    {
      empty: empty.json,
      length: tooLong.json && tooLong.json.comment && tooLong.json.comment.body.length,
    }
  );
  await db.query('DELETE FROM case_comments WHERE id = $1', [tooLong.json.comment.id]);

  const reply = await call(`/api/cases/${primary.id}/comments`, {
    method: 'POST',
    cookie: cookieLead,
    body: { body: 'Additional photographs uploaded.', replyTo: first.id },
  });
  const replyRow = (reply.json && reply.json.comment) || {};
  record(
    '§11 reply to a comment: a second row that points at the first, not an edit of it',
    reply.status === 201 &&
      replyRow.parentCommentId === first.id &&
      replyRow.authorRole === 'SURVEYOR',
    { status: reply.status, reply: replyRow }
  );

  const wrongCase = await call(`/api/cases/${sealed.id}/comments`, {
    method: 'POST',
    cookie: cookieLead,
    body: { body: 'A reply aimed at a comment on the other file.', replyTo: first.id },
  });
  record(
    'a reply cannot be filed under a different case than the comment it answers',
    wrongCase.status === 400 && wrongCase.json.code === 'comment_case_mismatch',
    wrongCase.json
  );

  /* 4. Mentions: three answers to an @token, and only one of them tells a person. */
  const mention = await call(`/api/cases/${primary.id}/comments`, {
    method: 'POST',
    cookie: cookieLead,
    body: {
      body: `Please re-shoot the chassis plate, ${tokenOf('worker')}. And ${tokenOf(
        'strange'
      )} and @note-nobody-${stamp} too.`,
      mentions: [tokenOf('worker').slice(1), 'never typed at all'],
    },
  });
  const mentionResult = (mention.json && mention.json.mentions) || {};
  record(
    '§11 mention: a name that is on the case tells somebody, and the other two answers are said out loud',
    mention.status === 201 &&
      mentionResult.notified.length === 1 &&
      mentionResult.notified[0].fullName === 'Comment Probe Worker' &&
      mentionResult.notOnCase.length === 1 &&
      mentionResult.unknown.length === 1 &&
      JSON.stringify(mention.json.comment.mentions).includes(worker.id),
    { status: mention.status, mentions: mentionResult }
  );

  const toldByMention = await inboxOf(cookieWorker);
  const mentionNotice = ofType(toldByMention.rows, 'case_comment')[0] || {};
  record(
    'a mention sends the notification §11 asks for, and it names who said it and what they said',
    mentionNotice.message.includes('Comment Probe Surveyor') &&
      mentionNotice.caseId === primary.id &&
      mentionNotice.commentId === mention.json.comment.id,
    { mentionNotice }
  );

  const outsider = await inboxOf(cookieStrange);
  record(
    'a member who cannot open the case is not told about it, and is not given a notice that leads to a closed door',
    outsider.json.unread === 0 && mentionResult.notOnCase[0].token === tokenOf('strange').slice(1),
    { unread: outsider.json.unread, notOnCase: mentionResult.notOnCase }
  );

  const claimedOnly = await call(`/api/cases/${primary.id}/comments`, {
    method: 'POST',
    cookie: cookieLead,
    body: {
      body: 'A note that names nobody in its own words.',
      mentions: [tokenOf('helper').slice(1)],
    },
  });
  record(
    'a payload cannot mention a person the sentence does not actually name',
    claimedOnly.status === 201 &&
      claimedOnly.json.mentions.notified.length === 0 &&
      claimedOnly.json.mentions.unknown.length === 0,
    claimedOnly.json && claimedOnly.json.mentions
  );

  /* 5. An instruction is a comment with the authority of §12's "admin adds instructions" behind it. */
  const instruction = await call(`/api/cases/${primary.id}/comments`, {
    method: 'POST',
    cookie: cookieLead,
    body: {
      body: 'Please upload close-up photographs of the damaged chassis area.',
      instruction: true,
    },
  });
  const workerAfterInstruction = await inboxOf(cookieWorker);
  const helperAfterInstruction = await inboxOf(cookieHelper);
  record(
    '§12 admin instruction: an instruction reaches everyone who shares the case and is filed as one',
    instruction.status === 201 &&
      instruction.json.comment.isInstruction === true &&
      ofType(workerAfterInstruction.rows, 'admin_instruction').length === 1 &&
      ofType(helperAfterInstruction.rows, 'admin_instruction').length === 1,
    {
      status: instruction.status,
      worker: ofType(workerAfterInstruction.rows, 'admin_instruction').length,
      helper: ofType(helperAfterInstruction.rows, 'admin_instruction').length,
    }
  );

  const staffInstruction = await call(`/api/cases/${primary.id}/comments`, {
    method: 'POST',
    cookie: cookieWorker,
    body: { body: 'An instruction written by the member doing the work.', instruction: true },
  });
  record(
    'the instruction flag belongs to the people who hand out work, not to whoever can type',
    staffInstruction.status === 403 && staffInstruction.json.code === 'instruction_forbidden',
    staffInstruction.json
  );

  const replyNotice = await inboxOf(cookieWorker);
  record(
    'the person being answered is told, whether or not they were mentioned',
    ofType(replyNotice.rows, 'case_comment').some((row) => row.message.includes('replied')) &&
      replyNotice.json.unread > 0,
    { notices: ofType(replyNotice.rows, 'case_comment').map((row) => row.message) }
  );

  /* 6. Attachment: §11's supporting file is a document already filed under the case. */
  const registered = await call('/api/documents', {
    method: 'POST',
    cookie: cookieWorker,
    body: { case: primary.id, category: 'Inspection Photos', filename: 'chassis-plate.jpg' },
  });
  const documentId = registered.json && registered.json.document && registered.json.document.id;
  const bytesLanded = await sendBytes(`/api/documents/${documentId}/file`, jpegBytes, cookieWorker);
  const withFile = await call(`/api/cases/${primary.id}/comments`, {
    method: 'POST',
    cookie: cookieWorker,
    body: { body: 'The chassis plate, as asked for.', documentId },
  });
  const foreign = await call('/api/documents', {
    method: 'POST',
    cookie: cookieStrange,
    body: { case: sealed.id, category: 'Bills', filename: 'other-case.jpg' },
  });
  const foreignId = foreign.json && foreign.json.document && foreign.json.document.id;
  const crossed = await call(`/api/cases/${primary.id}/comments`, {
    method: 'POST',
    cookie: cookieLead,
    body: { body: 'Pointing at a file on somebody else', documentId: foreignId },
  });
  record(
    '§11 attach supporting files: the comment points at a document on the case, and a file on another case is refused',
    bytesLanded.status === 200 &&
      withFile.status === 201 &&
      withFile.json.comment.documentFilename === 'chassis-plate.jpg' &&
      withFile.json.comment.documentStatus === 'Pending Verification' &&
      crossed.status === 403 &&
      crossed.json.code === 'document_case_mismatch',
    {
      landed: bytesLanded.status,
      attached: withFile.json && withFile.json.comment,
      crossed: crossed.json,
    }
  );

  /* 7. Read and unread, per person rather than per thread. */
  const threadAsHelper = await call(`/api/cases/${primary.id}/comments`, { cookie: cookieHelper });
  const rowsAsHelper = (threadAsHelper.json && threadAsHelper.json.comments) || [];
  record(
    'the thread carries the author, the time, the replies and which rows this person has not read',
    threadAsHelper.status === 200 &&
      rowsAsHelper.length >= 5 &&
      rowsAsHelper.every((row) => row.authorName && row.createdAt) &&
      rowsAsHelper.filter((row) => row.unread).length === rowsAsHelper.length &&
      threadAsHelper.json.unread === rowsAsHelper.length &&
      threadAsHelper.json.can.comment === true &&
      threadAsHelper.json.can.instruct === false,
    {
      status: threadAsHelper.status,
      rows: rowsAsHelper.map((row) => ({ unread: row.unread, author: row.authorName })),
      can: threadAsHelper.json && threadAsHelper.json.can,
    }
  );

  const threadAsWorker = await call(`/api/cases/${primary.id}/comments`, { cookie: cookieWorker });
  const rowsAsWorker = (threadAsWorker.json && threadAsWorker.json.comments) || [];
  record(
    'nobody has an unread notice about their own sentence',
    rowsAsWorker.filter((row) => row.unread).length ===
      rowsAsWorker.filter((row) => row.authorName !== 'Comment Probe Worker').length,
    {
      unread: rowsAsWorker.filter((row) => row.unread).length,
      ofOthers: rowsAsWorker.filter((row) => row.authorName !== 'Comment Probe Worker').length,
    }
  );

  const registerBeforeRead = await call('/api/cases', { cookie: cookieHelper });
  const unreadOnRegister = (registerBeforeRead.json.commentUnread || {})[primary.id] || 0;
  await call(`/api/cases/${primary.id}/comments/read`, { method: 'POST', cookie: cookieHelper });
  const threadAfterRead = await call(`/api/cases/${primary.id}/comments`, { cookie: cookieHelper });
  const registerAfterRead = await call('/api/cases', { cookie: cookieHelper });
  record(
    '§11 read/unread: opening the thread clears the marker, and the register carries it before that',
    unreadOnRegister > 0 &&
      threadAfterRead.json.unread === 0 &&
      (registerAfterRead.json.commentUnread || {})[primary.id] === undefined,
    { before: unreadOnRegister, after: (registerAfterRead.json.commentUnread || {})[primary.id] }
  );

  const sealedThread = await call(`/api/cases/${sealed.id}/comments`, { cookie: cookieHelper });
  const sealedPost = await call(`/api/cases/${sealed.id}/comments`, {
    method: 'POST',
    cookie: cookieHelper,
    body: { body: 'Something said about a file this member cannot open.' },
  });
  const noBody = await call('/api/cases/does-not-exist-at-all-9/comments', {
    cookie: cookieHelper,
  });
  record(
    'a comment is not a side door: the case rule answers for the thread exactly as it does for the case',
    sealedThread.status === 403 &&
      sealedThread.json.code === 'case_forbidden' &&
      sealedPost.status === 403 &&
      noBody.status === 404,
    { thread: sealedThread.json, post: sealedPost.json, missing: noBody.json }
  );

  /* 8. The decisions §8 makes and §12 says must be announced. Each decision only moves a document that
     is waiting for one, so the two sentences need two files: a rejected document is settled by a
     replacement, not by a second decision on the same row. */
  const rejected = await call(`/api/documents/${documentId}/reject`, {
    method: 'POST',
    cookie: cookieLead,
    body: { reason: 'The plate number is not legible in this light.' },
  });
  const afterRejection = await inboxOf(cookieWorker);
  const rejectionNotice = ofType(afterRejection.rows, 'document_rejected')[0] || {};
  record(
    '§12 document rejected: the uploader is told which file, in the words the verifier used',
    rejected.status === 200 &&
      rejectionNotice.documentId === documentId &&
      rejectionNotice.message.includes('The plate number is not legible') &&
      rejectionNotice.message.includes('chassis-plate.jpg'),
    { status: rejected.status, notice: rejectionNotice }
  );

  const second = await call('/api/documents', {
    method: 'POST',
    cookie: cookieWorker,
    body: { case: primary.id, category: 'Bills', filename: 'repair-bill.jpg' },
  });
  const secondId = second.json && second.json.document && second.json.document.id;
  const secondBytes = await sendBytes(`/api/documents/${secondId}/file`, jpegBytes, cookieWorker);
  const asked = await call(`/api/documents/${secondId}/request_replacement`, {
    method: 'POST',
    cookie: cookieLead,
    body: { reason: 'Photograph the plate again, straight on.' },
  });
  const afterReplacementAsk = await inboxOf(cookieWorker);
  const askNotice = ofType(afterReplacementAsk.rows, 'correction_requested').find(
    (row) => row.documentId === secondId
  );
  record(
    '§12 correction requested: a document sent back for a new copy reads as a request, not a rejection',
    secondBytes.status === 200 &&
      asked.status === 200 &&
      Boolean(askNotice) &&
      askNotice.message.includes('asked for a new copy of') &&
      askNotice.message.includes('repair-bill.jpg'),
    { bytes: secondBytes.status, status: asked.status, json: asked.json, notice: askNotice }
  );

  const replacement = await call(`/api/documents/${secondId}/replace`, {
    method: 'POST',
    cookie: cookieWorker,
    body: {},
  });
  const replacementId =
    replacement.json && replacement.json.document && replacement.json.document.id;
  const beforeLanding = await inboxOf(cookieLead);
  const replacementBytes = await sendBytes(
    `/api/documents/${replacementId}/file`,
    Buffer.concat([jpegBytes, Buffer.from('v2')]),
    cookieWorker
  );
  const afterLanding = await inboxOf(cookieLead);
  const replacedNotice = ofType(afterLanding.rows, 'work_submitted').find(
    (row) => row.documentId === replacementId
  );
  record(
    '§12 staff submits work: the person who asked for the new copy is told it landed, and not before',
    replacement.status === 201 &&
      !ofType(beforeLanding.rows, 'work_submitted').some(
        (row) => row.documentId === replacementId
      ) &&
      replacementBytes.status === 200 &&
      Boolean(replacedNotice) &&
      replacedNotice.message.includes('version 2') &&
      replacedNotice.message.includes('ready to be checked'),
    {
      replace: replacement.status,
      bytes: replacementBytes.status,
      notice: replacedNotice,
    }
  );

  /* 9. The §6 workflow, announced. */
  const submitted = await call(`/api/tasks/${assignment.taskId}/submit`, {
    method: 'POST',
    cookie: cookieWorker,
    body: {},
  });
  const adminAfterSubmit = await inboxOf(cookieAdmin);
  const submitNotice = ofType(adminAfterSubmit.rows, 'work_submitted')[0] || {};
  record(
    '§12 staff submits work: it goes to the member who handed it out',
    submitted.status === 200 &&
      submitNotice.taskId === assignment.taskId &&
      submitNotice.message.includes('Comment Probe Worker'),
    { status: submitted.status, notice: submitNotice }
  );

  const returned = await call(`/api/tasks/${assignment.taskId}/reject`, {
    method: 'POST',
    cookie: cookieAdmin,
    body: { reason: 'The estimate is missing the labour lines.' },
  });
  const afterReturn = await inboxOf(cookieWorker);
  const returnNotice = ofType(afterReturn.rows, 'correction_requested').find(
    (row) => row.taskId === assignment.taskId
  );
  record(
    '§12 correction requested: work returned says what was wrong in the bell as well as on the task',
    returned.status === 200 &&
      Boolean(returnNotice) &&
      returnNotice.message.includes('The estimate is missing the labour lines'),
    { status: returned.status, notice: returnNotice }
  );

  const resubmitted = await call(`/api/tasks/${assignment.taskId}/resubmit`, {
    method: 'POST',
    cookie: cookieWorker,
    body: {},
  });
  const approved = await call(`/api/tasks/${assignment.taskId}/approve`, {
    method: 'POST',
    cookie: cookieAdmin,
    body: {},
  });
  const afterApproval = await inboxOf(cookieWorker);
  const approvalNotice = ofType(afterApproval.rows, 'task_approved')[0] || {};
  record(
    '§12 task approved: the member who did the work is told it is finished',
    resubmitted.status === 200 &&
      approved.status === 200 &&
      approvalNotice.taskId === assignment.taskId &&
      approvalNotice.message.includes('approved'),
    { resubmit: resubmitted.status, approve: approved.status, notice: approvalNotice }
  );

  /* 10. The brief, and the move of the work itself. The helper's own task, because the case thread in
     §5 put an instruction on this inbox already and the two sentences have to be told apart by the
     work they name rather than by counting. */
  const helperTask = (workToHelper.json && workToHelper.json.task) || {};
  const rebrief = await call(`/api/tasks/${helperTask.id}`, {
    method: 'PATCH',
    cookie: cookieAdmin,
    body: {
      instructions: 'Take the bill from the garage manager, not the owner.',
      dueDate: dayText(5),
    },
  });
  const helperAfterBrief = await inboxOf(cookieHelper);
  const briefInstruction = ofType(helperAfterBrief.rows, 'admin_instruction').find(
    (row) => row.taskId === helperTask.id
  );
  const briefChanged = ofType(helperAfterBrief.rows, 'assignment_changed').find(
    (row) => row.taskId === helperTask.id
  );
  record(
    '§12 tells an instruction and a changed assignment as the two different sentences they are',
    rebrief.status === 200 &&
      Boolean(briefInstruction) &&
      briefInstruction.message.includes('Repair Bill Collection') &&
      Boolean(briefChanged) &&
      briefChanged.message.includes(dayText(5)),
    { status: rebrief.status, briefInstruction, briefChanged }
  );

  const third = await giveWork(helper, 'legal documents', {
    type: 'Legal Document Collection',
    dueIn: 9,
  });
  const thirdTaskId = third.json && third.json.task && third.json.task.id;
  const moved = await call(`/api/tasks/${thirdTaskId}/reassign`, {
    method: 'POST',
    cookie: cookieAdmin,
    body: {
      assigneeUserId: worker.id,
      reason: 'The garage is on the way to the second inspection.',
    },
  });
  const workerAfterMove = await inboxOf(cookieWorker);
  const helperAfterMove = await inboxOf(cookieHelper);
  const movedTo = ofType(workerAfterMove.rows, 'assignment_changed').find((row) =>
    row.message.includes('moved')
  );
  const movedFrom = ofType(helperAfterMove.rows, 'assignment_changed').find((row) =>
    row.message.includes('away')
  );
  record(
    '§12 assignment changed: both halves of a reassignment get their own sentence',
    moved.status === 200 &&
      Boolean(movedTo) &&
      movedTo.taskId === thirdTaskId &&
      Boolean(movedFrom) &&
      movedFrom.message.includes('Comment Probe Worker'),
    { status: moved.status, movedTo, movedFrom }
  );

  /* 11. Reading the bell: the six fields §12 lists, the count, and the two ways to mark it read. */
  const full = await inboxOf(cookieWorker);
  const sample = full.rows[0] || {};
  record(
    '§12 every notification carries its type, message, case, date and read status',
    full.status === 200 &&
      full.json.types.length === 13 &&
      full.json.deadlineDays >= 0 &&
      Object.keys(sample).sort().join(',') ===
        [
          'actorName',
          'actorUserId',
          'caseId',
          'commentId',
          'createdAt',
          'documentId',
          'id',
          'message',
          'readAt',
          'taskId',
          'type',
          'userId',
        ]
          .sort()
          .join(','),
    { status: full.status, keys: Object.keys(sample), types: full.json && full.json.types.length }
  );

  const badLimit = await call('/api/notifications?limit=0', { cookie: cookieWorker });
  const badLimit2 = await call('/api/notifications?limit=9999', { cookie: cookieWorker });
  record(
    'a page size that is not a page size is answered rather than ignored',
    badLimit.status === 400 && badLimit.json.code === 'invalid_limit' && badLimit2.status === 400,
    { badLimit: badLimit.json, badLimit2: badLimit2.json }
  );

  const beforeMark = await call('/api/notifications/count', { cookie: cookieWorker });
  const oneToMark = full.rows.find((row) => row.readAt === null);
  const marked = await call(`/api/notifications/${oneToMark.id}/read`, {
    method: 'POST',
    cookie: cookieWorker,
  });
  const afterMark = await call('/api/notifications/count', { cookie: cookieWorker });
  record(
    'the header count moves when one notice is read, and only when one is read',
    beforeMark.json.unread === afterMark.json.unread + 1 &&
      marked.json.unread === afterMark.json.unread &&
      marked.status === 200,
    {
      before: beforeMark.json.unread,
      after: afterMark.json.unread,
      marked: marked.json,
    }
  );

  const somebodyElses = marked.ok ? full.rows.filter((row) => row.readAt === null)[0] : oneToMark;
  const stolen = await call(`/api/notifications/${somebodyElses.id}/read`, {
    method: 'POST',
    cookie: cookieStrange,
  });
  record(
    'naming somebody else’s notification id does not read their bell for them',
    stolen.status === 404 && stolen.json.code === 'notification_not_found',
    stolen.json
  );

  const unreadOnly = await inboxOf(cookieHelper, '?unread=1');
  const readAll = await call('/api/notifications/read-all', {
    method: 'POST',
    cookie: cookieHelper,
  });
  const afterReadAll = await call('/api/notifications/count', { cookie: cookieHelper });
  record(
    'marking all read leaves nothing unread, and the unread filter agrees with the count',
    unreadOnly.rows.every((row) => row.readAt === null) &&
      readAll.json.unread === 0 &&
      afterReadAll.json.unread === 0 &&
      readAll.json.marked === unreadOnly.rows.length,
    {
      filtered: unreadOnly.rows.length,
      marked: readAll.json.marked,
      after: afterReadAll.json.unread,
    }
  );

  /* 12. The two account events, which end the session that made them — hence the table read. */
  const reset = await call(`/api/admin/users/${worker.id}/reset-password`, {
    method: 'POST',
    cookie: cookieAdmin,
    body: {},
  });
  const resetNotice = (
    await db.query(
      `SELECT type, message FROM notifications WHERE user_id = $1 AND type = 'password_reset_requested'`,
      [worker.id]
    )
  ).rows[0];
  const disabled = await call(`/api/admin/users/${helper.id}`, {
    method: 'PATCH',
    cookie: cookieAdmin,
    body: { isActive: false, remarks: 'Left the office.' },
  });
  const suspended = (
    await db.query(
      `SELECT type, message FROM notifications WHERE user_id = $1 AND type = 'account_suspended'`,
      [helper.id]
    )
  ).rows[0];
  const roleChanged = await call(`/api/admin/users/${strange.id}`, {
    method: 'PATCH',
    cookie: cookieAdmin,
    body: { role: 'SURVEYOR' },
  });
  const roleNotice = (
    await db.query(
      `SELECT type, message FROM notifications WHERE user_id = $1 AND type = 'assignment_changed'`,
      [strange.id]
    )
  ).rows[0];
  record(
    '§12 account suspended and password reset: both reach the account they are about, and neither carries a secret',
    reset.status === 200 &&
      Boolean(resetNotice) &&
      !JSON.stringify(resetNotice).includes(reset.json.temporaryPassword) &&
      disabled.status === 200 &&
      Boolean(suspended) &&
      suspended.message.includes('Left the office.') === false &&
      roleChanged.status === 200 &&
      Boolean(roleNotice) &&
      roleNotice.message.includes('SURVEYOR'),
    {
      reset: reset.status,
      resetNotice,
      suspended,
      roleNotice,
      remarksLeaked: suspended ? suspended.message.includes('Left the office.') : null,
    }
  );

  /* 13. The vocabulary the bell and the table agree on. */
  const constraint = await db.query(
    `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
     WHERE conrelid = 'notifications'::regclass AND conname = 'notifications_type_check'`
  );
  const declared = (constraint.rows[0] || {}).def || '';
  const missingTypes = full.json.types.filter((type) => !declared.includes(`'${type}'`));
  record(
    'the thirteen types the server offers are the thirteen the database accepts',
    missingTypes.length === 0 && full.json.types.length === 13,
    { missingTypes, declared }
  );

  /* 14. Nothing is left behind. The accounts go first and by id, so the cascade takes their
     notifications, their read markers and their audit rows with them rather than leaving rows that
     name nobody — and the sweep below is the proof, not the plan, so it runs after the deletes. */
  const ids = [admin.id, lead.id, worker.id, helper.id, strange.id];
  await db.query('DELETE FROM notifications WHERE user_id = ANY($1::uuid[])', [ids]);
  await db.query('DELETE FROM case_comment_reads WHERE user_id = ANY($1::uuid[])', [ids]);
  await db.query('DELETE FROM case_comments WHERE author_user_id = ANY($1::uuid[])', [ids]);
  await db.query('DELETE FROM tasks WHERE assignee_user_id = ANY($1::uuid[])', [ids]);
  await db.query('DELETE FROM documents WHERE uploaded_by = ANY($1::uuid[])', [ids]);
  await db.query('DELETE FROM cases WHERE owner_user_id = ANY($1::uuid[])', [ids]);
  await db.query('DELETE FROM audit_logs WHERE actor_user_id = ANY($1::uuid[])', [ids]);
  await db.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [ids]);
  removeUploadDirs();

  const leftovers = await db.query(
    `SELECT
       (SELECT count(*)::int FROM cases WHERE id = ANY($1::text[])) AS cases,
       (SELECT count(*)::int FROM case_comments WHERE case_id = ANY($1::text[])) AS comments,
       (SELECT count(*)::int FROM case_comment_reads WHERE user_id = ANY($2::uuid[])) AS reads,
       (SELECT count(*)::int FROM notifications WHERE user_id = ANY($2::uuid[])) AS notifications,
       (SELECT count(*)::int FROM documents WHERE case_id = ANY($1::text[])) AS documents,
       (SELECT count(*)::int FROM tasks WHERE case_id = ANY($1::text[])) AS tasks,
       (SELECT count(*)::int FROM users WHERE email LIKE 'note-%@example.invalid') AS accounts`,
    [caseIds, ids]
  );
  const dirsLeft = fs.existsSync(UPLOAD_ROOT)
    ? fs.readdirSync(UPLOAD_ROOT).filter((name) => probeCaseId.test(name))
    : [];
  const left = leftovers.rows[0];
  record(
    'the suite leaves the register, the threads, the bells, the documents, the work and the bytes as it found them',
    caseIds.length === 2 &&
      taskIds.length >= 3 &&
      left.cases === 0 &&
      left.comments === 0 &&
      left.reads === 0 &&
      left.notifications === 0 &&
      left.documents === 0 &&
      left.tasks === 0 &&
      left.accounts === 0 &&
      dirsLeft.length === 0,
    { ...left, dirsLeft, caseIds: caseIds.length, taskIds: taskIds.length }
  );

  const failed = results.filter((r) => !r.ok);
  console.log(
    JSON.stringify(
      {
        suite: 'case comments and notifications',
        passed: results.length - failed.length,
        failed: failed.length,
        total: results.length,
        casesRemoved: caseIds.length,
        workAssignedRemoved: taskIds.length,
        failures: failed.map((f) => ({ name: f.name, detail: f.detail })),
      },
      null,
      2
    )
  );
  process.exit(failed.length ? 1 : 0);
})().catch((error) => {
  /* A run that throws part-way still has to say which assertion the server broke on, because the
     startup sweep above takes care of the rows this run could not clean up itself. */
  console.log(
    JSON.stringify(
      {
        suite: 'case comments and notifications',
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
