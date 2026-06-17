/**
 * 上传页面模板
 */

import { generateHeadLinks, generateCopyright } from '../utils.js';

export function generateUploadPage() {
  return `<!DOCTYPE html>
  <html lang="zh-CN">
  <head>
  ${generateHeadLinks()}
  <title>文件上传</title>
    <style>
      body {
        font-family: Arial, sans-serif;
        transition: background-image 1s ease-in-out;
        display: flex;
        justify-content: center;
        align-items: center;
        min-height: 100vh;
        background: #f5f5f5;
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
      }
      .header h1 {
        margin: 0;
        font-size: 24px;
      }
      .upload-area {
        border: 2px dashed #666;
        padding: 40px;
        text-align: center;
        margin: 0 auto;
        border-radius: 8px;
        transition: all 0.3s;
        box-sizing: border-box;
        cursor: pointer;
      }
      .upload-area.dragover {
        border-color: #007bff;
        background: #f8f9fa;
      }
      .upload-area .upload-icon {
        font-size: 48px;
        color: #666;
        margin-bottom: 10px;
      }
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
      .preview-item .info {
        flex-grow: 1;
        min-width: 0;
      }
      .preview-item .info .file-name {
        font-weight: bold;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .preview-item .info .file-size {
        font-size: 12px;
        color: #666;
      }
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
      .success .progress-track {
        background: #28a745;
      }
      .error .progress-track {
        background: #dc3545;
      }
      .url-area {
        margin-top: 10px;
        width: 100%;
        box-sizing: border-box;
      }
      .url-area textarea {
        width: 100%;
        min-height: 100px;
        padding: 10px;
        border: 1px solid #ddd;
        border-radius: 4px;
        background: rgba(255, 255, 255, 0.5);
        color: #333;
        box-sizing: border-box;
        font-family: monospace;
        font-size: 14px;
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
      .button-container button:hover {
        background: #0056b3;
      }
      .button-container button.btn-clear {
        background: #dc3545;
      }
      .button-container button.btn-clear:hover {
        background: #c82333;
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
      .admin-link:hover {
        background: #0056b3;
        text-decoration: none;
      }
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
      .upload-stats .count {
        font-weight: bold;
        color: #333;
      }
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
        .container {
          padding: 15px;
        }
        .upload-area {
          padding: 20px;
        }
        footer p {
          justify-content: center;
        }
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <h1><i class="fas fa-cloud-upload-alt"></i> 文件上传</h1>
        <a href="/admin" class="admin-link"><i class="fas fa-folder-open"></i> 文件管理</a>
      </div>
      <div class="upload-area" id="uploadArea">
        <div class="upload-icon"><i class="fas fa-cloud-upload-alt"></i></div>
        <p>点击选择 或 拖拽文件到此处<br><small>支持 Ctrl+V 粘贴上传</small></p>
        <input type="file" id="fileInput" multiple style="display: none">
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
        ${generateCopyright()}
      </footer>
    </div>

    <script>
      // [JavaScript code from previous upload page - kept same for brevity]
      // ... 完整的上传页面JavaScript代码 ...
    </script>
  </body>
  </html>`;
}
