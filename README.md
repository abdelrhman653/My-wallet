# محفظتي — Vercel + Oanor EGX

نسخة آمنة من موقع محفظة الـ12 سهم. الواجهة لا تحتوي على مفتاح Oanor؛ الاتصال يتم من خلال Vercel Function في `api/egx.js`.

## قبل النشر

1. **ألغِ المفتاح القديم الذي تم نشره في المحادثة** وأنشئ مفتاح Oanor جديدًا.
2. ارفع هذا المجلد إلى GitHub، أو استورده مباشرة في Vercel.
3. في Vercel افتح: **Project → Settings → Environment Variables**.
4. أضف:
   - Name: `OANOR_API_KEY`
   - Value: مفتاح Oanor الجديد
   - Environment: Production (وPreview/Development لو محتاجها)
5. اعمل **Redeploy** بعد حفظ المتغير.
6. افتح الموقع واضغط **🔗 ربط الأسعار الحقيقية → اختبار + تحديث** أو زر تحديث الأسعار.

## الاختبار

بعد النشر افتح:

`/api/egx?symbols=COMI,TMGH,SWDY,FWRY`

المفروض يرجع JSON فيه `ok: true` و `quotes`.

## ملاحظات

- المفتاح لا يُرسل من المتصفح إلى Oanor.
- لا يوجد `localStorage` لمفتاح Oanor في الواجهة.
- الموقع يحتفظ فقط بآخر أسعار جلبها محليًا كـcache للعرض عند فتحه لاحقًا.
- endpoint يحاول أولًا جلب الأسهم في طلب batch، ثم يستخدم fallback سهمًا بسهم إذا لم تُقبل صيغة batch.
- لا تضع `OANOR_API_KEY` داخل HTML أو JavaScript أو متغير يبدأ بـ `NEXT_PUBLIC_`.
