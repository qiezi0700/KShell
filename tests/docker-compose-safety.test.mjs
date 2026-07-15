import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { buildComposeStackArgs } from '../src/api/docker-compose-command.ts'

const dockerSource = await readFile(
  new URL('../src/api/docker.ts', import.meta.url),
  'utf8',
)

const stack = {
  name: 'my-app',
  configFiles: '/srv/my-app/compose.yml,/srv/my-app/compose.prod.yml',
}

test('Compose Stack 参数固定项目名并保留全部配置文件', () => {
  assert.deepEqual(
    buildComposeStackArgs(stack, 'up'),
    ['compose', '-p', 'my-app', '-f', '/srv/my-app/compose.yml', '-f', '/srv/my-app/compose.prod.yml', 'up', '-d'],
  )
  assert.deepEqual(
    buildComposeStackArgs(stack, 'down'),
    ['compose', '-p', 'my-app', '-f', '/srv/my-app/compose.yml', '-f', '/srv/my-app/compose.prod.yml', 'down'],
  )
  assert.deepEqual(
    buildComposeStackArgs(stack, 'restart'),
    ['compose', '-p', 'my-app', '-f', '/srv/my-app/compose.yml', '-f', '/srv/my-app/compose.prod.yml', 'restart'],
  )
})

test('Compose Stack 拒绝空配置文件列表', () => {
  assert.throws(
    () => buildComposeStackArgs({ name: 'my-app', configFiles: ' , ' }, 'down'),
    /缺少 compose 配置文件/,
  )
})

test('Compose Stack 校验每一个配置文件路径', () => {
  assert.throws(
    () => buildComposeStackArgs(
      { name: 'my-app', configFiles: '/srv/compose.yml,/srv/prod.yml;touch /tmp/pwn' },
      'down',
    ),
    /compose 文件路径不合法/,
  )
})

test('Compose Stack 拒绝非法项目名', () => {
  assert.throws(
    () => buildComposeStackArgs(
      { name: 'my-app;touch-pwn', configFiles: '/srv/compose.yml' },
      'down',
    ),
    /Stack 名不合法/,
  )
})


test('Docker API 的 Stack 操作统一使用安全命令生成器', () => {
  assert.equal(dockerSource.includes("buildComposeStackArgs(stack, 'up')"), true)
  assert.equal(dockerSource.includes("buildComposeStackArgs(stack, 'down')"), true)
  assert.equal(dockerSource.includes("buildComposeStackArgs(stack, 'restart')"), true)
  assert.match(dockerSource, /dockerExec\(sessionId, buildComposeStackArgs/)
  assert.equal(dockerSource.includes('firstConfig(stack)'), false)
})
