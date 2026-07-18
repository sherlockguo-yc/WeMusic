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
API="https://api.github.com/repos/$REPO/releases/tags/latest"

# 查询 latest release，从 body "Auto build <sha>" 提取 sha
BODY=$(curl -sS -H "Cache-Control: no-cache" --connect-timeout 10 "$API" 2>/dev/null)
REMOTE_VER=$(echo "$BODY" | grep -m1 '"body"' | sed -E 's/.*Auto build ([a-f0-9]+).*/\1/')

if [ -z "$REMOTE_VER" ] || [ "$REMOTE_VER" = "$BODY" ]; then
  echo "[$(date)] 查询 release 失败或无法解析版本" >> "$LOG"
  exit 0
fi

LOCAL_VER=$(cat "$DIR/.version" 2>/dev/null || echo "none")
if [ "$REMOTE_VER" = "$LOCAL_VER" ]; then
  exit 0  # 无更新
fi

echo "[$(date)] 发现新版本 $REMOTE_VER (当前: $LOCAL_VER)，开始部署" >> "$LOG"

# 下载产物 — 优先 ghproxy.net 镜像
URL="https://github.com/$REPO/releases/download/latest/wemusic.tar.gz"
MIRROR_URL="https://ghproxy.net/$URL"
TMP="/tmp/wemusic-latest.tar.gz"
DOWNLOAD_OK=0

for i in 1 2 3 4 5; do
  if curl -sSL --connect-timeout 15 -o "$TMP" "$MIRROR_URL" 2>/dev/null && file "$TMP" | grep -q "gzip"; then
    DOWNLOAD_OK=1
    break
  fi
  sleep 3
done

if [ "$DOWNLOAD_OK" -ne 1 ]; then
  for i in 1 2 3 4 5 6 7 8; do
    if curl -sSL --connect-timeout 20 -o "$TMP" "$URL" 2>/dev/null && file "$TMP" | grep -q "gzip"; then
      DOWNLOAD_OK=1
      break
    fi
    sleep 3
  done
fi

if [ "$DOWNLOAD_OK" -ne 1 ]; then
  echo "[$(date)] 下载失败（镜像+直连均重试后失败）" >> "$LOG"
  rm -f "$TMP"
  exit 0
fi

# 解压到临时目录
STAGE="/tmp/wemusic-stage"
rm -rf "$STAGE" && mkdir -p "$STAGE"
if ! tar -xzf "$TMP" -C "$STAGE"; then
  echo "[$(date)] 解压失败" >> "$LOG"
  rm -f "$TMP"; exit 0
fi

# 校验：解压出的 .version 应与远端一致
STAGE_VER=$(cat "$STAGE/.version" 2>/dev/null)
if [ "$STAGE_VER" != "$REMOTE_VER" ]; then
  echo "[$(date)] 版本校验失败: 包内=$STAGE_VER 期望=$REMOTE_VER" >> "$LOG"
  rm -rf "$STAGE" "$TMP"; exit 0
fi

# 同步到运行目录（--delete 清理旧文件，但保护 data/ 和 .env）
mkdir -p "$DIR"
rsync -a --delete --exclude 'data' --exclude '.env' "$STAGE/" "$DIR/"
rm -rf "$STAGE" "$TMP"

# 重启
bash "$DIR/restart.sh" >> "$LOG" 2>&1
echo "[$(date)] 部署完成 → $REMOTE_VER" >> "$LOG"
