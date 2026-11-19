'use client';

import { useMemo } from 'react';
import { AlertTriangle, CalendarClock, Printer } from 'lucide-react';
import {
  TimelineAircraftInput,
  TimelinePackageInput,
  buildPackageTimeline,
  formatTimeInZone,
} from '../../lib/package-timeline';
import { InboxAssignmentRecord } from '../../lib/action-inbox';
import { planningStateLabels } from '../../lib/planning';

interface PackageGanttProps {
  packages: TimelinePackageInput[];
  aircraft: TimelineAircraftInput[];
  assignments?: InboxAssignmentRecord[];
  selectedId: string | null;
  onSelect: (packageId: string) => void;
  onPrint?: (packageId: string) => void;
}

export default function PackageGantt({
  packages,
  aircraft,
  assignments = [],
  selectedId,
  onSelect,
  onPrint,
}: PackageGanttProps) {
  const timeline = useMemo(
    () => buildPackageTimeline(packages, aircraft, 'Asia/Amman'),
    [packages, aircraft]
  );

  const assignmentMap = useMemo(
    () =>
      new Map(
        assignments
          .filter((a) => a.data?.targetType === 'package' && a.data?.targetId)
          .map((a) => [a.data!.targetId!, a.data!])
      ),
    [assignments]
  );

  if (!timeline) {
    return (
      <section className="panel package-gantt" aria-label="المخطط الزمني لحزم العمل">
        <div className="sectionhead">
          <div>
            <h2>المخطط الزمني لحزم العمل (Gantt)</h2>
            <p>يظهر هنا توزيع نوافذ التوقف وساعات العمل لكل طائرة عند إضافة حزم عمل.</p>
          </div>
        </div>
        <div className="empty">لا توجد حزم عمل نشطة لعرضها على الخط الزمني.</div>
      </section>
    );
  }

  return (
    <section className="panel package-gantt" aria-label="المخطط الزمني لحزم العمل">
      <div className="sectionhead">
        <div>
          <div className="gantt-title">
            <CalendarClock size={18} />
            <h2>المخطط الزمني وتوزيع الجهد (Gantt)</h2>
          </div>
          <p>
            النطاق الزمني (توقيت عمّان): {formatTimeInZone(timeline.minIso, 'Asia/Amman')} ←{' '}
            {formatTimeInZone(timeline.maxIso, 'Asia/Amman')}
          </p>
        </div>
        <div className="gantt-summary">
          <span className="badge ok">إجمالي الجهد: {timeline.totalManHours} ساعة عمل</span>
          {timeline.overlapCount > 0 && (
            <span className="badge overdue">
              <AlertTriangle size={12} /> تداخل زمني على الطائرة ({timeline.overlapCount})
            </span>
          )}
          {selectedId && onPrint && (
            <button type="button" className="secondary" onClick={() => onPrint(selectedId)}>
              <Printer size={15} />
              طباعة الحزمة المحددة
            </button>
          )}
        </div>
      </div>

      <div className="gantt-tracks">
        {timeline.tracks.map((track) => (
          <div className="gantt-track" key={track.aircraftId}>
            <div className="gantt-track-label">
              <strong className="mono">{track.aircraftName}</strong>
              <small>{track.totalManHours} ساعة عمل</small>
            </div>
            <div className="gantt-lane" dir="ltr">
              {track.bars.map((bar) => {
                const assignee = assignmentMap.get(bar.id);
                const isSelected = selectedId === bar.id;
                const overlapClass = bar.hasAircraftOverlap
                  ? ' overlap-aircraft'
                  : bar.hasStationOverlap
                  ? ' overlap-station'
                  : '';
                return (
                  <button
                    key={bar.id}
                    type="button"
                    className={`gantt-bar${isSelected ? ' selected' : ''}${overlapClass}`}
                    style={{ left: `${bar.leftPct}%`, width: `${bar.widthPct}%` }}
                    title={`${bar.code} — ${bar.name} | عمّان: ${bar.startLocal} → ${bar.endLocal} | محطة: ${bar.station} | ${bar.plannedManHours} س`}
                    onClick={() => onSelect(bar.id)}
                  >
                    <span className="gantt-bar-code">{bar.code}</span>
                    <span className="gantt-bar-meta">
                      {bar.station} · {bar.plannedManHours}h · {planningStateLabels[bar.state] || bar.state}
                      {assignee?.primaryEmail ? ` · ${assignee.primaryEmail.split('@')[0]}` : ''}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
