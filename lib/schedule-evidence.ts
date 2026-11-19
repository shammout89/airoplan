import {newDependencies,publishedEvidence} from './domain';
export async function pinScheduleEvidence(db:any,bucket:any,scope:string,program:any,checkExisting=false){
 const c={versions:(await db.prepare('SELECT * FROM document_versions WHERE workspace_id=?').bind(scope).all()).results};const dep=newDependencies();
 for(const task of program.tasks){if(!task.schedulePolicy)continue;const snapshots=await publishedEvidence(c,task.schedulePolicy.evidenceVersionIds,dep,bucket,true,true);if(checkExisting&&JSON.stringify(task.scheduleEvidence)!==JSON.stringify(snapshots))throw Error('تغير دليل سياسة الاستحقاق؛ أعد البرنامج للمسودة وأعد حفظه ومراجعته');task.scheduleEvidence=snapshots}
 return program;
}
