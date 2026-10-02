#!/usr/bin/env python3
# ═══════════════════════════════════════════════════════════════
#  وكيل اختبار صارم — معرض الأعمال (Nova)
#  يحاكي التدفق الحرفي للكود: app.js → Supabase → admin.js
#  لا يكتفي بالاتصال، بل يبني كائن الطلب كما يبنيه app.js تماماً
#  (بما فيه الحقول الزائدة) ليتأكد أن الإدراج يُقبل فعلياً.
#  التشغيل:  python test-agent.py
# ═══════════════════════════════════════════════════════════════
import json, urllib.request, urllib.error, urllib.parse, sys, time
sys.stdout.reconfigure(encoding='utf-8')

URL = "https://qcarxyaxcfgasqkppkjb.supabase.co/rest/v1"
KEY = "sb_publishable_3di31UtXQVsvZ14AZjfHpA_4o_0azWQ"

# نفس قائمة db.js — الأعمدة المسموحة لجدول الطلبات
ORDER_COLS = ['reference','productId','productName','price','currency','discountCode',
  'total','methodKey','methodLabel','walletId','walletEndpoint','payerName','payerRef',
  'status','licenseKey','createdAt','confirmedAt']

results = []
def check(name, ok, detail=''):
    results.append((name, ok, detail))
    print(f"   {'✓' if ok else '✗'} {name}" + (f" — {detail}" if detail else ''))

def req(method, path, data=None, prefer=None):
    body = json.dumps(data, ensure_ascii=False).encode('utf-8') if data is not None else None
    headers = {'apikey': KEY, 'Authorization': 'Bearer ' + KEY,
               'Content-Type': 'application/json; charset=utf-8'}
    if prefer: headers['Prefer'] = prefer
    r = urllib.request.Request(f"{URL}/{path}", data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            raw = resp.read().decode('utf-8', 'ignore')
            return resp.status, (json.loads(raw) if raw.strip() else None)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', 'ignore')[:250]

def pick(row, cols):
    """نفس دالة db.js — تصفية الحقول قبل الإرسال"""
    return {c: row[c] for c in cols if row.get(c) is not None or c in ('licenseKey',)}

print("═" * 56)
print("  اختبار صارم — التدفق الكامل (عميل ← قاعدة ← أدمن)")
print("═" * 56)

# ═══ ١) البنية التحتية ═══
print("\n[1] البنية التحتية")
for t in ('products', 'orders', 'suggestions'):
    st, _ = req('GET', f'{t}?select=id&limit=1')
    check(f'جدول {t} متاح', st == 200, f'HTTP {st}')

st, products = req('GET', 'products?select=*&order=id')
check('قراءة المنتجات', st == 200 and isinstance(products, list),
      f'{len(products) if isinstance(products, list) else 0} منتجاً')

# ═══ ٢) محاكاة app.js الكاملة ═══
print("\n[2] محاكاة ما يرسله app.js (بالحقول الزائدة)")
ref = 'QA-' + str(int(time.time()))
target = next((p for p in products if (p.get('price') or 0) > 0), products[0])

# الكائن كما يبنيه app.js حرفياً — يتضمن discountValue الزائد
raw_order = {
    'reference': ref,
    'productId': target['id'],
    'productName': target['name'],
    'price': target.get('price', 0),
    'currency': target.get('currency', 'USD'),
    'discountCode': '',
    'discountValue': 0,              # ← ليس عموداً في الجدول (سبب الخطأ القاتل)
    'total': target.get('price', 0),
    'methodKey': 'wlt_trx_91kqa2',
    'methodLabel': 'USDT (TRC20) · TRC20',
    'walletId': 'wlt_trx_91kqa2',
    'walletEndpoint': 'wlt_trx_91kqa2',
    'payerName': 'مُختبر صارم',
    'payerRef': 'TX-QA-7788',
    'status': 'pending',
    'licenseKey': None,
    'createdAt': time.strftime('%Y-%m-%dT%H:%M:00Z', time.gmtime()),
}
check('الكائن الخام يحتوي حقلًا زائدًا (discountValue)', 'discountValue' in raw_order)

# اختبار قاتل: الإدراج المباشر WITHOUT تصفية يجب أن يفشل
st_bad, msg_bad = req('POST', 'orders', [raw_order], prefer='return=minimal')
check('الإدراج بدون تصفية يُرفض (إثبات الخطأ)', st_bad >= 400,
      f'HTTP {st_bad} · {"PGRST204" if "PGRST204" in str(msg_bad) else "مرفوض"}')

# الإدراج الصحيح: بعد تصفية db.js
cleaned = pick(raw_order, ORDER_COLS)
check('التصفية أزالت الحقل الزائد', 'discountValue' not in cleaned)
st_ok, _ = req('POST', 'orders', [cleaned], prefer='return=minimal')
check('الإدراج بعد التصفية ينجح', st_ok in (200, 201), f'HTTP {st_ok} · المرجع {ref}')

# ═══ ٣) ما يراه الأدمن ═══
print("\n[3] ما يراه الأدمن (renderOrders)")
st, orders = req('GET', 'orders?select=*&order=id.desc&limit=10')
found = st == 200 and isinstance(orders, list) and any(o.get('reference') == ref for o in orders)
check('الطلب يظهر في قائمة الأدمن', found, f'HTTP {st}')
check('الطلب بحالة pending', found and next((o for o in orders if o.get('reference') == ref), {}).get('status') == 'pending')

st, pend = req('GET', "orders?status=eq.pending&select=reference")
check('يظهر ضمن الطلبات المعلّقة', st == 200 and isinstance(pend, list),
      f'{len(pend) if isinstance(pend, list) else 0} معلقاً')

# ═══ ٤) التأكيد وسحب المفتاح ═══
print("\n[4] التأكيد وسحب مفتاح الترخيص")
lic = next((p for p in products if p.get('licenseMode') == 'key' and (p.get('licenseKeys') or [])), None)
new_key = None
if lic:
    keys = lic.get('licenseKeys') or []
    used = lic.get('usedKeys') or []
    avail = [k for k in keys if k not in used]
    check('مفاتيح متاحة', len(avail) > 0, f'{len(avail)} من {len(keys)}')
    if avail:
        new_key = avail[0]
        st, _ = req('PATCH', f"orders?reference=eq.{ref}", {
            'status': 'confirmed', 'licenseKey': new_key,
            'confirmedAt': time.strftime('%Y-%m-%dT%H:%M:00Z', time.gmtime()),
        }, prefer='return=minimal')
        check('تأكيد الطلب', st in (200, 204), f'HTTP {st} · {new_key}')
        st, _ = req('PATCH', f"products?id=eq.{lic['id']}",
                    {'usedKeys': used + [new_key]}, prefer='return=minimal')
        check('تحديث المخزون', st in (200, 204), f'HTTP {st}')

        # ═══ ٥) ما يراه المشتري ═══
        print("\n[5] ما يراه المشتري (تتبّع الطلب)")
        st, o = req('GET', f"orders?reference=eq.{ref}&select=status,licenseKey,productName")
        o = o[0] if isinstance(o, list) and o else {}
        check('المفتاح يظهر للمشتري', o.get('licenseKey') == new_key, f"{o.get('licenseKey')}")
        check('الحالة confirmed', o.get('status') == 'confirmed')
        check('اسم المنتج صحيح', o.get('productName') == target['name'])

# ═══ ٦) الاقتراحات ═══
print("\n[6] الاقتراحات")
st, _ = req('POST', 'suggestions', [{'name': 'مُختبر', 'text': 'اقتراح فحص'}], prefer='return=minimal')
check('إضافة اقتراح', st in (200, 201), f'HTTP {st}')
st, sug = req('GET', 'suggestions?select=*&order=id.desc&limit=5')
check('قراءة الاقتراحات', st == 200 and isinstance(sug, list),
      f'{len(sug) if isinstance(sug, list) else 0}')

# ═══ ٧) التنظيف ═══
print("\n[7] التنظيف")
st, _ = req('DELETE', f"orders?reference=eq.{ref}")
check('حذف الطلب التجريبي', st in (200, 204), f'HTTP {st}')
st, _ = req('DELETE', 'suggestions?text=eq.' + urllib.parse.quote('اقتراح فحص'))
check('حذف الاقتراح', st in (200, 204), f'HTTP {st}')
if lic and new_key:
    now = lic.get('usedKeys') or []
    st, _ = req('PATCH', f"products?id=eq.{lic['id']}",
                {'usedKeys': [k for k in now if k != new_key]}, prefer='return=minimal')
    check('إعادة المفتاح للمخزون', st in (200, 204), f'HTTP {st}')

# ═══ النتيجة ═══
print("\n" + "═" * 56)
passed = sum(1 for _, ok, _ in results if ok)
total = len(results)
print(f"  النتيجة: {passed}/{total} اختباراً")
if passed == total:
    print("  ✅ النظام سليم — التدفق كامل يعمل")
else:
    print("  ❌ فشل:")
    for name, ok, detail in results:
        if not ok:
            print(f"     • {name} — {detail}")
print("═" * 56)
sys.exit(0 if passed == total else 1)
