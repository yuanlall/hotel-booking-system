// ========== Cloudflare Pages Function: API 鉴权中间件 ==========
// 拦截需保护的接口，验证 Bearer Token

// 不需要鉴权的路径（面向用户的公开接口）
const PUBLIC_PATHS = [
  '/api/auth',          // 平台管理员登录
  '/api/staff-auth',    // 酒店员工登录
];

// 需要鉴权的动作（通过 action 参数区分）
const PROTECTED_ACTIONS = {
  '/api/order': { GET: ['list'], POST: ['updateStatus'] },
  '/api/coupon': { GET: ['init'] },
  '/api/config': { POST: ['update_hotel', 'update_room', 'update_coupon', 'create_hotel'] }
};

// ========== 鉴权核心逻辑（内联，因为 Pages Function 不支持跨文件 import） ==========
const TOKEN_EXPIRE_MS = 24 * 60 * 60 * 1000;

function getSigningKey(env) {
  return env.AUTH_SECRET || 'hotel-booking-auth-2025';
}

async function verifyToken(token, env) {
  if (!token) return { valid: false };
  try {
    const raw = atob(token);
    const parts = raw.split('|');
    const isNewFormat = parts.length === 5;
    const isOldFormat = parts.length === 3;
    if (!isNewFormat && !isOldFormat) return { valid: false };
    let timestamp, account, sigHex, payload, role, hotelId;
    if (isNewFormat) {
      [timestamp, account, role, hotelId, sigHex] = parts;
      payload = `${timestamp}|${account}|${role}|${hotelId}`;
    } else {
      [timestamp, account, sigHex] = parts;
      payload = `${timestamp}|${account}`;
      role = 'platform';
      hotelId = null;
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

// ========== Cloudflare Pages 中间件 ==========
export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const pathname = url.pathname;
  const method = request.method;

  // 1. 公开路径直接放行
  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
    return next();
  }

  // 2. 检查是否命中需鉴权的路由+动作
  const routeConfig = PROTECTED_ACTIONS[pathname];
  if (!routeConfig) {
    // 未注册的路径也放行（如 POST /api/order 默认提交订单）
    return next();
  }

  const methodActions = routeConfig[method];
  if (!methodActions) {
    return next();
  }

  // GET 请求从 query 获取 action，POST/PUT 从 body 获取
  let action = url.searchParams.get('action');
  if (!action && (method === 'POST' || method === 'PUT')) {
    // POST body 需要 clone + 解析（不能消耗原始 body）
    const contentType = request.headers.get('Content-Type') || '';
    if (contentType.includes('application/json')) {
      try {
        const clonedReq = request.clone();
        const body = await clonedReq.json();
        action = body.action;
      } catch (e) {
        // 无法解析 body，放行让下游处理
        return next();
      }
    }
  }

  // 未指定 action 或 action 不在保护列表中 → 放行
  if (!action || !methodActions.includes(action)) {
    return next();
  }

  // 3. 需要鉴权 → 提取 Bearer Token
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  if (!token) {
    return jsonResponse({ success: false, message: '未授权访问，请先登录', code: 'UNAUTHORIZED' }, 401);
  }

  // 4. 验证 Token
  const result = await verifyToken(token, env);

  if (!result.valid) {
    if (result.reason === 'expired') {
      return jsonResponse({ success: false, message: '登录已过期，请重新登录', code: 'TOKEN_EXPIRED' }, 401);
    }
    return jsonResponse({ success: false, message: 'Token 无效', code: 'INVALID_TOKEN' }, 401);
  }

  // 5. 角色权限检查：某些操作仅限平台管理员
  if (result.role === 'hotel') {
    // 酒店员工禁止创建/更新酒店信息
    const hotelOnlyActions = ['create_hotel', 'update_hotel'];
    if (hotelOnlyActions.includes(action)) {
      return jsonResponse({ success: false, message: '无权限执行此操作', code: 'FORBIDDEN' }, 403);
    }
  }

  // 6. 鉴权通过，在请求头中附加 account + role + hotelId 信息，放行
  const newHeaders = new Headers(request.headers);
  newHeaders.set('X-Auth-Account', result.account);
  newHeaders.set('X-Auth-Role', result.role || 'platform');
  if (result.hotelId) newHeaders.set('X-Auth-HotelId', result.hotelId.toString());
  const newRequest = new Request(request, { headers: newHeaders });

  return next(newRequest);
}
