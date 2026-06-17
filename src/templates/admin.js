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
      * {
        box-sizing: border-box;
      }
      body {
        font-family: Arial, sans-serif;
        margin: 0;
        padding: 20px;
        background: #f5f5f5;
        min-height: 100vh;
      }
      .container {
        max-width: 1400px;
        margin: 0 auto;
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
      
      .header h2 {
        margin: 0;
        flex: 1;
        min-width: 0;
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
      
      .header .backup:hover {
        background: #0056b3;
      }
      
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
        .header {
          flex-wrap: nowrap;
        }
        .header .search {
          flex: unset;
          width: 300px;
        }
      }

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
      
      .batch-toolbar #selectedCount {
        font-weight: bold;
        color: #333;
      }
      
      .batch-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      
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
      
      .btn-batch-copy {
        background: #007bff;
      }
      .btn-batch-copy:hover {
        background: #0056b3;
      }
      
      .btn-batch-delete {
        background: #dc3545;
      }
      .btn-batch-delete:hover {
        background: #c82333;
      }
      
      .btn-select-all {
        background: #28a745;
      }
      .btn-select-all:hover {
        background: #218838;
      }
      
      .btn-clear-select {
        background: #6c757d;
      }
      .btn-clear-select:hover {
        background: #5a6268;
      }

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
      
      .file-card.selected {
        border: 2px solid #007bff;
      }
      
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
      
      .file-preview img:hover {
        transform: scale(1.05);
      }
      
      .file-preview video {
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
      }
      
      .file-preview .file-icon {
        font-size: 48px;
        color: #666;
      }
      
      .file-info {
        padding: 10px 12px;
        font-size: 13px;
      }
      
      .file-info .file-name {
        font-weight: bold;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        margin-bottom: 4px;
      }
      
      .file-info .file-meta {
        color: #666;
        font-size: 12px;
      }
      
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
      
      .file-actions .btn:hover {
        transform: scale(1.05);
      }
      
      .file-actions .btn-delete {
        background: #dc3545;
        color: white;
      }
      .file-actions .btn-delete:hover {
        background: #c82333;
      }
      
      .file-actions .btn-copy {
        background: #007bff;
        color: white;
      }
      .file-actions .btn-copy:hover {
        background: #0056b3;
      }
      
      .file-actions .btn-share {
        background: #17a2b8;
        color: white;
      }
      .file-actions .btn-share:hover {
        background: #138496;
      }
      
      .file-actions .btn-open {
        background: #28a745;
        color: white;
        text-decoration: none;
      }
      .file-actions .btn-open:hover {
        background: #218838;
      }

      /* 模态框 */
      .modal {
        display: none;
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.8);
        justify-content: center;
        align-items: center;
        z-index: 1000;
        animation: fadeIn 0.3s ease;
      }
      
      .modal.active {
        display: flex;
      }
      
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      
      .modal-content {
        background: white;
        padding: 20px;
        border-radius: 10px;
        max-width: 90%;
        max-height: 90%;
        position: relative;
        box-shadow: 0 4px 30px rgba(0,0,0,0.3);
        animation: slideUp 0.3s ease;
      }
      
      @keyframes slideUp {
        from { transform: translateY(30px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
      
      .modal-close {
        position: absolute;
        top: 10px;
        right: 15px;
        font-size: 28px;
        cursor: pointer;
        color: #333;
        transition: color 0.2s;
        line-height: 1;
      }
      
      .modal-close:hover {
        color: #dc3545;
      }
      
      #previewImage {
        max-width: 100%;
        max-height: 80vh;
        object-fit: contain;
        display: block;
      }
      
      .qr-content {
        text-align: center;
        min-width: 250px;
      }
      
      #qrcode {
        margin: 15px auto;
        display: flex;
        justify-content: center;
      }
      
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
      
      .qr-copy {
        background: #007bff;
      }
      .qr-copy:hover {
        background: #0056b3;
      }
      .qr-close {
        background: #6c757d;
      }
      .qr-close:hover {
        background: #5a6268;
      }

      /* 分页 */
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

      #pagination .btn-page:hover {
        background-color: #007bff;
        color: #fff;
        border-color: #007bff;
      }
    
      #pagination .btn-page.active {
        background-color: #007bff;
        color: #fff;
        border-color: #007bff;
        cursor: default;
      }
    
      #pagination .btn-page:disabled {
        background-color: #f0f0f0;
        color: #aaa;
        cursor: not-allowed;
        border-color: #ccc;
      }
    
      #pagination span.page-info {
        padding: 6px 10px;
        font-size: 14px;
        color: #333;
      }

      /* 空状态 */
      .empty-state {
        text-align: center;
        padding: 60px 20px;
        color: #666;
      }
      
      .empty-state .icon {
        font-size: 64px;
        margin-bottom: 20px;
        color: #ccc;
      }
      
      .empty-state h3 {
        margin: 0 0 10px 0;
        color: #333;
      }

      /* 版权页脚 */
      footer {
        font-size: 0.85rem;
        width: 100%;
        text-align: center;
        margin-top: 30px;
      }
      footer p {
        color: #7F7F7E;
        display: flex;
        justify-content: center;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
        margin: 0;
      }
      footer a {
        color: #7F7F7E;
        text-decoration: none;
        transition: color 0.3s ease;
      }
      footer a:hover {
        color: #007BFF !important;
      }
      
      /* 响应式 */
      @media (max-width: 768px) {
        .grid {
          grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
          gap: 12px;
        }
        .file-preview {
          height: 120px;
        }
        .batch-toolbar {
          flex-direction: column;
          align-items: stretch;
        }
        .batch-actions {
          justify-content: center;
        }
        .batch-actions .btn {
          font-size: 12px;
          padding: 4px 10px;
        }
      }
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

    <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
    <script>
      // -------------------- 变量 --------------------
      const itemsPerPage = 20;
      let currentPage = 1;
      let selectedUrls = new Set();
      let currentShareUrl = '';

      const fileGrid = document.getElementById('fileGrid');
      const searchInput = document.getElementById('searchInput');
      const batchToolbar = document.getElementById('batchToolbar');
      const selectedCountEl = document.getElementById('selectedCount');
      
      let fileCards = Array.from(document.querySelectorAll('.file-card'));

      // 创建分页容器
      const paginationContainer = document.createElement('div');
      paginationContainer.id = 'pagination';
      fileGrid.parentNode.insertBefore(paginationContainer, fileGrid.nextSibling);

      // -------------------- 背景图 --------------------
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
      setBingBackground();
      setInterval(setBingBackground, 3600000);

      // -------------------- 复选框功能 --------------------
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

      // -------------------- 批量复制 --------------------
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

      // -------------------- 批量删除 --------------------
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
            urls.forEach(url => {
              const card = document.querySelector(\`[data-url="\${url}"]\`);
              if (card) card.remove();
            });
            selectedUrls.clear();
            updateSelection();
            fileCards = Array.from(document.querySelectorAll('.file-card'));
            renderPage(currentPage);
            alert(data.message);
          } else {
            throw new Error(data.error || '批量删除失败');
          }
        } catch (err) {
          alert('批量删除失败: ' + err.message);
        }
      }

      // -------------------- 单个复制 --------------------
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

      // -------------------- 图片预览 --------------------
      function openPreview(url) {
        const modal = document.getElementById('previewModal');
        const img = document.getElementById('previewImage');
        img.src = url;
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
      }

      function closePreview() {
        const modal = document.getElementById('previewModal');
        modal.classList.remove('active');
        document.body.style.overflow = '';
        setTimeout(() => {
          document.getElementById('previewImage').src = '';
        }, 300);
      }

      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          closePreview();
          closeQRModal();
        }
      });

      // -------------------- 二维码 --------------------
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
        navigator.clipboard.writeText(currentShareUrl).then(() => {
          const copyBtn = document.querySelector('.qr-copy');
          copyBtn.textContent = '✔ 已复制';
          copyBtn.disabled = true;
          setTimeout(() => {
            copyBtn.textContent = '复制链接';
            copyBtn.disabled = false;
          }, 3000);
        }).catch(() => alert('复制失败，请手动复制'));
      }

      function closeQRModal() {
        const modal = document.getElementById('qrModal');
        modal.classList.remove('active');
        document.body.style.overflow = '';
      }

      document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
          if (e.target === modal) {
            modal.classList.remove('active');
            document.body.style.overflow = '';
          }
        });
      });

      // -------------------- 删除功能 --------------------
      async function deleteFile(url) {
        if (!confirm('确定要删除这个文件吗？此操作不可恢复！')) return;
        try {
          const response = await fetch('/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
          });
          
          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || '删除失败');
          }
          
          const card = document.querySelector(\`[data-url="\${url}"]\`);
          if (card) card.remove();
          selectedUrls.delete(url);
          updateSelection();
          fileCards = Array.from(document.querySelectorAll('.file-card'));
          renderPage(currentPage);
          alert('文件删除成功');
        } catch (err) {
          alert('文件删除失败: ' + err.message);
        }
      }

      // -------------------- 分页逻辑 --------------------
      function getFilteredCards() {
        const term = searchInput.value.toLowerCase();
        return fileCards.filter(card => {
          const name = card.querySelector('.file-name')?.textContent?.toLowerCase() || '';
          return name.includes(term);
        });
      }

      function renderPage(page) {
        const filteredCards = getFilteredCards();
        const totalPages = Math.ceil(filteredCards.length / itemsPerPage) || 1;
        
        if (page > totalPages) currentPage = totalPages;
        if (page < 1) currentPage = 1;
    
        const start = (currentPage - 1) * itemsPerPage;
        const end = start + itemsPerPage;
    
        fileCards.forEach(c => c.style.display = 'none');
        filteredCards.slice(start, end).forEach(c => c.style.display = '');
    
        renderPagination(totalPages);
      }

      function renderPagination(totalPages) {
        paginationContainer.innerHTML = '';
        
        if (totalPages <= 1) return;

        const prevBtn = document.createElement('button');
        prevBtn.textContent = '‹ 上一页';
        prevBtn.className = 'btn-page';
        prevBtn.disabled = currentPage === 1;
        prevBtn.onclick = () => { currentPage--; renderPage(currentPage); };
        paginationContainer.appendChild(prevBtn);

        const maxVisible = 7;
        let startPage = Math.max(1, currentPage - 3);
        let endPage = Math.min(totalPages, startPage + maxVisible - 1);
        
        if (endPage - startPage < maxVisible - 1) {
          startPage = Math.max(1, endPage - maxVisible + 1);
        }

        if (startPage > 1) {
          const firstBtn = document.createElement('button');
          firstBtn.textContent = '1';
          firstBtn.className = 'btn-page';
          firstBtn.onclick = () => { currentPage = 1; renderPage(currentPage); };
          paginationContainer.appendChild(firstBtn);
          if (startPage > 2) {
            const dots = document.createElement('span');
            dots.textContent = '…';
            dots.className = 'page-info';
            paginationContainer.appendChild(dots);
          }
        }

        for (let i = startPage; i <= endPage; i++) {
          const btn = document.createElement('button');
          btn.textContent = i;
          btn.className = 'btn-page' + (i === currentPage ? ' active' : '');
          btn.onclick = () => { currentPage = i; renderPage(currentPage); };
          paginationContainer.appendChild(btn);
        }

        if (endPage < totalPages) {
          if (endPage < totalPages - 1) {
            const dots = document.createElement('span');
            dots.textContent = '…';
            dots.className = 'page-info';
            paginationContainer.appendChild(dots);
          }
          const lastBtn = document.createElement('button');
          lastBtn.textContent = totalPages;
          lastBtn.className = 'btn-page';
          lastBtn.onclick = () => { currentPage = totalPages; renderPage(currentPage); };
          paginationContainer.appendChild(lastBtn);
        }

        const nextBtn = document.createElement('button');
        nextBtn.textContent = '下一页 ›';
        nextBtn.className = 'btn-page';
        nextBtn.disabled = currentPage === totalPages;
        nextBtn.onclick = () => { currentPage++; renderPage(currentPage); };
        paginationContainer.appendChild(nextBtn);
      }

      searchInput.addEventListener('input', () => {
        currentPage = 1;
        renderPage(currentPage);
      });

      // 暴露全局函数供 HTML onclick 调用
      window.toggleSelectAll = toggleSelectAll;
      window.clearSelection = clearSelection;
      window.batchCopy = batchCopy;
      window.batchDelete = batchDelete;
      window.copySingleUrl = copySingleUrl;
      window.openPreview = openPreview;
      window.closePreview = closePreview;
      window.showQRCode = showQRCode;
      window.handleCopyUrl = handleCopyUrl;
      window.closeQRModal = closeQRModal;
      window.deleteFile = deleteFile;

      // -------------------- 初始渲染 --------------------
      renderPage(currentPage);
    </script>
  </body>
  </html>`;
}
