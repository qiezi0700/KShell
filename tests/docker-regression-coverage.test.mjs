import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const [
  apiSource,
  runDialogSource,
  registryDialogSource,
  installDialogSource,
  systemDialogSource,
  tabSource,
  containersSource,
] = await Promise.all([
  readFile(new URL('../src/api/docker.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/docker/DockerRunDialog.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/docker/DockerRegistryDialog.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/docker/DockerInstallDialog.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/docker/DockerSystemDialog.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/docker/DockerTabView.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/docker/DockerContainers.vue', import.meta.url), 'utf8'),
])

function functionSource(source, name, nextMarker) {
  const start = source.indexOf(`export async function ${name}`)
  const end = source.indexOf(nextMarker, start)
  return source.slice(start, end < 0 ? undefined : end)
}

test('Registry 列表只提取 auths 的一级 key', () => {
  const source = functionSource(apiSource, 'dockerListRegistries', '// Compose Stack')
  assert.match(source, /f=1;d=1;line=\$0/)
  assert.match(source, /if\(d==1&&match\(\$0/)
  assert.doesNotMatch(source, /f&&d>=1/)
  assert.doesNotMatch(source, /catch[\s\S]*return \[\]/)
})

test('Registry 弹窗隔离列表和动作代次且运行中禁止关闭', () => {
  assert.match(registryDialogSource, /const listGuard = new LatestOperationGuard\(\)/)
  assert.match(registryDialogSource, /const actionGuard = new LatestOperationGuard\(\)/)
  assert.match(registryDialogSource, /\(\) => \[props\.open, props\.sessionId\] as const/)
  assert.match(registryDialogSource, /function handleOpenChange\(nextOpen: boolean\)[\s\S]*if \(!nextOpen && busy\.value\) return/)
  assert.match(registryDialogSource, /<Dialog :open="open" @update:open="handleOpenChange">/)
})

test('安装弹窗运行中不能关闭重开后重复安装', () => {
  const watcher = installDialogSource.match(/watch\([\s\S]*?\n\)/)?.[0] ?? ''
  assert.doesNotMatch(watcher, /busy\.value\s*=\s*false/)
  assert.match(installDialogSource, /function handleOpenChange\(nextOpen: boolean\)[\s\S]*if \(!nextOpen && busy\.value\) return/)
  assert.match(installDialogSource, /<Dialog :open="open" @update:open="handleOpenChange">/)
})

test('新建和克隆都把附加网络纳入事务', () => {
  assert.match(runDialogSource, /createContainerTransaction\s*\(/)
  assert.match(runDialogSource, /additionalNetworks: spec\.additionalNetworks \?\? \[\]/)
  assert.match(runDialogSource, /connectNetwork: async \(network, container\)/)
  assert.doesNotMatch(runDialogSource, /async function attachExtraNetworks/)
})

test('重建保留常用隐藏配置并阻止无法表达的配置', () => {
  for (const field of ['entrypointArgs', 'user', 'tty', 'openStdin', 'readOnlyRootfs', 'networkAttachments', 'recreateSafetyIssues']) {
    assert.match(apiSource, new RegExp(`\\b${field}[?]?:`), field)
  }
  assert.match(apiSource, /detectRecreateSafetyIssues\(/)
  assert.match(tabSource, /if \(insp\.recreateSafetyIssues\.length > 0\)/)
  assert.match(runDialogSource, /entrypoint: \[\.\.\.spec\.entrypoint\]/)
  assert.match(runDialogSource, /labels: \{ \.\.\.spec\.labels \}/)
})

test('Compose 容器通过结构化网络附件重建且克隆会重置身份字段', () => {
  assert.doesNotMatch(apiSource, /'容器由 Compose 管理'/)
  assert.doesNotMatch(apiSource, /'自定义网络别名'/)
  assert.doesNotMatch(apiSource, /'固定网络地址'/)
  for (const option of ['--network-alias', '--ip', '--ip6', '--link-local-ip']) {
    assert.match(apiSource, new RegExp(option), option)
  }
  assert.match(apiSource, /str\(mo\.Type\) === 'volume' \? str\(mo\.Name\)/)
  assert.match(apiSource, /hostname === containerId\.slice\(0, 12\) \? '' : hostname/)
  assert.match(tabSource, /inspectToRunSpec\(insp, 'clone'\)/)
  assert.match(apiSource, /!key\.startsWith\('com\.docker\.compose\.'\)/)
  assert.match(runDialogSource, /spec\.networkAttachments\?\.find/)
})

test('自定义日志驱动与日志参数通过运行规格无损还原', () => {
  assert.doesNotMatch(apiSource, /'自定义日志驱动或日志参数'/)
  assert.match(apiSource, /logDriver: str\(logConfig\.Type\)/)
  assert.match(apiSource, /Object\.entries\(record\(logConfig\.Config\)\)/)
  assert.match(apiSource, /parts\.push\('--log-driver'/)
  assert.match(apiSource, /parts\.push\('--log-opt'/)
  assert.match(runDialogSource, /logOptions: props\.initial\?\.logOptions/)
})

test('Compose 解析和日志扫描不再把错误伪装成空列表', () => {
  const composeSource = functionSource(apiSource, 'dockerListStacks', 'export async function dockerStackUp')
  const scanSource = functionSource(apiSource, 'dockerFindLogFiles', '/** 查询容器详情')
  assert.match(composeSource, /throw new Error\(`Compose 列表解析失败:/)
  assert.doesNotMatch(composeSource, /catch\s*\{\s*return \[\]/)
  assert.match(scanSource, /throw new Error\(`扫描日志文件失败:/)
  assert.doesNotMatch(scanSource, /catch\s*\{[\s\S]*return \[\]/)
})

test('系统弹窗和容器变更操作都有独立 busy/代次保护', () => {
  assert.match(systemDialogSource, /const refreshGuard = new LatestOperationGuard\(\)/)
  assert.match(systemDialogSource, /const pruneGuard = new LatestOperationGuard\(\)/)
  assert.match(systemDialogSource, /\(\) => \[props\.open, props\.sessionId\] as const/)
  assert.match(tabSource, /const containerBusyIds = ref<Set<string>>\(new Set\(\)\)/)
  assert.match(tabSource, /if \(containerBusyIds\.value\.has\(c\.id\)\) return/)
  assert.match(containersSource, /busy: Set<string>/)
  assert.match(containersSource, /:disabled="busy\.has\(c\.id\)"/)
})
