/**
 * 文件处理模块
 */

import { getFileByUrl } from './database.js';
import { getContentType, formatSize } from './utils.js';
import { getFromCache, saveToCache, getCacheMaxAge, createCacheHeaders } from './cache.js';

const TELEGRAM_API = 'https://api.telegram.org/bot';

export async function handleFileRequest(request, config) {
  const url = request.url;

  try {
    // 从缓存获取
    const cachedResponse = await getFromCache(url);
    if (cachedResponse) {
      return cachedResponse;
    }

    // 从数据库查询
    const file = await getFileByUrl(config.database, url);
    if (!file) {
      return new Response('文件不存在', { 
        status: 404,
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' }
      });
    }

    // 获取Telegram文件路径
    const tgResponse = await fetch(
      `${TELEGRAM_API}${config.tgBotToken}/getFile?file_id=${file.fileId}`
    );

    if (!tgResponse.ok) {
      const errorText = await tgResponse.text();
      return new Response(`获取文件失败: ${errorText}`, { 
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

    // 下载文件
    const fileUrl = `${TELEGRAM_API}file/bot${config.tgBotToken}/${filePath}`;
    const fileResponse = await fetch(fileUrl);

    if (!fileResponse.ok) {
      return new Response('下载文件失败', { 
        status: 500,
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' }
      });
    }

    const contentType = file.mime_type || getContentType(url.split('.').pop().toLowerCase());
    const maxAge = getCacheMaxAge(url);
    const headers = {
      'Content-Type': contentType,
      ...createCacheHeaders(maxAge),
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(file.file_name || '')}`
    };

    const response = new Response(fileResponse.body, { headers });
    await saveToCache(url, response, maxAge);
    
    return response;

  } catch (error) {
    return new Response('服务器内部错误', { 
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
