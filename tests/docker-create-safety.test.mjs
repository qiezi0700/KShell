import assert from 'node:assert/strict'
import test from 'node:test'

import { createContainerTransaction } from '../src/components/docker/create-container.ts'

function createOperations(overrides = {}) {
  const calls = []
  const operations = {
    async run() {
      calls.push('run')
      return 'new-id'
    },
    async exists(container) {
      calls.push(`exists:${container}`)
      return false
    },
    async connectNetwork(network, container) {
      calls.push(`network:${network}->${container}`)
    },
    async remove(container, force) {
      calls.push(`remove:${container}:${force}`)
    },
    ...overrides,
  }
  return { calls, operations }
}

test('新建容器及全部附加网络成功后才提交事务', async () => {
  const { calls, operations } = createOperations()

  const target = await createContainerTransaction(
    { additionalNetworks: ['backend', 'metrics'] },
    operations,
  )

  assert.equal(target, 'new-id')
  assert.deepEqual(calls, [
    'run',
    'network:backend->new-id',
    'network:metrics->new-id',
  ])
})

test('附加网络失败时删除已创建的容器', async () => {
  const { calls, operations } = createOperations({
    async connectNetwork(network, container) {
      calls.push(`network:${network}->${container}`)
      throw new Error('网络不存在')
    },
  })

  await assert.rejects(
    createContainerTransaction({ targetName: 'app', additionalNetworks: ['backend'] }, operations),
    /网络不存在/,
  )
  assert.deepEqual(calls, [
    'run',
    'network:backend->app',
    'remove:app:true',
  ])
})

test('docker run 失败并留下具名容器时清理残留', async () => {
  const { calls, operations } = createOperations({
    async run() {
      calls.push('run')
      throw new Error('启动失败')
    },
    async exists(container) {
      calls.push(`exists:${container}`)
      return true
    },
  })

  await assert.rejects(
    createContainerTransaction({ targetName: 'app', additionalNetworks: [] }, operations),
    /启动失败/,
  )
  assert.deepEqual(calls, ['run', 'exists:app', 'remove:app:true'])
})

test('回滚失败时同时报告原错误与清理错误', async () => {
  const { operations } = createOperations({
    async connectNetwork() {
      throw new Error('网络失败')
    },
    async remove() {
      throw new Error('删除失败')
    },
  })

  await assert.rejects(
    createContainerTransaction({ additionalNetworks: ['backend'] }, operations),
    (error) => {
      assert.match(String(error), /网络失败/)
      assert.match(String(error), /删除失败/)
      return true
    },
  )
})
