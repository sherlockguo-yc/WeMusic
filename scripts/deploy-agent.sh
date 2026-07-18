#!/bin/bash
# 统一部署代理 - 支持 webhook 触发 和 cron 轮询两种模式
# 
# cron 模式:  bash deploy-agent.sh                    → 检查所有项目，有更新则部署
# 单项目:    bash deploy-agent.sh --check wemusic     → 只检查指定项目
# webhook:   bash deploy-agent.sh --deploy wemusic VERSION → 立即部署指定版本
# 
# 配置文件: ~/.deploy-projects.conf
# 格式: PROJECT|REPO|DIR|PORT|TAG_MODE|FILE_NAME
#   TAG_MODE: "latest" 固定用 latest tag / "sha" 用 commit SHA 作为 tag
# 
# 本脚本放在 ~/ 下，不在各项目目录内，避免被 rsync --delete 清除。

set -e

LOCK_FILE="/tmp/deploy-agent.lock"
exec 200>"$LOCK_FILE"
if ! flock -n 200; then
  exit 0  # 另一个实例正在运行
fi

CONF="${HOME}/.deploy-projects.conf"
LOG_BASE="/tmp"

log_event() {
  local project="$1" stage="$2" status="$3" message="$4"
  local ts=$(date +%s)
  local dir=$(grep "^${project}|" "$CONF" 2>/dev/null | cut -d'|' -f3)
  dir=$(eval echo "$dir")
  mkdir -p "$dir/data"
  echo "{\"stage\":\"$stage\",\"status\":\"$status\",\"message\":\"$message\",\"ts\":$ts}" >> "$dir/data/deploy-events.jsonl"
}

# ── 查询 GitHub API 获取最新版本 ──
query_version() {
  local repo="$1" tag_mode="$2"
  local api auth_hdr=()

  [ -f "${HOME}/wemusic/.env" ] && . "${HOME}/wemusic/.env"
  [ -n "${GITHUB_TOKEN:-}" ] && auth_hdr=(-H "Authorization: Bearer $GITHUB_TOKEN")

  if [ "$tag_mode" = "latest" ]; then
    # WeMusic 模式：查 latest tag
    api="https://api.github.com/repos/$repo/releases/tags/latest"
    local body=$(curl -sS -H "Cache-Control: no-cache" --max-time 30 --connect-timeout 10 "${auth_hdr[@]}" "$api" 2>/dev/null)
    echo "$body" | grep -m1 '"body"' | sed -E 's/.*Auto build ([a-f0-9]+).*/\1/'
  else
    # WeMonitor 模式：查最新 release（per_page=1）
    api="https://api.github.com/repos/$repo/releases?per_page=1"
    local body=$(curl -sS -H "Cache-Control: no-cache" --max-time 30 --connect-timeout 10 "${auth_hdr[@]}" "$api" 2>/dev/null)
    echo "$body" | grep -m1 '"body"' | sed -E 's/.*Auto build ([a-f0-9]+).*/\1/'
  fi
}

# ── 下载产物（镜像 + 直连 fallback）──
download_artifact() {
  local repo="$1" tag="$2" file_name="$3" tmp="$4"
  local base="https://github.com/$repo/releases/download"
  local mirror_base="https://ghproxy.net/$base"
  local url="$base/$tag/$file_name"
  local mirror_url="$mirror_base/$tag/$file_name"

  # 先试镜像（3 次快速重试）
  for i in 1 2 3; do
    if curl -sSL --max-time 60 --connect-timeout 15 -o "$tmp" "$mirror_url" 2>/dev/null && file "$tmp" | grep -q "gzip"; then
      return 0
    fi
    sleep 2
  done

  # 镜像失败则直连（3 次）
  for i in 1 2 3; do
    if curl -sSL --max-time 60 --connect-timeout 20 -o "$tmp" "$url" 2>/dev/null && file "$tmp" | grep -q "gzip"; then
      return 0
    fi
    sleep 2
  done

  return 1
}

# ── 部署单个项目 ──
deploy_project() {
  local project="$1" repo="$2" dir="$3" port="$4" tag_mode="$5" file_name="$6" force_version="$7"
  local log="$LOG_BASE/$project-deploy.log"

  dir=$(eval echo "$dir")

  echo "[$(date)] 部署 $project (tag_mode=$tag_mode, force_version=${force_version:-auto})" >> "$log"

  # 确定版本号
  local remote_ver
  if [ -n "$force_version" ]; then
    remote_ver="$force_version"
  else
    remote_ver=$(query_version "$repo" "$tag_mode")
    if [ -z "$remote_ver" ] || [ "$remote_ver" = "$1" ]; then
      echo "[$(date)] $project 查询版本失败" >> "$log"
      return 1
    fi

    local local_ver=$(cat "$dir/.version" 2>/dev/null || echo "none")
    if [ "$remote_ver" = "$local_ver" ]; then
      return 0  # 已是最新
    fi
  fi

  echo "[$(date)] $project 新版本 $remote_ver，开始下载" >> "$log"
  log_event "$project" "download" "started" "下载 $remote_ver"

  # 确定下载 tag
  local dl_tag
  if [ "$tag_mode" = "latest" ]; then
    dl_tag="latest"
  else
    dl_tag="$remote_ver"
  fi

  local tmp="/tmp/${project}-deploy.tar.gz"
  local stage="/tmp/${project}-stage"

  if ! download_artifact "$repo" "$dl_tag" "$file_name" "$tmp"; then
    echo "[$(date)] $project 下载失败" >> "$log"
    log_event "$project" "download" "error" "下载失败 $remote_ver"
    rm -f "$tmp"
    return 1
  fi

  log_event "$project" "download" "ok" "下载完成 $remote_ver"

  # 解压
  rm -rf "$stage" && mkdir -p "$stage"
  if ! tar -xzf "$tmp" -C "$stage"; then
    echo "[$(date)] $project 解压失败" >> "$log"
    log_event "$project" "deploy" "error" "解压失败"
    rm -rf "$stage" "$tmp"
    return 1
  fi

  # 校验版本
  local stage_ver=$(cat "$stage/.version" 2>/dev/null)
  if [ "$stage_ver" != "$remote_ver" ]; then
    echo "[$(date)] $project 版本校验失败（可能镜像缓存过期）: 包内=$stage_ver 期望=$remote_ver" >> "$log"
    log_event "$project" "deploy" "error" "版本校验失败（镜像缓存），尝试直连重试"

    # 直连 GitHub 重试（跳过镜像）
    rm -rf "$stage" "$tmp"
    local url="https://github.com/$repo/releases/download/$dl_tag/$file_name"
    if curl -sSL --max-time 60 --connect-timeout 20 -o "$tmp" "$url" 2>/dev/null && file "$tmp" | grep -q "gzip"; then
      rm -rf "$stage" && mkdir -p "$stage"
      if tar -xzf "$tmp" -C "$stage"; then
        stage_ver=$(cat "$stage/.version" 2>/dev/null)
        if [ "$stage_ver" != "$remote_ver" ]; then
          echo "[$(date)] $project 直连版本校验仍失败: 包内=$stage_ver 期望=$remote_ver" >> "$log"
          log_event "$project" "deploy" "error" "直连版本校验仍失败"
          rm -rf "$stage" "$tmp"
          return 1
        fi
        echo "[$(date)] $project 直连下载版本校验通过" >> "$log"
      else
        rm -rf "$stage" "$tmp"
        return 1
      fi
    else
      echo "[$(date)] $project 直连下载失败" >> "$log"
      log_event "$project" "deploy" "error" "直连下载失败"
      rm -f "$tmp"
      return 1
    fi
  fi

  # rsync 到运行目录
  log_event "$project" "deploy" "started" "开始同步 $remote_ver"
  mkdir -p "$dir"
  rsync -a --delete --exclude 'data' --exclude '.env' "$stage/" "$dir/"
  rm -rf "$stage" "$tmp"
  log_event "$project" "deploy" "ok" "文件同步完成 $remote_ver"

  # 重启
  bash "$dir/restart.sh" 200>&- >> "$log" 2>&1
  echo "[$(date)] $project 部署完成 → $remote_ver" >> "$log"
  return 0
}

# ── 主入口 ──

# 解析参数
MODE="cron"
TARGET_PROJECT=""
FORCE_VERSION=""

while [ $# -gt 0 ]; do
  case "$1" in
    --deploy)
      MODE="webhook"
      TARGET_PROJECT="$2"
      FORCE_VERSION="$3"
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
  exit 0
fi

while IFS='|' read -r project repo dir port tag_mode file_name; do
  # 跳过注释和空行
  [[ "$project" =~ ^# ]] && continue
  [ -z "$project" ] && continue

  # cron 模式跳过与当前版本相同的项目
  if [ "$MODE" = "cron" ] && [ -n "$TARGET_PROJECT" ] && [ "$project" != "$TARGET_PROJECT" ]; then
    continue
  fi

  # 只处理目标项目
  if [ "$MODE" = "webhook" ] && [ "$project" != "$TARGET_PROJECT" ]; then
    continue
  fi

  deploy_project "$project" "$repo" "$dir" "$port" "$tag_mode" "$file_name" "$FORCE_VERSION"
done < "$CONF"

# 释放锁
exec 200>&-
