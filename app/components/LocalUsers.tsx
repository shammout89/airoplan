'use client';
import {useEffect,useRef,useState} from 'react';
import {apiFetch} from '../client-fetch';
import {roleLabels} from '../../lib/permissions';
import Registers from './Registers';
import RoleMatrix from './RoleMatrix';

const emptyForm=()=>({id:'',accountId:'',pendingId:'',name:'',email:'',role:'viewer',state:'active',password:'',confirm:'',invitation:false});
export default function LocalUsers({permissions,isOwner,onChanged}:{permissions:string[],isOwner:boolean,onChanged:()=>void}){
 const [users,setUsers]=useState<any[]>([]),[owner,setOwner]=useState(''),[form,setForm]=useState(emptyForm),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[activation,setActivation]=useState(''),[reset,setReset]=useState<any>(null);
 const pending=useRef(false),panel=useRef<HTMLElement>(null),editing=!!form.accountId;
 async function load(){const response=await apiFetch('/api/team'),data:any=await response.json();if(!response.ok)throw Error(data.error);setUsers(data.members);setOwner(data.ownerUserId)}
 async function reload(){setLoading(true);setError('');try{await load()}catch(e:any){setError(e.message)}finally{setLoading(false)}}
 useEffect(()=>{reload()},[]);
 function begin(user:any){setError('');setMessage('');setActivation('');setReset(null);setForm({...emptyForm(),id:user.id||'',accountId:user.accountId||'',pendingId:user.accountId?'':user.id,name:user.name===user.email?'':user.name,email:user.email,role:user.role,state:user.state});panel.current?.scrollIntoView?.({block:'start',behavior:'smooth'})}
 async function submit(e:any){
  e.preventDefault();if(pending.current)return;
  setError('');setMessage('');setActivation('');
  if(!editing&&!form.invitation&&form.password!==form.confirm){setError('كلمتا المرور غير متطابقتين');return}
  pending.current=true;setBusy(true);
  try{
   const body=editing?{action:'update',id:form.id||undefined,accountId:form.accountId,role:form.role,state:form.state}:{action:form.invitation?'invite':'create',name:form.name,email:form.email,role:form.role,state:form.state,...(!form.invitation?{password:form.password,confirm:form.confirm}:{})};
   const response=await apiFetch('/api/team',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),data:any=await response.json();if(!response.ok)throw Error(data.error);
   setForm(emptyForm());setMessage(data.message);setActivation(data.activationURL||'');
   try{await load()}catch{setError('تم الحفظ، لكن تعذر تحديث القائمة. اضغط تحديث المستخدمين.')}
   onChanged();
  }catch(e:any){setError(e.message);setForm(old=>({...old,password:'',confirm:''}))}finally{pending.current=false;setBusy(false)}
 }
 async function resetPassword(){
  if(!reset||pending.current)return;pending.current=true;setBusy(true);setError('');setMessage('');setActivation('');
  try{const response=await apiFetch('/api/team',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'reset',accountId:reset.accountId})}),data:any=await response.json();if(!response.ok)throw Error(data.error);setReset(null);setMessage(data.message);setActivation(data.activationURL);try{await load()}catch{setError('تم إصدار الرابط، لكن تعذر تحديث القائمة. اضغط تحديث المستخدمين.')}onChanged()}catch(e:any){setError(e.message)}finally{pending.current=false;setBusy(false)}
 }
 return <div className="users-management">
  <div className="configintro"><div><h2>المستخدمون والصلاحيات</h2><p>أنشئ حساب المستخدم وحدّد دوره وحالته، ثم أدر صلاحياته من هذه الصفحة.</p></div><button className="secondary" disabled={busy||loading} onClick={reload}>تحديث المستخدمين</button></div>
  {error&&<div className="error" role="alert">{error}</div>}
  {message&&<div className="notice" role="status">{message}</div>}
  {activation&&<section className="panel users-activation" aria-label="رابط تفعيل المستخدم"><div className="padded"><p>شارك الرابط مع صاحب الحساب بقناة موثوقة. صالح لمرة واحدة خلال ٢٤ ساعة.</p><a dir="ltr" href={activation}>{activation}</a><p>يختار المستخدم كلمة المرور من الرابط.</p></div></section>}
  {(isOwner||editing)?<section className="panel" ref={panel} aria-label="بيانات المستخدم"><div className="sectionhead"><h2>{editing?'تعديل المستخدم':form.pendingId?'استكمال حساب المستخدم':'إنشاء مستخدم'}</h2></div>
   <form onSubmit={submit} onInvalidCapture={()=>setError('تحقق من الحقول المطلوبة. كلمة المرور من ١٢ إلى ١٢٨ حرفًا.')}>
    <fieldset disabled={busy||loading} className="users-fields"><div className="formgrid">
     <label>الاسم<input name="name" required={!editing} maxLength={100} value={form.name} readOnly={editing} onChange={e=>setForm({...form,name:e.target.value})}/></label>
     <label>البريد الإلكتروني<input name="email" required type="email" maxLength={200} autoComplete="username" dir="ltr" value={form.email} readOnly={editing||!!form.pendingId} onChange={e=>setForm({...form,email:e.target.value})}/></label>
     <label>الدور<select name="role" value={form.role} onChange={e=>setForm({...form,role:e.target.value})}>{Object.entries(roleLabels).map(([key,label])=><option value={key} key={key}>{label}</option>)}</select></label>
     <label>حالة المستخدم<select name="state" value={form.state} onChange={e=>setForm({...form,state:e.target.value})}><option value="active">مفعّل</option><option value="disabled">معطّل — منع الدخول</option></select></label>
     {!editing&&!form.invitation&&<><label>كلمة المرور<input name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})}/></label><label>تأكيد كلمة المرور<input name="confirm" type="password" required minLength={12} maxLength={128} autoComplete="new-password" value={form.confirm} onChange={e=>setForm({...form,confirm:e.target.value})}/></label></>}
    </div>
    {!editing&&<details className="padded"><summary>خيارات تفعيل الحساب</summary><label className="users-invite-choice"><input type="checkbox" checked={form.invitation} onChange={e=>setForm({...form,invitation:e.target.checked,password:'',confirm:''})}/>يختار المستخدم كلمة مروره من رابط تفعيل</label><p className="hint">يُنشأ الحساب وعضويته معًا. عند اختيار الرابط لن يستطيع المستخدم الدخول حتى يختار كلمة المرور.</p></details>}
    <div className="modalfoot"><button className="primary" type="submit">{busy?'جارٍ الحفظ…':editing?'حفظ التغييرات':form.pendingId?'استكمال الحساب':'إنشاء المستخدم'}</button>{(editing||form.pendingId)&&<button type="button" className="secondary" onClick={()=>setForm(emptyForm())}>إلغاء التعديل</button>}</div>
    </fieldset>
   </form>
  </section>:<p className="notice">إنشاء الحسابات وإعادة ضبط كلمات المرور متاحان لمالك مساحة العمل. يمكنك تعديل الأدوار وحالة المستخدمين وفق صلاحياتك.</p>}
  {reset&&<section className="panel" aria-label="تأكيد إعادة ضبط كلمة المرور"><div className="padded"><h3>إعادة ضبط كلمة مرور {reset.email}</h3><p>سيُصدر رابط جديد ويُوقف استخدام كلمة المرور والجلسات الحالية لهذا المستخدم.</p><div className="opactions"><button className="primary" disabled={busy} onClick={resetPassword}>تأكيد إعادة الضبط</button><button className="secondary" disabled={busy} onClick={()=>setReset(null)}>إلغاء إعادة الضبط</button></div></div></section>}
  <section className="panel teamlist"><div className="sectionhead"><h2>قائمة المستخدمين</h2><span>{users.length} مستخدمين</span></div>{loading?<p className="empty">جارٍ تحميل المستخدمين…</p>:<div className="tablewrap"><table><thead><tr><th>المستخدم</th><th>الدور</th><th>الحالة</th><th>حساب الدخول</th><th>الإجراءات</th></tr></thead><tbody>{users.map(user=><tr key={user.accountId||user.id}>
   <td><strong>{user.name}</strong><br/><span dir="ltr">{user.email}</span></td><td>{roleLabels[user.role]}</td><td>{user.id?(user.state==='active'&&user.enabled!==0?'مفعّل':'معطّل'):'دون عضوية'}</td><td>{user.accountId?(user.enrolled?'جاهز للدخول':'بانتظار تعيين كلمة المرور'):user.userId?'ارتباط يحتاج مراجعة':'يحتاج استكمال الحساب'}</td><td><div className="users-row-actions">
    {user.accountId===owner?<span className="badge">المالك — محمي</span>:user.accountId?<button className="link" disabled={busy} onClick={()=>begin(user)}>تعديل الدور / الحالة</button>:!user.userId&&isOwner?<button className="link" disabled={busy} onClick={()=>begin(user)}>استكمال الحساب</button>:<span className="hint">{user.userId?'تعذر مطابقة هوية حساب الدخول':'يستكمل المالك إنشاء الحساب'}</span>}
    {isOwner&&user.accountId&&user.accountId!==owner&&<button className="link" disabled={busy} onClick={()=>{setReset(user);setActivation('');setMessage('');setError('')}}>إعادة ضبط كلمة المرور</button>}
   </div></td>
  </tr>)}</tbody></table>{!users.length&&<p className="empty">لا يوجد مستخدمون.</p>}</div>}</section>
  <Registers title="تفويضات الصلاحيات وعقود مصادر البيانات" kinds={['access_grant','integration_contract','integration_acceptance']} permissions={permissions} onChanged={onChanged}/>
  <RoleMatrix/>
 </div>;
}
