export type ComposeStackAction = 'up' | 'down' | 'restart'

export interface ComposeStackCommandInput {
  name: string
  configFiles: string
}

const STACK_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/
const COMPOSE_PATH_RE = /^\/[a-zA-Z0-9/_.:@#+=-]+$/

function validateStackName(name: string): void {
  if (!name || !STACK_NAME_RE.test(name)) {
    throw new Error(`Stack 名不合法: ${name}`)
  }
}

export function validateComposePath(path: string): void {
  if (!COMPOSE_PATH_RE.test(path)) {
    throw new Error(`compose 文件路径不合法(需绝对路径): ${path}`)
  }
}

function parseConfigFiles(configFiles: string): string[] {
  const paths = configFiles
    .split(',')
    .map((path) => path.trim())
    .filter(Boolean)
  if (paths.length === 0) {
    throw new Error('缺少 compose 配置文件')
  }
  for (const path of paths) validateComposePath(path)
  return paths
}

export function buildComposeStackCommand(
  stack: ComposeStackCommandInput,
  action: ComposeStackAction,
): string {
  validateStackName(stack.name)
  const parts = ['docker', 'compose', '-p', stack.name]
  for (const configPath of parseConfigFiles(stack.configFiles)) {
    parts.push('-f', configPath)
  }
  parts.push(action)
  if (action === 'up') parts.push('-d')
  parts.push('2>&1')
  return parts.join(' ')
}
