import { due } from './due';
import { taskMode } from './task-approval';
import { programToday } from './program';

export type InboxActionKind =
  | 'submit'
  | 'review'
  | 'approve'
  | 'execute_overdue'
  | 'execute_submit'
  | 'execute_review'
  | 'execute_approve';

export interface InboxAccomplishmentRecord {
  id: string;
  task_id: string;
  state: string;
  modified_by?: string | null;
  submitted_by?: string | null;
  reviewed_by?: string | null;
  approved_by?: string | null;
}

export interface ActionInboxItem {
  id: string;
  entityType: 'task' | 'package' | 'component' | 'movement';
  entityId: string;
  title: string;
  subtitle: string;
  actionKind: InboxActionKind;
  actionLabel: string;
  tab: string;
  assignedToMe: boolean;
  priority: number;
}

export interface InboxPlaneRecord {
  id: string;
  data?: Record<string, unknown>;
}

export interface InboxTaskRecord {
  id: string;
  data?: {
    name?: string;
    reference?: string;
    aircraftId?: string;
    status?: string;
    reviewState?: string;
    modifiedBy?: string;
    submittedBy?: string;
    reviewedBy?: string;
    taskApproval?: {
      contributors?: unknown;
      policy?: {
        reviewerRoles?: string[];
        approverRoles?: string[];
      };
    };
    [key: string]: unknown;
  };
}

export interface InboxPlanningItem {
  id: string;
  kind: string;
  code?: string;
  state?: string;
  modified_by?: string;
  submitted_by?: string;
  reviewed_by?: string;
  data?: {
    name?: string;
    [key: string]: unknown;
  };
}

export interface InboxAssignmentRecord {
  id?: string;
  etag?: string;
  data?: {
    targetType?: string;
    targetId?: string;
    primaryUserId?: string;
    backupUserId?: string | null;
    primaryEmail?: string;
    shiftLabel?: string;
    handoverNote?: string;
  };
}

export interface ActionInboxInput {
  session: { userId?: string; role?: string; permissions?: string[] } | null;
  aircraft?: InboxPlaneRecord[];
  tasks?: InboxTaskRecord[];
  accomplishments?: InboxAccomplishmentRecord[];
  planningItems?: InboxPlanningItem[];
  assignments?: InboxAssignmentRecord[];
  today?: string;
}

function can(permissions: string[], p: string): boolean {
  return permissions.includes(p);
}

function isContributor(contributors: unknown, userId: string): boolean {
  return Array.isArray(contributors) && contributors.includes(userId);
}

export function buildActionInbox(input: ActionInboxInput): ActionInboxItem[] {
  const session = input.session;
  if (!session?.userId) return [];
  const userId = session.userId;
  const permissions = Array.isArray(session.permissions) ? session.permissions : [];
  const aircraftMap = new Map<string, Record<string, unknown> | undefined>(
    (input.aircraft || []).map((a) => [a.id, a.data])
  );
  const assignmentMap = new Map<string, InboxAssignmentRecord['data']>(
    (input.assignments || []).map((a) => [`${a.data?.targetType}:${a.data?.targetId}`, a.data])
  );
  const accomplishmentMap = new Map<string, InboxAccomplishmentRecord>(
    (input.accomplishments || []).map((e) => [e.task_id, e])
  );
  const today = input.today || programToday();
  const items: ActionInboxItem[] = [];

  for (const t of input.tasks || []) {
    const d = t.data || {};
    if (d.status === 'closed' || d.status === 'withdrawn') continue;
    const state = d.reviewState || 'draft';
    const mode = taskMode(d);
    const plane = d.aircraftId ? aircraftMap.get(d.aircraftId) : undefined;
    const planeName = typeof plane?.name === 'string' && plane.name ? plane.name : '—';
    const assignment = assignmentMap.get(`task:${t.id}`);
    const assignedToMe = Boolean(
      assignment && (assignment.primaryUserId === userId || assignment.backupUserId === userId)
    );
    const contributors = d.taskApproval?.contributors;
    const sameAuthor =
      d.modifiedBy === userId ||
      d.submittedBy === userId ||
      isContributor(contributors, userId);

    if (state === 'draft' && can(permissions, 'submit')) {
      items.push({
        id: `task-submit:${t.id}`,
        entityType: 'task',
        entityId: t.id,
        title: d.name || 'مهمة مسودة',
        subtitle: `${planeName}${d.reference ? ` · ${d.reference}` : ''}`,
        actionKind: 'submit',
        actionLabel: 'إرسال للمراجعة',
        tab: 'task',
        assignedToMe,
        priority: assignedToMe ? 10 : 40,
      });
      continue;
    }

    if (state === 'submitted' && mode === 'three_person' && can(permissions, 'review') && !sameAuthor) {
      const allowedRoles = d.taskApproval?.policy?.reviewerRoles;
      if (!Array.isArray(allowedRoles) || !session.role || allowedRoles.includes(session.role)) {
        items.push({
          id: `task-review:${t.id}`,
          entityType: 'task',
          entityId: t.id,
          title: d.name || 'مهمة للمراجعة',
          subtitle: `${planeName}${d.reference ? ` · ${d.reference}` : ''}`,
          actionKind: 'review',
          actionLabel: 'مراجعة فنية',
          tab: 'task',
          assignedToMe,
          priority: assignedToMe ? 5 : 20,
        });
      }
      continue;
    }

    if (
      ((state === 'submitted' && mode === 'two_person') ||
        (state === 'reviewed' && mode === 'three_person')) &&
      can(permissions, 'approve') &&
      !sameAuthor &&
      (mode !== 'three_person' || d.reviewedBy !== userId)
    ) {
      const allowedRoles = d.taskApproval?.policy?.approverRoles;
      if (!Array.isArray(allowedRoles) || !session.role || allowedRoles.includes(session.role)) {
        items.push({
          id: `task-approve:${t.id}`,
          entityType: 'task',
          entityId: t.id,
          title: d.name || 'مهمة للاعتماد',
          subtitle: `${planeName}${d.reference ? ` · ${d.reference}` : ''}`,
          actionKind: 'approve',
          actionLabel: mode === 'two_person' ? 'مراجعة واعتماد' : 'اعتماد مستقل',
          tab: 'task',
          assignedToMe,
          priority: assignedToMe ? 4 : 15,
        });
      }
      continue;
    }

    if (state === 'approved') {
      const entry = accomplishmentMap.get(t.id);
      if (entry) {
        const execSameAuthor =
          entry.modified_by === userId || entry.submitted_by === userId;

        if (entry.state === 'draft' && can(permissions, 'submit')) {
          items.push({
            id: `exec-submit:${t.id}`,
            entityType: 'task',
            entityId: t.id,
            title: d.name || 'تنفيذ بانتظار الإرسال',
            subtitle: `${planeName}${d.reference ? ` · ${d.reference}` : ''} · مسودة تنفيذ`,
            actionKind: 'execute_submit',
            actionLabel: 'إرسال التنفيذ للمراجعة',
            tab: 'task',
            assignedToMe,
            priority: assignedToMe ? 2 : 12,
          });
          continue;
        }

        if (entry.state === 'submitted' && can(permissions, 'review') && !execSameAuthor) {
          items.push({
            id: `exec-review:${t.id}`,
            entityType: 'task',
            entityId: t.id,
            title: d.name || 'تنفيذ بانتظار المراجعة',
            subtitle: `${planeName}${d.reference ? ` · ${d.reference}` : ''} · سجل تنفيذ مرسل`,
            actionKind: 'execute_review',
            actionLabel: 'تأكيد مراجعة التنفيذ',
            tab: 'task',
            assignedToMe,
            priority: assignedToMe ? 2 : 11,
          });
          continue;
        }

        if (
          entry.state === 'reviewed' &&
          can(permissions, 'approve') &&
          !execSameAuthor &&
          entry.reviewed_by !== userId
        ) {
          items.push({
            id: `exec-approve:${t.id}`,
            entityType: 'task',
            entityId: t.id,
            title: d.name || 'تنفيذ بانتظار الاعتماد',
            subtitle: `${planeName}${d.reference ? ` · ${d.reference}` : ''} · مراجعة التنفيذ مكتملة`,
            actionKind: 'execute_approve',
            actionLabel: 'اعتماد التنفيذ وحساب التالي',
            tab: 'task',
            assignedToMe,
            priority: assignedToMe ? 1 : 9,
          });
          continue;
        }
      }

      if (!entry || entry.state === 'draft') {
        const dueState = due(d, plane, today);
        if (dueState.status === 'overdue') {
          items.push({
            id: `task-overdue:${t.id}`,
            entityType: 'task',
            entityId: t.id,
            title: d.name || 'مهمة مستحقة',
            subtitle: `${planeName} · مستحقة / متجاوزة`,
            actionKind: 'execute_overdue',
            actionLabel: 'الاستحقاق والتنفيذ',
            tab: 'task',
            assignedToMe,
            priority: assignedToMe ? 1 : 10,
          });
        }
      }
    }
  }

  for (const item of input.planningItems || []) {
    if (item.kind !== 'package' && item.kind !== 'component' && item.kind !== 'movement') continue;
    const state = item.state || 'draft';
    const tab = item.kind === 'package' ? 'packages' : 'components';
    const assignment = item.kind === 'package' ? assignmentMap.get(`package:${item.id}`) : null;
    const assignedToMe = Boolean(
      assignment && (assignment.primaryUserId === userId || assignment.backupUserId === userId)
    );
    const title =
      item.kind === 'package'
        ? `${item.code || ''} — ${item.data?.name || 'حزمة عمل'}`.trim()
        : item.data?.name || item.code || 'سجل تخطيط';
    const sameAuthor = item.modified_by === userId || item.submitted_by === userId;

    if (state === 'draft' && can(permissions, 'edit_planning') && can(permissions, 'submit')) {
      items.push({
        id: `plan-submit:${item.id}`,
        entityType: item.kind,
        entityId: item.id,
        title,
        subtitle: item.kind === 'package' ? 'حزمة عمل مسودة' : 'سجل تخطيط مسودة',
        actionKind: 'submit',
        actionLabel: 'إرسال للمراجعة',
        tab,
        assignedToMe,
        priority: assignedToMe ? 12 : 45,
      });
    } else if (state === 'submitted' && can(permissions, 'review') && !sameAuthor) {
      items.push({
        id: `plan-review:${item.id}`,
        entityType: item.kind,
        entityId: item.id,
        title,
        subtitle: item.kind === 'package' ? 'حزمة بانتظار المراجعة' : 'حركة/مكون بانتظار المراجعة',
        actionKind: 'review',
        actionLabel: 'تأكيد المراجعة',
        tab,
        assignedToMe,
        priority: assignedToMe ? 6 : 25,
      });
    } else if (
      state === 'reviewed' &&
      can(permissions, 'approve') &&
      !sameAuthor &&
      item.reviewed_by !== userId
    ) {
      items.push({
        id: `plan-approve:${item.id}`,
        entityType: item.kind,
        entityId: item.id,
        title,
        subtitle: item.kind === 'package' ? 'حزمة بانتظار الاعتماد' : 'حركة/مكون بانتظار الاعتماد',
        actionKind: 'approve',
        actionLabel: 'اعتماد داخلي',
        tab,
        assignedToMe,
        priority: assignedToMe ? 5 : 18,
      });
    }
  }

  return items.sort(
    (a, b) =>
      Number(b.assignedToMe) - Number(a.assignedToMe) ||
      a.priority - b.priority ||
      a.title.localeCompare(b.title, 'ar')
  );
}
