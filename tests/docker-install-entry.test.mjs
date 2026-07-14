import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(
  new URL('../src/stores/session-actions.ts', import.meta.url),
  'utf8',
)

const dockerAction = source.slice(
  source.indexOf("id: 'open-docker'"),
  source.indexOf("\n})", source.indexOf("id: 'open-docker'")) + 3,
)

test('Docker 未安装时仍创建标签页以暴露安装入口', () => {
  assert.match(dockerAction, /connectSession\(s\)/)
  assert.match(dockerAction, /addTab\(\{/)
  assert.doesNotMatch(dockerAction, /dockerAvailable\(/)
  assert.doesNotMatch(dockerAction, /sshDisconnect\(/)
})
