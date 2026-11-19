import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fixture } from './controlled-fixture.mjs';

const f = await fixture();
await build({
  stdin: {
    contents: `
      export { GET as getAssignments, POST as postAssignments } from './app/api/assignments/route';
      export { workspaceData } from './lib/workspace-data';
      export { backupTables, sealSnapshot, validateSnapshot } from './lib/backup-format';
    `,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  outfile: '.sites-runtime/ux-security-test.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  plugins: [
    {
      name: 'bindings',
      setup(b) {
        b.onResolve({ filter: /^(next\/headers|cloudflare:workers)$/ }, (a) => ({
          path: a.path,
          namespace: 'fixture',
        }));
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, (a) => ({
          contents:
            a.path === 'next/headers'
              ? 'export async function headers(){return globalThis.__headers}'
              : 'export const env=globalThis.__env',
          loader: 'js',
        }));
      },
    },
  ],
});

const mod = await import('../.sites-runtime/ux-security-test.mjs');
let checks = 0;

function asUser(who) {
  globalThis.__headers = new Headers({
    'oai-authenticated-user-id': who,
    'oai-authenticated-user-email': `${who}@example.test`,
  });
}

async function callAssign(who, body, origin = 'https://test.local') {
  asUser(who);
  const headers = { 'Content-Type': 'application/json' };
  if (origin) headers.origin = origin;
  const req = new Request('https://test.local/api/assignments', {
    method: body ? 'POST' : 'GET',
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const res = await (body ? mod.postAssignments(req) : mod.getAssignments(req));
  return { status: res.status, json: await res.json() };
}

try {
  // 1. Create and approve a real task
  const taskId = await f.newTask('SYN-UX-ASSIGN-1');
  const beforeTaskRow = await f.db
    .prepare('SELECT data FROM records WHERE id=?')
    .bind(taskId)
    .first();
  const beforeTask = JSON.parse(beforeTaskRow.data);
  assert.equal(beforeTask.reviewState, 'approved');
  checks++;

  // 2. Security: viewer cannot create/modify assignment (403)
  const viewerDenied = await callAssign('viewer', {
    targetType: 'task',
    targetId: taskId,
    primaryUserId: 'planner',
  });
  assert.equal(viewerDenied.status, 403);
  checks++;

  // 3. Security: missing or forged Origin header rejected (403)
  const noOrigin = await callAssign(
    'planner',
    { targetType: 'task', targetId: taskId, primaryUserId: 'planner' },
    ''
  );
  assert.equal(noOrigin.status, 403);
  const forgedOrigin = await callAssign(
    'planner',
    { targetType: 'task', targetId: taskId, primaryUserId: 'planner' },
    'https://evil.example'
  );
  assert.equal(forgedOrigin.status, 403);
  checks += 2;

  // 4. Integrity: non-existent target task rejected (404)
  const missingTarget = await callAssign('planner', {
    targetType: 'task',
    targetId: 'does-not-exist',
    primaryUserId: 'planner',
  });
  assert.equal(missingTarget.status, 404);
  checks++;

  // 5. Validation: backup === primary or unknown member rejected (400)
  const sameBackup = await callAssign('planner', {
    targetType: 'task',
    targetId: taskId,
    primaryUserId: 'planner',
    backupUserId: 'planner',
  });
  assert.equal(sameBackup.status, 400);
  const unknownMember = await callAssign('planner', {
    targetType: 'task',
    targetId: taskId,
    primaryUserId: 'ghost-user',
  });
  assert.equal(unknownMember.status, 400);
  checks += 2;

  // 6. Successful assignment save persists, creates audit log, and does NOT mutate task reviewState
  const saved = await callAssign('planner', {
    targetType: 'task',
    targetId: taskId,
    primaryUserId: 'planner',
    backupUserId: 'approver',
    shiftLabel: 'المناوبة الصباحية',
    handoverNote: 'تسليم متابعة الفحص الدوري',
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.json.ok, true);
  const etag1 = saved.json.assignment.etag;
  assert.ok(etag1);
  checks += 2;

  const afterTaskRow = await f.db
    .prepare('SELECT data FROM records WHERE id=?')
    .bind(taskId)
    .first();
  assert.equal(afterTaskRow.data, beforeTaskRow.data, 'Assignment must never mutate task approval hash or state');
  checks++;

  const auditRow = await f.db
    .prepare("SELECT action FROM audit WHERE owner=? AND action LIKE '%تعيين مسؤول التخطيط%'")
    .bind(f.scope)
    .first();
  assert.ok(auditRow, 'Audit row must be created atomically');
  checks++;

  // 7. Optimistic concurrency: stale etag fails with 409, fresh etag succeeds
  const stale = await callAssign('planner', {
    targetType: 'task',
    targetId: taskId,
    primaryUserId: 'approver',
    etag: 'stale-etag-123',
  });
  assert.equal(stale.status, 409);
  const updated = await callAssign('planner', {
    targetType: 'task',
    targetId: taskId,
    primaryUserId: 'approver',
    shiftLabel: 'المناوبة المسائية',
    etag: etag1,
  });
  assert.equal(updated.status, 200);
  assert.notEqual(updated.json.assignment.etag, etag1);
  checks += 2;

  // 8. GET /api/assignments and workspaceData include the assignment cleanly
  const fetched = await callAssign('viewer');
  assert.equal(fetched.status, 200);
  assert.equal(fetched.json.assignments.length, 1);
  assert.equal(fetched.json.assignments[0].data.primaryUserId, 'approver');
  const ws = await mod.workspaceData(f.db, f.scope, new URL('https://test.local/api/data?view=workspace'));
  assert.equal(ws.assignments.length, 1);
  assert.equal(ws.assignments[0].data.shiftLabel, 'المناوبة المسائية');
  checks += 4;

  // 9. Backup sealSnapshot & validateSnapshot accept valid planner_assignment and reject tampered target
  const tables = {};
  for (const t of Object.keys(mod.backupTables)) {
    const colScope = mod.backupTables[t].scope;
    const res = await f.db
      .prepare(`SELECT * FROM ${t} WHERE ${colScope} = ?`)
      .bind(f.scope)
      .all();
    tables[t] = res.results;
  }
  const files = (tables.document_versions || []).map((v) => ({
    versionId: v.id,
    sourceKey: v.storage_key,
    digest: v.digest,
    size: v.size,
    backupKey: `backups/${f.scope}/${v.id}`,
  }));
  const sealed = await mod.sealSnapshot(f.scope, tables, new Date().toISOString(), files);
  const validation = await mod.validateSnapshot(sealed, f.scope);
  assert.equal(validation.valid, true);
  checks++;

  // Tamper assignment targetId and re-seal to confirm semantic check rejects invalid reference
  const tamperedTables = structuredClone(tables);
  const assignExt = tamperedTables.extension_items.find((x) => x.kind === 'planner_assignment');
  const parsed = JSON.parse(assignExt.data);
  parsed.targetId = 'missing-task-id';
  assignExt.data = JSON.stringify(parsed);
  const tamperedSnap = await mod.sealSnapshot(f.scope, tamperedTables, new Date().toISOString(), files);
  await assert.rejects(() => mod.validateSnapshot(tamperedSnap, f.scope), /مرجع مفقود/);
  checks++;

  console.log(
    `${checks + f.checks} UX planning security & backup integration checks passed (RBAC 403, CSRF Origin 403, missing target 404, backup validation 400, approval-hash immutability, atomic audit, etag 409, workspaceData integration, and backup seal/tamper checks).`
  );
} finally {
  await f.cleanup();
}
