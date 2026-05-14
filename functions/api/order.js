// ========== Cloudflare Pages Function: 璁㈠崟绠＄悊 ==========

export async function onRequestPost(context) {
  const { request, env } = context;
  
  try {
    const body = await request.json();
    
    // 楠岃瘉蹇呭～瀛楁
    const required = ['roomId', 'roomName', 'checkin', 'checkout', 'guestName', 'guestPhone'];
    for (const field of required) {
      if (!body[field]) {
        return jsonResponse({ success: false, message: `缂哄皯蹇呭～瀛楁: ${field}` }, 400);
      }
    }
    
    // 鐢熸垚璁㈠崟ID
    const orderId = `ORD${Date.now()}${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
    const nights = Math.ceil((new Date(body.checkout) - new Date(body.checkin)) / (1000*60*60*24));
    const submittedAt = new Date().toLocaleString('zh-CN');
    
    // 璁㈠崟鏁版嵁
    const order = {
      id: orderId,
      hotel: body.hotel || '棣欐睙鍥介檯閰掑簵',
      roomId: body.roomId,
      roomName: body.roomName,
      roomPrice: body.roomPrice,
      checkin: body.checkin,
      checkout: body.checkout,
      nights: nights,
      guestName: body.guestName,
      guestPhone: body.guestPhone,
      note: body.note || '',
      coupons: body.coupons || [],
      originalTotal: body.originalTotal || body.roomPrice,
      finalTotal: body.finalTotal || body.roomPrice,
      submittedAt: submittedAt,
      status: 'pending',
      ip: request.headers.get('cf-connecting-ip') || 'unknown'
    };
    
    // ===== 1. 浼佷笟寰俊閫氱煡 =====
    let wecomOk = false;
    if (env.WECOM_WEBHOOK_URL) {
      try {
        const wecomMessage = {
          msgtype: 'markdown',
          markdown: {
            content: `馃彣 **鏂拌鍗曢€氱煡**\n\n` +
              `馃搵 璁㈠崟鍙凤細${orderId}\n` +
              `馃彔 閰掑簵锛?{order.hotel}\n` +
              `馃洀锔?鎴垮瀷锛?{order.roomName}\n` +
              `馃搮 鍏ヤ綇锛?{body.checkin}\n` +
              `馃搮 绂诲簵锛?{body.checkout}锛?{nights}鏅氾級\n` +
              `馃懁 瀹汉锛?{body.guestName}\n` +
              `馃摫 鎵嬫満锛?{body.guestPhone}\n` +
              `馃挵 瀹炰粯锛毬?{body.finalTotal}\n` +
              `馃挰 澶囨敞锛?{body.note || '鏃?}\n` +
              `鈴?鎻愪氦锛?{submittedAt}\n\n` +
              `璇峰強鏃剁‘璁よ鍗曪紒馃摓`
          }
        };
        
        const wecomRes = await fetch(env.WECOM_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(wecomMessage)
        });
        
        const wecomData = await wecomRes.json();
        wecomOk = wecomData.errcode === 0;
      } catch(e) {
        console.error('WeCom error:', e);
      }
    }
    
    // ===== 2. 椋炰功澶氱淮琛ㄦ牸瀛樺偍锛堥璁㈣鍗曪級=====
    let feishuOk = false;
    if (env.FEISHU_APP_ID && env.FEISHU_APP_SECRET && env.FEISHU_BITABLE_APP_TOKEN && env.FEISHU_BOOKING_TABLE_ID) {
      try {
        const accessToken = await getFeishuToken(env.FEISHU_APP_ID, env.FEISHU_APP_SECRET);
        
        const addRes = await fetch(
          `https://open.feishu.cn/open-apis/bitable/v1/apps/${env.FEISHU_BITABLE_APP_TOKEN}/tables/${env.FEISHU_BOOKING_TABLE_ID}/records`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              fields: {
                '璁㈠崟鍙?: orderId,
                '閰掑簵鍚嶇О': order.hotel,
                '鎴垮瀷': order.roomName,
                '鍏ヤ綇鏃ユ湡': body.checkin,
                '绂诲簵鏃ユ湡': body.checkout,
                '鍏ヤ綇澶╂暟': nights,
                '鍏ヤ綇浜?: order.guestName,
                '鎵嬫満鍙?: order.guestPhone,
                '澶囨敞': order.note,
                '瀹炰粯閲戦': order.finalTotal,
                '璁㈠崟鐘舵€?: '寰呯‘璁?,
                '鎻愪氦鏃堕棿': submittedAt
              }
            })
          }
        );
        const addData = await addRes.json();
        feishuOk = addData.code === 0;
      } catch(e) {
        console.error('Feishu write error:', e);
      }
    }
    
    return jsonResponse({
      success: true,
      orderId: orderId,
      message: '璁㈠崟鎻愪氦鎴愬姛锛屽晢瀹跺皢灏藉揩纭',
      notify: { wecom: wecomOk, feishu: feishuOk }
    });
    
  } catch(e) {
    console.error('Order submit error:', e);
    return jsonResponse({ success: false, message: '鏈嶅姟鍣ㄩ敊璇紝璇烽噸璇? }, 500);
  }
}

// GET: 鏌ヨ璁㈠崟鍒楄〃锛堝晢瀹跺悗鍙帮級
export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const action = url.searchParams.get('action');
  
  if (action === 'list') {
    return jsonResponse({ success: false, message: 'Use /api/orders endpoint' }, 400);
  }
  
  return jsonResponse({ success: false, message: 'Unknown action' }, 400);
}

// ===== 璇诲彇璁㈠崟鍒楄〃锛圙ET /api/orders锛?====
export async function onRequest(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  
  // 鍙鐞?GET 璇锋眰鐨勫垪琛ㄦ煡璇?  if (request.method === 'GET' && url.pathname === '/api/orders') {
    try {
      if (!env.FEISHU_APP_ID || !env.FEISHU_APP_SECRET || !env.FEISHU_BITABLE_APP_TOKEN || !env.FEISHU_BOOKING_TABLE_ID) {
        return jsonResponse({ success: false, message: '椋炰功閰嶇疆鏈畬鎴?, orders: [] }, 200);
      }
      
      // 鑾峰彇 access_token
      const accessToken = await getFeishuToken(env.FEISHU_APP_ID, env.FEISHU_APP_SECRET);
      
      // 鏌ヨ鏈€杩戠殑璁㈠崟锛堟渶澶?0鏉★級
      const listRes = await fetch(
        `https://open.feishu.cn/open-apis/bitable/v1/apps/${env.FEISHU_BITABLE_APP_TOKEN}/tables/${env.FEISHU_BOOKING_TABLE_ID}/records?page_size=50&sort=-created_time`,
        {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        }
      );
      
      const listData = await listRes.json();
      
      if (listData.code !== 0) {
        return jsonResponse({ success: false, message: '璇诲彇椋炰功澶辫触', orders: [] }, 200);
      }
      
      // 杞崲椋炰功璁板綍涓哄墠绔牸寮?      const orders = (listData.data.items || []).map(item => {
        const f = item.fields;
        return {
          id: f['璁㈠崟鍙?] || item.record_id,
          hotel: f['閰掑簵鍚嶇О'] || '',
          roomName: f['鎴垮瀷'] || '',
          checkin: f['鍏ヤ綇鏃ユ湡'] || '',
          checkout: f['绂诲簵鏃ユ湡'] || '',
          nights: f['鍏ヤ綇澶╂暟'] || 1,
          guestName: f['鍏ヤ綇浜?] || '',
          guestPhone: f['鎵嬫満鍙?] || '',
          note: f['澶囨敞'] || '',
          finalTotal: f['瀹炰粯閲戦'] || 0,
          status: f['璁㈠崟鐘舵€?] === '宸茬‘璁? ? 'confirmed' : f['璁㈠崟鐘舵€?] === '宸叉嫆缁? ? 'cancelled' : 'pending',
          statusText: f['璁㈠崟鐘舵€?] || '寰呯‘璁?,
          submittedAt: f['鎻愪氦鏃堕棿'] || ''
        };
      });
      
      return jsonResponse({ success: true, orders: orders });
      
    } catch(e) {
      console.error('Orders list error:', e);
      return jsonResponse({ success: false, message: '鏈嶅姟鍣ㄩ敊璇?, orders: [] }, 200);
    }
  }
  
  // POST 鍒?/api/orders
  if (request.method === 'POST' && url.pathname === '/api/orders') {
    const body = await request.json();
    
    // 澶勭悊璁㈠崟纭/鍙栨秷
    if (body.action === 'updateStatus' && body.recordId) {
      try {
        const accessToken = await getFeishuToken(env.FEISHU_APP_ID, env.FEISHU_APP_SECRET);
        const statusMap = { confirmed: '宸茬‘璁?, cancelled: '宸叉嫆缁?, pending: '寰呯‘璁? };
        
        const updateRes = await fetch(
          `https://open.feishu.cn/open-apis/bitable/v1/apps/${env.FEISHU_BITABLE_APP_TOKEN}/tables/${env.FEISHU_BOOKING_TABLE_ID}/records/${body.recordId}`,
          {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              fields: {
                '璁㈠崟鐘舵€?: statusMap[body.status] || body.status
              }
            })
          }
        );
        
        const updateData = await updateRes.json();
        return jsonResponse({ success: updateData.code === 0, message: updateData.msg });
      } catch(e) {
        return jsonResponse({ success: false, message: '鏇存柊澶辫触' }, 500);
      }
    }
    
    // 鏂板缓璁㈠崟
    return onRequestPost(context);
  }
  
  // 404
  return jsonResponse({ success: false, message: 'Not found' }, 404);
}

// ===== 杈呭姪鍑芥暟 =====
async function getFeishuToken(appId, appSecret) {
  const res = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret })
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(data.msg);
  return data.tenant_access_token;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}