// ============================================================
// CF-TGBed - Cloudflare Workers 图床服务
// 支持: Telegram / R2 / GitHub 三种存储方式
// 功能: 上传、管理、搜索、批量操作、WebP转换、二维码分享、退出登录
// 新增: 图片预览支持鼠标滚轮缩放 + 拖拽平移、多视图切换（网格/列表/瀑布流）
// Telegram Bot API 官方文件上传限制为 50MB
// 超过 50MB 的文件无法通过 Telegram 上传，请使用 R2 或 GitHub 存储
// 可通过环境变量 MAX_SIZE_MB 调整，建议不超过 50
// 大文件（>20MB）使用流式传输，支持 Range 请求，解决视频播放问题
// 作者: Chnbsdan
// 版本: 2.3
// ============================================================

// ============================================================
// 1. 数据库初始化
// ============================================================
let isDatabaseInitialized = false;

async function initDatabase(config) {
  if (isDatabaseInitialized) return;
  try {
    await config.database.prepare(`
      CREATE TABLE IF NOT EXISTS files (
        url TEXT PRIMARY KEY,
        fileId TEXT,
        message_id INTEGER,
        created_at INTEGER NOT NULL,
        file_name TEXT,
        file_size INTEGER,
        mime_type TEXT,
        storage_type TEXT DEFAULT 'telegram'
      )
    `).run();
    isDatabaseInitialized = true;
  } catch (error) {
    console.error('Database initialization failed:', error);
    throw new Response('Database error', { status: 500 });
  }
}

// ============================================================
// 2. 导出主函数
// ============================================================
export default {
  async fetch(request, env) {
    // 2.1 加载配置
    const config = {
      domain: env.DOMAIN,
      database: env.DATABASE,
      username: env.USERNAME || 'admin',
      password: env.PASSWORD || 'admin',
      enableAuth: env.ENABLE_AUTH !== 'false',
      tgBotToken: env.TG_BOT_TOKEN,
      tgChatId: env.TG_CHAT_ID,
      cookie: Number(env.COOKIE) || 7,
      // Telegram Bot API 官方文件上传限制为 50MB
      // 超过 50MB 的文件无法通过 Telegram 上传，请使用 R2 或 GitHub 存储
      // 可通过环境变量 MAX_SIZE_MB 调整，建议不超过 50
      maxSizeMB: Number(env.MAX_SIZE_MB) || 50,
      chunkSize: Number(env.CHUNK_SIZE) || 5 * 1024 * 1024,
      r2Bucket: env.R2_BUCKET,
      r2PublicUrl: env.R2_PUBLIC_URL,
      enableR2Fallback: env.ENABLE_R2_FALLBACK === 'true',
      githubToken: env.GITHUB_TOKEN,
      githubRepo: env.GITHUB_REPO,
      githubBranch: env.GITHUB_BRANCH || 'main',
      githubPath: env.GITHUB_PATH || 'images'
    };

    // 2.2 初始化数据库
    await initDatabase(config);
    
    const { pathname } = new URL(request.url);

    // 2.3 GitHub 代理（优先处理）
    if (pathname.startsWith('/github/')) {
      return await handleGitHubProxy(request, config);
    }

    // 2.4 配置接口
    if (pathname === '/config') {
      return new Response(JSON.stringify({ 
        maxSizeMB: config.maxSizeMB,
        chunkSize: config.chunkSize,
        enableR2Fallback: config.enableR2Fallback,
        supportedTypes: config.supportedTypes || [
          'image/jpeg', 'image/png', 'image/gif', 'image/webp',
          'video/mp4', 'video/webm',
          'audio/mpeg', 'audio/wav', 'audio/ogg',
          'application/pdf', 'text/plain', 'text/markdown'
        ]
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // 2.5 路由分发
    const routes = {
      '/': () => handleAuthRequest(request, config),
      '/login': () => handleLoginRequest(request, config),
      '/logout': () => handleLogoutRequest(request, config),
      '/upload': () => handleUploadRequest(request, config),
      '/admin': () => handleAdminRequest(request, config),
      '/delete': () => handleDeleteRequest(request, config),
      '/batch-delete': () => handleBatchDeleteRequest(request, config),
      '/search': () => handleSearchRequest(request, config),
      '/bing': handleBingImagesRequest,
      '/history': () => handleHistoryRequest(request, config)
    };
    
    const handler = routes[pathname];
    if (handler) {
      return await handler();
    }
    
    // 2.6 文件访问
    return await handleFileRequest(request, config);
  }
};

// ============================================================
// 3. 身份认证（Cookie 会话）
// ============================================================
function authenticate(request, config) {
  const cookies = request.headers.get("Cookie") || "";
  const authToken = cookies.match(/auth_token=([^;]+)/);
  if (authToken) {
    try {
      const tokenData = JSON.parse(atob(authToken[1]));
      const now = Date.now();           
      if (now > tokenData.expiration) {
        return false;
      }          
      return tokenData.username === config.username;
    } catch (error) {
      return false;
    }
  }
  return false;
}

// ============================================================
// 4. 认证请求处理
// ============================================================
async function handleAuthRequest(request, config) {
  if (config.enableAuth) {
    const isAuthenticated = authenticate(request, config);
    if (!isAuthenticated) {
      return handleLoginRequest(request, config);
    }
    return handleUploadRequest(request, config);
  }
  return handleUploadRequest(request, config);
}

// ============================================================
// 5. 登录处理
// ============================================================
async function handleLoginRequest(request, config) {
  if (request.method === 'POST') {
    const { username, password } = await request.json();
    
    if (username === config.username && password === config.password) {
      const expirationDate = new Date();
      expirationDate.setDate(expirationDate.getDate() + config.cookie);
      const expirationTimestamp = expirationDate.getTime();
      const tokenData = JSON.stringify({
        username: config.username,
        expiration: expirationTimestamp
      });

      const token = btoa(tokenData);
      const cookie = `auth_token=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=${expirationDate.toUTCString()}`;
      return new Response("登录成功", {
        status: 200,
        headers: {
          "Set-Cookie": cookie,
          "Content-Type": "text/plain"
        }
      });
    }
    return new Response("认证失败", { status: 401 });
  }
  const html = generateLoginPage();
  return new Response(html, {
    headers: { 'Content-Type': 'text/html;charset=UTF-8' }
  });
}

// ============================================================
// 6. 退出登录
// ============================================================
async function handleLogoutRequest(request, config) {
  const cookie = `auth_token=; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  return new Response(null, {
    status: 302,
    headers: {
      "Set-Cookie": cookie,
      "Location": "/login"
    }
  });
}

// ============================================================
// 7. GitHub 代理（解决跨域和速率限制）
// ============================================================
async function handleGitHubProxy(request, config) {
  try {
    const url = new URL(request.url);
    const filePath = url.pathname.replace('/github/', '');
    
    if (!filePath || filePath === '') {
      return new Response('文件路径无效', { status: 400 });
    }
    
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const githubUrl = `https://raw.githubusercontent.com/${config.githubRepo}/${config.githubBranch}/${filePath}`;
        
        const response = await fetch(githubUrl, {
          headers: {
            'User-Agent': 'CF-TGBed/1.0'
          }
        });
        
        if (response.ok) {
          const ext = filePath.split('.').pop() || '';
          const contentType = getContentType(ext);
          
          return new Response(response.body, {
            headers: {
              'Content-Type': contentType,
              'Cache-Control': 'public, max-age=31536000',
              'Access-Control-Allow-Origin': '*'
            }
          });
        }
        
        if (response.status === 403) {
          return new Response('GitHub API 速率限制，请稍后重试', { status: 429 });
        }
        
        if (response.status === 404) {
          return new Response('文件不存在', { status: 404 });
        }
        
        lastError = `HTTP ${response.status}`;
      } catch (e) {
        lastError = e.message;
        if (attempt < 3) {
          await new Promise(r => setTimeout(r, 1000 * attempt));
        }
      }
    }
    
    return new Response(`代理失败: ${lastError}`, { status: 500 });
  } catch (error) {
    return new Response('代理失败: ' + error.message, { status: 500 });
  }
}

// ============================================================
// 8. GitHub 上传
// ============================================================
async function uploadToGitHub(file, config) {
  try {
    const dateStr = new Date().toISOString().slice(0,10).replace(/-/g, '');
    const baseName = file.name.replace(/\.[^.]+$/, '');
    const encodedName = encodeURIComponent(baseName);
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const fileName = `${dateStr}-${encodedName}.${ext}`;
    const filePath = `${config.githubPath}/${fileName}`;
    
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64Content = btoa(binary);
    
    const apiUrl = `https://api.github.com/repos/${config.githubRepo}/contents/${encodeURIComponent(filePath)}`;
    
    let sha = null;
    try {
      const checkResponse = await fetch(apiUrl, {
        headers: {
          'Authorization': `token ${config.githubToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'CF-TGBed/1.0'
        }
      });
      if (checkResponse.ok) {
        const existing = await checkResponse.json();
        sha = existing.sha;
      }
    } catch (e) {
      // 文件不存在，继续
    }
    
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const requestBody = {
          message: `Upload ${fileName}`,
          content: base64Content,
          branch: config.githubBranch
        };
        if (sha) {
          requestBody.sha = sha;
        }
        
        const response = await fetch(apiUrl, {
          method: 'PUT',
          headers: {
            'Authorization': `token ${config.githubToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'CF-TGBed/1.0'
          },
          body: JSON.stringify(requestBody)
        });
        
        if (response.ok) {
          const data = await response.json();
          const url = `https://${config.domain}/github/${filePath}`;
          return { 
            url, 
            fileId: data.content?.sha || Date.now().toString() 
          };
        }
        
        if (response.status === 403) {
          throw new Error('GitHub API 速率限制，请稍后重试');
        }
        
        const errorJson = await response.json();
        lastError = errorJson.message || `HTTP ${response.status}`;
      } catch (e) {
        lastError = e.message;
        if (attempt < 3) {
          await new Promise(r => setTimeout(r, 1000 * attempt));
        }
      }
    }
    
    throw new Error(`GitHub 上传失败: ${lastError}`);
  } catch (error) {
    console.error('[GitHub Error]', error);
    throw error;
  }
}

// ============================================================
// 9. 上传处理（核心）
// ============================================================
async function handleUploadRequest(request, config) {
  if (config.enableAuth && !authenticate(request, config)) {
    return Response.redirect(`${new URL(request.url).origin}/login`, 302);
  }
  if (request.method === 'GET') {
    const html = generateUploadPage();
    return new Response(html, {
      headers: { 'Content-Type': 'text/html;charset=UTF-8' }
    });
  }

  try {
    const formData = await request.formData();
    let file = formData.get('file');
    if (!file) throw new Error('未找到文件');
    
    // 9.1 文件类型白名单校验
    const allowedTypes = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'video/mp4', 'video/webm',
      'audio/mpeg', 'audio/wav', 'audio/ogg',
      'application/pdf', 'text/plain', 'text/markdown'
    ];
    
    let mimeType = file.type || getContentType(file.name.split('.').pop().toLowerCase());
    if (!allowedTypes.includes(mimeType)) {
      const ext = file.name.split('.').pop().toLowerCase();
      const guessedType = getContentType(ext);
      if (!allowedTypes.includes(guessedType)) {
        throw new Error(`不支持的文件类型: ${mimeType || ext}`);
      }
      mimeType = guessedType;
    }

    const convertToWebp = formData.get('webp') === 'true';
    let originalFileName = file.name;
    let ext = (file.name.split('.').pop() || '').toLowerCase();

    const selectedStorage = formData.get('storageMode') || 'telegram';
    let fileId = null;
    let messageId = null;
    let storageType = 'telegram';
    let uploadError = null;
    let url = '';

    if (selectedStorage === 'telegram' && file.size > config.maxSizeMB * 1024 * 1024) {
      throw new Error(`文件超过${config.maxSizeMB}MB限制，请选择 R2 或 GitHub 存储`);
    }

    if (selectedStorage === 'github') {
      if (!config.githubToken || !config.githubRepo) {
        throw new Error('GitHub 未配置，请检查环境变量');
      }
      const result = await uploadToGitHub(file, config);
      fileId = result.fileId;
      messageId = Date.now();
      storageType = 'github';
      url = result.url;
    } 
    else if (selectedStorage === 'r2') {
      if (!config.r2Bucket) {
        throw new Error('R2 未配置，请检查环境变量');
      }
      const dateStr = new Date().toISOString().slice(0,10).replace(/-/g, '');
      const baseName = originalFileName.replace(/\.[^.]+$/, '');
      const encodedName = encodeURIComponent(baseName);
      const r2Key = `${dateStr}-${encodedName}.${ext}`;
      
      await config.r2Bucket.put(r2Key, file.stream(), {
        httpMetadata: { contentType: mimeType }
      });
      
      fileId = r2Key;
      messageId = Date.now();
      storageType = 'r2';
      url = `${config.r2PublicUrl || `https://${config.domain}`}/${r2Key}`;
    } 
    else {
      if (config.tgBotToken && config.tgChatId) {
        const [mainType] = mimeType.split('/');
        const typeMap = {
          image: { method: 'sendPhoto', field: 'photo' },
          video: { method: 'sendVideo', field: 'video' },
          audio: { method: 'sendAudio', field: 'audio' }
        };
        let { method = 'sendDocument', field = 'document' } = typeMap[mainType] || {};

        const tgFormData = new FormData();
        tgFormData.append('chat_id', config.tgChatId);
        tgFormData.append(field, file, file.name);
        
        const tgResponse = await fetch(
          `https://api.telegram.org/bot${config.tgBotToken}/${method}`,
          { method: 'POST', body: tgFormData }
        );
        
        if (tgResponse.ok) {
          const tgData = await tgResponse.json();
          const result = tgData.result;
          messageId = result?.message_id;
          // 优先提取 video 的 file_id
          fileId = result?.video?.file_id ||
                   result?.document?.file_id ||
                   result?.audio?.file_id ||
                   (result?.photo && result.photo[result.photo.length-1]?.file_id);
          if (fileId && messageId) {
            storageType = 'telegram';
            const dateStr = new Date().toISOString().slice(0,10).replace(/-/g, '');
            const baseName = originalFileName.replace(/\.[^.]+$/, '');
            const encodedName = encodeURIComponent(baseName);
            url = `https://${config.domain}/${dateStr}-${encodedName}.${ext}`;
          } else {
            uploadError = 'Telegram返回数据异常';
          }
        } else {
          const errorData = await tgResponse.json();
          uploadError = errorData.description || 'Telegram上传失败';
        }
      } else {
        uploadError = 'Telegram 未配置';
      }

      if ((!fileId || !messageId) && config.enableR2Fallback && config.r2Bucket) {
        const dateStr = new Date().toISOString().slice(0,10).replace(/-/g, '');
        const baseName = originalFileName.replace(/\.[^.]+$/, '');
        const encodedName = encodeURIComponent(baseName);
        const r2Key = `${dateStr}-${encodedName}.${ext}`;
        
        await config.r2Bucket.put(r2Key, file.stream(), {
          httpMetadata: { contentType: mimeType }
        });
        
        fileId = r2Key;
        messageId = Date.now();
        storageType = 'r2';
        url = `${config.r2PublicUrl || `https://${config.domain}`}/${r2Key}`;
        uploadError = null;
      }
    }

    if (!fileId || !messageId || !url) {
      throw new Error(uploadError || '上传失败，请检查配置');
    }

    const timestamp = Date.now();
    await config.database.prepare(`
      INSERT INTO files (url, fileId, message_id, created_at, file_name, file_size, mime_type, storage_type) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      url,
      fileId,
      messageId,
      timestamp,
      originalFileName,
      file.size,
      mimeType,
      storageType
    ).run();

    let msg = '✔ 上传成功';
    if (storageType === 'github') msg = '✔ 上传成功 (GitHub)';
    else if (storageType === 'r2' && selectedStorage === 'r2') msg = '✔ 上传成功 (R2)';
    else if (storageType === 'r2' && selectedStorage === 'telegram') msg = '✔ 上传成功 (R2备用)';
    else if (convertToWebp) msg = '✔ 上传成功 (WebP)';
    else if (storageType === 'telegram') msg = '✔ 上传成功 (TG)';

    return new Response(
      JSON.stringify({ status: 1, msg, url, storage: storageType, webp: convertToWebp }),
      { headers: { 'Content-Type': 'application/json' }}
    );

  } catch (error) {
    console.error(`[Upload Error] ${error.message}`);
    let statusCode = 500;
    if (error.message.includes(`文件超过${config.maxSizeMB}MB限制`)) {
      statusCode = 400;
    } else if (error.message.includes('不支持的文件类型')) {
      statusCode = 400;
    } else if (error.message.includes('Telegram参数配置错误')) {
      statusCode = 502;
    } else if (error.message.includes('速率限制')) {
      statusCode = 429;
    } else if (error instanceof TypeError && error.message.includes('Failed to fetch')) {
      statusCode = 504;
    }
    return new Response(
      JSON.stringify({ status: 0, msg: "✘ 上传失败", error: error.message }),
      { status: statusCode, headers: { 'Content-Type': 'application/json' }}
    );
  }
}

// ============================================================
// 10. 管理后台
// ============================================================
async function handleAdminRequest(request, config) {
  if (config.enableAuth && !authenticate(request, config)) {
    return Response.redirect(`${new URL(request.url).origin}/login`, 302);
  }

  try {
    const files = await config.database.prepare(
      `SELECT url, fileId, message_id, created_at, file_name, file_size, mime_type,
        IFNULL(storage_type, 'telegram') as storage_type
      FROM files
      ORDER BY created_at DESC`
    ).all();

    const fileList = files.results || [];
    const fileCards = fileList.map((file, index) => {
      const fileName = file.file_name || '未知文件';
      const fileSize = formatSize(file.file_size || 0);
      const createdAt = file.created_at ? new Date(file.created_at).toISOString().replace('T', ' ').split('.')[0] : '';
      const storageType = file.storage_type || 'telegram';
      let storageBadge = '<span class="storage-badge tg">TG</span>';
      if (storageType === 'r2') storageBadge = '<span class="storage-badge r2">R2</span>';
      else if (storageType === 'github') storageBadge = '<span class="storage-badge github">GitHub</span>';
      const previewHtml = getPreviewHtml(file.url);
      
      return `
        <div class="file-card" data-url="${file.url}" data-index="${index}" data-name="${fileName}">
          <input type="checkbox" class="file-checkbox" data-url="${file.url}">
          <div class="file-preview" onclick="openPreview('${file.url}')">
            ${previewHtml}
          </div>
          <div class="file-info">
            <div class="file-name" title="${fileName}">${fileName} ${storageBadge}</div>
            <div class="file-meta">${fileSize} · ${createdAt}</div>
          </div>
          <div class="file-actions">
            <button class="btn btn-copy" onclick="copySingleUrl('${file.url}')">
              <i class="fas fa-copy"></i>
            </button>
            <a class="btn btn-open" href="${file.url}" target="_blank" title="打开链接">
              <i class="fas fa-external-link-alt"></i>
            </a>
            <button class="btn btn-share" onclick="showQRCode('${file.url}')">
              <i class="fas fa-qrcode"></i>
            </button>
            <button class="btn btn-delete" onclick="deleteFile('${file.url}')">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        </div>
      `;
    }).join('');

    // ============================================================
    // 预览模态框 - 新增滚轮缩放和拖拽平移功能
    // ============================================================
    const previewModal = `
      <div id="previewModal" class="modal" onclick="closePreviewOnBackdrop(event)">
        <div class="modal-content" onclick="event.stopPropagation()">
          <span class="modal-close" onclick="closePreview()">&times;</span>
          <div class="preview-wrapper" id="previewWrapper">
            <div class="preview-container" id="previewContainer">
              <img id="previewImage" src="" alt="预览">
            </div>
            <div class="zoom-hint" id="zoomHint">🖱️ 滚轮缩放 · 拖拽移动</div>
          </div>
          <div class="preview-toolbar">
            <span class="preview-filename" id="previewFilename">文件名</span>
            <div class="preview-actions">
              <button onclick="previewZoomIn()" title="放大">
                <i class="fas fa-search-plus"></i>
              </button>
              <button onclick="previewZoomOut()" title="缩小">
                <i class="fas fa-search-minus"></i>
              </button>
              <button onclick="previewZoomReset()" title="重置">
                <i class="fas fa-expand"></i>
              </button>
              <button onclick="previewOpenLink()" title="打开链接">
                <i class="fas fa-external-link-alt"></i>
              </button>
              <button onclick="previewCopyLink()" title="复制链接">
                <i class="fas fa-copy"></i>
              </button>
              <button onclick="previewDeleteFile()" title="删除文件" class="preview-delete">
                <i class="fas fa-trash"></i>
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    const qrModal = `
      <div id="qrModal" class="modal" onclick="closeQRModal()">
        <div class="modal-content qr-content" onclick="event.stopPropagation()">
          <span class="modal-close" onclick="closeQRModal()">&times;</span>
          <div id="qrcode"></div>
          <div class="qr-buttons">
            <button class="qr-copy" onclick="handleCopyUrl()">复制链接</button>
            <button class="qr-close" onclick="closeQRModal()">关闭</button>
          </div>
        </div>
      </div>
    `;

    const batchToolbar = `
      <div id="batchToolbar" class="batch-toolbar" style="display:none;">
        <span id="selectedCount">已选择 0 个文件</span>
        <div class="batch-actions">
          <button class="btn btn-batch-copy" onclick="batchCopy()">
            <i class="fas fa-copy"></i> 批量复制
          </button>
          <button class="btn btn-batch-delete" onclick="batchDelete()">
            <i class="fas fa-trash"></i> 批量删除
          </button>
          <button class="btn btn-select-all" onclick="toggleSelectAll()">
            <i class="fas fa-check-double"></i> 全选
          </button>
          <button class="btn btn-clear-select" onclick="clearSelection()">
            <i class="fas fa-times"></i> 取消选择
          </button>
        </div>
      </div>
    `;

    const html = generateAdminPage(fileCards, previewModal, qrModal, batchToolbar);
    return new Response(html, {
      headers: { 'Content-Type': 'text/html;charset=UTF-8' }
    });
  } catch (error) {
    console.error('[Admin Error]', error);
    return new Response('Admin Error: ' + error.message, { status: 500 });
  }
}

// ============================================================
// 11. 批量删除
// ============================================================
async function handleBatchDeleteRequest(request, config) {
  if (config.enableAuth && !authenticate(request, config)) {
    return Response.redirect(`${new URL(request.url).origin}/login`, 302);
  }

  try {
    const { urls } = await request.json();
    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return new Response(JSON.stringify({ error: '无效的URL列表' }), {
        status: 400, 
        headers: { 'Content-Type': 'application/json' }
      });
    }

    let deletedCount = 0;
    let errors = [];

    for (const url of urls) {
      try {
        const file = await config.database.prepare(
          'SELECT fileId, message_id, storage_type FROM files WHERE url = ?'
        ).bind(url).first();
        
        if (file) {
          if (file.storage_type === 'r2' && config.r2Bucket) {
            try {
              await config.r2Bucket.delete(file.fileId);
            } catch (e) {
              console.error('R2删除失败:', e);
            }
          } else if (file.storage_type === 'github' && config.githubToken) {
            try {
              const filePath = file.fileId;
              const deleteUrl = `https://api.github.com/repos/${config.githubRepo}/contents/${encodeURIComponent(filePath)}`;
              const getRes = await fetch(deleteUrl, {
                headers: {
                  'Authorization': `token ${config.githubToken}`,
                  'Accept': 'application/vnd.github.v3+json',
                  'User-Agent': 'CF-TGBed/1.0'
                }
              });
              if (getRes.ok) {
                const fileData = await getRes.json();
                await fetch(deleteUrl, {
                  method: 'DELETE',
                  headers: {
                    'Authorization': `token ${config.githubToken}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/vnd.github.v3+json',
                    'User-Agent': 'CF-TGBed/1.0'
                  },
                  body: JSON.stringify({
                    message: `Delete ${filePath}`,
                    sha: fileData.sha,
                    branch: config.githubBranch
                  })
                });
              }
            } catch (e) {
              console.error('GitHub删除失败:', e);
            }
          } else {
            try {
              await fetch(
                `https://api.telegram.org/bot${config.tgBotToken}/deleteMessage?chat_id=${config.tgChatId}&message_id=${file.message_id}`
              );
            } catch (e) {
              console.error('Telegram删除失败:', e);
            }
          }
          
          await config.database.prepare('DELETE FROM files WHERE url = ?').bind(url).run();
          deletedCount++;
        }
      } catch (e) {
        errors.push({ url, error: e.message });
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true,
        deletedCount: deletedCount,
        errors: errors,
        message: `成功删除 ${deletedCount} 个文件${errors.length > 0 ? `，${errors.length} 个失败` : ''}`
      }),
      { headers: { 'Content-Type': 'application/json' }}
    );

  } catch (error) {
    console.error('[Batch Delete Error]', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' }}
    );
  }
}

// ============================================================
// 12. 上传历史
// ============================================================
async function handleHistoryRequest(request, config) {
  if (config.enableAuth && !authenticate(request, config)) {
    return Response.redirect(`${new URL(request.url).origin}/login`, 302);
  }

  try {
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page')) || 1;
    const limit = parseInt(url.searchParams.get('limit')) || 20;
    const offset = (page - 1) * limit;
    
    const total = await config.database.prepare(
      'SELECT COUNT(*) as count FROM files'
    ).first();
    
    const files = await config.database.prepare(
      `SELECT url, file_name, file_size, created_at, mime_type,
        IFNULL(storage_type, 'telegram') as storage_type
       FROM files 
       ORDER BY created_at DESC 
       LIMIT ? OFFSET ?`
    ).bind(limit, offset).all();

    return new Response(
      JSON.stringify({
        files: files.results || [],
        total: total ? total.count : 0,
        page: page,
        limit: limit,
        totalPages: total ? Math.ceil(total.count / limit) : 0
      }),
      { headers: { 'Content-Type': 'application/json' }}
    );

  } catch (error) {
    console.error('[History Error]', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' }}
    );
  }
}

// ============================================================
// 13. 搜索
// ============================================================
async function handleSearchRequest(request, config) {
  if (config.enableAuth && !authenticate(request, config)) {
    return Response.redirect(`${new URL(request.url).origin}/login`, 302);
  }

  try {
    const { query } = await request.json();
    const searchPattern = `%${query}%`;    
    const files = await config.database.prepare(
      `SELECT url, fileId, message_id, created_at, file_name, file_size, mime_type,
        IFNULL(storage_type, 'telegram') as storage_type
       FROM files 
       WHERE file_name LIKE ? ESCAPE '!'
       COLLATE NOCASE
       ORDER BY created_at DESC`
    ).bind(searchPattern).all();

    return new Response(
      JSON.stringify({ files: files.results || [] }),
      { headers: { 'Content-Type': 'application/json' }}
    );

  } catch (error) {
    console.error('[Search Error]', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' }}
    );
  }
}

// ============================================================
// 14. 文件预览
// ============================================================
function getPreviewHtml(url) {
  const ext = (url.split('.').pop() || '').toLowerCase();
  const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'icon', 'bmp', 'tiff'].includes(ext);
  const isVideo = ['mp4', 'webm', 'avi', 'mov', 'mkv'].includes(ext);
  const isAudio = ['mp3', 'wav', 'ogg', 'flac', 'aac'].includes(ext);

  if (isImage) {
    return `<img src="${url}" alt="预览" loading="lazy">`;
  } else if (isVideo) {
    return `<video src="${url}" controls preload="metadata" style="max-width:100%;max-height:100%;"></video>`;
  } else if (isAudio) {
    return `<audio src="${url}" controls preload="none"></audio>`;
  } else {
    return `<div class="file-icon"><i class="fas fa-file"></i></div>`;
  }
}

// ============================================================
// 15. 文件访问（支持大文件流式传输和 Range 请求）
// ============================================================
async function handleFileRequest(request, config) {
  const url = request.url;
  const cache = caches.default;
  const cacheKey = new Request(url);

  try {
    // 检查缓存（只缓存完整文件，不缓存 Range 请求）
    const range = request.headers.get('Range');
    if (!range) {
      const cachedResponse = await cache.match(cacheKey);
      if (cachedResponse) {
        return cachedResponse;
      }
    }

    const file = await config.database.prepare(
      `SELECT fileId, message_id, file_name, mime_type, file_size,
        IFNULL(storage_type, 'telegram') as storage_type
      FROM files WHERE url = ?`
    ).bind(url).first();

    if (!file) {
      return new Response('文件不存在', { 
        status: 404,
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' }
      });
    }

    // 获取文件内容（流式传输）
    let fileResponse;
    let contentType = file.mime_type || getContentType(url.split('.').pop().toLowerCase());
    let contentLength = file.file_size || 0;
    let status = 200;
    let headers = {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000',
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*'
    };

    if (file.storage_type === 'github') {
      const response = await fetch(url);
      if (!response.ok) {
        return new Response('文件不存在', { status: 404 });
      }
      fileResponse = new Response(response.body, { headers });
    } else if (file.storage_type === 'r2' && config.r2Bucket) {
      const object = await config.r2Bucket.get(file.fileId);
      if (!object) {
        return new Response('文件不存在', { status: 404 });
      }
      // R2 支持 Range 请求
      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : object.size - 1;
        const chunkSize = end - start + 1;
        const r2Range = await config.r2Bucket.get(file.fileId, {
          range: { offset: start, length: chunkSize }
        });
        if (r2Range) {
          status = 206;
          headers['Content-Range'] = `bytes ${start}-${end}/${object.size}`;
          headers['Content-Length'] = chunkSize;
          fileResponse = new Response(r2Range.body, { status, headers });
        } else {
          fileResponse = new Response(object.body, { headers });
        }
      } else {
        headers['Content-Length'] = object.size;
        fileResponse = new Response(object.body, { headers });
      }
    } else {
      // Telegram 存储
      const tgResponse = await fetch(
        `https://api.telegram.org/bot${config.tgBotToken}/getFile?file_id=${file.fileId}`
      );

      if (!tgResponse.ok) {
        console.error(`[Telegram API Error] ${await tgResponse.text()}`);
        return new Response('获取文件失败', { 
          status: 500,
          headers: { 'Content-Type': 'text/plain;charset=UTF-8' }
        });
      }

      const tgData = await tgResponse.json();
      const filePath = tgData.result?.file_path;

      if (!filePath) {
        return new Response('文件路径无效', { 
          status: 404,
          headers: { 'Content-Type': 'text/plain;charset=UTF-8' }
        });
      }

      const fileUrl = `https://api.telegram.org/file/bot${config.tgBotToken}/${filePath}`;
      
      // 处理 Range 请求（视频播放必需）
      if (range) {
        // 先获取文件大小（通过 HEAD 请求）
        const headResponse = await fetch(fileUrl, { method: 'HEAD' });
        const totalSize = parseInt(headResponse.headers.get('Content-Length') || '0', 10) || contentLength;
        
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;
        const chunkSize = end - start + 1;
        
        // 使用 Range 请求获取部分内容
        const rangeResponse = await fetch(fileUrl, {
          headers: { 'Range': `bytes=${start}-${end}` }
        });
        
        if (rangeResponse.ok) {
          status = 206;
          headers['Content-Range'] = `bytes ${start}-${end}/${totalSize}`;
          headers['Content-Length'] = chunkSize;
          // 添加视频播放必需的 Accept-Ranges
          headers['Accept-Ranges'] = 'bytes';
          fileResponse = new Response(rangeResponse.body, { status, headers });
        } else {
          // Range 请求失败，降级为完整文件
          const fullResponse = await fetch(fileUrl);
          fileResponse = new Response(fullResponse.body, { headers });
        }
      } else {
        // 完整文件请求
        const tgFileResponse = await fetch(fileUrl);
        if (!tgFileResponse.ok) {
          return new Response('下载文件失败', { 
            status: 500,
            headers: { 'Content-Type': 'text/plain;charset=UTF-8' }
          });
        }
        // 流式传输，不将文件加载到内存
        fileResponse = new Response(tgFileResponse.body, { headers });
      }
    }

    // 缓存完整文件（非 Range 请求）
    if (!range && fileResponse.ok && fileResponse.status === 200) {
      await cache.put(cacheKey, fileResponse.clone());
    }
    
    return fileResponse;

  } catch (error) {
    console.error(`[File Error] ${error.message} for ${url}`);
    return new Response('服务器内部错误', { 
      status: 500,
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' }
    });
  }
}

// ============================================================
// 16. 删除单个文件
// ============================================================
async function handleDeleteRequest(request, config) {
  if (config.enableAuth && !authenticate(request, config)) {
    return Response.redirect(`${new URL(request.url).origin}/login`, 302);
  }

  try {
    const { url } = await request.json();
    if (!url || typeof url !== 'string') {
      return new Response(JSON.stringify({ error: '无效的URL' }), {
        status: 400, 
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const file = await config.database.prepare(
      'SELECT fileId, message_id, storage_type FROM files WHERE url = ?'
    ).bind(url).first();    
    if (!file) {
      return new Response(JSON.stringify({ error: '文件不存在' }), { 
        status: 404, 
        headers: { 'Content-Type': 'application/json' }}
      );
    }    

    let deleteError = null;

    if (file.storage_type === 'r2' && config.r2Bucket) {
      try {
        await config.r2Bucket.delete(file.fileId);
      } catch (e) {
        deleteError = e.message;
        console.error('R2删除失败:', e);
      }
    } else if (file.storage_type === 'github' && config.githubToken) {
      try {
        const filePath = file.fileId;
        const deleteUrl = `https://api.github.com/repos/${config.githubRepo}/contents/${encodeURIComponent(filePath)}`;
        const getRes = await fetch(deleteUrl, {
          headers: {
            'Authorization': `token ${config.githubToken}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'CF-TGBed/1.0'
          }
        });
        if (getRes.ok) {
          const fileData = await getRes.json();
          await fetch(deleteUrl, {
            method: 'DELETE',
            headers: {
              'Authorization': `token ${config.githubToken}`,
              'Content-Type': 'application/json',
              'Accept': 'application/vnd.github.v3+json',
              'User-Agent': 'CF-TGBed/1.0'
            },
            body: JSON.stringify({
              message: `Delete ${filePath}`,
              sha: fileData.sha,
              branch: config.githubBranch
            })
          });
        }
      } catch (e) {
        deleteError = e.message;
        console.error('GitHub删除失败:', e);
      }
    } else {
      try {
        const deleteResponse = await fetch(
          `https://api.telegram.org/bot${config.tgBotToken}/deleteMessage?chat_id=${config.tgChatId}&message_id=${file.message_id}`
        );
        if (!deleteResponse.ok) {
          const errorData = await deleteResponse.json();
          console.error(`[Telegram API Error] ${JSON.stringify(errorData)}`);
          throw new Error(`Telegram 消息删除失败: ${errorData.description}`);
        }
      } catch (error) { deleteError = error.message; }
    }

    await config.database.prepare('DELETE FROM files WHERE url = ?').bind(url).run();
    
    return new Response(
      JSON.stringify({ 
        success: true,
        message: deleteError ? `文件已从数据库删除，但存储删除失败: ${deleteError}` : '文件删除成功'
      }),
      { headers: { 'Content-Type': 'application/json' }}
    );

  } catch (error) {
    console.error(`[Delete Error] ${error.message}`);
    return new Response(
      JSON.stringify({ 
        error: error.message.includes('message to delete not found') ? 
              '文件已从频道移除' : error.message 
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' }}
    );
  }
}

// ============================================================
// 17. 工具函数
// ============================================================
function getContentType(ext) {
  const types = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg', 
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    icon: 'image/x-icon',
    bmp: 'image/bmp',
    tiff: 'image/tiff',
    mp4: 'video/mp4',
    webm: 'video/webm',
    avi: 'video/x-msvideo',
    mov: 'video/quicktime',
    mkv: 'video/x-matroska',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    flac: 'audio/flac',
    aac: 'audio/aac',
    pdf: 'application/pdf',
    txt: 'text/plain',
    md: 'text/markdown',
    zip: 'application/zip',
    rar: 'application/x-rar-compressed',
    json: 'application/json',
    xml: 'application/xml',
    ini: 'text/plain',
    js: 'application/javascript',
    yml: 'application/yaml',
    yaml: 'application/yaml',
    py: 'text/x-python',
    sh: 'application/x-sh'
  };
  return types[ext] || 'application/octet-stream';
}

function formatSize(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

// ============================================================
// 18. Bing 壁纸
// ============================================================
async function handleBingImagesRequest() {
  const cache = caches.default;
  const cacheKey = new Request('https://cn.bing.com/HPImageArchive.aspx?format=js&idx=0&n=5');
  
  const cachedResponse = await cache.match(cacheKey);
  if (cachedResponse) {
    return cachedResponse;
  }
  
  try {
    const res = await fetch(cacheKey);
    if (!res.ok) {
      console.error(`Bing API 请求失败，状态码：${res.status}`);
      return new Response('请求 Bing API 失败', { status: res.status });
    }
    
    const bingData = await res.json();
    const images = bingData.images.map(image => ({ url: `https://cn.bing.com${image.url}` }));
    const returnData = { status: true, message: "操作成功", data: images };
    
    const response = new Response(JSON.stringify(returnData), { 
      status: 200, 
      headers: { 
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=21600',
        'Access-Control-Allow-Origin': '*' 
      }
    });
    
    await cache.put(cacheKey, response.clone());
    return response;
  } catch (error) {
    console.error('请求 Bing API 过程中发生错误:', error);
    return new Response('请求 Bing API 失败', { status: 500 });
  }
}

// ============================================================
// 19. HTML 模板 - 公共部分
// ============================================================
function headLinks() {
  return `
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="Telegram文件存储与分享平台">
    <link rel="shortcut icon" href="https://img.hangdn.com/hexo/蓝色地球圆.ico" type="image/x-icon">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  `;
}

function copyright() {
  return `
    <p>
      <span><i class="fas fa-copyright"></i> 2025 Copyright by Chnbsdan</span><span>|</span>
      <a href="https://github.com/chnbsdan/CF-tgbed" target="_blank">
      <i class="fab fa-github"></i> GitHub chnbsdan</a><span>|</span>
      <a href="https://aoso.hangdn.com/" target="_blank">
      <i class="fas fa-blog"></i> Hangdn Notes</a>
    </p>
  `;
}

// ============================================================
// 20. 登录页面（全新样式）
// ============================================================
function generateLoginPage() {
  return `<!DOCTYPE html>
  <html lang="zh-CN">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>登录 | CF-TGBed</title>
    <link rel="shortcut icon" href="https://img.hangdn.com/hexo/蓝色地球圆.ico" type="image/x-icon">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
      /* ===== 全局重置 & 基础 ===== */
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }

      body {
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        background: #f0f2f5;
        background-size: cover;
        background-position: center;
        background-repeat: no-repeat;
        background-attachment: fixed;
        position: relative;
      }

      /* ===== 登录容器 ===== */
      .login-container {
        width: 100%;
        max-width: 420px;
        animation: fadeInUp 0.6s ease-out;
      }

      @keyframes fadeInUp {
        from {
          opacity: 0;
          transform: translateY(30px) scale(0.96);
        }
        to {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }

      /* ===== 登录卡片（毛玻璃效果） ===== */
      .login-card {
        background: rgba(255, 255, 255, 0.75);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        border-radius: 28px;
        padding: 48px 40px 40px;
        box-shadow: 
          0 8px 32px rgba(0, 0, 0, 0.10),
          0 2px 16px rgba(0, 0, 0, 0.04),
          inset 0 1px 0 rgba(255, 255, 255, 0.5);
        text-align: center;
        border: 1px solid rgba(255, 255, 255, 0.4);
        transition: transform 0.3s ease, box-shadow 0.3s ease;
      }

      .login-card:hover {
        transform: translateY(-2px);
        box-shadow: 0 12px 48px rgba(0, 0, 0, 0.12);
      }

      /* ===== Logo & 标题 ===== */
      .logo-icon {
        font-size: 3.2em;
        color: #4a6cf7;
        margin-bottom: 16px;
        display: block;
        background: linear-gradient(135deg, #4a6cf7, #7c3aed);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
      }

      .title {
        font-size: 1.8em;
        font-weight: 700;
        color: #1a1a2e;
        margin-bottom: 6px;
        letter-spacing: -0.5px;
      }

      .subtitle {
        color: #666;
        margin-bottom: 32px;
        font-size: 0.95em;
        line-height: 1.5;
        font-weight: 400;
      }

      /* ===== 错误信息 ===== */
      .error-message {
        background: rgba(220, 53, 69, 0.08);
        border: 1px solid rgba(220, 53, 69, 0.2);
        color: #dc3545;
        padding: 12px 16px;
        border-radius: 12px;
        margin-bottom: 20px;
        font-size: 0.9em;
        display: none;
        align-items: center;
        gap: 10px;
        text-align: left;
      }

      .error-message.show {
        display: flex;
      }

      .error-message i {
        font-size: 1.1em;
        flex-shrink: 0;
      }

      /* ===== 表单 ===== */
      .form-group {
        margin-bottom: 18px;
        text-align: left;
      }

      .form-group label {
        display: block;
        font-size: 0.85em;
        color: #555;
        margin-bottom: 6px;
        font-weight: 500;
        letter-spacing: 0.3px;
      }

      .input-wrapper {
        position: relative;
      }

      .input-wrapper i {
        position: absolute;
        left: 16px;
        top: 50%;
        transform: translateY(-50%);
        color: #aaa;
        font-size: 1em;
        transition: color 0.3s;
        pointer-events: none;
      }

      .input-wrapper:focus-within i {
        color: #4a6cf7;
      }

      .form-input {
        width: 100%;
        padding: 14px 16px 14px 46px;
        border: 2px solid #e8ecf1;
        border-radius: 14px;
        font-size: 0.95em;
        transition: all 0.3s ease;
        background: rgba(255, 255, 255, 0.7);
        color: #1a1a2e;
        outline: none;
        font-family: inherit;
      }

      .form-input:focus {
        border-color: #4a6cf7;
        background: rgba(255, 255, 255, 0.9);
        box-shadow: 0 0 0 4px rgba(74, 108, 247, 0.10);
      }

      .form-input::placeholder {
        color: #bbb;
        font-weight: 300;
      }

      .form-input.has-toggle {
        padding-right: 52px;
      }

      /* ===== 密码显示切换 ===== */
      .password-toggle {
        position: absolute;
        right: 12px;
        top: 50%;
        transform: translateY(-50%);
        width: 36px;
        height: 36px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: none;
        border: none;
        border-radius: 10px;
        color: #999;
        cursor: pointer;
        padding: 0;
        transition: all 0.2s;
        font-size: 1em;
      }

      .password-toggle:hover {
        color: #4a6cf7;
        background: rgba(74, 108, 247, 0.06);
      }

      /* ===== 记住我 ===== */
      .remember-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 24px;
        margin-top: 4px;
      }

      .remember-label {
        display: flex;
        align-items: center;
        gap: 8px;
        cursor: pointer;
        font-size: 0.9em;
        color: #666;
        user-select: none;
      }

      .remember-label input[type="checkbox"] {
        width: 18px;
        height: 18px;
        accent-color: #4a6cf7;
        border-radius: 4px;
        cursor: pointer;
        flex-shrink: 0;
      }

      /* ===== 登录按钮 ===== */
      .login-btn {
        width: 100%;
        padding: 16px 20px;
        background: linear-gradient(135deg, #4a6cf7 0%, #7c3aed 100%);
        border: none;
        border-radius: 14px;
        color: #fff;
        font-size: 1.05em;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        position: relative;
        overflow: hidden;
        font-family: inherit;
        letter-spacing: 0.5px;
      }

      .login-btn::before {
        content: '';
        position: absolute;
        top: 0;
        left: -100%;
        width: 100%;
        height: 100%;
        background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.15), transparent);
        transition: left 0.6s ease;
      }

      .login-btn:hover::before {
        left: 100%;
      }

      .login-btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 8px 28px rgba(74, 108, 247, 0.35);
      }

      .login-btn:active {
        transform: translateY(0);
        box-shadow: 0 4px 16px rgba(74, 108, 247, 0.25);
      }

      .login-btn:disabled {
        opacity: 0.7;
        cursor: not-allowed;
        transform: none !important;
      }

      .login-btn .spinner {
        width: 20px;
        height: 20px;
        border: 2.5px solid rgba(255, 255, 255, 0.25);
        border-top-color: #fff;
        border-radius: 50%;
        animation: spin 0.7s linear infinite;
      }

      @keyframes spin {
        to { transform: rotate(360deg); }
      }

      /* ===== 页脚 ===== */
      .footer-text {
        margin-top: 28px;
        color: #999;
        font-size: 0.8em;
        letter-spacing: 0.3px;
      }

      .footer-text a {
        color: #4a6cf7;
        text-decoration: none;
        font-weight: 500;
        transition: color 0.2s;
      }

      .footer-text a:hover {
        color: #7c3aed;
        text-decoration: underline;
      }

      .footer-text .divider {
        margin: 0 6px;
        color: #ddd;
      }

      /* ===== 响应式 ===== */
      @media (max-width: 480px) {
        body {
          padding: 16px;
          align-items: flex-start;
          padding-top: 10vh;
        }

        .login-card {
          padding: 32px 24px 28px;
          border-radius: 24px;
        }

        .logo-icon {
          font-size: 2.6em;
          margin-bottom: 12px;
        }

        .title {
          font-size: 1.5em;
        }

        .subtitle {
          font-size: 0.85em;
          margin-bottom: 24px;
        }

        .form-input {
          padding: 13px 14px 13px 42px;
          font-size: 0.9em;
          border-radius: 12px;
        }

        .form-input.has-toggle {
          padding-right: 48px;
        }

        .password-toggle {
          right: 8px;
          width: 32px;
          height: 32px;
          font-size: 0.9em;
        }

        .login-btn {
          padding: 14px;
          font-size: 0.95em;
          border-radius: 12px;
        }

        .remember-row {
          margin-bottom: 20px;
          font-size: 0.85em;
        }

        .footer-text {
          font-size: 0.75em;
          margin-top: 22px;
        }
      }

      @media (max-width: 360px) {
        .login-card {
          padding: 24px 16px 20px;
          border-radius: 20px;
        }

        .logo-icon {
          font-size: 2.2em;
        }

        .title {
          font-size: 1.3em;
        }
      }
    </style>
  </head>
  <body>
    <div class="login-container">
      <div class="login-card">
        <!-- Logo -->
        <i class="fas fa-cloud-upload-alt logo-icon"></i>
        <h1 class="title">CF-TGBed</h1>
        <p class="subtitle">登录以管理您的文件</p>

        <!-- 错误信息 -->
        <div class="error-message" id="errorMessage">
          <i class="fas fa-exclamation-circle"></i>
          <span id="errorText">用户名或密码错误</span>
        </div>

        <!-- 登录表单 -->
        <form id="loginForm" onsubmit="handleLogin(event)">
          <div class="form-group">
            <label for="username">用户名</label>
            <div class="input-wrapper">
              <i class="fas fa-user"></i>
              <input type="text" id="username" class="form-input" placeholder="请输入用户名" required autofocus>
            </div>
          </div>

          <div class="form-group">
            <label for="password">密码</label>
            <div class="input-wrapper">
              <i class="fas fa-lock"></i>
              <input type="password" id="password" class="form-input has-toggle" placeholder="请输入密码" required>
              <button type="button" class="password-toggle" onclick="togglePassword()" aria-label="切换密码可见性">
                <i class="fas fa-eye" id="passwordToggleIcon"></i>
              </button>
            </div>
          </div>

          <div class="remember-row">
            <label class="remember-label">
              <input type="checkbox" id="remember" checked>
              <span>记住我</span>
            </label>
            <!-- 可在此添加"忘记密码"链接 -->
          </div>

          <button type="submit" class="login-btn" id="loginBtn">
            <i class="fas fa-sign-in-alt"></i>
            <span>登 录</span>
          </button>
        </form>

        <p class="footer-text">
  <i class="fas fa-copyright"></i> 2025 
  <a href="https://github.com/chnbsdan/CF-tgbed" target="_blank">CF-TGBed</a>
  <span class="divider">|</span>
  <i class="far fa-heart" style="color: #ff6b6b; font-size: 0.85em;"></i>
  <a href="https://github.com/chnbsdan" target="_blank">@chnbsdan</a>
</p>
      </div>
    </div>

    <script>
      // ===== 自动设置背景 =====
      (function setInitialBackground() {
        try {
          var imageUrl = 'https://pico.hangdn.com/api/wallpaper?t=' + Date.now();
          document.body.style.backgroundImage = 'url(' + imageUrl + ')';
          document.body.style.backgroundSize = 'cover';
          document.body.style.backgroundPosition = 'center center';
          document.body.style.backgroundRepeat = 'no-repeat';
          document.body.style.backgroundAttachment = 'fixed';
        } catch (e) {
          console.warn('背景图加载失败，使用默认背景');
          document.body.style.background = '#f0f2f5';
        }
      })();

      // ===== 切换密码可见性 =====
      function togglePassword() {
        var passwordInput = document.getElementById('password');
        var icon = document.getElementById('passwordToggleIcon');
        
        if (passwordInput.type === 'password') {
          passwordInput.type = 'text';
          icon.classList.remove('fa-eye');
          icon.classList.add('fa-eye-slash');
        } else {
          passwordInput.type = 'password';
          icon.classList.remove('fa-eye-slash');
          icon.classList.add('fa-eye');
        }
      }

      // ===== 显示/隐藏错误 =====
      function showError(message) {
        var errorDiv = document.getElementById('errorMessage');
        var errorText = document.getElementById('errorText');
        errorText.textContent = message || '用户名或密码错误';
        errorDiv.classList.add('show');
      }

      function hideError() {
        document.getElementById('errorMessage').classList.remove('show');
      }

      // ===== 按钮加载状态 =====
      function setLoading(loading) {
        var btn = document.getElementById('loginBtn');
        if (loading) {
          btn.disabled = true;
          btn.innerHTML = '<div class="spinner"></div><span>登录中...</span>';
        } else {
          btn.disabled = false;
          btn.innerHTML = '<i class="fas fa-sign-in-alt"></i><span>登 录</span>';
        }
      }

      // ===== 登录处理 =====
      async function handleLogin(event) {
        event.preventDefault();
        hideError();

        var username = document.getElementById('username').value.trim();
        var password = document.getElementById('password').value;

        if (!username || !password) {
          showError('请输入用户名和密码');
          return;
        }

        setLoading(true);

        try {
          var response = await fetch('/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: username, password: password })
          });

          if (response.ok) {
            // 登录成功，跳转到上传页
            window.location.href = '/upload';
          } else {
            var errorText = await response.text();
            showError(errorText || '用户名或密码错误');
            setLoading(false);
          }
        } catch (err) {
          console.error('登录请求失败:', err);
          showError('网络错误，请稍后重试');
          setLoading(false);
        }
      }

      // ===== 回车键提交 =====
      document.getElementById('password').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          document.getElementById('loginForm').dispatchEvent(new Event('submit'));
        }
      });

      // 暴露函数到全局（供 HTML 内联调用）
      window.togglePassword = togglePassword;
      window.handleLogin = handleLogin;
    </script>
  </body>
  </html>`;
}

// ============================================================
// 21. 上传页面
// ============================================================
function generateUploadPage() {
  return `<!DOCTYPE html>
  <html lang="zh-CN">
  <head>
  ${headLinks()}
  <title>CF-TGBed | 免费文件托管服务</title>
    <style>
      body {
        font-family: Arial, sans-serif;
        transition: background-image 1s ease-in-out;
        display: flex;
        justify-content: center;
        align-items: center;
        min-height: 100vh;
        background: #f5f5f5;
        background-size: cover;
        background-position: center center;
        background-repeat: no-repeat;
        background-attachment: fixed;
        margin: 0;
        padding: 20px;
      }
      .container {
        width: 100%;
        max-width: 800px;
        background: rgba(255, 255, 255, 0.5);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        padding: 20px 40px 20px 40px;
        border-radius: 8px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        margin: 20px;
      }
      .header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 20px;
        flex-wrap: wrap;
        gap: 10px;
      }
      .header h1 { margin: 0; font-size: 24px; }
      .header-actions {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .btn-refresh {
        background: rgba(0,0,0,0.06);
        border: 1px solid rgba(0,0,0,0.1);
        color: #555;
        width: 36px;
        height: 36px;
        border-radius: 50%;
        cursor: pointer;
        font-size: 16px;
        transition: all 0.3s ease;
      }
      .btn-refresh:hover {
        background: rgba(0,0,0,0.12);
        transform: rotate(180deg);
      }
      .btn-refresh:active {
        transform: rotate(360deg);
      }
      .admin-link {
        background: #007BFF;
        padding: 8px 16px;
        border: none;
        border-radius: 4px;
        text-decoration: none;
        color: #fff;
        display: inline-block;
        font-size: 14px;
        transition: background 0.2s;
      }
      .admin-link:hover { background: #0056b3; text-decoration: none; }
      .logout-link {
        background: #dc3545;
        padding: 8px 16px;
        border: none;
        border-radius: 4px;
        text-decoration: none;
        color: #fff;
        display: inline-block;
        font-size: 14px;
        transition: background 0.2s;
      }
      .logout-link:hover { background: #c82333; text-decoration: none; color: #fff; }
      .upload-area {
        border: 2px dashed #666;
        padding: 40px;
        text-align: center;
        border-radius: 8px;
        transition: all 0.3s;
        cursor: pointer;
      }
      .upload-area.dragover {
        border-color: #007bff;
        background: #f8f9fa;
      }
      .upload-area .upload-icon { font-size: 48px; color: #666; margin-bottom: 10px; }
      
      .storage-select {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
        margin: 15px 0;
        padding: 10px;
        background: rgba(0,0,0,0.03);
        border-radius: 8px;
        border: 1px solid rgba(0,0,0,0.06);
        flex-wrap: wrap;
      }
      .storage-select label {
        font-size: 14px;
        color: #555;
        font-weight: 500;
      }
      .storage-select select {
        padding: 6px 12px;
        border-radius: 6px;
        border: 1px solid #ddd;
        background: white;
        font-size: 14px;
        cursor: pointer;
        outline: none;
      }
      .storage-select select:focus {
        border-color: #007bff;
      }
      .storage-select .hint {
        font-size: 12px;
        color: #999;
      }
      
      .webp-toggle {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
        margin: 15px 0;
        padding: 10px;
        background: rgba(0,0,0,0.03);
        border-radius: 8px;
        border: 1px solid rgba(0,0,0,0.06);
        flex-wrap: wrap;
      }
      .webp-toggle label {
        display: flex;
        align-items: center;
        gap: 8px;
        cursor: pointer;
        font-size: 14px;
        color: #555;
        user-select: none;
      }
      .webp-toggle input[type="checkbox"] {
        width: 44px;
        height: 24px;
        appearance: none;
        -webkit-appearance: none;
        background: #ccc;
        border-radius: 12px;
        position: relative;
        cursor: pointer;
        transition: background 0.3s;
        flex-shrink: 0;
      }
      .webp-toggle input[type="checkbox"]::after {
        content: '';
        position: absolute;
        top: 2px;
        left: 2px;
        width: 20px;
        height: 20px;
        background: white;
        border-radius: 50%;
        transition: transform 0.3s;
        box-shadow: 0 1px 3px rgba(0,0,0,0.2);
      }
      .webp-toggle input[type="checkbox"]:checked {
        background: #007bff;
      }
      .webp-toggle input[type="checkbox"]:checked::after {
        transform: translateX(20px);
      }
      .webp-toggle .webp-label { font-weight: 500; color: #333; }
      .webp-toggle .webp-hint { font-size: 12px; color: #999; }
      .webp-toggle .webp-status {
        font-size: 12px;
        padding: 2px 10px;
        border-radius: 10px;
        background: #e9ecef;
        color: #666;
        transition: all 0.3s;
      }
      .webp-toggle .webp-status.active { background: #d4edda; color: #155724; }

      .preview-area {
        margin-top: 20px;
        max-height: 400px;
        overflow-y: auto;
      }
      .preview-item {
        display: flex;
        align-items: center;
        padding: 10px;
        border: 1px solid #ddd;
        margin-bottom: 10px;
        border-radius: 4px;
        background: rgba(255,255,255,0.5);
      }
      .preview-item img {
        max-width: 80px;
        max-height: 80px;
        margin-right: 10px;
        border-radius: 4px;
      }
      .preview-item .info { flex-grow: 1; min-width: 0; }
      .preview-item .info .file-name {
        font-weight: bold;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .preview-item .info .file-size { font-size: 12px; color: #666; }
      .progress-bar {
        height: 20px;
        background: #eee;
        border-radius: 10px;
        margin: 5px 0;
        overflow: hidden;
        position: relative;
      }
      .progress-track {
        height: 100%;
        background: #007bff;
        transition: width 0.3s ease;
        width: 0;
      }
      .progress-text {
        position: absolute;
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%);
        color: white;
        font-size: 12px;
        font-weight: bold;
        text-shadow: 0 1px 2px rgba(0,0,0,0.3);
      }
      .success .progress-track { background: #28a745; }
      .error .progress-track { background: #dc3545; }
      .url-area { margin-top: 10px; width: 100%; }
      .url-area textarea {
        width: 100%;
        min-height: 100px;
        padding: 10px;
        border: 1px solid #ddd;
        border-radius: 4px;
        background: rgba(255,255,255,0.5);
        font-family: monospace;
        font-size: 14px;
        box-sizing: border-box;
      }
      .button-container {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin: 15px 0;
      }
      .button-container button {
        padding: 8px 16px;
        border: none;
        border-radius: 4px;
        background: #007bff;
        color: white;
        cursor: pointer;
        font-size: 14px;
        transition: background 0.2s;
      }
      .button-container button:hover { background: #0056b3; }
      .button-container button.btn-clear { background: #dc3545; }
      .button-container button.btn-clear:hover { background: #c82333; }
      .upload-stats {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-top: 10px;
        padding: 10px;
        background: rgba(0,0,0,0.05);
        border-radius: 4px;
        font-size: 14px;
        color: #666;
      }
      .upload-stats .count { font-weight: bold; color: #333; }

      footer {
        font-size: 0.85rem;
        width: 100%;
        text-align: center;
        margin-top: 20px;
      }
      footer p {
        color: #7F7F7E;
        display: flex;
        justify-content: flex-end;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
        margin: 0;
      }
      @media (max-width: 768px) {
        .container { padding: 15px; }
        .upload-area { padding: 20px; }
        footer p { justify-content: center; }
        .webp-toggle { flex-wrap: wrap; }
        .storage-select { flex-wrap: wrap; }
        .header { flex-wrap: wrap; gap: 10px; }
        .logout-link, .admin-link { padding: 6px 12px; font-size: 12px; }
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <h1><i class="fas fa-cloud-upload-alt"></i> 文件上传</h1>
        <div class="header-actions">
          <button onclick="setBingBackground()" class="btn-refresh" title="换背景">
            <i class="fas fa-sync-alt"></i>
          </button>
          <a href="/admin" class="admin-link"><i class="fas fa-folder-open"></i> 文件管理</a>
          <a href="/logout" class="logout-link" onclick="return confirm('确定要退出登录吗？')">
            <i class="fas fa-sign-out-alt"></i> 退出
          </a>
        </div>
      </div>
      <div class="upload-area" id="uploadArea">
        <div class="upload-icon"><i class="fas fa-cloud-upload-alt"></i></div>
        <p>点击选择 或 拖拽文件到此处<br><small>支持 Ctrl+V 粘贴上传</small></p>
        <input type="file" id="fileInput" multiple style="display: none">
      </div>
      
      <div class="storage-select">
        <label><i class="fas fa-database"></i> 存储方式：</label>
        <select id="storageMode">
          <option value="telegram">☁️ Telegram</option>
          <option value="r2">📦 R2</option>
          <option value="github">🐙 GitHub</option>
        </select>
        <span class="hint">选择文件存储位置</span>
      </div>
      
      <div class="webp-toggle">
        <label>
          <input type="checkbox" id="webpToggle">
          <span class="webp-label">🌐 转换为 WebP</span>
        </label>
        <span class="webp-hint">图片上传时自动转为 WebP 格式</span>
        <span class="webp-status" id="webpStatus">关闭</span>
      </div>
      
      <div class="preview-area" id="previewArea"></div>
      <div class="upload-stats" id="uploadStats">
        <span>已上传: <span class="count" id="uploadCount">0</span> 个文件</span>
        <span>总大小: <span class="count" id="totalSize">0 B</span></span>
      </div>
      <div class="url-area">
        <textarea id="urlArea" readonly placeholder="上传完成后的链接将显示在这里"></textarea>
      </div>
      <div class="button-container">
        <button onclick="copyUrls('url')"><i class="fas fa-copy"></i> 复制URL</button>
        <button onclick="copyUrls('markdown')"><i class="fas fa-code"></i> 复制Markdown</button>
        <button onclick="copyUrls('html')"><i class="fas fa-code"></i> 复制HTML</button>
        <button onclick="copyUrls('bbcode')"><i class="fas fa-code"></i> 复制BBCode</button>
        <button class="btn-clear" onclick="clearAll()"><i class="fas fa-trash"></i> 清空列表</button>
      </div>
      <footer>
        ${copyright()}
      </footer>
    </div>

    <script>
      let config = { maxSizeMB: 20, enableR2Fallback: false };
      let uploadedUrls = [];
      let uploadCount = 0;
      let totalBytes = 0;
      let enableWebP = false;

      const uploadArea = document.getElementById('uploadArea');
      const fileInput = document.getElementById('fileInput');
      const previewArea = document.getElementById('previewArea');
      const urlArea = document.getElementById('urlArea');
      const uploadCountEl = document.getElementById('uploadCount');
      const totalSizeEl = document.getElementById('totalSize');
      const webpToggle = document.getElementById('webpToggle');
      const webpStatus = document.getElementById('webpStatus');
      const storageMode = document.getElementById('storageMode');

      function convertToWebP(file) {
        return new Promise((resolve, reject) => {
          if (!file.type.startsWith('image/') || file.type === 'image/gif') {
            resolve(file);
            return;
          }
          const reader = new FileReader();
          reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
              const canvas = document.createElement('canvas');
              canvas.width = img.width;
              canvas.height = img.height;
              const ctx = canvas.getContext('2d');
              ctx.drawImage(img, 0, 0);
              canvas.toBlob((blob) => {
                if (blob) {
                  const webpFile = new File(
                    [blob], 
                    file.name.replace(/\\.[^.]+$/, '.webp'), 
                    { type: 'image/webp' }
                  );
                  resolve(webpFile);
                } else {
                  resolve(file);
                }
              }, 'image/webp', 0.8);
            };
            img.onerror = () => resolve(file);
            img.src = e.target.result;
          };
          reader.onerror = () => resolve(file);
          reader.readAsDataURL(file);
        });
      }

      webpToggle.addEventListener('change', function() {
        enableWebP = this.checked;
        webpStatus.textContent = enableWebP ? '开启 ✅' : '关闭';
        webpStatus.className = 'webp-status' + (enableWebP ? ' active' : '');
      });

      async function loadConfig() {
        try {
          const response = await fetch('/config');
          if (response.ok) {
            config = await response.json();
          }
        } catch (e) {
          console.error('加载配置失败:', e);
        }
      }

      async function setBingBackground() {
        try {
          var imageUrl = 'https://pico.hangdn.com/api/wallpaper?t=' + Date.now();
          var style = document.body.style;
          style.backgroundImage = 'url(' + imageUrl + ')';
          style.backgroundSize = 'cover';
          style.backgroundPosition = 'center center';
          style.backgroundRepeat = 'no-repeat';
          style.backgroundAttachment = 'fixed';
        } catch (error) {
          console.error('获取背景图失败:', error);
        }
      }

      function formatSize(bytes) {
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let size = bytes;
        let unitIndex = 0;
        while (size >= 1024 && unitIndex < units.length - 1) {
          size /= 1024;
          unitIndex++;
        }
        return \`\${size.toFixed(2)} \${units[unitIndex]}\`;
      }

      function updateUrlArea() {
        urlArea.value = uploadedUrls.join('\\n');
        urlArea.scrollTop = 0;
      }

      function updateStats(file) {
        uploadCount++;
        totalBytes += file.size;
        uploadCountEl.textContent = uploadCount;
        totalSizeEl.textContent = formatSize(totalBytes);
      }

      function createPreview(file) {
        const div = document.createElement('div');
        div.className = 'preview-item';
        
        if (file.type && file.type.startsWith('image/')) {
          const img = document.createElement('img');
          img.src = URL.createObjectURL(file);
          img.onload = () => URL.revokeObjectURL(img.src);
          div.appendChild(img);
        }

        const info = document.createElement('div');
        info.className = 'info';
        info.innerHTML = \`
          <div class="file-name">\${file.name}</div>
          <div class="file-size">\${formatSize(file.size)}</div>
          <div class="progress-bar">
            <div class="progress-track"></div>
            <span class="progress-text">0%</span>
          </div>
        \`;
        div.appendChild(info);
        return div;
      }

      async function uploadFile(file) {
        await loadConfig();
        
        let uploadFile = file;
        if (enableWebP && file.type && file.type.startsWith('image/') && file.type !== 'image/gif') {
          try {
            uploadFile = await convertToWebP(file);
          } catch (e) {
            console.warn('WebP转换失败，使用原文件');
          }
        }

        const preview = createPreview(file);
        previewArea.appendChild(preview);

        const xhr = new XMLHttpRequest();
        const progressTrack = preview.querySelector('.progress-track');
        const progressText = preview.querySelector('.progress-text');

        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            const percent = Math.round((e.loaded / e.total) * 100);
            progressTrack.style.width = \`\${percent}%\`;
            progressText.textContent = \`\${percent}%\`;
          }
        });

        xhr.addEventListener('load', () => {
          try {
            const data = JSON.parse(xhr.responseText);
            if (xhr.status >= 200 && xhr.status < 300 && data.status === 1) {
              progressText.textContent = data.msg || '✓ 上传完成';
              uploadedUrls.push(data.url);
              updateUrlArea();
              updateStats(file);
              preview.classList.add('success');
            } else {
              const errorMsg = [data.msg, data.error || '未知错误'].filter(Boolean).join(' | ');
              progressText.textContent = \`✗ \${errorMsg}\`;
              preview.classList.add('error');
            }
          } catch (e) {
            progressText.textContent = '✗ 响应解析失败';
            preview.classList.add('error');
          }
        });

        xhr.addEventListener('error', () => {
          progressText.textContent = '✗ 网络错误';
          preview.classList.add('error');
        });

        const formData = new FormData();
        formData.append('file', uploadFile);
        formData.append('webp', enableWebP ? 'true' : 'false');
        formData.append('storageMode', storageMode.value);
        xhr.open('POST', '/upload');
        xhr.send(formData);
      }

      async function handleFiles(e) {
        await loadConfig();
        const files = Array.from(e.target.files);
        for (let file of files) {
          if (file.size > config.maxSizeMB * 1024 * 1024) {
            if (storageMode.value === 'telegram') {
              alert(\`文件超过\${config.maxSizeMB}MB限制，请选择 R2 或 GitHub 存储\`);
              continue;
            }
          }
          await uploadFile(file);
        }
        fileInput.value = '';
      }

      function handleDrop(e) {
        const dt = e.dataTransfer;
        const files = dt.files;
        handleFiles({ target: { files } });
      }

      function copyUrls(format) {
        if (uploadedUrls.length === 0) {
          alert('没有可复制的链接');
          return;
        }
        let text = '';
        switch (format) {
          case 'url':
            text = uploadedUrls.join('\\n');
            break;
          case 'markdown':
            text = uploadedUrls.map(url => \`![](\${url})\`).join('\\n');
            break;
          case 'html':
            text = uploadedUrls.map(url => \`<img src="\${url}" />\`).join('\\n');
            break;
          case 'bbcode':
            text = uploadedUrls.map(url => \`[img]\${url}[/img]\`).join('\\n');
            break;
        }
        navigator.clipboard.writeText(text).then(() => {
          alert('已复制到剪贴板');
        }).catch(() => {
          const textarea = document.createElement('textarea');
          textarea.value = text;
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand('copy');
          document.body.removeChild(textarea);
          alert('已复制到剪贴板');
        });
      }

      function clearAll() {
        if (uploadedUrls.length === 0 && previewArea.children.length === 0) return;
        if (!confirm('确定要清空所有上传记录吗？')) return;
        uploadedUrls = [];
        uploadCount = 0;
        totalBytes = 0;
        previewArea.innerHTML = '';
        urlArea.value = '';
        uploadCountEl.textContent = '0';
        totalSizeEl.textContent = '0 B';
      }

      ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        uploadArea.addEventListener(eventName, (e) => {
          e.preventDefault();
          e.stopPropagation();
        });
      });

      ['dragenter', 'dragover'].forEach(eventName => {
        uploadArea.addEventListener(eventName, () => uploadArea.classList.add('dragover'));
      });

      ['dragleave', 'drop'].forEach(eventName => {
        uploadArea.addEventListener(eventName, () => uploadArea.classList.remove('dragover'));
      });

      uploadArea.addEventListener('drop', handleDrop);
      uploadArea.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', handleFiles);

      document.addEventListener('paste', async (e) => {
        const items = (e.clipboardData || e.originalEvent.clipboardData).items;
        for (let item of items) {
          if (item.kind === 'file') {
            const file = item.getAsFile();
            await uploadFile(file);
          }
        }
      });

      window.copyUrls = copyUrls;
      window.clearAll = clearAll;

      loadConfig();
      setBingBackground();
      setInterval(setBingBackground, 3600000);
    </script>
  </body>
  </html>`;
}

// ============================================================
// 22. 管理页面（含鼠标滚轮缩放和拖拽平移功能）
// ============================================================
function generateAdminPage(fileCards, previewModal, qrModal, batchToolbar) {
  return `<!DOCTYPE html>
  <html lang="zh-CN">
  <head>
  ${headLinks()}
  <title>文件管理</title>
    <style>
      * { box-sizing: border-box; }
      body {
        font-family: Arial, sans-serif;
        margin: 0;
        padding: 20px;
        background: #f5f5f5;
        background-size: cover;
        background-position: center center;
        background-repeat: no-repeat;
        background-attachment: fixed;
        min-height: 100vh;
      }
      .container { max-width: 1400px; margin: 0 auto; }

      /* ============ 视图控制栏 ============ */
      .view-controls {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 16px;
        background: rgba(255,255,255,0.6);
        border-radius: 8px;
        backdrop-filter: blur(8px);
        margin-bottom: 16px;
        flex-wrap: wrap;
      }
      .view-controls .view-label {
        font-size: 13px;
        color: #666;
        margin-right: 8px;
        font-weight: 500;
      }
      .view-controls .view-btn {
        padding: 6px 14px;
        border: 1px solid rgba(0,0,0,0.1);
        border-radius: 6px;
        background: rgba(255,255,255,0.5);
        cursor: pointer;
        font-size: 13px;
        transition: all 0.2s ease;
        color: #555;
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      .view-controls .view-btn:hover {
        background: rgba(255,255,255,0.9);
        border-color: rgba(0,0,0,0.2);
      }
      .view-controls .view-btn.active {
        background: #007bff;
        color: #fff;
        border-color: #007bff;
      }
      .view-controls .view-btn i {
        font-size: 14px;
      }

      /* ============ 列表视图 ============ */
      .view-list .file-card {
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 12px 16px;
        min-height: 80px;
        border-radius: 8px;
      }
      .view-list .file-card .file-preview {
        width: 80px;
        height: 80px;
        flex-shrink: 0;
        border-radius: 6px;
        overflow: hidden;
        background: rgba(0,0,0,0.05);
      }
      .view-list .file-card .file-preview img,
      .view-list .file-card .file-preview video {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .view-list .file-card .file-info {
        flex: 1;
        padding: 0;
        min-width: 0;
      }
      .view-list .file-card .file-info .file-name {
        font-size: 15px;
        font-weight: 600;
      }
      .view-list .file-card .file-info .file-meta {
        font-size: 13px;
        color: #888;
      }
      .view-list .file-card .file-actions {
        border-top: none;
        padding: 0;
        flex-shrink: 0;
        gap: 6px;
      }
      .view-list .file-card .file-checkbox {
        position: relative;
        top: auto;
        left: auto;
        margin-right: 8px;
        flex-shrink: 0;
      }

      /* ============ 网格视图（默认） ============ */
      .view-grid .file-card {
        display: block;
      }
      .view-grid .file-card .file-preview {
        height: 160px;
      }
      .view-grid .file-card .file-info {
        padding: 10px 12px;
      }
      .view-grid .file-card .file-actions {
        padding: 8px 12px;
        border-top: 1px solid rgba(0,0,0,0.1);
      }
      .view-grid .file-card .file-checkbox {
        position: absolute;
        top: 10px;
        left: 10px;
      }

      /* ============ 瀑布流视图 ============ */
      .view-waterfall {
        column-count: 4;
        column-gap: 16px;
      }
      .view-waterfall .file-card {
        break-inside: avoid;
        margin-bottom: 16px;
        display: block;
      }
      .view-waterfall .file-card .file-preview {
        height: auto;
        min-height: 100px;
        max-height: 400px;
      }
      .view-waterfall .file-card .file-preview img,
      .view-waterfall .file-card .file-preview video {
        width: 100%;
        height: auto;
        max-height: 400px;
        object-fit: contain;
      }
      .view-waterfall .file-card .file-info {
        padding: 10px 12px;
      }
      .view-waterfall .file-card .file-actions {
        padding: 8px 12px;
        border-top: 1px solid rgba(0,0,0,0.1);
      }
      .view-waterfall .file-card .file-checkbox {
        position: absolute;
        top: 10px;
        left: 10px;
      }

      @media (max-width: 1200px) {
        .view-waterfall { column-count: 3; }
      }
      @media (max-width: 768px) {
        .view-waterfall { column-count: 2; }
        .view-controls .view-label { display: none; }
        .view-controls .view-btn { padding: 4px 10px; font-size: 12px; }
      }
      @media (max-width: 480px) {
        .view-waterfall { column-count: 1; }
      }

      .header {
        background: rgba(255, 255, 255, 0.5);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        padding: 20px;
        border-radius: 8px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        margin-bottom: 20px;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 10px;
      }
      .header h2 { margin: 0; flex: 1; min-width: 0; }
      .header-actions {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .btn-refresh {
        background: rgba(0,0,0,0.06);
        border: 1px solid rgba(0,0,0,0.1);
        color: #555;
        width: 36px;
        height: 36px;
        border-radius: 50%;
        cursor: pointer;
        font-size: 16px;
        transition: all 0.3s ease;
        flex-shrink: 0;
      }
      .btn-refresh:hover {
        background: rgba(0,0,0,0.12);
        transform: rotate(180deg);
      }
      .btn-refresh:active {
        transform: rotate(360deg);
      }
      .header .backup {
        background: #007BFF;
        padding: 8px 16px;
        border: none;
        border-radius: 4px;
        text-decoration: none;
        color: #fff;
        transition: background 0.2s;
        font-size: 14px;
      }
      .header .backup:hover { background: #0056b3; text-decoration: none; color: #fff; }
      .header .logout-link {
        background: #dc3545;
        padding: 8px 16px;
        border: none;
        border-radius: 4px;
        text-decoration: none;
        color: #fff;
        transition: background 0.2s;
        font-size: 14px;
      }
      .header .logout-link:hover { background: #c82333; text-decoration: none; color: #fff; }
      .header .search {
        flex: 1 1 100%;
        max-width: 100%;
        padding: 8px 12px;
        border: 1px solid #ddd;
        border-radius: 4px;
        background: rgba(255,255,255,0.5);
        box-sizing: border-box;
        font-size: 14px;
      }
      @media (min-width: 768px) {
        .header { flex-wrap: nowrap; }
        .header .search { flex: unset; width: 300px; }
      }
      @media (max-width: 768px) {
        .header .backup, .header .logout-link { padding: 6px 12px; font-size: 12px; }
      }

      .storage-badge {
        font-size: 10px;
        padding: 2px 6px;
        border-radius: 10px;
        margin-left: 4px;
        font-weight: bold;
      }
      .storage-badge.tg { background: #28a745; color: white; }
      .storage-badge.r2 { background: #007bff; color: white; }
      .storage-badge.github { background: #24292e; color: white; }

      .batch-toolbar {
        background: rgba(255, 255, 255, 0.8);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        padding: 15px 20px;
        border-radius: 8px;
        margin-bottom: 20px;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.1);
      }
      .batch-toolbar #selectedCount { font-weight: bold; color: #333; }
      .batch-actions { display: flex; flex-wrap: wrap; gap: 8px; }
      .batch-actions .btn {
        padding: 6px 12px;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 13px;
        transition: all 0.2s;
        color: white;
        display: inline-flex;
        align-items: center;
        gap: 5px;
      }
      .btn-batch-copy { background: #007bff; }
      .btn-batch-copy:hover { background: #0056b3; }
      .btn-batch-delete { background: #dc3545; }
      .btn-batch-delete:hover { background: #c82333; }
      .btn-select-all { background: #28a745; }
      .btn-select-all:hover { background: #218838; }
      .btn-clear-select { background: #6c757d; }
      .btn-clear-select:hover { background: #5a6268; }

      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
        gap: 20px;
      }
      .file-card {
        background: rgba(255, 255, 255, 0.5);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        border-radius: 8px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        overflow: hidden;
        position: relative;
        transition: transform 0.2s, box-shadow 0.2s;
      }
      .file-card:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 20px rgba(0,0,0,0.15);
      }
      .file-card .file-checkbox {
        position: absolute;
        top: 10px;
        left: 10px;
        z-index: 10;
        width: 18px;
        height: 18px;
        cursor: pointer;
        accent-color: #007bff;
      }
      .file-card.selected { border: 2px solid #007bff; }
      .file-preview {
        height: 160px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0,0,0,0.05);
        cursor: pointer;
        overflow: hidden;
        position: relative;
      }
      .file-preview img {
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
        transition: transform 0.3s;
      }
      .file-preview img:hover { transform: scale(1.05); }
      .file-preview video {
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
      }
      .file-preview .file-icon { font-size: 48px; color: #666; }
      .file-info { padding: 10px 12px; font-size: 13px; }
      .file-info .file-name {
        font-weight: bold;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        margin-bottom: 4px;
      }
      .file-info .file-meta { color: #666; font-size: 12px; }
      .file-actions {
        padding: 8px 12px;
        border-top: 1px solid rgba(0,0,0,0.1);
        display: flex;
        justify-content: space-around;
        gap: 4px;
      }
      .file-actions .btn {
        padding: 5px 10px;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 13px;
        transition: all 0.2s;
        background: #f0f0f0;
        color: #333;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 32px;
      }
      .file-actions .btn:hover { transform: scale(1.05); }
      .file-actions .btn-delete { background: #dc3545; color: white; }
      .file-actions .btn-delete:hover { background: #c82333; }
      .file-actions .btn-copy { background: #007bff; color: white; }
      .file-actions .btn-copy:hover { background: #0056b3; }
      .file-actions .btn-share { background: #17a2b8; color: white; }
      .file-actions .btn-share:hover { background: #138496; }
      .file-actions .btn-open { background: #28a745; color: white; text-decoration: none; }
      .file-actions .btn-open:hover { background: #218838; }

      /* ============ 预览模态框样式（含缩放） ============ */
      .modal {
        display: none;
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.85);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        justify-content: center;
        align-items: center;
        z-index: 1000;
        animation: fadeIn 0.3s ease;
      }
      .modal.active { display: flex; }
      @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      
      .modal-content {
        background: transparent;
        padding: 0;
        border-radius: 16px;
        max-width: 95%;
        max-height: 95%;
        position: relative;
        animation: slideUp 0.3s ease;
        overflow: hidden;
        box-shadow: 0 8px 40px rgba(0,0,0,0.5);
        display: flex;
        flex-direction: column;
      }
      @keyframes slideUp { from { transform: scale(0.95); opacity: 0; } to { transform: scale(1); opacity: 1; } }
      
      .modal-close {
        position: absolute;
        top: 12px;
        right: 20px;
        font-size: 28px;
        cursor: pointer;
        color: #fff;
        transition: all 0.2s;
        line-height: 1;
        z-index: 10;
        text-shadow: 0 2px 12px rgba(0,0,0,0.6);
        background: rgba(0,0,0,0.4);
        width: 40px;
        height: 40px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: bold;
        border: 1px solid rgba(255,255,255,0.1);
      }
      .modal-close:hover { 
        color: #ff6b6b; 
        background: rgba(255,255,255,0.15);
        transform: rotate(90deg);
      }

      .preview-wrapper {
        position: relative;
        width: 100%;
        max-width: 92vw;
        max-height: 82vh;
        overflow: hidden;
        background: rgba(0, 0, 0, 0.9);
        border-radius: 16px 16px 0 0;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: grab;
        user-select: none;
        -webkit-user-select: none;
        min-height: 300px;
      }

      .preview-wrapper:active {
        cursor: grabbing;
      }

      .preview-container {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        position: relative;
        padding: 20px;
      }

      #previewImage {
        max-width: 100%;
        max-height: 75vh;
        object-fit: contain;
        user-select: none;
        -webkit-user-drag: none;
        pointer-events: none;
        transition: transform 0.05s linear;
        border-radius: 8px;
        will-change: transform;
      }

      .zoom-hint {
        position: absolute;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.7);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        color: rgba(255, 255, 255, 0.8);
        padding: 6px 16px;
        border-radius: 20px;
        font-size: 12px;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.5s ease;
        white-space: nowrap;
        border: 1px solid rgba(255,255,255,0.05);
      }

      .preview-wrapper:hover .zoom-hint {
        opacity: 1;
      }

      .preview-toolbar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 20px;
        background: rgba(0, 0, 0, 0.8);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        border-radius: 0 0 16px 16px;
        gap: 12px;
        flex-wrap: wrap;
        border-top: 1px solid rgba(255,255,255,0.05);
      }
      .preview-filename {
        color: #fff;
        font-size: 14px;
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 300px;
        opacity: 0.8;
      }
      .preview-actions {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }
      .preview-actions button {
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255,255,255,0.05);
        color: #fff;
        width: 34px;
        height: 34px;
        border-radius: 50%;
        cursor: pointer;
        font-size: 13px;
        transition: all 0.2s ease;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .preview-actions button:hover {
        background: rgba(255, 255, 255, 0.2);
        transform: scale(1.05);
        border-color: rgba(255,255,255,0.15);
      }
      .preview-actions .preview-delete:hover {
        background: #dc3545;
        border-color: #dc3545;
      }

      .zoom-level {
        color: rgba(255,255,255,0.5);
        font-size: 12px;
        padding: 0 6px;
        min-width: 40px;
        text-align: center;
      }

      @media (max-width: 600px) {
        .preview-wrapper {
          max-width: 100vw;
          max-height: 70vh;
          border-radius: 12px 12px 0 0;
          min-height: 200px;
        }
        #previewImage {
          max-height: 60vh;
        }
        .zoom-hint {
          font-size: 10px;
          padding: 4px 12px;
          bottom: 10px;
        }
        .preview-actions button {
          width: 30px;
          height: 30px;
          font-size: 11px;
        }
        .preview-toolbar {
          padding: 10px 14px;
          gap: 8px;
        }
        .preview-filename {
          font-size: 12px;
          max-width: 120px;
        }
        .modal-content {
          max-width: 100%;
          max-height: 100%;
          border-radius: 0;
        }
        .preview-wrapper {
          border-radius: 0;
        }
        .preview-toolbar {
          border-radius: 0;
        }
      }

      .qr-content { text-align: center; min-width: 250px; }
      #qrcode { margin: 15px auto; display: flex; justify-content: center; }
      .qr-buttons {
        display: flex;
        gap: 10px;
        justify-content: center;
        margin-top: 15px;
        flex-wrap: wrap;
      }
      .qr-buttons button {
        padding: 8px 20px;
        border: none;
        border-radius: 5px;
        cursor: pointer;
        font-size: 14px;
        transition: all 0.2s;
        color: white;
      }
      .qr-copy { background: #007bff; }
      .qr-copy:hover { background: #0056b3; }
      .qr-close { background: #6c757d; }
      .qr-close:hover { background: #5a6268; }

      #pagination {
        display: flex;
        justify-content: center;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
        margin: 20px 0;
      }
      #pagination .btn-page {
        padding: 6px 14px;
        border-radius: 6px;
        border: 1px solid #ddd;
        background: rgba(255, 255, 255, 0.5);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        color: #333;
        cursor: pointer;
        transition: all 0.2s;
        min-width: 40px;
        text-align: center;
        font-size: 14px;
        box-shadow: none;
      }
      #pagination .btn-page:hover { background-color: #007bff; color: #fff; border-color: #007bff; }
      #pagination .btn-page.active { background-color: #007bff; color: #fff; border-color: #007bff; cursor: default; }
      #pagination .btn-page:disabled { background-color: #f0f0f0; color: #aaa; cursor: not-allowed; border-color: #ccc; }
      #pagination span.page-info { padding: 6px 10px; font-size: 14px; color: #333; }

      .empty-state { text-align: center; padding: 60px 20px; color: #666; }
      .empty-state .icon { font-size: 64px; margin-bottom: 20px; color: #ccc; }
      .empty-state h3 { margin: 0 0 10px 0; color: #333; }

      footer { font-size: 0.85rem; width: 100%; text-align: center; margin-top: 30px; }
      footer p {
        color: #7F7F7E;
        display: flex;
        justify-content: center;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
        margin: 0;
      }
      footer a { color: #7F7F7E; text-decoration: none; transition: color 0.3s ease; }
      footer a:hover { color: #007BFF !important; }

      @media (max-width: 768px) {
        .grid { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; }
        .file-preview { height: 120px; }
        .batch-toolbar { flex-direction: column; align-items: stretch; }
        .batch-actions { justify-content: center; }
        .batch-actions .btn { font-size: 12px; padding: 4px 10px; }
        .header { flex-wrap: wrap; gap: 10px; }
        .preview-toolbar { flex-direction: column; align-items: stretch; gap: 8px; padding: 10px 16px; }
        .preview-filename { max-width: 100%; text-align: center; }
        .preview-actions { justify-content: center; }
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <h2><i class="fas fa-folder-open"></i> 文件管理</h2>
        <div class="header-actions">
          <button onclick="setBingBackground()" class="btn-refresh" title="换背景">
            <i class="fas fa-sync-alt"></i>
          </button>
          <a href="/upload" class="backup"><i class="fas fa-upload"></i> 上传</a>
          <a href="/logout" class="logout-link" onclick="return confirm('确定要退出登录吗？')">
            <i class="fas fa-sign-out-alt"></i> 退出
          </a>
        </div>
        <input type="text" class="search" placeholder="搜索文件..." id="searchInput">
      </div>
      
      <!-- ============ 视图控制 ============ -->
      <div class="view-controls">
        <span class="view-label"><i class="fas fa-eye"></i> 视图：</span>
        <button class="view-btn active" data-view="grid" onclick="switchView('grid')">
          <i class="fas fa-th"></i> 网格
        </button>
        <button class="view-btn" data-view="list" onclick="switchView('list')">
          <i class="fas fa-list"></i> 列表
        </button>
        <button class="view-btn" data-view="waterfall" onclick="switchView('waterfall')">
          <i class="fas fa-water"></i> 瀑布流
        </button>
      </div>
      
      ${batchToolbar}
      
      <div class="grid view-grid" id="fileGrid">
        ${fileCards || '<div class="empty-state"><div class="icon"><i class="fas fa-inbox"></i></div><h3>暂无文件</h3><p>上传一些文件开始使用吧</p></div>'}
      </div>
      
      <div id="pagination"></div>
      
      ${previewModal}
      ${qrModal}
      
      <footer>
        ${copyright()}
      </footer>
    </div>

    <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
    <script>
      // ============ 变量 ============
      const itemsPerPage = 20;
      let currentPage = 1;
      let selectedUrls = new Set();
      let currentShareUrl = '';
      let currentPreviewUrl = '';
      let currentPreviewName = '';

      const fileGrid = document.getElementById('fileGrid');
      const searchInput = document.getElementById('searchInput');
      const batchToolbar = document.getElementById('batchToolbar');
      const selectedCountEl = document.getElementById('selectedCount');
      
      let fileCards = Array.from(document.querySelectorAll('.file-card'));
      const paginationContainer = document.createElement('div');
      paginationContainer.id = 'pagination';
      fileGrid.parentNode.insertBefore(paginationContainer, fileGrid.nextSibling);

      // ============ 预览缩放变量 ============
      let previewScale = 1;
      let previewTranslateX = 0;
      let previewTranslateY = 0;
      let isDragging = false;
      let dragStartX = 0;
      let dragStartY = 0;
      let dragStartTranslateX = 0;
      let dragStartTranslateY = 0;

      // ============ 视图切换 ============
      function switchView(view) {
        const grid = document.getElementById('fileGrid');
        const btns = document.querySelectorAll('.view-btn');
        
        // 移除所有视图类
        grid.className = 'grid';
        // 添加选中的视图类
        grid.classList.add('view-' + view);
        
        // 更新按钮状态
        btns.forEach(btn => {
          btn.classList.toggle('active', btn.dataset.view === view);
        });
        
        // 保存用户偏好
        try {
          localStorage.setItem('adminView', view);
        } catch(e) {}
      }

      function restoreView() {
        try {
          const saved = localStorage.getItem('adminView');
          if (saved) {
            const btn = document.querySelector('.view-btn[data-view="' + saved + '"]');
            if (btn) {
              setTimeout(function() { switchView(saved); }, 50);
              return;
            }
          }
        } catch(e) {}
        switchView('grid');
      }

      // ============ 背景图 ============
      async function setBingBackground() {
        try {
          var imageUrl = 'https://pico.hangdn.com/api/wallpaper?t=' + Date.now();
          var style = document.body.style;
          style.backgroundImage = 'url(' + imageUrl + ')';
          style.backgroundSize = 'cover';
          style.backgroundPosition = 'center center';
          style.backgroundRepeat = 'no-repeat';
          style.backgroundAttachment = 'fixed';
        } catch (error) {
          console.error('获取背景图失败:', error);
        }
      }
      setBingBackground();
      setInterval(setBingBackground, 3600000);

      // ============ 复选框 ============
      function updateSelection() {
        const checkboxes = document.querySelectorAll('.file-checkbox:checked');
        selectedUrls = new Set(Array.from(checkboxes).map(cb => cb.dataset.url));
        
        document.querySelectorAll('.file-card').forEach(card => {
          const cb = card.querySelector('.file-checkbox');
          card.classList.toggle('selected', cb && cb.checked);
        });
        
        const count = selectedUrls.size;
        if (count > 0) {
          batchToolbar.style.display = 'flex';
          selectedCountEl.textContent = \`已选择 \${count} 个文件\`;
        } else {
          batchToolbar.style.display = 'none';
        }
      }

      document.addEventListener('change', (e) => {
        if (e.target.classList.contains('file-checkbox')) {
          updateSelection();
        }
      });

      function toggleSelectAll() {
        const checkboxes = document.querySelectorAll('.file-checkbox');
        const allChecked = Array.from(checkboxes).every(cb => cb.checked);
        checkboxes.forEach(cb => cb.checked = !allChecked);
        updateSelection();
      }

      function clearSelection() {
        document.querySelectorAll('.file-checkbox').forEach(cb => cb.checked = false);
        updateSelection();
      }

      // ============ 批量复制 ============
      function batchCopy() {
        if (selectedUrls.size === 0) {
          alert('请先选择文件');
          return;
        }
        const urls = Array.from(selectedUrls);
        const text = urls.join('\\n');
        navigator.clipboard.writeText(text).then(() => {
          alert(\`已复制 \${urls.length} 个链接到剪贴板\`);
        }).catch(() => {
          const textarea = document.createElement('textarea');
          textarea.value = text;
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand('copy');
          document.body.removeChild(textarea);
          alert(\`已复制 \${urls.length} 个链接到剪贴板\`);
        });
      }

      // ============ 批量删除 ============
      async function batchDelete() {
        if (selectedUrls.size === 0) {
          alert('请先选择文件');
          return;
        }
        if (!confirm(\`确定要删除选中的 \${selectedUrls.size} 个文件吗？此操作不可恢复！\`)) return;
        
        const urls = Array.from(selectedUrls);
        try {
          const response = await fetch('/batch-delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ urls })
          });
          
          const data = await response.json();
          if (data.success) {
            await reloadPageData();
            selectedUrls.clear();
            updateSelection();
            alert(data.message);
          } else {
            throw new Error(data.error || '批量删除失败');
          }
        } catch (err) {
          alert('批量删除失败: ' + err.message);
        }
      }

      // ============ 重新加载页面数据 ============
      async function reloadPageData() {
        try {
          const response = await fetch('/admin');
          const html = await response.text();
          const parser = new DOMParser();
          const doc = parser.parseFromString(html, 'text/html');
          const newGrid = doc.getElementById('fileGrid');
          if (newGrid) {
            fileGrid.innerHTML = newGrid.innerHTML;
            fileCards = Array.from(document.querySelectorAll('.file-card'));
            renderPage(currentPage);
          }
        } catch (e) {
          console.error('刷新数据失败:', e);
          location.reload();
        }
      }

      // ============ 单个复制 ============
      function copySingleUrl(url) {
        navigator.clipboard.writeText(url).then(() => {
          const btn = event.target.closest('.btn-copy');
          if (btn) {
            const originalHtml = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-check"></i>';
            setTimeout(() => btn.innerHTML = originalHtml, 2000);
          }
        }).catch(() => {
          const textarea = document.createElement('textarea');
          textarea.value = url;
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand('copy');
          document.body.removeChild(textarea);
          alert('链接已复制');
        });
      }

      // ============ 大图预览（带缩放功能） ============
      function openPreview(url) {
        const modal = document.getElementById('previewModal');
        const img = document.getElementById('previewImage');
        const filename = document.getElementById('previewFilename');
        const container = document.getElementById('previewContainer');
        
        const card = document.querySelector('[data-url="' + url + '"]');
        const nameEl = card ? card.querySelector('.file-name') : null;
        var fileName = nameEl ? nameEl.textContent.replace(/TG|R2|GitHub/g, '').trim() : '未知文件';
        
        // 重置缩放状态
        previewScale = 1;
        previewTranslateX = 0;
        previewTranslateY = 0;
        updatePreviewTransform();
        
        img.src = url;
        currentPreviewUrl = url;
        currentPreviewName = fileName;
        filename.textContent = fileName;
        
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
      }

      function closePreview() {
        const modal = document.getElementById('previewModal');
        modal.classList.remove('active');
        document.body.style.overflow = '';
        setTimeout(function() { 
          document.getElementById('previewImage').src = ''; 
        }, 300);
      }

      // ============ 关闭预览（点击背景） ============
      function closePreviewOnBackdrop(event) {
        if (event.target === event.currentTarget) {
          closePreview();
        }
      }

      // ============ 更新图片变换 ============
      function updatePreviewTransform() {
        const img = document.getElementById('previewImage');
        if (!img) return;
        img.style.transform = \`translate(\${previewTranslateX}px, \${previewTranslateY}px) scale(\${previewScale})\`;
      }

      // ============ 缩放控制 ============
      function previewZoomIn() {
        previewScale = Math.min(previewScale + 0.2, 5);
        updatePreviewTransform();
      }

      function previewZoomOut() {
        previewScale = Math.max(previewScale - 0.2, 0.2);
        updatePreviewTransform();
      }

      function previewZoomReset() {
        previewScale = 1;
        previewTranslateX = 0;
        previewTranslateY = 0;
        updatePreviewTransform();
      }

      // ============ 鼠标滚轮缩放 ============
      function handleWheelZoom(e) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        previewScale = Math.min(Math.max(previewScale + delta, 0.2), 5);
        updatePreviewTransform();
      }

      // ============ 鼠标拖拽平移 ============
      function handleDragStart(e) {
        if (previewScale <= 1) return;
        isDragging = true;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        dragStartTranslateX = previewTranslateX;
        dragStartTranslateY = previewTranslateY;
        document.getElementById('previewWrapper').style.cursor = 'grabbing';
      }

      function handleDragMove(e) {
        if (!isDragging) return;
        const dx = e.clientX - dragStartX;
        const dy = e.clientY - dragStartY;
        previewTranslateX = dragStartTranslateX + dx;
        previewTranslateY = dragStartTranslateY + dy;
        updatePreviewTransform();
      }

      function handleDragEnd(e) {
        if (!isDragging) return;
        isDragging = false;
        document.getElementById('previewWrapper').style.cursor = 'grab';
      }

      // ============ 绑定缩放事件 ============
      function bindPreviewEvents() {
        const wrapper = document.getElementById('previewWrapper');
        if (!wrapper) return;
        
        // 滚轮缩放
        wrapper.addEventListener('wheel', handleWheelZoom, { passive: false });
        
        // 鼠标拖拽
        wrapper.addEventListener('mousedown', handleDragStart);
        document.addEventListener('mousemove', handleDragMove);
        document.addEventListener('mouseup', handleDragEnd);
        
        // 触摸支持
        let touchStartX = 0, touchStartY = 0;
        let touchStartTranslateX = 0, touchStartTranslateY = 0;
        let lastTouchDistance = 0;
        
        wrapper.addEventListener('touchstart', function(e) {
          if (e.touches.length === 1 && previewScale > 1) {
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
            touchStartTranslateX = previewTranslateX;
            touchStartTranslateY = previewTranslateY;
            isDragging = true;
          } else if (e.touches.length === 2) {
            const touch1 = e.touches[0];
            const touch2 = e.touches[1];
            lastTouchDistance = Math.hypot(touch2.clientX - touch1.clientX, touch2.clientY - touch1.clientY);
          }
        }, { passive: true });
        
        wrapper.addEventListener('touchmove', function(e) {
          if (e.touches.length === 1 && isDragging && previewScale > 1) {
            const dx = e.touches[0].clientX - touchStartX;
            const dy = e.touches[0].clientY - touchStartY;
            previewTranslateX = touchStartTranslateX + dx;
            previewTranslateY = touchStartTranslateY + dy;
            updatePreviewTransform();
          } else if (e.touches.length === 2) {
            const touch1 = e.touches[0];
            const touch2 = e.touches[1];
            const distance = Math.hypot(touch2.clientX - touch1.clientX, touch2.clientY - touch1.clientY);
            const scaleDelta = (distance - lastTouchDistance) / 200;
            previewScale = Math.min(Math.max(previewScale + scaleDelta, 0.2), 5);
            lastTouchDistance = distance;
            updatePreviewTransform();
          }
        }, { passive: true });
        
        wrapper.addEventListener('touchend', function(e) {
          isDragging = false;
        }, { passive: true });
      }

      // ============ 监听模态框打开 ============
      document.addEventListener('DOMContentLoaded', function() {
        const modal = document.getElementById('previewModal');
        const observer = new MutationObserver(function(mutations) {
          mutations.forEach(function(mutation) {
            if (mutation.attributeName === 'class') {
              if (modal.classList.contains('active')) {
                setTimeout(bindPreviewEvents, 200);
              }
            }
          });
        });
        observer.observe(modal, { attributes: true });
      });

      // ============ 预览工具栏操作 ============
      function previewOpenLink() {
        if (currentPreviewUrl) {
          window.open(currentPreviewUrl, '_blank');
        }
      }

      function previewCopyLink() {
        if (currentPreviewUrl) {
          navigator.clipboard.writeText(currentPreviewUrl).then(function() {
            alert('链接已复制');
          }).catch(function() {
            var textarea = document.createElement('textarea');
            textarea.value = currentPreviewUrl;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            alert('链接已复制');
          });
        }
      }

      function previewDeleteFile() {
        if (!currentPreviewUrl) return;
        if (!confirm('确定要删除这个文件吗？此操作不可恢复！')) return;
        deleteFile(currentPreviewUrl);
        closePreview();
      }

      document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') { 
          closePreview(); 
          closeQRModal(); 
        }
      });

      // ============ 二维码 ============
      function showQRCode(url) {
        currentShareUrl = url;
        const modal = document.getElementById('qrModal');
        const qrcodeDiv = document.getElementById('qrcode');
        const copyBtn = document.querySelector('.qr-copy');
        
        copyBtn.textContent = '复制链接';
        copyBtn.disabled = false;
        qrcodeDiv.innerHTML = '';
        
        new QRCode(qrcodeDiv, {
          text: url,
          width: 200,
          height: 200,
          colorDark: "#000",
          colorLight: "#fff",
          correctLevel: QRCode.CorrectLevel.H
        });
        
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
      }

      function handleCopyUrl() {
        navigator.clipboard.writeText(currentShareUrl).then(function() {
          var copyBtn = document.querySelector('.qr-copy');
          copyBtn.textContent = '✔ 已复制';
          copyBtn.disabled = true;
          setTimeout(function() {
            copyBtn.textContent = '复制链接';
            copyBtn.disabled = false;
          }, 3000);
        }).catch(function() { 
          alert('复制失败，请手动复制'); 
        });
      }

      function closeQRModal() {
        var modal = document.getElementById('qrModal');
        modal.classList.remove('active');
        document.body.style.overflow = '';
      }

      document.querySelectorAll('.modal').forEach(function(modal) {
        modal.addEventListener('click', function(e) {
          if (e.target === modal) {
            modal.classList.remove('active');
            document.body.style.overflow = '';
          }
        });
      });

      // ============ 删除单个 ============
      async function deleteFile(url) {
        if (!confirm('确定要删除这个文件吗？此操作不可恢复！')) return;
        try {
          var response = await fetch('/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: url })
          });
          
          if (!response.ok) {
            var errorData = await response.json();
            throw new Error(errorData.error || '删除失败');
          }
          
          await reloadPageData();
          selectedUrls.delete(url);
          updateSelection();
          alert('文件删除成功');
        } catch (err) {
          alert('文件删除失败: ' + err.message);
        }
      }

      // ============ 分页 ============
      function getFilteredCards() {
        var term = searchInput.value.toLowerCase();
        return fileCards.filter(function(card) {
          var name = card.querySelector('.file-name') ? card.querySelector('.file-name').textContent.toLowerCase() : '';
          return name.includes(term);
        });
      }

      function renderPage(page) {
        var filteredCards = getFilteredCards();
        var totalPages = Math.ceil(filteredCards.length / itemsPerPage) || 1;
        if (page > totalPages) currentPage = totalPages;
        if (page < 1) currentPage = 1;
    
        var start = (currentPage - 1) * itemsPerPage;
        var end = start + itemsPerPage;
    
        fileCards.forEach(function(c) { c.style.display = 'none'; });
        filteredCards.slice(start, end).forEach(function(c) { c.style.display = ''; });
        renderPagination(totalPages);
      }

      function renderPagination(totalPages) {
        paginationContainer.innerHTML = '';
        if (totalPages <= 1) return;

        var prevBtn = document.createElement('button');
        prevBtn.textContent = '‹ 上一页';
        prevBtn.className = 'btn-page';
        prevBtn.disabled = currentPage === 1;
        prevBtn.onclick = function() { currentPage--; renderPage(currentPage); };
        paginationContainer.appendChild(prevBtn);

        var maxVisible = 7;
        var startPage = Math.max(1, currentPage - 3);
        var endPage = Math.min(totalPages, startPage + maxVisible - 1);
        if (endPage - startPage < maxVisible - 1) {
          startPage = Math.max(1, endPage - maxVisible + 1);
        }

        if (startPage > 1) {
          var firstBtn = document.createElement('button');
          firstBtn.textContent = '1';
          firstBtn.className = 'btn-page';
          firstBtn.onclick = function() { currentPage = 1; renderPage(currentPage); };
          paginationContainer.appendChild(firstBtn);
          if (startPage > 2) {
            var dots = document.createElement('span');
            dots.textContent = '…';
            dots.className = 'page-info';
            paginationContainer.appendChild(dots);
          }
        }

        for (var i = startPage; i <= endPage; i++) {
          var btn = document.createElement('button');
          btn.textContent = i;
          btn.className = 'btn-page' + (i === currentPage ? ' active' : '');
          btn.onclick = (function(page) { 
            return function() { currentPage = page; renderPage(currentPage); };
          })(i);
          paginationContainer.appendChild(btn);
        }

        if (endPage < totalPages) {
          if (endPage < totalPages - 1) {
            var dots = document.createElement('span');
            dots.textContent = '…';
            dots.className = 'page-info';
            paginationContainer.appendChild(dots);
          }
          var lastBtn = document.createElement('button');
          lastBtn.textContent = totalPages;
          lastBtn.className = 'btn-page';
          lastBtn.onclick = function() { currentPage = totalPages; renderPage(currentPage); };
          paginationContainer.appendChild(lastBtn);
        }

        var nextBtn = document.createElement('button');
        nextBtn.textContent = '下一页 ›';
        nextBtn.className = 'btn-page';
        nextBtn.disabled = currentPage === totalPages;
        nextBtn.onclick = function() { currentPage++; renderPage(currentPage); };
        paginationContainer.appendChild(nextBtn);
      }

      searchInput.addEventListener('input', function() {
        currentPage = 1;
        renderPage(currentPage);
      });

      // ============ 暴露全局函数 ============
      window.toggleSelectAll = toggleSelectAll;
      window.clearSelection = clearSelection;
      window.batchCopy = batchCopy;
      window.batchDelete = batchDelete;
      window.copySingleUrl = copySingleUrl;
      window.openPreview = openPreview;
      window.closePreview = closePreview;
      window.closePreviewOnBackdrop = closePreviewOnBackdrop;
      window.previewZoomIn = previewZoomIn;
      window.previewZoomOut = previewZoomOut;
      window.previewZoomReset = previewZoomReset;
      window.previewOpenLink = previewOpenLink;
      window.previewCopyLink = previewCopyLink;
      window.previewDeleteFile = previewDeleteFile;
      window.showQRCode = showQRCode;
      window.handleCopyUrl = handleCopyUrl;
      window.closeQRModal = closeQRModal;
      window.deleteFile = deleteFile;
      window.switchView = switchView;
      window.restoreView = restoreView;

      // ============ 初始化渲染 ============
      restoreView();
      renderPage(currentPage);
    </script>
  </body>
  </html>`;
}
