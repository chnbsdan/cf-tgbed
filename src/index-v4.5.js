// ============================================================
// CF-TGBed - Cloudflare Workers 图床服务
// 支持: Telegram / R2 / GitHub 三种存储方式
// 功能: 上传、管理、搜索、批量操作、WebP转换、二维码分享、退出登录
// 新增: 图片预览支持鼠标滚轮缩放 + 拖拽平移、多视图切换（网格/列表/瀑布流）
// 新增: 多用户系统（注册、登录、独立空间）
// Telegram Bot API 官方文件上传限制为 50MB
// 超过 50MB 的文件无法通过 Telegram 上传，请使用 R2 或 GitHub 存储
// 可通过环境变量 MAX_SIZE_MB 调整，建议不超过 50
// 大文件（>20MB）使用流式传输，支持 Range 请求，解决视频播放问题
// 作者: Chnbsdan
// 版本: 4.5
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
        storage_type TEXT DEFAULT 'telegram',
        user_id TEXT DEFAULT 'default'
      )
    `).run();
    
    await config.database.prepare(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        email TEXT,
        created_at INTEGER NOT NULL,
        is_admin INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1
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
      '/register': () => handleRegisterRequest(request, config),
      '/logout': () => handleLogoutRequest(request, config),
      '/upload': () => handleUploadRequest(request, config),
      '/admin': () => handleAdminRequest(request, config),
      '/delete': () => handleDeleteRequest(request, config),
      '/batch-delete': () => handleBatchDeleteRequest(request, config),
      '/search': () => handleSearchRequest(request, config),
      '/bing': handleBingImagesRequest,
      '/history': () => handleHistoryRequest(request, config),
      '/favicon.ico': () => handleFaviconRequest(request, config),
      '/admin/users/toggle-admin': () => handleToggleAdmin(request, config),
      '/admin/users/toggle-active': () => handleToggleActive(request, config),
      '/api/folders': () => handleFoldersRequest(request, config),
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
// 3. 身份认证（Cookie 会话）- 支持多用户
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
      return tokenData.username;
    } catch (error) {
      return false;
    }
  }
  return false;
}

// ============================================================
// 4. 密码加密工具
// ============================================================
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + 'cf-tgbed-salt');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function verifyPassword(password, hashed) {
  const newHash = await hashPassword(password);
  return newHash === hashed;
}

// ============================================================
// 5. 获取当前登录用户
// ============================================================
async function getCurrentUser(request, config) {
  const username = authenticate(request, config);
  if (!username) return null;
  
  try {
    const user = await config.database.prepare(
      'SELECT id, username, is_admin FROM users WHERE username = ? AND is_active = 1'
    ).bind(username).first();
    return user;
  } catch (error) {
    return null;
  }
}

// ============================================================
// 6. 生成认证 Token
// ============================================================
function generateAuthToken(username, cookieDays) {
  const expirationDate = new Date();
  expirationDate.setDate(expirationDate.getDate() + cookieDays);
  const tokenData = JSON.stringify({
    username: username,
    expiration: expirationDate.getTime()
  });
  return btoa(tokenData);
}

// ============================================================
// 7. 认证请求处理
// ============================================================
async function handleAuthRequest(request, config) {
  if (config.enableAuth) {
    const username = authenticate(request, config);
    if (!username) {
      return handleLoginRequest(request, config);
    }
    return handleUploadRequest(request, config);
  }
  return handleUploadRequest(request, config);
}

// ============================================================
// 8. 登录处理（支持多用户）
// ============================================================
async function handleLoginRequest(request, config) {
  if (request.method === 'POST') {
    try {
      const { username, password } = await request.json();
      
      // 先从 users 表查找
      const user = await config.database.prepare(
        'SELECT id, username, password, is_active FROM users WHERE username = ?'
      ).bind(username).first();
      
      // 验证用户
      if (user && user.is_active === 1) {
        const isValid = await verifyPassword(password, user.password);
        if (isValid) {
          const token = generateAuthToken(username, config.cookie);
          const expirationDate = new Date();
          expirationDate.setDate(expirationDate.getDate() + config.cookie);
          const cookie = `auth_token=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=${expirationDate.toUTCString()}`;
          return new Response("登录成功", {
            status: 200,
            headers: {
              "Set-Cookie": cookie,
              "Content-Type": "text/plain"
            }
          });
        }
      }
      
      // 兼容旧版单用户模式（admin/admin）
      if (username === config.username && password === config.password) {
        const token = generateAuthToken(username, config.cookie);
        const expirationDate = new Date();
        expirationDate.setDate(expirationDate.getDate() + config.cookie);
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
    } catch (error) {
      console.error('Login error:', error);
      return new Response("认证失败", { status: 401 });
    }
  }
  
  const html = generateLoginPage();
  return new Response(html, {
    headers: { 'Content-Type': 'text/html;charset=UTF-8' }
  });
}

// ============================================================
// 9. 用户注册处理
// ============================================================
async function handleRegisterRequest(request, config) {
  if (request.method === 'POST') {
    try {
      const { username, email, password } = await request.json();
      
      // 验证用户名
      if (!username || username.length < 3) {
        return new Response(JSON.stringify({ success: false, error: '用户名至少3个字符' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      // 验证密码
      if (!password || password.length < 6) {
        return new Response(JSON.stringify({ success: false, error: '密码至少6个字符' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      // 检查用户名是否已存在
      const existing = await config.database.prepare(
        'SELECT id FROM users WHERE username = ?'
      ).bind(username).first();
      
      if (existing) {
        return new Response(JSON.stringify({ success: false, error: '用户名已存在' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      // 哈希密码
      const hashedPassword = await hashPassword(password);
      const userId = crypto.randomUUID();
      const timestamp = Date.now();
      
      // 插入新用户
      await config.database.prepare(`
        INSERT INTO users (id, username, password, email, created_at, is_admin, is_active)
        VALUES (?, ?, ?, ?, ?, 0, 1)
      `).bind(userId, username, hashedPassword, email || '', timestamp).run();
      
      // 生成认证 Token 并设置 Cookie
      const token = generateAuthToken(username, config.cookie);
      const expirationDate = new Date();
      expirationDate.setDate(expirationDate.getDate() + config.cookie);
      const cookie = `auth_token=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=${expirationDate.toUTCString()}`;
      
      return new Response(JSON.stringify({
        success: true,
        username: username,
        message: '注册成功'
      }), {
        status: 200,
        headers: {
          'Set-Cookie': cookie,
          'Content-Type': 'application/json'
        }
      });
      
    } catch (error) {
      console.error('Register error:', error);
      return new Response(JSON.stringify({ success: false, error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
  
  // GET 请求返回注册页面
  const html = generateRegisterPage();
  return new Response(html, {
    headers: { 'Content-Type': 'text/html;charset=UTF-8' }
  });
}

// ============================================================
// 10. 注册页面
// ============================================================
function generateRegisterPage() {
  return `<!DOCTYPE html>
  <html lang="zh-CN">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>注册 | CF-TGBed</title>
    <link rel="shortcut icon" href="https://img.hangdn.com/favicon.ico" type="image/x-icon">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
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
      }
      .register-container {
        width: 100%;
        max-width: 420px;
        animation: fadeInUp 0.6s ease-out;
      }
      @keyframes fadeInUp {
        from { opacity: 0; transform: translateY(30px) scale(0.96); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      .register-card {
        background: rgba(255, 255, 255, 0.75);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        border-radius: 28px;
        padding: 48px 40px 40px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.10), 0 2px 16px rgba(0,0,0,0.04), inset 0 1px 0 rgba(255,255,255,0.5);
        text-align: center;
        border: 1px solid rgba(255,255,255,0.4);
      }
      .logo-icon { font-size: 3.2em; color: #4a6cf7; margin-bottom: 16px; display: block; background: linear-gradient(135deg, #4a6cf7, #7c3aed); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
      .title { font-size: 1.8em; font-weight: 700; color: #1a1a2e; margin-bottom: 6px; letter-spacing: -0.5px; }
      .subtitle { color: #666; margin-bottom: 32px; font-size: 0.95em; line-height: 1.5; }
      .error-message {
        background: rgba(220,53,69,0.08);
        border: 1px solid rgba(220,53,69,0.2);
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
      .error-message.show { display: flex; }
      .form-group { margin-bottom: 18px; text-align: left; }
      .form-group label { display: block; font-size: 0.85em; color: #555; margin-bottom: 6px; font-weight: 500; }
      .input-wrapper { position: relative; }
      .input-wrapper i { position: absolute; left: 16px; top: 50%; transform: translateY(-50%); color: #aaa; font-size: 1em; pointer-events: none; }
      .form-input {
        width: 100%;
        padding: 14px 16px 14px 46px;
        border: 2px solid #e8ecf1;
        border-radius: 14px;
        font-size: 0.95em;
        transition: all 0.3s ease;
        background: rgba(255,255,255,0.7);
        color: #1a1a2e;
        outline: none;
        font-family: inherit;
      }
      .form-input:focus {
        border-color: #4a6cf7;
        background: rgba(255,255,255,0.9);
        box-shadow: 0 0 0 4px rgba(74,108,247,0.10);
      }
      .form-input.has-toggle { padding-right: 52px; }
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
        transition: all 0.2s;
        font-size: 1em;
      }
      .password-toggle:hover { color: #4a6cf7; background: rgba(74,108,247,0.06); }
      .register-btn {
        width: 100%;
        padding: 16px 20px;
        background: linear-gradient(135deg, #4a6cf7 0%, #7c3aed 100%);
        border: none;
        border-radius: 14px;
        color: #fff;
        font-size: 1.05em;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.3s cubic-bezier(0.4,0,0.2,1);
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        font-family: inherit;
        letter-spacing: 0.5px;
      }
      .register-btn:hover { transform: translateY(-2px); box-shadow: 0 8px 28px rgba(74,108,247,0.35); }
      .register-btn:disabled { opacity: 0.7; cursor: not-allowed; transform: none !important; }
      .register-btn .spinner {
        width: 20px; height: 20px;
        border: 2.5px solid rgba(255,255,255,0.25);
        border-top-color: #fff;
        border-radius: 50%;
        animation: spin 0.7s linear infinite;
      }
      @keyframes spin { to { transform: rotate(360deg); } }
      .footer-text { margin-top: 28px; color: #999; font-size: 0.8em; }
      .footer-text a { color: #4a6cf7; text-decoration: none; font-weight: 500; transition: color 0.2s; }
      .footer-text a:hover { color: #7c3aed; text-decoration: underline; }
      .footer-text .divider { margin: 0 6px; color: #ddd; }
      .login-link { margin-top: 16px; font-size: 0.9em; color: #666; }
      .login-link a { color: #4a6cf7; text-decoration: none; font-weight: 500; }
      .login-link a:hover { text-decoration: underline; }
      @media (max-width: 480px) {
        .register-card { padding: 32px 24px 28px; border-radius: 24px; }
        .logo-icon { font-size: 2.6em; }
        .title { font-size: 1.5em; }
        .form-input { padding: 13px 14px 13px 42px; font-size: 0.9em; }
        .register-btn { padding: 14px; font-size: 0.95em; }
      }
    </style>
  </head>
  <body>
    <div class="register-container">
      <div class="register-card">
        <i class="fas fa-user-plus logo-icon"></i>
        <h1 class="title">创建账号</h1>
        <p class="subtitle">注册以开始使用文件托管服务</p>
        <div class="error-message" id="errorMessage">
          <i class="fas fa-exclamation-circle"></i>
          <span id="errorText">注册失败</span>
        </div>
        <form id="registerForm">
          <div class="form-group">
            <label for="username">用户名</label>
            <div class="input-wrapper">
              <i class="fas fa-user"></i>
              <input type="text" id="username" class="form-input" placeholder="请输入用户名" required>
            </div>
          </div>
          <div class="form-group">
            <label for="email">邮箱（可选）</label>
            <div class="input-wrapper">
              <i class="fas fa-envelope"></i>
              <input type="email" id="email" class="form-input" placeholder="请输入邮箱（可选）">
            </div>
          </div>
          <div class="form-group">
            <label for="password">密码</label>
            <div class="input-wrapper">
              <i class="fas fa-lock"></i>
              <input type="password" id="password" class="form-input has-toggle" placeholder="请输入密码（至少6位）" required minlength="6">
              <button type="button" class="password-toggle" onclick="togglePassword()">
                <i class="fas fa-eye" id="passwordToggleIcon"></i>
              </button>
            </div>
          </div>
          <div class="form-group">
            <label for="confirmPassword">确认密码</label>
            <div class="input-wrapper">
              <i class="fas fa-check"></i>
              <input type="password" id="confirmPassword" class="form-input has-toggle" placeholder="请再次输入密码" required>
            </div>
          </div>
          <button type="submit" class="register-btn" id="registerBtn">
            <i class="fas fa-user-plus"></i>
            <span>注 册</span>
          </button>
        </form>
        <p class="login-link">已有账号？<a href="/login">立即登录</a></p>
        <p class="footer-text">
          <i class="fas fa-copyright"></i> 2025
          <a href="https://github.com/chnbsdan/CF-tgbed" target="_blank">CF-TGBed</a>
        </p>
      </div>
    </div>
    <script>
      (function() {
        try {
          var imageUrl = 'https://pico.1356666.xyz/api/wallpaper?t=' + Date.now();
          document.body.style.backgroundImage = 'url(' + imageUrl + ')';
          document.body.style.backgroundSize = 'cover';
          document.body.style.backgroundPosition = 'center center';
          document.body.style.backgroundRepeat = 'no-repeat';
          document.body.style.backgroundAttachment = 'fixed';
        } catch(e) {}
      })();

      function togglePassword() {
        var pwd = document.getElementById('password');
        var icon = document.getElementById('passwordToggleIcon');
        if (pwd.type === 'password') { pwd.type = 'text'; icon.className = 'fas fa-eye-slash'; }
        else { pwd.type = 'password'; icon.className = 'fas fa-eye'; }
      }

      document.getElementById('registerForm').addEventListener('submit', async function(e) {
        e.preventDefault();
        var username = document.getElementById('username').value.trim();
        var email = document.getElementById('email').value.trim();
        var password = document.getElementById('password').value;
        var confirm = document.getElementById('confirmPassword').value;
        var errorEl = document.getElementById('errorMessage');
        var errorText = document.getElementById('errorText');
        var btn = document.getElementById('registerBtn');

        errorEl.classList.remove('show');

        if (username.length < 3) {
          errorText.textContent = '用户名至少3个字符';
          errorEl.classList.add('show');
          return;
        }
        if (password.length < 6) {
          errorText.textContent = '密码至少6个字符';
          errorEl.classList.add('show');
          return;
        }
        if (password !== confirm) {
          errorText.textContent = '两次输入的密码不一致';
          errorEl.classList.add('show');
          return;
        }

        btn.disabled = true;
        btn.innerHTML = '<div class="spinner"></div><span>注册中...</span>';

        try {
          var response = await fetch('/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, email, password })
          });
          var data = await response.json();

          if (data.success) {
            window.location.href = '/upload';
          } else {
            errorText.textContent = data.error || '注册失败';
            errorEl.classList.add('show');
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-user-plus"></i><span>注 册</span>';
          }
        } catch(err) {
          errorText.textContent = '网络错误，请稍后重试';
          errorEl.classList.add('show');
          btn.disabled = false;
          btn.innerHTML = '<i class="fas fa-user-plus"></i><span>注 册</span>';
        }
      });
    </script>
  </body>
  </html>`;
}

// ============================================================
// 11. 退出登录
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
// 12. GitHub 代理（解决跨域和速率限制）
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
// 13. GitHub 上传
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
// 14. 上传处理（核心）- 支持多用户隔离
// ============================================================
async function handleUploadRequest(request, config) {
  if (config.enableAuth) {
    const username = authenticate(request, config);
    if (!username) {
      return Response.redirect(`${new URL(request.url).origin}/login`, 302);
    }
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
    
    // 14.1 文件类型白名单校验
    const allowedTypes = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'video/mp4', 'video/webm',
      'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/flac',
      'application/pdf', 'text/plain', 'text/markdown',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/zip',
      'application/x-rar-compressed',
      'application/x-7z-compressed',
      'application/json',
      'application/xml',
      'text/csv'
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
    const folderId = formData.get('folderId') || '';
    let fileId = null;
    let messageId = null;
    let storageType = 'telegram';
    let uploadError = null;
    let url = '';

    // 获取当前用户 ID
    const username = authenticate(request, config);
    let userId = 'default';
    if (username) {
      const user = await config.database.prepare(
        'SELECT id FROM users WHERE username = ?'
      ).bind(username).first();
      if (user) {
        userId = user.id;
      }
    }

    if (selectedStorage === 'telegram' && file.size > config.maxSizeMB * 1024 * 1024) {
      throw new Error(`文件超过${config.maxSizeMB}MB限制，请选择 R2 或 GitHub 存储`);
    }

    if (selectedStorage === 'github') {
      if (!config.githubToken || !config.githubRepo) {
        throw new Error('GitHub 存储暂不可用，请选择其他存储方式');
      }
      const result = await uploadToGitHub(file, config);
      fileId = result.fileId;
      messageId = Date.now();
      storageType = 'github';
      url = result.url;
    } 
    else if (selectedStorage === 'r2') {
      if (!config.r2Bucket) {
        throw new Error('R2 存储暂不可用，请选择其他存储方式');
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
  INSERT INTO files (url, fileId, message_id, created_at, file_name, file_size, mime_type, storage_type, user_id, folder_id) 
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).bind(
  url,
  fileId,
  messageId,
  timestamp,
  originalFileName,
  file.size,
  mimeType,
  storageType,
  userId,
  folderId
).run();

    // 更新用户存储空间
    if (userId !== 'default') {
      await config.database.prepare(
        'UPDATE users SET used_storage = used_storage + ? WHERE id = ?'
      ).bind(file.size, userId).run();
    }

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
// 15. 管理后台（支持管理员查看所有用户 + 文件夹筛选）
// ============================================================
async function handleAdminRequest(request, config) {
  if (config.enableAuth) {
    const username = authenticate(request, config);
    if (!username) {
      return Response.redirect(`${new URL(request.url).origin}/login`, 302);
    }
  }

  try {
    // 获取当前用户信息
    const username = authenticate(request, config);
    let userId = 'default';
    let isAdmin = false;
    
    if (username) {
      const user = await config.database.prepare(
        'SELECT id, is_admin FROM users WHERE username = ?'
      ).bind(username).first();
      if (user) {
        userId = user.id;
        isAdmin = user.is_admin === 1;
      }
    }

    // 获取文件夹筛选参数
    const url = new URL(request.url);
    const folderFilter = url.searchParams.get('folder') || '';

    // 构建查询
    let sql = `
      SELECT url, fileId, message_id, created_at, file_name, file_size, mime_type,
        IFNULL(storage_type, 'telegram') as storage_type,
        user_id,
        folder_id
      FROM files
    `;
    let params = [];
    let whereConditions = [];

    // 用户隔离（普通用户只能看自己的）
    if (!isAdmin) {
      whereConditions.push(`user_id = ?`);
      params.push(userId);
    }

    // 文件夹筛选（有 folder 参数时才筛选）
    if (folderFilter && folderFilter !== '') {
      whereConditions.push(`folder_id = ?`);
      params.push(folderFilter);
    }

    if (whereConditions.length > 0) {
      sql += ` WHERE ` + whereConditions.join(' AND ');
    }

    sql += ` ORDER BY created_at DESC`;

    const files = await config.database.prepare(sql).bind(...params).all();
    const fileList = files.results || [];

        // 获取所有用户信息（仅管理员可见）
    let usersList = [];
    if (isAdmin) {
      const users = await config.database.prepare(
        'SELECT id, username, email, created_at, is_admin, is_active, used_storage FROM users ORDER BY created_at DESC'
      ).all();
      usersList = users.results || [];
    }

    // 构建文件卡片
    const fileCards = fileList.map((file, index) => {
      const fileName = file.file_name || '未知文件';
      const fileSize = formatSize(file.file_size || 0);
      const createdAt = file.created_at ? new Date(file.created_at).toISOString().replace('T', ' ').split('.')[0] : '';
      const storageType = file.storage_type || 'telegram';
      let storageBadge = '<span class="storage-badge tg">TG</span>';
      if (storageType === 'r2') storageBadge = '<span class="storage-badge r2">R2</span>';
      else if (storageType === 'github') storageBadge = '<span class="storage-badge github">GitHub</span>';
      
      // 如果是管理员，显示上传者
      let ownerInfo = '';
      if (isAdmin && file.user_id) {
        const owner = usersList.find(u => u.id === file.user_id);
        if (owner) {
          ownerInfo = `<span class="file-owner">👤 ${owner.username}</span>`;
        }
      }
      
      const previewHtml = getPreviewHtml(file.url);
      
      return `
        <div class="file-card" data-url="${file.url}" data-index="${index}" data-name="${fileName}">
          <input type="checkbox" class="file-checkbox" data-url="${file.url}">
          <div class="file-preview" onclick="openPreview('${file.url}')">
            ${previewHtml}
          </div>
          <div class="file-info">
            <div class="file-name" title="${fileName}">${fileName} ${storageBadge}</div>
            <div class="file-meta">${fileSize} · ${createdAt} ${ownerInfo}</div>
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
    // 用户管理面板（仅管理员可见）
    // ============================================================
    let userManagementHtml = '';
    if (isAdmin && usersList.length > 0) {
            const userRows = usersList.map(user => {
        const statusBadge = user.is_active === 1 
          ? '<span class="badge-active">✅ 活跃</span>' 
          : '<span class="badge-inactive">⛔ 已禁用</span>';
        const adminBadge = user.is_admin === 1 
          ? '<span class="badge-admin">👑 管理员</span>' 
          : '';
        const createdAt = user.created_at ? new Date(user.created_at).toISOString().replace('T', ' ').split('.')[0] : '';
        const usedStorage = formatSize(user.used_storage || 0);
        
        return `
          <div class="user-row" data-userid="${user.id}">
            <span class="user-username"><strong>${user.username}</strong></span>
            <span class="user-email">${user.email || '无邮箱'}</span>
            <span class="user-time">${createdAt}</span>
            <span class="user-storage">💾 ${usedStorage}</span>
            <span class="user-status">${statusBadge} ${adminBadge}</span>
            <div class="user-actions">
              <button class="btn-toggle-admin" onclick="toggleAdmin('${user.id}', '${user.username}')" title="切换管理员权限">
                <i class="fas fa-crown"></i>
              </button>
              <button class="btn-toggle-active" onclick="toggleActive('${user.id}', '${user.username}')" title="启用/禁用用户">
                <i class="fas ${user.is_active === 1 ? 'fa-ban' : 'fa-check-circle'}"></i>
              </button>
            </div>
          </div>
        `;
      }).join('');

      userManagementHtml = `
        <div class="user-management">
          <h3><i class="fas fa-users"></i> 用户管理 (${usersList.length} 位用户)</h3>
          <div class="user-table">
            <div class="user-header">
  <span>用户名</span>
  <span>邮箱</span>
  <span>注册时间</span>
  <span>已用空间</span>
  <span>状态</span>
  <span>操作</span>
</div>
            ${userRows}
          </div>
          <style>
            .user-management {
              background: rgba(255, 255, 255, 0.72);
              backdrop-filter: blur(12px);
              -webkit-backdrop-filter: blur(12px);
              border-radius: 16px;
              padding: 18px 20px;
              margin-bottom: 20px;
              border: 1px solid rgba(255, 255, 255, 0.5);
            }
            .user-management h3 {
              margin: 0 0 14px 0;
              font-size: 1.1em;
              color: #1a1a2e;
            }
            .user-table {
              display: flex;
              flex-direction: column;
              gap: 6px;
            }
            .user-header, .user-row {
  display: grid;
  grid-template-columns: 1fr 0.8fr 1.2fr 0.8fr 1fr 1.2fr;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 13px;
  align-items: center;
}
            .user-header {
              font-weight: 600;
              color: #666;
              background: rgba(0,0,0,0.03);
              font-size: 12px;
              text-transform: uppercase;
              letter-spacing: 0.5px;
            }
            .user-row {
              background: rgba(255,255,255,0.3);
              transition: background 0.2s;
            }
            .user-row:hover {
              background: rgba(255,255,255,0.6);
            }
            .badge-active { color: #22b573; font-size: 12px; }
            .badge-inactive { color: #dc3545; font-size: 12px; }
            .badge-admin { color: #4a6cf7; font-size: 12px; }
            .user-actions {
              display: flex;
              gap: 6px;
            }
            .user-actions button {
              padding: 4px 10px;
              border: none;
              border-radius: 6px;
              cursor: pointer;
              font-size: 13px;
              transition: all 0.2s;
              background: rgba(0,0,0,0.04);
              color: #555;
            }
            .user-actions button:hover {
              background: rgba(0,0,0,0.08);
              transform: scale(1.05);
            }
            .user-actions .btn-toggle-admin:hover { background: #4a6cf7; color: #fff; }
            .user-actions .btn-toggle-active:hover { background: #dc3545; color: #fff; }
            @media (max-width: 768px) {
              .user-header, .user-row {
                grid-template-columns: 1fr 1fr;
                font-size: 12px;
                gap: 4px;
              }
              .user-header span:nth-child(3), .user-row span:nth-child(3),
              .user-header span:nth-child(4), .user-row span:nth-child(4) {
                display: none;
              }
            }
          </style>
        </div>
      `;
    }

    // ============================================================
    // 预览模态框
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
              <button onclick="previewZoomIn()" title="放大"><i class="fas fa-search-plus"></i></button>
              <button onclick="previewZoomOut()" title="缩小"><i class="fas fa-search-minus"></i></button>
              <button onclick="previewZoomReset()" title="重置"><i class="fas fa-expand"></i></button>
              <button onclick="previewOpenLink()" title="打开链接"><i class="fas fa-external-link-alt"></i></button>
              <button onclick="previewCopyLink()" title="复制链接"><i class="fas fa-copy"></i></button>
              <button onclick="previewDeleteFile()" title="删除文件" class="preview-delete"><i class="fas fa-trash"></i></button>
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
          <button class="btn btn-batch-copy" onclick="batchCopy()"><i class="fas fa-copy"></i> 批量复制</button>
          <button class="btn btn-batch-delete" onclick="batchDelete()"><i class="fas fa-trash"></i> 批量删除</button>
          <button class="btn btn-select-all" onclick="toggleSelectAll()"><i class="fas fa-check-double"></i> 全选</button>
          <button class="btn btn-clear-select" onclick="clearSelection()"><i class="fas fa-times"></i> 取消选择</button>
        </div>
      </div>
    `;

    const html = generateAdminPage(fileCards, previewModal, qrModal, batchToolbar, userManagementHtml);
    return new Response(html, {
      headers: { 'Content-Type': 'text/html;charset=UTF-8' }
    });
  } catch (error) {
    console.error('[Admin Error]', error);
    return new Response('Admin Error: ' + error.message, { status: 500 });
  }
}

// ============================================================
// 16. 批量删除
// ============================================================
async function handleBatchDeleteRequest(request, config) {
  if (config.enableAuth) {
    const username = authenticate(request, config);
    if (!username) {
      return Response.redirect(`${new URL(request.url).origin}/login`, 302);
    }
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
// 17. 搜索
// ============================================================
async function handleSearchRequest(request, config) {
  if (config.enableAuth) {
    const username = authenticate(request, config);
    if (!username) {
      return Response.redirect(`${new URL(request.url).origin}/login`, 302);
    }
  }

  try {
    // 获取当前用户 ID
    const username = authenticate(request, config);
    let userId = 'default';
    if (username) {
      const user = await config.database.prepare(
        'SELECT id FROM users WHERE username = ?'
      ).bind(username).first();
      if (user) {
        userId = user.id;
      }
    }

    const { query } = await request.json();
    const searchPattern = `%${query}%`;    
    const files = await config.database.prepare(
      `SELECT url, fileId, message_id, created_at, file_name, file_size, mime_type,
        IFNULL(storage_type, 'telegram') as storage_type
       FROM files 
       WHERE user_id = ? AND file_name LIKE ? ESCAPE '!'
       COLLATE NOCASE
       ORDER BY created_at DESC`
    ).bind(userId, searchPattern).all();

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
// 18. 上传历史
// ============================================================
async function handleHistoryRequest(request, config) {
  if (config.enableAuth) {
    const username = authenticate(request, config);
    if (!username) {
      return Response.redirect(`${new URL(request.url).origin}/login`, 302);
    }
  }

  try {
    // 获取当前用户 ID
    const username = authenticate(request, config);
    let userId = 'default';
    if (username) {
      const user = await config.database.prepare(
        'SELECT id FROM users WHERE username = ?'
      ).bind(username).first();
      if (user) {
        userId = user.id;
      }
    }

    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page')) || 1;
    const limit = parseInt(url.searchParams.get('limit')) || 20;
    const offset = (page - 1) * limit;
    
    const total = await config.database.prepare(
      'SELECT COUNT(*) as count FROM files WHERE user_id = ?'
    ).bind(userId).first();
    
    const files = await config.database.prepare(
      `SELECT url, file_name, file_size, created_at, mime_type,
        IFNULL(storage_type, 'telegram') as storage_type
       FROM files 
       WHERE user_id = ?
       ORDER BY created_at DESC 
       LIMIT ? OFFSET ?`
    ).bind(userId, limit, offset).all();

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
// 19. 文件预览
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
// 20. 文件访问（支持大文件流式传输和 Range 请求）
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
      
      if (range) {
        const headResponse = await fetch(fileUrl, { method: 'HEAD' });
        const totalSize = parseInt(headResponse.headers.get('Content-Length') || '0', 10) || contentLength;
        
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;
        const chunkSize = end - start + 1;
        
        const rangeResponse = await fetch(fileUrl, {
          headers: { 'Range': `bytes=${start}-${end}` }
        });
        
        if (rangeResponse.ok) {
          status = 206;
          headers['Content-Range'] = `bytes ${start}-${end}/${totalSize}`;
          headers['Content-Length'] = chunkSize;
          headers['Accept-Ranges'] = 'bytes';
          fileResponse = new Response(rangeResponse.body, { status, headers });
        } else {
          const fullResponse = await fetch(fileUrl);
          fileResponse = new Response(fullResponse.body, { headers });
        }
      } else {
        const tgFileResponse = await fetch(fileUrl);
        if (!tgFileResponse.ok) {
          return new Response('下载文件失败', { 
            status: 500,
            headers: { 'Content-Type': 'text/plain;charset=UTF-8' }
          });
        }
        fileResponse = new Response(tgFileResponse.body, { headers });
      }
    }

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
// 21. 删除单个文件
// ============================================================
async function handleDeleteRequest(request, config) {
  if (config.enableAuth) {
    const username = authenticate(request, config);
    if (!username) {
      return Response.redirect(`${new URL(request.url).origin}/login`, 302);
    }
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
      'SELECT fileId, message_id, storage_type, user_id, file_size FROM files WHERE url = ?'
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
    
    // 减少用户存储空间
    if (file.user_id && file.user_id !== 'default' && file.file_size) {
      await config.database.prepare(
        'UPDATE users SET used_storage = used_storage - ? WHERE id = ?'
      ).bind(file.file_size, file.user_id).run();
    }
    
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
// 22. 工具函数
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
    '7z': 'application/x-7z-compressed',
    json: 'application/json',
    xml: 'application/xml',
    ini: 'text/plain',
    js: 'application/javascript',
    yml: 'application/yaml',
    yaml: 'application/yaml',
    py: 'text/x-python',
    sh: 'application/x-sh',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    csv: 'text/csv'
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
// 23. Bing 壁纸
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
// 24. Favicon 处理（从网络获取）
// ============================================================
async function handleFaviconRequest(request, config) {
  const faviconUrl = 'https://img.hangdn.com/favicon.ico';
  
  try {
    const response = await fetch(faviconUrl);
    
    if (response.ok) {
      return new Response(response.body, {
        headers: {
          'Content-Type': 'image/x-icon',
          'Cache-Control': 'public, max-age=86400',
        }
      });
    } else {
      return new Response('Favicon not found', { status: 404 });
    }
  } catch (error) {
    return new Response('Favicon fetch error', { status: 500 });
  }
}

// ============================================================
// 切换用户管理员权限
// ============================================================
async function handleToggleAdmin(request, config) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }
  
  const username = authenticate(request, config);
  if (!username) {
    return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });
  }
  
  const currentUser = await config.database.prepare(
    'SELECT is_admin FROM users WHERE username = ?'
  ).bind(username).first();
  
  if (!currentUser || currentUser.is_admin !== 1) {
    return new Response(JSON.stringify({ error: '权限不足' }), { status: 403 });
  }
  
  try {
    const { userId } = await request.json();
    if (!userId) {
      return new Response(JSON.stringify({ error: '缺少用户ID' }), { status: 400 });
    }
    
    const targetUser = await config.database.prepare(
      'SELECT username, is_admin FROM users WHERE id = ?'
    ).bind(userId).first();
    
    if (!targetUser) {
      return new Response(JSON.stringify({ error: '用户不存在' }), { status: 404 });
    }
    
    if (targetUser.username === username) {
      return new Response(JSON.stringify({ error: '不能修改自己的权限' }), { status: 400 });
    }
    
    const newAdminStatus = targetUser.is_admin === 1 ? 0 : 1;
    await config.database.prepare(
      'UPDATE users SET is_admin = ? WHERE id = ?'
    ).bind(newAdminStatus, userId).run();
    
    return new Response(JSON.stringify({
      success: true,
      is_admin: newAdminStatus,
      message: `用户 ${targetUser.username} 的权限已更新`
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// ============================================================
// 切换用户启用/禁用状态
// ============================================================
async function handleToggleActive(request, config) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }
  
  const username = authenticate(request, config);
  if (!username) {
    return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });
  }
  
  const currentUser = await config.database.prepare(
    'SELECT is_admin FROM users WHERE username = ?'
  ).bind(username).first();
  
  if (!currentUser || currentUser.is_admin !== 1) {
    return new Response(JSON.stringify({ error: '权限不足' }), { status: 403 });
  }
  
  try {
    const { userId } = await request.json();
    if (!userId) {
      return new Response(JSON.stringify({ error: '缺少用户ID' }), { status: 400 });
    }
    
    const targetUser = await config.database.prepare(
      'SELECT username, is_active FROM users WHERE id = ?'
    ).bind(userId).first();
    
    if (!targetUser) {
      return new Response(JSON.stringify({ error: '用户不存在' }), { status: 404 });
    }
    
    if (targetUser.username === username) {
      return new Response(JSON.stringify({ error: '不能禁用自己' }), { status: 400 });
    }
    
    const newActiveStatus = targetUser.is_active === 1 ? 0 : 1;
    await config.database.prepare(
      'UPDATE users SET is_active = ? WHERE id = ?'
    ).bind(newActiveStatus, userId).run();
    
    return new Response(JSON.stringify({
      success: true,
      is_active: newActiveStatus,
      message: `用户 ${targetUser.username} 的状态已更新`
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// ============================================================
// 文件夹管理 API（管理员可以看到所有用户的文件夹）
// ============================================================
async function handleFoldersRequest(request, config) {
  const username = authenticate(request, config);
  if (!username) {
    return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });
  }
  
  const user = await config.database.prepare(
    'SELECT id, is_admin FROM users WHERE username = ?'
  ).bind(username).first();
  
  if (!user) {
    return new Response(JSON.stringify({ error: '用户不存在' }), { status: 404 });
  }
  
  const isAdmin = user.is_admin === 1;
  
  // GET：获取文件夹列表
  if (request.method === 'GET') {
    try {
      let sql = 'SELECT id, user_id, name, created_at FROM folders';
      let params = [];
      
      // 普通用户只能看到自己的文件夹
      if (!isAdmin) {
        sql += ' WHERE user_id = ?';
        params.push(user.id);
      }
      // 管理员看到所有用户的文件夹
      
      sql += ' ORDER BY created_at DESC';
      
      const folders = await config.database.prepare(sql).bind(...params).all();
      
      // 如果是管理员，附加用户名信息
      let folderList = folders.results || [];
      if (isAdmin && folderList.length > 0) {
        // 获取所有用户名
        const users = await config.database.prepare(
          'SELECT id, username FROM users'
        ).all();
        const userMap = {};
        (users.results || []).forEach(u => {
          userMap[u.id] = u.username;
        });
        folderList = folderList.map(f => ({
          ...f,
          username: userMap[f.user_id] || '未知'
        }));
      }
      
      return new Response(JSON.stringify({
        success: true,
        folders: folderList,
        isAdmin: isAdmin
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
  
  // POST：创建文件夹
  if (request.method === 'POST') {
    try {
      const { name } = await request.json();
      if (!name || name.trim() === '') {
        return new Response(JSON.stringify({ error: '文件夹名称不能为空' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      const folderId = crypto.randomUUID();
      const timestamp = Date.now();
      
      await config.database.prepare(`
        INSERT INTO folders (id, user_id, name, created_at)
        VALUES (?, ?, ?, ?)
      `).bind(folderId, user.id, name.trim(), timestamp).run();
      
      return new Response(JSON.stringify({
        success: true,
        folderId: folderId,
        name: name.trim()
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
  
  return new Response('Method not allowed', { status: 405 });
}

// ============================================================
// 25. HTML 模板 - 公共部分
// ============================================================
function headLinks() {
  return `
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="Telegram文件存储与分享平台">
    <link rel="shortcut icon" href="https://img.hangdn.com/favicon.ico" type="image/x-icon">
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
// 26. 登录页面（含注册入口）
// ============================================================
function generateLoginPage() {
  return `<!DOCTYPE html>
  <html lang="zh-CN">
  <head>
  ${headLinks()}
  <title>登录 | CF-TGBed</title>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
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
      .login-container {
        width: 100%;
        max-width: 420px;
        animation: fadeInUp 0.6s ease-out;
      }
      @keyframes fadeInUp {
        from { opacity: 0; transform: translateY(30px) scale(0.96); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      .login-card {
        background: rgba(255, 255, 255, 0.75);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        border-radius: 28px;
        padding: 48px 40px 40px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.10), 0 2px 16px rgba(0,0,0,0.04), inset 0 1px 0 rgba(255,255,255,0.5);
        text-align: center;
        border: 1px solid rgba(255,255,255,0.4);
        transition: transform 0.3s ease, box-shadow 0.3s ease;
      }
      .login-card:hover { transform: translateY(-2px); box-shadow: 0 12px 48px rgba(0,0,0,0.12); }
      .logo-icon { font-size: 3.2em; color: #4a6cf7; margin-bottom: 16px; display: block; background: linear-gradient(135deg, #4a6cf7, #7c3aed); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
      .title { font-size: 1.8em; font-weight: 700; color: #1a1a2e; margin-bottom: 6px; letter-spacing: -0.5px; }
      .subtitle { color: #666; margin-bottom: 32px; font-size: 0.95em; line-height: 1.5; font-weight: 400; }
      .error-message {
        background: rgba(220,53,69,0.08);
        border: 1px solid rgba(220,53,69,0.2);
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
      .error-message.show { display: flex; }
      .error-message i { font-size: 1.1em; flex-shrink: 0; }
      .form-group { margin-bottom: 18px; text-align: left; }
      .form-group label { display: block; font-size: 0.85em; color: #555; margin-bottom: 6px; font-weight: 500; letter-spacing: 0.3px; }
      .input-wrapper { position: relative; }
      .input-wrapper i { position: absolute; left: 16px; top: 50%; transform: translateY(-50%); color: #aaa; font-size: 1em; transition: color 0.3s; pointer-events: none; }
      .input-wrapper:focus-within i { color: #4a6cf7; }
      .form-input {
        width: 100%;
        padding: 14px 16px 14px 46px;
        border: 2px solid #e8ecf1;
        border-radius: 14px;
        font-size: 0.95em;
        transition: all 0.3s ease;
        background: rgba(255,255,255,0.7);
        color: #1a1a2e;
        outline: none;
        font-family: inherit;
      }
      .form-input:focus { border-color: #4a6cf7; background: rgba(255,255,255,0.9); box-shadow: 0 0 0 4px rgba(74,108,247,0.10); }
      .form-input::placeholder { color: #bbb; font-weight: 300; }
      .form-input.has-toggle { padding-right: 52px; }
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
      .password-toggle:hover { color: #4a6cf7; background: rgba(74,108,247,0.06); }
      .remember-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; margin-top: 4px; }
      .remember-label { display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 0.9em; color: #666; user-select: none; }
      .remember-label input[type="checkbox"] { width: 18px; height: 18px; accent-color: #4a6cf7; border-radius: 4px; cursor: pointer; flex-shrink: 0; }
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
        transition: all 0.3s cubic-bezier(0.4,0,0.2,1);
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
        background: linear-gradient(90deg, transparent, rgba(255,255,255,0.15), transparent);
        transition: left 0.6s ease;
      }
      .login-btn:hover::before { left: 100%; }
      .login-btn:hover { transform: translateY(-2px); box-shadow: 0 8px 28px rgba(74,108,247,0.35); }
      .login-btn:active { transform: translateY(0); box-shadow: 0 4px 16px rgba(74,108,247,0.25); }
      .login-btn:disabled { opacity: 0.7; cursor: not-allowed; transform: none !important; }
      .login-btn .spinner {
        width: 20px; height: 20px;
        border: 2.5px solid rgba(255,255,255,0.25);
        border-top-color: #fff;
        border-radius: 50%;
        animation: spin 0.7s linear infinite;
      }
      @keyframes spin { to { transform: rotate(360deg); } }
      .footer-text { margin-top: 28px; color: #999; font-size: 0.8em; letter-spacing: 0.3px; }
      .footer-text a { color: #4a6cf7; text-decoration: none; font-weight: 500; transition: color 0.2s; }
      .footer-text a:hover { color: #7c3aed; text-decoration: underline; }
      .footer-text .divider { margin: 0 6px; color: #ddd; }
      .login-link { margin-top: 16px; font-size: 0.9em; color: #666; }
      .login-link a { color: #4a6cf7; text-decoration: none; font-weight: 500; }
      .login-link a:hover { text-decoration: underline; }
      @media (max-width: 480px) {
        .login-card { padding: 32px 24px 28px; border-radius: 24px; }
        .logo-icon { font-size: 2.6em; }
        .title { font-size: 1.5em; }
        .subtitle { font-size: 0.85em; margin-bottom: 24px; }
        .form-input { padding: 13px 14px 13px 42px; font-size: 0.9em; border-radius: 12px; }
        .form-input.has-toggle { padding-right: 48px; }
        .password-toggle { right: 8px; width: 32px; height: 32px; font-size: 0.9em; }
        .login-btn { padding: 14px; font-size: 0.95em; border-radius: 12px; }
        .remember-row { margin-bottom: 20px; font-size: 0.85em; }
        .footer-text { font-size: 0.75em; margin-top: 22px; }
      }
    </style>
  </head>
  <body>
    <div class="login-container">
      <div class="login-card">
        <i class="fas fa-cloud-upload-alt logo-icon"></i>
        <h1 class="title">CF-TGBed</h1>
        <p class="subtitle">登录以管理您的文件</p>
        <div class="error-message" id="errorMessage">
          <i class="fas fa-exclamation-circle"></i>
          <span id="errorText">用户名或密码错误</span>
        </div>
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
              <button type="button" class="password-toggle" onclick="togglePassword()">
                <i class="fas fa-eye" id="passwordToggleIcon"></i>
              </button>
            </div>
          </div>
          <div class="remember-row">
            <label class="remember-label">
              <input type="checkbox" id="remember" checked>
              <span>记住我</span>
            </label>
          </div>
          <button type="submit" class="login-btn" id="loginBtn">
            <i class="fas fa-sign-in-alt"></i>
            <span>登 录</span>
          </button>
        </form>
        <p class="login-link">还没有账号？<a href="/register">立即注册</a></p>
        <p class="footer-text">
          <i class="fas fa-copyright"></i> 2025 
          <a href="https://github.com/chnbsdan/CF-tgbed" target="_blank">CF-TGBed</a>
          <span class="divider">|</span>
          <i class="fas fa-heart" style="color: #402cf7ff; font-size: 0.85em;"></i>
          <a href="https://github.com/chnbsdan" target="_blank">@chnbsdan</a>
        </p>
      </div>
    </div>
    <script>
      (function setInitialBackground() {
        try {
          var imageUrl = 'https://pico.1356666.xyz/api/wallpaper?t=' + Date.now();
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

      function showError(message) {
        var errorDiv = document.getElementById('errorMessage');
        var errorText = document.getElementById('errorText');
        errorText.textContent = message || '用户名或密码错误';
        errorDiv.classList.add('show');
      }

      function hideError() {
        document.getElementById('errorMessage').classList.remove('show');
      }

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

      document.getElementById('password').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          document.getElementById('loginForm').dispatchEvent(new Event('submit'));
        }
      });

      window.togglePassword = togglePassword;
      window.handleLogin = handleLogin;
    </script>
  </body>
  </html>`;
}

// ============================================================
// 27. 上传页面（全新样式，功能不变）
// ============================================================
function generateUploadPage() {
  return `<!DOCTYPE html>
  <html lang="zh-CN">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>文件上传 | CF-TGBed</title>
    <link rel="shortcut icon" href="https://img.hangdn.com/favicon.ico" type="image/x-icon">
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
        padding: 24px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        background: #f0f2f5;
        background-size: cover;
        background-position: center;
        background-repeat: no-repeat;
        background-attachment: fixed;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      /* ===== 主容器（毛玻璃卡片） ===== */
      .container {
        width: 100%;
        max-width: 880px;
        background: rgba(255, 255, 255, 0.72);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        border-radius: 28px;
        padding: 36px 40px 32px;
        box-shadow: 0 8px 40px rgba(0, 0, 0, 0.08), 0 2px 12px rgba(0, 0, 0, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.5);
        transition: box-shadow 0.3s ease;
      }

      .container:hover {
        box-shadow: 0 12px 56px rgba(0, 0, 0, 0.10);
      }

      /* ===== 头部 ===== */
      .header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-wrap: wrap;
        gap: 12px;
        margin-bottom: 28px;
      }

      .header-left {
        display: flex;
        align-items: center;
        gap: 14px;
      }

      .header-left h1 {
        font-size: 1.6em;
        font-weight: 700;
        color: #1a1a2e;
        letter-spacing: -0.3px;
        margin: 0;
      }

      .header-left h1 i {
        color: #4a6cf7;
        margin-right: 6px;
        background: linear-gradient(135deg, #4a6cf7, #7c3aed);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
      }

      .header-actions {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
      }

      .btn-refresh {
        width: 38px;
        height: 38px;
        border-radius: 50%;
        border: 1px solid rgba(0, 0, 0, 0.06);
        background: rgba(255, 255, 255, 0.6);
        color: #555;
        cursor: pointer;
        font-size: 15px;
        transition: all 0.3s ease;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .btn-refresh:hover {
        background: rgba(255, 255, 255, 0.9);
        transform: rotate(180deg);
        border-color: rgba(74, 108, 247, 0.2);
        color: #4a6cf7;
      }

      .btn-header {
        padding: 8px 18px;
        border-radius: 12px;
        border: none;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.25s ease;
        text-decoration: none;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        background: rgba(255, 255, 255, 0.6);
        color: #333;
        border: 1px solid rgba(0, 0, 0, 0.06);
      }

      .btn-header:hover {
        background: rgba(255, 255, 255, 0.9);
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.06);
      }

      .btn-header.admin {
        background: #4a6cf7;
        color: #fff;
        border-color: #4a6cf7;
      }

      .btn-header.admin:hover {
        background: #3b5de7;
        box-shadow: 0 4px 16px rgba(74, 108, 247, 0.25);
      }

      .btn-header.logout {
        background: rgba(220, 53, 69, 0.08);
        color: #dc3545;
        border-color: rgba(220, 53, 69, 0.12);
      }

      .btn-header.logout:hover {
        background: #dc3545;
        color: #fff;
        border-color: #dc3545;
        box-shadow: 0 4px 16px rgba(220, 53, 69, 0.20);
      }

      /* ===== 上传区域 ===== */
      .upload-area {
        border: 2.5px dashed rgba(0, 0, 0, 0.10);
        border-radius: 20px;
        padding: 48px 24px;
        text-align: center;
        cursor: pointer;
        transition: all 0.3s ease;
        background: rgba(255, 255, 255, 0.30);
        position: relative;
      }

      .upload-area:hover {
        border-color: rgba(74, 108, 247, 0.25);
        background: rgba(255, 255, 255, 0.45);
      }

      .upload-area.dragover {
        border-color: #4a6cf7;
        background: rgba(74, 108, 247, 0.06);
        transform: scale(1.005);
        box-shadow: 0 0 0 4px rgba(74, 108, 247, 0.04);
      }

      .upload-icon {
        font-size: 3.6em;
        color: #4a6cf7;
        margin-bottom: 12px;
        display: block;
        opacity: 0.8;
        transition: transform 0.3s ease;
      }

      .upload-area:hover .upload-icon {
        transform: translateY(-4px);
      }

      .upload-area p {
        font-size: 1.05em;
        color: #444;
        font-weight: 500;
      }

      .upload-area p small {
        display: block;
        font-size: 0.82em;
        color: #999;
        font-weight: 400;
        margin-top: 4px;
      }

      .upload-area input[type="file"] {
        display: none;
      }

      /* ===== 工具栏（存储 + WebP） ===== */
      .toolbar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 16px 24px;
        margin: 20px 0 0;
        padding: 14px 18px;
        background: rgba(255, 255, 255, 0.35);
        border-radius: 16px;
        border: 1px solid rgba(255, 255, 255, 0.4);
      }

      .toolbar-group {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
      }

      .toolbar-group label {
        font-size: 0.85em;
        font-weight: 500;
        color: #555;
        display: flex;
        align-items: center;
        gap: 5px;
      }

      .toolbar-group select {
        padding: 7px 32px 7px 12px;
        border-radius: 10px;
        border: 1px solid rgba(0, 0, 0, 0.08);
        background: rgba(255, 255, 255, 0.7);
        font-size: 0.9em;
        color: #333;
        cursor: pointer;
        outline: none;
        transition: all 0.2s ease;
        font-family: inherit;
        appearance: none;
        -webkit-appearance: none;
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23999' d='M6 8L1 3h10z'/%3E%3C/svg%3E");
        background-repeat: no-repeat;
        background-position: right 12px center;
        background-size: 12px;
        min-width: 150px;
      }

      .toolbar-group select:focus {
        border-color: #4a6cf7;
        box-shadow: 0 0 0 3px rgba(74, 108, 247, 0.08);
      }

           /* ===== 现代化存储下拉 ===== */
.storage-select-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.storage-select {
  padding: 8px 44px 8px 14px;
  border: 1.5px solid rgba(0,0,0,0.06);
  border-radius: 10px;
  background: rgba(255,255,255,0.6) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23999' d='M6 8L1 3h10z'/%3E%3C/svg%3E") no-repeat right 12px center;
  background-size: 12px;
  font-size: 13px;
  font-weight: 500;
  color: #1a1a2e;
  cursor: pointer;
  outline: none;
  appearance: none;
  -webkit-appearance: none;
  font-family: inherit;
  min-width: 160px;
  transition: none;
}

.storage-select:hover {
  background-color: rgba(255,255,255,0.8);
  border-color: rgba(74,108,247,0.2);
}

.storage-select:focus {
  border-color: #4a6cf7;
  box-shadow: 0 0 0 3px rgba(74,108,247,0.08);
}

.storage-select-wrapper::after {
  display: none;
}

.storage-icons {
  display: none;
  /* 使用 JS 动态更新图标 */
}

/* ===== 现代化 WebP 开关 ===== */
.webp-toggle-modern {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 16px 6px 12px;
  background: rgba(255,255,255,0.35);
  backdrop-filter: blur(4px);
  border-radius: 100px;
  border: 1px solid rgba(255,255,255,0.2);
  transition: all 0.3s ease;
}

.webp-toggle-modern:hover {
  background: rgba(255,255,255,0.5);
  border-color: rgba(74,108,247,0.15);
}

.webp-toggle-modern .toggle-icon {
  color: #4a6cf7;
  font-size: 16px;
  opacity: 0.8;
}

.webp-toggle-modern .toggle-label {
  font-size: 13px;
  font-weight: 500;
  color: #444;
  white-space: nowrap;
}

/* 自定义开关 */
.switch {
  position: relative;
  display: inline-block;
  width: 40px;
  height: 22px;
  flex-shrink: 0;
}

.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.switch .slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: #d1d5db;
  transition: 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  border-radius: 22px;
  box-shadow: inset 0 1px 3px rgba(0,0,0,0.08);
}

.switch .slider::before {
  content: '';
  position: absolute;
  height: 16px;
  width: 16px;
  left: 3px;
  bottom: 3px;
  background: white;
  transition: 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  border-radius: 50%;
  box-shadow: 0 1px 4px rgba(0,0,0,0.12);
}

.switch input:checked + .slider {
  background: linear-gradient(135deg, #4a6cf7, #7c3aed);
}

.switch input:checked + .slider::before {
  transform: translateX(18px);
}

.status-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 12px;
  border-radius: 20px;
  background: rgba(0,0,0,0.04);
  color: #999;
  transition: all 0.3s ease;
  min-width: 32px;
  text-align: center;
}

.status-badge .status-on {
  display: none;
  color: #4a6cf7;
}

.status-badge .status-off {
  display: inline;
  color: #999;
}

.status-badge.active {
  background: rgba(74,108,247,0.08);
}

.status-badge.active .status-on {
  display: inline;
}

.status-badge.active .status-off {
  display: none;
}

/* ===== 现代化文件夹选择器 ===== */
.folder-section-modern {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 4px 4px 12px;
  background: rgba(255,255,255,0.35);
  backdrop-filter: blur(4px);
  border-radius: 100px;
  border: 1px solid rgba(255,255,255,0.2);
  transition: all 0.3s ease;
}

.folder-section-modern:hover {
  background: rgba(255,255,255,0.5);
  border-color: rgba(74,108,247,0.1);
}

.folder-section-modern .folder-icon {
  color: #f59e0b;
  font-size: 15px;
  transition: transform 0.3s ease;
}

.folder-section-modern:hover .folder-icon {
  transform: scale(1.1) rotate(-3deg);
}

.folder-select {
  border: none;
  background: transparent;
  padding: 8px 28px 8px 4px;
  font-size: 13px;
  font-weight: 500;
  color: #333;
  cursor: pointer;
  outline: none;
  appearance: none;
  -webkit-appearance: none;
  font-family: inherit;
  min-width: 100px;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23999' d='M6 8L1 3h10z'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 4px center;
  background-size: 12px;
}

.folder-select:hover {
  color: #1a1a2e;
}

.btn-folder-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 50%;
  background: linear-gradient(135deg, #4a6cf7, #7c3aed);
  color: #fff;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.25s ease;
  flex-shrink: 0;
}

.btn-folder-icon:hover {
  transform: scale(1.1);
  box-shadow: 0 4px 16px rgba(74,108,247,0.3);
}

.btn-folder-icon:active {
  transform: scale(0.92);
}

/* ===== 响应式调整 ===== */
@media (max-width: 768px) {
  .storage-select {
    min-width: 120px;
    font-size: 12px;
    padding: 7px 36px 7px 12px;
  }
  
  .webp-toggle-modern {
    padding: 4px 12px 4px 10px;
    gap: 6px;
  }
  
  .webp-toggle-modern .toggle-label {
    font-size: 12px;
  }
  
  .switch {
    width: 34px;
    height: 20px;
  }
  
  .switch .slider::before {
    height: 14px;
    width: 14px;
  }
  
  .switch input:checked + .slider::before {
    transform: translateX(14px);
  }
  
  .folder-section-modern {
    padding: 3px 3px 3px 10px;
  }
  
  .folder-select {
    font-size: 12px;
    min-width: 70px;
    padding: 6px 24px 6px 4px;
  }
  
  .btn-folder-icon {
    width: 26px;
    height: 26px;
    font-size: 11px;
  }
}

@media (max-width: 480px) {
  .storage-select {
    min-width: 100px;
    font-size: 11px;
    padding: 6px 30px 6px 10px;
  }
  
  .webp-toggle-modern .toggle-label {
    font-size: 11px;
  }
  
  .folder-select {
    font-size: 11px;
    min-width: 60px;
  }
}

      
      /* ===== 上传预览列表 ===== */
      .preview-area {
        margin-top: 20px;
        max-height: 320px;
        overflow-y: auto;
        padding-right: 4px;
      }

      .preview-area::-webkit-scrollbar {
        width: 4px;
      }

      .preview-area::-webkit-scrollbar-track {
        background: rgba(0, 0, 0, 0.03);
        border-radius: 4px;
      }

      .preview-area::-webkit-scrollbar-thumb {
        background: rgba(0, 0, 0, 0.12);
        border-radius: 4px;
      }

      .preview-item {
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 12px 16px;
        background: rgba(255, 255, 255, 0.50);
        border-radius: 14px;
        margin-bottom: 8px;
        border: 1px solid rgba(255, 255, 255, 0.4);
        transition: all 0.2s;
      }

      .preview-item:hover {
        background: rgba(255, 255, 255, 0.70);
      }

      .preview-item .file-thumb {
        width: 48px;
        height: 48px;
        flex-shrink: 0;
        border-radius: 10px;
        overflow: hidden;
        background: rgba(0, 0, 0, 0.04);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.4em;
        color: #888;
      }

      .preview-item .file-thumb img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .preview-item .file-info {
        flex: 1;
        min-width: 0;
      }

      .preview-item .file-info .file-name {
        font-weight: 600;
        font-size: 0.92em;
        color: #1a1a2e;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .preview-item .file-info .file-size {
        font-size: 0.78em;
        color: #999;
      }

      .preview-item .progress-bar {
        height: 6px;
        background: rgba(0, 0, 0, 0.06);
        border-radius: 4px;
        margin-top: 4px;
        overflow: hidden;
        position: relative;
        width: 100%;
        max-width: 200px;
      }

      .preview-item .progress-track {
        height: 100%;
        background: linear-gradient(90deg, #4a6cf7, #7c3aed);
        border-radius: 4px;
        width: 0%;
        transition: width 0.25s ease;
      }

      .preview-item .progress-text {
        font-size: 0.78em;
        font-weight: 500;
        color: #666;
        min-width: 48px;
        text-align: right;
        flex-shrink: 0;
      }

      .preview-item.success .progress-text {
        color: #22b573;
      }

      .preview-item.error .progress-text {
        color: #dc3545;
      }

      /* ===== 统计信息 ===== */
      .upload-stats {
        display: flex;
        justify-content: space-between;
        padding: 12px 4px 4px;
        font-size: 0.85em;
        color: #888;
        border-top: 1px solid rgba(0, 0, 0, 0.04);
        margin-top: 12px;
      }

      .upload-stats .count {
        font-weight: 600;
        color: #333;
      }

      /* ===== URL 文本框 ===== */
      .url-area {
        margin-top: 14px;
      }

      .url-area textarea {
        width: 100%;
        min-height: 80px;
        padding: 14px 16px;
        border: 1px solid rgba(0, 0, 0, 0.06);
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.4);
        font-family: 'SF Mono', 'Fira Code', monospace;
        font-size: 0.82em;
        color: #333;
        resize: vertical;
        transition: border-color 0.2s;
        box-sizing: border-box;
        line-height: 1.6;
      }

      .url-area textarea:focus {
        outline: none;
        border-color: #4a6cf7;
        background: rgba(255, 255, 255, 0.6);
        box-shadow: 0 0 0 4px rgba(74, 108, 247, 0.04);
      }

      /* ===== 操作按钮组 ===== */
      .button-container {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin: 16px 0 6px;
      }

      .button-container .btn {
        padding: 8px 18px;
        border: none;
        border-radius: 12px;
        font-size: 0.85em;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.25s ease;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        background: rgba(255, 255, 255, 0.6);
        color: #444;
        border: 1px solid rgba(0, 0, 0, 0.04);
      }

      .button-container .btn:hover {
        background: rgba(255, 255, 255, 0.9);
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.06);
      }

      .button-container .btn-primary {
        background: #4a6cf7;
        color: #fff;
        border-color: #4a6cf7;
      }

      .button-container .btn-primary:hover {
        background: #3b5de7;
        box-shadow: 0 4px 16px rgba(74, 108, 247, 0.20);
      }

      .button-container .btn-danger {
        background: rgba(220, 53, 69, 0.08);
        color: #dc3545;
        border-color: rgba(220, 53, 69, 0.10);
      }

      .button-container .btn-danger:hover {
        background: #dc3545;
        color: #fff;
        border-color: #dc3545;
        box-shadow: 0 4px 16px rgba(220, 53, 69, 0.15);
      }

      /* ===== 页脚 ===== */
      footer {
        margin-top: 24px;
        text-align: center;
        font-size: 0.8em;
        color: #aaa;
        border-top: 1px solid rgba(0, 0, 0, 0.04);
        padding-top: 18px;
      }

      footer p {
        display: flex;
        justify-content: center;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
        color: #999;
      }

      footer a {
        color: #999;
        text-decoration: none;
        transition: color 0.2s;
      }

      footer a:hover {
        color: #4a6cf7;
      }

      footer .divider {
        color: #ddd;
      }

      footer .heart {
        color: #ff6b6b;
        font-size: 0.85em;
      }

      /* ===== 响应式 ===== */
      @media (max-width: 768px) {
        body {
          padding: 16px;
        }

        .container {
          padding: 24px 20px 20px;
          border-radius: 24px;
        }

        .header-left h1 {
          font-size: 1.3em;
        }

        .header-actions .btn-header span {
          display: none;
        }

        .upload-area {
          padding: 32px 16px;
        }

        .upload-icon {
          font-size: 2.8em;
        }

        .toolbar {
          flex-direction: column;
          align-items: stretch;
          gap: 12px;
          padding: 14px;
        }

        .webp-toggle {
          margin-left: 0;
          justify-content: space-between;
        }

        .button-container .btn {
          padding: 8px 14px;
          font-size: 0.8em;
        }

        .preview-item .progress-bar {
          max-width: 100px;
        }
      }

      @media (max-width: 480px) {
        body {
          padding: 12px;
        }

        .container {
          padding: 18px 14px 16px;
          border-radius: 20px;
        }

        .header {
          flex-direction: column;
          align-items: stretch;
          gap: 10px;
        }

        .header-actions {
          justify-content: flex-start;
        }

        .upload-area {
          padding: 24px 12px;
        }

        .upload-area p {
          font-size: 0.92em;
        }

        .preview-item {
          padding: 10px 12px;
          flex-wrap: wrap;
        }

        .preview-item .file-info {
          flex-basis: 100%;
        }

        .preview-item .progress-text {
          min-width: 36px;
          font-size: 0.7em;
        }

        .url-area textarea {
          min-height: 60px;
          font-size: 0.75em;
          padding: 10px 12px;
        }

        .button-container {
          gap: 6px;
        }

        .button-container .btn {
          padding: 6px 12px;
          font-size: 0.75em;
        }
      }
    </style>
  </head>
  <body>
    <div class="container">
      <!-- ===== 头部 ===== -->
      <div class="header">
        <div class="header-left">
          <h1><i class="fas fa-cloud-upload-alt"></i> 文件上传</h1>
        </div>
        <div class="header-actions">
          <button onclick="setBingBackground()" class="btn-refresh" title="换背景">
            <i class="fas fa-sync-alt"></i>
          </button>
          <a href="/admin" class="btn-header admin"><i class="fas fa-folder-open"></i> <span>管理</span></a>
          <a href="/logout" class="btn-header logout" onclick="return confirm('确定要退出登录吗？')">
            <i class="fas fa-sign-out-alt"></i> <span>退出</span>
          </a>
        </div>
      </div>

      <!-- ===== 上传区域 ===== -->
      <div class="upload-area" id="uploadArea">
        <i class="fas fa-cloud-upload-alt upload-icon"></i>
        <p>点击选择 或 拖拽文件到此处<br><small>支持 Ctrl+V 粘贴上传</small></p>
        <input type="file" id="fileInput" multiple>
      </div>

      <!-- ===== 工具栏 ===== -->
      <div class="toolbar">
        <div class="toolbar-group">
  <span class="group-label"><i class="fas fa-database"></i> 存储</span>
  <div class="storage-select-wrapper">
    <select id="storageMode" class="storage-select">
      <option value="telegram">Telegram</option>
      <option value="r2">Cloudflare R2</option>
      <option value="github">GitHub</option>
    </select>
    <div class="storage-icons">
      <span class="storage-option" data-value="telegram"><i class="fab fa-telegram-plane"></i></span>
      <span class="storage-option" data-value="r2"><i class="fas fa-cloud-upload-alt"></i></span>
      <span class="storage-option" data-value="github"><i class="fab fa-github"></i></span>
    </div>
  </div>
</div>

        <div class="webp-toggle-modern">
  <i class="fas fa-image toggle-icon"></i>
  <span class="toggle-label">WebP 转换</span>
  <label class="switch">
    <input type="checkbox" id="webpToggle">
    <span class="slider round"></span>
  </label>
  <span class="status-badge" id="webpStatus">
    <span class="status-off">关闭</span>
    <span class="status-on">开启</span>
  </span>
</div>

        <div class="folder-section-modern">
  <i class="fas fa-folder-open folder-icon"></i>
  <select id="folderSelect" class="folder-select">
    <option value="">根目录</option>
  </select>
  <button type="button" id="createFolderBtn" class="btn-folder-icon" title="新建文件夹">
    <i class="fas fa-plus"></i>
  </button>
</div>
      </div>

      <!-- ===== 上传列表 ===== -->
      <div class="preview-area" id="previewArea"></div>

      <!-- ===== 统计 ===== -->
      <div class="upload-stats">
        <span>已上传: <span class="count" id="uploadCount">0</span> 个</span>
        <span>总大小: <span class="count" id="totalSize">0 B</span></span>
      </div>

      <!-- ===== URL 输出 ===== -->
      <div class="url-area">
        <textarea id="urlArea" readonly placeholder="上传完成后的链接将显示在这里"></textarea>
      </div>

      <!-- ===== 操作按钮 ===== -->
      <div class="button-container">
        <button class="btn btn-primary" onclick="copyUrls('url')"><i class="fas fa-copy"></i> 复制URL</button>
        <button class="btn btn-primary" onclick="copyUrls('markdown')"><i class="fas fa-code"></i> Markdown</button>
        <button class="btn btn-primary" onclick="copyUrls('html')"><i class="fas fa-code"></i> HTML</button>
        <button class="btn btn-primary" onclick="copyUrls('bbcode')"><i class="fas fa-code"></i> BBCode</button>
        <button class="btn btn-danger" onclick="clearAll()"><i class="fas fa-trash"></i> 清空</button>
      </div>

      <!-- ===== 页脚 ===== -->
      <footer>
        <p>
          <i class="fas fa-copyright"></i> 2025
          <a href="https://github.com/chnbsdan/CF-tgbed" target="_blank">CF-TGBed</a>
          <span class="divider">|</span>
          <i class="fas fa-heart" style="color: #402cf7ff; font-size: 0.85em;"></i>
          <a href="https://github.com/chnbsdan" target="_blank">@chnbsdan</a>
        </p>
      </footer>
    </div>

    <script>
      // ============================================================
      // 以下 JS 代码与原版完全一致，未做任何功能改动
      // ============================================================

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

      // ---- WebP 转换 ----
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
  const statusBadge = document.getElementById('webpStatus');
  if (enableWebP) {
    statusBadge.classList.add('active');
  } else {
    statusBadge.classList.remove('active');
  }
});

// 存储选项的图标同步（可选）
document.getElementById('storageMode')?.addEventListener('change', function() {
  const selected = this.value;
  const icons = document.querySelectorAll('.storage-option');
  icons.forEach(icon => {
    icon.style.opacity = icon.dataset.value === selected ? '1' : '0.3';
    icon.style.transform = icon.dataset.value === selected ? 'scale(1.2)' : 'scale(1)';
  });
});

      // ---- 加载配置 ----
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

      // ---- 背景图 ----
      async function setBingBackground() {
        try {
          var imageUrl = 'https://pico.1356666.xyz/api/wallpaper?t=' + Date.now();
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

      // ---- 工具函数 ----
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

      // ---- 创建预览项 ----
      function createPreview(file) {
        const div = document.createElement('div');
        div.className = 'preview-item';

        const thumb = document.createElement('div');
        thumb.className = 'file-thumb';
        if (file.type && file.type.startsWith('image/')) {
          const img = document.createElement('img');
          img.src = URL.createObjectURL(file);
          img.onload = () => URL.revokeObjectURL(img.src);
          thumb.appendChild(img);
        } else {
          thumb.innerHTML = '<i class="fas fa-file"></i>';
        }
        div.appendChild(thumb);

        const info = document.createElement('div');
        info.className = 'file-info';
        info.innerHTML = \`
          <div class="file-name">\${file.name}</div>
          <div class="file-size">\${formatSize(file.size)}</div>
          <div class="progress-bar">
            <div class="progress-track"></div>
          </div>
        \`;
        div.appendChild(info);

        const text = document.createElement('span');
        text.className = 'progress-text';
        text.textContent = '0%';
        div.appendChild(text);

        return div;
      }

      // ---- 上传单个文件 ----
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
              progressText.textContent = data.msg || '✓ 完成';
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
        formData.append('folderId', document.getElementById('folderSelect')?.value || '');
        xhr.open('POST', '/upload');
        xhr.send(formData);
      }

      // ---- 处理文件列表 ----
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

      // ---- 拖拽处理 ----
      function handleDrop(e) {
        const dt = e.dataTransfer;
        const files = dt.files;
        handleFiles({ target: { files } });
      }

      // ---- 复制链接 ----
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

      // ---- 清空 ----
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

      // ---- 事件绑定 ----
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

      // ---- 暴露全局函数 ----
      window.copyUrls = copyUrls;
      window.clearAll = clearAll;
      window.setBingBackground = setBingBackground;

          // ---- 文件夹管理 ----
      async function loadFolders() {
        try {
          const response = await fetch('/api/folders');
          const data = await response.json();
          if (data.success) {
            const select = document.getElementById('folderSelect');
            if (!select) return;
            select.innerHTML = '<option value="">根目录</option>';
            data.folders.forEach(folder => {
              const option = document.createElement('option');
              option.value = folder.id;
              option.textContent = folder.name;
              select.appendChild(option);
            });
          }
        } catch (e) {
          console.error('加载文件夹失败:', e);
        }
      }

      // 创建文件夹
      document.getElementById('createFolderBtn')?.addEventListener('click', async function() {
        const folderName = prompt('请输入文件夹名称：');
        if (!folderName || folderName.trim() === '') return;
        
        try {
          const response = await fetch('/api/folders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: folderName.trim() })
          });
          const data = await response.json();
          if (data.success) {
            alert('文件夹创建成功 ✅');
            loadFolders();
          } else {
            alert(data.error || '创建失败');
          }
        } catch (e) {
          alert('创建失败: ' + e.message);
        }
      });

      // 在初始化时加载文件夹
      loadFolders();
   

      // ---- 初始化 ----
      loadConfig();
      setBingBackground();
      setInterval(setBingBackground, 3600000);
    </script>
  </body>
  </html>`;
}

// ============================================================
// 28. 管理页面（自由缩放预览版 + 景深背景 + 管理员功能）
// ============================================================
function generateAdminPage(fileCards, previewModal, qrModal, batchToolbar, userManagementHtml) {
  return `<!DOCTYPE html>
  <html lang="zh-CN">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>文件管理 | CF-TGBed</title>
    <link rel="shortcut icon" href="https://img.hangdn.com/favicon.ico" type="image/x-icon">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
      /* ===== 全局重置 & 基础 ===== */
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body {
        min-height: 100vh;
        padding: 24px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        background: #f0f2f5;
        background-size: cover;
        background-position: center;
        background-repeat: no-repeat;
        background-attachment: fixed;
      }

      .container {
        max-width: 1400px;
        margin: 0 auto;
      }

      /* ===== 头部（毛玻璃） ===== */
      .header {
        background: rgba(255, 255, 255, 0.72);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        border-radius: 20px;
        padding: 18px 24px;
        border: 1px solid rgba(255, 255, 255, 0.5);
        box-shadow: 0 4px 24px rgba(0, 0, 0, 0.06);
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 12px;
        margin-bottom: 20px;
      }

      .header h2 {
        margin: 0;
        font-size: 1.3em;
        font-weight: 700;
        color: #1a1a2e;
        display: flex;
        align-items: center;
        gap: 8px;
        flex: 1;
        min-width: 0;
      }

      .header h2 i {
        color: #4a6cf7;
        background: linear-gradient(135deg, #4a6cf7, #7c3aed);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
      }

      .header-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }

      .btn-refresh {
        width: 36px;
        height: 36px;
        border-radius: 50%;
        border: 1px solid rgba(0, 0, 0, 0.06);
        background: rgba(255, 255, 255, 0.6);
        color: #555;
        cursor: pointer;
        font-size: 14px;
        transition: all 0.3s ease;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .btn-refresh:hover {
        background: rgba(255, 255, 255, 0.9);
        transform: rotate(180deg);
        color: #4a6cf7;
        border-color: rgba(74, 108, 247, 0.2);
      }

      .btn-header {
        padding: 7px 16px;
        border-radius: 10px;
        border: none;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.25s ease;
        text-decoration: none;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        background: rgba(255, 255, 255, 0.6);
        color: #333;
        border: 1px solid rgba(0, 0, 0, 0.06);
      }

      .btn-header:hover {
        background: rgba(255, 255, 255, 0.9);
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.06);
      }

      .btn-header.primary {
        background: #4a6cf7;
        color: #fff;
        border-color: #4a6cf7;
      }

      .btn-header.primary:hover {
        background: #3b5de7;
        box-shadow: 0 4px 16px rgba(74, 108, 247, 0.25);
      }

      .btn-header.danger {
        background: rgba(220, 53, 69, 0.08);
        color: #dc3545;
        border-color: rgba(220, 53, 69, 0.10);
      }

      .btn-header.danger:hover {
        background: #dc3545;
        color: #fff;
        border-color: #dc3545;
        box-shadow: 0 4px 16px rgba(220, 53, 69, 0.15);
      }

      .header .search {
        flex: 1 1 100%;
        max-width: 100%;
        padding: 10px 16px;
        border: 1px solid rgba(0, 0, 0, 0.06);
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.5);
        font-size: 14px;
        transition: all 0.2s;
        outline: none;
        font-family: inherit;
      }

      .header .search:focus {
  border-color: transparent;
  background: rgba(255, 255, 255, 0.8);
  box-shadow: none;
}

      @media (min-width: 768px) {
        .header { flex-wrap: nowrap; }
        .header .search { flex: unset; width: 260px; }
      }

      /* ===== 视图控制 ===== */
      .view-controls {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 10px 16px;
        background: rgba(255, 255, 255, 0.50);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        border-radius: 14px;
        border: 1px solid rgba(255, 255, 255, 0.4);
        margin-bottom: 16px;
        flex-wrap: wrap;
      }

      .view-controls .view-label {
        font-size: 12px;
        color: #666;/* ← "视图"文字的颜色 */
        margin-right: 4px;
        font-weight: 500;
      }

      .view-controls .view-btn {
        padding: 5px 14px;
        border: 1px solid rgba(0, 0, 0, 0.04);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.4);
        cursor: pointer;
        font-size: 12px;
        transition: all 0.2s ease;
        color: #666;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-family: inherit;
      }

      .view-controls .view-btn:hover {
        background: rgba(255, 255, 255, 0.8);
        border-color: rgba(0, 0, 0, 0.08);
      }

      .view-controls .view-btn.active {
  background: linear-gradient(135deg, #4a6cf7, #7c3aed);
  color: #fff;
  border-color: #4a6cf7;
  box-shadow: 0 2px 12px rgba(74, 108, 247, 0.25);
}

      /* ===== 批量工具栏 ===== */
      .batch-toolbar {
        background: rgba(255, 255, 255, 0.72);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        padding: 12px 20px;
        border-radius: 14px;
        border: 1px solid rgba(255, 255, 255, 0.5);
        margin-bottom: 16px;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
      }

      .batch-toolbar #selectedCount {
        font-weight: 600;
        color: #1a1a2e;
        font-size: 14px;
      }

      .batch-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }

      .batch-actions .btn {
  padding: 6px 14px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 8px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  transition: all 0.2s ease;
  color: #f7f2f2ff;
  background: rgba(18, 30, 201, 0.7);
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-family: inherit;
}

.batch-actions .btn:hover {
  background: rgba(231, 39, 39, 0.95);
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.batch-toolbar.has-selection .btn-copy { background: #4a6cf7; color: #fff; border-color: #4a6cf7; }
.batch-toolbar.has-selection .btn-copy:hover { background: #3b5de7; }
.batch-toolbar.has-selection .btn-delete { background: #dc3545; color: #fff; border-color: #dc3545; }
.batch-toolbar.has-selection .btn-delete:hover { background: #c82333; }
.batch-toolbar.has-selection .btn-select { background: #22b573; color: #fff; border-color: #22b573; }
.batch-toolbar.has-selection .btn-select:hover { background: #1a9e63; }
.batch-toolbar.has-selection .btn-clear { background: #6c757d; color: #fff; border-color: #6c757d; }
.batch-toolbar.has-selection .btn-clear:hover { background: #5a6268; }

      /* ===== 文件网格 ===== */
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
        gap: 18px;
      }

      /* ===== 文件卡片 ===== */
      .file-card {
        background: rgba(255, 255, 255, 0.72);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border-radius: 16px;
        border: 1px solid rgba(255, 255, 255, 0.5);
        box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
        overflow: hidden;
        position: relative;
        transition: all 0.3s ease;
      }

      .file-card:hover {
        transform: translateY(-4px);
        box-shadow: 0 8px 28px rgba(0, 0, 0, 0.08);
        border-color: rgba(255, 255, 255, 0.8);
      }

      .file-card.selected {
        border-color: #4a6cf7;
        box-shadow: 0 0 0 2px rgba(74, 108, 247, 0.15), 0 8px 28px rgba(0, 0, 0, 0.08);
      }

      .file-card .file-checkbox {
        position: absolute;
        top: 10px;
        left: 10px;
        z-index: 10;
        width: 18px;
        height: 18px;
        cursor: pointer;
        accent-color: #4a6cf7;
        border-radius: 4px;
      }

      .file-preview {
        height: 160px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0, 0, 0, 0.02);
        cursor: pointer;
        overflow: hidden;
        position: relative;
      }

      .file-preview img {
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
        transition: transform 0.4s ease;
      }

      .file-preview img:hover { transform: scale(1.04); }

      .file-preview video {
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
      }

      .file-preview .file-icon {
        font-size: 44px;
        color: #bbb;
      }

      .file-info {
        padding: 10px 14px 6px;
      }

      .file-info .file-name {
        font-weight: 600;
        font-size: 13px;
        color: #1a1a2e;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        margin-bottom: 2px;
      }

      .file-info .file-meta {
        font-size: 11px;
        color: #999;
      }

      .storage-badge {
        font-size: 9px;
        padding: 2px 8px;
        border-radius: 20px;
        margin-left: 4px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.3px;
        display: inline-block;
      }

      .storage-badge.tg { background: rgba(34, 181, 115, 0.12); color: #22b573; }
      .storage-badge.r2 { background: rgba(74, 108, 247, 0.10); color: #4a6cf7; }
      .storage-badge.github { background: rgba(36, 41, 46, 0.08); color: #24292e; }

      .file-actions {
        padding: 8px 14px 12px;
        display: flex;
        justify-content: space-around;
        gap: 4px;
        border-top: 1px solid rgba(0, 0, 0, 0.03);
      }

      .file-actions .btn {
        padding: 5px 10px;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        font-size: 12px;
        transition: all 0.2s ease;
        background: rgba(0, 0, 0, 0.03);
        color: #666;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 32px;
        font-family: inherit;
      }

      .file-actions .btn:hover { transform: scale(1.05); background: rgba(0, 0, 0, 0.06); }
      .file-actions .btn-delete { background: rgba(220, 53, 69, 0.06); color: #dc3545; }
      .file-actions .btn-delete:hover { background: #dc3545; color: #fff; }
      .file-actions .btn-copy { background: rgba(74, 108, 247, 0.06); color: #4a6cf7; }
      .file-actions .btn-copy:hover { background: #4a6cf7; color: #fff; }
      .file-actions .btn-share { background: rgba(23, 162, 184, 0.06); color: #17a2b8; }
      .file-actions .btn-share:hover { background: #17a2b8; color: #fff; }
      .file-actions .btn-open { background: rgba(34, 181, 115, 0.06); color: #22b573; text-decoration: none; }
      .file-actions .btn-open:hover { background: #22b573; color: #fff; }

      /* ===== 视图：列表 ===== */
      .view-list .file-card {
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 10px 16px;
        min-height: 72px;
      }

      .view-list .file-card .file-preview {
        width: 64px;
        height: 64px;
        flex-shrink: 0;
        border-radius: 10px;
        overflow: hidden;
        background: rgba(0, 0, 0, 0.03);
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

      .view-list .file-card .file-info .file-name { font-size: 14px; }
      .view-list .file-card .file-actions { border-top: none; padding: 0; flex-shrink: 0; gap: 4px; }
      .view-list .file-card .file-checkbox { position: relative; top: auto; left: auto; margin-right: 6px; flex-shrink: 0; }

      /* ===== 视图：瀑布流 ===== */
      .view-waterfall {
        column-count: 4;
        column-gap: 18px;
      }

      .view-waterfall .file-card {
        break-inside: avoid;
        margin-bottom: 18px;
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

      .view-waterfall .file-card .file-info { padding: 10px 14px 4px; }
      .view-waterfall .file-card .file-actions { padding: 8px 14px 12px; border-top: 1px solid rgba(0, 0, 0, 0.03); }
      .view-waterfall .file-card .file-checkbox { position: absolute; top: 10px; left: 10px; }

      @media (max-width: 1200px) { .view-waterfall { column-count: 3; } }
      @media (max-width: 768px) { .view-waterfall { column-count: 2; } }
      @media (max-width: 480px) { .view-waterfall { column-count: 1; } }

      /* ===== 空状态 ===== */
      .empty-state {
        text-align: center;
        padding: 60px 20px;
        color: #999;
        grid-column: 1 / -1;
      }

      .empty-state .icon { font-size: 56px; margin-bottom: 16px; color: #ddd; }
      .empty-state h3 { margin: 0 0 6px; color: #666; font-weight: 600; }
      .empty-state p { color: #aaa; font-size: 14px; }

      /* ===== 分页 ===== */
      #pagination {
        display: flex;
        justify-content: center;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px;
        margin: 24px 0 16px;
      }

      #pagination .btn-page {
        padding: 6px 14px;
        border-radius: 8px;
        border: 1px solid rgba(0, 0, 0, 0.04);
        background: rgba(255, 255, 255, 0.5);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        color: #555;
        cursor: pointer;
        transition: all 0.2s;
        min-width: 36px;
        text-align: center;
        font-size: 13px;
        font-family: inherit;
      }

      #pagination .btn-page:hover {
        background: #4a6cf7;
        color: #fff;
        border-color: #4a6cf7;
      }

      #pagination .btn-page.active {
        background: #4a6cf7;
        color: #fff;
        border-color: #4a6cf7;
        cursor: default;
      }

      #pagination .btn-page:disabled {
        opacity: 0.4;
        cursor: not-allowed;
        transform: none !important;
      }

      #pagination .page-info {
        padding: 6px 8px;
        font-size: 13px;
        color: #999;
      }

      /* ============================================================
         景深预览模态框 - 背景模糊
         ============================================================ */
      .modal {
        display: none;
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.12);
        backdrop-filter: blur(6px);
        -webkit-backdrop-filter: blur(6px);
        justify-content: center;
        align-items: center;
        z-index: 1000;
      }

      .modal.active { display: flex; }

      .modal-content {
        background: transparent;
        padding: 0;
        border-radius: 0;
        width: 100vw;
        height: 100vh;
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: none;
        overflow: visible;
      }

      /* 关闭按钮 */
      .modal-close {
        position: fixed;
        top: 20px;
        right: 24px;
        font-size: 28px;
        color: rgba(255, 255, 255, 0.4);
        cursor: pointer;
        z-index: 1010;
        width: 44px;
        height: 44px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        background: rgba(0, 0, 0, 0.15);
        backdrop-filter: blur(4px);
        -webkit-backdrop-filter: blur(4px);
        border: 1px solid rgba(255, 255, 255, 0.06);
        transition: all 0.25s ease;
        font-family: inherit;
        line-height: 1;
        padding: 0;
      }

      .modal-close:hover {
        color: #fff;
        background: rgba(0, 0, 0, 0.4);
        transform: scale(1.05);
      }

      /* 图片容器 - 完全自由，无任何限制 */
      .preview-wrapper {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: grab;
        user-select: none;
        -webkit-user-select: none;
        background: transparent;
        overflow: visible !important;
        position: relative;
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
        overflow: visible !important;
        padding: 20px;
        position: relative;
      }

      /* 图片本身：默认适配屏幕，缩放后可以自由放大 */
      #previewImage {
        max-width: 95vw;
        max-height: 88vh;
        width: auto;
        height: auto;
        object-fit: contain;
        user-select: none;
        -webkit-user-drag: none;
        pointer-events: none;
        border-radius: 12px;
        box-shadow: 0 8px 40px rgba(0, 0, 0, 0.12);
        transition: transform 0.05s linear;
        will-change: transform;
        transform-origin: center center;
      }

      /* 底部工具栏 - 固定在屏幕底部 */
      .preview-toolbar {
        display: flex !important;
        justify-content: space-between;
        align-items: center;
        padding: 10px 20px;
        background: rgba(0, 0, 0, 0.20);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border-radius: 16px;
        gap: 12px;
        flex-wrap: wrap;
        border: 1px solid rgba(255, 255, 255, 0.04);
        position: fixed;
        bottom: 30px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 1010;
        max-width: 90vw;
        min-width: 200px;
        justify-content: center;
      }

      .preview-filename {
        color: rgba(255, 255, 255, 0.70);
        font-size: 13px;
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 200px;
      }

      .preview-actions {
        display: flex;
        gap: 4px;
        flex-wrap: wrap;
      }

      .preview-actions button {
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.04);
        color: rgba(255, 255, 255, 0.50);
        width: 34px;
        height: 34px;
        border-radius: 50%;
        cursor: pointer;
        font-size: 13px;
        transition: all 0.2s ease;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: inherit;
      }

      .preview-actions button:hover {
        background: rgba(255, 255, 255, 0.10);
        color: #fff;
        transform: scale(1.05);
      }

      .preview-actions .preview-delete:hover {
        background: #dc3545;
        border-color: #dc3545;
        color: #fff;
      }

      /* 隐藏缩放提示 */
      .zoom-hint {
        display: none !important;
      }

      /* ===== 二维码模态框 ===== */
      .qr-content {
        background: rgba(255, 255, 255, 0.90);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        padding: 32px 36px 28px;
        border-radius: 24px;
        text-align: center;
        min-width: 260px;
        border: 1px solid rgba(255, 255, 255, 0.5);
        box-shadow: 0 16px 48px rgba(0, 0, 0, 0.15);
      }

      .qr-content .modal-close {
        position: absolute;
        top: 10px;
        right: 14px;
        color: #888;
        background: rgba(0, 0, 0, 0.04);
        border: none;
        width: 34px;
        height: 34px;
        font-size: 22px;
      }

      .qr-content .modal-close:hover { color: #dc3545; background: rgba(220, 53, 69, 0.06); }

      #qrcode { margin: 16px auto; display: flex; justify-content: center; }

      .qr-buttons {
        display: flex;
        gap: 10px;
        justify-content: center;
        margin-top: 16px;
        flex-wrap: wrap;
      }

      .qr-buttons button {
        padding: 8px 24px;
        border: none;
        border-radius: 10px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 500;
        transition: all 0.2s;
        color: #fff;
        font-family: inherit;
      }

      .qr-copy { background: #4a6cf7; }
      .qr-copy:hover { background: #3b5de7; transform: translateY(-1px); box-shadow: 0 4px 12px rgba(74, 108, 247, 0.25); }
      .qr-close { background: #6c757d; }
      .qr-close:hover { background: #5a6268; transform: translateY(-1px); }

      /* ===== 页脚 ===== */
      footer {
        margin-top: 28px;
        text-align: center;
        font-size: 0.8em;
        color: #aaa;
        padding-top: 16px;
        border-top: 1px solid rgba(255, 255, 255, 0.2);
      }

      footer p {
        display: flex;
        justify-content: center;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
        color: #999;
      }

      footer a {
        color: #999;
        text-decoration: none;
        transition: color 0.2s;
      }

      footer a:hover { color: #4a6cf7; }

      footer .divider { color: #ddd; }
      footer .heart { color: #ff6b6b; font-size: 0.85em; }

      /* ===== 响应式 ===== */
      @media (max-width: 768px) {
        body { padding: 16px; }
        .header { padding: 14px 16px; border-radius: 16px; }
        .header h2 { font-size: 1.1em; }
        .header-actions .btn-header span { display: none; }
        .grid { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; }
        .file-preview { height: 120px; }
        .batch-toolbar { flex-direction: column; align-items: stretch; gap: 8px; padding: 14px 16px; }
        .batch-actions { justify-content: center; }
        .view-controls .view-label { display: none; }
        .view-controls .view-btn { padding: 4px 10px; font-size: 11px; }
        .modal-close { top: 14px; right: 16px; width: 38px; height: 38px; font-size: 22px; }
        #previewImage { border-radius: 16px; }
        .preview-toolbar {
          bottom: 20px;
          padding: 8px 14px;
          min-width: unset;
          width: auto;
          max-width: 95vw;
        }
        .preview-filename { max-width: 120px; font-size: 12px; }
        .preview-actions button { width: 30px; height: 30px; font-size: 11px; }
        .qr-content { padding: 24px 20px; min-width: auto; width: 90%; }
      }

      @media (max-width: 480px) {
        body { padding: 12px; }
        .grid { grid-template-columns: 1fr 1fr; gap: 10px; }
        .file-preview { height: 100px; }
        .file-info .file-name { font-size: 11px; }
        .file-actions .btn { font-size: 10px; padding: 4px 6px; min-width: 26px; }
        .view-list .file-card { padding: 8px 12px; gap: 10px; }
        .view-list .file-card .file-preview { width: 48px; height: 48px; }
        .batch-actions .btn { font-size: 11px; padding: 4px 10px; }
        .header .search { font-size: 12px; padding: 8px 12px; }
        .modal-close { top: 10px; right: 12px; width: 34px; height: 34px; font-size: 18px; }
        #previewImage { border-radius: 12px; }
        .preview-toolbar {
          bottom: 14px;
          padding: 6px 12px;
          gap: 6px;
          border-radius: 12px;
        }
        .preview-filename { max-width: 80px; font-size: 11px; }
        .preview-actions button { width: 28px; height: 28px; font-size: 10px; }
        .preview-container { padding: 8px; }
      }
    </style>
  </head>
  <body>
    <div class="container">
      <!-- ===== 头部 ===== -->
      <div class="header">
        <h2><i class="fas fa-folder-open"></i> 文件管理</h2>
        <div class="header-actions">
          <button onclick="setBingBackground()" class="btn-refresh" title="换背景">
            <i class="fas fa-sync-alt"></i>
          </button>
          <a href="/upload" class="btn-header primary"><i class="fas fa-upload"></i> <span>上传</span></a>
          <a href="/logout" class="btn-header danger" onclick="return confirm('确定要退出登录吗？')">
            <i class="fas fa-sign-out-alt"></i> <span>退出</span>
          </a>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex:1;background:rgba(255,255,255,0.5);border-radius:12px;padding:0 16px;border:1px solid rgba(0,0,0,0.06);">
  <i class="fas fa-search" style="color:#999;font-size:14px;"></i>
  <input type="text" class="search" placeholder="搜索文件..." id="searchInput" style="flex:1;border:none;outline:none;background:transparent;padding:10px 0;font-size:14px;font-family:inherit;">
</div>
        <select id="folderFilter" style="padding:8px 14px;border-radius:10px;border:1px solid rgba(0,0,0,0.06);background:rgba(255,255,255,0.5);font-size:14px;outline:none;cursor:pointer;">
          <option value="">所有文件夹</option>
        </select>
      </div>

      <!-- ===== 视图控制 ===== -->
      <div class="view-controls">
        <span class="view-label"><i class="fas fa-eye"></i> 视图</span>
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

      <!-- ===== 批量工具栏 ===== -->
      ${batchToolbar}

      <!-- ===== 用户管理面板（仅管理员可见） ===== -->
      ${userManagementHtml || ''}

      <!-- ===== 文件列表 ===== -->
      <div class="grid view-grid" id="fileGrid">
        ${fileCards || '<div class="empty-state"><div class="icon"><i class="fas fa-inbox"></i></div><h3>暂无文件</h3><p>上传一些文件开始使用吧</p></div>'}
      </div>

      <!-- ===== 分页 ===== -->
      <div id="pagination"></div>

      <!-- ===== 模态框 ===== -->
      ${previewModal}
      ${qrModal}

      <!-- ===== 页脚 ===== -->
      <footer>
        <p>
          <i class="fas fa-copyright"></i> 2025
          <a href="https://github.com/chnbsdan/CF-tgbed" target="_blank">CF-TGBed</a>
          <span class="divider">|</span>
          <i class="fas fa-heart" style="color: #402cf7ff; font-size: 0.85em;"></i>
          <a href="https://github.com/chnbsdan" target="_blank">@chnbsdan</a>
        </p>
      </footer>
    </div>

    <!-- ============================================================ -->
    <!-- 以下 JS 代码与原版完全一致，未做任何功能改动                 -->
    <!-- ============================================================ -->
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

        grid.className = 'grid';
        grid.classList.add('view-' + view);

        btns.forEach(btn => {
          btn.classList.toggle('active', btn.dataset.view === view);
        });

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
          var imageUrl = 'https://pico.1356666.xyz/api/wallpaper?t=' + Date.now();
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
  const batchToolbar = document.getElementById('batchToolbar');
  const selectedCountEl = document.querySelector('#batchToolbar span');
  
  if (count > 0) {
    batchToolbar.style.display = 'flex';
    batchToolbar.classList.add('has-selection');
    if (selectedCountEl) selectedCountEl.textContent = '已选择 ' + count + ' 个文件';
  } else {
    batchToolbar.style.display = 'none';
    batchToolbar.classList.remove('has-selection');
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

      // ============ 大图预览 ============
      function openPreview(url) {
        const modal = document.getElementById('previewModal');
        const img = document.getElementById('previewImage');
        const filename = document.getElementById('previewFilename');

        const card = document.querySelector('[data-url="' + url + '"]');
        const nameEl = card ? card.querySelector('.file-name') : null;
        var fileName = nameEl ? nameEl.textContent.replace(/TG|R2|GitHub/g, '').trim() : '未知文件';

        previewScale = 1;
        previewTranslateX = 0;
        previewTranslateY = 0;
        updatePreviewTransform();

        img.src = url;
        currentPreviewUrl = url;
        currentPreviewName = fileName;
        filename.textContent = fileName;

        // 双击图片还原
        img.ondblclick = function(e) {
            e.stopPropagation();
            previewZoomReset();
        };

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

      function closePreviewOnBackdrop(event) {
        if (event.target === event.currentTarget) {
          closePreview();
        }
      }

      function updatePreviewTransform() {
        const img = document.getElementById('previewImage');
        if (!img) return;
        img.style.transform = \`translate(\${previewTranslateX}px, \${previewTranslateY}px) scale(\${previewScale})\`;
      }

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

      function handleWheelZoom(e) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        previewScale = Math.min(Math.max(previewScale + delta, 0.2), 5);
        updatePreviewTransform();
      }

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

      function bindPreviewEvents() {
        const wrapper = document.getElementById('previewWrapper');
        if (!wrapper) return;

        wrapper.addEventListener('wheel', handleWheelZoom, { passive: false });

        wrapper.addEventListener('mousedown', handleDragStart);
        document.addEventListener('mousemove', handleDragMove);
        document.addEventListener('mouseup', handleDragEnd);

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

      // ============ 切换管理员权限 ============
      async function toggleAdmin(userId, username) {
        if (!confirm('确定要切换用户 "' + username + '" 的管理员权限吗？')) return;
        
        try {
          const response = await fetch('/admin/users/toggle-admin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId })
          });
          const data = await response.json();
          
          if (data.success) {
            alert(data.message);
            location.reload();
          } else {
            alert(data.error || '操作失败');
          }
        } catch (err) {
          alert('操作失败: ' + err.message);
        }
      }

      // ============ 切换用户状态 ============
      async function toggleActive(userId, username) {
        if (!confirm('确定要切换用户 "' + username + '" 的启用状态吗？')) return;
        
        try {
          const response = await fetch('/admin/users/toggle-active', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId })
          });
          const data = await response.json();
          
          if (data.success) {
            alert(data.message);
            location.reload();
          } else {
            alert(data.error || '操作失败');
          }
        } catch (err) {
          alert('操作失败: ' + err.message);
        }
      }

      // ============ 加载文件夹筛选列表 ============
      async function loadFolderFilter() {
        try {
          const response = await fetch('/api/folders');
          const data = await response.json();
          if (data.success) {
            const select = document.getElementById('folderFilter');
            if (!select) return;
            select.innerHTML = '<option value="">所有文件夹</option>';
            data.folders.forEach(folder => {
              const option = document.createElement('option');
              option.value = folder.id;
              option.textContent = folder.name;
              select.appendChild(option);
            });
            
            // 恢复当前选中的值
            const urlParams = new URLSearchParams(window.location.search);
            const currentFolder = urlParams.get('folder');
            if (currentFolder) {
              select.value = currentFolder;
            } else {
              select.value = '';
            }
            
            // 监听变化，刷新页面
            select.addEventListener('change', function() {
              const folderId = this.value;
              const currentUrl = new URL(window.location.href);
              if (folderId && folderId !== '') {
                currentUrl.searchParams.set('folder', folderId);
              } else {
                currentUrl.searchParams.delete('folder');
              }
              window.location.href = currentUrl.toString();
            });
          }
        } catch (e) {
          console.error('加载文件夹筛选失败:', e);
        }
      }

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
      window.setBingBackground = setBingBackground;
      window.toggleAdmin = toggleAdmin;
      window.toggleActive = toggleActive;

      // ============ 初始化 ============
      loadFolderFilter();
      restoreView();
      renderPage(currentPage);
    </script>
  </body>
  </html>`;
}
