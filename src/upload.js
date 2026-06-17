/**
 * 上传处理模块
 */

import { saveFile } from './database.js';
import { getContentType, generateFileUrl } from './utils.js';

const TELEGRAM_API = 'https://api.telegram.org/bot';

export async function uploadToTelegram(file, config) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const mimeType = getContentType(ext);
  const [mainType] = mimeType.split('/');
  
  const typeMap = {
    image: { method: 'sendPhoto', field: 'photo' },
    video: { method: 'sendVideo', field: 'video' },
    audio: { method: 'sendAudio', field: 'audio' }
  };
  
  let { method = 'sendDocument', field = 'document' } = typeMap[mainType] || {};

  if (['application', 'text'].includes(mainType)) {
    method = 'sendDocument';
    field = 'document';
  }

  const formData = new FormData();
  formData.append('chat_id', config.tgChatId);
  formData.append(field, file, file.name);
  
  const response = await fetch(
    `${TELEGRAM_API}${config.tgBotToken}/${method}`,
    { method: 'POST', body: formData }
  );
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Telegram API错误: ${error}`);
  }

  const data = await response.json();
  if (!data.ok) {
    throw new Error(`Telegram错误: ${data.description}`);
  }

  const result = data.result;
  const messageId = result?.message_id;
  const fileId = result?.document?.file_id ||
                 result?.video?.file_id ||
                 result?.audio?.file_id ||
                 (result?.photo && result.photo[result.photo.length-1]?.file_id);
                 
  if (!fileId) throw new Error('未获取到文件ID');
  if (!messageId) throw new Error('未获取到消息ID');

  const url = generateFileUrl(config.domain, ext);
  const timestamp = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();

  // 保存到数据库
  await saveFile(config.database, {
    url,
    fileId,
    messageId,
    timestamp,
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type || mimeType
  });

  return { url, fileId, messageId };
}

export async function handleChunkedUpload(request, config) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const chunkIndex = parseInt(formData.get('chunkIndex'));
    const totalChunks = parseInt(formData.get('totalChunks'));
    const uploadId = formData.get('uploadId');
    
    if (!file) throw new Error('未找到文件');
    if (file.size > config.maxSizeMB * 1024 * 1024) {
      throw new Error(`文件超过${config.maxSizeMB}MB限制`);
    }
    
    const cacheKey = `upload_${uploadId}`;
    const cache = caches.default;
    
    let chunks = [];
    const cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) {
      const data = await cachedResponse.json();
      chunks = data.chunks || [];
    }
    
    const buffer = await file.arrayBuffer();
    const base64Chunk = btoa(String.fromCharCode(...new Uint8Array(buffer)));
    chunks[chunkIndex] = base64Chunk;
    
    const chunkData = {
      chunks,
      totalChunks,
      fileName: formData.get('fileName') || file.name,
      fileType: formData.get('fileType') || file.type,
      uploadId
    };
    
    const response = new Response(JSON.stringify(chunkData), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600'
      }
    });
    await cache.put(cacheKey, response.clone());
    
    const allChunksUploaded = chunks.every(chunk => chunk !== undefined);
    
    if (allChunksUploaded && chunks.length === totalChunks) {
      const fullFile = await mergeChunks(chunks, chunkData.fileName, chunkData.fileType);
      const result = await uploadToTelegram(fullFile, config);
      
      await cache.delete(cacheKey);
      
      return {
        status: 1,
        msg: "✔ 上传成功",
        url: result.url
      };
    }
    
    return {
      status: 2,
      msg: `分块 ${chunkIndex + 1}/${totalChunks} 上传成功`,
      progress: (chunks.filter(c => c !== undefined).length / totalChunks) * 100
    };
    
  } catch (error) {
    console.error('[Chunked Upload Error]', error);
    throw error;
  }
}

async function mergeChunks(chunks, fileName, fileType) {
  const binaryStrings = chunks.map(chunk => atob(chunk));
  const totalLength = binaryStrings.reduce((sum, str) => sum + str.length, 0);
  const arrayBuffer = new ArrayBuffer(totalLength);
  const uint8Array = new Uint8Array(arrayBuffer);
  
  let offset = 0;
  for (const binaryString of binaryStrings) {
    const chunkArray = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      chunkArray[i] = binaryString.charCodeAt(i);
    }
    uint8Array.set(chunkArray, offset);
    offset += chunkArray.length;
  }
  
  return new File([arrayBuffer], fileName, { type: fileType });
}
