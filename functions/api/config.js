// ========== Cloudflare Pages Function: 酒店配置 API ==========
// D1 Schema: hotels / rooms / coupon_templates 三张配置表
// 前端通过 GET /api/config 获取全部配置，替代硬编码 HOTEL 对象

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}

// GET /api/config — 获取酒店全部配置（前端调用）
// GET /api/config?action=init — 初始化三张配置表 + 种子数据
// GET /api/config?action=init&reset=1 — 重建表（清空旧数据）
export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const action = url.searchParams.get('action');

  if (!env.DB) return jsonResponse({ success: false, message: '数据库不可用' }, 503);

  // ===== 公开房态查询（无需鉴权） =====
  if (action === 'availability') {
    try {
      const date = url.searchParams.get('date') || new Date().toISOString().slice(0, 10);
      const rooms = await env.DB.prepare(
        'SELECT room_id, total_stock FROM rooms WHERE status = \'active\''
      ).all();
      // 查当天已确认订单占用的房间
      const orders = await env.DB.prepare(
        'SELECT room_name FROM orders WHERE status = \'confirmed\' AND checkin <= ? AND checkout > ?'
      ).bind(date, date).all();
      // 构建房型名→ID映射
      const roomNames = await env.DB.prepare('SELECT room_id, name FROM rooms WHERE status = \'active\'').all();
      const nameToId = {};
      roomNames.results.forEach(r => { nameToId[r.name] = r.room_id; });
      // 计算占用
      const occupied = {};
      rooms.results.forEach(r => { occupied[r.room_id] = 0; });
      orders.results.forEach(o => {
        const rid = nameToId[o.room_name];
        if (rid) occupied[rid] = (occupied[rid] || 0) + 1;
      });
      const availability = {};
      rooms.results.forEach(r => {
        availability[r.room_id] = Math.max(0, r.total_stock - (occupied[r.room_id] || 0));
      });
      return jsonResponse({ success: true, availability, date });
    } catch(e) {
      return jsonResponse({ success: false, message: '查询失败' }, 500);
    }
  }

  // ===== 初始化表结构 + 种子数据 =====
  if (action === 'init') {
    try {
      const reset = url.searchParams.get('reset') === '1';

      if (reset) {
        await env.DB.exec('DROP TABLE IF EXISTS rooms');
        await env.DB.exec('DROP TABLE IF EXISTS coupon_templates');
        await env.DB.exec('DROP TABLE IF EXISTS hotels');
      }

      // 1. hotels 表
      await env.DB.exec(
        'CREATE TABLE IF NOT EXISTS hotels (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, address TEXT, phone TEXT, rating REAL DEFAULT 4.5, review_count INTEGER DEFAULT 0, tags TEXT, description TEXT, checkin_time TEXT DEFAULT \'14:00\', checkout_time TEXT DEFAULT \'12:00\', parking TEXT DEFAULT \'免费\', active INTEGER DEFAULT 1, created_at TEXT, updated_at TEXT)'
      );

      // 2. rooms 表
      await env.DB.exec(
        'CREATE TABLE IF NOT EXISTS rooms (id INTEGER PRIMARY KEY AUTOINCREMENT, hotel_id INTEGER NOT NULL, room_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL, price INTEGER DEFAULT 0, area TEXT, bed_type TEXT, features TEXT, total_stock INTEGER DEFAULT 1, status TEXT DEFAULT \'active\', sort_order INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT, FOREIGN KEY (hotel_id) REFERENCES hotels(id))'
      );

      // 3. coupon_templates 表
      await env.DB.exec(
        'CREATE TABLE IF NOT EXISTS coupon_templates (id INTEGER PRIMARY KEY AUTOINCREMENT, hotel_id INTEGER, coupon_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL, amount INTEGER DEFAULT 0, condition_amount INTEGER DEFAULT 0, expire_days INTEGER DEFAULT 7, description TEXT, max_claim_per_user INTEGER DEFAULT 1, status TEXT DEFAULT \'active\', created_at TEXT, FOREIGN KEY (hotel_id) REFERENCES hotels(id))'
      );

      // 检查是否有种子数据
      const hotelCount = await env.DB.prepare('SELECT COUNT(*) as cnt FROM hotels').first();
      if (hotelCount && hotelCount.cnt === 0) {
        // ===== 种子数据：香江国际酒店 =====
        const now = new Date().toISOString();

        // 插入酒店
        await env.DB.prepare(
          'INSERT INTO hotels (name, address, phone, rating, review_count, tags, description, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(
          '香江国际酒店',
          '赣州市章贡区长冈路13号达芬奇国际中心9栋',
          '0797-8681517',
          4.8,
          328,
          '官方直营,近博物馆,免费停车,含早餐,新装修',
          '赣州章贡区精品商务酒店，近博物馆，官方直营0佣金预订',
          1, now, now
        ).run();

        const hotel = await env.DB.prepare('SELECT id FROM hotels WHERE name = ?').bind('香江国际酒店').first();
        const hotelId = hotel.id;

        // 插入房型
        const roomData = [
          { room_id: 'standard', name: '标准双床房', price: 279, area: '30m²', bed_type: '双床1.2m', features: '免费WiFi,含早', stock: 8, sort: 1 },
          { room_id: 'king', name: '豪华大床房', price: 328, area: '28m²', bed_type: '大床1.8m', features: '免费WiFi,含早', stock: 5, sort: 2 },
          { room_id: 'suite', name: '行政套房', price: 588, area: '45m²', bed_type: '大床2.0m', features: '客厅,含早', stock: 2, sort: 3 }
        ];
        for (const r of roomData) {
          await env.DB.prepare(
            'INSERT INTO rooms (hotel_id, room_id, name, price, area, bed_type, features, total_stock, status, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
          ).bind(hotelId, r.room_id, r.name, r.price, r.area, r.bed_type, r.features, r.stock, 'active', r.sort, now).run();
        }

        // 插入优惠券模板
        const couponData = [
          { coupon_id: 'new', name: '新客专享', amount: 30, condition: 200, days: 7, desc: '满200减30', max: 1 },
          { coupon_id: 'share', name: '分享立减', amount: 50, condition: 300, days: 7, desc: '满300减50', max: 999 },
          { coupon_id: 'return', name: '回头客', amount: 40, condition: 250, days: 14, desc: '满250减40', max: 1 }
        ];
        for (const c of couponData) {
          await env.DB.prepare(
            'INSERT INTO coupon_templates (hotel_id, coupon_id, name, amount, condition_amount, expire_days, description, max_claim_per_user, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
          ).bind(hotelId, c.coupon_id, c.name, c.amount, c.condition, c.days, c.desc, c.max, 'active', now).run();
        }
      }

      return jsonResponse({ success: true, message: '配置表已就绪' });
    } catch (e) {
      return jsonResponse({ success: false, message: '初始化失败: ' + e.message }, 500);
    }
  }

  // ===== 获取酒店配置（前端主要调用） =====
  try {
    // 1. 查酒店信息
    const hotel = await env.DB.prepare('SELECT * FROM hotels WHERE active = 1 LIMIT 1').first();
    if (!hotel) {
      return jsonResponse({ success: false, message: '暂无酒店配置' }, 200);
    }

    // 2. 查房型列表
    const roomsResult = await env.DB.prepare(
      'SELECT * FROM rooms WHERE hotel_id = ? AND status = \'active\' ORDER BY sort_order ASC'
    ).bind(hotel.id).all();
    const rooms = roomsResult.results.map(r => ({
      id: r.room_id,
      name: r.name,
      price: r.price,
      area: r.area,
      bedType: r.bed_type,
      features: (r.features || '').split(',').filter(Boolean),
      stock: r.total_stock
    }));

    // 3. 查优惠券模板
    const couponsResult = await env.DB.prepare(
      'SELECT * FROM coupon_templates WHERE hotel_id = ? AND status = \'active\' ORDER BY id ASC'
    ).bind(hotel.id).all();
    const coupons = couponsResult.results.map(c => ({
      id: c.coupon_id,
      name: c.name,
      amount: c.amount,
      condition: c.condition_amount,
      desc: c.description || `满${c.condition_amount}减${c.amount}`,
      expire: c.expire_days
    }));

    // 4. 组装返回
    const config = {
      hotel: {
        name: hotel.name,
        address: hotel.address,
        phone: hotel.phone,
        rating: hotel.rating,
        reviewCount: hotel.review_count,
        tags: (hotel.tags || '').split(',').filter(Boolean),
        description: hotel.description,
        checkinTime: hotel.checkin_time,
        checkoutTime: hotel.checkout_time,
        parking: hotel.parking
      },
      rooms,
      coupons
    };

    return jsonResponse({ success: true, config });

  } catch (e) {
    console.error('Config API error:', e.message || e);
    return jsonResponse({ success: false, message: '读取配置失败' }, 500);
  }
}

// POST /api/config — 管理员更新配置（需鉴权，由 _middleware 保护）
// Body: { action: 'update_hotel'|'update_room'|'update_coupon', ...data }
export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.DB) return jsonResponse({ success: false, message: '数据库不可用' }, 503);

  try {
    const body = await request.json();
    const now = new Date().toISOString();

    if (body.action === 'update_hotel') {
      const fields = ['name', 'address', 'phone', 'rating', 'review_count', 'tags', 'description', 'checkin_time', 'checkout_time', 'parking'];
      const updates = [];
      const values = [];
      for (const f of fields) {
        if (body[f] !== undefined) {
          updates.push(`${f} = ?`);
          values.push(body[f]);
        }
      }
      if (updates.length === 0) return jsonResponse({ success: false, message: '无更新字段' }, 400);
      updates.push('updated_at = ?');
      values.push(now);
      await env.DB.prepare(`UPDATE hotels SET ${updates.join(', ')} WHERE id = (SELECT id FROM hotels WHERE active = 1 LIMIT 1)`).bind(...values).run();
      return jsonResponse({ success: true, message: '酒店信息已更新' });
    }

    if (body.action === 'update_room') {
      if (!body.room_id) return jsonResponse({ success: false, message: '缺少 room_id' }, 400);
      const fields = { name: 'name', price: 'price', area: 'area', bed_type: 'bed_type', features: 'features', total_stock: 'total_stock', status: 'status', sort_order: 'sort_order' };
      // 使用 UPSERT：存在则更新，不存在则插入
      const hotel = await env.DB.prepare('SELECT id FROM hotels WHERE active = 1 LIMIT 1').first();
      const hotelId = hotel ? hotel.id : 1;
      const sets = ['hotel_id = excluded.hotel_id'];
      const vals = [hotelId, body.room_id, now];
      for (const [key, col] of Object.entries(fields)) {
        if (body[key] !== undefined) {
          sets.push(`${col} = excluded.${col}`);
          vals.push(body[key]);
        }
      }
      const columns = ['hotel_id', 'room_id', 'updated_at'];
      const placeholders = ['?', '?', '?'];
      for (const [key] of Object.entries(fields)) {
        if (body[key] !== undefined) {
          columns.push(fields[key]);
          placeholders.push('?');
        }
      }
      await env.DB.prepare(
        `INSERT INTO rooms (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) ON CONFLICT(room_id) DO UPDATE SET ${sets.join(', ')}`
      ).bind(...vals).run();
      return jsonResponse({ success: true, message: '房型已保存' });
    }

    if (body.action === 'update_coupon') {
      if (!body.coupon_id) return jsonResponse({ success: false, message: '缺少 coupon_id' }, 400);
      const fields = { name: 'name', amount: 'amount', condition_amount: 'condition_amount', expire_days: 'expire_days', description: 'description', max_claim_per_user: 'max_claim_per_user', status: 'status' };
      // 使用 UPSERT：存在则更新，不存在则插入
      const hotel = await env.DB.prepare('SELECT id FROM hotels WHERE active = 1 LIMIT 1').first();
      const hotelId = hotel ? hotel.id : 1;
      const sets = ['hotel_id = excluded.hotel_id'];
      const vals = [hotelId, body.coupon_id, now];
      const columns = ['hotel_id', 'coupon_id', 'created_at'];
      const placeholders = ['?', '?', '?'];
      for (const [key] of Object.entries(fields)) {
        if (body[key] !== undefined) {
          sets.push(`${fields[key]} = excluded.${fields[key]}`);
          columns.push(fields[key]);
          placeholders.push('?');
          vals.push(body[key]);
        }
      }
      await env.DB.prepare(
        `INSERT INTO coupon_templates (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) ON CONFLICT(coupon_id) DO UPDATE SET ${sets.join(', ')}`
      ).bind(...vals).run();
      return jsonResponse({ success: true, message: '优惠券模板已保存' });
    }

    return jsonResponse({ success: false, message: '未知操作: ' + (body.action || '') }, 400);

  } catch (e) {
    console.error('Config update error:', e.message || e);
    return jsonResponse({ success: false, message: '更新失败: ' + e.message }, 500);
  }
}
