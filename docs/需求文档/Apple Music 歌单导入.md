# Apple Music 歌单导入

> 状态：已实现（2026-09-28）；封面补齐见「变更记录」（2026-10-08）
> 日期：2026-09-28
> 关联决策：独立输入框（与 QQ/网易云并列）+ 只支持歌单链接（不支持专辑）；封面初版用默认占位图，2026-10-08 改为「导入时反查 QQ album_mid」
> 实现现状见：docs/功能规格/歌单导入.md

---

## 1. 用户场景（一句话）

用户把 Apple Music 上收藏的歌单（如「演出曲目单：邓紫棋《I AM GLORIA 2.0》巡演」）链接粘贴进 WeMusic 导入弹窗，解析后一键添加到自己的歌单，像 QQ/网易云歌单一样在 WeMusic 里收听。

## 2. 数据流

```
用户粘贴 Apple Music 歌单链接 → 导入弹窗「从 Apple Music 链接解析」→ 点「解析」
→ POST /api/music/parse-playlist（Apple 分支最先判断，见 §5 分支顺序）
→ server/services/apple.js：
   extractApplePlaylistId(url)              // 组合识别策略（见下方「链接识别规则」）
   → fetch 歌单页面 HTML（跟随重定向，15s 超时，桌面 UA）
   → 解析 <script id="serialized-server-data"> 内嵌 JSON
   → 定位曲目：优先取 itemKind === 'trackLockup' 的 section（实测锚点）；
     无则回退遍历全部 sections 过滤 contentDescriptor.kind === 'song'
   → 数量校验：解析数 ≠ JSON-LD numTracks 时打日志（不阻断，仅诊断）
   → normalize 为 songs 数组
   → fillAlbumMids()：逐首用「歌名+歌手」反查 QQ 音乐补 album_mid（并发 4，整体 20s 上限，
     失败/未命中保持空；封面依赖它，2026-10-08 新增）
→ 返回 { source: 'apple', playlistId, name, total, songs }
→ 前端复用 parseAndShowPlaylist() 预览 → 「全部添加到歌单」→ POST /api/playlists/:id/songs
```

### 字段映射（服务端实测确认）

| 输出字段 | 来源（SSR items[] 元素） |
|---|---|
| `song_mid` | `am_<contentDescriptor.identifiers.storeAdamID>` |
| `name` | `title` |
| `singer` | `artistName`（缺失时 fallback `subtitleLinks[0].title`） |
| `album` | `tertiaryLinks` 中 destination.kind === 'album' 的 `title`（缺失时空串） |
| `duration` | `duration`（毫秒）÷ 1000 **向下取整**（与 Apple 页面 ISO 时长口径一致：270677ms → 270s 即 4:30） |
| `source` | `'apple'`（新增 `Platform.APPLE_MUSIC`） |
| `album_mid` | 导入时用「歌名 + 歌手」反查 QQ 音乐补上（2026-10-08；原为空） |
| `singer_mid` | 空 |

歌单名提取优先级（实测 section[0] 与 JSON-LD 一致）：`sections[0].items[0].title` → JSON-LD `name` → `<title>`（需 trim 前后 U+200E 等不可见字符，并去掉「 - 歌单 - Apple Music」后缀）。

### 链接识别规则（组合策略，避免误判/漏判）

| 输入形态 | 判定 |
|---|---|
| 整体为纯 `pl.<hex>`（≥20 位十六进制） | 接受，直接作为歌单 ID |
| URL 含 Apple 域名（`music.apple.com` / `itunes.apple.com` 及其子域，如 `geo.music.apple.com`）且含 `pl.<hex>` | 提取 ID |
| 其余（含 `example.com/pl.xxx` 等） | 返回 null，不走 Apple 分支 |

匹配用大小写不敏感 `/i`，返回值统一 `toLowerCase()` 归一化（实测 ID 为 32 位小写 hex，长度约束放宽到 ≥20 位以防变化）。

### 降级策略

| 层级 | 数据源 | 说明 |
|---|---|---|
| 主 | `serialized-server-data` | 全字段（含歌手/专辑/时长） |
| 降级 | schema.org JSON-LD（`MusicPlaylist`） | 仅歌名 + 时长 + 歌曲链接，**无歌手/专辑**；SSR 结构变更时仍可导入，B 站匹配质量下降 |
| 失败 | 两者都无 | 502「解析失败，Apple Music 页面结构可能已变更」 |

## 3. 状态机

```
空闲 ──粘贴链接+点解析──> 解析中（main 区域显示「正在解析歌单…」，弹窗关闭）
  ├──成功──> 预览页（歌单名 + N 首 + 「全部添加到歌单」按钮）
  │            └──点击──> 选目标歌单弹窗 ──> 写入成功 toast「已添加 N 首」
  └──失败──> main 区域显示「解析失败：<原因>」（不白屏）
```

- 并发：解析中再次点击无入口（弹窗已关闭，预览页占据 main 区域）；与现有 QQ/网易云解析行为一致。
- 空歌单：预览页正常显示「0 首 · 解析完成」（与现有行为一致，不特殊处理）。

## 4. 影响面（参照 `.project-graph.json` 与 grep 结果）

| 文件 | 改动 |
|---|---|
| `server/services/apple.js` | **新增**：链接提取 + 页面抓取 + SSR/JSON-LD 解析 + normalize |
| `server/routes/music.js` | `/parse-playlist` 新增 Apple 分支（放最前，见 §5） |
| `shared/constants.js` | `Platform.APPLE_MUSIC = 'apple'` + `PLATFORM_META` 条目（语义补充，当前 UI 无消费方） |
| `public/index.html` | 导入弹窗新增第三段「从 Apple Music 链接解析」 |
| `src/playlist-ui.js` | 绑定 `importAppleBtn` + Enter 键（复用 `parseAndShowPlaylist`） |
| `docs/功能规格/歌单导入.md` | 更新已实现列表 + 涉及文件；修正「不支持 Apple Music」描述 |

**不受影响**：播放链路（`play.js` 靠 name+singer 搜 B 站，不读 `songs.source`）、歌词、离线缓存、JSON 导入导出。

## 5. 边界与失败

| 场景 | 行为 |
|---|---|
| 链接不含 `pl.` ID | 400「无法识别的 Apple Music 歌单链接」 |
| 歌单不存在 / 未公开 | 实测 HTTP 404、约 4KB 错误页、无 SSR 数据 → 502「歌单不存在或未公开」 |
| 页面结构变更（SSR + JSON-LD 均解析失败） | 502「解析失败，Apple Music 页面结构可能已变更」 |
| 请求超时（15s）/ 网络失败 | 502「Apple Music 访问超时，请稍后重试」 |
| 重复导入 | 现有 `insertSongsBulk` 按 `name__singer` 去重，无需额外处理 |
| **分支顺序（已实测确认，重要）** | Apple 分支必须在网易云/QQ 之前。现有两函数的兜底正则 `/(\d{6,})/` 会误吞 pl ID 内的连续数字：4 个真实样本中 2 个踩中 —— `pl.beb783da7712481fbeed35be144bd48c`（A-List）吞成 `7712481`、`pl.d467987f72384448b2bebe52c0b212d6` 吞成 `467987`，走错分支直接报错 |
| 大歌单 | 实测 100 首歌单 SSR 全量内嵌无分页（= JSON-LD numTracks），无需翻页逻辑 |

## 6. 备选方案对比

| 方案 | 说明 | 结论 |
|---|---|---|
| A. 抓取页面 SSR 数据（**选定**） | 无需 token/登录；实测 33/75/98/100 首歌单全量；N150 国内直连正常（HTTP 200，281KB） | ✅ 零维护成本 |
| B. amp-api.music.apple.com + Bearer token | 实测无 token 返回 401；需从 Apple JS 逆向获取 web token 且会过期，未获官方授权 | ❌ 维护成本高 |
| C. MusicKit JS + OAuth | 需开发者证书 + 用户登录 Apple Music | ❌ 复杂度极高，不适合服务端导入 |
| D. 不做 | — | ❌ 用户明确需求 |

已知风险：方案 A 依赖 Apple 页面 SSR 结构，Apple 改版会导致解析失效（有 §2 降级 + §5 明确报错兜底）。

## 6.5 方案自查验证记录（2026-09-28）

用真实歌单样本对方案逻辑做的实测验证，实现时以下结论直接复用：

| 验证项 | 方法 | 结果 |
|---|---|---|
| 曲目过滤正确性 | 3 个歌单对比 `kind==='song'` 计数 vs JSON-LD numTracks | 33/100/98 全部相等；非曲目 section 仅含 playlist/artist 项，无歌曲混入 |
| section 锚点 | 检查各 sections 的 `itemKind` | 曲目 section 恒为 `trackLockup`，可作为首选定位；全局过滤作为兜底 |
| 链接识别 | 10 种 URL 形态（6 正例 + 4 负例）跑 3 个正则候选 | 单一正则均有缺陷（误判非苹果域名 或 漏判纯 ID），故采用 §2 组合策略 |
| 分支顺序 | 真实 Apple 链接喂给现有两个提取函数 | 4 个样本 2 个误判（见 §5），确认 Apple 分支必须前置 |
| 歌单名 | section[0] vs JSON-LD vs `<title>` 三来源对比 | section[0] 与 JSON-LD 一致且干净；`<title>` 含 U+200E 前缀 + 后缀，仅作兜底 |
| 时长解析（降级路径） | ISO 8601 解析 10 个用例（含 `PT1H2M3S` / `PT45S` / 空值） | 全部通过；与 SSR 毫秒值交叉核对一致 |
| 字段空值 | artistName / duration 全量扫描 | 无空歌手、无异常时长 |
| 404 行为 | 2 个不存在的 ID | HTTP 404 + 4KB 错误页，无 SSR 数据 |

## 7. 验收标准

1. 打开导入弹窗 → 粘贴示例链接（`https://music.apple.com/cn/playlist/演出曲目单-邓紫棋-i-am-gloria-2-0-巡演/pl.324d5804f46e41fbadeba455c4227e6b`）→ 点解析，显示歌单名「演出曲目单：邓紫棋《I AM GLORIA 2.0》巡演」+ 33 首。
2. 点「全部添加到歌单」选目标歌单后，歌曲入库，列表正确显示歌名/歌手/专辑/时长。
3. 播放其中一首歌，正常走 B 站视频搜索匹配播放（与网易云导入的歌行为一致）。
4. 100 首大歌单（如「A-List：国语流行」）完整解析出 100 首，无截断。
5. 粘贴非 Apple 链接或损坏链接 → 明确错误提示，页面不白屏。
6. 回归：QQ 音乐、网易云、JSON 导入功能不受影响。

## 8. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-09-28 | 初版实现：SSR/JSON-LD 解析、字段映射、分支顺序、降级与报错兜底 |
| 2026-10-08 | **封面补齐**：导入时用「歌名+歌手」反查 QQ 音乐补 `album_mid`（实测 33 首命中 32/33，约 +3s）；存量歌单打开时自动回填（`POST /api/playlists/:id/fill-album-mids`，10 分钟防重），完成后原地刷新四宫格封面并同步播放器；网易云导入同机制修复（其数字专辑 ID 拼 QQ 封面 URL 404）；顺带修复离线页 `album-backfill`（原实现依赖 smartbox 接口，实测该接口不返回 albummid，长期静默失效） |
