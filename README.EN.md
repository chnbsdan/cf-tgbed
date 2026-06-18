# CF-TGBed

## A self-hosted image hosting and file management system based on Cloudflare Workers + D1 Database + Telegram Channel + R2 Storage.

[![GitHub license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![JavaScript](https://img.shields.io/badge/JavaScript-100%25-yellow.svg)](https://www.javascript.com/)

> **Language**: [中文](./README.md) | [English](./README.EN.md)

A self-hosted image hosting and file management system based on Cloudflare Workers + D1 Database + Telegram Channel + R2 Storage.

---

## 📖 Introduction

`CF-TGBed` is a lightweight, self-hosted file sharing solution. It leverages **Cloudflare Workers** for serverless computing, **D1** for metadata storage, **Telegram Channels** as the primary storage backend, and **R2** as a backup storage option. It provides a highly available, fully controllable file hosting system with a built-in admin panel.

Files can be uploaded via Telegram Bot to a specified channel or directly to R2, generating direct links for sharing, downloading, and online preview.

---

## ✨ Features

### Core Features
- 🔐 **Optional Authentication** (Cookie-based login with configurable expiry)
- 🗜️ **WebP Conversion** (Frontend toggle, disabled by default)
- 📦 **File Size Limiting** (Default 20MB, configurable via environment variables)
- 📁 **All File Formats Supported** (Images, videos, documents, etc.)
- 📤 **Multi-File Upload** (Drag & drop, click selection, and Ctrl+V paste support)
- ☁️ **Dual Storage Support** (Telegram Channel default + R2 direct upload)
- 🔄 **R2 Fallback** (Auto-fallback to R2 when Telegram upload fails)

### Admin Features
- 🖼️ **Admin Dashboard** (Full management interface with batch operations)
- 🗑️ **Batch File Deletion** (Sync deletes from Telegram/R2 and database)
- 📋 **Batch Link Copying** (URL, Markdown, HTML, BBCode formats)
- 🖼️ **Full-Screen Preview** (Modal popup for images)
- 🏷️ **Storage Type Labels** (TG / R2 identification)
- 📊 **Pagination & Search** (Built-in search and pagination)
- ⏰ **Upload Timestamps** (File upload time display)

### Performance Optimizations
- ⚡ **Cloudflare Cache API** support
- 🎨 **Lazy Loading** and responsive design
- 🌅 **Bing Daily Wallpaper** (Auto-rotating background)
- 📱 **Mobile Responsive** (Full support for all devices)

---

## 🛠️ Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | [Cloudflare Workers](https://workers.cloudflare.com/) |
| Database | [Cloudflare D1](https://developers.cloudflare.com/d1/) |
| Primary Storage | [Telegram Bot API](https://core.telegram.org/bots/api) |
| Backup Storage | [Cloudflare R2](https://developers.cloudflare.com/r2/) |
| Cache | Cloudflare Workers Cache API |
| Language | JavaScript (ES Modules) |

---

## 🚀 Deployment Guide

> ⚠️ **Recommendation**: Configure **Edge TTL** caching and enable **User Authentication** to prevent abuse and unexpected charges.

### Prerequisites

1. **Telegram Setup**:
   - Create a **Telegram Bot** and get its `Bot Token`
   - Create a **public channel** and add the bot as an administrator
   - Get the channel **Chat ID** (format: `-10*****062333`)

2. **Cloudflare Setup**:
   - Cloudflare account
   - Create a **D1 Database**
   - Create an **R2 Bucket** (optional, for R2 support)

### Step 1: Create R2 Bucket (Optional)

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Navigate to **R2 Object Storage** → **Create Bucket**
3. Set bucket name (e.g., `tgbed-backup`) and region
4. Save the bucket name for later use

### Step 2: Create D1 Database

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Navigate to **Workers & Pages** → **D1 SQL Database**
3. Click **Create** to create a database
   - Database name: e.g., `imgbed`
   - Recommended region: **Asia Pacific** for better speed
4. Record the database ID for binding

### Step 3: Create Worker

1. Go to **Workers & Pages**
2. Click **Create** → **Create Worker**
3. Set a name for your Worker
4. Click **Deploy** to create the Worker

### Step 4: Bind D1 Database and R2 Bucket

In your Worker **Settings** → **Bindings**:

| Binding Type | Variable Name | Description |
|--------------|---------------|-------------|
| D1 Database | `DATABASE` | Bind the created D1 database |
| R2 Bucket | `R2_BUCKET` | Bind the created R2 bucket (optional) |

### Step 5: Configure Environment Variables

In your Worker **Settings** → **Variables**:

| Variable | Type | Description | Required |
|----------|------|-------------|----------|
| `DOMAIN` | Plain Text | Your project domain | ✅ |
| `USERNAME` | Plain Text | Admin username (default `admin`) | ✅ |
| `PASSWORD` | Encrypted | Admin password | ✅ |
| `TG_BOT_TOKEN` | Encrypted | Telegram Bot Token | ✅ |
| `TG_CHAT_ID` | Encrypted | Telegram Channel ID (format: `-10*****062333`) | ✅ |
| `ENABLE_AUTH` | Plain Text | Enable authentication (`true`/`false`) | ❌ |
| `COOKIE` | Plain Text | Login cookie expiry in days (default `7`) | ❌ |
| `MAX_SIZE_MB` | Plain Text | Max file size in MB (default `20`) | ❌ |
| `ENABLE_R2_FALLBACK` | Plain Text | Enable R2 fallback (`true`/`false`) | ❌ |
| `R2_PUBLIC_URL` | Plain Text | R2 public domain (leave empty to use main domain) | ❌ |

### Step 6: Deploy Code

1. Go to your Worker's **Quick Edit** page
2. Copy and paste the complete `_worker.js` code
3. Click **Save and Deploy**

### Step 7: Configure Custom Domain (Optional)

1. In your Worker **Settings** → **Domains & Routes**
2. Click **Add** → **Custom Domain**
3. Enter your Cloudflare-managed domain
4. Click **Add Domain**

### Step 8: Configure Cache (Recommended)

1. Go to Cloudflare Dashboard → **Website** → **Your Domain**
2. Navigate to **Cache** → **Cache Rules** → **Create Cache Rule**
3. Select **Cache Everything** template
4. Set **Edge TTL** → **Ignore cache-control headers and use this TTL** → **30 days**
5. Click **Deploy**

---

## 🔧 Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `DOMAIN` | Project domain | **Yes** | - |
| `TG_BOT_TOKEN` | Telegram Bot access token | **Yes** | - |
| `TG_CHAT_ID` | Telegram Channel ID (format: `-10*****062333`) | **Yes** | - |
| `USERNAME` | Admin login username | **Yes** | `admin` |
| `PASSWORD` | Admin login password | **Yes** | `admin` |
| `ENABLE_AUTH` | Enable login authentication | No | `true` |
| `COOKIE` | Login cookie expiry (days) | No | `7` |
| `MAX_SIZE_MB` | Max single file size (MB) | No | `20` |
| `ENABLE_R2_FALLBACK` | Enable R2 fallback storage | No | `false` |
| `R2_PUBLIC_URL` | R2 public domain (leave empty to use main domain) | No | `""` |

---

## 📋 Feature Details

### Storage Methods

| Method | Description | Use Case |
|--------|-------------|----------|
| **Telegram (Default)** | Upload to Telegram Channel | Daily use, free storage |
| **R2 Direct** | Upload directly to R2 | Fast, stable access required |
| **R2 Fallback** | Auto-fallback when Telegram fails | High availability guarantee |

### Upload Page

- **Storage Method Selector**: Dropdown to choose Telegram or R2
- **WebP Toggle**: Enable/disable WebP conversion
- **Drag & Drop / Click Upload**: Multi-file support with progress bar
- **Upload Statistics**: Display file count and total size

### Admin Dashboard

- **File List**: All files with pagination and search
- **Storage Labels**: `TG` / `R2` badges indicating storage location
- **Batch Operations**: Bulk copy links, bulk delete
- **Single File Operations**: Copy, Open, Share (QR code), Delete
- **Full-Screen Preview**: Click image to open modal

---

## 🗄️ Database Schema

### `files` Table

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

| Field | Type | Description |
|-------|------|-------------|
| `url` | TEXT | File access link (Primary Key) |
| `fileId` | TEXT | Telegram/R2 file ID |
| `message_id` | INTEGER | Telegram message ID |
| `created_at` | INTEGER | Creation timestamp (numeric) |
| `file_name` | TEXT | Original file name |
| `file_size` | INTEGER | File size (bytes) |
| `mime_type` | TEXT | File MIME type |
| `storage_type` | TEXT | Storage type: `telegram` / `r2` |

---

## 📝 Route Map

| Route | Function |
|-------|----------|
| `/` | Homepage (Login/Upload) |
| `/login` | Login page |
| `/upload` | Upload page |
| `/admin` | Admin dashboard |
| `/delete` | Delete file |
| `/batch-delete` | Batch delete |
| `/search` | Search files |
| `/history` | Upload history |
| `/bing` | Bing background |
| `/config` | Configuration info |

---

## 📝 Changelog

### 2026-06-18

#### 🆕 New Features
- **R2 Storage Support**: R2 direct upload and auto-fallback
- **WebP Toggle**: Frontend switch for WebP conversion
- **Storage Method Selector**: Dropdown for TG / R2 selection
- **Storage Labels**: Display TG / R2 badges in admin
- **Original Filename Links**: `date-original_filename.extension` format

#### ⚡ Optimizations
- Unified file naming (TG and R2 consistent)
- Database indexing improvements
- Code cleanup and refactoring

### 2026-01-21
- Updated code with Claude Opus 4.5

### 2025-08-24
- Fixed CDN outage related loading issues

### 2025-08-07
- Fixed homepage background image loading

### 2024-12-18
- Updated admin UI styles
- Configurable file size via environment variables

### 2024-12-17
- Added compression toggle button

### 2024-12-16
- Sync deletion from R2 storage
- Forked from [0-RTT/telegraph](https://github.com/0-RTT/telegraph)

---

## 🤝 Contributing

1. Fork this repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📄 License

MIT License

## Acknowledgements

Thanks to [0-RTT](https://github.com/0-RTT/telegraph) for the inspiration.

---

**Thanks for using CF-TGBed!** ⭐ Star support is welcome.
