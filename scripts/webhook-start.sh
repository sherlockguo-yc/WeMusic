#!/bin/bash
# N150 Webhook 服务启动脚本；部署到 ~/webhook-start.sh，独立于项目目录。

set -e

DIR="$HOME/wemusic"
LOG="/tmp/webhook.log"
PORT=9001

[ -f "$DIR/.env" ] && . "$DIR/.env"
# .env 中的 PORT 属于 WeMusic 主服务，不能覆盖 webhook 端口。
PORT=9001

PID=$(lsof -ti:"$PORT" 2>/dev/null)
if [ -n "$PID" ]; then
  kill $PID 2>/dev/null || true
  sleep 1
  kill -9 $PID 2>/dev/null || true
  echo "[$(date)] 停止旧 webhook PID $PID" >> "$LOG"
fi

cd "$DIR"
nohup node server/webhook.js > "$LOG" 2>&1 &
sleep 1

NEW_PID=$(lsof -ti:"$PORT" 2>/dev/null)
if [ -n "$NEW_PID" ]; then
  echo "[$(date)] webhook 启动成功 PID $NEW_PID 端口 $PORT" >> "$LOG"
else
  echo "[$(date)] webhook 启动失败" >> "$LOG"
  tail -5 "$LOG"
  exit 1
fi
