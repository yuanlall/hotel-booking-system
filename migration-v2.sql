-- Migration v2: Fix multi-tenant isolation + Add photo fields
-- 1. Recreate rooms table with composite UNIQUE(hotel_id, room_id)
CREATE TABLE IF NOT EXISTS rooms_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hotel_id INTEGER NOT NULL,
    room_id TEXT NOT NULL,
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
    FOREIGN KEY (hotel_id) REFERENCES hotels(id),
    UNIQUE(hotel_id, room_id)
);
INSERT OR IGNORE INTO rooms_new SELECT * FROM rooms;
DROP TABLE rooms;
ALTER TABLE rooms_new RENAME TO rooms;
CREATE INDEX IF NOT EXISTS idx_rooms_hotel_id ON rooms(hotel_id);

-- 2. Recreate coupon_templates table with composite UNIQUE(hotel_id, coupon_id)
CREATE TABLE IF NOT EXISTS coupon_templates_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hotel_id INTEGER,
    coupon_id TEXT NOT NULL,
    name TEXT NOT NULL,
    amount INTEGER DEFAULT 0,
    condition_amount INTEGER DEFAULT 0,
    expire_days INTEGER DEFAULT 7,
    description TEXT,
    max_claim_per_user INTEGER DEFAULT 1,
    status TEXT DEFAULT 'active',
    created_at TEXT,
    FOREIGN KEY (hotel_id) REFERENCES hotels(id),
    UNIQUE(hotel_id, coupon_id)
);
INSERT OR IGNORE INTO coupon_templates_new SELECT * FROM coupon_templates;
DROP TABLE coupon_templates;
ALTER TABLE coupon_templates_new RENAME TO coupon_templates;

-- 3. Add photo columns to hotels table
ALTER TABLE hotels ADD COLUMN carousel_images TEXT DEFAULT '[]';
ALTER TABLE hotels ADD COLUMN gallery_images TEXT DEFAULT '[]';

-- 4. Seed photo data for hotel 1 (香江国际)
UPDATE hotels SET carousel_images = '["./assets/hero-exterior.jpg","./assets/hero-lobby.jpg","./assets/hero-room.jpg","./assets/hero-restaurant.jpg"]' WHERE id = 1;
UPDATE hotels SET gallery_images = '["./assets/photo-grid-1.jpg","./assets/photo-grid-2.jpg","./assets/photo-grid-3.jpg","./assets/photo-grid-4.jpg","./assets/photo-grid-5.jpg"]' WHERE id = 1;
