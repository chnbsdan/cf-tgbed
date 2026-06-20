# CF-TGBed - Cloudflare Workers 图床服务

<div align="center">

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

---

## 🏗️ 系统架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        用户浏览器                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Cloudflare Workers                          │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   路由分发                              │   │
│  │  /upload  /admin  /delete  /batch-delete  /search     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   存储适配层                            │   │
│  ├──────────────┬────────────────┬───────────────────────┤   │
│  │   Telegram   │      R2        │       GitHub          │   │
│  │   (默认)     │   (备用/直传)  │     (仓库存储)        │   │
│  └──────────────┴────────────────┴───────────────────────┘   │
│                              │                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   数据库 (D1)                          │   │
│  │  存储文件 URL、fileId、类型、存储来源等元数据          │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Cloudflare Cache                           │
│                   (文件缓存加速)                                │
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

### 2. 部署步骤

#### 步骤 1：创建 D1 数据库

```bash
# 创建数据库
wrangler d1 create cf-tgbed-db

# 创建表
wrangler d1 execute cf-tgbed-db --command "
CREATE TABLE IF NOT EXISTS files (
  url TEXT PRIMARY KEY,
  fileId TEXT,
  message_id INTEGER,
  created_at INTEGER NOT NULL,
  file_name TEXT,
  file_size INTEGER,
  mime_type TEXT,
  storage_type TEXT DEFAULT 'telegram'
)"
```

#### 步骤 2：创建 Telegram Bot

1. 在 Telegram 中搜索 [@BotFather](https://t.me/botfather)
2. 发送 `/newbot` 创建机器人
3. 获取 Bot Token（格式：`123456:ABC-DEF...`）
4. 将 Bot 添加到你的频道/群组，获取 Chat ID

#### 步骤 3：配置 R2（可选）

```bash
# 创建 R2 Bucket
wrangler r2 bucket create cf-tgbed-images

# 绑定到 Worker
# 在 wrangler.toml 中添加配置
```

#### 步骤 4：配置 GitHub（可选）

1. 访问 GitHub Settings → Developer settings → Personal access tokens
2. 生成 Token，权限选择 `repo`
3. 创建仓库用于存储文件

#### 步骤 5：部署 Worker

```bash
# 克隆项目
git clone https://github.com/chnbsdan/CF-tgbed.git
cd CF-tgbed

# 安装依赖（如有）
npm install

# 部署
wrangler deploy
```

---

## ⚙️ 环境变量

### 必填变量

| 变量名 | 说明 | 示例 |
|--------|------|------|
| `DOMAIN` | 你的域名 | `img.example.com` |
| `TG_BOT_TOKEN` | Telegram Bot Token | `123456:ABC-DEF...` |
| `TG_CHAT_ID` | Telegram Chat ID | `-1001234567890` |
| `DATABASE` | D1 数据库绑定名称 | `DB` |

### 认证相关

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `USERNAME` | 登录用户名 | `admin` |
| `PASSWORD` | 登录密码 | `admin` |
| `ENABLE_AUTH` | 是否启用认证 | `true` |
| `COOKIE` | Cookie 过期天数 | `7` |

### R2 存储

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `R2_BUCKET` | R2 Bucket 绑定名称 | - |
| `R2_PUBLIC_URL` | R2 公开访问 URL | `https://${DOMAIN}` |
| `ENABLE_R2_FALLBACK` | 是否启用 R2 备用 | `false` |

### GitHub 存储

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `GITHUB_TOKEN` | GitHub Personal Access Token | 变量要用密钥不要用文本|
| `GITHUB_REPO` | 仓库名（格式：`github名称/项目仓库名`） | chnbsdan/cf-tgbed |
| `GITHUB_BRANCH` | 分支名 | `main` |
| `GITHUB_PATH` | 存储路径 | `images` |

### 其他配置

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `MAX_SIZE_MB` | 最大文件大小（MB） | `20` |

### wrangler.toml 配置示例

```toml
name = "cf-tgbed"
main = "src/index.js"
compatibility_date = "2024-01-01"

[[d1_databases]]
binding = "DATABASE"
database_name = "cf-tgbed-db"
database_id = "your-database-id"

[[r2_buckets]]
binding = "R2_BUCKET"
bucket_name = "cf-tgbed-images"

[vars]
DOMAIN = "img.example.com"
TG_BOT_TOKEN = "123456:ABC-DEF..."
TG_CHAT_ID = "-1001234567890"
USERNAME = "admin"
PASSWORD = "your-password"
ENABLE_AUTH = "true"
COOKIE = "7"
MAX_SIZE_MB = "20"
ENABLE_R2_FALLBACK = "true"
GITHUB_TOKEN = "ghp_xxx"
GITHUB_REPO = "username/repo"
GITHUB_BRANCH = "main"
GITHUB_PATH = "images"
```

---

## 📖 使用指南

### 访问地址

| 路径 | 说明 |
|------|------|
| `/` 或 `/upload` | 上传页面 |
| `/admin` | 文件管理后台 |
| `/login` | 登录页面 |
| `/config` | 获取配置信息（API） |
| `/bing` | Bing 每日壁纸（API） |
| `/history` | 上传历史（API） |
| `/search` | 搜索文件（API） |
| `/delete` | 删除文件（API） |
| `/batch-delete` | 批量删除（API） |
| `/github/*` | GitHub 文件代理 |

### 上传文件

1. 访问 `/upload` 页面
2. 选择存储方式（TG / R2 / GitHub）
3. 可选：开启 WebP 转换
4. 点击上传区域或拖拽文件
5. 支持 Ctrl+V 粘贴上传
6. 上传完成后自动显示链接

### 管理文件

1. 访问 `/admin` 进入管理后台
2. 支持：
   - 🔍 搜索文件
   - 📄 分页浏览
   - ✅ 批量选择
   - 📋 批量复制链接
   - 🗑️ 批量删除
   - 🔗 单个复制/打开/分享/删除
   - 🖼️ 点击预览大图

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
├── wrangler.toml         # Cloudflare 配置文件
├── package.json          # 项目配置
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

# 部署到生产
wrangler deploy
```

### 数据库迁移

```bash
# 执行 SQL
wrangler d1 execute cf-tgbed-db --file=./migrations/001_init.sql
```

---

## ❓ 常见问题

### Q: 上传失败怎么办？

1. 检查是否超过文件大小限制（默认 20MB）
2. 检查存储方式配置是否正确
3. 查看 Cloudflare Worker 日志

### Q: 如何获取 Telegram Chat ID？

1. 将 Bot 添加到频道/群组
2. 发送一条消息
3. 访问 `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates`
4. 从返回的 JSON 中获取 `chat.id`

### Q: GitHub 上传失败？

1. 检查 Token 权限是否包含 `repo`
2. 检查仓库是否存在
3. 检查是否达到速率限制

### Q: 如何清空所有数据？

```sql
DELETE FROM files;
```

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
