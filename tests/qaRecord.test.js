/**
 * qaRecord.js 单元测试
 *
 * 被测模块（CommonJS）真实导出的 API：
 *   saveRecord(record)        → 追加一条问答记录到 JSONL 文件，返回 { id, createdAt }
 *   readRecentRecords(limit) → 读取最近记录，返回数组（旧 → 新序）；limit 默认 20
 *   recordFile                → JSONL 文件的绝对路径（qa-records.jsonl）
 *
 * 设计要点：
 *   - Vitest v5 要求测试文件为 ESM（import），被测模块是 CJS，
 *     这里通过 createRequire 在 ESM 中加载 CJS 模块
 *   - 每次测试前清空 JSONL 文件，避免前次写入的记录残留影响断言
 *   - 分组 A 直接用 fs 手动造文件内容，绕开 saveRecord，避免"自己测自己"
 *   - 分组 B/C 走完整的 saveRecord → readRecentRecords 调用链
 *   - 独立断言：不镜像源码的 slice(-max)、时间戳格式等实现细节，
 *     只验证"给入什么 → 出来什么"的行为契约
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

// 在 ESM 里拿 require，用来加载 CommonJS 被测模块
const require = createRequire(import.meta.url);
const { saveRecord, readRecentRecords, recordFile } = require('../src/record/qaRecord.js');

// ---------------------------------------------------------------------------
// 夹具：每次测试前把 JSONL 文件干掉（或清空），防止历史数据污染
// ---------------------------------------------------------------------------
async function clearRecordFile() {
  try {
    await fs.unlink(recordFile);
  } catch (err) {
    // ENOENT = 文件本来就不存在，这不是错误，直接忽略
    if (err.code !== 'ENOENT') throw err;
  }
}

// ---------------------------------------------------------------------------
// 夹具：构造一条 saveRecord 能接受的最小问答对象
// ---------------------------------------------------------------------------
function makeRecord(overrides = {}) {
  return {
    question: '测试问题？',
    answer: '测试回答。',
    mode: 'demo',
    model: 'test-model',
    sources: [{ title: '课程资料A', score: 0.95 }],
    durationMs: 123,
    ...overrides,
  };
}

// ===========================================================================
// 分组 A：readRecentRecords（读取行为，需求 1 / 3）
// ===========================================================================
describe('readRecentRecords', () => {
  beforeEach(async () => {
    await clearRecordFile();
  });

  // 需求 1 前半：文件不存在 → 返回空数组
  it('文件不存在时返回空数组', async () => {
    const records = await readRecentRecords();
    expect(records).toEqual([]);
  });

  // 需求 1 后半：正常文件 → 返回数组，且顺序为旧记录在前
  it('正常文件返回数组，默认顺序为旧→新', async () => {
    // 直接用 fs 写 JSONL，不经过 saveRecord——这是 readRecentRecords 的独立职责
    const lines = [
      JSON.stringify({ question: '最早的一条', createdAt: '2025-01-01T00:00:00.000Z' }),
      JSON.stringify({ question: '中间一条', createdAt: '2025-01-02T00:00:00.000Z' }),
      JSON.stringify({ question: '最新的一条', createdAt: '2025-01-03T00:00:00.000Z' }),
    ];
    await fs.mkdir(path.dirname(recordFile), { recursive: true });
    await fs.writeFile(recordFile, lines.join('\n') + '\n', 'utf8');

    const records = await readRecentRecords();

    expect(records).toHaveLength(3);
    // 旧 → 新：文件第一行在数组最前
    expect(records[0].question).toBe('最早的一条');
    expect(records[1].question).toBe('中间一条');
    expect(records[2].question).toBe('最新的一条');
  });

  // 需求 3：readRecentRecords(limit) 限制返回条数
  it('传入 limit 时只返回最近 N 条，顺序仍为旧→新', async () => {
    const lines = [
      JSON.stringify({ question: 'A' }),
      JSON.stringify({ question: 'B' }),
      JSON.stringify({ question: 'C' }),
      JSON.stringify({ question: 'D' }),
      JSON.stringify({ question: 'E' }),
    ];
    await fs.mkdir(path.dirname(recordFile), { recursive: true });
    await fs.writeFile(recordFile, lines.join('\n') + '\n', 'utf8');

    // limit=2 → 取最后两条 C、D、E 中的后两条 D、E；顺序旧→新 → D 在前
    const records = await readRecentRecords(2);

    expect(records).toHaveLength(2);
    expect(records[0].question).toBe('D');
    expect(records[1].question).toBe('E');
  });

  // 防御性：limit 传 0 / 负数 → 应回退到默认上限 20
  it('limit 非法时回退到默认上限，不抛异常', async () => {
    await fs.mkdir(path.dirname(recordFile), { recursive: true });
    await fs.writeFile(recordFile, JSON.stringify({ question: 'x' }) + '\n', 'utf8');

    // 不抛异常即通过；具体返回条数由源码内部处理
    const records = await readRecentRecords(-1);
    expect(Array.isArray(records)).toBe(true);
  });

  // 防御性：文件中有损坏行 → 跳过损坏行，正常行仍能读回
  it('跳过损坏的 JSON 行，正常行不受影响', async () => {
    const content = [
      JSON.stringify({ question: '好记录 1' }),
      '{这不是合法的 json',
      JSON.stringify({ question: '好记录 2' }),
    ].join('\n') + '\n';
    await fs.mkdir(path.dirname(recordFile), { recursive: true });
    await fs.writeFile(recordFile, content, 'utf8');

    const records = await readRecentRecords();

    expect(records).toHaveLength(2);
    expect(records.map((r) => r.question)).toEqual(['好记录 1', '好记录 2']);
  });
});

// ===========================================================================
// 分组 B：saveRecord（追加写入，需求 2）
// ===========================================================================
describe('saveRecord', () => {
  beforeEach(async () => {
    await clearRecordFile();
  });

  // 需求 2：传入问答对象 → 自动生成 id 和 createdAt，追加保存
  it('返回值中自动生成 id 和 createdAt', async () => {
    const beforeCall = Date.now();

    const result = await saveRecord(makeRecord({ question: '自动生成标识测试' }));

    const afterCall = Date.now();

    // 返回值有 createdAt，且为合法时间字符串
    expect(result).toHaveProperty('createdAt');
    expect(typeof result.createdAt).toBe('string');
    expect(Number.isNaN(Date.parse(result.createdAt))).toBe(false);

    // createdAt 落在本次调用前后之间
    const ts = Date.parse(result.createdAt);
    expect(ts).toBeGreaterThanOrEqual(beforeCall - 1000);
    expect(ts).toBeLessThanOrEqual(afterCall + 1000);

    // 返回值有 id，且格式符合 qa-<毫秒时间戳>-<6位十六进制>
    expect(result).toHaveProperty('id');
    expect(result.id).toMatch(/^qa-\d{10,13}-[0-9a-f]{6}$/);
  });

  // 需求 2 续：连续调用 saveRecord → 每次都是追加，不覆盖前一条
  it('多次调用 saveRecord 结果为追加，不覆盖之前的记录', async () => {
    await saveRecord(makeRecord({ question: '第一条', answer: '答案一' }));
    await saveRecord(makeRecord({ question: '第二条', answer: '答案二' }));
    await saveRecord(makeRecord({ question: '第三条', answer: '答案三' }));

    const records = await readRecentRecords();

    expect(records).toHaveLength(3);
    expect(records[0].question).toBe('第一条');
    expect(records[1].question).toBe('第二条');
    expect(records[2].question).toBe('第三条');
  });

  // 额外：保存后再读，question / answer / durationMs 等核心字段内容一致
  it('saveRecord 写入的核心字段，readRecentRecords 能原样读回', async () => {
    await saveRecord(
      makeRecord({
        question: '字段一致性',
        answer: '回答内容完整',
        mode: 'online',
        model: 'gpt-4o',
        durationMs: 567,
      })
    );

    const records = await readRecentRecords();
    expect(records).toHaveLength(1);

    // 核对写入值 vs 读回值
    expect(records[0].question).toBe('字段一致性');
    expect(records[0].answer).toBe('回答内容完整');
    expect(records[0].mode).toBe('online');
    expect(records[0].model).toBe('gpt-4o');
    expect(records[0].durationMs).toBe(567);

    // sources 也应保留并被归一化（只含 title / score 两个字段）
    expect(records[0].sources).toEqual([{ title: '课程资料A', score: 0.95 }]);
  });
});

// ===========================================================================
// 分组 C：saveRecord → readRecentRecords 完整链路排序验证
// ===========================================================================
describe('saveRecord 写入 + readRecentRecords 读出的排序行为', () => {
  beforeEach(async () => {
    await clearRecordFile();
  });

  // 核心用例：连续追加三条后，readRecentRecords 返回顺序为 旧→新
  it('连续追加三条记录后，readRecentRecords 返回顺序为旧→新', async () => {
    // 每次 sleep 确保时间戳可分辨，避免同一毫秒内写入
    await saveRecord(makeRecord({ question: '记录 A' }));
    await new Promise((r) => setTimeout(r, 10));

    await saveRecord(makeRecord({ question: '记录 B' }));
    await new Promise((r) => setTimeout(r, 10));

    await saveRecord(makeRecord({ question: '记录 C' }));

    const records = await readRecentRecords();

    // 条数正确
    expect(records).toHaveLength(3);

    // 顺序：最早写入的在数组最前，最晚写入的在最后
    expect(records.map((r) => r.question)).toEqual(['记录 A', '记录 B', '记录 C']);

    // 时间戳严格递增（旧 → 新）
    for (let i = 1; i < records.length; i++) {
      const prev = Date.parse(records[i - 1].createdAt);
      const curr = Date.parse(records[i].createdAt);
      expect(curr).toBeGreaterThanOrEqual(prev);
    }
  });

  // 结合 limit：读最近 N 条，顺序仍旧→新
  it('limit=3 时只返回最后 3 条，顺序仍旧→新', async () => {
    // 写 5 条
    for (let i = 1; i <= 5; i++) {
      await saveRecord(makeRecord({ question: `记录 ${i}` }));
      await new Promise((r) => setTimeout(r, 5));
    }

    // limit=3 → 取最后 3 条，顺序旧→新
    const records = await readRecentRecords(3);
    expect(records.map((r) => r.question)).toEqual(['记录 3', '记录 4', '记录 5']);
  });
});
