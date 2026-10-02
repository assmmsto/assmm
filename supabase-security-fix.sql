-- ═══════════════════════════════════════════════════════════════
--  سياسات الأمان — معرض الأعمال (Nova)   [نسخة مُصحَّحة]
--  شغّل هذا الملف في: Supabase → SQL Editor → Run
-- ─────────────────────────────────────────────────────────────
--  ⚠️ هذا الملف آمن للتشغيل أكثر من مرة (idempotent).
--
--  لماذا هذا الملف؟
--  السياسة القديمة كانت `for all using(true) with check(true)` على الجداول
--  الثلاثة، أي أن مفتاح الموقع العام (المضمَّن في data/settings.json لأنه
--  موقع ثابت) كان يملك قراءة وكتابة وحذف كل شيء. تحقّقنا عملياً أن:
--    · أي زائر يقرأ 19 مفتاح ترخيص من products.licenseKeys
--    · أي زائر يغيّر سعر أي منتج        (PATCH نجح)
--    · أي زائر يحذف أي منتج             (DELETE نجح)
--    · أي زائر يقرأ كل الطلبات وبيانات المشترين
--    · أي زائر يحذف كل الاقتراحات
--
--  ⚠️ ثغرات كانت في النسخة السابقة من هذا الملف — صُحّحت هنا:
--
--  (أ) **صلاحيات الأعمدة كانت بلا أثر.** كان الملف يفعل:
--        revoke select ("licenseKeys","usedKeys") on products from anon;
--        grant  select on products to anon;              ← المشكلة هنا
--      في PostgreSQL، منح SELECT على مستوى **الجدول** يشمل كل الأعمدة
--      ويُلغي أثر سحب العمود. أي أن المفاتيح كانت ستبقى مقروءة تماماً.
--      الحل الصحيح: منع SELECT على مستوى الجدول، ومنح الأعمدة العامة
--      **واحداً واحداً** (قائمة صريحة أدناه). مبدأ «الفشل مُغلَق».
--
--  (ب) **سياسة قراءة الطلبات كانت `using(true)`.** أي أن كل زائر يستطيع
--      سرد الجدول كله — أسماء المشترين وإثباتات دفعهم. و«المرجع غير قابل
--      للتخمين» لا يحمي إن كنت تستطيع سرد الجدول. الحل: دالة
--      `get_order_by_reference` تُعيد صفاً واحداً بمرجعه فقط، وسحب
--      صلاحية قراءة الجدول من المفتاح العام نهائياً.
--
--  (ج) **`force row level security` أُزيلت عمداً.** هي تجعل RLS تُطبَّق حتى
--      على مالك الجدول — فيصبح محرر SQL و«محرّر الجداول» في لوحة Supabase
--      غير قادرين على رؤية أي صف. الحماية الحقيقية هي السياسات + صلاحيات
--      الأعمدة أدناه، لا تعطيل حسابك عن قاعدة بياناتك.
--
--  ⚠️ ملاحظة على لوحة الأدمن:
--  بعد هذا الملف لا يستطيع المفتاح العام الكتابة في القاعدة. ولوحة الأدمن
--  تحتاج هوية حقيقية للكتابة — راجع القسم (9) في نهاية الملف.
-- ═══════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════
--  0) أعمدة ناقصة يحتاجها الموقع
--  ─────────────────────────────────────────────────────────────
--  ⚠️ هذا القسم إصلاح لعلّة حقيقية وقعت: كان `payerEmail` مُرسَلاً من الواجهة
--  ضمن كل طلب، وغير موجود في الجدول. وPostgREST يرفض الإدراج كاملاً عند وجود
--  حقل واحد مجهول (PGRST204) ⇒ كان **كل طلب جديد يُفقد بصمت** (يُحفظ في متصفح
--  المشتري فقط ولا يصل للأدمن، بلا أي رسالة خطأ).
-- ═══════════════════════════════════════════════════════════════
alter table orders add column if not exists "payerEmail"    text;
alter table orders add column if not exists "notes"         text;
alter table orders add column if not exists "trackAttempts" int default 0;

create index if not exists orders_reference_idx  on orders (reference);
create index if not exists orders_status_idx     on orders (status);
create index if not exists orders_created_at_idx on orders ("createdAt" desc);


-- ═══════════════════════════════════════════════════════════════
--  0-b) دالة زيادة عدّاد التحميلات (ذرّية)
--  ─────────────────────────────────────────────────────────────
--  الزائر لا يستطيع UPDATE على products (وهذا مقصود)، لكن العدّاد يحتاج
--  زيادة. الحل: دالة SECURITY DEFINER تزيد عموداً واحداً فقط —
--  لا تسمح بتغيير السعر أو الاسم أو أي شيء آخر.
-- ═══════════════════════════════════════════════════════════════
create or replace function increment_product_downloads(pid int)
returns void
language sql
security definer
set search_path = public
as $$
  update products set downloads = coalesce(downloads, 0) + 1 where id = pid;
$$;

revoke all on function increment_product_downloads(int) from public;
grant execute on function increment_product_downloads(int) to anon, authenticated;


-- ═══════════════════════════════════════════════════════════════
--  1) إزالة كل السياسات المفتوحة (بأي اسم)
-- ═══════════════════════════════════════════════════════════════
drop policy if exists "قراءة وكتابة عامة" on products;
drop policy if exists "قراءة وكتابة عامة" on orders;
drop policy if exists "قراءة وكتابة عامة" on suggestions;

-- إزالة أي سياسة أخرى قد تكون أُضيفت يدوياً وتمنح تعديلاً/حذفاً للجميع
do $$
declare
  pol record;
begin
  for pol in
    select policyname, tablename
    from pg_policies
    where schemaname = 'public'
      and tablename in ('products', 'orders', 'suggestions')
      and cmd in ('UPDATE', 'DELETE', 'ALL')
  loop
    execute format('drop policy if exists %I on public.%I', pol.policyname, pol.tablename);
    raise notice 'أُزيلت سياسة مفتوحة: % على %', pol.policyname, pol.tablename;
  end loop;
end $$;

-- إزالة السياسات التي أضفناها في نسخة سابقة (لإعادة إنشائها بشكل صحيح)
drop policy if exists "products: قراءة عامة"          on products;
drop policy if exists "products: إدارة للموثّقين"      on products;
drop policy if exists "orders: إنشاء طلب عام"          on orders;
drop policy if exists "orders: قراءة بمتابعة الطلب"    on orders;
drop policy if exists "orders: إدارة للموثّقين"        on orders;
drop policy if exists "suggestions: إرسال اقتراح"      on suggestions;
drop policy if exists "suggestions: إدارة للموثّقين"   on suggestions;


-- ═══════════════════════════════════════════════════════════════
--  2) تفعيل RLS
--  (بلا `force` — راجع السبب في رأس الملف)
-- ═══════════════════════════════════════════════════════════════
alter table products    enable row level security;
alter table orders      enable row level security;
alter table suggestions enable row level security;
alter table products    no force row level security;
alter table orders      no force row level security;
alter table suggestions no force row level security;


-- ═══════════════════════════════════════════════════════════════
--  3) جدول المنتجات
-- ═══════════════════════════════════════════════════════════════

-- الزائر: قراءة الكتالوج. الأعمدة السرّية محجوبة في القسم (6).
create policy "products: قراءة عامة"
  on products for select
  to anon, authenticated
  using (true);

-- الأدمن الموثّق: إدارة كاملة (الكتابة تحتاج هوية حقيقية)
create policy "products: إدارة للموثّقين"
  on products for all
  to authenticated
  using (true)
  with check (true);


-- ═══════════════════════════════════════════════════════════════
--  4) جدول الطلبات
-- ═══════════════════════════════════════════════════════════════

-- الزائر ينشئ طلباً جديداً: مسموح.
-- القيد: لا يمكنه إنشاء طلب بحالة confirmed مباشرة، ولا تعيين مفتاح ترخيص.
create policy "orders: إنشاء طلب عام"
  on orders for insert
  to anon, authenticated
  with check (
    status = 'pending'
    and coalesce("licenseKey", '') = ''
    and coalesce(total, 0) >= 0
  );

-- الأدمن الموثّق: قراءة كل الطلبات وتأكيدها وسحب المفاتيح
create policy "orders: إدارة للموثّقين"
  on orders for all
  to authenticated
  using (true)
  with check (true);

-- ⛔ لا سياسة SELECT للمفتاح العام: غياب السياسة = المنع الكامل.
--    لهذا لا يستطيع أي زائر سرد الطلبات أو قراءة بيانات المشترين.

-- بديل آمن لمتابعة الطلب: دالة تُعيد **صفاً واحداً** بمرجعه فقط،
-- وبأعمدة محدودة عمداً (بلا payerName/payerRef/payerEmail).
-- ⚠️ يجب أن تتطابق توقيعاتها هنا وفي supabase-final.sql (نفس 11 عموداً)
--    حتى يكون تشغيل الملفين بأي ترتيب آمناً. أي اختلاف يجعل إعادة تشغيل
--    أحدهما بعد الآخر تُسقط deliveryUrl/deliveryNote/rejectReason عن المتابعة.
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


-- ═══════════════════════════════════════════════════════════════
--  5) جدول الاقتراحات
-- ═══════════════════════════════════════════════════════════════

create policy "suggestions: إرسال اقتراح"
  on suggestions for insert
  to anon, authenticated
  with check (
    coalesce("text", '') <> ''
    and length("text") <= 500
    and coalesce(length(name), 0) <= 60
  );

-- الأدمن الموثّق: قراءة الاقتراحات وحذفها. لا سياسة للزائر ⇒ اقتراحات الناس ليست عامة.
create policy "suggestions: إدارة للموثّقين"
  on suggestions for all
  to authenticated
  using (true)
  with check (true);


-- ═══════════════════════════════════════════════════════════════
--  6) 🛡️ الطبقة الأقوى: صلاحيات الأعمدة
--  ─────────────────────────────────────────────────────────────
--  ⚠️ اقرأ هذا قبل التعديل:
--  لا نمنح SELECT على مستوى الجدول إطلاقاً، بل نمنح الأعمدة العامة **صراحةً**.
--  سبب ذلك: في PostgreSQL، منح SELECT على الجدول يشمل كل أعمدته ويلغي أثر
--  أي سحب على مستوى العمود. القائمة الصريحة هي الطريقة الوحيدة التي تعمل.
--
--  📌 قاعدة صيانة مهمة:
--  إن أضفت عموداً جديداً إلى products وتريد أن يراه الزائر في الموقع،
--  **أضفه إلى قائمة GRANT أدناه** — وإلا لن يصل إلى الواجهة (وهذا فشل مُغلَق
--  مقصود: النسيان يُخفي عموداً، ولا يكشف سرّاً).
-- ═══════════════════════════════════════════════════════════════

-- ── المنتجات ──
revoke all on products from anon, authenticated;

grant select (
  id, slug, name, short, long, type, kind, platform, price, currency, version,
  features, "installCommands", "downloadUrl", "licenseMode", "licenseNote",
  "githubInviteUrl", "demoUrl", "previewImage", status, featured, downloads,
  "hiddenFields", "paymentMethods"
) on products to anon;

-- الأدمن الموثّق يحصل على الأعمدة العامة + السرّية
grant select (
  id, slug, name, short, long, type, kind, platform, price, currency, version,
  features, "installCommands", "downloadUrl", "licenseMode", "licenseNote",
  "githubInviteUrl", "demoUrl", "previewImage", status, featured, downloads,
  "hiddenFields", "paymentMethods", "licenseKeys", "usedKeys"
) on products to authenticated;

grant insert, update, delete on products to authenticated;

-- ── الطلبات ──
revoke all on orders from anon, authenticated;

-- الزائر: إدراج فقط، وبلا أي قراءة (المتابعة عبر الدالة أعلاه)
grant insert on orders to anon;
grant select, insert, update, delete on orders to authenticated;

-- ── الاقتراحات ──
revoke all on suggestions from anon, authenticated;

grant insert on suggestions to anon;
grant select, insert, update, delete on suggestions to authenticated;


-- ═══════════════════════════════════════════════════════════════
--  7) التسلسلات (sequences)
--  ─────────────────────────────────────────────────────────────
--  الإدراج يحتاج صلاحية على تسلسل المعرّف التلقائي. نسحبها عن الزائر حيث
--  لا إدراج له، ونُبقيها حيث يحتاجها (الطلبات والاقتراحات).
-- ═══════════════════════════════════════════════════════════════
revoke all on sequence products_id_seq    from anon;
revoke all on sequence orders_id_seq      from anon;
revoke all on sequence suggestions_id_seq from anon;

grant usage, select on sequence products_id_seq    to authenticated;
grant usage, select on sequence orders_id_seq      to anon, authenticated;
grant usage, select on sequence suggestions_id_seq to anon, authenticated;


-- ═══════════════════════════════════════════════════════════════
--  8) التحقق الفوري — اقرأ رسائل NOTICE في نافذة النتيجة
-- ═══════════════════════════════════════════════════════════════
do $$
declare
  open_policies int;
  anon_secret   int;
  auth_secret   int;
begin
  -- (1) هل بقيت سياسة تسمح بتعديل/حذف للجميع؟
  select count(*) into open_policies
  from pg_policies
  where schemaname = 'public'
    and tablename in ('products', 'orders', 'suggestions')
    and cmd in ('UPDATE', 'DELETE', 'ALL')
    and 'anon' = any (roles);

  if open_policies = 0 then
    raise notice '✅ 1/4 لا سياسات تعديل/حذف للمفتاح العام';
  else
    raise warning '⚠️ 1/4 ما زالت هناك % سياسة مفتوحة', open_policies;
  end if;

  -- (2) هل الأعمدة السرّية محجوبة عن المفتاح العام فعلاً؟
  select count(*) into anon_secret
  from information_schema.column_privileges
  where table_schema = 'public' and table_name = 'products'
    and column_name in ('licenseKeys', 'usedKeys')
    and grantee = 'anon' and privilege_type = 'SELECT';

  if anon_secret = 0 then
    raise notice '✅ 2/4 licenseKeys و usedKeys محجوبتان عن المفتاح العام';
  else
    raise warning '⚠️ 2/4 الأعمدة السرّية ما زالت مقروءة (% صلاحية)', anon_secret;
  end if;

  -- (3) هل الأدمن الموثّق يستطيع قراءتها فعلاً؟ (وإلا فقد السيطرة على مخزونه)
  select count(*) into auth_secret
  from information_schema.column_privileges
  where table_schema = 'public' and table_name = 'products'
    and column_name in ('licenseKeys', 'usedKeys')
    and grantee = 'authenticated' and privilege_type = 'SELECT';

  if auth_secret >= 2 then
    raise notice '✅ 3/4 الأدمن الموثّق يقرأ مفاتيح الترخيص';
  else
    raise warning '⚠️ 3/4 الأدمن الموثّق لا يقرأ المفاتيح (% صلاحية) — راجع القسم 6', auth_secret;
  end if;

  -- (4) هل الزائر يقرأ الطلبات؟ (يجب أن يكون صفراً)
  if exists (
    select 1 from information_schema.table_privileges
    where table_schema = 'public' and table_name = 'orders'
      and grantee = 'anon' and privilege_type = 'SELECT'
  ) then
    raise warning '⚠️ 4/4 الزائر ما زال يقرأ جدول الطلبات — راجع القسم 6';
  else
    raise notice '✅ 4/4 لا قراءة لجدول الطلبات من المفتاح العام';
  end if;
end $$;


-- ═══════════════════════════════════════════════════════════════
--  9) الخطوة التالية الإلزامية — تأمين الكتابة للأدمن
--  ─────────────────────────────────────────────────────────────
--  بعد هذا الملف، المفتاح العام لا يستطيع:
--    · تعديل أو حذف منتج
--    · تأكيد طلب أو تعيين مفتاح ترخيص
--    · قراءة مفاتيح الترخيص أو بيانات المشترين
--
--  ✅ الموقع العام (index.html) يعمل بلا أي تغيير: يعرض المنتجات،
--     يُرسل الطلبات، ويتابعها بالمرجع عبر الدالة الآمنة.
--
--  ⛔ لوحة الأدمن (admin.html) ستحتاج هوية حقيقية للكتابة. الخطوات:
--
--     1) في Supabase → Authentication → Users: «Add user» ← أنشئ مستخدماً
--        ببريدك وكلمة مرور قوية، وعلّم «Auto Confirm User».
--     2) في Authentication → Providers → Email:
--        **أوقف** «Allow new users to sign up» — حتى لا ينشئ أحدٌ حساباً
--        ويصبح «موثّقاً». حسابك أنت فقط.
--     3) في لوحة الأدمن → الإعدادات → حقل `adminEmail`:
--        اكتب نفس البريد واحفظ.
--     4) أعد تحميل لوحة الأدمن: سيظهر حقل البريد في شاشة الدخول،
--        والتحقّق يصير على الخادم بدل كلمة المرور المحلية.
--
--  ملاحظة: السياسات أعلاه تمنح كل مستخدم «authenticated» صلاحية الإدارة.
--  وهذا آمن فقط لأن التسجيل العام مُعطَّل (الخطوة 2). لو أردت تقييداً
--  بالبريد تحديداً، أضف شرطاً كهذا إلى كل سياسة «للموثّقين»:
--      using (auth.jwt() ->> 'email' = 'بريدك@نطاقك.com')
-- ═══════════════════════════════════════════════════════════════
