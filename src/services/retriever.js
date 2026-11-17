'use strict';

const fs = require('fs/promises');
const path = require('path');
const { tokenize, countTokens, truncate } = require('../utils/text');

// 默认资料路径：data/course-notes.md（相对项目根目录）
const DEFAULT_NOTES_PATH = path.resolve(__dirname, '../../data/course-notes.md');

// 检索参数
const TITLE_WEIGHT = 3;      // 标题命中的权重（标题更能说明章节主题）
const MAX_SECTIONS = 3;      // 最多返回的章节数
const MIN_SCORE = 0.05;      // 低于该分数的章节视为不相关
const MAX_CONTEXT_CHARS = 3500; // 拼给大模型的资料上限

/**
 * 把 Markdown 按二级标题拆分为章节
 * @param {string} markdown 原始 Markdown 文本
 * @returns {Array<{title: string, content: string}>} 章节列表
 */
function parseSections(markdown) {
  const lines = markdown.split(/\r?\n/);
  const sections = [];
  let current = null;

  for (const line of lines) {
    // 一级标题视为文档标题，跳过；二级及以下标题作为章节切分点
    if (/^#\s+/.test(line)) continue;

    const heading = line.match(/^#{2,3}\s+(.+?)\s*$/);
    if (heading) {
      if (current && current.content.trim()) sections.push(current);
      current = { title: heading[1].trim(), content: '' };
      continue;
    }

    if (!current) {
      // 首个标题之前的导言内容，归入“课程概览”
      if (line.trim() === '') continue;
      current = { title: '课程概览', content: '' };
    }
    current.content += `${line}\n`;
  }

  if (current && current.content.trim()) sections.push(current);

  return sections.map((section) => ({
    title: section.title,
    content: section.content.trim(),
  }));
}

/**
 * 读取并解析课程资料（每次读取最新文件内容，方便修改资料后立即生效）
 * @returns {Promise<Array<{title: string, content: string}>>} 章节列表
 */
async function loadSections() {
  const markdown = await fs.readFile(DEFAULT_NOTES_PATH, 'utf8');
  return parseSections(markdown);
}

/**
 * 计算单个章节与查询的相关性得分
 * 得分 = 标题词频加权 + 正文词频加权，再按章节长度做归一化，避免长章节天然占优
 * @param {Map<string, number>} queryCounter 查询词频
 * @param {{title: string, content: string}} section 章节
 * @returns {number} 相关性得分
 */
function scoreSection(queryCounter, section) {
  const titleCounter = countTokens(tokenize(section.title));
  const bodyCounter = countTokens(tokenize(section.content));

  let rawScore = 0;
  for (const token of queryCounter.keys()) {
    // 查询中的同一个词只计一次权重，避免重复词放大分数
    const titleHit = titleCounter.get(token) || 0;
    const bodyHit = bodyCounter.get(token) || 0;
    if (titleHit > 0) rawScore += TITLE_WEIGHT * Math.min(titleHit, 2);
    if (bodyHit > 0) rawScore += Math.min(bodyHit, 3);
  }

  if (rawScore === 0) return 0;

  // 用章节词数的平方根归一化：长章节需要命中更多词才能拿到同样分数
  const lengthPenalty = Math.sqrt(Math.max(bodyCounter.size, 1));
  return rawScore / lengthPenalty / Math.max(1, Math.log2(queryCounter.size + 2));
}

/**
 * 检索与问题最相关的课程章节
 * @param {string} question 用户问题
 * @returns {Promise<Array<{title: string, content: string, score: number}>>} 相关章节（按分数降序）
 */
async function retrieve(question) {
  const tokens = tokenize(question);
  if (tokens.length === 0) return [];

  const queryCounter = countTokens(tokens);
  const sections = await loadSections();

  const scored = sections
    .map((section) => ({ ...section, score: scoreSection(queryCounter, section) }))
    .filter((section) => section.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SECTIONS);

  return scored.map((section) => ({
    ...section,
    // 保留三位小数，避免接口返回过长的小数
    score: Number(section.score.toFixed(3)),
  }));
}

/**
 * 把检索结果拼成提供给大模型的资料上下文
 * @param {Array<{title: string, content: string}>} sections 检索结果
 * @returns {string} 资料上下文文本
 */
function buildContext(sections) {
  if (!Array.isArray(sections) || sections.length === 0) return '';

  const text = sections
    .map((section, index) => `【资料${index + 1}】${section.title}\n${section.content}`)
    .join('\n\n');

  return truncate(text, MAX_CONTEXT_CHARS);
}

module.exports = {
  retrieve,
  buildContext,
  parseSections,
  notesPath: DEFAULT_NOTES_PATH,
};
