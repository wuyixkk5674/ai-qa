/**
 * AI 答疑助手 Playwright 离线 E2E 测试脚本
 *
 * 覆盖的浏览器操作（与手工验证流程完全一致）：
 *   1. 打开 http://localhost:3000，校验页面标题，截图
 *   2. 输入「什么是MCP？」→ 点击提交 → 等待回答出现，截图
 *   3. 校验历史记录新增一条且最新在最上方（前端 reverse 后的效果），截图
 *
 * 离线运行前提：
 *   - 服务已在本机 3000 端口启动（npm start）
 *   - 未配置 LLM_API_KEY，走演示模式，回答为本地预设内容，不依赖外网
 *
 * 运行方式：
 *   npx playwright test e2e/qa.spec.js
 *
 * 截图输出：screenshots/ 目录（每次运行自动创建并覆盖）
 */
const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');

const BASE_URL = 'http://localhost:3000';
const SCREENSHOT_DIR = path.resolve(__dirname, '..', 'screenshots');

// 项目 data 目录下的记录文件（真实落盘为 JSONL，同时兼容清理 .json）
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const RECORD_FILE_JSONL = path.join(DATA_DIR, 'qa-records.jsonl');
const RECORD_FILE_JSON = path.join(DATA_DIR, 'qa-records.json');

/**
 * 删除单个文件，文件不存在时忽略
 * @param {string} filePath 文件绝对路径
 */
async function removeIfExists(filePath) {
  try {
    await fs.unlink(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

/**
 * 清空历史记录文件，避免旧数据污染断言
 */
async function clearRecordFiles() {
  await removeIfExists(RECORD_FILE_JSONL);
  await removeIfExists(RECORD_FILE_JSON);
}

/**
 * 等待回答真正生成完成
 * answer-meta（来源说明）只在 renderAnswer 之后才填充，
 * 用它做锚点比等待 answer-text 更可靠（answer-text 会先显示"正在检索…"）
 * @param {import('@playwright/test').Page} page
 */
async function waitForAnswer(page) {
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="answer-meta"]');
      return el && el.textContent.trim().length > 0;
    },
    { timeout: 30000 }
  );
}

test.describe('AI 答疑助手 - 浏览器操作全流程', () => {
  // 整个测试套件开始前：确认服务在线，并准备截图目录
  test.beforeAll(async () => {
    await fs.mkdir(SCREENSHOT_DIR, { recursive: true });

    let res;
    try {
      res = await fetch(`${BASE_URL}/api/status`);
    } catch {
      throw new Error(`无法连接 ${BASE_URL}，请先执行 npm start 启动服务后再运行本脚本`);
    }
    expect(res.ok).toBe(true);
  });

  // 每个用例前清空历史记录，保证列表断言从零开始
  test.beforeEach(async () => {
    await clearRecordFiles();
  });

  // -------------------------------------------------------------------------
  // 操作 1：打开首页，查看页面标题并截图
  // -------------------------------------------------------------------------
  test('打开首页并校验标题', async ({ page }) => {
    const response = await page.goto(BASE_URL, { waitUntil: 'load' });

    // HTTP 200
    expect(response.status()).toBe(200);

    // 页面标题精确匹配
    await expect(page).toHaveTitle('AI 答疑助手 · 人工智能导论');

    // 关键元素可见
    await expect(page.getByTestId('ask-input')).toBeVisible();
    await expect(page.getByTestId('ask-button')).toBeVisible();

    // 截图：首页完整视图
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01-home.png'), fullPage: true });
  });

  // -------------------------------------------------------------------------
  // 操作 2：输入「什么是MCP？」→ 点击提交 → 等待回答出现 → 截图
  // -------------------------------------------------------------------------
  test('提交「什么是MCP？」并等待回答出现', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'load' });

    // 输入问题
    await page.getByTestId('ask-input').fill('什么是MCP？');

    // 点击提交
    await page.getByTestId('ask-button').click();

    // 回答面板出现
    await expect(page.getByTestId('answer-panel')).toBeVisible();

    // 等待回答生成完成（以 answer-meta 非空为准）
    await waitForAnswer(page);

    // 回答文本非空，且演示模式下带「演示模式」标志
    const answerText = page.getByTestId('answer-text');
    await expect(answerText).not.toBeEmpty();
    await expect(answerText).toContainText('演示模式');

    // 来源说明非空（如：演示模式 · 耗时 2 毫秒）
    await expect(page.getByTestId('answer-meta')).toContainText('演示模式');

    // 截图：回答展示（视口截取，聚焦首屏内容）
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02-answer-mcp.png') });
  });

  // -------------------------------------------------------------------------
  // 操作 3：提交后历史记录新增一条，最新记录在最上方
  // -------------------------------------------------------------------------
  test('提交后历史记录新增且最新在最上方', async ({ page }) => {
    const question = '什么是MCP？';

    await page.goto(BASE_URL, { waitUntil: 'load' });

    // 初始无历史记录
    const historyItems = page.getByTestId('history-item');
    await expect(historyItems).toHaveCount(0);

    // 提交问题
    await page.getByTestId('ask-input').fill(question);
    await page.getByTestId('ask-button').click();
    await waitForAnswer(page);

    // 历史列表新增 1 条，且内容包含本次提问
    await expect(historyItems).toHaveCount(1);
    await expect(historyItems.first()).toContainText(question);

    // 截图：历史列表区域
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '03-history.png'), fullPage: true });
  });
});
