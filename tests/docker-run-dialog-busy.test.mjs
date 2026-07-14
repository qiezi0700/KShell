import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(
  new URL('../src/components/docker/DockerRunDialog.vue', import.meta.url),
  'utf8',
)

test('执行期间不能通过关闭重开重置 busy 状态', () => {
  const openWatcher = source.match(/watch\([\s\S]*?\n\)/)?.[0] ?? ''
  assert.doesNotMatch(openWatcher, /busy\.value\s*=\s*false/)
  assert.match(source, /function handleOpenChange\(nextOpen: boolean\)[\s\S]*if \(!nextOpen && busy\.value\) return/)
  assert.match(source, /<Dialog :open="open" @update:open="handleOpenChange">/)
})

test('取消按钮统一走受保护的关闭入口', () => {
  assert.match(source, /@click="handleOpenChange\(false\)">取消<\/Button>/)
  assert.doesNotMatch(source, /@click="emit\('update:open', false\)">取消<\/Button>/)
})
