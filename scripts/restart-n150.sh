#!/bin/bash
# WeMusic 重启脚本（N150 生产环境，随 CI 产物一起分发）
PORT=5174
LOG=/tmp/wemusic.log
DIR="$HOME/wemusic"
EVENTS="$DIR/data/deploy-events.jsonl"

log_event() {
  local stage="$1" status="$2" message="$3"
  local ts=$(date +%s)
  mkdir -p "$DIR/data"
  echo "{\"stage\":\"$stage\",\"status\":\"$status\",\"message\":\"$message\",\"ts\":$ts}" >> "$EVENTS"
}

# 杀旧进程
PID=$(lsof -ti:$PORT 2>/dev/null)
if [ -n "$PID" ]; then
  kill $PID 2>/dev/null
  sleep 1
  kill -9 $PID 2>/dev/null
  echo "[$(date)] stopped PID $PID"
  log_event "restart" "ok" "已停止旧进程 PID $PID"
fi

# 启动
cd "$DIR" || exit 1
# 加载持久化凭据（如 GITHUB_TOKEN）—— .env 受 rsync --exclude 保护，跨版本持久
[ -f "$DIR/.env" ] && . "$DIR/.env"
nohup node server/index.js > "$LOG" 2>&1 &
sleep 2
NEWPID=$(lsof -ti:$PORT 2>/dev/null)
if [ -n "$NEWPID" ]; then
  echo "[$(date)] started PID $NEWPID port $PORT"
  log_event "restart" "ok" "启动成功 PID $NEWPID :$PORT"
else
  echo "[$(date)] 启动失败，查看 $LOG"
  log_event "restart" "error" "启动失败"
  tail -5 "$LOG"
fi
