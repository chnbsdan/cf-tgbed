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
      * { box-sizing: border-box; }
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
      .header h1 { margin: 0; font-size: 24px; }
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
      // ============================================================
      // 配置
      // ============================================================
      let config = { maxSizeMB: 20, chunkSize: 5 * 1024 * 1024 };
      let uploadedUrls = [];
      let uploadCount = 0;
      let totalBytes = 0;

      // ============================================================
      // DOM 元素
      // ============================================================
      const uploadArea = document.getElementById('uploadArea');
      const fileInput = document.getElementById('fileInput');
      const previewArea = document.getElementById('previewArea');
      const urlArea = document.getElementById('urlArea');
      const uploadCountEl = document.getElementById('uploadCount');
      const totalSizeEl = document.getElementById('totalSize');

      // ============================================================
      // 加载配置
      // ============================================================
      async function loadConfig() {
        try {
          const response = await fetch('/config');
          if (response.ok) {
            config = await response.json();
            config.chunkSize = config.chunkSize || 5 * 1024 * 1024;
          }
        } catch (e) {
          console.error('加载配置失败:', e);
        }
      }

      // ============================================================
      // 背景图
      // ============================================================
      async function setBingBackground() {
        try {
          const response = await fetch('/bing', { cache: 'no-store' });
          const data = await response.json();
          if (data.status && data.data && data.data.length > 0) {
            const randomIndex = Math.floor(Math.random() * data.data.length);
            document.body.style.backgroundImage = \`url(\${data.data[randomIndex].url})\`;
          }
        } catch (error) {
          console.error('获取背景图失败:', error);
        }
      }

      // ============================================================
      // 工具函数
      // ============================================================
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

      // ============================================================
      // 创建预览元素
      // ============================================================
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

      // ============================================================
      // 上传文件（普通）
      // ============================================================
      async function uploadFile(file) {
        await loadConfig();
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
              progressText.textContent = '✓ 上传完成';
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
        formData.append('file', file);
        xhr.open('POST', '/upload');
        xhr.send(formData);
      }

      // ============================================================
      // 分块上传
      // ============================================================
      async function uploadFileChunked(file) {
        await loadConfig();
        const chunkSize = config.chunkSize;
        const totalChunks = Math.ceil(file.size / chunkSize);
        const uploadId = \`\${Date.now()}_\${Math.random().toString(36).substr(2, 9)}\`;
        
        const preview = createPreview(file);
        previewArea.appendChild(preview);
        const progressTrack = preview.querySelector('.progress-track');
        const progressText = preview.querySelector('.progress-text');

        try {
          for (let i = 0; i < totalChunks; i++) {
            const start = i * chunkSize;
            const end = Math.min(start + chunkSize, file.size);
            const chunk = file.slice(start, end);
            
            const formData = new FormData();
            formData.append('file', chunk);
            formData.append('chunkIndex', i);
            formData.append('totalChunks', totalChunks);
            formData.append('uploadId', uploadId);
            formData.append('fileName', file.name);
            formData.append('fileType', file.type);

            const response = await fetch('/upload', {
              method: 'POST',
              body: formData
            });

            const data = await response.json();
            
            if (data.status === 0) {
              throw new Error(data.error || '上传失败');
            }

            const progress = ((i + 1) / totalChunks) * 100;
            progressTrack.style.width = \`\${progress}%\`;
            progressText.textContent = \`\${Math.round(progress)}% (\${i + 1}/\${totalChunks})\`;

            if (data.status === 1) {
              progressText.textContent = '✓ 上传完成';
              preview.classList.add('success');
              uploadedUrls.push(data.url);
              updateUrlArea();
              updateStats(file);
              break;
            }
          }
        } catch (error) {
          progressText.textContent = \`✗ \${error.message}\`;
          preview.classList.add('error');
        }
      }

      // ============================================================
      // 处理文件选择/拖拽
      // ============================================================
      async function handleFiles(e) {
        await loadConfig();
        const files = Array.from(e.target.files);
        for (let file of files) {
          if (file.size > config.maxSizeMB * 1024 * 1024) {
            if (confirm(\`文件 \${file.name} 超过 \${config.maxSizeMB}MB 限制，是否使用分块上传？\`)) {
              await uploadFileChunked(file);
            }
          } else {
            await uploadFile(file);
          }
        }
        fileInput.value = '';
      }

      function handleDrop(e) {
        const dt = e.dataTransfer;
        const files = dt.files;
        handleFiles({ target: { files } });
      }

      // ============================================================
      // 复制功能
      // ============================================================
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

      // ============================================================
      // 清空列表
      // ============================================================
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

      // ============================================================
      // 事件绑定
      // ============================================================
      // 拖拽事件
      ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        uploadArea.addEventListener(eventName, (e) => {
          e.preventDefault();
          e.stopPropagation();
        });
        document.body.addEventListener(eventName, (e) => {
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

      // 粘贴上传
      document.addEventListener('paste', async (e) => {
        const items = (e.clipboardData || e.originalEvent.clipboardData).items;
        for (let item of items) {
          if (item.kind === 'file') {
            const file = item.getAsFile();
            await uploadFile(file);
          }
        }
      });

      // ============================================================
      // 暴露全局函数给 HTML onclick 调用
      // ============================================================
      window.copyUrls = copyUrls;
      window.clearAll = clearAll;

      // ============================================================
      // 初始化
      // ============================================================
      loadConfig();
      setBingBackground();
      setInterval(setBingBackground, 3600000);
    </script>
  </body>
  </html>`;
}
