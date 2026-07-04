#!/bin/bash
# WeMusic 服务器重启脚本

PORT=5174
LOG=/tmp/wemusic.log

# 杀掉旧进程
PID=$(lsof -ti:$PORT 2>/dev/null)
if [ -n "$PID" ]; then
  kill $PID 2>/dev/null
  sleep 1
  echo "已停止旧进程 (PID $PID)"
fi

# 启动新进程（nodemon 监听 server/ 目录，代码变更自动重启）
cd "$(dirname "$0")"
nohup npx nodemon server/index.js > "$LOG" 2>&1 &
echo "服务器已启动 (PID $!, 端口 $PORT)"
echo "日志: $LOG"
