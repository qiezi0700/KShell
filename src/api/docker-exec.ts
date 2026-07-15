import { invoke } from '@tauri-apps/api/core'

export interface DockerExecOptions {
  stdin?: string
  timeoutMs?: number
}

/** Docker 程序名固定在 Rust 端，所有参数以数组传递并由后端统一编码。 */
export async function dockerExec(
  sessionId: string,
  arguments_: string[],
  options: DockerExecOptions = {},
): Promise<string> {
  const stdin = options.stdin == null
    ? undefined
    : Array.from(new TextEncoder().encode(options.stdin))
  return await invoke<string>('docker_exec', {
    sessionId,
    arguments: arguments_,
    stdin,
    timeoutMs: options.timeoutMs,
  })
}
