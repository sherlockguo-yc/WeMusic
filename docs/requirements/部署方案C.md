# 部署方案 C：GitHub Actions 构建 + N150 拉产物

> 创建日期：2026-07-12
> 最后更新：2026-07-13

## 方案概述

```
git push → GitHub Actions:
             ① npm ci（完整依赖，用于构建）
             ② npm run build（vite + codegraph）
             ③ pkg/ 中 PUPPETEER_SKIP_DOWNLOAD=true npm ci --omit=dev
                （仅生产依赖，不下载 Chromium）
             ④ 打包 server/ + shared/ + public/ + node_modules/ + package.json → tar.gz
             ⑤ 发布 GitHub Release，tag = commit sha（如 a1b2c3d）
                                         ↓
         N150 cron（每分钟）:
             查询最新 Release tag（sha）
             → 与本地 ~/wemusic/.version 比对
             → 不同则下载 tar.gz → 解压覆盖 → bash restart.sh
             → 相同则跳过（不重复下载）
```

**N150 不接触源码、不构建、不 npm install。** 所有构建工作由 GitHub Actions 完成。

## 关键设计决策

| 决策点 | 方案 | 理由 |
|--------|------|------|
| puppeteer Chromium | CI 用 `PUPPETEER_SKIP_DOWNLOAD=true` 不打包，N150 装系统 `chromium-browser` | 避免 63M 大包，Chromium 由系统提供 |
| 版本判断 | Release tag = commit sha，N150 比对 `.version` | 避免每分钟重复下载 63M |
| 原生模块兼容 | CI `ubuntu-latest` 与 N150 均为 x86_64 Ubuntu glibc | 架构一致，`.node` 二进制可直接用 |
| 数据库 | `~/wemusic/data/` 持久化，解压时不覆盖 data 目录 | 保护生产数据 |
| puppeteer 环境变量 | N150 `.env` 加 `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser` | 让 puppeteer 用系统 Chromium |

---

## 工作清单

### 阶段 0：清理（回到干净状态）

| # | 内容 | 状态 |
|---|------|------|
| 0.1 | 停掉 5174 端口上残留的裸机 node 进程 | ⏳ |
| 0.2 | 删除 `~/wemusic/`（保留数据库备份到 `~/wemusic-data-backup/`） | ⏳ |
| 0.3 | 确认 Docker 容器状态（portainer、npm 保留） | ⏳ |

### 阶段一：Mac 端（修改 CI）

| # | 内容 | 状态 |
|---|------|------|
| 1.1 | 修改 `deploy.yml`：`PUPPETEER_SKIP_DOWNLOAD=true` + tag 改为 commit sha | ⏳ |
| 1.2 | commit + push，触发构建，确认 CI 通过且包体积 < 20M | ⏳ |

### 阶段二：N150 端（一次性配置）

| # | 内容 | 状态 |
|---|------|------|
| 2.1 | 安装系统 Chromium：`sudo apt install -y chromium-browser` | ⏳ |
| 2.2 | 创建运行目录 `~/wemusic/`，恢复数据库到 `~/wemusic/data/` | ⏳ |
| 2.3 | 创建 `.env`（PORT/JWT_SECRET/SUPER_ADMIN/PUPPETEER_EXECUTABLE_PATH） | ⏳ |
| 2.4 | 创建 `restart.sh`（杀旧进程 + 启 node server/index.js） | ⏳ |
| 2.5 | 创建 `update.sh`（查 Release tag → 比对 → 下载解压重启） | ⏳ |
| 2.6 | 设置 cron（每分钟跑 update.sh） | ⏳ |

### 阶段三：首次部署 + 验证

| # | 内容 | 状态 |
|---|------|------|
| 3.1 | 手动跑一次 update.sh，拉取首个 Release 部署 | ⏳ |
| 3.2 | 确认 NPM 反代目标为 `127.0.0.1:5174`（已改） | ⏳ |
| 3.3 | `curl localhost:5174` + `curl localhost/`（经 NPM）验证 | ⏳ |
| 3.4 | 端到端验证：push 一次代码 → 60 秒内自动上线 | ⏳ |

---

## 涉及文件

| 文件 | 位置 | 说明 |
|------|------|------|
| `.github/workflows/deploy.yml` | Mac 仓库 | CI 构建 + 发布 Release |
| `~/wemusic/.env` | N150 | 环境变量 |
| `~/wemusic/restart.sh` | N150 | 杀旧进程 + 启动 |
| `~/wemusic/update.sh` | N150 | cron 调用，检查更新 |

## 完成后效果

`git push` → CI 构建发布 Release → N150 cron 60 秒内检测到新 sha → 下载解压重启。全自动，N150 零构建。

## 前置条件

- N150 能访问 GitHub API 和 Release 下载（github.com / objects.githubusercontent.com）
- 仓库为 `sherlockguo-yc/WeMusic`，N150 的 SSH key 已有访问权限（用于 gh 或 API token）
