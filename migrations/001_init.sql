-- ============================================================
-- CF-TGBed 数据库初始化
-- 创建文件元数据表
-- ============================================================

CREATE TABLE IF NOT EXISTS files (
  url TEXT PRIMARY KEY,
  fileId TEXT,
  message_id INTEGER,
  created_at INTEGER NOT NULL,
  file_name TEXT,
  file_size INTEGER,
  mime_type TEXT,
  storage_type TEXT DEFAULT 'telegram'
);

-- 创建索引优化查询性能
CREATE INDEX IF NOT EXISTS idx_files_created_at ON files(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_files_storage_type ON files(storage_type);
CREATE INDEX IF NOT EXISTS idx_files_file_name ON files(file_name);

-- 创建视图：统计信息
CREATE VIEW IF NOT EXISTS v_file_stats AS
SELECT 
  storage_type,
  COUNT(*) as file_count,
  SUM(file_size) as total_size
FROM files
GROUP BY storage_type;
