/**
 * AI 答疑助手 HTTP 集成测试
 *
 * 被测服务：src/server.js（原生 Node.js http，非 Express）
 * 测试框架：Vitest + supertest
 *
 * 路由对照表（用户描述 vs 源码真实路径）：
 *   用户说 GET  /api/history → 源码实际是 GET /api/records （src/server.js 第 123 行）
 *   用户说"最新排在前面"   → 后端 /api/records 返回的是旧→新序，前端 app.js 自己 reverse
 *
 * 演示模式保证：测试前显式删除 LLM_API_KEY 环境变量，避免误触发真实大模型调用
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';

// ESM 里拿 require，加载 CommonJS 被测模块
const require = createRequire(import.meta.url);
const { server } = require('../src/server.js');
const { recordFile } = require('../src/record/qaRecord.js');

// 测试过程中动态分配的端口
let baseUrl;
let app;

// ---------------------------------------------------------------------------
// beforeAll：启动独立端口的 HTTP 服务
// ---------------------------------------------------------------------------
beforeAll(async () => {
  // server.js 顶层代码已经执行过 server.listen(PORT)，
  // 先 close 掉默认监听，再 listen(0) 让 OS 随机分配端口，避免固定端口 3000 冲突
  await new Promise((resolve) => server.close(() => resolve()));

  await new Promise((resolve) => {
    server.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://localhost:${port}`;
      resolve();
    });
  });

  // supertest 的 agent，所有请求共用
  app = request(baseUrl);

  // 强制清空 LLM_API_KEY，保证进入演示模式（不调用真实大模型）
  delete process.env.LLM_API_KEY;
});

// ---------------------------------------------------------------------------
// afterAll：关闭服务，释放端口
// ---------------------------------------------------------------------------
afterAll(async () => {
  await new Promise((resolve) => server.close(() => resolve()));
});

// ---------------------------------------------------------------------------
// beforeEach：清空 JSONL 文件，防止旧数据污染 history 断言
// ---------------------------------------------------------------------------
beforeEach(async () => {
  try {
    await fs.unlink(recordFile);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
});

// ===========================================================================
// 分组 A：GET / —— 访问首页
// ===========================================================================
describe('GET / 首页', () => {
  // 需求 1：HTTP 状态码 200
  it('返回 HTTP 200', async () => {
    const res = await app.get('/');
    expect(res.status).toBe(200);
  });

  // 防御性：返回内容是 HTML，且包含页面标题
  it('返回内容为 HTML 且包含页面标题', async () => {
    const res = await app.get('/');
    expect(res.header['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('AI 答疑助手');
  });
});

// ===========================================================================
// 分组 B：POST /api/ask —— 提问接口
// ===========================================================================
describe('POST /api/ask 提问', () => {
  // 需求 2 前半：传入 question → 接口正常返回 answer
  it('传入 question 返回 ok=true 且含 answer 字段', async () => {
    const res = await app
      .post('/api/ask')
      .set('Content-Type', 'application/json')
      .send({ question: '监督学习和无监督学习有什么区别？' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('ok', true);
    expect(res.body).toHaveProperty('answer');
    expect(typeof res.body.answer).toBe('string');
    expect(res.body.answer.length).toBeGreaterThan(0);
  });

  // 需求 2 后半：演示模式下返回预设回答（mode=demo，answer 里含演示模式标志）
  it('演示模式下 mode 为 demo，answer 含"演示模式"标志文本', async () => {
    const res = await app
      .post('/api/ask')
      .set('Content-Type', 'application/json')
      .send({ question: '什么是机器学习？' });

    expect(res.body.mode).toBe('demo');
    expect(res.body.model).toBe('演示模式');
    expect(res.body.answer).toMatch(/演示模式/);
  });

  // 额外：返回体里应该包含一个写入记录成功后的 record 对象
  it('返回体包含 record 字段，带 id 和 createdAt', async () => {
    const res = await app
      .post('/api/ask')
      .set('Content-Type', 'application/json')
      .send({ question: '测试记录持久化' });

    expect(res.body).toHaveProperty('record');
    expect(res.body.record).toHaveProperty('id');
    expect(res.body.record).toHaveProperty('createdAt');
  });

  // 额外：question 为空时应返回 400，且不写记录
  it('question 为空字符串时返回 HTTP 400', async () => {
    const res = await app
      .post('/api/ask')
      .set('Content-Type', 'application/json')
      .send({ question: '   ' });

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/不能为空/);
  });
});

// ===========================================================================
// 分组 C：GET /api/records —— 历史记录接口
// ===========================================================================
describe('GET /api/records 历史记录', () => {
  // 需求 3 前半：返回数组
  it('返回体中 records 为数组', async () => {
    const res = await app.get('/api/records');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.records)).toBe(true);
  });

  // 需求 3 延伸：没有任何提问时返回空数组
  it('无历史记录时返回空数组', async () => {
    // beforeEach 已经清空过 JSONL 文件
    const res = await app.get('/api/records');

    expect(res.body.records).toEqual([]);
  });

  // 需求 3 后半：连续提问两条后，后端返回数组顺序为旧→新
  // （前端会自己 reverse 变成最新在前——这是客户端职责，这里只验证后端真实返回）
  it('提问两条后 records 含两条，顺序为旧→新（后端真实行为）', async () => {
    // 先提两个问题，每次 sleep 让时间戳可分辨
    await app.post('/api/ask').set('Content-Type', 'application/json').send({ question: '第一个问题' });
    await new Promise((r) => setTimeout(r, 10));

    await app.post('/api/ask').set('Content-Type', 'application/json').send({ question: '第二个问题' });

    const res = await app.get('/api/records');

    expect(res.body.records).toHaveLength(2);

    // 后端 readRecentRecords 返回旧→新
    const questions = res.body.records.map((r) => r.question);
    expect(questions).toEqual(['第一个问题', '第二个问题']);

    // 时间戳递增（旧 → 新）
    for (let i = 1; i < res.body.records.length; i++) {
      const prev = Date.parse(res.body.records[i - 1].createdAt);
      const curr = Date.parse(res.body.records[i].createdAt);
      expect(curr).toBeGreaterThanOrEqual(prev);
    }
  });

  // 额外：带 limit 参数时只返回最近 N 条
  it('带 limit=1 时只返回最近一条', async () => {
    await app.post('/api/ask').set('Content-Type', 'application/json').send({ question: 'A' });
    await new Promise((r) => setTimeout(r, 5));
    await app.post('/api/ask').set('Content-Type', 'application/json').send({ question: 'B' });
    await new Promise((r) => setTimeout(r, 5));
    await app.post('/api/ask').set('Content-Type', 'application/json').send({ question: 'C' });

    const res = await app.get('/api/records?limit=1');
    expect(res.body.records).toHaveLength(1);
    expect(res.body.records[0].question).toBe('C');
  });
});
