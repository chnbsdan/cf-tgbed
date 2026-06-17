# CF-TGBed

[![GitHub license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![JavaScript](https://img.shields.io/badge/JavaScript-100%25-yellow.svg)](https://www.javascript.com/)

基于 Cloudflare Workers 和 D1 数据库的 Telegram 独立图床与文件托管平台。

## 📖 项目简介

`cf-tgbed` 是一个轻量级、自托管的文件分享解决方案。它利用 **Cloudflare Workers** 的无服务器能力和 **Telegram Bot API** 作为存储后端，为您提供一个完全可控、支持多种格式、并带有管理面板的图床服务。

### 核心特性

*   **🚀 无服务器架构**：基于 Cloudflare Workers 运行，无需管理服务器，自带 CDN 加速。
*   **🖼️ 全能文件托管**：支持图片、视频、音频、文档等几乎所有文件格式的上传、预览和分享。
*   **🔐 安全认证**：内置用户名/密码认证机制，保护您的管理界面（可选启用）。
*   **📂 文件管理**：美观的响应式管理面板，支持文件列表、**大图预览**、**批量复制链接**和**批量删除**。
*   **📦 大文件分块上传**：针对大文件进行智能分块上传，解决 Telegram API 的大小限制问题。
*   **⚡ 智能缓存**：对高频访问的文件进行边缘缓存，显著提升访问速度。
*   **🔍 全文搜索**：支持按文件名快速搜索已上传的文件。
*   **📱 响应式设计**：在桌面和移动设备上均能获得良好的使用体验。

## 🛠️ 技术栈

*   **Runtime**: [Cloudflare Workers](https://workers.cloudflare.com/)
*   **Database**: [Cloudflare D1](https://developers.cloudflare.com/d1/)
*   **Storage**: [Telegram Bot API](https://core.telegram.org/bots/api)
*   **Language**: JavaScript (ES Modules)
*   **Tools**: [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)

## 📁 项目结构

```
cf-tgbed/
├── src/
│   ├── index.js          # 应用主入口，负责路由分发
│   ├── config.js         # 配置加载与管理
│   ├── database.js       # D1 数据库操作（CRUD、搜索）
│   ├── auth.js           # 身份认证与登录逻辑
│   ├── upload.js         # 文件上传逻辑（含分块上传）
│   ├── cache.js          # Workers KV 缓存管理
│   ├── file.js           # 文件访问、预览与信息处理
│   ├── utils.js          # 通用工具函数（格式化、类型映射等）
│   └── templates/        # HTML 页面模板
│       ├── index.js      # 模板统一导出
│       ├── login.js      # 登录页面
│       ├── upload.js     # 上传页面
│       └── admin.js      # 文件管理页面
├── .env.example          # 环境变量配置示例
├── .gitignore
├── package.json
├── wrangler.toml         # Cloudflare Workers 配置文件
└── README.md
```

## 🚀 快速部署

### 前置准备

1.  **Telegram 准备**：
    *   创建一个 **Telegram Bot**，获取其 `Bot Token`。
    *   创建一个 **公开频道**，并将 Bot 添加为管理员。
    *   获取频道的 **Chat ID**（例如：`-1001234567890`）。
2.  **Cloudflare 准备**：
    *   一个 Cloudflare 账号。
    *   安装 [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) 并完成登录 (`npx wrangler login`)。
    *   创建一个 **D1 数据库**：`npx wrangler d1 create tgfile-db`，并记录下生成的 **Database ID**。

### 部署步骤

1.  **克隆项目**
    ```bash
    git clone https://github.com/chnbsdan/cf-tgbed.git
    cd cf-tgbed
    ```

2.  **配置 `wrangler.toml`**
    将 `wrangler.toml` 中 `[[d1_databases]]` 下的 `database_id` 更新为你在前置准备中获取的 D1 数据库 ID。
    ```toml
    [[d1_databases]]
    binding = "DATABASE"
    database_name = "tgfile-db"
    database_id = "你的-D1-数据库-ID" # <--- 在这里修改
    ```

3.  **设置环境变量**
    复制 `.env.example` 为 `.env` 并根据你的信息填写。
    ```bash
    cp .env.example .env
    ```
    `.env` 文件内容示例：
    ```env
    DOMAIN=your-domain.com           # 你的 Workers 自定义域名或 workers.dev 域名
    USERNAME=admin                   # 管理员用户名
    PASSWORD=your-strong-password    # 管理员密码
    ENABLE_AUTH=true                 # 是否启用登录认证
    TG_BOT_TOKEN=你的-Bot-Token
    TG_CHAT_ID=你的-频道-Chat-ID
    COOKIE=7                         # 登录态 Cookie 有效期（天）
    MAX_SIZE_MB=20                   # 单文件大小限制 (MB)
    CHUNK_SIZE=5242880               # 分块大小 (字节, 5MB)
    ```
    > **安全提醒**：请勿将包含敏感信息的 `.env` 文件提交到 Git 仓库。

4.  **安装依赖并部署**
    ```bash
    npm install
    npx wrangler deploy
    ```

5.  **配置项目变量 (可选但推荐)**
    作为更安全的替代方案，你可以在 Cloudflare Dashboard 的 Workers → 你的项目 → **Settings** → **Variables** 中，将所有环境变量（尤其是 `PASSWORD`, `TG_BOT_TOKEN`, `TG_CHAT_ID`）添加为 **Encrypted Variables**。这样它们就不会出现在代码仓库中。

## 🔧 环境变量说明

| 变量名 | 描述 | 是否必需 | 默认值 |
| :--- | :--- | :--- | :--- |
| `DOMAIN` | 你的 Workers 项目域名，用于生成文件链接 | **是** | - |
| `TG_BOT_TOKEN` | Telegram Bot 的访问令牌 | **是** | - |
| `TG_CHAT_ID` | 用于存储文件的 Telegram 频道 ID | **是** | - |
| `USERNAME` | 管理员登录用户名（`ENABLE_AUTH` 为 `true` 时必需） | 条件必需 | - |
| `PASSWORD` | 管理员登录密码（`ENABLE_AUTH` 为 `true` 时必需） | 条件必需 | - |
| `ENABLE_AUTH` | 为 `true` 时启用登录认证，保护所有页面 | 否 | `false` |
| `COOKIE` | 登录 Cookie 的有效期（天） | 否 | `7` |
| `MAX_SIZE_MB` | 允许上传的单个文件最大大小 (MB) | 否 | `20` |
| `CHUNK_SIZE` | 分块上传时每个分块的大小 (字节) | 否 | `5242880` (5MB) |

## 🎯 功能使用指南

*   **上传文件**：访问 `/upload` 页面。可通过点击、拖拽或粘贴 (Ctrl+V) 上传文件，上传进度和链接会实时显示。
*   **管理文件**：访问 `/admin` 页面。在此你可以：
    *   浏览所有已上传的文件，并预览图片/视频。
    *   使用搜索框按文件名查找文件。
    *   **批量操作**：勾选文件后，可进行 **批量复制链接** 或 **批量删除**。
    *   **单个操作**：对单个文件进行 **复制链接**、**打开链接**、**分享（生成二维码）** 或 **删除**。
    *   **大图预览**：点击文件卡片上的图片，即可在模态框中查看大图。

## 🤝 参与贡献

欢迎提出 Issue 或 Pull Request 来帮助改进这个项目。

1.  Fork 本仓库
2.  创建你的特性分支 (`git checkout -b feature/AmazingFeature`)
3.  提交你的更改 (`git commit -m 'Add some AmazingFeature'`)
4.  推送到分支 (`git push origin feature/AmazingFeature`)
5.  打开一个 Pull Request

## 📄 许可证

本项目基于 MIT 许可证开源。详情请参阅 [LICENSE](LICENSE) 文件。

## 🔗 相关链接

*   [Cloudflare Workers 文档](https://developers.cloudflare.com/workers/)
*   [Telegram Bot API 文档](https://core.telegram.org/bots/api)

---

**感谢使用 CF-TGBed！** 如果这个项目对你有帮助，欢迎给它一个 ⭐Star。
