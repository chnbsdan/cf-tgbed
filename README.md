# CF-TGBed
## 基于 Cloudflare Workers + D1 数据库 + Telegram 频道 + R2 存储的独立图床与文件托管系统。

[![GitHub license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![JavaScript](https://img.shields.io/badge/JavaScript-100%25-yellow.svg)](https://www.javascript.com/)

> **Language**: [中文](./README.md) | [English](./README.EN.md)


## 📖 项目简介

`CF-TGBed` 是一个轻量级、自托管的文件分享解决方案。利用 **Cloudflare Workers** 的无服务器能力，**D1** 存储元数据，**Telegram 频道** 作为主要存储后端，**R2** 作为备用存储，为您提供一个高可用、完全可控的文件托管系统。

上传的文件可通过 Telegram 机器人发送到指定频道，或直接存储到 R2，生成直链供分享、下载和在线预览。

---

## ✨ 功能特点

### 核心功能
- 🔐 可选的用户认证（Cookie 登录，支持有效期配置）
- 🗜️ WebP 图片转换（前端开关，默认关闭）
- 📦 文件大小限制（默认 20MB，可通过环境变量配置）
- 📁 支持所有文件格式上传（图片、视频、文档等）
- 📤 支持多文件上传、拖拽上传和粘贴上传（Ctrl+V）
- ☁️ 双存储支持：Telegram 频道（默认）+ R2 直传
- 🔄 R2 备用：Telegram 上传失败时自动降级

### 管理功能
- 🖼️ 管理后台，支持批量操作
- 🗑️ 批量删除文件（同步删除 Telegram/R2 和数据库记录）
- 📋 批量复制链接（URL、Markdown、HTML、BBCode）
- 🖼️ 大图预览（点击图片弹出模态框）
- 🏷️ 存储类型标签（TG / R2）
- 📊 分页和搜索功能
- ⏰ 显示文件上传时间

### 性能优化
- ⚡ Cloudflare Cache API 缓存支持
- 🎨 懒加载和响应式设计
- 🌅 Bing 每日壁纸背景（自动轮播）
- 📱 响应式设计，支持移动端

---

## 🛠️ 技术栈

| 组件 | 技术 |
|------|------|
| Runtime | [Cloudflare Workers](https://workers.cloudflare.com/) |
| Database | [Cloudflare D1](https://developers.cloudflare.com/d1/) |
| Primary Storage | [Telegram Bot API](https://core.telegram.org/bots/api) |
| Backup Storage | [Cloudflare R2](https://developers.cloudflare.com/r2/) |
| Cache | Cloudflare Workers Cache API |
| Language | JavaScript (ES Modules) |

---

## 🚀 部署步骤

> ⚠️ 建议配置好**边缘 TTL** 并开启**用户认证**，防止被刷导致扣费。

### 1. 创建 R2 存储桶（可选）

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 进入 **R2 对象存储** → **创建存储桶**
3. 设置存储桶名称（如 `tgbed-backup`）和区域
4. 保存存储桶的名称以便后续使用

### 2. 创建 D1 数据库

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 进入 **Workers & Pages** → **D1 SQL 数据库**
3. 点击 **创建** 创建数据库
   - 数据库名称可自定义，例如 `imgbed`
   - 建议选择数据库位置为 **亚太地区**，可以获得更好的访问速度
4. 记录数据库 ID 以便后续绑定

### 3. 创建 Worker

1. 进入 **Workers & Pages**
2. 点击 **创建** → **创建 Worker**
3. 为 Worker 设置一个名称
4. 点击 **部署** 创建 Worker

### 4. 绑定 D1 数据库和 R2 存储

在 Worker 设置页面找到 **设置** → **绑定**：

| 绑定类型 | 变量名 | 说明 |
|----------|--------|------|
| D1 Database | `DATABASE` | 绑定创建的 D1 数据库 ,自已取的名字|
| R2 Bucket | `R2_BUCKET` | 绑定创建的 R2 存储桶（可选），自已取的名字 |

### 5. 配置环境变量

在 Worker 的 **设置** → **变量和机密** 中添加：

| 变量名 | 类型 | 说明 | 必填 |
|--------|------|------|------|
| `DOMAIN` | 纯文本 | 项目绑定的域名 | ✅ |
| `USERNAME` | 纯文本 | 管理员用户名（默认 `admin`） | ✅ |
| `PASSWORD` | 加密 | 管理员密码 | ✅ |
| `TG_BOT_TOKEN` | 加密 | Telegram Bot Token | ✅ |
| `TG_CHAT_ID` | 加密 | Telegram 频道 ID（格式：`-10*****062333`） | ✅ |
| `ENABLE_AUTH` | 纯文本 | 是否启用登录认证（`true`/`false`）,若用用户名与密码登录则加变量值为true | ❌ |
| `COOKIE` | 纯文本 | 登录 Cookie 有效期（天），默认 `7` | ❌ |
| `MAX_SIZE_MB` | 纯文本 | 单文件最大大小（MB），默认 `20` | ❌ |
| `ENABLE_R2_FALLBACK` | 纯文本 | 启用 R2 备用存储（`true`/`false`），若使用R2则加变量值为true | ❌ |
| `R2_PUBLIC_URL` | 纯文本 | R2 公开域名（留空则使用主域名），这项不需要绑定变量 | ❌ |

### 6. 部署代码

1. 进入 Worker 的编辑页面
2. 将 [_worker.js](https://github.com/chnbsdan/cf-tgbed/blob/main/_worker.js) 的完整代码复制粘贴到编辑器中
3. 点击 **保存并部署**

### 7. 绑定域名（可选）

1. 在 Worker 的 **设置** → **域和路由**
2. 点击 **添加** → **自定义域**
3. 输入你在 Cloudflare 绑定的域名
4. 点击 **添加域**

### 8. 配置缓存（推荐）

1. 进入 Cloudflare Dashboard → **网站** → **选择你的自定义域名**
2. 进入 **缓存** → **Cache Rules** → **创建缓存规则**
3. 选择 **缓存所有内容模板**
4. 设置 **边缘 TTL** → **忽略缓存控制标头，使用此 TTL** → **30天**
5. 点击 **部署**

---

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
| `ENABLE_R2_FALLBACK` | 启用 R2 备用存储 | 否 | `false` |
| `R2_PUBLIC_URL` | R2 公开访问域名（留空则使用主域名） | 否 | `""` |

---

## 📋 功能详解

### 存储方式

| 方式 | 说明 | 使用场景 |
|------|------|----------|
| **Telegram（默认）** | 上传到 Telegram 频道，优先使用 | 日常使用，免费存储 |
| **R2 直传** | 直接上传到 R2，不经过 Telegram | 需要稳定、快速访问 |
| **R2 备用** | Telegram 失败时自动降级 | 高可用保障 |

### 上传页面

- **存储方式选择**：下拉菜单选择 Telegram 或 R2
- **WebP 转换开关**：开启后图片自动转为 WebP
- **拖拽/点击上传**：支持多文件、进度条
- **上传统计**：显示数量和总大小

### 管理后台

- **文件列表**：显示所有文件，支持分页、搜索
- **存储标签**：`TG` / `R2` 标识文件存储位置
- **批量操作**：批量复制链接、批量删除
- **单文件操作**：复制、打开、分享（二维码）、删除
- **大图预览**：点击图片弹出模态框查看

---

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
| `created_at` | INTEGER | 创建时间戳（数字） |
| `file_name` | TEXT | 原始文件名 |
| `file_size` | INTEGER | 文件大小（字节） |
| `mime_type` | TEXT | 文件 MIME 类型 |
| `storage_type` | TEXT | 存储类型：`telegram` / `r2` |

---

## 📝 路由说明

| 路由 | 功能 |
|------|------|
| `/` | 首页（登录/上传） |
| `/login` | 登录页面 |
| `/upload` | 上传页面 |
| `/admin` | 管理后台 |
| `/delete` | 删除文件 |
| `/batch-delete` | 批量删除 |
| `/search` | 搜索文件 |
| `/history` | 上传历史 |
| `/bing` | Bing 背景图 |
| `/config` | 配置信息 |

---

## 📝 更新日志

### 2026-06-18

#### 🆕 新增功能
- **R2 存储支持**：用户可选 R2 直传，TG 失败自动降级
- **WebP 转换开关**：上传页面增加开关
- **存储方式选择**：下拉菜单选择 TG / R2
- **存储类型标签**：管理后台显示 TG / R2
- **原文件名链接**：`日期-原文件名.扩展名`

#### ⚡ 优化
- 统一文件命名格式（TG 和 R2 一致）
- 数据库索引优化
- 代码精简

---

## 🤝 参与贡献

1. Fork 本仓库
2. 创建特性分支
3. 提交更改
4. 推送到分支
5. 打开 Pull Request

## 鸣谢维护与改进
本项目基于 [0-RTT/JSimages](https://github.com/0-RTT/JSimages) 改进，由 [chnbsdan](https://github.com/chnbsdan) 持续维护和功能增强。

## 📄 许可证
本项目采用 [MIT License](./LICENSE) 开源协议。


---

**感谢使用 CF-TGBed！** 欢迎 ⭐Star 支持。
```
