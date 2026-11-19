import qrcode from './vendor/qrcode-generator.mjs';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function enrollmentQR(uri){
  if(typeof uri!=='string'||uri.length>2400||!/^otpauth:\/\/totp\//.test(uri)||!/^[\x21-\x7e]+$/.test(uri))throw Error('رابط إعداد المصادقة غير صالح');
  const url=new URL(uri);
  if(!/^[A-Z2-7]{32}$/.test(url.searchParams.get('secret')||'')||url.searchParams.get('algorithm')!=='SHA1'||url.searchParams.get('digits')!=='6'||url.searchParams.get('period')!=='30')throw Error('إعداد رمز المصادقة غير صالح');
  const code=qrcode(0,'M');
  code.addData(uri,'Byte');
  code.make();
  return code.createSvgTag({cellSize:4,margin:16,scalable:true})
    .replace('<svg ','<svg class="mfa-qr" role="img" aria-label="رمز QR لربط تطبيق المصادقة" shape-rendering="crispEdges" ');
}

export function confirmEnrollmentForm(){
  return '<form method="post" action="/auth/mfa/enable"><label>الرمز المكوّن من ستة أرقام من التطبيق<input name="otp" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="80" dir="ltr" required autofocus></label><button type="submit">تأكيد الربط وإصدار رموز الاسترداد</button></form>';
}

export function enrollmentMarkup(setup){
  if(new URL(setup.uri).searchParams.get('secret')!==setup.secret)throw Error('مفتاح الربط لا يطابق رمز QR');
  return `<p>افتح تطبيق المصادقة على هاتفك، واختر إضافة حساب ثم مسح رمز QR. بعد المسح، أدخل رمز الحساب من التطبيق لتأكيد الربط.</p><figure class="mfa-scan">${enrollmentQR(setup.uri)}<figcaption>امسح الرمز من تطبيق المصادقة على هاتفك</figcaption></figure><p class="muted">طلب الربط صالح لعشر دقائق من بدئه. رمز QR والمفتاح خاصان بحسابك؛ احتفظ بهما لنفسك.</p><details class="mfa-manual"><summary>الإدخال اليدوي بدل المسح</summary><p>إذا تعذر المسح، أضف حسابًا يدويًا واختر رمزًا يعتمد على الوقت (TOTP)، ثم أدخل هذا المفتاح:</p><p dir="ltr"><strong>${escape(setup.secret)}</strong></p><a class="link" href="${escape(setup.uri)}">فتح رابط الإعداد في تطبيق المصادقة</a></details>${confirmEnrollmentForm()}`;
}
