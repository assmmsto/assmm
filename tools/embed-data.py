#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
تضمين نسخة من بيانات data/*.json داخل صفحات HTML — أداة توليد.

لماذا؟
  فتح index.html بالنقر المزدوج (file://) يمنع المتصفح من fetch لملفات JSON
  المحلية — قيد أمني في كل المتصفحات. والمشتري أو المالك قد يفتح الصفحة هكذا،
  فيرى متجراً فارغاً بلا سبب واضح.

الحل:
  وسم <script type="application/json"> داخل الصفحة يحمل نسخة من البيانات.
  ووسم السكربت غير القابل للتنفيذ لا يُحجبه CSP ولا يحتاج شبكة — فيعمل على
  file:// كما يعمل على http. وapp.js يستخدمه كاحتياط **فقط** حين يفشل الجلب.

  المصدر يبقى data/*.json. هذه الأداة تُولّد النسخة، فلا تنشأ حقيقتان:
      python tools/embed-data.py
  شغّلها بعد أي تعديل على ملفات data/*.json.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_FILES = ("products", "settings", "wallets")
PAGES = ("index.html", "admin.html")

MARKER = "<!-- ═══ البيانات المضمّنة (احتياط للعمل بلا خادم) — تُولَّد بـ tools/embed-data.py ═══ -->"
BLOCK_RE = re.compile(
    r"<!--[^\n]*البيانات المضمّنة[^\n]*-->\s*<script id=\"nova-data\"[^>]*>.*?</script>",
    re.DOTALL,
)


def load_data() -> dict:
    out = {}
    for name in DATA_FILES:
        path = ROOT / "data" / f"{name}.json"
        if not path.exists():
            print(f"  ! لا يوجد {path.name} — تخطّي")
            continue
        try:
            out[name] = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            print(f"  ✗ {path.name}: JSON غير صالح — {exc}")
            sys.exit(1)
    return out


def build_block(data: dict) -> str:
    # ensure_ascii=False ليقرأه الإنسان، و<\/script> لا يقطع الوسم
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    payload = payload.replace("</", "<\\/")
    return f'{MARKER}\n  <script id="nova-data" type="application/json">{payload}</script>'


def patch_page(path: Path, block: str) -> str:
    html = path.read_text(encoding="utf-8")
    if BLOCK_RE.search(html):
        html = BLOCK_RE.sub(lambda _m: block, html, count=1)
        action = "حُدِّثت"
    else:
        # الإدراج قبل أول وسم سكربت خارجي — فتُقرأ البيانات قبل تشغيل app.js
        anchor = re.search(r'[ \t]*<script src="', html)
        if not anchor:
            return f"✗ {path.name}: لم أجد موضع الإدراج"
        indent = "  "
        html = html[: anchor.start()] + indent + block + "\n" + html[anchor.start() :]
        action = "أُضيفت"
    path.write_text(html, encoding="utf-8")
    return f"✓ {path.name}: {action} ({len(block) // 1024} ك.ب)"


def main() -> int:
    print("═══ تضمين بيانات data/*.json في الصفحات ═══")
    data = load_data()
    if not data:
        print("✗ لا بيانات — لا شيء يُضمَّن.")
        return 1

    counts = ", ".join(
        f"{k}={len(v.get('products') or v.get('wallets') or []) or '…'}" for k, v in data.items()
    )
    print(f"  المصدر: {counts}")

    block = build_block(data)
    ok = True
    for page in PAGES:
        target = ROOT / page
        if not target.exists():
            print(f"  ! لا يوجد {page} — تخطّي")
            continue
        result = patch_page(target, block)
        print("  " + result)
        ok = ok and result.startswith("✓")

    print("═══ تمّ ═══")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
