// ========== Cloudflare Pages Function: 优惠券管理 v2 (多租户版) ==========
// v2 变更：去重限制改为按 coupon_id + source，分享券可裂变，用券时标记已使用+关联订单
// 多租户：所有查询通过 hotel_id 隔离

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

// 从请求中解析 hotel_id
// 优先级：Token员工身份 > URL参数 > Header > Referer > 默认
async function resolveHotelId(env, request) {
  // 1. 如果是员工账号，强制使用 token 中的 hotelId（数据隔离）
  const authRole = request.headers.get('X-Auth-Role');
  const authHotelId = request.headers.get('X-Auth-HotelId');
  if (authRole === 'hotel' && authHotelId) {
    return parseInt(authHotelId);
  }

  // 2. URL 参数
  const url = new URL(request.url);
  let hotelId = url.searchParams.get('hotelId');

  // 3. 请求头
  if (!hotelId) {
    hotelId = request.headers.get('X-Hotel-Id');
  }

  // 4. Referer
  if (!hotelId) {
    const referer = request.headers.get('Referer') || '';
    if (referer) {
      try {
        const refUrl = new URL(referer);
        hotelId = refUrl.searchParams.get('hotelId');
        if (!hotelId) {
          const slug = refUrl.searchParams.get('hotel');
          if (slug) {
            const hotel = await env.DB.prepare('SELECT id FROM hotels WHERE slug = ?').bind(slug).first();
            if (hotel) hotelId = hotel.id;
          }
        }
      } catch(e) {}
    }
  }

  // 5. 默认
  if (!hotelId) {
    const hotel = await env.DB.prepare('SELECT id FROM hotels WHERE active = 1 ORDER BY id ASC LIMIT 1').first();
    return hotel ? hotel.id : 1;
  }

  const id = parseInt(hotelId);
  return isNaN(id) ? 1 : id;
}

// POST /api/coupon — 领取优惠券
// Body: { phone, couponId, couponName, amount, condition, expireDays, hotelId?, referrerPhone? }
export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.DB) return jsonResponse({ success: false, message: '数据库不可用' }, 503);

  try {
    const body = await request.json();
    const { phone, couponId, referrerPhone } = body;
    const clean = cleanPhone(phone);

    if (!clean || !couponId) return jsonResponse({ success: false, message: '缺少参数' }, 400);
    if (!phoneValid(clean)) return jsonResponse({ success: false, message: '手机号格式不正确' }, 400);

    const hotelId = body.hotelId || await resolveHotelId(env, request);

    // 校验优惠券模板存在且有效（支持 private 券通过分享链接领取）
    const template = await env.DB.prepare(
      'SELECT id, visibility, status FROM coupon_templates WHERE hotel_id = ? AND coupon_id = ?'
    ).bind(hotelId, couponId).first();
    if (!template) return jsonResponse({ success: false, message: '优惠券不存在' }, 404);
    if (template.status !== 'active') return jsonResponse({ success: false, message: '优惠券已失效' }, 400);

    // 检查是否已有未使用的同类型券（同酒店内）
    const existing = await env.DB.prepare(
      'SELECT id, used, expire_at FROM coupon_claims WHERE hotel_id = ? AND phone = ? AND coupon_id = ? AND used = 0 AND expire_at > ?'
    ).bind(hotelId, clean, couponId, new Date().toISOString()).first();

    if (existing) {
      return jsonResponse({ success: false, message: '你已经有一张未使用的该优惠券', alreadyClaimed: true });
    }

    // 写入领取记录
    const expireDays = body.expireDays || 7;
    const expireAt = new Date(Date.now() + expireDays * 24 * 60 * 60 * 1000).toISOString();

    await env.DB.prepare(
      'INSERT INTO coupon_claims (hotel_id, phone, coupon_id, coupon_name, amount, condition_amount, expire_at, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      hotelId, clean, couponId, body.couponName || '', body.amount || 0, body.condition || 0,
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

    // 分享裂变
    let rewardResult = null;
    if (couponId === 'share' && referrerPhone) {
      const refClean = cleanPhone(referrerPhone);
      if (refClean !== clean && phoneValid(refClean)) {
        const rewardExpireAt = new Date(Date.now() + expireDays * 24 * 60 * 60 * 1000).toISOString();
        await env.DB.prepare(
          'INSERT INTO coupon_claims (hotel_id, phone, coupon_id, coupon_name, amount, condition_amount, expire_at, source, referrer_of_phone, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(
          hotelId, refClean, 'share', '分享立减', 50, 300,
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

// PUT /api/coupon — 使用优惠券
// Body: { phone, couponId, orderId, hotelId? }
export async function onRequestPut(context) {
  const { request, env } = context;
  if (!env.DB) return jsonResponse({ success: false, message: '数据库不可用' }, 503);

  try {
    const body = await request.json();
    const { phone, couponId, orderId } = body;
    const clean = cleanPhone(phone);

    if (!clean || !couponId || !orderId) return jsonResponse({ success: false, message: '缺少参数' }, 400);

    const hotelId = body.hotelId || await resolveHotelId(env, request);

    const coupon = await env.DB.prepare(
      'SELECT id FROM coupon_claims WHERE hotel_id = ? AND phone = ? AND coupon_id = ? AND used = 0 AND expire_at > ?'
    ).bind(hotelId, clean, couponId, new Date().toISOString()).first();

    if (!coupon) {
      return jsonResponse({ success: false, message: '没有可用的优惠券' });
    }

    await env.DB.prepare(
      'UPDATE coupon_claims SET used = 1, used_order_id = ?, used_at = ? WHERE id = ?'
    ).bind(orderId, new Date().toISOString(), coupon.id).run();

    return jsonResponse({ success: true, message: '优惠券已使用' });

  } catch (e) {
    console.error('Coupon use error:', e.message || e);
    return jsonResponse({ success: false, message: '服务器错误' }, 500);
  }
}

// GET /api/coupon?phone=xxx&hotelId=1 — 查询可用优惠券
// GET /api/coupon?action=init — 初始化/升级表结构
export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const action = url.searchParams.get('action');
  const phone = url.searchParams.get('phone');

  if (!env.DB) return jsonResponse({ success: false, message: '数据库不可用' }, 503);

  // 老客召回券信息查询（无需登录，用于分享链接预览）
  if (action === 'recall_info') {
    try {
      const couponId = url.searchParams.get('couponId');
      const hotelId = parseInt(url.searchParams.get('hotelId')) || await resolveHotelId(env, request);
      if (!couponId) return jsonResponse({ success: false, message: '缺少 couponId' }, 400);
      const tmpl = await env.DB.prepare(
        'SELECT coupon_id, name, amount, condition_amount, expire_days, visibility, status FROM coupon_templates WHERE hotel_id = ? AND coupon_id = ?'
      ).bind(hotelId, couponId).first();
      if (!tmpl || tmpl.status !== 'active' || tmpl.visibility !== 'private') {
        return jsonResponse({ success: false, message: '优惠券不存在或已失效' }, 404);
      }
      return jsonResponse({ success: true, coupon: { id: tmpl.coupon_id, name: tmpl.name, amount: tmpl.amount, condition: tmpl.condition_amount, expire: tmpl.expire_days } });
    } catch(e) {
      return jsonResponse({ success: false, message: '查询失败' }, 500);
    }
  }

  // 初始化表结构
  if (action === 'init') {
    try {
      await env.DB.exec(
        'CREATE TABLE IF NOT EXISTS coupon_claims (id INTEGER PRIMARY KEY AUTOINCREMENT, hotel_id INTEGER NOT NULL DEFAULT 1, phone TEXT NOT NULL, coupon_id TEXT NOT NULL, coupon_name TEXT, amount INTEGER DEFAULT 0, condition_amount INTEGER DEFAULT 0, expire_at TEXT, used INTEGER DEFAULT 0, used_order_id TEXT, used_at TEXT, source TEXT DEFAULT \'self\', referrer_of_phone TEXT, created_at TEXT, FOREIGN KEY (hotel_id) REFERENCES hotels(id))'
      );
      // 为旧表补充新列
      try { await env.DB.exec('ALTER TABLE coupon_claims ADD COLUMN hotel_id INTEGER NOT NULL DEFAULT 1'); } catch(e) {}
      try { await env.DB.exec('ALTER TABLE coupon_claims ADD COLUMN source TEXT DEFAULT \'self\''); } catch(e) {}
      try { await env.DB.exec('ALTER TABLE coupon_claims ADD COLUMN referrer_of_phone TEXT'); } catch(e) {}
      try { await env.DB.exec('ALTER TABLE coupon_claims ADD COLUMN used_at TEXT'); } catch(e) {}
      try { await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_coupon_claims_hotel_id ON coupon_claims(hotel_id)'); } catch(e) {}
      return jsonResponse({ success: true, message: 'coupon_claims v2 多租户表已就绪' });
    } catch (e) {
      return jsonResponse({ success: false, message: '建表失败: ' + e.message }, 500);
    }
  }

  // 查询可用优惠券（未使用+未过期，按酒店隔离）
  if (phone) {
    try {
      const hotelId = await resolveHotelId(env, request);
      const clean = cleanPhone(phone);
      const now = new Date().toISOString();

      const available = await env.DB.prepare(
        'SELECT coupon_id, coupon_name, amount, condition_amount, expire_at, source, id FROM coupon_claims WHERE hotel_id = ? AND phone = ? AND used = 0 AND expire_at > ?'
      ).bind(hotelId, clean, now).all();

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

      const used = await env.DB.prepare(
        'SELECT coupon_id, coupon_name, amount, condition_amount, used_order_id, used_at FROM coupon_claims WHERE hotel_id = ? AND phone = ? AND used = 1 ORDER BY used_at DESC LIMIT 5'
      ).bind(hotelId, clean).all();

      const usedCoupons = used.results.map(row => ({
        id: row.coupon_id,
        name: row.coupon_name,
        amount: row.amount,
        orderId: row.used_order_id,
        usedAt: row.used_at
      }));

      return jsonResponse({ success: true, coupons, usedCoupons, hotelId });
    } catch (e) {
      return jsonResponse({ success: false, message: '查询失败' }, 500);
    }
  }

  return jsonResponse({ success: false, message: '缺少参数' }, 400);
}
