# Docker 部署检查清单

部署任何 Docker 服务前，按此清单逐项检查。

## 1. 构建上下文完整性

- [ ] 检查 `Dockerfile` 中 `COPY . .` 或 `COPY xxx` 是否遗漏文件
- [ ] 确认 `.dockerignore` 没有排除必要的文件（如 `public/css/`、`public/icons/` 等静态资源）
- [ ] 如果使用 rsync/scp 上传源码，确认没有用 `--exclude` 排除了构建必需的文件

## 2. 端口与网络

- [ ] `docker-compose.yml` 中的 `ports` 映射是否正确
- [ ] 如果通过 NPM 或其他反代访问，确认两个容器在 **同一个 Docker 网络** 中
- [ ] 检查 `docker network ls`，确认目标网络是否存在
- [ ] 使用 `docker network connect <network> <container>` 将容器加入同一网络
- [ ] 写入 `docker-compose.yml` 的 `networks` 字段，确保重启后网络配置持久化

## 3. Volume 与数据持久化

- [ ] 数据库/文件存储目录是否挂载为 volume 或 bind mount
- [ ] volume 命名是否避免与其他项目冲突
- [ ] 检查 `docker volume ls` 确认 volume 存在

## 4. 环境变量

- [ ] `JWT_SECRET` 等敏感配置是否通过 `.env` 文件或环境变量传入，**不硬编码**
- [ ] 确认 `.env` 文件不在 Git 仓库中（已加入 `.gitignore`）

## 5. 反代（NPM / Nginx）

- [ ] Proxy Host 的 `Forward Hostname/IP` 是否使用 Docker 容器名（而非 IP）
- [ ] `Forward Port` 是否正确
- [ ] 检查 Docker 网络互通：`docker exec <proxy_container> curl http://<target_container>:<port>/`
- [ ] 如使用 502，先查 Docker 网络，再查容器是否 running

## 6. SPA 应用特殊检查

- [ ] Express 等后端是否有 SPA fallback（非 API/非文件请求返回 `index.html`）
- [ ] 是否设置了 `trust proxy`（如果经过反代）
- [ ] 限流/鉴权中间件的 `skip` 逻辑是否考虑了反代后的 IP 变化

## 7. 验证

```bash
# 容器状态
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'

# 日志
docker logs <container> --tail 20

# 本地测试
curl -s -o /dev/null -w '%{http_code}' http://localhost:<port>/

# 通过反代测试
curl -s -o /dev/null -w '%{http_code}' http://localhost/
```
