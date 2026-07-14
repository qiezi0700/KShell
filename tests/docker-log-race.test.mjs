import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { LatestOperationGuard } from '../src/components/docker/latest-operation-guard.ts'

const dialogSource = await readFile(
  new URL('../src/components/docker/DockerLogDialog.vue', import.meta.url),
  'utf8',
)

test('新操作开始后旧异步结果立即失效', () => {
  const guard = new LatestOperationGuard()
  const first = guard.begin()
  const second = guard.begin()

  assert.equal(guard.isCurrent(first), false)
  assert.equal(guard.isCurrent(second), true)
})

test('关闭弹窗时可主动使当前操作失效', () => {
  const guard = new LatestOperationGuard()
  const current = guard.begin()

  guard.invalidate()

  assert.equal(guard.isCurrent(current), false)
})

test('日志弹窗分别隔离拉取、扫描和流式通道代次', () => {
  assert.match(dialogSource, /const fetchGuard = new LatestOperationGuard\(\)/)
  assert.match(dialogSource, /const scanGuard = new LatestOperationGuard\(\)/)
  assert.match(dialogSource, /const streamGuard = new LatestOperationGuard\(\)/)
  assert.match(dialogSource, /fetchGuard\.isCurrent\(/)
  assert.match(dialogSource, /scanGuard\.isCurrent\(/)
  assert.match(dialogSource, /streamGuard\.isCurrent\(/)
})
