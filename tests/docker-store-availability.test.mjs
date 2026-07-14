import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { isDockerPollAvailable } from '../src/stores/docker-poll-result.ts'

const storeSource = await readFile(
  new URL('../src/stores/docker.ts', import.meta.url),
  'utf8',
)

test('全部 Docker 资源请求失败时判定为不可用', () => {
  const results = [
    { status: 'rejected', reason: new Error('容器失败') },
    { status: 'rejected', reason: new Error('镜像失败') },
  ]

  assert.equal(isDockerPollAvailable(results), false)
})

test('任一 Docker 资源请求成功时判定为可用', () => {
  const results = [
    { status: 'rejected', reason: new Error('容器失败') },
    { status: 'fulfilled', value: [] },
  ]

  assert.equal(isDockerPollAvailable(results), true)
})

test('Docker store 每轮都覆盖 available 状态', () => {
  assert.match(storeSource, /available: pollAvailable/)
  assert.doesNotMatch(storeSource, /if \(anyOk\) patch\(sessionId, \{ available: true/)
})
