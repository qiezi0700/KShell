import assert from 'node:assert/strict'
import test from 'node:test'

import { validateDockerPortMapping } from '../src/api/docker-run-validation.ts'

test('接受有效的 Docker 端口映射', () => {
  assert.doesNotThrow(() => validateDockerPortMapping('8080', '80'))
  assert.doesNotThrow(() => validateDockerPortMapping('127.0.0.1:65535', '53/udp'))
  assert.doesNotThrow(() => validateDockerPortMapping('0.0.0.0:443', '443/tcp'))
})

test('拒绝越界端口', () => {
  assert.throws(() => validateDockerPortMapping('0', '80'), /宿主端口需在 1-65535 之间/)
  assert.throws(() => validateDockerPortMapping('65536', '80'), /宿主端口需在 1-65535 之间/)
  assert.throws(() => validateDockerPortMapping('8080', '0'), /容器端口需在 1-65535 之间/)
  assert.throws(() => validateDockerPortMapping('8080', '65536/tcp'), /容器端口需在 1-65535 之间/)
})

test('拒绝越界 IPv4 地址和非法协议', () => {
  assert.throws(() => validateDockerPortMapping('256.0.0.1:8080', '80'), /宿主 IP 不合法/)
  assert.throws(() => validateDockerPortMapping('127.0.0.1:8080', '80/http'), /容器端口不合法/)
})
