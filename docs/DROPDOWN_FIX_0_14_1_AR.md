# إصلاح سهم القوائم — AeroPlan 0.14.1

## التغيير

تعتمد حقول البحث في بطاقة الطائرة على مكوّن مشترك. كان إدخال النص يُرسم بحدّه الخاص، وتظهر حاوية زر السهم في سطر أسفله لأن تنسيق ترتيبها الأفقي لم يكن مطبقًا. أضيف تنسيق صريح محدود بهذا المكوّن: إطار خارجي واحد، صف أفقي لا يلتف، إدخال يتمدد ضمن المساحة المتبقية، ومجموعة أزرار لا تنكمش داخل الصندوق. يبقى السهم في الطرف الأيسر للواجهة العربية ومتمركزًا رأسيًا. تتسع المجموعة لزر مسح الاختيار أيضًا دون تداخل النص.

يسري التصحيح على حقول المصنع والعائلة والطراز والبلد والجهة الرقابية، وعلى القوائم التي تستخدم المكوّن نفسه في إعداد البيانات الأساسية. أصبح تعطيل الحقل يمر صراحة إلى الإدخال وأزراره. لا تغييرات على تعريفات القوائم أو علاقاتها أو الصلاحيات أو حسابات المستخدمين أو عدادات الطائرات أو مخطط قاعدة البيانات. بقيت إصدارات الاعتماديات كما هي.

## تحديث التثبيت الحالي

نزّل AeroPlan-Dropdown-Fix-0.14.1.zip إلى Downloads. هذه حزمة جزئية فوق 0.14.0؛ لا تشمل compose.yaml أو .env أو بيانات التشغيل أو مفاتيح المصادقة أو ملفات الخدمات المُولّدة. الحزمة الكاملة 0.14.1 تتضمن ميزات الإصدارات السابقة وإصلاح السهم.

الأوامر التالية مخصصة لمجلد المستخدم الحالي Downloads\AeroPlan-Docker ولمشروع Compose القائم aeroplan. شغّل Docker Desktop، والصق الكتلة كاملة ثم اضغط Enter. تستخدم أوامر مباشرة وتلتقط ملفات التشغيل الإضافية الموجودة، دون استدعاء سكربت PowerShell غير موقّع أو تغيير سياسة التنفيذ.

```powershell
& {
    $ErrorActionPreference = 'Stop'
    Set-Location "$env:USERPROFILE\Downloads\AeroPlan-Docker"
    $AeroZip = Get-ChildItem -LiteralPath "$env:USERPROFILE\Downloads" -Filter 'AeroPlan-Dropdown-Fix-0.14.1*.zip' -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($null -eq $AeroZip) { throw 'نزّل حزمة الإصلاح إلى Downloads أولًا.' }
    Expand-Archive -LiteralPath $AeroZip.FullName -DestinationPath . -Force
    $AeroRelease = Get-Content -LiteralPath '.\release.json' -Raw | ConvertFrom-Json
    if ($AeroRelease.version -ne '0.14.1') { throw 'لم تصل ملفات الإصدار 0.14.1 إلى المجلد الحالي.' }
    $AeroFiles = @('-f', 'compose.yaml')
    if (Test-Path '.\compose.production.yaml') { $AeroFiles = @('-f', 'compose.production.yaml') }
    foreach ($AeroExtra in @('compose.backup.yaml', 'compose.services.yaml')) { if (Test-Path $AeroExtra) { $AeroFiles += @('-f', $AeroExtra) } }
    docker compose -p aeroplan @AeroFiles up -d --build --force-recreate --wait
    if ($LASTEXITCODE -ne 0) { throw 'فشل البناء أو التشغيل؛ راجع رسالة Docker أعلاه.' }
    $AeroHealth = Invoke-RestMethod 'http://localhost:8080/healthz'
    $AeroHealth | Format-List status, version
    if ($AeroHealth.version -ne '0.14.1') { throw 'الخادم لم يشغّل الإصدار 0.14.1 بعد.' }
    Start-Process 'http://localhost:8080'
}
```

يجب أن يظهر status = ok وversion = 0.14.1. حدّث الصفحة بـ Ctrl+F5، وافتح «الطائرات ← إضافة طائرة». تحقق من أن السهم داخل الإطار نفسه، وفي منتصف ارتفاع الحقل، وأن الاختيار الطويل لا يتداخل معه. جرّب فتح القائمة والبحث والاختيار بالماوس ولوحة المفاتيح، ثم ضيّق النافذة وافحص القوائم الخمس. تظل مسودة التسجيل وحده متاحة، وتبقى القيم التاريخية محفوظة.

استعمل حسابك الحالي ووحدة البيانات القائمة، دون إعادة تهيئة المدير أو حذف مجلدات التشغيل. قد يبقى وسم الصورة في compose.yaml برقم أقدم لأنه محفوظ؛ يؤكد /healthz إصدار التطبيق المبني فعليًا.

## التحقق وحدوده

نجح TypeScript وبناء الإنتاج والمجموعات الـ32، ومنها 56 فحص عرض ساكن وحالة مكوّن، و99 فحص قوائم، و16 فحص حفاظ على تثبيت سابق، و164 فحص HTTP فعلي و57 فحص مصادقة. لا تثبت هذه النتائج موضع السهم بصريًا أو تفاعل الماوس ولوحة المفاتيح.

لم يستطع المتصفح البعيد الوصول إلى خادم الاختبار المحلي. مُنع فتح الملف المحلي أيضًا بسياسة المتصفح، فتوقف المسار دون التحايل على المنع. لذلك لم يُنفّذ اختبار بصري أو تفاعل بالمتصفح، ولم يُختبر نشر 0.14.1 على Windows/Docker هنا. تبقى هذه الفحوص مطلوبة على جهاز المستخدم. السجلات في docs/proof/dropdown-0.14.1-2026-11-16/.
