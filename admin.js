/* ==========================================================================
   لوحة الأدمن — admin.js (أداة محلية)
   ملاحظة أمنية: هذه أداة على جهاز الأدمن. كلمة المرور والتوكن يبقيان
   في localStorage فقط ولا يُصدَّران مع ملفات JSON. حماية خادم حقيقية
   تتطلب backend — خارج نطاق النسخة الثابتة.
   ========================================================================== */
'use strict';

const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

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

function readLocal(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
  catch { return fallback; }
}
function writeLocal(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch (error) { console.error('فشل التخزين المحلي', error); return false; }
}

function downloadFile(filename, text) {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}

/* ── سياسة الظهور للعميل (نسخة الأدمن للمعاينة — مطابقة لمنطق app.js) ── */
const DELIVERY_FIELDS_PREVIEW = ['downloadUrl', 'repo', 'githubUrl', 'install'];

function previewHasValue(value) {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  return String(value).trim() !== '';
}

function previewDeliveryVisible(product) {
  return !Number(product.price);
}

function previewVisible(product, key, value) {
  if ((product.hiddenFields ?? []).includes(key)) return false;
  if (!previewHasValue(value)) return false;
  if (DELIVERY_FIELDS_PREVIEW.includes(key) && !previewDeliveryVisible(product)) return false;
  return true;
}

function openAdminPreview(product) {
  const locked = !previewDeliveryVisible(product);
  const body = $('#adminPreviewBody');
  if (!body) return;
  const money = product.price
    ? `<span class="badge badge-indigo font-num" dir="ltr">${esc(product.currency)} ${esc(product.price)}</span>`
    : '<span class="badge badge-success">مجاني</span>';
  const showLong = previewVisible(product, 'long', product.long);
  const showImages = previewVisible(product, 'images', product.images);
  const coverImage = product.images?.[0] ?? product.previewImage;
  const galleryImages = (product.images ?? (product.previewImage ? [product.previewImage] : [])).filter(Boolean);
  const rows = [
    previewVisible(product, 'featured', product.featured === true ? 'x' : '') ? '<span class="badge badge-indigo flex items-center gap-space-xs"><span class="material-symbols-outlined" style="font-size:14px">star</span>مميّز</span>' : '',
    previewVisible(product, 'type', product.type) ? `<span class="badge badge-neutral">${esc(product.type)}</span>` : '',
    previewVisible(product, 'platform', product.platform) ? `<span class="font-body-sm text-on-surface-variant">${esc(product.platform)}</span>` : '',
    previewVisible(product, 'version', product.version) ? `<span class="badge badge-neutral font-num" dir="ltr">v${esc(product.version)}</span>` : '',
  ].filter(Boolean).join(' ');
  body.innerHTML = `
    <div class="flex flex-col gap-space-sm">
      <div class="flex items-center gap-space-sm flex-wrap">
        ${previewVisible(product, 'name', product.name) ? `<h3 class="font-headline-md">${esc(product.name)}</h3>` : '<h3 class="font-headline-md text-on-surface-variant">(الاسم مخفي بالعين)</h3>'}
        ${money} <span class="badge badge-indigo">معاينة أدمن 👁‍🗨</span>
      </div>
      <div class="flex items-center gap-space-sm flex-wrap">${rows}</div>
      ${previewVisible(product, 'short', product.short) ? `<p class="font-body-md text-on-surface-variant">${esc(product.short)}</p>` : ''}
      ${showLong ? `<p class="font-body-sm text-on-surface-variant">${esc(product.long)}</p>` : ''}
      ${showImages && coverImage ? `<img src="${esc(coverImage)}" alt="${esc(product.name)}" style="width:100%;max-height:220px;object-fit:cover;border-radius:var(--radius-default);border:1px solid var(--color-outline-variant)">` : ''}
      ${showImages && galleryImages.length > 1 ? `<div class="grid grid-cols-3 gap-space-xs">${galleryImages.slice(1).map((src) => `<img src="${esc(src)}" alt="" style="width:100%;height:70px;object-fit:cover;border-radius:var(--radius-default);border:1px solid var(--color-outline-variant)">`).join('')}</div>` : ''}
      ${locked
        ? '<div class="font-body-sm text-on-surface-variant" style="border:1px dashed var(--color-outline-variant);border-radius:var(--radius-default);padding:var(--space-sm) var(--space-md)">🔒 مدفوع — محتوى التسليم مقفل تلقائياً ويُسلَّم بعد تأكيد الدفع.</div>'
        : (() => {
            const dv = product.delivery ?? {};
            const meta = DELIVERY_MODE_META[dv.mode];
            if (!meta) return '<div class="font-body-sm text-on-surface-variant">لم تُضبط طريقة التسليم بعد.</div>';
            const target = adminDeliveryUrl(product);
            if (dv.mode === 'install') {
              return `<div class="font-code-sm" dir="ltr" style="background:var(--color-surface-container-lowest);border:1px solid var(--color-outline-variant);border-radius:var(--radius-default);padding:var(--space-sm)">${(dv.commands ?? []).map((c) => esc(c)).join('<br>')}</div>`;
            }
            if (dv.mode === 'key') {
              const keys = (product.licenseKeys ?? []).filter(Boolean).length;
              return `<div class="font-body-sm text-on-surface-variant">يُسلَّم مفتاح ترخيص بعد الدفع — المخزون: <b class="font-num">${keys}</b></div>`;
            }
            return target
              ? `<a class="btn btn-primary btn-size-md" href="${esc(target)}" target="_blank" rel="noopener">فتح التسليم (${esc(DELIVERY_MODE_LABELS[dv.mode] ?? dv.mode)})</a>`
              : '<div class="font-body-sm text-error">الرابط فارغ — لن يجد المشتري ما يستلمه.</div>';
          })()}
    </div>`;
  document.getElementById('adminPreviewModal')?.classList.add('active');
}

/* ── حالة الأدمن ── */
const adminState = {
  products: [],
  settings: {},
  wallets: [],
  editingId: null,
  authMode: null,          // 'supabase' | 'local' — يحدّد لافتة الوضع
  editingWalletId: null,
  editingImages: [],   // صور المعاينة الحالية في النموذج (مصفوفة dataURL أو روابط)
  editingWalletLogo: '',  // شعار المحفظة الحالي (dataURL)
  editingWalletQr: '',    // صورة QR الحالية (dataURL)
  editingLogoImage: '',   // صورة شعار المنصة الحالية (dataURL)
};

/* ── البوابة: كلمة المرور المحلية (SHA-256) ──
   crypto.subtle متاح فقط في السياقات الآمنة (https/localhost).
   عند فتح admin.html عبر file:// نستخدم تنفيذاً نقياً بنفس الخوارزمية
   والناتج متطابق في الحالتين. */
async function sha256(text) {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const bytes = new TextEncoder().encode(text);
    const digest = await subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  return sha256Fallback(text);
}

/* SHA-256 نقي وفق FIPS 180-4 — مدخل UTF-8، ناتج hex */
function sha256Fallback(text) {
  const bytes = new TextEncoder().encode(text);
  const bitLength = bytes.length * 8;
  const paddedLength = (((bytes.length + 8) >> 6) + 1) << 6;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i] + w[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + temp1) | 0;
      d = c; c = b; b = a; a = (temp1 + temp2) | 0;
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
  }
  return Array.from(H).map((x) => x.toString(16).padStart(8, '0')).join('');
}

/* ── فحص كلمة المرور المحلية ──
   `allowCreate` صريح: لا نُنشئ كلمة مرور محلية تلقائياً حين تكون مصادقة
   Supabase مُفعّلة — وإلا صارت كلمة مرور Supabase نفسها كلمةً محلية بلا علمه. */
async function tryLocalPassword(password, allowCreate) {
  const storedHash = readLocal('nova_admin_hash', null);
  const hash = await sha256(password);
  if (storedHash === null) {
    if (!allowCreate) return false;
    writeLocal('nova_admin_hash', hash);
    return true;
  }
  return hash === storedHash;
}

/** يُظهر مخرج الطوارئ بعد فشل دخول Supabase */
function revealLocalFallback(errorText) {
  const box = $('#localFallback');
  if (!box) return;
  box.style.display = '';
  const btn = $('#gateLocalBtn');
  if (btn && !btn.dataset.bound) {
    btn.dataset.bound = '1';
    btn.addEventListener('click', async () => {
      const password = $('#gatePass').value;
      if (!password) { showToast('اكتب كلمة مرور للوضع المحلي أولاً.', 'error'); return; }
      await tryLocalPassword(password, true);
      showToast('دخلت بالوضع المحلي — تأكيد الطلبات يحتاج السرّ.', 'success');
      enterAdmin({ auth: false });
    });
  }
  showToast('تعذّر الدخول بحساب Supabase: ' + errorText, 'error');
}

/* ── البوابة: مصادقة Supabase الحقيقية، أو كلمة مرور محلية كاحتياط ──
   ⚠️ لماذا أُضيفت مصادقة حقيقية؟
   البوابة المحلية ليست مصادقة: إن لم توجد كلمة مرور محفوظة على الجهاز،
   فالزائر يكتب واحدة **هو** ويدخل. ولا يوجد أي تحقّق على الخادم. ولذلك
   أيضاً لا يستطيع الأدمن الكتابة في القاعدة بعد تشديد سياسات RLS — لأنه
   يحمل هوية «anon» مثل أي زائر.
   الحل: عند ضبط `adminEmail` في settings.json وإنشاء المستخدم في Supabase،
   يتحوّل الدخول تلقائياً إلى Supabase Auth (تحقّق على الخادم + هوية حقيقية
   تسمح بالكتابة). وإن لم يُضبط: تبقى البوابة المحلية تعمل بلا أي تعطّل.

   ⚠️ وأُضيف مخرج طوارئ: كان ضبط `adminEmail` **يقفل اللوحة نهائياً** إن
   فشل الدخول (لا مسار بديل إطلاقاً). واللوحة أداة المالك على جهازه، والحماية
   الحقيقية في القاعدة نفسها — فلا معنى لحبس المالك خارج أداته. */
async function initGate() {
  const authReady = typeof DB !== 'undefined' && typeof DB.authReady === 'function' && DB.authReady();
  const emailLabel = $('#gateEmailLabel');
  const emailInput = $('#gateEmail');
  const warnBox = $('#gateWarn');
  const hint = $('#gateHint');

  if (authReady) {
    if (emailLabel) emailLabel.style.display = '';
    if (emailInput) {
      emailInput.style.display = '';
      emailInput.value = String(adminState.settings.adminEmail ?? '').trim();
    }
    if (warnBox) warnBox.style.display = 'none';
    if (hint) hint.textContent = 'الدخول محمي بحساب Supabase — التحقّق يتم على الخادم.';
    $('#gatePass')?.setAttribute('autocomplete', 'current-password');
  } else {
    if (warnBox) warnBox.style.display = '';
    const storedHash = readLocal('nova_admin_hash', null);
    if (hint) {
      hint.textContent = storedHash
        ? 'أدخل كلمة المرور المحفوظة محلياً على هذا الجهاز.'
        : 'أول تشغيل: اكتب كلمة مرور جديدة وستُحفظ محلياً على هذا الجهاز فقط.';
    }
  }

  $('#gateEnter').addEventListener('click', async () => {
    const password = $('#gatePass').value;
    if (!password) { showToast('اكتب كلمة المرور.', 'error'); return; }
    try {
      if (authReady) {
        const email = String($('#gateEmail')?.value ?? '').trim();
        if (!email) { showToast('اكتب بريد الأدمن.', 'error'); return; }
        const result = await DB.signIn(email, password);
        if (result.ok) {
          showToast('تم التحقّق من هويتك — مرحباً.', 'success');
          enterAdmin({ auth: true });
          return;
        }
        /* فشل الحساب ⇒ لا نحبس المالك خارج لوحته. «Invalid login credentials»
           تعني أن المستخدم غير موجود أو كلمة المرور خاطئة — وكلاهما لا يجب أن
           يمنعك من إدارة متجرك. نجرّب الكلمة المحلية، وإن لم توجد نعرض مخرجاً. */
        if (await tryLocalPassword(password, false)) {
          showToast('دخلت بالوضع المحلي — تأكيد الطلبات يعمل بالسرّ.', 'success');
          enterAdmin({ auth: false });
        } else {
          revealLocalFallback(result.error);
        }
        return;
      }
      const storedHash = readLocal('nova_admin_hash', null);
      if (await tryLocalPassword(password, true)) {
        if (storedHash === null) showToast('أُنشئت كلمة المرور وحُفظت محلياً.', 'success');
        enterAdmin({ auth: false });
      } else {
        showToast('كلمة المرور غير صحيحة. إن نسيتها استخدم «إعادة التعيين المحلية».', 'error');
      }
    } catch (error) {
      console.error('فشل التحقق من كلمة المرور', error);
      showToast(`تعذر التحقق: ${error.message}`, 'error');
    }
  });
  $('#gatePass').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') $('#gateEnter').click();
  });
  $('#gateReset')?.addEventListener('click', () => {
    if (!confirm('إعادة تعيين كلمة المرور المحفوظة على هذا الجهاز؟ سيلزم إدخال كلمة مرور جديدة في الدخول القادم.')) return;
    localStorage.removeItem('nova_admin_hash');
    location.reload();
  });
}

/* ── لافتة الوضع: يرى الأدمن دائماً هل تأكيده يصل للقاعدة أم لا ──
   كانت اللوحة تبدو متطابقة في الحالتين، فيؤكّد الأدمن ويظن أن المشتري سيرى
   — وهو لا يرى. اللافتة تُزيل هذا الالتباس من أول نظرة. */
function paintModeBanner() {
  const box = $('#modeBanner');
  if (!box) return;
  if (adminState.authMode === 'supabase') { box.style.display = 'none'; return; }

  const hasSecret = Boolean(getConfirmSecret());
  box.style.display = 'block';
  box.className = hasSecret ? 'text-warning' : 'text-error';
  box.innerHTML = `
    <div class="flex items-start gap-space-sm" style="border:1px solid currentColor;border-radius:var(--radius-default);padding:var(--space-sm) var(--space-md)">
      <span class="material-symbols-outlined" style="font-size:20px;flex-shrink:0">${hasSecret ? 'key' : 'warning'}</span>
      <div class="grow font-body-sm">
        <b>الوضع المحلي.</b> المنتجات والإعدادات تُحفظ في هذا المتصفح.
        ${hasSecret
          ? 'وتأكيد الطلبات يعمل عبر <b>سرّ التأكيد</b> — فالمشتري سيرى تأكيدك خلال ٢٠ ثانية.'
          : 'وتأكيد الطلبات <b>لن يصل للقاعدة</b> — أضف «سرّ تأكيد الطلبات» من تبويب الإعدادات، أو سجّل دخولك بحساب Supabase.'}
      </div>
    </div>`;
}

async function enterAdmin(opts = {}) {
  $('#gateScreen').style.display = 'none';
  $('#adminApp').style.display = 'block';
  sessionStorage.setItem('nova_admin_session', '1');
  adminState.authMode = opts.auth ? 'supabase' : 'local';
  paintModeBanner();
  // بعد التحقّق من الهوية تصبح قراءة `licenseKeys` ممكنة (سياسة «للموثّقين»).
  // قبل الدخول كان الطلب يُرفض لأن الهوية «anon» — فكان الجدول يعرض صفر مفاتيح.
  if (typeof DB !== 'undefined' && DB.isOnline()) {
    try {
      const rows = await DB.getProducts(null, { withSecrets: true });
      if (Array.isArray(rows) && rows.length) {
        adminState.products = rows;
        renderProductsTable();
        renderAdminStats();
      }
    } catch (error) {
      console.warn('تعذّر تحديث المنتجات بعد الدخول:', error?.message);
    }
  }
}

async function lockAdmin() {
  $('#gateScreen').style.display = 'flex';
  $('#adminApp').style.display = 'none';
  $('#gatePass').value = '';
  sessionStorage.removeItem('nova_admin_session');
  // إن كان الدخول عبر Supabase Auth فيجب إبطال الجلسة فعلاً،
  // وإلا بقي المفتاح العام يحمل هوية الأدمن بعد «الخروج».
  if (typeof DB !== 'undefined' && typeof DB.signOut === 'function' && DB.authReady?.()) {
    await DB.signOut();
  }
}


/* ── المنتجات: جدول + تحرير ── */
function renderProductsTable() {
  const tbody = $('#productsTableBody');
  tbody.innerHTML = adminState.products.map((product) => {
    const keys = (product.licenseKeys ?? []).length;
    const used = (product.usedKeys ?? []).length;
    const kind = kindOf(product);
    return `
    <tr>
      <td class="font-body-md">${esc(product.name)}${product.featured === true ? ' <span class="material-symbols-outlined" style="font-size:14px;vertical-align:-3px;color:#fbbf24">star</span>' : ''}<br><span class="font-code-sm text-on-surface-variant">${esc(product.slug)}</span></td>
      <td class="flex items-center gap-space-xs"><span class="material-symbols-outlined text-on-surface-variant" style="font-size:16px">${PRODUCT_KINDS[kind]?.icon ?? 'category'}</span>${esc(PRODUCT_KINDS[kind]?.label ?? product.type)}</td>
      <td>${product.price ? `<span class="font-num" dir="ltr">${esc(product.currency)} ${product.price}</span>` : '<span class="badge badge-success">مجاني</span>'}</td>
      <td class="font-num" dir="ltr">v${esc(product.version)}</td>
      <td class="font-num">${used}/${keys}</td>
      <td><span class="badge ${product.status === 'active' ? 'badge-success' : 'badge-neutral'}">${product.status === 'active' ? 'فعّال' : 'مخفي'}</span></td>
      <td class="flex gap-space-xs">
        <button type="button" class="btn btn-secondary btn-size-sm" data-edit="${product.id}">تحرير</button>
        <button type="button" class="btn btn-ghost btn-size-sm" data-share="${product.id}" title="نسخ رابط مباشر ومشاركته ⧉">⧉</button>
        <button type="button" class="btn btn-ghost btn-size-sm" data-preview="${product.id}" title="معاينة كعميل ‍🗨">‍🗨</button>
        <button type="button" class="btn btn-ghost btn-size-sm" data-del="${product.id}">حذف</button>
      </td>
    </tr>`;
  }).join('');
  $('#productsCount').textContent = `${adminState.products.length} منتج`;
  renderDeliveryAlert();
  renderAdminStats();
}

/* ── بطاقات الإحصاءات: أرقام حقيقية من بيانات اللوحة (لا ثوابت وهمية) ── */
async function renderAdminStats() {
  const products = adminState.products ?? [];
  const active = products.filter((p) => p.status !== 'hidden');
  const downloads = products.reduce((sum, p) => sum + (Number(p.downloads) || 0), 0);
  // الطلبات من قاعدة البيانات الأونلاين إن وُجدت، وإلا المحلي
  const orders = (typeof DB !== 'undefined')
    ? await DB.getOrders()
    : readLocal('nova_purchases', []);
  const pending = orders.filter((o) => o.status !== 'confirmed').length;

  let totalKeys = 0;
  let remainingKeys = 0;
  products.forEach((p) => {
    if (p.licenseMode !== 'key') return;
    const all = p.licenseKeys ?? [];
    const used = p.usedKeys ?? [];
    totalKeys += all.length;
    remainingKeys += all.filter((k) => !used.includes(k)).length;
  });

  const setText = (id, value) => { const el = $(id); if (el) el.textContent = value; };
  setText('#statTotalProducts', String(products.length));
  setText('#statActiveProducts', `${active.length} فعّال · ${products.length - active.length} مخفي`);
  setText('#statDownloads', downloads.toLocaleString('ar-EG'));
  setText('#statOrders', String(orders.length));
  setText('#statPendingOrders', `${pending} بانتظار التأكيد`);
  setText('#statKeys', String(remainingKeys));
  setText('#statKeysNote', totalKeys ? `متبقٍ من ${totalKeys} في المخزون` : 'لا منتجات بمفاتيح');
}

/* ── استيراد JSON حقيقي: يقرأ الملف فعلياً ويستبدل البيانات ── */
function importJSONFile(inputEl, kind) {
  const file = inputEl.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result));
      if (kind === 'products') {
        if (!Array.isArray(parsed.products)) throw new Error('الملف لا يحتوي مصفوفة products');
        adminState.products = parsed.products;
        persistProductsDraft();
        renderProductsTable();
        showToast(`تم استيراد ${parsed.products.length} منتجاً، وحُفظ محلياً.`, 'success');
      } else if (kind === 'wallets') {
        if (!Array.isArray(parsed.wallets)) throw new Error('الملف لا يحتوي مصفوفة wallets');
        adminState.wallets = parsed.wallets;
        persistWalletsDraft();
        renderWalletsTable();
        showToast(`تم استيراد ${parsed.wallets.length} محفظة، وحُفظ محلياً.`, 'success');
      }
    } catch (error) {
      showToast(`تعذّر الاستيراد: ${error.message}`, 'error');
    }
    inputEl.value = '';
  };
  reader.onerror = () => { showToast('تعذّر قراءة الملف.', 'error'); inputEl.value = ''; };
  reader.readAsText(file, 'utf-8');
}

function currentProductPayments() {
  return Array.from(document.querySelectorAll('#pPaymentMethods .pay-opt.active'))
    .map((card) => card.dataset.pay).filter(Boolean);
}

/* العين لكل منتج: تُخزَّن في المنتج نفسه (hiddenFields) — تحكم بظهور الحقل للعميل */
function currentHiddenFields() {
  return Array.from(document.querySelectorAll('#productModal [data-eye].eye-off'))
    .map((button) => button.dataset.eye).filter(Boolean);
}

function paintEyeButtons(hidden = []) {
  const set = new Set(hidden);
  document.querySelectorAll('#productModal [data-eye]').forEach((button) => {
    const off = set.has(button.dataset.eye);
    button.classList.toggle('eye-off', off);
    const icon = button.querySelector('.material-symbols-outlined');
    if (icon) icon.textContent = off ? 'visibility_off' : 'visibility';
    button.style.opacity = off ? '.45' : '1';
    button.title = off ? 'مخفي عن العميل — انقر للإظهار' : 'ظاهر للعميل — انقر للإخفاء';
  });
}

/* ── صور المعاينة: ترفع صورة أو عدة صور وتُحوَّل إلى dataURL (تعمل بلا سيرفر) ──
   الصورة الأولى = الغلاف (previewImage للتوافق)، والباقي يظهر في معرض التفاصيل. */
const MAX_IMAGE_PX = 1280;   // ضغط بسيط لتقليل حجم التخزين

function addImageFiles(fileList) {
  const files = Array.from(fileList ?? []).filter((f) => f.type.startsWith('image/'));
  if (!files.length) { showToast('اختر ملفات صور صحيحة.', 'error'); return; }
  let pending = files.length;
  files.forEach((file) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        // تصغير إن تجاوز الحد (يحافظ على جودة معقولة وحجم أصغر)
        const scale = Math.min(1, MAX_IMAGE_PX / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        try {
          adminState.editingImages.push(canvas.toDataURL('image/jpeg', 0.85));
        } catch { adminState.editingImages.push(String(reader.result)); }
        if (--pending === 0) { renderImagesGrid(); showToast(`أُضيفت ${files.length} صورة.`, 'success'); }
      };
      img.onerror = () => { if (--pending === 0) renderImagesGrid(); };
      img.src = String(reader.result);
    };
    reader.onerror = () => { if (--pending === 0) renderImagesGrid(); };
    reader.readAsDataURL(file);
  });
}

function renderImagesGrid() {
  const grid = $('#pImagesGrid');
  if (!grid) return;
  const images = adminState.editingImages ?? [];
  grid.innerHTML = images.length ? images.map((src, index) => `
    <div class="img-thumb${index === 0 ? ' cover' : ''}">
      <img src="${esc(src)}" alt="">
      ${index === 0 ? '<span class="img-cover-tag">الغلاف</span>' : ''}
      <button type="button" class="img-remove" data-img-remove="${index}" title="إزالة"><span class="material-symbols-outlined">close</span></button>
    </div>`).join('')
    : '<p class="font-body-sm text-on-surface-variant">لا صور بعد.</p>';
}

/* ── صورة مفردة (شعار محفظة / QR): تُضغط وتُخزَّن كـ dataURL ── */
function readSingleImage(file, onDone) {
  if (!file || !file.type.startsWith('image/')) { showToast('اختر ملف صورة صحيح.', 'error'); return; }
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_IMAGE_PX / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      try { onDone(canvas.toDataURL('image/png')); }
      catch { onDone(String(reader.result)); }
    };
    img.onerror = () => showToast('تعذّر قراءة الصورة.', 'error');
    img.src = String(reader.result);
  };
  reader.onerror = () => showToast('تعذّر قراءة الملف.', 'error');
  reader.readAsDataURL(file);
}

/** معاينة شعار المحفظة أو QR مع زر إزالة */
function renderWalletAsset(previewId, dataUrl, label) {
  const box = $(previewId);
  if (!box) return;
  box.innerHTML = dataUrl
    ? `<div class="wallet-thumb"><img src="${esc(dataUrl)}" alt="${esc(label)}"><button type="button" class="img-remove" data-wallet-asset-remove="${previewId}" title="إزالة"><span class="material-symbols-outlined">close</span></button></div>`
    : '';
}

function loadProductToForm(product) {
  $('#pName').value = product.name ?? '';
  $('#pSlug').value = product.slug ?? '';
  $('#pShort').value = product.short ?? '';
  $('#pLong').value = product.long ?? '';
  $('#pType').value = product.type ?? 'file';
  $('#pPlatform').value = product.platform ?? '';
  $('#pPrice').value = product.price ?? 0;
  $('#pCurrency').value = product.currency ?? 'USD';
  $('#pVersion').value = product.version ?? '1.0.0';
  $('#pStatus').value = product.status ?? 'active';
  const dv = product.delivery ?? {};
  $('#pDeliveryMode').value = dv.mode ?? 'file';
  $('#pDeliveryUrl').value = dv.url ?? '';
  $('#pDeliveryInvite').value = dv.inviteUrl ?? '';
  $('#pDeliveryPublic').checked = dv.isPublic !== false;
  $('#pDeliveryFile').value = dv.fileName ?? '';
  $('#pDeliverySize').value = dv.size ?? '';
  $('#pDeliveryNote').value = dv.note ?? '';
  $('#pDeliveryCommands').value = (dv.commands ?? []).join('\n');
  paintDeliveryFields(dv.mode ?? 'file');
  $('#pLicenseNote').value = product.licenseNote ?? '';
  if ($('#pFeatured')) $('#pFeatured').checked = product.featured ?? false;
  $('#pLicenseMode').value = product.licenseMode ?? 'none';
  $('#pLicenseKeys').value = (product.licenseKeys ?? []).join('\n');
  // صور المعاينة: مصفوفة images، أو صورة قديمة (previewImage) للتوافق الخلفي
  adminState.editingImages = Array.isArray(product.images)
    ? [...product.images]
    : (product.previewImage ? [product.previewImage] : []);
  renderImagesGrid();
  // النوع أولاً: يحدد الحقول الظاهرة قبل بقية التهيئة
  const kind = kindOf(product);
  $('#productModal').dataset.lastPaid = product.price > 0 ? String(product.price) : '';
  renderKindButtons(kind);
  applyKindFields(kind);
  // طرق الدفع صارت عامة (كل المحافظ تظهر للمشتري) — أُزيل المنتقي.
  paintEyeButtons(product.hiddenFields ?? []);
  paintPriceMode();
  renderStateBar();
}

/** مزامنة أزرار التسعير مع السعر الحالي */
function paintPriceMode() {
  const paid = (Number($('#pPrice')?.value) || 0) > 0;
  $$('#productModal [data-pricemode]').forEach((btn) => {
    const active = (btn.dataset.pricemode === 'paid') === paid;
    btn.classList.toggle('btn-primary', active);
    btn.classList.toggle('btn-secondary', !active);
  });
}

/* ── أُزيل منتقي طرق الدفع لكل منتج ──
   القرار: كل المحافظ المُفعّلة تُعرض للمشتري وهو يختار — فلا معنى لربط
   طريقة دفع بمنتج بعينه. كانت هنا بطاقات تُبنى من نظامين متوازيين
   (wallets.json + settings.paymentMethods) وهذا الازدواج هو ما جعل
   عدد الطرق المُعدّة صفراً دون أن يلاحظ أحد. */



/* ═══ روابط التسليم — نفس منطق الواجهة (app.js) ═══
   لوحة الأدمن لا تحمّل app.js، فنكرّر الحل هنا معرّفاً واحداً للمصدر.
   الهدف: ألّا يرى الأدمن رابطاً ميتاً في المعاينة، وأن يعرف فوراً أي منتج
   تنزيله غير جاهز (يُنبَّه في التقرير لا بصمت).

   ⚠️ لا تحجب مضيفاً كاملاً — github.com سليم؛ الميت هو المسار /nova-dev/. */
const DEAD_URL_HOSTS = ['nova.dev', 'example.com', 'localhost'];

function adminResolveDeliveryUrl(product, raw) {
  if (!raw) return '';
  let out = String(raw)
    .replace(/\{slug\}/gi, product.slug ?? '')
    .replace(/\{version\}/gi, product.version ?? 'latest')
    .replace(/\{kind\}/gi, product.kind ?? product.type ?? '')
    .replace(/\{type\}/gi, product.type ?? '')
    .replace(/\{file\}/gi, product.fileName ?? product.asset ?? '');
  if (/\{|\}/.test(out)) return '';
  let host = '';
  let pathname = '';
  try {
    const parsed = new URL(out);
    host = parsed.hostname.replace(/^www\./, '');
    pathname = parsed.pathname;
  } catch {
    return '';
  }
  if (DEAD_URL_HOSTS.includes(host)) return '';
  if (host === 'github.com' && /^\/(nova-dev|example)(\/|$)/i.test(pathname)) return '';
  return out;
}

function adminDeliveryUrl(product) {
  const d = product.delivery;
  if (d && DELIVERY_MODE_META[d.mode]) {
    // المستودع الخاص: الوجهة هي رابط الدعوة لا رابط المستودع
    if (d.mode === 'repo' && d.isPublic === false) return adminResolveDeliveryUrl(product, d.inviteUrl);
    // المفتاح والأوامر لا «وجهة» لهما — يُعرضان لا يُفتحان
    if (d.mode === 'key' || d.mode === 'install') return '';
    return adminResolveDeliveryUrl(product, d.url);
  }
  // توافق خلفي لمنتج لم يُحدَّث بعد
  return adminResolveDeliveryUrl(product, product.repo ?? product.downloadUrl);
}

/* ══ التسليم الموحّد — نمط واحد يُظهر حقوله فقط ══
   كان هنا أربعة حقول متفرّقة (رابط التسليم · صفحة المشروع · دعوة GitHub ·
   أوامر التثبيت) لا يعرف الأدمن أيّها يُستخدم فعلاً، ولا يمكن تمثيل منشور
   أو خدمة أو مفتاح بها. الآن نمط صريح، والحقول غير المتعلّقة لا تُرسم. */
const DELIVERY_MODE_LABELS = {
  file: 'ملف', repo: 'مستودع', link: 'منشور', service: 'خدمة', key: 'مفتاح', install: 'أوامر',
};

const DELIVERY_MODE_META = {
  file:    { needsUrl: true,  hint: 'ارفع الملف على أي استضافة ثم ضع الرابط المباشر.' },
  repo:    { needsUrl: true,  hint: 'المستودع العام يكفيه الرابط. والخاص يحتاج رابط دعوة يُرسَل بعد الدفع.' },
  link:    { needsUrl: true,  hint: 'منشور أو مقال أو صفحة — يُفتح في تبويب جديد.' },
  service: { needsUrl: true,  hint: 'خدمة حيّة — يُفتح في تبويب جديد.' },
  key:     { needsUrl: false, hint: 'المفتاح يُسلَّم من «مفاتيح الترخيص» أعلاه ويظهر للمشتري بعد تأكيد الدفع.' },
  install: { needsUrl: false, hint: 'الأوامر تُعرَض للمشتري في صفحة المنتج مع زر نسخ لكل أمر.' },
};

function paintDeliveryFields(mode) {
  const meta = DELIVERY_MODE_META[mode] ?? DELIVERY_MODE_META.file;
  $$('#productModal .dv-field').forEach((el) => {
    const modes = String(el.dataset.dv ?? '').split(' ');
    el.style.display = modes.includes(mode) ? '' : 'none';
  });
  const hint = $('#pDeliveryHint');
  if (hint) {
    const free = Number($('#pPrice')?.value || 0) === 0;
    const keyWarning = (mode === 'key' && free)
      ? ' ⚠️ منتج مجاني بمفتاح: المفتاح سيصير ظاهراً لكل زائر.'
      : '';
    hint.textContent = meta.hint + keyWarning;
  }
}

function readDeliveryForm() {
  const mode = $('#pDeliveryMode')?.value ?? 'file';
  const lines = (value) => String(value ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  return {
    mode,
    url: ($('#pDeliveryUrl')?.value ?? '').trim(),
    inviteUrl: ($('#pDeliveryInvite')?.value ?? '').trim(),
    isPublic: $('#pDeliveryPublic')?.checked !== false,
    fileName: ($('#pDeliveryFile')?.value ?? '').trim(),
    size: ($('#pDeliverySize')?.value ?? '').trim(),
    note: ($('#pDeliveryNote')?.value ?? '').trim(),
    commands: lines($('#pDeliveryCommands')?.value),
  };
}

/** هل التسليم جاهز فعلاً لهذا المنتج؟ — يُبنى عليه تقرير الجاهزية */
function isDeliveryReady(product) {
  const d = product.delivery;
  if (!d || !DELIVERY_MODE_META[d.mode]) return false;
  if (d.mode === 'install') return Array.isArray(d.commands) && d.commands.some((c) => String(c).trim());
  if (d.mode === 'key') return Array.isArray(product.licenseKeys) && product.licenseKeys.some((k) => String(k).trim());
  if (d.mode === 'repo' && d.isPublic === false) return Boolean(String(d.inviteUrl ?? '').trim());
  const url = String(d.url ?? '').trim();
  return /^https?:\/\//i.test(url) && !ADMIN_PLACEHOLDER_RE.test(url);
}

/* تقرير جاهزية التسليم: أي منتج فعّال بلا رابط تسليم صالح؟ */
function deliveryGaps(products) {
  return (products ?? [])
    .filter((p) => p.status !== 'hidden')
    .map((p) => ({ product: p, ready: isDeliveryReady(p) }))
    .filter((row) => !row.ready);
}

function renderDeliveryAlert() {
  const box = $('#deliveryAlert');
  if (!box) return;
  const gaps = deliveryGaps(adminState.products);
  if (!gaps.length) { box.style.display = 'none'; box.innerHTML = ''; return; }
  box.style.display = 'block';
  box.innerHTML = `
    <span class="material-symbols-outlined" style="font-size:20px">warning</span>
    <div class="grow">
      <strong>${gaps.length} منتج فعّال بلا تسليم جاهز.</strong>
      <span class="text-on-surface-variant">المشتري قد يدفع ولا يجد ما يستلمه — افتح كل منتج واضبط «طريقة التسليم» وحقلها:</span>
      <div style="margin-top:6px">${gaps.map((g) => `<code dir="ltr">${esc(g.product.slug)}</code>`).join(' · ')}</div>
    </div>`;
}

/* تقرير جاهزية الدفع: أي وسيلة دفع لا يمكن استخدامها فعلاً؟
   سبب وجوده: الواجهة تُخفي تلقائياً أي وسيلة بلا عنوان/رابط صالح (لأن عرض
   وسيلة معطوبة يعني أن المشتري قد يُرسل مالاً إلى عنوان لا يملكه أحد).
   لكن الإخفاء الصامت يترك الأدمن في حيرة «لماذا لا تظهر؟» — فهذا التقرير
   يقول له السبب بالضبط. */
const ADMIN_PLACEHOLDER_RE = /(example|demo|test|xxxx+|your[-_]?|placeholder|change[-_]?me|work[-_]?showcase|nova[-_]?dev)/i;

function paymentGaps() {
  const gaps = [];
  (adminState.wallets ?? []).forEach((wallet) => {
    if (wallet.enabled === false) return;
    const label = wallet.label ?? wallet.id;
    if (wallet.type === 'local') {
      // المحلية تحتاج رقم حساب + اسم صاحب حساب — وإلا لا يمكن الدفع إليها
      const account = String(wallet.account ?? '').trim();
      const owner = String(wallet.accountName ?? '').trim();
      if (account.length < 4 || ADMIN_PLACEHOLDER_RE.test(account)) gaps.push(`${label} — لا رقم محفظة`);
      else if (owner.length < 2) gaps.push(`${label} — لا اسم صاحب حساب`);
    } else {
      const address = String(wallet.address ?? '').trim();
      if (address.length < 12 || ADMIN_PLACEHOLDER_RE.test(address)) gaps.push(`${label} — لا عنوان استقبال`);
    }
  });
  return gaps;
}

function renderPaymentsAlert() {
  const box = $('#paymentsAlert');
  if (!box) return;
  const gaps = paymentGaps();
  if (!gaps.length) { box.style.display = 'none'; box.innerHTML = ''; return; }
  box.style.display = 'block';
  box.innerHTML = `
    <span class="material-symbols-outlined" style="font-size:20px">warning</span>
    <div class="grow">
      <strong>${gaps.length} وسيلة دفع لن تظهر للمشتري.</strong>
      <span class="text-on-surface-variant">لا تُعرض في صفحة الشراء حتى تُكمل بياناتها — وعرض وسيلة معطوبة يعني أن المشتري قد يُرسل مالاً إلى عنوان لا تملكه:</span>
      <div style="margin-top:6px">${gaps.map((g) => `<span>· ${esc(g)}</span>`).join('<br>')}</div>
    </div>`;
}


/* الحقول الحساسة (تسليم): تُقفل تلقائياً عن العميل عندما يكون المنتج مدفوعاً.
   `repo` مضاف: يبقى رابطاً مضموناً للمشتري إن لم يكن ملف التنزيل جاهزاً بعد. */
const DELIVERY_FIELDS = ['downloadUrl', 'repo', 'githubUrl', 'install'];

function defaultHiddenFor(price) {
  return Number(price) > 0 ? [...DELIVERY_FIELDS] : [];
}

function visibleDefaultPayments() {
  // المنتج الجديد: المحافظ الافتراضية فقط تُحدَّد تلقائياً (لا كل الطرق)
  return (adminState.wallets ?? [])
    .filter((w) => w.enabled !== false && w.isDefault)
    .map((w) => w.id);
}

/* ═══ أنواع إضافة المنتج: لكل نوع حقوله الخاصة ═══
   النوع يحدد: (١) حقل `type` المخزَّن للعميل (٢) حقول النموذج الظاهرة
   (٣) تسمية الحقول المشتركة — فيقرأ كل نوع بعباراته الصحيحة:
       مشروع GitHub ≠ واجهة API ≠ منشور نصي ≠ تطبيق سطح مكتب … */
const FIELD_INPUT_IDS = {};  // حقول التسليم صارت كائناً واحداً (delivery) لا أربعة حقول متفرّقة
const DEFAULT_FIELD_LABELS = {
  downloadUrl: 'رابط التسليم 🔒',
  githubUrl: 'دعوة مستودع GitHub 🔒',
  install: 'أوامر التثبيت/الاستخدام 🔒',
  repo: 'رابط صفحة المشروع (بديل مضمون) 🔒',
};
const PRODUCT_KINDS = {
  cli: {
    label: 'أداة CLI', icon: 'terminal', type: 'cli',
    fields: ['name', 'slug', 'short', 'long', 'images', 'platform', 'version', 'install', 'githubUrl', 'price', 'currency', 'licenseMode', 'licenseKeys', 'featured', 'status', 'payments'],
    labels: { install: 'أوامر التثبيت (CLI)', githubUrl: 'رابط المستودع (GitHub) 🔒' },
  },
  exe: {
    label: 'تطبيق سطح مكتب (exe)', icon: 'desktop_windows', type: 'exe',
    fields: ['name', 'slug', 'short', 'long', 'images', 'platform', 'version', 'downloadUrl', 'repo', 'price', 'currency', 'licenseMode', 'licenseKeys', 'licenseNote', 'featured', 'status', 'payments'],
    labels: { downloadUrl: 'رابط ملف التثبيت (.exe) 🔒' },
  },
  apk: {
    label: 'تطبيق أندرويد (apk)', icon: 'phone_android', type: 'apk',
    fields: ['name', 'slug', 'short', 'long', 'images', 'platform', 'version', 'downloadUrl', 'repo', 'price', 'currency', 'licenseMode', 'licenseKeys', 'licenseNote', 'featured', 'status', 'payments'],
    labels: { downloadUrl: 'رابط ملف APK 🔒' },
  },
  api: {
    label: 'واجهة برمجية (API)', icon: 'dns', type: 'api',
    fields: ['name', 'slug', 'short', 'long', 'images', 'version', 'downloadUrl', 'repo', 'githubUrl', 'install', 'price', 'currency', 'licenseMode', 'licenseKeys', 'licenseNote', 'featured', 'status', 'payments'],
    labels: { downloadUrl: 'رابط التوثيق / Endpoint 🔒', githubUrl: 'رابط المستودع 🔒', install: 'مثال على الاستدعاء 🔒' },
  },
  github: {
    label: 'مشروع GitHub', icon: 'code', type: 'file',
    fields: ['name', 'slug', 'short', 'long', 'images', 'version', 'githubUrl', 'downloadUrl', 'repo', 'install', 'price', 'currency', 'licenseMode', 'licenseKeys', 'featured', 'status', 'payments'],
    labels: { githubUrl: 'رابط المستودع 🔒', downloadUrl: 'رابط الإصدارات (Releases)', install: 'أوامر البناء/التشغيل' },
  },
  website: {
    label: 'موقع / قالب ويب', icon: 'language', type: 'file',
    fields: ['name', 'slug', 'short', 'long', 'images', 'platform', 'downloadUrl', 'repo', 'price', 'currency', 'licenseMode', 'licenseKeys', 'featured', 'status', 'payments'],
    labels: { downloadUrl: 'رابط القالب / الملف 🔒' },
  },
  post: {
    label: 'منشور / صور', icon: 'image', type: 'file',
    fields: ['name', 'slug', 'short', 'long', 'images', 'downloadUrl', 'repo', 'price', 'currency', 'featured', 'status', 'payments'],
    labels: { downloadUrl: 'رابط المرفق (اختياري)' },
  },
};

/** نوع المنتج المخزَّن — يرجع للاستنتاج من الحقل القديم `type` عند غيابه */
function kindOf(product) {
  if (product.kind && PRODUCT_KINDS[product.kind]) return product.kind;
  return Object.keys(PRODUCT_KINDS).find((key) => PRODUCT_KINDS[key].type === product.type) ?? 'website';
}

function currentKind() {
  return $('#pKindPicker')?.dataset.kind ?? 'website';
}

function renderKindButtons(active) {
  const box = $('#pKindButtons');
  if (!box) return;
  box.innerHTML = Object.entries(PRODUCT_KINDS).map(([key, kind]) => `
    <button type="button" class="btn btn-size-md ${key === active ? 'btn-primary' : 'btn-secondary'}" data-kind="${key}">
      <span class="material-symbols-outlined" style="font-size:16px">${kind.icon}</span>${esc(kind.label)}
    </button>`).join('');
  $('#pKindPicker').dataset.kind = active;
}

/** تطبيق حقول النوع: إخفاء ما لا يخصّه، وتفريغ قيمه عند تبديل النوع */
function applyKindFields(kindKey, { clear = false } = {}) {
  const kind = PRODUCT_KINDS[kindKey];
  if (!kind) return;
  const allowed = new Set(kind.fields);
  document.querySelectorAll('#productModal [data-pfield]').forEach((box) => {
    const key = box.dataset.pfield;
    const show = allowed.has(key) || key === 'type';
    box.style.display = show ? '' : 'none';
    if (!show && clear) {
      box.querySelectorAll('input, textarea').forEach((el) => { el.value = ''; });
      if (key === 'images') { adminState.editingImages = []; renderImagesGrid(); }
    }
  });
  // تسميات الحقول المشتركة تتبدّل بحسب النوع (رابط المستودع مقابل رابط التسليم …)
  const labels = { ...DEFAULT_FIELD_LABELS, ...(kind.labels ?? {}) };
  Object.entries(FIELD_INPUT_IDS).forEach(([field, inputId]) => {
    const label = document.querySelector(`#productModal label[for="${inputId}"]`);
    if (label) label.textContent = labels[field];
  });
  const typeSelect = $('#pType');
  if (typeSelect) typeSelect.value = kind.type;
  renderStateBar();
}

/** شريط الحالة الحيّ: النوع + مجاني/مدفوع + حالة قفل التسليم */
function renderStateBar() {
  const bar = $('#pStateBar');
  if (!bar) return;
  const kind = PRODUCT_KINDS[currentKind()];
  const price = Number($('#pPrice')?.value) || 0;
  const paid = price > 0;
  bar.innerHTML = `
    <span class="badge badge-indigo flex items-center gap-space-xs"><span class="material-symbols-outlined" style="font-size:14px">${kind?.icon ?? 'category'}</span>${esc(kind?.label ?? 'نوع')}</span>
    <span class="badge ${paid ? 'badge-indigo' : 'badge-success'}">${paid ? `مدفوع — ${esc($('#pCurrency')?.value ?? 'USD')} ${price}` : 'مجاني — تنزيل مباشر'}</span>
    <span class="text-on-surface-variant flex items-center gap-space-xs">
      <span class="material-symbols-outlined" style="font-size:15px">${paid ? 'lock' : 'lock_open'}</span>
      ${paid ? 'رابط التسليم والترخيص يُسلَّمان بعد تأكيد الدفع' : 'التسليم مفتوح للعميل مباشرة'}
    </span>`;
}

/** تبديل وضع التسعير: مجاني ↔ مدفوع (يفرّق الحقول والسلوك) */
function setPriceMode(mode) {
  const priceInput = $('#pPrice');
  if (!priceInput) return;
  if (mode === 'free') {
    // نحفظ آخر سعر مدفوع كي لا يضيع عند الرجوع للوضع المدفوع
    if (Number(priceInput.value) > 0) $('#productModal').dataset.lastPaid = priceInput.value;
    priceInput.value = 0;
  } else {
    priceInput.value = $('#productModal').dataset.lastPaid || 29;
  }
  priceInput.dispatchEvent(new Event('input'));
  $$('#productModal [data-pricemode]').forEach((btn) => {
    const active = btn.dataset.pricemode === mode;
    btn.classList.toggle('btn-primary', active);
    btn.classList.toggle('btn-secondary', !active);
  });
  renderStateBar();
}

function formToProduct() {
  const lines = (value) => String(value ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
  const existing = adminState.products.find((p) => p.id === adminState.editingId);
  const price = Number($('#pPrice').value) || 0;
  // دمج: اختيارات العين الحالية + قفل التسليم التلقائي للمدفوع (لا يعتمد على تذكّر الأدمن)
  const hiddenFields = [...new Set([...currentHiddenFields(), ...defaultHiddenFor(price)])];
  return {
    id: adminState.editingId ?? Math.max(0, ...adminState.products.map((p) => p.id)) + 1,
    name: $('#pName').value.trim(),
    slug: $('#pSlug').value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-'),
    short: $('#pShort').value.trim(),
    long: $('#pLong').value.trim(),
    type: $('#pType').value,
    platform: $('#pPlatform').value.trim(),
    price,
    currency: $('#pCurrency').value,
    version: $('#pVersion').value.trim() || '1.0.0',
    status: $('#pStatus').value,
    images: [...(adminState.editingImages ?? [])],
    licenseMode: $('#pLicenseMode').value,
    licenseKeys: lines($('#pLicenseKeys').value),
    usedKeys: existing?.usedKeys ?? [],
    hiddenFields,
    delivery: readDeliveryForm(),
    kind: currentKind(),
    licenseNote: $('#pLicenseNote')?.value.trim() ?? existing?.licenseNote ?? '',
    featured: $('#pFeatured') ? $('#pFeatured').checked : (existing?.featured ?? false),
    downloads: existing?.downloads ?? 0,
  };
}

/* مسودات محلية: جسر بين الأدمن والعميل على نفس الجهاز.
   الموقع ثابت بلا سيرفر، فصفحة العميل تقرأ data/*.json.
   ما يُضاف في الأدمن يُحفظ هنا فوراً، وصفحة العميل تدمجه تلقائياً
   حتى قبل الدفع إلى GitHub (التصدير/المزامنة تبقى للنشر العام). */
function persistProductsDraft() {
  writeLocal('nova_products_draft', { products: adminState.products, updatedAt: new Date().toISOString() });
  // مزامنة فورية مع قاعدة البيانات الأونلاين إن كانت متصلة — لا حاجة لأي رفع يدوي
  if (typeof DB !== 'undefined' && DB.isOnline()) {
    DB.migrateProducts(adminState.products).catch((error) => {
      console.warn('تعذّرت مزامنة المنتجات مع القاعدة:', error.message);
    });
  }
}
function persistWalletsDraft() {
  writeLocal('nova_wallets_draft', { wallets: adminState.wallets, updatedAt: new Date().toISOString() });
}


/* ─ بطاقة المشاركة: رابط مباشر يفتح المنتج عند العميل + أزرار وسائل التواصل ─ */
function directProductLink(product) {
  // رابط مباشر داخل مجلد الموقع — يفتح صفحة العميل على تفاصيل المنتج نفسه
  const base = location.href.split(/[?#]/)[0].replace(/[^/]*$/, '');
  return `${base}index.html?p=${encodeURIComponent(product.slug)}`;
}

function openShareCard(product) {
  const body = $('#shareBody');
  if (!body) return;
  const link = directProductLink(product);
  const priceText = product.price ? `${product.currency} ${product.price}` : 'مجاني';
  const shareText = `${product.name} — ${product.short || ''} (${priceText})`;
  const enc = encodeURIComponent;
  const socials = [
    { label: 'X / تويتر', icon: 'share', href: `https://twitter.com/intent/tweet?text=${enc(shareText)}&url=${enc(link)}` },
    { label: 'واتساب', icon: 'chat', href: `https://wa.me/?text=${enc(`${shareText} ${link}`)}` },
    { label: 'تيليجرام', icon: 'send', href: `https://t.me/share/url?url=${enc(link)}&text=${enc(shareText)}` },
    { label: 'فيسبوك', icon: 'public', href: `https://www.facebook.com/sharer/sharer.php?u=${enc(link)}` },
    { label: 'لينكدإن', icon: 'work', href: `https://www.linkedin.com/sharing/share-offsite/?url=${enc(link)}` },
  ];
  body.innerHTML = `
    <div class="flex flex-col gap-space-md">
      ${(product.images?.[0] ?? product.previewImage) ? `<img src="${esc(product.images?.[0] ?? product.previewImage)}" alt="${esc(product.name)}" style="width:100%;max-height:200px;object-fit:cover;border-radius:var(--radius-default);border:1px solid var(--color-outline-variant)">` : ''}
      <div class="flex items-center gap-space-sm flex-wrap">
        <span class="badge badge-indigo flex items-center gap-space-xs"><span class="material-symbols-outlined" style="font-size:14px">${PRODUCT_KINDS[kindOf(product)]?.icon ?? 'category'}</span>${esc(PRODUCT_KINDS[kindOf(product)]?.label ?? product.type)}</span>
        <span class="badge ${product.price ? 'badge-indigo' : 'badge-success'}">${esc(priceText)}</span>
        ${product.featured === true ? '<span class="badge badge-neutral">مميّز</span>' : ''}
      </div>
      <div>
        <div class="field-label">الرابط المباشر — يفتح تفاصيل هذا المنتج فوراً عند العميل</div>
        <div class="flex items-center gap-space-sm">
          <input id="shareLinkInput" class="input grow font-code-sm" dir="ltr" readonly value="${esc(link)}">
          <button type="button" class="btn btn-primary btn-size-md" id="shareCopyBtn" style="flex-shrink:0">نسخ</button>
        </div>
      </div>
      <div>
        <div class="field-label">انشره على وسائل التواصل</div>
        <div class="flex flex-wrap gap-space-xs">
          ${socials.map((s) => `<a class="btn btn-secondary btn-size-md" href="${esc(s.href)}" target="_blank" rel="noopener"><span class="material-symbols-outlined" style="font-size:16px">${s.icon}</span>${esc(s.label)}</a>`).join('')}
        </div>
      </div>
      <p class="font-body-sm text-on-surface-variant">المنشور: <span dir="auto">${esc(shareText)}</span></p>
    </div>`;
  $('#shareCopyBtn')?.addEventListener('click', () => {
    navigator.clipboard.writeText(link)
      .then(() => showToast('نُسخ الرابط المباشر — شارِكه الآن.', 'success'))
      .catch(() => {
        const input = $('#shareLinkInput');
        input?.select();
        showToast('تعذّر النسخ التلقائي — الرابط محدَّد، انسخه يدوياً (Ctrl+C).', 'error');
      });
  });
  document.getElementById('shareModal').classList.add('active');
}

function initProductCRUD() {
  // منتقي النوع: تبديل النوع يبدّل حقول النموذج (ويفرّغ حقول النوع السابق)
  document.addEventListener('click', (event) => {
    const kindBtn = event.target.closest('[data-kind]');
    if (kindBtn && kindBtn.closest('#pKindPicker')) {
      const next = kindBtn.dataset.kind;
      if (next === currentKind()) return;
      renderKindButtons(next);
      applyKindFields(next, { clear: true });
      paintEyeButtons([]); // نوع جديد = إخفاءات نظيفة
      renderStateBar();
      showToast(`نوع المنتج: ${PRODUCT_KINDS[next].label} — عرضنا حقوله فقط.`, 'info');
      return;
    }
    const modeBtn = event.target.closest('[data-pricemode]');
    if (modeBtn && modeBtn.closest('#pPriceModeRow')) setPriceMode(modeBtn.dataset.pricemode);
  });
  // العين: تبديل حالة الظهور للعميل لكل حقل
  document.addEventListener('click', (event) => {
    const eye = event.target.closest('[data-eye]');
    if (eye && eye.closest('#productModal')) {
      eye.classList.toggle('eye-off');
      paintEyeButtons(currentHiddenFields());
    }
  });
  // بطاقات الدفع: النقر على البطاقة يفعّلها/يلغيها للمنتج
  // مبدّل نمط التسليم: يُظهر حقول النمط المختار فقط
  $('#pDeliveryMode')?.addEventListener('change', (event) => paintDeliveryFields(event.target.value));
  $('#pPrice')?.addEventListener('input', () => paintDeliveryFields($('#pDeliveryMode')?.value ?? 'file'));

  $('#pPaymentMethods')?.addEventListener('click', (event) => {
    const card = event.target.closest('.pay-opt');
    if (card) card.classList.toggle('active');
  });
  // مدير الصور: اختيار متعدد + سحب وإفلات + إزالة
  const imagesDrop = $('#pImagesDrop');
  const imagesInput = $('#pImagesInput');
  imagesDrop?.addEventListener('click', () => imagesInput?.click());
  imagesInput?.addEventListener('change', (event) => {
    addImageFiles(event.target.files);
    event.target.value = '';
  });
  imagesDrop?.addEventListener('dragover', (event) => { event.preventDefault(); imagesDrop.classList.add('drag'); });
  imagesDrop?.addEventListener('dragleave', () => imagesDrop.classList.remove('drag'));
  imagesDrop?.addEventListener('drop', (event) => {
    event.preventDefault();
    imagesDrop.classList.remove('drag');
    if (event.dataTransfer?.files?.length) addImageFiles(event.dataTransfer.files);
  });
  $('#pImagesGrid')?.addEventListener('click', (event) => {
    const removeBtn = event.target.closest('[data-img-remove]');
    if (!removeBtn) return;
    adminState.editingImages.splice(Number(removeBtn.dataset.imgRemove), 1);
    renderImagesGrid();
  });
  // المنتج الجديد: الافتراضي، الافتراضيات تُحدَّد تلقائياً؛ القفل التلقائي عند كتابة سعر
  $('#pPrice')?.addEventListener('input', () => {
    const price = Number($('#pPrice').value) || 0;
    const current = new Set(currentHiddenFields());
    if (price > 0) {
      defaultHiddenFor(price).forEach((key) => current.add(key));
    } else {
      // عاد المنتج مجانياً: تُفتح أقفال التسليم التلقائية، وتبقى إخفاءات العين اليدوية الأخرى
      DELIVERY_FIELDS.forEach((key) => current.delete(key));
    }
    paintEyeButtons([...current]);
    renderStateBar();
  });
  $('#pCurrency')?.addEventListener('change', renderStateBar);
  $('#addProductBtn').addEventListener('click', () => {
    adminState.editingId = null;
    $('#productModalTitle').textContent = 'منتج جديد';
    loadProductToForm({ status: 'active', currency: 'USD', version: '1.0.0', type: 'file', kind: 'website', hiddenFields: [] });
    document.getElementById('productModal').classList.add('active');
  });
  $('#saveProductBtn').addEventListener('click', () => {
    const product = formToProduct();
    if (!product.name || !product.slug) { showToast('الاسم والمعرّف مطلوبان.', 'error'); return; }
    const index = adminState.products.findIndex((p) => p.id === product.id);
    if (index >= 0) adminState.products[index] = product;
    else adminState.products.push(product);
    persistProductsDraft();
    renderProductsTable();
    document.getElementById('productModal').classList.remove('active');
    showToast('تم حفظ المنتج — يظهر الآن في صفحة العميل على هذا الجهاز. ادفعه إلى GitHub ليظهر للجميع.', 'success');
  });
  document.addEventListener('click', (event) => {
    const editBtn = event.target.closest('[data-edit]');
    if (editBtn) {
      const product = adminState.products.find((p) => p.id === Number(editBtn.dataset.edit));
      if (product) {
        adminState.editingId = product.id;
        $('#productModalTitle').textContent = `تحرير: ${product.name}`;
        loadProductToForm(product);
        document.getElementById('productModal').classList.add('active');
      }
      return;
    }
    const previewBtn = event.target.closest('[data-preview]');
    if (previewBtn) {
      const product = adminState.products.find((p) => p.id === Number(previewBtn.dataset.preview))
        ?? formToProduct();
      openAdminPreview(product);
      return;
    }
    const shareBtn = event.target.closest('[data-share]');
    if (shareBtn) {
      const product = adminState.products.find((p) => p.id === Number(shareBtn.dataset.share));
      if (product) openShareCard(product);
      return;
    }
    const delBtn = event.target.closest('[data-del]');
    if (delBtn && confirm('حذف هذا المنتج نهائياً؟')) {
      adminState.products = adminState.products.filter((p) => p.id !== Number(delBtn.dataset.del));
      persistProductsDraft();
      renderProductsTable();
      showToast('تم حذف المنتج — حُذف أيضاً من صفحة العميل على هذا الجهاز.', 'success');
    }
  });
  document.getElementById('productModal').addEventListener('click', (event) => {
    if (event.target.classList.contains('modal-overlay')) event.target.classList.remove('active');
  });
  document.getElementById('adminPreviewModal')?.addEventListener('click', (event) => {
    if (event.target.classList.contains('modal-overlay')) event.target.classList.remove('active');
  });
  document.getElementById('shareModal')?.addEventListener('click', (event) => {
    if (event.target.classList.contains('modal-overlay')) event.target.classList.remove('active');
  });
  // زر المعاينة داخل مودال التحرير: يعاين القيم الحالية قبل الحفظ
  $('#previewProductBtnFooter')?.addEventListener('click', () => openAdminPreview(formToProduct()));
  $$('.modal-close').forEach((button) => button.addEventListener('click', () => {
    document.getElementById(button.dataset.close)?.classList.remove('active');
  }));
}

/* ── الطلبات والاقتراحات ── */

/** تنبيه صريح: القاعدة متصلة لكن القراءة محجوبة.
    بعد تشديد سياسات الأمان، قراءة الطلبات والاقتراحات تحتاج هوية موثّقة
    (Supabase Auth). ولو كان الأدمن داخلاً بالبوابة المحلية فقط، لعرض الجدول
    «لا طلبات بعد» بلا أي تفسير — وهذا بالضبط نوع الفشل الصامت الذي نمنعه. */
function dbReadNotice(colspan) {
  if (typeof DB === 'undefined' || !DB.isOnline()) return '';
  if (typeof DB.authReady === 'function' && DB.authReady()) return '';
  return `<tr><td colspan="${colspan}" class="text-center text-on-surface-variant" style="padding:var(--space-md)">
    <span class="material-symbols-outlined" style="font-size:18px;vertical-align:-4px">info</span>
    القاعدة متصلة، لكن قراءة هذه البيانات محجوبة عن المفتاح العام (وهذا هو الإصلاح الأمني المطلوب).
    لتظهر هنا: اضبط <code class="font-code-sm" dir="ltr">adminEmail</code> في تبويب الإعدادات،
    وأنشئ المستخدم في Supabase → Authentication.
    حتى ذلك الحين تُعرض البيانات المحفوظة في هذا المتصفح فقط.
  </td></tr>`;
}

/* ── حالة مصادقة الأدمن — تظهر بجانب حقل البريد في الإعدادات ── */
/* ── تنقية الكتالوج قبل النشر ──
   ⚠️ `data/products.json` ملف **منشور علناً**. فوجود رابط تسليم منتج مدفوع
   فيه يعني أن أي زائر يفتح الملف ويحمّل المنتج بلا دفع — وهذا تسريب حقيقي.
   القاعدة: **رابط تسليم المنتج المدفوع لا يخرج من متصفح الأدمن**؛ يُكتب على
   الطلب لحظة التأكيد، والمشتري يقرأه من طلبه وحده.
   والمجاني يبقى رابطاً علنياً لأنه كذلك بطبيعته.

   ملاحظة: أوامر التثبيت (`commands`) للمنتج المدفوع تُنشر أيضاً — فإن كان
   منتجك المدفوع تسليمه أوامر، فاترك الأوامر فارغة هنا واكتبها في ملاحظة
   التسليم عند التأكيد. */
function sanitizeForPublish(products) {
  return (products ?? []).map((product) => {
    if (!product.delivery || Number(product.price) === 0) return product;
    const { url, inviteUrl, ...rest } = product.delivery;
    void url; void inviteUrl;
    return { ...product, delivery: { ...rest, url: '', inviteUrl: '' } };
  });
}

const CONFIRM_SECRET_KEY = 'nova_confirm_secret';
function getConfirmSecret() { return readLocal(CONFIRM_SECRET_KEY, ''); }

/* ── رفض الطلب — سبب إجباري يصل للمشتري ──
   القاعدة الهندسية: الرفض بلا سبب هجرٌ للمشتري الذي حوّل مالاً بالفعل.
   المودال يمنع المتابعة بلا سبب (5 محارف على الأقل)، والسبب يُخزَّن في
   orders.rejectReason ويقرؤه المشتري من صفحة «الطلبات» وصندوق التتبّع. */
let rejectTarget = null;

function openRejectModal(reference) {
  rejectTarget = reference;
  const modal = $('#rejectModal');
  if (!modal) return;
  $('#rejectRef').textContent = reference;
  $('#rejectReasonInput').value = '';
  $('#rejectReasonError').style.display = 'none';
  modal.classList.add('active');
  setTimeout(() => $('#rejectReasonInput')?.focus(), 50);
}

function closeRejectModal() {
  $('#rejectModal')?.classList.remove('active');
  rejectTarget = null;
}

async function submitReject() {
  const input = $('#rejectReasonInput');
  const errorBox = $('#rejectReasonError');
  const reasonText = (input?.value ?? '').trim();
  if (reasonText.length < 5) {
    errorBox.style.display = 'block';
    input?.focus();
    return;
  }
  errorBox.style.display = 'none';
  const submitBtn = $('#rejectSubmitBtn');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'جارٍ الرفض…'; }

  try {
    let res = { ok: true, online: false, reason: 'offline' };
    if (typeof DB !== 'undefined') {
      res = await DB.rejectOrder(rejectTarget, reasonText, { secret: getConfirmSecret() });
    } else {
      const orders = readLocal('nova_purchases', []);
      const order = orders.find((o) => o.reference === rejectTarget);
      if (order) {
        order.status = 'rejected';
        order.rejectReason = reasonText;
        order.licenseKey = '';
        order.confirmedAt = null;
        writeLocal('nova_purchases', orders);
      }
    }
    closeRejectModal();
    await renderOrders();
    await renderAdminStats();

    if (res.online) {
      showToast(`رُفض الطلب ${rejectTarget ?? ''} — سبب الرفض يظهر للمشتري في صفحة الطلبات.`, 'success');
    } else {
      const FAIL = {
        'reason-required': 'السبب مطلوب — لا رفض بلا سبب.',
        'reason-too-short': 'السبب قصير جداً — اكتب 5 محارف على الأقل.',
        'bad-secret': 'سرّ التأكيد غير صحيح — راجع الإعدادات.',
        'no-such-order': 'لا طلب قيد المراجعة بهذا المرجع (قد يكون مؤكَّداً أو مرفوضاً سابقاً).',
        'needs-auth': 'أنت غير مسجَّل بحساب Supabase — اضبط «بريد الأدمن» ثم سجّل الدخول.',
        'rls': 'سياسات القاعدة ترفض التحديث رغم أنك موثّق — راجع ملف SQL.',
        'rpc-missing': 'دالة الرفض غير مُنشأة في القاعدة — شغّل supabase-final.sql.',
        'offline': 'لا اتصال بالقاعدة.',
        'network': 'تعذّر الوصول إلى القاعدة.',
        'db-error': 'خطأ من القاعدة.',
      };
      const why = FAIL[res.reason] ?? 'تعذّرت الكتابة في القاعدة.';
      showToast(`الرفض حُفظ في هذا المتصفح فقط — المشتري لن يراه. السبب: ${why}`, 'error');
    }
  } finally {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'تأكيد الرفض'; }
  }
}

async function paintAuthState() {
  // رابط مباشر لصفحة المستخدمين — نبنيها من معرّف المشروع في supabaseUrl
  const link = $('#authUsersLink');
  if (link) {
    const ref = String(adminState.settings?.supabaseUrl ?? '').match(/https?:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1];
    link.href = ref ? `https://supabase.com/dashboard/project/${ref}/auth/users` : 'https://supabase.com/dashboard';
  }

  const secretField = $('#setConfirmSecret');
  if (secretField && !secretField.value) {
    const saved = getConfirmSecret();
    if (saved) secretField.value = saved;
  }
  const secretBox = $('#secretState');
  if (secretBox) {
    secretBox.innerHTML = getConfirmSecret()
      ? '<span class=\"badge badge-success\">سرّ محفوظ ✓</span> — التأكيد يعمل بلا حساب.'
      : '<span class=\"badge badge-neutral\">بلا سرّ</span> — التأكيد يحتاج تسجيل دخول Supabase.';
  }

  const box = $('#authState');
  if (!box) return;
  const email = ($('#setAdminEmail')?.value ?? adminState.settings?.adminEmail ?? '').trim();

  if (typeof DB === 'undefined' || !DB.isOnline()) {
    box.innerHTML = '<span class="badge badge-neutral">غير متصل بقاعدة</span><br>'
      + 'كل شيء سيُحفظ في هذا المتصفح فقط.';
    return;
  }
  if (!email) {
    box.innerHTML = '<span class="badge badge-indigo">بلا مصادقة</span><br>'
      + '<span class="text-error">تأكيد الطلبات لن يصل للقاعدة — المشتري لن يراه.</span>';
    return;
  }
  const session = await DB.getSession();
  box.innerHTML = session
    ? '<span class="badge badge-success">مسجَّل ✓</span><br>' + esc(session.user?.email ?? email)
    : '<span class="badge badge-indigo">بانتظار الدخول</span><br>احفظ الإعدادات ثم أعد تحميل اللوحة وسجّل دخولك.';
}

/* ── تشخيص المتابعة: هل يستطيع المشتري رؤية تأكيد الأدمن؟ ──
   سبب وجوده: أخطر عطل في المشروع كان أن يُؤكّد الأدمن طلباً ولا يراه المشتري
   أبداً — بلا أي رسالة خطأ في أي من الطرفين. والسبب دائماً أحد اثنين:
     · دالة `get_order_by_reference` غير مُعرَّفة في القاعدة (إصلاح الأمان لم يُشغَّل)
     · سياسات RLS تمنع الكتابة عن المفتاح العام (والحل مصادقة الأدمن)
   هذا الفحص يسمّي السبب في اللوحة قبل أن يصل كشكوى من مشترٍ. */
async function renderTrackingDiagnostic() {
  const box = $('#trackingDiag');
  if (!box) return;
  const paint = (kind, icon, html) => {
    box.style.display = 'flex';
    box.className = 'text-' + kind;
    box.style.borderColor = kind === 'success' ? 'rgba(31,197,156,.35)' : (kind === 'warning' ? 'rgba(139,92,246,.35)' : 'var(--color-error)');
    box.innerHTML = `<span class="material-symbols-outlined" style="font-size:20px;flex-shrink:0">${icon}</span><div class="grow font-body-sm">${html}</div>`;
  };

  if (typeof DB === 'undefined' || !DB.isOnline()) {
    paint('warning', 'cloud_off',
      '<b>الوضع المحلي.</b> الطلبات والتأكيدات تُحفظ في هذا المتصفح فقط — '
      + 'المشتري على جهاز آخر لن يرى شيئاً. اربط Supabase من تبويب الإعدادات.');
    return;
  }

  /* ── المسار الأول المفضّل: السرّ (يعمل بلا حساب) ──
     نفحصه بمحاولة تأكيد بسرّ خاطئ على مرجع غير موجود: فإن ردّت الدالة بـ
     «unauthorized» فهي موجودة وتعمل — وهذا كل ما نحتاج معرفته. */
  if (getConfirmSecret()) {
    const probe2 = await DB.confirmOrder('__probe__', '', { secret: 'x'.repeat(20) });
    if (probe2.reason === 'rpc-missing') {
      paint('error', 'database_off',
        '<b>السرّ محفوظ لكن الدالة غير مُنشأة.</b> شغّل '
        + '<code class="font-code-sm" dir="ltr">supabase-admin-confirm.sql</code> من محرّر SQL في Supabase.');
      return;
    }
    if (probe2.reason === 'bad-secret') {
      paint('success', 'check_circle',
        '<b>التأكيد يعمل بالسرّ ✓</b> — المشتري يرى حالته ومفتاحه فور تأكيدك، بلا حاجة لحساب.');
      return;
    }
    paint('warning', 'sync_problem',
      'السرّ محفوظ لكن الفحص لم يكتمل (' + esc(probe2.reason ?? 'غير معروف') + ').');
    return;
  }

  /* ── المسار الثاني: مصادقة Supabase ── */
  const probe = await DB.getOrder('ZZZZZZ');
  const reason = probe?.reason;
  if (reason === 'rpc-missing') {
    paint('error', 'database_off',
      '<b>المشتري لن يرى تأكيدك.</b> دالة المتابعة الآمنة <code class="font-code-sm" dir="ltr">get_order_by_reference</code> '
      + 'غير مُعرَّفة في القاعدة — أي أن إصلاح الأمان لم يُشغَّل بعد. '
      + 'شغّل <code class="font-code-sm" dir="ltr">supabase-security-fix.sql</code> من محرّر SQL في Supabase.');
    return;
  }

  /* المصادقة أهم من كل ما سبق: سياسات الأمان تسمح بتأكيد الطلبات **للموثّقين
     فقط**. فبلا تسجيل دخول، التأكيد يُحفظ محلياً ويراه المشتري كأنه لم يحدث. */
  if (!DB.authReady()) {
    paint('error', 'lock_person',
      '<b>المشتري لن يرى تأكيدك.</b> أنت غير موثّق (الهوية «زائر»)، وسياسات القاعدة '
      + 'تسمح بتأكيد الطلبات للموثّقين فقط. اضبط <b>«بريد الأدمن»</b> في تبويب الإعدادات، '
      + 'وأنشئ المستخدم في Supabase → Authentication → Users، ثم سجّل دخولك من بوابة اللوحة.');
    return;
  }
  const session = await DB.getSession();
  if (!session) {
    paint('warning', 'login',
      '<b>لم تسجّل دخولك بعد.</b> أنشئت حساب Supabase وضبطت البريد، لكن الجلسة غير نشطة. '
      + 'أعد تحميل اللوحة وسجّل دخولك من بوابة الدخول.');
    return;
  }
  if (reason === 'rpc-error' || reason === 'network') {
    paint('error', 'sync_problem',
      '<b>تعذّر التحقّق من حالة المتابعة.</b> تحقّق من مفاتيح Supabase ومن الاتصال. '
      + 'حتى ذلك الحين قد لا يرى المشتري تأكيدك.');
    return;
  }
  if (reason === 'not-on-db') {
    paint('success', 'check_circle',
      '<b>المتابعة تعمل.</b> المشتري يرى حالة طلبه ومفتاحه فور تأكيدك — بلا حاجة لتحديث يدوي.');
    return;
  }
  paint('warning', 'help', 'حالة غير معروفة — راجع الكونسول.');
}

/** حالة الطلب كما يراها الأدمن — أسماء عربية وشارات دلالية لا نص إنجليزي خام */
function orderStatusLabel(status) {
  const map = {
    pending:   '<span class="badge badge-indigo">قيد المراجعة</span>',
    confirmed: '<span class="badge badge-success">مؤكَّد ✓</span>',
    rejected:  '<span class="badge" style="background:rgba(239,68,68,.12);color:var(--color-error);border-color:rgba(239,68,68,.3)">مرفوض ✕</span>',
  };
  return map[status] ?? `<span class="badge badge-neutral">${esc(status)}</span>`;
}

async function renderOrders() {
  const orders = (typeof DB !== 'undefined')
    ? await DB.getOrders()
    : readLocal('nova_purchases', []);
  const rows = orders.length ? orders.map((order) => `
    <tr>
      <td class="font-code-sm">${esc(order.reference)}</td>
      <td>${esc(order.productName)}</td>
      <td class="font-num" dir="ltr">${esc(order.currency)} ${order.price}</td>
      <td>${esc(order.methodLabel ?? order.methodKey)}${order.walletEndpoint ? `<br><span class="font-code-sm text-on-surface-variant">${esc(order.walletEndpoint)}</span>` : ''}</td>
      <td>${esc(order.payerName)}</td>
      <td class="font-code-sm payment-detail">${esc(order.payerRef)}</td>
      <td>${orderStatusLabel(order.status)}</td>
      <td>${order.status === 'confirmed' && order.licenseKey
        ? `<div class="flex items-center gap-space-xs"><code class="font-code-sm text-on-surface" dir="ltr">${esc(order.licenseKey)}</code><button type="button" class="btn btn-ghost btn-size-sm" data-copy-key="${esc(order.licenseKey)}">نسخ</button></div>`
        : (order.status === 'pending'
          ? `<div class="flex items-center gap-space-xs"><button type="button" class="btn btn-secondary btn-size-sm" data-approve="${esc(order.reference)}">تأكيد</button><button type="button" class="btn btn-ghost btn-size-sm" style="color:var(--color-error)" data-reject="${esc(order.reference)}">رفض…</button></div>`
          : (order.status === 'rejected' && order.rejectReason
            ? `<span class="font-body-sm text-on-surface-variant">السبب: ${esc(order.rejectReason)}</span>`
            : ''))}</td>
    </tr>`).join('') : '<tr><td colspan="8" class="text-center text-on-surface-variant">لا طلبات بعد.</td></tr>';
  $('#ordersTableBody').innerHTML = dbReadNotice(8) + rows;
  renderTrackingDiagnostic();
}

async function renderSuggestions() {
  const suggestions = (typeof DB !== 'undefined')
    ? await DB.getSuggestions()
    : readLocal('nova_suggestions', []);
  const rows = suggestions.length ? suggestions.map((suggestion) => `
    <tr>
      <td>${esc(suggestion.name)}</td>
      <td class="font-body-md">${esc(suggestion.text)}</td>
      <td class="font-code-sm">${new Date(suggestion.createdAt).toLocaleDateString('ar-EG')}</td>
      <td><button type="button" class="btn btn-ghost btn-size-sm" data-del-sug="${suggestion.id}">حذف</button></td>
    </tr>`).join('') : '<tr><td colspan="4" class="text-center text-on-surface-variant">لا اقتراحات بعد.</td></tr>';
  $('#suggestionsTableBody').innerHTML = dbReadNotice(4) + rows;
}

/* ── الإعدادات: ٤ بطاقات بلا JSON ── */
function loadSettingsForm() {
  const settings = adminState.settings;
  // ١) الهوية
  $('#setPlatformName').value = settings.platformName ?? '';
  $('#setPlatformNameEn').value = settings.platformNameEn ?? '';
  $('#setLogoLetter').value = settings.logoLetter ?? '';
  adminState.editingLogoImage = settings.logoImage ?? '';
  renderWalletAsset('#setLogoPreview', adminState.editingLogoImage, 'شعار');
  $('#setHeroTitle').value = settings.heroTitle ?? '';
  $('#setHeroSub').value = settings.heroSub ?? '';
  $('#setHeroBadge').value = settings.heroBadge ?? '';
  $('#setDevName').value = settings.devName ?? '';
  $('#setDevTitle').value = settings.devTitle ?? '';
  $('#setContactEmail').value = settings.contactEmail ?? '';
  $('#setContactGithub').value = settings.contactGithub ?? '';
  $('#setContactLinkedin').value = settings.contactLinkedin ?? '';
  if ($('#setContactWhatsapp')) $('#setContactWhatsapp').value = settings.contactWhatsapp ?? '';
  if ($('#setAdminEmail')) $('#setAdminEmail').value = settings.adminEmail ?? '';
  paintAuthState();
  $('#setThemeDefault').value = settings.theme?.default ?? 'dark';
  $('#setThemeAllowToggle').checked = settings.theme?.allowToggle ?? true;
  // ٢+٣) محررا الدفع والكوبونات
  renderCouponsEditor(settings.discounts ?? []);
  // ٤) التكاملات
  $('#setGithubRepo').value = settings.githubRepo ?? '';
  $('#setGithubBranch').value = settings.githubBranch ?? 'main';
  $('#setGithubToken').value = readLocal('nova_github_token', '');
  if ($('#setPurchasesEndpoint')) $('#setPurchasesEndpoint').value = settings.purchasesEndpoint ?? '';
  if ($('#setSupabaseUrl')) $('#setSupabaseUrl').value = settings.supabaseUrl ?? '';
  if ($('#setSupabaseKey')) $('#setSupabaseKey').value = settings.supabaseKey ?? '';
  // تهيئة طبقة البيانات + عرض الحالة الحالية
  if (typeof DB !== 'undefined') {
    const m = DB.init(adminState.settings);
    const badge = $('#supabaseStatus');
    if (badge) {
      badge.textContent = m === 'supabase'
        ? 'متصل بقاعدة البيانات — كل شيء يعمل أونلاين'
        : 'غير متصل — يعمل محلياً (JSON + متصفحك)';
      badge.style.color = m === 'supabase' ? 'var(--color-success)' : 'var(--color-on-surface-variant)';
    }
  }
}

function saveSettingsLocal() {
  adminState.settings.platformName = $('#setPlatformName').value.trim();
  adminState.settings.platformNameEn = $('#setPlatformNameEn').value.trim();
  adminState.settings.logoLetter = $('#setLogoLetter').value.trim();
  adminState.settings.logoImage = adminState.editingLogoImage || null;
  adminState.settings.heroTitle = $('#setHeroTitle').value.trim();
  adminState.settings.heroSub = $('#setHeroSub').value.trim();
  adminState.settings.heroBadge = $('#setHeroBadge').value.trim();
  adminState.settings.devName = $('#setDevName').value.trim();
  adminState.settings.devTitle = $('#setDevTitle').value.trim();
  adminState.settings.contactEmail = $('#setContactEmail').value.trim();
  adminState.settings.contactGithub = $('#setContactGithub').value.trim();
  adminState.settings.contactLinkedin = $('#setContactLinkedin').value.trim();
  if ($('#setContactWhatsapp')) adminState.settings.contactWhatsapp = $('#setContactWhatsapp').value.replace(/[^0-9]/g, '');
  if ($('#setAdminEmail')) adminState.settings.adminEmail = $('#setAdminEmail').value.trim();
  adminState.settings.theme = { default: $('#setThemeDefault').value, allowToggle: $('#setThemeAllowToggle').checked };
  adminState.settings.githubRepo = $('#setGithubRepo').value.trim();
  adminState.settings.githubBranch = $('#setGithubBranch').value.trim() || 'main';
  adminState.settings.discounts = readCouponsEditor();
  if ($('#setPurchasesEndpoint')) adminState.settings.purchasesEndpoint = $('#setPurchasesEndpoint').value.trim();
  if ($('#setSupabaseUrl')) adminState.settings.supabaseUrl = $('#setSupabaseUrl').value.trim();
  if ($('#setSupabaseKey')) adminState.settings.supabaseKey = $('#setSupabaseKey').value.trim();
  writeLocal('nova_github_token', $('#setGithubToken').value.trim());
  writeLocal('nova_settings_draft', adminState.settings);
  showToast('حُفظت الإعدادات محلياً — صدّرها أو ادفعها إلى GitHub.', 'success');
}

/* ── محرّر طرق الدفع المرئي (بديل JSON): يدوي / رابط / Stripe ── */
function renderPayMethodsEditor(methods) {
  const box = $('#setPayMethodsList');
  if (!box) return;
  box.innerHTML = '';
  Object.entries(methods ?? {}).forEach(([key, method]) => box.appendChild(payMethodCard(key, method)));
  if (!box.children.length) box.innerHTML = '<p class="font-body-sm text-on-surface-variant">لا طرق دفع بعد — أضف أول طريقة.</p>';
}

function payMethodCard(key, method = {}) {
  const type = method.type ?? 'manual';
  const card = document.createElement('div');
  card.className = 'pm-editor-card';
  card.innerHTML = `
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-space-sm">
      <div><label class="field-label">المعرّف</label><input class="input pm-key" dir="ltr" value="${esc(key)}"></div>
      <div><label class="field-label">التسمية</label><input class="input pm-label" value="${esc(method.label ?? '')}"></div>
      <div><label class="field-label">النوع</label>
        <select class="input pm-type">
          <option value="manual"${type === 'manual' ? ' selected' : ''}>يدوي (عنوان/حساب)</option>
          <option value="link"${type === 'link' ? ' selected' : ''}>رابط دفع</option>
          <option value="stripe"${type === 'stripe' ? ' selected' : ''}>Stripe</option>
        </select></div>
    </div>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-space-sm mt-space-sm pm-g-manual">
      <div><label class="field-label">العنوان</label><input class="input pm-address" dir="ltr" value="${esc(method.address ?? '')}"></div>
      <div><label class="field-label">الشبكة</label><input class="input pm-network" dir="ltr" value="${esc(method.network ?? '')}"></div>
      <div><label class="field-label">الأصل (Asset)</label><input class="input pm-asset" dir="ltr" value="${esc(method.asset ?? '')}"></div>
      <div><label class="field-label">البنك</label><input class="input pm-bank" value="${esc(method.bank ?? '')}"></div>
      <div><label class="field-label">اسم الحساب</label><input class="input pm-accountName" value="${esc(method.accountName ?? '')}"></div>
      <div><label class="field-label">IBAN</label><input class="input pm-iban" dir="ltr" value="${esc(method.iban ?? '')}"></div>
      <div><label class="field-label">SWIFT</label><input class="input pm-swift" dir="ltr" value="${esc(method.swift ?? '')}"></div>
      <div><label class="field-label">صورة QR (رابط)</label><input class="input pm-qr" dir="ltr" value="${esc(typeof method.qr === 'string' && !method.qr.startsWith('data:') ? method.qr : '')}"></div>
      <div class="col-span-full"><label class="field-label">ملاحظة</label><input class="input pm-note" value="${esc(method.note ?? '')}"></div>
    </div>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-space-sm mt-space-sm pm-g-link">
      <div class="col-span-full"><label class="field-label">رابط الدفع</label><input class="input pm-href" dir="ltr" value="${esc(method.href ?? '')}"></div>
      <div class="col-span-full"><label class="field-label">ملاحظة</label><input class="input pm-note" value="${esc(method.note ?? '')}"></div>
    </div>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-space-sm mt-space-sm pm-g-stripe">
      <div class="col-span-full"><label class="field-label">معرّف السعر (priceId)</label><input class="input pm-priceId" dir="ltr" value="${esc(method.priceId ?? '')}"></div>
      <div class="col-span-full"><label class="field-label">ملاحظة</label><input class="input pm-note" value="${esc(method.note ?? '')}"></div>
    </div>
    <button type="button" class="btn btn-ghost btn-size-sm mt-space-sm" data-pm-remove>حذف هذه الطريقة</button>`;
  syncPmCard(card);
  return card;
}

function syncPmCard(card) {
  const type = card.querySelector('.pm-type')?.value ?? 'manual';
  card.querySelector('.pm-g-manual').style.display = type === 'manual' ? '' : 'none';
  card.querySelector('.pm-g-link').style.display = type === 'link' ? '' : 'none';
  card.querySelector('.pm-g-stripe').style.display = type === 'stripe' ? '' : 'none';
}

function readPayMethodsEditor() {
  const out = {};
  document.querySelectorAll('#setPayMethodsList .pm-editor-card').forEach((card) => {
    const key = card.querySelector('.pm-key')?.value.trim();
    if (!key) return;
    const type = card.querySelector('.pm-type')?.value ?? 'manual';
    const val = (sel) => card.querySelector(sel)?.value.trim() ?? '';
    const method = { label: val('.pm-label') || key, type };
    if (type === 'manual') {
      ['address', 'network', 'asset', 'bank', 'accountName', 'iban', 'swift', 'qr'].forEach((f) => {
        const v = val(`.pm-g-manual .pm-${f}`);
        if (v) method[f] = v;
      });
      const note = val('.pm-g-manual .pm-note'); if (note) method.note = note;
    } else if (type === 'link') {
      const href = val('.pm-g-link .pm-href'); if (href) method.href = href;
      const note = val('.pm-g-link .pm-note'); if (note) method.note = note;
    } else if (type === 'stripe') {
      const priceId = val('.pm-g-stripe .pm-priceId'); if (priceId) method.priceId = priceId;
      const note = val('.pm-g-stripe .pm-note'); if (note) method.note = note;
    }
    out[key] = method;
  });
  return out;
}

/* ── محرّر الكوبونات المرئي (بديل JSON) ── */
function renderCouponsEditor(discounts) {
  const box = $('#setCouponsList');
  if (!box) return;
  box.innerHTML = '';
  (discounts ?? []).forEach((d) => box.appendChild(couponRow(d)));
  if (!box.children.length) box.innerHTML = '<p class="font-body-sm text-on-surface-variant">لا كوبونات بعد.</p>';
}

function couponRow(d = {}) {
  const row = document.createElement('div');
  row.className = 'cp-row';
  row.innerHTML = `
    <input class="input cp-code" dir="ltr" placeholder="الكود" value="${esc(d.code ?? '')}">
    <input class="input cp-label" placeholder="التسمية" value="${esc(d.label ?? '')}">
    <input class="input cp-amount" type="number" min="0" placeholder="المبلغ" value="${esc(d.amount ?? '')}">
    <select class="input cp-type">
      <option value="percent"${d.type !== 'fixed' ? ' selected' : ''}>نسبة %</option>
      <option value="fixed"${d.type === 'fixed' ? ' selected' : ''}>مبلغ ثابت</option>
    </select>
    <button type="button" class="btn btn-ghost btn-size-sm" data-cp-remove>حذف</button>`;
  return row;
}

function readCouponsEditor() {
  const out = [];
  document.querySelectorAll('#setCouponsList .cp-row').forEach((row) => {
    const code = row.querySelector('.cp-code')?.value.trim();
    if (!code) return;
    out.push({
      code,
      label: row.querySelector('.cp-label')?.value.trim() || 'خصم',
      amount: Number(row.querySelector('.cp-amount')?.value) || 0,
      type: row.querySelector('.cp-type')?.value === 'fixed' ? 'fixed' : 'percent',
    });
  });
  return out;
}

/* ── التصدير ── */
function exportJSON(filename, data) {
  downloadFile(filename, JSON.stringify(data, null, 2));
  showToast(`تم تنزيل ${filename}`, 'success');
}

/* ── مزامنة GitHub ── */
function syncLog(message) {
  const log = $('#syncLog');
  log.textContent += `\n${message}`;
  log.scrollTop = log.scrollHeight;
}

async function pushToGithub() {
  const token = readLocal('nova_github_token', '');
  const repo = $('#setGithubRepo').value.trim();
  const branch = $('#setGithubBranch').value.trim() || 'main';
  if (!token || !repo) { showToast('أدخل التوكن واسم المستودع في تبويب الإعدادات أولاً.', 'error'); return; }

  const files = [];
  if ($('#syncProducts').checked) files.push({ path: 'data/products.json', content: { products: sanitizeForPublish(adminState.products) } });
  if ($('#syncWallets')?.checked) files.push({ path: 'data/wallets.json', content: { wallets: adminState.wallets } });
  if ($('#syncSettings').checked) {
    const exportable = { ...adminState.settings };
    delete exportable.githubToken; // التوكن لا يُصدَّر أبداً
    files.push({ path: 'data/settings.json', content: exportable });
  }
  if (!files.length) { showToast('اختر ملفاً واحداً على الأقل.', 'error'); return; }

  for (const file of files) {
    try {
      syncLog(`[${file.path}] جلب SHA الحالي...`);
      const headResponse = await fetch(
        `https://api.github.com/repos/${repo}/contents/${file.path}?ref=${branch}`,
        { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } },
      );
      const headData = headResponse.ok ? await headResponse.json() : null;
      const sha = headData?.sha;
      syncLog(`[${file.path}] رفع المحتوى...`);
      const putResponse = await fetch(
        `https://api.github.com/repos/${repo}/contents/${file.path}`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: $('#commitMessage').value.trim() || `تحديث ${file.path} من لوحة الأدمن`,
            content: btoa(unescape(encodeURIComponent(JSON.stringify(file.content, null, 2)))),
            branch, ...(sha ? { sha } : {}),
          }),
        },
      );
      if (!putResponse.ok) throw new Error(`HTTP ${putResponse.status}`);
      syncLog(`[${file.path}] ✓ تم الرفع`);
    } catch (error) {
      syncLog(`[${file.path}] ✗ فشل: ${error.message}`);
      showToast(`فشل رفع ${file.path} — راجع السجل.`, 'error');
    }
  }
  syncLog('— انتهت المزامنة —');
}

/* ── المحافظ (wallets.json) — قواعد تحقق لكل شبكة كالمرجع ── */
const NETWORK_RULES = {
  TRC20: { test: (value) => /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(value), hint: 'عناوين TRC20 تبدأ بحرف T وطولها 34 محرفاً (Base58Check)' },
  ERC20: { test: (value) => /^0x[a-fA-F0-9]{40}$/.test(value), hint: 'عناوين EVM تبدأ بـ 0x وطولها 42 محرفاً' },
  BEP20: { test: (value) => /^0x[a-fA-F0-9]{40}$/.test(value), hint: 'عناوين EVM تبدأ بـ 0x وطولها 42 محرفاً' },
  BTC: { test: (value) => /^(bc1[a-z0-9]{25,59}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/.test(value), hint: 'عناوين BTC تبدأ بـ bc1 أو 1 أو 3' },
  SOL: { test: (value) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value), hint: 'عناوين Solana بطول 32–44 محرفاً' },
  IBAN: { test: (value) => value.replace(/\s/g, '').length >= 15, hint: 'رقم الحساب/IBAN بحد أدنى 15 خانة' },
  OTHER: { test: (value) => value.length >= 26, hint: 'طول مقبول: 26 محرفاً على الأقل' },
};

function validateWalletAddress(address, network) {
  const rule = NETWORK_RULES[network] ?? NETWORK_RULES.OTHER;
  return { ok: rule.test(String(address).trim()), hint: rule.hint };
}

function generateEndpointId(network) {
  const slugMap = { TRC20: 'trx', ERC20: 'eth', BEP20: 'bnb', BTC: 'btc', SOL: 'sol' };
  return `wlt_${slugMap[network] ?? 'wlt'}_${Math.random().toString(36).slice(2, 8)}`;
}

/** مُعرّف المحفظة: مشتقّ من النوع والشبكة/الدولة ليكون مقروءاً */
function generateWalletId(type, network, country) {
  if (type === 'local') return `wlt_local_${String(country ?? 'xx').toLowerCase()}_${Math.random().toString(36).slice(2, 7)}`;
  return generateEndpointId(network);
}

/** تعبئة قائمة الدول من settings.countries — يظهر منها ما يضيفه المالك */
function paintWalletCountries() {
  const sel = $('#wCountry');
  if (!sel) return;
  const map = adminState.settings?.countries ?? {};
  const keys = Object.keys(map);
  sel.innerHTML = keys.length
    ? keys.map((code) => `<option value="${esc(code)}">${esc(map[code])}</option>`).join('')
    : '<option value="OTHER">دولة أخرى</option>';
}

function shortAddress(address) {
  const value = String(address ?? '');
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
}

function setWalletBadge(state) {
  const badge = $('#wAddressBadge');
  const hint = $('#wAddressHint');
  if (!badge || !hint) return;
  if (state === 'empty') {
    badge.className = 'badge badge-neutral';
    badge.textContent = 'بانتظار الإدخال';
    hint.textContent = '';
    return;
  }
  badge.className = `badge ${state.ok ? 'badge-success' : 'badge-neutral'}`;
  badge.textContent = state.ok ? '✓ صيغة صحيحة ومعتمدة' : '⚠ عنوان غير مكتمل';
  hint.textContent = state.hint ?? '';
}

/* ── جدول المحافظ — نظام موحّد: رقمية (crypto) + محلية (local) ── */
function walletTypeBadge(wallet) {
  return wallet.type === 'local'
    ? '<span class="badge badge-local">محلية</span>'
    : '<span class="badge badge-indigo">رقمية</span>';
}

function walletDetailCell(wallet) {
  if (wallet.type === 'local') {
    const country = adminState.settings?.countries?.[wallet.country] ?? wallet.country ?? '';
    return `<span class="font-body-md">${esc(wallet.provider ?? '')}</span><br>
            <span class="font-code-sm text-on-surface-variant">${esc(country)}${wallet.currency ? ' · ' + esc(wallet.currency) : ''}</span>`;
  }
  return `<span class="font-body-md">${esc(wallet.currency ?? '')}</span><br>
          <span class="font-code-sm text-on-surface-variant">${esc(wallet.network ?? '')}</span>`;
}

function walletReceiveCell(wallet) {
  if (wallet.type === 'local') {
    const account = String(wallet.account ?? '').trim();
    const owner = String(wallet.accountName ?? '').trim();
    if (!account) return '<span class="text-error font-body-sm">لا رقم محفظة</span>';
    return `<span class="font-code-sm" dir="ltr">${esc(shortAddress(account))}</span><br>
            <span class="font-body-sm text-on-surface-variant">${esc(owner || '— بلا اسم صاحب حساب')}</span>`;
  }
  const address = String(wallet.address ?? '').trim();
  if (!address) return '<span class="text-error font-body-sm">لا عنوان</span>';
  return `<span class="font-code-sm" dir="ltr">${esc(shortAddress(address))}</span>`;
}

function renderWalletsTable() {
  const tbody = $('#walletsTableBody');
  tbody.innerHTML = adminState.wallets.length ? adminState.wallets.map((wallet) => `
    <tr>
      <td>${walletTypeBadge(wallet)}</td>
      <td class="font-body-md">${esc(wallet.label)}${wallet.isDefault ? ' <span class="badge badge-success">افتراضية</span>' : ''}
        <br><span class="font-code-sm text-on-surface-variant">${esc(wallet.endpointId ?? wallet.id)}</span></td>
      <td>${walletDetailCell(wallet)}</td>
      <td>${walletReceiveCell(wallet)}</td>
      <td><span class="badge ${wallet.enabled !== false ? 'badge-success' : 'badge-neutral'}">${wallet.enabled !== false ? 'مفعّلة' : 'متوقفة'}</span></td>
      <td class="flex gap-space-xs">
        <button type="button" class="btn btn-secondary btn-size-sm" data-wedit="${esc(wallet.id)}">تحرير</button>
        <button type="button" class="btn btn-ghost btn-size-sm" data-wdel="${esc(wallet.id)}">حذف</button>
      </td>
    </tr>`).join('') : '<tr><td colspan="6" class="text-center text-on-surface-variant">لا محافظ بعد — أضف أول محفظة.</td></tr>';
  $('#walletsCount').textContent = `${adminState.wallets.length} محفظة`;
  renderPaymentsAlert();
}

/* ── مبدّل نوع المحفظة: يُظهر حقول النوع المختار فقط ── */
let walletDraftType = 'crypto';
function paintWalletType(type) {
  walletDraftType = type;
  $$('#wTypeSeg .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.wtype === type));
  $$('.w-crypto').forEach((el) => { el.style.display = type === 'crypto' ? '' : 'none'; });
  $$('.w-local').forEach((el) => { el.style.display = type === 'local' ? '' : 'none'; });
  const hint = $('#wTypeHint');
  if (hint) {
    hint.textContent = type === 'local'
      ? 'محفظة محلية داخل بلد واحد (شام كاش+ · فودافون كاش …) — تظهر للمشتري بوسم الدولة كتعريف لا كفلتر.'
      : 'محفظة رقمية متاحة لكل الزوار (USDT · BTC) — يظهر بوسم الشبكة، وهي الأهم تحذيراً.';
  }
}

function openWalletModal(wallet) {
  adminState.editingWalletId = wallet ? wallet.id : null;
  $('#walletModalTitle').textContent = wallet ? `تحرير: ${wallet.label}` : 'محفظة جديدة';
  paintWalletCountries();
  const type = wallet?.type === 'local' ? 'local' : 'crypto';
  paintWalletType(type);

  $('#wLabel').value = wallet?.label ?? '';
  $('#wNetwork').value = wallet?.network ?? 'TRC20';
  $('#wCurrency').value = wallet?.currency ?? (type === 'local' ? '' : 'USDT');
  $('#wAddress').value = wallet?.address ?? '';
  $('#wCountry').value = wallet?.country ?? $('#wCountry').options[0]?.value ?? 'OTHER';
  $('#wProvider').value = wallet?.provider ?? '';
  $('#wAccount').value = wallet?.account ?? '';
  $('#wAccountName').value = wallet?.accountName ?? '';
  $('#wNote').value = wallet?.note ?? '';
  $('#wQr').value = wallet?.qr ?? '';
  $('#wEndpoint').value = wallet?.endpointId ?? generateWalletId(type, wallet?.network, wallet?.country);
  $('#wIsDefault').checked = wallet?.isDefault ?? false;
  $('#wEnabled').checked = wallet?.enabled ?? true;

  // الشعار وصورة QR المرفوعة (dataURL)
  adminState.editingWalletLogo = wallet?.logo ?? '';
  adminState.editingWalletQr = (wallet?.qr && String(wallet.qr).startsWith('data:')) ? wallet.qr : '';
  renderWalletAsset('#wLogoPreview', adminState.editingWalletLogo, 'شعار');
  renderWalletAsset('#wQrPreview', adminState.editingWalletQr, 'QR');

  const address = $('#wAddress').value.trim();
  setWalletBadge(address ? validateWalletAddress(address, $('#wNetwork').value) : 'empty');
  document.getElementById('walletModal').classList.add('active');
}

/* ── نموذج المحفظة → كائن موحّد ──
   الحقول غير المتعلّقة بالنوع لا تُكتب إطلاقاً (لا شبكة لمحفظة محلية،
   ولا حساب لمحفظة رقمية) — تطبيقاً لقاعدة «الفارغ لا يُرسم». */
function walletFormToObject() {
  const type = walletDraftType;
  const network = $('#wNetwork').value;
  const country = $('#wCountry').value;
  const existing = adminState.wallets.find((w) => w.id === adminState.editingWalletId);

  const base = {
    id: adminState.editingWalletId ?? generateWalletId(type, network, country),
    endpointId: $('#wEndpoint').value.trim() || generateWalletId(type, network, country),
    type,
    label: $('#wLabel').value.trim(),
    qr: adminState.editingWalletQr || $('#wQr').value.trim(),
    logo: adminState.editingWalletLogo || '',
    note: $('#wNote').value.trim(),
    isDefault: $('#wIsDefault').checked,
    enabled: $('#wEnabled').checked,
    stats: existing?.stats ?? { receivedCount: 0, receivedAmount: 0, lastTxid: '', createdAt: new Date().toISOString() },
  };

  if (type === 'local') {
    return {
      ...base,
      country,
      provider: $('#wProvider').value.trim(),
      currency: $('#wCurrency').value.trim(),
      account: $('#wAccount').value.trim(),
      accountName: $('#wAccountName').value.trim(),
    };
  }
  return {
    ...base,
    network,
    currency: $('#wCurrency').value.trim() || network,
    address: $('#wAddress').value.trim(),
  };
}

function initWalletsCRUD() {
  $('#addWalletBtn').addEventListener('click', () => openWalletModal(null));
  // مبدّل النوع — يُظهر حقول النوع المختار فقط، ويولّد معرّفاً مطابقاً
  $$('#wTypeSeg .seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      paintWalletType(btn.dataset.wtype);
      if (adminState.editingWalletId === null) {
        $('#wEndpoint').value = generateWalletId(walletDraftType, $('#wNetwork').value, $('#wCountry').value);
      }
      if (walletDraftType === 'crypto' && !$('#wCurrency').value.trim()) $('#wCurrency').value = 'USDT';
    });
  });
  $('#wNetwork').addEventListener('change', () => {
    if (adminState.editingWalletId === null) $('#wEndpoint').value = generateWalletId('crypto', $('#wNetwork').value);
  });
  $('#wCountry').addEventListener('change', () => {
    if (adminState.editingWalletId === null) $('#wEndpoint').value = generateWalletId('local', null, $('#wCountry').value);
  });
  $('#wAddress').addEventListener('input', () => {
    const value = $('#wAddress').value.trim();
    setWalletBadge(value ? validateWalletAddress(value, $('#wNetwork').value) : 'empty');
  });
  // رفع شعار المحفظة
  $('#wLogoDrop')?.addEventListener('click', () => $('#wLogoInput')?.click());
  $('#wLogoInput')?.addEventListener('change', (event) => {
    readSingleImage(event.target.files?.[0], (dataUrl) => {
      adminState.editingWalletLogo = dataUrl;
      renderWalletAsset('#wLogoPreview', dataUrl, 'شعار');
    });
    event.target.value = '';
  });
  // رفع صورة QR
  $('#wQrDrop')?.addEventListener('click', () => $('#wQrInput')?.click());
  $('#wQrInput')?.addEventListener('change', (event) => {
    readSingleImage(event.target.files?.[0], (dataUrl) => {
      adminState.editingWalletQr = dataUrl;
      renderWalletAsset('#wQrPreview', dataUrl, 'QR');
    });
    event.target.value = '';
  });
  // إزالة شعار أو QR (تفويض نقرة واحدة)
  $('#walletModal')?.addEventListener('click', (event) => {
    const removeBtn = event.target.closest('[data-wallet-asset-remove]');
    if (!removeBtn) return;
    const which = removeBtn.dataset.walletAssetRemove;
    if (which === '#wLogoPreview') { adminState.editingWalletLogo = ''; renderWalletAsset('#wLogoPreview', '', 'شعار'); }
    if (which === '#wQrPreview') { adminState.editingWalletQr = ''; renderWalletAsset('#wQrPreview', '', 'QR'); }
  });
  $('#saveWalletBtn').addEventListener('click', () => {
    const wallet = walletFormToObject();
    if (!wallet.label) { showToast('اكتب الاسم الظاهر للزائر.', 'error'); return; }
    if (wallet.type === 'local') {
      // المحلية بلا رقم حساب أو بلا اسم صاحب حساب = محفظة لا يمكن الدفع إليها
      if (!wallet.account || !wallet.accountName) {
        showToast('المحفظة المحلية تحتاج رقم المحفظة واسم صاحب الحساب — وإلا لا تُعرض للعميل إطلاقاً.', 'error');
        return;
      }
    } else {
      if (!wallet.address) { showToast('اكتب عنوان الاستقبال.', 'error'); return; }
      const check = validateWalletAddress(wallet.address, wallet.network);
      if (!check.ok) { showToast(`العنوان لا يطابق قواعد ${wallet.network}: ${check.hint}`, 'error'); return; }
    }
    if (wallet.isDefault) adminState.wallets.forEach((item) => { item.isDefault = false; });
    const index = adminState.wallets.findIndex((item) => item.id === wallet.id);
    if (index >= 0) adminState.wallets[index] = wallet;
    else adminState.wallets.push(wallet);
    persistWalletsDraft();
    renderWalletsTable();
    document.getElementById('walletModal').classList.remove('active');
    showToast('حُفظت المحفظة — تظهر الآن في صفحة الدفع. ادفعها إلى GitHub لتظهر للجميع.', 'success');
  });
  document.addEventListener('click', (event) => {
    const editBtn = event.target.closest('[data-wedit]');
    if (editBtn) {
      const wallet = adminState.wallets.find((item) => item.id === editBtn.dataset.wedit);
      if (wallet) openWalletModal(wallet);
      return;
    }
    const delBtn = event.target.closest('[data-wdel]');
    if (delBtn && confirm('إلغاء ربط وحذف هذه المحفظة نهائياً؟')) {
      adminState.wallets = adminState.wallets.filter((item) => item.id !== delBtn.dataset.wdel);
      persistWalletsDraft();
      renderWalletsTable();
      showToast('تم حذف المحفظة — اختفت من checkout العميل على هذا الجهاز.', 'success');
    }
  });
  document.getElementById('walletModal').addEventListener('click', (event) => {
    if (event.target.classList.contains('modal-overlay')) event.target.classList.remove('active');
  });
}

/* ── التبويبات ── */
function initTabs() {
  $$('.admin-tab').forEach((tab) => tab.addEventListener('click', () => {
    $$('.admin-tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    $$('.admin-panel').forEach((panel) => panel.classList.remove('active'));
    const panel = $(`#panel-${tab.dataset.tab}`);
    if (panel) panel.classList.add('active');
    refreshTabData(tab.dataset.tab);
  }));
}

/* ── تحديث بيانات التبويب عند فتحه:
   يضمن ظهور طلبات جديدة أرسلها المشترون أثناء فتح اللوحة،
   بدون حاجة إلى إعادة تحميل الصفحة. ── */
async function refreshTabData(tabName) {
  try {
    if (tabName === 'orders') {
      await renderOrders();
      await renderAdminStats();
    } else if (tabName === 'suggestions') {
      await renderSuggestions();
    } else if (tabName === 'wallets') {
      renderWalletsTable();
    } else if (tabName === 'products') {
      renderProductsTable();
      await renderAdminStats();
    }
  } catch (error) {
    console.warn('تعذّر تحديث بيانات التبويب:', error?.message ?? error);
  }
}

/* ── قراءة بيانات مع احتياط مضمّن ──
   فتح admin.html بالنقر المزدوج (file://) يمنع fetch لملفات JSON — والنسخة
   المضمّنة في <script id="nova-data"> تجعل اللوحة تعمل بلا خادم أيضاً.
   (نفس المنطق في app.js — والمصدر يبقى data/*.json، والنسخة تُولَّد بـ
   tools/embed-data.py.) */
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

function loadDataFile(path, fallbackValue) {
  return fetch(`${path}?v=${Date.now()}`)
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .catch(() => readEmbeddedData(path) ?? fallbackValue);
}

/* ── التهيئة ── */
async function init() {
  const [productsData, settingsData, walletsData] = await Promise.all([
    loadDataFile('data/products.json', { products: [] }),
    loadDataFile('data/settings.json', {}),
    loadDataFile('data/wallets.json', { wallets: [] }),
  ]);
  const draft = readLocal('nova_settings_draft', null);
  adminState.products = productsData.products ?? [];
  // المسودة المحلية تتجاوز الملف — لكن مفاتيح قاعدة البيانات تُؤخذ من settings.json دائماً،
  // لأن المسودة قد تكون قديمة (حُفظت قبل إضافة المفاتيح) فتفقد اللوحة الاتصال.
  const merged = draft ? { ...settingsData, ...draft } : settingsData;
  if (!merged.supabaseUrl) merged.supabaseUrl = settingsData.supabaseUrl ?? '';
  if (!merged.supabaseKey) merged.supabaseKey = settingsData.supabaseKey ?? '';
  adminState.settings = merged;
  adminState.wallets = walletsData.wallets ?? [];
  // تهيئة طبقة البيانات مبكراً: بوابة الدخول تعتمد عليها لمعرفة إن كانت
  // مصادقة Supabase مُفعّلة (adminEmail مضبوط) أم لا.
  if (typeof DB !== 'undefined') DB.init(adminState.settings);
  // مسودات سابقة على نفس الجهاز (حفظ سابق من اللوحة) تتجاوز ملفات data/*.json —
  // وإلا ضاع ما أضفته بعد تحديث الصفحة، لأن data/*.json لا تتغير إلا بالتصدير/المزامنة.
  const productsDraft = readLocal('nova_products_draft', null);
  if (Array.isArray(productsDraft?.products)) adminState.products = productsDraft.products;
  const walletsDraft = readLocal('nova_wallets_draft', null);
  if (Array.isArray(walletsDraft?.wallets)) adminState.wallets = walletsDraft.wallets;

  // ── القاعدة هي المصدر عند الاتصال ──
  //  سبب إضافتها: مفاتيح الترخيص لم تعد موجودة في data/products.json (حمايةً
  //  لها من التسريب العلني)، فهي تعيش في جدول products وحده. ولو بقي الأدمن
  //  يقرأ من الملف المحلي، لظهر مخزون الترخيص فارغاً — ثم يمحوه الحفظ التالي.
  if (typeof DB !== 'undefined' && DB.isOnline()) {
    try {
      const onlineProducts = await DB.getProducts(null, { withSecrets: true });
      if (Array.isArray(onlineProducts) && onlineProducts.length) {
        adminState.products = onlineProducts;
      }
    } catch (error) {
      console.warn('تعذّر جلب المنتجات من القاعدة — نُكمل بالبيانات المحلية:', error?.message);
    }
  }

  await initGate();
  if (sessionStorage.getItem('nova_admin_session') === '1') {
    // جلسة هذا التبويب قائمة. نحدّد الوضع من وجود جلسة Supabase فعلاً لا من التخمين.
    let viaSupabase = false;
    if (typeof DB !== 'undefined' && typeof DB.authReady === 'function' && DB.authReady()) {
      try { viaSupabase = Boolean(await DB.getSession()); } catch { viaSupabase = false; }
    }
    enterAdmin({ auth: viaSupabase });
  } else if (typeof DB !== 'undefined' && typeof DB.authReady === 'function' && DB.authReady()) {
    // جلسة Supabase محفوظة من زيارة سابقة — لا نُطالب بالدخول من جديد
    const session = await DB.getSession();
    if (session) enterAdmin({ auth: true });
  }
  $('#lockBtn').addEventListener('click', lockAdmin);

  initTabs();
  initProductCRUD();
  initWalletsCRUD();
  loadSettingsForm();
  renderProductsTable();
  renderWalletsTable();
  await renderOrders();
  await renderSuggestions();
  await renderAdminStats();
  $('#importProductsBtn')?.addEventListener('click', () => $('#importProductsInput')?.click());
  $('#importProductsInput')?.addEventListener('change', (event) => importJSONFile(event.target, 'products'));
  $('#importWalletsBtn')?.addEventListener('click', () => $('#importWalletsInput')?.click());
  $('#importWalletsInput')?.addEventListener('change', (event) => importJSONFile(event.target, 'wallets'));
  // ── قاعدة البيانات الأونلاين (Supabase) ──
  $('#testSupabaseBtn')?.addEventListener('click', async () => {
    if (typeof DB === 'undefined') return;
    DB.init(adminState.settings);
    const res = await DB.testConnection();
    showToast(res.ok ? 'الاتصال بقاعدة البيانات ناجح.' : `فشل الاتصال: ${res.reason}`,
      res.ok ? 'success' : 'error');
  });
  $('#migrateSupabaseBtn')?.addEventListener('click', async () => {
    if (typeof DB === 'undefined') return;
    DB.init(adminState.settings);
    if (!DB.isOnline()) { showToast('ضع رابط المشروع والمفتاح أولاً ثم احفظ الإعدادات.', 'error'); return; }
    if (!confirm('سيتم رفع كل المنتجات الحالية إلى قاعدة البيانات. متابعة؟')) return;
    const res = await DB.migrateProducts(adminState.products);
    showToast(res.ok ? `تم رفع ${res.count} منتجاً بنجاح.` : `فشل الرفع: ${res.reason}`,
      res.ok ? 'success' : 'error');
  });

  // ── محررا الإعدادات: إضافة/حذف + تبديل النوع + رفع الشعار ──
  $('#addPayMethodBtn')?.addEventListener('click', () => {
    const box = $('#setPayMethodsList');
    if (!box) return;
    box.querySelector('p')?.remove();
    box.appendChild(payMethodCard(`method_${Date.now().toString(36)}`, { type: 'manual', label: '' }));
  });
  $('#setPayMethodsList')?.addEventListener('click', (event) => {
    const removeBtn = event.target.closest('[data-pm-remove]');
    if (removeBtn) removeBtn.closest('.pm-editor-card')?.remove();
  });
  $('#setPayMethodsList')?.addEventListener('change', (event) => {
    const typeSelect = event.target.closest('.pm-type');
    if (typeSelect) syncPmCard(typeSelect.closest('.pm-editor-card'));
  });
  $('#addCouponBtn')?.addEventListener('click', () => {
    const box = $('#setCouponsList');
    if (!box) return;
    box.querySelector('p')?.remove();
    box.appendChild(couponRow({}));
  });
  $('#setCouponsList')?.addEventListener('click', (event) => {
    const removeBtn = event.target.closest('[data-cp-remove]');
    if (removeBtn) removeBtn.closest('.cp-row')?.remove();
  });
  $('#setAdminEmail')?.addEventListener('input', paintAuthState);
  // سرّ التأكيد: يُحفظ في هذا المتصفح فقط — لا يُنشر في أي ملف عام
  $('#saveSecretBtn')?.addEventListener('click', () => {
    const value = ($('#setConfirmSecret')?.value ?? '').trim();
    if (value.length < 16) {
      showToast('السرّ قصير — انسخه كما هو من supabase-admin-confirm.sql.', 'error');
      return;
    }
    writeLocal(CONFIRM_SECRET_KEY, value);
    paintAuthState();
    paintModeBanner();
    renderTrackingDiagnostic();
    showToast('حُفظ السرّ في هذا المتصفح — التأكيد يعمل الآن بلا حساب.', 'success');
  });
  $('#clearSecretBtn')?.addEventListener('click', () => {
    localStorage.removeItem(CONFIRM_SECRET_KEY);
    const field = $('#setConfirmSecret');
    if (field) field.value = '';
    paintAuthState();
    paintModeBanner();
    renderTrackingDiagnostic();
    showToast('مُحي السرّ — التأكيد سيحتاج تسجيل دخول Supabase.', 'success');
  });
  $('#setLogoDrop')?.addEventListener('click', () => $('#setLogoInput')?.click());
  $('#setLogoInput')?.addEventListener('change', (event) => {
    readSingleImage(event.target.files?.[0], (dataUrl) => {
      adminState.editingLogoImage = dataUrl;
      renderWalletAsset('#setLogoPreview', dataUrl, 'شعار');
    });
    event.target.value = '';
  });
  $('#setLogoPreview')?.addEventListener('click', (event) => {
    if (event.target.closest('[data-wallet-asset-remove]')) {
      adminState.editingLogoImage = '';
      renderWalletAsset('#setLogoPreview', '', 'شعار');
    }
  });
  $('#saveSettingsBtn').addEventListener('click', saveSettingsLocal);
  $('#exportProductsBtn').addEventListener('click', () => exportJSON('products.json', { products: sanitizeForPublish(adminState.products) }));
  $('#exportWalletsBtn').addEventListener('click', () => exportJSON('wallets.json', { wallets: adminState.wallets }));
  $('#exportSettingsBtn').addEventListener('click', () => {
    const exportable = { ...adminState.settings };
    delete exportable.githubToken;
    exportJSON('settings.json', exportable);
  });
  $('#exportSuggestionsBtn').addEventListener('click', async () => {
    const suggestions = (typeof DB !== 'undefined')
      ? await DB.getSuggestions()
      : readLocal('nova_suggestions', []);
    exportJSON('suggestions.json', { suggestions });
  });
  $('#ordersRefreshBtn')?.addEventListener('click', () => { renderOrders(); renderTrackingDiagnostic(); });
  // مودال الرفض: تأكيد السبب · إغلاق · إلغاء بمفتاح Escape
  $('#rejectSubmitBtn')?.addEventListener('click', submitReject);
  $('#rejectCancelBtn')?.addEventListener('click', closeRejectModal);
  $('#rejectReasonInput')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); submitReject(); }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && $('#rejectModal')?.classList.contains('active')) closeRejectModal();
  });
  $('#pushBtn').addEventListener('click', pushToGithub);
  document.addEventListener('click', async (event) => {
    const approveBtn = event.target.closest('[data-approve]');
    if (approveBtn) {
      const orders = (typeof DB !== 'undefined')
        ? await DB.getOrders()
        : readLocal('nova_purchases', []);
      const order = orders.find((o) => o.reference === approveBtn.dataset.approve);
      if (order) {
        // إغلاق دورة البيع: سحب أول مفتاح غير مستخدم من مخزون المنتج وتعيينه للطلب
        const product = adminState.products.find((p) => p.id === order.productId);
        let assignedKey = '';
        if (product?.licenseMode === 'key') {
          const used = product.usedKeys ?? [];
          const available = (product.licenseKeys ?? []).filter((key) => !used.includes(key));
          if (available.length) {
            assignedKey = available[0];
            product.usedKeys = [...used, assignedKey];
            renderProductsTable();
          } else {
            showToast('لا مفاتيح متبقية لهذا المنتج — أضف مفاتيحاً من تبويب المنتجات.', 'error');
          }
        }
        /* ⚠️ أخطر حالة في اللوحة: أن ينجح التأكيد محلياً ويفشل في القاعدة.
           عندها يرى الأدمن رسالة نجاح، والمشتري لا يرى شيئاً أبداً — وهذا
           بالضبط سبب شكوى «عند الموافقة لا يظهر للمستخدم». لذلك نفحص نتيجة
           الكتابة ونقول الحقيقة بدل رسالة نجاح كاذبة. */
        let confirmRes = { ok: true, online: false, reason: 'offline' };
        if (typeof DB !== 'undefined') {
          /* رابط التسليم يُرسَل مع التأكيد فيُكتب على **الطلب** لا على الكتالوج.
             السبب: الكتالوج (data/products.json) ملف منشور علناً — ووضع رابط
             منتج مدفوع فيه يعني أن أي زائر يقرأه ويحمّل بلا دفع. */
          const deliveryUrl = String(product?.delivery?.url ?? '').trim();
          const deliveryNote = String(product?.delivery?.note ?? '').trim();
          confirmRes = await DB.confirmOrder(order.reference, assignedKey, {
            secret: getConfirmSecret(), deliveryUrl, deliveryNote,
          });
        } else {
          order.status = 'confirmed';
          order.licenseKey = assignedKey;
          order.confirmedAt = new Date().toISOString();
          writeLocal('nova_purchases', orders);
        }
        // شبكة أمان للمخزون: الدالة الجديدة تحفظ usedKeys في القاعدة نفسها،
        // وهذه المزامنة (أفضل جهد) تغطي من لم يحدّث ملف SQL بعد — ولا تضر لو حفظت مرتين.
        if (assignedKey && product && typeof DB !== 'undefined' && DB.isOnline()) {
          DB.saveProduct({ id: product.id, usedKeys: product.usedKeys ?? [assignedKey] });
        }
        renderOrders();
        renderAdminStats();
        if (confirmRes.online) {
          const noDelivery = !String(product?.delivery?.url ?? '').trim()
            && !String(product?.delivery?.inviteUrl ?? '').trim()
            && (product?.delivery?.mode ?? 'file') !== 'key'
            && (product?.delivery?.mode ?? 'file') !== 'install';
          showToast(assignedKey
            ? `تم التأكيد وتعيين المفتاح ${assignedKey} — سيراه المشتري فوراً.`
            : 'تم تأكيد الطلب — سيراه المشتري فوراً.', 'success');
          if (noDelivery) {
            showToast('تنبيه: لا رابط تسليم لهذا المنتج — المشتري سيرى التأكيد بلا ملف. اضبط «طريقة التسليم» في المنتج.', 'error');
          } else if (!confirmRes.deliveryStored) {
            showToast('التأكيد نجح، لكن رابط التسليم لم يُحفظ على الطلب — شغّل supabase-final.sql لتفعيل ذلك.', 'error');
          }
        } else {
          /* خريطة أسباب واضحة بدل شلال شروط ثلاثي — أسهل قراءةً وأصعب خطأً */
          const FAIL_REASONS = {
            'bad-secret': 'السرّ غير صحيح — انسخه من supabase-admin-confirm.sql كما هو.',
            'rpc-missing': 'دالة admin_confirm_order غير مُنشأة — شغّل supabase-admin-confirm.sql من محرّر SQL.',
            'no-such-order': 'لا يوجد طلب بهذا المرجع في القاعدة (قد يكون محفوظاً في متصفح المشتري فقط).',
            'license-key-required': 'هذا المنتج يُسلّم بمفتاح ولا يوجد مفتاح للتعيين — أضف مفاتيحاً من تبويب المنتجات.',
            'license-key-invalid': 'رُفض التأكيد: المفتاح المحدّد ليس في مخزون المنتج أصلاً — راجع مفاتيح الترخيص.',
            'license-key-used': 'رُفض التأكيد: هذا المفتاح استُهلك في طلب سابق — القاعدة تمنع بيع المفتاح مرتين.',
            'needs-auth': 'أنت غير مسجَّل بحساب Supabase — القاعدة تسمح بالتأكيد للموثّقين فقط. اضبط «بريد الأدمن» ثم أنشئ المستخدم في Supabase → Authentication.',
            'rls': 'سياسات القاعدة ترفض التحديث رغم أنك موثّق — راجع supabase-security-fix.sql.',
            'offline': 'لا اتصال بالقاعدة.',
            'network': 'تعذّر الوصول إلى القاعدة (شبكة).',
          };
          const why = FAIL_REASONS[confirmRes.reason] ?? 'تعذّرت الكتابة في القاعدة.';
          showToast('حُفظ التأكيد في هذا المتصفح فقط — المشتري لن يراه. السبب: ' + why, 'error');
        }
      }
    }
    const rejectBtn = event.target.closest('[data-reject]');
    if (rejectBtn) {
      openRejectModal(rejectBtn.dataset.reject);
      return;
    }
    const delSugBtn = event.target.closest('[data-del-sug]');
    if (delSugBtn) {
      const sugId = Number(delSugBtn.dataset.delSug);
      if (typeof DB !== 'undefined') DB.deleteSuggestion(sugId);
      writeLocal('nova_suggestions', readLocal('nova_suggestions', []).filter((s) => s.id !== sugId));
      renderSuggestions();
    }
    const copyKeyBtn = event.target.closest('[data-copy-key]');
    if (copyKeyBtn) {
      navigator.clipboard.writeText(copyKeyBtn.dataset.copyKey)
        .then(() => showToast('نُسخ المفتاح.', 'success'))
        .catch(() => showToast('تعذّر النسخ.', 'error'));
    }
  });
}

/* ── تفعيل Service Worker (العمل دون اتصال) ── */
function registerServiceWorkerAdmin() {
  if (!('serviceWorker' in navigator)) return;
  const host = location.hostname;
  const secure = location.protocol === 'https:' || host === 'localhost' || host === '127.0.0.1';
  if (!secure) return;
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

registerServiceWorkerAdmin();

/* التهيئة تُستدعى هنا بعد تعريف كل الدوال أعلاه */
init();
