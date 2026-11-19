import { ASSIGNMENT_KIND, ActiveMemberRef, assignmentCode, normalizeAssignment } from './assignment';
import { AccessError } from './permissions';
import {
  AircraftScopePolicy,
  DEFAULT_AIRCRAFT_SCOPE,
  extractScopedAircraftIds,
  requireAircraftInScope,
} from './aircraft-scope';

export interface DbPreparedStmt {
  bind: (...args: unknown[]) => DbBoundStmt;
}

export interface DbBoundStmt {
  first: <T = Record<string, unknown>>() => Promise<T | null>;
  all: <T = Record<string, unknown>>() => Promise<{ results: T[] }>;
  run: () => Promise<{ meta?: { changes?: number } }>;
}

export interface DbClient {
  prepare: (sql: string) => DbPreparedStmt;
  batch: (stmts: DbBoundStmt[]) => Promise<Array<{ meta?: { changes?: number } }>>;
}

export interface StoredAssignment {
  id: string;
  kind: string;
  code: string;
  state: string;
  data: ReturnType<typeof normalizeAssignment>;
  etag: string;
  modified_by: string;
  updated: string;
}

export async function listAssignments(
  db: DbClient,
  scope: string,
  aircraftScope: AircraftScopePolicy = DEFAULT_AIRCRAFT_SCOPE
): Promise<StoredAssignment[]> {
  const res = await db
    .prepare(
      'SELECT id, kind, code, state, data, etag, modified_by, updated FROM extension_items WHERE workspace_id = ? AND kind = ? ORDER BY updated DESC'
    )
    .bind(scope, ASSIGNMENT_KIND)
    .all<{
      id: string;
      kind: string;
      code: string;
      state: string;
      data: string;
      etag: string;
      modified_by: string;
      updated: string;
    }>();
  const rows = (res?.results || []).map((row) => ({
    ...row,
    data: JSON.parse(row.data),
  }));
  if (!aircraftScope || aircraftScope.mode !== 'restricted' || !rows.length) {
    return rows;
  }
  const [planeRes, taskRes, pkgRes] = await Promise.all([
    db.prepare("SELECT id, data FROM records WHERE owner = ? AND kind = 'aircraft'").bind(scope).all<{ id: string; data: string }>(),
    db.prepare("SELECT id, json_extract(data, '$.aircraftId') AS aircraftId FROM records WHERE owner = ? AND kind = 'task'").bind(scope).all<{ id: string; aircraftId: string }>(),
    db.prepare("SELECT id, json_extract(data, '$.aircraftId') AS aircraftId FROM planning_items WHERE workspace_id = ? AND kind = 'package'").bind(scope).all<{ id: string; aircraftId: string }>(),
  ]);
  const planes = (planeRes?.results || []).map((p) => {
    const parsed = JSON.parse(p.data);
    return { id: p.id, model: parsed.model, type: parsed.type, name: parsed.name };
  });
  const scopedPlaneIds = extractScopedAircraftIds(aircraftScope, planes);
  const taskPlaneMap = new Map((taskRes?.results || []).map((t) => [t.id, t.aircraftId]));
  const pkgPlaneMap = new Map((pkgRes?.results || []).map((p) => [p.id, p.aircraftId]));
  return rows.filter((row) => {
    const planeId =
      row.data?.targetType === 'package'
        ? pkgPlaneMap.get(row.data.targetId)
        : taskPlaneMap.get(row.data?.targetId);
    return !!planeId && scopedPlaneIds.has(planeId);
  });
}

export async function listAssignableMembers(db: DbClient, scope: string): Promise<ActiveMemberRef[]> {
  const res = await db
    .prepare(
      "SELECT id, user_id, email, role, state FROM members WHERE workspace_id = ? AND state = 'active' AND user_id IS NOT NULL ORDER BY created ASC"
    )
    .bind(scope)
    .all<{ id: string; user_id: string; email: string; role: string; state: string }>();
  return (res?.results || []).map((m) => ({
    id: String(m.id),
    userId: String(m.user_id),
    email: String(m.email),
    role: String(m.role),
    state: String(m.state),
  }));
}

export async function saveAssignment(
  db: DbClient,
  a: { scope: string; userId: string; email: string; isOwner?: boolean; aircraftScope?: AircraftScopePolicy },
  body: Record<string, unknown>
) {
  const rawType = body?.targetType;
  const rawId = typeof body?.targetId === 'string' ? body.targetId.trim() : '';
  if ((rawType !== 'task' && rawType !== 'package') || !rawId) {
    throw new Error('حدد نوع العنصر ومعرّفه قبل حفظ التعيين');
  }

  let targetAircraftId: string | null = null;
  if (rawType === 'task') {
    const taskRow = await db
      .prepare("SELECT id, json_extract(data, '$.aircraftId') AS aircraftId FROM records WHERE id = ? AND owner = ? AND kind = 'task'")
      .bind(rawId, a.scope)
      .first<{ id: string; aircraftId: string | null }>();
    if (!taskRow) {
      throw new AccessError('المهمة المحددة غير موجودة في مساحة العمل', 404);
    }
    targetAircraftId = taskRow.aircraftId || null;
  } else {
    const pkgRow = await db
      .prepare("SELECT id, json_extract(data, '$.aircraftId') AS aircraftId FROM planning_items WHERE id = ? AND workspace_id = ? AND kind = 'package'")
      .bind(rawId, a.scope)
      .first<{ id: string; aircraftId: string | null }>();
    if (!pkgRow) {
      throw new AccessError('حزمة العمل المحددة غير موجودة في مساحة العمل', 404);
    }
    targetAircraftId = pkgRow.aircraftId || null;
  }

  if (!a.isOwner && a.aircraftScope?.mode === 'restricted') {
    const planeRow = targetAircraftId
      ? await db
          .prepare("SELECT id, data FROM records WHERE id = ? AND owner = ? AND kind = 'aircraft'")
          .bind(targetAircraftId, a.scope)
          .first<{ id: string; data: string }>()
      : null;
    if (!planeRow) {
      throw new AccessError('ليس لديك صلاحية على هذه الطائرة أو طرازها ضمن نطاق تفويضك', 403);
    }
    requireAircraftInScope(a, { id: planeRow.id, ...JSON.parse(planeRow.data) });
  }

  const members = await listAssignableMembers(db, a.scope);
  const now = new Date().toISOString();
  const normalized = normalizeAssignment(body, {
    members,
    actorId: a.userId,
    now,
  });

  const code = assignmentCode(normalized.targetType, normalized.targetId);
  const existing = await db
    .prepare('SELECT id, etag FROM extension_items WHERE workspace_id = ? AND kind = ? AND code = ?')
    .bind(a.scope, ASSIGNMENT_KIND, code)
    .first<{ id: string; etag: string }>();

  const hasEtagField =
    body &&
    Object.prototype.hasOwnProperty.call(body, 'etag') &&
    body.etag !== undefined &&
    body.etag !== null &&
    body.etag !== '';
  if (existing && hasEtagField && body.etag !== existing.etag) {
    throw new AccessError('تغير تعيين المسؤول أثناء الحفظ؛ حدّث الصفحة', 409);
  }
  if (!existing && hasEtagField) {
    throw new AccessError('تغير تعيين المسؤول أثناء الحفظ؛ حدّث الصفحة', 409);
  }

  const rowId = existing?.id || crypto.randomUUID();
  const newEtag = crypto.randomUUID();
  const encoded = JSON.stringify(normalized);

  const targetExistsSql =
    normalized.targetType === 'task'
      ? "EXISTS(SELECT 1 FROM records WHERE id = ? AND owner = ? AND kind = 'task')"
      : "EXISTS(SELECT 1 FROM planning_items WHERE id = ? AND workspace_id = ? AND kind = 'package')";

  const writeStmt = existing
    ? db
        .prepare(
          `UPDATE extension_items SET state = 'active', data = ?, etag = ?, modified_by = ?, updated = ? WHERE id = ? AND workspace_id = ? AND etag = ? AND ${targetExistsSql}`
        )
        .bind(
          encoded,
          newEtag,
          a.userId,
          now,
          existing.id,
          a.scope,
          existing.etag,
          normalized.targetId,
          a.scope
        )
    : db
        .prepare(
          `INSERT INTO extension_items (id, workspace_id, kind, code, state, data, etag, modified_by, created, updated) SELECT ?, ?, ?, ?, 'active', ?, ?, ?, ?, ? WHERE ${targetExistsSql}`
        )
        .bind(
          rowId,
          a.scope,
          ASSIGNMENT_KIND,
          code,
          encoded,
          newEtag,
          a.userId,
          now,
          now,
          normalized.targetId,
          a.scope
        );

  const auditAction = `${a.email} — تعيين مسؤول التخطيط (${normalized.targetType === 'task' ? 'مهمة' : 'حزمة عمل'}): ${normalized.primaryEmail}${normalized.backupEmail ? ` / بديل: ${normalized.backupEmail}` : ''}`;
  const auditStmt = db
    .prepare(
      'INSERT INTO audit (id, owner, action, created) SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM extension_items WHERE id = ? AND workspace_id = ? AND etag = ?)'
    )
    .bind(crypto.randomUUID(), a.scope, auditAction, now, rowId, a.scope, newEtag);

  const result = await db.batch([writeStmt, auditStmt]);
  if (!result?.[0]?.meta?.changes) {
    throw new AccessError('تغيرت بيانات التعيين أثناء الحفظ؛ حدّث الصفحة', 409);
  }

  return {
    id: rowId,
    etag: newEtag,
    code,
    state: 'active',
    data: normalized,
    updated: now,
  };
}
