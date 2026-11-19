export function viewExport(records:any[],context:{view:string,page:number,query:string,status:string,totalTasks:number,matchingTasks:number},exportedAt=new Date().toISOString()){
 const snapshot=structuredClone(records),counts={aircraft:0,task:0,field:0};
 for(const row of snapshot)if(Object.hasOwn(counts,row.kind))counts[row.kind as keyof typeof counts]++;
 return {format:'AeroPlan-view-export-v1',exportedAt,completeWorkspaceExport:false,scope:'currently_loaded_records',context:{...context},counts,records:snapshot};
}
