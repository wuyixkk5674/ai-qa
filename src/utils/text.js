'use strict';

/**
 * 文本分词工具（不依赖第三方分词库）
 * 中文按二元词（bigram）切分，英文与数字按单词切分，适合做轻量级关键词检索。
 */

// 中文停用词：这些字词出现频率高，但几乎不携带检索信息
const CHINESE_STOPWORDS = new Set([
  '的', '了', '是', '在', '和', '与', '及', '或', '等', '我', '你', '他', '她', '它',
  '我们', '你们', '他们', '这', '那', '这个', '那个', '一个', '什么', '怎么', '如何',
  '为什么', '哪些', '哪里', '是否', '可以', '能否', '请问', '请', '介绍', '一下',
  '有', '没有', '要', '会', '能', '对', '把', '被', '就', '都', '也', '还', '而',
  '以及', '关于', '如果', '那么', '因为', '所以', '但', '但是', '中', '上', '下',
  '吗', '呢', '吧', '啊', '呀', '哦', '着', '过', '地', '得',
]);

// 英文停用词
const ENGLISH_STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'to', 'of', 'and', 'or',
  'in', 'on', 'at', 'for', 'with', 'by', 'from', 'as', 'that', 'this', 'these', 'those',
  'it', 'its', 'i', 'you', 'he', 'she', 'they', 'we', 'what', 'which', 'who', 'how',
  'why', 'when', 'where', 'can', 'could', 'should', 'would', 'do', 'does', 'did', 'not',
  'please', 'about', 'there', 'here', 'my', 'your', 'our', 'their',
]);

/**
 * 判断一个二元词是否完全由停用字组成（例如“什么”“么是”）
 * @param {string} bigram 中文二元词
 * @returns {boolean} 是否为无意义二元词
 */
function isStopBigram(bigram) {
  return CHINESE_STOPWORDS.has(bigram) ||
    (CHINESE_STOPWORDS.has(bigram[0]) && CHINESE_STOPWORDS.has(bigram[1]));
}

/**
 * 对文本分词，返回去重前的词数组（保留重复次数，便于计算词频）
 * @param {string} text 原始文本
 * @returns {string[]} 词数组
 */
function tokenize(text) {
  if (typeof text !== 'string' || text.trim() === '') return [];

  const normalized = text.toLowerCase();
  const tokens = [];

  // 1. 提取英文单词、数字（保留 3.10、f1 这类写法）
  const englishMatches = normalized.match(/[a-z0-9][a-z0-9._-]*/g) || [];
  for (const word of englishMatches) {
    const cleaned = word.replace(/^[._-]+|[._-]+$/g, '');
    if (cleaned.length < 2 && !/^\d+$/.test(cleaned)) continue;
    if (ENGLISH_STOPWORDS.has(cleaned)) continue;
    tokens.push(cleaned);
  }

  // 2. 提取连续中文片段，再切分为二元词
  const chineseMatches = normalized.match(/[\u4e00-\u9fa5]+/g) || [];
  for (const segment of chineseMatches) {
    if (segment.length === 1) {
      if (!CHINESE_STOPWORDS.has(segment)) tokens.push(segment);
      continue;
    }
    for (let i = 0; i < segment.length - 1; i += 1) {
      const bigram = segment.slice(i, i + 2);
      if (isStopBigram(bigram)) continue;
      tokens.push(bigram);
    }
  }

  return tokens;
}

/**
 * 统计词频
 * @param {string[]} tokens 词数组
 * @returns {Map<string, number>} 词 -> 出现次数
 */
function countTokens(tokens) {
  const counter = new Map();
  for (const token of tokens) {
    counter.set(token, (counter.get(token) || 0) + 1);
  }
  return counter;
}

/**
 * 按最大长度截断文本，避免把整份资料塞进提示词
 * @param {string} text 原文本
 * @param {number} maxLength 最大字符数
 * @returns {string} 截断后的文本
 */
function truncate(text, maxLength) {
  if (typeof text !== 'string') return '';
  if (!Number.isFinite(maxLength) || maxLength <= 0 || text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}\n……（内容过长，已截断）`;
}

module.exports = {
  tokenize,
  countTokens,
  truncate,
};
