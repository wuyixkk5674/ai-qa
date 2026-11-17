import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { server } = require('../../src/server.js')

let baseUrl
let app

beforeAll(async () => {
  // 先关掉默认的 3000 监听
  await new Promise((resolve) => server.close(() => resolve()))
  
  // 随机分配一个可用端口启动
  await new Promise((resolve) => {
    server.listen(0, () => {
      const port = server.address().port
      baseUrl = `http://127.0.0.1:${port}`
      app = request(baseUrl)
      resolve()
    })
  })
})

afterAll(async () => {
  await new Promise((resolve) => server.close(() => resolve()))
})

describe('集成测试 POST /api/ask + GET /api/records', () => {
  it('正常提问后，records接口可以查到这条记录', async () => {
    const questionText = "测试集成测试链路"
    const askRes = await app
      .post('/api/ask')
      .send({ question: questionText })
    expect(askRes.statusCode).toBe(200)

    const historyRes = await app.get('/api/records')
    expect(historyRes.statusCode).toBe(200)
    // 从body里取出records数组
    const list = historyRes.body.records
    const exist = list.some(item => item.question === questionText)
    expect(exist).toBe(true)
  })

  it('传入空问题，接口返回400状态码', async () => {
    const res = await app
      .post('/api/ask')
      .send({ question: "" })
    expect(res.statusCode).toBe(400)
  })
})