#!/usr/bin/env bash
# =========================================================================
# اختبارات DOM الحقيقية — معرض الأعمال (Nova)
# ─────────────────────────────────────────────────────────────────────────
# تشغّل صفحات المشروع الفعلية (index.html / admin.html) داخل jsdom،
# تتصل فعلياً بـ Supabase، وتحاكي تفاعلات حقيقية.
#
# الاستخدام:   bash tests/run.sh
# المتطلبات:   Node 18+  ·  jsdom + @supabase/supabase-js
# =========================================================================
set -u
cd "$(dirname "$0")/.."

# ── تحديد Node ──
NODE_BIN="${NODE_BIN:-}"
if [ -z "$NODE_BIN" ]; then
  for cand in \
    "C:/Users/$USERNAME/.workbuddy-ai/binaries/node/versions/22.22.2-3/node.exe" \
    "$HOME/.workbuddy-ai/binaries/node/versions/22.22.2-3/node.exe" \
    "C:/Users/$USERNAME/.workbuddy-ai/binaries/node/versions/22.22.2-2/node.exe" \
    "$HOME/.workbuddy-ai/binaries/node/versions/22.22.2-2/node.exe" \
    "node"; do
    if command -v "$cand" >/dev/null 2>&1 || [ -x "$cand" ]; then NODE_BIN="$cand"; break; fi
  done
fi
if [ -z "$NODE_BIN" ]; then
  echo "❌ لم يُعثر على Node — ثبّته أو مرّر المسار: NODE_BIN=/path/to/node bash tests/run.sh"
  exit 2
fi

# ── تحديد مسار الحِزم (jsdom) ──
if [ -z "${NODE_PATH:-}" ]; then
  for cand in \
    "C:/Users/$USERNAME/.workbuddy-ai/binaries/node/workspace/node_modules" \
    "$HOME/.workbuddy-ai/binaries/node/workspace/node_modules" \
    "./node_modules"; do
    if [ -d "$cand/jsdom" ]; then export NODE_PATH="$cand"; break; fi
  done
fi
if [ -z "${NODE_PATH:-}" ] || [ ! -d "$NODE_PATH/jsdom" ]; then
  echo "❌ jsdom غير مثبّت — نفّذ:  npm i jsdom @supabase/supabase-js"
  exit 2
fi

echo "════════════════════════════════════════════════════"
echo "  اختبارات DOM الحقيقية — معرض الأعمال"
echo "════════════════════════════════════════════════════"
fail=0
fail_list=""
# flow-e2e أولاً: يقود الرحلة كاملة (تصفّح → شراء → أدمن → تتبّع) في وضع محلي
for t in flow-e2e dom-index dom-admin dom-checkout; do
  echo ""
  "$NODE_BIN" "tests/$t.js" || { fail=$((fail + 1)); fail_list="$fail_list $t"; }
done

echo ""
if [ "$fail" -eq 0 ]; then
  echo "🎉 كل اختبارات DOM ناجحة"
  exit 0
else
  echo "❌ $fail ملف اختبار فشل:$fail_list"
  exit 1
fi
