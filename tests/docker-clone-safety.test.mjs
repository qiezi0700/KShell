import assert from 'node:assert/strict'
import test from 'node:test'

import { cloneContainerTransaction } from '../src/components/docker/clone-container.ts'

const plan = {
  image: 'example/app:latest',
  originalName: 'app',
  targetName: 'app-clone',
  shouldPullImage: true,
  shouldStopOriginal: true,
}

function createOperations(overrides = {}) {
  const calls = []
  const operations = {
    async exists(container) {
      calls.push(`exists:${container}`)
      return false
    },
    async pull(image) {
      calls.push(`pull:${image}`)
    },
    async inspectState(container) {
      calls.push(`inspect:${container}`)
      return 'running'
    },
    async stop(container) {
      calls.push(`stop:${container}`)
    },
    async run() {
      calls.push('run')
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

test('克隆成功时按选项停止并保留原容器', async () => {
  const { calls, operations } = createOperations()

  await cloneContainerTransaction(plan, operations)

  assert.deepEqual(calls, [
    'exists:app-clone',
    'pull:example/app:latest',
    'inspect:app',
    'stop:app',
    'run',
  ])
})

test('克隆创建失败时重新启动被停止的原容器', async () => {
  const { calls, operations } = createOperations({
    async run() {
      calls.push('run')
      throw new Error('创建失败')
    },
  })

  await assert.rejects(cloneContainerTransaction(plan, operations), /创建失败/)
  assert.deepEqual(calls, [
    'exists:app-clone',
    'pull:example/app:latest',
    'inspect:app',
    'stop:app',
    'run',
    'exists:app-clone',
    'start:app',
  ])
})

test('克隆失败并残留新容器时先清理残留再恢复原容器', async () => {
  let existsCount = 0
  const { calls, operations } = createOperations({
    async exists(container) {
      calls.push(`exists:${container}`)
      existsCount += 1
      return existsCount > 1
    },
    async run() {
      calls.push('run')
      throw new Error('端口冲突')
    },
  })

  await assert.rejects(cloneContainerTransaction(plan, operations), /端口冲突/)
  assert.deepEqual(calls, [
    'exists:app-clone',
    'pull:example/app:latest',
    'inspect:app',
    'stop:app',
    'run',
    'exists:app-clone',
    'remove:app-clone:true',
    'start:app',
  ])
})

test('原容器原本停止时克隆失败后不启动它', async () => {
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

  await assert.rejects(cloneContainerTransaction(plan, operations))
  assert.deepEqual(calls, [
    'exists:app-clone',
    'pull:example/app:latest',
    'inspect:app',
    'run',
    'exists:app-clone',
  ])
})

test('克隆目标名称已存在时不得停止原容器', async () => {
  const { calls, operations } = createOperations({
    async exists(container) {
      calls.push(`exists:${container}`)
      return true
    },
  })

  await assert.rejects(
    cloneContainerTransaction(plan, operations),
    /目标容器名 app-clone 已存在/,
  )
  assert.deepEqual(calls, ['exists:app-clone'])
})

test('不停止原容器时无需读取或恢复原状态', async () => {
  const { calls, operations } = createOperations({
    async run() {
      calls.push('run')
      throw new Error('创建失败')
    },
  })

  await assert.rejects(
    cloneContainerTransaction({ ...plan, shouldStopOriginal: false }, operations),
  )
  assert.deepEqual(calls, [
    'exists:app-clone',
    'pull:example/app:latest',
    'run',
    'exists:app-clone',
  ])
})
