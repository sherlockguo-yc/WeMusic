# 部署方案 C：GitHub Actions 构建 + N150 拉产物

> 创建日期：2026-07-12
> 完成日期：2026-07-13
> 状态：✅ 已上线，端到端全自动部署验证通过

## 方案概述

```
git push master → GitHub Actions:
             ① npm ci（完整依赖，用于构建）
             ② npm run build（vite + codegraph）
             ③ pkg/ 中 PUPPETEER_SKIP_DOWNLOAD=true npm ci --omit=dev
             ④ 移除 @ffmpeg-installer / @ffprobe-installer（140M 二进制，改用系统 ffmpeg）
             ⑤ 打包 server/ + shared/ + public/ + node_modules/ + restart.sh + .version → tar.gz（约 12M）
             ⑥ 发布/覆盖 GitHub Release，固定 tag = latest，body = "Auto build <sha>"
                                         ↓
         N150 cron（每分钟跑 ~/wemusic-update.sh）:
             查 /releases/tags/latest → 从 body 解析 sha
             → 与本地 ~/wemusic/.version 比对
             → 不同则下载 tar.gz → 校验 .version → rsync 到 ~/wemusic/
               （--delete 但排除 data/ 和 .env）→ bash restart.sh
             → 相同则跳过
```

**N150 不接触源码、不构建、不 npm install。** 所有构建由 GitHub Actions 完成，N150 仅下载 + 解压 + 重启。

## 关键设计决策

| 决策点 | 最终方案 | 理由 |
|--------|---------|------|
| puppeteer Chromium | CI `PUPPETEER_SKIP_DOWNLOAD=true` 不打包 | 减小包体积 |
| ffmpeg/ffprobe 二进制 | CI 移除 installer 包（140M），N150 装系统 `ffmpeg`，代码优先读 `FFMPEG_PATH` 环境变量 | 包体积从 65M 降到 12M |
| 版本判断 | 固定 tag `latest`，从 release body `Auto build <sha>` 解析 sha，比对本地 `.version` | `/releases/tags/latest` 端点稳定，不受 release 列表排序影响 |
| 版本查询端点 | `/releases/tags/latest`（不用 `/releases/latest`） | `/latest` 会忽略 prerelease，返回 404 |
| 仓库可见性 | public | N150 无需 token 即可匿名查 API + 下载 |
| update.sh 位置 | `~/wemusic-update.sh`（不在 `~/wemusic/` 内） | 避免被 rsync --delete 清除 |
| restart.sh 位置 | 打进 CI 产物 → `~/wemusic/restart.sh` | 随包更新，rsync 不会误删 |
| 数据库 & .env | rsync 时 `--exclude 'data' --exclude '.env'` | 保护生产数据和密钥 |
| 开机自启 | crontab `@reboot` 调 restart.sh | 替代 Docker 的 restart: unless-stopped |

---

## 工作清单（全部完成）

### 阶段一：Mac 端（CI）

| # | 内容 | 状态 |
|---|------|------|
| 1.1 | `deploy.yml`：skip puppeteer + 移除 ffmpeg installer + 固定 tag latest + body 带 sha | ✅ |
| 1.2 | commit + push，CI 通过，包体积 12M < 20M | ✅ |

### 阶段二：N150 端（一次性配置）

| # | 内容 | 状态 |
|---|------|------|
| 2.1 | 安装系统 ffmpeg（`/usr/bin/ffmpeg` 6.1.1） | ✅ |
| 2.2 | 创建 `~/wemusic/`，恢复数据库到 `~/wemusic/data/` | ✅ |
| 2.3 | 创建 `.env`（PORT/JWT_SECRET/SUPER_ADMIN/FFMPEG_PATH） | ✅ |
| 2.4 | `restart.sh`（随产物分发，杀旧进程 + 启 node） | ✅ |
| 2.5 | `~/wemusic-update.sh`（查 release → 比对 → 下载解压重启） | ✅ |
| 2.6 | cron：每分钟跑 update.sh + `@reboot` 自启 | ✅ |

### 阶段三：首次部署 + 验证

| # | 内容 | 状态 |
|---|------|------|
| 3.1 | 手动跑 update.sh 拉取首个 Release 部署 | ✅ |
| 3.2 | NPM 反代目标改为 `127.0.0.1:5174` | ✅ |
| 3.3 | `curl localhost:5174` + `curl localhost/` 均 200 | ✅ |
| 3.4 | 端到端：push → CI → cron 自动检测 → 60s 内上线（25b3aae → f7317b9 验证通过） | ✅ |

---

## 涉及文件

| 文件 | 位置 | 说明 |
|------|------|------|
| `.github/workflows/deploy.yml` | Mac 仓库 | CI 构建 + 发布 Release |
| `scripts/restart-n150.sh` | Mac 仓库 | 打进产物，部署为 `~/wemusic/restart.sh` |
| `scripts/wemusic-update.sh` | Mac 仓库 | 部署为 N150 `~/wemusic-update.sh` |
| `~/wemusic/.env` | N150 | 环境变量（含 FFMPEG_PATH） |
| `server/routes/play.js` | Mac 仓库 | ffmpeg 路径改为优先读 FFMPEG_PATH 环境变量 |

## 日常使用

改代码 → `git push` → 60 秒后 N150 自动上线。无需任何手动操作。

## 运维备忘

- 部署日志：`ssh weweb 'tail -f /tmp/wemusic-update.log'`
- 服务日志：`ssh weweb 'tail -f /tmp/wemusic.log'`
- 当前版本：`ssh weweb 'cat ~/wemusic/.version'`
- 手动触发更新：`ssh weweb 'bash ~/wemusic-update.sh'`
- 手动重启：`ssh weweb 'bash ~/wemusic/restart.sh'`

## 遗留事项

- 分享海报功能依赖 puppeteer + Chromium。N150 未装系统 Chromium（Ubuntu Server 无桌面，chromium 为 snap 包）。如需该功能，后续在 `.env` 加 `PUPPETEER_EXECUTABLE_PATH` 并安装 Chromium。当前主流程（播放/歌单/搜索）不受影响。
- 旧的 Docker `~/wemusic-build` 相关的 volume 数据库仍保留在 `/var/lib/docker/volumes/`，确认新部署稳定后可清理。
