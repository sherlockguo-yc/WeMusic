# devserver-qspace 磁盘清理与迁移

> VM-224-130-tencentos · 根盘爆满应急处理 · 2026-07-23 → 07-24

## 一、最终状态

| 指标 | 清理前 | 清理后 |
|:--|:--|:--|
| 根盘用量 | 284G / 296G（**100%**）| **76G / 296G（27%）**|
| 释放空间 | — | **约 213G** |
| 数据盘 | 7.5T / 16T（52%）| 7.7T / 16T（52%）|

## 二、磁盘概况

| 文件系统 | 容量 | 类型 |
|:--|:--|:--|
| `/dev/vda1`（根盘） | 296G | HDD |
| `/dev/vdc`（数据盘） | 16T | HDD |

### 根盘用量变化时间线

| 时间点 | 已用 | 使用率 | 操作 |
|:--|:--|:--|:--|
| 清理前 | 284G | 100% | — |
| 第 1 次删 workspace | 247G | 88% | 删 p-c802（38G）|
| 构建重新触发 | 280G | 99% | p-c802 重建 34G |
| 第 2 次删 workspace | 247G | 88% | 删 p-c802（34G）|
| 构建再次触发 | 250G | 89% | p-c802 又重建 |
| 删 _old 目录 | **76G** | **27%** | **删 mmfinderbdedevserver_old（174G）**|

## 三、清理操作汇总

### 3.1 手动清理

| 操作 | 大小 | 说明 |
|:--|:--|:--|
| 删除 p-c802 workspace（×3 次）| ~38G/次 | 流水线残留，每次构建重建 |
| 删除 `mmfinderbdedevserver_old/` | **174G** | 同事迁移 codebase 到 /data 后的旧目录 |
| 删除 `agent.zip` | 142M | Agent 部署包，已安装完毕 |
| 清空 `devops_agent/tmp/` | 400M | 临时文件 |
| 删除 6 个旧 workspace 空壳 | ~100K | 清理历史残留 |

**累计手动释放：约 213G**

### 3.2 自动化清理

部署了 `/home/qspace/cleanup-old-workspaces.sh`：

| 配置项 | 值 |
|:--|:--|
| 清理目标 | `/home/qspace/devops_agent/workspace/` |
| 触发频率 | **每 10 分钟**（`*/10 * * * *`）|
| 清理阈值 | 最后修改超过 **10 分钟**（`-mmin +10`）|
| 安全保护 | 不删正在运行的构建（通过 `ps aux` 检测 java 进程）|
| 软链接兼容 | 使用 `readlink -f` + `find -L` |
| 日志路径 | `/home/qspace/cleanup-workspace.log` |

## 四、devops_agent 分析

- **平台**：腾讯蓝盾（DevOps）
- **项目**：metis
- **Agent ID**：mzwdydvp
- **并发任务数**：4
- **日志保留**：96 小时

### Workspace 膨胀原因

`p-c802` 流水线 workspace 每次构建积压 ~34G：
1. 仓库使用 Git LFS 管理大文件（ML 模型/训练数据）
2. 流水线完成/失败后 **workspace 未自动清理**
3. Agent 配置中没有 workspace 自动清理策略

## 五、迁移状态

| 目录 | 状态 | 位置 |
|:--|:--|:--|
| `mmfinderbdedevserver/` | ✅ 已迁移 | 软链接 → `/data/home/qspace/mmfinderbdedevserver/` |
| `devops_agent/workspace/` | ❌ 未迁移 | 仍在根盘（有 cron 每 10 分钟自动清理兜底）|

⚠️ **workspace 尚未迁移到数据盘**，当前依赖 cron 自动清理。构建完成后最迟 10 分钟内释放空间。

## 六、待完成

1. **完成 workspace 迁移**：将 `devops_agent/workspace` 软链接到 `/data`
2. **排查流水线清理**：`p-c802` 流水线缺少 workspace 自动清理步骤

## 七、运维备忘

| 项目 | 值 |
|:--|:--|
| 清理脚本 | `bash /home/qspace/cleanup-old-workspaces.sh` |
| 日志 | `/home/qspace/cleanup-workspace.log` |
| Cron | `*/10 * * * * /bin/bash /home/qspace/cleanup-old-workspaces.sh` |
| 重启注意 | 确认 `/data` 在 fstab 中自动挂载；确认 devops_agent 有自启动 |

> 📅 更新时间：2026-07-24 · 🖥️ 服务器：VM-224-130-tencentos
