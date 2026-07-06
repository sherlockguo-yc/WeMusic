/**
 * 歌词 Provider 基类
 *
 * 设计参考 naisev/WeMusic 的 IApi 接口：
 *   - GetMusicUrl() / GetCoverUrl() / GetLyric() — 每个平台实现同样的接口
 * 我们将其适配为 JavaScript 版本的 LyricsProvider：
 *   - search(name, artist) → candidates
 *   - fetchLyric(id) → raw lyric text
 *   - scoreCandidate(candidate, {name, singer}) → quality score
 */

export default class LyricsProvider {
  /**
   * @param {string} source - LyricsSource 常量（'ne' / 'qq'）
   * @param {string} label - 显示名称（'网易云音乐' / 'QQ音乐'）
   */
  constructor(source, label) {
    this.source = source;
    this.label = label;
  }

  /**
   * 搜索歌词候选列表
   * @param {string} keyword - 搜索关键词
   * @returns {Promise<Array<{id: string, rawId: string, name: string, artist: string}>>}
   */
  async search(keyword) {
    throw new Error('子类必须实现 search()');
  }

  /**
   * 拉取歌词原文
   * @param {string} id - 平台特定的歌曲 ID（rawId: 网易云用纯数字，QQ 用 songmid）
   * @returns {Promise<string>} LRC 格式歌词
   */
  async fetchLyric(id) {
    throw new Error('子类必须实现 fetchLyric()');
  }

  /**
   * 为候选打分
   * @param {object} song - search() 返回的歌曲对象
   * @param {{ name: string, singerFirst: string }} context
   * @returns {{ quality: number }}
   */
  scoreCandidate(song, context) {
    throw new Error('子类必须实现 scoreCandidate()');
  }
}
