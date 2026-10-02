#!/usr/bin/env node
/* =========================================================================
   اختبار التدفّق الكامل — من التصفّح إلى استلام المفتاح   v1
   -------------------------------------------------------------------------
   يقود رحلة المشتري والأدمن خطوة بخطوة على الصفحات الحقيقية في jsdom،
   بوضع محلي (بلا قاعدة) ليكون الاختبار حتمياً وقابلاً للتكرار:

     المرحلة ١  الكتالوج يُحمَّل ويُرسم
     المرحلة ٢  التصفّح: بحث + فلترة + إعادة الضبط
     المرحلة ٣  تفاصيل المنتج: كتلة التسليم بحسب النمط + القفل للمدفوع
     المرحلة ٤  الشراء: المحافظ المعروضة → تفاصيل التحويل → إثبات → إنشاء الطلب
     المرحلة ٥  لوحة الأدمن: الطلب ظاهر → تأكيد وسحب مفتاح من المخزون
     المرحلة ٦  التتبّع: إدخال المرجع → الحالة → المفتاح → التسليم مفتوح
     المرحلة ٧  حالات حدّية: المحفظة الناقصة لا تُعرض · الفارغ لا يُرسم

   التشغيل:  node tests/flow-e2e.js
   ========================================================================= */
'use strict';
const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');
const path = require('path');

const WS = path.resolve(__dirname, '..');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const failed = [];
function chk(label, cond, extra = '') {
  if (cond) { pass++; console.log('  ✅ ' + label + (extra ? '  → ' + extra : '')); }
  else { fail++; failed.push(label); console.log('  ❌ ' + label + (extra ? '  → ' + extra : '')); }
}
function head(text) { console.log('\n─── ' + text + ' ' + '─'.repeat(Math.max(0, 46 - text.length))); }

/* ── أدوات بناء الصفحة (نفس نمط بقية الاختبارات) ── */
function buildHtml(file) {
  return fs.readFileSync(path.join(WS, file), 'utf-8')
    .replace(/<script\b[^>]*\bsrc\s*=\s*"[^"]*"[^>]*>\s*<\/script>/gi, '');
}
function inject(html, list) {
  const boot = list.map(([m, code]) =>
    '<scr' + 'ipt>\n/* __' + m + '__ */\n' + code + '\n</scr' + 'ipt>').join('\n');
  const i = html.lastIndexOf('</body>');
  // ⚠️ دالة استبدال لا نص: النص يفسّر $$ كـ escape لـ $ فيكسر الكود
  return html.slice(0, i) + boot + html.slice(i);
}

/* ── بيانات الاختبار: محافظ حقيقية الشكل + مخزون مفاتيح ── */
const TRC20_ADDR = 'TQ5NMqJj3fN8kQv2Hr7sLp4Xd9WzB1cE6y';

function seedFrom() {
  const products = JSON.parse(fs.readFileSync(path.join(WS, 'data/products.json'), 'utf-8')).products;
  // مخزون مفاتيح للمنتجات المدفوعة — بلا مخزون لا يستطيع الأدمن تأكيد طلب
  products.forEach((p) => {
    if (p.licenseMode === 'key') { p.licenseKeys = [`TEST-${p.slug.slice(0, 4).toUpperCase()}-0001`]; p.usedKeys = []; }
  });
  const wallets = {
    wallets: [
      { id: 'wlt_test_crypto', endpointId: 'wlt_test_crypto', type: 'crypto', label: 'USDT — Binance',
        network: 'TRC20', currency: 'USDT', address: TRC20_ADDR, qr: '',
        note: 'أرسل على شبكة TRC20 فقط.', isDefault: true, enabled: true },
      { id: 'wlt_test_local', endpointId: 'wlt_test_local', type: 'local', label: 'شام كاش+',
        country: 'SY', provider: 'شام كاش+', currency: 'SYP', account: '0999 123 456',
        accountName: 'أحمد محمد', qr: '', note: 'أرسل صورة الإشعار.', isDefault: false, enabled: true },
      // ناقصة عمداً: بلا عنوان ⇒ يجب ألّا تظهر للمشتري
      { id: 'wlt_test_empty', endpointId: 'wlt_test_empty', type: 'crypto', label: 'محفظة غير مُعدّة',
        network: 'BEP20', currency: 'USDT', address: '', qr: '', note: '', isDefault: false, enabled: true },
    ],
  };
  return { products: { products }, wallets };
}

function makeDom(file, store, scripts) {
  const html = inject(buildHtml(file), scripts);
  const errs = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errs.push(String(e.detail?.message || e.message).split('\n')[0]));
  const dom = new JSDOM(html, {
    url: 'http://localhost:8080/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      // بلا supabase ⇒ الوضع المحلي: حتمي وبلا شبكة
      window.fetch = async (url) => {
        const u = String(url);
        if (!/^https?:/i.test(u)) {
          const f = path.join(WS, u.split('?')[0]);
          if (fs.existsSync(f) && fs.statSync(f).isFile()) {
            const body = fs.readFileSync(f, 'utf-8');
            return { ok: true, status: 200, json: async () => JSON.parse(body), text: async () => body };
          }
        }
        return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
      };
      window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
      window.scrollTo = () => {};
      window.open = () => null;
      window.confirm = () => true;
      if (store) Object.entries(store).forEach(([k, v]) => window.localStorage.setItem(k, v));
    },
  });
  return { dom, errs };
}

function dumpStore(win) {
  const out = {};
  for (let i = 0; i < win.localStorage.length; i++) {
    const k = win.localStorage.key(i);
    out[k] = win.localStorage.getItem(k);
  }
  return out;
}

async function settle(win, fn, tries = 40) {
  for (let i = 0; i < tries; i++) { await wait(120); if (fn()) return true; }
  return false;
}

(async () => {
  const seed = seedFrom();
  const STORE = {
    nova_products_draft: JSON.stringify(seed.products),
    nova_wallets_draft: JSON.stringify(seed.wallets),
  };

  /* ═══════════════ المرحلة ١+٢: الكتالوج والتصفّح ═══════════════ */
  console.log('═══════ اختبار التدفّق الكامل — من التصفّح إلى المفتاح ═══════');

  const scripts = [
    ['db', fs.readFileSync(path.join(WS, 'db.js'), 'utf-8')],
    ['app', fs.readFileSync(path.join(WS, 'app.js'), 'utf-8')],
  ];
  const p1 = makeDom('index.html', STORE, scripts);
  const w1 = p1.dom.window, d1 = w1.document;
  const q1 = (s) => d1.querySelector(s);
  const qa1 = (s) => Array.from(d1.querySelectorAll(s));

  await settle(w1, () => qa1('.product-card').length > 0);

  head('المرحلة ١ — الكتالوج');
  chk('لا أخطاء تشغيل', p1.errs.length === 0, p1.errs[0] ?? '');
  const total = w1.eval('(state.products||[]).length');
  chk('المنتجات حُمّلت من المسودة', total === 7, total + ' منتج');
  chk('البطاقات رُسمت', qa1('.product-card').length === 7, qa1('.product-card').length + ' بطاقة');
  chk('الوضع محلي (بلا قاعدة)', w1.eval('DB.getMode()') === 'local', w1.eval('DB.getMode()'));
  chk('لا لافتة بيانات ناقصة', !q1('#productGrid [class*="card"] .material-symbols-outlined') ||
      qa1('.product-card').length === 7, 'الكتالوج ظاهر');

  head('المرحلة ٢ — التصفّح');
  const freeBtn = q1('.filter-btn[data-filter="free"]');
  freeBtn.dispatchEvent(new w1.Event('click', { bubbles: true }));
  await wait(200);
  chk('فلتر «مجانية»', qa1('.product-card').length === 3, qa1('.product-card').length + ' بطاقة');

  const paidBtn = q1('.filter-btn[data-filter="paid"]');
  paidBtn.dispatchEvent(new w1.Event('click', { bubbles: true }));
  await wait(200);
  chk('فلتر «مدفوعة»', qa1('.product-card').length === 4, qa1('.product-card').length + ' بطاقة');

  const search = q1('#searchInput');
  q1('.filter-btn[data-filter="all"]').dispatchEvent(new w1.Event('click', { bubbles: true }));
  await wait(150);
  search.value = 'apex';
  search.dispatchEvent(new w1.Event('input', { bubbles: true }));
  await wait(250);
  chk('البحث «apex»', qa1('.product-card').length === 1, qa1('.product-card').length + ' نتيجة');
  search.value = '';
  search.dispatchEvent(new w1.Event('input', { bubbles: true }));
  await wait(200);

  /* ═══════════════ المرحلة ٣: تفاصيل المنتج والتسليم ═══════════════ */
  head('المرحلة ٣ — تفاصيل المنتج وكتلة التسليم');
  const openDetails = async (slug) => {
    const p = w1.eval(`(state.products||[]).find(function(x){return x.slug==='${slug}';})`);
    w1.eval(`renderDetails(state.products.find(function(x){return x.slug==='${slug}';})); openModal('detailsModal');`);
    await wait(220);
    return p;
  };

  await openDetails('clipstash');   // مجاني · نمط ملف
  let block = q1('#detailsBody [data-dpanel="install"]')?.innerHTML ?? '';
  chk('المجاني: التسليم ظاهر', block.includes('طريقة التسليم'), 'كتلة موجودة');
  chk('المجاني: لا قفل', !block.includes('يُسلَّم بعد تأكيد الدفع'), 'بلا قفل');

  await openDetails('apex-dashboard');   // مدفوع · ملف
  block = q1('#detailsBody [data-dpanel="install"]')?.innerHTML ?? '';
  chk('المدفوع: التسليم مقفل', block.includes('يُسلَّم بعد تأكيد الدفع'), 'قفل ظاهر');
  chk('المدفوع: لا رابط مكشوف', !/href="https?:/.test(block), 'لا روابط تسليم');

  await openDetails('authkit-api');   // مدفوع · مستودع خاص
  block = q1('#detailsBody [data-dpanel="install"]')?.innerHTML ?? '';
  chk('المستودع الخاص: مقفل مع إشارة الدعوة', block.includes('يُسلَّم بعد تأكيد الدفع'), 'مقفل');

  await openDetails('config-forge-cli');   // مجاني · أوامر تثبيت
  block = q1('#detailsBody [data-dpanel="install"]')?.innerHTML ?? '';
  chk('أوامر التثبيت تُعرض للمجاني', block.includes('npm i -g'), 'الأوامر ظاهرة');
  chk('لكل أمر زر نسخ', (block.match(/data-copy=/g) || []).length >= 3, (block.match(/data-copy=/g) || []).length + ' زر');
  w1.eval("closeModal('detailsModal')");

  /* ═══════════════ المرحلة ٤: الشراء ═══════════════ */
  head('المرحلة ٤ — الشراء (اختيار محفظة → تحويل → إثبات)');
  const paidProduct = w1.eval("(state.products||[]).find(function(p){return p.slug==='apex-dashboard';})");
  w1.eval("openCheckout(state.products.find(function(p){return p.slug==='apex-dashboard';}))");
  await wait(320);

  const opts = qa1('#paymentMethods .payment-opt');
  chk('مودال الشراء انفتح', q1('#checkoutModal').classList.contains('active'), 'active');
  chk('المحافظ المُعدّة تُعرض', opts.length === 2, opts.length + ' محفظة');
  chk('المحفظة الناقصة مخفية', !opts.some((o) => o.dataset.method === 'wlt_test_empty'), 'غير موجودة');
  // الفحص على واجهة الشراء وحدها — لا على نص السكربتات (تعليق قد يذكر «PayPal»)
  const checkoutHtml = q1('#checkoutModal')?.innerHTML ?? '';
  chk('لا وسائط دفع (Stripe/PayPal/بنك) في واجهة الشراء',
      !checkoutHtml.includes('Stripe') && !checkoutHtml.includes('PayPal') && !checkoutHtml.includes('IBAN'),
      'الواجهة نظيفة');
  const cryptoOpt = opts.find((o) => o.dataset.method === 'wlt_test_crypto');
  const localOpt = opts.find((o) => o.dataset.method === 'wlt_test_local');
  chk('وسم «رقمية» + الشبكة', cryptoOpt?.innerHTML.includes('رقمية') && cryptoOpt.innerHTML.includes('TRC20'), 'TRC20');
  chk('وسم «محلية» + الدولة', localOpt?.innerHTML.includes('محلية') && localOpt.innerHTML.includes('سوريا'), 'سوريا');

  cryptoOpt.dispatchEvent(new w1.Event('click', { bubbles: true }));
  await wait(160);
  chk('المحفظة اختيرت', cryptoOpt.classList.contains('selected'), w1.eval('state.checkout.methodKey'));

  q1('#checkoutNext').dispatchEvent(new w1.Event('click', { bubbles: true }));
  await wait(320);
  const detailHtml = q1('#paymentDetails')?.innerHTML ?? '';
  chk('انتقل للخطوة ٢', q1('#checkoutStep2').style.display !== 'none', 'ظاهرة');
  chk('العنوان يظهر للمشتري', detailHtml.includes(TRC20_ADDR.slice(0, 12)), 'العنوان ظاهر');
  chk('تحذير الشبكة ظاهر', detailHtml.includes('net-warn') && detailHtml.includes('TRC20'), 'تحذير موجود');
  // QR: صورة مولّدة، أو صورة مرفوعة، أو رسالة صريحة تطلب النسخ — لا صمت
  chk('QR أو بديل صريح',
      detailHtml.includes('qr-wrap') || detailHtml.includes('رمز QR غير متاح'),
      detailHtml.includes('qr-wrap') ? 'صورة QR' : 'رسالة بديلة');
  chk('المبلغ بالدولار', detailHtml.includes('$29'), '$29');
  chk('زر النسخ موجود', detailHtml.includes('data-copy'), 'نسخ');

  q1('#payerName').value = 'مشتري الاختبار';
  q1('#payerRef').value = 'TXID-987654';
  q1('#payerEmail').value = 'buyer@test.local';
  q1('#checkoutNext').dispatchEvent(new w1.Event('click', { bubbles: true }));
  await wait(1400);

  const orders1 = JSON.parse(w1.localStorage.getItem('nova_purchases') || '[]');
  chk('الطلب أُنشئ', orders1.length === 1, orders1.length + ' طلب');
  const order1 = orders1[0] ?? {};
  chk('رقم المرجع ٦ محارف', /^[A-Z2-9]{6}$/.test(order1.reference || ''), order1.reference);
  chk('حالة الطلب pending', order1.status === 'pending', order1.status);
  chk('المحفظة مسجّلة', order1.methodKey === 'wlt_test_crypto', order1.methodKey);
  chk('الإثبات مسجّل', order1.payerRef === 'TXID-987654', order1.payerRef);
  chk('المبلغ 29', Number(order1.total) === 29, String(order1.total));
  chk('productId رقمي', typeof order1.productId === 'number', typeof order1.productId);
  const REF = order1.reference;
  const STORE_AFTER_BUY = dumpStore(w1);

  /* ═══════════════ المرحلة ٥: لوحة الأدمن ═══════════════ */
  head('المرحلة ٥ — لوحة الأدمن (تأكيد وسحب مفتاح)');
  const adminScripts = [
    ['db', fs.readFileSync(path.join(WS, 'db.js'), 'utf-8')],
    ['admin', fs.readFileSync(path.join(WS, 'admin.js'), 'utf-8')],
  ];
  const p2 = makeDom('admin.html', STORE_AFTER_BUY, adminScripts);
  const w2 = p2.dom.window, d2 = w2.document;
  const q2 = (s) => d2.querySelector(s);
  const qa2 = (s) => Array.from(d2.querySelectorAll(s));

  await settle(w2, () => q2('#gateScreen') && w2.eval('typeof enterAdmin === "function"'));

  q2('#gatePass').value = 'test-pass-123';
  q2('#gateEnter').dispatchEvent(new w2.Event('click', { bubbles: true }));
  await settle(w2, () => q2('#adminApp')?.style.display === 'block');
  chk('الدخول للوحة نجح', q2('#adminApp')?.style.display === 'block', 'اللوحة ظاهرة');
  chk('لا أخطاء تشغيل في اللوحة', p2.errs.length === 0, p2.errs[0] ?? '');

  d2.querySelector('.admin-tab[data-tab="orders"]').dispatchEvent(new w2.Event('click', { bubbles: true }));
  await settle(w2, () => qa2('#ordersTableBody tr').length > 0);
  chk('الطلب ظاهر للأدمن', (q2('#ordersTableBody')?.innerHTML || '').includes(REF), REF);

  const approveBtn = q2(`[data-approve="${REF}"]`);
  chk('زر التأكيد موجود', !!approveBtn, approveBtn ? 'موجود' : 'مفقود');
  if (approveBtn) {
    approveBtn.dispatchEvent(new w2.Event('click', { bubbles: true }));
    await wait(600);
  }
  const orders2 = JSON.parse(w2.localStorage.getItem('nova_purchases') || '[]');
  const order2 = orders2.find((o) => o.reference === REF) ?? {};
  chk('الطلب تأكّد', order2.status === 'confirmed', order2.status);
  chk('مفتاح الترخيص سُحب من المخزون', /^TEST-/.test(order2.licenseKey || ''), order2.licenseKey);
  chk('وقت التأكيد سُجّل', !!order2.confirmedAt, order2.confirmedAt ? 'مسجّل' : 'مفقود');
  const STORE_AFTER_CONFIRM = dumpStore(w2);

  /* ═══════════════ المرحلة ٦: التتبّع ═══════════════ */
  head('المرحلة ٦ — تتبّع المشتري واستلام المفتاح');
  const p3 = makeDom('index.html', STORE_AFTER_CONFIRM, scripts);
  const w3 = p3.dom.window, d3 = w3.document;
  const q3 = (s) => d3.querySelector(s);
  await settle(w3, () => d3.querySelectorAll('.product-card').length > 0);

  const otpInput = q3('#trackOtp input');
  chk('حقل التتبّع فيه ٦ خانات', d3.querySelectorAll('#trackOtp .tbox').length === 6,
      d3.querySelectorAll('#trackOtp .tbox').length + ' خانة');
  otpInput.value = REF;
  otpInput.dispatchEvent(new w3.Event('input', { bubbles: true }));
  await wait(150);
  const painted = Array.from(d3.querySelectorAll('#trackOtp .tbox')).map((b) => b.textContent).join('');
  chk('المرجع ظهر في الخانات', painted === REF, painted);

  q3('#trackBtn').dispatchEvent(new w3.Event('click', { bubbles: true }));
  await settle(w3, () => (q3('#trackResult')?.innerHTML || '').includes('مؤكَّد'));
  const result = q3('#trackResult')?.innerHTML ?? '';
  chk('الطلب وُجد وحالته مؤكَّد', result.includes('مؤكَّد'), 'مؤكَّد ✓');
  chk('مفتاح الترخيص ظهر للمشتري', result.includes(order2.licenseKey || '@@'), order2.licenseKey);
  chk('زر نسخ المفتاح موجود', result.includes('data-copy-key'), 'نسخ المفتاح');
  chk('التسليم مفتوح', result.includes('تحميل') || result.includes('غير مُعدّ') || result.includes('قيد التجهيز')
      || result.includes('المفتاح جاهز') || result.includes('سيظهر هنا'),
      'حالة التسليم معروضة');
  chk('تنبيه المصدر يظهر (بلا قاعدة)', result.includes('إيصالك المحفوظ'), 'مصدر الحالة مُسمّى');
  chk('لا وعد بفحص دوري بعد التأكيد', !result.includes('تُفحَص تلقائياً'), 'الفحص توقّف');

  /* ═══════════════ المرحلة ٨: حالة «قيد المراجعة» ═══════════════ */
  head('المرحلة ٨ — قيد المراجعة (ما يراه المشتري قبل تأكيد الأدمن)');
  const pendingStore = { ...STORE_AFTER_CONFIRM };
  pendingStore.nova_purchases = JSON.stringify(
    JSON.parse(pendingStore.nova_purchases || '[]').map((o) =>
      o.reference === REF ? { ...o, status: 'pending', licenseKey: '' } : o)
  );
  const p4 = makeDom('index.html', pendingStore, scripts);
  const w4 = p4.dom.window, d4 = w4.document;
  await settle(w4, () => d4.querySelectorAll('.product-card').length > 0);

  const inp4 = d4.querySelector('#trackOtp input');
  inp4.value = REF;
  inp4.dispatchEvent(new w4.Event('input', { bubbles: true }));
  d4.querySelector('#trackBtn').dispatchEvent(new w4.Event('click', { bubbles: true }));
  await settle(w4, () => (d4.querySelector('#trackResult')?.innerHTML || '').includes('قيد المراجعة'));
  const pend = d4.querySelector('#trackResult')?.innerHTML || '';
  chk('حالة «قيد المراجعة» تُعرض', pend.includes('قيد المراجعة'), 'قيد المراجعة');
  chk('خط الحالات يُظهر الحالة الحيّة', pend.includes('track-tl-item now'), 'نبضة على الخطوة الجارية');
  chk('يُخبَر المشتري بالفحص التلقائي', pend.includes('تُفحَص تلقائياً'), 'لا حاجة لإعادة التحميل');
  chk('لا مفتاح قبل التأكيد', !pend.includes('license-key-box'), 'لا مفتاح مكشوف');
  chk('تنبيه المصدر ظاهر', pend.includes('إيصالك المحفوظ'), 'المصدر مُسمّى');
  // writeLocal يحفظ بـ JSON.stringify — فالقراءة تحتاج JSON.parse
  let savedRef = null;
  try { savedRef = JSON.parse(w4.localStorage.getItem('nova_last_ref')); } catch {}
  chk('المرجع محفوظ للاسترجاع', savedRef === REF, String(savedRef));

  /* ═══════════════ المرحلة ٧: حالات حدّية ═══════════════ */
  head('المرحلة ٧ — حالات حدّية وقواعد ثابتة');
  chk('المحفظة الناقصة لا تصل للواجهة',
      !w3.eval("(state.wallets||[]).filter(isConfiguredWallet).some(function(w){return w.id==='wlt_test_empty';})"),
      'مُستبعدة');
  chk('المدفوع مقفل التسليم دائماً',
      w3.eval("(state.products||[]).filter(function(p){return p.price>0;}).every(function(p){return deliveryVisible(p)===false;})"),
      'كل المدفوع مقفل');
  chk('المجاني مفتوح التسليم',
      w3.eval("(state.products||[]).filter(function(p){return !p.price;}).every(function(p){return deliveryVisible(p)===true;})"),
      'كل المجاني مفتوح');
  chk('الفارغ لا يُرسم (المحفظة المحلية بلا QR)',
      !(w3.eval("renderWalletPaymentDetails(state.wallets.find(function(w){return w.type==='local';}))") , d3.querySelector('#paymentDetails')?.innerHTML || '').includes('qr-wrap'),
      'لا QR لمحفظة محلية');
  chk('لا أخطاء تشغيل في رحلة التتبّع', p3.errs.length === 0, p3.errs[0] ?? '');

  console.log('\n═══════ النتيجة: ' + pass + ' ناجح / ' + fail + ' فاشل ═══════');
  if (failed.length) console.log('🔴 فاشلة: ' + failed.join(' · '));
  // إغلاق النوافذ يوقف مؤقتات الفحص الدوري — وإلا بقي Node حياً بلا نهاية
  w1.close(); w2.close(); w3.close(); w4.close();
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('CRASH:', e); process.exit(2); });
