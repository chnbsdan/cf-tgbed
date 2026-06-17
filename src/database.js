/**
 * 数据库操作模块
 */

let isDatabaseInitialized = false;

export async function initDatabase(config) {
  if (isDatabaseInitialized) return;
  
  try {
    const db = config.database;
    
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS files (
        url TEXT PRIMARY KEY,
        fileId TEXT NOT NULL,
        message_id INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        file_name TEXT,
        file_size INTEGER,
        mime_type TEXT
      )
    `).run();
    
    await db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_files_created_at ON files(created_at DESC)
    `).run();
    
    await db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_files_file_name ON files(file_name)
    `).run();
    
    await db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_files_url ON files(url)
    `).run();
    
    isDatabaseInitialized = true;
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Database initialization failed:', error);
    throw new Error('Database initialization failed');
  }
}

export async function saveFile(db, fileData) {
  const { url, fileId, messageId, timestamp, fileName, fileSize, mimeType } = fileData;
  
  await db.prepare(`
    INSERT INTO files (url, fileId, message_id, created_at, file_name, file_size, mime_type) 
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    url,
    fileId,
    messageId,
    timestamp,
    fileName,
    fileSize,
    mimeType
  ).run();
}

export async function getFileByUrl(db, url) {
  return await db.prepare(
    `SELECT fileId, message_id, file_name, mime_type
     FROM files WHERE url = ?`
  ).bind(url).first();
}

export async function getFiles(db, options = {}) {
  const { limit = 100, offset = 0, orderBy = 'created_at DESC' } = options;
  
  return await db.prepare(
    `SELECT url, fileId, message_id, created_at, file_name, file_size, mime_type
     FROM files
     ORDER BY ${orderBy}
     LIMIT ? OFFSET ?`
  ).bind(limit, offset).all();
}

export async function searchFiles(db, query) {
  const searchPattern = `%${query}%`;
  return await db.prepare(
    `SELECT url, fileId, message_id, created_at, file_name, file_size, mime_type
     FROM files 
     WHERE file_name LIKE ? ESCAPE '!'
     COLLATE NOCASE
     ORDER BY created_at DESC`
  ).bind(searchPattern).all();
}

export async function deleteFile(db, url) {
  return await db.prepare('DELETE FROM files WHERE url = ?').bind(url).run();
}

export async function deleteFiles(db, urls) {
  if (!urls || urls.length === 0) return { deleted: 0 };
  
  const placeholders = urls.map(() => '?').join(',');
  const result = await db.prepare(
    `DELETE FROM files WHERE url IN (${placeholders})`
  ).bind(...urls).run();
  
  return { deleted: result.meta.changes };
}

export async function getFileCount(db) {
  const result = await db.prepare('SELECT COUNT(*) as count FROM files').first();
  return result?.count || 0;
}

export async function getTotalSize(db) {
  const result = await db.prepare('SELECT SUM(file_size) as total FROM files').first();
  return result?.total || 0;
}
