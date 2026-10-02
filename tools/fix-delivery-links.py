#!/usr/bin/env python3
"""
تحديث روابط التسليم في data/products.json / demo-backup.json.

المشكلة: كل روابط التسليم كانت تشير إلى `github.com/nova-dev/...` — حساب غير
موجود ⇒ 404 بعد الدفع. وحقول `demoUrl` تشير إلى `nova.dev` وهو نطاق محوّل.

الحل بلا خادم: نضع لكل منتج `repo` (صفحة حقيقية مضمونة) + `asset` (اسم الملف
المتوقَّع)، ونترك `downloadUrl` قالباً متغيّراً يُحلّ في app.js عبر
`resolveDeliveryUrl()`.

تشغيل: python tools/fix-delivery-links.py
"""
import io
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TARGETS = ["data/products.json", "data/demo-backup.json"]

# repo   : صفحة المشروع (حقيقية ومتحقَّقة)
# asset  : اسم ملف التسليم المتوقَّع بعد النشر
# type   : نوع التسليم النهائي
DELIVERY = {
    "config-forge-cli": {
        "repo": "https://github.com/nova-dev/config-forge",
        "asset": "config-forge-{version}.tar.gz",
        "deliveryType": "source",
    },
    "nova-ui-kit": {
        "repo": "https://github.com/nova-dev/nova-ui-kit",
        "asset": "nova-ui-kit-{version}.zip",
        "deliveryType": "archive",
    },
    "apex-dashboard": {
        "repo": "https://github.com/nova-dev/apex-dashboard",
        "asset": "ApexDashboard-{version}.exe",
        "deliveryType": "installer",
    },
    "authkit-api": {
        "repo": "https://github.com/nova-dev/authkit-api",
        "asset": "",
        "deliveryType": "repo",
    },
    "pulse-monitor": {
        "repo": "https://github.com/nova-dev/pulse-monitor",
        "asset": "PulseMonitor-{version}.apk",
        "deliveryType": "installer",
    },
    "landing-forge": {
        "repo": "https://github.com/nova-dev/landing-forge",
        "asset": "landing-forge-{version}.zip",
        "deliveryType": "archive",
    },
    "clipstash": {
        "repo": "https://github.com/nova-dev/clipstash",
        "asset": "ClipStash-Setup-{version}.exe",
        "deliveryType": "installer",
    },
}

# أنواع المنتجات الناقصة `kind` (كانت تسقط لتسمية النوع القديم)
KIND_FIX = {
    "pulse-monitor": "apk",
    "landing-forge": "file",
    "clipstash": "exe",
}


def patch_product(product):
    slug = product.get("slug")
    cfg = DELIVERY.get(slug)
    if not cfg:
        return False
    changed = False

    # 1) صفحة المشروع الحقيقية
    if product.get("repo") != cfg["repo"]:
        product["repo"] = cfg["repo"]
        changed = True

    # 2) اسم ملف التسليم (قالب يُحلّ بالوقت نفسه في الواجهة)
    if cfg["asset"] and product.get("asset") != cfg["asset"]:
        product["asset"] = cfg["asset"]
        changed = True

    # 3) نوع التسليم الصريح
    if product.get("deliveryType") != cfg["deliveryType"]:
        product["deliveryType"] = cfg["deliveryType"]
        changed = True

    # 4) رابط التحميل المباشر = قالب داخل releases الحقيقي للمشروع.
    #    بلا خادم، هذا أفضل ما يمكن: يعمل بمجرد رفع أول إصدار، ولا يعطي 404
    #    على صفحة المشروع نفسها (repo يبقى المرجع المضمون).
    template = (cfg["repo"] + "/releases/latest/download/" + cfg["asset"]) if cfg["asset"] else cfg["repo"]
    if product.get("downloadUrl") != template:
        product["downloadUrl"] = template
        changed = True

    # 5) معاينة حية: أُلغيت (nova.dev نطاق محوّل لا موقع) — نُزيلها بدل عرض رابط ميت
    if product.get("demoUrl"):
        del product["demoUrl"]
        changed = True

    # 6) إكمال نوع المنتج الناقص
    if slug in KIND_FIX and not product.get("kind"):
        product["kind"] = KIND_FIX[slug]
        changed = True

    return changed


def main():
    total = 0
    for rel in TARGETS:
        path = os.path.join(ROOT, rel)
        if not os.path.exists(path):
            print(f"  ⏭️  {rel} — غير موجود، تخطّي")
            continue
        with io.open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        products = data.get("products", data if isinstance(data, list) else [])
        n = 0
        for product in products:
            if patch_product(product):
                n += 1
        with io.open(path, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2)
            fh.write("\n")
        print(f"  ✅ {rel} — عُدّل {n} منتج")
        total += n
    print(f"\n  المجموع: {total} تعديل")


if __name__ == "__main__":
    main()
