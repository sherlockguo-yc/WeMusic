/**
 * 平台 / 来源常量
 *
 * 设计原则（参考 naisev/WeMusic 的 MusicSource 枚举 + IMusic.SourceName）：
 *   - 统一使用常量，禁止硬编码字符串 'qqmusic' / 'ne' / 'qq' 等
 *   - 各平台提供 sourceType（对外标识）和 shortName（内部简写）
 *   - sourceId 编解码集中管理（QQ Music 使用 'qq:xxx' 前缀，Netease 使用纯数字）
 */

// ============================================
// 音乐平台枚举
// ============================================

/** @enum {string} */
export const Platform = {
  QQ_MUSIC: 'qqmusic',
  NETEASE: 'netease',
  KUGOU: 'kugou',
  BILIBILI: 'bilibili',
  LOCAL: 'local',
};

// ============================================
// 歌词来源（内部简写，对应 API 返回值中 candidate.source 字段）
// ============================================

/** @enum {string} */
export const LyricsSource = {
  NE: 'ne',       // 网易云音乐
  QQ: 'qq',       // QQ 音乐
};

// ============================================
// 平台元数据
// ============================================

/**
 * 平台配置映射
 */
export const PLATFORM_META = {
  [Platform.QQ_MUSIC]: { label: 'QQ音乐', sourceType: Platform.QQ_MUSIC, shortName: LyricsSource.QQ },
  [Platform.NETEASE]:   { label: '网易云音乐', sourceType: Platform.NETEASE, shortName: LyricsSource.NE },
  [Platform.KUGOU]:     { label: '酷狗音乐', sourceType: Platform.KUGOU, shortName: 'kg' },
  [Platform.BILIBILI]:  { label: 'Bilibili', sourceType: Platform.BILIBILI, shortName: 'bili' },
};

/**
 * 获取平台显示名称
 */
export function platformLabel(platform) {
  return PLATFORM_META[platform]?.label || platform;
}

/**
 * 将歌词 source 简写 → 对外 sourceType
 * 'qq' → 'qqmusic', 'ne' → 'netease'
 */
export function shortNameToSourceType(shortName) {
  if (shortName === LyricsSource.QQ) return Platform.QQ_MUSIC;
  if (shortName === LyricsSource.NE) return Platform.NETEASE;
  return shortName;
}

/**
 * 将对外 sourceType → 歌词 source 简写
 * 'qqmusic' → 'qq', 'netease' → 'ne'
 */
export function sourceTypeToShortName(sourceType) {
  if (sourceType === Platform.QQ_MUSIC) return LyricsSource.QQ;
  if (sourceType === Platform.NETEASE) return LyricsSource.NE;
  return sourceType;
}

// ============================================
// sourceId 编解码
// ============================================

const QQ_PREFIX = 'qq:';

/**
 * 编码 sourceId：QQ 音乐加 'qq:' 前缀，网易云直接数字
 */
export function encodeSourceId(platform, id) {
  if (platform === Platform.QQ_MUSIC) return `${QQ_PREFIX}${id}`;
  return String(id);
}

/**
 * 解码 sourceId：返回 { platform, id }
 */
export function decodeSourceId(sourceId) {
  const s = String(sourceId);
  if (s.startsWith(QQ_PREFIX)) {
    return { platform: Platform.QQ_MUSIC, id: s.slice(QQ_PREFIX.length) };
  }
  return { platform: Platform.NETEASE, id: s };
}

/**
 * 判断 sourceId 是否为 QQ 音乐源
 */
export function isQQSource(sourceId) {
  return String(sourceId).startsWith(QQ_PREFIX);
}
