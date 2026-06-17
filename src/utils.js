/**
 * 工具函数模块
 */

export function formatSize(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

export function getContentType(ext) {
  const types = {
    // 图片
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg', 
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    icon: 'image/x-icon',
    bmp: 'image/bmp',
    tiff: 'image/tiff',
    // 视频
    mp4: 'video/mp4',
    webm: 'video/webm',
    avi: 'video/x-msvideo',
    mov: 'video/quicktime',
    mkv: 'video/x-matroska',
    // 音频
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    flac: 'audio/flac',
    aac: 'audio/aac',
    // 文档
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

export function generateFileUrl(domain, ext) {
  const time = Date.now();
  return `https://${domain}/${time}.${ext}`;
}

export function generateUploadId() {
  return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export function getClientIP(request) {
  return request.headers.get('CF-Connecting-IP') || 
         request.headers.get('X-Forwarded-For')?.split(',')[0] || 
         'unknown';
}

export function createErrorResponse(message, status = 500) {
  return new Response(
    JSON.stringify({ status: 0, msg: '✘ 操作失败', error: message }),
    { 
      status, 
      headers: { 'Content-Type': 'application/json' }
    }
  );
}

export function createSuccessResponse(data, message = '操作成功') {
  return new Response(
    JSON.stringify({ status: 1, msg: message, ...data }),
    { 
      status: 200, 
      headers: { 'Content-Type': 'application/json' }
    }
  );
}

export function generateHeadLinks() {
  return `
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="Telegram文件存储与分享平台">
    <link rel="shortcut icon" href="https://img.hangdn.com/hexo/蓝色地球圆.ico" type="image/x-icon">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  `;
}

export function generateCopyright() {
  return `
    <p>
      <span><i class="fas fa-copyright"></i> 2025 Copyright by Chnbsdan</span><span>|</span>
      <a href="https://github.com/chnbsdan/CF-tgfile" target="_blank">
      <i class="fab fa-github"></i> GitHub Repo</a><span>|</span>
      <a href="https://1356666.xyz/" target="_blank">
      <i class="fas fa-blog"></i> BSDAN | 智能家居产品制造商</a>
    </p>
  `;
}
