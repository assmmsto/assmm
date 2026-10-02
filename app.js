/* ==========================================================================
   معرض الأعمال — app.js (production, بلا سيرفر)
   المسؤوليات: تحميل البيانات، عرض المنتجات، البحث/الفلترة،
   تفاصيل المنتج، الدفع اليدوي/الروابط، الاقتراحات، الثيم، الإحصاءات.
   ملاحظة أمنية: كل نص قادم من JSON أو المستخدم يمرّ عبر esc() قبل innerHTML.
   ========================================================================== */
'use strict';

/* ── أدوات عامة ── */
const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

/** تهريب HTML لمنع XSS في أي نص يُحقن عبر innerHTML */
function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** تنسيق السعر: 0 → "مجاني"، وإلا "$29" */
function formatPrice(price, currency) {
  if (!price) return 'مجاني';
  const symbol = currency === 'USD' ? '$' : (currency === 'EGP' ? 'ج.م' : currency);
  return `${symbol}${price}`;
}

/* ── Toast ── */
const toastEl = $('#toast');
let toastTimer = null;
function showToast(message, kind = 'info') {
  if (!toastEl) return;
  const icons = { info: 'info', success: 'check_circle', error: 'error' };
  $('#toastMsg').textContent = message;
  $('#toastIcon').textContent = icons[kind] ?? icons.info;
  toastEl.classList.toggle('success', kind === 'success');
  toastEl.classList.toggle('error', kind === 'error');
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3200);
}

/* ── إدارة المودالات ── */
function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}
function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('active');
}
document.addEventListener('click', (event) => {
  const closer = event.target.closest('[data-close]');
  if (closer) closeModal(closer.dataset.close);
  // إغلاق عند النقر على الخلفية فقط
  if (event.target.classList?.contains('modal-overlay')) event.target.classList.remove('active');
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') $$('.modal-overlay.active').forEach((m) => m.classList.remove('active'));
});

/* ── تخزين محلي (طلبات + اقتراحات) ── */
function readLocal(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function writeLocal(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.error('فشل التخزين المحلي', error);
    return false;
  }
}

/* ── قراءة البيانات: جلب ثم احتياط مضمّن ──
   فتح index.html بالنقر المزدوج (file://) يمنع المتصفح من fetch لملفات JSON —
   قيد أمني في كل المتصفحات لا عيب في الموقع. ولأن المالك يريد أن تعمل الصفحة
   بلا خادم، تُضمَّن نسخة من البيانات **داخل الصفحة نفسها** في وسم
   <script id="nova-data" type="application/json"> — ووسم السكربت غير القابل
   للتنفيذ لا يُحجبه CSP ولا يحتاج شبكة.

   المصدر يبقى data/*.json، والنسخة المضمّنة تُولَّد بالأمر:
       python tools/embed-data.py
   فتبقى الحقيقة واحدة، والنسخة المضمّنة مجرّد احتياط. */
function readEmbeddedData(path) {
  const node = document.getElementById('nova-data');
  if (!node) return null;
  try {
    const all = JSON.parse(node.textContent || '{}');
    const key = String(path).replace(/^\.?\/*data\//, '').replace(/\.json$/, '');
    return all[key] ?? null;
  } catch (error) {
    console.warn('تعذّر قراءة البيانات المضمّنة:', error.message);
    return null;
  }
}

/* ── تحميل البيانات (فشل الشبكة حالة مدعومة) ── */
async function loadJSON(path, fallbackValue) {
  try {
    const response = await fetch(`${path}?v=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    const embedded = readEmbeddedData(path);
    if (embedded) {
      console.info(`استُخدمت البيانات المضمّنة لـ ${path} (${error.message}).`);
      return embedded;
    }
    console.warn(`تعذّر تحميل ${path}:`, error.message);
    return fallbackValue;
  }
}

/* ── حالة التطبيق (مصدر حقيقة واحد) ── */
const state = {
  products: [],
  settings: {},
  wallets: [],
  filter: 'all',
  query: '',
  checkout: null, // { product, methodKey, step, timerId, timerEnd }
};

/* ── تطبيق الإعدادات على الصفحة ──
   قاعدة المشروع: **الفارغ لا يُرسم**. لذلك أي نص إعدادات فارغ يُخفى عنصره
   بدل أن يبقى نص HTML قديم مكتوب يدوياً في الصفحة. */
function applySettings(settings) {
  const text = (id, value) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (value) { el.textContent = value; el.style.display = ''; }
    else { el.style.display = 'none'; }
  };
  text('siteTitle', settings.platformName);
  text('footerTitle', settings.platformName);
  text('heroTitle', settings.heroTitle);
  text('heroSub', settings.heroSub);
  text('heroBadge', settings.heroBadge);
  // شعار المنصة: صورة مرفوعة إن وُجدت، وإلا الافتراضي
  if (settings.logoImage) {
    const siteLogo = $('#siteLogo');
    if (siteLogo) siteLogo.src = settings.logoImage;
    const footerLogo = $('#footerLogo');
    if (footerLogo) footerLogo.src = settings.logoImage;
  }
  const yearEl = $('#year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();
  const emailEl = $('#contactEmail');
  if (emailEl && settings.contactEmail) {
    emailEl.textContent = `تواصل: ${settings.contactEmail}`;
    emailEl.href = `mailto:${settings.contactEmail}`;
  }
  document.title = `${settings.platformName ?? 'معرض الأعمال'} — منتجات رقمية للمطورين`;
}

/* ── الثيم (داكن افتراضياً، محفوظ محلياً) ── */
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const icon = $('#themeToggle .material-symbols-outlined');
  if (icon) icon.textContent = theme === 'dark' ? 'dark_mode' : 'light_mode';
}
function initTheme(settings) {
  const saved = readLocal('nova_theme', null);
  const initial = saved ?? settings.theme?.default ?? 'dark';
  applyTheme(initial);
  // زر التبديل يظهر فقط إن سمحت الإعدادات بذلك
  const toggle = $('#themeToggle');
  if (settings.theme && settings.theme.allowToggle === false) {
    toggle?.remove();
    return;
  }
  toggle?.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    writeLocal('nova_theme', next);
  });
}

/* ── نظام الألوان: البرتقالي الذهبي #f59e0b هو الأساسي الثابت ──
   مُعرَّف مباشرة في :root بملف styles.css — لا حاجة لأي منطق تبديل. */

/* ── سياسة الظهور للعميل: الفارغ لا يُرسم · العين تُخفي · المدفوع يقفل التسليم ── */
const DELIVERY_FIELDS_CLIENT = ['downloadUrl', 'githubUrl', 'install'];

function isHidden(product, key) {
  return (product.hiddenFields ?? []).includes(key);
}

function hasValue(value) {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  // الأرقام تُحوَّل إلى نص: 0 تصبح "0" فتُعد قيمة ظاهرة (السعر المجاني يُعرض)
  return String(value).trim() !== '';
}

/* هل يُسمح بعرض حقل التسليم؟ المدفوع يُقفل تلقائياً حتى لو نسي الأدمن */
function deliveryVisible(product) {
  return !Number(product.price);
}

function clientVisible(product, key, value) {
  if (isHidden(product, key)) return false;
  if (!hasValue(value)) return false;
  if (DELIVERY_FIELDS_CLIENT.includes(key) && !deliveryVisible(product)) return false;
  return true;
}

/* ── بطاقات المنتجات ── */
function productCard(product) {
  const isFree = !product.price;
  const priceShown = clientVisible(product, 'price', product.price ?? 0);
  const priceBadge = isFree
    ? '<span class="badge badge-success">مجاني</span>'
    : `<span class="badge badge-indigo font-num" dir="ltr">${esc(formatPrice(product.price, product.currency))}</span>`;
  // المجاني يبقى معلَماً دائماً؛ سعر المنتج المدفوع يُخفى إن أطفأ الأدمن عين «السعر»
  const badge = isFree || priceShown ? priceBadge : '';
  const typeLabels = { exe: 'تطبيق', apk: 'أندرويد', cli: 'CLI', api: 'API', file: 'قالب' };
  const meta = kindMeta(product);
  const showType = clientVisible(product, 'type', product.type);
  const showName = clientVisible(product, 'name', product.name);
  const showShort = clientVisible(product, 'short', product.short);
  const showVersion = clientVisible(product, 'version', product.version);
  // «مميّز» قيمة منطقية: لا تُعرض إلا عند true صراحةً، وتخضع لعين الأدمن كبقية الحقول
  const showFeatured = product.featured === true && !isHidden(product, 'featured');
  const coverImages = (product.images ?? (product.previewImage ? [product.previewImage] : [])).filter(Boolean);
  const showCover = clientVisible(product, 'images', coverImages) && coverImages[0];
  // أول ميزة على البطاقة: ما يقرره الزائر («ماذا أحصل؟») قبل أن يفتح المودال
  const showTopFeature = !isHidden(product, 'features') && Array.isArray(product.features) && product.features.length > 0;
  // حالة مخزون المفاتيح للمنتج المدفوع بالمفتاح: ندرة حقيقية تبيع — والمعلومة موجودة أصلاً
  let stockBadge = '';
  if (!isFree && product.licenseMode === 'key' && Array.isArray(product.licenseKeys)) {
    const remaining = product.licenseKeys.filter((k) => !(product.usedKeys ?? []).includes(k)).length;
    if (remaining > 0) {
      stockBadge = `<div class="font-code-sm text-on-surface-variant"><span class="font-num text-primary">${esc(String(remaining))}</span> مفتاح متبقٍ</div>`;
    }
  }
  return `
  <article class="card product-card${showFeatured ? ' featured' : ''}" style="padding:var(--space-lg);display:flex;flex-direction:column;gap:var(--space-sm)">
    ${showCover ? `<img src="${esc(coverImages[0])}" alt="${esc(product.name)}" loading="lazy" style="width:100%;height:150px;object-fit:cover;border-radius:var(--radius-default);border:1px solid var(--color-outline-variant)">` : ''}
    <div class="flex items-center justify-between">
      <span class="flex items-center gap-space-xs">
        ${showFeatured ? '<span class="badge badge-indigo flex items-center gap-space-xs"><span class="material-symbols-outlined" style="font-size:14px">star</span>مميّز</span>' : ''}
        ${showType ? `<span class="badge badge-neutral flex items-center gap-space-xs"><span class="material-symbols-outlined" style="font-size:14px">${meta.icon}</span>${esc(meta.label)}</span>` : ''}
      </span>
      ${badge}
    </div>
    ${showName ? `<h3 class="font-headline-md font-latin text-on-surface">${esc(product.name)}</h3>` : ''}
    ${showShort ? `<p class="font-body-md text-on-surface-variant line-clamp-2 grow">${esc(product.short)}</p>` : ''}
    ${showTopFeature ? `<div class="flex items-center gap-space-xs font-body-sm text-on-surface-variant"><span class="material-symbols-outlined text-primary" style="font-size:15px">check_circle</span>${esc(product.features[0])}</div>` : ''}
    ${stockBadge}
    <div class="flex items-center justify-between font-body-sm text-on-surface-variant">
      ${showVersion ? `<span class="font-num" dir="ltr">v${esc(product.version)}</span>` : '<span></span>'}
      <span class="font-num">${esc(product.downloads ?? 0)} تحميل</span>
    </div>
    <div class="flex gap-space-sm">
      <button type="button" class="btn btn-secondary btn-size-md grow" data-details="${product.id}">التفاصيل</button>
      <button type="button" class="btn btn-primary btn-size-md grow" data-buy="${product.id}">
        <span class="material-symbols-outlined" style="font-size:16px">${deliveryCta(product).icon}</span>
        ${esc(deliveryCta(product).text)}
      </button>
    </div>
  </article>`;
}

function visibleProducts() {
  const query = state.query.trim().toLowerCase();
  const matches = state.products.filter((product) => {
    if (product.status === 'hidden') return false;
    if (state.filter === 'free' && product.price) return false;
    if (state.filter === 'paid' && !product.price) return false;
    if (!['all', 'free', 'paid'].includes(state.filter)) {
      // الفلتر يطابق النوع الجديد (kind) أو النوع المخزَّن (type) لتوافق أوسع
      const facets = [product.kind, product.type].filter(Boolean);
      if (!facets.includes(state.filter)) return false;
    }
    if (!query) return true;
    return [product.name, product.short, product.long, product.slug]
      .some((field) => String(field).toLowerCase().includes(query));
  });
  // المميّز أولاً (الأدمن يبرزه من النموذج) مع الحفاظ على ترتيب بقية المنتجات
  return matches.sort((a, b) => Number(b.featured === true) - Number(a.featured === true));
}

function renderProducts() {
  const grid = $('#productGrid');
  const emptyState = $('#emptyState');
  const items = visibleProducts();
  grid.querySelectorAll('.product-card').forEach((card) => card.remove());
  emptyState.style.display = items.length ? 'none' : 'block';
  items.forEach((product) => grid.insertAdjacentHTML('beforeend', productCard(product)));
}

/* ── الفلاتر: تُبنى من البيانات لا من HTML ثابت ──
   السبب: كان في الصفحة 11 زراً ثابتاً بينما المنتجات تغطّي 5 أنواع فقط،
   فثلاثة أزرار (مشاريع GitHub · مواقع · منشورات) لا تُظهر شيئاً أبداً فيظنّ
   الزائر أن المتجر فارغ أو معطوب. الآن يُبنى كل زر من نوع موجود فعلاً —
   تطبيقاً لقاعدة المشروع: **الفارغ لا يُرسم**. */
const FILTER_ORDER = ['all', 'free', 'paid', 'cli', 'api', 'exe', 'apk', 'file', 'github', 'website', 'post'];
const FILTER_LABELS = {
  all: 'الكل', free: 'مجانية', paid: 'مدفوعة',
  cli: 'أدوات CLI', api: 'APIs', exe: 'تطبيقات', apk: 'أندرويد', file: 'قوالب',
  github: 'مشاريع GitHub', website: 'مواقع', post: 'منشورات',
};

function visibleForFilter(key) {
  const active = state.products.filter((product) => product.status !== 'hidden');
  if (key === 'all') return active;
  if (key === 'free') return active.filter((product) => !product.price);
  if (key === 'paid') return active.filter((product) => product.price);
  return active.filter((product) => kindOf(product) === key);
}

function buildFilters() {
  const bar = $('#filterBar');
  if (!bar) return;
  const present = new Set();
  state.products.forEach((product) => {
    if (product.status === 'hidden') return;
    const kind = kindOf(product);
    if (kind) present.add(kind);
  });
  // الأزرار الثابتة الثلاثة + الأنواع الموجودة فعلاً فقط
  const keys = FILTER_ORDER.filter((key) => ['all', 'free', 'paid'].includes(key) || present.has(key));
  bar.innerHTML = keys.map((key) => `
    <button class="filter-btn btn btn-secondary btn-size-md${key === state.filter ? ' active' : ''}" data-filter="${esc(key)}">
      ${esc(FILTER_LABELS[key] ?? key)}<span class="font-num">${visibleForFilter(key).length}</span>
    </button>`).join('');
  $$('.filter-btn').forEach((button) => {
    button.addEventListener('click', () => {
      $$('.filter-btn').forEach((b) => b.classList.remove('active'));
      button.classList.add('active');
      state.filter = button.dataset.filter;
      renderProducts();
    });
  });
}

function initFilters() {
  $('#searchInput')?.addEventListener('input', (event) => {
    state.query = event.target.value;
    renderProducts();
  });
  buildFilters();
}


/* ── تفاصيل المنتج (Modal — مُطابق لبنية stitch: رأس + شبكة مواصفات + تبويبات + تذييل) ── */
const TYPE_ICONS = { exe: 'desktop_windows', apk: 'phone_android', cli: 'terminal', api: 'dns', file: 'description' };

/* أنواع المنتجات (كما يضيفها الأدمن): تعطي تسمية وأيقونة أدق من `type` وحده */
const KIND_META = {
  cli:     { label: 'أداة CLI',        icon: 'terminal' },
  exe:     { label: 'تطبيق سطح مكتب',  icon: 'desktop_windows' },
  apk:     { label: 'تطبيق أندرويد',   icon: 'phone_android' },
  api:     { label: 'واجهة برمجية API', icon: 'dns' },
  github:  { label: 'مشروع GitHub',    icon: 'code' },
  website: { label: 'موقع / قالب',     icon: 'language' },
  post:    { label: 'منشور / صور',     icon: 'image' },
};
const TYPE_LABELS = { exe: 'تطبيق', apk: 'أندرويد', cli: 'CLI', api: 'API', file: 'قالب' };

/** نوع المنتج: `kind` إن وُجد، وإلا يُستنتج من `type` القديم (توافق خلفي) */
function kindOf(product) {
  if (product.kind && KIND_META[product.kind]) return product.kind;
  if (product.type === 'cli' || product.type === 'api') return product.type;
  if (product.type === 'exe') return 'exe';
  if (product.type === 'apk') return 'apk';
  return product.kind ?? product.type;
}

function kindMeta(product) {
  const kind = kindOf(product);
  return KIND_META[kind] ?? { label: TYPE_LABELS[product.type] ?? product.type, icon: TYPE_ICONS[product.type] ?? 'package_2' };
}

/** وسوم المحافظ المتاحة للدفع — نظام واحد، بلا ربط بمنتج بعينه */
function productPaymentLabels() {
  return (state.wallets ?? [])
    .filter(isConfiguredWallet)
    .map((wallet) => wallet.type === 'local'
      ? `${wallet.label ?? ''}${wallet.country ? ' · ' + countryLabel(wallet.country) : ''}`
      : `${wallet.currency ?? ''}${wallet.network ? ' · ' + wallet.network : ''}`);
}

/* ── شارات تقنية (إضافة مرئية) ──
   ⚠️ كانت هنا شارة «E2EE مؤمَّن» تُضاف لكل منتج مدفوع. لا يوجد تشفير طرف-لطرف
   في المشروع إطلاقاً — والادعاء نُظِّف من index.html لكنه بقي يُولَّد من هنا.
   استُبدلت بوصف صادق، لأن الادعاء التقني الكاذب يهدم الثقة أسرع مما يبنيها. */
function techBadges(product) {
  const badges = [];
  const kind = kindOf(product);
  const platform = String(product.platform ?? '').toLowerCase();
  if (kind === 'cli' || kind === 'api' || (product.installCommands ?? []).length) {
    badges.push({ icon: 'rocket_launch', label: 'CI/CD Ready' });
  }
  if (product.licenseMode === 'key') {
    badges.push({ icon: 'key', label: 'ترخيص بمفتاح' });
  }
  const multi = ['windows', 'macos', 'linux', 'android', 'universal', 'docker', 'cross'];
  if (multi.filter((k) => platform.includes(k)).length >= 2 || kind === 'cli') {
    badges.push({ icon: 'devices', label: 'Cross-platform' });
  }
  if (!badges.length) return '';
  return `
    <div class="flex flex-wrap items-center gap-space-xs mb-space-md">
      ${badges.map((b) => `
        <span class="badge badge-neutral flex items-center gap-space-xs">
          <span class="material-symbols-outlined" style="font-size:13px">${b.icon}</span>${esc(b.label)}
        </span>`).join('')}
    </div>`;
}

function renderDetails(product, preview = false) {
  const isFree = !product.price;
  const locked = !deliveryVisible(product);
  const icon = kindMeta(product).icon;
  const galleryImages = (product.images ?? (product.previewImage ? [product.previewImage] : [])).filter(Boolean);
  const showImages = clientVisible(product, 'images', galleryImages);
  const showDemo = clientVisible(product, 'demoUrl', resolveDeliveryUrl(product, product.demoUrl));
  const showVersion = clientVisible(product, 'version', product.version);
  const showPlatform = clientVisible(product, 'platform', product.platform);
  const showLong = clientVisible(product, 'long', product.long);
  const showLicenseNote = clientVisible(product, 'licenseNote', product.licenseNote);
  const showShort = clientVisible(product, 'short', product.short);
  const showName = clientVisible(product, 'name', product.name);
  const showFeatured = product.featured === true && !isHidden(product, 'featured');
  const specCell = (label, valueHtml) => `
    <div class="flex flex-col gap-space-xs">
      <span class="font-code-sm text-on-surface-variant">${esc(label)}</span>
      <span class="font-headline-sm text-on-surface flex items-center gap-space-xs">${valueHtml}</span>
    </div>`;
  // معرض الصور: الصورة الأولى كبيرة (الغلاف)، والبقية في شبكة مصغّرات
  const coverImage = galleryImages[0] ?? '';
  const thumbImages = galleryImages.slice(1);
  const galleryHtml = showImages && coverImage ? `
    <div class="pd-gallery">
      <img class="pd-cover" src="${esc(coverImage)}" alt="${esc(product.name)}">
      ${thumbImages.length ? `<div class="pd-thumbs">${thumbImages.map((src) => `<img src="${esc(src)}" alt="" loading="lazy">`).join('')}</div>` : ''}
    </div>` : '';
  $('#detailsBody').innerHTML = `
    <div class="flex items-start justify-between gap-space-md" style="border-bottom:1px solid var(--color-outline-variant);padding-bottom:var(--space-md);margin-bottom:var(--space-md)">
      <div class="flex items-center gap-space-md">
        <div class="flex items-center justify-center text-primary" style="width:48px;height:48px;border-radius:var(--radius-default);background:var(--color-surface-container-high);border:1px solid var(--color-outline-variant);flex-shrink:0">
          <span class="material-symbols-outlined" style="font-size:26px">${icon}</span>
        </div>
        <div class="flex flex-col gap-space-xs">
          <div class="flex items-center gap-space-sm flex-wrap">
            ${showName ? `<h2 class="font-headline-md font-latin text-on-surface" id="detailsName">${esc(product.name)}</h2>` : ''}
            ${showFeatured ? '<span class="badge badge-indigo flex items-center gap-space-xs"><span class="material-symbols-outlined" style="font-size:14px">star</span>مميّز</span>' : ''}
            ${showVersion ? `<span class="badge badge-neutral font-num" dir="ltr">v${esc(product.version)}</span>` : ''}
            ${preview ? '<span class="badge badge-indigo">معاينة أدمن 👁‍🗨</span>' : '<span class="badge badge-success flex items-center gap-space-xs"><span class="pulse-dot"></span>نشط ومستقر</span>'}
          </div>
          ${showShort ? `<p class="font-body-sm text-on-surface-variant">${esc(product.short)}</p>` : ''}
        </div>
      </div>
    </div>
    ${galleryHtml}
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-space-md mb-space-md" style="background:var(--color-surface-container-low);border:1px solid var(--color-outline-variant);border-radius:var(--radius-default);padding:var(--space-sm)">
      ${specCell('السعر والترخيص', isFree
        ? '<span class="material-symbols-outlined text-success" style="font-size:16px">lock_open</span><span class="text-success">مجاني</span>'
        : `<span class="material-symbols-outlined text-primary" style="font-size:16px">key</span><span class="font-num">${esc(formatPrice(product.price, product.currency))}</span>`)}
      ${showPlatform ? specCell('المنصة', `<span class="font-latin" dir="ltr">${esc(product.platform)}</span>`) : ''}
      ${specCell('التنزيلات', `<span class="material-symbols-outlined text-primary" style="font-size:16px">download</span><span class="font-num" dir="ltr">${esc(product.downloads ?? 0)}</span>`)}
      ${specCell('التسليم', isFree ? '<span class="font-code-sm">تحميل مباشر</span>' : '<span class="font-code-sm">مفتاح ترخيص فوري</span>')}
    </div>`;
  $('#detailsBody').innerHTML += `
    <div class="flex items-center gap-space-xs mb-space-md" style="border-bottom:1px solid var(--color-outline-variant);padding-bottom:var(--space-xs);overflow-x:auto">
      <button type="button" class="btn btn-primary btn-size-sm" data-dtab="overview"><span class="material-symbols-outlined" style="font-size:16px">overview</span>نظرة عامة</button>
      <button type="button" class="btn btn-ghost btn-size-sm" data-dtab="install"><span class="material-symbols-outlined" style="font-size:16px">inventory_2</span>التسليم</button>
    </div>
    <div data-dpanel="overview">
      ${showLong ? `<p class="font-body-md text-on-surface-variant mb-space-md" style="line-height:1.8">${esc(product.long)}</p>` : ''}
      ${techBadges(product)}
      ${showLicenseNote && product.licenseMode === 'key' ? `<p class="font-body-sm text-on-surface-variant mb-space-md"><span class="material-symbols-outlined text-primary" style="font-size:15px;vertical-align:-3px">key</span> ${esc(product.licenseNote)}</p>` : ''}
      ${productPaymentLabels().length ? `
      <div class="flex flex-wrap items-center gap-space-sm font-code-sm" style="background:var(--color-surface-container-low);border:1px solid var(--color-outline-variant);border-radius:var(--radius-default);padding:var(--space-sm) var(--space-md)">
        <span class="text-on-surface-variant">طرق الدفع المتاحة:</span>
        ${productPaymentLabels().map((label) => `<span class="badge badge-neutral" dir="ltr">${esc(label)}</span>`).join(' ')}
        <span class="text-success flex items-center gap-space-xs"><span class="material-symbols-outlined" style="font-size:14px">verified</span>مُوثّقة</span>
      </div>` : ''}
    </div>
    <div data-dpanel="install" style="display:none">
      ${renderDeliveryBlock(product, locked)}
    </div>
    <div class="flex flex-wrap items-center justify-between gap-space-sm" style="border-top:1px solid var(--color-outline-variant);padding-top:var(--space-md);margin-top:var(--space-md)">
      <button type="button" class="btn btn-primary btn-size-md grow" data-buy="${product.id}">
        <span class="material-symbols-outlined" style="font-size:18px">${deliveryCta(product).icon}</span>
        ${isFree ? esc(deliveryCta(product).text) : `شراء — ${esc(formatPrice(product.price, product.currency))}`}
      </button>
      ${showDemo ? `<a class="btn btn-secondary btn-size-md" href="${esc(resolveDeliveryUrl(product, product.demoUrl))}" target="_blank" rel="noopener"><span class="material-symbols-outlined" style="font-size:16px">visibility</span>معاينة حية</a>` : ''}
      ${(!locked && deliveryTarget(product) && (deliveryOf(product)?.mode === 'link' || deliveryOf(product)?.mode === 'service'))
        ? `<a class="btn btn-secondary btn-size-md" href="${esc(deliveryTarget(product))}" target="_blank" rel="noopener"><span class="material-symbols-outlined" style="font-size:16px">open_in_new</span>فتح</a>`
        : ''}
    </div>`;
  const tabs = $$('#detailsBody [data-dtab]');
  tabs.forEach((button) => button.addEventListener('click', () => {
    tabs.forEach((item) => {
      const active = item === button;
      item.classList.toggle('btn-primary', active);
      item.classList.toggle('btn-ghost', !active);
    });
    $$('#detailsBody [data-dpanel]').forEach((panel) => {
      panel.style.display = panel.dataset.dpanel === button.dataset.dtab ? 'block' : 'none';
    });
  }));
  $$('#detailsBody [data-copy]').forEach((button) => button.addEventListener('click', () => {
    navigator.clipboard.writeText(button.dataset.copy)
      .then(() => showToast('تم النسخ إلى الحافظة.', 'success'))
      .catch(() => showToast('تعذّر النسخ — انسخ يدوياً.', 'error'));
  }));
}

function shortLink(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`.slice(0, 42);
  } catch {
    return String(url).slice(0, 42);
  }
}

/* ══ حل روابط التسليم ══
   المشكلة: 4 منتجات مدفوعة كانت روابطها `github.com/nova-dev/<slug>/...`
   وهو حساب غير موجود ⇒ 404 بعد الدفع (فشل التسليم بعد استلام المال).
   الحل بلا خادم: قوالب متغيّرة + بديل آمن.
     · {slug}          → slug المنتج
     · {version}       → إصدار المنتج
     · {kind}/{type}   → نوع المنتج (exe/apk/cli/...)
     · {file}          → اسم ملف التسليم إن وُجد
   و`repo` على المنتج يتجاوز `downloadUrl`.
   ⚠️ مهم: لا نحجب مضيفاً كاملاً أبداً — `github.com` مضيف سليم تماماً،
   والميت هو *مسار الحساب* `github.com/nova-dev` تحديداً. حجب المضيف كاملاً
   كان يمنع كل روابط GitHub صحيحة — خطأ فادح. */
const DEAD_URL_HOSTS = ['nova.dev', 'example.com', 'localhost'];

function resolveDeliveryUrl(product, raw) {
  if (!raw) return '';
  const version = product.version ?? 'latest';
  const file = product.fileName ?? product.asset ?? '';
  let out = String(raw);
  out = out.replace(/\{slug\}/gi, product.slug ?? '')
           .replace(/\{version\}/gi, version)
           .replace(/\{kind\}/gi, product.kind ?? product.type ?? '')
           .replace(/\{type\}/gi, product.type ?? '')
           .replace(/\{file\}/gi, file);
  if (/\{|\}/.test(out)) return '';   // بقي متغيّر لم يُحلّ ⇒ غير صالح
  // استخراج المضيف والمسار — نطاق try ضيّق عمداً: لا يُخفي أخطاء منطقية
  let host = '';
  let pathname = '';
  try {
    const parsed = new URL(out);
    host = parsed.hostname.replace(/^www\./, '');
    pathname = parsed.pathname;
  } catch {
    return '';   // ليس رابطاً صالحاً أصلاً
  }
  // مضيف ميت بالكامل
  if (DEAD_URL_HOSTS.includes(host)) return '';
  // حساب GitHub وهمي: المضيف سليم لكن مسار المشروع غير موجود
  if (host === 'github.com' && /^\/(nova-dev|example)(\/|$)/i.test(pathname)) return '';
  return out;
}

/* الرابط الفعّال للتسليم: repo يتجاوز downloadUrl */
function deliveryUrl(product) {
  return resolveDeliveryUrl(product, product.repo ?? product.downloadUrl);
}

/* ══════════════════════════════════════════════════════════════
   منطق التسليم — ستة أنماط صريحة
   ──────────────────────────────────────────────────────────────
   المشكلة قبل هذا: التسليم كان حقلاً مسطّحاً واحداً
   (downloadUrl / repo / githubUrl / installCommands) وكلّه يُقفل
   بقاعدة واحدة عند price > 0. فلم يكن ممكناً تمثيل منشور عن مفاتيح API
   ولا موقع يقدّم خدمة مجانية — لا ملف هناك ليُحمَّل، فيرى الزائر زر
   «تحميل» لا يفعل شيئاً.

   الحل: `delivery.mode` صريح لكل منتج، ولكل نمط واجهته وزره.
   والقفل: المدفوع يُقفل دائماً (القاعدة الذهبية) · والمجاني يُفتح،
   إلا المفتاح المجاني فيُنبَّه الأدمن أنه سيصير مكشوفاً للجميع.
   ══════════════════════════════════════════════════════════════ */
const DELIVERY_MODES = {
  file:    { label: 'ملف للتحميل',  icon: 'download',   cta: 'تحميل الآن' },
  repo:    { label: 'مستودع كود',   icon: 'code',       cta: 'فتح المستودع' },
  link:    { label: 'منشور / مقال', icon: 'article',    cta: 'اقرأ المنشور' },
  service: { label: 'خدمة حيّة',    icon: 'cloud_done', cta: 'استخدم الخدمة' },
  key:     { label: 'مفتاح ترخيص',  icon: 'key',        cta: 'استلم المفتاح' },
  install: { label: 'أوامر تثبيت',  icon: 'terminal',   cta: 'أوامر التثبيت' },
};
const DELIVERY_MODE_KEYS = Object.keys(DELIVERY_MODES);

/** يُحلّ كائن التسليم من `delivery`، ويسقط لاستنتاج النمط من الحقول القديمة
    حتى لا يتعطّل أي منتج قائم. يعيد null إن لم يُعدّ شيء بعد. */
function deliveryOf(product) {
  const d = product.delivery;
  if (d && DELIVERY_MODES[d.mode]) {
    return {
      mode: d.mode,
      url: String(d.url ?? '').trim(),
      inviteUrl: String(d.inviteUrl ?? '').trim(),
      isPublic: d.isPublic !== false,
      commands: Array.isArray(d.commands) ? d.commands.filter((c) => String(c).trim()) : [],
      fileName: String(d.fileName ?? '').trim(),
      size: String(d.size ?? '').trim(),
      note: String(d.note ?? '').trim(),
    };
  }
  // ── توافق خلفي ──
  const commands = (product.installCommands ?? []).filter((c) => String(c).trim());
  const url = deliveryUrl(product);
  const base = { url, inviteUrl: '', isPublic: true, commands: [], fileName: '', size: '', note: '' };
  if (commands.length) return { ...base, mode: 'install', commands };
  if (url && /github\.com/i.test(url)) return { ...base, mode: 'repo' };
  if (url) return { ...base, mode: 'file', fileName: product.fileName ?? product.asset ?? '' };
  if (product.demoUrl) return { ...base, mode: 'link', url: resolveDeliveryUrl(product, product.demoUrl) };
  return null;
}

/** الرابط الذي يُفتح فعلاً لهذا النمط (المستودع الخاص ⇒ رابط الدعوة) */
function deliveryTarget(product, d) {
  const mode = d ?? deliveryOf(product);
  if (!mode) return '';
  if (mode.mode === 'repo') return mode.isPublic ? mode.url : (mode.inviteUrl || mode.url);
  return mode.url;
}

/** زر البطاقة: يعكس ما سيحدث فعلاً بدل «تحميل» دائماً */
function deliveryCta(product) {
  if (Number(product.price) > 0) return { text: 'اشترِ الآن', icon: 'shopping_cart' };
  const d = deliveryOf(product);
  if (!d) return { text: 'التفاصيل', icon: 'info' };
  const meta = DELIVERY_MODES[d.mode];
  // المفتاح والأوامر لا «يُفتحان» — يُعرضان في صفحة التفاصيل
  if (d.mode === 'key' || d.mode === 'install') return { text: 'اعرض طريقة الاستلام', icon: meta.icon };
  if (!deliveryTarget(product, d)) return { text: 'غير متاح بعد', icon: 'hourglass_empty' };
  return { text: meta.cta, icon: meta.icon };
}

/** التنفيذ: يفتح الوجهة، أو يعرض التفاصيل للأنماط التي تُعرض لا تُفتح */
function openDelivery(product) {
  if (!deliveryVisible(product)) {
    showToast('هذا المنتج مدفوع — محتوى التسليم يُسلَّم بعد تأكيد الدفع.', 'error');
    return;
  }
  const d = deliveryOf(product);
  if (!d || d.mode === 'key' || d.mode === 'install') {
    renderDetails(product);
    openModal('detailsModal');
    return;
  }
  const target = deliveryTarget(product, d);
  if (!target) {
    showToast('التسليم غير مُعدّ لهذا المنتج بعد.', 'error');
    return;
  }
  window.open(target, '_blank', 'noopener');
  bumpDownloadCounter(product);
}

/** عدّاد التحميلات: يزيد محلياً فوراً (يظهر للزائر بلا انتظار) ثم يُرحَّل للقاعدة */
function bumpDownloadCounter(product) {
  const downloads = readLocal('nova_downloads', {});
  downloads[product.id] = (downloads[product.id] ?? 0) + 1;
  writeLocal('nova_downloads', downloads);
  product.downloads = (Number(product.downloads) || 0) + 1;
  renderStats();
  if (typeof DB !== 'undefined' && DB.isOnline() && typeof DB.incrementDownload === 'function') {
    DB.incrementDownload(product.id).catch(() => {});
  }
}

/** كتلة التسليم في صفحة التفاصيل — واجهة مختلفة لكل نمط */
function renderDeliveryBlock(product, locked) {
  const d = deliveryOf(product);
  const free = !Number(product.price);

  if (locked) {
    return `
      <div class="flex items-center gap-space-sm font-body-sm text-on-surface-variant" style="background:var(--color-surface-container-low);border:1px dashed var(--color-outline-variant);border-radius:var(--radius-default);padding:var(--space-sm) var(--space-md)">
        <span class="material-symbols-outlined text-primary" style="font-size:16px">lock</span>
        <span>محتوى التسليم يُسلَّم بعد تأكيد الدفع — لا يظهر هنا حتى لو نُسي إخفاؤه.</span>
      </div>`;
  }

  if (!d) {
    return `
      <div class="flex items-center gap-space-sm font-body-sm text-on-surface-variant" style="background:var(--color-surface-container-low);border:1px dashed var(--color-outline-variant);border-radius:var(--radius-default);padding:var(--space-sm) var(--space-md)">
        <span class="material-symbols-outlined" style="font-size:16px">hourglass_empty</span>
        <span>لم يُعدّ التسليم لهذا المنتج بعد.</span>
      </div>`;
  }

  const meta = DELIVERY_MODES[d.mode];
  let inner = '';

  if (d.mode === 'install' && d.commands.length) {
    inner = `
      <div class="font-code-sm custom-scroll" style="background:var(--color-surface-container-lowest);border:1px solid var(--color-outline-variant);border-radius:var(--radius-default);padding:var(--space-sm) var(--space-md)">
        ${d.commands.map((command) => `
        <div class="flex items-center justify-between gap-space-sm" style="border-bottom:1px solid var(--color-outline-variant);padding:var(--space-xs) 0">
          <code class="font-code-sm text-on-surface" dir="ltr"><span class="text-success" style="font-weight:700">$ </span>${esc(command)}</code>
          <button type="button" class="btn btn-ghost btn-size-sm" data-copy="${esc(command)}" style="flex-shrink:0">نسخ</button>
        </div>`).join('')}
      </div>`;
  } else if (d.mode === 'key') {
    inner = `
      <div class="flex items-center gap-space-sm font-body-sm text-on-surface-variant" style="background:var(--color-surface-container-low);border:1px dashed var(--color-outline-variant);border-radius:var(--radius-default);padding:var(--space-sm) var(--space-md)">
        <span class="material-symbols-outlined text-primary" style="font-size:16px">key</span>
        <span>يُسلَّم مفتاح الترخيص عند الشراء ويظهر في صندوق «متابعة طلب سابق».</span>
      </div>`;
  } else if (d.mode === 'repo' && !d.isPublic) {
    inner = `
      <div class="flex items-center gap-space-sm font-body-sm text-on-surface-variant" style="background:var(--color-surface-container-low);border:1px solid var(--color-outline-variant);border-radius:var(--radius-default);padding:var(--space-sm) var(--space-md)">
        <span class="material-symbols-outlined text-primary" style="font-size:16px">lock</span>
        <span>مستودع خاص — تُرسَل دعوة الوصول إلى بريدك بعد الشراء.</span>
      </div>`;
  } else {
    const target = deliveryTarget(product, d);
    const shown = d.fileName || shortLink(target);
    inner = `
      <div class="flex items-center justify-between gap-space-sm font-code-sm text-on-surface-variant" style="background:var(--color-surface-container-low);border:1px solid var(--color-outline-variant);border-radius:var(--radius-default);padding:var(--space-sm) var(--space-md)">
        <span>${esc(d.mode === 'file' ? 'الملف' : (d.mode === 'service' ? 'الخدمة' : 'الرابط'))}${d.size ? ' · ' + esc(d.size) : ''}:</span>
        <a href="${esc(target)}" target="_blank" rel="noopener" class="text-primary flex items-center gap-space-xs" dir="ltr" style="max-width:70%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
          <span class="material-symbols-outlined" style="font-size:14px">link</span>${esc(shown)}
        </a>
      </div>`;
  }

  // تحذير صادق: مفتاح مجاني = مكشوف للجميع
  const freeKeyWarning = (free && d.mode === 'key')
    ? `<p class="font-body-sm text-primary mt-space-sm">
         <span class="material-symbols-outlined" style="font-size:14px;vertical-align:-2px">warning</span>
         منتج مجاني بمفتاح: المفتاح يظهر لكل زائر.</p>`
    : '';

  return `
    <div class="flex items-center gap-space-xs mb-space-xs">
      <span class="material-symbols-outlined text-primary" style="font-size:16px">${meta.icon}</span>
      <span class="font-label-sm text-on-surface-variant">طريقة التسليم: ${esc(meta.label)}</span>
    </div>
    ${inner}
    ${d.note ? `<p class="font-body-sm text-on-surface-variant mt-space-sm">${esc(d.note)}</p>` : ''}
    ${freeKeyWarning}`;
}

/* ── التحميل/التسليم الفوري ──
   أُعيد توجيهه إلى openDelivery الذي يعرف الأنماط الستة: الملف يُحمَّل،
   والمنشور والخدمة يُفتحان، والمستودع يُفتح أو يُنتظر منه دعوة،
   والمفتاح والأوامر يُعرضان في صفحة التفاصيل. */
function freeDownload(product) {
  openDelivery(product);
}

/* ── هل المحفظة قابلة للاستخدام فعلاً؟ ──
   القاعدة الهندسية: غير مُعدّة ⇒ لا تُعرض. والحقل الفارغ هو الإشارة.
   سبب وجودها: عرض وسيلة دفع معطوبة **أسوأ من عدم عرضها** — المشتري يقرّر
   الشراء ثم يُرسل مالاً إلى عنوان لا يملكه أحد.
   · الرقمية (crypto)  ⇒ تحتاج عنواناً صالحاً (١٢ محرفاً على الأقل).
   · المحلية (local)   ⇒ تحتاج رقم حساب + اسم صاحب الحساب معاً. */
const PLACEHOLDER_RE = /(example|demo|test|xxxx+|your[-_]?|placeholder|change[-_]?me|work[-_]?showcase|nova[-_]?dev)/i;

function isConfiguredWallet(wallet) {
  if (!wallet || wallet.enabled === false) return false;
  if (wallet.type === 'local') {
    const account = String(wallet.account ?? '').trim();
    const owner = String(wallet.accountName ?? '').trim();
    return account.length >= 4 && !PLACEHOLDER_RE.test(account) && owner.length >= 2;
  }
  const address = String(wallet.address ?? '').trim();
  return address.length >= 12 && !PLACEHOLDER_RE.test(address);
}

/** اسم الدولة من رمزها — القائمة في settings.countries (قابلة للتوسيع من الإعدادات) */
function countryLabel(code) {
  if (!code) return '';
  const map = state.settings?.countries ?? {};
  return map[code] ?? code;
}

/** وسم نوع المحفظة كما يراه المشتري */
function walletBadges(wallet) {
  const out = [];
  if (wallet.type === 'local') {
    out.push('<span class="badge badge-neutral">محلية</span>');
    if (wallet.country) out.push(`<span class="badge badge-success">${esc(countryLabel(wallet.country))}</span>`);
  } else {
    out.push('<span class="badge badge-neutral">رقمية</span>');
    if (wallet.network) out.push(`<span class="badge badge-indigo">${esc(wallet.network)}</span>`);
  }
  return out.join(' ');
}

/** أيقونة المحفظة: صورة مرفوعة إن وُجدت، وإلا حرف/رمز قصير */
function walletIcon(wallet) {
  if (wallet.logo) return `<span class="pay-ico"><img src="${esc(wallet.logo)}" alt=""></span>`;
  const text = wallet.type === 'local'
    ? String(wallet.provider ?? wallet.label ?? '؟').trim().charAt(0)
    : String(wallet.currency ?? '؟').trim().slice(0, 4);
  return `<span class="pay-ico">${esc(text)}</span>`;
}

/* ── مسار الشراء (Checkout بثلاث خطوات) ──
   الخيارات = **المحافظ وحدها** — نظام واحد بدل نظامين متوازيين.
   كل المحافظ المُفعّلة والمُعدّة تُعرض للمشتري والمستخدم يختار؛
   لا فلترة بالبلد ولا ربط بمنتج بعينه. التسعير بالدولار لكل المحافظ.
   المحفظة الافتراضية تظهر أولاً وتُحدَّد تلقائياً. */
function collectPaymentOptions() {
  return (state.wallets ?? [])
    .filter(isConfiguredWallet)
    .sort((a, b) => Number(b.isDefault === true) - Number(a.isDefault === true));
}

function openCheckout(product) {
  if (!product.price) { freeDownload(product); return; }
  const options = collectPaymentOptions();
  if (!options.length) {
    showToast('لم يُعدّ صاحب المتجر أي محفظة للدفع بعد — تواصل معه مباشرة.', 'error');
    return;
  }
  state.checkout = { product, methodKey: null, step: 1, timerId: null, timerEnd: 0, discount: null };
  // تنظيف بقايا طلب سابق (اسم/إثبات/كوبون) قبل فتح مسار جديد
  const payerNameEl = $('#payerName');
  if (payerNameEl) payerNameEl.value = '';
  const payerRefEl = $('#payerRef');
  if (payerRefEl) payerRefEl.value = '';
  const payerEmailEl = $('#payerEmail');
  if (payerEmailEl) payerEmailEl.value = '';
  const couponEl = $('#couponInput');
  if (couponEl) couponEl.value = '';
  renderCheckoutMethods(options);
  renderCheckoutSidebar();
  setCheckoutStep(1);
  openModal('checkoutModal');
  if (options.length === 1) selectMethod(options[0].id);
}

function renderCheckoutMethods(options) {
  $('#paymentMethods').innerHTML = options.map((wallet) => `
    <label class="payment-opt" data-method="${esc(wallet.id)}">
      <input type="radio" name="payMethod" value="${esc(wallet.id)}" style="accent-color:var(--color-primary)">
      ${walletIcon(wallet)}
      <span class="pay-body">
        <span class="pay-title">${esc(wallet.label ?? wallet.id)}${wallet.isDefault ? ' <span class="badge badge-success">افتراضية</span>' : ''}</span>
        <span class="pay-tags">${walletBadges(wallet)}</span>
      </span>
      <span class="pay-radio"></span>
    </label>`).join('');
  $$('#paymentMethods .payment-opt').forEach((option) => {
    option.addEventListener('click', () => selectMethod(option.dataset.method));
  });
}

function selectMethod(methodKey) {
  if (!state.checkout) return;
  state.checkout.methodKey = methodKey;
  $$('#paymentMethods .payment-opt').forEach((option) => {
    const selected = option.dataset.method === methodKey;
    option.classList.toggle('selected', selected);
    option.querySelector('input').checked = selected;
  });
}

/* ── الكوبون وجدول التفصيل المالي (كمرجع checkout_modal) ── */
function checkoutTotals(product) {
  const checkout = state.checkout ?? { product, discount: null };
  const price = product.price;
  const discount = checkout.discount ?? null;
  const discountValue = discount
    ? (discount.type === 'fixed' ? Math.min(discount.amount, price) : +(price * discount.amount / 100).toFixed(2))
    : 0;
  return { price, discount, discountValue, total: Math.max(0, +(price - discountValue).toFixed(2)) };
}

function renderCheckoutSummary() {
  const box = $('#checkoutSummary');
  if (!box || !state.checkout) return;
  const { price, discount, discountValue, total } = checkoutTotals(state.checkout.product);
  box.innerHTML = `
    <div class="flex flex-col gap-space-xs font-body-sm" style="border-top:1px solid var(--color-outline-variant);padding-top:var(--space-sm)">
      <div class="flex items-center justify-between text-on-surface-variant"><span>سعر الترخيص</span><span class="font-num" dir="ltr">${esc(formatPrice(price, state.checkout.product.currency))}</span></div>
      ${discount ? `
      <div class="flex items-center justify-between text-success">
        <span class="flex items-center gap-space-xs">خصم ${esc(discount.label)}<span class="badge badge-success font-code-sm" dir="ltr">${esc(discount.code)}</span></span>
        <span class="font-num" dir="ltr">-${esc(formatPrice(discountValue, state.checkout.product.currency))}</span>
      </div>` : ''}
      <div class="flex items-center justify-between text-on-surface-variant"><span>رسوم الوسيط</span><span class="font-num text-success" dir="ltr">$0.00</span></div>
      <div class="flex items-baseline justify-between" style="border-top:1px solid var(--color-outline-variant);padding-top:var(--space-xs)">
        <span class="font-body-md" style="font-weight:600">الإجمالي المطلوب:</span>
        <span class="font-num text-primary" style="font-size:1.35rem" dir="ltr">${esc(formatPrice(total, state.checkout.product.currency))}</span>
      </div>
      <p class="font-body-sm text-on-surface-variant">ضمان استرجاع كامل خلال ١٤ يوماً بلا حاجة لذكر سبب — <a href="terms.html" target="_blank" rel="noopener" class="text-primary">تفاصيل السياسة</a>.</p>
    </div>`;
}

/* ── الشريط الجانبي للملخص في الدفع (إضافة) ── */
function renderCheckoutSidebar() {
  const box = $('#checkoutSidebar');
  if (!box || !state.checkout) return;
  const product = state.checkout.product;
  const { price, discount, discountValue, total } = checkoutTotals(product);
  const meta = kindMeta(product);
  const features = (product.features ?? []).slice(0, 4);
  box.innerHTML = `
    <div class="cs-head">
      <span class="cs-icon"><span class="material-symbols-outlined">${meta.icon}</span></span>
      <div style="min-width:0">
        <div class="cs-title">${esc(product.name)}</div>
        <div class="cs-sub font-num" dir="ltr">v${esc(product.version ?? '')} · ${esc(meta.label)}</div>
      </div>
    </div>
    ${product.short ? `<p class="font-body-sm text-on-surface-variant mb-space-sm">${esc(product.short)}</p>` : ''}
    <div class="cs-row"><span>سعر الترخيص</span><span class="font-num" dir="ltr">${esc(formatPrice(price, product.currency))}</span></div>
    ${discount ? `<div class="cs-row" style="color:var(--color-success)"><span>خصم ${esc(discount.code)}</span><span class="font-num" dir="ltr">-${esc(formatPrice(discountValue, product.currency))}</span></div>` : ''}
    <div class="cs-row"><span>رسوم الوسيط</span><span class="font-num text-success" dir="ltr">$0.00</span></div>
    <div class="cs-row total"><span>الإجمالي</span><span class="font-num text-primary" dir="ltr" style="font-size:1.1rem">${esc(formatPrice(total, product.currency))}</span></div>
    ${features.length ? `
    <div class="cs-note" style="border-top:none;padding-top:var(--space-sm);margin-top:0">
      ${features.map((f) => `<div class="cs-feature"><span class="material-symbols-outlined">check_circle</span><span>${esc(f)}</span></div>`).join('')}
    </div>` : ''}
    <div class="cs-note">
      <span class="material-symbols-outlined" style="font-size:13px;vertical-align:-2px">verified_user</span>
      ضمان استرجاع كامل خلال ١٤ يوماً — <a href="terms.html" target="_blank" rel="noopener" class="text-primary">الشروط</a>.
    </div>`;
}

function applyCoupon() {
  const checkout = state.checkout;
  if (!checkout) return;
  const code = ($('#couponInput')?.value ?? '').trim().toUpperCase();
  if (!code) { showToast('اكتب كود الخصم أولاً.', 'error'); return; }
  const discounts = state.settings.discounts ?? [];
  const found = discounts.find((item) => String(item.code ?? '').toUpperCase() === code);
  if (!found) {
    checkout.discount = null;
    renderCheckoutSummary();
    showToast('كود الخصم غير صالح.', 'error');
    return;
  }
    checkout.discount = {
    code: found.code, label: found.label ?? 'خصم',
    amount: Number(found.amount) || 0,
    type: found.type === 'fixed' ? 'fixed' : 'percent',
  };
  renderCheckoutSummary();
  renderCheckoutSidebar();
  showToast(`طُبِّق الكوبون ${found.code} بنجاح.`, 'success');
}

function setCheckoutStep(step) {
  if (!state.checkout) return;
  state.checkout.step = step;
  for (let index = 1; index <= 3; index += 1) {
    $(`#checkoutStep${index}`).style.display = index === step ? 'block' : 'none';
    const dot = $(`#stepDot${index}`);
    dot.classList.toggle('active', index === step);
    dot.classList.toggle('done', index < step);
    dot.textContent = index < step ? '✓' : String(index);
  }
  $('#checkoutNext').textContent = step === 2 ? 'تأكيد الطلب' : 'التالي';
  // زر الرجوع: يظهر في الخطوة ٢ فقط للعودة وتغيير طريقة الدفع
  const backBtn = $('#checkoutBack');
  if (backBtn) backBtn.style.display = step === 2 ? '' : 'none';
  if (step === 2) {
    renderCheckoutSummary();
    const wallet = (state.wallets ?? []).find((item) => item.id === state.checkout.methodKey);
    if (wallet?.type === 'crypto') startCheckoutTimer();
    else stopCheckoutTimer();
  } else {
    stopCheckoutTimer();
  }
}

/* مؤقت صلاحية السعر (15 دقيقة) للمحافظ المشفرة — كالمرجع */
function startCheckoutTimer() {
  stopCheckoutTimer();
  state.checkout.timerEnd = Date.now() + 15 * 60 * 1000;
  state.checkout.timerId = setInterval(() => {
    const display = $('#txCountdown');
    if (!display) { stopCheckoutTimer(); return; }
    const remaining = Math.max(0, Math.round((state.checkout.timerEnd - Date.now()) / 1000));
    const minutes = String(Math.floor(remaining / 60)).padStart(2, '0');
    const seconds = String(remaining % 60).padStart(2, '0');
    display.textContent = remaining > 0 ? `${minutes}:${seconds}` : '00:00 — انتهت';
    if (remaining === 0) {
      stopCheckoutTimer();
      showToast('انتهت صلاحية السعر — أكمل الطلب أو أعد المحاولة.', 'error');
    }
  }, 1000);
}

function stopCheckoutTimer() {
  if (state.checkout?.timerId) {
    clearInterval(state.checkout.timerId);
    state.checkout.timerId = null;
  }
}

function renderPaymentDetails(methodKey) {
  const wallet = (state.wallets ?? []).find((item) => item.id === methodKey);
  if (!wallet) return;
  renderWalletPaymentDetails(wallet);
}

/* ── أُزيلت resolvePaymentLink() ──
   كانت تُعدّل مبلغاً داخل رابط دفع (PayPal مثلاً). وبعد إلغاء الوسطاء
   والاكتفاء بالمحافظ، لم يبقَ لها أي موضع نداء — فحُذفت بدل تركها كوداً ميتاً. */


/* ── تفاصيل الدفع: المحفظة هي الطريقة الوحيدة ──
   الرقمية: عنوان بخط ثابت + QR + تحذير شبكة صريح (شبكة خاطئة = فقدان المال).
   المحلية: رقم المحفظة + اسم صاحب الحساب + الدولة.
   الفارغ لا يُرسم: لا صف «شبكة» لمحفظة محلية، ولا صف «دولة» لرقمية. */
function renderWalletPaymentDetails(wallet) {
  const isCrypto = wallet.type !== 'local';
  const total = state.checkout?.product ? checkoutTotals(state.checkout.product).total : 0;
  const currency = state.checkout?.product?.currency ?? 'USD';

  const rows = [];
  if (isCrypto) {
    if (wallet.address) rows.push(['عنوان الاستقبال', wallet.address, true]);
    if (wallet.network) rows.push(['الشبكة', wallet.network, true]);
    if (wallet.currency) rows.push(['العملة', wallet.currency, true]);
  } else {
    if (wallet.provider) rows.push(['المزوّد', wallet.provider, false]);
    if (wallet.country) rows.push(['الدولة', countryLabel(wallet.country), false]);
    if (wallet.account) rows.push(['رقم المحفظة / الهاتف', wallet.account, true]);
    if (wallet.accountName) rows.push(['اسم صاحب الحساب', wallet.accountName, false]);
  }

  const copyValue = isCrypto ? wallet.address : wallet.account;

  $('#paymentDetails').innerHTML = `
    <div class="flex items-center gap-space-sm mb-space-md flex-wrap">
      ${walletIcon(wallet)}
      <span class="font-headline-sm">${esc(wallet.label ?? '')}</span>
      <span class="flex gap-space-xs">${walletBadges(wallet)}</span>
    </div>

    <div class="flex items-center justify-between gap-space-sm mb-space-md"
         style="background:var(--color-surface-container-low);border:1px solid var(--color-outline-variant);border-radius:var(--radius-default);padding:var(--space-sm) var(--space-md)">
      <span class="font-label-sm text-on-surface-variant">المبلغ المطلوب</span>
      <span class="font-num text-primary" style="font-size:1.35rem" dir="ltr">${esc(formatPrice(total, currency))}</span>
    </div>

    ${!isCrypto ? `
    <div class="net-warn mb-space-md">
      <span class="material-symbols-outlined">currency_exchange</span>
      <span>المبلغ معروض بعملة المنتج <b>${esc(currency)}</b>. حوّله إلى ما يعادله بالعملة المحلية لهذه المحفظة
      ${wallet.currency ? `(<b dir="ltr">${esc(wallet.currency)}</b>)` : ''} وتأكد منه قبل التحويل — أو تواصل معنا لمعرفة المبلغ الدقيق.</span>
    </div>` : ''}

    ${walletAddressQR(wallet)}

    ${rows.length ? `<div class="card-bleed p-space-sm mb-space-md">
      ${rows.map(([label, value, mono]) => `
        <div class="detail-row">
          <span class="k">${esc(label)}</span>
          <span class="v${mono ? '' : ' font-body-sm'}"${mono ? ' dir="ltr"' : ''}>${esc(value)}</span>
        </div>`).join('')}
    </div>` : ''}

    ${isCrypto && wallet.network ? `
    <div class="net-warn mb-space-md">
      <span class="material-symbols-outlined">error</span>
      <span>أرسل على شبكة <b>${esc(wallet.network)}</b> فقط. أي شبكة أخرى تعني فقدان المبلغ نهائياً ولا يمكن استرجاعه.</span>
    </div>` : ''}

    ${isCrypto ? `
    <div class="flex items-center justify-between gap-space-sm mb-space-md">
      <span class="font-label-sm text-on-surface-variant">صلاحية سعر الصرف</span>
      <span class="font-num text-primary" id="txCountdown" style="font-size:1.05rem">15:00</span>
    </div>` : ''}

    ${wallet.note ? `<p class="font-body-sm text-on-surface-variant mb-space-md">${esc(wallet.note)}</p>` : ''}

    ${copyValue ? `
    <button type="button" class="btn btn-secondary btn-size-md btn-block" data-copy="${esc(copyValue)}">
      <span class="material-symbols-outlined" style="font-size:16px">content_copy</span>
      ${isCrypto ? 'نسخ عنوان المحفظة' : 'نسخ رقم المحفظة'}
    </button>` : ''}`;

  const copyButton = $('#paymentDetails [data-copy]');
  copyButton?.addEventListener('click', () => {
    navigator.clipboard.writeText(copyButton.dataset.copy)
      .then(() => showToast('تم النسخ إلى الحافظة.', 'success'))
      .catch(() => showToast('تعذّر النسخ — انسخ يدوياً.', 'error'));
  });
}

/* QR: صورة مخصصة إن وُجدت، وإلا توليد من العنوان (qrious) للمحافظ الرقمية.
   المحلية لا QR لها من العنوان — رقم الحساب يُنسخ لا يُمسح.
   وإن غابت مكتبة التوليد (بلا اتصال · أو فتح مباشر بلا خادم) لا نُخفي الصف
   بصمت: نُخبر المشتري أن ينسخ العنوان. الصمت هنا يعني «لا QR ولا سبب». */
function walletAddressQR(wallet) {
  if (wallet.qr) {
    return `<div class="qr-wrap flex justify-center mb-space-md"><img src="${esc(wallet.qr)}" alt="QR" width="120" height="120"></div>`;
  }
  if (wallet.type === 'local' || !wallet.address) return '';
  if (typeof window.QRious !== 'function') {
    return `<p class="font-body-sm text-on-surface-variant mb-space-md" style="text-align:center">
      <span class="material-symbols-outlined" style="font-size:14px;vertical-align:-2px">qr_code_2</span>
      رمز QR غير متاح الآن — انسخ العنوان بالأسفل.</p>`;
  }
  try {
    const qr = new window.QRious({ value: wallet.address, size: 120, background: '#ffffff', foreground: '#0d0e12' });
    return `<div class="qr-wrap flex justify-center mb-space-md"><img src="${qr.toDataURL()}" alt="QR" width="120" height="120"></div>`;
  } catch (error) {
    console.warn('تعذّر توليد QR:', error.message);
    return '';
  }
}


/* ── إرسال الطلب إلى endpoint خارجي (إنتاجي) ──
   يعمل مع: Formspree · Google Sheets (Apps Script) · Web3Forms · Getform · Basin
   الحقل: settings.purchasesEndpoint — إن كان فارغاً يبقى الحفظ المحلي فقط. */
async function sendOrderToEndpoint(order) {
  const endpoint = String(state.settings.purchasesEndpoint ?? '').trim();
  if (!endpoint) return false;
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        _subject: `طلب جديد ${order.reference} — ${order.productName}`,
        reference: order.reference,
        product: order.productName,
        productId: order.productId,
        price: order.price,
        currency: order.currency,
        discount: order.discountCode ?? '',
        total: order.total,
        method: order.methodLabel ?? order.methodKey,
        payerName: order.payerName,
        payerRef: order.payerRef,
        payerEmail: order.payerEmail ?? '',
        status: order.status,
        createdAt: order.createdAt,
      }),
    });
    return response.ok;
  } catch (error) {
    console.warn('تعذّر إرسال الطلب للـ endpoint:', error.message);
    return false;
  }
}

/* ── توليد رقم مرجع الطلب ──
   بطلب المالك: الرقم **٦ محارف** بدل ١٢ — أقصر على المشتري وأسهل في نقله من
   إشعار التحويل. وبلا بادئة `REF-` لأنها كانت تستهلك ٤ من الـ١٢ بلا قيمة.

   ⚠️ مقايضة يجب معرفتها: 32^6 ≈ 1.07 مليار احتمال (كان 10^12 بـ8 محارف).
   لا يزال غير قابل للتخمين عملياً لمتجر صغير، لكنه أضعف. فإن كثرت الطلبات
   لاحقاً فأعد الطول إلى 8، أو أضف حدّاً لعدد محاولات التتبّع.

   عشوائي فعلاً من مولّد آمن (crypto) لا من الزمن — والمرجع هو المفتاح الوحيد
   لمتابعة الطلب واستلام المنتج، فلو كان زمنياً لأمكن حساب مراجع الآخرين. */
const ORDER_REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // بلا I/O/0/1 لتجنّب اللبس
const ORDER_REF_LEN = 6;

function generateOrderReference() {
  const bytes = new Uint8Array(ORDER_REF_LEN);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += ORDER_REF_ALPHABET[bytes[i] % ORDER_REF_ALPHABET.length];
  return out;
}

/* ── إنهاء الطلب: حفظ محلي + مفتاح مبدئي من المخزون ── */
function completeOrder() {
  const checkout = state.checkout;
  const payerName = $('#payerName').value.trim();
  const payerRef = $('#payerRef').value.trim();
  const payerEmail = ($('#payerEmail')?.value ?? '').trim();
  if (!payerName || !payerRef) {
    showToast('اكتب اسمك ورقم العملية لإكمال الطلب.', 'error');
    return;
  }
  // البريد اختياري، لكن إن كُتب فيجب أن يكون صالحاً — وإلا ضاع المفتاح بلا وسيلة تواصل.
  if (payerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(payerEmail)) {
    showToast('صيغة البريد الإلكتروني غير صحيحة.', 'error');
    return;
  }
  const reference = generateOrderReference();
  const wallet = (state.wallets ?? []).find((item) => item.id === checkout.methodKey);
  const totals = checkoutTotals(checkout.product);
  // كان هنا بناء مصفوفة ثم دفع الطلب فيها — ولا تُكتب أبداً في فرع الأونلاين
  // (DB.saveOrder يتولّى الكتابة المحلية بنفسه). كود ميت أُزيل.
  const createdOrder = {
    reference, productId: checkout.product.id, productName: checkout.product.name,
    price: totals.price, currency: checkout.product.currency,
    discountCode: totals.discount?.code ?? '', discountValue: totals.discountValue, total: totals.total,
    methodKey: checkout.methodKey,
    methodLabel: wallet
      ? (wallet.type === 'local'
          ? `${wallet.label ?? ''} — ${wallet.account ?? ''}`
          : `${wallet.label ?? ''} — ${wallet.network ?? ''}`)
      : checkout.methodKey,
    walletId: wallet?.id ?? '', walletEndpoint: wallet?.endpointId ?? '',
    payerName, payerRef, payerEmail, status: 'pending',
    createdAt: new Date().toISOString(),
  };
  // الحفظ عبر طبقة البيانات (الأونلاين إن وُجدت، وإلا محلياً).
  // db.js يكتب الإيصال المحلي **دائماً** حتى مع نجاح الأونلاين — فالمشتري
  // يستطيع متابعة طلبه بلا إنترنت ولو سقطت القاعدة.
  // رسالة واحدة للنجاح: كان نجاح الأونلاين ونجاح الـ endpoint يعرضان التوست نفسه مرتين
  let orderNotified = false;
  const notifyOrderSent = () => {
    if (orderNotified) return;
    orderNotified = true;
    showToast('تم إرسال طلبك — سنتواصل معك للتأكيد قريباً.', 'success');
  };
  if (typeof DB !== 'undefined') {
    DB.saveOrder(createdOrder).then((res) => {
      if (res.online) notifyOrderSent();
    });
  } else {
    const localOrders = readLocal('nova_purchases', []);
    localOrders.push(createdOrder);
    writeLocal('nova_purchases', localOrders);
  }
  // إرسال للـ endpoint الخارجي إن كان مُعدّاً (يبقى احتياطاً)
  sendOrderToEndpoint(createdOrder).then((sent) => {
    if (sent) notifyOrderSent();
  });
  stopCheckoutTimer();
  setCheckoutStep(3);
  setTimeout(() => {
    closeModal('checkoutModal');
    showSuccess(checkout.product, reference);
    showToast('تم حفظ طلبك محلياً — أرسل الإثبات لإتمام التفعيل.', 'success');
  }, 900);
}

function showSuccess(product, reference) {
  const totals = checkoutTotals(product);
  $('#successDetails').innerHTML = `
    <div class="flex items-start justify-between gap-space-sm mb-space-xs">
      <span class="font-label-sm text-on-surface-variant">رقم الطلب</span>
      <code class="font-code-md text-primary">${esc(reference)}</code>
    </div>
    <div class="flex items-start justify-between gap-space-sm mb-space-xs">
      <span class="font-label-sm text-on-surface-variant">المنتج</span>
      <span class="font-body-md font-latin">${esc(product.name)}</span>
    </div>
    <div class="flex items-start justify-between gap-space-sm mb-space-xs">
      <span class="font-label-sm text-on-surface-variant">المبلغ المطلوب</span>
      <span class="font-num font-body-md" dir="ltr">${esc(formatPrice(totals.total, product.currency))}</span>
    </div>
    ${product.githubInviteUrl && clientVisible(product, 'githubUrl', product.githubInviteUrl) ? `
    <div class="flex items-center justify-between gap-space-sm mb-space-xs" style="background:var(--color-surface-container-lowest);border:1px dashed var(--color-outline-variant);border-radius:var(--radius-default);padding:var(--space-sm) var(--space-md)">
      <span class="font-body-sm text-on-surface-variant">دعوة مستودع المصدر (GitHub)</span>
      <span class="flex items-center gap-space-xs">
        <span class="font-code-sm text-primary flex items-center gap-space-xs"><span class="material-symbols-outlined" style="font-size:14px">lock</span>تُسلَّم بعد تأكيد الدفع</span>
        <button type="button" class="btn btn-secondary btn-size-sm" data-copy="${esc(product.githubInviteUrl)}" title="نسخ رابط المستودع">
          <span class="material-symbols-outlined" style="font-size:14px">content_copy</span> نسخ الرابط
        </button>
      </span>
    </div>` : ''}
    <p class="font-body-sm text-on-surface-variant" style="border-top:1px solid var(--color-outline-variant);padding-top:var(--space-xs)">
      <span class="material-symbols-outlined text-success" style="font-size:14px;vertical-align:-2px">verified_user</span>
      احتفظ برقم الطلب وتابعه من صندوق «متابعة طلب سابق».
    </p>`;
  $$('#successDetails [data-copy]').forEach((button) => button.addEventListener('click', () => {
    navigator.clipboard.writeText(button.dataset.copy)
      .then(() => showToast('تم نسخ رابط المستودع.', 'success'))
      .catch(() => showToast('تعذّر النسخ — انسخ يدوياً.', 'error'));
  }));
  const dlBtn = $('#downloadNowBtn');
  if (dlBtn) {
    const cta = deliveryCta(product);
    dlBtn.style.display = product.price ? 'none' : 'flex';
    dlBtn.innerHTML = `<span class="material-symbols-outlined" style="font-size:16px">${cta.icon}</span> ${esc(cta.text)}`;
  }
  // نحفظ المرجع ليُستَرجَع تلقائياً في صندوق «متابعة طلب سابق» بلا إعادة كتابة
  if (reference) writeLocal('nova_last_ref', reference);
  openModal('successModal');
}

/* ── تفويض النقرات العامة (بطاقات + أزرار الشراء) ── */
function initGlobalClicks() {
  document.addEventListener('click', (event) => {
    const detailsButton = event.target.closest('[data-details]');
    if (detailsButton) {
      const product = state.products.find((p) => p.id === Number(detailsButton.dataset.details));
      if (product) { renderDetails(product); openModal('detailsModal'); }
      return;
    }
    const buyButton = event.target.closest('[data-buy]');
    if (buyButton) {
      const product = state.products.find((p) => p.id === Number(buyButton.dataset.buy));
      if (product) { closeModal('detailsModal'); openCheckout(product); }
    }
  });
  $('#checkoutNext')?.addEventListener('click', () => {
    if (!state.checkout) return;
    if (state.checkout.step === 1) {
      if (!state.checkout.methodKey) { showToast('اختر طريقة دفع أولاً.', 'error'); return; }
      renderPaymentDetails(state.checkout.methodKey);
      setCheckoutStep(2);
    } else if (state.checkout.step === 2) {
      completeOrder();
    }
  });
  $('#checkoutBack')?.addEventListener('click', () => {
    if (!state.checkout) return;
    if (state.checkout.step === 2) setCheckoutStep(1);
  });
  $('#applyCouponBtn')?.addEventListener('click', applyCoupon);
  $('#couponInput')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); applyCoupon(); }
  });
  $('#downloadNowBtn')?.addEventListener('click', () => {
    if (state.checkout?.product) freeDownload(state.checkout.product);
  });
}

/* ── الاقتراحات: تُحفظ أونلاين إن اتصلت القاعدة، وإلا محلياً ── */
function initSuggestions() {
  $('#suggestionForm')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = $('#sugText').value.trim();
    if (!text) return;
    const suggestion = {
      id: Date.now(), name: $('#sugName').value.trim() || 'زائر',
      text, createdAt: new Date().toISOString(),
    };
    if (typeof DB !== 'undefined') {
      // db.js يكتب الإيصال المحلي بنفسه عند فشل الأونلاين —
      // إضافة محلية هنا كانت تكرّر الاقتراح في nova_suggestions (عطل مكتشف).
      DB.saveSuggestion(suggestion);
    } else {
      const suggestions = readLocal('nova_suggestions', []);
      suggestions.push(suggestion);
      writeLocal('nova_suggestions', suggestions);
    }
    event.target.reset();
    showToast('وصلت فكرتك — شكراً لمساهمتك!', 'success');
  });
}

/* ── الإحصاءات ── */
function renderStats() {
  const active = state.products.filter((product) => product.status !== 'hidden');
  const totalDownloads = active.reduce((sum, product) => sum + (product.downloads ?? 0), 0);
  const setText = (id, value) => { const el = $(id); if (el) el.textContent = value; };
  setText('#statProducts', String(active.length));
  setText('#statDownloads', totalDownloads.toLocaleString('en-US'));

  // عدد المحافظ القابلة للاستخدام فعلاً — لا نعدّ ما لا يمكن الدفع به.
  // تُخفى البطاقة كلياً عند الصفر، تطبيقاً لقاعدة المشروع: الفارغ لا يُرسم.
  const methods = (state.wallets ?? []).filter(isConfiguredWallet);
  const card = $('#statPaymentsCard');
  if (card) {
    card.style.display = methods.length ? '' : 'none';
    setText('#statPayments', String(methods.length));
  }
}

/* ── لافتة تشخيص: الصفحة بلا بيانات ──
   كانت تظهر في حالة واحدة فقط (فتح مباشر بـ file://)، فلو فشل جلب ملفات
   JSON عبر http — ملف ناقص، مسار خاطئ، أو رفع مجلد غير كامل — لم يظهر شيء
   وبدا المتجر «فارغاً» بلا تفسير. الآن تُشخّص الحالتين وتُسمّي السبب.
   والهدف ليس الزخرفة: بلا بيانات لا متجر، فاللافتة يجب أن تقول ماذا تفعل. */
function showLoadWarning() {
  if (state.products.length) return;
  const grid = $('#productGrid');
  if (!grid) return;

  const isFile = location.protocol === 'file:';
  const title = isFile ? 'الصفحة مفتوحة مباشرة من الملف' : 'تعذّر الوصول إلى ملفات البيانات';
  const why = isFile
    ? 'المتصفح يمنع قراءة ملفات JSON عند فتح الصفحة بـ <code class="font-code-sm">file://</code> — قيد أمني في كل المتصفحات، وليس عيباً في الموقع.'
    : 'لم تُجلب ملفات <code class="font-code-sm">data/*.json</code>. تأكد أن مجلد <code class="font-code-sm">data</code> مرفوع مع الصفحة، وأنك لا تفتح ملفاً منقولاً وحده.';
  const fix = isFile
    ? 'python tools/embed-data.py\n# ثم أعد تحميل الصفحة'
    : 'أعد رفع المجلد كاملاً (index.html + data/ + assets/) إلى الاستضافة.';

  const banner = document.createElement('div');
  banner.className = 'card col-span-full';
  banner.style.cssText = 'max-width:720px;margin-inline:auto;padding:var(--space-lg)';
  banner.innerHTML = `
    <div class="flex items-start gap-space-md">
      <span class="material-symbols-outlined text-primary" style="font-size:28px;flex-shrink:0">database_off</span>
      <div style="min-width:0">
        <p class="font-headline-sm">${esc(title)}</p>
        <p class="font-body-sm text-on-surface-variant mt-space-xs">${why}</p>
        <p class="font-label-sm text-on-surface-variant mt-space-md">${isFile ? 'الحل: شغّل خادماً محلياً' : 'الحل'}</p>
        <div class="flex items-start gap-space-sm mt-space-xs">
          <pre class="font-code-sm text-on-surface grow" dir="ltr" style="background:var(--color-surface-container-lowest);border:1px solid var(--color-outline-variant);border-radius:var(--radius-default);padding:var(--space-sm);margin:0;overflow-x:auto;white-space:pre-wrap">${esc(fix)}</pre>
          <button type="button" class="btn btn-secondary btn-size-sm flex-none" id="copyFixBtn">
            <span class="material-symbols-outlined" style="font-size:14px">content_copy</span> نسخ
          </button>
        </div>
        <p class="font-body-sm text-on-surface-variant mt-space-sm">
          <b>الموقع نفسه يعمل</b> — الناقص هو البيانات فقط. والنسخة المضمّنة داخل
          الصفحة هي ما يجعلها تعمل بلا خادم؛ وإن كانت ناقصة فولّدها بالأمر أعلاه.
        </p>
      </div>
    </div>`;
  grid.prepend(banner);

  banner.querySelector('#copyFixBtn')?.addEventListener('click', (event) => {
    const text = isFile ? 'python -m http.server 8080' : fix;
    navigator.clipboard?.writeText(text)
      .then(() => showToast('نُسخ الأمر.', 'success'))
      .catch(() => showToast('تعذّر النسخ — انسخ يدوياً.', 'error'));
    event.currentTarget.blur();
  });
}

/* ── متابعة الطلب: العميل يُدخل REF فيرى الحالة والمفتاح والتحميل ── */
function initOrderTracking() {
  const trackButton = $('#trackBtn');
  const wrap = $('#trackOtp');
  const result = $('#trackResult');
  if (!trackButton || !wrap || !result) return;

  // ── بناء الحقل المتحوّل (٦ خانات = رقم المرجع كاملاً) ──
  const LEN = Number(wrap.dataset.len) || ORDER_REF_LEN;
  const SP = 31, R = 21, SC = .4, MORPH = .55, SPD = 2.4;
  // عرض الحاوية يُحسب من عدد الخانات — لا رقم ثابت في CSS يفسد إن تغيّر الطول
  wrap.style.width = ((LEN - 1) * SP + 36) + 'px';
  const boxes = [];
  for (let i = 0; i < LEN; i++) {
    const b = document.createElement('div');
    b.className = 'tbox';
    wrap.appendChild(b);
    boxes.push(b);
  }
  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = LEN;
  input.autocomplete = 'one-time-code';
  input.inputMode = 'text';
  input.setAttribute('aria-label', 'رقم المرجع');
  Object.assign(input.style, {
    position: 'absolute', inset: '0', width: '100%', height: '100%',
    opacity: '0', cursor: 'pointer', border: '0', background: 'transparent', color: 'transparent',
  });
  wrap.appendChild(input);
  const done = document.createElement('div');
  done.className = 'track-done';
  done.innerHTML = '<div class="tring"><svg viewBox="0 0 24 24"><path d="M4.5 12.8l4.7 4.7L19.5 7"/></svg></div>';
  wrap.appendChild(done);

  const rx = (i) => (i - (LEN - 1) / 2) * SP;
  const layoutRow = () => boxes.forEach((b, i) => {
    b.style.transform = 'translate(' + rx(i) + 'px, 0px) scale(1)';
    b.style.opacity = '1';
  });
  const paintBoxes = () => {
    const v = input.value;
    boxes.forEach((b, i) => {
      b.textContent = v[i] || '';
      b.classList.toggle('on', Boolean(v[i]));
    });
  };

  let raf = null;
  function animateOrbit(target) {
    if (raf) cancelAnimationFrame(raf);
    const t0 = performance.now();
    const from = boxes.map((b, i) => ({ x: rx(i), y: 0, s: 1 }));
    const ease = (t) => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    (function frame(now) {
      const dt = (now - t0) / 1000;
      let t = 1;
      if (target === 'wait') t = Math.min(1, ease(dt / MORPH));
      else if (target === 'good') t = Math.max(0, 1 - ease(dt / .5));
      else if (target === 'bad') t = Math.max(0, 1 - ease(dt / .45));
      boxes.forEach((b, i) => {
        const spin = (target === 'wait' && t >= 1) ? (dt - MORPH) * SPD : 0;
        const a = (2 * Math.PI * i) / LEN + spin;
        const ox = R * Math.cos(a), oy = R * Math.sin(a);
        const x = from[i].x + (ox - from[i].x) * t;
        const y = from[i].y + (oy - from[i].y) * t;
        const s = from[i].s + (SC - from[i].s) * t;
        b.style.transform = 'translate(' + x + 'px, ' + y + 'px) scale(' + s + ')';
        b.style.opacity = target === 'good' ? String(Math.max(0, t)) : '1';
      });
      if (target === 'wait') { raf = requestAnimationFrame(frame); return; }
      if (dt < .55) { raf = requestAnimationFrame(frame); return; }
      raf = null;
      if (target === 'good') return;      // تبقى منهارة — لا تعود
      layoutRow();
      if (target === 'bad') {
        boxes.forEach((b, i) => {
          b.animate([
            { transform: 'translate(' + rx(i) + 'px,0) scale(1)' },
            { transform: 'translate(' + (rx(i) - 7) + 'px,0) scale(1)' },
            { transform: 'translate(' + (rx(i) + 6) + 'px,0) scale(1)' },
            { transform: 'translate(' + (rx(i) - 4) + 'px,0) scale(1)' },
            { transform: 'translate(' + rx(i) + 'px,0) scale(1)' },
          ], { duration: 440, easing: 'cubic-bezier(.36,.07,.19,.97)' });
        });
      }
    })(t0);
  }

  layoutRow();
  paintBoxes();
  // الحاوية تعكس حالة التركيز — مستخدم لوحة المفاتيح كان يتنقل داخل حقل شفاف أعمى
  input.addEventListener('focus', () => wrap.classList.add('focused'));
  input.addEventListener('blur', () => wrap.classList.remove('focused'));
  input.addEventListener('input', () => {
    paintBoxes();
    // بحث تلقائي عند اكتمال الخانات — بلا انتظار زر «تتبع الطلب»
    if (input.value.length >= LEN) lookup();
  });
  wrap.addEventListener('click', () => input.focus());

  /* ── خط حالات الطلب: يُقرأ من status الواحد ── */
  const TRACK_STEPS = [
    { t: 'استلمنا طلبك',  d: 'سُجِّل الطلب وإثبات الدفع.' },
    { t: 'مراجعة الإثبات', d: 'نتحقّق من رقم العملية والمبلغ.' },
    { t: 'تأكيد الدفع',    d: 'يُفعَّل الترخيص ويُسحب مفتاح من المخزون.' },
    { t: 'التسليم مفتوح',  d: 'المفتاح ورابط التسليم يظهران هنا.' },
  ];

  function trackTimeline(confirmed) {
    const level = confirmed ? 3 : 1;
    return `<div class="track-tl">${TRACK_STEPS.map((step, i) => {
      const done = i < level || (i === level && confirmed);
      const cls = done ? 'done' : (i === level ? 'now' : '');
      const icon = done ? 'check' : (i === level ? 'more_horiz' : '');
      return `<div class="track-tl-item ${cls}">
        <span class="track-tl-dot"><span class="material-symbols-outlined">${icon}</span></span>
        <div class="track-tl-title">${esc(step.t)}</div>
        <div class="track-tl-desc">${esc(step.d)}</div>
      </div>`;
    }).join('')}</div>`;
  }

  let pollId = null;
  let lastStatus = null;
  let checkedAt = 0;
  let tickId = null;

  /** ملاحظة المصدر: إن كانت الحالة من الإيصال المحلي وحده، فالمشتري يجب أن يعرف.
      هذا هو مقتل العطل الأصلي: كان السقوط المحلي صامتاً، فيرى المشتري «قيد
      المراجعة» إلى الأبد بعد أن يكون الأدمن قد أكّد طلبه فعلاً. */
  function sourceNote(source, reason, confirmed) {
    if (source !== 'local') return '';
    const why = reason === 'rpc-missing'
      ? ' — دالة المتابعة الآمنة غير مُعرَّفة في القاعدة بعد'
      : (reason === 'offline' ? ' — لا اتصال بالقاعدة الآن' : '');
    return `
      <div class="flex items-start gap-space-sm font-body-sm" style="background:var(--color-surface-container-low);border:1px dashed var(--color-outline-variant);border-radius:var(--radius-default);padding:var(--space-sm) var(--space-md)">
        <span class="material-symbols-outlined text-primary" style="font-size:16px;flex-shrink:0">cloud_off</span>
        <span>هذه الحالة من <b>إيصالك المحفوظ في هذا المتصفح</b>${esc(why)}.
        ${confirmed ? '' : 'قد يكون الأدمن أكّد طلبك بالفعل — سنُحدّث الحالة تلقائياً عند توفّر الاتصال.'}</span>
      </div>`;
  }

  function deliveryActions(order, product, confirmed) {
    // حالة الرفض: السبب يصل للمشتري كما كتبه الأدمن — بلا رفض صامت أبداً
    if (order.status === 'rejected') {
      const why = String(order.rejectReason ?? '').trim();
      return `
        <div class="reject-box">
          <div class="flex items-start gap-space-sm">
            <span class="material-symbols-outlined" style="font-size:20px;color:var(--color-error);flex-shrink:0">cancel</span>
            <div style="min-width:0">
              <b>تم رفض هذا الطلب.</b>
              ${why
                ? `<p class="font-body-sm mt-space-xs" style="line-height:1.8"><span class="text-on-surface-variant">سبب الرفض من صاحب المتجر:</span><br>${esc(why)}</p>`
                : '<p class="font-body-sm mt-space-xs text-on-surface-variant">لم يُذكر سبب — تواصل معنا وسنجيبك فوراً.</p>'}
              <p class="font-body-sm text-on-surface-variant mt-space-sm">
                إن كنت ترى أن هذا خطأً فتواصل معنا مع رقم العملية <code class="font-code-sm" dir="ltr">${esc(order.reference)}</code>
                — وسنراجع الطلب من جديد. لم يُخصم من مخزون الترخيص أي مفتاح.
              </p>
            </div>
          </div>
        </div>`;
    }
    if (!confirmed) {
      return '<p class="font-body-sm text-on-surface-variant">بانتظار تأكيد الأدمن للدفع. الحالة تُفحَص تلقائياً كل ٢٠ ثانية — لا حاجة لإعادة التحميل.</p>';
    }
    /* ── مصدر التسليم: الطلب أولاً، ثم الكتالوج احتياطاً ──
       رابط التسليم للمنتج المدفوع **لا يجوز أن يكون في الكتالوج العام**،
       لأن `data/products.json` ملف منشور — أي زائر يقرأه ويحمّل بلا دفع.
       فيُكتب الرابط على **الطلب نفسه** لحظة التأكيد، والمشتري يقرأه من هنا.
       والكتالوج يبقى احتياطاً للمنتجات المجانية التي تسليمها علني بطبيعته. */
    const orderUrl = String(order.deliveryUrl ?? '').trim();
    const catalogUrl = product ? deliveryTarget(product) : '';
    const target = orderUrl || catalogUrl;
    const mode = product ? deliveryOf(product)?.mode : 'file';
    const note = String(order.deliveryNote ?? '').trim() || (product ? (deliveryOf(product)?.note ?? '') : '');

    const key = order.licenseKey
      ? `<div class="license-key-box mb-space-sm">
           <span class="font-body-sm text-on-surface-variant">مفتاح الترخيص</span>
           <code class="key" dir="ltr">${esc(order.licenseKey)}</code>
           <button type="button" class="btn btn-secondary btn-size-sm" data-copy-key="${esc(order.licenseKey)}">نسخ</button>
         </div>`
      : '';

    const action = target
      ? `<a class="btn btn-primary btn-size-md btn-block" href="${esc(target)}" target="_blank" rel="noopener">
           <span class="material-symbols-outlined" style="font-size:16px">${DELIVERY_MODES[mode]?.icon ?? 'download'}</span>
           ${esc(product ? deliveryCta(product).text : 'افتح التسليم')}</a>`
      : (key
          ? '<p class="font-body-sm text-on-surface-variant">المفتاح جاهز أعلاه. ورابط التسليم سيظهر هنا فور إعداده.</p>'
          : '<p class="font-body-sm text-on-surface-variant">طلبك مؤكَّد، لكن التسليم قيد التجهيز — تواصل معنا وسنرسله فوراً.</p>');

    return key + action + (note ? `<p class="font-body-sm text-on-surface-variant mt-space-sm">${esc(note)}</p>` : '');
  }

  function renderTrackResult(order, source, reason, reference) {
    const product = state.products.find((item) => item.id === order.productId);
    const confirmed = order.status === 'confirmed';
    const rejected = order.status === 'rejected';
    checkedAt = Date.now();

    result.innerHTML = `
      <div class="card p-space-md flex flex-col gap-space-sm">
        <div class="flex items-center justify-between flex-wrap gap-space-sm">
          <span class="font-body-md">${esc(order.productName)} · <span class="font-code-sm" dir="ltr">${esc(reference)}</span></span>
          <span class="badge ${confirmed ? 'badge-success' : (rejected ? 'badge-rejected' : 'badge-indigo')}">${confirmed ? 'مؤكَّد ✓' : (rejected ? 'مرفوض ✕' : 'قيد المراجعة')}</span>
        </div>
        ${sourceNote(source, reason, confirmed)}
        ${rejected
          ? '<div class="track-reject-note"><span class="material-symbols-outlined" style="font-size:16px">info</span> انتهت دورة هذا الطلب بالرفض — سببها ظاهر أدناه.</div>'
          : trackTimeline(confirmed)}
        <div class="reveal-box${confirmed ? ' open' : ''}">${deliveryActions(order, product, confirmed)}</div>
        <div class="flex items-center justify-between flex-wrap gap-space-sm">
          <span class="font-body-sm text-on-surface-variant" id="trackChecked">آخر فحص: الآن</span>
          <button type="button" class="btn btn-ghost btn-size-sm" id="trackRefresh">
            <span class="material-symbols-outlined" style="font-size:14px">refresh</span> تحديث
          </button>
        </div>
      </div>`;

    result.querySelector('[data-copy-key]')?.addEventListener('click', (event) => {
      navigator.clipboard.writeText(event.currentTarget.dataset.copyKey)
        .then(() => showToast('نُسخ المفتاح.', 'success'))
        .catch(() => showToast('تعذّر النسخ.', 'error'));
    });
    result.querySelector('#trackRefresh')?.addEventListener('click', () => lookup());
    // إصلاح: عدّاد التحميلات كان يعمل للمجاني فقط — الآن يزيد أيضاً عند فتح تسليم مؤكّد
    if (confirmed && product) {
      result.querySelector('a.btn-primary')?.addEventListener('click', () => bumpDownloadCounter(product));
    }
    startPolling(reference, confirmed);
    lastStatus = order.status;
  }

  /* ── فحص دوري: الحالة تتغيّر عند الأدمن، فلا يُترك المشتري يُعيد التحميل ──
     بحدود واضحة: يتوقّف عند التأكيد (لا داعي لسؤال القاعدة بعدها)، ويسقُط بعد
     ~١٣ دقيقة حتى لا يُرهق القاعدة من تبويب منسيّ مفتوح. */
  const POLL_MS = 20000;
  const POLL_MAX = 40;
  let pollCount = 0;
  let pollRef = null;   // المرجع الذي تعمل عليه الدورة الحالية

  function startPolling(reference, confirmed) {
    stopPolling();
    if (confirmed) return;
    // إصلاح: كل نتيجة فحص تعيد رسم الصندوق فتستدعي startPolling من جديد،
    // ولو صُفّر pollCount هنا لبقي الفحص يعمل للأبد (POLL_MAX بلا أثر).
    // التصفير الآن فقط عند بدء دورة لمرجع مختلف.
    if (pollRef !== reference) { pollCount = 0; pollRef = reference; }
    pollId = setInterval(() => {
      pollCount += 1;
      if (pollCount > POLL_MAX) { stopPolling(); return; }
      lookup({ silent: true, reference });
    }, POLL_MS);
    if (tickId) clearInterval(tickId);
    tickId = setInterval(() => {
      const el = $('#trackChecked');
      if (!el || !checkedAt) return;
      const secs = Math.round((Date.now() - checkedAt) / 1000);
      el.textContent = 'آخر فحص: ' + (secs < 5 ? 'الآن' : 'قبل ' + secs + ' ثانية');
    }, 5000);
  }
  function stopPolling() {
    if (pollId) { clearInterval(pollId); pollId = null; }
    if (tickId) { clearInterval(tickId); tickId = null; }
  }
  // تنظيف عند مغادرة الصفحة — وإلا بقيت المؤقتات تعمل في الخلفية
  window.addEventListener('beforeunload', stopPolling);

  /* حدّ محاولات التتبّع الفاشلة — بلا هذا الحد يستطيع سكربت صبور تجربة مراجع
     بلا توقف (المرجع 6 محارف ≈ 1.07 مليار). عند تجاوز الحد يُقفل البحث مؤقتاً؛
     ومن يملك مرجعاً صحيحاً يعود بعد إعادة تحميل الصفحة فيجد طلبه. */
  const MAX_FAILED_LOOKUPS = 10;
  let failedLookups = 0;
  let trackingLocked = false;

  const lookup = async (opts = {}) => {
    if (trackingLocked) return;
    const reference = (opts.reference ?? input.value).trim().toUpperCase();
    if (!reference) { result.innerHTML = ''; return; }

    if (!opts.silent) {
      wrap.classList.remove('good', 'bad');
      result.innerHTML = '';
      animateOrbit('wait');
    }

    let payload;
    if (typeof DB !== 'undefined') {
      payload = await DB.getOrder(reference);
    } else {
      const local = readLocal('nova_purchases', []).find((item) => item.reference === reference);
      payload = { order: local ?? null, source: local ? 'local' : null, reason: 'offline' };
    }
    const { order, source, reason } = payload ?? {};

    if (raf) cancelAnimationFrame(raf);

    if (!order) {
      stopPolling();
      if (opts.silent) return;
      failedLookups += 1;
      if (failedLookups >= MAX_FAILED_LOOKUPS) {
        trackingLocked = true;
        result.innerHTML = `
          <div class="card p-space-md font-body-sm text-on-surface-variant">
            <b>تم إيقاف البحث مؤقتاً</b> — كثرت المحاولات بلا مرجع صحيح.
            إن كنت تملك مرجعاً صحيحاً فأعد تحميل الصفحة وجرّب من جديد.
          </div>`;
        return;
      }
      wrap.classList.add('bad');
      animateOrbit('bad');
      // مسح الخانات بعد اهتزازة الفشل — لا يبقى مرجع خاطئ معلّقاً يُعاد إرساله بالخطأ
      setTimeout(() => {
        input.value = '';
        paintBoxes();
        wrap.classList.remove('bad');
        layoutRow();
        input.focus();
      }, 650);
      result.innerHTML = `
        <div class="card p-space-md font-body-sm text-on-surface-variant">
          لا يوجد طلب بالمرجع <code class="font-code-sm" dir="ltr">${esc(reference)}</code>.
        </div>`;
      return;
    }
    failedLookups = 0;

    // تغيّرت الحالة أثناء المشاهدة؟ أعلِم المشتري بدل أن يتغيّر الصمت
    if (opts.silent && lastStatus && order.status !== lastStatus) {
      if (order.status === 'confirmed') showToast('تم تأكيد دفعتك — المفتاح ظاهر الآن.', 'success');
      else if (order.status === 'rejected') showToast('انتهت مراجعة طلبك بالرفض — السبب ظاهر في النتيجة.', 'error');
      else showToast('تحدّثت حالة طلبك.', 'success');
    }
    if (opts.silent && source === 'local' && lastStatus !== order.status) {
      wrap.classList.remove('good', 'bad');
      animateOrbit('good');
    } else if (!opts.silent) {
      wrap.classList.add('good');
      animateOrbit('good');
    }

    writeLocal('nova_last_ref', reference);
    renderTrackResult(order, source, reason, reference);
  };

  trackButton.addEventListener('click', () => lookup());
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') lookup();
  });

  // استرجاع آخر مرجع تتبّعه المشتري — فلا يُعيد كتابته في كل مرة
  const savedRef = readLocal('nova_last_ref', '');
  if (savedRef && !input.value) { input.value = savedRef; paintBoxes(); }
}

/* ── التهيئة ── */
async function init() {
  const [productsData, settingsData, walletsData] = await Promise.all([
    loadJSON('data/products.json', { products: [] }),
    loadJSON('data/settings.json', {}),
    loadJSON('data/wallets.json', { wallets: [] }),
  ]);
  state.products = productsData.products ?? [];
  state.settings = settingsData;
  state.wallets = walletsData.wallets ?? [];
  // تهيئة طبقة البيانات: Supabase إن وُجد المفتاح، وإلا يعمل محلياً
  if (typeof DB !== 'undefined') DB.init(settingsData);
  // المنتجات: من قاعدة البيانات الأونلاين إن اتصلت، وإلا المسودة المحلية ثم JSON
  if (typeof DB !== 'undefined' && DB.isOnline()) {
    state.products = await DB.getProducts(productsData.products ?? []);
  } else {
    const productsDraft = readLocal('nova_products_draft', null);
    if (Array.isArray(productsDraft?.products)) {
      state.products = productsDraft.products;
    }
  }
  /* ── دمج حقل التسليم من الكتالوج المحلي ──
     السبب: عند الاتصال بالقاعدة تكون هي المصدر، وقاعدة قائمة قد لا تحتوي
     حقل `delivery` بعد. بدون هذا الدمج يعمل منطق التسليم محلياً فقط ويظهر
     للزائر أونلاين بلا طريقة استلام. الدمج بالـ slug ولا يطمس أي قيمة
     قادمة من القاعدة — يُستخدم فقط حين يغيب الحقل تماماً. */
  const localBySlug = new Map((productsData.products ?? []).map((p) => [p.slug, p]));
  state.products.forEach((product) => {
    if (!product.delivery) {
      const local = localBySlug.get(product.slug);
      if (local?.delivery) product.delivery = local.delivery;
    }
  });

  const walletsDraft = readLocal('nova_wallets_draft', null);
  if (Array.isArray(walletsDraft?.wallets)) {
    state.wallets = walletsDraft.wallets;
  }
  applySettings(settingsData);
  initTheme(settingsData);
  initFilters();
  initGlobalClicks();
  initSuggestions();
  initOrderTracking();
  renderProducts();
  renderStats();
  showLoadWarning();
  openFromDeepLink();
}

/* رابط مباشر: index.html?p=<slug> يفتح تفاصيل المنتج فوراً (للمشاركة على الوسائط) */
function openFromDeepLink() {
  const params = new URLSearchParams(location.search);
  const slug = params.get('p') ?? params.get('product');
  if (!slug) return;
  const product = state.products.find((item) => item.slug === slug);
  if (!product || product.status === 'hidden') {
    showToast('المنتج المطلوب غير متاح حالياً.', 'error');
    return;
  }
  renderDetails(product);
  openModal('detailsModal');
}

/* ── تفعيل Service Worker (العمل دون اتصال + التثبيت كتطبيق) ── */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // المتصفحات لا تسمح بتسجيله إلا في سياق آمن (https أو المضيف المحلي)
  const host = location.hostname;
  const secure = location.protocol === 'https:' || host === 'localhost' || host === '127.0.0.1';
  if (!secure) return;
  navigator.serviceWorker.register('sw.js').catch((error) => {
    console.warn('تعذّر تسجيل Service Worker:', error.message);
  });
}

registerServiceWorker();
init();


