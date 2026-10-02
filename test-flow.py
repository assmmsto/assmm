#!/usr/bin/env python3
# ═══════════════════════════════════════════════════════════════════════════
#  اختبار صارم للتدفق الكامل — معرض الأعمال (Nova)
#  يختبر السيناريو الحقيقي من طرف العميل وطرف الأدمن، ويتحقق من البيانات
#  الفعلية (لا يكتفي برمز HTTP). ينظّف كل أثره بعد الانتهاء.
#
#  التشغيل:  python test-flow.py
#  كود الخروج: 0 = كل الاختبارات نجحت · 1 = يوجد فشل
# ═══════════════════════════════════════════════════════════════════════════
import json, urllib.request, urllib.error, urllib.parse, sys, time
sys.stdout.reconfigure(encoding='utf-8')

URL = "https://qcarxyaxcfgasqkppkjb.supabase.co/rest/v1"
KEY = "sb_publishable_3di31UtXQVsvZ14AZjfHpA_4o_0azWQ"
HDR = {'apikey': KEY, 'Authorization': 'Bearer ' + KEY,
       'Content-Type': 'application/json; charset=utf-8'}

results = []
def check(name, ok, detail=''):
    results.append((name, ok, detail))
    print(f"   {'✅' if ok else '❌'} {name}" + (f"\n        ↳ {detail}" if detail else ''))

def req(method, path, data=None, prefer=None):
    body = json.dumps(data, ensure_ascii=False).encode('utf-8') if data is not None else None
    h = dict(HDR)
    if prefer: h['Prefer'] = prefer
    r = urllib.request.Request(f"{URL}/{path}", data=body, method=method, headers=h)
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            raw = resp.read().decode('utf-8', 'ignore')
            return resp.status, (json.loads(raw) if raw.strip() else None)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', 'ignore')[:300]

print("\n" + "═" * 60)
print("  اختبار صارم للتدفق الكامل — معرض الأعمال")
print("═" * 60)

# ═══════════════════════════════════════════════════
# ١) البنية التحتية
# ═══════════════════════════════════════════════════
print("\n[١] البنية التحتية والجداول")
for t in ('products', 'orders', 'suggestions'):
    st, d = req('GET', f"{t}?select=id&limit=1")
    check(f'الجدول {t} accessible', st == 200, f'HTTP {st}' if st != 200 else '')

# ═══════════════════════════════════════════════════
# ٢) المنتجات
# ═══════════════════════════════════════════════════
print("\n[٢] المنتجات")
st, products = req('GET', 'products?select=*&order=id')
ok = st == 200 and isinstance(products, list) and len(products) > 0
check('قراءة المنتجات', ok, f'{len(products) if isinstance(products, list) else 0} منتجاً')

p0 = products[0] if ok else {}
missing = [k for k in ('id', 'name', 'slug', 'price', 'type', 'status') if k not in p0]
check('الحقول الأساسية مكتملة', not missing, f'ناقص: {missing}' if missing else 'id/name/slug/price/type/status')

paid = [p for p in products if (p.get('price') or 0) > 0]
check('منتجات مدفوعة موجودة', len(paid) > 0, f'{len(paid)} مدفوعة · {len(products) - len(paid)} مجانية')

lic = [p for p in products if p.get('licenseMode') == 'key' and (p.get('licenseKeys') or [])]
check('منتج بمفاتيح ترخيص جاهز', len(lic) > 0, f'{len(lic)} منتجاً بمفاتيح')

# ═══════════════════════════════════════════════════
# ٣) العميل ينشئ طلباً
# ═══════════════════════════════════════════════════
print("\n[٣] العميل — إنشاء طلب شراء")
ref = 'FLOW-' + str(int(time.time()))
target = lic[0] if lic else (paid[0] if paid else products[0])
total = target.get('price', 0)
order = {
    'reference': ref, 'productId': target['id'], 'productName': target['name'],
    'price': total, 'currency': target.get('currency', 'USD'),
    'discountCode': '', 'total': total,
    'methodKey': 'flowtest', 'methodLabel': 'اختبار صارم',
    'payerName': 'عميل تجريبي', 'payerRef': 'TX-FLOW-001',
    'status': 'pending', 'licenseKey': None,
}
st, _ = req('POST', 'orders', [order], prefer='return=minimal')
check('إنشاء الطلب', st in (200, 201), f'HTTP {st} · المرجع {ref}')

st, rows = req('GET', f"orders?reference=eq.{ref}&select=*")
found = st == 200 and isinstance(rows, list) and len(rows) == 1
check('الطلب محفوظ ويمكن قراءته', found, f'HTTP {st}')
if found:
    o = rows[0]
    check('حالة الطلب = pending', o.get('status') == 'pending', f"status={o.get('status')}")
    check('بيانات المشتري محفوظة', o.get('payerName') == 'عميل تجريبي', f"payerName={o.get('payerName')}")

# ═══════════════════════════════════════════════════
# ٤) الأدمن يرى الطلب  ← النقطة الحرجة
# ═══════════════════════════════════════════════════
print("\n[٤] الأدمن — هل يظهر الطلب؟ (النقطة الحرجة)")
st, all_orders = req('GET', 'orders?select=*&order=id.desc')
ok = st == 200 and isinstance(all_orders, list)
check('الأدمن يقرأ قائمة الطلبات', ok, f'{len(all_orders) if ok else 0} طلباً في القاعدة')

in_list = ok and any(o.get('reference') == ref for o in all_orders)
check('✅ الطلب يظهر للأدمن', in_list,
      'المرجع موجود في القائمة' if in_list else '❌ الطلب غير موجود في قائمة الأدمن!')

st, pend = req('GET', 'orders?status=eq.pending&select=reference')
in_pending = isinstance(pend, list) and any(o.get('reference') == ref for o in pend)
check('الطلب يظهر ضمن «المعلّقة»', in_pending,
      f'{len(pend) if isinstance(pend, list) else 0} طلباً معلقاً')

# ═══════════════════════════════════════════════════
# ٥) الأدمن يؤكد ويسحب مفتاحاً
# ═══════════════════════════════════════════════════
print("\n[٥] الأدمن — التأكيد وسحب مفتاح الترخيص")
new_key = None
if found:
    oid = rows[0]['id']
    if lic:
        lp = lic[0]
        keys = lp.get('licenseKeys') or []
        used = lp.get('usedKeys') or []
        avail = [k for k in keys if k not in used]
        check('مفاتيح متاحة في المخزون', len(avail) > 0, f'{len(avail)} من {len(keys)}')
        if avail:
            new_key = avail[0]
            st, _ = req('PATCH', f'orders?id=eq.{oid}', {
                'status': 'confirmed', 'licenseKey': new_key,
                'confirmedAt': time.strftime('%Y-%m-%dT%H:%M:00Z', time.gmtime()),
            }, prefer='return=minimal')
            check('تأكيد الطلب وتعيين المفتاح', st in (200, 204), f'HTTP {st} · {new_key}')

            st, _ = req('PATCH', f"products?id=eq.{lp['id']}",
                        {'usedKeys': used + [new_key]}, prefer='return=minimal')
            check('تحديث مخزون المفاتيح', st in (200, 204), f'HTTP {st}')

            st, after = req('GET', f"orders?reference=eq.{ref}&select=status,licenseKey")
            if isinstance(after, list) and after:
                a = after[0]
                check('المفتاح محفوظ في الطلب',
                      a.get('licenseKey') == new_key and a.get('status') == 'confirmed',
                      f"status={a.get('status')} · key={a.get('licenseKey')}")

            # التحقق من تفرّغ المفتاح من المخزون
            st, lp2 = req('GET', f"products?id=eq.{lp['id']}&select=usedKeys")
            if isinstance(lp2, list) and lp2:
                u = lp2[0].get('usedKeys') or []
                check('المفتاح انتقل إلى المستهلكة', new_key in u, f'usedKeys الآن: {len(u)}')
    else:
        check('التأكيد', False, 'لا يوجد منتج بمفاتيح — تخطّي')

# ═══════════════════════════════════════════════════
# ٦) العميل يتحقق من طلبه
# ═══════════════════════════════════════════════════
print("\n[٦] العميل — تتبّع الطلب (هل يرى المفتاح؟)")
st, cust = req('GET', f"orders?reference=eq.{ref}&select=reference,status,licenseKey,productName")
if isinstance(cust, list) and cust:
    c = cust[0]
    check('العميل يجد طلبه بالمرجع', True, f"{c.get('productName')}")
    check('الحالة = confirmed', c.get('status') == 'confirmed', str(c.get('status')))
    if new_key:
        check('✅ المفتاح يظهر للعميل', c.get('licenseKey') == new_key, str(c.get('licenseKey')))
else:
    check('العميل يجد طلبه', False, 'لم يُعثر على الطلب')

# ═══════════════════════════════════════════════════
# ٧) الاقتراحات
# ═══════════════════════════════════════════════════
print("\n[٧] الاقتراحات")
st, _ = req('POST', 'suggestions', [{'name': 'مُختبِر', 'text': 'اقتراح تدفق'}], prefer='return=minimal')
check('إضافة اقتراح', st in (200, 201), f'HTTP {st}')
st, sug = req('GET', 'suggestions?select=*&order=id.desc&limit=5')
has = isinstance(sug, list) and any(s.get('text') == 'اقتراح تدفق' for s in sug)
check('الاقتراح يظهر في القائمة', has, f'{len(sug) if isinstance(sug, list) else 0} اقتراحاً')

# ═══════════════════════════════════════════════════
# ٨) التنظيف
# ═══════════════════════════════════════════════════
print("\n[٨] تنظيف آثار الاختبار")
st, _ = req('DELETE', f'orders?reference=eq.{ref}')
check('حذف الطلب التجريبي', st in (200, 204), f'HTTP {st}')
st, _ = req('DELETE', 'suggestions?text=eq.' + urllib.parse.quote('اقتراح تدفق'))
check('حذف الاقتراح التجريبي', st in (200, 204), f'HTTP {st}')
if new_key and lic:
    st, cur = req('GET', f"products?id=eq.{lic[0]['id']}&select=usedKeys")
    if isinstance(cur, list) and cur:
        u = [k for k in (cur[0].get('usedKeys') or []) if k != new_key]
        st, _ = req('PATCH', f"products?id=eq.{lic[0]['id']}", {'usedKeys': u}, prefer='return=minimal')
        check('إعادة المفتاح للمخزون', st in (200, 204), f'HTTP {st}')

st, left = req('GET', f"orders?reference=eq.{ref}&select=id")
clean = not (isinstance(left, list) and len(left) > 0)
check('التأكد من نظافة القاعدة', clean, 'لا أثر للاختبار' if clean else '⚠️ بقايا موجودة!')

# ═══════════════════════════════════════════════════
#  النتيجة
# ═══════════════════════════════════════════════════
print("\n" + "═" * 60)
passed = sum(1 for _, o, _ in results if o)
total_n = len(results)
print(f"  النتيجة: {passed}/{total_n} اختباراً ناجحاً")
if passed == total_n:
    print("  🎉 التدفق سليم بالكامل — من الشراء حتى وصول المفتاح")
else:
    print("  ⚠️ الفاشلة:")
    for n, o, d in results:
        if not o: print(f"     • {n} — {d}")
print("═" * 60 + "\n")
sys.exit(0 if passed == total_n else 1)
