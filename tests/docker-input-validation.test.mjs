import assert from 'node:assert/strict'
import test from 'node:test'

import {
  validateDockerCpuLimit,
  validateDockerImageReference,
  validateDockerMemoryLimit,
  validateDockerRegistry,
} from '../src/api/docker-validation.ts'

test('Registry 地址校验端口、主机标签和 IP 语义', () => {
  for (const registry of [
    '',
    'registry.example.com:5000',
    'localhost:5000',
    '10.0.0.8:443/team',
    '[::1]:5000',
    'index.docker.io/v1',
  ]) {
    assert.doesNotThrow(() => validateDockerRegistry(registry), registry)
  }

  for (const registry of [
    'registry.example.com:0',
    'registry.example.com:65536',
    'registry..example.com',
    '-registry.example.com',
    '999.0.0.1:5000',
    'https://registry.example.com',
    'registry.example.com/',
  ]) {
    assert.throws(() => validateDockerRegistry(registry), /registry 地址不合法/, registry)
  }
})

test('内存限制校验最小值、解除限制和数值上界', () => {
  for (const memory of ['6m', '0.5g', '67108864', '1G']) {
    assert.doesNotThrow(() => validateDockerMemoryLimit(memory, false), memory)
  }
  assert.doesNotThrow(() => validateDockerMemoryLimit('0', true))

  for (const memory of ['0', '0.0', '1m', '-1g', '999999999999999999999999g']) {
    assert.throws(() => validateDockerMemoryLimit(memory, false), /内存限制不合法/, memory)
  }
  assert.throws(() => validateDockerMemoryLimit('0.0', true), /内存限制不合法/)
})

test('CPU 限制只接受正数，更新时仅允许精确的 0 解除限制', () => {
  for (const cpus of ['0.001', '1', '1.5']) {
    assert.doesNotThrow(() => validateDockerCpuLimit(cpus, false), cpus)
  }
  assert.doesNotThrow(() => validateDockerCpuLimit('0', true))

  for (const cpus of ['0', '0.0', '-1', '1e3', '999999999999999999999']) {
    assert.throws(() => validateDockerCpuLimit(cpus, false), /CPU 数不合法/, cpus)
  }
  assert.throws(() => validateDockerCpuLimit('0.0', true), /CPU 数不合法/)
})

test('镜像引用不能伪装成 Docker CLI 选项', () => {
  for (const reference of ['nginx:latest', 'registry.example.com/team/app:v1', 'sha256:abcdef']) {
    assert.doesNotThrow(() => validateDockerImageReference(reference), reference)
  }
  for (const reference of ['--help', '-v', '/nginx', 'registry.example.com//app']) {
    assert.throws(() => validateDockerImageReference(reference), /镜像标识不合法/, reference)
  }
})
