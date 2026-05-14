// ========== Cloudflare Pages Function: 订单管理 ==========

// 获取飞书 access_token
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

// POST /api/order - 提交新订单
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
    const nights = Math.ceil((new Date(body.checkout) - new Date(body.checkin)) / (1000*60*60*24));
    const submittedAt = new Date().toLocaleString('zh-CN');
    
    // 订单数据
    const order = {
      id: orderId,
      hotel: body.hotel || '棣欐睙国际酒店',
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
    
    // ===== 1. 企业微信通知 =====
    let wecomOk = false;
    if (env.WECOM_WEBHOOK_URL) {
      try {
        const wecomMessage = {
          msgtype: 'markdown',
          markdown: {
            content: `🔔 **新订单通知**\n\n` +
              `📋 订单号：${orderId}\n` +
              `🏨 酒店：${order.hotel}\n` +
              `🛏️ 房型：${order.roomName}\n` +
              `📅 入住：${body.checkin}\n` +
              `📅 离店：${body.checkout}（${nights}晚）\n` +
              `👤 入住人：${body.guestName}\n` +
              `📱 手机：${body.guestPhone}\n` +
              `💰 实付：¥${body.finalTotal}\n` +
              `📝 备注：${body.note || '无'}\n` +
              `⏰ 提交：${submittedAt}\n\n` +
              `请及时确认订单！👀`
          }
        };
        
        const wecomRes = await fetch(env.WECOM_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(wecomMessage)
        });
        
        const wecomData = await wecomRes.json();
        wecomOk = wecomData.errcode === 0;
        console.log('WeCom result:', JSON.stringify(wecomData));
      } catch(e) {
        console.error('WeCom error:', e.message || e);
      }
    }
    
    // ===== 2. 飞书多维表格存储（预订订单）=====
    let feishuOk = false;
    let feishuError = null;
    
    if (env.FEISHU_APP_ID && env.FEISHU_APP_SECRET && env.FEISHU_BITABLE_APP_TOKEN && env.FEISHU_BOOKING_TABLE_ID) {
      try {
        console.log('Feishu: starting write...');
        const accessToken = await getFeishuToken(env.FEISHU_APP_ID, env.FEISHU_APP_SECRET);
        console.log('Feishu: got token');
        
        const apiUrl = `https://open.feishu.cn/open-apis/bitable/v1/apps/${env.FEISHU_BITABLE_APP_TOKEN}/tables/${env.FEISHU_BOOKING_TABLE_ID}/records`;
        console.log('Feishu: posting to', apiUrl);
        
        const addRes = await fetch(apiUrl, {
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
              '入住天数': nights,
              '入住人': order.guestName,
              '手机号': order.guestPhone,
              '备注': order.note,
              '实付金额': order.finalTotal,
              '订单状态': '待确认',
              '提交时间': submittedAt
            }
          })
        });
        
        const addData = await addRes.json();
        console.log('Feishu response:', JSON.stringify(addData));
        
        if (addData.code === 0) {
          feishuOk = true;
          console.log('Feishu: write OK, record_id=' + addData.data.record.id);
        } else {
          feishuError = addData.msg || addData.code;
          console.error('Feishu error code:', addData.code, 'msg:', addData.msg);
        }
      } catch(e) {
        feishuError = e.message || String(e);
        console.error('Feishu write exception:', feishuError);
      }
    } else {
      console.log('Feishu: missing config - APP_ID:', !!env.FEISHU_APP_ID, 'APP_SECRET:', !!env.FEISHU_APP_SECRET, 'BITABLE_APP_TOKEN:', !!env.FEISHU_BITABLE_APP_TOKEN, 'BOOKING_TABLE_ID:', !!env.FEISHU_BOOKING_TABLE_ID);
    }
    
    return jsonResponse({
      success: true,
      orderId: orderId,
      message: '订单提交成功，商家将尽快确认',
      notify: { 
        wecom: wecomOk, 
        feishu: feishuOk,
        debug: { feishuError: feishuError }
      }
    });
    
  } catch(e) {
    console.error('Order submit error:', e.message || e);
    return jsonResponse({ success: false, message: '服务器错误，请重试' }, 500);
  }
}

// GET /api/order?action=list - 查询订单列表（商家后台）
export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const action = url.searchParams.get('action');
  
  if (action === 'list') {
    // 查询飞书表格获取订单列表
    try {
      if (!env.FEISHU_APP_ID || !env.FEISHU_APP_SECRET || !env.FEISHU_BITABLE_APP_TOKEN || !env.FEISHU_BOOKING_TABLE_ID) {
        return jsonResponse({ success: false, message: '飞书配置未完成', orders: [] }, 200);
      }
      
      const accessToken = await getFeishuToken(env.FEISHU_APP_ID, env.FEISHU_APP_SECRET);
      
      // 查询最近的订单（最多50条）
      const listRes = await fetch(
        `https://open.feishu.cn/open-apis/bitable/v1/apps/${env.FEISHU_BITABLE_APP_TOKEN}/tables/${env.FEISHU_BOOKING_TABLE_ID}/records?page_size=50&sort=-created_time`,
        {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        }
      );
      
      const listData = await listRes.json();
      
      if (listData.code !== 0) {
        console.error('Feishu list error:', listData.code, listData.msg);
        return jsonResponse({ success: false, message: '读取飞书失败: ' + listData.msg, orders: [] }, 200);
      }
      
      // 转换飞书记录为前端格式
      const orders = (listData.data.items || []).map(item => {
        const f = item.fields;
        return {
          recordId: item.record_id,
          id: f['订单号'] || item.record_id,
          hotel: f['酒店名称'] || '',
          roomName: f['房型'] || '',
          checkin: f['入住日期'] || '',
          checkout: f['离店日期'] || '',
          nights: f['入住天数'] || 1,
          guestName: f['入住人'] || '',
          guestPhone: f['手机号'] || '',
          note: f['备注'] || '',
          finalTotal: f['实付金额'] || 0,
          status: f['订单状态'] === '已确认' ? 'confirmed' : f['订单状态'] === '已拒绝' ? 'cancelled' : 'pending',
          statusText: f['订单状态'] || '待确认',
          submittedAt: f['提交时间'] || ''
        };
      });
      
      return jsonResponse({ success: true, orders: orders });
      
    } catch(e) {
      console.error('Orders list error:', e.message || e);
      return jsonResponse({ success: false, message: '服务器错误', orders: [] }, 200);
    }
  }
  
  return jsonResponse({ success: false, message: 'Unknown action' }, 400);
}
