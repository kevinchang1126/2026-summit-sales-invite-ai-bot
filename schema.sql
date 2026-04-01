-- 說帖記錄表
CREATE TABLE IF NOT EXISTS pitches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
