-- ═══════════════════════════════════════════════════════════════════════════
--  تأكيد الطلبات بلا حساب — دالة SECURITY DEFINER بسرّ مشترك
--  معرض الأعمال (Nova)  ·  شغّله مرة واحدة من: Supabase → SQL Editor → Run
-- ═══════════════════════════════════════════════════════════════════════════
--
--  لماذا هذا الملف؟
--  ────────────────
--  سياسات إصلاح الأمان تمنح الزائر (anon) **إدراجاً فقط** على جدول الطلبات:
--      revoke all on orders from anon, authenticated;
--      grant insert on orders to anon;
--      grant select, insert, update, delete on orders to authenticated;
--  وسياسة «orders: إدارة للموثّقين» موجّهة إلى authenticated وحده.
--
--  النتيجة المؤكَّدة عملياً (اختُبرت على القاعدة الحقيقية):
--      POST /rest/v1/orders           → 201  ✅ المشتري يُدرج طلبه
--      POST /rpc/get_order_by_reference → 200  ✅ المشتري يقرأ طلبه
--      PATCH /rest/v1/orders          → 401  ❌ الأدمن لا يستطيع التأكيد
--
--  الحل: دالة تعمل بصلاحيات مالك القاعدة (security definer)، فلا تحتاج
--  صلاحيات الجدول، وتتحقّق من **سرّ** قبل أن تُحدّث. فالزائر يملك تنفيذ
--  الدالة لكنه لا يملك السرّ — ولا يستطيع تأكيد أي طلب.
--
--  ⚠️ لماذا جدول `app_secrets` وليس ملف الإعدادات؟
--  لأن `data/settings.json` **منشور علناً** — أي سرّ فيه يصير معروفاً للجميع.
--  والجدول هنا بلا أي سياسة RLS ⇒ لا قراءة ولا كتابة لأي دور عبر REST.
--
--  ⚠️ السرّ المُدرَج أدناه وُلِّد عشوائياً (40 محرفاً ≈ 238 بت). انسخه كما هو
--  والصقه في لوحة الأدمن → تبويب الإعدادات → «سرّ تأكيد الطلبات». وإن أردت
--  تغييره لاحقاً، غيّره في المكانين معاً (هنا وفي اللوحة).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1) جدول الأسرار: مغلق تماماً أمام REST ──
create table if not exists app_secrets (
  name       text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

alter table app_secrets enable row level security;

-- لا سياسات إطلاقاً ⇒ RLS يمنع كل شيء. وسحب المنح صراحةً طبقة ثانية.
revoke all on app_secrets from anon, authenticated, public;

-- ── 2) السرّ ──
insert into app_secrets (name, value)
values ('admin_confirm', 'Gvb9wjVhCeviLpyVd8U9CKAcfFswDhL6mWCJY6tA')
on conflict (name) do update set value = excluded.value, updated_at = now();

-- ── 3) دالة التأكيد ──
--  تعيد true إن نجح التأكيد. وترفع استثناءً إن كان السرّ خاطئاً.
--  ملاحظة: لا تكشف الدالة وجود المرجع من عدمه عند السرّ الخاطئ — ترفض أولاً.
create or replace function admin_confirm_order(
  p_ref     text,
  p_key     text,
  p_secret  text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  expected text;
  updated  int;
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

  update orders
     set status        = 'confirmed',
         "licenseKey"  = coalesce(p_key, ''),
         "confirmedAt" = now()
   where reference = p_ref;

  get diagnostics updated = row_count;
  return updated > 0;
end;
$$;

-- الزائر يملك **تنفيذ** الدالة فقط — لا صلاحيات الجدول
revoke all on function admin_confirm_order(text, text, text) from public;
grant execute on function admin_confirm_order(text, text, text) to anon, authenticated;

-- ── 4) دالة حذف طلب (للتنظيف: طلبات تجريبية أو مزعجة) ──
create or replace function admin_delete_order(
  p_ref     text,
  p_secret  text
)
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

-- ── 5) تحقّق ──
do $$
declare n int;
begin
  select count(*) into n from app_secrets where name = 'admin_confirm';
  raise notice 'السرّ مُسجَّل: %', (n = 1);
  raise notice 'RLS مُفعَّل على app_secrets: %',
    (select relrowsecurity from pg_class where relname = 'app_secrets');
  raise notice 'عدد سياسات app_secrets (يجب أن يكون 0): %',
    (select count(*) from pg_policies where tablename = 'app_secrets');
  raise notice 'دالة التأكيد موجودة: %',
    (select count(*) from pg_proc where proname = 'admin_confirm_order');
  raise notice 'دالة الحذف موجودة: %',
    (select count(*) from pg_proc where proname = 'admin_delete_order');
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
--  بعد التشغيل: انسخ السرّ والصقه في لوحة الأدمن
--  تبويب الإعدادات → «🔐 مصادقة الأدمن» → حقل «سرّ تأكيد الطلبات» → حفظ
--
--  للتحقق من أن كل شيء سليم بعد التشغيل:
--      python tools/live-check.py
--
--  لتغيير السرّ لاحقاً (نفّذ ثم حدّث اللوحة):
--      update app_secrets set value = 'سرّ-جديد-طويل'
--       where name = 'admin_confirm';
--
--  ملاحظة أمنية: السرّ محفوظ في متصفح الأدمن (localStorage) ولا يُنشر في
--  أي ملف عام. ومن يسرق جهاز الأدمن يسرق السرّ — لذا لا تضع الجهاز في
--  متناول آخرين. وإن أردت أقوى من ذلك: مصادقة Supabase (تُضبط من نفس البطاقة).
-- ═══════════════════════════════════════════════════════════════════════════
