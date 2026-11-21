import {prepareTaskApproval,taskPolicyHeadGuard,taskEventWrites,taskActorGuard} from '../../../lib/task-approval-store';
import {programDefinition} from '../../../lib/program-store';
import { initializeSchedule, nextOccurrence } from '../../../lib/scheduling';
import {taskLimits} from '../../../lib/task-validation';
import {executionRecord} from '../../../lib/execution-record';
import { pinScheduleEvidence } from '../../../lib/schedule-evidence';
import { requireAircraftReady } from '../../../lib/aircraft';
import { routePolicy, policyWrites } from '../../../lib/approval-policy';
import { acquireWrite, releaseWrite } from '../../../lib/write-gate';
import { env } from 'cloudflare:workers';
import { access, checkOrigin, failure, requirePermission, requireAircraftInScope, requireAircraftIdInScope, scopedAircraftSet } from '../../../lib/access';
import { AccessError, workflowTransition } from '../../../lib/permissions';
import { serviceBaseline } from '../../../lib/recurrence';
import { applies, programToday } from '../../../lib/program';
export const dynamic = 'force-dynamic';
export async function GET(req?: Request) {
    try {
        const a = await access(), db = env.DB!, url = new URL(req?.url || 'https://local/api/execution'), taskId = url.searchParams.get('taskId');
        let chain: any = null, taskIds: string[] = [];
        if (taskId) {
            const selected: any = await db.prepare("SELECT * FROM records WHERE id=? AND owner=? AND kind='task'").bind(taskId, a.scope).first();
            if (!selected)
                throw new AccessError('المهمة غير موجودة', 404);
            const task = JSON.parse(selected.data);
            await requireAircraftIdInScope(a, task.aircraftId);
            const root = task.schedule?.rootTaskId || selected.id, offset = Math.max(0, Math.min(1000000, Math.floor(Number(url.searchParams.get('offset')) || 0))), where = "owner=? AND kind='task' AND (id=? OR json_extract(data,'$.schedule.rootTaskId')=?)", args = [a.scope, root, root], count: any = await db.prepare('SELECT COUNT(*) total FROM records WHERE ' + where).bind(...args).first(), rows = await db.prepare("SELECT * FROM records WHERE " + where + " ORDER BY CAST(json_extract(data,'$.schedule.sequence') AS INTEGER) DESC,id LIMIT 50 OFFSET ?").bind(...args, offset).all();
            chain = { records: rows.results.map((r: any) => ({ ...r, data: JSON.parse(r.data) })), total: Number(count.total), limit: 50, offset };
            taskIds = chain.records.map((r: any) => r.id);
        }
        const allowedPlanes = !taskId ? await scopedAircraftSet(a) : null;
        let scopedTaskIds: Set<string> | null = null;
        if (allowedPlanes) {
            const taskRows = await db.prepare("SELECT id, json_extract(data,'$.aircraftId') aircraftId FROM records WHERE owner=? AND kind='task'").bind(a.scope).all();
            scopedTaskIds = new Set((taskRows.results || []).filter((t: any) => allowedPlanes.has(t.aircraftId)).map((t: any) => t.id));
        }
        const filter = taskId ? ' AND task_id IN (' + (taskIds.length ? taskIds.map(() => '?').join(',') : 'NULL') + ')' : '', result = await db.prepare('SELECT * FROM accomplishments WHERE workspace_id=?' + filter + ' ORDER BY updated DESC').bind(a.scope, ...taskIds).all(), overrides = await db.prepare("SELECT * FROM effective_values WHERE workspace_id=? AND kind='completion'").bind(a.scope).all();
        const filteredAccomplishments = scopedTaskIds ? result.results.filter((r: any) => scopedTaskIds!.has(r.task_id)) : result.results;
        return Response.json({ chain, accomplishments: filteredAccomplishments.map((r: any) => { const original = JSON.parse(r.data), o: any = overrides.results.find((v: any) => v.target_id === r.id); return { ...r, originalData: original, data: o ? { ...original, ...JSON.parse(o.data) } : original, correctionId: o?.version || null }; }) });
    }
    catch (e) {
        return failure(e);
    }
}
export async function POST(req: Request) {
    let lease: string | null = null;
    try {
        checkOrigin(req);
        const a = await access(), db = env.DB!;
        lease = await acquireWrite(a, req);
        const body: any = await req.json();
        const pendingPolicy = await routePolicy(env.DB!, a, 'execution', body);
        if (JSON.stringify(body).length > 16000)
            throw Error('حجم بيانات التنفيذ كبير');
        const task: any = await db.prepare("SELECT * FROM records WHERE id=? AND owner=? AND kind='task'").bind(body.taskId, a.scope).first();
        if (!task)
            throw new AccessError('المهمة غير موجودة', 404);
        const t = JSON.parse(task.data);Object.defineProperty(t,'_taskId',{value:task.id});
        taskLimits(t);if(t.continuationUntil&&t.continuationUntil<new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Amman'}))throw Error('انتهت مهلة الاستمرار بالإصدار السابق؛ اعتمد خطة انتقال محدثة');
        if (['closed','withdrawn'].includes(t.status))
            throw new AccessError('تم إغلاق هذه المرة بالفعل', 409);
        const plane: any = await db.prepare("SELECT * FROM records WHERE id=? AND owner=? AND kind='aircraft'").bind(t.aircraftId, a.scope).first();
        if (!plane)
            throw Error('الطائرة غير موجودة');
        const aircraft = JSON.parse(plane.data);
        requireAircraftInScope(a, { id: plane.id, ...aircraft });
        if (body.action !== 'return')
            requireAircraftReady(aircraft);
        const program: any = t.programRevisionId ? await db.prepare('SELECT * FROM program_revisions WHERE id=? AND workspace_id=?').bind(t.programRevisionId, a.scope).first() : null;
        if ((t.schedule||t.programRevisionId) && (!program || !['approved', 'superseded'].includes(program.state)))
            throw Error('يلزم برنامج معتمد لهذه المهمة');
        const p = program?JSON.parse(program.data):null, definition = program?await programDefinition(db,a.scope,program,t.programTaskCode):null;
        if (p&&(!definition || !applies(p, definition, t.aircraftId) || p.effectiveDate > programToday()))
            throw Error('تعريف المهمة غير منطبق أو غير ساري');
        if (t.schedule?.policy && body.action !== 'return') {
            await pinScheduleEvidence(db, env.BUCKET!, a.scope, { tasks: [definition] }, true);
            if (JSON.stringify(t.schedule.policy) !== JSON.stringify(definition.schedulePolicy) || JSON.stringify(t.schedule.policyEvidence) !== JSON.stringify(definition.scheduleEvidence))
                throw Error('سياسة المهمة لا تطابق إصدار البرنامج المثبت');
        }
        const now = new Date().toISOString(), token = crypto.randomUUID();
        const touchedPlane = JSON.stringify({ ...aircraft, _revision: token });
        const touch = (id: string, table = 'accomplishments', proof = token) => db.prepare(`UPDATE records SET data=?,updated=? WHERE id=? AND owner=? AND EXISTS(SELECT 1 FROM ${table} WHERE id=? AND ${table === 'records' ? 'data' : 'etag'}=?)`).bind(touchedPlane, now, plane.id, a.scope, id, proof);
        const audit = (action: string, table: string, id: string) => db.prepare(`INSERT INTO audit (id,owner,action,created) SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM ${table} WHERE id=? AND ${table === 'records' ? 'owner' : 'workspace_id'}=? AND ${table === 'records' ? 'data' : 'etag'}=?)`).bind(crypto.randomUUID(), a.scope, `${a.email} — ${action}: ${t.name}`, now, id, a.scope, table === 'records' ? JSON.stringify(nextData) : token);
        let nextData: any;
        if (body.action === 'initialize') {
            requirePermission(a, 'edit_task');
            if(!program||!definition)throw Error('اربط المهمة ببرنامج معتمد لتهيئة التكرار');
            if (t.schedule)
                throw new AccessError('المهمة مهيأة بالفعل', 409);
            if (program.state !== 'approved')
                throw Error('اختر الإصدار الحالي قبل تهيئة الاستحقاق');
            if (body.taskRevision !== t._revision)
                throw new AccessError('تغيرت المهمة. حدّث الصفحة', 409);
            await pinScheduleEvidence(db, env.BUCKET!, a.scope, { tasks: [definition] }, true);
            const baseline = serviceBaseline(aircraft), initialized = initializeSchedule(definition, baseline, task.id), limits = initialized.limits;
            nextData = { ...t, ...limits, reviewState: 'draft', modifiedBy: a.userId, submittedBy: null, reviewedBy: null, approvedBy: null, _revision: token, schedule: { ...initialized.schedule, policyEvidence: definition.scheduleEvidence || [], initializedBy: a.userId, initializedAt: now } };
            const prepared=await prepareTaskApproval(db,a,task.id,nextData,t);nextData={...prepared.data,_revision:token};const head=taskPolicyHeadGuard(a.scope,prepared.policyHead),actor=taskActorGuard(a);
            const result = await db.batch([db.prepare('UPDATE records SET data=?,updated=? WHERE id=? AND owner=? AND data=? AND EXISTS(SELECT 1 FROM records WHERE id=? AND data=?) AND EXISTS(SELECT 1 FROM program_revisions WHERE id=? AND etag=?)'+head.sql+actor.sql).bind(JSON.stringify(nextData), now, task.id, a.scope, task.data, plane.id, plane.data, program.id, program.etag,...head.args,...actor.args),...taskEventWrites(db,a,task.id,JSON.stringify(nextData),nextData,'prepared',prepared.archived?{previousApproval:prepared.archived}:{}), touch(task.id, 'records', JSON.stringify(nextData)), audit('تهيئة الاستحقاق الأول', 'records', task.id)]);
            if (!result[0].meta.changes)
                throw new AccessError('تغيرت البيانات أثناء التهيئة', 409);
            return Response.json({ ok: true });
        }
        if (t.programRevisionId&&(!t.schedule || t.schedule.mode !== 'automatic'))
            throw Error('هيئ الاستحقاق الآلي أولًا');
        const existing: any = await db.prepare('SELECT * FROM accomplishments WHERE workspace_id=? AND task_id=?').bind(a.scope, task.id).first();
        if (body.action === 'save') {
            requirePermission(a, 'record_execution');
            if (existing && existing.state !== 'draft')
                throw new AccessError('سجل التنفيذ مقفل للمراجعة أو معتمد');
            if (existing && body.etag !== existing.etag)
                throw new AccessError('تغير سجل التنفيذ', 409);
            const data = await executionRecord(db,env.BUCKET!,a.scope,body.data,aircraft,t), id = existing?.id || crypto.randomUUID();
            const guard = ' AND EXISTS(SELECT 1 FROM records WHERE id=? AND owner=? AND data=?) AND EXISTS(SELECT 1 FROM records WHERE id=? AND data=?)';
            const write = existing ? db.prepare("UPDATE accomplishments SET data=?,etag=?,modified_by=?,updated=? WHERE id=? AND workspace_id=? AND etag=? AND state='draft'" + guard).bind(JSON.stringify(data), token, a.userId, now, id, a.scope, existing.etag, task.id, a.scope, task.data, plane.id, plane.data) : db.prepare("INSERT INTO accomplishments(id,workspace_id,task_id,state,data,etag,modified_by,created,updated) SELECT ?,?,?,'draft',?,?,?,?,? WHERE 1=1" + guard).bind(id, a.scope, task.id, JSON.stringify(data), token, a.userId, now, now, task.id, a.scope, task.data, plane.id, plane.data);
            const result = await db.batch([write, touch(id), audit('حفظ تنفيذ', 'accomplishments', id)]);
            if (!result[0].meta.changes)
                throw new AccessError('تغيرت البيانات أثناء الحفظ', 409);
            return Response.json({ ok: true });
        }
        if (!existing)
            throw new AccessError('سجل التنفيذ غير موجود', 404);
        if (body.etag !== existing.etag)
            throw new AccessError('تغير سجل التنفيذ. حدّث الصفحة', 409);
        let state: string, submitted = existing.submitted_by, reviewed = existing.reviewed_by, approved = existing.approved_by;
        const completion = body.action==='return'?JSON.parse(existing.data):await executionRecord(db,env.BUCKET!,a.scope,JSON.parse(existing.data),aircraft,t,true);
        if (body.action === 'return') {
            requirePermission(a, 'record_execution');
            if (!['submitted', 'reviewed'].includes(existing.state))
                throw new AccessError('لا يمكن إعادة السجل إلى المسودة', 409);
            state = 'draft';
            submitted = null;
            reviewed = null;
            approved = null;
        }
        else {
            if (!['submit', 'review', 'approve'].includes(body.action))
                throw Error('إجراء غير صالح');
            if (t.reviewState !== 'approved')
                throw new AccessError('يجب اعتماد تخطيط المهمة قبل إرسال تنفيذها', 409);
            const next = workflowTransition({ reviewState: existing.state, modifiedBy: existing.modified_by, submittedBy: existing.submitted_by, reviewedBy: existing.reviewed_by }, body.action, a.userId, a.role);
            state = next.reviewState;
            submitted = next.submittedBy ?? submitted;
            reviewed = next.reviewedBy ?? reviewed;
            approved = next.approvedBy ?? approved;
        }
        const resultData: any = { ...completion };
        let nextId: string | null = null, nextTask: any = null;
        if (state === 'approved') {
            if (program?.state === 'superseded') {
                const ref = String(body.continuationReference || t.programTransitionReference || '').trim();
                if (body.acknowledgeSuperseded !== true || !ref || ref.length > 300)
                    throw Error('راجع استمرار تطبيق الإصدار السابق وأدخل مرجع القرار قبل الاعتماد');
                resultData.continuationReference = ref;
                resultData.continuedSupersededProgram = true;
            }
            const nextOccurrenceResult = t.schedule?nextOccurrence(t, completion):null, nextLimits = nextOccurrenceResult?.limits;
            if (nextLimits) {
                nextId = crypto.randomUUID();
                nextTask = { ...t, workCardId:null, ...nextLimits, status: 'open', reviewState: 'approved', modifiedBy: a.userId, approvedBy: a.userId, reviewedBy: reviewed, _revision: crypto.randomUUID(), schedule: { ...nextOccurrenceResult!.schedule, previousTaskId: task.id, generatedFromCompletion: existing.id, generatedAt: now } };
                delete nextTask.taskApproval;nextTask.planningApprovalOrigin={type:'approved_completion',id:existing.id,previousTaskId:task.id};
                delete nextTask.completionId;
                delete nextTask.nextTaskId;
                delete nextTask.authorizedVariation;
            }
            resultData.nextCalculation = nextOccurrenceResult?.schedule.calculation || null;
            resultData.scheduleSnapshot = t.schedule||null;
            resultData.variationSnapshot = t.authorizedVariation || null;
            resultData.nextTaskId = nextId;
            resultData.taskSnapshot = { name: t.name, aircraftId: t.aircraftId, programSnapshot: t.programSnapshot||null, due: { hours: t.hours, cycles: t.cycles, date: t.date }, sequence: t.schedule?.sequence||null };
            nextData = { ...t, status: 'closed', completionId: existing.id, nextTaskId: nextId, _revision: token, closedBy: a.userId, closedAt: now };
        }
        const programGuard=program?' AND EXISTS(SELECT 1 FROM program_revisions WHERE id=? AND etag=?)':'',programArgs=program?[program.id,program.etag]:[];
        const statements = [db.prepare('UPDATE accomplishments SET state=?,data=?,submitted_by=?,reviewed_by=?,approved_by=?,etag=?,updated=? WHERE id=? AND workspace_id=? AND etag=? AND EXISTS(SELECT 1 FROM records WHERE id=? AND owner=? AND data=?) AND EXISTS(SELECT 1 FROM records WHERE id=? AND data=?)'+programGuard).bind(state, JSON.stringify(resultData), submitted, reviewed, approved, token, now, existing.id, a.scope, existing.etag, task.id, a.scope, task.data, plane.id, plane.data,...programArgs)];
        statements.push(...policyWrites(db, a, pendingPolicy, existing.id, token), touch(existing.id));
        if (state === 'approved') {
            statements.push(db.prepare('UPDATE records SET data=?,updated=? WHERE id=? AND owner=? AND data=? AND EXISTS(SELECT 1 FROM accomplishments WHERE id=? AND etag=?)').bind(JSON.stringify(nextData), now, task.id, a.scope, task.data, existing.id, token));
            if (nextTask)
                statements.push(db.prepare("INSERT INTO records(id,owner,kind,data,updated) SELECT ?,?,'task',?,? WHERE EXISTS(SELECT 1 FROM accomplishments WHERE id=? AND etag=?)").bind(nextId, a.scope, JSON.stringify(nextTask), now, existing.id, token));
        }
        statements.push(audit('تنفيذ / ' + body.action, 'accomplishments', existing.id));
        const result = await db.batch(statements);
        if (!result[0].meta.changes)
            throw new AccessError('تغيرت البيانات أثناء الاعتماد أو المراجعة', 409);
        return Response.json({ ok: true, nextTaskId: nextId });
    }
    catch (e) {
        return failure(e);
    }
    finally {
        await releaseWrite(lease);
    }
}
