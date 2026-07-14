import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { editContainerTransaction } from '../src/components/docker/edit-container.ts'

const plan = {
  originalName: 'app',
  targetName: 'app-v2',
  nextUpdate: { memory: '2g', cpus: '2', restart: 'always' },
  previousUpdate: { memory: '1g', cpus: '1', restart: 'no' },
  disconnectNetworks: ['old-net'],
  connectNetworks: ['new-a', 'new-b'],
}

function createOperations(overrides = {}) {
  const calls = []
  const operations = {
    async rename(container, newName) {
      calls.push(`rename:${container}->${newName}`)
    },
    async update(container, options) {
      calls.push(`update:${container}:${JSON.stringify(options)}`)
    },
    async disconnectNetwork(network, container) {
      calls.push(`disconnect:${network}:${container}`)
    },
    async connectNetwork(network, container) {
      calls.push(`connect:${network}:${container}`)
    },
    ...overrides,
  }
  return { calls, operations }
}

test('容器编辑成功时按改名、资源、网络顺序执行', async () => {
  const { calls, operations } = createOperations()

  await editContainerTransaction(plan, operations)

  assert.deepEqual(calls, [
    'rename:app->app-v2',
    `update:app-v2:${JSON.stringify(plan.nextUpdate)}`,
    'disconnect:old-net:app-v2',
    'connect:new-a:app-v2',
    'connect:new-b:app-v2',
  ])
})

test('资源更新失败时恢复原资源配置和容器名', async () => {
  let updateCount = 0
  const { calls, operations } = createOperations({
    async update(container, options) {
      updateCount += 1
      calls.push(`update:${container}:${JSON.stringify(options)}`)
      if (updateCount === 1) throw new Error('资源更新失败')
    },
  })

  await assert.rejects(editContainerTransaction(plan, operations), /资源更新失败/)
  assert.deepEqual(calls, [
    'rename:app->app-v2',
    `update:app-v2:${JSON.stringify(plan.nextUpdate)}`,
    `update:app-v2:${JSON.stringify(plan.previousUpdate)}`,
    'rename:app-v2->app',
  ])
})

test('网络连接失败时逆序恢复已变更网络、资源和名称', async () => {
  const { calls, operations } = createOperations({
    async connectNetwork(network, container) {
      calls.push(`connect:${network}:${container}`)
      if (network === 'new-b') throw new Error('网络连接失败')
    },
  })

  await assert.rejects(editContainerTransaction(plan, operations), /网络连接失败/)
  assert.deepEqual(calls, [
    'rename:app->app-v2',
    `update:app-v2:${JSON.stringify(plan.nextUpdate)}`,
    'disconnect:old-net:app-v2',
    'connect:new-a:app-v2',
    'connect:new-b:app-v2',
    'disconnect:new-a:app-v2',
    'connect:old-net:app-v2',
    `update:app-v2:${JSON.stringify(plan.previousUpdate)}`,
    'rename:app-v2->app',
  ])
})

test('回滚失败时同时保留原始错误和补偿错误', async () => {
  let updateCount = 0
  const { operations } = createOperations({
    async update() {
      updateCount += 1
      if (updateCount === 1) throw new Error('资源更新失败')
      throw new Error('资源恢复失败')
    },
    async rename(container) {
      if (container === 'app-v2') throw new Error('名称恢复失败')
    },
  })

  await assert.rejects(
    editContainerTransaction(plan, operations),
    /资源更新失败；自动回滚未完全成功：恢复资源配置失败：资源恢复失败；恢复容器名称失败：名称恢复失败/,
  )
})

const dialogSource = await readFile(
  new URL('../src/components/docker/DockerContainerEditDialog.vue', import.meta.url),
  'utf8',
)

test('编辑弹窗通过事务编排执行并把空资源限制转换为 0', () => {
  assert.match(dialogSource, /import \{ editContainerTransaction \} from '\.\/edit-container'/)
  assert.match(dialogSource, /await editContainerTransaction\(/)
  assert.match(dialogSource, /memory: memoryChanged\.value \? form\.memory\.trim\(\) \|\| '0'/)
  assert.match(dialogSource, /cpus: cpusChanged\.value \? form\.cpus\.trim\(\) \|\| '0'/)
})
