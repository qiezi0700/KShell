import { sshExec } from './ssh'

// ============================================================
// 类型定义
// docker CLI 的 `--format '{{json .}}'` 输出键为 PascalCase(ID / Names / Image…),
// 这里统一归一化为 camelCase,供前端消费。
// ============================================================

export interface DockerContainer {
  id: string
  /** 容器名;docker ps 的 Names 可能多个(/n1,/n2),取首个并去掉 / 前缀 */
  name: string
  image: string
  command: string
  createdAt: string
  status: string
  state: string
  ports: string
  labels: string
}

export interface DockerImage {
  id: string
  repository: string
  tag: string
  digest: string
  createdSince: string
  createdAt: string
  size: string
}

export interface DockerVersion {
  version: string
  apiVersion: string
}

// ============================================================
// 可用性检测
// ============================================================

/** 检测远端是否安装 docker 且当前用户有权限(docker info 成功即算可用) */
export async function dockerAvailable(sessionId: string): Promise<boolean> {
  try {
    const out = await sshExec(sessionId, 'command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1 && echo ok')
    return out.trim() === 'ok'
  } catch {
    return false
  }
}

/** 获取 Docker 服务端版本信息 */
export async function dockerVersion(sessionId: string): Promise<DockerVersion | null> {
  try {
    const out = await sshExec(sessionId, 'docker version --format "{{.Server.Version}}|{{.Server.APIVersion}}" 2>/dev/null')
    const [version, apiVersion] = out.trim().split('|')
    if (!version) return null
    return { version, apiVersion: apiVersion || '' }
  } catch {
    return null
  }
}

// ============================================================
// 容器操作
// ============================================================

// docker 容器 ID / 名称 / 镜像 ID 的合法字符集:字母数字及 -_.
// 这里做白名单校验,作为 shell 字符串拼接场景下命令注入的缓解措施。
// 真正的参数化需在后端单独开 docker 命令,当前仍走 ssh_exec 传整条命令。
const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/

function validateName(name: string, label = '容器标识'): void {
  if (!name || !NAME_RE.test(name)) {
    throw new Error(`${label}不合法: ${name}`)
  }
}

/** 列出所有容器(含已停止) */
export async function dockerListContainers(sessionId: string): Promise<DockerContainer[]> {
  const out = await sshExec(sessionId, "docker ps -a --format '{{json .}}'")
  return parseJsonLines(out).map(normalizeContainer)
}

/** 启动容器 */
export async function dockerStart(sessionId: string, container: string): Promise<void> {
  validateName(container)
  await sshExec(sessionId, `docker start ${container}`)
}

/** 停止容器 */
export async function dockerStop(sessionId: string, container: string): Promise<void> {
  validateName(container)
  await sshExec(sessionId, `docker stop ${container}`)
}

/** 重启容器 */
export async function dockerRestart(sessionId: string, container: string): Promise<void> {
  validateName(container)
  await sshExec(sessionId, `docker restart ${container}`)
}

/** 删除容器(-f 强制) */
export async function dockerRemove(sessionId: string, container: string, force = false): Promise<void> {
  validateName(container)
  await sshExec(sessionId, `docker rm ${force ? '-f ' : ''}${container}`)
}

/** 获取容器日志(最近 tail 行,合并 stdout+stderr) */
export async function dockerLogs(sessionId: string, container: string, tail = 200): Promise<string> {
  validateName(container)
  const n = Math.min(Math.max(Math.floor(tail), 1), 5000)
  return sshExec(sessionId, `docker logs --tail ${n} ${container} 2>&1`)
}

// ============================================================
// 镜像操作
// ============================================================

/** 列出本地镜像 */
export async function dockerListImages(sessionId: string): Promise<DockerImage[]> {
  const out = await sshExec(sessionId, "docker images --format '{{json .}}'")
  return parseJsonLines(out).map(normalizeImage)
}

/** 删除镜像 */
export async function dockerRemoveImage(sessionId: string, imageId: string): Promise<void> {
  validateName(imageId, '镜像标识')
  await sshExec(sessionId, `docker rmi ${imageId}`)
}

// ============================================================
// 解析工具
// ============================================================

/** 逐行解析 JSON 输出(docker --format '{{json .}}' 每行一个 JSON 对象) */
function parseJsonLines(raw: string): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      result.push(JSON.parse(trimmed) as Record<string, unknown>)
    } catch {
      // 跳过无法解析的行(docker 可能在 JSON 之前输出警告)
    }
  }
  return result
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v)
}

/** docker ps 的 Names 形如 "/foo,/bar";取首个并去掉 / 前缀 */
function pickName(raw: string): string {
  return raw.split(',')[0]?.replace(/^\//, '') ?? ''
}

/** 将 docker ps 的 PascalCase JSON 归一化为 DockerContainer */
function normalizeContainer(r: Record<string, unknown>): DockerContainer {
  return {
    id: str(r.ID),
    name: pickName(str(r.Names)),
    image: str(r.Image),
    command: str(r.Command),
    createdAt: str(r.CreatedAt),
    status: str(r.Status),
    state: str(r.State),
    ports: str(r.Ports),
    labels: str(r.Labels),
  }
}

/** 将 docker images 的 PascalCase JSON 归一化为 DockerImage */
function normalizeImage(r: Record<string, unknown>): DockerImage {
  return {
    id: str(r.ID),
    repository: str(r.Repository),
    tag: str(r.Tag),
    digest: str(r.Digest),
    createdSince: str(r.CreatedSince),
    createdAt: str(r.CreatedAt),
    size: str(r.Size),
  }
}
