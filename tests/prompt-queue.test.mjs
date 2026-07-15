import assert from 'node:assert/strict'
import test from 'node:test'

import { nextTick } from 'vue'

import {
  confirmState,
  openConfirm,
  resolveConfirm,
} from '../src/stores/prompt.ts'

test('并发确认请求按进入顺序展示且不会覆盖前一个请求', async () => {
  const first = openConfirm({ title: '第一个确认' })
  const second = openConfirm({ title: '第二个确认' })

  assert.equal(confirmState.value?.title, '第一个确认')
  resolveConfirm(true)
  assert.equal(await first, true)

  await nextTick()
  assert.equal(confirmState.value?.title, '第二个确认')
  resolveConfirm(false)
  assert.equal(await second, false)
})
