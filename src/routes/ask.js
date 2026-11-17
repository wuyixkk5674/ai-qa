'use strict';

const { retrieve, buildContext } = require('../services/retriever');
const llm = require('../services/llm');
const { saveRecord, readRecentRecords } = require('../record/qaRecord');

// 请求体大小上限：64KB，防止超大请求占用内存
const MAX_BODY_BYTES = 64 * 1024;
const MAX_QUESTION_CHARS = 2000;

/**
 * 读取并解析 JSON 请求体
 * @param {import('http').IncomingMessage} req 请求对象
 * @returns {Promise<object>} 解析后的对象
 */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;

    req.on('data', (chunk) => {
      if (tooLarge) return; // 已超限，继续丢弃剩余数据，保证连接正常收尾
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        reject(Object.assign(new Error('请求体过大'), { statusCode: 413 }));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim();
      if (!text) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(Object.assign(new Error('请求体不是合法的 JSON'), { statusCode: 400 }));
      }
    });

    req.on('error', (error) => {
      reject(Object.assign(error, { statusCode: 400 }));
    });
  });
}

/**
 * 校验问题文本
 * @param {unknown} question 原始问题
 * @returns {string} 去除首尾空白的问题
 */
function validateQuestion(question) {
  if (typeof question !== 'string') {
    throw Object.assign(new Error('缺少字段 question，且必须是字符串'), { statusCode: 400 });
  }
  const trimmed = question.trim();
  if (trimmed === '') {
    throw Object.assign(new Error('问题不能为空'), { statusCode: 400 });
  }
  if (trimmed.length > MAX_QUESTION_CHARS) {
    throw Object.assign(new Error(`问题过长，最多 ${MAX_QUESTION_CHARS} 个字符`), { statusCode: 400 });
  }
  return trimmed;
}

/**
 * 处理 POST /api/ask：检索资料 -> 调用大模型 -> 保存记录
 * @param {import('http').IncomingMessage} req 请求对象
 * @param {import('http').ServerResponse} res 响应对象
 * @param {(res: import('http').ServerResponse, status: number, data: object) => void} sendJson 统一的 JSON 响应函数
 */
async function handleAsk(req, res, sendJson) {
  const startedAt = Date.now();

  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    sendJson(res, error.statusCode || 400, { ok: false, error: error.message });
    return;
  }

  let question;
  try {
    question = validateQuestion(body.question);
  } catch (error) {
    sendJson(res, error.statusCode || 400, { ok: false, error: error.message });
    return;
  }

  try {
    // 1. 检索课程资料
    let sections = [];
    try {
      sections = await retrieve(question);
    } catch (error) {
      // 资料缺失不应阻断整体流程，退化为“未检索到资料”
      console.error('[检索] 读取课程资料失败：', error.message);
      sections = [];
    }
    const context = buildContext(sections);

    // 2. 把资料与问题一起发给大模型
    const result = await llm.ask(question, context, sections);

    // 3. 保存问答记录（记录失败不影响本次回答返回）
    let record = null;
    try {
      record = await saveRecord({
        question,
        answer: result.answer,
        mode: result.mode,
        model: result.model,
        sources: sections,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      console.error('[记录] 保存问答记录失败：', error.message);
    }

    sendJson(res, 200, {
      ok: true,
      question,
      answer: result.answer,
      mode: result.mode,
      model: result.model,
      sources: sections.map((section) => ({ title: section.title, score: section.score })),
      record,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    console.error('[问答] 处理失败：', error.message);
    sendJson(res, 502, {
      ok: false,
      error: error.message || '大模型服务暂时不可用，请稍后重试',
    });
  }
}

/**
 * 处理 GET /api/records：返回最近的问答记录
 * @param {URL} url 请求地址（可能带有 limit 参数）
 * @param {import('http').ServerResponse} res 响应对象
 * @param {(res: import('http').ServerResponse, status: number, data: object) => void} sendJson 统一的 JSON 响应函数
 */
async function handleRecords(url, res, sendJson) {
  const limitParam = Number.parseInt(url.searchParams.get('limit') || '', 10);
  try {
    const records = await readRecentRecords(Number.isFinite(limitParam) ? limitParam : 20);
    sendJson(res, 200, { ok: true, records });
  } catch (error) {
    console.error('[记录] 读取问答记录失败：', error.message);
    sendJson(res, 500, { ok: false, error: '读取问答记录失败' });
  }
}

module.exports = {
  handleAsk,
  handleRecords,
};
