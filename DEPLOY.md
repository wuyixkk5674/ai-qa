# AI 答疑助手 · 部署文档

本文档覆盖本地开发启动、Docker 容器部署、环境变量说明，以及一次「人为停止服务」的故障演练。

- 应用：AI 答疑助手（原生 Node.js HTTP 服务，零运行时依赖、无构建步骤）
- 默认端口：`3000`
- 运行入口：`src/server.js`（`npm start`）

---

## 1. 本地开发启动

### 1.1 前置条件

| 项目 | 要求 |
|---|---|
| Node.js | `>= 18`（`package.json` 的 `engines` 约束），推荐 24 |
| npm | 随 Node 安装 |
| 运行时依赖 | **无**，`src/` 只使用 Node 内置模块 |

### 1.2 启动步骤

```bash
# 1) 克隆并进入项目
git clone <仓库地址>
cd ai-qa

# 2) 安装依赖（仅测试需要：vitest / playwright / supertest）
npm install

# 3) 启动服务
npm start
```

启动成功时控制台输出：

```
AI 答疑助手已启动：http://localhost:3000
未配置 LLM_API_KEY，当前为演示模式，将返回预设回答。
```

浏览器访问 <http://localhost:3000> 即可使用。

> 说明：若只运行服务、不跑测试，可跳过 `npm install`——`npm start` 不依赖 `node_modules`。

### 1.3 验证服务

```bash
# 运行模式（demo / llm）
curl http://localhost:3000/api/status

# 提问接口
curl -X POST http://localhost:3000/api/ask \
  -H "Content-Type: application/json" \
  -d '{"question":"什么是MCP？"}'

# 历史记录（默认最近 20 条，可用 ?limit=N）
curl http://localhost:3000/api/records?limit=5
```

`/api/status` 返回示例：`{"ok":true,"mode":"demo","model":"演示模式"}`

### 1.4 修改端口与配置

`PORT` 与 `LLM_*` 均从环境变量读取，不配置时使用默认值：

```bash
# macOS / Linux
PORT=4000 npm start
LLM_API_KEY=sk-xxx LLM_MODEL=gpt-4o-mini npm start

# Windows PowerShell
$env:PORT=4000; npm start
$env:LLM_API_KEY="sk-xxx"; npm start
```

### 1.5 运行测试

```bash
npm test                        # 单元测试 + 接口测试（Vitest）
npx playwright install chromium # 首次运行端到端测试前安装浏览器
npm run test:e2e                # 端到端测试（Playwright 自动拉起服务）
```

`playwright.config.js` 中已配置 `webServer`，执行 `npm run test:e2e` 时会自动启动服务，无需另开终端手动 `npm start`。

---

## 2. Docker 容器部署

### 2.1 构建镜像

```bash
docker build -t aiqa:1.0.0 .
```

构建上下文由 `.dockerignore` 裁剪，仅复制 `package.json`、`src/`、`public/`、`data/`，排除 `node_modules`、`.git`、`tests/`、`e2e/`、`test-results/`、`screenshots/`、`.github/`、`.env` 等。

### 2.2 启动容器

```bash
# 前台运行（Ctrl+C 停止，便于观察日志）
docker run --rm --init -p 3000:3000 --name aiqa aiqa:1.0.0

# 后台运行
docker run -d --init -p 3000:3000 --name aiqa aiqa:1.0.0
```

- `--init`：注入轻量 init 进程作为 PID 1，确保 `docker stop` 的 `SIGTERM` 能正确转发给 Node 进程，触发应用的优雅关闭逻辑。
- `-p 3000:3000`：宿主机 3000 → 容器 3000。
- 容器内以非 root 用户 `node`（uid 1000）运行。

### 2.3 注入环境变量

```bash
docker run -d --init -p 3000:3000 --name aiqa \
  -e LLM_API_KEY=sk-xxx \
  -e LLM_MODEL=gpt-4o-mini \
  -e LLM_BASE_URL=https://api.openai.com/v1 \
  -e LLM_TIMEOUT_MS=30000 \
  aiqa:1.0.0
```

不传 `LLM_API_KEY` 即进入演示模式，完全离线可用。

### 2.4 验证部署

```bash
curl http://localhost:3000/api/status
curl -X POST http://localhost:3000/api/ask -H "Content-Type: application/json" -d '{"question":"什么是机器学习？"}'
```

### 2.5 日常运维命令

```bash
docker ps                      # 查看运行状态（STATUS 应为 Up）
docker logs -f aiqa            # 实时日志
docker exec -it aiqa sh        # 进入容器排查
docker stop aiqa               # 优雅停止
docker start aiqa              # 再次启动
docker rm -f aiqa              # 删除容器
docker rmi aiqa:1.0.0          # 删除镜像
```

### 2.6 记录持久化（可选，注意坑）

默认情况下 `data/qa-records.jsonl` 写在容器内，容器重建后记录丢失。若需保留历史记录，可挂载宿主目录：

```bash
mkdir -p ./runtime-data
cp data/course-notes.md ./runtime-data/     # ⚠️ 必须先把课程资料放进挂载目录

docker run -d --init -p 3000:3000 --name aiqa \
  -v "$(pwd)/runtime-data:/app/data" \
  aiqa:1.0.0
```

**为什么必须复制 `course-notes.md`**：挂载会覆盖镜像内的 `/app/data` 目录。检索服务每次请求都读取 `data/course-notes.md`，文件缺失时 `fs.readFile` 抛 `ENOENT`，`/api/ask` 将返回 `500 服务器内部错误`。若不需要持久化，直接省略 `-v` 参数即可。

Windows PowerShell 中路径写法为 `-v "${PWD}\runtime-data:/app/data"`。

---

## 3. 环境变量说明

配置读取逻辑位于 `src/services/llm.js` 的 `getConfig()`，服务启动时读取一次并打印，每次提问时按当前进程环境重新读取。

| 变量 | 是否必填 | 默认值 | 说明 |
|---|---|---|---|
| `PORT` | 否 | `3000` | HTTP 监听端口。非法值回退为 3000。 |
| `LLM_API_KEY` | 否 | 空 | 大模型接口密钥。**为空时进入演示模式**，不发起任何外网请求，返回基于课程资料拼接的预设回答。 |
| `LLM_BASE_URL` | 否 | `https://api.openai.com/v1` | 兼容 OpenAI 协议的接口基础地址，自动去掉末尾 `/`。可指向自建网关或代理。 |
| `LLM_MODEL` | 否 | `gpt-4o-mini` | 模型名称，直接透传给 `/chat/completions`。 |
| `LLM_TIMEOUT_MS` | 否 | `30000` | 单次大模型调用超时（毫秒），非法或非正数回退为 30000。 |
| `NODE_ENV` | 否 | Dockerfile 内置 `production` | 运行环境标识，应用本身不依赖它做分支判断。 |

补充说明：

- 两个接口限制为代码常量，**不可通过环境变量调整**：问题最大 2000 字符、请求体最大 64 KB。
- `data/course-notes.md` 是运行时读取的课程资料（每次请求重新读取），修改后无需重启；而环境变量在进程启动后修改无效，需重启容器。

常用组合示例：

```bash
# 演示模式（默认，无外网）
docker run -d -p 3000:3000 --name aiqa aiqa:1.0.0

# 接入真实大模型
docker run -d -p 3000:3000 --name aiqa \
  -e LLM_API_KEY=sk-xxx -e LLM_MODEL=gpt-4o-mini -e LLM_TIMEOUT_MS=20000 \
  aiqa:1.0.0
```

---

## 4. 故障演练：人为停止服务

**演练目的**：确认服务停止后能准确识别现象、快速定位、正确恢复，并验证重启后数据与配置一致。

### 4.1 场景 A：Docker 容器被优雅停止

**操作（制造故障）**

```bash
docker stop aiqa
```

**故障现象**

- 浏览器访问 <http://localhost:3000> 显示「无法访问此网站 / ERR_CONNECTION_REFUSED」。
- `curl http://localhost:3000/api/status` 立即失败：`Failed to connect to localhost port 3000`。
- `docker ps` 中不再出现 `aiqa`；`docker ps -a` 显示状态为 `Exited (0)` 或 `Exited (143)`。
- `docker logs aiqa` 末尾出现：

```
收到 SIGTERM，正在关闭服务……
服务已关闭。
```

**排查步骤**

```bash
# 1) 确认容器是否还在运行
docker ps -a --filter name=aiqa

# 2) 查看退出码与退出时间
docker inspect --format '{{.State.Status}} {{.State.ExitCode}} {{.State.FinishedAt}}' aiqa

# 3) 查看最后日志，确认是收到信号正常退出，还是异常崩溃
docker logs --tail 50 aiqa

# 4) 确认端口是否被占用（排除端口冲突的可能）
netstat -ano | findstr :3000     # Windows
ss -lntp | grep 3000             # Linux
```

**根因**

演练中人为执行 `docker stop`，容器收到 `SIGTERM`；应用在 `src/server.js` 注册了 `SIGTERM` 处理函数，先 `server.close()` 停止接收新连接，退出码 0/143 属正常优雅退出。**这不是故障，而是预期行为**——排除掉该原因后，若容器非人为退出且退出码为 `137`，才应怀疑 `OOMKilled` 或外部 `docker kill`。

**恢复操作**

```bash
docker start aiqa
docker ps                      # 确认 STATUS 为 Up
curl http://localhost:3000/api/status
```

启动日志应重新出现 `AI 答疑助手已启动：http://localhost:3000`。若之前通过 `-v` 挂载了数据目录，历史记录会保留；未挂载则容器内记录仍在（`docker start` 复用同一容器），但 `docker rm` 重建后会丢失。

**验证恢复**

1. `/api/status` 返回 `{"ok":true,...}`。
2. 首页可正常打开并展示输入框。
3. 提交一次提问，`/api/records` 能查到新记录。

---

### 4.2 场景 B：容器被强制杀死

**操作（制造故障）**

```bash
docker kill aiqa          # 发送 SIGKILL，不给进程清理机会
```

**故障现象**

- 页面连接被拒绝，与场景 A 表现一致。
- `docker ps -a` 显示 `Exited (137)`。
- `docker logs aiqa` 中**没有**「收到 SIGTERM，正在关闭服务……」这类优雅退出日志。

**排查步骤**

```bash
docker inspect --format '{{.State.ExitCode}} OOMKilled={{.State.OOMKilled}}' aiqa
docker inspect --format '{{.HostConfig.Memory}}' aiqa
docker logs --tail 30 aiqa
```

**根因**

- 演练中执行 `docker kill` → 进程收到 `SIGKILL`，无法执行关闭逻辑，退出码 137（128+9）。
- 若未执行 `docker kill` 却出现 137 且 `OOMKilled=true`，根因是容器内存超限被内核杀死（例如并发大请求）。此时应调高 `--memory` 或排查内存泄漏。

**恢复操作**

```bash
docker start aiqa
docker logs --tail 20 aiqa
```

**数据影响评估**：问答记录采用「写队列 + 追加写」方式，最坏情况是最后一条记录只写入半行。检索侧已对损坏行做容错跳过（`readRecentRecords` 会忽略无法解析的行），因此 137 强杀后 `/api/records` 仍能正常返回，不会整体报错。

---

### 4.3 场景 C：本地开发进程被中断 / 端口被占用

**操作（制造故障）**

```bash
# 方式一：在 npm start 终端按 Ctrl+C
# 方式二：强杀占用 3000 端口的进程（Windows）
netstat -ano | findstr :3000
taskkill /PID <PID> /F
```

**故障现象**

- `http://localhost:3000` 无法访问。
- 若此时再执行 `npm run test:e2e`，Playwright 报错：
  `无法连接 http://localhost:3000，请先执行 npm start 启动服务后再运行本脚本`。
- 若旧进程未完全退出就重新 `npm start`，会看到：

```
Error: listen EADDRINUSE: address already in use :::3000
```

**排查步骤**

```bash
# 1) 确认端口是否被监听
netstat -ano | findstr :3000

# 2) 定位占用进程（Windows）
tasklist /FI "PID eq <PID>"

# 3) 查看是否有残留 node 进程
Get-Process node
```

**根因**

- Ctrl+C 使前台进程退出，端口释放。
- `EADDRINUSE` 的根因是上一个进程仍持有 3000 端口（未退出、或被 `taskkill` 杀掉的子进程残留），并非代码缺陷。

**恢复操作**

```bash
# 1) 清理残留进程（确认 PID 属于本项目后再杀）
taskkill /PID <PID> /F

# 2) 重新启动
npm start

# 3) 验证
curl http://localhost:3000/api/status
```

---

### 4.4 演练记录表

| 场景 | 制造方式 | 关键现象 | 判定退出码/日志 | 恢复命令 | 结果 |
|---|---|---|---|---|---|
| A 优雅停止 | `docker stop aiqa` | 连接被拒绝，`docker ps` 无容器 | `Exited (0/143)`，有「收到 SIGTERM」日志 | `docker start aiqa` | 预期通过 |
| B 强制杀死 | `docker kill aiqa` | 连接被拒绝，`Exited (137)` | 无优雅关闭日志；查 `OOMKilled` | `docker start aiqa` | 预期通过 |
| C 本地中断 | `Ctrl+C` / `taskkill /F` | 页面无法访问；重复启动报 `EADDRINUSE` | 进程不存在 / 端口被占用 | 清理 PID 后 `npm start` | 预期通过 |

### 4.5 快速自检清单

- [ ] `docker ps` 中容器 `STATUS` 为 `Up`，`PORTS` 含 `0.0.0.0:3000->3000/tcp`
- [ ] `curl http://localhost:3000/api/status` 返回 `ok: true`
- [ ] 首页能加载，输入框与提交按钮可见
- [ ] `POST /api/ask` 返回 `ok: true` 且 `answer` 非空
- [ ] `GET /api/records` 能读到刚提交的记录
- [ ] `docker logs` 中无 `未捕获的异常` / `EADDRINUSE`
- [ ] `docker inspect` 的 `ExitCode` 为 `0` 或 `143`（非 `137`）
