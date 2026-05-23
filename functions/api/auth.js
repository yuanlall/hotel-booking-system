// ========== Cloudflare Pages Function: 管理员登录鉴权 ==========
// 提供登录接口 + Token 生成/验证中间件工具

// Token 有效期：24小时
const TOKEN_EXPIRE_MS = 24 * 60 * 60 * 1000;

// 密码签名密钥（从环境变量读取，fallback 用固定值，生产环境应配置）
function getSigningKey(env) {
  return env.AUTH_SECRET || 'hotel-booking-auth-2025';
}

// Token 格式: base64(timestamp|account|platform|0|sigHex)
// 新格式包含 role 和 hotelId 字段，中间件可区分平台/酒店账号
async function generateToken(account, env) {
  const key = getSigningKey(env);
  const timestamp = Date.now().toString();
  const payload = `${timestamp}|${account}|platform|0`;
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(payload));
  const sigHex = Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');
  const raw = `${timestamp}|${account}|platform|0|${sigHex}`;
  return btoa(raw);
}

// 验证 Token，返回 { valid, account, role, hotelId } 或 { valid: false }
// 兼容旧版 3段 token 和新版 5段 token
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

// 管理员账号（从环境变量读取，fallback 内置）
function getAdminAccounts(env) {
  // 环境变量格式: "admin:hotel2025,前台小王:wang123"
  const envAccounts = env.ADMIN_ACCOUNTS;
  if (envAccounts) {
    return envAccounts.split(',').map(item => {
      const [account, password] = item.split(':');
      return { account, password };
    }).filter(a => a.account && a.password);
  }
  // fallback 内置账号
  return [
    { account: 'admin', password: 'hotel2025' }
  ];
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}

// POST /api/auth — 登录获取 Token
export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const body = await request.json();
    const { account, password } = body;

    if (!account || !password) {
      return jsonResponse({ success: false, message: '请输入账号和密码' }, 400);
    }

    const accounts = getAdminAccounts(env);
    const found = accounts.find(a => a.account === account && a.password === password);

    if (!found) {
      return jsonResponse({ success: false, message: '账号或密码错误' }, 401);
    }

    const token = await generateToken(account, env);
    return jsonResponse({
      success: true,
      token,
      account,
      expiresIn: TOKEN_EXPIRE_MS
    });
  } catch (e) {
    return jsonResponse({ success: false, message: '服务器错误' }, 500);
  }
}

// GET /api/auth?action=verify&token=xxx — 验证 Token 是否有效（可选，前端主动检查用）
export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const token = url.searchParams.get('token');

  if (!token) return jsonResponse({ success: false, message: '缺少 token' }, 400);

  const result = await verifyToken(token, env);
  if (result.valid) {
    return jsonResponse({ success: true, account: result.account });
  }
  return jsonResponse({ success: false, message: 'Token 无效或已过期', reason: result.reason }, 401);
}

// 导出 verifyToken 供中间件和其他函数使用（Pages Function 之间不能直接 import，
// 所以中间件需要内联相同的验证逻辑）
export { verifyToken, getAdminAccounts, TOKEN_EXPIRE_MS };
