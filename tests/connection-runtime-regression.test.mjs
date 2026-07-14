import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { parseDockerProbeOutput } from '../src/api/docker-probe.ts'

const dockerStoreSource = await readFile(new URL('../src/stores/docker.ts', import.meta.url), 'utf8')
const dockerContainersSource = await readFile(
  new URL('../src/components/docker/DockerContainers.vue', import.meta.url),
  'utf8',
)
const sftpViewSource = await readFile(
  new URL('../src/components/sftp/SftpView.vue', import.meta.url),
  'utf8',
)
const sftpCommandsSource = await readFile(
  new URL('../src-tauri/src/sftp/commands.rs', import.meta.url),
  'utf8',
)

test('Docker 探测区分未安装、不可用和可用', () => {
  assert.deepEqual(parseDockerProbeOutput('__KSHELL_DOCKER__:missing\n'), {
    installed: false,
    available: false,
    message: '远端未安装 Docker',
    version: null,
  })
  assert.deepEqual(parseDockerProbeOutput('__KSHELL_DOCKER__:unusable\npermission denied\n'), {
    installed: true,
    available: false,
    message: 'permission denied',
    version: null,
  })
  assert.deepEqual(parseDockerProbeOutput('登录提示\n__KSHELL_DOCKER__:ready|27.5.1|1.47\n'), {
    installed: true,
    available: true,
    message: '',
    version: { version: '27.5.1', apiVersion: '1.47' },
  })
})

test('Docker 仅在明确未安装时展示安装入口并限制轮询并发', () => {
  assert.match(dockerContainersSource, /v-if="installed === false"/)
  const batches = [...dockerStoreSource.matchAll(/Promise\.allSettled\(\[([\s\S]*?)\]\)/g)]
    .map((match) => (match[1]?.match(/dockerList\w+\(sessionId\)/g) ?? []).length)
    .filter(Boolean)
  assert.deepEqual(batches, [2, 2, 1])
})

test('SFTP 共享底层会话并阻止卸载后的旧请求回写', () => {
  assert.match(sftpCommandsSource, /shared_sftp_sessions/)
  assert.match(sftpCommandsSource, /has_other_lease/)
  assert.match(sftpViewSource, /if \(isUnmounted\) \{\s*closeSftpLease\(openedId\)/)
  assert.match(sftpViewSource, /onBeforeUnmount\(\(\) => \{\s*isUnmounted = true/)
})
