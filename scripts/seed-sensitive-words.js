#!/usr/bin/env node
// 敏感词库初始化脚本
// 从 konsheng/Sensitive-lexicon 下载词库并导入到数据库
// 用法: node scripts/seed-sensitive-words.js

import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '..', 'data', 'wemusic.sqlite');
const db = new Database(dbPath);

// 词库文件与分类映射
const SOURCES = [
  { file: '色情词库.txt', category: 'porn' },
  { file: '暴恐词库.txt', category: 'violence' },
  { file: '反动词库.txt', category: 'political' },
  { file: '政治类型.txt', category: 'political' },
];

const BASE_URL = 'https://raw.githubusercontent.com/konsheng/Sensitive-lexicon/main/Vocabulary/';

console.log('开始下载敏感词库...');

let totalAdded = 0;

for (const { file, category } of SOURCES) {
  try {
    const url = BASE_URL + encodeURIComponent(file);
    console.log(`  下载 ${file} ...`);
    const resp = await fetch(url, { timeout: 30000 });
    if (!resp.ok) {
      console.log(`    × 下载失败: HTTP ${resp.status} (跳过)`);
      continue;
    }
    const text = await resp.text();
    const words = text
      .split('\n')
      .map((w) => w.trim())
      .filter((w) => w.length > 0 && w.length <= 50);

    const insert = db.prepare(
      'INSERT OR IGNORE INTO sensitive_words (word, category, added_by, created_at) VALUES (?, ?, ?, ?)',
    );

    let added = 0;
    const now = Date.now();
    for (const word of words) {
      const result = insert.run(word, category, 'seed', now);
      if (result.changes > 0) added++;
    }

    console.log(`    √ ${file}: ${added} 词（总共 ${words.length} 行，${words.length - added} 重复跳过）`);
    totalAdded += added;
  } catch (e) {
    console.log(`    × ${file}: ${e.message} (跳过)`);
  }
}

console.log(`\n完成！共新增 ${totalAdded} 个敏感词`);
db.close();
