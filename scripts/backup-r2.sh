#!/bin/bash
# ============================================================
# 多服务自动备份脚本 — Cloudflare R2（S3 兼容 API）
# ============================================================
# 用法：
#   bash ~/backup-r2.sh <服务名>       如：bash ~/backup-r2.sh wemusic
#
# 前置准备（一次性）：
#   1. Cloudflare 控制台 → R2 → 创建 bucket（n150-backups）
#   2. 创建 R2 API Token（Object Read & Write，指定 n150-backups）
#   3. N150 上：
#        mkdir -p ~/.aws && chmod 700 ~/.aws
#        cat > ~/.aws/credentials << 'CREDS'
#        [r2]
#        aws_access_key_id = <Access Key ID>
#        aws_secret_access_key = <Secret Access Key>
#        CREDS
#        chmod 600 ~/.aws/credentials
#   4. 部署：scp scripts/backup-r2.sh weweb:~/backup-r2.sh
#   5. cron（每天凌晨 3 点，各服务错开）：
#        0 3 * * * /bin/bash $HOME/backup-r2.sh wemusic >> /tmp/backup-r2.log 2>&1
#        5 3 * * * /bin/bash $HOME/backup-r2.sh wemonitor >> /tmp/backup-r2.log 2>&1
#
# 费用保护（R2 免费额度：10GB 存储）：
#   - 单次备份 > 100MB → 跳过
#   - 桶总量 ≥ 8GB → 跳过（留 2GB 缓冲）
#   - 接近上限时先删最旧备份腾空间
# ============================================================

set -euo pipefail

SERVICE="${1:-}"
if [ -z "$SERVICE" ]; then
  echo "用法: $0 <服务名>  如 $0 wemusic"
  exit 1
fi

# —— R2 配置 ——
AWS="$HOME/.local/bin/aws"
R2_ENDPOINT="https://2a5205f18821f595c1074e864cb02a61.r2.cloudflarestorage.com"
R2_BUCKET="n150-backups"
R2_PROFILE="r2"

# —— 费用保护 ——
MAX_BACKUP_SIZE_MB=100
MAX_BUCKET_USAGE_GB=8
RETENTION_DAYS=30

# —— 路径 ——
SOURCE_DIR="$HOME/$SERVICE/data"
ENV_FILE="$HOME/$SERVICE/.env"
BACKUP_NAME="${SERVICE}-backup-$(date +%Y%m%d-%H%M%S)"
TEMP_DIR="/tmp/r2-backup-$$"
S3_PREFIX="s3://${R2_BUCKET}/${SERVICE}/daily"
S3_PATH="${S3_PREFIX}/${BACKUP_NAME}.tar.gz"

# —— 函数 ——
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [$SERVICE] $*"; }

cleanup() { rm -rf "$TEMP_DIR" 2>/dev/null; }
trap cleanup EXIT

s3_ls() {
  $AWS s3 ls "$@" --profile "$R2_PROFILE" --endpoint-url "$R2_ENDPOINT" --no-verify-ssl 2>/dev/null
}

s3_cp() {
  $AWS s3 cp "$@" --profile "$R2_PROFILE" --endpoint-url "$R2_ENDPOINT" --no-verify-ssl
}

s3_rm() {
  $AWS s3 rm "$@" --profile "$R2_PROFILE" --endpoint-url "$R2_ENDPOINT" --no-verify-ssl 2>/dev/null
}

bucket_total_gb() {
  # 返回存储桶当前总用量（GB，整数）；空桶或网络异常时返回 0
  s3_ls --recursive --summarize "s3://${R2_BUCKET}/" \
    | grep "Total Size" \
    | awk '{printf "%.0f", $3/1024/1024/1024}' || echo 0
}

# ============================================================

# —— Step 0: 前置检查 ——
if [ ! -x "$AWS" ]; then
  log "ERROR: awscli 未安装（$AWS 不存在）"
  exit 1
fi

# —— Step 1: 打包 ——
log "开始备份"

if [ ! -d "$SOURCE_DIR" ] && [ ! -f "$ENV_FILE" ]; then
  log "SKIP: $SOURCE_DIR 和 $ENV_FILE 均不存在"
  exit 0
fi

mkdir -p "$TEMP_DIR"

[ -d "$SOURCE_DIR" ] && cp -r "$SOURCE_DIR" "$TEMP_DIR/data"
[ -f "$ENV_FILE" ] && cp "$ENV_FILE" "$TEMP_DIR/.env"

tar -czf "/tmp/${BACKUP_NAME}.tar.gz" -C "$TEMP_DIR" .

BACKUP_BYTES=$(stat -c%s "/tmp/${BACKUP_NAME}.tar.gz" 2>/dev/null || stat -f%z "/tmp/${BACKUP_NAME}.tar.gz" 2>/dev/null)
BACKUP_SIZE_MB=$(( BACKUP_BYTES / 1024 / 1024 ))
BACKUP_SIZE_HUMAN=$(du -h "/tmp/${BACKUP_NAME}.tar.gz" | cut -f1)
log "打包完成：${BACKUP_SIZE_HUMAN} (${BACKUP_SIZE_MB} MB)"

# —— 防线 1: 单次体积 ——
if [ "$BACKUP_SIZE_MB" -gt "$MAX_BACKUP_SIZE_MB" ]; then
  log "BLOCKED: 备份 ${BACKUP_SIZE_MB}MB > ${MAX_BACKUP_SIZE_MB}MB 上限，跳过"
  log "  可能原因：数据库异常膨胀，请检查 $SOURCE_DIR"
  rm -f "/tmp/${BACKUP_NAME}.tar.gz"
  exit 0
fi

# —— 防线 2+3: 总量检查 + 腾空间 ——
CURRENT_GB=0
CURRENT_GB=$(bucket_total_gb)
CURRENT_GB=${CURRENT_GB:-0}
log "R2 存储桶当前用量：~${CURRENT_GB} GB / ${MAX_BUCKET_USAGE_GB} GB 上限"

while [ "$CURRENT_GB" -ge "$MAX_BUCKET_USAGE_GB" ]; do
  OLDEST=$(s3_ls "$S3_PREFIX/" | sort | head -1 | awk '{print $NF}')
  if [ -z "$OLDEST" ]; then
    log "BLOCKED: 存储桶已达 ${CURRENT_GB}GB 上限，无更多 ${SERVICE} 旧备份可清理，跳过"
    rm -f "/tmp/${BACKUP_NAME}.tar.gz"
    exit 0
  fi
  log "接近上限，删除最旧备份以腾空间：$OLDEST"
  s3_rm "s3://${R2_BUCKET}/$OLDEST" || true
  CURRENT_GB=$(bucket_total_gb)
  CURRENT_GB=${CURRENT_GB:-0}
done

# —— Step 2: 上传 ——
log "上传到 R2：$S3_PATH"
s3_cp "/tmp/${BACKUP_NAME}.tar.gz" "$S3_PATH" || {
  log "ERROR: 上传失败"
  rm -f "/tmp/${BACKUP_NAME}.tar.gz"
  exit 1
}
rm -f "/tmp/${BACKUP_NAME}.tar.gz"

# —— Step 3: 清理过期备份 ——
CUTOFF=$(date -d "-${RETENTION_DAYS} days" +%s 2>/dev/null || date -v-${RETENTION_DAYS}d +%s)

s3_ls "$S3_PREFIX/" | while read -r _ _ _ _ key; do
  [ -z "$key" ] && continue
  TIMESTAMP=$(echo "$key" | sed -n 's/.*-backup-\([0-9]\{8\}-[0-9]\{6\}\)\.tar\.gz/\1/p')
  [ -z "$TIMESTAMP" ] && continue
  FILE_DATE="${TIMESTAMP:0:8}"
  FILE_EPOCH=$(date -d "$FILE_DATE" +%s 2>/dev/null || date -j -f "%Y%m%d" "$FILE_DATE" +%s 2>/dev/null)
  if [ -n "$FILE_EPOCH" ] && [ "$FILE_EPOCH" -lt "$CUTOFF" ]; then
    log "清理过期备份：$key"
    s3_rm "s3://${R2_BUCKET}/$key" || true
  fi
done

log "备份完成 ✓ (R2: ${R2_BUCKET}/${SERVICE}/daily/，用量 ~${CURRENT_GB}GB/${MAX_BUCKET_USAGE_GB}GB)"
