import {createInterface} from 'node:readline/promises';
import {localRuntime} from './runtime.mjs';
import {LocalAuth} from './auth.mjs';
process.umask(0o077);
async function hidden(prompt){
 if(!process.stdin.isTTY)throw Error('شغّل الأمر في طرفية تفاعلية دون تمرير كلمة المرور في سطر الأوامر');
 return new Promise((resolve,reject)=>{
  let value='';
  const cleanup=()=>{process.stdin.off('data',onData);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n')};
  const onData=chars=>{for(const char of chars){
   if(char==='\u0003'){cleanup();reject(Error('أُلغي الإدخال'));return}
   if(char==='\r'||char==='\n'){cleanup();resolve(value);return}
   if(char==='\u007f'||char==='\b'){value=value.slice(0,-1);continue}
   if(char>=' '&&value.length<129)value+=char;
  }};
  // Disable terminal echo and attach the listener BEFORE displaying the prompt.
  process.stdin.setRawMode(true);process.stdin.setEncoding('utf8');process.stdin.on('data',onData);process.stdin.resume();process.stdout.write(prompt);
 });
}
const {db}=localRuntime(),auth=new LocalAuth(db),command=process.argv[2];
try{if(command==='init'){if(auth.owner())throw Error('المدير مهيأ مسبقًا');const rl=createInterface({input:process.stdin,output:process.stdout});const email=await rl.question('بريد المدير: '),name=await rl.question('اسم المدير: ');rl.close();const password=await hidden('كلمة المرور (12 حرفًا على الأقل، لن تظهر): '),confirm=await hidden('تأكيد كلمة المرور: ');if(password!==confirm)throw Error('كلمتا المرور غير متطابقتين');await auth.initializeOwner(email,name,password);console.log('تم إنشاء حساب المدير. شغّل docker compose up -d ثم افتح http://localhost:8080');}
else if(command==='reset-owner'){const password=await hidden('كلمة مرور جديدة للمدير: '),confirm=await hidden('تأكيد كلمة المرور: ');if(password!==confirm)throw Error('كلمتا المرور غير متطابقتين');await auth.recoverOwner(password);if(process.argv.includes('--reset-mfa'))auth.resetMFAFromConsole(auth.owner().id);console.log('تم تغيير كلمة مرور المدير وإبطال جلساته السابقة.');}
else throw Error('Usage: node selfhost/admin.mjs init | reset-owner [--reset-mfa]');}catch(e){console.error(e.message);process.exitCode=1}finally{db.close()}
