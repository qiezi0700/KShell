import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(
  new URL('../src/components/docker/DockerContainerEditDialog.vue', import.meta.url),
  'utf8',
)

test('编辑弹窗网络列表使用独立代次守卫', () => {
  assert.match(source, /import \{ LatestOperationGuard \} from '\.\/latest-operation-guard'/)
  assert.match(source, /const networkListGuard = new LatestOperationGuard\(\)/)
  assert.match(source, /\(\) => \[props\.open, props\.inspect, props\.sessionId\] as const/)
  assert.match(source, /async \(\[open, insp, sessionId\]\) => \{\s*const requestVersion = networkListGuard\.begin\(\)/)
  assert.match(
    source,
    /const networks = await dockerListNetworks\(sessionId\)[\s\S]*if \(networkListGuard\.isCurrent\(requestVersion\)\) \{\s*availableNetworks\.value = networks/,
  )
})

test('关闭编辑弹窗时使旧网络列表请求失效', () => {
  assert.match(source, /const requestVersion = networkListGuard\.begin\(\)[\s\S]*if \(!open \|\| !insp\) return/)
})
