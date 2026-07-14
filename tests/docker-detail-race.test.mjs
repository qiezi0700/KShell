import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(
  new URL('../src/components/docker/DockerTabView.vue', import.meta.url),
  'utf8',
)

test('Docker 详情与编辑请求使用独立代次守卫', () => {
  for (const name of [
    'rawInspectGuard',
    'containerInspectGuard',
    'recreateGuard',
    'cloneGuard',
    'editGuard',
    'imageInspectGuard',
  ]) {
    assert.match(source, new RegExp(`const ${name} = new LatestOperationGuard\\(\\)`))
    assert.match(source, new RegExp(`${name}\\.begin\\(\\)`))
    assert.match(source, new RegExp(`${name}\\.isCurrent\\(`))
  }
})

test('关闭详情弹窗时主动使未完成请求失效', () => {
  assert.match(source, /function closeRawInspect\([\s\S]*rawInspectGuard\.invalidate\(\)/)
  assert.match(source, /function closeContainerInspect\([\s\S]*containerInspectGuard\.invalidate\(\)/)
  assert.match(source, /function closeImageInspect\([\s\S]*imageInspectGuard\.invalidate\(\)/)
  assert.match(source, /@update:open="onRawInspectOpenChange"/)
  assert.match(source, /@update:open="onContainerInspectOpenChange"/)
  assert.match(source, /@update:open="onImageInspectOpenChange"/)
})
