/* Runs the seven RBAC suites against the server that is already listening, and reports one verdict.

   These are not unit tests. Each suite mints a real administrator session, creates throwaway
   accounts under @example.invalid or rbac-probe@, exercises the routes over HTTP, and deletes
   everything it made — including the audit rows that name those accounts and the uploaded bytes that
   sit under uploads/, so the log, the register and the disk stay unambiguous. That is why they need
   the server running and why they are kept out of `npm test`, which is the offline export smoke test.

     node server.js            # in another terminal, on 3000
     npm run test:rbac

   The base URL can be overridden with the RBAC_BASE environment variable. */
const { spawnSync } = require('child_process');
const path = require('path');

const BASE = process.env.RBAC_BASE || 'http://127.0.0.1:3000';
const SUITES = [
  ['accounts and roles', 'rbac-accounts.js'],
  ['permission catalogue and overrides', 'rbac-permissions.js'],
  ['ownership transfer and self-deletion', 'rbac-ownership.js'],
  ['case registry and duplicate detection', 'rbac-cases.js'],
  ['assignment and approval workflow', 'rbac-tasks.js'],
  ['document verification', 'rbac-documents.js'],
  ['case comments and notifications', 'rbac-comments-notifications.js'],
];

/* A child that calls process.exit() while a socket is still open aborts on Windows with a libuv
   assertion, so the verdict is read from the JSON summary each suite prints before it exits and the
   exit code only breaks the tie when no summary arrived. The probe uses core http rather than a
   spawned fetch for the same reason. */
const reachable = () =>
  new Promise((resolve) => {
    const req = require('http')
      .get(`${BASE}/health`, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode >= 200 && res.statusCode < 300));
      })
      .on('error', () => resolve(false));
    req.setTimeout(5000, () => {
      req.destroy();
      resolve(false);
    });
  });

/* Each suite pretty-prints its summary as the last thing it writes, and only the top-level brace of
   a pretty-printed object sits alone at column zero — nested ones are indented. So the summary starts
   at the last such line and runs to the final closing brace, which discards any trailing crash text. */
const readSummary = (text) => {
  const lines = text.split('\n');
  let start = -1;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (/^\{$/.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start === -1) return null;
  const body = lines.slice(start).join('\n');
  const end = body.lastIndexOf('}');
  if (end === -1) return null;
  try {
    return JSON.parse(body.slice(0, end + 1));
  } catch {
    return null;
  }
};

(async () => {
  if (!(await reachable())) {
    console.error(
      `No server answering on ${BASE}. Start it with "node server.js" and run this again.`
    );
    console.error('The suites call the live API, so there is nothing to check without it.');
    process.exitCode = 1;
    return;
  }

  const rows = [];
  for (const [label, file] of SUITES) {
    const started = Date.now();
    const run = spawnSync(process.execPath, [path.join(__dirname, file)], {
      encoding: 'utf8',
      cwd: path.join(__dirname, '..'),
      timeout: 300000,
    });
    const out = `${run.stdout || ''}${run.stderr || ''}`.trim();
    const summary = readSummary(out);
    const failures = summary
      ? (summary.failures || []).concat((summary.results || []).filter((r) => !r.ok))
      : [];

    rows.push({
      label,
      ok: summary ? !summary.fatal && failures.length === 0 : run.status === 0,
      passed: summary ? summary.passed : null,
      total: summary
        ? summary.total != null
          ? summary.total
          : (summary.passed || 0) + (summary.failed || 0)
        : null,
      fatal: summary && summary.fatal ? summary.fatal : null,
      ms: Date.now() - started,
    });

    if (!summary) console.error(`\n${file} printed no summary:\n${out || '(nothing)'}`);
    failures.slice(0, 12).forEach((f) => {
      console.error(
        `  FAIL  ${f.name || '?'}  ${JSON.stringify(f.detail !== undefined ? f.detail : f)}`
      );
    });
  }

  const width = rows.reduce((n, r) => Math.max(n, r.label.length), 0);
  console.log('');
  rows.forEach((r) => {
    const counts = r.passed != null && r.total != null ? `${r.passed}/${r.total}` : 'no summary';
    console.log(
      `${r.ok ? 'PASS' : 'FAIL'}  ${r.label.padEnd(width)}  ${counts.padStart(9)}  ${(r.ms / 1000).toFixed(1)}s${
        r.fatal ? `  fatal: ${r.fatal}` : ''
      }`
    );
  });

  const failedSuites = rows.filter((r) => !r.ok);
  const checks = rows.reduce((n, r) => n + (r.total || 0), 0);
  console.log(
    failedSuites.length
      ? `\n${failedSuites.length} of ${rows.length} suites failed (${checks} checks run).`
      : `\nAll ${rows.length} suites passed, ${checks} checks.`
  );
  process.exitCode = failedSuites.length ? 1 : 0;
})();
