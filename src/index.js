/**
 * 主入口文件 - Telegram文件托管平台
 */

import { loadConfig, getSafeConfig, defaultConfig } from './config.js';
import { initDatabase, getFiles, searchFiles, deleteFile, deleteFiles } from './database.js';
import { authenticate, requireAuth, validateCredentials, createAuthToken } from './auth.js';
import { uploadToTelegram, handleChunkedUpload } from './upload.js';
import { handleFileRequest, getPreviewHtml, formatFileInfo } from './file.js';
import { 
  getCacheMaxAge, 
  createCacheHeaders,
  getFromCache,
  saveToCache 
} from './cache.js';
import {
  formatSize,
  getContentType,
  generateFileUrl,
  generateUploadId,
  getClientIP,
  createErrorResponse,
  createSuccessResponse,
  generateHeadLinks,
  generateCopyright
} from './utils.js';
import {
  generateLoginPage,
  generateUploadPage,
  generateAdminPage
} from './templates/index.js';

export default {
  async fetch(request, env) {
    const config = loadConfig(env);
    
    try {
      await initDatabase(config);
    } catch (error) {
      return new Response('Database error', { status: 500 });
    }

    const { pathname } = new URL(request.url);
    
    // 路由处理
    const routes = {
      '/': () => handleAuthRequest(request, config),
      '/login': () => handleLoginRequest(request, config),
      '/upload': () => handleUploadRequest(request, config),
      '/admin': () => handleAdminRequest(request, config),
      '/delete': () => handleDeleteRequest(request, config),
      '/batch-delete': () => handleBatchDeleteRequest(request, config),
      '/search': () => handleSearchRequest(request, config),
      '/upload-history': () => handleUploadHistoryRequest(request, config),
      '/bing': handleBingImagesRequest,
      '/config': () => handleConfigRequest(config)
    };

    const handler = routes[pathname];
    if (handler) {
      return await handler();
    }

    // 文件访问
    return await handleFileRequest(request, config);
  }
};

// ============ 路由处理器 ============

async function handleAuthRequest(request, config) {
  if (config.enableAuth && !authenticate(request, config)) {
    return Response.redirect(`${new URL(request.url).origin}/login`, 302);
  }
  return handleUploadRequest(request, config);
}

async function handleLoginRequest(request, config) {
  if (request.method === 'POST') {
    try {
      const { username, password } = await request.json();
      
      if (validateCredentials(username, password, config)) {
        const { token, expires } = createAuthToken(username, config);
        const cookie = `auth_token=${token}; Path=/; HttpOnly; Secure; Expires=${expires}`;
        
        return new Response("登录成功", {
          status: 200,
          headers: {
            "Set-Cookie": cookie,
            "Content-Type": "text/plain"
          }
        });
      }
      return new Response("认证失败", { status: 401 });
    } catch (error) {
      return new Response("请求格式错误", { status: 400 });
    }
  }
  
  return new Response(generateLoginPage(), {
    headers: { 'Content-Type': 'text/html;charset=UTF-8' }
  });
}

async function handleUploadRequest(request, config) {
  if (config.enableAuth && !authenticate(request, config)) {
    return Response.redirect(`${new URL(request.url).origin}/login`, 302);
  }
  
  if (request.method === 'GET') {
    return new Response(generateUploadPage(), {
      headers: { 'Content-Type': 'text/html;charset=UTF-8' }
    });
  }

  try {
    const contentType = request.headers.get('Content-Type') || '';
    
    if (!contentType.includes('multipart/form-data')) {
      return createErrorResponse('不支持的请求格式', 400);
    }

    const formData = await request.formData();
    const file = formData.get('file');
    
    if (!file) {
      return createErrorResponse('未找到文件', 400);
    }

    // 检查是否需要分块上传
    if (formData.has('chunkIndex')) {
      const result = await handleChunkedUpload(request, config);
      return createSuccessResponse(result);
    }

    // 检查文件大小
    if (file.size > config.maxSizeMB * 1024 * 1024) {
      const chunkSize = config.chunkSize;
      const totalChunks = Math.ceil(file.size / chunkSize);
      
      if (totalChunks > 1) {
        return createSuccessResponse({
          status: 3,
          msg: "文件过大，请使用分块上传",
          totalChunks,
          chunkSize
        });
      }
      return createErrorResponse(`文件超过${config.maxSizeMB}MB限制`, 400);
    }

    const result = await uploadToTelegram(file, config);
    return createSuccessResponse(result, "✔ 上传成功");

  } catch (error) {
    console.error('[Upload Error]', error);
    const status = error.message.includes('Telegram') ? 502 : 500;
    return createErrorResponse(error.message, status);
  }
}

async function handleAdminRequest(request, config) {
  if (config.enableAuth && !authenticate(request, config)) {
    return Response.redirect(`${new URL(request.url).origin}/login`, 302);
  }

  const files = await getFiles(config.database);
  const fileList = files.results || [];

  const fileCards = fileList.map((file, index) => {
    const info = formatFileInfo(file);
    const previewHtml = getPreviewHtml(file.url);
    
    return `
      <div class="file-card" data-url="${file.url}" data-index="${index}">
        <input type="checkbox" class="file-checkbox" data-url="${file.url}">
        <div class="file-preview" onclick="openPreview('${file.url}')">
          ${previewHtml}
        </div>
        <div class="file-info">
          <div class="file-name" title="${info.fileName}">${info.fileName}</div>
          <div class="file-meta">${info.fileSize} · ${info.createdAt}</div>
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

  // 模态框
  const previewModal = `
    <div id="previewModal" class="modal" onclick="closePreview()">
      <div class="modal-content" onclick="event.stopPropagation()">
        <span class="modal-close" onclick="closePreview()">&times;</span>
        <img id="previewImage" src="" alt="预览">
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
}

async function handleDeleteRequest(request, config) {
  if (config.enableAuth && !authenticate(request, config)) {
    return Response.redirect(`${new URL(request.url).origin}/login`, 302);
  }

  try {
    const { url } = await request.json();
    if (!url || typeof url !== 'string') {
      return createErrorResponse('无效的URL', 400);
    }

    const file = await getFileByUrl(config.database, url);
    if (!file) {
      return createErrorResponse('文件不存在', 404);
    }

    // 删除Telegram消息
    try {
      await fetch(
        `https://api.telegram.org/bot${config.tgBotToken}/deleteMessage?chat_id=${config.tgChatId}&message_id=${file.message_id}`
      );
    } catch (e) {
      console.error('Telegram删除失败:', e);
    }

    await deleteFile(config.database, url);
    
    return createSuccessResponse({}, '文件删除成功');

  } catch (error) {
    console.error('[Delete Error]', error);
    return createErrorResponse(error.message);
  }
}

async function handleBatchDeleteRequest(request, config) {
  if (config.enableAuth && !authenticate(request, config)) {
    return Response.redirect(`${new URL(request.url).origin}/login`, 302);
  }

  try {
    const { urls } = await request.json();
    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return createErrorResponse('无效的URL列表', 400);
    }

    // 批量删除Telegram消息
    for (const url of urls) {
      try {
        const file = await getFileByUrl(config.database, url);
        if (file) {
          await fetch(
            `https://api.telegram.org/bot${config.tgBotToken}/deleteMessage?chat_id=${config.tgChatId}&message_id=${file.message_id}`
          );
        }
      } catch (e) {
        console.error(`Telegram删除失败 ${url}:`, e);
      }
    }

    const result = await deleteFiles(config.database, urls);
    
    return createSuccessResponse(
      { deletedCount: result.deleted },
      `成功删除 ${result.deleted} 个文件`
    );

  } catch (error) {
    console.error('[Batch Delete Error]', error);
    return createErrorResponse(error.message);
  }
}

async function handleSearchRequest(request, config) {
  if (config.enableAuth && !authenticate(request, config)) {
    return Response.redirect(`${new URL(request.url).origin}/login`, 302);
  }

  try {
    const { query } = await request.json();
    const files = await searchFiles(config.database, query);
    
    return createSuccessResponse({ 
      files: files.results || [] 
    });

  } catch (error) {
    console.error('[Search Error]', error);
    return createErrorResponse(error.message);
  }
}

async function handleUploadHistoryRequest(request, config) {
  if (config.enableAuth && !authenticate(request, config)) {
    return Response.redirect(`${new URL(request.url).origin}/login`, 302);
  }

  try {
    const { page = 1, limit = 20 } = await request.json();
    const offset = (page - 1) * limit;
    
    const total = await getFileCount(config.database);
    const files = await getFiles(config.database, { limit, offset });

    return createSuccessResponse({
      files: files.results || [],
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    });

  } catch (error) {
    console.error('[History Error]', error);
    return createErrorResponse(error.message);
  }
}

async function handleConfigRequest(config) {
  const safeConfig = getSafeConfig(config);
  return createSuccessResponse(safeConfig);
}

async function handleBingImagesRequest() {
  const cacheKey = new Request('https://cn.bing.com/HPImageArchive.aspx?format=js&idx=0&n=5');
  const cached = await getFromCache(cacheKey.url);
  
  if (cached) {
    return cached;
  }

  try {
    const response = await fetch(cacheKey);
    if (!response.ok) {
      throw new Error(`Bing API error: ${response.status}`);
    }

    const data = await response.json();
    const images = data.images.map(image => ({
      url: `https://cn.bing.com${image.url}`
    }));

    const result = { status: true, message: "操作成功", data: images };
    const resp = new Response(JSON.stringify(result), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=21600',
        'Access-Control-Allow-Origin': '*'
      }
    });

    await saveToCache(cacheKey.url, resp, 21600);
    return resp;

  } catch (error) {
    console.error('[Bing Error]', error);
    return new Response('请求Bing API失败', { status: 500 });
  }
}
