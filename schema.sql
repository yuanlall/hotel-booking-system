-- D1 数据库 Schema: hotel-booking-db (多租户版)
-- 所有数据表通过 hotel_id 关联到 hotels 主表

-- 酒店主表（已存在，新增 slug 字段）
-- slug 用于 URL 标识，如 xiangjiang-intl
CREATE TABLE IF NOT EXISTS hotels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  rating REAL DEFAULT 4.5,
  review_count INTEGER DEFAULT 0,
  tags TEXT,
  description TEXT,
  checkin_time TEXT DEFAULT '14:00',
  checkout_time TEXT DEFAULT '12:00',
  parking TEXT DEFAULT '免费',
  active INTEGER DEFAULT 1,
  created_at TEXT,
  updated_at TEXT
);

-- 房型表（已存在，已有 hotel_id）
CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id INTEGER NOT NULL,
  room_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  price INTEGER DEFAULT 0,
  area TEXT,
  bed_type TEXT,
  features TEXT,
  total_stock INTEGER DEFAULT 1,
  status TEXT DEFAULT 'active',
  sort_order INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY (hotel_id) REFERENCES hotels(id)
);

-- 优惠券模板表（已存在，已有 hotel_id）
CREATE TABLE IF NOT EXISTS coupon_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id INTEGER,
  coupon_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  amount INTEGER DEFAULT 0,
  condition_amount INTEGER DEFAULT 0,
  expire_days INTEGER DEFAULT 7,
  description TEXT,
  max_claim_per_user INTEGER DEFAULT 1,
  status TEXT DEFAULT 'active',
  created_at TEXT,
  FOREIGN KEY (hotel_id) REFERENCES hotels(id)
);

-- 订单表（新增 hotel_id）
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT UNIQUE NOT NULL,
  hotel_id INTEGER NOT NULL DEFAULT 1,
  hotel TEXT DEFAULT '',
  room_name TEXT NOT NULL,
  checkin TEXT NOT NULL,
  checkout TEXT NOT NULL,
  nights INTEGER DEFAULT 1,
  guest_name TEXT NOT NULL,
  guest_phone TEXT NOT NULL,
  note TEXT DEFAULT '',
  original_total REAL DEFAULT 0,
  final_total REAL DEFAULT 0,
  status TEXT DEFAULT 'pending',
  status_text TEXT DEFAULT '待确认',
  feishu_record_id TEXT,
  submitted_at TEXT,
  ip TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (hotel_id) REFERENCES hotels(id)
);

-- 优惠券领取记录表（新增 hotel_id）
CREATE TABLE IF NOT EXISTS coupon_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id INTEGER NOT NULL DEFAULT 1,
  phone TEXT NOT NULL,
  coupon_id TEXT NOT NULL,
  coupon_name TEXT,
  amount INTEGER DEFAULT 0,
  condition_amount INTEGER DEFAULT 0,
  expire_at TEXT,
  used INTEGER DEFAULT 0,
  used_order_id TEXT,
  used_at TEXT,
  source TEXT DEFAULT 'self',
  referrer_of_phone TEXT,
  created_at TEXT,
  FOREIGN KEY (hotel_id) REFERENCES hotels(id)
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_orders_order_id ON orders(order_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_checkin ON orders(checkin);
CREATE INDEX IF NOT EXISTS idx_orders_checkout ON orders(checkout);
CREATE INDEX IF NOT EXISTS idx_orders_hotel_id ON orders(hotel_id);
CREATE INDEX IF NOT EXISTS idx_coupon_claims_hotel_id ON coupon_claims(hotel_id);
CREATE INDEX IF NOT EXISTS idx_hotels_slug ON hotels(slug);
