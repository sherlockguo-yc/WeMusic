#!/bin/bash
# ============================================================
# WeMusic 自动备份脚本 — Cloudflare R2（S3 兼容 API）
# ============================================================
# 用法：
#   手动触发：  bash ~/backup-r2.sh
#   定时自动：  cron 每天执行一次
#
# 前置准备（一次性）：
#   1. Cloudflare 控制台 → R2 → 创建 bucket（如 wemusic-backups）
#   2. 创建 API Token：R2 → Manage R2 API Tokens → 创建
#      - 权限：Object Read & Write
#      - 指定 bucket：选上面创建的 bucket
#   3. N150 上安装 awscli：sudo apt install awscli -y
#   4. N150 上配置：
#        mkdir -p ~/.aws
#        cat > ~/.aws/credentials << 'CREDS'
#        [r2]
#        aws_access_key_id = <R2 Access Key ID>
#        aws_secret_access_key = <R2 Secret Access Key>
#        CREDS
#   5. 修改下方 R2_ENDPOINT / R2_BUCKET 为你自己的值
#   6. 部署到 ~/backup-r2.sh（放 ~/ 下，不在 wemusic/ 内，避免 rsync --delete 清除）
#   7. 添加 cron（每天凌晨 3 点）：crontab -e 加一行：
#        0 3 * * * /bin/bash $HOME/backup-r2.sh >> /tmp/backup-r2.log 2>&1
#
# Cloudflare R2 与 S3 的差异：
#   - endpoint 格式：https://<account_id>.r2.cloudflarestorage.com
#   - R2 不支持 object tagging，可用前缀模拟版本管理
#   - R2 免费 10GB 存储 + 1000 万次 A 类操作 + 1000 万次 B 类操作/月
# ============================================================

set -euo pipefail

# —— 配置（部署到 N150 后修改） ——
R2_ENDPOINT="https://<your-account-id>.r2.cloudflarestorage.com"
R2_BUCKET="wemusic-backups"
R2_PROFILE="r2"             # ~/.aws/credentials 中的 profile 名
RETENTION_DAYS=30           # R2 上保留最近 N 天的备份

SOURCE_DIR="$HOME/wemusic/data"
ENV_FILE="$HOME/wemusic/.env"
BACKUP_NAME="wemusic-backup-$(date +%Y%m%d-%H%M%S)"
TEMP_DIR="/tmp/wemusic-backup-$$"
S3_PATH="s3://${R2_BUCKET}/wemusic/daily/${BACKUP_NAME}.tar.gz"

# —— 函数 ——
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

cleanup() {
  rm -rf "$TEMP_DIR" 2>/dev/null
}
trap cleanup EXIT

# —— Step 1: 打包 ——
log "开始备份：$BACKUP_NAME"

mkdir -p "$TEMP_DIR"

# 复制 data/（SQLite 数据库 + 部署事件日志）
if [ -d "$SOURCE_DIR" ]; then
  cp -r "$SOURCE_DIR" "$TEMP_DIR/data"
else
  log "WARNING: $SOURCE_DIR 不存在，跳过"
fi

# 复制 .env
if [ -f "$ENV_FILE" ]; then
  cp "$ENV_FILE" "$TEMP_DIR/.env"
else
  log "WARNING: $ENV_FILE 不存在，跳过"
fi

# 打包
tar -czf "/tmp/${BACKUP_NAME}.tar.gz" -C "$TEMP_DIR" .

BACKUP_SIZE=$(du -h "/tmp/${BACKUP_NAME}.tar.gz" | cut -f1)
log "打包完成：${BACKUP_SIZE}"

# —— Step 2: 上传到 R2 ——
if ! command -v aws >/dev/null 2>&1; then
  log "ERROR: awscli 未安装。请先执行：sudo apt install awscli -y"
  exit 1
fi

log "上传到 R2：$S3_PATH"
aws s3 cp "/tmp/${BACKUP_NAME}.tar.gz" "$S3_PATH" \
  --profile "$R2_PROFILE" \
  --endpoint-url "$R2_ENDPOINT" \
  --no-verify-ssl \
  2>&1 || {
    log "ERROR: 上传失败，请检查 R2 凭证和网络"
    exit 1
  }

rm -f "/tmp/${BACKUP_NAME}.tar.gz"

# —— Step 3: 清理过期备份 ——
log "清理 ${RETENTION_DAYS} 天前的旧备份…"
CUTOFF=$(date -d "-${RETENTION_DAYS} days" +%s 2>/dev/null || date -v-${RETENTION_DAYS}d +%s)

# 列出 bucket 中所有备份，解析日期并删除过期项
aws s3 ls "s3://${R2_BUCKET}/wemusic/daily/" \
  --profile "$R2_PROFILE" \
  --endpoint-url "$R2_ENDPOINT" \
  --no-verify-ssl \
  2>/dev/null | while read -r _ _ _ _ key; do
  if [ -z "$key" ]; then continue; fi
  # 从文件名提取日期时间：wemusic-backup-YYYYMMDD-HHMMSS.tar.gz
  TIMESTAMP=$(echo "$key" | sed -n 's/.*wemusic-backup-\([0-9]\{8\}-[0-9]\{6\}\)\.tar\.gz/\1/p')
  if [ -z "$TIMESTAMP" ]; then continue; fi
  # 转为 epoch 比较
  FILE_DATE="${TIMESTAMP:0:8}"
  FILE_EPOCH=$(date -d "$FILE_DATE" +%s 2>/dev/null || date -j -f "%Y%m%d" "$FILE_DATE" +%s 2>/dev/null)
  if [ -n "$FILE_EPOCH" ] && [ "$FILE_EPOCH" -lt "$CUTOFF" ]; then
    log "删除过期备份：$key"
    aws s3 rm "s3://${R2_BUCKET}/$key" \
      --profile "$R2_PROFILE" \
      --endpoint-url "$R2_ENDPOINT" \
      --no-verify-ssl \
      2>/dev/null || true
  fi
done

log "备份完成：$BACKUP_NAME (R2 ${R2_BUCKET}/wemusic/daily/，保留 ${RETENTION_DAYS} 天)"
