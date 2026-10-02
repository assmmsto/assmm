-- ═══════════════════════════════════════════════════════════════
--  مخطط قاعدة البيانات — معرض الأعمال (Nova)
--  المكان: Supabase → SQL Editor → الصق هذا الملف كاملاً → Run
--  لا حاجة لأي تعديل — انسخ كما هو
-- ═══════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
--  1) المنتجات
-- ─────────────────────────────────────────────
create table if not exists products (
  id               serial primary key,
  slug             text unique,
  name             text,
  short            text,
  long             text,
  type             text,
  kind             text,
  platform         text,
  price            numeric default 0,
  currency         text default 'USD',
  version          text,
  features         jsonb,
  "installCommands" jsonb,
  "downloadUrl"    text,
  "licenseMode"    text default 'none',
  "licenseKeys"    jsonb,
  "usedKeys"       jsonb,
  "licenseNote"    text,
  "githubInviteUrl" text,
  "demoUrl"        text,
  "previewImage"   text,
  status           text default 'active',
  featured         boolean default false,
  downloads        int default 0,
  "hiddenFields"   jsonb,
  "paymentMethods" jsonb
);

-- ─────────────────────────────────────────────
--  2) الطلبات
-- ─────────────────────────────────────────────
create table if not exists orders (
  id            serial primary key,
  reference     text unique,
  "productId"   int,
  "productName" text,
  price         numeric,
  currency      text,
  "discountCode" text,
  total         numeric,
  "methodKey"   text,
  "methodLabel" text,
  "walletId"    text,
  "walletEndpoint" text,
  "payerName"   text,
  "payerRef"    text,
  status        text default 'pending',
  "licenseKey"  text,
  "createdAt"   timestamptz default now(),
  "confirmedAt" timestamptz
);

-- ─────────────────────────────────────────────
--  3) الاقتراحات
-- ─────────────────────────────────────────────
create table if not exists suggestions (
  id         serial primary key,
  name       text,
  text       text,
  "createdAt" timestamptz default now()
);

-- ═══════════════════════════════════════════════════════════════
--  4) الأمان (Row Level Security)
--  المفتاح المستخدم في الموقع هو anon وهو عام بطبعه،
--  لذا نسمح بالقراءة للجميع والكتابة للجميع — مناسب لمتجر صغير.
--  لاحقاً يمكن تقييد الكتابة بجلسة أدمن عبر Supabase Auth.
-- ═══════════════════════════════════════════════════════════════
alter table products    enable row level security;
alter table orders      enable row level security;
alter table suggestions enable row level security;

drop policy if exists "قراءة وكتابة عامة" on products;
create policy "قراءة وكتابة عامة" on products
  for all using (true) with check (true);

drop policy if exists "قراءة وكتابة عامة" on orders;
create policy "قراءة وكتابة عامة" on orders
  for all using (true) with check (true);

drop policy if exists "قراءة وكتابة عامة" on suggestions;
create policy "قراءة وكتابة عامة" on suggestions
  for all using (true) with check (true);

-- ═══════════════════════════════════════════════════════════════
--  5) رفع المنتجات الحالية
--  أسهل طريقة: من لوحة الأدمن ← الإعدادات ← «رفع المنتجات الحالية»
--  (بعد وضع المفتاحين). لا حاجة لكتابة INSERT يدوياً.
-- ═══════════════════════════════════════════════════════════════
