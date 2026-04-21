-- 使用者記錄表 (Teams 登入)
CREATE TABLE IF NOT EXISTS users (
  user_code TEXT PRIMARY KEY,
  ad_name TEXT NOT NULL,
  custom_nickname TEXT,
  last_nickname_update DATETIME
);

-- 說帖記錄表
CREATE TABLE IF NOT EXISTS pitches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_code TEXT,
  industry TEXT NOT NULL,
  role TEXT NOT NULL,
  channel TEXT NOT NULL,
  scale TEXT DEFAULT '',
  pain_points TEXT DEFAULT '',
  session_pref TEXT DEFAULT '',
  customer_type TEXT DEFAULT '',
  style TEXT DEFAULT '',
  content TEXT NOT NULL,
  author TEXT DEFAULT '匿名業務',
  likes INTEGER DEFAULT 0,
  dislikes INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 投票記錄（防重複投票）
CREATE TABLE IF NOT EXISTS votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pitch_id INTEGER NOT NULL,
  voter_id TEXT NOT NULL,
  vote_type TEXT NOT NULL CHECK(vote_type IN ('like', 'dislike')),
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(pitch_id, voter_id),
  FOREIGN KEY (pitch_id) REFERENCES pitches(id)
);

-- 限流記錄表
CREATE TABLE IF NOT EXISTS rate_limits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL
);

-- ============================================================
-- Phase 1：活動資源中心 schema
-- ============================================================

-- 系列活動（Migration 2025-04）
CREATE TABLE IF NOT EXISTS event_series (
  id           TEXT    PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name         TEXT    NOT NULL,
  description  TEXT,
  cover_image_key TEXT,
  status       TEXT    NOT NULL DEFAULT 'active' CHECK(status IN ('active','ended','archived')),
  created_by   TEXT    NOT NULL,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch())
);

-- 活動主檔
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  target_audience TEXT,
  event_date TEXT NOT NULL,
  event_time TEXT,
  location TEXT,
  cover_image_key TEXT,
  status TEXT NOT NULL DEFAULT 'upcoming' CHECK(status IN ('upcoming','ongoing','ended','archived')),
  -- 系列欄位（Migration 2025-04）
  series_id TEXT REFERENCES event_series(id) ON DELETE SET NULL,
  series_order INTEGER,
  created_by TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
CREATE INDEX IF NOT EXISTS idx_events_date ON events(event_date);

-- 資源（連結存 D1，檔案存 R2）
CREATE TABLE IF NOT EXISTS resources (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  resource_type TEXT NOT NULL CHECK(resource_type IN ('article','slide','video','other')),
  storage_type TEXT NOT NULL CHECK(storage_type IN ('link','r2')),
  url TEXT,
  r2_key TEXT,
  file_name TEXT,
  file_size INTEGER,
  mime_type TEXT,
  uploaded_by TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_resources_event ON resources(event_id);
CREATE INDEX IF NOT EXISTS idx_resources_type ON resources(resource_type);

-- 標籤字典（固定分類，可由 superadmin 擴充）
CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL CHECK(category IN ('industry','role','channel','scale','customer_type','session_pref','resource_type','custom')),
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(category, name)
);
CREATE INDEX IF NOT EXISTS idx_tags_category ON tags(category);

-- 標籤關聯（event / resource 共用）
CREATE TABLE IF NOT EXISTS tag_relations (
  target_type TEXT NOT NULL CHECK(target_type IN ('event','resource')),
  target_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  PRIMARY KEY (target_type, target_id, tag_id),
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_tag_relations_tag ON tag_relations(tag_id);

-- 使用者角色（superadmin / eventadmin）
CREATE TABLE IF NOT EXISTS user_roles (
  user_code TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK(role IN ('superadmin','eventadmin')),
  granted_by TEXT,
  granted_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- eventadmin 可管轄的活動範圍（superadmin 不需進此表，預設全活動）
CREATE TABLE IF NOT EXISTS event_admins (
  user_code TEXT NOT NULL,
  event_id TEXT NOT NULL,
  granted_by TEXT,
  granted_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (user_code, event_id),
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);
