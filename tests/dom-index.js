/* =========================================================================
   اختبار DOM حقيقي — v4 (النسخة النهائية المعتمدة)
   يشغّل index.html الحقيقي بكامل عناصره + db.js + app.js في jsdom،
   ويتصل فعلياً بـ Supabase، ثم يقيس:
     • الأخطاء            • حالة طبقة البيانات     • عدد البطاقات
     • الفلترة            • البحث                  • فتح التفاصيل
     • حقل التتبّع        • الإحصاءات              • الأقسام
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
  let html = fs.readFileSync(path.join(WS, file), 'utf-8');
  return html.replace(/<script\b[^>]*\bsrc\s*=\s*"[^"]*"[^>]*>\s*<\/script>/gi, '');
}
function inject(html, list) {
  const boot = list.map(([m, code]) =>
    '<scr' + 'ipt>\n/* __' + m + '__ */\n' + code + '\n</scr' + 'ipt>').join('\n');
  const i = html.lastIndexOf('</body>');
  // ⚠️ نستخدم دالة استبدال لا نصاً: النص يُفسِّر $$ كـ escape لـ $ فيكسر الكود
  return html.slice(0, i) + boot + html.slice(i);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function chk(label, cond, extra = '') {
  if (cond) { pass++; console.log('  ✅ ' + label + (extra ? '  → ' + extra : '')); }
  else { fail++; console.log('  ❌ ' + label + (extra ? '  → ' + extra : '')); }
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

  // انتظار شرطي: ننتظر حتى تُرسم البطاقات فعلاً أو ينتهي المهلة
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    await wait(400);
    if (document.querySelectorAll('.product-card').length > 0) break;
  }
  await wait(500);

  console.log('═══════ اختبار DOM الحقيقي (index.html) ═══════');
  console.log('▸ الأخطاء:', errs.length ? errs.slice(0, 5) : 'لا شيء');
  chk('لا أخطاء تشغيل', errs.length === 0, errs[0] ?? '');
  chk('طبقة DB مُهيّأة', window.eval('typeof DB!=="undefined"'), window.eval('typeof DB!=="undefined" ? DB.getMode() : "?"'));
  chk('الاتصال أونلاين', window.eval('typeof DB!=="undefined" && DB.isOnline()'), '');

  /* الأعداد المتوقّعة تُشتقّ من حالة الصفحة لا من أرقام ثابتة.
     السبب: المصدر قد يكون data/products.json أو قاعدة البيانات، ورقم ثابت
     يجعل الاختبار يفشل بلا عيب حقيقي. المهم أن الرسم يطابق الحالة. */
  const total = window.eval('(state.products||[]).filter(function(p){ return p.status !== "hidden"; }).length');
  const cards = qa('.product-card');
  chk('عرض بطاقات المنتجات', cards.length === total && total > 0, cards.length + ' بطاقة (المتوقّع ' + total + ')');

  chk('إحصاء المنتجات', q('#statProducts')?.textContent?.trim() === String(total),
      q('#statProducts')?.textContent?.trim() + ' (المتوقّع ' + total + ')');
  // حقل التتبّع: ٦ خانات — يطابق طول رقم المرجع الجديد
  const otpBoxes = qa('#trackOtp .tbox').length;
  const refLen = window.eval('typeof ORDER_REF_LEN !== "undefined" ? ORDER_REF_LEN : 0');
  chk('حقل التتبّع بعدد خانات المرجع', otpBoxes > 0 && otpBoxes === refLen,
      otpBoxes + ' خانة (طول المرجع ' + refLen + ')');
  chk('عرض حقل التتبّع محسوب لا صفري',
      /\d+px/.test(q('#trackOtp')?.style.width ?? ''), q('#trackOtp')?.style.width ?? 'بلا عرض');
  chk('قسم بنية المنصة', !!q('#architecture'));
  chk('الفوتر', !!q('footer'));

  /* أزرار الفلترة صارت تُبنى من البيانات: كل زر معروض يجب أن يُظهر منتجاً
     واحداً على الأقل — تطبيقاً لقاعدة «الفارغ لا يُرسم». */
  const filterBtns = qa('.filter-btn');
  chk('أزرار الفلترة موجودة', filterBtns.length >= 3, filterBtns.length + ' زر');
  let emptyFilters = [];
  for (const btn of filterBtns) {
    btn.dispatchEvent(new window.Event('click', { bubbles: true }));
    await wait(60);
    if (qa('.product-card').length === 0) emptyFilters.push(btn.dataset.filter);
  }
  chk('لا فلتر فارغ', emptyFilters.length === 0,
      emptyFilters.length ? 'فارغة: ' + emptyFilters.join(', ') : 'كل الفلاتر تُظهر نتائج');
  q('.filter-btn[data-filter="all"]')?.dispatchEvent(new window.Event('click', { bubbles: true }));
  await wait(150);

  // فلترة: المدفوعة
  const paidBtn = q('.filter-btn[data-filter="paid"]');
  if (paidBtn) {
    paidBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
    await wait(300);
    const paid = qa('.product-card').length;
    chk('فلترة «مدفوعة»', paid > 0 && paid < total, paid + ' بطاقة من ' + total);
    q('.filter-btn[data-filter="all"]')?.dispatchEvent(new window.Event('click', { bubbles: true }));
    await wait(300);
    chk('عودة «الكل»', qa('.product-card').length === total, qa('.product-card').length + '');
  }

  // بحث
  const search = q('#searchInput');
  if (search) {
    search.value = 'Auth';
    search.dispatchEvent(new window.Event('input', { bubbles: true }));
    await wait(400);
    const n = qa('.product-card').length;
    chk('البحث عن "Auth"', n >= 1 && n <= 7, n + ' نتيجة');
    search.value = '';
    search.dispatchEvent(new window.Event('input', { bubbles: true }));
    await wait(300);
  }

  // فتح تفاصيل منتج
  if (qa('.product-card').length) {
    qa('.product-card')[0].dispatchEvent(new window.Event('click', { bubbles: true }));
    await wait(500);
    const modal = q('#detailsModal');
    chk('فتح تفاصيل المنتج', !!modal && !modal.classList.contains('hidden'), modal?.className ?? '—');
  }

  /* ═══ منطق التسليم: ستة أنماط صريحة ═══ */
  const MODES = ['file', 'repo', 'link', 'service', 'key', 'install'];
  const modes = window.eval('(state.products||[]).map(function(p){ return (p.delivery||{}).mode; })');
  chk('كل منتج له نمط تسليم معروف',
      modes.length > 0 && modes.every((m) => MODES.includes(m)),
      modes.join(', '));

  /* زر البطاقة يعكس النمط فعلاً — لا «تحميل» للجميع.
     نختبر المنطق بحقن رابط مؤقت لأن البيانات الحقيقية روابطها فارغة
     (وهذا صحيح: الزر يقول «غير متاح بعد» حتى يملأ المالك الرابط). */
  const ctaLogic = window.eval(`
    (function () {
      var out = [];
      var p = (state.products || []).filter(function (x) { return !x.price; })[0];
      if (!p) return out;
      var saved = p.delivery;
      ['file', 'repo', 'link', 'service'].forEach(function (m) {
        p.delivery = { mode: m, url: 'https://example.org/x', inviteUrl: 'https://example.org/i',
                       isPublic: true, commands: [], fileName: '', size: '', note: '' };
        out.push(deliveryCta(p).text);
      });
      p.delivery = saved;
      return out;
    })()
  `);
  chk('زر المجاني يعكس نمط التسليم',
      ctaLogic.length === 4 && new Set(ctaLogic).size === 4, ctaLogic.join(' · '));

  // والمفتاح والأوامر لا «يُفتحان» — يُعرضان
  const keyCta = window.eval(`
    (function () {
      var p = (state.products || []).filter(function (x) { return !x.price; })[0];
      var saved = p.delivery;
      p.delivery = { mode: 'key', url: '', inviteUrl: '', isPublic: true, commands: [], fileName: '', size: '', note: '' };
      var t = deliveryCta(p).text;
      p.delivery = saved;
      return t;
    })()
  `);
  chk('المفتاح يُعرَض لا يُفتح', keyCta === 'اعرض طريقة الاستلام', keyCta);

  // المدفوع يُقفل تسليمه دائماً — القاعدة الذهبية
  const paidLocked = window.eval(
    '(state.products||[]).filter(function(p){ return p.price > 0; }).every(function(p){ return deliveryVisible(p) === false; })'
  );
  chk('المدفوع مقفل التسليم دائماً', paidLocked, paidLocked ? 'كل المدفوع مقفل' : 'يوجد مدفوع مفتوح');

  // كتلة التسليم تُبنى لكل نمط بلا خطأ
  let deliveryBlocks = 0;
  for (const p of window.eval('(state.products||[])')) {
    const html = window.eval(`renderDeliveryBlock(state.products.find(function(x){return x.id===${p.id};}), ${Number(p.price) > 0})`);
    if (typeof html === 'string' && html.length > 0) deliveryBlocks++;
  }
  chk('كتلة التسليم تُبنى لكل منتج', deliveryBlocks === window.eval('(state.products||[]).length'),
      deliveryBlocks + ' كتلة');

  /* ═══ الاحتياط المضمّن: عمل الصفحة بلا خادم (file://) ═══
     فتح index.html بالنقر المزدوج يمنع fetch لملفات JSON، والنسخة المضمّنة
     في <script id="nova-data"> هي ما يجعل المتجر يظهر بدل صفحة فارغة. */
  const embedded = window.eval('readEmbeddedData("data/products.json")');
  chk('البيانات المضمّنة موجودة', !!embedded && Array.isArray(embedded.products) && embedded.products.length > 0,
      embedded ? embedded.products.length + ' منتج مضمّن' : 'غير موجودة');

  const embeddedWallets = window.eval('readEmbeddedData("data/wallets.json")');
  chk('المحافظ المضمّنة موجودة', !!embeddedWallets && Array.isArray(embeddedWallets.wallets) && embeddedWallets.wallets.length > 0,
      embeddedWallets ? embeddedWallets.wallets.length + ' محفظة' : 'غير موجودة');

  const offlineRead = await window.eval(`(async function () {
    var real = window.fetch;
    window.fetch = function () { return Promise.reject(new Error('offline')); };
    try {
      var r = await loadJSON('data/products.json', { products: [] });
      return (r && Array.isArray(r.products)) ? r.products.length : -1;
    } finally { window.fetch = real; }
  })()`);
  chk('يقرأ بلا شبكة من النسخة المضمّنة', offlineRead > 0, offlineRead + ' منتج');

  console.log('═══════ النتيجة: ' + pass + ' ناجح / ' + fail + ' فاشل ═══════');
  window.close();
  process.exit(fail === 0 ? 0 : 1);
}

run().catch((e) => { console.error('CRASH:', e); process.exit(2); });
