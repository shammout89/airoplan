export const ASSIGNMENT_KIND = 'planner_assignment';

export interface ActiveMemberRef {
  id: string;
  userId: string;
  email: string;
  role: string;
  state: string;
}

export interface NormalizedAssignment {
  targetType: 'task' | 'package';
  targetId: string;
  primaryUserId: string;
  primaryEmail: string;
  primaryRole: string;
  backupUserId: string | null;
  backupEmail: string | null;
  shiftLabel: string;
  handoverNote: string;
  assignedBy: string;
  assignedAt: string;
}

const CONTROL_CHARS = /[\x00-\x08\x0b\x0c\x0e-\x1f]/;

export function assignmentCode(targetType: string, targetId: string): string {
  return `${targetType}:${targetId}`;
}

export function normalizeAssignment(
  raw: unknown,
  context: {
    members: ActiveMemberRef[];
    actorId: string;
    now?: string;
  }
): NormalizedAssignment {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('بيانات تعيين المسؤول غير صالحة');
  }
  const input = raw as Record<string, unknown>;
  const targetType = input.targetType;
  if (targetType !== 'task' && targetType !== 'package') {
    throw new Error('نوع العنصر للتعيين غير صالح');
  }
  const targetId = typeof input.targetId === 'string' ? input.targetId.trim() : '';
  if (!targetId || targetId.length > 120 || CONTROL_CHARS.test(targetId)) {
    throw new Error('معرّف العنصر غير صالح');
  }

  const activeMembers = (context.members || []).filter(
    (m) => m.state === 'active' && typeof m.userId === 'string' && m.userId.length > 0
  );
  const primaryUserId = typeof input.primaryUserId === 'string' ? input.primaryUserId.trim() : '';
  const primary = activeMembers.find((m) => m.userId === primaryUserId);
  if (!primary) {
    throw new Error('اختر مسؤول تخطيط مفعلًا من أعضاء مساحة العمل');
  }

  const rawBackupId = typeof input.backupUserId === 'string' ? input.backupUserId.trim() : '';
  let backup: ActiveMemberRef | null = null;
  if (rawBackupId) {
    if (rawBackupId === primary.userId) {
      throw new Error('المسؤول البديل يجب أن يختلف عن المسؤول الأساسي');
    }
    backup = activeMembers.find((m) => m.userId === rawBackupId) || null;
    if (!backup) {
      throw new Error('المسؤول البديل غير موجود أو غير مفعل في مساحة العمل');
    }
  }

  const shiftLabel = typeof input.shiftLabel === 'string' ? input.shiftLabel.trim() : '';
  if (shiftLabel.length > 60 || CONTROL_CHARS.test(shiftLabel)) {
    throw new Error('اسم المناوبة غير صالح');
  }

  const handoverNote = typeof input.handoverNote === 'string' ? input.handoverNote.trim() : '';
  if (handoverNote.length > 1000 || CONTROL_CHARS.test(handoverNote)) {
    throw new Error('ملاحظة تسليم العمل يجب ألا تتجاوز 1000 حرف');
  }

  return {
    targetType,
    targetId,
    primaryUserId: primary.userId,
    primaryEmail: primary.email,
    primaryRole: primary.role,
    backupUserId: backup?.userId || null,
    backupEmail: backup?.email || null,
    shiftLabel,
    handoverNote,
    assignedBy: context.actorId,
    assignedAt: context.now || new Date().toISOString(),
  };
}
