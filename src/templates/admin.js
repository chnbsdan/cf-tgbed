/**
 * 管理页面模板
 */

import { generateHeadLinks, generateCopyright } from '../utils.js';

export function generateAdminPage(fileCards, previewModal, qrModal, batchToolbar) {
  return `<!DOCTYPE html>
  <html lang="zh-CN">
  <head>
  ${generateHeadLinks()}
  <title>文件管理</title>
    <style>
      /* 样式代码 - 与之前相同 */
      /* ... */
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <h2><i class="fas fa-folder-open"></i> 文件管理</h2>
        <a href="/upload" class="backup"><i class="fas fa-upload"></i> 上传</a>
        <input type="text" class="search" placeholder="搜索文件..." id="searchInput">
      </div>
      
      ${batchToolbar}
      
      <div class="grid" id="fileGrid">
        ${fileCards || '<div class="empty-state"><div class="icon"><i class="fas fa-inbox"></i></div><h3>暂无文件</h3><p>上传一些文件开始使用吧</p></div>'}
      </div>
      
      <div id="pagination"></div>
      
      ${previewModal}
      ${qrModal}
      
      <footer>
        ${generateCopyright()}
      </footer>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/qrcodejs/qrcode.min.js"></script>
    <script>
      // [JavaScript code from previous admin page - kept same for brevity]
      // ... 完整的管理页面JavaScript代码 ...
    </script>
  </body>
  </html>`;
}
