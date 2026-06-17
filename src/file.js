/**
 * 文件处理模块
 */

import { getFileByUrl } from './database.js';
import { getContentType, formatSize } from './utils.js';
import { getFromCache, saveToCache, getCacheMaxAge, createCacheHeaders } from './cache.js';

const TELEGRAM_API = 'https://api.telegram.org/bot';

export async function handleFileRequest(request, config) {
  const url = request.url;
  console.log(`[File Request] Processing: ${url}`);

  try {
    // 1. 检查缓存
    console.log(`[File Request] Step 1: Checking cache...`);
    const cachedResponse = await getFromCache(url);
    if (cachedResponse) {
      console.log(`[Cache Hit] ${url}`);
      return cachedResponse;
    }
    console.log(`[File Request] Step 1: Cache miss`);

    // 2. 从数据库查询
    console.log(`[File Request] Step 2: Querying database...`);
    const file = await getFileByUrl(config.database, url);
    if (!file) {
      console.log(`[404] File not found: ${url}`);
      return new Response('文件不存在', { 
        status: 404,
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' }
      });
    }
    console.log(`[File Request] Step 2: Found file in DB:`, { 
      fileId: file.fileId, 
      fileName: file.file_name,
      mimeType: file.mime_type
    });

    // 3. 验证配置
    console.log(`[File Request] Step 3: Validating configuration...`);
    if (!config.tgBotToken) {
      console.error(`[Config Error] TG_BOT_TOKEN is missing or empty`);
      return new Response('服务器配置错误: 缺少TG_BOT_TOKEN', { 
        status: 500,
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' }
      });
    }
    console.log(`[File Request] Step 3: TG_BOT_TOKEN configured (length: ${config.tgBotToken.length})`);

    // 4. 获取Telegram文件路径
    console.log(`[File Request] Step 4: Fetching file path from Telegram...`);
    const getFileUrl = `${TELEGRAM_API}${config.tgBotToken}/getFile?file_id=${file.fileId}`;
    console.log(`[File Request] Step 4: Requesting: ${getFileUrl.replace(config.tgBotToken, '***')}`);
    
    const tgResponse = await fetch(getFileUrl);

    if (!tgResponse.ok) {
      const errorText = await tgResponse.text();
      console.error(`[Telegram API Error] Status: ${tgResponse.status}, Response: ${errorText}`);
      return new Response(`获取文件失败: Telegram API 返回 ${tgResponse.status}`, { 
        status: 500,
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' }
      });
    }

    const tgData = await tgResponse.json();
    console.log(`[File Request] Step 4: Telegram response ok: ${tgData.ok}`);
    
    const filePath = tgData.result?.file_path;
    if (!filePath) {
      console.error(`[Invalid Path] No file_path in response for ${file.fileId}`);
      console.error(`[Invalid Path] Full response:`, JSON.stringify(tgData));
      return new Response('文件路径无效', { 
        status: 404,
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' }
      });
    }
    console.log(`[File Request] Step 4: Got file path: ${filePath}`);

    // 5. 下载文件
    console.log(`[File Request] Step 5: Downloading file from Telegram...`);
    const fileUrl = `${TELEGRAM_API}file/bot${config.tgBotToken}/${filePath}`;
    const fileResponse = await fetch(fileUrl);

    if (!fileResponse.ok) {
      console.error(`[Download Error] Status: ${fileResponse.status}, URL: ${fileUrl.replace(config.tgBotToken, '***')}`);
      return new Response(`下载文件失败: Telegram 返回 ${fileResponse.status}`, { 
        status: 500,
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' }
      });
    }
    console.log(`[File Request] Step 5: Download successful`);

    // 6. 构建响应并缓存
    console.log(`[File Request] Step 6: Building response...`);
    const contentType = file.mime_type || getContentType(url.split('.').pop().toLowerCase());
    const maxAge = getCacheMaxAge(url);
    const headers = {
      'Content-Type': contentType,
      ...createCacheHeaders(maxAge),
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(file.file_name || '')}`
    };

    const response = new Response(fileResponse.body, { headers });
    await saveToCache(url, response, maxAge);
    
    console.log(`[File Request] Step 6: Response cached and returned successfully`);
    return response;

  } catch (error) {
    console.error(`[File Request Error] ${error.message}`);
    console.error(`[File Request Error] Stack: ${error.stack}`);
    return new Response(`服务器内部错误: ${error.message}`, { 
      status: 500,
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' }
    });
  }
}

export function getPreviewHtml(url) {
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

export function formatFileInfo(file) {
  return {
    url: file.url,
    fileName: file.file_name,
    fileSize: formatSize(file.file_size || 0),
    createdAt: new Date(file.created_at).toISOString().replace('T', ' ').split('.')[0],
    mimeType: file.mime_type
  };
}
