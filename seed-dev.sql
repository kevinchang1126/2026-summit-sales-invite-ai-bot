-- 本地 dev 測試資料（P4 煙霧測試用）
-- 執行：npx wrangler d1 execute DB --local --file=seed-dev.sql

INSERT OR IGNORE INTO tags (id, category, name, sort_order) VALUES
  ('t_ind_mfg',     'industry', '製造業',     1),
  ('t_ind_biotech', 'industry', '生醫',       2),
  ('t_ind_plastic', 'industry', '塑膠',       3),
  ('t_role_ceo',    'role',     '企業主',     1),
  ('t_role_it',     'role',     'IT資訊人員', 2),
  ('t_role_ops',    'role',     '廠長',       3);

INSERT OR IGNORE INTO events (id, name, description, event_date, location, status, created_by) VALUES
  ('2026040001', '台北場', 'Phase 4 測試活動 - 台北', '2026-04-16', '台北大直典華', 'upcoming', 'dev_user'),
  ('2026040002', '台中場', 'Phase 4 測試活動 - 台中', '2026-04-21', '台中金典酒店', 'upcoming', 'dev_user'),
  ('2026010003', '過往場次', '三個月前的活動',         '2026-01-15', '高雄',         'ended',    'dev_user');

INSERT OR IGNORE INTO resources (id, event_id, title, description, resource_type, storage_type, url, uploaded_by) VALUES
  ('r_demo_1', '2026040001', 'Agentic AI 產業白皮書',   '院長分享的 AI 轉型重點',   'article', 'link', 'https://example.com/whitepaper', 'dev_user'),
  ('r_demo_2', '2026040001', '製造業 AI 應用案例簡報',   '高通 Edge AI 案例',        'slide',   'link', 'https://example.com/slides',     'dev_user'),
  ('r_demo_3', '2026040002', '生醫產業 AI 策略',         '點點心 / 歐都納 案例',     'article', 'link', 'https://example.com/biotech',    'dev_user'),
  ('r_demo_4', '2026040002', 'IT 資訊長圓桌座談',         'AI 治理新挑戰',            'video',   'link', 'https://example.com/video',      'dev_user'),
  ('r_demo_5', '2026010003', '歷史簡報：轉型白皮書',     '三個月前場次資料',         'slide',   'link', 'https://example.com/old',        'dev_user');

INSERT OR IGNORE INTO tag_relations (target_type, target_id, tag_id) VALUES
  ('resource', 'r_demo_1', 't_ind_mfg'),
  ('resource', 'r_demo_1', 't_role_ceo'),
  ('resource', 'r_demo_2', 't_ind_mfg'),
  ('resource', 'r_demo_2', 't_role_it'),
  ('resource', 'r_demo_3', 't_ind_biotech'),
  ('resource', 'r_demo_3', 't_role_ceo'),
  ('resource', 'r_demo_4', 't_role_it'),
  ('resource', 'r_demo_4', 't_ind_plastic'),
  ('resource', 'r_demo_5', 't_ind_mfg'),
  ('resource', 'r_demo_5', 't_role_ops');
