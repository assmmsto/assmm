/* ==========================================================================
   طبقة البيانات الموحّدة — db.js
   ─────────────────────────────────────────────────────────────────────────
   تعمل بطريقتين تلقائياً:
   1) Supabase  — إن وُضع (supabaseUrl + supabaseKey) في الإعدادات → كل شيء أونلاين
   2) محلي      — JSON + localStorage → يعمل فوراً بدون أي إعداد
   الكود لا يتعطّل إن غاب المفتاح: يسقط تلقائياً إلى الوضع المحلي.
   ========================================================================== */
'use strict';

const DB = (() => {
  let client = null;
  let mode = 'local';
  let settings = {};

  /* ── التهيئة: تُستدعى بعد تحميل الإعدادات ── */
  function init(cfg) {
    settings = cfg ?? {};
    const url = String(settings.supabaseUrl ?? '').trim();
    const key = String(settings.supabaseKey ?? '').trim();
    if (url && key && typeof window.supabase !== 'undefined' && window.supabase.createClient) {
      try {
        client = window.supabase.createClient(url, key);
        mode = 'supabase';
        return mode;
      } catch (error) {
        console.warn('تعذّرت تهيئة Supabase — الانتقال للوضع المحلي:', error.message);
        client = null;
      }
    }
    mode = 'local';
    return mode;
  }

  const isOnline = () => mode === 'supabase' && client !== null;
  const getMode  = () => mode;

  /* ── أدوات التخزين المحلي (fallback) ── */
  function readLocal(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch { return fallback; }
  }
  function writeLocal(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (error) { console.error('فشل التخزين المحلي', error); return false; }
  }

  /* ══════════ المنتجات ══════════ */

  /* أعمدة المنتج — قائمة صريحة عمداً، وسبب ذلك خطأ صامت كان سيُسقط الموقع:
     بعد تشديد سياسات الأمان تُسحب صلاحية قراءة `licenseKeys` و`usedKeys` على
     مستوى العمود. وطلب `select('*')` يفشل **كلياً** في هذه الحالة
     (permission denied for column) — أي أن الصفحة كانت ستعرض كتالوجاً فارغاً
     أو تسقط للبيانات المحلية القديمة بلا أي رسالة.
     لذلك نطلب الأعمدة العامة صراحةً، ونضيف السرّية فقط للأدمن الموثّق. */
  const PRODUCT_PUBLIC_COLS = [
    'id', 'slug', 'name', 'short', 'long', 'type', 'kind', 'platform', 'price',
    'currency', 'version', 'features', 'installCommands', 'downloadUrl',
    'licenseMode', 'licenseNote', 'githubInviteUrl', 'demoUrl', 'previewImage',
    'status', 'featured', 'downloads', 'hiddenFields', 'paymentMethods',
  ];
  const PRODUCT_SECRET_COLS = ['licenseKeys', 'usedKeys'];

  /** يجلب المنتجات: من Supabase إن كان متصلاً، وإلا من data/products.json + المسودة المحلية
      @param {object} [options] — { withSecrets: true } لجلب مفاتيح الترخيص (للأدمن فقط) */
  async function getProducts(fallbackJson, options) {
    if (isOnline()) {
      const withSecrets = options?.withSecrets === true;
      const cols = PRODUCT_PUBLIC_COLS.concat(withSecrets ? PRODUCT_SECRET_COLS : []);
      try {
        const { data, error } = await client.from('products').select(cols.join(',')).order('id');
        if (!error && Array.isArray(data)) return data;
        console.warn('تعذّر جلب المنتجات من Supabase:', error?.message);
        // احتياط: إن كانت سياسات الأمان لم تُشغَّل بعد، جرّب الجلب الكامل.
        // (وإن كانت مُشغَّلة وسُحبت الأعمدة السرّية، يفشل هذا أيضاً — وهذا مقصود.)
        if (error && !withSecrets) {
          const retry = await client.from('products').select('*').order('id');
          if (!retry.error && Array.isArray(retry.data)) return retry.data;
        }
      } catch (error) {
        console.warn('خطأ شبكة أثناء جلب المنتجات:', error.message);
      }
    }
    // الوضع المحلي: المسودة أولاً ثم ملف JSON
    const draft = readLocal('nova_products_draft', null);
    if (Array.isArray(draft?.products)) return draft.products;
    return fallbackJson ?? [];
  }

  /** يحفظ منتجاً (إضافة أو تحديث) */
  async function saveProduct(product) {
    if (isOnline()) {
      try {
        // withoutEmptyKeys تحمي مخزون الترخيص من المحو بمصفوفة فارغة (شرحها أدناه)
      const row = withoutEmptyKeys(product, 0);
      const { error } = await client.from('products').upsert(row, { onConflict: 'id' });
        if (!error) return { ok: true };
        console.warn('تعذّر حفظ المنتج في Supabase:', error.message);
      } catch (error) { console.warn('خطأ شبكة أثناء حفظ المنتج:', error.message); }
    }
    // محلياً: الكود الحالي في admin.js يتولى الحفظ عبر persistProductsDraft
    return { ok: false, local: true };
  }

  /** يحذف منتجاً */
  async function deleteProduct(id) {
    if (isOnline()) {
      try {
        const { error } = await client.from('products').delete().eq('id', id);
        if (!error) return { ok: true };
      } catch (error) { console.warn('خطأ أثناء الحذف:', error.message); }
    }
    return { ok: false, local: true };
  }

  /** يزيد عدّاد تحميلات منتج — يستخدم دالة قاعدة ذرّية إن وُجدت.
      ملاحظة: يفشل بصمت إن كانت سياسات RLS تمنع الكتابة (وهذا متوقّع بعد
      تشديد الأمان) — العدد المحلي يعمل دائماً، فلا تُعطَّل تجربة الزائر. */
  async function incrementDownload(productId) {
    if (!isOnline()) return { ok: false, local: true };
    try {
      const { error } = await client.rpc('increment_product_downloads', { pid: productId });
      if (!error) return { ok: true };
      console.warn('تعذّر ترحيل عدّاد التحميل:', error.message);
    } catch (error) { console.warn('خطأ شبكة في عدّاد التحميل:', error.message); }
    return { ok: false, local: true };
  }

  /* ══════════ الطلبات ══════════ */

  /** يجلب الطلبات */
  async function getOrders() {
    if (isOnline()) {
      try {
        const { data, error } = await client.from('orders').select('*').order('id', { ascending: false });
        if (!error && Array.isArray(data)) return data;
      } catch (error) { console.warn('خطأ أثناء جلب الطلبات:', error.message); }
    }
    return readLocal('nova_purchases', []);
  }

  /* أعمدة كل جدول — تُصفَّى قبل الإرسال:
     PostgREST يرفض الإدراج كلياً (PGRST204) إن وُجد حقل واحد غير موجود كعمود. */
  const ORDER_COLS = ['reference', 'productId', 'productName', 'price', 'currency',
    'discountCode', 'total', 'methodKey', 'methodLabel', 'walletId', 'walletEndpoint',
    'payerName', 'payerRef', 'payerEmail', 'status', 'licenseKey', 'createdAt', 'confirmedAt',
    'rejectReason'];

  function pick(row, cols) {
    const out = {};
    cols.forEach((c) => { if (row[c] !== undefined) out[c] = row[c]; });
    return out;
  }

  /* ── إدراج مرن: يتراجع تلقائياً عن أي عمود غير موجود في مخطط القاعدة ──
     سبب وجوده — خطأ حقيقي وقع وكان يُفقد كل طلب جديد بصمت:
     كان `payerEmail` مذكوراً في ORDER_COLS قبل إضافة العمود في القاعدة، فصار
     كل إدراج يفشل بـ PGRST204 ثم يسقط إلى التخزين المحلي بلا أي رسالة خطأ
     في الواجهة. النتيجة: المشتري يرى «تم إرسال طلبك» والأدمن لا يرى شيئاً.
     القاعدة الهندسية المطبَّقة: **لا تُفقد بيانات بصمت بسبب اختلاف مخطط.**
     الحل: نقرأ اسم العمود من رسالة الخطأ نفسها ونعيد المحاولة بدونه. */
  const MISSING_COL_PGRST = /could not find the '([^']+)' column/i;              // PGRST204
  const MISSING_COL_PG    = /column [A-Za-z0-9_]+\.([A-Za-z0-9_]+) does not exist/i; // 42703

  function missingColumn(message) {
    const text = String(message ?? '');
    const match = MISSING_COL_PGRST.exec(text) ?? MISSING_COL_PG.exec(text);
    return match ? match[1] : null;
  }

  /** يُدرج صفاً؛ وإن رفضته القاعدة لعمود غير موجود يحذفه ويعيد المحاولة.
      يعيد { ok, dropped, error } — و`dropped` يُسجَّل للتشخيص لا للإخفاء. */
  async function insertResilient(table, row, maxDrops = 3) {
    const payload = { ...row };
    const dropped = [];
    for (let attempt = 0; attempt <= maxDrops; attempt++) {
      const { error } = await client.from(table).insert(payload);
      if (!error) return { ok: true, dropped, error: null };
      const column = missingColumn(error.message);
      // لا نُكرّر المحاولة إلا إذا كان الخطأ فعلاً عن عمود موجود في حمولتنا
      if (!column || !(column in payload)) return { ok: false, dropped, error: error.message };
      delete payload[column];
      dropped.push(column);
      console.warn(`حقل «${column}» غير موجود في جدول ${table} — أُعيدت المحاولة بدونه.`);
    }
    return { ok: false, dropped, error: 'تجاوزنا عدد الحقول غير المعروفة' };
  }

  /** يحفظ طلباً جديداً.
      ملاحظة تصميمية مهمة: نكتب نسخة محلية **دائماً**، حتى لو نجح الحفظ أونلاين.
      السبب: النسخة المحلية هي إيصال المشتري — بها يتابع طلبه بلا إنترنت،
      وبها يبقى صندوق «متابعة الطلب» يعمل لو انقطعت القاعدة.
      (وقبل هذا التعديل كان النجاح أونلاين يمنع الكتابة المحلية، فبدا المشتري
      كأن طلبه لم يُحفظ — لأن الاختبار والواجهة كلاهما كان يقرأ المحلي.) */
  async function saveOrder(order) {
    let online = false;
    let dropped = [];
    if (isOnline()) {
      try {
        const result = await insertResilient('orders', pick(order, ORDER_COLS));
        if (result.ok) { online = true; dropped = result.dropped; }
        else console.warn('تعذّر حفظ الطلب في Supabase:', result.error);
      } catch (error) { console.warn('خطأ شبكة أثناء حفظ الطلب:', error.message); }
    }
    const orders = readLocal('nova_purchases', []);
    orders.push(order);
    writeLocal('nova_purchases', orders);
    return { ok: true, online, dropped };
  }

  /** يؤكد طلباً ويعيّن مفتاح الترخيص.
      مساران — لأن صلاحيات القاعدة تفرّق بينهما:
        · **بسرّ** (من اللوحة) → دالة `admin_confirm_order` بصلاحيات المالك.
          تعمل ولو كان المستخدم «زائر» — لأنها لا تحتاج صلاحيات الجدول.
        · **بلا سرّ** → تحديث الجدول مباشرة. يحتاج جلسة موثّقة (Supabase Auth).

      يعيد { ok, online, via, reason } — و`online:false` تعني أن الكتابة لم تصل
      للقاعدة، فالواجهة **يجب** أن تقول ذلك للأدمن بدل رسالة نجاح كاذبة. */
  async function confirmOrder(reference, licenseKey, options) {
    const secret = String(options?.secret ?? '').trim();
    const stamp = new Date().toISOString();
    let reason = null;
    let online = false;
    let via = null;
    let deliveryStored = false;  // هل حُفظ رابط التسليم على الطلب؟

    if (!isOnline()) reason = 'offline';

    /* ── المسار ١: السرّ (يعمل للزائر) ──
       يُرسل معه رابط التسليم وملاحظته — فيُكتبان على **الطلب** لا على الكتالوج
       العام. وهذا ما يمنع تسريب رابط منتج مدفوع في ملف منشور.

       ⚠️ توافق خلفي: إن كانت القاعدة ما زالت تحمل النسخة القديمة (٣ معاملات)
       نُعيد المحاولة بها — فلا يتعطّل التأكيد عند من لم يُحدِّث بعد. ونُعلن
       `deliveryStored: false` لتعرف الواجهة أن رابط التسليم لم يُحفظ. */
    if (isOnline() && secret) {
      const args = {
        p_ref: reference,
        p_key: licenseKey ?? '',
        p_secret: secret,
        p_delivery_url: String(options?.deliveryUrl ?? ''),
        p_delivery_note: String(options?.deliveryNote ?? ''),
      };
      const isMissing = (msg) => /does not exist|Could not find the function|schema cache|404/i.test(String(msg));

      try {
        let { data, error } = await client.rpc('admin_confirm_order', args);

        if (error && isMissing(error.message)) {
          const legacy = await client.rpc('admin_confirm_order', {
            p_ref: args.p_ref, p_key: args.p_key, p_secret: args.p_secret,
          });
          if (!legacy.error && legacy.data === true) {
            online = true; via = 'secret'; deliveryStored = false;
            console.warn('القاعدة على النسخة القديمة من دالة التأكيد — رابط التسليم لم يُحفظ. شغّل supabase-final.sql.');
          } else if (legacy.error) {
            reason = isMissing(legacy.error.message) ? 'rpc-missing' : 'db-error';
            console.warn('تعذّر التأكيد بالسرّ:', legacy.error.message, '| reason =', reason);
          } else {
            reason = 'no-such-order';
          }
        } else if (!error && data === true) {
          online = true; via = 'secret'; deliveryStored = true;
        } else if (error) {
          // أخطاء المفاتيح أسباب مستقلة يعرفها admin.js — لا تُخلط بـ db-error
          const msg = String(error.message);
          const keyErr = msg.match(/license-key-(required|invalid|used)/);
          reason = keyErr ? keyErr[0]
            : (/unauthorized/i.test(msg) ? 'bad-secret'
            : (isMissing(msg) ? 'rpc-missing' : 'db-error'));
          console.warn('تعذّر التأكيد بالسرّ:', error.message, '| reason =', reason);
        } else {
          // الدالة عملت ولم تُحدِّث شيئاً ⇒ لا طلب بهذا المرجع
          reason = 'no-such-order';
        }
      } catch (error) {
        reason = 'network';
        console.warn('خطأ شبكة أثناء التأكيد بالسرّ:', error.message);
      }
    }

    /* ── المسار ٢: تحديث مباشر (يحتاج موثّقاً) ──
       يُجرَّب إن لم يُمرَّر سرّ، أو إن كان السرّ مُمرَّراً والدالة غير مُنشأة
       بعد — فلا يتعطّل الأدمن الموثّق بسبب سرّ لم يُضبط. */
    if (isOnline() && !online && (!secret || reason === 'rpc-missing')) {
      try {
        const { error } = await client.from('orders')
          .update({ status: 'confirmed', licenseKey, confirmedAt: stamp })
          .eq('reference', reference);
        if (!error) { online = true; via = 'auth'; reason = null; }
        else {
          /* نميّز سببين مختلفين تماماً — وخلطهما كان يرسل الأدمن إلى الحل الخطأ:
             · needs-auth : أنت «anon»، والسياسة تسمح للموثّقين ⇒ الحل مصادقة Supabase.
             · rls        : أنت موثّق ومع ذلك رُفضت ⇒ مشكلة في السياسات نفسها. */
          const denied = /row-level security|policy|permission|denied|JWT|401|403/i.test(String(error.message));
          reason = denied ? (authReady() ? 'rls' : 'needs-auth') : 'db-error';
          console.warn('تعذّر تأكيد الطلب في القاعدة:', error.message, '| reason =', reason);
        }
      } catch (error) {
        reason = 'network';
        console.warn('خطأ شبكة أثناء تأكيد الطلب:', error.message);
      }
    }

    // الإيصال المحلي يُحدَّث دائماً — للاتساق في نفس المتصفح، ولأن الأدمن
    // يحتاج رؤية ما أكّده حتى لو رفضت القاعدة الكتابة.
    const orders = readLocal('nova_purchases', []);
    const order = orders.find((o) => o.reference === reference);
    if (order) {
      order.status = 'confirmed';
      order.licenseKey = licenseKey;
      order.confirmedAt = stamp;
      writeLocal('nova_purchases', orders);
    }
    return { ok: true, online, via, reason, deliveryStored };
  }

  /** يرفض الأدمن طلباً — سبب الرفض **إجباري** ويصل للمشتري عبر صفحة الطلبات.
      يعيد { ok, online, via, reason } — بنفس أعراف confirmOrder:
      إن كان ok:true مع online:false فالرفض محفوظ محلياً فقط (القاعدة رفضته)،
      والواجهة يجب أن تقول ذلك بدل رسالة نجاح كاذبة. */
  async function rejectOrder(reference, rejectReason, options) {
    const secret = String(options?.secret ?? '').trim();
    let reason = null;
    let online = false;
    let via = null;

    if (!isOnline()) reason = 'offline';

    if (isOnline() && secret) {
      try {
        const { data, error } = await client.rpc('admin_reject_order', {
          p_ref: reference,
          p_secret: secret,
          p_reason: String(rejectReason ?? ''),
        });
        if (!error && data === true) { online = true; via = 'secret'; }
        else if (error) {
          const msg = String(error.message);
          reason = /reason-required/i.test(msg) ? 'reason-required'
            : (/reason-too-short/i.test(msg) ? 'reason-too-short'
            : (/unauthorized/i.test(msg) ? 'bad-secret'
            : (isMissing(msg) ? 'rpc-missing' : 'db-error')));
          console.warn('تعذّر رفض الطلب:', error.message, '| reason =', reason);
        } else {
          reason = 'no-such-order';   // لا طلب قيد المراجعة بهذا المرجع
        }
      } catch (error) {
        reason = 'network';
        console.warn('خطأ شبكة أثناء رفض الطلب:', error.message);
      }
    }

    if (!online && (!secret || reason === 'rpc-missing')) {
      try {
        const { error } = await client.from('orders')
          .update({ status: 'rejected', rejectReason: String(rejectReason ?? ''), confirmedAt: null, licenseKey: '' })
          .eq('reference', reference).eq('status', 'pending');
        if (!error) { online = true; via = 'auth'; reason = null; }
        else {
          const denied = /row-level security|policy|permission|denied|JWT|401|403/i.test(String(error.message));
          reason = denied ? (authReady() ? 'rls' : 'needs-auth') : 'db-error';
        }
      } catch { reason = 'network'; }
    }

    // الإيصال المحلي يُحدَّث دائماً — كما في confirmOrder
    const orders = readLocal('nova_purchases', []);
    const order = orders.find((o) => o.reference === reference);
    if (order) {
      order.status = 'rejected';
      order.rejectReason = String(rejectReason ?? '');
      order.licenseKey = '';
      order.confirmedAt = null;
      writeLocal('nova_purchases', orders);
    }
    return { ok: true, online, via, reason };
  }

  /** يجلب طلباً واحداً برقم المرجع.
      يعيد { order, source, reason }:
        source = 'db'    → قراءة موثوقة من القاعدة (الدالة الآمنة)
        source = 'local' → إيصال المشتري المحلي فقط — قد يكون قديماً
        order  = null    → لا يوجد طلب بهذا المرجع

      ⚠️ سبب وجود `source` — هذا كان سبب عطل حقيقي:
      كان السقوط إلى الإيصال المحلي **صامتاً**. فالمشتري يرى إيصاله المحلي
      بحالة «pending» إلى الأبد حتى بعد أن يؤكد الأدمن الطلب في القاعدة —
      فيظن أن الموافقة لم تصل، بينما هي وصلت ولم يستطع أحد قراءتها.
      الآن تُسمّى الحالة بمصدرها، فلا يبقى الزائر في حيرة.

      الطريقة المفضّلة: دالة `get_order_by_reference` المُعرَّفة بأمان — تُعيد
      صفاً واحداً بمرجعه بلا حاجة إلى صلاحية قراءة الجدول كله. وهذا تحديداً ما
      يمنع أي زائر من سرد كل الطلبات وأسماء المشترين وإثباتات دفعهم. */
  async function getOrder(reference) {
    const localOrder = readLocal('nova_purchases', []).find((o) => o.reference === reference) ?? null;
    const asLocal = (reason) => ({ order: localOrder, source: localOrder ? 'local' : null, reason });

    if (!isOnline()) return asLocal('offline');

    try {
      const { data, error } = await client.rpc('get_order_by_reference', { ref: reference });
      if (!error && Array.isArray(data) && data.length) {
        return { order: data[0], source: 'db', reason: null };
      }
      if (error) {
        console.warn('تعذّر جلب الطلب عبر الدالة الآمنة:', error.message);
        // الدالة غائبة ⇒ إصلاح الأمان لم يُشغَّل بعد. لا نُخفي ذلك عن الواجهة.
        const missing = /does not exist|schema cache|Could not find the function|404/i.test(String(error.message));
        return asLocal(missing ? 'rpc-missing' : 'rpc-error');
      }
      // الدالة عملت وأعادت صفراً ⇒ لا طلب بهذا المرجع في القاعدة
      return asLocal('not-on-db');
    } catch (error) {
      console.warn('خطأ شبكة أثناء جلب الطلب:', error.message);
      return asLocal('network');
    }
  }

  /* ══════════ الاقتراحات ══════════ */

  async function getSuggestions() {
    if (isOnline()) {
      try {
        const { data, error } = await client.from('suggestions').select('*').order('id', { ascending: false });
        if (!error && Array.isArray(data)) return data;
      } catch (error) { console.warn('خطأ أثناء جلب الاقتراحات:', error.message); }
    }
    return readLocal('nova_suggestions', []);
  }

  async function saveSuggestion(suggestion) {
    if (isOnline()) {
      try {
        // إدراج مرن أيضاً: أي حقل زائد من الواجهة لا يُسقط الاقتراح كله
        const result = await insertResilient('suggestions', { ...suggestion }, 2);
        if (result.ok) return { ok: true, online: true };
        console.warn('تعذّر حفظ الاقتراح في Supabase:', result.error);
      } catch (error) { console.warn('خطأ أثناء حفظ الاقتراح:', error.message); }
    }
    const list = readLocal('nova_suggestions', []);
    list.push(suggestion);
    writeLocal('nova_suggestions', list);
    return { ok: true, online: false };
  }

  async function deleteSuggestion(id) {
    if (isOnline()) {
      try {
        const { error } = await client.from('suggestions').delete().eq('id', id);
        if (!error) return { ok: true };
      } catch (error) { console.warn('خطأ أثناء حذف الاقتراح:', error.message); }
    }
    writeLocal('nova_suggestions', readLocal('nova_suggestions', []).filter((s) => s.id !== id));
    return { ok: true };
  }

  /* ══════════ ترحيل البيانات (مرة واحدة) ══════════ */

  /** يرفع المنتجات الحالية من JSON إلى Supabase — يُستدعى من زر في اللوحة
      ⚠️ حماية مهمة: لا نرسل `licenseKeys`/`usedKeys` فارغتين أبداً.
      الفرق جوهري: **غياب الحقل** من الحمولة يعني «لا تلمس العمود»،
      بينما **مصفوفة فارغة** تعني «امسح كل المفاتيح». ولأن المفاتيح لم تعد
      موجودة في data/products.json (حمايةً لها)، فإن نموذج الأدمن يقرأها
      فارغة — ولو أرسلناها كما هي لمحونا مخزون الترخيص كله بصمت. */
  function withoutEmptyKeys(product, index) {
    const row = { ...product, id: product.id ?? index + 1 };
    for (const field of ['licenseKeys', 'usedKeys']) {
      if (!Array.isArray(row[field]) || row[field].length === 0) delete row[field];
    }
    return row;
  }

  async function migrateProducts(products) {
    if (!isOnline()) return { ok: false, reason: 'غير متصل' };
    try {
      const rows = products.map(withoutEmptyKeys);
      const { error } = await client.from('products').upsert(rows, { onConflict: 'id' });
      if (error) return { ok: false, reason: error.message };
      return { ok: true, count: rows.length };
    } catch (error) {
      return { ok: false, reason: error.message };
    }
  }

  /** يتحقق من وجود الجداول ويعيد أسماءها */
  async function testConnection() {
    if (!isOnline()) return { ok: false, reason: 'لا يوجد مفتاح — الوضع محلي' };
    try {
      const { error } = await client.from('products').select('id').limit(1);
      if (error) return { ok: false, reason: error.message };
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: error.message };
    }
  }

  /* ══════════ مصادقة الأدمن (Supabase Auth) ══════════
     لماذا؟ بوابة لوحة الأدمن الحالية محلية بالكامل: أول زائر يفتح admin.html
     ينشئ كلمة مرور بنفسه ويدخل — لا يوجد أي تحقّق على الخادم. وهي لا تحمي
     شيئاً إلا إن كانت سياسات RLS مقيّدة، وحينها يحتاج الأدمن هو نفسه هوية
     حقيقية ليتمكّن من الكتابة.
     الحل: مصادقة حقيقية عبر Supabase Auth. تُفعَّل تلقائياً بمجرد ضبط
     `adminEmail` في settings.json + إنشاء المستخدم في لوحة Supabase.
     وإن لم تُضبط: يعمل كل شيء كما كان (بوابة محلية) بلا أي تعطّل. */

  const authReady = () => isOnline() && Boolean(String(settings.adminEmail ?? '').trim());

  /** يسجّل دخول الأدمن — يعيد { ok, error } */
  async function signIn(email, password) {
    if (!isOnline()) return { ok: false, error: 'القاعدة غير متصلة' };
    try {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) return { ok: false, error: error.message };
      return { ok: true, user: data?.user ?? null };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  async function signOut() {
    if (!isOnline()) return { ok: true };
    try { await client.auth.signOut(); return { ok: true }; }
    catch (error) { return { ok: false, error: error.message }; }
  }

  /** الجلسة الحالية — تُستدعى عند فتح اللوحة لمعرفة إن كان الأدمن مسجَّلاً */
  async function getSession() {
    if (!isOnline()) return null;
    try {
      const { data } = await client.auth.getSession();
      return data?.session ?? null;
    } catch { return null; }
  }

  return {
    init, getMode, isOnline, authReady, signIn, signOut, getSession,
    getProducts, saveProduct, deleteProduct, incrementDownload,
    getOrders, saveOrder, confirmOrder, rejectOrder, getOrder,
    getSuggestions, saveSuggestion, deleteSuggestion,
    migrateProducts, testConnection,
  };
})();
