#!/usr/bin/env python3
"""
بناء مجلد نشر نظيف لـ Cloudflare Pages.

لماذا هذا السكربت؟
------------------
Cloudflare Pages **لا يملك ملف استثناء** (لا .cfignore ولا .assetsignore).
أي أن كل ما في المجلد يُرفع ويصبح متاحاً للعموم — بما في ذلك أدوات التطوير
والاختبارات ومساحة العمل الداخلية وسكربتات القاعدة.

والأخطر: لو رُفع ملف حسّاس بالخطأ، فلمنصة Cloudflare **ذاكرة أصول تحتفظ
بالملفات المحذوفة حتى أسبوع**، ولا يمكن مسحها يدوياً. أي أن الخطأ لا رجعة فيه
فوراً — يجب تدوير المفتاح لا حذف الملف.

الحل: نبني مجلد `dist/` يحتوي الملفات العامة فقط، ونرفع هذا المجلد وحده.

الاستخدام:
    python tools/build-dist.py            # يبني dist/
    python tools/build-dist.py --clean    # يمسح dist/ أولاً (الافتراضي)
"""

import argparse
import io
import os
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, 'dist')

# ── ملفات الجذر العامة (قائمة صريحة — لا تخمين) ──
ROOT_FILES = [
    'index.html',
    'admin.html',
    'orders.html',
    'orders.js',
    'privacy.html',
    'terms.html',
    '404.html',
    'styles.css',
    'app.js',
    'db.js',
    'admin.js',
    'sw.js',
    'manifest.json',
    'robots.txt',
    'sitemap.xml',
    '_headers',      # ترويسات Cloudflare
    '_redirects',    # تحويلات Cloudflare
]

# ── مجلدات تُنسخ بالكامل ──
DIRS = ['assets']

# ── ملفات بيانات مسموح بها (purchases.json مستثنى: غير مستخدم في الكود) ──
DATA_FILES = ['products.json', 'settings.json', 'wallets.json', 'suggestions.json']

# ── ما يجب ألّا يصل الإنتاج أبداً — للتوثيق والتحقق ──
FORBIDDEN = [
    '.workbuddy-ai', '.git', 'tests', 'tools',
    '.htaccess', 'admin_stitch.html', 'demo-motion.html', 'demo-otp.html',
    'supabase-schema.sql', 'supabase-security-fix.sql',
    'PRODUCTION-READINESS-AR.md', 'SECURITY-FIX-STEPS.md',
    'SETUP-ONLINE.md', 'README.md',
    'data/purchases.json',
]


def human(size):
    for unit in ('B', 'KB', 'MB'):
        if size < 1024:
            return f'{size:.0f} {unit}'
        size /= 1024
    return f'{size:.1f} GB'


def main():
    ap = argparse.ArgumentParser(description='بناء مجلد نشر نظيف')
    ap.add_argument('--keep', action='store_true', help='لا تمسح dist/ قبل البناء')
    args = ap.parse_args()

    if os.path.exists(DIST) and not args.keep:
        shutil.rmtree(DIST)
    os.makedirs(DIST, exist_ok=True)

    copied = []
    missing = []

    # 1) ملفات الجذر
    for name in ROOT_FILES:
        src = os.path.join(ROOT, name)
        if not os.path.isfile(src):
            missing.append(name)
            continue
        shutil.copy2(src, os.path.join(DIST, name))
        copied.append(name)

    # 2) المجلدات
    for name in DIRS:
        src = os.path.join(ROOT, name)
        if not os.path.isdir(src):
            missing.append(name + '/')
            continue
        shutil.copytree(src, os.path.join(DIST, name))
        for dirpath, _, files in os.walk(src):
            for f in files:
                rel = os.path.relpath(os.path.join(dirpath, f), ROOT)
                copied.append(rel.replace(os.sep, '/'))

    # 3) ملفات البيانات
    os.makedirs(os.path.join(DIST, 'data'), exist_ok=True)
    for name in DATA_FILES:
        src = os.path.join(ROOT, 'data', name)
        if not os.path.isfile(src):
            missing.append('data/' + name)
            continue
        shutil.copy2(src, os.path.join(DIST, 'data', name))
        copied.append('data/' + name)

    # ── تحقق 1: هل تسرّب شيء ممنوع؟ ──
    leaks = []
    for dirpath, _, files in os.walk(DIST):
        for f in files:
            rel = os.path.relpath(os.path.join(dirpath, f), DIST).replace(os.sep, '/')
            for bad in FORBIDDEN:
                if rel == bad or rel.startswith(bad.rstrip('/') + '/'):
                    leaks.append(rel)
            if rel.endswith(('.py', '.sql', '.md', '.bak', '.log')):
                leaks.append(rel)

    # ── تحقق 2: هل ملفات حرجة موجودة؟ ──
    critical = ['index.html', 'app.js', 'db.js', 'styles.css', 'sw.js',
                'manifest.json', '_headers', '_redirects', '404.html',
                'privacy.html', 'terms.html']
    absent = [c for c in critical if not os.path.exists(os.path.join(DIST, c))]

    # ── تحقق 3: لا أسرار في settings.json ──
    secret_warn = []
    st = os.path.join(DIST, 'data', 'settings.json')
    if os.path.isfile(st):
        import json
        with io.open(st, encoding='utf-8') as fh:
            s = json.load(fh)
        for key in ('githubToken', 'githubRepo'):
            if str(s.get(key) or '').strip():
                secret_warn.append(key)

    # ── تحقق 4: لا مفاتيح ترخيص في الكتالوج العام ──
    #  سبب وجوده — تسريب حقيقي اكتُشف: كان `licenseKeys` مكتوباً نصاً صريحاً
    #  في data/products.json، وهو ملف **منشور علناً** على الموقع. أي زائر يفتح
    #  /data/products.json كان يقرأ كل مفاتيح الترخيص بلا أي اختراق — وبلا
    #  حاجة إلى Supabase إطلاقاً. تشديد RLS وحده لا يغلق هذا المسار.
    key_leaks = []
    pj = os.path.join(DIST, 'data', 'products.json')
    if os.path.isfile(pj):
        import json
        with io.open(pj, encoding='utf-8') as fh:
            pdata = json.load(fh)
        for product in pdata.get('products', []):
            for field in ('licenseKeys', 'usedKeys'):
                if product.get(field):
                    key_leaks.append(f"{product.get('slug') or product.get('id')}.{field}")

    # ── تحقق 5: هل بقي نطاق المعاينة؟ ──
    #  ملاحظة: وجود example.com في canonical يعني أن الصفحة تُصرّح لمحركات
    #  البحث بأن نسختها الأصلية على example.com — وهذا يُسقط موقعك من النتائج.
    domain_pending = []
    for name in ('index.html', 'robots.txt', 'sitemap.xml'):
        path = os.path.join(DIST, name)
        if os.path.isfile(path):
            with io.open(path, encoding='utf-8') as fh:
                if 'example.com' in fh.read():
                    domain_pending.append(name)

    # ── التقرير ──
    total = 0
    for dirpath, _, files in os.walk(DIST):
        for f in files:
            total += os.path.getsize(os.path.join(dirpath, f))

    print('═' * 62)
    print('  بناء مجلد النشر — Cloudflare Pages')
    print('═' * 62)
    print(f'\n  📦 {DIST}')
    print(f'  📄 {len(copied)} ملفاً · {human(total)}')

    if missing:
        print(f'\n  ⚠️  مفقود ({len(missing)}): {", ".join(missing)}')

    print('\n─── التحقق الأمني ───')
    if leaks:
        print(f'  ❌ تسرّب {len(leaks)} ملفاً ممنوعاً!')
        for l in leaks[:15]:
            print(f'     · {l}')
    else:
        print('  ✅ لا ملفات تطوير ولا أسرار مرشّحة')

    if absent:
        print(f'  ❌ ملفات حرجة ناقصة: {", ".join(absent)}')
    else:
        print('  ✅ كل الملفات الحرجة موجودة')

    if secret_warn:
        print(f'  🔴 خطر: حقول سرّية مملوءة في settings.json: {", ".join(secret_warn)}')
        print('     ستُنشر علناً! أفرغها قبل النشر.')
    else:
        print('  ✅ لا مفاتيح سرّية في settings.json')

    if key_leaks:
        print(f'  🔴 خطر: مفاتيح ترخيص في الكتالوج العام ({len(key_leaks)}):')
        for k in key_leaks[:10]:
            print(f'     · {k}')
        print('     ملف products.json منشور علناً — انقل المفاتيح إلى جدول Supabase.')
    else:
        print('  ✅ لا مفاتيح ترخيص في الكتالوج العام')

    if domain_pending:
        print(f'  ⚠️  نطاق المعاينة example.com ما زال في: {", ".join(domain_pending)}')
        print('     يُنصح باستبداله بنطاقك قبل الفهرسة (لا يمنع النشر).')
    else:
        print('  ✅ النطاق الحقيقي مضبوط')

    print()
    if leaks or absent or secret_warn or key_leaks:
        print('  🛑 لا تنشر — أصلح ما سبق أولاً.')
        return 1
    print('  🎉 جاهز للنشر: اسحب مجلد dist/ إلى Cloudflare Pages')
    return 0


if __name__ == '__main__':
    sys.exit(main())
