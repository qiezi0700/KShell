import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const [dockerSource, dockerExecSource, dockerCommandSource, sshApiSource, commandSource, libSource] = await Promise.all([
  readFile(new URL('../src/api/docker.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/api/docker-exec.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src-tauri/src/docker/mod.rs', import.meta.url), 'utf8'),
  readFile(new URL('../src/api/ssh.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src-tauri/src/commands.rs', import.meta.url), 'utf8'),
  readFile(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8'),
])

test('SSH 一次性命令支持将敏感输入通过 stdin 独立发送', () => {
  assert.match(sshApiSource, /export async function sshExecWithStdin\(/)
  assert.match(sshApiSource, /invoke<string>\('ssh_exec_with_stdin'/)
  assert.match(commandSource, /pub async fn ssh_exec_with_stdin\(/)
  assert.match(commandSource, /channel\.data\(&stdin\[\.\.\]\)\.await/)
  assert.match(commandSource, /channel\.eof\(\)\.await/)
  assert.match(libSource, /commands::ssh_exec_with_stdin/)
})

test('Docker Registry 密码不再拼入远端命令或环境变量', () => {
  assert.doesNotMatch(dockerSource, /KSHELL_PW/)
  assert.doesNotMatch(dockerSource, /shq\(password\)/)
  assert.match(dockerSource, /dockerExec\(sessionId, arguments_, \{ stdin: password \}\)/)
  assert.match(dockerExecSource, /TextEncoder\(\)\.encode\(options\.stdin\)/)
  assert.match(dockerCommandSource, /execute_ssh_command\(/)
})

test('Docker 安装 sudo 密码只通过 stdin 发送', () => {
  assert.doesNotMatch(dockerSource, /KSHELL_SUDO_PW/)
  assert.doesNotMatch(dockerSource, /shq\(opts\.sudoPassword\)/)
  assert.match(
    dockerSource,
    /dockerInstallCommand\(opts\)[\s\S]*sshShellExecWithStdin\(sessionId, command, `[\s\S]*opts\.sudoPassword/,
  )
})
