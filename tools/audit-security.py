# -*- coding: utf-8 -*-
"""
وكيل تدقيق أمني مستقل — معرض الأعمال (Nova)
════════════════════════════════════════════════════════════════
يحاول فعلياً تنفيذ كل هجوم كان ناجحاً قبل الإصلاح، ويفشل التقرير إن نجح أي منها.
هذا الوكيل **مستقل عن كود الإصلاح** — لا يستورد منه شيئاً، بل يهاجم القاعدة مباشرة،
وهو الحكم النهائي على نجاح سياسات RLS.

التشغيل:  python tools/audit-security.py
كود الخروج 0 = كل الهجمات فشلت (القاعدة آمنة).
"""
import json
import os
import sys
import uuid
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SETTINGS = os.path.join(ROOT, 'data', 'settings.json')

with open(SETTINGS, encoding='utf-8') as f:
    _s = json.load(f)
URL = _s['supabaseUrl'].rstrip('/')
KEY = _s['supabaseKey']
H = {'apikey': KEY, 'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'}

PASS, FAIL = 0, 0
failures = []

# معرّف فريد لكل تشغيل — يمنع خطأ 409 (تعارض تكرار) من أن يُفسَّر خطأً
# كـ«الهجوم مُنع»، فيصير الفحص حتمياً لا يعتمد على حالة سابقة.
AUDIT_SLUG = 'audit-inject-' + uuid.uuid4().hex[:8]


def req(method, path, body=None, params='', limit=200):
    """يرسل طلباً ويرجع (status, text). لا يرفع استثناءً.

    ⚠️ مهم: `limit` يقصّ الاستجابة افتراضياً لتقليل الضجيج في السجل،
    لكن **فحوصات التسريب يجب أن تمرّر limit=None** — وإلا فُسد تحليل JSON
    فتُفسَّر الاستجابة الطويلة خطأً كـ«لا تسريب». هذا خطأ حقيقي وقع:
    كان التدقيق يُبلّغ «لا تسريب» عن 5 مفاتيح ترخيص مقروءة فعلاً،
    لأن الاستجابة 615 حرفاً قُصّت إلى 200 فصار json.loads يفشل بصمت."""
    url = f'{URL}/rest/v1/{path}{params}'
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, method=method, data=data, headers=H)
    try:
        with urllib.request.urlopen(r) as resp:
            text = resp.read().decode()
            return resp.status, (text if limit is None else text[:limit])
    except urllib.error.HTTPError as e:
        text = e.read().decode()
        return e.code, (text if limit is None else text[:limit])
    except Exception as e:
        return 0, str(e)


def attack(label, method, path, body=None, params='', expect_blocked=True, leak_check=None):
    """ينفّذ هجوماً. expect_blocked=True يعني: نجاح الاختبار = الهجوم فشل."""
    global PASS, FAIL
    status, text = req(method, path, body, params)
    # PostgREST: العملية نجحت إن كانت 2xx
    succeeded = 200 <= status < 300

    if expect_blocked:
        if not succeeded:
            PASS += 1
            print(f'  ✅ {label}  → مُنع ({status})')
        else:
            FAIL += 1
            failures.append(label)
            print(f'  ❌ {label}  → 🔴 نجح الهجوم! ({status}) {text[:90]}')
    return status, text


def leak_attack(label, path, params, secret_key):
    """يفحص إن كانت بيانات سرّية قابلة للقراءة فعلاً.

    ⚠️ الدرس الحاكم: فشل تحليل الاستجابة **ليس** دليل سلامة. لو فشل التحليل
    نُعلن فشل الاختبار (لا نجاحه)، لأن ذلك يعني أننا لا نعرف ماذا عاد فعلاً."""
    global PASS, FAIL
    status, full = req('GET', path, params=params, limit=None)
    if status != 200:
        PASS += 1
        print(f'  ✅ {label}  → مُنع ({status})')
        return
    try:
        rows = json.loads(full)
    except Exception as e:
        # لا نعتبره نجاحاً أبداً — لا نعرف محتوى الاستجابة
        FAIL += 1
        failures.append(f'{label} (تعذّر التحليل)')
        print(f'  ❌ {label}  → ⚠️ تعذّر تحليل الاستجابة ({type(e).__name__}) — تُعامل كخطر')
        print(f'      عيّنة: {full[:120]}')
        return

    leaked = 0
    if isinstance(rows, list):
        for row in rows:
            val = row.get(secret_key)
            if isinstance(val, list) and val:
                leaked += len(val)
            elif val:
                leaked += 1
    if leaked == 0:
        PASS += 1
        print(f'  ✅ {label}  → لا تسريب')
    else:
        FAIL += 1
        failures.append(label)
        print(f'  ❌ {label}  → 🔴 تسرّب {leaked} قيمة سرّية!')
        print(f'      عيّنة: {str(rows)[:150]}')


print('═' * 64)
print('  وكيل التدقيق الأمني المستقل — معرض الأعمال')
print(f'  الهدف: {URL}')
print('═' * 64)

# ═══ 1) الهجمات التي كانت ناجحة قبل الإصلاح ═══
print('\n─── 1) منع الكتابة على المنتجات (كانت ناجحة) ───')

attack('تعديل سعر منتج إلى 0.01$',
       'PATCH', 'products', {'price': 0.01}, '?id=eq.99999')

attack('حذف منتج',
       'DELETE', 'products', None, '?id=eq.99999')

attack('إضافة منتج وهمي',
       'POST', 'products', {'name': 'AUDIT-INJECT', 'slug': AUDIT_SLUG, 'price': 999})
attack('إخفاء كل المنتجات (status=hidden)',
       'PATCH', 'products', {'status': 'hidden'}, '?id=eq.99999')

# ═══ 2) منع تسريب المفاتيح ═══
print('\n─── 2) منع تسريب مفاتيح الترخيص ───')

leak_attack('قراءة licenseKeys صراحةً', 'products', '?select=name,licenseKeys', 'licenseKeys')
leak_attack('قراءة usedKeys', 'products', '?select=name,usedKeys', 'usedKeys')
leak_attack('قراءة كل الأعمدة', 'products', '?select=*', 'licenseKeys')

# ⚠️ فحص حاكم — «لا تكسر الموقع وأنت تُصلحه»:
# سحب صلاحية قراءة عمود يجعل `select=*` يفشل **كلياً** بخطأ صلاحيات، لا أن
# يُخفي العمود فقط. ولو لم تُحدَّث الواجهة لتطلب الأعمدة العامة صراحةً،
# لسقط الكتالوج كاملاً بلا أي رسالة. لذلك نتحقق أن القائمة التي تستخدمها
# الواجهة فعلاً (db.js → PRODUCT_PUBLIC_COLS) ما زالت تعمل.
PUBLIC_COLS = ('id,slug,name,short,long,type,kind,platform,price,currency,version,'
               'features,installCommands,downloadUrl,licenseMode,licenseNote,'
               'githubInviteUrl,demoUrl,previewImage,status,featured,downloads,'
               'hiddenFields,paymentMethods')
status, _ = req('GET', 'products', params=f'?select={PUBLIC_COLS}&order=id')
if status == 200:
    PASS += 1
    print('  ✅ أعمدة الواجهة العامة تعمل  → 200')
else:
    FAIL += 1
    failures.append('أعمدة الواجهة العامة')
    print(f'  ❌ أعمدة الواجهة العامة لا تعمل ({status}) — الكتالوج سيسقط للزائر!')

# ═══ 3) منع العبث بالطلبات ═══
print('\n─── 3) منع العبث بالطلبات ───')

attack('قراءة كل بيانات المشترين',
       'GET', 'orders', None, '?select=reference,payerName,payerRef', expect_blocked=True)

attack('إدراج طلب بحالة confirmed مباشرة (تجاوز الدفع)',
       'POST', 'orders',
       {'reference': 'AUDIT-FAKE-1', 'productId': 1, 'status': 'confirmed',
        'licenseKey': 'AUDIT-KEY', 'total': 0, 'price': 0, 'currency': 'USD',
        'productName': 'x', 'methodKey': 'x', 'methodLabel': 'x'})

attack('تأكيد طلب حقيقي وسحب مفتاح (status=confirmed)',
       'PATCH', 'orders', {'status': 'confirmed', 'licenseKey': 'AUDIT-STOLEN'},
       '?reference=eq.REF-MUD7EDEA')

# ⚠️ حماية: هذا الهجوم خطير لأنه يمحو كل الطلبات إن نجح.
# لذلك نحصر الهدف في مرجع تجريبي غير موجود — النتيجة نفسها (يُمنع أو يُنفَّذ)
# لكن بلا أي خطر على بيانات حقيقية.
attack('حذف الطلبات (هدف تجريبي غير موجود)',
       'DELETE', 'orders', None, '?reference=eq.AUDIT-NONEXISTENT-REF')

# ═══ 4) منع العبث بالاقتراحات ═══
print('\n─── 4) منع العبث بالاقتراحات ───')

attack('قراءة اقتراحات الناس',
       'GET', 'suggestions', None, '?select=*')

# ⚠️ تنبيه: كان هدف هذا الهجوم `?id=gte.0` — وهو **يمسح كل الاقتراحات فعلاً**
# إن كانت الكتابة مسموحة. أي أن أداة التدقيق كانت ستُدمّر بيانات حقيقية.
# الهدف الآن معرّف تجريبي غير موجود: النتيجة الأمنية نفسها (يُمنع أو يُنفَّذ)
# بلا أي خطر على بيانات حقيقية.
attack('حذف الاقتراحات (هدف تجريبي غير موجود)',
       'DELETE', 'suggestions', None, '?id=eq.999999')

# ═══ 5) التأكد أن الوظائف المشروعة ما زالت تعمل ═══
print('\n─── 5) الوظائف المشروعة (يجب أن تعمل) ───')

status, _ = req('GET', 'products', params='?select=id,name,slug,price,currency,status&order=id')
if status == 200:
    PASS += 1
    rows = json.loads(req('GET', 'products', params='?select=id&order=id')[1])
    print(f'  ✅ الزائر يقرأ الكتالوج  → 200 ({len(rows)} منتج)')
else:
    FAIL += 1
    failures.append('قراءة الكتالوج')
    print(f'  ❌ الزائر لا يستطيع قراءة الكتالوج ({status}) — أفسدنا الموقع!')

# نُنشئ طلباً تجريبياً حقيقياً ثم نتحقق ثم نحذفه يدوياً بـ service role غير متاح،
# لذلك نستخدم مرجعاً فريداً ونتأكد أنه أُنشئ فعلاً (سيبقى — وهو مقبول لأن
# صندوق الطلبات يعرض الطلبات المعلّقة، ولا نستطيع حذفها بالمفتاح العام).
print('\n─── 6) دورة الطلب الكاملة (وظيفة حرجة) ───')
AUDIT_REF = 'AUDIT-ORDER-TEST'
# الحمولة مطابقة تماماً لما يرسله db.js في ORDER_COLS.
# إرسال عمود غير موجود يُفشل الإدراج بـ PGRST204 — وهذا يفحص المخطط لا الثغرة،
# فنضيف payerEmail فقط إن كان العمود موجوداً فعلاً (نستكشفه أولاً).
AUDIT_ORDER = {
    'reference': AUDIT_REF, 'productId': 1, 'productName': 'Audit Product',
    'price': 5, 'currency': 'USD', 'discountCode': '', 'total': 5,
    'methodKey': 'usdt', 'methodLabel': 'USDT', 'payerName': 'Audit Bot',
    'payerRef': 'AUDIT-TX-1', 'status': 'pending',
    'licenseKey': '', 'createdAt': '2026-01-01T00:00:00Z',
}
_probe, _ = req('GET', 'orders', params='?select=payerEmail&limit=1')
if _probe == 200:
    AUDIT_ORDER['payerEmail'] = 'audit@test.local'
else:
    print('  ⚠️  عمود payerEmail غير موجود — اختبرنا بدون الحقل (شغّل الـSQL)')

status, text = req('POST', 'orders', AUDIT_ORDER)

if status and 200 <= status < 300:
    PASS += 1
    print(f'  ✅ إنشاء طلب معلّق  → {status}')

    # متابعة الطلب: بعد تشديد السياسات صارت عبر دالة آمنة تُعيد صفاً واحداً
    # بمرجعه. (القراءة المباشرة من الجدول محجوبة عن المفتاح العام — وهذا مقصود.)
    st2, tx2 = req('POST', 'rpc/get_order_by_reference', {'ref': AUDIT_REF}, limit=None)
    if st2 == 200 and AUDIT_REF in tx2:
        PASS += 1
        print('  ✅ متابعة الطلب بالمرجع تعمل (عبر الدالة الآمنة)')
    else:
        FAIL += 1
        failures.append('متابعة الطلب')
        print(f'  ❌ متابعة الطلب فشلت ({st2}) {tx2[:90]}')

    # والدالة نفسها يجب ألّا تُعيد بيانات المشتري الشخصية
    if st2 == 200 and any(f in tx2 for f in ('payerName', 'payerRef', 'payerEmail')):
        FAIL += 1
        failures.append('الدالة تُسرّب بيانات المشتري')
        print('  ❌ دالة المتابعة تُعيد أعمدة بيانات المشتري — يجب أن تقتصر على حالة الطلب')
else:
    FAIL += 1
    failures.append('إنشاء طلب')
    print(f'  ❌ إنشاء طلب معلّق فشل ({status}) — أفسدنا البيع!')

# ═══ 7) تنظيف ذاتي لأي أثر خلّفه التدقيق ═══
# ملاحظة: هذا القسم يعمل فقط إذا كانت الكتابة مسموحة (أي أن الإصلاح لم يُطبَّق).
# بعد تطبيق الإصلاح ستفشل عمليات التنظيف — وهذا مقبول، لأنها تفشل لأن
# الاصطناع نفسه مُنع من البداية.
print('\n─── 7) تنظيف أثر التدقيق ───')
cleanup_targets = [
    ('orders', '?reference=like.AUDIT*'),
    ('orders', '?reference=eq.AUDIT-ORDER-TEST'),
    ('products', f'?slug=eq.{AUDIT_SLUG}'),
]
cleaned = 0
for table, params in cleanup_targets:
    st, _ = req('DELETE', table, None, params)
    if 200 <= st < 300:
        cleaned += 1
if cleaned:
    print(f'  🧹 نُظّف {cleaned} هدف تسجيل تجريبي')
else:
    print('  ✅ لا شيء يُنظَّف (الكتابة مُنعت من الأساس)')

# التحقق النهائي من سلامة البيانات الحقيقية
st, _ = req('GET', 'products', params='?select=id')
try:
    n_products = len(json.loads(req('GET', 'products', params='?select=id&order=id')[1]))
except Exception:
    n_products = -1
st, _ = req('GET', 'orders', params='?select=id')
try:
    n_orders = len(json.loads(req('GET', 'orders', params='?select=id&order=id')[1]))
except Exception:
    n_orders = -1
print(f'  📊 الحالة: {n_products} منتج · {n_orders} طلب')
if n_orders > 1 and n_orders > 3:
    print('  ⚠️ عدد الطلبات أعلى من المتوقع — راجعها')

# ═══ النتيجة ═══
print('\n' + '═' * 64)
print(f'  النتيجة: {PASS} ناجح · {FAIL} فاشل')
if FAIL == 0:
    print('  🛡️ القاعدة آمنة — كل هجمات الاختراق فشلت والوظائف سليمة')
else:
    print('  🔴 ثغرات باقية:')
    for f in failures:
        print(f'     · {f}')
print('═' * 64)
sys.exit(0 if FAIL == 0 else 1)
