import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(
  new URL('../src/components/docker/DockerRunDialog.vue', import.meta.url),
  'utf8',
)

test('容器命令参数以数组形式无损预填和提交', () => {
  assert.match(source, /cmd:\s*string\[\]/)
  assert.match(source, /cmd:\s*\[\.\.\.spec\.cmd\]/)
  assert.match(source, /cmd:\s*\[\.\.\.form\.cmd\]/)
  assert.doesNotMatch(source, /function splitCmd\(/)
})

test('命令参数逐项编辑且允许保留空字符串参数', () => {
  assert.match(source, /v-for="\(_, i\) in form\.cmd"/)
  assert.match(source, /v-model="form\.cmd\[i\]"/)
  assert.match(source, /@click="addCmdArg"/)
  assert.match(source, /@click="delCmdArg\(i\)"/)
  assert.match(source, /每项对应一个 argv 参数/)
})
