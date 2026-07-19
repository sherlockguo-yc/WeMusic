#!/bin/bash
# N150 统一部署队列 worker。
# cron 每分钟运行一次：补偿漏掉的 Release 通知并处理一个队列任务。
# webhook 只负责写入 ~/.deploy-queue/jobs/<project>.json，绝不直接执行部署。

set -eo pipefail

CONF="${HOME}/.deploy-projects.conf"
QUEUE_ROOT="${HOME}/.deploy-queue"
JOB_DIR="${QUEUE_ROOT}/jobs"
RUN_DIR="${QUEUE_ROOT}/running"
STATE_DIR="${QUEUE_ROOT}/states"
WORKER_STATE_FILE="${QUEUE_ROOT}/worker.json"
LOCK_FILE="${QUEUE_ROOT}/worker.lock"
LOG_BASE="/tmp"
LEASE_SECONDS=1800
DEPLOY_WORKER_PID=$$
export DEPLOY_WORKER_PID

ensure_dirs() {
  mkdir -p "$JOB_DIR" "$RUN_DIR" "$STATE_DIR"
}

now() {
  date +%s
}

read_json_value() {
  local file="$1" key="$2"
  python3 - "$file" "$key" <<'PY' 2>/dev/null || true
import json, sys
try:
    value = json.load(open(sys.argv[1], encoding='utf-8'))
    for part in sys.argv[2].split('.'):
        value = value.get(part) if isinstance(value, dict) else None
    if value is not None:
        print(value)
except Exception:
    pass
PY
}

write_worker_state() {
  local status="$1" project="${2:-}" version="${3:-}" phase="${4:-}" message="${5:-}"
  python3 - "$WORKER_STATE_FILE" "$status" "$project" "$version" "$phase" "$message" <<'PY'
import json, os, sys, tempfile, time
path, status, project, version, phase, message = sys.argv[1:]
now = int(time.time())
try:
    with open(path, encoding='utf-8') as f:
        state = json.load(f)
except Exception:
    state = {}

is_new_task = state.get('project') != project or state.get('version') != version
state.update({
    'pid': int(os.environ.get('DEPLOY_WORKER_PID', os.getpid())),
    'status': status,
    'project': project or None,
    'version': version or None,
    'phase': phase or None,
    'message': message or None,
    'updatedAt': now,
})
if status == 'working':
    if is_new_task:
        state['startedAt'] = now
else:
    state['startedAt'] = None

os.makedirs(os.path.dirname(path), exist_ok=True)
fd, tmp = tempfile.mkstemp(prefix='.worker-', dir=os.path.dirname(path), text=True)
with os.fdopen(fd, 'w', encoding='utf-8') as f:
    json.dump(state, f, ensure_ascii=False, separators=(',', ':'))
    f.write('\n')
os.replace(tmp, path)
PY
}

state_transition() {
  local project="$1" action="$2" version="$3" phase="$4" status="$5" trigger="$6" message="$7" attempt="${8:-0}"
  python3 - "$STATE_DIR/$project.json" "$project" "$action" "$version" "$phase" "$status" "$trigger" "$message" "$attempt" <<'PY'
import json, os, sys, tempfile, time

path, project, action, version, phase, status, trigger, message, attempt = sys.argv[1:]
try:
    with open(path, encoding='utf-8') as f:
        state = json.load(f)
except Exception:
    state = {}

now = int(time.time())
state['project'] = project
state.setdefault('active', None)
state.setdefault('pending', None)
state.setdefault('last', None)
state['updatedAt'] = now

def task():
    return {
        'project': project,
        'version': version,
        'phase': phase,
        'status': status,
        'trigger': trigger,
        'message': message,
        'attempt': int(attempt or 0),
        'updatedAt': now,
    }

if action == 'queued':
    pending = task()
    pending['queuedAt'] = now
    state['pending'] = pending
elif action == 'active':
    active = task()
    active['startedAt'] = now
    active['workerPid'] = int(os.environ.get('DEPLOY_WORKER_PID', os.getpid()))
    state['active'] = active
    pending = state.get('pending')
    if isinstance(pending, dict) and pending.get('version') == version:
        state['pending'] = None
elif action == 'phase':
    active = state.get('active')
    if not isinstance(active, dict) or active.get('version') != version:
        active = task()
        active['startedAt'] = now
        active['workerPid'] = int(os.environ.get('DEPLOY_WORKER_PID', os.getpid()))
    active.update(task())
    active.setdefault('startedAt', now)
    active['workerPid'] = int(os.environ.get('DEPLOY_WORKER_PID', os.getpid()))
    state['active'] = active
elif action in ('succeeded', 'failed', 'interrupted'):
    completed = task()
    completed['finishedAt'] = now
    active = state.get('active')
    if isinstance(active, dict):
        completed['startedAt'] = active.get('startedAt')
        completed['workerPid'] = active.get('workerPid')
    state['active'] = None
    state['last'] = completed

os.makedirs(os.path.dirname(path), exist_ok=True)
fd, tmp = tempfile.mkstemp(prefix='.state-', dir=os.path.dirname(path), text=True)
with os.fdopen(fd, 'w', encoding='utf-8') as f:
    json.dump(state, f, ensure_ascii=False, separators=(',', ':'))
    f.write('\n')
os.replace(tmp, path)
PY
  if [ "$action" = "active" ] || [ "$action" = "phase" ]; then
    write_worker_state working "$project" "$version" "$phase" "$message" || true
  fi
}

log_event() {
  local project="$1" stage="$2" status="$3" message="$4" trigger="$5"
  local ts
  ts=$(now)
  local dir
  dir=$(grep "^${project}|" "$CONF" 2>/dev/null | cut -d'|' -f3)
  dir=$(eval echo "$dir")
  mkdir -p "$dir/data"
  python3 - "$dir/data/deploy-events.jsonl" "$stage" "$status" "$message" "$trigger" "$ts" <<'PY'
import json, sys
with open(sys.argv[1], 'a', encoding='utf-8') as f:
    f.write(json.dumps({
        'stage': sys.argv[2], 'status': sys.argv[3], 'message': sys.argv[4],
        'trigger': sys.argv[5], 'ts': int(sys.argv[6]),
    }, ensure_ascii=False, separators=(',', ':')) + '\n')
PY
}

project_config() {
  local wanted="$1"
  grep "^${wanted}|" "$CONF" 2>/dev/null | head -1
}

query_version() {
  local repo="$1" tag_mode="$2" api body
  local auth_hdr=()

  [ -f "${HOME}/.deploy-env" ] && . "${HOME}/.deploy-env"
  [ -n "${GITHUB_TOKEN:-}" ] && auth_hdr=(-H "Authorization: Bearer $GITHUB_TOKEN")

  if [ "$tag_mode" = "latest" ]; then
    api="https://api.github.com/repos/$repo/releases/tags/latest"
    body=$(curl -sS -H "Cache-Control: no-cache" --max-time 30 --connect-timeout 10 "${auth_hdr[@]}" "$api" 2>/dev/null || true)
    printf '%s' "$body" | python3 -c "
import json, re, sys
try:
    release = json.load(sys.stdin)
    match = re.search(r'Auto build ([a-f0-9]+)', release.get('body', ''))
    if match: print(match.group(1))
except Exception: pass
" 2>/dev/null || true
    return
  fi

  api="https://api.github.com/repos/$repo/releases?per_page=100"
  body=$(curl -sS -H "Cache-Control: no-cache" --max-time 30 --connect-timeout 10 "${auth_hdr[@]}" "$api" 2>/dev/null || true)
  printf '%s' "$body" | python3 -c "
import json, re, sys
try:
    releases = json.load(sys.stdin)
    releases.sort(key=lambda item: item.get('published_at', ''), reverse=True)
    for release in releases:
        if release.get('tag_name') == 'latest':
            continue
        match = re.search(r'Auto build ([a-f0-9]+)', release.get('body', ''))
        if match:
            print(match.group(1))
            break
except Exception: pass
" 2>/dev/null || true
}

enqueue_job() {
  local project="$1" version="$2" trigger="$3"
  local job="$JOB_DIR/$project.json"
  local current
  current=$(read_json_value "$job" version)
  [ "$current" = "$version" ] && return 0

  python3 - "$job" "$project" "$version" "$trigger" <<'PY'
import json, os, sys, tempfile, time
path, project, version, trigger = sys.argv[1:]
data = {
    'project': project, 'version': version, 'trigger': trigger,
    'queuedAt': int(time.time()), 'attempt': 0,
}
os.makedirs(os.path.dirname(path), exist_ok=True)
fd, tmp = tempfile.mkstemp(prefix='.job-', dir=os.path.dirname(path), text=True)
with os.fdopen(fd, 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    f.write('\n')
os.replace(tmp, path)
PY
  state_transition "$project" queued "$version" queued queued "$trigger" "等待部署 $version" 0
  log_event "$project" queue queued "已入队 $version" "$trigger"
}

queue_remote_updates() {
  while IFS='|' read -r project repo dir port tag_mode file_name; do
    [[ "$project" =~ ^# ]] && continue
    [ -z "$project" ] && continue

    local remote_ver local_ver pending_ver active_ver
    remote_ver=$(query_version "$repo" "$tag_mode")
    [ -z "$remote_ver" ] && continue
    dir=$(eval echo "$dir")
    local_ver=$(cat "$dir/.version" 2>/dev/null || echo "none")
    [ "$remote_ver" = "$local_ver" ] && continue

    pending_ver=$(read_json_value "$JOB_DIR/$project.json" version)
    active_ver=$(read_json_value "$STATE_DIR/$project.json" active.version)
    [ "$remote_ver" = "$pending_ver" ] && continue
    [ "$remote_ver" = "$active_ver" ] && continue
    enqueue_job "$project" "$remote_ver" cron
  done < "$CONF"
}

recover_interrupted_jobs() {
  local running
  for running in "$RUN_DIR"/*.json; do
    [ -e "$running" ] || continue
    local project version trigger worker_pid updated_at queued_job current_time
    project=$(read_json_value "$running" project)
    version=$(read_json_value "$running" version)
    trigger=$(read_json_value "$running" trigger)
    worker_pid=$(read_json_value "$STATE_DIR/$project.json" active.workerPid)
    updated_at=$(read_json_value "$STATE_DIR/$project.json" active.updatedAt)
    current_time=$(now)
    queued_job="$JOB_DIR/$project.json"

    # 只有在PID仍存在且心跳未过租约时才认为worker仍有效；锁已释放时，
    # 过期状态或PID复用都必须恢复，不能让任务永久停在活动阶段。
    if [ -n "$worker_pid" ] && kill -0 "$worker_pid" 2>/dev/null \
      && [ -n "$updated_at" ] && [ $((current_time - updated_at)) -lt "$LEASE_SECONDS" ]; then
      continue
    fi

    if [ ! -f "$queued_job" ]; then
      mv "$running" "$queued_job"
      state_transition "$project" interrupted "$version" interrupted interrupted "${trigger:-cron}" "worker 中断，任务已重新排队" 0
      state_transition "$project" queued "$version" queued queued "${trigger:-cron}" "worker 中断后重新排队" 0
    else
      rm -f "$running"
      state_transition "$project" interrupted "$version" interrupted interrupted "${trigger:-cron}" "worker 中断，保留更新版本的排队任务" 0
    fi
    log_event "$project" worker interrupted "worker 中断，任务已恢复到队列" "${trigger:-cron}"
  done
}

claim_next_job() {
  local job
  job=$(python3 - "$JOB_DIR" <<'PY'
import glob, json, os, sys
items = []
for path in glob.glob(os.path.join(sys.argv[1], '*.json')):
    try:
        with open(path, encoding='utf-8') as f:
            data = json.load(f)
        items.append((int(data.get('queuedAt', 0)), path))
    except Exception:
        pass
if items:
    print(min(items)[1])
PY
)
  [ -z "$job" ] && return 1

  local name running
  name=$(basename "$job" .json)
  running="$RUN_DIR/${name}.$$.json"
  mv "$job" "$running" 2>/dev/null || return 1
  printf '%s\n' "$running"
}

curl_error_message() {
  case "$1" in
    6) echo "DNS 解析失败" ;;
    7) echo "连接失败" ;;
    22) echo "HTTP 错误" ;;
    28) echo "下载超时" ;;
    *) echo "curl 失败（exit=$1）" ;;
  esac
}

try_download_resumable() {
  local project="$1" version="$2" source="$3" url="$4" tmp="$5" budget="$6" per_try="${7:-90}"
  local start attempt=0 curl_rc=0
  start=$(now)

  while true; do
    attempt=$((attempt + 1))
    state_transition "$project" phase "$version" downloading started worker "${source} 下载中，第 ${attempt} 次尝试" "$attempt"
    curl_rc=0
    curl -fsSL -C - --max-time "$per_try" --connect-timeout 15 -o "$tmp" "$url" 2>/dev/null || curl_rc=$?
    if [ -f "$tmp" ] && gzip -t "$tmp" 2>/dev/null; then
      return 0
    fi

    local elapsed
    elapsed=$(( $(now) - start ))
    echo "[$(date)] $project ${source} 下载未完成：$(curl_error_message "$curl_rc")，已用 ${elapsed}s" >> "$LOG_BASE/$project-deploy.log"
    if [ "$elapsed" -ge "$budget" ]; then
      DOWNLOAD_ERROR="${source} ${elapsed}s 后仍未完成：$(curl_error_message "$curl_rc")"
      return 1
    fi
    sleep 3
  done
}

download_artifact() {
  local project="$1" repo="$2" tag="$3" file_name="$4" tmp="$5" version="$6"
  local base="https://github.com/$repo/releases/download"
  local mirror_url="https://ghproxy.net/$base/$tag/$file_name"
  local direct_url="$base/$tag/$file_name"

  DOWNLOAD_ERROR="下载失败"
  rm -f "$tmp"
  if try_download_resumable "$project" "$version" 镜像 "$mirror_url" "$tmp" 360 90; then
    return 0
  fi
  if try_download_resumable "$project" "$version" GitHub直连 "$direct_url" "$tmp" 900 90; then
    return 0
  fi
  return 1
}

finish_job() {
  local running="$1" project="$2" version="$3" result="$4" phase="$5" trigger="$6" message="$7" attempt="${8:-0}"
  state_transition "$project" "$result" "$version" "$phase" "$result" "$trigger" "$message" "$attempt"
  write_worker_state idle "" "" "" "空闲" || true
  log_event "$project" "$phase" "$result" "$message" "$trigger"
  rm -f "$running"
}

deploy_job() {
  local running="$1"
  local project version trigger attempt=0
  project=$(read_json_value "$running" project)
  version=$(read_json_value "$running" version)
  trigger=$(read_json_value "$running" trigger)
  [ -n "$project" ] && [ -n "$version" ] || return 1

  local config
  config=$(project_config "$project")
  if [ -z "$config" ]; then
    finish_job "$running" "$project" "$version" failed worker "${trigger:-cron}" "未知项目，无法部署" 0
    return 1
  fi

  local repo dir port tag_mode file_name
  IFS='|' read -r _ repo dir port tag_mode file_name <<< "$config"
  dir=$(eval echo "$dir")
  local log="$LOG_BASE/$project-deploy.log"
  local local_ver
  local_ver=$(cat "$dir/.version" 2>/dev/null || echo "none")
  if [ "$local_ver" = "$version" ]; then
    finish_job "$running" "$project" "$version" succeeded complete "${trigger:-cron}" "版本已部署 $version" 0
    return 0
  fi

  echo "[$(date)] worker 开始部署 $project $version" >> "$log"
  state_transition "$project" active "$version" downloading started "${trigger:-cron}" "开始下载 $version" 0
  log_event "$project" download started "开始下载 $version" "${trigger:-cron}"

  local tmp="/tmp/${project}-deploy.tar.gz"
  local stage="/tmp/${project}-stage"
  if ! download_artifact "$project" "$repo" "$version" "$file_name" "$tmp" "$version"; then
    finish_job "$running" "$project" "$version" failed downloading "${trigger:-cron}" "$DOWNLOAD_ERROR" 0
    rm -f "$tmp"
    return 1
  fi

  state_transition "$project" phase "$version" verifying started "${trigger:-cron}" "校验下载产物" 0
  log_event "$project" verify started "校验下载产物 $version" "${trigger:-cron}"
  rm -rf "$stage" && mkdir -p "$stage"
  if ! tar -xzf "$tmp" -C "$stage"; then
    finish_job "$running" "$project" "$version" failed verifying "${trigger:-cron}" "解压失败" 0
    rm -rf "$stage" "$tmp"
    return 1
  fi

  local stage_ver
  stage_ver=$(cat "$stage/.version" 2>/dev/null || true)
  if [ "$stage_ver" != "$version" ]; then
    finish_job "$running" "$project" "$version" failed verifying "${trigger:-cron}" "版本校验失败：包内 ${stage_ver:-空}，期望 $version" 0
    rm -rf "$stage" "$tmp"
    return 1
  fi

  state_transition "$project" phase "$version" syncing started "${trigger:-cron}" "同步部署文件" 0
  log_event "$project" deploy started "开始同步 $version" "${trigger:-cron}"
  mkdir -p "$dir"
  if ! rsync -a --delete --exclude 'data' --exclude '.env' "$stage/" "$dir/"; then
    finish_job "$running" "$project" "$version" failed syncing "${trigger:-cron}" "rsync 同步失败" 0
    rm -rf "$stage" "$tmp"
    return 1
  fi
  rm -rf "$stage" "$tmp"

  state_transition "$project" phase "$version" restarting started "${trigger:-cron}" "重启服务" 0
  log_event "$project" restart started "重启服务 $version" "${trigger:-cron}"
  if ! bash "$dir/restart.sh" 200>&- >> "$log" 2>&1; then
    finish_job "$running" "$project" "$version" failed restarting "${trigger:-cron}" "restart.sh 执行失败" 0
    return 1
  fi

  finish_job "$running" "$project" "$version" succeeded complete "${trigger:-cron}" "部署完成 $version" 0
  echo "[$(date)] $project 部署完成 → $version" >> "$log"
}

run_health_checks() {
  while IFS='|' read -r project repo dir port tag_mode file_name; do
    [[ "$project" =~ ^# ]] && continue
    [ -z "$project" ] && continue
    [ -z "$port" ] && continue
    [ -n "$(read_json_value "$STATE_DIR/$project.json" active.version)" ] && continue
    dir=$(eval echo "$dir")
    if ! lsof -ti:"$port" >/dev/null 2>&1; then
      log_event "$project" healthcheck error "端口 $port 无响应，触发重启" cron
      bash "$dir/restart.sh" 200>&- >> "$LOG_BASE/$project-deploy.log" 2>&1 || true
    fi
  done < "$CONF"
}

MODE="cron"
TARGET_PROJECT=""
TARGET_VERSION=""
while [ $# -gt 0 ]; do
  case "$1" in
    --enqueue|--deploy)
      # 兼容旧Webhook的 --deploy 调用；两种模式都只入队，绝不在Webhook进程中下载。
      MODE="enqueue"
      TARGET_PROJECT="$2"
      TARGET_VERSION="$3"
      shift 3
      ;;
    --check)
      MODE="cron"
      TARGET_PROJECT="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

if [ ! -f "$CONF" ]; then
  echo "[$(date)] 配置文件 $CONF 不存在" >> /tmp/deploy-agent.log
  exit 1
fi
ensure_dirs

if [ "$MODE" = "enqueue" ]; then
  if [ -z "$(project_config "$TARGET_PROJECT")" ] || ! [[ "$TARGET_VERSION" =~ ^[a-f0-9]{7,40}$ ]]; then
    echo "无效的项目或版本" >&2
    exit 1
  fi
  enqueue_job "$TARGET_PROJECT" "$TARGET_VERSION" webhook
  exit 0
fi

exec 200>"$LOCK_FILE"
if ! flock -n 200; then
  exit 0
fi
write_worker_state idle "" "" "" "空闲" || true

recover_interrupted_jobs
queue_remote_updates

if [ -n "$TARGET_PROJECT" ]; then
  job="$JOB_DIR/$TARGET_PROJECT.json"
  if [ -f "$job" ]; then
    running="$RUN_DIR/${TARGET_PROJECT}.$$.json"
    mv "$job" "$running"
    deploy_job "$running" || true
  fi
else
  running=$(claim_next_job || true)
  if [ -n "$running" ]; then
    deploy_job "$running" || true
  else
    run_health_checks
  fi
fi

exec 200>&-
