// ========== Cloudflare Pages Function: 酒店配置 API (多租户版) ==========
// D1 Schema: hotels / rooms / coupon_templates 三张配置表
// 所有查询通过 hotel_id 隔离数据
// 前端通过 hotel slug（URL参数）识别酒店，API 内部转为 hotel_id

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}

// 从 URL 参数或请求头解析 hotel slug，再查 D1 获取 hotel_id
// 返回 { hotelId, hotel, slug } 或 null
async function resolveHotel(env, request) {
  const url = new URL(request.url);
  // 优先从 query 参数获取 slug
  let slug = url.searchParams.get('hotel');

  // fallback: 从自定义请求头获取
  if (!slug) {
    slug = request.headers.get('X-Hotel-Slug');
  }

  // fallback: 从 Referer 解析（前端页面跳转 API 时自动携带）
  if (!slug) {
    const referer = request.headers.get('Referer') || '';
    const refererUrl = referer ? new URL(referer) : null;
    if (refererUrl) {
      slug = refererUrl.searchParams.get('hotel');
    }
  }

  // 如果没有指定 slug，返回默认酒店（向后兼容）
  if (!slug) {
    const hotel = await env.DB.prepare('SELECT id, slug FROM hotels WHERE active = 1 ORDER BY id ASC LIMIT 1').first();
    if (hotel) return { hotelId: hotel.id, hotel, slug: hotel.slug };
    return null;
  }

  // 按 slug 查找
  const hotel = await env.DB.prepare('SELECT * FROM hotels WHERE slug = ? AND active = 1').bind(slug).first();
  if (hotel) return { hotelId: hotel.id, hotel, slug };

  // 兼容：如果是数字，尝试按 id 查找
  const id = parseInt(slug);
  if (!isNaN(id)) {
    const byId = await env.DB.prepare('SELECT * FROM hotels WHERE id = ? AND active = 1').bind(id).first();
    if (byId) return { hotelId: byId.id, hotel: byId, slug: byId.slug };
  }

  return null;
}

// GET /api/config — 获取酒店全部配置（前端调用）
//   ?hotel=xiangjiang-intl  — 指定酒店 slug
//   ?action=init            — 初始化表结构+种子数据
//   ?action=init&reset=1    — 重建表（清空旧数据）
//   ?action=availability    — 查房态
//   ?action=list_hotels     — 列出所有酒店（管理后台用）
export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const action = url.searchParams.get('action');

  if (!env.DB) return jsonResponse({ success: false, message: '数据库不可用' }, 503);

  // ===== 列出所有酒店（管理后台用，含员工账号信息） =====
  if (action === 'list_hotels') {
    try {
      const result = await env.DB.prepare('SELECT id, slug, name, address, phone, active FROM hotels ORDER BY id ASC').all();
      // 查询每个酒店的员工账号
      const hotels = result.results;
      for (let i = 0; i < hotels.length; i++) {
        try {
          const account = await env.DB.prepare('SELECT account, password FROM hotel_accounts WHERE hotel_id = ? AND active = 1 LIMIT 1').bind(hotels[i].id).first();
          hotels[i].staffAccount = account ? account.account : '';
          hotels[i].staffPassword = account ? account.password : '';
        } catch(e) {
          hotels[i].staffAccount = '';
          hotels[i].staffPassword = '';
        }
      }
      return jsonResponse({ success: true, hotels });
    } catch(e) {
      return jsonResponse({ success: false, message: '查询失败' }, 500);
    }
  }

  // ===== 公开房态查询（无需鉴权） =====
  if (action === 'availability') {
    try {
      const resolved = await resolveHotel(env, request);
      if (!resolved) return jsonResponse({ success: false, message: '酒店不存在' }, 404);

      const date = url.searchParams.get('date') || new Date().toISOString().slice(0, 10);
      const rooms = await env.DB.prepare(
        'SELECT room_id, total_stock FROM rooms WHERE hotel_id = ? AND status = \'active\''
      ).bind(resolved.hotelId).all();

      const orders = await env.DB.prepare(
        'SELECT room_name FROM orders WHERE hotel_id = ? AND status = \'confirmed\' AND checkin <= ? AND checkout > ?'
      ).bind(resolved.hotelId, date, date).all();

      const roomNames = await env.DB.prepare('SELECT room_id, name FROM rooms WHERE hotel_id = ? AND status = \'active\'').bind(resolved.hotelId).all();
      const nameToId = {};
      roomNames.results.forEach(r => { nameToId[r.name] = r.room_id; });

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
      return jsonResponse({ success: true, availability, date, hotelId: resolved.hotelId });
    } catch(e) {
      return jsonResponse({ success: false, message: '查询失败' }, 500);
    }
  }

  // ===== 初始化表结构 + 种子数据 =====
  if (action === 'init') {
    try {
      const reset = url.searchParams.get('reset') === '1';

      if (reset) {
        await env.DB.exec('DROP TABLE IF EXISTS coupon_claims');
        await env.DB.exec('DROP TABLE IF EXISTS orders');
        await env.DB.exec('DROP TABLE IF EXISTS rooms');
        await env.DB.exec('DROP TABLE IF EXISTS coupon_templates');
        await env.DB.exec('DROP TABLE IF EXISTS hotels');
      }

      // 1. hotels 表（含 slug）
      await env.DB.exec(
        'CREATE TABLE IF NOT EXISTS hotels (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL, address TEXT, phone TEXT, rating REAL DEFAULT 4.5, review_count INTEGER DEFAULT 0, tags TEXT, description TEXT, checkin_time TEXT DEFAULT \'14:00\', checkout_time TEXT DEFAULT \'12:00\', parking TEXT DEFAULT \'免费\', active INTEGER DEFAULT 1, created_at TEXT, updated_at TEXT)'
      );

      // 2. rooms 表（已有 hotel_id）
      await env.DB.exec(
        'CREATE TABLE IF NOT EXISTS rooms (id INTEGER PRIMARY KEY AUTOINCREMENT, hotel_id INTEGER NOT NULL, room_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL, price INTEGER DEFAULT 0, area TEXT, bed_type TEXT, features TEXT, total_stock INTEGER DEFAULT 1, status TEXT DEFAULT \'active\', sort_order INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT, FOREIGN KEY (hotel_id) REFERENCES hotels(id))'
      );

      // 3. coupon_templates 表（已有 hotel_id）
      await env.DB.exec(
        'CREATE TABLE IF NOT EXISTS coupon_templates (id INTEGER PRIMARY KEY AUTOINCREMENT, hotel_id INTEGER, coupon_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL, amount INTEGER DEFAULT 0, condition_amount INTEGER DEFAULT 0, expire_days INTEGER DEFAULT 7, description TEXT, max_claim_per_user INTEGER DEFAULT 1, status TEXT DEFAULT \'active\', created_at TEXT, FOREIGN KEY (hotel_id) REFERENCES hotels(id))'
      );

      // 4. orders 表（新增 hotel_id）
      await env.DB.exec(
        'CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT UNIQUE NOT NULL, hotel_id INTEGER NOT NULL DEFAULT 1, hotel TEXT DEFAULT \'\', room_name TEXT NOT NULL, checkin TEXT NOT NULL, checkout TEXT NOT NULL, nights INTEGER DEFAULT 1, guest_name TEXT NOT NULL, guest_phone TEXT NOT NULL, note TEXT DEFAULT \'\', original_total REAL DEFAULT 0, final_total REAL DEFAULT 0, status TEXT DEFAULT \'pending\', status_text TEXT DEFAULT \'待确认\', feishu_record_id TEXT, submitted_at TEXT, ip TEXT DEFAULT \'\', created_at TEXT DEFAULT (datetime(\'now\')), FOREIGN KEY (hotel_id) REFERENCES hotels(id))'
      );

      // 5. coupon_claims 表（新增 hotel_id）
      await env.DB.exec(
        'CREATE TABLE IF NOT EXISTS coupon_claims (id INTEGER PRIMARY KEY AUTOINCREMENT, hotel_id INTEGER NOT NULL DEFAULT 1, phone TEXT NOT NULL, coupon_id TEXT NOT NULL, coupon_name TEXT, amount INTEGER DEFAULT 0, condition_amount INTEGER DEFAULT 0, expire_at TEXT, used INTEGER DEFAULT 0, used_order_id TEXT, used_at TEXT, source TEXT DEFAULT \'self\', referrer_of_phone TEXT, created_at TEXT, FOREIGN KEY (hotel_id) REFERENCES hotels(id))'
      );

      // 6. hotel_accounts 表（酒店员工账号）
      await env.DB.exec(
        'CREATE TABLE IF NOT EXISTS hotel_accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, hotel_id INTEGER NOT NULL, account TEXT UNIQUE NOT NULL, password TEXT NOT NULL, role TEXT DEFAULT \'staff\', name TEXT DEFAULT \'\', active INTEGER DEFAULT 1, created_at TEXT, updated_at TEXT, FOREIGN KEY (hotel_id) REFERENCES hotels(id))'
      );

      // 索引
      try { await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_orders_hotel_id ON orders(hotel_id)'); } catch(e) {}
      try { await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_coupon_claims_hotel_id ON coupon_claims(hotel_id)'); } catch(e) {}
      try { await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_hotels_slug ON hotels(slug)'); } catch(e) {}
      try { await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_hotel_accounts_account ON hotel_accounts(account)'); } catch(e) {}
      try { await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_hotel_accounts_hotel_id ON hotel_accounts(hotel_id)'); } catch(e) {}

      // 为旧表补充新列（兼容升级）
      try { await env.DB.exec('ALTER TABLE hotels ADD COLUMN slug TEXT'); } catch(e) {}
      try { await env.DB.exec('ALTER TABLE orders ADD COLUMN hotel_id INTEGER NOT NULL DEFAULT 1'); } catch(e) {}
      try { await env.DB.exec('ALTER TABLE coupon_claims ADD COLUMN hotel_id INTEGER NOT NULL DEFAULT 1'); } catch(e) {}

      // 检查种子数据
      const hotelCount = await env.DB.prepare('SELECT COUNT(*) as cnt FROM hotels').first();
      if (hotelCount && hotelCount.cnt === 0) {
        const now = new Date().toISOString();

        // 插入香江国际酒店
        await env.DB.prepare(
          'INSERT INTO hotels (slug, name, address, phone, rating, review_count, tags, description, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(
          'xiangjiang-intl',
          '赣州香江国际酒店',
          '赣州市章贡区长冈路13号达芬奇国际中心9栋',
          '0797-8681517',
          4.8, 328,
          '官方直营,近博物馆,免费停车,含早餐,新装修',
          '赣州章贡区精品商务酒店，近博物馆，官方直营0佣金预订',
          1, now, now
        ).run();

        const hotel = await env.DB.prepare('SELECT id FROM hotels WHERE slug = ?').bind('xiangjiang-intl').first();
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

        // 创建香江国际员工账号
        try {
          await env.DB.prepare(
            'INSERT INTO hotel_accounts (hotel_id, account, password, role, name, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
          ).bind(hotelId, 'xiangjiang_intl', 'hotel0001', 'staff', '香江国际前台', 1, now, now).run();
        } catch(e) { console.log('Seed account exists:', e.message); }
      } else {
        // 已有数据：为旧记录补充 slug
        const noSlug = await env.DB.prepare('SELECT id, name FROM hotels WHERE slug IS NULL OR slug = \'\'').all();
        for (const h of noSlug.results) {
          const slug = generateSlug(h.name) + '-' + h.id;
          await env.DB.prepare('UPDATE hotels SET slug = ? WHERE id = ?').bind(slug, h.id).run();
        }

        // 为已有酒店补充员工账号
        const hotelsWithoutAccount = await env.DB.prepare('SELECT h.id, h.slug, h.name FROM hotels h LEFT JOIN hotel_accounts a ON h.id = a.hotel_id WHERE a.id IS NULL AND h.active = 1').all();
        for (const h of hotelsWithoutAccount.results) {
          const account = (h.slug || generateSlug(h.name)).replace(/-/g, '_');
          const password = 'hotel' + h.id.toString().slice(-4).padStart(4, '0');
          try {
            await env.DB.prepare(
              'INSERT INTO hotel_accounts (hotel_id, account, password, role, name, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
            ).bind(h.id, account, password, 'staff', h.name + ' 前台', 1, new Date().toISOString(), new Date().toISOString()).run();
          } catch(e) { console.log('Account already exists for', h.name); }
        }
      }

      return jsonResponse({ success: true, message: '配置表已就绪（多租户版）' });
    } catch (e) {
      return jsonResponse({ success: false, message: '初始化失败: ' + e.message }, 500);
    }
  }

  // ===== 获取酒店配置（前端主要调用） =====
  try {
    const resolved = await resolveHotel(env, request);
    if (!resolved) {
      return jsonResponse({ success: false, message: '酒店不存在或未指定' }, 404);
    }

    const hotel = resolved.hotel;

    // 查房型列表
    const roomsResult = await env.DB.prepare(
      'SELECT * FROM rooms WHERE hotel_id = ? AND status = \'active\' ORDER BY sort_order ASC'
    ).bind(resolved.hotelId).all();
    const rooms = roomsResult.results.map(r => ({
      id: r.room_id,
      name: r.name,
      price: r.price,
      area: r.area,
      bedType: r.bed_type,
      features: (r.features || '').split(',').filter(Boolean),
      stock: r.total_stock
    }));

    // 查优惠券模板
    const couponsResult = await env.DB.prepare(
      'SELECT * FROM coupon_templates WHERE hotel_id = ? AND status = \'active\' ORDER BY id ASC'
    ).bind(resolved.hotelId).all();
    const coupons = couponsResult.results.map(c => ({
      id: c.coupon_id,
      name: c.name,
      amount: c.amount,
      condition: c.condition_amount,
      desc: c.description || `满${c.condition_amount}减${c.amount}`,
      expire: c.expire_days
    }));

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
        parking: hotel.parking,
        slug: hotel.slug
      },
      rooms,
      coupons
    };

    return jsonResponse({ success: true, config, hotelId: resolved.hotelId });

  } catch (e) {
    console.error('Config API error:', e.message || e);
    return jsonResponse({ success: false, message: '读取配置失败' }, 500);
  }
}

// 生成 URL-safe slug
function generateSlug(name) {
  // 简单实现：取拼音首字母或简化
  // 这里用简化策略：移除特殊字符，空格转连字符
  return name
    .replace(/[^\w\u4e00-\u9fff]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 40);
}

// POST /api/config — 管理员更新配置（需鉴权）
// Body: { action: 'update_hotel'|'update_room'|'update_coupon'|'create_hotel', hotelId?, ...data }
export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.DB) return jsonResponse({ success: false, message: '数据库不可用' }, 503);

  try {
    const body = await request.json();
    const now = new Date().toISOString();

    // ===== 创建新酒店（官网生成器调用） =====
    if (body.action === 'create_hotel') {
      const name = body.name || body.hotelName;
      if (!name) return jsonResponse({ success: false, message: '缺少酒店名称' }, 400);

      // 生成 slug
      let slug = body.slug || generateSlug(name);
      // 确保 slug 唯一
      const existing = await env.DB.prepare('SELECT id FROM hotels WHERE slug = ?').bind(slug).first();
      if (existing) {
        slug = slug + '-' + Date.now().toString(36);
      }

      await env.DB.prepare(
        'INSERT INTO hotels (slug, name, address, phone, rating, review_count, tags, description, checkin_time, checkout_time, parking, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(
        slug, name,
        body.address || body.hotelAddress || '',
        body.phone || body.hotelPhone || '',
        body.rating || body.hotelRating || 4.5,
        body.reviewCount || body.reviewCount || 0,
        body.tags || body.hotelTags || '',
        body.description || body.hotelDesc || '',
        body.checkinTime || '14:00',
        body.checkoutTime || '12:00',
        body.parking || '免费',
        1, now, now
      ).run();

      const hotel = await env.DB.prepare('SELECT id, slug FROM hotels WHERE slug = ?').bind(slug).first();

      // 如果有房型数据，一并插入
      if (body.rooms && body.rooms.length) {
        for (let i = 0; i < body.rooms.length; i++) {
          const r = body.rooms[i];
          const roomId = slug + '-' + (r.id || r.name.toLowerCase().replace(/\s+/g, '-')) + '-' + i;
          await env.DB.prepare(
            'INSERT INTO rooms (hotel_id, room_id, name, price, area, bed_type, features, total_stock, status, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
          ).bind(hotel.id, roomId, r.name, r.price || 0, r.area || '', r.bed || r.bedType || '', r.features || '', r.stock || 1, 'active', i + 1, now).run();
        }
      }

      // 如果有优惠券模板，插入默认模板
      if (body.createDefaultCoupons !== false) {
        const defaultCoupons = [
          { coupon_id: slug + '-new', name: '新客专享', amount: 30, condition: 200, days: 7, desc: '满200减30', max: 1 },
          { coupon_id: slug + '-share', name: '分享立减', amount: 50, condition: 300, days: 7, desc: '满300减50', max: 999 }
        ];
        for (const c of defaultCoupons) {
          await env.DB.prepare(
            'INSERT INTO coupon_templates (hotel_id, coupon_id, name, amount, condition_amount, expire_days, description, max_claim_per_user, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
          ).bind(hotel.id, c.coupon_id, c.name, c.amount, c.condition, c.days, c.desc, c.max, 'active', now).run();
        }
      }

      // 返回酒店信息和预订链接
      const bookingBaseUrl = body.bookingUrl || '';
      const bookingLink = bookingBaseUrl ? `${bookingBaseUrl}?hotel=${slug}` : `?hotel=${slug}`;

      // 创建酒店员工账号（默认账号=slug，密码=hotel+id后4位）
      const defaultPassword = 'hotel' + hotel.id.toString().slice(-4).padStart(4, '0');
      const staffAccount = slug.replace(/-/g, '_');
      try {
        await env.DB.prepare(
          'INSERT INTO hotel_accounts (hotel_id, account, password, role, name, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(hotel.id, staffAccount, defaultPassword, 'staff', name + ' 前台', 1, now, now).run();
      } catch(e) {
        // hotel_accounts 表可能不存在，init 后重试
        console.log('hotel_accounts insert failed:', e.message);
      }

      return jsonResponse({
        success: true,
        hotelId: hotel.id,
        slug,
        bookingLink,
        staffAccount,
        staffPassword: defaultPassword,
        staffLoginUrl: bookingBaseUrl ? `${bookingBaseUrl}/staff?hotel=${slug}` : `/staff?hotel=${slug}`,
        message: '酒店创建成功'
      });
    }

    // ===== 更新酒店信息 =====
    if (body.action === 'update_hotel') {
      const hotelId = body.hotelId;
      if (!hotelId) return jsonResponse({ success: false, message: '缺少 hotelId' }, 400);

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
      values.push(hotelId);
      await env.DB.prepare(`UPDATE hotels SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();
      return jsonResponse({ success: true, message: '酒店信息已更新' });
    }

    if (body.action === 'update_room') {
      if (!body.room_id) return jsonResponse({ success: false, message: '缺少 room_id' }, 400);
      const hotelId = body.hotelId;
      if (!hotelId) return jsonResponse({ success: false, message: '缺少 hotelId' }, 400);

      const fields = { name: 'name', price: 'price', area: 'area', bed_type: 'bed_type', features: 'features', total_stock: 'total_stock', status: 'status', sort_order: 'sort_order' };
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
      const hotelId = body.hotelId;
      if (!hotelId) return jsonResponse({ success: false, message: '缺少 hotelId' }, 400);

      const fields = { name: 'name', amount: 'amount', condition_amount: 'condition_amount', expire_days: 'expire_days', description: 'description', max_claim_per_user: 'max_claim_per_user', status: 'status' };
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
