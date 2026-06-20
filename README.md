<div align="center">
  
# CF-TGBed - Cloudflare Workers 图床服务



![GitHub](https://img.shields.io/badge/Cloudflare-Workers-F38020?style=flat&logo=cloudflare)
![GitHub](https://img.shields.io/badge/Telegram-Bot-26A5E4?style=flat&logo=telegram)
![GitHub](https://img.shields.io/badge/R2-Storage-FF9900?style=flat&logo=amazon-s3)
![GitHub](https://img.shields.io/badge/GitHub-API-181717?style=flat&logo=github)
![License](https://img.shields.io/badge/License-MIT-green)

**基于 Cloudflare Workers 的多后端图床服务**

[功能特性](#-功能特性) • [快速部署](#-快速部署) • [环境变量](#-环境变量) • [使用指南](#-使用指南)

</div>

---

## 📖 项目简介

CF-TGBed 是一个部署在 Cloudflare Workers 上的图床/文件存储服务，支持 **Telegram**、**R2** 和 **GitHub** 三种存储后端，提供完整的文件上传、管理、分享功能。

### ✨ 功能特性

| 功能 | 说明 |
|------|------|
| 📤 **多存储后端** | 支持 Telegram / R2 / GitHub 三种存储方式，用户可自由选择 |
| 🔄 **智能回退** | Telegram 上传失败时自动切换到 R2 备用存储 |
| 🌐 **WebP 转换** | 前端实现图片转 WebP 格式，节省存储空间 |
| 🔐 **认证系统** | 基于 Cookie 的会话认证，支持自定义用户名/密码 |
| 📁 **文件管理** | 完整的后台管理界面，支持分页、搜索、批量操作 |
| 📋 **批量操作** | 批量复制链接、批量删除文件 |
| 🔗 **多种格式** | 支持 URL、Markdown、HTML、BBCode 格式复制 |
| 📱 **二维码分享** | 生成文件链接二维码，方便移动端分享 |
| 🖼️ **文件预览** | 支持图片、视频、音频文件在线预览 |
| 💾 **缓存加速** | 利用 Cloudflare Cache API 加速文件访问 |
| 📊 **上传统计** | 实时显示已上传文件数量和总大小 |
| 🚪 **退出登录** | 支持安全退出，清除会话状态 |

---

## 🏗️ 系统架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        用户浏览器                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Cloudflare Workers                           │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                   路由分发                               │    │
│  │  /upload  /admin  /delete  /batch-delete  /search       │    │
│  └─────────────────────────────────────────────────────────┘    │
│                              │                                  │
│  ┌───────────────────────────────────────────────────────┐      │
│  │                   存储适配层                           │      │
│  ├──────────────┬────────────────┬───────────────────────┤      │
│  │   Telegram   │      R2        │       GitHub          │      │
│  │   (默认)     │   (备用/直传)   │     (仓库存储)         │      │
│  └──────────────┴────────────────┴───────────────────────┘      │
│                              │                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                   数据库 (D1)                           │    │
│  │  存储文件 URL、fileId、类型、存储来源等元数据              │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Cloudflare Cache                            │
│                   (文件缓存加速)                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🚀 快速部署

### 1. 准备工作

| 服务 | 说明 | 是否必须 |
|------|------|----------|
| Cloudflare 账号 | 用于部署 Worker 和 D1 | ✅ 必须 |
| Telegram Bot | [@BotFather](https://t.me/botfather) 创建 | ✅ 必须 |
| Cloudflare D1 | 数据库存储文件元数据 | ✅ 必须 |
| Cloudflare R2 | 对象存储（可选） | ⚪ 可选 |
| GitHub Token | 仓库存储（可选） | ⚪ 可选 |
| 域名 | Cloudflare 托管的域名 | ✅ 必须 |

---

## 📝 详细部署步骤

### 第一步：注册 Cloudflare 账号

1. 访问 [Cloudflare 官网](https://dash.cloudflare.com/sign-up)
2. 点击 "Sign Up" 注册账号
3. 填写邮箱和密码
4. 验证邮箱后登录

### 第二步：添加域名到 Cloudflare

1. 登录 Cloudflare Dashboard
2. 点击 "Add a Site" 或 "添加站点"
3. 输入你的域名（例如：`example.com`）
4. 选择免费计划（Free Plan）
5. Cloudflare 会扫描 DNS 记录
6. 将你的域名注册商处的 NS 记录修改为 Cloudflare 提供的 NS 服务器
7. 等待 DNS 生效（通常 5-30 分钟）

### 第三步：创建 Telegram Bot

1. 在 Telegram 中搜索 [@BotFather](https://t.me/botfather)
2. 发送 `/newbot` 命令
3. 输入 Bot 名称（例如：`我的图床机器人`）
4. 输入 Bot 用户名（必须以 `bot` 结尾，例如：`my_image_host_bot`）
5. 创建成功后，BotFather 会返回 Token
6. **保存 Token**（格式：`1234567890:ABCdefGHIjklMNOpqrsTUVwxyz`）
7. 将 Bot 添加到你的频道或群组
8. 获取 Chat ID：
   - 在群组中发送一条消息
   - 访问：`https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates`
   - 从返回的 JSON 中找到 `chat.id`
   - Chat ID 格式：`-1001234567890`（群组）或 `123456789`（个人）

### 第四步：创建 Cloudflare D1 数据库

#### 方式一：通过 Cloudflare Dashboard（推荐新手）

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 点击左侧菜单 "Workers & Pages"
3. 点击 "D1" 选项卡
4. 点击 "Create Database" 或 "创建数据库"
5. 输入数据库名称：`cf-tgbed-db`
6. 选择地域（选择离你最近的地区）
7. 点击 "Create"
8. 创建完成后，记录数据库 ID

#### 方式二：通过 Wrangler CLI

```bash
# 安装 Wrangler
npm install -g wrangler

# 登录 Cloudflare
wrangler login

# 创建数据库
wrangler d1 create cf-tgbed-db

# 输出示例：
# ✅ Successfully created DB 'cf-tgbed-db'
# ┌──────────────────────────────────────────────────────────────────────────┐
# │ name              │ cf-tgbed-db                                          │
# │ database_id       │ 12345678-1234-1234-1234-123456789012                 │
# └──────────────────────────────────────────────────────────────────────────┘
# 保存 database_id，后面需要用到
```

### 第五步：创建 R2 存储桶（可选）

#### 方式一：通过 Cloudflare Dashboard

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 点击 "R2" 菜单
3. 点击 "Create Bucket" 或 "创建存储桶"
4. 输入存储桶名称：`cf-tgbed-images`
5. 选择地域
6. 点击 "Create Bucket"
7. 进入存储桶设置
8. 点击 "Settings" → "Public Access"
9. 开启 "Public Bucket" 公开访问
10. 记录 `R2_PUBLIC_URL`（格式：`https://pub-xxxx.r2.dev`）

#### 方式二：通过 Wrangler CLI

```bash
# 创建 R2 存储桶
wrangler r2 bucket create cf-tgbed-images

# 获取存储桶列表
wrangler r2 bucket list
```

### 第六步：配置 GitHub Token（可选）

1. 登录 [GitHub](https://github.com)
2. 点击右上角头像 → "Settings"
3. 左侧菜单点击 "Developer settings"
4. 点击 "Personal access tokens" → "Tokens (classic)"
5. 点击 "Generate new token" → "Generate new token (classic)"
6. 输入 Token 名称：`CF-TGBed`
7. 选择权限：
   - ✅ `repo` (完整仓库权限)
   - ✅ `workflow` (如需 GitHub Actions)
8. 点击 "Generate token"
9. **立即复制并保存 Token**（刷新后不再显示）
10. 创建用于存储图片的仓库
11. 记录仓库名（格式：`username/repo`，例如：`chnbsdan/cf-tgbed-images`）

### 第七步：创建 Worker 并部署

#### 方式一：通过 Cloudflare Dashboard 部署

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 点击 "Workers & Pages" → "Create Application"
3. 点击 "Create Worker"
4. 输入 Worker 名称：`cf-tgbed`
5. 点击 "Deploy"
6. 进入 Worker 编辑页面
7. 删除默认代码，粘贴项目完整代码
8. 点击 "Save and Deploy"

#### 方式二：通过 Wrangler CLI 部署

```bash
# 克隆项目
git clone https://github.com/chnbsdan/CF-tgbed.git
cd CF-tgbed

# 复制代码文件到 src/index.js
# ... 将完整代码放入 src/index.js

# 安装依赖
npm install

# 部署
wrangler deploy
```

### 第八步：配置环境变量

#### 通过 Dashboard 配置

1. 进入 Worker 详情页面
2. 点击 "Settings" 或 "设置"
3. 点击 "Variables" 或 "变量"
4. 添加以下环境变量：

| 变量名 | 值 | 说明 |
|--------|-----|------|
| `DOMAIN` | `img.example.com` | 你的域名（必须已托管在 Cloudflare） |
| `TG_BOT_TOKEN` | `123456:ABC...` | Telegram Bot Token（使用密钥存储） |
| `TG_CHAT_ID` | `-1001234567890` | Telegram Chat ID |
| `USERNAME` | `admin` | 登录用户名 |
| `PASSWORD` | `your-strong-password` | 登录密码（使用密钥存储） |
| `ENABLE_AUTH` | `true` | 启用认证 |
| `COOKIE` | `7` | Cookie 过期天数 |
| `MAX_SIZE_MB` | `20` | 最大文件大小 |
| `ENABLE_R2_FALLBACK` | `false` | 是否启用 R2 备用（如果配置了 R2） |
| `GITHUB_REPO` | `username/repo` | GitHub 仓库名 |
| `GITHUB_BRANCH` | `main` | GitHub 分支名 |
| `GITHUB_PATH` | `images` | GitHub 存储路径 |

#### 绑定 D1 数据库

1. 在 Worker 详情页点击 "Settings" → "D1 Database Bindings"
2. 点击 "Add binding"
3. 变量名：`DATABASE`
4. 选择数据库：`cf-tgbed-db`
5. 点击 "Save"

#### 绑定 R2 存储桶（可选）

1. 在 Worker 详情页点击 "Settings" → "R2 Bucket Bindings"
2. 点击 "Add binding"
3. 变量名：`R2_BUCKET`
4. 选择存储桶：`cf-tgbed-images`
5. 点击 "Save"

#### 使用密钥存储敏感信息（推荐）

```bash
# 通过 CLI 设置密钥
wrangler secret put TG_BOT_TOKEN
wrangler secret put TG_CHAT_ID
wrangler secret put PASSWORD
wrangler secret put GITHUB_TOKEN
```

### 第九步：配置域名

1. 在 Worker 详情页点击 "Triggers" 或 "触发器"
2. 在 "Routes" 部分点击 "Add Route"
3. 输入：`img.example.com/*`（替换为你的域名）
4. 选择 "Enable Workers" 或 "启用 Workers"
5. 点击 "Save"
6. 等待 DNS 生效（通常 1-5 分钟）

### 第十步：初始化数据库

#### 通过 Dashboard 执行 SQL

1. 进入 D1 数据库管理页面
2. 点击 "Query" 或 "查询"
3. 粘贴以下 SQL：

```sql
CREATE TABLE IF NOT EXISTS files (
  url TEXT PRIMARY KEY,
  fileId TEXT,
  message_id INTEGER,
  created_at INTEGER NOT NULL,
  file_name TEXT,
  file_size INTEGER,
  mime_type TEXT,
  storage_type TEXT DEFAULT 'telegram'
);

CREATE INDEX IF NOT EXISTS idx_files_created_at ON files(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_files_storage_type ON files(storage_type);
CREATE INDEX IF NOT EXISTS idx_files_file_name ON files(file_name);
```

4. 点击 "Execute" 或 "执行"

#### 通过 Wrangler CLI 执行

```bash
# 创建初始化脚本
cat > migrations/001_init.sql << EOF
CREATE TABLE IF NOT EXISTS files (
  url TEXT PRIMARY KEY,
  fileId TEXT,
  message_id INTEGER,
  created_at INTEGER NOT NULL,
  file_name TEXT,
  file_size INTEGER,
  mime_type TEXT,
  storage_type TEXT DEFAULT 'telegram'
);

CREATE INDEX IF NOT EXISTS idx_files_created_at ON files(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_files_storage_type ON files(storage_type);
CREATE INDEX IF NOT EXISTS idx_files_file_name ON files(file_name);
EOF

# 执行初始化
wrangler d1 execute cf-tgbed-db --file=./migrations/001_init.sql
```

---

## ⚙️ 环境变量详细说明

### 必填变量

| 变量名 | 说明 | 示例 | 获取方式 |
|--------|------|------|----------|
| `DOMAIN` | 你的域名 | `img.example.com` | 在 Cloudflare DNS 中已添加的域名 |
| `TG_BOT_TOKEN` | Telegram Bot Token | `123456:ABC-DEF...` | 从 @BotFather 获取 |
| `TG_CHAT_ID` | Telegram Chat ID | `-1001234567890` | 通过 getUpdates API 获取 |
| `DATABASE` | D1 数据库绑定名称 | `DATABASE` | 在 Worker 绑定中设置 |

### 认证相关

| 变量名 | 说明 | 默认值 | 建议 |
|--------|------|--------|------|
| `USERNAME` | 登录用户名 | `admin` | 修改为强用户名 |
| `PASSWORD` | 登录密码 | `admin` | 必须修改为强密码（建议使用密钥存储） |
| `ENABLE_AUTH` | 是否启用认证 | `true` | 生产环境建议保持 `true` |
| `COOKIE` | Cookie 过期天数 | `7` | 根据需要调整 |

### R2 存储

| 变量名 | 说明 | 默认值 | 获取方式 |
|--------|------|--------|----------|
| `R2_BUCKET` | R2 Bucket 绑定名称 | - | 在 Worker 绑定中设置 |
| `R2_PUBLIC_URL` | R2 公开访问 URL | `https://${DOMAIN}` | 在 R2 存储桶设置中获取 |
| `ENABLE_R2_FALLBACK` | 是否启用 R2 备用 | `false` | 设置为 `true` 启用 |

### GitHub 存储

| 变量名 | 说明 | 默认值 | 获取方式 |
|--------|------|--------|----------|
| `GITHUB_TOKEN` | GitHub Personal Access Token | - | GitHub Settings → Developer settings → Tokens |
| `GITHUB_REPO` | 仓库名 | - | `username/repo` 格式 |
| `GITHUB_BRANCH` | 分支名 | `main` | 通常保持默认 |
| `GITHUB_PATH` | 存储路径 | `images` | 自定义 |

### 其他配置

| 变量名 | 说明 | 默认值 | 建议 |
|--------|------|--------|------|
| `MAX_SIZE_MB` | 最大文件大小（MB） | `20` | Telegram 限制 20MB，R2/GitHub 无限制 |

---

## 📖 使用指南

### 访问地址

| 路径 | 说明 |
|------|------|
| `/` 或 `/upload` | 上传页面 |
| `/admin` | 文件管理后台 |
| `/login` | 登录页面 |
| `/logout` | 退出登录 |
| `/config` | 获取配置信息（API） |
| `/bing` | Bing 每日壁纸（API） |
| `/history` | 上传历史（API） |
| `/search` | 搜索文件（API） |
| `/delete` | 删除文件（API） |
| `/batch-delete` | 批量删除（API） |
| `/github/*` | GitHub 文件代理 |

### 上传文件

1. 访问 `https://img.example.com/upload`
2. 输入用户名和密码登录
3. 选择存储方式（TG / R2 / GitHub）
4. 可选：开启 WebP 转换
5. 点击上传区域或拖拽文件
6. 支持 Ctrl+V 粘贴上传
7. 上传完成后自动显示链接
8. 点击 "复制URL" 等按钮复制链接

### 管理文件

1. 访问 `https://img.example.com/admin`
2. 支持：
   - 🔍 搜索文件
   - 📄 分页浏览
   - ✅ 批量选择
   - 📋 批量复制链接
   - 🗑️ 批量删除
   - 🔗 单个复制/打开/分享/删除
   - 🖼️ 点击预览大图
   - 🚪 退出登录

### 退出登录

1. 点击页面右上角的红色 "退出" 按钮
2. 确认退出
3. 会话被清除，跳转到登录页面

### API 接口

#### 上传文件

```http
POST /upload
Content-Type: multipart/form-data

file: <文件>
storageMode: telegram | r2 | github
webp: true | false
```

#### 获取配置

```http
GET /config
```

#### 搜索文件

```http
POST /search
Content-Type: application/json

{
  "query": "关键词"
}
```

#### 删除文件

```http
POST /delete
Content-Type: application/json

{
  "url": "https://example.com/file.jpg"
}
```

#### 批量删除

```http
POST /batch-delete
Content-Type: application/json

{
  "urls": ["url1", "url2", "url3"]
}
```

---

## 📊 存储方式对比

| 特性 | Telegram | R2 | GitHub |
|------|----------|-----|--------|
| 免费额度 | 无限（限制文件大小） | 10GB 存储 / 100万次操作 | 无限（公开仓库） |
| 文件大小限制 | 20MB（默认） | 无限制 | 100MB（单个文件） |
| 访问速度 | 依赖 Telegram CDN | Cloudflare 全球加速 | GitHub CDN |
| 稳定性 | 高 | 极高 | 高 |
| 隐私性 | 公开（任何人可访问） | 可控 | 公开仓库公开 |
| 适用场景 | 小文件、图片 | 大文件、视频 | 代码、文档 |
| 配置难度 | 简单 | 中等 | 中等 |

---

## 🛠️ 技术栈

| 技术 | 用途 |
|------|------|
| **Cloudflare Workers** | 服务端运行环境 |
| **Cloudflare D1** | SQLite 数据库，存储文件元数据 |
| **Cloudflare R2** | S3 兼容对象存储 |
| **Telegram Bot API** | 文件存储后端 |
| **GitHub API** | 文件存储后端 |
| **QRCode.js** | 二维码生成 |
| **Font Awesome** | 图标库 |
| **原生 JavaScript** | 前端交互 |

---

## 📁 项目结构

```
CF-tgbed/
├── src/
│   └── index.js          # 主代码文件
├── migrations/
│   └── 001_init.sql      # 数据库初始化脚本
├── .gitignore            # Git 忽略文件
├── .env.example          # 环境变量示例
├── package.json          # 项目配置
├── wrangler.toml         # Cloudflare 配置文件
└── README.md             # 项目说明
```

---

## 🔧 开发指南

### 本地开发

```bash
# 安装依赖
npm install

# 本地运行（需要 Cloudflare 账号）
wrangler dev

# 查看日志
wrangler tail

# 部署到生产
wrangler deploy
```

### 数据库迁移

```bash
# 执行 SQL
wrangler d1 execute cf-tgbed-db --file=./migrations/001_init.sql

# 执行单条 SQL
wrangler d1 execute cf-tgbed-db --command "SELECT * FROM files"
```

### 调试技巧

1. 使用 `console.log()` 在 Worker 中输出日志
2. 通过 `wrangler tail` 实时查看日志
3. 在 Dashboard 的 "Logs" 标签查看历史日志

---

## ❓ 常见问题

### Q: 上传失败怎么办？

1. 检查是否超过文件大小限制（默认 20MB）
2. 检查存储方式配置是否正确
3. 查看 Cloudflare Worker 日志
4. 检查 Telegram Bot Token 和 Chat ID 是否正确

### Q: 如何获取 Telegram Chat ID？

1. 将 Bot 添加到频道/群组
2. 发送一条消息
3. 访问 `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates`
4. 从返回的 JSON 中获取 `chat.id`

### Q: GitHub 上传失败？

1. 检查 Token 权限是否包含 `repo`
2. 检查仓库是否存在
3. 检查是否达到速率限制
4. 检查文件是否超过 100MB 限制

### Q: 如何清空所有数据？

```bash
# 通过 CLI
wrangler d1 execute cf-tgbed-db --command "DELETE FROM files;"
```

### Q: 如何重置密码？

1. 在 Cloudflare Dashboard 中修改 `PASSWORD` 环境变量
2. 重新部署 Worker

### Q: 忘记登录密码怎么办？

1. 登录 Cloudflare Dashboard
2. 进入 Worker 设置
3. 修改 `PASSWORD` 环境变量
4. 保存并部署

### Q: 如何更新代码？

1. 修改 `src/index.js` 文件
2. 运行 `wrangler deploy` 重新部署
3. 代码会自动更新

---

## 📄 License

[MIT](LICENSE) © 2025 Chnbsdan

---

## 🙏 致谢

- [Cloudflare](https://cloudflare.com) - 提供 Workers、D1、R2 服务
- [Telegram](https://telegram.org) - 提供 Bot API
- [Font Awesome](https://fontawesome.com) - 图标库
- [QRCode.js](https://github.com/davidshimjs/qrcodejs) - 二维码生成

---

## 📞 联系方式

- GitHub: [@chnbsdan](https://github.com/chnbsdan)
- Blog: [Hangdn Notes](https://aoso.hangdn.com)

---

<div align="center">

**⭐ 如果这个项目对你有帮助，请点个 Star 支持一下！**

</div>
