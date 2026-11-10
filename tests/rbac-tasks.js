/* End-to-end check of §5 (case and task assignment) and §6 (the approval workflow) against the live
   server on 3000 — the second suite that writes business rows, and it inherits the first one's rule:
   nothing it makes is left behind. Tasks and their events go with the case they hang from, the case
   goes by id, the audit rows go by the probe that wrote them, and the final counts are printed.

   Everything runs on throwaway accounts under @example.invalid, with addresses prefixed 'task-' so
   this sweep cannot reach the case registry's probes.

   Four pieces of work are opened and each answers a different question, because the status of a task
   is what every rule here is about and a single task cannot be in two states at once:
     A  lead → staff, Physical Inspection   the whole §6 path, acceptance to approval
     B  lead → other, Document Collection   reassignment, editing, withdrawal
     C  lead → staff, Photograph Collection self-approval and the duplicate guard
     D  spare case → staff, Document Collection  §2: an assignment makes the case reachable */
const db = require('../db/index.js');
const argon2 = require('argon2');

const BASE = process.env.RBAC_BASE || 'http://127.0.0.1:3000';
const PASSWORD = 'Task-Probe-2026!';
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
  db.createSessionForUser(userId, { metadata: { browserName: 'task-probe' } });

const stamp = Date.now();
const email = (who) => `task-${who}-${stamp}@example.invalid`;

/* The case shape the browser really sends, trimmed to what the registry indexes. */
const caseBody = (over = {}) => ({
  id: over.id || `taskprobe${stamp}${Math.random().toString(36).slice(2, 7)}`,
  mod: 'motor',
  cr: stamp - 60000,
  u: stamp,
  st: 'Intimation',
  due: '',
  owner: '',
  x: {},
  f: {
    case_claimNo: over.claimNo || `TSK-${stamp}`,
    case_policyNo: over.policyNo || '',
    case_company: over.insurer || '',
    pol_insured: over.insured || '',
    case_insReg: over.reg || '',
    case_surveyor: over.surveyor || '',
    ...(over.f || {}),
  },
});

(async () => {
  /* A run that crashed part-way leaves its probes behind, and one stale open task is enough to make
     the duplicate guard or the reachability rule read as a bug. The sweep is bounded by the 'task-'
     address prefix, so it cannot touch another suite's rows — the ownership probes are 'ow-', the
     case registry's are 'case-'. */
  const sweep = `email LIKE 'task-%@example.invalid'`;
  const myCases = `owner_user_id IN (SELECT id FROM users WHERE ${sweep})`;
  await db.query(`DELETE FROM tasks WHERE case_id IN (SELECT id FROM cases WHERE ${myCases})`);
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

  const lead = await make('lead', 'SURVEYOR', 'Task Probe Surveyor');
  const staff = await make('worker', 'STAFF', 'Task Probe Staff');
  const other = await make('other', 'STAFF', 'Task Probe Other');
  const admin = await make('admin', 'ADMIN', 'Task Probe Admin');

  const cookieLead = await mint(lead.id);
  const cookieStaff = await mint(staff.id);
  const cookieOther = await mint(other.id);
  const cookieAdmin = await mint(admin.id);

  const caseIds = [];
  const openCase = async (cookie, over) => {
    const body = caseBody(over);
    caseIds.push(body.id);
    const res = await call(`/api/cases/${body.id}`, { method: 'PUT', cookie, body });
    return { id: body.id, status: res.status, json: res.json };
  };

  /* The case every task but D hangs from, opened by the surveyor who owns it. */
  const primary = await openCase(cookieLead, {
    claimNo: `TSK-MAIN-${stamp}`,
    insurer: 'Nepal Insurance Ltd',
    surveyor: 'Task Probe Surveyor',
  });
  record('a probe case is open on the registry to attach work to', primary.status === 200, {
    status: primary.status,
    code: primary.json?.code,
  });
  const spare = await openCase(cookieLead, { claimNo: `TSK-SPARE-${stamp}` });

  const taskIds = [];
  const assign = async (cookie, over = {}) => {
    const res = await call('/api/tasks', {
      method: 'POST',
      cookie,
      body: {
        caseId: over.caseId || primary.id,
        assigneeUserId: over.assigneeUserId || staff.id,
        assignmentType: over.assignmentType || 'Physical Inspection',
        priority: over.priority,
        dueDate: over.dueDate,
        instructions: over.instructions,
      },
    });
    if (res.json && res.json.task) taskIds.push(res.json.task.id);
    return res;
  };
  const move = (id, action, cookie, body) =>
    call(`/api/tasks/${id}/${action}`, { method: 'POST', cookie, body: body || {} });

  /* 1. §5 — who may assign at all, and to whom */
  const madeA = await assign(cookieLead, {
    instructions: 'Inspect the vehicle at the garage and photograph the registration plate.',
    dueDate: '2026-11-20',
    priority: 'High',
  });
  const A = madeA.json?.task || {};
  record(
    'a member with assign_case opens a task on a case they can reach',
    madeA.status === 201 && A.status === 'Assigned',
    { status: madeA.status, code: madeA.json?.code }
  );
  record(
    'the task carries the case, the member, the assigner and the fields §5 lists',
    A.caseId === primary.id &&
      A.assigneeUserId === staff.id &&
      A.assignedByUserId === lead.id &&
      A.assignmentType === 'Physical Inspection' &&
      A.priority === 'High' &&
      A.dueDate === '2026-11-20' &&
      String(A.instructions || '').startsWith('Inspect the vehicle'),
    {
      caseId: A.caseId,
      assigneeUserId: A.assigneeUserId,
      assignedByUserId: A.assignedByUserId,
      priority: A.priority,
      dueDate: A.dueDate,
    }
  );

  const madeB = await assign(cookieLead, {
    assigneeUserId: other.id,
    assignmentType: 'Document Collection',
  });
  const B = madeB.json?.task || {};
  const madeC = await assign(cookieLead, { assignmentType: 'Photograph Collection' });
  const C = madeC.json?.task || {};

  const staffAssigns = await assign(cookieStaff, { assignmentType: 'Inspection Checklist' });
  record(
    'a staff member cannot assign work at all (§2: staff do not assign cases to themselves)',
    staffAssigns.status === 403 && staffAssigns.json.code === 'permission_denied',
    { status: staffAssigns.status, permission: staffAssigns.json?.permission }
  );

  const notACase = await call('/api/tasks', {
    method: 'POST',
    cookie: cookieLead,
    body: { caseId: 'not-a-case', assigneeUserId: staff.id, assignmentType: 'Other' },
  });
  record(
    'a case id that is not one is refused',
    /* The registry's own convention, kept: a well-formed id that is simply not in the table is a 404,
       and only an id that could never be one is a 400. */
    notACase.status === 404 && notACase.json.code === 'case_not_found',
    notACase.json?.code
  );

  const wrongType = await assign(cookieLead, { assignmentType: 'Photograph of the engine' });
  record(
    'an assignment type outside the eight is refused, and says which there are',
    wrongType.status === 400 &&
      wrongType.json.code === 'invalid_assignment_type' &&
      wrongType.json.allowed.length === 8,
    { status: wrongType.status, allowed: wrongType.json?.allowed?.length }
  );
  const wrongPriority = await assign(cookieLead, { priority: 'Critical' });
  record(
    'a priority outside the four the dashboard uses is refused',
    wrongPriority.status === 400 && wrongPriority.json.code === 'invalid_priority',
    { status: wrongPriority.status, allowed: wrongPriority.json?.allowed }
  );
  const wrongDate = await assign(cookieLead, { dueDate: '<b>2026-11</b>' });
  record(
    'a deadline that is not a date is refused',
    wrongDate.status === 400 && wrongDate.json.code === 'invalid_due_date',
    wrongDate.json?.code
  );
  const noMember = await assign(cookieLead, {
    assigneeUserId: '11111111-1111-1111-1111-111111111111',
  });
  record(
    'an assignee who is not an account is refused',
    noMember.status === 400 && noMember.json.code === 'invalid_assignee',
    noMember.json?.code
  );

  await db.query('UPDATE users SET is_active = FALSE WHERE id = $1', [other.id]);
  const sleeping = await assign(cookieLead, { assigneeUserId: other.id, assignmentType: 'Other' });
  record(
    'a deactivated member is not given work',
    sleeping.status === 400 && sleeping.json.code === 'assignee_inactive',
    { status: sleeping.status, code: sleeping.json?.code }
  );
  await db.query('UPDATE users SET is_active = TRUE WHERE id = $1', [other.id]);

  const twice = await assign(cookieLead, {});
  record(
    'the same member is not asked twice for the same kind of work on one case',
    twice.status === 409 && twice.json.code === 'task_duplicate',
    { status: twice.status, code: twice.json?.code }
  );
  const differentKind = await assign(cookieLead, { assignmentType: 'Legal Document Collection' });
  record(
    'a second kind of work for the same member is a separate task, and is tidied up by this suite',
    differentKind.status === 201,
    { status: differentKind.status }
  );

  /* 2. §6 — the eleven steps, on task A */
  const accepted = await move(A.id, 'accept', cookieStaff);
  record(
    'the member accepts the work and the moment is stamped',
    accepted.json?.task?.status === 'Accepted' && Boolean(accepted.json.task.acceptedAt),
    { status: accepted.status, code: accepted.json?.code }
  );
  const colleagueStarts = await move(A.id, 'start', cookieOther);
  record(
    'a colleague cannot start work that was not given to them',
    colleagueStarts.status === 403 && colleagueStarts.json.code === 'task_not_yours',
    { status: colleagueStarts.status, code: colleagueStarts.json?.code }
  );
  const started = await move(A.id, 'start', cookieStaff);
  record(
    'starting the work moves it to In Progress',
    started.json?.task?.status === 'In Progress',
    { code: started.json?.code }
  );
  const tooEarly = await move(A.id, 'approve', cookieLead);
  record(
    'work that was never submitted cannot be approved',
    tooEarly.status === 409 &&
      tooEarly.json.code === 'task_not_ready' &&
      tooEarly.json.status === 'In Progress',
    { status: tooEarly.status, code: tooEarly.json?.code }
  );
  const submitted = await move(A.id, 'submit', cookieStaff);
  record(
    'the member submits for review',
    submitted.json?.task?.status === 'Submitted for Review' &&
      Boolean(submitted.json.task.submittedAt),
    { code: submitted.json?.code }
  );
  const selfApproved = await move(C.id, 'submit', cookieStaff).then(() =>
    move(C.id, 'approve', cookieStaff)
  );
  record(
    '§6 step 11 and §2: the member who did the work cannot approve it, whatever they hold',
    selfApproved.status === 403 && selfApproved.json.code === 'self_approval_forbidden',
    { status: selfApproved.status, code: selfApproved.json?.code }
  );
  const staffApprovesB = await move(B.id, 'approve', cookieStaff);
  record(
    'and a staff account has no approval permission to use on somebody else’s work either',
    staffApprovesB.status === 403 &&
      staffApprovesB.json.code === 'permission_denied' &&
      staffApprovesB.json.permission === 'approve_task',
    { code: staffApprovesB.json?.code, permission: staffApprovesB.json?.permission }
  );

  const bareReject = await move(A.id, 'reject', cookieLead);
  record(
    '§6 step 8: a rejection with no reason is refused',
    bareReject.status === 400 && bareReject.json.code === 'reason_required',
    { status: bareReject.status, code: bareReject.json?.code }
  );
  const rejected = await move(A.id, 'reject', cookieLead, {
    reason: 'The registration plate is missing from the photographs.',
  });
  record(
    'a rejection with a reason returns the work and keeps the reason on the task',
    rejected.json?.task?.status === 'Correction Required' &&
      String(rejected.json.task.reviewReason || '').includes('registration plate'),
    { status: rejected.status, code: rejected.json?.code }
  );
  const submitAgain = await move(A.id, 'submit', cookieStaff);
  record(
    'returned work is resubmitted, not submitted as if for the first time',
    submitAgain.status === 409 && submitAgain.json.code === 'task_not_ready',
    { code: submitAgain.json?.code }
  );
  const resubmitted = await move(A.id, 'resubmit', cookieStaff);
  record('the member corrects and resubmits', resubmitted.json?.task?.status === 'Resubmitted', {
    code: resubmitted.json?.code,
  });
  const approved = await move(A.id, 'approve', cookieLead, { reason: 'Photographs are complete.' });
  record(
    'the reviewer approves, and the decision says who made it',
    approved.json?.task?.status === 'Approved' &&
      approved.json.task.reviewedByUserId === lead.id &&
      Boolean(approved.json.task.reviewedAt),
    { status: approved.status, code: approved.json?.code }
  );
  const approveAgain = await move(A.id, 'approve', cookieLead);
  record(
    'approved work cannot be moved again',
    approveAgain.status === 409 && approveAgain.json.code === 'task_not_ready',
    { code: approveAgain.json?.code, status: approveAgain.json?.status }
  );

  /* 3. §6 — every transition recorded */
  const detailA = await call(`/api/tasks/${A.id}`, { cookie: cookieLead });
  const trail = detailA.json?.events || [];
  record(
    'every transition of the task is recorded, in order, from the assignment to the approval',
    trail.map((e) => e.action).join(',') ===
      'assigned,accepted,started,submitted,returned,resubmitted,approved',
    { actions: trail.map((e) => e.action) }
  );
  record(
    'the record names who moved it, keeps the reason a reviewer gave, and is only ever about this task',
    trail.filter((e) => e.actorUserId === staff.id).length >= 3 &&
      trail.some((e) => String(e.reason || '').includes('registration plate')) &&
      trail.every((e) => e.taskId === A.id),
    { staffMoves: trail.filter((e) => e.actorUserId === staff.id).length }
  );
  const otherReadsA = await call(`/api/tasks/${A.id}`, { cookie: cookieOther });
  record(
    'a member with other work on the same case reads the task through the case rule',
    otherReadsA.status === 200 && otherReadsA.json.events.length === trail.length,
    { status: otherReadsA.status, code: otherReadsA.json?.code }
  );
  const outsiderReadsA = await call(`/api/tasks/${A.id}`, { cookie: cookieAdmin });
  record(
    'and an administrator reads it too, without any work on the case at all',
    outsiderReadsA.status === 200,
    outsiderReadsA.status
  );

  /* 4. §5 — reassign, change, withdraw, on task B */
  const selfTransfer = await call(`/api/tasks/${B.id}/reassign`, {
    method: 'POST',
    cookie: cookieOther,
    body: { assigneeUserId: staff.id },
  });
  record(
    '§5: a member cannot transfer their own assignment to somebody else',
    selfTransfer.status === 403 &&
      selfTransfer.json.code === 'permission_denied' &&
      selfTransfer.json.permission === 'reassign_case',
    { code: selfTransfer.json?.code, permission: selfTransfer.json?.permission }
  );
  const reassigned = await call(`/api/tasks/${B.id}/reassign`, {
    method: 'POST',
    cookie: cookieLead,
    body: { assigneeUserId: staff.id, reason: 'The garage is nearer to the other member.' },
  });
  record(
    'the assigner moves the work to another member and it starts again',
    reassigned.json?.task?.assigneeUserId === staff.id &&
      reassigned.json.task.status === 'Assigned' &&
      !reassigned.json.task.acceptedAt &&
      reassigned.json.task.assignedByUserId === lead.id,
    { status: reassigned.status, code: reassigned.json?.code }
  );
  const reassignApproved = await call(`/api/tasks/${A.id}/reassign`, {
    method: 'POST',
    cookie: cookieLead,
    body: { assigneeUserId: other.id },
  });
  record(
    'approved work stays with the member who did it',
    reassignApproved.status === 409 && reassignApproved.json.code === 'task_approved',
    { code: reassignApproved.json?.code }
  );

  const edited = await call(`/api/tasks/${B.id}`, {
    method: 'PATCH',
    cookie: cookieLead,
    body: {
      priority: 'Urgent',
      dueDate: '2026-11-18',
      instructions: 'Collect the FIR copy as well.',
    },
  });
  record(
    'the assigner can change the deadline, the priority and the instructions',
    edited.json?.task?.priority === 'Urgent' &&
      edited.json.task.dueDate === '2026-11-18' &&
      String(edited.json.task.instructions || '').includes('FIR'),
    { status: edited.status, code: edited.json?.code }
  );
  const assigneeEdits = await call(`/api/tasks/${B.id}`, {
    method: 'PATCH',
    cookie: cookieStaff,
    body: { priority: 'Normal' },
  });
  record(
    'the member doing the work cannot rewrite the brief they were given',
    assigneeEdits.status === 403 && assigneeEdits.json.code === 'task_not_yours',
    { code: assigneeEdits.json?.code }
  );
  const editApproved = await call(`/api/tasks/${A.id}`, {
    method: 'PATCH',
    cookie: cookieLead,
    body: { dueDate: '2027-01-01' },
  });
  record(
    'a finished task keeps the deadline it was judged against',
    editApproved.status === 409 && editApproved.json.code === 'task_closed',
    { code: editApproved.json?.code }
  );

  const cancelBare = await move(B.id, 'cancel', cookieLead);
  record(
    'withdrawing an assignment without a reason is refused',
    cancelBare.status === 400 && cancelBare.json.code === 'reason_required',
    { code: cancelBare.json?.code }
  );
  const cancelByAssignee = await move(B.id, 'cancel', cookieStaff);
  record(
    'the member cannot withdraw work that was given to them',
    cancelByAssignee.status === 403 && cancelByAssignee.json.code === 'task_not_yours',
    { code: cancelByAssignee.json?.code }
  );
  const cancelled = await move(B.id, 'cancel', cookieLead, {
    reason: 'The claim was closed by the insurer.',
  });
  record(
    'the assigner withdraws the assignment and the reason is kept',
    cancelled.json?.task?.status === 'Cancelled' &&
      String(cancelled.json.task.cancelledReason || '').includes('closed by the insurer'),
    { status: cancelled.status, code: cancelled.json?.code }
  );

  /* 5. §2 — an assignment is what makes a case reachable for a member */
  const madeD = await assign(cookieLead, {
    caseId: spare.id,
    assignmentType: 'Repair Bill Collection',
  });
  const D = madeD.json?.task || {};
  const beforeD = await call(`/api/cases/${spare.id}`, { cookie: cookieOther });
  record(
    'a staff member with no connection to a case cannot open it',
    beforeD.status === 403 && beforeD.json.code === 'case_forbidden',
    { status: beforeD.status, code: beforeD.json?.code }
  );
  const afterD = await call(`/api/cases/${spare.id}`, { cookie: cookieStaff });
  record(
    'assigning them work on it makes the file theirs to open (their assigned cases)',
    madeD.status === 201 && afterD.status === 200,
    { assign: madeD.status, open: afterD.status, code: afterD.json?.code }
  );
  const listed = await call('/api/cases', { cookie: cookieStaff });
  const seen = (listed.json?.cases || []).map((row) => row.id);
  record(
    'and it appears in the list they are scoped to, not only when they guess the id',
    listed.json?.scope === 'own' && seen.includes(spare.id) && seen.includes(primary.id),
    { scope: listed.json?.scope, ids: seen }
  );
  /* Closing the work must close the door again, or a finished job would keep a case open forever. */
  await move(D.id, 'cancel', cookieLead, { reason: 'Done by the surveyor instead.' });
  const afterClose = await call(`/api/cases/${spare.id}`, { cookie: cookieStaff });
  record(
    'withdrawn work does not keep a case open to the member for ever',
    afterClose.status === 403,
    { status: afterClose.status, code: afterClose.json?.code }
  );

  /* 6. lists and scopes */
  const mine = await call('/api/tasks?scope=mine', { cookie: cookieStaff });
  record(
    'scope=mine returns only the caller’s own work, with the counts for a dashboard',
    mine.status === 200 &&
      mine.json.tasks.every((row) => row.assigneeUserId === staff.id) &&
      typeof mine.json.counts?.open === 'number',
    { count: mine.json?.tasks?.length, counts: mine.json?.counts }
  );
  record(
    'each row carries the case it belongs to, so one request paints the list',
    mine.json?.tasks?.length > 0 && mine.json.tasks.every((row) => Boolean(row.caseNumber)),
    { first: mine.json?.tasks?.[0]?.caseNumber }
  );
  const wantsAll = await call('/api/tasks?scope=all', { cookie: cookieStaff });
  record(
    'a staff account cannot list everybody’s work',
    wantsAll.status === 403 &&
      wantsAll.json.code === 'permission_denied' &&
      wantsAll.json.permission === 'view_all_cases',
    { code: wantsAll.json?.code }
  );
  const adminAll = await call('/api/tasks?scope=all', { cookie: cookieAdmin });
  record(
    'an administrator sees the register of work',
    adminAll.status === 200 && adminAll.json.tasks.length >= 4,
    { count: adminAll.json?.tasks?.length }
  );
  const handedOut = await call('/api/tasks?scope=assigned', { cookie: cookieLead });
  record(
    'the assigner sees what they handed out',
    handedOut.status === 200 &&
      handedOut.json.tasks.length >= 5 &&
      handedOut.json.tasks.every((row) => row.assignedByUserId === lead.id),
    { count: handedOut.json?.tasks?.length }
  );
  const openOnly = await call('/api/tasks?scope=all&open=1', { cookie: cookieAdmin });
  record(
    'the finished and withdrawn work can be filtered out',
    openOnly.status === 200 &&
      openOnly.json.tasks.every((row) => row.status !== 'Approved' && row.status !== 'Cancelled'),
    { count: openOnly.json?.tasks?.length }
  );
  const caseScope = await call(`/api/tasks?scope=case&case=${primary.id}`, { cookie: cookieStaff });
  record(
    'the work on one case is readable by a member who has open work on it',
    caseScope.status === 200 && caseScope.json.tasks.every((row) => row.caseId === primary.id),
    { count: caseScope.json?.tasks?.length }
  );
  const caseScopeClosed = await call(`/api/tasks?scope=case&case=${primary.id}`, {
    cookie: cookieOther,
  });
  record(
    'and the withdrawal of their task closed that list to them too',
    caseScopeClosed.status === 403 && caseScopeClosed.json.code === 'case_forbidden',
    { status: caseScopeClosed.status, code: caseScopeClosed.json?.code }
  );
  const caseDenied = await call(`/api/tasks?scope=case&case=${spare.id}`, { cookie: cookieAdmin });
  record(
    'and an administrator is never locked out of a case',
    caseDenied.status === 200,
    caseDenied.status
  );
  const badStatus = await call('/api/tasks?scope=mine&status=Wandering', { cookie: cookieStaff });
  record(
    'an unknown status filter is refused rather than silently empty',
    badStatus.status === 400 && badStatus.json.code === 'invalid_status',
    badStatus.json?.code
  );
  const badScope = await call('/api/tasks?scope=nonsense', { cookie: cookieStaff });
  record(
    'an unknown scope is refused',
    badScope.status === 400 && badScope.json.code === 'invalid_scope',
    badScope.json?.code
  );
  const anon = await call('/api/tasks?scope=mine');
  record('nobody is anonymous in the task register', anon.status === 401, anon.status);

  const history = await call(`/api/cases/${primary.id}/assignments`, { cookie: cookieLead });
  record(
    'the case screen gets the work on it and the whole assignment history in one call',
    history.status === 200 &&
      history.json.tasks.length >= 3 &&
      history.json.history.some((row) => row.action === 'assigned') &&
      history.json.history.some((row) => row.action === 'reassigned'),
    { tasks: history.json?.tasks?.length, history: history.json?.history?.length }
  );
  const historyAdmin = await call(`/api/cases/${primary.id}/assignments`, { cookie: cookieAdmin });
  record(
    'an administrator reads the same history',
    historyAdmin.status === 200,
    historyAdmin.status
  );
  const unknownTask = await move('11111111-1111-1111-1111-111111111111', 'approve', cookieLead);
  record(
    'a task id that is not one is a 404, not a crash',
    unknownTask.status === 404 && unknownTask.json.code === 'task_not_found',
    { status: unknownTask.status, code: unknownTask.json?.code }
  );

  /* 7. §14 — the audit trail and §6's history answer different questions */
  const audits = await db.query(
    `SELECT action, details FROM audit_logs
     WHERE actor_user_id = ANY($1::uuid[]) AND action LIKE 'task_%'
     ORDER BY created_at`,
    [[lead.id, staff.id, other.id, admin.id]]
  );
  const kinds = new Set(audits.rows.map((row) => row.action));
  record(
    'the privileged moves reach the audit log as well as the task history',
    [
      'task_assigned',
      'task_accepted',
      'task_started',
      'task_submitted',
      'task_returned',
      'task_resubmitted',
      'task_approved',
      'task_reassigned',
      'task_updated',
      'task_withdrawn',
    ].every((action) => kinds.has(action)),
    { kinds: [...kinds].sort() }
  );
  record(
    'every audit entry names the task it is about',
    audits.rows.length > 0 && audits.rows.every((row) => Boolean(row.details?.taskId)),
    { rows: audits.rows.length, missing: audits.rows.filter((r) => !r.details?.taskId).length }
  );

  /* 8. cleanup — and proof it worked */
  await db.query('DELETE FROM tasks WHERE case_id = ANY($1::text[])', [caseIds]);
  const ids = [lead, staff, other, admin].map((u) => u.id);
  await db.query(
    `WITH probe AS (SELECT unnest($1::uuid[]) AS id)
     DELETE FROM audit_logs a
     WHERE EXISTS (SELECT 1 FROM probe p WHERE p.id = a.actor_user_id OR p.id = a.target_user_id)`,
    [ids]
  );
  await db.query('DELETE FROM cases WHERE id = ANY($1::text[])', [caseIds]);
  await db.query('DELETE FROM users WHERE id = ANY($1)', [ids]);

  const leftovers = await db.query(
    `SELECT
       (SELECT count(*)::int FROM users WHERE email LIKE 'task-%@example.invalid') AS users,
       (SELECT count(*)::int FROM cases WHERE id = ANY($1::text[])) AS cases,
       (SELECT count(*)::int FROM tasks WHERE case_id = ANY($1::text[])) AS tasks,
       (SELECT count(*)::int FROM task_events WHERE task_id = ANY($2::uuid[])) AS events,
       (SELECT count(*)::int FROM audit_logs WHERE actor_user_id = ANY($3::uuid[])) AS audit`,
    [caseIds, taskIds, ids]
  );
  const left = leftovers.rows[0];
  record(
    'the suite leaves the register, the tasks, the history and the log exactly as it found them',
    left.users === 0 &&
      left.cases === 0 &&
      left.tasks === 0 &&
      left.events === 0 &&
      left.audit === 0,
    left
  );

  const failed = results.filter((r) => !r.ok);
  console.log(
    JSON.stringify(
      {
        suite: 'assignment and approval workflow',
        passed: results.length - failed.length,
        failed: failed.length,
        total: results.length,
        casesRemoved: caseIds.length,
        tasksRemoved: taskIds.length,
        leftovers: left,
        failures: failed.map((f) => ({ name: f.name, detail: f.detail })),
      },
      null,
      2
    )
  );
  process.exit(failed.length ? 1 : 0);
})().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
