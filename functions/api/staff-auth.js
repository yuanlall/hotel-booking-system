// ========== Cloudflare Pages Function: 酒店员工登录鉴权 ==========
// 与平台管理员 (/api/auth) 分离，员工账号存储在 D1 hotel_accounts 表
// 登录后返回的 Token 包含 role=hotel + hotel_id 信息

const TOKEN_EXPIRE_MS = 24 * 60 * 60 * 1000;

function getSigningKey(env) {
  return env.AUTH_SECRET || 'hotel-booking-auth-2025';
}

// Token 格式: base64(timestamp|account|role|hotelId|hmac_sha256(timestamp|account|role|hotelId|secret))
async function generateStaffToken(account, hotelId, env) {
  const key = getSigningKey(env);
  const timestamp = Date.now().toString();
  const payload = `${timestamp}|${account}|hotel|${hotelId}`;
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(payload));
  const sigHex = Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');
  const raw = `${timestamp}|${account}|hotel|${hotelId}|${sigHex}`;
  return btoa(raw);
}

// 验证 Token（兼容旧版2段token和新版4段token）
async function verifyToken(token, env) {
  if (!token) return { valid: false };
  try {
    const raw = atob(token);
    const parts = raw.split('|');
    const isNewFormat = parts.length === 5; // timestamp|account|hotel|hotelId|sig
    const isOldFormat = parts.length === 3;  // timestamp|account|sig

    if (!isNewFormat && !isOldFormat) return { valid: false };

    let timestamp, account, role, hotelId, sigHex, payload;
    if (isNewFormat) {
      [timestamp, account, role, hotelId, sigHex] = parts;
      payload = `${timestamp}|${account}|${role}|${hotelId}`;
    } else {
      [timestamp, account, sigHex] = parts;
      payload = `${timestamp}|${account}`;
      role = 'platform'; // 旧格式为平台管理员
    }

    const ts = parseInt(timestamp, 10);
    if (Date.now() - ts > TOKEN_EXPIRE_MS) return { valid: false, reason: 'expired' };

    const key = getSigningKey(env);
    const encoder = new TextEncoder();
    const cryptoKey = await crypto.subtle.importKey(
      'raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(payload));
    const expectedHex = Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');

    if (sigHex !== expectedHex) return { valid: false, reason: 'invalid' };

    return { valid: true, account, role: role || 'platform', hotelId: hotelId ? parseInt(hotelId) : null };
  } catch (e) {
    return { valid: false, reason: 'malformed' };
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const action = url.searchParams.get('action');

  // GET /api/staff-auth?action=me — 获取当前员工信息
  if (action === 'me') {
    const authHeader = request.headers.get('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const result = await verifyToken(token, env);

    if (!result.valid) {
      return jsonResponse({ success: false, message: 'Token 无效或已过期' }, 401);
    }
    if (result.role !== 'hotel' || !result.hotelId) {
      return jsonResponse({ success: false, message: '非酒店员工账号' }, 403);
    }

    // 查询酒店名
    const hotel = await env.DB.prepare('SELECT name, slug FROM hotels WHERE id = ?').bind(result.hotelId).first();

    return jsonResponse({
      success: true,
      account: result.account,
      hotelId: result.hotelId,
      hotelName: hotel ? hotel.name : '',
      hotelSlug: hotel ? hotel.slug : ''
    });
  }

  // GET /api/staff-auth?action=verify&token=xxx
  if (action === 'verify') {
    const token = url.searchParams.get('token');
    if (!token) return jsonResponse({ success: false, message: '缺少 token' }, 400);
    const result = await verifyToken(token, env);
    if (result.valid) {
      return jsonResponse({ success: true, account: result.account, role: result.role, hotelId: result.hotelId });
    }
    return jsonResponse({ success: false, message: 'Token 无效或已过期', reason: result.reason }, 401);
  }

  return jsonResponse({ success: false, message: '未知 action' }, 400);
}

// POST /api/staff-auth — 员工登录
export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const body = await request.json();
    const { account, password } = body;

    if (!account || !password) {
      return jsonResponse({ success: false, message: '请输入账号和密码' }, 400);
    }

    // 查询 hotel_accounts 表
    const staffAccount = await env.DB.prepare(
      'SELECT sa.*, h.name as hotel_name, h.slug FROM hotel_accounts sa JOIN hotels h ON sa.hotel_id = h.id WHERE sa.account = ? AND sa.active = 1'
    ).bind(account).first();

    if (!staffAccount || staffAccount.password !== password) {
      return jsonResponse({ success: false, message: '账号或密码错误' }, 401);
    }

    const token = await generateStaffToken(account, staffAccount.hotel_id, env);

    return jsonResponse({
      success: true,
      token,
      account,
      hotelId: staffAccount.hotel_id,
      hotelName: staffAccount.hotel_name,
      hotelSlug: staffAccount.slug,
      expiresIn: TOKEN_EXPIRE_MS
    });
  } catch (e) {
    return jsonResponse({ success: false, message: '服务器错误: ' + e.message }, 500);
  }
}

// PUT /api/staff-auth — 修改密码
export async function onRequestPut(context) {
  const { request, env } = context;
  try {
    const authHeader = request.headers.get('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const result = await verifyToken(token, env);

    if (!result.valid || result.role !== 'hotel') {
      return jsonResponse({ success: false, message: '未授权' }, 401);
    }

    const body = await request.json();
    const { oldPassword, newPassword } = body;

    if (!oldPassword || !newPassword) {
      return jsonResponse({ success: false, message: '请输入旧密码和新密码' }, 400);
    }

    const staffAccount = await env.DB.prepare(
      'SELECT * FROM hotel_accounts WHERE account = ? AND hotel_id = ? AND active = 1'
    ).bind(result.account, result.hotelId).first();

    if (!staffAccount || staffAccount.password !== oldPassword) {
      return jsonResponse({ success: false, message: '旧密码错误' }, 401);
    }

    await env.DB.prepare(
      'UPDATE hotel_accounts SET password = ?, updated_at = datetime("now") WHERE account = ? AND hotel_id = ?'
    ).bind(newPassword, result.account, result.hotelId).run();

    return jsonResponse({ success: true, message: '密码已修改' });
  } catch (e) {
    return jsonResponse({ success: false, message: '服务器错误' }, 500);
  }
}

export { verifyToken };
