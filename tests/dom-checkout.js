#!/usr/bin/env node
/* =========================================================================
   اختبار DOM حقيقي — مسار الشراء (checkout)  v1
   -------------------------------------------------------------------------
   يشغّل index.html الحقيقي + db.js + app.js في jsdom ويتصل فعلياً بـ Supabase،
   ثم يقود مسار الشراء بنقرات حقيقية ويتحقق من:

     • حقل البريد الإلكتروني (payerEmail) — موجود، اختياري، يُتحقق منه
     • رقم مرجع الطلب عشوائي وغير قابل للتخمين (generateOrderReference)
     • إنشاء الطلب بحقوله كاملة (رقم productId، الحالة، الوقت)
     • مشهد الرفض: بريد غير صالح / اسم فارغ لا يُنشئان طلباً
     • تصفير بقايا الطلب السابق عند فتح مسار جديد

   التشغيل:  bash tests/run.sh
   ========================================================================= */
'use strict';
const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');
const path = require('path');
const WS = path.resolve(__dirname, '..');

const errs = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errs.push(String(e.detail?.message || e.message).split('\n')[0]));

function buildHtml(file) {
  const html = fs.readFileSync(path.join(WS, file), 'utf-8');
  return html.replace(/<script\b[^>]*\bsrc\s*=\s*"[^"]*"[^>]*>\s*<\/script>/gi, '');
}
function inject(html, list) {
  const boot = list.map(([m, code]) =>
    '<scr' + 'ipt>\n/* __' + m + '__ */\n' + code + '\n</scr' + 'ipt>').join('\n');
  const i = html.lastIndexOf('</body>');
  // ⚠️ دالة استبدال لا نص: النص يُفسِّر $$ كـ escape لـ $ فيكسر الكود
  return html.slice(0, i) + boot + html.slice(i);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const failed = [];
function chk(label, cond, extra = '') {
  if (cond) { pass++; console.log('  ✅ ' + label + (extra ? '  → ' + extra : '')); }
  else { fail++; failed.push(label); console.log('  ❌ ' + label + (extra ? '  → ' + extra : '')); }
}

async function run() {
  let html = buildHtml('index.html');
  html = inject(html, [
    ['db', fs.readFileSync(path.join(WS, 'db.js'), 'utf-8')],
    ['app', fs.readFileSync(path.join(WS, 'app.js'), 'utf-8')],
  ]);

  let createClient = null;
  try { ({ createClient } = require('@supabase/supabase-js')); } catch {}

  const dom = new JSDOM(html, {
    url: 'http://localhost:8080/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      window.fetch = async (url) => {
        const u = String(url);
        if (!/^https?:/i.test(u)) {
          const file = path.join(WS, u.split('?')[0]);
          if (fs.existsSync(file) && fs.statSync(file).isFile()) {
            const body = fs.readFileSync(file, 'utf-8');
            return { ok: true, status: 200, json: async () => JSON.parse(body), text: async () => body };
          }
          return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
        }
        return global.fetch(u);
      };
      if (createClient) window.supabase = { createClient };
      window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
      if (!window.requestAnimationFrame) window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
      window.scrollTo = () => {};
      window.innerWidth = 1280; window.innerHeight = 800;
    },
  });
  const { window } = dom;
  const { document } = window;
  const q = (s) => document.querySelector(s);
  const qa = (s) => Array.from(document.querySelectorAll(s));

  // انتظار شرطي لرسم البطاقات
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    await wait(300);
    if (document.querySelectorAll('.product-card').length > 0) break;
  }
  await wait(400);

  console.log('═══════ اختبار DOM — مسار الشراء (index.html) ═══════');
  console.log('▸ الأخطاء:', errs.length ? errs.slice(0, 3) : 'لا شيء');

  const cards = qa('.product-card');
  /* العدد المتوقّع يُشتقّ من حالة الصفحة لا من رقم ثابت:
     المصدر قد يكون data/products.json أو قاعدة البيانات، ورقم ثابت
     يجعل الاختبار يفشل بلا سبب حقيقي. المهم أن الرسم يطابق الحالة. */
  const expectedCards = window.eval('(state.products||[]).filter(function(p){ return p.status !== "hidden"; }).length');
  chk('الصفحة حمّلت ورسمت البطاقات', cards.length === expectedCards && cards.length > 0,
      cards.length + ' بطاقة (المتوقّع ' + expectedCards + ')');
  if (!cards.length) { console.log('\nتعذّر المتابعة — الصفحة لم تُرسم.'); process.exit(1); }

  /* ═══ 1) مولّد المرجع: عشوائي فعلاً ═══ */
  console.log('\n─── 1) رقم مرجع الطلب غير قابل للتخمين ───');
  const refs = new Set();
  for (let i = 0; i < 40; i++) refs.add(window.generateOrderReference());
  chk('الدالة موجودة عامّة', typeof window.generateOrderReference === 'function');
  chk('الشكل: ٦ محارف بلا لبس', [...refs].every((r) => /^[A-Z2-9]{6}$/.test(r) && !/[IO01]/.test(r)), [...refs][0]);
  chk('بلا محارف ملتبسة I/O/0/1', [...refs].every((r) => !/[IO01]/.test(r)));
  chk('40 توليداً بلا تكرار', refs.size === 40, refs.size + '/40 فريد');
  // لا علاقة بالزمن: توليدان متتاليان لا يتشاركان أي بنية زمنية
  chk('لا يعتمد على الزمن', window.generateOrderReference() !== window.generateOrderReference());

  /* ═══ 2) حقل البريد في النموذج ═══ */
  console.log('\n─── 2) حقل البريد الإلكتروني ───');
  const emailEl = q('#payerEmail');
  chk('الحقل موجود', !!emailEl);
  chk('نوعه email', !!emailEl && emailEl.getAttribute('type') === 'email');
  chk('اختياري (بلا required)', !!emailEl && !emailEl.hasAttribute('required'));
  chk('autocomplete=email', !!emailEl && emailEl.getAttribute('autocomplete') === 'email');
  chk('لا يوجد داخل نموذج يُرسل تلقائياً', !emailEl || !emailEl.closest('form'));

  /* ═══ 3) فتح المودال ═══ */
  console.log('\n─── 3) فتح مسار الشراء ───');
  // openCheckout يستقبل كائن المنتج لا معرّفه، ويلزمه حقل paymentMethods.
  // نأخذ المنتج من حالة التطبيق نفسها (ما يراه الزائر فعلاً) لا من الملف.
  const paid = window.eval('(state.products||[]).find(p => Number(p.price) > 0) || null');
  chk('يوجد منتج مدفوع', !!paid, paid ? paid.slug + ' ($' + paid.price + ')' : '—');
  if (!paid) { console.log('تعذّر المتابعة — لا منتج مدفوع.'); process.exit(1); }

  const PAID_SLUG = JSON.stringify(paid.slug);
  const TEST_ADDRESS = 'TQ5NMqJj3fN8kQv2Hr7sLp4Xd9WzB1cE6y';

  /* ── النموذج الموحّد: كل المحافظ تُعرض للمشتري وهو يختار ──
     لم يبقَ ربط بين منتج وطريقة دفع (product.paymentMethods أُزيل)،
     فالتفريغ والتهيئة يقعان على المحافظ نفسها: عنوان للرقمية وحساب للمحلية. */
  const clearMethods = () => window.eval(`
    (function () {
      (state.wallets || []).forEach(function (w) {
        w.address = ''; w.account = ''; w.accountName = '';
      });
    })();
  `);

  /** يُعدّ محفظة رقمية بعنوان صالح ويرجع معرّفها — لاختبار مسار الشراء الطبيعي. */
  const configureMethod = () => window.eval(`
    (function () {
      var w = (state.wallets || []).filter(function (x) { return x.type !== 'local'; })[0];
      if (w) { w.address = '${TEST_ADDRESS}'; w.enabled = true; return w.id; }
      return null;
    })()
  `);

  /* ── قاعدة جديدة: الوسيلة غير المُعدّة لا تُعرض إطلاقاً ──
     السبب: كانت الواجهة تعرض عناوين محافظ تجريبية — وأحدها عنوان مثال من
     مواصفة Bitcoin نفسها. وعرض وسيلة معطوبة أسوأ من عدم عرضها: المشتري
     يقرّر الشراء ثم يُرسل مالاً إلى عنوان لا يملكه أحد. */
  clearMethods();
  window.openCheckout(paid);
  await wait(150);
  chk('الوسيلة غير المُعدّة لا تُعرض', qa('#paymentMethods .payment-opt').length === 0,
      qa('#paymentMethods .payment-opt').length + ' خيار (المتوقّع 0)');

  // ثم نُعدّ وسيلة حقيقية ونتابع المسار الطبيعي
  const configuredId = configureMethod();
  chk('أُعدّت وسيلة دفع للاختبار', !!configuredId, configuredId ?? '—');
  window.openCheckout(paid);
  await wait(250);
  const modal = q('#checkoutModal');
  chk('مودال الشراء انفتح', !!modal && !modal.classList.contains('hidden'), modal?.className ?? '—');

  const mBtns = qa('#paymentMethods .payment-opt');
  chk('طرق الدفع رُسمت', mBtns.length > 0, mBtns.length + ' خيار');
  if (mBtns.length) {
    mBtns[0].dispatchEvent(new window.Event('click', { bubbles: true }));
    await wait(200);
    chk('طريقة الدفع اختيرت فعلاً', mBtns[0].classList.contains('selected'), mBtns[0].dataset.method);
  }

  const nameEl = q('#payerName');
  const refEl = q('#payerRef');
  chk('حقل الاسم موجود', !!nameEl);
  chk('حقل رقم العملية موجود', !!refEl);

  const readOrders = () => {
    try { return JSON.parse(window.localStorage.getItem('nova_purchases') || '[]'); } catch { return []; }
  };
  // db.js يكتب محلياً بشكل غير متزامن (await قبل السقوط للوضع المحلي)،
  // فننتظر شرطياً ظهور الطلب بدل الاعتماد على مهلة ثابتة.
  const waitForOrders = async (n, timeout = 3000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (readOrders().length === n) return true;
      await wait(50);
    }
    return false;
  };
  const before = readOrders().length;

  /* ═══ 4) مشاهد الرفض ═══ */
  console.log('\n─── 4) مشاهد الرفض (يجب ألّا تُنشئ طلباً) ───');
  if (nameEl && refEl && emailEl) {
    // (أ) بريد غير صالح
    nameEl.value = 'مشتري الاختبار'; refEl.value = 'TX-TEST-12345'; emailEl.value = 'not-an-email';
    window.completeOrder();
    await wait(400);
    chk('بريد غير صالح ⇒ مرفوض', readOrders().length === before, 'الطلبات: ' + readOrders().length);

    // (ب) اسم فارغ
    nameEl.value = ''; refEl.value = 'TX-TEST-12345'; emailEl.value = 'buyer@test.local';
    window.completeOrder();
    await wait(400);
    chk('اسم فارغ ⇒ مرفوض', readOrders().length === before, 'الطلبات: ' + readOrders().length);

    // (ج) رقم عملية فارغ
    nameEl.value = 'مشتري'; refEl.value = ''; emailEl.value = '';
    window.completeOrder();
    await wait(400);
    chk('رقم عملية فارغ ⇒ مرفوض', readOrders().length === before, 'الطلبات: ' + readOrders().length);
  } else {
    chk('حقول النموذج متاحة', false, 'حقل مفقود');
  }

  /* ═══ 5) طلب صحيح كامل ═══ */
  console.log('\n─── 5) طلب صحيح — يُحفظ بحقوله كاملة ───');
  nameEl.value = 'مشتري الاختبار';
  refEl.value = 'TX-TEST-12345';
  emailEl.value = 'buyer@test.local';
  window.completeOrder();
  const madeIt = await waitForOrders(before + 1);

  const orders = readOrders();
  const saved = orders[orders.length - 1];
  chk('الطلب أُنشئ', madeIt && orders.length === before + 1, orders.length + ' طلب');
  if (saved) {
    chk('payerName محفوظ', saved.payerName === 'مشتري الاختبار', saved.payerName);
    chk('payerRef محفوظ', saved.payerRef === 'TX-TEST-12345', saved.payerRef);
    chk('payerEmail محفوظ', saved.payerEmail === 'buyer@test.local', saved.payerEmail);
    chk('status = pending', saved.status === 'pending', saved.status);
    chk('reference بصيغة ٦ محارف', /^[A-Z2-9]{6}$/.test(saved.reference), saved.reference);
    chk('productId رقم لا نص (يمنع خطأ int)', typeof saved.productId === 'number', typeof saved.productId + ' = ' + saved.productId);
    chk('createdAt بصيغة ISO', /^\d{4}-\d{2}-\d{2}T/.test(saved.createdAt || ''), saved.createdAt);
    chk('طريقة الدفع مسجّلة', !!saved.methodKey, saved.methodKey);
  }

  /* ═══ 6) البريد اختياري فعلاً ═══ */
  console.log('\n─── 6) البريد اختياري — طلب بلا بريد ينجح ───');
  nameEl.value = 'مشتري بلا بريد';
  refEl.value = 'TX-NO-EMAIL';
  emailEl.value = '';
  window.completeOrder();
  const noMailOk = await waitForOrders(orders.length + 1);
  const orders2 = readOrders();
  const noMail = orders2[orders2.length - 1];
  chk('طلب بلا بريد أُنشئ', noMailOk && orders2.length === orders.length + 1, orders2.length + ' طلب');
  chk('payerEmail فارغ لا undefined', noMail && noMail.payerEmail === '', JSON.stringify(noMail && noMail.payerEmail));

  /* ═══ 7) تصفير عند مسار جديد ═══ */
  console.log('\n─── 7) تصفير بقايا الطلب السابق ───');
  window.openCheckout(paid);
  await wait(300);
  chk('الاسم صُفِّر', q('#payerName').value === '', JSON.stringify(q('#payerName').value));
  chk('رقم العملية صُفِّر', q('#payerRef').value === '', JSON.stringify(q('#payerRef').value));
  chk('البريد صُفِّر', q('#payerEmail').value === '', JSON.stringify(q('#payerEmail').value));

  /* ═══ 8) تنظيف بيانات الاختبار ═══ */
  console.log('\n─── 8) تنظيف أثر الاختبار ───');
  const cleaned = readOrders().filter((o) => !/^[A-Z2-9]{6}$/.test(String(o.reference || '')) || !['TX-TEST-12345', 'TX-NO-EMAIL'].includes(o.payerRef));
  window.localStorage.setItem('nova_purchases', JSON.stringify(cleaned));
  chk('بيانات الاختبار أُزيلت من localStorage', readOrders().every((o) => !['TX-TEST-12345', 'TX-NO-EMAIL'].includes(o.payerRef)));

  console.log('\n═══════ النتيجة: ' + pass + ' ناجح / ' + fail + ' فاشل ═══════');
  if (fail) console.log('🔴 فاشلة: ' + failed.join(' · '));
  if (errs.length) console.log('⚠️  أخطاء تشغيل: ' + errs.slice(0, 3).join(' | '));
  window.close();
  process.exit(fail === 0 ? 0 : 1);
}

run().catch((e) => { console.error('CRASH:', e); process.exit(2); });
