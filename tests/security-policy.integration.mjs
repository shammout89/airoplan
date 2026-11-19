import {fixture} from './controlled-fixture.mjs';const f=await fixture();const {db,bucket,scope,planeId,evidence,api,call,row,approve,eq,newTask}=f;
try{
 const draftTask=await newTask('SYN ACCESS BASELINE');const base={userId:'planner',permissions:['read'],validUntil:'',reference:'SYN READ ONLY',reason:'SYN LIMITED DUTY SCOPE',evidenceVersionIds:[evidence]};
 await call('planner','control',{action:'save',kind:'access_grant',data:base},403);await call('admin','control',{action:'save',kind:'access_grant',data:{...base,permissions:['read','manage_members']}},400);
 const grant=await call('admin','control',{action:'save',kind:'access_grant',data:base});await approve('control',grant.id,{preparer:'admin'});
 await call('planner','data',{kind:'task',data:{name:'SYN DENIED',aircraftId:planeId,reference:'DENIED',hours:1200,cycles:'',date:'',status:'open'}},403);
 await call('planner','planning',{action:'save',kind:'profile',data:{aircraftId:planeId,mode:'manual',hoursPerDay:1,cyclesPerDay:1,windowDays:30,reference:'DENIED'}},403);
 await call('planner','control',{action:'save',kind:'work_template',data:{}},403);await call('planner','workflow',{action:'submit',id:draftTask},403);await call('planner','controls');
 const expanded=await call('admin','control',{action:'save',kind:'access_grant',data:{...base,reference:'SYN LIMITED EDIT',permissions:['read','edit_task','submit']}});await approve('control',expanded.id,{preparer:'admin'});eq((await row(grant.id)).state,'superseded');
 await call('planner','data',{kind:'task',data:{name:'SYN ALLOWED',aircraftId:planeId,reference:'SYN ALLOWED',hours:1200,cycles:'',date:'',status:'open'}});
 const created=(await db.prepare("SELECT id FROM records WHERE json_extract(data,'$.reference')='SYN ALLOWED'").first()).id;await call('planner','workflow',{action:'submit',id:created});await call('planner','execute',{action:'save',taskId:created,data:{}},403);
 const expired=await call('admin','control',{action:'save',kind:'access_grant',data:{...base,reference:'SYN EXPIRED PRIVILEGES',permissions:['read','edit_task','submit'],validUntil:'2026-01-01'}});await approve('control',expired.id,{preparer:'admin'});await call('planner','data',{kind:'task',data:{name:'EXPIRED',aircraftId:planeId,reference:'EXPIRED',hours:1200,cycles:'',date:'',status:'open'}},403);
 const backup=await api.captureBackup(db,bucket,scope,'SYNTHETIC SECURITY');eq(backup.manifest.relationshipChecks,'passed');console.log(`${f.checks} access policy checks passed: independent approval, immediate permission narrowing, role ceiling, read access, controlled revision and automatic read-only expiry.`);
}finally{await f.cleanup()}
