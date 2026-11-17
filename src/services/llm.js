'use strict';

/**
 * 大模型调用服务
 * 走兼容 OpenAI 协议的 /chat/completions 接口，配置全部来自环境变量：
 *   LLM_API_KEY  接口密钥，未配置时进入演示模式
 *   LLM_BASE_URL 接口基础地址，默认 https://api.openai.com/v1
 *   LLM_MODEL    模型名称，默认 gpt-4o-mini
 *   LLM_TIMEOUT_MS 超时时间（毫秒），默认 30000
 */

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_TIMEOUT_MS = 30000;
const MAX_QUESTION_CHARS = 2000;

/**
 * 读取环境变量配置，每次调用时读取，方便运行时修改环境变量后重启生效
 * @returns {{apiKey: string, baseUrl: string, model: string, timeoutMs: number, demo: boolean}}
 */
function getConfig() {
  const apiKey = (process.env.LLM_API_KEY || '').trim();
  const baseUrl = (process.env.LLM_BASE_URL || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
  const model = (process.env.LLM_MODEL || DEFAULT_MODEL).trim();
  const parsedTimeout = Number.parseInt(process.env.LLM_TIMEOUT_MS || '', 10);
  const timeoutMs = Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : DEFAULT_TIMEOUT_MS;

  return {
    apiKey,
    baseUrl,
    model,
    timeoutMs,
    demo: apiKey === '',
  };
}

/**
 * 构造发送给大模型的消息列表
 * @param {string} question 用户问题
 * @param {string} context 检索到的课程资料
 * @returns {Array<{role: string, content: string}>} 消息列表
 */
function buildMessages(question, context) {
  const systemPrompt = [
    '你是课程“人工智能导论”的助教，负责解答学生的问题。',
    '请严格依据下面提供的课程资料作答，不要编造资料中没有的内容。',
    '如果资料无法回答该问题，请明确说明“课程资料中没有相关内容”，并建议学生联系助教。',
    '回答使用中文，条理清晰，必要时分点说明，并在末尾标注参考的章节标题。',
    '',
    context ? `课程资料：\n${context}` : '课程资料：（本次未检索到相关资料）',
  ].join('\n');

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: question.slice(0, MAX_QUESTION_CHARS) },
  ];
}

/**
 * 演示模式回答：不调用网络，根据检索到的资料拼接一段预设格式的回答
 * @param {string} question 用户问题
 * @param {string} context 检索到的课程资料
 * @param {Array<{title: string}>} sections 检索命中的章节
 * @returns {string} 演示回答
 */
function buildDemoAnswer(question, context, sections) {
  if (!context) {
    return [
      '（演示模式）课程资料中没有检索到与这个问题相关的内容。',
      '建议换一种问法，或直接联系助教（答疑时间：每周三 19:00 至 21:00）。',
      '配置 LLM_API_KEY 后即可获得大模型的完整回答。',
    ].join('\n');
  }

  // 取前两个相关章节的内容，压缩空白后作为回答主体
  const summary = context
    .replace(/【资料\d+】/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .slice(0, 12)
    .join('\n');

  const titles = sections.map((section) => section.title).join('、');

  return [
    '（演示模式回答，未调用大模型）',
    `关于“${question.slice(0, 60)}”，课程资料的相关内容如下：`,
    '',
    summary,
    '',
    `参考章节：${titles}`,
  ].join('\n');
}

/**
 * 调用大模型接口，带超时保护与异常处理
 * @param {Array<{role: string, content: string}>} messages 消息列表
 * @returns {Promise<string>} 模型返回的文本内容
 */
async function requestChatCompletion(messages) {
  const config = getConfig();
  const url = `${config.baseUrl}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: 0.2,
        stream: false,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw new Error(`调用大模型超时（超过 ${config.timeoutMs} 毫秒），请稍后重试`);
    }
    throw new Error(`调用大模型失败：${error && error.message ? error.message : '网络异常'}`);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    // 只读取有限长度的错误内容，避免把整页错误信息塞进日志
    const errorText = await response.text().catch(() => '');
    const detail = errorText.slice(0, 200).replace(/\s+/g, ' ').trim();
    throw new Error(`大模型接口返回异常状态 ${response.status}${detail ? `：${detail}` : ''}`);
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error('大模型接口返回的不是合法 JSON');
  }

  const content = data && data.choices && data.choices[0] &&
    data.choices[0].message && data.choices[0].message.content;

  // 返回内容为空时按失败处理，避免把空回答当作成功写入记录
  if (typeof content !== 'string' || content.trim() === '') {
    throw new Error('大模型返回内容为空，请稍后重试');
  }

  return content.trim();
}

/**
 * 对外统一入口：根据是否配置密钥决定走真实接口还是演示模式
 * @param {string} question 用户问题
 * @param {string} context 检索到的课程资料
 * @param {Array<{title: string}>} sections 检索命中的章节
 * @returns {Promise<{answer: string, mode: 'llm'|'demo', model: string}>} 回答结果
 */
async function ask(question, context, sections) {
  const config = getConfig();

  if (config.demo) {
    return {
      answer: buildDemoAnswer(question, context, sections || []),
      mode: 'demo',
      model: '演示模式',
    };
  }

  const messages = buildMessages(question, context);
  const answer = await requestChatCompletion(messages);

  return {
    answer,
    mode: 'llm',
    model: config.model,
  };
}

module.exports = {
  ask,
  getConfig,
  buildMessages,
  buildDemoAnswer,
};
