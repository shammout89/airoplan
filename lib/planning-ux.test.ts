import test from 'node:test';
import assert from 'node:assert/strict';
import { groupNavigation, groupForTab } from './navigation-groups';
import { searchWorkspace } from './global-search';
import { buildActionInbox } from './action-inbox';
import { normalizeAssignment } from './assignment';
import { buildPackageTimeline, formatTimeInZone } from './package-timeline';
import { dailyNavigation, mainNavigation } from './settings-navigation';

test('groupNavigation preserves all permitted keys without duplication', () => {
  const adminKeys = mainNavigation({
    isOwner: true,
    authProvider: 'local',
    permissions: [
      'read',
      'manage_members',
      'configure',
      'audit',
      'import_data',
    ],
  });
  const groups = groupNavigation(adminKeys);
  const flattened = groups.flatMap((g) => g.keys);
  assert.equal(flattened.length, adminKeys.length);
  assert.deepEqual(new Set(flattened), new Set(adminKeys));
  assert.equal(groupForTab('packages'), 'planning');
  assert.equal(groupForTab('settings'), 'governance');
  assert.equal(groupForTab('unknown-tab'), 'daily');

  const viewerGroups = groupNavigation(dailyNavigation);
  assert.equal(viewerGroups.some((g) => g.keys.includes('settings')), false);
});

test('searchWorkspace ranks exact matches and finds aircraft, tasks, packages, and settings', () => {
  const results = searchWorkspace({
    query: 'HZ-AK1',
    aircraft: [
      { id: 'a1', data: { name: 'HZ-AK1', manufacturer: 'Airbus', model: 'A320neo', msn: '9001' } },
      { id: 'a2', data: { name: 'HZ-AK2', manufacturer: 'Boeing', model: '787-9', msn: '9002' } },
    ],
    tasks: [
      { id: 't1', data: { name: 'فحص A-Check', aircraftId: 'a1', reference: 'MPD-05-01' } },
      { id: 't2', data: { name: 'فحص B-Check', aircraftId: 'a2', reference: 'MPD-05-02' } },
    ],
    planningItems: [
      { id: 'p1', kind: 'package', code: 'PKG-101', data: { name: 'توقف ليلي', aircraftId: 'a1', station: 'AMM' } },
    ],
    navigationItems: [
      { key: 'dashboard', label: 'نظرة عامة' },
      { key: 'packages', label: 'حزم العمل' },
    ],
    settingsItems: [{ id: 'team', title: 'المستخدمون والصلاحيات', description: 'الأدوار' }],
  });

  assert.equal(results[0]?.kind, 'aircraft');
  assert.equal(results[0]?.recordId, 'a1');
  assert.ok(results.some((r) => r.kind === 'task' && r.recordId === 't1'));
  assert.ok(results.some((r) => r.kind === 'package' && r.recordId === 'p1'));
});

test('buildActionInbox enforces separation of duties and prioritizes assigned items', () => {
  const verifiedPlaneData = {
    profileVersion: 'aircraft-card-v1',
    profileStatus: 'verified',
    profileVerifiedBy: 'u-admin',
    profileVerifiedEmail: 'admin@example.test',
    profileVerifiedAt: '2026-04-01T00:00:00.000Z',
    fleetStatus: 'in_service',
    name: 'JY-ABC',
    manufacturer: 'Airbus',
    model: 'A320',
    msn: '4501',
    registrationCountry: 'Jordan',
    hours: 5000,
    cycles: 2000,
    counterConfirmed: true,
    counterAsOf: '2026-04-01T00:00:00.000Z',
    counterSource: 'Tech Log',
    counterSnapshot: {
      hours: 5000,
      cycles: 2000,
      asOf: '2026-04-01T00:00:00.000Z',
      reference: 'Tech Log',
    },
  };
  const aircraft = [{ id: 'a1', data: verifiedPlaneData }];
  const tasks = [
    {
      id: 't-draft',
      data: { name: 'مسودة قابلة للإرسال', aircraftId: 'a1', reviewState: 'draft', status: 'open', modifiedBy: 'u-planner' },
    },
    {
      id: 't-own-sub',
      data: {
        name: 'مهمتي المرسلة',
        aircraftId: 'a1',
        reviewState: 'submitted',
        status: 'open',
        modifiedBy: 'u-approver',
        submittedBy: 'u-approver',
        taskApproval: { mode: 'two_person', contributors: ['u-approver'] },
      },
    },
    {
      id: 't-other-sub',
      data: {
        name: 'مهمة من مخطط آخر',
        aircraftId: 'a1',
        reviewState: 'submitted',
        status: 'open',
        modifiedBy: 'u-planner',
        submittedBy: 'u-planner',
        taskApproval: { mode: 'two_person', contributors: ['u-planner'] },
      },
    },
    {
      id: 't-overdue',
      data: {
        name: 'مهمة متجاوزة',
        aircraftId: 'a1',
        reviewState: 'approved',
        status: 'open',
        hours: 4900,
      },
    },
  ];
  const assignments = [
    {
      data: { targetType: 'task', targetId: 't-other-sub', primaryUserId: 'u-approver', backupUserId: null },
    },
  ];

  const approverInbox = buildActionInbox({
    session: { userId: 'u-approver', role: 'approver', permissions: ['read', 'approve'] },
    aircraft,
    tasks,
    assignments,
    today: '2026-05-01',
  });

  // Approver cannot approve their own submitted task (t-own-sub) and cannot submit draft (no submit perm)
  assert.equal(approverInbox.some((i) => i.entityId === 't-own-sub'), false);
  assert.equal(approverInbox.some((i) => i.entityId === 't-draft'), false);

  // Assigned task comes first even above overdue unassigned task
  assert.equal(approverInbox[0]?.entityId, 't-other-sub');
  assert.equal(approverInbox[0]?.assignedToMe, true);
  assert.equal(approverInbox[0]?.actionKind, 'approve');

  // Overdue approved task appears
  assert.ok(approverInbox.some((i) => i.entityId === 't-overdue' && i.actionKind === 'execute_overdue'));
});

test('buildActionInbox surfaces execution accomplishments per role while preserving separation of duties', () => {
  const aircraft = [{ id: 'a1', data: { name: 'JY-AZ1', hours: 5000, cycles: 2000 } }];
  const tasks = [
    { id: 't-exec-draft', data: { name: 'فحص مسودة تنفيذ', aircraftId: 'a1', reviewState: 'approved', status: 'open', hours: 4800 } },
    { id: 't-exec-sub', data: { name: 'فحص مرسل للمراجعة', aircraftId: 'a1', reviewState: 'approved', status: 'open', hours: 4800 } },
    { id: 't-exec-rev', data: { name: 'فحص جاهز للاعتماد', aircraftId: 'a1', reviewState: 'approved', status: 'open', hours: 4800 } },
  ];
  const accomplishments = [
    { id: 'e1', task_id: 't-exec-draft', state: 'draft', modified_by: 'u-planner' },
    { id: 'e2', task_id: 't-exec-sub', state: 'submitted', modified_by: 'u-planner', submitted_by: 'u-planner' },
    { id: 'e3', task_id: 't-exec-rev', state: 'reviewed', modified_by: 'u-planner', submitted_by: 'u-planner', reviewed_by: 'u-reviewer' },
  ];

  const plannerInbox = buildActionInbox({
    session: { userId: 'u-planner', role: 'planner', permissions: ['read', 'submit', 'record_execution'] },
    aircraft,
    tasks,
    accomplishments,
    today: '2026-05-01',
  });
  assert.ok(plannerInbox.some((i) => i.entityId === 't-exec-draft' && i.actionKind === 'execute_submit'));
  // Once submitted or reviewed, do not clutter inbox with execute_overdue
  assert.equal(plannerInbox.some((i) => i.entityId === 't-exec-sub' && i.actionKind === 'execute_overdue'), false);
  assert.equal(plannerInbox.some((i) => i.entityId === 't-exec-rev' && i.actionKind === 'execute_overdue'), false);

  const reviewerInbox = buildActionInbox({
    session: { userId: 'u-reviewer', role: 'reviewer', permissions: ['read', 'review'] },
    aircraft,
    tasks,
    accomplishments,
    today: '2026-05-01',
  });
  assert.equal(reviewerInbox.some((i) => i.entityId === 't-exec-sub' && i.actionKind === 'execute_review'), true);
  assert.equal(reviewerInbox.some((i) => i.entityId === 't-exec-rev'), false);

  const approverInbox = buildActionInbox({
    session: { userId: 'u-approver', role: 'approver', permissions: ['read', 'approve'] },
    aircraft,
    tasks,
    accomplishments,
    today: '2026-05-01',
  });
  assert.equal(approverInbox.some((i) => i.entityId === 't-exec-rev' && i.actionKind === 'execute_approve'), true);
  assert.equal(approverInbox.some((i) => i.entityId === 't-exec-sub'), false);

  // Reviewer who reviewed t-exec-rev cannot also approve it even if granted approve permission
  const dualReviewerApproverInbox = buildActionInbox({
    session: { userId: 'u-reviewer', role: 'admin', permissions: ['read', 'review', 'approve'] },
    aircraft,
    tasks,
    accomplishments,
    today: '2026-05-01',
  });
  assert.equal(dualReviewerApproverInbox.some((i) => i.entityId === 't-exec-rev' && i.actionKind === 'execute_approve'), false);
});

test('normalizeAssignment validates members, prevents duplicate backup, and strips/rejects control chars', () => {
  const members = [
    { id: 'm1', userId: 'u1', email: 'planner@example.test', role: 'planner', state: 'active' },
    { id: 'm2', userId: 'u2', email: 'backup@example.test', role: 'planner', state: 'active' },
    { id: 'm3', userId: 'u3', email: 'disabled@example.test', role: 'planner', state: 'disabled' },
  ];

  const ok = normalizeAssignment(
    {
      targetType: 'task',
      targetId: 't-123',
      primaryUserId: 'u1',
      backupUserId: 'u2',
      shiftLabel: 'المناوبة الصباحية',
      handoverNote: 'بانتظار توفر فني B1',
    },
    { members, actorId: 'u1', now: '2026-05-01T10:00:00.000Z' }
  );
  assert.equal(ok.primaryEmail, 'planner@example.test');
  assert.equal(ok.backupEmail, 'backup@example.test');
  assert.equal(ok.shiftLabel, 'المناوبة الصباحية');

  assert.throws(() =>
    normalizeAssignment({ targetType: 'task', targetId: 't-123', primaryUserId: 'u3' }, { members, actorId: 'u1' })
  );
  assert.throws(() =>
    normalizeAssignment(
      { targetType: 'task', targetId: 't-123', primaryUserId: 'u1', backupUserId: 'u1' },
      { members, actorId: 'u1' }
    )
  );
  assert.throws(() =>
    normalizeAssignment(
      { targetType: 'task', targetId: 't-123', primaryUserId: 'u1', handoverNote: 'bad\x00note' },
      { members, actorId: 'u1' }
    )
  );
});

test('buildPackageTimeline computes bars, local Asia/Amman time, and aircraft/station overlaps', () => {
  const aircraft = [
    { id: 'a1', data: { name: 'JY-A01' } },
    { id: 'a2', data: { name: 'JY-A02' } },
  ];
  const packages = [
    {
      id: 'p1',
      code: 'PKG-1',
      state: 'approved',
      data: {
        name: 'فحص ليلي 1',
        aircraftId: 'a1',
        station: 'AMM',
        start: '2026-05-10T00:00:00.000Z',
        end: '2026-05-10T06:00:00.000Z',
        plannedManHours: 12,
        taskIds: ['t1', 't2'],
      },
    },
    {
      id: 'p2',
      code: 'PKG-2',
      state: 'draft',
      data: {
        name: 'فحص متداخل طائرة',
        aircraftId: 'a1',
        station: 'DXB',
        start: '2026-05-10T04:00:00.000Z',
        end: '2026-05-10T10:00:00.000Z',
        plannedManHours: 8,
        taskIds: ['t3'],
      },
    },
    {
      id: 'p3',
      code: 'PKG-3',
      state: 'draft',
      data: {
        name: 'فحص متداخل محطة',
        aircraftId: 'a2',
        station: 'AMM',
        start: '2026-05-10T03:00:00.000Z',
        end: '2026-05-10T12:00:00.000Z',
        plannedManHours: 10,
        taskIds: ['t4'],
      },
    },
  ];

  const timeline = buildPackageTimeline(packages, aircraft, 'Asia/Amman');
  assert.ok(timeline);
  assert.equal(timeline.totalManHours, 30);
  assert.equal(timeline.overlapCount, 2);
  assert.equal(timeline.tracks.length, 2);

  const bar1 = timeline.tracks[0].bars[0];
  assert.equal(bar1.leftPct, 0);
  assert.equal(bar1.widthPct, 50);
  assert.equal(bar1.hasAircraftOverlap, true);
  assert.equal(bar1.hasStationOverlap, true);
  // Asia/Amman is UTC+3
  assert.ok(formatTimeInZone('2026-05-10T00:00:00.000Z', 'Asia/Amman').includes('03:00'));
});
