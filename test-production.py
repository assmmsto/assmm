# -*- coding: utf-8 -*-
"""
اختبار جاهزية الإنتاج — معرض الأعمال (Nova)
════════════════════════════════════════════════════════════════
فحص ثابت (static) يتحقق من كل ما يلزم قبل رفع الموقع على السيرفر:
اتساق إصدارات الكاش · سلامة أصول Service Worker · الأيقونات ·
أصول المشاركة · robots/sitemap · .htaccess · الروابط المكسورة.

التشغيل:  python test-production.py
كود الخروج 0 = جاهز للإنتاج.
"""
import json
import os
import re
import sys
import xml.dom.minidom

ROOT = os.path.dirname(os.path.abspath(__file__))
os.chdir(ROOT)

PASS, FAIL, WARN = 0, 0, 0
issues = []


def ok(label, extra=''):
    global PASS
    PASS += 1
    print(f'  ✅ {label}' + (f'  → {extra}' if extra else ''))


def bad(label, extra=''):
    global FAIL
    FAIL += 1
    issues.append(f'{label} — {extra}' if extra else label)
    print(f'  ❌ {label}' + (f'  → {extra}' if extra else ''))


def warn(label, extra=''):
    global WARN
    WARN += 1
    print(f'  ⚠️  {label}' + (f'  → {extra}' if extra else ''))


def read(path):
    with open(path, encoding='utf-8') as f:
        return f.read()


def section(title):
    print(f'\n─── {title} ───')


# ═══ 1) اتساق إصدار الكاش ═══
section('اتساق إصدار الكاش')
sw = read('sw.js')
m = re.search(r"CACHE_NAME\s*=\s*'nova-cache-v(\d+)'", sw)
sw_ver = m.group(1) if m else None
if not sw_ver:
    bad('قراءة CACHE_NAME من sw.js')
else:
    ok('CACHE_NAME', f'v{sw_ver}')
    html_vers = {}
    for page in ['index.html', 'admin.html']:
        vers = set(re.findall(r'\?v=(\d+)', read(page)))
        html_vers[page] = vers
        if vers == {sw_ver}:
            ok(f'{page} — كل الإصدارات موحّدة', f'v{sw_ver}')
        else:
            bad(f'{page} — إصدارات غير موحّدة', f'{sorted(vers)} بدل v{sw_ver}')

# ═══ 2) سلامة أصول Service Worker ═══
section('أصول Service Worker')
block = re.search(r'CORE_ASSETS\s*=\s*\[(.*?)\];', sw, re.S)
if not block:
    bad('قراءة CORE_ASSETS')
else:
    assets = re.findall(r"'([^']+)'", block.group(1))
    local = [a for a in assets if not a.startswith('http') and a not in ('.',)]
    missing = [a for a in local if not os.path.exists(a)]
    if missing:
        bad('أصول محلية مفقودة', ', '.join(missing))
    else:
        ok(f'كل الأصول المحلية موجودة ({len(local)})')

    # الملفات الأساسية يجب أن تكون مُخزّنة مسبقاً
    for core in ['styles.css', 'app.js', 'db.js', 'index.html']:
        if core in assets:
            ok(f'«{core}» مُخزَّن مسبقاً')
        else:
            bad(f'«{core}» غير مُخزَّن مسبقاً', 'لن يعمل الموقع بلا إنترنت')

    # Tailwind غير مستخدم — يجب ألّا يكون مُخزّناً
    if 'cdn.tailwindcss.com' in assets:
        bad('Tailwind مُخزَّن مسبقاً', 'المشروع لا يستخدمه — هدر ~400KB لكل زائر')
    else:
        ok('لا يوجد تخزين مسبق لـ Tailwind')

# ═══ 3) بيان التطبيق (manifest) ═══
section('بيان التطبيق')
try:
    man = json.loads(read('manifest.json'))
    ok('manifest.json سليم')
    for key in ['name', 'short_name', 'start_url', 'display', 'theme_color', 'icons']:
        if key in man:
            ok(f'حقل «{key}»')
        else:
            bad(f'حقل «{key}» مفقود')
    icons = man.get('icons', [])
    if len(icons) >= 3:
        ok(f'عدد الأيقونات', str(len(icons)))
    else:
        bad('أيقونات ناقصة', f'{len(icons)} فقط')
    has_maskable = any('maskable' in i.get('purpose', '') for i in icons)
    ok('أيقونة maskable') if has_maskable else bad('لا توجد أيقونة maskable')
    for i in icons:
        if not os.path.exists(i['src']):
            bad(f'أيقونة مفقودة', i['src'])
    if all(os.path.exists(i['src']) for i in icons):
        ok('كل ملفات الأيقونات موجودة')
except Exception as e:
    bad('manifest.json', str(e))

# ═══ 4) أصول الهوية والصور ═══
section('أصول الهوية')
try:
    from PIL import Image
    og = 'assets/og-image.png'
    if os.path.exists(og):
        im = Image.open(og)
        if im.size == (1200, 630):
            ok('صورة المشاركة 1200×630')
        else:
            bad('مقاس صورة المشاركة', f'{im.size} بدل (1200, 630)')
    else:
        bad('صورة المشاركة مفقودة', og)

    for ic in ['assets/icon-192.png', 'assets/icon-512.png', 'assets/icon-maskable-512.png', 'assets/apple-touch-icon.png']:
        if os.path.exists(ic):
            im = Image.open(ic)
            expect = int(re.search(r'(\d+)', os.path.basename(ic).replace('apple-touch-icon', '180')).group(1))
            if im.size == (expect, expect):
                ok(f'{os.path.basename(ic)} — {im.size[0]}×{im.size[1]}')
            else:
                bad(os.path.basename(ic), f'{im.size}')
        else:
            bad('أيقونة مفقودة', ic)
except ImportError:
    warn('Pillow غير متاح — تُخطّى فحوص الصور')

# ═══ 5) أصول المشاركة في index.html ═══
section('وسوم المشاركة (SEO)')
idx = read('index.html')
for tag, label in [('og:title', 'og:title'), ('og:description', 'og:description'),
                   ('og:image', 'og:image'), ('og:url', 'og:url'),
                   ('twitter:card', 'twitter:card'), ('rel="canonical"', 'canonical')]:
    if tag in idx:
        ok(label)
    else:
        bad(f'{label} مفقود')
if 'example.com' in idx:
    warn('النطاق لم يُستبدل بعد', 'ابحث عن example.com واستبدله بنطاقك')
else:
    ok('النطاق مُستبدل')

# ═══ 6) robots + sitemap ═══
section('الفهرسة')
if os.path.exists('robots.txt'):
    rb = read('robots.txt')
    ok('robots.txt موجود')
    if 'Disallow: /admin.html' in rb:
        ok('لوحة الأدمن محجوبة عن الفهرسة')
    else:
        bad('لوحة الأدمن غير محجوبة في robots.txt')
else:
    bad('robots.txt مفقود')
if os.path.exists('sitemap.xml'):
    try:
        xml.dom.minidom.parse('sitemap.xml')
        ok('sitemap.xml سليم')
    except Exception as e:
        bad('sitemap.xml غير سليم', str(e))
else:
    bad('sitemap.xml مفقود')

# ═══ 7) إعدادات الإنتاج (.htaccess) ═══
section('إعدادات السيرفر')
if os.path.exists('.htaccess'):
    ht = read('.htaccess')
    ok('.htaccess موجود')
    checks = [
        ('Options -Indexes', 'منع عرض المجلدات'),
        ('nosniff', 'ترويسة nosniff'),
        ('Content-Security-Policy', 'سياسة أمان المحتوى'),
        ('X-Frame-Options', 'حماية من التأطير'),
        ('mod_deflate', 'ضغط'),
        ('RewriteEngine', 'إعادة توجيه HTTPS'),
        (r'\.(py|sql|md|cmd|bat|log)', 'حجب ملفات التطوير'),
        (r'\(tests\|tools\)', 'حجب مجلدات الاختبارات والأدوات'),
        (r'\.workbuddy-ai', 'حجب مساحة العمل الداخلية'),
    ]
    for needle, label in checks:
        if re.search(needle, ht):
            ok(label)
        else:
            bad(f'مفقود: {label}')
else:
    bad('.htaccess مفقود')

# ═══ 8) الروابط المحلية في الصفحات ═══
section('الروابط المحلية')
for page in ['index.html', 'admin.html']:
    html = read(page)
    refs = re.findall(r'(?:src|href)="([^"]+)"', html)
    local = [r for r in refs if not r.startswith(('http', 'data:', '#', 'mailto:', 'tel:', '//'))]
    missing = []
    for r in local:
        clean = r.split('?')[0].split('#')[0]
        if clean and not os.path.exists(clean):
            missing.append(r)
    if missing:
        bad(f'{page} — روابط مكسورة', ', '.join(missing[:5]))
    else:
        ok(f'{page} — كل الروابط المحلية سليمة ({len(local)})')

    # ملفات التطوير يجب ألّا تكون مُشاراً إليها
    dev = [r for r in refs if re.search(r'(test-|demo-|admin_stitch|\.py|\.sql|\.md)', r)]
    if dev:
        bad(f'{page} — يشير لملفات تطوير', ', '.join(dev[:4]))
    else:
        ok(f'{page} — لا يشير لملفات تطوير')

# ═══ 9) تنظيف الملفات المؤقتة ═══
section('نظافة المستودع')
junk = [f for f in os.listdir('.') if f.endswith(('.tmp', '.log', '.bak', '.out.txt')) or f.startswith('_pv')]
if junk:
    warn('ملفات مؤقتة', ', '.join(junk))
else:
    ok('لا ملفات مؤقتة في الجذر')

# ═══ 10) فحوص المانعات — أُضيفت بعد تحليل 2026-09-25 ═══
#  سبب وجود هذا القسم — درس مباشر:
#  كانت الفحوصات الـ48 كلها **خضراء** ومع ذلك لم تكتشف ثلاثة مانعات نشر.
#  لأنها تفحص «هل الكود مكتوب بشكل سليم؟» لا «هل النتيجة صحيحة؟».
#  وهذه الفحوصات تفحص النتيجة: هل تصل البيانات؟ هل تُسرَّب؟ هل يُسلَّم المنتج؟
section('فحوص المانعات (نتيجة لا صياغة)')

# (1) مفاتيح الترخيص يجب ألّا تكون في الملف المنشور علناً
try:
    pdata = json.loads(read('data/products.json'))
    leaked = [f"{p.get('slug')}.{f}" for p in pdata.get('products', [])
              for f in ('licenseKeys', 'usedKeys') if p.get(f)]
    if leaked:
        bad('مفاتيح ترخيص في الكتالوج العام', ', '.join(leaked[:5]))
    else:
        ok('لا مفاتيح ترخيص في الكتالوج العام')
except Exception as e:
    bad('data/products.json', str(e))

# (2) رابط لوحة الأدمن يجب ألّا يكون منشوراً في الصفحة العامة
if re.search(r'href="admin\.html"', idx):
    bad('رابط لوحة الأدمن منشور في الصفحة العامة', 'أي زائر يجده بنقرة')
else:
    ok('لا رابط للوحة الأدمن في الصفحة العامة')

# (3) لا عناوين دفع تجريبية — أخطرها عناوين محافظ تُفقد أموال المشتري
fake_re = re.compile(
    r'(bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh'      # عنوان مثال BIP-173 الشهير
    r'|TF175bg6Vwzp4x1xUa9J7Hpx82qBvU9KzP'
    r'|paypal\.me/WorkShowcase'
    r'|price_1R2NovaStripeDemo'
    r'|EG63 0002)', re.I)
fake_hits = [f for f in ('data/settings.json', 'data/wallets.json') if fake_re.search(read(f))]
if fake_hits:
    bad('عناوين دفع تجريبية', ', '.join(fake_hits))
else:
    ok('لا عناوين دفع تجريبية في البيانات')

# (4) قراءة المنتجات يجب أن تطلب أعمدة صريحة.
#     سحب صلاحية قراءة عمود يجعل select('*') يفشل **كلياً** بخطأ صلاحيات
#     (لا أن يُخفي العمود) ⇒ الكتالوج كله يسقط للزائر بلا رسالة.
dbjs = read('db.js')
if 'PRODUCT_PUBLIC_COLS' in dbjs and "select(cols.join(','))" in dbjs:
    ok('db.js يطلب أعمدة المنتجات صراحةً')
else:
    bad('db.js لا يطلب أعمدة المنتجات صراحةً', "select('*') يفشل بعد تشديد صلاحيات الأعمدة")

# (5) الإدراج المرن موجود — يمنع فقدان الطلبات بصمت عند اختلاف المخطط
if 'insertResilient' in dbjs:
    ok('الإدراج المرن موجود في db.js')
else:
    bad('لا يوجد إدراج مرن', 'أي عمود غير موجود في القاعدة يُفقد الطلب بصمت')

# (6) قراءة الطلب الواحد يجب أن تمرّ بدالة آمنة
if 'get_order_by_reference' in dbjs and "rpc('get_order_by_reference'" in dbjs:
    ok('متابعة الطلب عبر الدالة الآمنة')
else:
    bad('متابعة الطلب لا تستخدم الدالة الآمنة')

# (7) ملف الأمان: العناصر الحرجة موجودة
sqlfix = read('supabase-security-fix.sql')
for needle, label in [
    ('get_order_by_reference', 'دالة متابعة الطلب'),
    ('grant select (', 'منح الأعمدة صراحةً (لا منح على مستوى الجدول)'),
    ('revoke all on products from anon', 'سحب صلاحيات الجدول الكاملة أولاً'),
    ('add column if not exists "payerEmail"', 'عمود بريد المشتري'),
]:
    if needle in sqlfix:
        ok(label)
    else:
        bad(f'مفقود في ملف الأمان: {label}')

# (8) لا سياسة قراءة مفتوحة على جدول الطلبات
if re.search(r'on orders\s+for select', sqlfix, re.I):
    bad('ملف الأمان فيه سياسة قراءة مفتوحة للطلبات', 'أي زائر يسرد كل الطلبات وبيانات المشترين')
else:
    ok('لا سياسة قراءة مفتوحة على جدول الطلبات')

# (9) أداة التدقيق يجب ألّا تحمل هجوماً مُدمِّراً
audit = read('tools/audit-security.py')
if re.search(r"DELETE',\s*'suggestions'.*\?id=gte\.", audit):
    bad('أداة التدقيق تحمل حذفاً جماعياً للاقتراحات', 'تمسح بيانات حقيقية عند التشغيل')
else:
    ok('أداة التدقيق غير مُدمِّرة')

# (10) حماية مخزون الترخيص من المحو عند الرفع
if 'withoutEmptyKeys' in dbjs:
    ok('حماية مفاتيح الترخيص من المحو بمصفوفة فارغة')
else:
    bad('لا حماية لمفاتيح الترخيص', 'رفع المنتجات قد يمحو المخزون')

# ═══ النتيجة ═══
print('\n' + '═' * 62)
print(f'  النتيجة: {PASS} ناجح · {FAIL} فاشل · {WARN} تحذير')
if FAIL == 0:
    print('  🎉 الموقع جاهز للإنتاج' + (' (مع تحذيرات)' if WARN else ''))
else:
    print('  ❌ توجد مشاكل يجب إصلاحها قبل النشر:')
    for i in issues:
        print('     ·', i)
print('═' * 62)
sys.exit(0 if FAIL == 0 else 1)
