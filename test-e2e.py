#!/usr/bin/env python3
# ═══════════════════════════════════════════════════════════════════════════
#  اختبار End-to-End حقيقي من الصفر — معرض الأعمال (Nova)
#  ───────────────────────────────────────────────────────────────────────────
#  يحاكي رحلة كاملة بنفس استدعاءات db.js التي يفعلها المتصفح:
#    ٠) تنظيف أي أثر سابق
#    ١) الأدمن يضيف منتجاً جديداً (بمفاتيح ترخيص)
#    ٢) الزائر يرى المنتج يظهر في المتجر
#    ٣) الزائر يشتريه ← يُنشأ طلب (pending)
#    ٤) الأدمن يرى الطلب ← النقطة الحرجة
#    ٥) الأدمن يؤكد ← يُسحب مفتاح من المخزون
#    ٦) الزائر يتتبّع طلبه ← يرى المفتاح
#    ٧) حذف كل شيء والتأكد من النظافة التامة
#  التشغيل:  python test-e2e.py     (كود الخروج 0 = نجاح كامل)
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
    return ok

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

# هوية فريدة لهذه الجولة — تمنع التداخل مع بيانات حقيقية
RUN  = 'E2E' + str(int(time.time()))
SLUG = 'e2e-' + str(int(time.time()))
REF  = 'REF-' + RUN

print("\n" + "═" * 62)
print("  اختبار E2E من الصفر — معرض الأعمال")
print("═" * 62)
print(f"\n  هوية الجولة: {RUN}\n")

# ═══════════════════════════════════════════════════════════════
# ٠) تنظيف أي أثر سابق
# ═══════════════════════════════════════════════════════════════
print("[٠] تنظيف أي أثر لجولات سابقة")
req('DELETE', 'orders?reference=like.E2E*')
req('DELETE', 'products?slug=like.e2e-*')
st, left = req('GET', 'products?slug=like.' + urllib.parse.quote('e2e-*') + '&select=id')
check('لا بقايا قبل البدء', not (isinstance(left, list) and left),
      f'{len(left) if isinstance(left, list) else 0} منتجاً تجريبياً متبقياً')

# ═══════════════════════════════════════════════════════════════
# ١) الأدمن يضيف منتجاً جديداً
# ═══════════════════════════════════════════════════════════════
print("\n[١] الأدمن — إضافة منتج جديد (بمفاتيح ترخيص)")
st, mx = req('GET', 'products?select=id&order=id.desc&limit=1')
new_id = (mx[0]['id'] + 1) if (isinstance(mx, list) and mx) else 999

product = {
    'id': new_id, 'slug': SLUG, 'name': 'منتج اختبار E2E',
    'short': 'منتج يُنشأ ويُحذف آلياً', 'long': 'وصف تجريبي كامل',
    'type': 'exe', 'kind': 'exe', 'platform': 'Windows 10+',
    'price': 25, 'currency': 'USD', 'version': 'v9.9.9',
    'features': ['ميزة ١', 'ميزة ٢'], 'installCommands': ['install e2e'],
    'downloadUrl': 'https://example.com/e2e.exe',
    'licenseMode': 'key',
    'licenseKeys': ['E2E-KEY-AAAA', 'E2E-KEY-BBBB'],
    'usedKeys': [], 'licenseNote': 'ترخيص تجريبي',
    'githubInviteUrl': 'https://github.com/example/e2e',
    'demoUrl': '', 'previewImage': '',
    'status': 'active', 'featured': False, 'downloads': 0,
    'hiddenFields': [], 'paymentMethods': [],
}
st, _ = req('POST', 'products', [product], prefer='return=minimal')
check('إضافة المنتج', st in (200, 201), f'HTTP {st} · id={new_id} · slug={SLUG}')

st, chk = req('GET', f'products?id=eq.{new_id}&select=*')
created = st == 200 and isinstance(chk, list) and len(chk) == 1
check('المنتج محفوظ فعلياً', created, 'يمكن قراءته من القاعدة')
if created:
    p = chk[0]
    check('السعر صحيح', p.get('price') == 25, f"price={p.get('price')}")
    check('المفاتيح محفوظة', (p.get('licenseKeys') or []) == ['E2E-KEY-AAAA', 'E2E-KEY-BBBB'],
          str(p.get('licenseKeys')))
    check('المستهلكة فارغة', (p.get('usedKeys') or []) == [], str(p.get('usedKeys')))

# ═══════════════════════════════════════════════════════════════
# ٢) الزائر يرى المنتج
# ═══════════════════════════════════════════════════════════════
print("\n[٢] الزائر — هل يظهر المنتج في المتجر؟")
st, allp = req('GET', 'products?select=*&order=id')   # نفس استدعاء index.html
visible = isinstance(allp, list) and any(p.get('slug') == SLUG for p in allp)
check('✅ المنتج يظهر للزائر', visible,
      f'{len(allp) if isinstance(allp, list) else 0} منتجاً في المتجر')

st, act = req('GET', 'products?status=eq.active&select=slug')
in_active = isinstance(act, list) and any(p.get('slug') == SLUG for p in act)
check('يظهر ضمن الفعّالة (يمرّ فلتر الحالة)', in_active, 'موجود في قائمة الفعّالة')

# ═══════════════════════════════════════════════════════════════
# ٣) الزائر يشتري
# ═══════════════════════════════════════════════════════════════
print("\n[٣] الزائر — شراء المنتج")
order = {
    'reference': REF, 'productId': new_id, 'productName': 'منتج اختبار E2E',
    'price': 25, 'currency': 'USD', 'discountCode': '', 'total': 25,
    'methodKey': 'e2e', 'methodLabel': 'اختبار E2E',
    'payerName': 'مشترٍ تجريبي', 'payerRef': 'TX-E2E-001',
    'status': 'pending', 'licenseKey': None,
}
st, _ = req('POST', 'orders', [order], prefer='return=minimal')
check('إنشاء الطلب', st in (200, 201), f'HTTP {st} · المرجع {REF}')

st, o_rows = req('GET', f'orders?reference=eq.{REF}&select=*')
ok_order = st == 200 and isinstance(o_rows, list) and len(o_rows) == 1
check('الطلب محفوظ', ok_order, f'HTTP {st}')
if ok_order:
    o = o_rows[0]
    check('الحالة pending', o.get('status') == 'pending', str(o.get('status')))
    check('المبلغ صحيح', o.get('total') == 25, f"total={o.get('total')}")

# ═══════════════════════════════════════════════════════════════
# ٤) الأدمن يرى الطلب  ← النقطة الحرجة
# ═══════════════════════════════════════════════════════════════
print("\n[٤] الأدمن — هل يظهر الطلب؟ (النقطة الحرجة)")
st, orders = req('GET', 'orders?select=*&order=id.desc')   # نفس استدعاء admin.js
in_admin = isinstance(orders, list) and any(o.get('reference') == REF for o in orders)
check('✅ الطلب يظهر للأدمن', in_admin,
      f'{len(orders) if isinstance(orders, list) else 0} طلباً · المرجع {"موجود" if in_admin else "غير موجود!"}')

st, pend = req('GET', 'orders?status=eq.pending&select=reference')
in_pend = isinstance(pend, list) and any(o.get('reference') == REF for o in pend)
check('يظهر ضمن قيد المراجعة', in_pend,
      f'{len(pend) if isinstance(pend, list) else 0} طلباً معلقاً')

# ═══════════════════════════════════════════════════════════════
# ٥) الأدمن يؤكد ← سحب مفتاح
# ═══════════════════════════════════════════════════════════════
print("\n[٥] الأدمن — التأكيد وسحب مفتاح من المخزون")
assigned = None
if ok_order:
    oid = o_rows[0]['id']
    st, cur = req('GET', f'products?id=eq.{new_id}&select=licenseKeys,usedKeys')
    keys = (cur[0].get('licenseKeys') or []) if isinstance(cur, list) and cur else []
    used = (cur[0].get('usedKeys') or []) if isinstance(cur, list) and cur else []
    avail = [k for k in keys if k not in used]
    check('مفتاح متاح للسحب', len(avail) > 0, f'{len(avail)} متاح من {len(keys)}')
    if avail:
        assigned = avail[0]
        st, _ = req('PATCH', f'orders?id=eq.{oid}', {
            'status': 'confirmed', 'licenseKey': assigned,
            'confirmedAt': time.strftime('%Y-%m-%dT%H:%M:00Z', time.gmtime()),
        }, prefer='return=minimal')
        check('تأكيد الطلب', st in (200, 204), f'HTTP {st} · المفتاح {assigned}')

        st, _ = req('PATCH', f'products?id=eq.{new_id}',
                    {'usedKeys': used + [assigned]}, prefer='return=minimal')
        check('تحديث مخزون المفاتيح', st in (200, 204), f'HTTP {st}')

        st, after = req('GET', f'products?id=eq.{new_id}&select=usedKeys')
        if isinstance(after, list) and after:
            u = after[0].get('usedKeys') or []
            check('المفتاح انتقل للمستهلكة', assigned in u, f'usedKeys = {u}')

# ═══════════════════════════════════════════════════════════════
# ٦) الزائر يتتبّع طلبه
# ═══════════════════════════════════════════════════════════════
print("\n[٦] الزائر — تتبّع الطلب (هل يرى المفتاح؟)")
st, cust = req('GET', f'orders?reference=eq.{REF}&select=reference,status,licenseKey,productName')
if isinstance(cust, list) and cust:
    c = cust[0]
    check('يجد طلبه بالمرجع', c.get('productName') == 'منتج اختبار E2E', str(c.get('productName')))
    check('الحالة confirmed', c.get('status') == 'confirmed', str(c.get('status')))
    if assigned:
        check('✅ المفتاح يظهر للزائر', c.get('licenseKey') == assigned, str(c.get('licenseKey')))
else:
    check('الزائر يجد طلبه', False, 'لم يُعثر على الطلب')

# ═══════════════════════════════════════════════════════════════
# ٧) التنظيف الشامل
# ═══════════════════════════════════════════════════════════════
print("\n[٧] التنظيف الشامل — إعادة القاعدة لما كانت")
st, _ = req('DELETE', f'orders?reference=eq.{REF}')
check('حذف الطلب', st in (200, 204), f'HTTP {st}')
st, _ = req('DELETE', f'products?id=eq.{new_id}')
check('حذف المنتج التجريبي', st in (200, 204), f'HTTP {st}')

st, p_left = req('GET', f'products?id=eq.{new_id}&select=id')
st2, o_left = req('GET', f'orders?reference=eq.{REF}&select=id')
clean_p = not (isinstance(p_left, list) and p_left)
clean_o = not (isinstance(o_left, list) and o_left)
check('المنتج حُذف تماماً', clean_p, 'لا أثر')
check('الطلب حُذف تماماً', clean_o, 'لا أثر')

st, final = req('GET', 'products?select=id')
check('المنتجات الأصلية سليمة', isinstance(final, list) and len(final) == 7,
      f'{len(final) if isinstance(final, list) else 0} منتجاً (المتوقع ٧)')

# ═══════════════════════════════════════════════════════════════
print("\n" + "═" * 62)
passed = sum(1 for _, o, _ in results if o)
total = len(results)
print(f"  النتيجة النهائية: {passed}/{total}")
if passed == total:
    print("  🎉 نجاح كامل — التدفق من الصفر حتى النظافة سليم ١٠٠٪")
else:
    print("  ❌ الفاشلة:")
    for n, o, d in results:
        if not o: print(f"     • {n} — {d}")
print("═" * 62 + "\n")
sys.exit(0 if passed == total else 1)
