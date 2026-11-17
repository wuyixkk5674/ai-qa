import { describe, it, expect } from 'vitest'
import request from 'supertest'
const baseUrl = 'http://127.0.0.1:3000'

describe('集成测试 POST /api/ask + GET /api/records', () => {
  it('正常提问后，records接口可以查到这条记录', async () => {
    const questionText = "测试集成测试链路"
    const askRes = await request(baseUrl)
      .post('/api/ask')
      .send({ question: questionText })
    expect(askRes.statusCode).toBe(200)

    const historyRes = await request(baseUrl).get('/api/records')
    expect(historyRes.statusCode).toBe(200)
    // 从body里取出records数组
    const list = historyRes.body.records
    const exist = list.some(item => item.question === questionText)
    expect(exist).toBe(true)
  })

  it('传入空问题，接口返回400状态码', async () => {
    const res = await request(baseUrl)
      .post('/api/ask')
      .send({ question: "" })
    expect(res.statusCode).toBe(400)
  })
})
