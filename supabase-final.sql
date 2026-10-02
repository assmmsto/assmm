-- ═══════════════════════════════════════════════════════════════════════════
--  الملف النهائي — التسليم والمفاتيح على الطلب نفسه  [نسخة مُصحَّحة 2026-10]
--  معرض الأعمال (Nova)  ·  شغّله من: Supabase → SQL Editor → Run
--  آمن للتشغيل أكثر من مرة (idempotent).
-- ═══════════════════════════════════════════════════════════════════════════
--
--  ما يفعله هذا الملف (وما أُصلح فيه في هذه النسخة):
--
--  ١) عمودا التسليم deliveryUrl · deliveryNote على الطلبات — يُكتبان لحظة
--     التأكيد فلا يظهر رابط منتج مدفوع في الكتالوج المنشور علناً.
--
--  ٢) دالة المتابعة get_order_by_reference تُعيد التسليم مع الحالة —
--     يقرأ المشتري طلبه وحده بمرجعه، ولا يستطيع أحد سرد الطلبات كلها.
--
--  ٣) دالة التأكيد admin_confirm_order (٥ معاملات) تكتب المفتاح + التسليم
--     معاً، **وأصلحت فيها عيباً جوهرياً**: كانت تكتب أي مفتاح يُمرَّر بلا
--     تحقق ولا تحفظ usedKeys — فكان مخزون الترخيص وهمياً: بعد أي تحديث
--     للصفحة يُعاد المفتاح نفسه للمشتري التالي (ازدواج بيع).
--     الآن الدالة نفسها (security definer):
--       · ترفض التأكيد لمنتج «مفتاح» بلا مفتاح مُمرَّر      → license-key-required
--       · ترفض مفتاحاً ليس في مخزون المنتج                  → license-key-invalid
--       · ترفض مفتاحاً استُهلك سابقاً                        → license-key-used
--       · وعند النجاح تُضيف المفتاح إلى products.usedKeys فوراً — فالحفظ
--         يقع في القاعدة لا في ذاكرة متصفح الأدمن.
--
--  ٤) جدول الأسرار app_secrets مغلق تماماً + دالة حذف الطلبات للتنظيف.
--
--  ⚠️ السرّ: **لم يُكتب سرّ في هذا الملف عمداً** — لأن كتابته في ملف قد يُرفع
--  لمستودع عام يعني كشفه. والسرّ موجود أصلاً في قاعدتك من تشغيل
--  supabase-admin-confirm.sql سابقاً وسيبقى كما هو.
--  إن أردت تجديده، نفّذ في محرر SQL (وقيمة جديدة كل مرة):
--      insert into app_secrets (name, value)
--      values ('admin_confirm', '<سرّ-عشوائي-40-محرفاً>')
--      on conflict (name) do update set value = excluded.value, updated_at = now();
--  ثم ضع **القيمة نفسها** في اللوحة → الإعدادات → «سرّ تأكيد الطلبات».
--  لتوليد سرّ قوي:  python -c "import secrets; print(secrets.token_urlsafe(30))"
-- ═══════════════════════════════════════════════════════════════════════════


-- ── ٠) الأسرار: جدول مغلق تماماً أمام الواجهة ──
--  لا يقرأه ولا يكتبه أي عميل (revoke كامل) — تقرؤه الدوال security definer فقط.
create table if not exists app_secrets (
  name       text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);
alter table app_secrets enable row level security;
revoke all on app_secrets from anon, authenticated, public;

-- تنبيه (لا يُنشئ شيئاً): لو غاب السرّ تذكّرك به عند التشغيل
do $$
declare
  missing int;
begin
  select count(*) into missing from app_secrets where name = 'admin_confirm';
  if missing = 0 then
    raise notice '⚠️ سرّ التأكيد غير مضبوط. نفّذ: insert into app_secrets (name, value) values (''admin_confirm'', ''<سرّ-عشوائي-40+>'');';
  else
    raise notice '✅ سرّ التأكيد موجود (لن يُلمس ولا يُستبدل بهذا الملف)';
  end if;
end $$;


-- ── ١) أعمدة التسليم على الطلب ──
alter table orders add column if not exists "deliveryUrl"   text;
alter table orders add column if not exists "deliveryNote"  text;
alter table orders add column if not exists "rejectReason"  text;


-- ── ٢) دالة المتابعة: تُعيد التسليم مع الحالة ──
--  تغيير نوع الإرجاع يحتاج حذفاً أولاً (create or replace لا تكفي).
--  تُعيد صفاً واحداً بمرجعه فقط — ولا تكشف اسم المشتري ولا إثبات دفعه.
-- deliveryUrl و licenseKey لا يُكتبان إلا عند التأكيد، فلا يقرأهما أحد قبل الدفع.
drop function if exists get_order_by_reference(text);
create function get_order_by_reference(ref text)
returns table (
  reference      text,
  "productId"    int,
  "productName"  text,
  total          numeric,
  currency       text,
  status         text,
  "licenseKey"   text,
  "deliveryUrl"  text,
  "deliveryNote" text,
  "rejectReason" text,
  "createdAt"    text
)
language sql
security definer
set search_path = public
as $$
  select o.reference, o."productId", o."productName", o.total, o.currency,
         o.status, o."licenseKey", o."deliveryUrl", o."deliveryNote",
         o."rejectReason", o."createdAt"::text
  from orders o
  where o.reference = ref
  limit 1;
$$;

revoke all on function get_order_by_reference(text) from public;
grant execute on function get_order_by_reference(text) to anon, authenticated;


-- ── ٣) دالة التأكيد: المفتاح + التسليم معاً + تحديث المخزون ──
drop function if exists admin_confirm_order(text, text, text, text, text);
drop function if exists admin_confirm_order(text, text, text);
create function admin_confirm_order(
  p_ref            text,
  p_key            text,
  p_secret         text,
  p_delivery_url   text default null,
  p_delivery_note  text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  expected   text;
  updated    int;
  v_order    orders;
  v_mode     text;
  v_keys     jsonb;
  v_used     jsonb;
  v_key      text;
begin
  -- (أ) السرّ أولاً — قبل أي كشف عن وجود المرجع من عدمه
  select value into expected from app_secrets where name = 'admin_confirm';
  if expected is null then
    raise exception 'confirm-secret-not-configured' using errcode = '42501';
  end if;
  if p_secret is null or length(p_secret) < 16 or p_secret <> expected then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if p_ref is null or length(trim(p_ref)) = 0 then
    raise exception 'reference-required' using errcode = '22023';
  end if;

  -- (ب) الطلب موجود؟
  select * into v_order from orders where reference = trim(p_ref) limit 1;
  if v_order.id is null then
    return false;   -- لا طلب بهذا المرجع
  end if;

  v_key := nullif(trim(coalesce(p_key, '')), '');

  -- (ج) التحقق من المفتاح ضد مخزون المنتج — هنا كان ثقب الازدواج
  if v_order."productId" is not null then
    select p."licenseMode",
           p."licenseKeys",
           coalesce(p."usedKeys", '[]'::jsonb)
      into v_mode, v_keys, v_used
      from products p
     where p.id = v_order."productId"
     limit 1;

    -- منتج «مفتاح» ومخزونه غير فارغ ⇒ لا تأكيد بلا مفتاح صالح
    if v_mode = 'key'
       and v_keys is not null
       and jsonb_typeof(v_keys) = 'array'
       and jsonb_array_length(v_keys) > 0 then

      if v_key is null then
        raise exception 'license-key-required' using errcode = '22023';
      end if;
      -- المفتاح يجب أن يكون عنصراً في المخزون (؟ يفحص عناصر المصفوفة النصية)
      if not (v_keys ? v_key) then
        raise exception 'license-key-invalid' using errcode = '22023';
      end if;
      -- ويجب ألا يكون مستهلكاً سابقاً — هذا ما يمنع بيع المفتاح مرتين
      if (v_used ? v_key) then
        raise exception 'license-key-used' using errcode = '22023';
      end if;
    end if;
  end if;

  -- (د) التأكيد نفسه
  update orders
     set status         = 'confirmed',
         "licenseKey"   = coalesce(v_key, ''),
         "deliveryUrl"  = coalesce(p_delivery_url, ''),
         "deliveryNote" = coalesce(p_delivery_note, ''),
         "confirmedAt"  = now()
   where id = v_order.id;
  get diagnostics updated = row_count;

  -- (هـ) حفظ الاستهلاك في **القاعدة** لا في ذاكرة المتصفح — جوهر الإصلاح
  if v_key is not null and v_mode = 'key' then
    update products
       set "usedKeys" = coalesce("usedKeys", '[]'::jsonb) || to_jsonb(v_key)
     where id = v_order."productId";
  end if;

  return updated > 0;
end;
$$;

revoke all on function admin_confirm_order(text, text, text, text, text) from public;
grant execute on function admin_confirm_order(text, text, text, text, text) to anon, authenticated;


-- ── ٣ب) دالة الرفض — سبب الرفض **إجباري** ويصل للمشتري في صفحة طلباته ──
--  · ترفض العمل بلا سبب أو بسبب أقصر من 5 محارف      → reason-required / reason-too-short
--  · لا تُرفض حالة «مؤكَّد» (المال وصل — الرفض خلفه خطأ محاسبي)
--    ولا حالة «مرفوض» سابقاً — WHERE status='pending' يضمن ذلك.
drop function if exists admin_reject_order(text, text, text);
create function admin_reject_order(
  p_ref     text,
  p_secret  text,
  p_reason  text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  expected text;
  updated  int;
  v_reason text;
begin
  select value into expected from app_secrets where name = 'admin_confirm';
  if expected is null then
    raise exception 'confirm-secret-not-configured' using errcode = '42501';
  end if;
  if p_secret is null or length(p_secret) < 16 or p_secret <> expected then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if p_ref is null or length(trim(p_ref)) = 0 then
    raise exception 'reference-required' using errcode = '22023';
  end if;

  v_reason := nullif(trim(coalesce(p_reason, '')), '');
  if v_reason is null then
    raise exception 'reason-required' using errcode = '22023';
  end if;
  if length(v_reason) < 5 then
    raise exception 'reason-too-short' using errcode = '22023';
  end if;

  update orders
     set status        = 'rejected',
         "rejectReason" = v_reason,
         "confirmedAt"  = null,
         "licenseKey"   = ''
   where reference = trim(p_ref)
     and status = 'pending';
  get diagnostics updated = row_count;
  return updated > 0;
end;
$$;

revoke all on function admin_reject_order(text, text, text) from public;
grant execute on function admin_reject_order(text, text, text) to anon, authenticated;

-- ── ٤) دالة الحذف (تنظيف طلبات تجريبية أو مزعجة) ──
drop function if exists admin_delete_order(text, text);
create function admin_delete_order(p_ref text, p_secret text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  expected text;
  removed  int;
begin
  select value into expected from app_secrets where name = 'admin_confirm';
  if expected is null or p_secret is null or length(p_secret) < 16 or p_secret <> expected then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  delete from orders where reference = p_ref;
  get diagnostics removed = row_count;
  return removed > 0;
end;
$$;

revoke all on function admin_delete_order(text, text) from public;
grant execute on function admin_delete_order(text, text) to anon, authenticated;


-- ── ٥) تحقّق ──
do $$
begin
  raise notice 'عمود deliveryUrl: %', (select count(*) from information_schema.columns
    where table_name = 'orders' and column_name = 'deliveryUrl');
  raise notice 'دالة المتابعة تُعيد deliveryUrl: %', (select count(*) from information_schema.columns
    where table_name = 'get_order_by_reference' and column_name = 'deliveryUrl');
  raise notice 'دالة التأكيد (5 معاملات) بالتحقق من المفتاح: %', (select count(*) from pg_proc
    where proname = 'admin_confirm_order' and pronargs = 5);
  raise notice 'دالة الحذف: %', (select count(*) from pg_proc where proname = 'admin_delete_order');
  raise notice 'دالة الرفض (سبب إجباري): %', (select count(*) from pg_proc where proname = 'admin_reject_order');
  raise notice 'عمود rejectReason: %', (select count(*) from information_schema.columns
    where table_name = 'orders' and column_name = 'rejectReason');
  raise notice 'دالة المتابعة تُعيد rejectReason: %', (select count(*) from information_schema.columns
    where table_name = 'get_order_by_reference' and column_name = 'rejectReason');
  raise notice 'سياسات app_secrets (يجب 0): %', (select count(*) from pg_policies where tablename = 'app_secrets');
  raise notice 'سرّ admin_confirm مضبوط: %', (select count(*) from app_secrets where name = 'admin_confirm');
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
--  بعد التشغيل:
--    ١) لوحة الأدمن → الإعدادات → «سرّ تأكيد الطلبات» = نفس السرّ الموجود في
--       app_secrets (إن جدّدته بالأمر أعلاه ضع القيمة الجديدة).
--    ٢) لكل منتج مدفوع: افتحه → «طريقة التسليم» → ضع الرابط (يُحفظ في متصفحك
--       ولا يُنشر — ولا يُكتب على الطلب إلا عند تأكيدك).
--    ٣) لكل منتج بمفتاح: أضف المفاتيح في «مفاتيح الترخيص» (سطر لكل مفتاح) —
--       وستُحفظ استهلاكاتها في القاعدة تلقائياً عند كل تأكيد.
--
--  للتحقق من كل شيء:   python tools/live-check.py
--  لتنظيف طلبات الفحص:  delete from orders where reference like 'ZZ%';
-- ═══════════════════════════════════════════════════════════════════════════
