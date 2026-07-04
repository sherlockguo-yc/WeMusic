# QQ 音乐接口文档

> **背景**：QQ 音乐没有公开的官方 API 文档。本文档通过逆向工程（浏览器 DevTools 抓包 + 开源项目参考 + 流量分析）汇总了 WeMusic 项目使用的所有 QQ 音乐接口，持续维护迭代。

---

## 一、全局约定

### 通用请求头

所有接口均需携带以下请求头，否则会被拒绝访问：

```
User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36
Referer: https://y.qq.com/
```

歌词相关接口使用独立的 Referer（`https://y.qq.com/portal/player.html`）。

### 响应格式

- 标准 JSON：直接 `JSON.parse()`
- JSONP（带 `callback()` 包裹）：需正则提取 `{...}` 再解析
- 歌词接口：`lyric` 字段为 Base64 编码的 LRC 格式

### musicu 统一接口

多个接口共用 `https://u.y.qq.com/cgi-bin/musicu.fcg`，通过 `data` 参数的 `module` + `method` 字段区分：

```json
{
  "comm": {"ct": 24, "cv": 0},
  "req": {
    "module": "<模块名>",
    "method": "<方法名>",
    "param": { ... }
  }
}
```

所有 musicu 调用方式：
```
GET https://u.y.qq.com/cgi-bin/musicu.fcg?format=json&data=<URL编码的JSON>
```

响应结构：`{ req: { data: { ... } } }`

---

## 二、接口列表

### 1. 完整搜索 — `search_for_qq_cp`

| 属性 | 值 |
|---|---|
| **状态** | ✅ 可用 |
| **URL** | `https://c.y.qq.com/soso/fcgi-bin/search_for_qq_cp` |
| **方法** | GET |
| **参数** | `w`=关键词, `n`=数量(默认30), `format`=json, `p`=页码(默认1) |
| **响应** | `data.song.list[]` — 每项含 `songname` / `singer[]` / `songmid` / `songid` / `albumname` / `albummid` / `interval` / `size128` / `size320` / `sizeflac` |
| **用途** | 桌面端关键词搜索，返回按相关性排序的歌曲列表 |
| **备注** | 支持分页 (`p`)，总数为 `data.song.totalnum`；本接口替代了已失效的 `DoSearchForQQMusicDesktop` |

**示例请求**：
```
GET https://c.y.qq.com/soso/fcgi-bin/search_for_qq_cp?w=外婆&n=30&format=json&p=1
```

**示例响应**：
```json
{
  "code": 0,
  "data": {
    "song": {
      "curnum": 20,
      "curpage": 1,
      "totalnum": 600,
      "list": [{
        "songname": "外婆",
        "songmid": "0027gHes1HjRNe",
        "songid": 102065748,
        "singer": [{ "id": 4558, "mid": "0025NhlN2yWrP4", "name": "周杰伦" }],
        "albumname": "七里香",
        "albummid": "003DFRzD192KKD",
        "interval": 244,
        "size128": 3913543,
        "size320": 9783513,
        "sizeflac": 28649531
      }]
    }
  }
}
```

**字段说明**：

| 字段 | 类型 | 说明 |
|---|---|---|
| `songname` | string | 歌名 |
| `songmid` | string | 歌曲 mid（12位） |
| `songid` | number | 歌曲数字 ID |
| `singer[]` | array | 歌手列表，每项 `{id, mid, name}` |
| `albumname` | string | 专辑名 |
| `albummid` | string | 专辑 mid |
| `interval` | number | 时长（秒） |
| `size128` / `size320` / `sizeflac` | number | 各音质文件大小（字节），>0 表示可用 |
| `pay` | object | 付费信息 `{payplay, paydownload, ...}` |
| `pubtime` | number | 发布时间（Unix 时间戳） |

---

### 2. 联想搜索 — `smartbox_new.fcg`

| 属性 | 值 |
|---|---|
| **状态** | ✅ 可用 |
| **URL** | `https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg` |
| **方法** | GET |
| **参数** | `key`=关键词, `format`=json, `utf8`=1 |
| **响应** | `data.song.itemlist[]`（歌曲联想）/ `data.singer.itemlist[]`（歌手联想） |
| **用途** | 搜索联想（输入框下拉提示），返回少量歌曲 + 歌手候选项 |
| **备注** | 歌手联想可能误匹配（如"外婆"→"外婆的彭湖湾"），需置信度校验 |

**示例请求**：
```
GET https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg?format=json&utf8=1&key=外婆
```

**示例响应**：
```json
{
  "code": 0,
  "data": {
    "song": {
      "itemlist": [
        { "name": "外婆", "mid": "0027gHes1HjRNe", "id": 102065748, "singer": "周杰伦" },
        { "name": "外婆的澎湖湾", "mid": "...", "id": ..., "singer": "1个球" }
      ]
    },
    "singer": {
      "itemlist": [
        { "name": "外婆的彭湖湾", "mid": "..." }
      ]
    }
  }
}
```

---

### 3. 批量歌曲详情 — musicu `CgiGetTrackInfo`

| 属性 | 值 |
|---|---|
| **状态** | ✅ 可用 |
| **URL** | `https://u.y.qq.com/cgi-bin/musicu.fcg` |
| **方法** | GET |
| **Module** | `music.trackInfo.UniformRuleCtrl` |
| **Method** | `CgiGetTrackInfo` |
| **参数** | `ids`=歌曲ID数组, `types`=对应类型数组(填0) |
| **响应** | `data.tracks[]` — 含完整歌曲元数据 |
| **用途** | 批量补全 smartbox 返回的歌曲信息（专辑、时长等） |
| **备注** | smartbox 返回的数据不完整，需要通过此接口补全 |

---

### 4. 歌手全部歌曲 — musicu `GetSingerSongList`

| 属性 | 值 |
|---|---|
| **状态** | ✅ 可用 |
| **URL** | `https://u.y.qq.com/cgi-bin/musicu.fcg` |
| **方法** | GET |
| **Module** | `musichall.song_list_server` |
| **Method** | `GetSingerSongList` |
| **参数** | `singerMid`=歌手mid, `order`=1(热度), `begin`=偏移, `num`=数量 |
| **响应** | `data.songList[]` + `data.totalNum` |
| **用途** | 获取歌手全部歌曲，支持翻页 |
| **备注** | `singerMid` 来自 smartbox 或 `search_for_qq_cp` 的歌手搜索结果 |

---

### 5. 歌手专辑列表 — `fcg_v8_singer_album.fcg`

| 属性 | 值 |
|---|---|
| **状态** | ✅ 可用 |
| **URL** | `https://c.y.qq.com/v8/fcg-bin/fcg_v8_singer_album.fcg` |
| **方法** | GET |
| **参数** | `singermid`=歌手mid, `order`=time, `begin`=偏移, `num`=80, `exclude_japan`=0, `format`=json, `platform`=yqq, `needNewCode`=0 |
| **响应** | `data.list[]` — 每项 `{albumMID, albumName, pubTime}` + `data.total` |
| **用途** | 歌手页专辑展示 |

---

### 6. 专辑详情 — `fcg_v8_album_info_cp.fcg`

| 属性 | 值 |
|---|---|
| **状态** | ✅ 可用 |
| **URL** | `https://c.y.qq.com/v8/fcg-bin/fcg_v8_album_info_cp.fcg` |
| **方法** | GET |
| **参数** | `albummid`=专辑mid, `newsong`=1, `format`=json, `platform`=yqq, `needNewCode`=0 |
| **响应** | `data.list[]`（歌曲列表）+ `data.name` / `data.desc` / `data.company` / `data.genre` / `data.aDate` |
| **用途** | 专辑详情页 + 歌曲背景信息 |

---

### 7. 歌单解析 — musicu `uniform_get_Dissinfo`

| 属性 | 值 |
|---|---|
| **状态** | ✅ 可用 |
| **URL** | `https://u.y.qq.com/cgi-bin/musicu.fcg` |
| **方法** | GET |
| **Module** | `music.srfDissInfo.aiDissInfo` |
| **Method** | `uniform_get_Dissinfo` |
| **参数** | `disstid`=歌单ID, `onlysong`=0, `song_begin`=0, `song_num`=1000, `enc_host_uin`="", `tag`=1, `userinfo`=1, `orderlist`=1 |
| **响应** | `data.songlist[]` + `data.dirinfo.title` + `data.total_song_num` |
| **用途** | 导入 QQ 音乐歌单 |
| **备注** | `disstid` 从歌单链接中提取 |

---

### 8. 排行榜 — `fcg_v8_toplist_cp.fcg`

| 属性 | 值 |
|---|---|
| **状态** | ✅ 可用 |
| **URL** | `https://c.y.qq.com/v8/fcg-bin/fcg_v8_toplist_cp.fcg` |
| **方法** | GET |
| **参数** | `topid`=榜单ID, `num`=50, `format`=json, `tpl`=3, `page`=detail, `type`=top |
| **响应** | `songlist[]` — 每项 `{data: {...歌曲对象}}` |
| **用途** | 热歌榜 / 新歌榜 / 流行指数榜 |

**已知 topId**：
| topId | 名称 |
|---|---|
| 26 | 巅峰榜·热歌 |
| 27 | 巅峰榜·新歌 |
| 4 | 巅峰榜·流行指数 |
| 67 | 听歌识曲榜 |
| 62 | 热歌榜（备用） |

---

### 9. 歌词搜索 — smartbox（命名冲突）

| 属性 | 值 |
|---|---|
| **状态** | ✅ 可用 |
| **URL** | `https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg` |
| **方法** | GET |
| **参数** | `key`=搜索词, `format`=json |
| **请求头** | Referer: `https://y.qq.com/portal/player.html` |
| **用途** | 歌词源候选搜索，获取歌曲 mid 用于拉取歌词 |

---

### 10. 歌词拉取 — `fcg_query_lyric_new.fcg`

| 属性 | 值 |
|---|---|
| **状态** | ✅ 可用 |
| **URL** | `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg` |
| **方法** | GET |
| **参数** | `songmid`=歌曲mid, `format`=json |
| **请求头** | Referer: `https://y.qq.com/portal/player.html` |
| **响应** | JSONP 格式，`lyric` 字段为 Base64 编码的 LRC 歌词 |
| **用途** | 根据 songmid 获取歌词正文 |
| **备注** | 需要正则提取 JSON + Base64 解码；响应可能被 JSONP 包裹 |

---

### 11. ⛔ 已失效 — musicu `DoSearchForQQMusicDesktop`

| 属性 | 值 |
|---|---|
| **状态** | ❌ 已失效（2026-07-04 确认） |
| **URL** | `https://u.y.qq.com/cgi-bin/musicu.fcg` |
| **Module** | `music.search.SearchCgiService` |
| **Method** | `DoSearchForQQMusicDesktop` |
| **参数** | `num_per_page`=50, `page_num`=1, `query`=关键词, `search_type`=0 |
| **现象** | 返回 `song.list: []` 空数组，`singer.list: []` 空数组 |
| **替代** | 使用 `search_for_qq_cp` |

---

### 12. ⛔ 已失效 — `client_search_cp.fcg` (t=8 专辑搜索)

| 属性 | 值 |
|---|---|
| **状态** | ❌ 已失效（2026-07-04 确认） |
| **URL** | `https://c.y.qq.com/soso/fcgi-bin/client_search_cp.fcg` |
| **方法** | GET |
| **参数** | `format`=json, `w`=关键词, `t`=8, `n`=6 |
| **现象** | 返回 HTTP 404 |
| **备注** | 代码中仍保留但实际不工作 |

---

## 三、已知限制

| 限制 | 说明 |
|---|---|
| **无反爬签名** | 当前仅依赖 Referer + User-Agent，未实现 VKey/sign 计算；高频请求可能被 403/风控 |
| **无播放量/收藏量** | 所有已知可用的搜索/详情接口均不返回听歌次数或喜欢人数 |
| **无官方文档** | 接口、参数、字段含义均通过实测推断，可能随时变动 |
| **Requester 限制** | 部分接口疑似对请求来源 IP 有频率限制 |

## 四、探索待办

- [ ] 寻找歌曲播放量/收藏量接口
- [ ] 寻找 QQ 音乐用户登录态接口（会员/FM/推荐）
- [ ] 研究 VKey/签名算法（应对更严格的风控）
- [ ] 探索热门评论接口
- [ ] 研究 `music.cyqq.com` 等其他 QQ 音乐域名的可用接口
- [ ] 探索 Android/iOS 客户端专用接口（可能需要客户端签名）
- [ ] 搜索 open-source 社区是否有更完整的 QQ 音乐 API 文档/代码

---

> 最后更新：2026-07-04
> 维护方式：每发现/修改/废弃一个接口，立即更新本文档
