import test from 'node:test';
import assert from 'node:assert/strict';
import { computeTaskWorkflowGuide } from './task-workflow-guide';

test('computeTaskWorkflowGuide handles uninitialized program task cleanly', () => {
  const guide = computeTaskWorkflowGuide({
    taskData: { name: 'فحص رئيسي', programRevisionId: 'prog-1', status: 'open', reviewState: 'draft' },
    program: { id: 'prog-1', state: 'approved' },
    session: { userId: 'u-reviewer', role: 'reviewer', permissions: ['read', 'review'] },
  });
  assert.equal(guide.stages[0]?.status, 'active');
  assert.equal(guide.waitingOn, 'المخطط أو مدير النظام');
  assert.equal(guide.canCurrentUserActInExecution, false);
  assert.ok(guide.executionGuidance?.includes('تهيئة الاستحقاق'));
});

test('computeTaskWorkflowGuide guides reviewer clearly when planning is approved but execution is not recorded', () => {
  const guide = computeTaskWorkflowGuide({
    taskData: {
      name: 'فحص عجلات',
      programRevisionId: 'prog-1',
      schedule: { mode: 'automatic', sequence: 1 },
      status: 'open',
      reviewState: 'approved',
    },
    accomplishment: null,
    session: { userId: 'u-reviewer', role: 'reviewer', permissions: ['read', 'review'] },
  });
  assert.equal(guide.stages[0]?.status, 'done');
  assert.equal(guide.stages[1]?.status, 'done');
  assert.equal(guide.stages[2]?.status, 'active');
  assert.equal(guide.executionBadgeLabel, 'التنفيذ: لم يُسجل بعد');
  assert.equal(guide.canCurrentUserActInExecution, false);
  assert.ok(guide.executionGuidance?.includes('سجل التنفيذ لم يُنشأ بعد'));
});

test('computeTaskWorkflowGuide guides approver while execution is waiting on reviewer and vice versa', () => {
  const submittedAccomplishment = {
    id: 'acc-1',
    task_id: 't-1',
    state: 'submitted',
    modified_by: 'u-admin',
    submitted_by: 'u-admin',
  };
  const taskData = {
    name: 'فحص عجلات',
    schedule: { mode: 'automatic', sequence: 1 },
    status: 'open',
    reviewState: 'approved',
  };

  const approverWhileSubmitted = computeTaskWorkflowGuide({
    taskData,
    accomplishment: submittedAccomplishment,
    session: { userId: 'u-approver', role: 'approver', permissions: ['read', 'approve'] },
  });
  assert.equal(approverWhileSubmitted.stages[3]?.status, 'active');
  assert.equal(approverWhileSubmitted.waitingOn, 'المراجع');
  assert.equal(approverWhileSubmitted.canCurrentUserActInExecution, false);
  assert.ok(approverWhileSubmitted.executionGuidance?.includes('بانتظار المراجع'));

  const reviewerWhileReviewed = computeTaskWorkflowGuide({
    taskData,
    accomplishment: { ...submittedAccomplishment, state: 'reviewed', reviewed_by: 'u-reviewer' },
    session: { userId: 'u-reviewer', role: 'reviewer', permissions: ['read', 'review'] },
  });
  assert.equal(reviewerWhileReviewed.waitingOn, 'المعتمد');
  assert.ok(reviewerWhileReviewed.executionGuidance?.includes('تمت مراجعتك بنجاح'));

  const approverWhileReviewed = computeTaskWorkflowGuide({
    taskData,
    accomplishment: { ...submittedAccomplishment, state: 'reviewed', reviewed_by: 'u-reviewer' },
    session: { userId: 'u-approver', role: 'approver', permissions: ['read', 'approve'] },
  });
  assert.equal(approverWhileReviewed.canCurrentUserActInExecution, true);
  assert.equal(approverWhileReviewed.executionGuidance, null);
});

test('computeTaskWorkflowGuide flags separation of duties when same actor tries to review or approve', () => {
  const guide = computeTaskWorkflowGuide({
    taskData: {
      name: 'فحص عجلات',
      schedule: { mode: 'automatic', sequence: 1 },
      status: 'open',
      reviewState: 'approved',
    },
    accomplishment: {
      id: 'acc-1',
      task_id: 't-1',
      state: 'reviewed',
      modified_by: 'u-admin',
      submitted_by: 'u-admin',
      reviewed_by: 'u-reviewer',
    },
    session: { userId: 'u-admin', role: 'admin', permissions: ['read', 'record_execution', 'submit', 'review', 'approve'] },
  });
  assert.ok(guide.executionGuidance?.includes('التزامًا بفصل الصلاحيات'));
});

test('computeTaskWorkflowGuide marks all 4 stages done when closed with nextTaskId', () => {
  const guide = computeTaskWorkflowGuide({
    taskData: {
      name: 'فحص عجلات',
      schedule: { mode: 'automatic', sequence: 1 },
      status: 'closed',
      nextTaskId: 't-2',
      reviewState: 'approved',
    },
    accomplishment: { id: 'acc-1', task_id: 't-1', state: 'approved' },
    session: { userId: 'u-reviewer', role: 'reviewer', permissions: ['read', 'review'] },
  });
  assert.equal(guide.stages.every((s) => s.status === 'done'), true);
  assert.equal(guide.waitingOn, 'مكتمل');
});
