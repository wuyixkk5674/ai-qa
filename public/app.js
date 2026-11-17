'use strict';

// 前端交互逻辑：提交问题、渲染回答与参考资料、展示最近问答记录

const questionInput = document.getElementById('question');
const askBtn = document.getElementById('askBtn');
const clearBtn = document.getElementById('clearBtn');
const refreshBtn = document.getElementById('refreshBtn');
const counter = document.getElementById('counter');
const errorText = document.getElementById('errorText');
const answerCard = document.getElementById('answerCard');
const answerBody = document.getElementById('answerBody');
const answerMeta = document.getElementById('answerMeta');
const sourcesBox = document.getElementById('sourcesBox');
const sourcesList = document.getElementById('sourcesList');
const historyList = document.getElementById('historyList');
const modeBadge = document.getElementById('modeBadge');

const MAX_LENGTH = 2000;

/**
 * 更新字数统计
 */
function updateCounter() {
  counter.textContent = `${questionInput.value.length} / ${MAX_LENGTH}`;
}

/**
 * 显示错误提示
 * @param {string} message 错误信息
 */
function showError(message) {
  errorText.textContent = message;
  errorText.hidden = false;
}

/**
 * 隐藏错误提示
 */
function hideError() {
  errorText.hidden = true;
  errorText.textContent = '';
}

/**
 * 渲染当前运行模式
 * @param {{mode: string, model: string}} status 状态信息
 */
function renderMode(status) {
  if (status.mode === 'demo') {
    modeBadge.textContent = '演示模式';
    modeBadge.classList.add('demo');
    modeBadge.title = '未配置 LLM_API_KEY，返回预设回答';
  } else {
    modeBadge.textContent = `在线模型 · ${status.model}`;
    modeBadge.classList.remove('demo');
    modeBadge.title = '正在调用大模型接口';
  }
}

/**
 * 加载服务状态
 */
async function loadStatus() {
  try {
    const response = await fetch('/api/status');
    const data = await response.json();
    if (data.ok) renderMode(data);
  } catch {
    modeBadge.textContent = '状态未知';
  }
}

/**
 * 渲染最近问答记录
 */
async function loadHistory() {
  try {
    const response = await fetch('/api/records?limit=10');
    const data = await response.json();
    if (!data.ok) throw new Error(data.error || '读取记录失败');

    historyList.innerHTML = '';
    if (!data.records.length) {
      const empty = document.createElement('li');
      empty.className = 'history-empty';
      empty.textContent = '暂无记录';
      historyList.appendChild(empty);
      return;
    }

    // 最新的记录排在最前面
    for (const record of data.records.slice().reverse()) {
      const item = document.createElement('li');
      item.setAttribute('data-testid', 'history-item');

      const question = document.createElement('div');
      question.className = 'history-q';
      question.textContent = record.question;

      const answer = document.createElement('div');
      answer.className = 'history-a';
      answer.textContent = record.answer;

      const time = document.createElement('div');
      time.className = 'history-time';
      time.textContent = new Date(record.createdAt).toLocaleString('zh-CN');

      item.appendChild(question);
      item.appendChild(answer);
      item.appendChild(time);
      historyList.appendChild(item);
    }
  } catch (error) {
    historyList.innerHTML = '';
    const empty = document.createElement('li');
    empty.className = 'history-empty';
    empty.textContent = `记录加载失败：${error.message}`;
    historyList.appendChild(empty);
  }
}

/**
 * 渲染回答内容
 * @param {{answer: string, mode: string, model: string, durationMs: number, sources: Array}} data 接口返回数据
 */
function renderAnswer(data) {
  answerCard.hidden = false;
  answerBody.classList.remove('loading');
  answerBody.textContent = data.answer;

  const modeLabel = data.mode === 'demo' ? '演示模式' : data.model;
  answerMeta.textContent = `${modeLabel} · 耗时 ${data.durationMs} 毫秒`;

  sourcesList.innerHTML = '';
  if (data.sources && data.sources.length > 0) {
    sourcesBox.hidden = false;
    for (const source of data.sources) {
      const tag = document.createElement('span');
      tag.className = 'source-tag';
      tag.textContent = `${source.title}（相关度 ${source.score}）`;
      sourcesList.appendChild(tag);
    }
  } else {
    sourcesBox.hidden = true;
  }
}

/**
 * 提交问题
 */
async function askQuestion() {
  const question = questionInput.value.trim();
  hideError();

  if (!question) {
    showError('请先输入问题');
    questionInput.focus();
    return;
  }

  askBtn.disabled = true;
  askBtn.textContent = '思考中…';
  answerCard.hidden = false;
  answerBody.classList.add('loading');
  answerBody.textContent = '正在检索课程资料并生成回答，请稍候…';
  answerMeta.textContent = '';
  sourcesBox.hidden = true;

  try {
    const response = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    });

    const data = await response.json().catch(() => ({
      ok: false,
      error: '服务器返回了无法解析的内容',
    }));

    if (!response.ok || !data.ok) {
      throw new Error(data.error || `请求失败（HTTP ${response.status}）`);
    }

    renderAnswer(data);
    loadHistory();
  } catch (error) {
    answerCard.hidden = true;
    showError(error.message || '请求失败，请稍后重试');
  } finally {
    askBtn.disabled = false;
    askBtn.textContent = '提交提问';
  }
}

askBtn.addEventListener('click', askQuestion);

clearBtn.addEventListener('click', () => {
  questionInput.value = '';
  updateCounter();
  hideError();
  answerCard.hidden = true;
  questionInput.focus();
});

refreshBtn.addEventListener('click', loadHistory);

questionInput.addEventListener('input', updateCounter);

// 支持 Ctrl + Enter（macOS 为 Command + Enter）快捷提交
questionInput.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    askQuestion();
  }
});

updateCounter();
loadStatus();
loadHistory();
