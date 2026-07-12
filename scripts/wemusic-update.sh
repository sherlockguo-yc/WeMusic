#!/bin/bash
# WeMusic 自动更新脚本（N150 生产环境，由 cron 每分钟调用）
# 查询 GitHub 最新 prerelease → 与本地 .version 比对 → 有新版则下载解压重启

REPO="sherlockguo-yc/WeMusic"
DIR="$HOME/wemusic"
LOG="/tmp/wemusic-update.log"
API="https://api.github.com/repos/$REPO/releases?per_page=1"

# 取最新 release 的 tag（形如 build-xxxxxxx）
TAG=$(curl -sS --connect-timeout 10 "$API" 2>/dev/null | grep -m1 '"tag_name"' | sed -E 's/.*"tag_name": *"([^"]+)".*/\1/')
if [ -z "$TAG" ]; then
  echo "[$(date)] 查询 release 失败" >> "$LOG"
  exit 0
fi

REMOTE_VER="${TAG#build-}"
LOCAL_VER=$(cat "$DIR/.version" 2>/dev/null || echo "none")

if [ "$REMOTE_VER" = "$LOCAL_VER" ]; then
  exit 0  # 无更新
fi

echo "[$(date)] 发现新版本 $REMOTE_VER (当前: $LOCAL_VER)，开始部署" >> "$LOG"

# 下载产物
URL="https://github.com/$REPO/releases/download/$TAG/wemusic.tar.gz"
TMP="/tmp/wemusic-$REMOTE_VER.tar.gz"
if ! curl -sSL --connect-timeout 20 -o "$TMP" "$URL"; then
  echo "[$(date)] 下载失败: $URL" >> "$LOG"
  exit 0
fi

# 解压到临时目录，保护 data/ 和 .env 不被覆盖
STAGE="/tmp/wemusic-stage-$REMOTE_VER"
rm -rf "$STAGE" && mkdir -p "$STAGE"
if ! tar -xzf "$TMP" -C "$STAGE"; then
  echo "[$(date)] 解压失败" >> "$LOG"
  rm -f "$TMP"; exit 0
fi

# 同步产物到运行目录（--delete 清理旧文件，但排除 data/ 和 .env）
mkdir -p "$DIR"
rsync -a --delete --exclude 'data' --exclude '.env' "$STAGE/" "$DIR/"
rm -rf "$STAGE" "$TMP"

# 重启
bash "$DIR/restart.sh" >> "$LOG" 2>&1
echo "[$(date)] 部署完成 → $REMOTE_VER" >> "$LOG"
