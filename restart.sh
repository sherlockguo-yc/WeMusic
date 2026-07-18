#!/bin/bash
# WeMusic 服务器重启脚本

PORT=5174
LOG=/tmp/wemusic.log

# 1. 先构建前端（此时旧服务器仍在运行，不影响服务）
echo "构建前端..."
npx vite build --logLevel warn

# 2. 清理 3 天前的旧 chunk（防止 dist/ 无限增长）
find public/dist/chunks -name '*.js' -mtime +3 -delete 2>/dev/null

# 3. 杀掉旧进程（包括 nodemon 子进程）
pkill -f "nodemon" 2>/dev/null
pkill -f "npx nodemon" 2>/dev/null
PID=$(lsof -ti:$PORT 2>/dev/null)
if [ -n "$PID" ]; then
  kill $PID 2>/dev/null
  sleep 1
  # 如仍存活，强制杀掉
  PID2=$(lsof -ti:$PORT 2>/dev/null)
  if [ -n "$PID2" ]; then
    kill -9 $PID2 2>/dev/null
    sleep 1
  fi
  echo "已停止旧进程 (PID $PID)"
fi

# 4. 启动新进程（nodemon 监听 server/ 目录，代码变更自动重启）
cd "$(dirname "$0")"
nohup npx nodemon server/index.js > "$LOG" 2>&1 &
echo "服务器已启动 (PID $!, 端口 $PORT)"
echo "日志: $LOG"
