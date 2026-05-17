// ========== Cloudflare Pages Function: 优惠券管理 ==========
// 优惠券领取 & 查询（D1 持久化）

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

// POST /api/coupon — 领取优惠券
// Body: { phone: string, couponId: string, couponName: string, amount: number, condition: number, expireDays: number }
export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.DB) {
    return jsonResponse({ success: false, message: '数据库不可用' }, 503);
  }

  try {
    const body = await request.json();
    const { phone, couponId } = body;

    if (!phone || !couponId) {
      return jsonResponse({ success: false, message: '缺少手机号或优惠券ID' }, 400);
    }

    // 手机号格式校验
    const cleanPhone = phone.replace(/\s/g, '');
    if (!/^1[3-9]\d{9}$/.test(cleanPhone)) {
      return jsonResponse({ success: false, message: '手机号格式不正确' }, 400);
    }

    // 检查是否已领取过（同手机号+同优惠券）
    const existing = await env.DB.prepare(
      'SELECT id, used, expire_at FROM coupon_claims WHERE phone = ? AND coupon_id = ?'
    ).bind(cleanPhone, couponId).first();

    if (existing) {
      if (existing.used) {
        return jsonResponse({ success: false, message: '该优惠券已使用', alreadyClaimed: true, used: true });
      }
      return jsonResponse({ success: false, message: '已经领取过该优惠券了', alreadyClaimed: true, claim: existing });
    }

    // 写入领取记录
    const expireDays = body.expireDays || 7;
    const expireAt = new Date(Date.now() + expireDays * 24 * 60 * 60 * 1000).toISOString();

    await env.DB.prepare(`
      INSERT INTO coupon_claims (phone, coupon_id, coupon_name, amount, condition_amount, expire_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      cleanPhone,
      couponId,
      body.couponName || '',
      body.amount || 0,
      body.condition || 0,
      expireAt,
      new Date().toISOString()
    ).run();

    return jsonResponse({
      success: true,
      message: '领取成功',
      claim: {
        couponId,
        couponName: body.couponName,
        amount: body.amount,
        condition: body.condition,
        expireAt,
        used: false
      }
    });

  } catch (e) {
    console.error('Coupon claim error:', e.message || e);
    return jsonResponse({ success: false, message: '服务器错误' }, 500);
  }
}

// GET /api/coupon?phone=xxx — 查询已领取优惠券列表
// GET /api/coupon?action=init — 初始化表结构
export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const action = url.searchParams.get('action');
  const phone = url.searchParams.get('phone');

  if (!env.DB) {
    return jsonResponse({ success: false, message: '数据库不可用' }, 503);
  }

  // 初始化表结构（仅首次调用）
  if (action === 'init') {
    try {
      await env.DB.exec(`
        CREATE TABLE IF NOT EXISTS coupon_claims (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          phone TEXT NOT NULL,
          coupon_id TEXT NOT NULL,
          coupon_name TEXT,
          amount INTEGER DEFAULT 0,
          condition_amount INTEGER DEFAULT 0,
          expire_at TEXT,
          used INTEGER DEFAULT 0,
          used_order_id TEXT,
          created_at TEXT,
          UNIQUE(phone, coupon_id)
        )
      `);
      return jsonResponse({ success: true, message: 'coupon_claims 表已就绪' });
    } catch (e) {
      return jsonResponse({ success: false, message: '建表失败: ' + e.message }, 500);
    }
  }

  // 查询已领取优惠券
  if (phone) {
    try {
      const cleanPhone = phone.replace(/\s/g, '');
      const now = new Date().toISOString();

      const result = await env.DB.prepare(
        'SELECT coupon_id, coupon_name, amount, condition_amount, expire_at, used FROM coupon_claims WHERE phone = ? AND expire_at > ?'
      ).bind(cleanPhone, now).all();

      const coupons = result.results.map(row => ({
        id: row.coupon_id,
        name: row.coupon_name,
        amount: row.amount,
        condition: row.condition_amount,
        expireAt: row.expire_at,
        used: row.used === 1
      }));

      return jsonResponse({ success: true, coupons });
    } catch (e) {
      return jsonResponse({ success: false, message: '查询失败' }, 500);
    }
  }

  return jsonResponse({ success: false, message: '缺少参数' }, 400);
}
