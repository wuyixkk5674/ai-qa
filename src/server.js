'use strict';

/**
 * 启动入口：创建原生 HTTP 服务
 *   - 提供 public 目录下的静态页面
 *   - 提供 /api/ask（提问）与 /api/records（历史记录）接口
 * 运行方式：node src/server.js
 */

const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const { handleAsk, handleRecords } = require('./routes/ask');
const { getConfig } = require('./services/llm');

const PORT = Number.parseInt(process.env.PORT || '3000', 10) || 3000;
const PUBLIC_DIR = path.resolve(__dirname, '../public');

// 常见静态资源类型
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * 统一 JSON 响应
 * @param {import('http').ServerResponse} res 响应对象
 * @param {number} status HTTP 状态码
 * @param {object} data 响应数据
 */
function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

/**
 * 返回静态文件
 * @param {import('http').IncomingMessage} req 请求对象
 * @param {import('http').ServerResponse} res 响应对象
 * @param {URL} url 请求地址
 */
async function serveStatic(req, res, url) {
  // 只允许 GET / HEAD 访问静态资源
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { ok: false, error: '不支持的请求方法' });
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    sendJson(res, 400, { ok: false, error: '请求路径不合法' });
    return;
  }

  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.resolve(PUBLIC_DIR, relativePath);

  // 防止 ../ 目录穿越，确保访问的文件始终位于 public 目录内
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(`${PUBLIC_DIR}${path.sep}`)) {
    sendJson(res, 403, { ok: false, error: '禁止访问该路径' });
    return;
  }

  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    sendJson(res, 404, { ok: false, error: '页面或文件不存在' });
    return;
  }

  if (stat.isDirectory()) {
    sendJson(res, 403, { ok: false, error: '禁止访问目录' });
    return;
  }

  const contentType = MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  const content = await fs.readFile(filePath);

  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': content.length,
    'Cache-Control': 'no-cache',
  });
  res.end(req.method === 'HEAD' ? undefined : content);
}

/**
 * 请求分发
 * @param {import('http').IncomingMessage} req 请求对象
 * @param {import('http').ServerResponse} res 响应对象
 */
async function handleRequest(req, res) {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  // 接口：POST /api/ask
  if (url.pathname === '/api/ask') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: '该接口只支持 POST 请求' });
      return;
    }
    await handleAsk(req, res, sendJson);
    return;
  }

  // 接口：GET /api/records
  if (url.pathname === '/api/records') {
    if (req.method !== 'GET') {
      sendJson(res, 405, { ok: false, error: '该接口只支持 GET 请求' });
      return;
    }
    await handleRecords(url, res, sendJson);
    return;
  }

  // 接口：GET /api/status，供前端显示当前运行模式
  if (url.pathname === '/api/status') {
    if (req.method !== 'GET') {
      sendJson(res, 405, { ok: false, error: '该接口只支持 GET 请求' });
      return;
    }
    const config = getConfig();
    sendJson(res, 200, {
      ok: true,
      mode: config.demo ? 'demo' : 'llm',
      model: config.demo ? '演示模式' : config.model,
    });
    return;
  }

  // 未知的接口路径统一返回 JSON 404，避免前端拿到 HTML
  if (url.pathname.startsWith('/api/')) {
    sendJson(res, 404, { ok: false, error: '接口不存在' });
    return;
  }

  // 其余请求走静态资源
  await serveStatic(req, res, url);
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    console.error('[服务器] 未捕获的异常：', error);
    if (!res.headersSent) {
      sendJson(res, 500, { ok: false, error: '服务器内部错误' });
    } else {
      res.end();
    }
  });
});

server.listen(PORT, () => {
  const config = getConfig();
  console.log(`AI 答疑助手已启动：http://localhost:${PORT}`);
  if (config.demo) {
    console.log('未配置 LLM_API_KEY，当前为演示模式，将返回预设回答。');
  } else {
    console.log(`大模型接口：${config.baseUrl}，模型：${config.model}`);
  }
});

// 优雅关闭：进程退出前关闭监听，避免端口占用
function shutdown(signal) {
  console.log(`收到 ${signal}，正在关闭服务……`);
  server.close(() => {
    console.log('服务已关闭。');
    process.exit(0);
  });
  // 兜底：5 秒内仍未关闭则强制退出
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = { server };
