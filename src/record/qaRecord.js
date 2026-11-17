'use strict';

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

// 问答记录文件：data/qa-records.jsonl（每行一条 JSON，方便追加与流式读取）
const RECORD_DIR = path.resolve(__dirname, '../../data');
const RECORD_FILE = path.join(RECORD_DIR, 'qa-records.jsonl');

// 串行化写入队列：并发请求时保证同一时刻只有一个追加操作，避免记录串行错乱
let writeQueue = Promise.resolve();

/**
 * 生成记录 ID
 * @returns {string} 形如 qa-1730000000000-a1b2c3 的唯一标识
 */
function createId() {
  return `qa-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
}

/**
 * 保存一条问答记录（追加写入 JSONL 文件）
 * @param {{question: string, answer: string, mode: string, model: string, sources: Array, durationMs: number}} record 记录内容
 * @returns {Promise<{id: string, createdAt: string}>} 记录标识信息
 */
function saveRecord(record) {
  const entry = {
    id: createId(),
    createdAt: new Date().toISOString(),
    question: record.question,
    answer: record.answer,
    mode: record.mode,
    model: record.model,
    sources: (record.sources || []).map((item) => ({ title: item.title, score: item.score })),
    durationMs: record.durationMs,
  };

  // 串行追加：前一次写入结束（无论成功或失败）后继续下一笔
  writeQueue = writeQueue
    .catch(() => {})
    .then(async () => {
      await fs.mkdir(RECORD_DIR, { recursive: true });
      await fs.appendFile(RECORD_FILE, `${JSON.stringify(entry)}\n`, 'utf8');
    });

  return writeQueue.then(() => ({ id: entry.id, createdAt: entry.createdAt }));
}

/**
 * 读取最近的问答记录（按时间正序返回，最新的在最后）
 * @param {number} limit 最多返回条数，默认 20
 * @returns {Promise<Array<object>>} 记录列表
 */
async function readRecentRecords(limit = 20) {
  const max = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 100) : 20;

  let raw;
  try {
    // 等待进行中的写入完成，保证读到最新的记录
    await writeQueue.catch(() => {});
    raw = await fs.readFile(RECORD_FILE, 'utf8');
  } catch (error) {
    // 文件尚未创建时视为没有记录
    if (error && error.code === 'ENOENT') return [];
    throw error;
  }

  // 逐行解析 JSON，跳过空行与损坏行（单行解析失败不影响其他记录）
  const records = raw
    .split('\n')
    .filter(line => line.trim())
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((record) => record !== null);

  // 取最后max条，保持原有顺序：旧 → 新（最新在数组末尾，符合注释要求）
  return records.slice(-max);
}

module.exports = {
  saveRecord,
  readRecentRecords,
  recordFile: RECORD_FILE,
};
