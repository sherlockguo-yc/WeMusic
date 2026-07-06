/**
 * 源质量众包服务：基于用户完播行为积累源权重
 */

import db from '../db.js';

/** 查询某首歌的众包完播数据，返回 Map<sourceId, completions> */
export function getCrowdCompletions(sourceType, songKey) {
  const rows = db.prepare(`
    SELECT source_id, completions FROM source_completions
    WHERE source_type = ? AND song_key = ?
  `).all(sourceType, songKey);
  const map = new Map();
  for (const r of rows) map.set(r.source_id, r.completions);
  return map;
}

/**
 * 计算完播加权加成
 * 对数衰减防止少数热门源垄断排序
 */
export function crowdBonus(completions, weight) {
  if (!completions || completions <= 0) return 0;
  return Math.round(Math.log2(completions + 1) * weight * 100) / 100;
}
