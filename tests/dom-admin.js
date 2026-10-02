/* =========================================================================
   اختبار DOM حقيقي — لوحة الأدمن (admin.html)
   يشغّل admin.html الحقيقي + db.js + admin.js في jsdom، ويتصل بـ Supabase،
   ثم يفحص: البوابة، التبويبات، الإحصاءات، جدول المنتجات، جدول الطلبات
   (الخطأ القاتل سابقاً)، المحافظ، الاقتراحات، مفاتيح Supabase في الإعدادات.
   ========================================================================= */
'use strict';
const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');
const path = require('path');
const WS = path.resolve(__dirname, '..');

const errs = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errs.push(String(e.detail?.message || e.message).split('\n')[0]));

let pass = 0, fail = 0;
function chk(label, cond, extra = '') {
  if (cond) { pass++; console.log('  ✅ ' + label + (extra ? '  → ' + extra : '')); }
  else { fail++; console.log('  ❌ ' + label + (extra ? '  → ' + extra : '')); }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function run() {
  let html = fs.readFileSync(path.join(WS, 'admin.html'), 'utf-8');
  // نُبقي بوابة كلمة المرور لكن نُعطّلها عبر حقن كلمة سر معروفة؟ الأفضل: نفتح اللوحة مباشرة
  html = html.replace(/<script\b[^>]*\bsrc\s*=\s*"[^"]*"[^>]*>\s*<\/script>/gi, '');
  const boot = '<scr' + 'ipt>\n' + fs.readFileSync(path.join(WS, 'db.js'), 'utf-8') + '\n</scr' + 'ipt>'
             + '<scr' + 'ipt>\n' + fs.readFileSync(path.join(WS, 'admin.js'), 'utf-8') + '\n</scr' + 'ipt>';
  // ⚠️ يلزم دالة استبدال: النص يُفسِّر $$ كـ escape فيكسر const $$ في الكود
  html = html.replace(/<\/body>/, () => boot + '</body>');

  let createClient = null;
  try { ({ createClient } = require('@supabase/supabase-js')); } catch {}

  const dom = new JSDOM(html, {
    url: 'http://localhost:8080/admin.html',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      window.fetch = async (url) => {
        const u = String(url);
        if (!/^https?:/i.test(u)) {
          const f = path.join(WS, u.split('?')[0]);
          if (fs.existsSync(f) && fs.statSync(f).isFile()) {
            const b = fs.readFileSync(f, 'utf-8');
            return { ok: true, status: 200, json: async () => JSON.parse(b), text: async () => b };
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
      window.alert = () => {};
      window.confirm = () => true;
      window.prompt = () => '';
      window.innerWidth = 1280; window.innerHeight = 800;
    },
  });
  const { window } = dom;
  const { document } = window;
  const q = (s) => document.querySelector(s);
  const qa = (s) => Array.from(document.querySelectorAll(s));

  // انتظار شرطي: ننتظر حتى تُملأ الإحصاءات أو ينتهي المهلة (أدق من مدة ثابتة)
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    await wait(400);
    const stats = document.querySelector('#statTotalProducts')?.textContent?.trim();
    const panelOpen = document.querySelector('#adminApp') && !document.querySelector('#adminApp').classList.contains('hidden');
    if (panelOpen && stats && stats !== '—' && stats !== '0') break;
  }
  await wait(600);

  console.log('═══════ اختبار DOM الحقيقي (admin.html) ═══════');
  console.log('▸ أخطاء:', errs.length ? errs.slice(0, 5) : 'لا شيء');
  chk('لا أخطاء تشغيل', errs.length === 0, errs[0] ?? '');

  // البوابة: نُدخل كلمة المرور الافتراضية إن وُجدت، أو نتحقق من وجودها
  const gate = q('#gateScreen');
  const app = q('#adminApp');
  console.log('  ▸ بوابة ظاهرة:', gate && !gate.classList.contains('hidden') ? 'نعم' : 'لا');
  console.log('  ▸ اللوحة ظاهرة:', app && !app.classList.contains('hidden') ? 'نعم' : 'لا');

  // إن كانت البوابة ظاهرة، نحاول فتحها بكلمة المرور الافتراضية
  if (gate && !gate.classList.contains('hidden')) {
    const pw = q('#gatePass');
    for (const guess of ['admin', 'admin123', 'nova', '123456', '']) {
      pw.value = guess;
      q('#gateEnter').dispatchEvent(new window.Event('click', { bubbles: true }));
      await wait(300);
      if (q('#adminApp') && !q('#adminApp').classList.contains('hidden')) break;
    }
  }

  const panelOpen = q('#adminApp') && !q('#adminApp').classList.contains('hidden');
  chk('فتح اللوحة', panelOpen);

  if (panelOpen) {
    chk('طبقة DB', window.eval('typeof DB!=="undefined" && DB.getMode()') === 'supabase', window.eval('typeof DB!=="undefined" ? DB.getMode() : "?"'));
    await wait(1500);

    // الإحصاءات
    console.log('  ▸ statTotalProducts :', q('#statTotalProducts')?.textContent?.trim());
    console.log('  ▸ statOrders        :', q('#statOrders')?.textContent?.trim());
    console.log('  ▸ statPendingOrders :', q('#statPendingOrders')?.textContent?.trim());
    chk('إحصاء المنتجات > 0', Number(q('#statTotalProducts')?.textContent?.trim() || 0) > 0, q('#statTotalProducts')?.textContent?.trim());

    // جدول المنتجات
    const prodRows = qa('#productsTableBody tr').filter(r => !r.querySelector('.empty-state') && r.textContent.trim() && !/لا توجد/.test(r.textContent));
    chk('جدول المنتجات', prodRows.length === 7, prodRows.length + ' صف');

    // الانتقال للتبويبات وفحص كل واحد
    const tabs = ['wallets', 'orders', 'suggestions', 'settings', 'sync'];
    for (const t of tabs) {
      const btn = q('.admin-tab[data-tab="' + t + '"]');
      const panel = q('#panel-' + t);
      if (btn && panel) {
        btn.dispatchEvent(new window.Event('click', { bubbles: true }));
        await wait(600);
        chk('تبويب «' + t + '» يفتح', panel.classList.contains('active'), panel.classList.contains('active') ? 'ظاهر' : 'مخفي');
      } else {
        chk('تبويب «' + t + '» موجود', false, btn ? 'اللوحة ناقصة' : 'الزر ناقص');
      }
    }

    // 🎯 الأهم: اختبار الخطأ القاتل — دورة الطلب الكاملة عبر DOM الحقيقي
    console.log('  ─── دورة الطلب الكاملة (الخطأ القاتل سابقاً) ───');
    const dbApi = window.eval('DB');
    const st = JSON.parse(fs.readFileSync(path.join(WS, 'data/settings.json'), 'utf-8'));
    const restBase = st.supabaseUrl + '/rest/v1/orders';
    const restHeaders = { apikey: st.supabaseKey, Authorization: 'Bearer ' + st.supabaseKey, 'Content-Type': 'application/json' };
    const cleanup = async () => {
      try { await global.fetch(restBase + '?reference=like.DOM-*', { method: 'DELETE', headers: restHeaders }); } catch {}
    };
    await cleanup(); // نظّف أي بقايا من جولات سابقة

    const testRef = 'DOM-' + Date.now().toString(36).toUpperCase();
    let created = false;
    try {
      const res = await dbApi.saveOrder({
        reference: testRef,
        productId: 999,
        productName: 'منتج اختبار DOM',
        price: 9, currency: 'USD', discountCode: '', total: 9,
        methodKey: 'usdt', methodLabel: 'USDT', walletId: 'w1', walletEndpoint: 'TXabc',
        payerName: 'عاصم', payerRef: 'TXYZ', status: 'pending',
        licenseKey: '', createdAt: new Date().toISOString(), confirmedAt: null,
      });
      created = res?.ok === true;
      chk('إنشاء طلب تجريبي', created, res?.online ? 'أونلاين ✅' : 'محلي');
    } catch (e) {
      chk('إنشاء طلب تجريبي', false, e.message);
    }

    if (created) {
      await wait(1200);
      q('.admin-tab[data-tab="orders"]').dispatchEvent(new window.Event('click', { bubbles: true }));
      await wait(3500);
      const orderRows = qa('#ordersTableBody tr');
      const found = orderRows.some((r) => r.textContent.includes(testRef));
      console.log('    ▸ testRef المُتوقَّع:', testRef);
      console.log('    ▸ مراجع الصفوف  :', orderRows.map((r) => (r.textContent.match(/DOM-[A-Z0-9]+/) || ['—'])[0]).join(', '));
      console.log('    ▸ صفوف جدول الطلبات:', orderRows.length);
      orderRows.slice(0, 3).forEach((r, i) => console.log('      [' + i + ']', r.textContent.trim().replace(/\s+/g, ' ').slice(0, 72)));
      chk('🎯 الطلب يظهر للأدمن (أونلاين)', found, found ? 'ظاهر في الجدول ✅' : orderRows.length + ' صف بلا الطلب');

      // تأكيد الطلب وتسليم مفتاح
      if (found) {
        const row = orderRows.find((r) => r.textContent.includes(testRef));
        // الزر الصحيح هو data-approve — و«button» الأولى قد تكون زر نسخ آخر
        const confirmBtn = row.querySelector('[data-approve]');
        if (confirmBtn) {
          confirmBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
          await wait(2500);
          /* نتحقق عبر طبقة البيانات نفسها لا عبر REST مباشر.
             السبب: بعد تشديد سياسات RLS صار المفتاح العام **لا يقرأ** جدول
             الطلبات (وهذا مقصود أمنياً — وإلا سرد أي زائر طلبات الجميع).
             فالفحص عبر REST كان يفشل دائماً بلا أي علاقة بصحة الكود. */
          const rows2 = await window.eval('DB.getOrders()');
          const after = (rows2 || []).find((o) => o.reference === testRef) || {};
          const okConfirm = after.status === 'confirmed' || !!after.licenseKey;
          chk('تأكيد الطلب وسحب المفتاح', okConfirm,
              okConfirm ? 'الحالة: ' + after.status + ' · المفتاح: ' + (after.licenseKey || '—') : 'لم يتغير');
        } else {
          chk('تأكيد الطلب وسحب المفتاح', false, 'زر التأكيد غير موجود في الصف');
        }
      }

      await cleanup();
      await wait(500);
      const r2 = await global.fetch(restBase + '?reference=like.DOM-*&select=reference', { headers: restHeaders });
      const left = await r2.json().catch(() => []);
      chk('تنظيف بيانات الاختبار', !left.length, left.length ? left.length + ' باقٍ' : 'نظيف ✅');
    }

    // الأهم: هل مفاتيح Supabase ظاهرة في الإعدادات؟
    const urlField = q('#setSupabaseUrl');
    const keyField = q('#setSupabaseKey');
    chk('حقل Supabase URL موجود', !!urlField, urlField?.value?.slice(0, 32) ?? '—');
    chk('حقل Supabase Key موجود', !!keyField, keyField?.value ? 'مملوء ✅' : 'فارغ ❌');
    chk('المفاتيح مملوءة من settings.json', !!urlField?.value && !!keyField?.value);
  }

  console.log('═══════ النتيجة: ' + pass + ' ناجح / ' + fail + ' فاشل ═══════');
  window.close();
  process.exit(fail === 0 ? 0 : 1);
}

run().catch((e) => { console.error('CRASH:', e); process.exit(2); });
