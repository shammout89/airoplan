'use client';

import { Check, Clock, AlertCircle } from 'lucide-react';
import { TaskWorkflowGuide } from '../../lib/task-workflow-guide';

interface TaskLifecycleBarProps {
  guide: TaskWorkflowGuide;
  compact?: boolean;
  showGuidance?: boolean;
}

export default function TaskLifecycleBar({
  guide,
  compact = false,
  showGuidance = false,
}: TaskLifecycleBarProps) {
  return (
    <section
      className={compact ? 'lifecycle-bar lifecycle-bar-compact' : 'lifecycle-bar'}
      aria-label="مراحل دورة المهمة"
    >
      <div className="lifecycle-bar-head">
        <div>
          <strong>مسار المهمة الحالي</strong>
          <p>{guide.summary}</p>
        </div>
        <div className="lifecycle-waiting">
          <small>المطلوب الآن من</small>
          <strong>{guide.waitingOn}</strong>
        </div>
      </div>

      <ol className="lifecycle-steps">
        {guide.stages.map((stage) => (
          <li key={stage.key} className={`lifecycle-step is-${stage.status}`}>
            <span className="lifecycle-step-index" aria-hidden="true">
              {stage.status === 'done' ? (
                <Check size={14} />
              ) : stage.status === 'blocked' ? (
                <AlertCircle size={14} />
              ) : stage.status === 'active' ? (
                <Clock size={14} />
              ) : (
                stage.step
              )}
            </span>
            <div className="lifecycle-step-text">
              <strong>{stage.title}</strong>
              <small>{stage.detail}</small>
            </div>
          </li>
        ))}
      </ol>

      <div className="lifecycle-next-line">
        <strong>الخطوة التالية:</strong> <span>{guide.nextStep}</span>
      </div>

      {showGuidance && guide.executionGuidance && (
        <div className="role-guidance" role="note">
          <AlertCircle size={16} aria-hidden="true" />
          <div>
            <strong>توضيح ظهور الأزرار لحسابك الحالي</strong>
            <p>{guide.executionGuidance}</p>
          </div>
        </div>
      )}
    </section>
  );
}
