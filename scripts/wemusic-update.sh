#!/bin/bash
# WeMusic 自动更新脚本（N150 生产环境，由 cron 每分钟调用）
# 查询 GitHub 固定 tag "latest" 的 release → 从 body 提取 sha → 与本地 .version 比对 → 有新版则部署
# 本脚本放在 ~/ 下，不在 ~/wemusic/ 内，避免被 rsync --delete 清除

set -e

LOCK_FILE="/tmp/wemusic-update.lock"
exec 200>"$LOCK_FILE"
if ! flock -n 200; then
  exit 0  # 另一个实例正在运行
fi

REPO="sherlockguo-yc/WeMusic"
DIR="$HOME/wemusic"
LOG="/tmp/wemusic-update.log"
EVENTS="$DIR/data/deploy-events.jsonl"
API="https://api.github.com/repos/$REPO/releases/tags/latest"

# 加载持久化凭据（.env 受 rsync --exclude 保护），GITHUB_TOKEN 用于将 API 额度从 60→5000/hr
[ -f "$DIR/.env" ] && . "$DIR/.env"

# 写入结构化部署事件
log_event() {
  local stage="$1" status="$2" message="$3"
  local ts=$(date +%s)
  mkdir -p "$DIR/data"
  echo "{\"stage\":\"$stage\",\"status\":\"$status\",\"message\":\"$message\",\"ts\":$ts}" >> "$EVENTS"
}

# 查询 latest release，从 body "Auto build <sha>" 提取 sha
if [ -n "${GITHUB_TOKEN:-}" ]; then
  BODY=$(curl -sS -H "Authorization: Bearer $GITHUB_TOKEN" -H "Cache-Control: no-cache" --max-time 30 --connect-timeout 10 "$API" 2>/dev/null)
else
  BODY=$(curl -sS -H "Cache-Control: no-cache" --max-time 30 --connect-timeout 10 "$API" 2>/dev/null)
fi
REMOTE_VER=$(echo "$BODY" | grep -m1 '"body"' | sed -E 's/.*Auto build ([a-f0-9]+).*/\1/')

if [ -z "$REMOTE_VER" ] || [ "$REMOTE_VER" = "$BODY" ]; then
  echo "[$(date)] 查询 release 失败或无法解析版本" >> "$LOG"
  log_event "check" "error" "查询 release 失败"
  exit 0
fi

LOCAL_VER=$(cat "$DIR/.version" 2>/dev/null || echo "none")
if [ "$REMOTE_VER" = "$LOCAL_VER" ]; then
  log_event "check" "ok" "已是最新版本 $REMOTE_VER"
  exit 0  # 无更新
fi

echo "[$(date)] 发现新版本 $REMOTE_VER (当前: $LOCAL_VER)，开始部署" >> "$LOG"
log_event "download" "started" "发现新版本 $REMOTE_VER"

# 下载产物 — 优先 ghproxy.net 镜像
URL="https://github.com/$REPO/releases/download/latest/wemusic.tar.gz"
MIRROR_URL="https://ghproxy.net/$URL"
TMP="/tmp/wemusic-latest.tar.gz"
DOWNLOAD_OK=0

for i in 1 2 3 4 5; do
  if curl -sSL --max-time 60 --connect-timeout 15 -o "$TMP" "$MIRROR_URL" 2>/dev/null && file "$TMP" | grep -q "gzip"; then
    DOWNLOAD_OK=1
    break
  fi
  sleep 3
done

if [ "$DOWNLOAD_OK" -ne 1 ]; then
  for i in 1 2 3 4 5 6 7 8; do
    if curl -sSL --max-time 60 --connect-timeout 20 -o "$TMP" "$URL" 2>/dev/null && file "$TMP" | grep -q "gzip"; then
      DOWNLOAD_OK=1
      break
    fi
    sleep 3
  done
fi

if [ "$DOWNLOAD_OK" -ne 1 ]; then
  echo "[$(date)] 下载失败（镜像+直连均重试后失败）" >> "$LOG"
  log_event "download" "error" "下载失败"
  rm -f "$TMP"
  exit 0
fi

log_event "download" "ok" "下载完成 $REMOTE_VER"

# 解压到临时目录
STAGE="/tmp/wemusic-stage"
rm -rf "$STAGE" && mkdir -p "$STAGE"
if ! tar -xzf "$TMP" -C "$STAGE"; then
  echo "[$(date)] 解压失败" >> "$LOG"
  log_event "deploy" "error" "解压失败"
  rm -f "$TMP"; exit 0
fi

# 校验：解压出的 .version 应与远端一致
STAGE_VER=$(cat "$STAGE/.version" 2>/dev/null)
if [ "$STAGE_VER" != "$REMOTE_VER" ]; then
  echo "[$(date)] 版本校验失败（可能是镜像缓存过期）: 包内=$STAGE_VER 期望=$REMOTE_VER" >> "$LOG"
  log_event "deploy" "error" "版本校验失败（镜像缓存），尝试直连 GitHub 重试"

  # 镜像可能缓存了旧版本，跳过镜像直连 GitHub 重试一次
  rm -rf "$STAGE" "$TMP"
  if curl -sSL --max-time 60 --connect-timeout 20 -o "$TMP" "$URL" 2>/dev/null && file "$TMP" | grep -q "gzip"; then
    log_event "download" "ok" "直连下载完成 $REMOTE_VER"
    rm -rf "$STAGE" && mkdir -p "$STAGE"
    if tar -xzf "$TMP" -C "$STAGE"; then
      STAGE_VER=$(cat "$STAGE/.version" 2>/dev/null)
      if [ "$STAGE_VER" = "$REMOTE_VER" ]; then
        echo "[$(date)] 直连下载版本校验通过" >> "$LOG"
      else
        echo "[$(date)] 直连下载版本校验仍失败: 包内=$STAGE_VER 期望=$REMOTE_VER" >> "$LOG"
        log_event "deploy" "error" "直连版本校验仍失败"
        rm -rf "$STAGE" "$TMP"; exit 0
      fi
    else
      echo "[$(date)] 直连下载解压失败" >> "$LOG"
      log_event "deploy" "error" "直连解压失败"
      rm -rf "$STAGE" "$TMP"; exit 0
    fi
  else
    echo "[$(date)] 直连下载失败" >> "$LOG"
    log_event "deploy" "error" "直连下载失败"
    rm -f "$TMP"; exit 0
  fi
fi

# 同步到运行目录（--delete 清理旧文件，但保护 data/ 和 .env）
log_event "deploy" "started" "开始同步文件 $REMOTE_VER"
mkdir -p "$DIR"
rsync -a --delete --exclude 'data' --exclude '.env' "$STAGE/" "$DIR/"
rm -rf "$STAGE" "$TMP"
log_event "deploy" "ok" "文件同步完成 $REMOTE_VER"

# 重启（200>&- 关闭锁 fd，避免 node 进程继承后永久持有锁）
bash "$DIR/restart.sh" 200>&- >> "$LOG" 2>&1
echo "[$(date)] 部署完成 → $REMOTE_VER" >> "$LOG"
