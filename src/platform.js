/**
 * 前端平台常量（与 shared/constants.js 保持一致）
 */

/** @enum {string} */
export const Platform = {
  QQ_MUSIC: 'qqmusic',
  NETEASE: 'netease',
  KUGOU: 'kugou',
  BILIBILI: 'bilibili',
  LOCAL: 'local',
};

/** @enum {string} 歌词候选 source 字段的值 */
export const LyricsSource = {
  NE: 'ne',
  QQ: 'qq',
};

/** 获取平台显示名称 */
export function platformLabel(platform) {
  const map = {
    [Platform.QQ_MUSIC]: 'QQ音乐',
    [Platform.NETEASE]: '网易云音乐',
    [Platform.KUGOU]: '酷狗音乐',
    [Platform.BILIBILI]: 'Bilibili',
  };
  return map[platform] || platform;
}

/** source 简写 → sourceType */
export function shortNameToSourceType(shortName) {
  if (shortName === LyricsSource.QQ) return Platform.QQ_MUSIC;
  if (shortName === LyricsSource.NE) return Platform.NETEASE;
  return shortName;
}

/** sourceType → source 简写 */
export function sourceTypeToShortName(sourceType) {
  if (sourceType === Platform.QQ_MUSIC) return LyricsSource.QQ;
  if (sourceType === Platform.NETEASE) return LyricsSource.NE;
  return sourceType;
}

/** 判断 sourceId 是否来自 QQ 音乐 */
export function isQQSource(sourceId) {
  return String(sourceId).startsWith('qq:');
}
