/* ==========================================================================
   صفحة طلباتي — orders.js
   ─────────────────────────────────────────────────────────────────────────
   مسؤوليتان:
   1) سرد طلبات هذا الجهاز (من nova_purchases) مع فلترة بالحالة
      (الكل · قيد المراجعة · مؤكَّدة · مرفوضة) — «الفارغ لا يُرسم».
   2) تتبّع طلب بالمرجع عبر حقل OTP المتحوّل (مثل index.html) — يقرأ الحالة
      من القاعدة (get_order_by_reference) أو من الإيصال المحلي، مع الاستقصاء
      الدوري الذي يتوقف عند التأكيد ويسقط بعد ~13 دقيقة.

   ملاحظة: كان هذا الملف مفقوداً (orders.html يشير إليه ولا وجود له) —
   فصفحة «طلباتي» لم تكن تعمل إطلاقاً. أُنشئ لسد هذه الثغرة.
   ========================================================================== */
'use strict';

const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

/** تهريب HTML لمنع XSS */
function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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

/* ── تخزين محلي ── */
function readLocal(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

/* ── قراءة البيانات المضمّنة (لا يُستخدم الآن لكنه يبقي الباب مفتوحاً) ── */
function readEmbeddedData(path) {
  const node = document.getElementById('nova-data');
  if (!node) return null;
  try {
    const all = JSON.parse(node.textContent || '{}');
    const key = String(path).replace(/^\.?\/*data\//, '').replace(/\.json$/, '');
    return all[key] ?? null;
  } catch {
    return null;
  }
}

async function loadJSON(path, fallbackValue) {
  try {
    const response = await fetch(`${path}?v=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    const embedded = readEmbeddedData(path);
    if (embedded) return embedded;
    console.warn(`تعذّر تحميل ${path}:`, error.message);
    return fallbackValue;
  }
}

const state = {
  orders: [],
  products: [],
  wallets: [],
  settings: {},
  filter: 'all',
};

/* ── إخفاء/إظهار أزرار الفلترة حسب ما يوجد فعلاً ── */
function visibleFilters() {
  const counts = { all: state.orders.length, pending: 0, confirmed: 0, rejected: 0 };
  state.orders.forEach((o) => { if (counts[o.status] !== undefined) counts[o.status] += 1; });
  return counts;
}

/* ── بطاقة طلب واحدة — الفارغ لا يُرسم ── */
function orderCard(order) {
  const confirmed = order.status === 'confirmed';
  const rejected = order.status === 'rejected';
  const badge = confirmed ? 'badge-success' : (rejected ? 'badge-rejected' : 'badge-indigo');
  const label = confirmed ? 'مؤكَّد ✓' : (rejected ? 'مرفوض ✕' : 'قيد المراجعة');
  const date = order.createdAt ? new Date(order.createdAt).toLocaleString('ar') : '';
  const price = order.total != null ? `${order.currency ?? 'USD'} ${order.total}` : '';

  let body = '';
  if (rejected) {
    body = `<div class="reject-box">
      <b>رُفض هذا الطلب.</b>
      ${order.rejectReason ? `<p class="font-body-sm mt-space-xs" style="line-height:1.8"><span class="text-on-surface-variant">سبب الرفض:</span><br>${esc(order.rejectReason)}</p>` : ''}
    </div>`;
  } else if (confirmed) {
    if (order.licenseKey) {
      body += `<div class="license-key-box mb-space-sm">
        <span class="font-body-sm text-on-surface-variant">مفتاح الترخيص</span>
        <code class="key" dir="ltr">${esc(order.licenseKey)}</code>
        <button type="button" class="btn btn-secondary btn-size-sm" data-copy-key="${esc(order.licenseKey)}">نسخ</button>
      </div>`;
    }
    const orderUrl = String(order.deliveryUrl ?? '').trim();
    const product = state.products.find((p) => p.id === order.productId);
    const catalogUrl = product ? String(product.delivery?.url ?? '') : '';
    const target = orderUrl || catalogUrl;
    body += target
      ? `<a class="btn btn-primary btn-size-md" href="${esc(target)}" target="_blank" rel="noopener">
           <span class="material-symbols-outlined" style="font-size:16px">download</span>افتح التسليم</a>`
      : '<p class="font-body-sm text-on-surface-variant">طلبك مؤكَّد، والتسليم قيد التجهيز — تواصل معنا وسنرسله فوراً.</p>';
    if (order.deliveryNote) body += `<p class="font-body-sm text-on-surface-variant mt-space-sm">${esc(order.deliveryNote)}</p>`;
  } else {
    body = '<p class="font-body-sm text-on-surface-variant">بانتظار تأكيد الأدمن للدفع.</p>';
  }

  return `
    <article class="card p-space-md flex flex-col gap-space-xs">
      <div class="flex items-center justify-between flex-wrap gap-space-sm">
        <span class="font-body-md">${esc(order.productName ?? 'طلب')} · <code class="font-code-sm" dir="ltr">${esc(order.reference ?? '')}</code></span>
        <span class="badge ${badge}">${label}</span>
      </div>
      <div class="flex flex-wrap items-center gap-space-md font-body-sm text-on-surface-variant">
        ${date ? `<span>${esc(date)}</span>` : ''}
        ${price ? `<span class="font-num" dir="ltr">${esc(price)}</span>` : ''}
        ${order.methodLabel ? `<span>${esc(order.methodLabel)}</span>` : ''}
      </div>
      ${body}
    </article>`;
}

function renderOrders() {
  const wrap = $('#myOrders');
  if (!wrap) return;
  const filtered = state.orders.filter((o) => {
    if (state.filter === 'all') return true;
    return o.status === state.filter;
  });
  if (!filtered.length) {
    wrap.innerHTML = '<p class="font-body-sm text-on-surface-variant">لا توجد طلبات هنا بعد.</p>';
  } else {
    wrap.innerHTML = filtered.map(orderCard).join('');
  }
  $$('#myOrders [data-copy-key]').forEach((btn) => {
    btn.addEventListener('click', () => {
      navigator.clipboard.writeText(btn.dataset.copyKey)
        .then(() => showToast('نُسخ المفتاح.', 'success'))
        .catch(() => showToast('تعذّر النسخ.', 'error'));
    });
  });
  renderFilterCounts();
}

function renderFilterCounts() {
  const counts = visibleFilters();
  $$('#statusFilter .filter-btn').forEach((btn) => {
    const key = btn.dataset.sfilter;
    const count = counts[key] ?? 0;
    const span = btn.querySelector('.font-num');
    if (span) span.textContent = String(count);
    else btn.insertAdjacentHTML('beforeend', ` <span class="font-num">${count}</span>`);
  });
}

function initOrderList() {
  const filterBar = $('#statusFilter');
  if (filterBar) {
    filterBar.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-sfilter]');
      if (!btn) return;
      $$('#statusFilter .filter-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.filter = btn.dataset.sfilter;
      renderOrders();
    });
  }
  state.orders = readLocal('nova_purchases', []);
  renderOrders();
}

/* ── تتبّع الطلب: حقل OTP + نتيجة ── */
function initOrderTracking() {
  const trackButton = $('#trackBtn');
  const wrap = $('#trackOtp');
  const result = $('#trackResult');
  if (!trackButton || !wrap || !result) return;

  const LEN = Number(wrap.dataset.len) || 6;
  const SP = 31;
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
  layoutRow();
  paintBoxes();
  input.addEventListener('focus', () => wrap.classList.add('focused'));
  input.addEventListener('blur', () => wrap.classList.remove('focused'));
  input.addEventListener('input', () => {
    paintBoxes();
    if (input.value.length >= LEN) lookup();
  });
  wrap.addEventListener('click', () => input.focus());

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

  function sourceNote(source, reason) {
    if (source !== 'local') return '';
    const why = reason === 'rpc-missing'
      ? ' — دالة المتابعة الآمنة غير مُعرَّفة في القاعدة بعد'
      : (reason === 'offline' ? ' — لا اتصال بالقاعدة الآن' : '');
    return `
      <div class="flex items-start gap-space-sm font-body-sm" style="background:var(--color-surface-container-low);border:1px dashed var(--color-outline-variant);border-radius:var(--radius-default);padding:var(--space-sm) var(--space-md)">
        <span class="material-symbols-outlined text-primary" style="font-size:16px;flex-shrink:0">cloud_off</span>
        <span>هذه الحالة من <b>إيصالك المحفوظ في هذا المتصفح</b>${esc(why)}.</span>
      </div>`;
  }

  function deliveryActions(order, confirmed) {
    if (order.status === 'rejected') {
      const why = String(order.rejectReason ?? '').trim();
      return `<div class="reject-box">
        <div class="flex items-start gap-space-sm">
          <span class="material-symbols-outlined" style="font-size:20px;color:var(--color-error);flex-shrink:0">cancel</span>
          <div style="min-width:0">
            <b>تم رفض هذا الطلب.</b>
            ${why ? `<p class="font-body-sm mt-space-xs" style="line-height:1.8">${esc(why)}</p>` : '<p class="font-body-sm mt-space-xs text-on-surface-variant">لم يُذكر سبب.</p>'}
          </div>
        </div>
      </div>`;
    }
    if (!confirmed) {
      return '<p class="font-body-sm text-on-surface-variant">بانتظار تأكيد الأدمن للدفع. الحالة تُفحَص تلقائياً كل ٢٠ ثانية.</p>';
    }
    const key = order.licenseKey
      ? `<div class="license-key-box mb-space-sm">
           <span class="font-body-sm text-on-surface-variant">مفتاح الترخيص</span>
           <code class="key" dir="ltr">${esc(order.licenseKey)}</code>
           <button type="button" class="btn btn-secondary btn-size-sm" data-copy-key="${esc(order.licenseKey)}">نسخ</button>
         </div>`
      : '';
    const orderUrl = String(order.deliveryUrl ?? '').trim();
    const product = state.products.find((p) => p.id === order.productId);
    const catalogUrl = product ? String(product.delivery?.url ?? '') : '';
    const target = orderUrl || catalogUrl;
    const action = target
      ? `<a class="btn btn-primary btn-size-md btn-block" href="${esc(target)}" target="_blank" rel="noopener">
           <span class="material-symbols-outlined" style="font-size:16px">download</span>افتح التسليم</a>`
      : (key
          ? '<p class="font-body-sm text-on-surface-variant">المفتاح جاهز أعلاه. ورابط التسليم سيظهر هنا فور إعداده.</p>'
          : '<p class="font-body-sm text-on-surface-variant">طلبك مؤكَّد، لكن التسليم قيد التجهيز.</p>');
    return key + action;
  }

  let pollId = null;
  let lastStatus = null;

  function renderResult(order, source, reason, reference) {
    const confirmed = order.status === 'confirmed';
    result.innerHTML = `
      <div class="card p-space-md flex flex-col gap-space-sm">
        <div class="flex items-center justify-between flex-wrap gap-space-sm">
          <span class="font-body-md">${esc(order.productName ?? 'طلب')} · <code class="font-code-sm" dir="ltr">${esc(reference)}</code></span>
          <span class="badge ${confirmed ? 'badge-success' : (order.status === 'rejected' ? 'badge-rejected' : 'badge-indigo')}">${confirmed ? 'مؤكَّد ✓' : (order.status === 'rejected' ? 'مرفوض ✕' : 'قيد المراجعة')}</span>
        </div>
        ${sourceNote(source, reason)}
        ${order.status === 'rejected' ? '' : trackTimeline(confirmed)}
        <div class="reveal-box${confirmed ? ' open' : ''}">${deliveryActions(order, confirmed)}</div>
      </div>`;
    result.querySelector('[data-copy-key]')?.addEventListener('click', (event) => {
      navigator.clipboard.writeText(event.currentTarget.dataset.copyKey)
        .then(() => showToast('نُسخ المفتاح.', 'success'))
        .catch(() => showToast('تعذّر النسخ.', 'error'));
    });
    lastStatus = order.status;
    startPolling(reference, confirmed);
  }

  const POLL_MS = 20000;
  const POLL_MAX = 40;
  let pollCount = 0;
  let pollRef = null;
  function startPolling(reference, confirmed) {
    stopPolling();
    if (confirmed) return;
    if (pollRef !== reference) { pollCount = 0; pollRef = reference; }
    pollId = setInterval(() => {
      pollCount += 1;
      if (pollCount > POLL_MAX) { stopPolling(); return; }
      lookup({ silent: true, reference });
    }, POLL_MS);
  }
  function stopPolling() {
    if (pollId) { clearInterval(pollId); pollId = null; }
  }
  window.addEventListener('beforeunload', stopPolling);

  const MAX_FAILED_LOOKUPS = 10;
  let failedLookups = 0;
  let trackingLocked = false;

  async function lookup(opts = {}) {
    if (trackingLocked) return;
    const reference = (opts.reference ?? input.value).trim().toUpperCase();
    if (!reference) { result.innerHTML = ''; return; }
    if (!opts.silent) result.innerHTML = '';

    let payload;
    if (typeof DB !== 'undefined') {
      payload = await DB.getOrder(reference);
    } else {
      const local = readLocal('nova_purchases', []).find((o) => o.reference === reference);
      payload = { order: local ?? null, source: local ? 'local' : null, reason: 'offline' };
    }
    const { order, source, reason } = payload ?? {};

    if (!order) {
      stopPolling();
      if (opts.silent) return;
      failedLookups += 1;
      if (failedLookups >= MAX_FAILED_LOOKUPS) {
        trackingLocked = true;
        result.innerHTML = `<div class="card p-space-md font-body-sm text-on-surface-variant">
          <b>تم إيقاف البحث مؤقتاً</b> — كثرت المحاولات بلا مرجع صحيح. أعد تحميل الصفحة للمتابعة.</div>`;
        return;
      }
      setTimeout(() => { input.value = ''; paintBoxes(); input.focus(); }, 300);
      result.innerHTML = `<div class="card p-space-md font-body-sm text-on-surface-variant">
        لا يوجد طلب بالمرجع <code class="font-code-sm" dir="ltr">${esc(reference)}</code>.</div>`;
      return;
    }
    failedLookups = 0;
    if (opts.silent && lastStatus && order.status !== lastStatus) {
      if (order.status === 'confirmed') showToast('تم تأكيد دفعتك — المفتاح ظاهر الآن.', 'success');
      else if (order.status === 'rejected') showToast('انتهت مراجعة طلبك بالرفض.', 'error');
    }
    writeLocal('nova_last_ref', reference);
    renderResult(order, source, reason, reference);
  }

  trackButton.addEventListener('click', () => lookup());
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') lookup();
  });
  const savedRef = readLocal('nova_last_ref', '');
  if (savedRef && !input.value) { input.value = savedRef; paintBoxes(); }
}

/* ── التهيئة ── */
async function init() {
  const [settingsData, productsData, walletsData] = await Promise.all([
    loadJSON('data/settings.json', {}),
    loadJSON('data/products.json', { products: [] }),
    loadJSON('data/wallets.json', { wallets: [] }),
  ]);
  state.settings = settingsData;
  state.products = productsData.products ?? [];
  state.wallets = walletsData.wallets ?? [];
  if (typeof DB !== 'undefined') DB.init(settingsData);
  if (typeof DB !== 'undefined' && DB.isOnline()) {
    const online = await DB.getProducts(productsData.products ?? []);
    if (Array.isArray(online)) state.products = online;
  }
  initOrderList();
  initOrderTracking();
}

init();
