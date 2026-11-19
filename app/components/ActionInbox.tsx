'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowUpLeft, CheckCircle2, ClipboardCheck, Inbox, Send } from 'lucide-react';
import {
  ActionInboxItem,
  InboxAssignmentRecord,
  InboxPlaneRecord,
  InboxPlanningItem,
  InboxTaskRecord,
  buildActionInbox,
} from '../../lib/action-inbox';

interface ActionInboxProps {
  session: { userId?: string; role?: string; permissions?: string[] } | null;
  aircraft: InboxPlaneRecord[];
  tasks: InboxTaskRecord[];
  planningItems: InboxPlanningItem[];
  assignments: InboxAssignmentRecord[];
  onAction: (item: ActionInboxItem) => void;
}

function ActionBadge({ kind }: { kind: ActionInboxItem['actionKind'] }) {
  if (kind === 'execute_overdue') {
    return (
      <span className="badge overdue">
        <AlertTriangle size={12} /> مستحق / متجاوز
      </span>
    );
  }
  if (kind === 'approve') {
    return (
      <span className="badge soon">
        <CheckCircle2 size={12} /> بانتظار الاعتماد
      </span>
    );
  }
  if (kind === 'review') {
    return (
      <span className="badge soon">
        <ClipboardCheck size={12} /> بانتظار المراجعة
      </span>
    );
  }
  return (
    <span className="badge">
      <Send size={12} /> مسودة
    </span>
  );
}

export default function ActionInbox({
  session,
  aircraft,
  tasks,
  planningItems,
  assignments,
  onAction,
}: ActionInboxProps) {
  const [onlyMine, setOnlyMine] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const items = useMemo(
    () =>
      buildActionInbox({
        session,
        aircraft,
        tasks,
        planningItems,
        assignments,
      }),
    [session, aircraft, tasks, planningItems, assignments]
  );

  const mineCount = items.filter((i) => i.assignedToMe).length;
  const visibleItems = onlyMine ? items.filter((i) => i.assignedToMe) : items;
  const displayed = showAll ? visibleItems : visibleItems.slice(0, 6);

  return (
    <section className="panel action-inbox" aria-label="صندوق الإجراءات المعلقة">
      <div className="sectionhead">
        <div>
          <div className="action-inbox-title">
            <Inbox size={18} />
            <h2>صندوق الإجراءات المعلقة</h2>
            <span className="badge ok">{items.length} إجراء</span>
          </div>
          <p>يعرض فقط المهام وحزم العمل المتاحة لصلاحياتك مع احترام فصل مهام الإعداد والمراجعة والاعتماد.</p>
        </div>
        <div className="action-inbox-controls">
          <button
            type="button"
            className={onlyMine ? 'primary' : 'secondary'}
            aria-pressed={onlyMine}
            onClick={() => setOnlyMine((v) => !v)}
          >
            المعيّن لي ({mineCount})
          </button>
        </div>
      </div>

      {displayed.length ? (
        <div className="action-inbox-list">
          {displayed.map((item) => (
            <div className="action-inbox-row" key={item.id}>
              <div className="action-inbox-meta">
                <div className="action-inbox-badges">
                  <ActionBadge kind={item.actionKind} />
                  {item.assignedToMe && <span className="assignment-badge mine">معيّن لي</span>}
                </div>
                <strong>{item.title}</strong>
                <small>{item.subtitle}</small>
              </div>
              <button type="button" className="secondary" onClick={() => onAction(item)}>
                {item.actionLabel}
                <ArrowUpLeft size={14} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty">
          {onlyMine
            ? 'لا توجد عناصر معلقة معيّنة لك حاليًا.'
            : 'لا توجد إجراءات معلقة تتطلب تدخلك وفق صلاحياتك الحالية.'}
        </div>
      )}

      {visibleItems.length > 6 && (
        <div className="action-inbox-foot">
          <button type="button" className="link" onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'عرض 6 عناصر فقط' : `عرض جميع الإجراءات (${visibleItems.length})`}
          </button>
        </div>
      )}
    </section>
  );
}
