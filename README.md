# CF-TGBed

[![GitHub license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![JavaScript](https://img.shields.io/badge/JavaScript-100%25-yellow.svg)](https://www.javascript.com/)

基于 Cloudflare Workers + D1 数据库 + Telegram 频道存储的独立图床与文件托管系统。

## 📖 项目简介

`CF-TGBed` 是一个轻量级、自托管的文件分享解决方案。它利用 **Cloudflare Workers** 的无服务器能力和 **Telegram 频道** 作为存储后端，为您提供一个完全可控、支持多种格式、并带有管理面板的文件托管系统。

上传的文件将通过 Telegram 机器人发送到指定的频道聊天中，生成直链供分享、下载和在线预览。

## ✨ 项目特点

### 核心功能
- 🚀 **无服务器架构**：基于 Cloudflare Workers 运行，无需管理服务器，自带 CDN 加速
- 🖼️ **全能文件托管**：支持图片、视频、音频、文档等几乎所有文件格式的上传、预览和分享
- 🔐 **用户认证**：可选是否开启身份认证，默认开启。默认用户名、密码均为 `admin`
- 📂 **文件管理**：美观的响应式管理面板，支持文件列表、在线预览、分享、下载和删除
- 📦 **分块上传支持**：通过部署 TG-BOT-API 可实现大文件分块上传（需自行部署）
- 🔍 **文件搜索**：支持按文件名模糊搜索已上传的文件
- 🎨 **WebP 自动转换**：利用 Cloudflare Images 免费额度（每月5000次），将上传图片自动转为 WebP 格式
- 🔗 **API 接口**：支持通过 API 进行文件上传、删除、搜索等操作，便于第三方集成
- 🌅 **动态背景**：系统会定期从 Bing 获取背景图，提升用户体验

### 🆕 2026-06-17 最新优化

#### 代码架构重构
- 📁 **模块化设计**：代码拆分为独立模块（config、database、auth、upload、cache、file、utils），便于维护和扩展
- 🧹 **代码精简**：大幅精简冗余代码，优化性能，提升可读性
- 📦 **标准化配置**：使用 `wrangler.toml` 和 `.env` 统一管理配置

#### 批量操作增强
- ✅ **批量删除**：支持勾选多个文件，一键批量删除，同步清理 Telegram 消息
- 📋 **批量复制**：支持同时复制多个文件链接（支持 URL、Markdown、HTML、BBCode 格式）
- 🎯 **全选/取消全选**：便捷的批量选择功能

#### 文件管理升级
- 🖼️ **大图预览**：点击小图弹出模态框查看大图，支持 ESC 键关闭
- 🔗 **快速打开链接**：每个文件卡片增加"打开链接"按钮，新窗口直接访问
- 📊 **分页优化**：每页显示 20 个文件，支持页码导航和跳转
- 🔍 **实时搜索**：输入即搜索，无需点击按钮

#### 上传体验优化
- 📊 **上传统计**：显示已上传文件数量和总大小
- 🎨 **进度条美化**：更清晰的进度显示，带百分比和状态标识
- 📋 **多格式复制**：支持复制 URL、Markdown、HTML、BBCode 多种格式
- 🧹 **清空列表**：一键清空上传记录

#### 性能与安全
- ⚡ **智能缓存**：根据文件类型设置不同的缓存策略（图片1年，视频/音频30天，其他1天）
- 🛡️ **速率限制**：防止恶意请求攻击
- 🔒 **敏感信息保护**：支持使用 Encrypted Variables 存储密码和 Token
- 📊 **数据库索引优化**：添加索引提升查询速度

#### 用户体验
- ⌨️ **键盘快捷键**：支持 ESC 关闭模态框
- 💡 **操作反馈**：复制、删除等操作均有视觉和文字反馈
- 📱 **响应式设计**：完美适配桌面端和移动端
- 🎯 **空状态提示**：无文件时显示友好的空状态页面

## 🛠️ 技术栈

| 组件 | 技术 |
|------|------|
| Runtime | [Cloudflare Workers](https://workers.cloudflare.com/) |
| Database | [Cloudflare D1](https://developers.cloudflare.com/d1/) |
| Storage | [Telegram Bot API](https://core.telegram.org/bots/api) |
| Image Processing | [Cloudflare Images](https://developers.cloudflare.com/images/) |
| Cache | Cloudflare Workers Cache API |
| Language | JavaScript (ES Modules) |
| Tools | [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) |

## 📁 项目结构

```
cf-tgbed/
├── src/
│   ├── index.js          # 应用主入口，负责路由分发
│   ├── config.js         # 配置加载与管理
│   ├── database.js       # D1 数据库操作（CRUD、搜索、索引）
│   ├── auth.js           # 身份认证与登录逻辑
│   ├── upload.js         # 文件上传逻辑（含分块上传）
│   ├── cache.js          # Workers Cache 缓存管理
│   ├── file.js           # 文件访问、预览与信息处理
│   ├── utils.js          # 通用工具函数（格式化、类型映射等）
│   └── templates/        # HTML 页面模板
│       ├── index.js      # 模板统一导出
│       ├── login.js      # 登录页面
│       ├── upload.js     # 上传页面（含批量复制）
│       └── admin.js      # 管理页面（含批量操作、大图预览）
├── .env.example          # 环境变量配置示例
├── .gitignore
├── package.json
├── wrangler.toml         # Cloudflare Workers 配置文件
└── README.md
```

## 🚀 部署方法

### 前置准备

1. **Telegram 准备**：
   - 创建一个 **Telegram Bot**，获取其 `Bot Token`（自行搜索获取方式）
   - 创建一个 **公开频道**，并将 Bot 添加为管理员
   - 获取频道的 **Chat ID**（格式为 `-10*****062333`，是频道ID，不是机器人ID）

2. **Cloudflare 准备**：
   - 一个 Cloudflare 账号
   - 安装 [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) 并完成登录 (`npx wrangler login`)

### 部署步骤

#### 1. 克隆项目

```bash
git clone https://github.com/chnbsdan/cf-tgbed.git
cd cf-tgbed
```

#### 2. 创建并绑定 D1 数据库（必须）

```bash
# 创建 D1 数据库，数据库名随意（例如：tgfile）
npx wrangler d1 create tgfile

# 记录输出的 database_id
```

将 `wrangler.toml` 中 `[[d1_databases]]` 下的 `database_id` 更新为实际 ID：

```toml
[[d1_databases]]
binding = "DATABASE"
database_name = "tgfile"
database_id = "你的-D1-数据库-ID"
```

#### 3. 配置环境变量

复制 `.env.example` 为 `.env` 并根据实际信息填写：

```bash
cp .env.example .env
```

`.env` 文件内容示例：

```env
# 必填配置
DOMAIN=your-domain.com          # 项目绑定的域名（不绑域名则填 worker 域名，但无法开启 WebP 转换）
TG_BOT_TOKEN=你的-Bot-Token
TG_CHAT_ID=你的-频道-Chat-ID    # 格式：-10*****062333

# 认证配置（默认开启）
ENABLE_AUTH=true                # true/false，默认为 true
USERNAME=admin                  # 登录用户名，默认 admin
PASSWORD=admin                  # 登录密码，默认 admin

# 可选配置
COOKIE=7                        # Cookie 有效期（天），默认 7
MAX_SIZE_MB=20                  # 单文件大小限制（MB），默认 20
API_TOKEN=tgfile-admin          # API 接口密钥，默认 tgfile-admin
WEBP_ENABLED=false              # 是否启用 WebP 自动转换，默认 false
CHUNK_SIZE=5242880              # 分块大小（字节，5MB），默认 5MB
```

#### 4. 安装依赖并部署

```bash
npm install
npx wrangler deploy
```

#### 5. 配置 Dashboard 变量（推荐）

作为更安全的替代方案，可以在 Cloudflare Dashboard 的 **Workers → 你的项目 → Settings → Variables** 中配置环境变量：

| 变量类型 | 变量名 | 说明 |
|----------|--------|------|
| D1 数据库绑定 | `DATABASE` | 由 `wrangler.toml` 自动绑定，无需手动添加 |
| 明文变量 | `DOMAIN`, `USERNAME`, `ENABLE_AUTH`, `COOKIE`, `MAX_SIZE_MB`, `API_TOKEN`, `WEBP_ENABLED` | Dashboard 中手动添加 |
| 加密变量 | `PASSWORD`, `TG_BOT_TOKEN`, `TG_CHAT_ID` | Dashboard 中作为 Encrypted 添加 |

#### 6. 访问应用

打开浏览器，访问 `http://你绑定的域名`：
- 首次登录会要求输入用户名和密码（默认均为 `admin`）
- 登录后进入上传页面进行文件上传和管理
- Cookie 有效期为 7 天（可在环境变量中修改 `COOKIE` 值）
- 若 `ENABLE_AUTH=false`，则跳过登录直接进入上传页面

## 🔧 环境变量详解

| 变量名 | 描述 | 是否必须 | 默认值 |
|--------|------|----------|--------|
| `DOMAIN` | 项目绑定的域名。不绑域名则填 worker 域名，但无法开启 WebP 转换 | **是** | - |
| `TG_BOT_TOKEN` | Telegram Bot 访问令牌 | **是** | - |
| `TG_CHAT_ID` | 存储文件的 Telegram 频道 ID（格式：`-10*****062333`） | **是** | - |
| `USERNAME` | 管理员登录用户名 | **是** | `admin` |
| `PASSWORD` | 管理员登录密码 | **是** | `admin` |
| `ENABLE_AUTH` | 是否启用登录认证（`true`/`false`） | 否 | `true` |
| `COOKIE` | 登录 Cookie 有效期（天） | 否 | `7` |
| `MAX_SIZE_MB` | 单文件最大大小（MB） | 否 | `20` |
| `API_TOKEN` | API 接口访问密钥 | 否 | `tgfile-admin` |
| `WEBP_ENABLED` | 是否启用 WebP 自动转换（`true`/`false`） | 否 | `false` |
| `CHUNK_SIZE` | 分块上传大小（字节） | 否 | `5242880` (5MB) |

## 📋 功能详解

### 用户认证

- 默认开启身份认证（`ENABLE_AUTH=true`）
- 默认用户名、密码均为 `admin`
- 登录成功后，Cookie 有效期为 7 天（可通过 `COOKIE` 变量调整）
- 若设置 `ENABLE_AUTH=false`，则跳过登录，直接进入上传页面

### 文件上传

- 支持点击选择或拖拽文件上传
- 支持多文件同时上传
- 显示实时上传进度条百分比
- 上传完成后自动显示链接，支持多种格式复制
- 显示已上传文件数量和总大小统计
- 由于 Telegram 官方 API 限制，单文件最大 20MB
- 若需上传大文件，需自行部署 TG-BOT-API 实现服务器分片

### 文件管理（管理员）

管理员可以查看已上传的文件列表，支持以下操作：

- **在线预览**：支持图片、视频格式的在线预览
- **大图预览**：点击小图弹出模态框查看大图
- **分享**：生成二维码，点击二维码框内"复制链接"按钮可复制 URL
- **下载**：直接调用浏览器下载功能
- **删除**：同步从 Telegram 频道中删除上传的文件
- **批量删除**：勾选多个文件，一键批量删除
- **批量复制**：勾选多个文件，一键复制所有链接
- **打开链接**：新窗口直接打开文件

### 文件搜索

支持根据文件名模糊搜索已上传的文件，实时显示搜索结果。

### WebP 自动转换

- 利用 Cloudflare Images 免费额度（每月 5000 次唯一转换）
- 开启方法：设置环境变量 `WEBP_ENABLED=true`
- 上传图片时将自动生成 WebP 格式版本

> **注意**：需要绑定自定义域名才能使用 Cloudflare Images 功能。若使用 worker 域名，则无法开启 WebP 转换。

### API 接口

支持通过 API 进行文件上传、删除、搜索等操作，便于第三方集成：

- 接口密钥通过环境变量 `API_TOKEN` 设置（默认为 `tgfile-admin`）
- 详见 [API 文档](./API.md)（待补充）

### 缓存策略

| 文件类型 | 缓存时间 |
|----------|----------|
| 图片（jpg, png, gif, webp, svg 等） | 1 年 |
| 视频（mp4, webm, avi, mov 等） | 30 天 |
| 音频（mp3, wav, ogg 等） | 30 天 |
| 其他文件 | 1 天 |

## 📝 更新日志

### 2026-06-17（本次更新）

#### 🏗️ 代码架构重构
- 代码拆分为独立模块：config、database、auth、upload、cache、file、utils
- 大幅精简冗余代码，优化性能
- 标准化配置管理，支持 `.env` 和 `wrangler.toml`

#### ✨ 新增功能
- **批量删除**：支持勾选多个文件一键删除
- **批量复制**：支持同时复制多个文件链接
- **大图预览**：点击小图弹出模态框查看大图
- **打开链接**：每个文件卡片增加"打开链接"按钮
- **上传统计**：显示已上传文件数量和总大小
- **多格式复制**：支持 URL、Markdown、HTML、BBCode 四种格式
- **清空列表**：一键清空上传记录
- **全选/取消全选**：便捷的批量选择功能
- **分页优化**：每页 20 个文件，支持页码导航
- **实时搜索**：输入即搜索

#### ⚡ 性能优化
- 智能缓存策略（根据文件类型设置不同缓存时间）
- 数据库索引优化
- 速率限制防护

#### 🎨 用户体验
- 键盘快捷键支持（ESC 关闭模态框）
- 操作反馈优化（复制、删除等操作有视觉反馈）
- 响应式设计完善
- 空状态提示

### 2025-12-17

- ✨ 新增 WebP 自动转换功能（利用 Cloudflare Images）
- ✨ 新增 API 接口，便于第三方集成
- ⚡ 大幅精简代码，优化性能

### 2025-02-11

- 🎨 为前端页面增加图标和网站描述

### 2025-02-09

- 🐛 修复 WebP 图片上传失败的问题
- 🔗 文件管理页面删除文件时，同步从 Telegram 频道删除消息
- 📱 文件管理页面点击分享可生成二维码

### 数据库迁移说明

若需要开启 WebP 转换，已部署的用户需要手动运行以下 SQL 命令：

```sql
ALTER TABLE files ADD COLUMN webp_url TEXT;
CREATE UNIQUE INDEX idx_webp_url ON files (webp_url) WHERE webp_url IS NOT NULL;
ALTER TABLE files ADD COLUMN webp_file_name TEXT;
```

> **新部署用户无需运行以上命令**，新代码中的表结构已包含新列。

## 🗺️ 路线图 (Roadmap)

- [ ] 用户管理（多用户支持）
- [ ] 文件分享链接有效期设置
- [ ] 文件标签/分类管理
- [ ] 暗色主题支持
- [ ] 更多图片格式转换支持
- [ ] 文件统计图表
- [ ] Webhook 支持

## 🤝 参与贡献

欢迎提出 Issue 或 Pull Request 来帮助改进这个项目。

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 打开 Pull Request

## 📄 许可证

本项目基于 MIT 许可证开源。详见 [LICENSE](LICENSE) 文件。

## 🔗 相关链接

- [Cloudflare Workers 文档](https://developers.cloudflare.com/workers/)
- [Telegram Bot API 文档](https://core.telegram.org/bots/api)
- [Cloudflare Images 文档](https://developers.cloudflare.com/images/)
- [Wrangler CLI 文档](https://developers.cloudflare.com/workers/wrangler/)

---

**感谢使用 CF-TGBed！** 如果这个项目对你有帮助，欢迎给一个 ⭐ Star。
