'use client';

import { useEffect, useState } from 'react';
import { UserCheck, X } from 'lucide-react';
import { apiFetch } from '../client-fetch';
import { roleLabels } from '../../lib/permissions';
import { ActiveMemberRef } from '../../lib/assignment';
import { InboxAssignmentRecord } from '../../lib/action-inbox';

interface AssignmentModalProps {
  targetType: 'task' | 'package';
  targetId: string;
  targetTitle: string;
  existingAssignment?: InboxAssignmentRecord;
  onSaved: () => Promise<void>;
  onClose: () => void;
}

interface AssignmentsApiResponse {
  members?: ActiveMemberRef[];
  assignments?: InboxAssignmentRecord[];
  error?: string;
}

export default function AssignmentModal({
  targetType,
  targetId,
  targetTitle,
  existingAssignment,
  onSaved,
  onClose,
}: AssignmentModalProps) {
  const [members, setMembers] = useState<ActiveMemberRef[]>([]);
  const [etag, setEtag] = useState<string>(existingAssignment?.etag || '');
  const [primaryUserId, setPrimaryUserId] = useState<string>(
    existingAssignment?.data?.primaryUserId || ''
  );
  const [backupUserId, setBackupUserId] = useState<string>(
    existingAssignment?.data?.backupUserId || ''
  );
  const [shiftLabel, setShiftLabel] = useState<string>(
    existingAssignment?.data?.shiftLabel || ''
  );
  const [handoverNote, setHandoverNote] = useState<string>(
    existingAssignment?.data?.handoverNote || ''
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const r = await apiFetch('/api/assignments');
        const j = (await r.json()) as AssignmentsApiResponse;
        if (!r.ok) throw Error(j.error || 'تعذر تحميل قائمة الأعضاء');
        if (cancelled) return;
        const activeMembers = Array.isArray(j.members) ? j.members : [];
        setMembers(activeMembers);
        const latest = (j.assignments || []).find(
          (a) => a.data?.targetType === targetType && a.data?.targetId === targetId
        );
        if (latest) {
          setEtag(latest.etag || '');
          setPrimaryUserId(latest.data?.primaryUserId || '');
          setBackupUserId(latest.data?.backupUserId || '');
          setShiftLabel(latest.data?.shiftLabel || '');
          setHandoverNote(latest.data?.handoverNote || '');
        } else if (activeMembers[0]?.userId) {
          setPrimaryUserId((prev) => prev || activeMembers[0].userId);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'تعذر تحميل بيانات التعيين');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [targetType, targetId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const r = await apiFetch('/api/assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetType,
          targetId,
          primaryUserId,
          backupUserId: backupUserId || null,
          shiftLabel,
          handoverNote,
          ...(etag ? { etag } : {}),
        }),
      });
      const j = (await r.json()) as { error?: string };
      if (!r.ok) throw Error(j.error || 'تعذر حفظ تعيين المسؤول');
      await onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر حفظ تعيين المسؤول');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <section
        className="modal assignment-modal"
        role="dialog"
        aria-modal="true"
        aria-label="تعيين مسؤول التخطيط وتسليم المناوبة"
      >
        <div className="sectionhead">
          <div>
            <h2>تعيين مسؤول التخطيط وتسليم المناوبة</h2>
            <p>
              {targetType === 'task' ? 'المهمة: ' : 'حزمة العمل: '}
              <strong>{targetTitle}</strong>
            </p>
          </div>
          <button
            type="button"
            className="iconbutton"
            disabled={saving}
            onClick={onClose}
            aria-label="إغلاق"
          >
            <X />
          </button>
        </div>

        <form onSubmit={submit}>
          <fieldset className="formfieldset" disabled={loading || saving}>
            <div className="formgrid">
              <label>
                المسؤول الأساسي
                <select
                  required
                  value={primaryUserId}
                  onChange={(e) => {
                    const next = e.target.value;
                    setPrimaryUserId(next);
                    if (backupUserId === next) setBackupUserId('');
                  }}
                >
                  <option value="">اختر عضوًا مفعلًا…</option>
                  {members.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.email} ({roleLabels[m.role] || m.role})
                    </option>
                  ))}
                </select>
              </label>

              <label>
                المسؤول البديل — اختياري
                <select
                  value={backupUserId}
                  onChange={(e) => setBackupUserId(e.target.value)}
                >
                  <option value="">بدون مسؤول بديل</option>
                  {members
                    .filter((m) => m.userId !== primaryUserId)
                    .map((m) => (
                      <option key={m.userId} value={m.userId}>
                        {m.email} ({roleLabels[m.role] || m.role})
                      </option>
                    ))}
                </select>
              </label>

              <label>
                المناوبة / الفريق
                <input
                  type="text"
                  maxLength={60}
                  placeholder="مثال: المناوبة الصباحية A"
                  value={shiftLabel}
                  onChange={(e) => setShiftLabel(e.target.value)}
                />
              </label>

              <label className="assignment-wide-field">
                ملاحظة تسليم العمل (Handover Note)
                <textarea
                  maxLength={1000}
                  placeholder="مثال: بانتظار إغلاق بطاقة الفحص أو وصول القطعة قبل موعد التوقف..."
                  value={handoverNote}
                  onChange={(e) => setHandoverNote(e.target.value)}
                />
              </label>
            </div>
          </fieldset>

          {error && (
            <div className="error programerror" role="alert">
              {error}
            </div>
          )}

          <div className="modalfoot">
            <button type="submit" className="primary" disabled={loading || saving || !primaryUserId}>
              <UserCheck size={16} />
              {saving ? 'جارٍ الحفظ…' : 'حفظ التعيين وتسليم المناوبة'}
            </button>
            <button type="button" className="secondary" disabled={saving} onClick={onClose}>
              إلغاء
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
