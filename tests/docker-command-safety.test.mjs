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
    /sshExec\([\s\S]{0,180}\`docker network connect\s+\$\{net\}/,
    'Docker 组件不得把网络名直接拼接到 SSH 命令中',
  )
  assert.match(source, /dockerNetworkConnect\s*\(/)
})

test('容器重建必须通过事务编排并保留失败回滚', () => {
  assert.match(source, /recreateContainerTransaction\s*\(/)
  assert.match(source, /dockerContainerExists\s*\(/)
  assert.doesNotMatch(
    source,
    /sshExec\([\s\S]{0,180}\`docker rm\s+\$\{originalName\}/,
    '重建流程不得在新容器就绪前直接删除原容器',
  )
})

test('容器克隆必须通过失败恢复编排执行', () => {
  assert.equal(source.includes('cloneContainerTransaction('), true)
  assert.equal(source.includes('docker stop ${origName}'), false)
  assert.equal(source.includes('${runCmd} 2>&1'), false)
})
