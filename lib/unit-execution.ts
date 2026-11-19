const fields=['date','hours','cycles','reference','performedBy','notes','method','organisation','evidenceVersionIds','evidenceSnapshot','workCardId','workCardProof','compliance','exceptionReference'];
export function unitExecutionPayload(data:any){return Object.fromEntries(fields.filter(k=>data[k]!==undefined).map(k=>[k,data[k]]))}
export function effectiveUnitExecution(row:any){return row.data.effectiveExecution?.data||unitExecutionPayload(row.data)}
