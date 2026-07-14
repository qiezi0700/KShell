import { buildComposeStackCommand, validateComposePath } from './docker-compose-command'
import { sshExec, sshExecWithStdin } from './ssh'

const DOCKER_QUERY_TIMEOUT_MS = 15_000

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

// docker inspect 取 [0] 后归一化的结构,只保留前端展示需要的字段
export interface DockerInspectPort {
  /** 容器内端口及协议,如 80/tcp */
  container: string
  /** 宿主机绑定地址,如 0.0.0.0:8080;无映射时为空 */
  host: string
}

export interface DockerInspectMount {
  type: string
  source: string
  destination: string
  mode: string
}

/** 单条端口绑定(HostConfig.PortBindings 的权威视图),IPv4/IPv6 双栈时会有两条,重建时会自动去重 */
export interface DockerInspectPortBinding {
  /** 容器内端口及协议,如 80/tcp */
  container: string
  /** 宿主机 IP,如 0.0.0.0 / :: ;空串表示所有接口 */
  hostIp: string
  /** 宿主机端口 */
  hostPort: string
}

export interface DockerDeviceBinding {
  hostPath: string
  containerPath: string
  permissions: string
}

export interface DockerInspect {
  id: string
  name: string
  image: string
  state: string
  createdAt: string
  startedAt: string
  command: string
  entrypoint: string
  ip: string
  networks: string[]
  ports: DockerInspectPort[]
  mounts: DockerInspectMount[]
  env: string[]
  labels: Record<string, string>
  // 下列字段用于容器重建(docker pull + stop + rm + run)时还原原始配置
  /** Config.Cmd 原始数组,重建时作为 image 后的位置参数;command 字段仅供 UI 展示 */
  cmd: string[]
  /** HostConfig.RestartPolicy.Name,如 always / unless-stopped;'no' 或空表示不设 */
  restartPolicy: string
  /** HostConfig.NetworkMode,如 host / bridge / container:xxx;默认时为 default */
  networkMode: string
  /** Config.Hostname;为空表示默认(等于短 ID) */
  hostname: string
  /** Config.WorkingDir;为空表示不指定 */
  workingDir: string
  /** HostConfig.Memory,单位 bytes;0 表示无限制;给编辑弹窗显示 & docker update 默认值 */
  memoryBytes: number
  /** HostConfig.NanoCpus / 1e9,浮点值(如 1.5);0 表示无限制 */
  cpus: number
  /** HostConfig.PortBindings 展开(权威源,补齐 NetworkSettings.Ports 缺失场景) */
  portBindings: DockerInspectPortBinding[]
  privileged: boolean
  capAdd: string[]
  capDrop: string[]
  dns: string[]
  devices: DockerDeviceBinding[]
}

// 镜像详情(docker inspect --type=image)
export interface DockerImageInspect {
  id: string
  repoTags: string[]
  repoDigests: string[]
  created: string
  size: number
  virtualSize: number
  architecture: string
  os: string
  author: string
  cmd: string[]
  entrypoint: string[]
  env: string[]
  workingDir: string
  user: string
  exposedPorts: string[]
  volumes: string[]
  labels: Record<string, string>
}

// docker image history 输出的一层
export interface DockerImageLayer {
  id: string
  created: string
  createdBy: string
  size: string
  comment: string
}

export interface DockerVolume {
  name: string
  driver: string
  scope: string
  mountpoint: string
  labels: string
}

// Compose v2 项目
export interface DockerStack {
  name: string
  /** 例如 "running(2)"、"exited(3)"、"created(1)" */
  status: string
  /** 逗号分隔的 compose 文件绝对路径，执行操作时必须按顺序全部传入 */
  configFiles: string
}

export interface DockerNetwork {
  id: string
  name: string
  driver: string
  scope: string
  labels: string
}

// docker stats --format '{{json .}}' 归一化;CPU/内存等保留 docker 的原始文本便于直接展示
export interface DockerStats {
  /** 容器短 ID,与 docker ps 的 ID 一致,用于回匹配列表 */
  container: string
  name: string
  cpuPercent: string
  memUsage: string
  memPercent: string
  netIo: string
  blockIo: string
  pids: string
}

// ============================================================
// 可用性检测
// ============================================================

/** 检测远端是否安装 docker 且当前用户有权限(docker info 成功即算可用) */
export async function dockerAvailable(sessionId: string): Promise<boolean> {
  try {
    const out = await sshExec(sessionId, 'command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1 && echo ok', DOCKER_QUERY_TIMEOUT_MS)
    return out.trim() === 'ok'
  } catch {
    return false
  }
}

// ============================================================
// Docker 安装(远端主机未装时使用)
// ============================================================

export type DockerInstallMirror = 'official' | 'aliyun' | 'azure' | 'tuna' | 'ustc'

export interface DockerInstallOptions {
  /** 镜像源:official 走 get.docker.com 默认;aliyun/azure 走官方脚本 --mirror 参数;
   * tuna/ustc 走 DOWNLOAD_URL 环境变量覆盖 get.docker.com 下载脚本内的 apt/yum 源。 */
  mirror: DockerInstallMirror
  /** 是否同时把当前用户加入 docker 组(需要 sudo;生效需重新登录会话) */
  addUserToDockerGroup: boolean
  /** sudo 密码(可选);非 root 用户无免密 sudo 时通过 SSH channel stdin 传入。
   * 空串表示远端已配免密 sudo 或当前为 root。 */
  sudoPassword?: string
}

/** get.docker.com 脚本支持两种镜像覆盖方式:
 *  --mirror Aliyun / AzureChinaCloud:脚本内置,替换 apt/yum 源;
 *  DOWNLOAD_URL 环境变量:覆盖下载 apt/yum 仓库元数据与 deb/rpm 包的根地址,
 *  清华/中科大镜像站用此方式(它们没有 --mirror 内置支持)。 */
function mirrorEnvPart(mirror: DockerInstallMirror): string {
  if (mirror === 'tuna') return 'DOWNLOAD_URL=https://mirrors.tuna.tsinghua.edu.cn/docker-ce '
  if (mirror === 'ustc') return 'DOWNLOAD_URL=https://mirrors.ustc.edu.cn/docker-ce '
  return ''
}

function mirrorArg(mirror: DockerInstallMirror): string {
  if (mirror === 'aliyun') return ' --mirror Aliyun'
  if (mirror === 'azure') return ' --mirror AzureChinaCloud'
  return ''
}

/**
 * 生成 Docker 安装命令字符串。
 * 用 docker 官方一键脚本 get.docker.com,跨 CentOS/Ubuntu/Debian/RHEL 等主流发行版。
 * --mirror 参数由官方脚本支持,Aliyun/AzureChinaCloud 为内置可选项;
 * 清华/中科大走 DOWNLOAD_URL 环境变量覆盖下载源。
 * 密码本身不参与命令生成，由 dockerInstall 通过 SSH channel stdin 单独发送。
 */
export function dockerInstallCommand(opts: DockerInstallOptions): string {
  const envPrefix = mirrorEnvPart(opts.mirror)
  const mArg = mirrorArg(opts.mirror)
  const download = 'curl -fsSL https://get.docker.com -o /tmp/get-docker.sh'
  const install = `${envPrefix}sh /tmp/get-docker.sh${mArg}`

  if (!opts.sudoPassword) {
    if (!opts.addUserToDockerGroup) return `${download} && ${install}`
    return `${download} && ${install} && (sudo usermod -aG docker \$USER 2>/dev/null || true)`
  }

  const privileged = opts.addUserToDockerGroup
    ? `${install} && (usermod -aG docker "$SUDO_USER" 2>/dev/null || true)`
    : install
  return `${download} && sudo -S -p '' sh -c ${shq(privileged)}`
}

/** 在远端执行 Docker 安装命令。sudo 密码通过 SSH channel stdin 发送，
 * 不进入远端命令行参数、进程环境或 shell 历史。 */
export async function dockerInstall(sessionId: string, opts: DockerInstallOptions): Promise<string> {
  const command = `${dockerInstallCommand(opts)} 2>&1`
  if (!opts.sudoPassword) return sshExec(sessionId, command, 5 * 60 * 1000)
  if (opts.sudoPassword.length > 4096) throw new Error('sudo 密码过长(>4096)')
  return sshExecWithStdin(sessionId, command, `${opts.sudoPassword}\n`, 5 * 60 * 1000)
}

/** 获取 Docker 服务端版本信息 */
export async function dockerVersion(sessionId: string): Promise<DockerVersion | null> {
  try {
    const out = await sshExec(sessionId, 'docker version --format "{{.Server.Version}}|{{.Server.APIVersion}}" 2>/dev/null', DOCKER_QUERY_TIMEOUT_MS)
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

// docker 容器 ID / 名称的合法字符集:字母数字开头,后跟字母数字及 _.-。
// 这里做白名单校验,作为 shell 字符串拼接场景下命令注入的缓解措施。
// 真正的参数化需在后端单独开 docker 命令,当前仍走 ssh_exec 传整条命令。
const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/

// 镜像标识与容器名不同:可能为 sha256:hash、短 hash、repo:tag、repo@sha256:digest,
// 乃至 registry 路径(含 /),因此允许 : @ / . _ -,同样禁空白与 shell 元字符。
const IMAGE_RE = /^[a-zA-Z0-9@:._/-]+$/

function validateName(name: string, label = '容器标识'): void {
  if (!name || !NAME_RE.test(name)) {
    throw new Error(`${label}不合法: ${name}`)
  }
}

function validateImageId(id: string): void {
  if (!id || !IMAGE_RE.test(id)) {
    throw new Error(`镜像标识不合法: ${id}`)
  }
}

/** 列出所有容器(含已停止) */
export async function dockerListContainers(sessionId: string): Promise<DockerContainer[]> {
  const out = await sshExec(sessionId, "docker ps -a --format '{{json .}}'", DOCKER_QUERY_TIMEOUT_MS)
  return parseJsonLines(out).map(normalizeContainer)
}

/** 判断指定容器是否存在。仅“未找到”返回 false,权限或连接错误继续抛出。 */
export async function dockerContainerExists(sessionId: string, container: string): Promise<boolean> {
  validateName(container)
  try {
    const out = await sshExec(sessionId, `docker inspect --type container --format '{{.Id}}' ${container}`)
    if (/No such (object|container)/i.test(out)) return false
    if (/^Error/i.test(out.trim())) throw new Error(out.trim())
    return out.trim().length > 0
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    if (/No such (object|container)/i.test(message)) return false
    throw error
  }
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

// 容器内日志文件路径白名单:绝对路径下的字母数字与常见文件名字符,
// 拒绝空白、shell 元字符($ ; & | ` " ' 等),缓解命令注入。
const LOG_PATH_RE = /^\/[a-zA-Z0-9/_.:@#+=-]+$/

function validateLogPath(path: string): void {
  if (!LOG_PATH_RE.test(path)) {
    throw new Error(`日志路径不合法(需绝对路径,不允许空格或 shell 元字符): ${path}`)
  }
}

/** 获取容器日志:未提供 path 时走 docker logs(容器 PID1 的 stdout/stderr);
 * 提供 path 时走 docker exec + tail,读取容器内应用写到文件里的日志(Java/Nginx 常见)。 */
export async function dockerLogs(
  sessionId: string,
  container: string,
  tail = 200,
  path?: string,
): Promise<string> {
  validateName(container)
  const n = Math.min(Math.max(Math.floor(tail), 1), 5000)
  const p = path?.trim()
  if (p) {
    validateLogPath(p)
    return sshExec(sessionId, `docker exec ${container} tail -n ${n} ${p} 2>&1`)
  }
  return sshExec(sessionId, `docker logs --tail ${n} ${container} 2>&1`)
}

/** 改名(docker rename)。docker 允许在运行时改名,无需停机。 */
export async function dockerRename(sessionId: string, container: string, newName: string): Promise<void> {
  validateName(container)
  validateName(newName, '新容器名')
  if (container === newName) return
  await sshExec(sessionId, `docker rename ${container} ${newName}`)
}

// docker update 支持的字段;传空串/undefined 表示不修改
export interface DockerUpdateOpts {
  /** 内存限制,格式 "512m"/"2g"/"1024k";空串表示不改;"0" 表示解除限制(docker 允许) */
  memory?: string
  /** CPU 数,浮点(如 1.5);空串表示不改 */
  cpus?: string
  /** 重启策略 no/always/unless-stopped/on-failure;空串表示不改 */
  restart?: string
}

// 内存字符串白名单:数字 + 可选 k/m/g 单位;拒绝空白与 shell 元字符
const MEM_RE = /^[0-9]+(\.[0-9]+)?[kKmMgG]?$/
const CPU_RE = /^[0-9]+(\.[0-9]+)?$/
const RESTART_RE = /^(no|always|on-failure|unless-stopped)(:[0-9]+)?$/

/** 修改运行时限制:内存 / CPU / 重启策略。docker update 支持热改,无需重启容器。 */
export async function dockerUpdateContainer(
  sessionId: string,
  container: string,
  opts: DockerUpdateOpts,
): Promise<void> {
  validateName(container)
  const parts: string[] = ['docker', 'update']
  const mem = opts.memory?.trim()
  const cpu = opts.cpus?.trim()
  const restart = opts.restart?.trim()
  if (mem) {
    if (!MEM_RE.test(mem)) throw new Error(`内存限制不合法: ${mem}(示例:512m / 2g)`)
    parts.push('--memory', mem)
    // docker 默认令 memory-swap = 2×memory;不显式设置以保留默认行为
  }
  if (cpu) {
    if (!CPU_RE.test(cpu)) throw new Error(`CPU 数不合法: ${cpu}(示例:1.5)`)
    parts.push('--cpus', cpu)
  }
  if (restart) {
    if (!RESTART_RE.test(restart)) throw new Error(`重启策略不合法: ${restart}`)
    parts.push('--restart', restart)
  }
  if (parts.length === 2) return // 无任何字段变更,直接返回避免打空 update
  parts.push(container)
  await sshExec(sessionId, parts.join(' '))
}

// ============================================================
// 容器创建(docker run)
// ============================================================

// 单条端口映射:host 侧写 "8080" 或 "0.0.0.0:8080";container 写 "80" 或 "80/tcp"
export interface DockerPortMapping {
  /** 宿主机端口。可以是纯数字(8080)或形如 "0.0.0.0:8080" / "127.0.0.1:8080" 的完整绑定 */
  host: string
  /** 容器内端口,如 80 或 80/tcp */
  container: string
}

// 单条卷绑定;source 可以是宿主机绝对路径也可以是命名卷
export interface DockerVolumeBinding {
  source: string
  destination: string
  readOnly?: boolean
}

export interface DockerRunSpec {
  image: string
  name?: string
  hostname?: string
  workingDir?: string
  /** no/always/unless-stopped/on-failure;空串表示不指定 */
  restartPolicy?: string
  /** 主网络(docker run --network),host/bridge/container:xxx/自定义网络名;空串表示默认 */
  networkMode?: string
  /** 附加网络列表:docker run 只能一个 --network,其余在 run 后用 docker network connect 依次挂载 */
  additionalNetworks?: string[]
  ports: DockerPortMapping[]
  volumes: DockerVolumeBinding[]
  /** KEY=VALUE 字符串数组 */
  env: string[]
  /** image 后的位置参数;整体命令按需覆盖镜像 CMD */
  cmd: string[]
  /** 内存限制,同 dockerUpdateContainer.memory 格式 */
  memory?: string
  /** CPU 限制,同 dockerUpdateContainer.cpus 格式 */
  cpus?: string
  privileged: boolean
  capAdd: string[]
  capDrop: string[]
  dns: string[]
  devices: DockerDeviceBinding[]
}

// docker 端口容器侧的白名单:数字 [/proto] 形式,proto 可选 tcp/udp/sctp
const PORT_CONTAINER_RE = /^[0-9]+(\/(tcp|udp|sctp))?$/
// docker 端口宿主侧:可选 "IP:" 前缀(IPv4 / IPv6 简单写法),后跟数字
const PORT_HOST_RE = /^([0-9]{1,3}(\.[0-9]{1,3}){3}:)?[0-9]+$/
// env KEY:大写字母/数字/下划线,首字符不能是数字
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/
// 卷 source:宿主机绝对路径 或命名卷(与容器名同规则)
const VOLUME_SOURCE_RE = /^(\/[a-zA-Z0-9/_.:@#+=-]+|[a-zA-Z0-9][a-zA-Z0-9_.-]*)$/
// 卷 destination:必须是容器内绝对路径
const VOLUME_DEST_RE = /^\/[a-zA-Z0-9/_.:@#+=-]*$/
const CAPABILITY_RE = /^[A-Za-z0-9_]+$/
const DEVICE_PERMISSIONS_RE = /^[rwm]{1,3}$/

/** 从 DockerRunSpec 组装 docker run -d 命令;所有用户内容都 shq 转义,避免 shell 注入。
 * 与 buildRunCommand(从 inspect 还原)分离:那个是"重建",这个是"新建",输入结构不同。 */
export function buildRunCommandFromSpec(s: DockerRunSpec): string {
  validateImageId(s.image)
  const parts: string[] = ['docker', 'run', '-d']

  if (s.name) {
    validateName(s.name)
    parts.push('--name', shq(s.name))
  }
  if (s.hostname) parts.push('--hostname', shq(s.hostname))
  if (s.workingDir) {
    if (!VOLUME_DEST_RE.test(s.workingDir)) throw new Error(`工作目录需绝对路径: ${s.workingDir}`)
    parts.push('--workdir', shq(s.workingDir))
  }
  if (s.restartPolicy) {
    if (!RESTART_RE.test(s.restartPolicy)) throw new Error(`重启策略不合法: ${s.restartPolicy}`)
    parts.push('--restart', shq(s.restartPolicy))
  }
  if (s.networkMode) parts.push('--network', shq(s.networkMode))
  if (s.privileged) parts.push('--privileged')
  for (const capability of s.capAdd) {
    if (!CAPABILITY_RE.test(capability)) throw new Error(`新增能力不合法: ${capability}`)
    parts.push('--cap-add', shq(capability))
  }
  for (const capability of s.capDrop) {
    if (!CAPABILITY_RE.test(capability)) throw new Error(`移除能力不合法: ${capability}`)
    parts.push('--cap-drop', shq(capability))
  }
  for (const server of s.dns) {
    if (!server || server.length > 253) throw new Error(`DNS 服务器不合法: ${server}`)
    parts.push('--dns', shq(server))
  }
  for (const device of s.devices) {
    if (!VOLUME_DEST_RE.test(device.hostPath)) throw new Error(`宿主设备路径不合法: ${device.hostPath}`)
    if (!VOLUME_DEST_RE.test(device.containerPath)) throw new Error(`容器设备路径不合法: ${device.containerPath}`)
    if (!DEVICE_PERMISSIONS_RE.test(device.permissions)) throw new Error(`设备权限不合法: ${device.permissions}`)
    parts.push('--device', shq(`${device.hostPath}:${device.containerPath}:${device.permissions}`))
  }

  for (const p of s.ports) {
    if (!PORT_HOST_RE.test(p.host)) throw new Error(`宿主端口不合法: ${p.host}`)
    if (!PORT_CONTAINER_RE.test(p.container)) throw new Error(`容器端口不合法: ${p.container}`)
    parts.push('-p', shq(`${p.host}:${p.container}`))
  }

  for (const v of s.volumes) {
    if (!VOLUME_SOURCE_RE.test(v.source)) throw new Error(`卷源不合法: ${v.source}`)
    if (!VOLUME_DEST_RE.test(v.destination)) throw new Error(`卷目标需绝对路径: ${v.destination}`)
    const suffix = v.readOnly ? ':ro' : ''
    parts.push('-v', shq(`${v.source}:${v.destination}${suffix}`))
  }

  for (const kv of s.env) {
    const eq = kv.indexOf('=')
    if (eq <= 0) throw new Error(`环境变量需为 KEY=VALUE: ${kv}`)
    const k = kv.slice(0, eq)
    if (!ENV_KEY_RE.test(k)) throw new Error(`环境变量键不合法: ${k}`)
    parts.push('-e', shq(kv))
  }

  if (s.memory) {
    if (!MEM_RE.test(s.memory)) throw new Error(`内存限制不合法: ${s.memory}`)
    parts.push('--memory', s.memory)
  }
  if (s.cpus) {
    if (!CPU_RE.test(s.cpus)) throw new Error(`CPU 数不合法: ${s.cpus}`)
    parts.push('--cpus', s.cpus)
  }

  parts.push(shq(s.image))
  for (const a of s.cmd) parts.push(shq(a))
  return parts.join(' ')
}

/** 新建容器(docker run -d)。返回 docker 输出(通常是容器 ID)。 */
export async function dockerRun(sessionId: string, spec: DockerRunSpec): Promise<string> {
  return sshExec(sessionId, `${buildRunCommandFromSpec(spec)} 2>&1`)
}

/** 把 DockerInspect 转成 DockerRunSpec,用于"更新并重建"时预填编辑弹窗。
 * - 端口权威源用 HostConfig.PortBindings;IPv4/IPv6 双栈自动合并为一条(优先 IPv4)
 * - 网络优先用 NetworkMode(host/自定义 bridge 名),回退到 Networks 里第一个非 bridge
 * - 挂载只取 bind + 命名 volume(tmpfs 等不还原)
 * - 特权模式、能力、DNS 与设备映射通过隐藏字段透传,避免重建时静默降权或丢设备 */
export function inspectToRunSpec(i: DockerInspect): DockerRunSpec {
  // 双栈去重:同 container+hostPort 组合优先保留 IPv4 那条
  const seen = new Set<string>()
  const ports: DockerPortMapping[] = []
  // 先过一遍 IPv4,再过一遍其余
  const sorted = [...i.portBindings].sort((a, b) => {
    const av = a.hostIp === '' || /^\d/.test(a.hostIp) ? 0 : 1
    const bv = b.hostIp === '' || /^\d/.test(b.hostIp) ? 0 : 1
    return av - bv
  })
  for (const b of sorted) {
    const key = `${b.container}|${b.hostPort}`
    if (seen.has(key)) continue
    seen.add(key)
    // IPv6 "::" 用户无法编辑,归一为空(所有接口)
    const useIp = b.hostIp && b.hostIp !== '::' && b.hostIp !== '0.0.0.0'
    const host = useIp ? `${b.hostIp}:${b.hostPort}` : b.hostPort
    ports.push({ host, container: b.container })
  }

  const volumes: DockerVolumeBinding[] = []
  for (const m of i.mounts) {
    if (m.type !== 'bind' && m.type !== 'volume') continue
    const readOnly = m.mode ? /(^|,)ro(,|$)/.test(m.mode) : false
    volumes.push({ source: m.source, destination: m.destination, readOnly })
  }

  // 网络:主网络优先取 HostConfig.NetworkMode(host / container:xx / 自定义 bridge 名);
  // NetworkMode = "default" 时回退到 Networks[0]。其余 Networks 作为附加网络,
  // 重建时先 --network 主的,run 完再对每个附加网络执行 docker network connect。
  let networkMode = ''
  const nm = i.networkMode
  if (nm && nm !== 'default') {
    networkMode = nm
  } else if (i.networks[0]) {
    networkMode = i.networks[0]
  }
  const additionalNetworks = i.networks.filter((n) => n && n !== networkMode)

  return {
    image: i.image,
    name: i.name || undefined,
    hostname: i.hostname || undefined,
    workingDir: i.workingDir || undefined,
    restartPolicy: i.restartPolicy && i.restartPolicy !== 'no' ? i.restartPolicy : undefined,
    networkMode: networkMode || undefined,
    additionalNetworks: additionalNetworks.length ? additionalNetworks : undefined,
    ports,
    volumes,
    env: [...i.env],
    cmd: [...i.cmd],
    memory: i.memoryBytes > 0 ? bytesToMemStr(i.memoryBytes) : undefined,
    cpus: i.cpus > 0 ? String(i.cpus) : undefined,
    privileged: i.privileged,
    capAdd: [...i.capAdd],
    capDrop: [...i.capDrop],
    dns: [...i.dns],
    devices: i.devices.map((device) => ({ ...device })),
  }
}

/** 内存字节数 → docker --memory 字符串(优先 g / m,取整,避免 0.5g 之类) */
function bytesToMemStr(bytes: number): string {
  const g = bytes / (1024 * 1024 * 1024)
  if (g >= 1 && Number.isInteger(g)) return `${g}g`
  const m = Math.round(bytes / (1024 * 1024))
  if (m > 0) return `${m}m`
  return String(bytes)
}

// ============================================================
// 镜像详情 + 层历史
// ============================================================

/** 查询镜像详情;`docker inspect --type=image --format '{{json .}}'` 拿单行 JSON。 */
export async function dockerImageInspect(sessionId: string, imageId: string): Promise<DockerImageInspect> {
  validateImageId(imageId)
  const out = await sshExec(
    sessionId,
    `docker inspect --type=image --format '{{json .}}' ${imageId}`,
  )
  const r = parseJsonLines(out)[0]
  if (!r) throw new Error('未找到镜像信息')
  const config = (r.Config ?? {}) as Record<string, unknown>
  const labels = (config.Labels ?? {}) as Record<string, unknown>
  const exposedPorts = (config.ExposedPorts ?? {}) as Record<string, unknown>
  const volumes = (config.Volumes ?? {}) as Record<string, unknown>
  return {
    id: str(r.Id),
    repoTags: Array.isArray(r.RepoTags) ? (r.RepoTags as unknown[]).map((x) => str(x)) : [],
    repoDigests: Array.isArray(r.RepoDigests) ? (r.RepoDigests as unknown[]).map((x) => str(x)) : [],
    created: str(r.Created),
    size: typeof r.Size === 'number' ? (r.Size as number) : 0,
    virtualSize: typeof r.VirtualSize === 'number' ? (r.VirtualSize as number) : 0,
    architecture: str(r.Architecture),
    os: str(r.Os),
    author: str(r.Author),
    cmd: Array.isArray(config.Cmd) ? (config.Cmd as unknown[]).map((x) => str(x)) : [],
    entrypoint: Array.isArray(config.Entrypoint) ? (config.Entrypoint as unknown[]).map((x) => str(x)) : [],
    env: Array.isArray(config.Env) ? (config.Env as unknown[]).map((x) => str(x)) : [],
    workingDir: str(config.WorkingDir),
    user: str(config.User),
    exposedPorts: Object.keys(exposedPorts),
    volumes: Object.keys(volumes),
    labels: Object.fromEntries(Object.entries(labels).map(([k, v]) => [k, str(v)])),
  }
}

/** 查询镜像的构建历史(各层)。`docker history --format '{{json .}}'` 一行一层。
 * 层顺序:docker CLI 默认从新到旧(最上层在前),我们保留原顺序。 */
export async function dockerImageHistory(sessionId: string, imageId: string): Promise<DockerImageLayer[]> {
  validateImageId(imageId)
  const out = await sshExec(
    sessionId,
    `docker history --no-trunc --format '{{json .}}' ${imageId}`,
  )
  return parseJsonLines(out).map((r) => ({
    id: str(r.ID),
    created: str(r.CreatedSince) || str(r.CreatedAt),
    createdBy: str(r.CreatedBy),
    size: str(r.Size),
    comment: str(r.Comment),
  }))
}

/** 扫描容器内常见目录的日志文件,返回绝对路径列表(最多 30 条,按文件大小从大到小)。
 * 场景:很多应用(Java jar、nginx、mysql 等)把日志写到容器内文件而非 stdout,
 * 这种情况下 docker logs 是空/几乎无内容的,需要 `docker exec + tail <path>` 才能看到。
 * 帮用户绕开"不知道路径写在哪"的问题,直接给出候选。 */
export async function dockerFindLogFiles(sessionId: string, container: string): Promise<string[]> {
  validateName(container)
  // -maxdepth 6 与限定根目录避免全盘扫描;xargs 补 ls -S 排序,让活跃日志更靠前;
  // 2>/dev/null 吞掉找不到目录/权限错误;head -30 兜底防列表爆炸
  const roots = '/var/log /app /workspace /opt /home /logs /data /srv /root /tmp'
  const inner =
    `find ${roots} -maxdepth 6 -type f ` +
    `\\( -name "*.log" -o -name "*.out" -o -name "*.err" -o -name "*.log.*" -o -name "catalina.out" -o -name "console.txt" \\) ` +
    `-size +0c 2>/dev/null | head -100 | xargs -r ls -1S 2>/dev/null | head -30`
  try {
    const out = await sshExec(sessionId, `docker exec ${container} sh -c '${inner}' 2>&1`)
    return out
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('/') && LOG_PATH_RE.test(l))
  } catch {
    // 极简镜像(distroless / scratch)可能没 sh / find,静默返回空,UI 侧提示
    return []
  }
}

/** 查询容器详情(docker inspect),返回归一化后的结构化字段。
 * 不加 --format 时 docker 会输出多行 pretty-print JSON 数组,按行 JSON.parse 会全部失败,
 * 因此用 '{{json .}}' 强制单行 JSON 输出,与 ps/images 走同一套解析。 */
export async function dockerInspect(sessionId: string, container: string): Promise<DockerInspect> {
  validateName(container)
  const out = await sshExec(sessionId, `docker inspect --format '{{json .}}' ${container}`)
  const arr = parseJsonLines(out)
  const r = arr[0]
  if (!r) throw new Error('未找到容器信息')
  return normalizeInspect(r)
}

// ============================================================
// 镜像操作
// ============================================================

/** 列出本地镜像 */
export async function dockerListImages(sessionId: string): Promise<DockerImage[]> {
  const out = await sshExec(sessionId, "docker images --format '{{json .}}'", DOCKER_QUERY_TIMEOUT_MS)
  return parseJsonLines(out).map(normalizeImage)
}

/** 删除镜像 */
export async function dockerRemoveImage(sessionId: string, imageId: string): Promise<void> {
  validateImageId(imageId)
  await sshExec(sessionId, `docker rmi ${imageId}`)
}

// ============================================================
// 系统:磁盘占用与清理
// ============================================================

export interface DockerDfEntry {
  /** Images / Containers / Local Volumes / Build Cache */
  type: string
  totalCount: string
  active: string
  size: string
  reclaimable: string
}

/** docker system df 汇总,输出一张按类型分行的表。
 * 不同 docker 版本支持 --format json 的情况差异较大,这里用 table 稳妥些,四列固定顺序解析。 */
export async function dockerSystemDf(sessionId: string): Promise<DockerDfEntry[]> {
  const out = await sshExec(
    sessionId,
    "docker system df --format '{{.Type}}\\t{{.TotalCount}}\\t{{.Active}}\\t{{.Size}}\\t{{.Reclaimable}}'",
  )
  const rows: DockerDfEntry[] = []
  for (const line of out.split('\n')) {
    const parts = line.split('\t')
    if (parts.length < 5) continue
    rows.push({
      type: parts[0].trim(),
      totalCount: parts[1].trim(),
      active: parts[2].trim(),
      size: parts[3].trim(),
      reclaimable: parts[4].trim(),
    })
  }
  return rows
}

/** 一键清理:未使用的容器/网络/镜像/构建缓存;withVolumes=true 时把未挂载的卷也一起删。 */
export async function dockerSystemPrune(sessionId: string, withVolumes: boolean): Promise<string> {
  const flags = withVolumes ? '-af --volumes' : '-af'
  return sshExec(sessionId, `docker system prune ${flags} 2>&1`)
}

// ============================================================
// 卷
// ============================================================

/** 列出所有本地卷 */
export async function dockerListVolumes(sessionId: string): Promise<DockerVolume[]> {
  const out = await sshExec(sessionId, "docker volume ls --format '{{json .}}'", DOCKER_QUERY_TIMEOUT_MS)
  return parseJsonLines(out).map((r) => ({
    name: str(r.Name),
    driver: str(r.Driver),
    scope: str(r.Scope),
    mountpoint: str(r.Mountpoint),
    labels: str(r.Labels),
  }))
}

/** 卷详情;pretty-print 数组同样用 --format '{{json .}}' 拿单行 */
export async function dockerInspectVolume(sessionId: string, name: string): Promise<Record<string, unknown> | null> {
  validateName(name, '卷名')
  const out = await sshExec(sessionId, `docker volume inspect --format '{{json .}}' ${name}`)
  return parseJsonLines(out)[0] ?? null
}

export async function dockerRemoveVolume(sessionId: string, name: string): Promise<void> {
  validateName(name, '卷名')
  await sshExec(sessionId, `docker volume rm ${name}`)
}

export async function dockerPruneVolumes(sessionId: string): Promise<string> {
  return sshExec(sessionId, 'docker volume prune -af 2>&1')
}

// ============================================================
// 网络
// ============================================================

/** 列出所有网络 */
export async function dockerListNetworks(sessionId: string): Promise<DockerNetwork[]> {
  const out = await sshExec(sessionId, "docker network ls --format '{{json .}}'", DOCKER_QUERY_TIMEOUT_MS)
  return parseJsonLines(out).map((r) => ({
    id: str(r.ID),
    name: str(r.Name),
    driver: str(r.Driver),
    scope: str(r.Scope),
    labels: str(r.Labels),
  }))
}

/** 网络详情;返回原始 JSON 结构,前端按需展开(networks 详情结构差异较大不做归一化) */
export async function dockerInspectNetwork(sessionId: string, id: string): Promise<Record<string, unknown> | null> {
  // 网络 id 是短 hash,复用容器名白名单足够
  validateName(id, '网络标识')
  const out = await sshExec(sessionId, `docker network inspect --format '{{json .}}' ${id}`)
  return parseJsonLines(out)[0] ?? null
}

export async function dockerRemoveNetwork(sessionId: string, id: string): Promise<void> {
  validateName(id, '网络标识')
  await sshExec(sessionId, `docker network rm ${id}`)
}

export async function dockerPruneNetworks(sessionId: string): Promise<string> {
  return sshExec(sessionId, 'docker network prune -f 2>&1')
}

/** 把容器接入指定网络。docker 允许在容器运行时动态 connect。
 * 已连的网络再 connect 会报 "already exists in network",调用方需自行去重。 */
export async function dockerNetworkConnect(
  sessionId: string,
  network: string,
  container: string,
): Promise<void> {
  validateName(network, '网络名')
  validateName(container)
  await sshExec(sessionId, `docker network connect ${network} ${container} 2>&1`)
}

/** 断开容器与指定网络。运行时也可断,但断掉最后一个网络后容器会失去网络访问。 */
export async function dockerNetworkDisconnect(
  sessionId: string,
  network: string,
  container: string,
): Promise<void> {
  validateName(network, '网络名')
  validateName(container)
  await sshExec(sessionId, `docker network disconnect ${network} ${container} 2>&1`)
}

// ============================================================
// Registry 登录 / 登出
// ============================================================

// registry 地址白名单:host[:port][/path],host 允许字母数字点连字符,不允许协议前缀。
// 空 registry 表示 Docker Hub 默认。
const REGISTRY_RE = /^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?(:[0-9]{1,5})?(\/[a-zA-Z0-9._/-]*)?$/
// 用户名白名单:字母/数字开头,允许 . _ - + @
const REGISTRY_USER_RE = /^[a-zA-Z0-9][a-zA-Z0-9._+@-]*$/

function validateRegistry(registry: string): void {
  if (registry && !REGISTRY_RE.test(registry)) {
    throw new Error(`registry 地址不合法(示例:registry.example.com:5000): ${registry}`)
  }
}

function validateRegistryUser(user: string): void {
  if (!REGISTRY_USER_RE.test(user)) {
    throw new Error(`用户名不合法(允许字母数字与 . _ - + @)`)
  }
}

/** 登录到远端 Docker Registry。密码通过 SSH channel stdin 直接发送给
 * docker login --password-stdin，不进入远端命令行参数、进程环境或 shell 历史。
 * docker login 成功后会把 token 写到远端 ~/.docker/config.json；需要清理时调用 dockerLogout。
 * registry 传空串表示 Docker Hub 默认。 */
export async function dockerLogin(
  sessionId: string,
  registry: string,
  username: string,
  password: string,
): Promise<void> {
  const reg = registry.trim()
  const user = username.trim()
  validateRegistry(reg)
  validateRegistryUser(user)
  if (!password) throw new Error('密码不能为空')
  if (password.length > 4096) throw new Error('密码过长(>4096)')

  const command = reg
    ? `docker login -u ${shq(user)} --password-stdin ${shq(reg)} 2>&1`
    : `docker login -u ${shq(user)} --password-stdin 2>&1`
  const out = await sshExecWithStdin(sessionId, command, password)
  if (!/Login Succeeded/i.test(out)) {
    throw new Error(out.trim() || 'Registry 登录失败')
  }
}

/** 从远端 docker registry 登出;清除 ~/.docker/config.json 中该 registry 的 auth 条目。
 * registry 传空串表示 Docker Hub 默认。 */
export async function dockerLogout(sessionId: string, registry: string): Promise<string> {
  const reg = registry.trim()
  validateRegistry(reg)
  const cmd = reg ? `docker logout ${shq(reg)} 2>&1` : 'docker logout 2>&1'
  return sshExec(sessionId, cmd)
}

/** 读远端 ~/.docker/config.json 的 auths keys,列出当前已登录的 registry 地址。
 * 用 grep + sed 而不是 jq / python,尽量少依赖;解析容错,失败返回空数组。 */
export async function dockerListRegistries(sessionId: string): Promise<string[]> {
  try {
    // 只提取 auths 对象下的一级 key;awk 状态机比嵌套 sed 稳
    const cmd =
      `awk '/"auths"[[:space:]]*:/{f=1;d=0;next} ` +
      `f&&/{/{d++;next} ` +
      `f&&/}/{d--;if(d<=0){f=0};next} ` +
      `f&&d>=1&&/"[^"]+"[[:space:]]*:/{match($0,/"[^"]+"/);if(RSTART){print substr($0,RSTART+1,RLENGTH-2)}}' ` +
      `~/.docker/config.json 2>/dev/null`
    const out = await sshExec(sessionId, cmd)
    return out
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  } catch {
    return []
  }
}

// ============================================================
// Compose Stack(仅 v2)
// ============================================================

/** 列出所有 compose 项目(含已停止)。
 * docker compose ls 输出的是**单行 JSON 数组**,不是每行一个 JSON,单独用 JSON.parse。 */
export async function dockerListStacks(sessionId: string): Promise<DockerStack[]> {
  const out = await sshExec(sessionId, 'docker compose ls --all --format json', DOCKER_QUERY_TIMEOUT_MS)
  try {
    const arr = JSON.parse(out.trim()) as Array<Record<string, unknown>>
    return arr.map((r) => ({
      name: str(r.Name),
      status: str(r.Status),
      configFiles: str(r.ConfigFiles),
    }))
  } catch {
    return []
  }
}

export async function dockerStackUp(sessionId: string, stack: DockerStack): Promise<string> {
  return sshExec(sessionId, buildComposeStackCommand(stack, 'up'))
}

export async function dockerStackDown(sessionId: string, stack: DockerStack): Promise<string> {
  return sshExec(sessionId, buildComposeStackCommand(stack, 'down'))
}

export async function dockerStackRestart(sessionId: string, stack: DockerStack): Promise<string> {
  return sshExec(sessionId, buildComposeStackCommand(stack, 'restart'))
}

/** 用指定 compose 文件部署一个新的 stack;compose ls 之后就能看到它 */
export async function dockerStackDeploy(sessionId: string, composePath: string): Promise<string> {
  validateComposePath(composePath)
  return sshExec(sessionId, `docker compose -f ${composePath} up -d 2>&1`)
}

/** 拉取镜像(新拉取或更新同名标签),返回 docker pull 的输出便于调用方展示。
 * ref 与 imageId 走同一套白名单:允许 registry.host/repo/name:tag、digest 形式,禁 shell 元字符。 */
export async function dockerPull(sessionId: string, ref: string): Promise<string> {
  validateImageId(ref)
  return sshExec(sessionId, `docker pull ${ref} 2>&1`)
}

// ============================================================
// 容器重建(用最新镜像重启)
// ============================================================

/** bash 单引号安全转义:内容里的 ' 变成 '\'',整体单引号包裹。
 * 用于把 env value / mount 路径 / cmd 参数等"用户内容"塞进拼接的 shell 命令,避免注入。 */
function shq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

// 旧版 buildRunCommand / dockerRecreate 已废弃,统一走 DockerRunDialog 的 recreate 模式
// (inspectToRunSpec → 用户编辑 → buildRunCommandFromSpec + pull/stop/rm/run)

// ============================================================
// 资源统计
// ============================================================

/** 采集所有运行中容器的资源占用(--no-stream 一次性快照) */
export async function dockerStats(sessionId: string): Promise<DockerStats[]> {
  const out = await sshExec(sessionId, "docker stats --no-stream --format '{{json .}}'", DOCKER_QUERY_TIMEOUT_MS)
  return parseJsonLines(out).map(normalizeStats)
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

function stringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map((item) => str(item)).filter(Boolean) : []
}

function parseDevices(v: unknown): DockerDeviceBinding[] {
  if (!Array.isArray(v)) return []
  return v.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const device = item as Record<string, unknown>
    const hostPath = str(device.PathOnHost)
    const containerPath = str(device.PathInContainer)
    const permissions = str(device.CgroupPermissions)
    if (!hostPath || !containerPath || !permissions) return []
    return [{ hostPath, containerPath, permissions }]
  })
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

/** 将数组字段归一为空格连接的字符串(docker inspect 的 Cmd/Entrypoint 可能为 null) */
function joinArr(v: unknown): string {
  if (Array.isArray(v)) return v.map((x) => str(x)).join(' ')
  if (v == null) return ''
  return str(v)
}

/** 解析 docker inspect 的端口映射:NetworkSettings.Ports 形如 {"80/tcp":[{"HostIp":"0.0.0.0","HostPort":"8080"}]} */
function parsePorts(ports: unknown): DockerInspectPort[] {
  const result: DockerInspectPort[] = []
  if (!ports || typeof ports !== 'object') return result
  for (const [key, val] of Object.entries(ports as Record<string, unknown>)) {
    if (Array.isArray(val)) {
      for (const b of val) {
        if (b && typeof b === 'object') {
          const hp = (b as Record<string, unknown>).HostPort
          const hip = (b as Record<string, unknown>).HostIp
          result.push({ container: key, host: `${str(hip)}:${str(hp)}`.replace(/^:::/, '') || '' })
        }
      }
    } else {
      // null 表示端口暴露但未映射到宿主机
      result.push({ container: key, host: '' })
    }
  }
  return result
}

/** 解析 HostConfig.PortBindings:{"80/tcp":[{"HostIp":"0.0.0.0","HostPort":"8080"}]}
 * 权威源,即使容器已停止也存在;NetworkSettings.Ports 仅运行中容器完整 */
function parsePortBindings(bindings: unknown): DockerInspectPortBinding[] {
  const result: DockerInspectPortBinding[] = []
  if (!bindings || typeof bindings !== 'object') return result
  for (const [key, val] of Object.entries(bindings as Record<string, unknown>)) {
    if (!Array.isArray(val) || val.length === 0) continue
    for (const b of val) {
      if (b && typeof b === 'object') {
        const hp = str((b as Record<string, unknown>).HostPort)
        const hip = str((b as Record<string, unknown>).HostIp)
        if (!hp) continue
        result.push({ container: key, hostIp: hip, hostPort: hp })
      }
    }
  }
  return result
}

/** 将 docker inspect 的 [0] 归一化为 DockerInspect */
function normalizeInspect(r: Record<string, unknown>): DockerInspect {
  const config = (r.Config ?? {}) as Record<string, unknown>
  const state = (r.State ?? {}) as Record<string, unknown>
  const host = (r.HostConfig ?? {}) as Record<string, unknown>
  const restart = (host.RestartPolicy ?? {}) as Record<string, unknown>
  const net = (r.NetworkSettings ?? {}) as Record<string, unknown>
  const networks = (net.Networks ?? {}) as Record<string, unknown>
  const labels = (config.Labels ?? {}) as Record<string, unknown>
  const mounts = (r.Mounts ?? []) as unknown[]
  return {
    id: str(r.Id),
    name: str(r.Name).replace(/^\//, ''),
    image: str(config.Image),
    state: str(state.Status),
    createdAt: str(r.Created),
    startedAt: str(state.StartedAt),
    command: joinArr(config.Cmd),
    entrypoint: joinArr(config.Entrypoint),
    ip: str(net.IPAddress),
    networks: Object.keys(networks),
    ports: parsePorts(net.Ports),
    mounts: mounts.map((m) => {
      const mo = (m ?? {}) as Record<string, unknown>
      return {
        type: str(mo.Type),
        source: str(mo.Source),
        destination: str(mo.Destination),
        mode: str(mo.Mode),
      }
    }),
    env: Array.isArray(config.Env) ? (config.Env as unknown[]).map((x) => str(x)) : [],
    labels: Object.fromEntries(Object.entries(labels).map(([k, v]) => [k, str(v)])),
    cmd: Array.isArray(config.Cmd) ? (config.Cmd as unknown[]).map((x) => str(x)) : [],
    restartPolicy: str(restart.Name),
    networkMode: str(host.NetworkMode),
    hostname: str(config.Hostname),
    workingDir: str(config.WorkingDir),
    memoryBytes: typeof host.Memory === 'number' ? (host.Memory as number) : 0,
    // NanoCpus 是纳核数(1e9 = 1 core);<0 视为无限制
    cpus:
      typeof host.NanoCpus === 'number' && (host.NanoCpus as number) > 0
        ? (host.NanoCpus as number) / 1e9
        : 0,
    portBindings: parsePortBindings(host.PortBindings),
    privileged: host.Privileged === true,
    capAdd: stringArray(host.CapAdd),
    capDrop: stringArray(host.CapDrop),
    dns: stringArray(host.Dns),
    devices: parseDevices(host.Devices),
  }
}

/** 将 docker stats 的 PascalCase JSON 归一化为 DockerStats */
function normalizeStats(r: Record<string, unknown>): DockerStats {
  return {
    container: str(r.Container),
    name: str(r.Name),
    cpuPercent: str(r.CPUPerc),
    memUsage: str(r.MemUsage),
    memPercent: str(r.MemPerc),
    netIo: str(r.NetIO),
    blockIo: str(r.BlockIO),
    pids: str(r.PIDs),
  }
}
