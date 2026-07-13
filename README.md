# WeMusic · 本地个人音乐网站

一个仅供个人本地学习使用的自托管音乐网站。借助 QQ 音乐的歌单 / 歌手 / 专辑数据进行检索与管理，播放时自动从 **Bilibili** 匹配最佳视频资源。

> 仅供个人本地学习使用，请勿用于商业用途。

---

## 功能特性

### 用户系统
- 注册 / 登录，JWT + bcrypt cost=12 鉴权，密码最少 8 位。
- 完成后可在 `.env` 设 `ALLOW_REGISTER=false` 关闭注册。
- 用户头像上传（base64 存储），偏好（主题/字体/字号/色板）跨设备同步。
- 播放队列/进度跨设备同步：电脑听到一半，手机打开自动恢复。
- 最近播放列表跨设备共享（基于服务端 `play_logs`）。
- **管理员面板**：顶栏盾牌图标入口，查看用户列表（最近登录 / 7天 30天 总计播放时长）+ 管理反馈。

### 歌单管理
- 粘贴 QQ 音乐链接自动解析导入；按歌手/专辑整张添加。
- 右键歌单编辑名称与简介、删除（带确认）。
- 歌单内拖拽排序持久化，导出/导入 JSON。
- 表头 # / 歌名 / 歌手 / 专辑 / 时长，严格对齐。

### 专辑收藏
- 歌手页 → 专辑详情 →「收藏专辑」，侧边栏「我的专辑」永久保存。
- 专辑网格：封面 hover 悬浮播放，流派药丸标签，hover 上浮 + 阴影。

### 发现音乐
- **为你推荐**：红心、歌单收藏、完播率、重复播放等信号加权 + 时间衰减。
- **排行榜**：热歌榜 / 新歌榜 / 流行指数，实时拉取。

### 播放
- 自动匹配 B 站视频（WBI 签名 + buvid 激活），多 query 并行搜索 + 片段过滤 + 官版优先评分。
- 自动过滤伴奏/现场/翻唱版本，候选标记当前源。
- 支持屏蔽/取消屏蔽视频源和歌词源（换源弹窗底部折叠区恢复）。
- 手动换源、bvid 全局缓存、风控重试 3 次。

### 播放控制
- 视频浮窗（拖动/全屏/收起）、列表循环/单曲循环/随机播放。
- 自动连播 + 后台 `<audio>` 代理（bgAudio 单一音频源），切后台自动接管，回前台无缝恢复。
- 换源偏好持久化到数据库，播放队列/历史同框切换，恢复上次会话。
- 标记「不喜欢」：播放与切歌（随机/顺序）时自动跳过已标记的歌曲，标记状态跨设备持久化。
- 音量归一化：基于 EBU R128 (ebur128) 分析不同视频响度并自动统一增益，设置面板开关，立即生效。

### 歌词
- 全屏歌词页（毛玻璃 + 旋转封面 + LRC 同步滚动），缩放动画。
- 网易云多策略并行搜索，支持换源，候选标记当前源。
- 缓存 24h 复用，偏好 localStorage 持久化。

### 数据统计 · 本周 / 本月听歌报告
- 播放次数/时长/不重复歌曲/听歌天数，含涨跌趋势。
- 6 张卡片：Top 歌曲 / Top 歌手 / 最爱专辑（2×2 封面）/ 播放习惯（跳过率·重复播放率·新歌·多样性·时长·时段）/ 完播率 / 趋势图。
- 音乐人设标签（铁粉/探险家/新曲猎人/深度聆听者/沉浸鉴赏家/多元品味家/自由旋律人）。
- 分享海报两种方案（html2canvas 简约 + Puppeteer 精工），4 主题可选，拼贴墙按专辑去重。

### 界面
- 深色/浅色/跟随系统，10 色预设主题 + 自定义主题色（拾色器，最多 8 个，跨设备同步），字号 4 档，字体 6 种。
- Lucide SVG 图标全站统一，hover 反馈全覆盖。
- 顶栏按钮：反馈 / 打赏（圆形 $）/ 管理员（盾牌）/ 帮助（?）。
- 底栏长歌名 / 视频标题自动左右滚动，视频浮窗标题同样支持。详见 `docs/功能规格/文本滚动.md`。
- 设置面板滚动提示（渐变遮罩 + 箭头）、移动端扫码访问（设置面板 / `/qr`）。
- `npm run mobile`：手机 USB + adb 一键打开浏览器。
- 侧边栏宽度拖拽、定时停止播放、响应式 + PWA。

### 键盘快捷键

| 键 | 功能 |
|----|------|
| `空格` | 暂停/继续 |
| `→` `←` | 上/下一首 |
| `/` | 搜索框 |
| `?` | 帮助 |
| `Esc` | 逐层关闭弹窗 |

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Node.js + Express + better-sqlite3 + JWT |
| 前端 | ES Modules + Vite + history API 路由 |
| 数据 | QQ 音乐 / Bilibili / 网易云歌词 API |
| 海报 | html2canvas + Puppeteer |
| 音频处理 | ffmpeg / ffprobe（音量归一化） |
| 存储 | SQLite + localStorage |

---

## 快速开始

```bash
npm install && npm run build && cp .env.example .env
npm start                     # 启动服务 + 前端自动构建（vite build --watch）
npm run deploy                # 构建 + 重启 + E2E
npm test                      # 单元 + API + 依赖检查（git push 自动运行）
```

`npm start` 会同时启动 Express 服务器和 Vite 构建监听。修改 `src/` 下任意文件后，Vite 自动重新打包到 `public/dist/`，刷新页面即可看到最新效果，无需手动 `npm run build`。

### 手机访问
- **扫码**：「设置 → 移动端访问」或 `http://localhost:5174/qr`
- **adb**：手机 USB 连接，`npm run mobile` 自动打开浏览器
- **手动**：`http://<局域网IP>:5174`（同一 Wi-Fi）
- iOS 分享 →「添加到主屏幕」即可获得 PWA 全屏体验。

---

## 部署

### Docker（推荐）

```bash
cp .env.example .env          # 按需修改 JWT_SECRET / ALLOW_REGISTER / SUPER_ADMIN
docker compose up -d --build  # 构建并后台启动，监听 5174
```

数据持久化在 `wemusic_data` 卷中；如需改端口，修改 `docker-compose.yml` 的 `ports` 映射并设置 `PORT` 环境变量。

### 裸机 / 内网自托管

```bash
npm install && npm run build
npm start                      # 默认监听 5174，可用 .env 的 PORT 覆盖
```

> 中国移动等运营商通常封锁 80/443 入站端口，公网访问可改用非标端口（如 8443）或 Cloudflare 隧道。详见 `docs/架构/自建服务器方案.md`。

---

## 推荐算法

| 信号 | 权重 | 来源 |
|------|------|------|
| 红心 / 歌单 | +3.0 / +2.5 | 明确收藏 |
| 完播率 ≥80% / 20-80% / <20% | +1.5 / +0.3 / -0.3 | 真正听完 vs 跳过 |
| 重复播放 | +0.5/次（上限+3） | 单曲循环 |
| 时间衰减 | 90天线性 ×1→×0.5 | 近期优先 |

歌手权重取 Top 3，合唱非主唱 ×0.4；候选按正分分桶推荐。

---

## 安全措施

| 措施 | 实现 |
|------|------|
| XSS / 点击劫持 / MIME | 响应头 |
| 限流 | 全局 120/min + 登录 10/15min |
| JWT + bcrypt cost=12 | 鉴权 + 密码哈希 |
| Payload / 注册开关 | 256KB / ALLOW_REGISTER |
| 错误脱敏 / 权限隔离 | 500 不暴露堆栈 / admin 403 |
| 音频流 / Webhook | token 认证 / WEBHOOK_SECRET |
| 输入校验 | duration≤24h, played≤duration |

**环境变量（`.env`）**：`PORT` / `JWT_SECRET` / `ALLOW_REGISTER` / `ADMIN_USERNAME` / `WEBHOOK_SECRET` / `WEBHOOK_PORT`

---

## 目录结构

```
WeMusic/
├── src/                      # 前端源码（ES Modules，Vite 打包到 public/dist/）
│   ├── main.js               # 入口 + 路由 + 视图调度
│   ├── player.js             # 播放核心（bgAudio 单音频源 / 进度 / 音量归一化）
│   ├── lyrics.js             # 歌词全屏页
│   ├── search.js             # 搜索 / 歌手 / 专辑
│   ├── stats.js              # 统计 / 周报月报
│   ├── report.js             # 分享海报生成
│   ├── settings.js           # 主题 / 头像 / 设置 / 自定义色 / 音量归一化开关
│   ├── ui.js                 # 右键菜单 / 换源弹窗 / 喜欢·不喜欢
│   ├── admin-panel.js        # 管理员面板
│   ├── albums.js             # 专辑收藏
│   ├── discover.js           # 为你推荐 / 排行榜
│   ├── likes.js              # 喜欢列表
│   ├── share.js              # 分享落地页
│   ├── queue.js              # 播放队列管理
│   ├── playlist-ui.js        # 歌单列表渲染
│   ├── state.js / api.js / utils.js / platform.js / login-entry.js
│   └── admin/               # 管理面板子模块
├── shared/                   # 前后端共用（海报模板 / 常量）
│   ├── poster-template.js
│   └── constants.js
├── public/                   # HTML / CSS / PWA / dist（构建产物）
├── server/                   # Express 后端
│   ├── index.js / config.js / db.js / webhook.js
│   ├── routes/              # auth / music / play / playlist / stats / admin
│   ├── services/            # bilibili / qqmusic / netease / lyrics / crowd / poster
│   └── middleware/          # 鉴权 / 限流
├── scripts/                  # build-restart / e2e / codegraph / check-deps / mobile-open / promote-admin
├── tests/                    # 单元测试 + API 集成测试
├── docker-compose.yml / Dockerfile
├── data/                     # SQLite 数据库（运行时生成）
└── package.json
```

---

## 已知限制

- iframe 跨域导致同步进度/画质/音量不可控。
- 自动连播靠定时器，MV 时长不一致时可能偏差。
- 单用户 SQLite 架构，不支持多并发。
- QQ 音乐专辑封面统一 500px 尺寸确保兼容。
