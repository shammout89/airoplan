import { AccessError } from './permissions';

export type AircraftScopeMode = 'all' | 'restricted';

export interface AircraftScopePolicy {
  mode: AircraftScopeMode;
  aircraftIds: string[];
  models: string[];
}

export interface AircraftScopeRecord {
  id: string;
  model?: string | null;
  type?: string | null;
  name?: string | null;
}

export const DEFAULT_AIRCRAFT_SCOPE: AircraftScopePolicy = {
  mode: 'all',
  aircraftIds: [],
  models: [],
};

export function normalizeModelKey(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

function cleanStringList(raw: unknown, max: number, label: string, normalizeUpper = false): string[] {
  if (raw === undefined || raw === null || raw === '') return [];
  if (!Array.isArray(raw) || raw.length > max) {
    throw new Error(`قائمة ${label} غير صالحة`);
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') {
      throw new Error(`قائمة ${label} غير صالحة`);
    }
    const trimmed = normalizeUpper ? normalizeModelKey(item) : item.trim();
    if (!trimmed) continue;
    if (trimmed.length > 150) {
      throw new Error(`قيمة ${label} أطول من الحد المسموح`);
    }
    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      out.push(trimmed);
    }
  }
  return out.sort();
}

export function normalizeAircraftScope(
  raw: unknown,
  validAircraft?: AircraftScopeRecord[]
): AircraftScopePolicy {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const rawMode =
    input.aircraftScopeMode ??
    input.mode ??
    (input.restrictedAircraft === true ? 'restricted' : 'all');

  if (rawMode !== 'all' && rawMode !== 'restricted') {
    throw new Error('وضع نطاق الطائرات غير صالح');
  }

  if (rawMode === 'all') {
    return { mode: 'all', aircraftIds: [], models: [] };
  }

  const aircraftIds = cleanStringList(input.aircraftIds, 500, 'الطائرات المسموحة');
  const models = cleanStringList(
    input.aircraftModels ?? input.models,
    100,
    'الطرز المسموحة',
    true
  );

  if (!aircraftIds.length && !models.length) {
    throw new Error('اختر طائرة واحدة أو طرازًا واحدًا على الأقل عند تفعيل تقييد النطاق');
  }

  if (validAircraft) {
    const validIds = new Set(validAircraft.map((a) => a.id));
    for (const id of aircraftIds) {
      if (!validIds.has(id)) {
        throw new Error('إحدى الطائرات المحددة في نطاق الصلاحيات غير مسجلة');
      }
    }
  }

  return {
    mode: 'restricted',
    aircraftIds,
    models,
  };
}

export function hasRestrictedAircraftScope(scope?: AircraftScopePolicy | null): boolean {
  return !!scope && scope.mode === 'restricted';
}

export function isAircraftInScope(
  scope: AircraftScopePolicy | null | undefined,
  plane: { id?: string | null; model?: string | null; type?: string | null } | null | undefined
): boolean {
  if (!scope || scope.mode !== 'restricted') {
    return true;
  }
  if (!plane) {
    return false;
  }
  if (plane.id && scope.aircraftIds.includes(plane.id)) {
    return true;
  }
  const modelKey = normalizeModelKey(plane.model || plane.type);
  if (modelKey && scope.models.some((m) => normalizeModelKey(m) === modelKey)) {
    return true;
  }
  return false;
}

export function requireAircraftInScope(
  actorOrScope:
    | { isOwner?: boolean; aircraftScope?: AircraftScopePolicy | null }
    | AircraftScopePolicy
    | null
    | undefined,
  plane: { id?: string | null; model?: string | null; type?: string | null } | null | undefined
): void {
  if (!actorOrScope) return;
  const maybeActor = actorOrScope as { isOwner?: boolean; aircraftScope?: AircraftScopePolicy | null };
  if (maybeActor.isOwner) return;
  const scope =
    'mode' in actorOrScope
      ? (actorOrScope as AircraftScopePolicy)
      : maybeActor.aircraftScope || DEFAULT_AIRCRAFT_SCOPE;
  if (!isAircraftInScope(scope, plane)) {
    throw new AccessError('ليس لديك صلاحية على هذه الطائرة أو طرازها ضمن نطاق تفويضك', 403);
  }
}

export function extractScopedAircraftIds(
  scope: AircraftScopePolicy | null | undefined,
  planes: AircraftScopeRecord[]
): Set<string> {
  if (!scope || scope.mode !== 'restricted') {
    return new Set(planes.map((p) => p.id));
  }
  const allowed = new Set<string>();
  for (const plane of planes) {
    if (isAircraftInScope(scope, plane)) {
      allowed.add(plane.id);
    }
  }
  return allowed;
}

export function describeAircraftScope(
  scope: AircraftScopePolicy | null | undefined,
  planes: AircraftScopeRecord[] = []
): string {
  if (!scope || scope.mode !== 'restricted') {
    return 'جميع طائرات الأسطول';
  }
  const parts: string[] = [];
  if (scope.aircraftIds.length) {
    const names = scope.aircraftIds
      .map((id) => planes.find((p) => p.id === id)?.name || id)
      .slice(0, 3);
    const suffix = scope.aircraftIds.length > 3 ? ` (+${scope.aircraftIds.length - 3})` : '';
    parts.push(`طائرات: ${names.join('، ')}${suffix}`);
  }
  if (scope.models.length) {
    parts.push(`طرز: ${scope.models.slice(0, 3).join('، ')}${scope.models.length > 3 ? ` (+${scope.models.length - 3})` : ''}`);
  }
  return parts.length ? `مقيّد (${parts.join(' · ')})` : 'مقيّد بدون طائرات';
}
