
# CF-TGBed

[![GitHub license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![JavaScript](https://img.shields.io/badge/JavaScript-100%25-yellow.svg)](https://www.javascript.com/)

## 基于 Cloudflare Workers + D1 数据库 + Telegram 频道存储的独立图床与文件托管系统。

## 📖 项目简介

`CF-TGBed` 是一个轻量级、自托管的文件分享解决方案。利用 **Cloudflare Workers** 的无服务器能力和 **Telegram 频道** 作为主要存储后端，并支持 **Cloudflare R2** 作为备用存储，为您提供一个高可用、完全可控的文件托管系统。

上传的文件通过 Telegram 机器人发送到指定频道，生成直链供分享、下载和在线预览。当 Telegram 上传失败时，自动降级到 R2 存储，确保服务稳定。

## ✨ 项目特点

### 核心功能
- 🚀 **无服务器架构**：基于 Cloudflare Workers 运行，无需管理服务器，自带 CDN 加速
- 🖼️ **全能文件托管**：支持图片、视频、音频、文档等几乎所有文件格式
- 🔐 **用户认证**：可选开启身份认证，默认用户名/密码均为 `admin`
- 📂 **文件管理**：响应式管理面板，支持列表、预览、分享、下载、删除
- 🔍 **文件搜索**：按文件名模糊搜索
- 🌅 **动态背景**：定期从 Bing 获取背景图
- 📎 **原文件名链接**：链接格式为 `日期-原文件名.扩展名`，便于识别
- 🎨 **WebP 转换**：前端开关，上传时自动将图片转为 WebP 格式（更小体积）
- 💾 **R2 备用存储**：Telegram 上传失败时自动降级到 R2，确保高可用

### 管理后台增强
- ✅ **批量删除**：勾选多个文件一键删除，同步清理 Telegram/R2 消息
- 📋 **批量复制**：同时复制多个文件链接（支持 URL、Markdown、HTML、BBCode）
- 🖼️ **大图预览**：点击图片弹出模态框查看大图，ESC 关闭
- 🔗 **快速打开链接**：每个文件卡片增加"打开链接"按钮
- 📊 **分页优化**：每页 20 个文件，支持页码导航
- 🔍 **实时搜索**：输入即搜索，无需点击按钮
- 🏷️ **存储类型标签**：管理后台显示文件存储位置（TG / R2）

### 上传体验
- 📊 **上传统计**：显示已上传文件数量和总大小
- 🎨 **进度条美化**：清晰的进度显示，带百分比和状态标识
- 📋 **多格式复制**：支持 URL、Markdown、HTML、BBCode 四种格式
- 🧹 **清空列表**：一键清空上传记录
- 🌐 **WebP 开关**：一键切换是否转换 WebP

### 性能与安全
- ⚡ **智能缓存**：根据文件类型设置不同缓存策略（图片1年，视频/音频30天，其他1天）
- 🔒 **敏感信息保护**：支持使用 Encrypted Variables 存储密码和 Token
- 📊 **数据库索引优化**：提升查询速度
- 🛡️ **双存储保障**：Telegram + R2 双备份，提高可用性

## 🛠️ 技术栈

| 组件 | 技术 |
|------|------|
| Runtime | [Cloudflare Workers](https://workers.cloudflare.com/) |
| Database | [Cloudflare D1](https://developers.cloudflare.com/d1/) |
| Primary Storage | [Telegram Bot API](https://core.telegram.org/bots/api) |
| Backup Storage | [Cloudflare R2](https://developers.cloudflare.com/r2/) |
| Cache | Cloudflare Workers Cache API |
| Language | JavaScript (ES Modules) |
| Tools | [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) |

## 📁 项目结构

```
cf-tgbed/
├── _worker.js           # 完整单文件代码（推荐部署）
├── src/                 # 拆分模块版本（开发用）
│   ├── index.js         # 应用主入口，路由分发
│   ├── config.js        # 配置加载与管理
│   ├── database.js      # D1 数据库操作
│   ├── auth.js          # 身份认证与登录
│   ├── upload.js        # 文件上传（含分块上传、WebP转换）
│   ├── cache.js         # 缓存管理
│   ├── file.js          # 文件访问与预览
│   ├── utils.js         # 工具函数
│   └── templates/       # HTML 模板
│       ├── index.js     # 统一导出
│       ├── login.js     # 登录页面
│       ├── upload.js    # 上传页面（含WebP开关）
│       └── admin.js     # 管理页面（含存储标签）
├── .env.example         # 环境变量示例
├── .gitignore
├── package.json
├── wrangler.toml        # Cloudflare Workers 配置
└── README.md
```

## 🚀 部署方法

### 前置准备

1. **Telegram 准备**：
   - 创建 **Telegram Bot**，获取 `Bot Token`
   - 创建 **公开频道**，将 Bot 添加为管理员
   - 获取频道 **Chat ID**（格式：`-10*****062333`）

2. **Cloudflare 准备**：
   - Cloudflare 账号
   - 安装 [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) 并登录

### 部署步骤

#### 1. 克隆项目

```bash
git clone https://github.com/chnbsdan/cf-tgbed.git
cd cf-tgbed
```

#### 2. 创建并绑定 D1 数据库

```bash
# 创建 D1 数据库
npx wrangler d1 create imgbed

# 记录输出的 database_id
```

将 `wrangler.toml` 中的 `database_id` 更新为实际 ID：

```toml
[[d1_databases]]
binding = "DATABASE"
database_name = "imgbed"
database_id = "你的-D1-数据库-ID"
```

#### 3. 创建并绑定 R2 存储桶（可选）

```bash
# 在 Cloudflare Dashboard → R2 创建存储桶
# 名称：tgbed-backup（随意）
```

在 `wrangler.toml` 中添加：

```toml
[[r2_buckets]]
binding = "R2_BUCKET"
bucket_name = "tgbed-backup"
```

#### 4. 配置 `wrangler.toml`

```toml
name = "tg-file-host"
main = "_worker.js"
compatibility_date = "2024-01-01"

[vars]
DOMAIN = "你的域名"
USERNAME = "admin"
PASSWORD = "你的密码"
ENABLE_AUTH = "true"
COOKIE = "7"
MAX_SIZE_MB = "20"
CHUNK_SIZE = "5242880"
TG_BOT_TOKEN = "你的-Bot-Token"
TG_CHAT_ID = "你的-频道-Chat-ID"
ENABLE_R2_FALLBACK = "true"      # 启用 R2 备用存储
R2_PUBLIC_URL = ""                # R2 公开域名（可选）

[[d1_databases]]
binding = "DATABASE"
database_name = "imgbed"
database_id = "你的-D1-数据库-ID"

[[r2_buckets]]
binding = "R2_BUCKET"
bucket_name = "tgbed-backup"
```

#### 5. 部署

```bash
# 单文件版本（推荐）
npx wrangler deploy

# 或使用拆分版本
# npm install
# npx wrangler deploy
```

#### 6. 访问应用

打开浏览器访问 `https://你的域名`：
- 首次登录需要输入用户名和密码（默认 `admin` / `admin`）
- 登录后进入上传页面
- Cookie 有效期为 7 天（可在 `COOKIE` 变量调整）

## 🔧 环境变量详解

| 变量名 | 描述 | 是否必须 | 默认值 |
|--------|------|----------|--------|
| `DOMAIN` | 项目绑定的域名 | **是** | - |
| `TG_BOT_TOKEN` | Telegram Bot 访问令牌 | **是** | - |
| `TG_CHAT_ID` | Telegram 频道 ID（格式：`-10*****062333`） | **是** | - |
| `USERNAME` | 管理员登录用户名 | **是** | `admin` |
| `PASSWORD` | 管理员登录密码 | **是** | `admin` |
| `ENABLE_AUTH` | 是否启用登录认证 | 否 | `true` |
| `COOKIE` | 登录 Cookie 有效期（天） | 否 | `7` |
| `MAX_SIZE_MB` | 单文件最大大小（MB） | 否 | `20` |
| `CHUNK_SIZE` | 分块上传大小（字节） | 否 | `5242880` |
| `ENABLE_R2_FALLBACK` | 启用 R2 备用存储 | 否 | `false` |
| `R2_PUBLIC_URL` | R2 公开访问域名 | 否 | `""` |

## 📋 功能详解

### 文件上传
- 支持点击选择或拖拽上传
- 支持多文件同时上传
- 实时显示上传进度
- **WebP 转换**：开启开关后，图片自动转为 WebP 格式
- 链接格式：`日期-原文件名.扩展名`（如 `20260618-我的图片.jpg`）
- 显示已上传文件数量和总大小统计

### 双存储机制

| 存储方式 | 触发条件 | 标签 |
|----------|----------|------|
| **Telegram** | 默认优先使用 | `TG` |
| **R2** | Telegram 失败时自动降级 | `R2` |

上传流程：
```
用户上传 → 尝试 Telegram → 成功 → 保存 (TG)
                        → 失败 → 尝试 R2 → 成功 → 保存 (R2)
                                         → 失败 → 返回错误
```

### 文件管理
- **在线预览**：支持图片、视频格式
- **大图预览**：点击图片弹出模态框查看
- **分享**：生成二维码，点击复制链接
- **下载**：浏览器下载功能
- **删除**：同步从 Telegram/R2 删除
- **批量删除**：勾选多个文件一键删除
- **批量复制**：勾选多个文件一键复制链接
- **打开链接**：新窗口直接打开文件
- **存储标签**：显示文件存储在 TG 还是 R2

### 文件搜索
支持按文件名模糊搜索，实时显示结果。

### 缓存策略

| 文件类型 | 缓存时间 |
|----------|----------|
| 图片（jpg, png, gif, webp 等） | 1 年 |
| 视频（mp4, webm, avi 等） | 30 天 |
| 音频（mp3, wav, ogg 等） | 30 天 |
| 其他文件 | 1 天 |

## 📝 更新日志

### 2026-06-18

#### 🆕 新增功能
- **R2 备用存储**：Telegram 上传失败时自动降级到 R2，确保高可用
- **WebP 转换开关**：上传页面增加开关，开启后图片自动转为 WebP
- **存储类型标签**：管理后台显示文件存储位置（TG / R2）
- **原文件名链接**：链接格式改为 `日期-原文件名.扩展名`
- **批量复制**：支持同时复制多个文件链接
- **大图预览**：点击图片弹出模态框查看
- **上传统计**：显示已上传文件数量和总大小
- **多格式复制**：支持 URL、Markdown、HTML、BBCode 四种格式
- **清空列表**：一键清空上传记录
- **全选/取消全选**：批量操作更便捷
- **分页优化**：每页 20 个文件

#### ⚡ 性能优化
- 智能缓存策略
- 数据库索引优化
- 代码模块化重构

### 2025-12-17
- 新增 WebP 自动转换（Cloudflare Images）
- 新增 API 接口
- 代码精简优化

### 2025-02-11
- 前端页面增加图标和描述

### 2025-02-09
- 修复 WebP 上传问题
- 删除文件同步清理 Telegram 消息
- 分享生成二维码

## 🗄️ 数据库表结构

### `files` 表

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
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `url` | TEXT | 文件访问链接（主键） |
| `fileId` | TEXT | Telegram/R2 文件 ID |
| `message_id` | INTEGER | Telegram 消息 ID |
| `created_at` | INTEGER | 创建时间戳 |
| `file_name` | TEXT | 原始文件名 |
| `file_size` | INTEGER | 文件大小（字节） |
| `mime_type` | TEXT | 文件 MIME 类型 |
| `storage_type` | TEXT | 存储类型：`telegram` / `r2` |

### 数据库迁移（已部署用户）

```sql
-- 添加 storage_type 字段
ALTER TABLE files ADD COLUMN storage_type TEXT DEFAULT 'telegram';

-- 创建索引
CREATE INDEX idx_files_created_at ON files(created_at DESC);
CREATE INDEX idx_files_file_name ON files(file_name);
```

## ☁️ R2 配置详解

### 创建存储桶
1. Cloudflare Dashboard → R2 → 创建存储桶
2. 名称：`tgbed-backup`（随意）

### 绑定到 Worker
在 `wrangler.toml` 中添加：
```toml
[[r2_buckets]]
binding = "R2_BUCKET"
bucket_name = "tgbed-backup"
```

### 设置公开访问（可选）
1. R2 → 存储桶 → 设置 → 公开访问
2. 绑定自定义域名或使用 R2.dev 域名
3. 将域名填入 `R2_PUBLIC_URL`

### 工作流程
```
上传 → Telegram 成功 → 保存到数据库 (storage_type=telegram)
上传 → Telegram 失败 → R2 上传 → 保存到数据库 (storage_type=r2)
```

## 🤝 参与贡献

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 打开 Pull Request

## 📄 许可证

MIT License

## 鸣谢

感谢这位[大佬](https://github.com/0-RTT/telegraph)给予的灵感，原代码借于此。

---

**感谢使用 CF-TGBed！** 欢迎 ⭐Star 支持。
