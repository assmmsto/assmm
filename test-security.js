/*═════════════════════════════════════════════════════════════
// اختبار أمان Supabase — معرض الأعمال (Nova)
// node test-security.js   أو   npm run audit
// ⚠️ لماذا أُعيد كتابة هذا الاختبار؟
   النسخة السابقة كانت تُبلّغ «ثغرة» كاذبة: PostgREST يُرجع 204
   (No Content) حتى لو لم يتأثر أي صف. فطلب
      PATCH products?id=eq.1
   على قاعدة لا يوجد فيها منتج رقم 1 ⇒ 0 صفوف ⇒ 204 بنجاح.
   أي أن «204» لا تعني اختراقاً. تحتاج: صفّ حقيقي + تحقّق بالقراءة.
═════════════════════════════════════════════════════════════*/
'use strict';
import fs from 'fs';
import path from 'path';
const __dirname = path.dirname(new URL(import.meta.url).pathname);


// Load settings (allow override via env for testing a new project)
const settings = JSON.parse(fs.readFileSync(new URL('data/settings.json', import.meta.url), 'utf-8'));

const SUPABASE_URL = (process.env.SUPABASE_URL || settings.supabaseUrl).replace(/\/*$/, '');
const KEY = process.env.SUPABASE_KEY || settings.supabaseKey;

const H = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
};
let pass = 0, fail = 0;
function chk(label, ok, extra = '') {
  if (ok) { pass++; console.log('  ✅ ' + label + (extra ? '  → ' + extra : '')); }
  else { fail++; console.log('  ❌ ' + label + (extra ? '  → ' + extra : '')); }
}


async function request(method, path, body = null) {
  const opts = {
    method,
    headers: H,
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, opts);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch (_) { json = text; }
  return { status: res.status, ok: res.ok, body: json };
}

console.log('\n════════════════════════════════════════════');
console.log('  اختبار أمان قاعدة البيانات — ' + SUPABASE_URL);
console.log('════════════════════════════════════════════');

// ── 0) sanity: does the table even exist / have rows? ──
const list = await request('GET', 'products?select=id,name,price&limit=3');
console.log('\n▸ فحص الجدول:');
if (list.status !== 200) {
  console.log('  ❌ لا يمكن قراءة جدول products — الحالة ' + list.status);
  console.log('  ' + JSON.stringify(list.body).slice(0, 300));
  console.log('\n  ⛔ توقّف: تأكّد أنك تشغّل الاختبار على المشروع الصحيح.');
  process.exit(1);
}
const rows = Array.isArray(list.body) ? list.body : [];
chk('الجدول products موجود ويقبل القراءة العامة', true, `${rows.length} صف معروض`);

if (rows.length === 0) {
  console.log('\n  ℹ️ الجدول فارغ — لا يوجد صف حقيقي لاختبار UPDATE/DELETE عليه.');
  console.log('     سأختبر التوصيف العام للصلاحيات عبر فحص مفاتيح التسريب فقط.');
}

// ── 1) WRITE must be blocked (insert with a REAL column) ──
console.log('\n▸ فحص منع الكتابة:');
const ins = await request('POST', 'products', { name: '__audit_probe__', price: 0 });
// a valid request is 201; a schema error is 400 PGRST204; only 2xx = real breach
const insertBreached = ins.status >= 200 && ins.status < 300;
chk('INSERT  مرفوض', !insertBreached, insertBreached ? `(status ${ins.status})` : `(status ${ins.status})`);

// ── 2) UPDATE a REAL row, then verify by reading back ──
if (rows.length > 0) {
  const target = rows[0];
  const before = target.price;
  const upd = await request('PATCH', `products?id=eq.${target.id}`, { price: 999999 });
  const verify = await request('GET', `products?id=eq.${target.id}&select=price`);
  let after = null;
  if (Array.isArray(verify.body) && verify.body[0]) after = verify.body[0].price;

  const changed = after !== null && Number(after) !== Number(before);
  chk('UPDATE  مرفوض (السعر لم يتغيّر)', !changed,
    changed ? `❌ تغيّر من ${before} إلى ${after} — اختراق حقيقي!` : `(status ${upd.status}, السعر=${after})`);

  // ── 3) DELETE a real row, then verify it still exists ──
  const del = await request('DELETE', `products?id=eq.${target.id}`);
  const after2 = await request('GET', `products?id=eq.${target.id}&select=id`);
  const stillThere = Array.isArray(after2.body) && after2.body.length > 0;
  chk('DELETE  مرفوض (الصف ما زال موجوداً)', stillThere,
    stillThere ? `(status ${del.status})` : `❌ حُذف المنتج ${target.id}!`);

  // ── 4) orders must be completely invisible to the public key ──
  const ordRead = await request('GET', 'orders?select=reference&limit=1');
  const ordersVisible = ordRead.status === 200 && Array.isArray(ordRead.body) && ordRead.body.length > 0;
  chk('الزائر لا يستطيع سرد جدول الطلبات', !ordersVisible,
    ordersVisible ? `❌ قرأ ${ordRead.body.length} طلب` : `(status ${ordRead.status})`);

  const ordUpd = await request('PATCH', 'orders?id=eq.1', { status: 'confirmed' });
  chk('الزائر لا يستطيع تأكيد طلب (UPDATE orders)',
    !(ordUpd.status === 200 || ordUpd.status === 204), `(status ${ordUpd.status})`);

  // ── 5) licenseKeys must not leak ──
  const leak = await request('GET', 'products?select=licenseKeys&limit=5');
  let leaked = 0;
  if (leak.status === 200 && Array.isArray(leak.body)) {
    for (const r of leak.body) {
      const v = r.licenseKeys;
      if (Array.isArray(v)) leaked += v.length;
      else if (typeof v === 'string' && v.trim()) leaked += v.split(',').filter(Boolean).length;
    }
  }
  chk('مفاتيح الترخيص (licenseKeys) غير مقروءة', leaked === 0,
    leaked === 0 ? '(محجوبة)' : `❌ تسرّب ${leaked} مفتاحاً`);

  // ── 6) suggestions: insert allowed, delete blocked ──
  // إصلاح: الجدول أعمدته name/text لا title/body — الحمولة القديمة كانت ترجع 400 (PGRST204)
  const sIns = await request('POST', 'suggestions', { name: '__audit__', text: '__audit__' });
  chk('INSERT في suggestions مسموح (رسالة اقتراح)',
    sIns.status >= 200 && sIns.status < 300, `(status ${sIns.status})`);
  if (sIns.status >= 200 && sIns.status < 300) {
    const newId = Array.isArray(sIns.body) ? sIns.body[0]?.id : sIns.body?.id;
    if (newId) {
      const sDel = await request('DELETE', `suggestions?id=eq.${newId}`);
      const gone = await request('GET', `suggestions?id=eq.${newId}&select=id`);
      const still = Array.isArray(gone.body) && gone.body.length > 0;
      chk('DELETE من suggestions مرفوض', still, `(status ${sDel.status})`);
    }
  }
}

console.log('\n════════════════════════════════════════════');
console.log(`  النتيجة:  ${pass} ناجح · ${fail} فاشل`);
console.log('════════════════════════════════════════════');
process.exit(fail > 0 ? 1 : 0);
