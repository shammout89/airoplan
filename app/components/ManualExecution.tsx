'use client';
import {useEffect,useId,useState} from 'react';
import {apiFetch} from '../client-fetch';
import {taskReviewLabel} from '../../lib/task-approval';
import {programToday} from '../../lib/program';

const labels:Record<string,string>={draft:'مسودة',submitted:'للمراجعة',reviewed:'للاعتماد',approved:'معتمد'};
export default function ManualExecution({task,aircraft,entries,permissions,onChanged,onClose}:any){
 const entry=entries.find((e:any)=>e.task_id===task.id),can=(p:string)=>permissions.includes(p);
 const formId=useId(),titleId=useId();
 const [form,setForm]=useState<any>({date:programToday(),hours:aircraft?.data.hours??'',cycles:aircraft?.data.cycles??'',reference:'',performedBy:'',method:'internal',organisation:'',evidenceVersionIds:[],notes:'',exceptionReference:''});
 const [evidence,setEvidence]=useState<any[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const [evidenceState,setEvidenceState]=useState<'loading'|'ready'|'error'>('loading');
 useEffect(()=>{if(entry)setForm(entry.data)},[entry?.etag]);
 useEffect(()=>{
  const previous=[document.documentElement,document.body].map(node=>({node,value:node.style.getPropertyValue('overflow'),priority:node.style.getPropertyPriority('overflow')}));
  for(const {node} of previous)node.style.setProperty('overflow','hidden','important');
  return()=>{for(const {node,value,priority} of previous){if(value)node.style.setProperty('overflow',value,priority);else node.style.removeProperty('overflow')}};
 },[]);
 useEffect(()=>{let live=true;apiFetch('/api/documents').then(async r=>{const j:any=await r.json();if(!r.ok)throw Error(j.error);if(live){setEvidence(j.versions.filter((v:any)=>v.published));setEvidenceState('ready')}}).catch(e=>{if(live){setError(e.message);setEvidenceState('error')}});return()=>{live=false}},[]);
 async function act(action:string){setBusy(true);setError('');setMessage('');try{const r=await apiFetch('/api/execution',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,taskId:task.id,etag:entry?.etag,data:form})});const j:any=await r.json();if(!r.ok)throw Error(j.error);await onChanged();setMessage(action==='approve'?'اعتمد الإنجاز وأغلقت المهمة مع حفظ الأدلة.':'حفظ الإجراء')}catch(e:any){setError(e.message)}finally{setBusy(false)}}
 const field=(key:string,label:string,type='text',required=true)=><label>{label}<input type={type} value={form[key]??''} required={required} min={type==='number'?0:undefined} step={key==='cycles'?1:'0.000001'} max={type==='date'?programToday():undefined} maxLength={key==='notes'?4000:500} onChange={e=>setForm({...form,[key]:e.target.value})}/></label>;
 const closed=task.data.status==='closed',canSave=!closed&&can('record_execution')&&(!entry||entry.state==='draft');
 return <div className="overlay manual-execution-overlay"><section className="modal executionmodal manual-execution-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-label="تنفيذ مهمة يدوية"><div className="sectionhead"><h2 id={titleId}>سجل إنجاز: {task.data.name}</h2><button type="button" className="secondary" disabled={busy} onClick={onClose}>إغلاق النافذة</button></div><div className="manual-execution-body">
 <p>المهمة اليدوية لا تولد تكرارًا تلقائيًا. الإغلاق يتطلب سجل إنجاز ومراجعة واعتمادًا مستقلين. اعتماد البيانات هنا لا يصدر تصريح إفراج للطائرة.</p>
 {task.data.status==='closed'?<section><h3>سجل مغلق</h3>{entry?<><p>{entry.data.date} · {entry.data.reference} · {entry.data.performedBy}</p><p>طريقة الإثبات: {entry.data.method==='external'?'شهادة خارجية':'سجل داخلي'}</p><p>{entry.data.evidenceSnapshot?.map((e:any)=>e.fileName+' / '+e.revision).join('، ')}</p></>:<p className="error">سجل تاريخي مغلق بلا إنجاز معتمد؛ يحتاج مطابقة وإجراء تصحيح موثق.</p>}</section>:<>
 <p>حالة الإنجاز: {entry?labels[entry.state]:'لم يسجل'} · حالة التخطيط: {taskReviewLabel(task.data)}</p>
 <form id={formId} onSubmit={e=>{e.preventDefault();act('save')}}><fieldset className="formfieldset" disabled={busy||!can('record_execution')||entry&&entry.state!=='draft'}><div className="formgrid">
 {field('date','تاريخ الإنجاز','date')}{field('hours','FH عند الإنجاز','number')}{field('cycles','FC عند الإنجاز','number')}{field('reference','مرجع أمر العمل / الشهادة')}{field('performedBy','منفذ العمل حسب السجل')}
 <label>طريقة الإثبات<select value={form.method||'internal'} onChange={e=>setForm({...form,method:e.target.value})}><option value="internal">سجل إنجاز داخلي</option><option value="external">شهادة مؤسسة صيانة خارجية</option></select></label>
 {field('organisation','مؤسسة الصيانة','text',form.method==='external')}{field('exceptionReference','مرجع معالجة تجاوز فعلي إن وجد','text',false)}{field('notes','ملاحظات','text',false)}
 </div><p>أدلة منشورة {form.method==='external'?'— مطلوبة للشهادة الخارجية':''}</p><div className="checklist">{evidence.map(v=><label key={v.id} className="check"><input type="checkbox" checked={(form.evidenceVersionIds||[]).includes(v.id)} onChange={e=>setForm({...form,evidenceVersionIds:e.target.checked?[...(form.evidenceVersionIds||[]),v.id]:(form.evidenceVersionIds||[]).filter((id:string)=>id!==v.id)})}/>{v.file_name} / {v.revision}</label>)}</div>
 {evidenceState==='loading'&&<p className="hint" role="status">جارٍ تحميل المستندات المنشورة…</p>}{evidenceState==='error'&&<p className="hint">تعذّر تحميل المستندات المنشورة.</p>}{evidenceState==='ready'&&!evidence.length&&<p className="hint">لا توجد مستندات منشورة متاحة للاختيار.</p>}</fieldset></form>
 </>}
 </div><div className="modalfoot manual-execution-footer">
 {error&&<p className="error manual-execution-feedback" role="alert">{error}</p>}{message&&<p className="manual-execution-feedback" role="status">{message}</p>}
 {canSave&&<button type="submit" form={formId} className="primary" disabled={busy}>حفظ مسودة الإنجاز</button>}
 {!closed&&entry&&<>{[['submit','draft','إرسال الإنجاز'],['review','submitted','مراجعة مستقلة'],['approve','reviewed','اعتماد الإنجاز وإغلاق المهمة']].filter(([p,s])=>can(p)&&entry.state===s).map(([action,,label])=><button type="button" key={action} className="primary" disabled={busy} onClick={()=>act(action)}>{label}</button>)}{can('record_execution')&&['submitted','reviewed'].includes(entry.state)&&<button type="button" className="secondary" disabled={busy} onClick={()=>act('return')}>إعادة للمسودة</button>}</>}
 <button type="button" className="secondary" disabled={busy} onClick={onClose}>إغلاق النافذة</button>
 </div></section></div>;
}
