import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const [apiSource, dialogSource] = await Promise.all([
  readFile(new URL('../src/api/docker.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/docker/DockerRunDialog.vue', import.meta.url), 'utf8'),
])

test('inspect 和运行规格保留常用高级运行配置', () => {
  for (const field of ['privileged', 'capAdd', 'capDrop', 'dns', 'devices']) {
    const declarations = apiSource.match(new RegExp(`\\b${field}[?]?:`, 'g')) ?? []
    assert.ok(declarations.length >= 2, `${field} 应同时存在于 inspect 和运行规格`)
  }
  assert.match(apiSource, /privileged:\s*host\.Privileged === true/)
  assert.match(apiSource, /capAdd:\s*stringArray\(host\.CapAdd\)/)
  assert.match(apiSource, /capDrop:\s*stringArray\(host\.CapDrop\)/)
  assert.match(apiSource, /dns:\s*stringArray\(host\.Dns\)/)
  assert.match(apiSource, /devices:\s*parseDevices\(host\.Devices\)/)
})

test('重建规格和表单无损透传高级运行配置', () => {
  assert.match(apiSource, /privileged: i\.privileged/)
  assert.match(apiSource, /capAdd: \[\.\.\.i\.capAdd\]/)
  assert.match(apiSource, /capDrop: \[\.\.\.i\.capDrop\]/)
  assert.match(apiSource, /dns: \[\.\.\.i\.dns\]/)
  assert.match(apiSource, /devices: i\.devices\.map/)
  assert.match(dialogSource, /privileged:\s*spec\.privileged/)
  assert.match(dialogSource, /capAdd:\s*\[\.\.\.spec\.capAdd\]/)
  assert.match(dialogSource, /capDrop:\s*\[\.\.\.spec\.capDrop\]/)
  assert.match(dialogSource, /dns:\s*\[\.\.\.spec\.dns\]/)
  assert.match(dialogSource, /devices:\s*spec\.devices\.map/)
  assert.match(dialogSource, /privileged:\s*form\.privileged/)
  assert.doesNotMatch(dialogSource, /高级运行时字段不会保留/)
})

test('docker run 参数数组无损还原高级运行参数', () => {
  assert.match(apiSource, /if \(s\.privileged\) parts\.push\('--privileged'\)/)
  assert.match(apiSource, /parts\.push\('--cap-add', capability\)/)
  assert.match(apiSource, /parts\.push\('--cap-drop', capability\)/)
  assert.match(apiSource, /parts\.push\('--dns', server\)/)
  assert.match(apiSource, /parts\.push\('--device', `\$\{device\.hostPath\}/)
  assert.match(apiSource, /dockerExec\(sessionId, buildRunArgsFromSpec\(spec\)\)/)
})
