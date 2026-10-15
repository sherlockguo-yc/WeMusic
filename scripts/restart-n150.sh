#!/bin/bash
# WeMusic 重启脚本（N150 生产环境，随 CI 产物一起分发）
PORT=5174
LOG=/tmp/wemusic.log
DIR="$HOME/wemusic"
EVENTS="$DIR/data/deploy-events.jsonl"
DEPS_DIR="$HOME/wemusic-deps"
LOCK_FILE=/tmp/wemusic-restart.lock

# 同一时刻只允许一个 restart.sh 执行：cron 健康检查与 webhook 部署会并发触发，
# 而依赖安装可能持续数分钟，并发跑会互相踩坏 node_modules。
#
# 锁必须在拉起常驻服务时显式关闭（9>&-）：常驻进程若继承 fd 9 就会永久持有锁，
# 之后每一次部署都卡死在 flock 上（2026-10-13 在别的项目上踩过这个坑）。
# 本脚本有三个后台启动点（systemd-run / 裸 node / webhook），每一个都要 9>&-。
exec 9>"$LOCK_FILE"
flock 9
echo "[$(date)] 已获得部署锁 $LOCK_FILE"

log_event() {
  local stage="$1" status="$2" message="$3"
  local ts=$(date +%s)
  mkdir -p "$DIR/data"
  echo "{\"stage\":\"$stage\",\"status\":\"$status\",\"message\":\"$message\",\"ts\":$ts}" >> "$EVENTS"
}

# ── 准备运行时依赖 ────────────────────────────────────────────────
# 依赖装在部署目录之外：deploy-agent 用 rsync -a --delete 同步 $DIR，
# 包里没有的东西都会被清掉（node_modules 也不例外），所以不能放在 $DIR 下。
# 只有 package-lock.json 变化时才重装；未变化时实测 0.3 秒跳过。
DEPS_MARKER="$DEPS_DIR/.lock-hash"

if [ -x /usr/local/bin/npm ]; then
  NPM=/usr/local/bin/npm
else
  NPM="$(command -v npm || echo npm)"
fi

ensure_deps() {
  local want
  want=$(sha1sum "$DIR/package-lock.json" 2>/dev/null | cut -d' ' -f1)
  if [ -z "$want" ]; then
    echo "[$(date)] ✗ 缺少 package-lock.json，无法安装依赖"
    log_event "deps" "error" "缺少 package-lock.json，未重启"
    return 1
  fi

  mkdir -p "$DEPS_DIR"
  if [ "$(cat "$DEPS_MARKER" 2>/dev/null)" = "$want" ] && [ -d "$DEPS_DIR/node_modules" ]; then
    echo "[$(date)] 依赖未变更，跳过安装"
  else
    cp "$DIR/package.json" "$DIR/package-lock.json" "$DEPS_DIR/"
    echo "[$(date)] 安装依赖到 $DEPS_DIR（npmmirror + 本地缓存优先）…"
    log_event "deps" "started" "安装依赖到 $DEPS_DIR"
    # 两个坑（2026-10-15 实测）：
    #   · puppeteer 与 @ffmpeg-installer 都是 dependencies，默认会跑 postinstall
    #     从境外下载 Chromium（约 150MB）和 ffmpeg 二进制，在 N150 上必然超时。
    #     Chromium 由下面的检查逻辑按需安装、ffmpeg 用系统版，所以整体跳过脚本。
    #   · 跳过脚本会让 better-sqlite3 拿不到原生二进制，必须单独 rebuild 补回来
    #     （实测：install 3 秒 + rebuild 2.9 秒，且能正常读写 SQLite）。
    if ! (cd "$DEPS_DIR" && PUPPETEER_SKIP_DOWNLOAD=true "$NPM" install --omit=dev \
        --ignore-scripts --prefer-offline --no-audit --no-fund \
        --registry=https://registry.npmmirror.com); then
      echo "[$(date)] ✗ 依赖安装失败"
      log_event "deps" "error" "依赖安装失败，未重启"
      return 1
    fi
    if ! (cd "$DEPS_DIR" && "$NPM" rebuild better-sqlite3); then
      echo "[$(date)] ✗ better-sqlite3 rebuild 失败"
      log_event "deps" "error" "better-sqlite3 rebuild 失败，未重启"
      return 1
    fi
    printf '%s' "$want" > "$DEPS_MARKER"
  fi

  # rsync --delete 每轮都会清掉部署目录里的 node_modules，用软链接接回去
  if [ -e "$DIR/node_modules" ] && [ ! -L "$DIR/node_modules" ]; then
    rm -rf "$DIR/node_modules"
  fi
  ln -sfn "$DEPS_DIR/node_modules" "$DIR/node_modules"
  echo "[$(date)] 依赖就绪：$DIR/node_modules -> $DEPS_DIR/node_modules"
  return 0
}

# 装在停进程之前：安装期间旧版本仍在提供服务，cron 健康检查不会插进来重启
if ! ensure_deps; then
  echo "[$(date)] ✗ 依赖准备失败，保持旧版本继续运行（不重启）"
  exit 1
fi

# 杀旧进程
PID=$(lsof -ti:$PORT 2>/dev/null)
if [ -n "$PID" ]; then
  kill $PID 2>/dev/null
  sleep 1
  kill -9 $PID 2>/dev/null
  echo "[$(date)] stopped PID $PID"
  log_event "restart" "ok" "已停止旧进程 PID $PID"
fi

# 检查 Chromium 是否已安装（Puppeteer 海报生成需要）
CHROMIUM_DIR="$HOME/.cache/puppeteer/chrome"
if [ ! -d "$CHROMIUM_DIR" ] || [ -z "$(ls -A "$CHROMIUM_DIR" 2>/dev/null)" ]; then
  echo "[$(date)] Chromium 未安装，正在安装（Puppeteer 海报生成依赖）..."
  cd "$DIR" && npx puppeteer browsers install chrome 2>&1 || echo "[$(date)] Chromium 安装失败，海报功能将不可用"
fi

# 启动主服务
cd "$DIR" || exit 1
# 统一凭据（GITHUB_TOKEN 等，用于 API 查询提升限流额度）
[ -f "$HOME/.deploy-env" ] && . "$HOME/.deploy-env"
# 服务专属配置（.env 受 rsync --exclude 保护，跨版本持久）
[ -f "$DIR/.env" ] && . "$DIR/.env"
# 防御性修复：.env 里的 PORT 会覆盖脚本开头设的 PORT=5174（本例中值相同，
# 无实际影响，但如果未来端口改名/改值，source .env 后必须显式恢复本脚本的
# 端口约定，避免下面的 lsof/kill 逻辑用错端口。同类 bug 曾在 webhook-start.sh
# 中导致 PORT 被 wemusic 自己的 .env 覆盖，误杀刚启动的主进程。
PORT=5174
# 用 systemd-run 起独立 scope，脱离 cron.service cgroup（避免被 cron 触发的历次
# 重启进程共用同一个 cgroup 记账，随崩溃循环累积资源压力互相牵连、被内核回收杀死）。
# 依赖 linger（让用户级 systemd 常驻，不随登录 session 结束而失效）：若未开启则自动开启。
export XDG_RUNTIME_DIR="/run/user/$(id -u)"
if command -v systemd-run >/dev/null 2>&1; then
  if ! loginctl show-user "$(id -un)" --property=Linger 2>/dev/null | grep -q 'Linger=yes'; then
    loginctl enable-linger "$(id -un)" >/dev/null 2>&1
    sleep 1
  fi
  # 清理上次遗留的同名 scope（正常退出会自动回收，异常情况下保险起见先清一次）
  systemctl --user stop wemusic-app.scope >/dev/null 2>&1
  systemctl --user reset-failed wemusic-app.scope >/dev/null 2>&1
  nohup systemd-run --user --scope --collect --unit="wemusic-app" -- node server/index.js > "$LOG" 2>&1 9>&- &
else
  nohup node server/index.js > "$LOG" 2>&1 9>&- &
fi
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

# 如果 webhook 服务在运行，同步重启（更新 webhook.js 代码）
WEBHOOK_PID=$(lsof -ti:9001 2>/dev/null)
if [ -n "$WEBHOOK_PID" ]; then
  bash "$HOME/webhook-start.sh" > /dev/null 2>&1 9>&- &
  echo "[$(date)] webhook 同步重启"
fi
