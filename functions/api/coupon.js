// ========== Cloudflare Pages Function: 优惠券管理 v2 ==========
// v2 变更：去重限制改为按 coupon_id + source，分享券可裂变，用券时标记已使用+关联订单

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

function cleanPhone(phone) {
  return (phone || '').replace(/\s/g, '');
}

function phoneValid(phone) {
  return /^1[3-9]\d{9}$/.test(phone);
}

// POST /api/coupon — 领取优惠券
// Body: { phone, couponId, couponName, amount, condition, expireDays, referrerPhone? }
//   referrerPhone 仅分享券需要，用于裂变奖励推荐人
export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.DB) return jsonResponse({ success: false, message: '数据库不可用' }, 503);

  try {
    const body = await request.json();
    const { phone, couponId, referrerPhone } = body;
    const clean = cleanPhone(phone);

    if (!clean || !couponId) return jsonResponse({ success: false, message: '缺少参数' }, 400);
    if (!phoneValid(clean)) return jsonResponse({ success: false, message: '手机号格式不正确' }, 400);

    // ===== 普通券（new / return）：同手机号同 coupon_id 只能领1张 =====
    // 通过检查是否已有未使用的同类型券
    const existing = await env.DB.prepare(
      'SELECT id, used, expire_at FROM coupon_claims WHERE phone = ? AND coupon_id = ? AND used = 0 AND expire_at > ?'
    ).bind(clean, couponId, new Date().toISOString()).first();

    if (existing) {
      return jsonResponse({ success: false, message: '你已经有一张未使用的该优惠券', alreadyClaimed: true });
    }

    // 写入领取记录
    const expireDays = body.expireDays || 7;
    const expireAt = new Date(Date.now() + expireDays * 24 * 60 * 60 * 1000).toISOString();

    await env.DB.prepare(
      'INSERT INTO coupon_claims (phone, coupon_id, coupon_name, amount, condition_amount, expire_at, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      clean, couponId, body.couponName || '', body.amount || 0, body.condition || 0,
      expireAt, 'self', new Date().toISOString()
    ).run();

    const claim = {
      couponId,
      couponName: body.couponName,
      amount: body.amount,
      condition: body.condition,
      expireAt,
      used: false
    };

    // ===== 分享裂变：如果领的是分享券，且有推荐人手机号，奖励推荐人1张分享券 =====
    let rewardResult = null;
    if (couponId === 'share' && referrerPhone) {
      const refClean = cleanPhone(referrerPhone);
      // 推荐人不能是自己
      if (refClean !== clean && phoneValid(refClean)) {
        // 奖励推荐人1张分享券
        const rewardExpireAt = new Date(Date.now() + expireDays * 24 * 60 * 60 * 1000).toISOString();
        await env.DB.prepare(
          'INSERT INTO coupon_claims (phone, coupon_id, coupon_name, amount, condition_amount, expire_at, source, referrer_of_phone, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(
          refClean, 'share', '分享立减', 50, 300,
          rewardExpireAt, 'share_reward', clean, new Date().toISOString()
        ).run();
        rewardResult = { rewardPhone: refClean, rewardCoupon: 'share' };
      }
    }

    return jsonResponse({ success: true, message: '领取成功', claim, reward: rewardResult });

  } catch (e) {
    console.error('Coupon claim error:', e.message || e);
    return jsonResponse({ success: false, message: '服务器错误' }, 500);
  }
}

// PUT /api/coupon — 使用优惠券（订单提交时调用）
// Body: { phone, couponId, orderId }
export async function onRequestPut(context) {
  const { request, env } = context;
  if (!env.DB) return jsonResponse({ success: false, message: '数据库不可用' }, 503);

  try {
    const body = await request.json();
    const { phone, couponId, orderId } = body;
    const clean = cleanPhone(phone);

    if (!clean || !couponId || !orderId) return jsonResponse({ success: false, message: '缺少参数' }, 400);

    // 找到该用户一张未使用、未过期的该优惠券
    const coupon = await env.DB.prepare(
      'SELECT id FROM coupon_claims WHERE phone = ? AND coupon_id = ? AND used = 0 AND expire_at > ?'
    ).bind(clean, couponId, new Date().toISOString()).first();

    if (!coupon) {
      return jsonResponse({ success: false, message: '没有可用的优惠券' });
    }

    // 标记为已使用，关联订单号
    await env.DB.prepare(
      'UPDATE coupon_claims SET used = 1, used_order_id = ?, used_at = ? WHERE id = ?'
    ).bind(orderId, new Date().toISOString(), coupon.id).run();

    // 如果是分享券（被推荐人使用），检查推荐人是否还有分享奖励待发放
    // （推荐人奖励在领取时就已发放，此处不需要额外操作）

    return jsonResponse({ success: true, message: '优惠券已使用' });

  } catch (e) {
    console.error('Coupon use error:', e.message || e);
    return jsonResponse({ success: false, message: '服务器错误' }, 500);
  }
}

// GET /api/coupon?phone=xxx — 查询可用优惠券（未使用+未过期）
// GET /api/coupon?action=init — 初始化/升级表结构
export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const action = url.searchParams.get('action');
  const phone = url.searchParams.get('phone');

  if (!env.DB) return jsonResponse({ success: false, message: '数据库不可用' }, 503);

  // 初始化表结构
  if (action === 'init') {
    try {
      // v2 表：增加 source, referrer_of_phone, used_at 字段
      await env.DB.exec(
        'CREATE TABLE IF NOT EXISTS coupon_claims (id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT NOT NULL, coupon_id TEXT NOT NULL, coupon_name TEXT, amount INTEGER DEFAULT 0, condition_amount INTEGER DEFAULT 0, expire_at TEXT, used INTEGER DEFAULT 0, used_order_id TEXT, used_at TEXT, source TEXT DEFAULT \'self\', referrer_of_phone TEXT, created_at TEXT)'
      );
      // 为旧表补充新列（如果缺失）
      try { await env.DB.exec('ALTER TABLE coupon_claims ADD COLUMN source TEXT DEFAULT \'self\''); } catch(e) {}
      try { await env.DB.exec('ALTER TABLE coupon_claims ADD COLUMN referrer_of_phone TEXT'); } catch(e) {}
      try { await env.DB.exec('ALTER TABLE coupon_claims ADD COLUMN used_at TEXT'); } catch(e) {}
      return jsonResponse({ success: true, message: 'coupon_claims v2 表已就绪' });
    } catch (e) {
      return jsonResponse({ success: false, message: '建表失败: ' + e.message }, 500);
    }
  }

  // 查询可用优惠券（未使用+未过期）
  if (phone) {
    try {
      const clean = cleanPhone(phone);
      const now = new Date().toISOString();

      // 查未使用的
      const available = await env.DB.prepare(
        'SELECT coupon_id, coupon_name, amount, condition_amount, expire_at, source, id FROM coupon_claims WHERE phone = ? AND used = 0 AND expire_at > ?'
      ).bind(clean, now).all();

      const coupons = available.results.map(row => ({
        id: row.coupon_id,
        name: row.coupon_name,
        amount: row.amount,
        condition: row.condition_amount,
        expireAt: row.expire_at,
        used: false,
        source: row.source,
        dbId: row.id
      }));

      // 查已使用的（最近5条，用于展示历史）
      const used = await env.DB.prepare(
        'SELECT coupon_id, coupon_name, amount, condition_amount, used_order_id, used_at FROM coupon_claims WHERE phone = ? AND used = 1 ORDER BY used_at DESC LIMIT 5'
      ).bind(clean).all();

      const usedCoupons = used.results.map(row => ({
        id: row.coupon_id,
        name: row.coupon_name,
        amount: row.amount,
        orderId: row.used_order_id,
        usedAt: row.used_at
      }));

      return jsonResponse({ success: true, coupons, usedCoupons });
    } catch (e) {
      return jsonResponse({ success: false, message: '查询失败' }, 500);
    }
  }

  return jsonResponse({ success: false, message: '缺少参数' }, 400);
}
