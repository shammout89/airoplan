export interface TimelinePackageBar {
  id: string;
  code: string;
  name: string;
  aircraftId: string;
  aircraftName: string;
  station: string;
  state: string;
  startIso: string;
  endIso: string;
  startLocal: string;
  endLocal: string;
  plannedManHours: number;
  taskCount: number;
  leftPct: number;
  widthPct: number;
  hasAircraftOverlap: boolean;
  hasStationOverlap: boolean;
}

export interface TimelineTrack {
  aircraftId: string;
  aircraftName: string;
  totalManHours: number;
  bars: TimelinePackageBar[];
}

export interface PackageTimelineResult {
  minIso: string;
  maxIso: string;
  totalManHours: number;
  overlapCount: number;
  tracks: TimelineTrack[];
}

export interface TimelinePackageInput {
  id: string;
  code?: string;
  state?: string;
  data?: {
    name?: string;
    aircraftId?: string;
    station?: string;
    start?: string;
    end?: string;
    plannedManHours?: number | string;
    taskIds?: string[];
  };
}

export interface TimelineAircraftInput {
  id: string;
  data?: {
    name?: string;
  };
}

export function formatTimeInZone(iso: string, timeZone = 'Asia/Amman'): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
  } catch {
    return iso.slice(0, 16).replace('T', ' ');
  }
}

function intervalsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function buildPackageTimeline(
  packages: TimelinePackageInput[],
  aircraft: TimelineAircraftInput[],
  timeZone = 'Asia/Amman'
): PackageTimelineResult | null {
  const planeMap = new Map<string, string>(
    (aircraft || []).map((a) => [a.id, String(a.data?.name || '—')])
  );

  const parsed = (packages || [])
    .filter((p) => p.state !== 'cancelled')
    .map((p) => {
      const startIso = p.data?.start || '';
      const endIso = p.data?.end || '';
      const startMs = Date.parse(startIso);
      const endMs = Date.parse(endIso);
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
      return {
        pkg: p,
        startIso,
        endIso,
        startMs,
        endMs,
        aircraftId: String(p.data?.aircraftId || ''),
        station: String(p.data?.station || '').trim().toUpperCase(),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  if (!parsed.length) return null;

  const minMs = Math.min(...parsed.map((x) => x.startMs));
  const maxMs = Math.max(...parsed.map((x) => x.endMs));
  const spanMs = Math.max(60 * 60 * 1000, maxMs - minMs);

  const aircraftOverlapIds = new Set<string>();
  const stationOverlapIds = new Set<string>();

  for (let i = 0; i < parsed.length; i++) {
    for (let j = i + 1; j < parsed.length; j++) {
      const a = parsed[i];
      const b = parsed[j];
      if (!intervalsOverlap(a.startMs, a.endMs, b.startMs, b.endMs)) continue;
      if (a.aircraftId && a.aircraftId === b.aircraftId) {
        aircraftOverlapIds.add(a.pkg.id);
        aircraftOverlapIds.add(b.pkg.id);
      }
      if (a.station && a.station === b.station) {
        stationOverlapIds.add(a.pkg.id);
        stationOverlapIds.add(b.pkg.id);
      }
    }
  }

  const tracksMap = new Map<string, TimelineTrack>();
  let totalManHours = 0;

  for (const entry of parsed.sort((a, b) => a.startMs - b.startMs)) {
    const p = entry.pkg;
    const manHours = Number(p.data?.plannedManHours) || 0;
    totalManHours += manHours;
    const leftPct = Math.max(0, Math.min(98, ((entry.startMs - minMs) / spanMs) * 100));
    const rawWidth = ((entry.endMs - entry.startMs) / spanMs) * 100;
    const widthPct = Math.max(3, Math.min(100 - leftPct, rawWidth));
    const aircraftName = planeMap.get(entry.aircraftId) || '—';

    const bar: TimelinePackageBar = {
      id: p.id,
      code: p.code || '',
      name: p.data?.name || '',
      aircraftId: entry.aircraftId,
      aircraftName,
      station: p.data?.station || '—',
      state: p.state || 'draft',
      startIso: entry.startIso,
      endIso: entry.endIso,
      startLocal: formatTimeInZone(entry.startIso, timeZone),
      endLocal: formatTimeInZone(entry.endIso, timeZone),
      plannedManHours: manHours,
      taskCount: Array.isArray(p.data?.taskIds) ? p.data.taskIds.length : 0,
      leftPct: Number(leftPct.toFixed(2)),
      widthPct: Number(widthPct.toFixed(2)),
      hasAircraftOverlap: aircraftOverlapIds.has(p.id),
      hasStationOverlap: stationOverlapIds.has(p.id),
    };

    const existing = tracksMap.get(entry.aircraftId);
    if (existing) {
      existing.bars.push(bar);
      existing.totalManHours += manHours;
    } else {
      tracksMap.set(entry.aircraftId, {
        aircraftId: entry.aircraftId,
        aircraftName,
        totalManHours: manHours,
        bars: [bar],
      });
    }
  }

  return {
    minIso: new Date(minMs).toISOString(),
    maxIso: new Date(maxMs).toISOString(),
    totalManHours,
    overlapCount: aircraftOverlapIds.size,
    tracks: [...tracksMap.values()],
  };
}
