# OpenList 部署与构建文档

## 项目概述

OpenList 是一个文件列表程序，支持多种存储驱动，提供 Web 界面管理文件。本项目在官方基础上新增了**分片上传功能**，支持大文件分片上传、断点续传和秒传。

## 项目结构

```
/workspace/
├── OpenList/                      # 后端源码 (Go)
│   ├── main.go                    # 程序入口
│   ├── server/
│   │   ├── router.go              # 路由配置（含分片上传路由）
│   │   └── handles/
│   │       └── chunk_upload.go    # 分片上传处理器
│   ├── public/
│   │   ├── public.go              # 嵌入前端静态文件 (go:embed)
│   │   └── dist/                  # 前端构建产物
│   ├── internal/                  # 内部核心模块
│   ├── build.sh                   # 官方构建脚本
│   └── go.mod                     # Go 依赖管理
├── OpenList-Frontend/             # 前端源码 (React + SolidJS)
│   ├── src/
│   │   ├── lang/
│   │   │   ├── en/                # 英文翻译（源语言）
│   │   │   ├── zh-CN/             # 简体中文翻译
│   │   │   └── zh-TW/             # 繁体中文翻译
│   │   └── pages/home/uploads/
│   │       ├── Upload.tsx         # 上传页面组件
│   │       ├── chunked.ts         # 分片上传逻辑
│   │       ├── uploads.ts         # 上传方式注册
│   │       └── types.ts           # 类型定义
│   ├── build.sh                   # 前端构建脚本
│   ├── crowdin.yml                # Crowdin 多语言配置
│   └── .gitignore                 # 已修改以跟踪 zh-CN/zh-TW
├── data/
│   ├── config.json                # OpenList 运行配置
│   └── data.db                    # SQLite 数据库
├── extract_zh_cn.py               # 中文翻译提取脚本
├── openlist-linux-amd64           # 编译好的二进制文件 (LFS)
├── DEPLOYMENT.md                  # 本文档
└── .gitattributes                 # LFS 跟踪配置
```

## 新增功能：分片上传

### 后端 API

分片上传接口注册在 `server/router.go`，路由组 `/fs/chunk`：

| 接口 | 方法 | 说明 |
|------|------|------|
| `/fs/chunk/init` | POST | 初始化分片上传会话，支持秒传检测 |
| `/fs/chunk/upload` | POST | 上传单个分片，支持断点续传 |
| `/fs/chunk/complete` | POST | 合并所有分片并写入存储 |
| `/fs/chunk/status` | GET | 查询上传会话状态 |
| `/fs/chunk/abort` | POST | 取消上传并清理临时文件 |

核心实现文件：`OpenList/server/handles/chunk_upload.go`

**关键参数：**
- 默认分片大小：10MB
- 最小分片大小：1MB
- 最大分片大小：100MB
- 会话过期时间：24 小时
- 后台自动清理过期会话

### 前端上传模式

在 `OpenList-Frontend/src/pages/home/uploads/` 中实现了两种上传模式：

1. **Auto（智能上传）**：大文件自动走分片上传，小文件走 Stream 流式上传
2. **Chunked（强制分片）**：不论文件大小都走分片上传

**前端特性：**
- 3 路并发上传分片
- 每个分片失败重试 3 次（指数退避）
- 分片大小可在 UI 中配置（1-100MB），通过 `localStorage` 持久化
- 支持秒传（通过 MD5/SHA1/SHA256 哈希匹配）
- 支持断点续传

核心实现文件：
- `OpenList-Frontend/src/pages/home/uploads/chunked.ts`
- `OpenList-Frontend/src/pages/home/uploads/Upload.tsx`

## 构建指南

### 环境要求

- Go 1.25+
- Node.js 24+
- pnpm 11+

### 1. 构建前端

```bash
cd OpenList-Frontend
pnpm install
pnpm build
```

构建产物在 `OpenList-Frontend/dist/`。

### 2. 复制前端到后端

```bash
rm -rf OpenList/public/dist
cp -r OpenList-Frontend/dist OpenList/public/dist
```

### 3. 构建后端二进制

```bash
cd OpenList
GOTOOLCHAIN=local CGO_ENABLED=0 go build \
  -o ../openlist-linux-amd64 \
  -ldflags="-w -s \
    -X 'github.com/OpenListTeam/OpenList/v4/internal/conf.Version=v4.2.3-custom' \
    -X 'github.com/OpenListTeam/OpenList/v4/internal/conf.WebVersion=v4.2.3'" \
  -tags=jsoniter .
```

> 注意：`CGO_ENABLED=0` 表示纯 Go 编译，SQLite 使用 glebarez 纯 Go 驱动。
> 如需 CGO（SQLite gorm 驱动），设置 `CGO_ENABLED=1` 并安装 C 编译器。

### 4. 使用官方构建脚本

```bash
cd OpenList
# 开发构建（会自动下载前端 rolling 版本）
bash build.sh dev

# 发布构建
bash build.sh release
```

## 多语言翻译

### 翻译来源

官方通过 [Crowdin](https://crowdin.com) 管理多语言翻译，构建时从 Crowdin 拉取并注入。

- 源语言文件：`src/lang/en/*.json`
- 翻译文件：`src/lang/<locale>/*.json`

### 已包含的翻译

本仓库已从官方 v4.2.3 Release 的 `i18n.tar.gz` 下载并内置了完整的：

- **zh-CN**（简体中文）：16 个 JSON 文件
- **zh-TW**（繁体中文）：16 个 JSON 文件

### 更新翻译

```bash
# 方法 1：从 GitHub Release 下载
curl -L -o i18n.tar.gz \
  "https://github.com/OpenListTeam/OpenList-Frontend/releases/download/v4.2.3/i18n.tar.gz"
tar -xzf i18n.tar.gz -C OpenList-Frontend/src/lang

# 方法 2：使用 Crowdin CLI（需要 API Token）
cd OpenList-Frontend
pnpm crowdin:download
```

### .gitignore 配置

官方 `.gitignore` 默认忽略 `src/lang/*`（仅保留 `en/`）。本项目已修改为同时跟踪 `zh-CN/` 和 `zh-TW/`：

```
/src/lang/*
!/src/lang/en/
!/src/lang/zh-CN/
!/src/lang/zh-TW/
```

## 运行配置

配置文件位于 `data/config.json`，关键配置项：

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `scheme.http_port` | 5244 | HTTP 监听端口 |
| `database.type` | sqlite3 | 数据库类型 |
| `database.db_file` | /workspace/data/data.db | SQLite 文件路径 |
| `temp_dir` | /workspace/data/temp | 临时目录（分片上传临时文件存放处） |
| `max_concurrency` | 64 | 最大并发数 |

## Git LFS 管理

以下大文件通过 Git LFS 管理（`.gitattributes`）：

```
openlist-linux-amd64 filter=lfs diff=lfs merge=lfs -text
data/data.db filter=lfs diff=lfs merge=lfs -text
*.db filter=lfs diff=lfs merge=lfs -text
```

克隆仓库后需要执行 `git lfs pull` 获取大文件。

## 仓库信息

- **仓库地址**：`https://github.com/fs5vcx/OpenListpeo`
- **分支**：`trae/agent-11gk5T`
- **基于版本**：OpenList v4.2.3
