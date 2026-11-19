import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { fixture } from './controlled-fixture.mjs';

const f = await fixture();
const { db, bucket, scope, planeId: planeAId, evidence, api, call, row, approve, eq } = f;

await mkdir('.sites-runtime', { recursive: true });
await build({
  stdin: {
    contents: `
      export { GET as dataGet, POST as dataPost } from './app/api/data/route';
      export { GET as planningGet, POST as planningPost } from './app/api/planning/route';
      export { GET as operationsGet, POST as operationsPost } from './app/api/operations/route';
      export { GET as assignmentsGet, POST as assignmentsPost } from './app/api/assignments/route';
      export { GET as variationsGet, POST as variationsPost } from './app/api/schedule-variations/route';
      export { GET as executionGet, POST as executionPost } from './app/api/execution/route';
      export { POST as workflowPost } from './app/api/workflow/route';
      export { POST as controlPost, GET as controlGet } from './app/api/control/route';
      export { POST as programPost } from './app/api/programs/route';
      export { POST as defectsPost, GET as defectsGet } from './app/api/defects/route';
      export { access } from './lib/access';
    `,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  outfile: '.sites-runtime/aircraft-scope-routes.mjs',
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

const routes = await import('../.sites-runtime/aircraft-scope-routes.mjs');

async function invoke(who, fnName, { method = 'GET', query = '', body } = {}, expectedStatus = 200) {
  globalThis.__headers = new Headers({
    'oai-authenticated-user-id': who,
    'oai-authenticated-user-email': `${who}@example.test`,
  });
  const res = await routes[fnName](
    new Request(`https://test.local/api/test${query}`, {
      method,
      headers: { origin: 'https://test.local', 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  );
  const json = await res.json();
  assert.equal(res.status, expectedStatus, `${fnName} (${who}): ${JSON.stringify(json)}`);
  return json;
}

try {
  // 1. Ensure workspace owner exists as a distinct user and add a second aircraft of a different model (B737-800)
  const now = new Date().toISOString();
  await db
    .prepare('INSERT INTO members VALUES(?,?,?,?,?,?,?,?)')
    .bind('owner', scope, 'owner@example.test', 'owner', 'admin', 'active', now, now)
    .run();

  // First aircraft created by fixture has model 'SYN' — add planeB with model 'B737-800'
  await call('admin', 'data', {
    action: 'activateAircraft',
    kind: 'aircraft',
    data: {
      name: 'SYN-B',
      manufacturer: 'Boeing',
      model: 'B737-800',
      msn: '999',
      registrationCountry: 'TEST',
      fleetStatus: 'in_service',
      hours: 2000,
      cycles: 900,
      serviceDate: '2021-01-01',
      serviceHours: 0,
      serviceCycles: 0,
      counterAsOf: '2026-11-01T00:00:00.000Z',
      counterSource: 'SYNTHETIC',
      counterConfirmed: true,
    },
  });
  const planeB = await db
    .prepare("SELECT id FROM records WHERE kind='aircraft' AND json_extract(data,'$.name')='SYN-B'")
    .first();
  const planeBId = planeB.id;

  // Create tasks on planeA and planeB
  const taskAId = await f.newTask('SCOPE-TASK-A');
  await call('admin', 'data', {
    kind: 'task',
    data: {
      name: 'SYN SCOPE-TASK-B',
      aircraftId: planeBId,
      reference: 'SCOPE-TASK-B',
      hours: 2200,
      cycles: '',
      date: '',
      status: 'open',
    },
  });
  const taskBRow = await db
    .prepare("SELECT id FROM records WHERE kind='task' AND json_extract(data,'$.reference')='SCOPE-TASK-B'")
    .first();
  const taskBId = taskBRow.id;
  for (const [who, action] of [
    ['admin', 'submit'],
    ['reviewer', 'review'],
    ['approver', 'approve'],
  ]) {
    await call(who, 'workflow', { action, id: taskBId });
  }

  // Create assignment on planeB task so read-filtering on assignments is verified
  await invoke('admin', 'assignmentsPost', {
    method: 'POST',
    body: {
      targetType: 'task',
      targetId: taskBId,
      primaryUserId: 'planner',
      shiftLabel: 'A',
    },
  });

  // 2. Reject invalid restricted access_grant (empty aircraftIds and aircraftModels, or unknown aircraftId)
  await call(
    'admin',
    'control',
    {
      action: 'save',
      kind: 'access_grant',
      data: {
        userId: 'planner',
        permissions: ['read', 'edit_task', 'edit_planning', 'log_usage', 'submit'],
        aircraftScopeMode: 'restricted',
        aircraftIds: [],
        aircraftModels: [],
        validUntil: '',
        reference: 'SYN EMPTY SCOPE',
        reason: 'MUST FAIL',
        evidenceVersionIds: [evidence],
      },
    },
    400
  );

  await call(
    'admin',
    'control',
    {
      action: 'save',
      kind: 'access_grant',
      data: {
        userId: 'planner',
        permissions: ['read', 'edit_task', 'edit_planning', 'log_usage', 'submit'],
        aircraftScopeMode: 'restricted',
        aircraftIds: ['nonexistent-plane'],
        aircraftModels: [],
        validUntil: '',
        reference: 'SYN BAD PLANE',
        reason: 'MUST FAIL',
        evidenceVersionIds: [evidence],
      },
    },
    400
  );

  // 3. Approve restricted access_grant for 'planner' limited to planeAId only
  const scopedGrant = await call('admin', 'control', {
    action: 'save',
    kind: 'access_grant',
    data: {
      userId: 'planner',
      permissions: ['read', 'edit_task', 'edit_planning', 'log_usage', 'submit', 'manage_technical'],
      aircraftScopeMode: 'restricted',
      aircraftIds: [planeAId],
      aircraftModels: [],
      validUntil: '2027-12-31',
      reference: 'SYN PLANE A ONLY',
      reason: 'PLANNER ASSIGNED TO PLANE A ONLY',
      evidenceVersionIds: [evidence],
    },
  });
  await approve('control', scopedGrant.id, { preparer: 'admin' });

  // 4. Verify workspace & read endpoints hide planeB, taskB, and planeB assignments for planner, while owner sees all
  const plannerWorkspace = await invoke('planner', 'dataGet', { query: '?view=workspace&page=1&status=all' });
  eq(plannerWorkspace.session.aircraftScope, {
    mode: 'restricted',
    aircraftIds: [planeAId],
    models: [],
  });
  const plannerAircraftIds = plannerWorkspace.records.filter((r) => r.kind === 'aircraft').map((r) => r.id);
  const plannerTaskIds = plannerWorkspace.records.filter((r) => r.kind === 'task').map((r) => r.id);
  assert.deepEqual(plannerAircraftIds, [planeAId]);
  assert.deepEqual(plannerTaskIds, [taskAId]);
  assert.equal(plannerWorkspace.assignments.some((a) => a.data.targetId === taskBId), false);

  // Direct record access to planeB or taskB returns 403
  await invoke('planner', 'dataGet', { query: `?view=record&id=${encodeURIComponent(taskBId)}` }, 403);
  await invoke('planner', 'dataGet', { query: `?view=record&id=${encodeURIComponent(planeBId)}` }, 403);

  // Owner still sees both aircraft
  const ownerWorkspace = await invoke('owner', 'dataGet', { query: '?view=workspace&page=1&status=all' });
  assert.equal(ownerWorkspace.records.filter((r) => r.kind === 'aircraft').length, 2);

  // 5. Verify out-of-scope write operations fail with 403 while in-scope succeed
  await invoke(
    'planner',
    'dataPost',
    {
      method: 'POST',
      body: {
        kind: 'task',
        data: {
          name: 'OUT OF SCOPE TASK',
          aircraftId: planeBId,
          reference: 'OOS-TASK',
          hours: 2500,
          cycles: '',
          date: '',
          status: 'open',
        },
      },
    },
    403
  );

  await invoke(
    'planner',
    'workflowPost',
    {
      method: 'POST',
      body: { action: 'submit', id: taskBId },
    },
    403
  );

  await invoke(
    'planner',
    'planningPost',
    {
      method: 'POST',
      body: {
        action: 'save',
        kind: 'profile',
        data: {
          aircraftId: planeBId,
          mode: 'manual',
          hoursPerDay: 2,
          cyclesPerDay: 1,
          windowDays: 30,
          reference: 'OOS-PROF',
        },
      },
    },
    403
  );

  await invoke(
    'planner',
    'assignmentsPost',
    {
      method: 'POST',
      body: {
        targetType: 'task',
        targetId: taskBId,
        primaryUserId: 'planner',
      },
    },
    403
  );

  await invoke(
    'planner',
    'operationsPost',
    {
      method: 'POST',
      body: {
        action: 'flight',
        aircraftId: planeBId,
        data: {
          date: '2026-11-12',
          hours: 3,
          cycles: 1,
          reference: 'OOS-FLT',
          asOf: '2026-11-12T10:00:00.000Z',
        },
      },
    },
    403
  );

  // In-scope task creation and forecast profile succeed for planeAId
  await invoke(
    'planner',
    'dataPost',
    {
      method: 'POST',
      body: {
        kind: 'task',
        data: {
          name: 'IN SCOPE TASK',
          aircraftId: planeAId,
          reference: 'IN-SCOPE-TASK',
          hours: 1300,
          cycles: '',
          date: '',
          status: 'open',
        },
      },
    },
    200
  );

  // 6. Model-based scope matching: update grant to models: ['B737-800'] -> planeB accessible, planeA blocked
  const modelGrant = await call('admin', 'control', {
    action: 'save',
    kind: 'access_grant',
    data: {
      userId: 'planner',
      permissions: ['read', 'edit_task', 'edit_planning'],
      aircraftScopeMode: 'restricted',
      aircraftIds: [],
      aircraftModels: [' b737-800 '],
      validUntil: '2027-12-31',
      reference: 'SYN B737 MODEL ONLY',
      reason: 'MODEL SCOPED TO B737-800',
      evidenceVersionIds: [evidence],
    },
  });
  await approve('control', modelGrant.id, { preparer: 'admin' });
  const afterModelWorkspace = await invoke('planner', 'dataGet', { query: '?view=workspace&page=1&status=all' });
  assert.deepEqual(
    afterModelWorkspace.records.filter((r) => r.kind === 'aircraft').map((r) => r.id),
    [planeBId]
  );
  await invoke('planner', 'dataGet', { query: `?view=record&id=${encodeURIComponent(taskAId)}` }, 403);

  // 7. Expired restricted access_grant retains read-only permissions AND preserves restricted aircraftScope
  const expiredGrant = await call('admin', 'control', {
    action: 'save',
    kind: 'access_grant',
    data: {
      userId: 'planner',
      permissions: ['read', 'edit_task'],
      aircraftScopeMode: 'restricted',
      aircraftIds: [planeAId],
      aircraftModels: [],
      validUntil: '2026-01-01',
      reference: 'SYN EXPIRED RESTRICTED',
      reason: 'EXPIRED STILL SCOPED TO PLANE A',
      evidenceVersionIds: [evidence],
    },
  });
  await approve('control', expiredGrant.id, { preparer: 'admin' });
  const expiredWorkspace = await invoke('planner', 'dataGet', { query: '?view=workspace&page=1&status=all' });
  eq(expiredWorkspace.session.permissions, ['read']);
  eq(expiredWorkspace.session.aircraftScope, {
    mode: 'restricted',
    aircraftIds: [planeAId],
    models: [],
  });
  assert.deepEqual(
    expiredWorkspace.records.filter((r) => r.kind === 'aircraft').map((r) => r.id),
    [planeAId]
  );

  // 8. Authorization optional aircraftIds narrowing
  const scopedAuth = await call('admin', 'control', {
    action: 'save',
    kind: 'authorization',
    data: {
      userId: 'planner',
      organization: 'SYN MRO',
      licenseNumber: 'LIC-01',
      validFrom: '2026-01-01',
      validUntil: '2027-12-31',
      licenseExpires: '2027-12-31',
      trainingExpires: '2027-12-31',
      privileges: ['maintenance'],
      allModels: true,
      models: [],
      aircraftIds: [planeAId],
      status: 'active',
      reference: 'AUTH-PLANE-A',
      evidenceVersionIds: [evidence],
    },
  });
  await approve('control', scopedAuth.id, { preparer: 'admin' });

  const allControls = await db.prepare('SELECT * FROM extension_items').all();
  const cMock = {
    items: (allControls.results || []).map((r) => ({ ...r, data: JSON.parse(r.data) })),
    records: ((await db.prepare('SELECT * FROM records').all()).results || []).map((r) => ({
      ...r,
      data: JSON.parse(r.data),
    })),
  };
  assert.ok(api.authorizationAt(cMock, scopedAuth.id, '2026-11-15', 'SYN', 'maintenance', undefined, planeAId));
  assert.throws(
    () => api.authorizationAt(cMock, scopedAuth.id, '2026-11-15', 'B737-800', 'maintenance', undefined, planeBId),
    /لا يغطي هذه الطائرة/
  );

  // 9. Backup snapshot capture & validation passes with restricted access_grant and aircraft-scoped authorization
  const backup = await api.captureBackup(db, bucket, scope, 'SYNTHETIC AIRCRAFT SCOPE BACKUP');
  eq(backup.manifest.relationshipChecks, 'passed');

  // Corrupting a restricted access_grant in snapshot must fail validateSnapshot
  const loaded = await api.loadBackup(db, bucket, scope, backup.id);
  const badTables = structuredClone(loaded.snapshot.tables);
  const badGrant = badTables.extension_items.find(
    (r) => r.id === scopedGrant.id || (r.kind === 'access_grant' && r.state === 'approved')
  );
  assert.ok(badGrant, 'expected approved/superseded access_grant in backup snapshot');
  const parsed = JSON.parse(badGrant.data);
  parsed.aircraftIds = ['nonexistent-plane-id'];
  badGrant.data = JSON.stringify(parsed);
  const badSealed = await api.sealSnapshot(scope, badTables, loaded.snapshot.createdAt, loaded.snapshot.files);
  await assert.rejects(() => api.validateSnapshot(badSealed), /غير مسجلة|نطاق الصلاحيات|مرجع مفقود/);

  console.log(`${f.checks} aircraft-scope checks passed: restricted grant persistence, read filtering, 403 write enforcement, model matching, expired read-only scope retention, authorization aircraftIds narrowing, and backup snapshot validation.`);
} finally {
  await f.cleanup();
}
