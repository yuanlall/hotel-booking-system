-- D1 数据库 Schema: hotel-booking-db
-- 订单表
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT UNIQUE NOT NULL,
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
  created_at TEXT DEFAULT (datetime('now'))
);

-- 索引：按订单号查询
CREATE INDEX IF NOT EXISTS idx_orders_order_id ON orders(order_id);

-- 索引：按状态查询
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

-- 索引：按日期范围查询（房态计算用）
CREATE INDEX IF NOT EXISTS idx_orders_checkin ON orders(checkin);
CREATE INDEX IF NOT EXISTS idx_orders_checkout ON orders(checkout);
