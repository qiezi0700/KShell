import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(
  new URL('../src/components/docker/DockerRunDialog.vue', import.meta.url),
  'utf8',
)

test('附加网络必须通过安全 Docker API 执行', () => {
  assert.doesNotMatch(
    source,
    /sshExec\([\s\S]{0,180}`docker network connect\s+\$\{net\}/,
    'Docker 组件不得把网络名直接拼接到 SSH 命令中',
  )
  assert.match(source, /dockerNetworkConnect\s*\(/)
})
