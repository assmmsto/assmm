#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
فحص حيّ لقاعدة البيانات — أداة تشخيص حقيقية.

لماذا؟
  اختبارات jsdom تختبر المنطق بمصادر مُحاكاة، ولا تلمس القاعدة الحقيقية.
  فتمرّ الاختبارات خضراء والتدفّق معطّل في الإنتاج. هذه الأداة تسأل القاعدة
  نفسها — بنفس المفتاح العام الذي يستخدمه الزائر — وتقول ما يعمل وما لا يعمل.

الاستخدام:
    python tools/live-check.py

تقرأ رابط القاعدة ومفتاحها من data/settings.json، ثم تختبر بالترتيب:
  ١. قراءة الكتالوج            (يحتاجه الزائر)
  ٢. وجود دالة المتابعة الآمنة  (يحتاجها المشتري)
  ٣. إدراج طلب جديد            (يحتاجه المشتري عند الشراء)
  ٤. قراءة الطلب بالمرجع        (يحتاجه المشتري في التتبّع)
  ٥. تحديث الطلب (تأكيد)        (يحتاجه الأدمن — يجب أن يُرفض للزائر)
  ٦. سرد الطلبات                (يجب أن يُرفض للزائر)
  ٧. تنظيف أثر الاختبار
"""
from __future__ import annotations

import json
import re
import secrets
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# مرجع فريد لكل تشغيل — وإلا اصطدم بالطلب السابق (409 duplicate key).
# البادئة ZZ ثابتة لتسهيل التنظيف:  delete from orders where reference like 'ZZ%';
TEST_REF = "ZZ" + "".join(secrets.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(4))
OK, BAD, WARN = "✅", "❌", "⚠️ "


def confirm_secret() -> str | None:
    """يقرأ سرّ التأكيد من supabase-admin-confirm.sql — فلا حاجة لإدخاله يدوياً."""
    path = ROOT / "supabase-admin-confirm.sql"
    if not path.exists():
        return None
    match = re.search(
        r"values\s*\(\s*'admin_confirm'\s*,\s*'([^']+)'\s*\)",
        path.read_text(encoding="utf-8"),
    )
    return match.group(1) if match else None


def settings() -> tuple[str, str]:
    path = ROOT / "data" / "settings.json"
    cfg = json.loads(path.read_text(encoding="utf-8"))
    url = str(cfg.get("supabaseUrl") or "").strip().rstrip("/")
    key = str(cfg.get("supabaseKey") or "").strip()
    if not url or not key:
        print(f"{BAD} لا يوجد supabaseUrl/supabaseKey في data/settings.json — الوضع محلي بالكامل.")
        sys.exit(2)
    return url, key


def call(url: str, key: str, path: str, method: str = "GET", body=None, prefer: str | None = None):
    req = urllib.request.Request(
        url + path,
        method=method,
        data=json.dumps(body).encode("utf-8") if body is not None else None,
        headers={
            "apikey": key,
            "Authorization": "Bearer " + key,
            "Content-Type": "application/json",
            **({"Prefer": prefer} if prefer else {}),
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=25) as res:
            raw = res.read().decode("utf-8", "replace")
            try:
                return res.status, json.loads(raw) if raw else None
            except json.JSONDecodeError:
                return res.status, raw
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", "replace")
        try:
            return exc.code, json.loads(raw)
        except json.JSONDecodeError:
            return exc.code, raw
    except Exception as exc:  # noqa: BLE001 — الشبكة حالة مدعومة
        return 0, str(exc)


def main() -> int:
    url, key = settings()
    print("═" * 62)
    print("  فحص حيّ لقاعدة البيانات — معرض الأعمال")
    print("  " + url)
    print("═" * 62)

    verdicts: list[tuple[str, str]] = []

    def line(ok: bool, label: str, detail: str = "", warn: bool = False) -> None:
        mark = WARN if warn else (OK if ok else BAD)
        print(f"  {mark} {label}" + (f"  → {detail}" if detail else ""))
        verdicts.append((label, mark))

    # ١) الكتالوج
    status, data = call(url, key, "/rest/v1/products?select=id,slug,status&order=id")
    count = len(data) if isinstance(data, list) else 0
    line(status == 200 and count > 0, "قراءة الكتالوج", f"HTTP {status} · {count} منتج")

    local = json.loads((ROOT / "data" / "products.json").read_text(encoding="utf-8"))["products"]
    if isinstance(data, list) and count:
        db_ids = {p["id"] for p in data}
        missing = [p["slug"] for p in local if p["id"] not in db_ids]
        line(not missing, "تطابق الكتالوج المحلي والقاعدة",
             "متطابق" if not missing else f"غائب من القاعدة: {', '.join(missing)}", warn=bool(missing))

    # ٢) دالة المتابعة
    status, data = call(url, key, "/rest/v1/rpc/get_order_by_reference", "POST", {"ref": "__none__"})
    rpc_ok = status == 200
    line(rpc_ok, "دالة المتابعة الآمنة موجودة",
         f"HTTP {status}" if rpc_ok else f"HTTP {status} — شغّل supabase-security-fix.sql")

    # ٣) إدراج طلب (كما يفعل المشتري)
    row = {
        "reference": TEST_REF, "productId": 3, "productName": "طلب فحص حيّ",
        "price": 29, "currency": "USD", "total": 29, "status": "pending",
        "payerName": "فحص", "payerRef": "TX-LIVE", "createdAt": "2026-01-01T00:00:00.000Z",
    }
    status, data = call(url, key, "/rest/v1/orders", "POST", [row])
    inserted = status in (200, 201)
    line(inserted, "إدراج طلب جديد (المشتري)",
         f"HTTP {status}" if inserted else f"HTTP {status} — {str(data)[:90]}")

    # ٤) قراءة الطلب بالمرجع (المشتري)
    status, data = call(url, key, "/rest/v1/rpc/get_order_by_reference", "POST", {"ref": TEST_REF})
    found = status == 200 and isinstance(data, list) and len(data) == 1
    line(found, "قراءة الطلب بالمرجع (المشتري)",
         f"HTTP {status} · الحالة {data[0].get('status')}" if found else f"HTTP {status} — لم يُقرأ")

    # ٥) التأكيد: المسار الحقيقي الذي يستخدمه الأدمن
    #    يُقرأ السرّ من supabase-admin-confirm.sql مباشرة — فلا حاجة لإدخاله.
    secret = confirm_secret()
    if not secret:
        line(False, "سرّ التأكيد", "لم أجد admin_confirm في supabase-admin-confirm.sql", warn=True)
    else:
        DELIVERY = "https://example.org/delivery.zip"
        status, data = call(url, key, "/rest/v1/rpc/admin_confirm_order", "POST",
                            {"p_ref": TEST_REF, "p_key": "ZZ-LIVE-KEY", "p_secret": secret,
                             "p_delivery_url": DELIVERY, "p_delivery_note": "ملاحظة الفحص"})
        confirmed = status == 200 and data is True
        detail = f"HTTP {status}"
        if not confirmed:
            msg = str(data)
            if "Could not find the function" in msg or "does not exist" in msg:
                detail += " — الدالة غير مُنشأة، شغّل supabase-admin-confirm.sql"
            elif "unauthorized" in msg:
                detail += " — السرّ في القاعدة لا يطابق الملف"
            else:
                detail += " — " + msg[:80]
        line(confirmed, "تأكيد الطلب بالسرّ (الأدمن)", detail if not confirmed else "HTTP 200 · تأكّد")

        # ٦) هل يرى المشتري التأكيد؟ — هذا هو بيت القصيد
        if confirmed:
            status, data = call(url, key, "/rest/v1/rpc/get_order_by_reference", "POST", {"ref": TEST_REF})
            row = data[0] if (isinstance(data, list) and data) else {}
            seen = (status == 200 and row.get("status") == "confirmed"
                    and row.get("licenseKey") == "ZZ-LIVE-KEY"
                    and row.get("deliveryUrl") == DELIVERY)
            line(seen, "المشتري يرى التأكيد والمفتاح ورابط التسليم",
                 f"الحالة {row.get('status')} · المفتاح {row.get('licenseKey')} · التسليم {row.get('deliveryUrl')}"
                 if seen else f"ناقص — {row}")

        # ٧) هل يستطيع الزائر التأكيد بسرّ خاطئ؟ يجب أن يُرفض — بشرط وجود الدالة
        status, data = call(url, key, "/rest/v1/rpc/admin_confirm_order", "POST",
                            {"p_ref": TEST_REF, "p_key": "HACKED", "p_secret": "x" * 20})
        if status == 404:
            line(False, "السرّ الخاطئ مرفوض (صحيح أمنياً)",
                 "لا يمكن الفحص — الدالة غير مُنشأة بعد", warn=True)
        else:
            refused = status >= 400
            line(refused, "السرّ الخاطئ مرفوض (صحيح أمنياً)",
                 f"HTTP {status}" + ("" if refused else " ← خطر: يمكن تأكيد الطلبات بلا سرّ!"),
                 warn=refused)

    # ٨) تحديث مباشر للجدول — يجب أن يُرفض للزائر
    status, data = call(url, key, f"/rest/v1/orders?reference=eq.{TEST_REF}", "PATCH",
                        {"status": "confirmed", "licenseKey": "ZZ-DIRECT"})
    denied = status in (401, 403)
    line(denied, "التحديث المباشر مرفوض للزائر (صحيح أمنياً)",
         f"HTTP {status}" + ("" if denied else " ← خطر!"), warn=denied)

    # ٩) سرد الطلبات — يجب أن يُرفض
    status, data = call(url, key, "/rest/v1/orders?select=reference&limit=1")
    denied = status in (401, 403)
    line(denied, "سرد الطلبات مرفوض للزائر (صحيح أمنياً)",
         f"HTTP {status}" + ("" if denied else " ← خطر: بيانات المشترين مكشوفة!"), warn=denied)

    # ١٠) تنظيف أثر الاختبار
    status, data = call(url, key, "/rest/v1/orders?reference=eq." + TEST_REF, "DELETE")
    cleaned = status in (200, 204)
    if not cleaned and secret:
        status, data = call(url, key, "/rest/v1/rpc/admin_delete_order", "POST",
                            {"p_ref": TEST_REF, "p_secret": secret})
        cleaned = status == 200 and data is True
    line(cleaned, "تنظيف أثر الاختبار",
         "حُذف" if cleaned else f"HTTP {status} — احذف المرجع {TEST_REF} يدوياً من لوحة Supabase",
         warn=cleaned)

    print("─" * 62)
    fails = [l for l, m in verdicts if m == BAD]
    warns = [l for l, m in verdicts if m == WARN]
    print(f"  النتيجة: {len(verdicts) - len(fails)} ناجح · {len(fails)} فاشل · {len(warns)} ملاحظة")
    if fails:
        print("  فاشلة: " + " · ".join(fails))
    print("─" * 62)
    print()
    print("  ما يعنيه ذلك:")
    print("   · إن فشل «إدراج طلب» أو «قراءة الطلب» ⇒ المشتري لا يستطيع الشراء ولا التتبّع.")
    print("   · إن فشل «تأكيد الطلب بالسرّ» ⇒ الأدمن لا يستطيع التأكيد، والمشتري لن يرى شيئاً.")
    print("     الحل: شغّل supabase-admin-confirm.sql من محرّر SQL في Supabase (مرة واحدة).")
    print("   · نجاح «التحديث المرفوض للزائر» هو المطلوب أمنياً — وليس عطلاً.")
    print("   · إن ظهر التأكيد بلا رابط تسليم ⇒ اضبط «طريقة التسليم» للمنتج في اللوحة.")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
