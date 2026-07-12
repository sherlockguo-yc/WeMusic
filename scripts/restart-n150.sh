#!/bin/bash
# WeMusic 重启脚本（N150 生产环境，随 CI 产物一起分发）
PORT=5174
LOG=/tmp/wemusic.log
DIR="$HOME/wemusic"

# 杀旧进程
PID=$(lsof -ti:$PORT 2>/dev/null)
if [ -n "$PID" ]; then
  kill $PID 2>/dev/null
  sleep 1
  kill -9 $PID 2>/dev/null
  echo "[$(date)] stopped PID $PID"
fi

# 启动（node 从 .env 读取配置）
cd "$DIR" || exit 1
nohup node server/index.js > "$LOG" 2>&1 &
sleep 2
NEWPID=$(lsof -ti:$PORT 2>/dev/null)
if [ -n "$NEWPID" ]; then
  echo "[$(date)] started PID $NEWPID port $PORT"
else
  echo "[$(date)] 启动失败，查看 $LOG"
  tail -5 "$LOG"
fi
