import assert from 'node:assert/strict'
import test from 'node:test'

import { recreateContainerTransaction } from '../src/components/docker/recreate-container.ts'

const plan = {
  image: 'example/app:latest',
  originalName: 'app',
  targetName: 'app',
  backupName: 'kshell-backup-1234',
  additionalNetworks: ['backend'],
}

function createOperations(overrides = {}) {
  const calls = []
  const operations = {
    async pull(image) {
      calls.push(`pull:${image}`)
    },
    async inspectState(container) {
      calls.push(`inspect:${container}`)
      return 'running'
    },
    async exists(container) {
      calls.push(`exists:${container}`)
      return false
    },
    async stop(container) {
      calls.push(`stop:${container}`)
    },
    async rename(container, newName) {
      calls.push(`rename:${container}->${newName}`)
    },
    async run() {
      calls.push('run')
    },
    async connectNetwork(network, container) {
      calls.push(`network:${network}->${container}`)
    },
    async remove(container, force) {
      calls.push(`remove:${container}:${force}`)
    },
    async start(container) {
      calls.push(`start:${container}`)
    },
    ...overrides,
  }
  return { calls, operations }
}

test('重建成功后才删除旧容器备份', async () => {
  const { calls, operations } = createOperations()

  const result = await recreateContainerTransaction(plan, operations)

  assert.deepEqual(calls, [
    'pull:example/app:latest',
    'inspect:app',
    'stop:app',
    'rename:app->kshell-backup-1234',
    'run',
    'network:backend->app',
    'remove:kshell-backup-1234:false',
  ])
  assert.equal(result.backupCleanupWarning, null)
})

test('新容器创建失败时恢复旧名称并重新启动原容器', async () => {
  const { calls, operations } = createOperations({
    async run() {
      calls.push('run')
      throw new Error('创建失败')
    },
  })

  await assert.rejects(
    recreateContainerTransaction(plan, operations),
    /创建失败/,
  )
  assert.deepEqual(calls, [
    'pull:example/app:latest',
    'inspect:app',
    'stop:app',
    'rename:app->kshell-backup-1234',
    'run',
    'exists:app',
    'rename:kshell-backup-1234->app',
    'start:app',
  ])
})

test('附加网络失败时删除新容器并恢复原容器', async () => {
  const { calls, operations } = createOperations({
    async connectNetwork(network, container) {
      calls.push(`network:${network}->${container}`)
      throw new Error('网络不存在')
    },
  })

  await assert.rejects(
    recreateContainerTransaction(plan, operations),
    /网络不存在/,
  )
  assert.deepEqual(calls, [
    'pull:example/app:latest',
    'inspect:app',
    'stop:app',
    'rename:app->kshell-backup-1234',
    'run',
    'network:backend->app',
    'remove:app:true',
    'rename:kshell-backup-1234->app',
    'start:app',
  ])
})

test('原容器原本停止时回滚后保持停止', async () => {
  const { calls, operations } = createOperations({
    async inspectState(container) {
      calls.push(`inspect:${container}`)
      return 'exited'
    },
    async run() {
      calls.push('run')
      throw new Error('创建失败')
    },
  })

  await assert.rejects(recreateContainerTransaction(plan, operations))
  assert.deepEqual(calls, [
    'pull:example/app:latest',
    'inspect:app',
    'rename:app->kshell-backup-1234',
    'run',
    'exists:app',
    'rename:kshell-backup-1234->app',
  ])
})

test('旧备份清理失败时保留新容器并返回警告', async () => {
  const { calls, operations } = createOperations({
    async remove(container, force) {
      calls.push(`remove:${container}:${force}`)
      throw new Error('备份删除失败')
    },
  })

  const result = await recreateContainerTransaction(plan, operations)

  assert.match(result.backupCleanupWarning ?? '', /备份删除失败/)
  assert.equal(calls.includes('remove:app:true'), false)
  assert.equal(calls.includes('rename:kshell-backup-1234->app'), false)
})

test('回滚失败时同时报告原始错误和回滚错误', async () => {
  const { calls, operations } = createOperations({
    async run() {
      calls.push('run')
      throw new Error('创建失败')
    },
    async rename(container, newName) {
      calls.push(`rename:${container}->${newName}`)
      if (container === plan.backupName) throw new Error('名称恢复失败')
    },
  })

  await assert.rejects(
    recreateContainerTransaction(plan, operations),
    (error) => {
      assert.match(String(error), /创建失败/)
      assert.match(String(error), /名称恢复失败/)
      return true
    },
  )
})


test('docker run 失败但残留新容器时先删除残留再恢复', async () => {
  const { calls, operations } = createOperations({
    async run() {
      calls.push('run')
      throw new Error('端口已被占用')
    },
    async exists(container) {
      calls.push(`exists:${container}`)
      return true
    },
  })

  await assert.rejects(
    recreateContainerTransaction(plan, operations),
    /端口已被占用/,
  )
  assert.deepEqual(calls, [
    'pull:example/app:latest',
    'inspect:app',
    'stop:app',
    'rename:app->kshell-backup-1234',
    'run',
    'exists:app',
    'remove:app:true',
    'rename:kshell-backup-1234->app',
    'start:app',
  ])
})

test('目标名称已被其他容器占用时不得停止原容器', async () => {
  const renamedPlan = { ...plan, targetName: 'app-v2' }
  const { calls, operations } = createOperations({
    async exists(container) {
      calls.push(`exists:${container}`)
      return container === 'app-v2'
    },
  })

  await assert.rejects(
    recreateContainerTransaction(renamedPlan, operations),
    /目标容器名 app-v2 已存在/,
  )
  assert.deepEqual(calls, [
    'pull:example/app:latest',
    'inspect:app',
    'exists:app-v2',
  ])
})
