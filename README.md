# CF-TGBed

[![GitHub license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![JavaScript](https://img.shields.io/badge/JavaScript-100%25-yellow.svg)](https://www.javascript.com/)

基于 Cloudflare Workers + D1 数据库 + Telegram 频道存储的独立图床与文件托管系统。

## 📖 项目简介

`CF-TGBed` 是一个轻量级、自托管的文件分享解决方案。利用 **Cloudflare Workers** 的无服务器能力和 **Telegram 频道** 作为存储后端，为您提供一个完全可控、支持多种格式、并带有管理面板的文件托管系统。

上传的文件通过 Telegram 机器人发送到指定频道，生成直链供分享、下载和在线预览。

## ✨ 项目特点

### 核心功能
- 🚀 **无服务器架构**：基于 Cloudflare Workers 运行，无需管理服务器，自带 CDN 加速
- 🖼️ **全能文件托管**：支持图片、视频、音频、文档等几乎所有文件格式
- 🔐 **用户认证**：可选开启身份认证，默认用户名/密码均为 `admin`
- 📂 **文件管理**：响应式管理面板，支持列表、预览、分享、下载、删除
- 🔍 **文件搜索**：按文件名模糊搜索
- 🌅 **动态背景**：定期从 Bing 获取背景图
- 📎 **原文件名链接**：链接格式为 `日期-原文件名.扩展名`，便于识别

### 管理后台增强
- ✅ **批量删除**：勾选多个文件一键删除，同步清理 Telegram 消息
- 📋 **批量复制**：同时复制多个文件链接（支持 URL、Markdown、HTML、BBCode）
- 🖼️ **大图预览**：点击图片弹出模态框查看大图，ESC 关闭
- 🔗 **快速打开链接**：每个文件卡片增加"打开链接"按钮
- 📊 **分页优化**：每页 20 个文件，支持页码导航
- 🔍 **实时搜索**：输入即搜索，无需点击按钮

### 上传体验
- 📊 **上传统计**：显示已上传文件数量和总大小
- 🎨 **进度条美化**：清晰的进度显示，带百分比和状态标识
- 📋 **多格式复制**：支持 URL、Markdown、HTML、BBCode 四种格式
- 🧹 **清空列表**：一键清空上传记录

### 性能与安全
- ⚡ **智能缓存**：根据文件类型设置不同缓存策略（图片1年，视频/音频30天，其他1天）
- 🔒 **敏感信息保护**：支持使用 Encrypted Variables 存储密码和 Token
- 📊 **数据库索引优化**：提升查询速度

## 🛠️ 技术栈

| 组件 | 技术 |
|------|------|
| Runtime | [Cloudflare Workers](https://workers.cloudflare.com/) |
| Database | [Cloudflare D1](https://developers.cloudflare.com/d1/) |
| Storage | [Telegram Bot API](https://core.telegram.org/bots/api) |
| Cache | Cloudflare Workers Cache API |
| Language | JavaScript (ES Modules) |
| Tools | [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) |

## 📁 项目结构

```
cf-tgbed/
├── src/
│   ├── index.js          # 应用主入口，路由分发
│   ├── config.js         # 配置加载与管理
│   ├── database.js       # D1 数据库操作
│   ├── auth.js           # 身份认证与登录
│   ├── upload.js         # 文件上传（含分块上传）
│   ├── cache.js          # 缓存管理
│   ├── file.js           # 文件访问与预览
│   ├── utils.js          # 工具函数
│   └── templates/        # HTML 模板
│       ├── index.js      # 统一导出
│       ├── login.js      # 登录页面
│       ├── upload.js     # 上传页面
│       └── admin.js      # 管理页面
├── .env.example          # 环境变量示例
├── .gitignore
├── package.json
├── wrangler.toml         # Cloudflare Workers 配置
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
npx wrangler d1 create tgbed

# 记录输出的 database_id
```

将 `wrangler.toml` 中的 `database_id` 更新为实际 ID：

```toml
[[d1_databases]]
binding = "DATABASE"
database_name = "tgbed"
database_id = "你的-D1-数据库-ID"
```

#### 3. 配置 `wrangler.toml`

```toml
name = "tg-file-host"
main = "src/index.js"
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

[[d1_databases]]
binding = "DATABASE"
database_name = "tgbed"
database_id = "你的-D1-数据库-ID"
```

#### 4. 安装依赖并部署

```bash
npm install
npx wrangler deploy
```

#### 5. 访问应用

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

## 📋 功能详解

### 文件上传
- 支持点击选择或拖拽上传
- 支持多文件同时上传
- 实时显示上传进度
- 链接格式：`日期-原文件名.扩展名`（如 `20260618-我的图片.jpg`）
- 显示已上传文件数量和总大小统计

### 文件管理
- **在线预览**：支持图片、视频格式
- **大图预览**：点击图片弹出模态框查看
- **分享**：生成二维码，点击复制链接
- **下载**：浏览器下载功能
- **删除**：同步从 Telegram 频道删除
- **批量删除**：勾选多个文件一键删除
- **批量复制**：勾选多个文件一键复制链接
- **打开链接**：新窗口直接打开文件

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

#### ✨ 新增功能
- **原文件名链接**：链接格式改为 `日期-原文件名.扩展名`，便于识别和管理
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
