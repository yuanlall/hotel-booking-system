// ========== Cloudflare Pages Function: 订单处理 ==========

export async function onRequestPost(context) {
  const { request, env } = context;
  
  try {
    const body = await request.json();
    
    // 验证必填字段
    const required = ['roomId', 'roomName', 'checkin', 'checkout', 'guestName', 'guestPhone'];
    for (const field of required) {
      if (!body[field]) {
        return jsonResponse({ success: false, message: `缺少必填字段: ${field}` }, 400);
      }
    }
    
    // 生成订单ID
    const orderId = `ORD${Date.now()}${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
    
    // 订单数据
    const order = {
      id: orderId,
      hotel: body.hotel || '香江国际酒店',
      roomId: body.roomId,
      roomName: body.roomName,
      roomPrice: body.roomPrice,
      checkin: body.checkin,
      checkout: body.checkout,
      nights: body.nights || 1,
      guestName: body.guestName,
      guestPhone: body.guestPhone,
      note: body.note || '',
      coupons: body.coupons || [],
      originalTotal: body.originalTotal || body.roomPrice,
      finalTotal: body.finalTotal || body.roomPrice,
      submittedAt: body.submittedAt || new Date().toLocaleString('zh-CN'),
      status: 'pending',
      ip: request.headers.get('cf-connecting-ip') || 'unknown'
    };
    
    // 1. 发送企业微信通知
    let wecomOk = false;
    if (env.WECOM_WEBHOOK_URL) {
      try {
        const nights = Math.ceil((new Date(body.checkout) - new Date(body.checkin)) / (1000*60*60*24));
        const wecomMessage = {
          msgtype: 'markdown',
          markdown: {
            content: `🏨 **新订单通知**\n\n` +
              `📋 订单号：${orderId}\n` +
              `🏠 酒店：${order.hotel}\n` +
              `🛏️ 房型：${order.roomName}\n` +
              `📅 入住：${body.checkin}\n` +
              `📅 离店：${body.checkout}（${nights}晚）\n` +
              `👤 客人：${body.guestName}\n` +
              `📱 手机：${body.guestPhone}\n` +
              `💰 实付：¥${body.finalTotal}\n` +
              `💬 备注：${body.note || '无'}\n` +
              `⏰ 提交：${order.submittedAt}\n\n` +
              `请及时确认订单！📞`
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
    
    // 2. 写入飞书多维表格
    let feishuOk = false;
    if (env.FEISHU_APP_ID && env.FEISHU_APP_SECRET && env.FEISHU_BITABLE_APP_TOKEN && env.FEISHU_BITABLE_TABLE_ID) {
      try {
        // 获取 access_token
        const tokenRes = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            app_id: env.FEISHU_APP_ID,
            app_secret: env.FEISHU_APP_SECRET
          })
        });
        const tokenData = await tokenRes.json();
        
        if (tokenData.code === 0) {
          const accessToken = tokenData.tenant_access_token;
          
          // 写入记录
          const addRes = await fetch(
            `https://open.feishu.cn/open-apis/bitable/v1/apps/${env.FEISHU_BITABLE_APP_TOKEN}/tables/${env.FEISHU_BITABLE_TABLE_ID}/records`,
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                fields: {
                  '订单号': orderId,
                  '酒店名称': order.hotel,
                  '房型': order.roomName,
                  '入住日期': body.checkin,
                  '离店日期': body.checkout,
                  '入住天数': order.nights,
                  '入住人': order.guestName,
                  '手机号': order.guestPhone,
                  '备注': order.note,
                  '实付金额': order.finalTotal,
                  '订单状态': '待确认',
                  '提交时间': order.submittedAt
                }
              })
            }
          );
          const addData = await addRes.json();
          feishuOk = addData.code === 0;
        }
      } catch(e) {
        console.error('Feishu error:', e);
      }
    }
    
    // 3. 保存到 D1 数据库（可选，如果配置了）
    let d1Ok = false;
    if (env.DB) {
      try {
        const nights = Math.ceil((new Date(body.checkout) - new Date(body.checkin)) / (1000*60*60*24));
        await env.DB.prepare(`
          INSERT INTO orders (id, hotel, room_id, room_name, room_price, checkin, checkout, nights, guest_name, guest_phone, note, original_total, final_total, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now'))
        `).bind(
          orderId, order.hotel, body.roomId, order.roomName, body.roomPrice,
          body.checkin, body.checkout, nights,
          body.guestName, body.guestPhone, body.note || '',
          body.originalTotal, body.finalTotal
        ).run();
        d1Ok = true;
      } catch(e) {
        console.error('D1 error:', e);
      }
    }
    
    return jsonResponse({
      success: true,
      orderId,
      message: '订单提交成功，商家将尽快确认',
      notify: {
        wecom: wecomOk,
        feishu: feishuOk
      }
    });
    
  } catch(e) {
    console.error('Order error:', e);
    return jsonResponse({ success: false, message: '服务器错误，请重试' }, 500);
  }
}

// GET: 查询订单列表（商家后台用）
export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const action = url.searchParams.get('action');
  
  if (action === 'list') {
    // 返回订单列表（模拟数据，MVP阶段）
    return jsonResponse({
      success: true,
      orders: []
    });
  }
  
  return jsonResponse({ success: false, message: 'Unknown action' }, 400);
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