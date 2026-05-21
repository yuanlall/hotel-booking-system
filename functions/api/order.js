// ========== Cloudflare Pages Function: 订单管理 (多租户版) ==========
// 双写策略：飞书多维表格 + Cloudflare D1 数据库
// 多租户：所有查询通过 hotel_id 隔离

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

// 从请求中解析 hotel_id
async function resolveHotelId(env, request) {
  const url = new URL(request.url);
  let hotelId = url.searchParams.get('hotelId');

  // 从请求头获取
  if (!hotelId) {
    hotelId = request.headers.get('X-Hotel-Id');
  }

  // 从 Referer 解析
  if (!hotelId) {
    const referer = request.headers.get('Referer') || '';
    if (referer) {
      try {
        const refUrl = new URL(referer);
        hotelId = refUrl.searchParams.get('hotelId');
        // 也支持 hotel slug
        if (!hotelId) {
          const slug = refUrl.searchParams.get('hotel');
          if (slug) {
            const hotel = await env.DB.prepare('SELECT id FROM hotels WHERE slug = ?').first();
            if (hotel) hotelId = hotel.id;
          }
        }
      } catch(e) {}
    }
  }

  // 默认返回第一个酒店
  if (!hotelId) {
    const hotel = await env.DB.prepare('SELECT id FROM hotels WHERE active = 1 ORDER BY id ASC LIMIT 1').first();
    return hotel ? hotel.id : 1;
  }

  const id = parseInt(hotelId);
  return isNaN(id) ? 1 : id;
}

// ========== POST /api/order ==========
export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();

    // ===== 分发处理 =====

    // action=updateStatus: 更新订单状态（飞书 + D1）
    if (body.action === 'updateStatus') {
      const recordId = body.recordId;
      const newStatus = body.status;
      const statusTextMap = { confirmed: '已确认', cancelled: '已拒绝', pending: '待确认' };
      const statusText = statusTextMap[newStatus] || '待确认';

      // 1. 更新 D1
      let d1Ok = false;
      let d1Error = null;
      if (env.DB) {
        try {
          let order;
          if (recordId && recordId.startsWith('rec')) {
            order = await env.DB.prepare('SELECT * FROM orders WHERE feishu_record_id = ?').bind(recordId).first();
          }
          if (!order) {
            order = await env.DB.prepare('SELECT * FROM orders WHERE order_id = ?').bind(recordId).first();
          }
          if (order) {
            await env.DB.prepare('UPDATE orders SET status = ?, status_text = ? WHERE id = ?')
              .bind(newStatus, statusText, order.id).run();
            d1Ok = true;
          } else {
            d1Error = 'D1中未找到订单: ' + recordId;
          }
        } catch(e) {
          d1Error = e.message;
        }
      }

      // 2. 更新飞书
      let feishuOk = false;
      let feishuError = null;
      if (env.FEISHU_APP_ID && env.FEISHU_APP_SECRET && env.FEISHU_BITABLE_APP_TOKEN && env.FEISHU_BOOKING_TABLE_ID) {
        try {
          const accessToken = await getFeishuToken(env.FEISHU_APP_ID, env.FEISHU_APP_SECRET);
          let feishuRecordId = recordId;
          if (env.DB && recordId && !recordId.startsWith('rec')) {
            const order = await env.DB.prepare('SELECT feishu_record_id FROM orders WHERE order_id = ?').bind(recordId).first();
            if (order && order.feishu_record_id) {
              feishuRecordId = order.feishu_record_id;
            }
          }
          const updateRes = await fetch(
            `https://open.feishu.cn/open-apis/bitable/v1/apps/${env.FEISHU_BITABLE_APP_TOKEN}/tables/${env.FEISHU_BOOKING_TABLE_ID}/records/${feishuRecordId}`,
            {
              method: 'PUT',
              headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ fields: { '订单状态': statusText } })
            }
          );
          const updateData = await updateRes.json();
          if (updateData.code === 0) {
            feishuOk = true;
            if (env.DB && recordId && !recordId.startsWith('rec')) {
              await env.DB.prepare('UPDATE orders SET feishu_record_id = ? WHERE order_id = ?')
                .bind(feishuRecordId, recordId).run();
            }
          } else {
            feishuError = updateData.msg;
          }
        } catch(e) {
          feishuError = e.message;
        }
      }

      if (d1Ok || feishuOk) {
        return jsonResponse({ success: true, message: '订单状态已更新', d1: d1Ok, feishu: feishuOk });
      }
      return jsonResponse({ success: false, message: '更新失败', d1Error, feishuError });
    }

    // ===== 默认: 提交新订单 =====

    const required = ['roomId', 'roomName', 'checkin', 'checkout', 'guestName', 'guestPhone'];
    for (const field of required) {
      if (!body[field]) {
        return jsonResponse({ success: false, message: `缺少必填字段: ${field}` }, 400);
      }
    }

    // 解析 hotel_id
    const hotelId = body.hotelId || await resolveHotelId(env, request);

    // 生成订单ID
    const orderId = `ORD${Date.now()}${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
    const nights = Math.ceil((new Date(body.checkout) - new Date(body.checkin)) / (1000*60*60*24));
    const submittedAt = new Date().toLocaleString('zh-CN');

    const order = {
      orderId,
      hotelId,
      hotel: body.hotel || '',
      roomId: body.roomId,
      roomName: body.roomName,
      roomPrice: body.roomPrice,
      checkin: body.checkin,
      checkout: body.checkout,
      nights,
      guestName: body.guestName,
      guestPhone: body.guestPhone,
      note: body.note || '',
      coupons: body.coupons || [],
      originalTotal: body.originalTotal || body.roomPrice,
      finalTotal: body.finalTotal || body.roomPrice,
      submittedAt,
      status: 'pending',
      ip: request.headers.get('cf-connecting-ip') || 'unknown'
    };

    // ===== 并行写入三个目标 =====
    const [wecomResult, feishuResult, d1Result] = await Promise.allSettled([
      // 1. 企业微信通知
      (async () => {
        if (!env.WECOM_WEBHOOK_URL) return { ok: false, error: 'no webhook' };
        try {
          const res = await fetch(env.WECOM_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              msgtype: 'markdown',
              markdown: {
                content: `🔔 **新订单通知**\n\n` +
                  `📋 订单号：${orderId}\n` +
                  `🏨 酒店：${order.hotel}\n` +
                  `🛏️ 房型：${order.roomName}\n` +
                  `📅 入住：${body.checkin}\n` +
                  `📅 离店：${body.checkout}（${nights}晚）\n` +
                  `👤 入住人：${order.guestName}\n` +
                  `📱 手机：${order.guestPhone}\n` +
                  `💰 实付：¥${body.finalTotal}\n` +
                  `📝 备注：${order.note || '无'}\n` +
                  `⏰ 提交：${submittedAt}\n\n` +
                  `请及时确认订单！👀`
              }
            })
          });
          const data = await res.json();
          return { ok: data.errcode === 0 };
        } catch(e) {
          return { ok: false, error: e.message };
        }
      })(),

      // 2. 飞书多维表格
      (async () => {
        if (!env.FEISHU_APP_ID || !env.FEISHU_APP_SECRET || !env.FEISHU_BITABLE_APP_TOKEN || !env.FEISHU_BOOKING_TABLE_ID) {
          return { ok: false, error: '飞书配置缺失' };
        }
        try {
          const accessToken = await getFeishuToken(env.FEISHU_APP_ID, env.FEISHU_APP_SECRET);
          const res = await fetch(
            `https://open.feishu.cn/open-apis/bitable/v1/apps/${env.FEISHU_BITABLE_APP_TOKEN}/tables/${env.FEISHU_BOOKING_TABLE_ID}/records`,
            {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
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
            }
          );
          const data = await res.json();
          if (data.code === 0) {
            return { ok: true, recordId: data.data.record.id };
          }
          return { ok: false, error: data.msg, code: data.code };
        } catch(e) {
          return { ok: false, error: e.message };
        }
      })(),

      // 3. D1 数据库（含 hotel_id）
      (async () => {
        if (!env.DB) return { ok: false, error: 'D1 未绑定' };
        try {
          await env.DB.prepare(`
            INSERT INTO orders (order_id, hotel_id, hotel, room_name, checkin, checkout, nights, guest_name, guest_phone, note, original_total, final_total, status, status_text, submitted_at, ip)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            orderId, hotelId, order.hotel, order.roomName, body.checkin, body.checkout,
            nights, order.guestName, order.guestPhone, order.note,
            Number(order.originalTotal) || 0, Number(order.finalTotal) || 0,
            'pending', '待确认', submittedAt, order.ip
          ).run();
          return { ok: true };
        } catch(e) {
          return { ok: false, error: e.message };
        }
      })()
    ]);

    const wecomOk = wecomResult.status === 'fulfilled' && wecomResult.value.ok;
    const feishuOk = feishuResult.status === 'fulfilled' && feishuResult.value.ok;
    const feishuRecordId = feishuResult.status === 'fulfilled' && feishuResult.value.recordId ? feishuResult.value.recordId : null;
    const d1Ok = d1Result.status === 'fulfilled' && d1Result.value.ok;

    // 如果飞书写入成功，把 feishu_record_id 回填到 D1
    if (feishuRecordId && env.DB && d1Ok) {
      try {
        await env.DB.prepare('UPDATE orders SET feishu_record_id = ? WHERE order_id = ?')
          .bind(feishuRecordId, orderId).run();
      } catch(e) {
        console.error('Backfill feishu_record_id error:', e.message);
      }
    }

    return jsonResponse({
      success: true,
      orderId,
      hotelId,
      message: '订单提交成功，商家将尽快确认',
      storage: {
        wecom: wecomOk,
        feishu: feishuOk,
        d1: d1Ok,
        feishuError: feishuResult.status === 'fulfilled' && !feishuResult.value.ok ? feishuResult.value.error : null,
        d1Error: d1Result.status === 'fulfilled' && !d1Result.value.ok ? d1Result.value.error : null
      }
    });

  } catch(e) {
    console.error('Order API error:', e.message || e);
    return jsonResponse({ success: false, message: '服务器错误，请重试' }, 500);
  }
}

// ========== GET /api/order?action=list ==========
export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const action = url.searchParams.get('action');

  if (action === 'list') {
    // 解析 hotel_id（管理后台按酒店筛选）
    const hotelId = url.searchParams.get('hotelId') || await resolveHotelId(env, request);

    // ===== 优先从 D1 读取 =====
    if (env.DB) {
      try {
        const result = await env.DB.prepare(
          'SELECT * FROM orders WHERE hotel_id = ? ORDER BY created_at DESC LIMIT 100'
        ).bind(hotelId).all();

        const orders = result.results.map(row => ({
          recordId: row.feishu_record_id || row.order_id,
          id: row.order_id,
          hotelId: row.hotel_id,
          hotel: row.hotel || '',
          roomName: row.room_name || '',
          checkin: row.checkin || '',
          checkout: row.checkout || '',
          nights: row.nights || 1,
          guestName: row.guest_name || '',
          guestPhone: row.guest_phone || '',
          note: row.note || '',
          finalTotal: row.final_total || 0,
          status: row.status || 'pending',
          statusText: row.status_text || '待确认',
          submittedAt: row.submitted_at || '',
          source: 'd1'
        }));

        // 附带房间配置
        let roomConfig = null;
        try {
          const roomResult = await env.DB.prepare(
            'SELECT room_id, name, total_stock FROM rooms WHERE hotel_id = ? AND status = ? ORDER BY sort_order'
          ).bind(hotelId, 'active').all();
          if (roomResult.results && roomResult.results.length > 0) {
            roomConfig = roomResult.results;
          }
        } catch(e) { /* 忽略 */ }

        return jsonResponse({ success: true, orders, source: 'd1', count: orders.length, roomConfig, hotelId });
      } catch(e) {
        console.error('D1 read error:', e.message);
      }
    }

    // ===== Fallback: 从飞书读取 =====
    try {
      if (!env.FEISHU_APP_ID || !env.FEISHU_APP_SECRET || !env.FEISHU_BITABLE_APP_TOKEN || !env.FEISHU_BOOKING_TABLE_ID) {
        return jsonResponse({ success: false, message: 'D1和飞书均不可用', orders: [] }, 200);
      }

      const accessToken = await getFeishuToken(env.FEISHU_APP_ID, env.FEISHU_APP_SECRET);
      const listRes = await fetch(
        `https://open.feishu.cn/open-apis/bitable/v1/apps/${env.FEISHU_BITABLE_APP_TOKEN}/tables/${env.FEISHU_BOOKING_TABLE_ID}/records?page_size=50`,
        { headers: { 'Authorization': `Bearer ${accessToken}` } }
      );
      const listData = await listRes.json();

      if (listData.code !== 0) {
        return jsonResponse({ success: false, message: '读取飞书失败: ' + listData.msg, orders: [] }, 200);
      }

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
          submittedAt: f['提交时间'] || '',
          source: 'feishu'
        };
      });

      return jsonResponse({ success: true, orders, source: 'feishu', count: orders.length });

    } catch(e) {
      console.error('Orders list error:', e.message || e);
      return jsonResponse({ success: false, message: '服务器错误', orders: [] }, 200);
    }
  }

  return jsonResponse({ success: false, message: 'Unknown GET action' }, 400);
}
