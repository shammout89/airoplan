import { env } from 'cloudflare:workers';
import { access, checkOrigin, failure, requirePermission } from '../../../lib/access';
import { acquireWrite, releaseWrite } from '../../../lib/write-gate';
import {
  DbClient,
  listAssignableMembers,
  listAssignments,
  saveAssignment,
} from '../../../lib/assignment-store';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const a = await access();
    requirePermission(a, 'read');
    const db = env.DB as unknown as DbClient;
    const [assignments, members] = await Promise.all([
      listAssignments(db, a.scope, a.aircraftScope),
      listAssignableMembers(db, a.scope),
    ]);
    return Response.json({ assignments, members });
  } catch (e) {
    return failure(e);
  }
}

export async function POST(req: Request) {
  let lease: string | null = null;
  try {
    checkOrigin(req);
    const a = await access();
    const rawBody: unknown = await req.json();
    const body =
      rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody)
        ? (rawBody as Record<string, unknown>)
        : {};
    const requiredPerm = body.targetType === 'package' ? 'edit_planning' : 'edit_task';
    requirePermission(a, requiredPerm);
    lease = await acquireWrite(a, req);
    const db = env.DB as unknown as DbClient;
    const saved = await saveAssignment(db, a, body);
    return Response.json({ ok: true, assignment: saved });
  } catch (e) {
    return failure(e);
  } finally {
    await releaseWrite(lease);
  }
}
