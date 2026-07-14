export interface DockerProbeVersion {
  version: string
  apiVersion: string
}

export interface DockerProbe {
  installed: boolean
  available: boolean
  message: string
  version: DockerProbeVersion | null
}

export const DOCKER_PROBE_MARKER = '__KSHELL_DOCKER__:'

export function parseDockerProbeOutput(output: string): DockerProbe {
  const lines = output.split(/\r?\n/)
  const markerIndex = lines.findIndex((line) => line.startsWith(DOCKER_PROBE_MARKER))
  if (markerIndex < 0) throw new Error('Docker 探测返回了无法识别的结果')

  const marker = lines[markerIndex] ?? ''
  const detailLines = lines.slice(markerIndex + 1)
  if (marker === `${DOCKER_PROBE_MARKER}missing`) {
    return { installed: false, available: false, message: '远端未安装 Docker', version: null }
  }
  if (marker.startsWith(`${DOCKER_PROBE_MARKER}ready|`)) {
    const [version = '', apiVersion = ''] = marker
      .slice(`${DOCKER_PROBE_MARKER}ready|`.length)
      .split('|')
    return {
      installed: true,
      available: true,
      message: '',
      version: version ? { version, apiVersion } : null,
    }
  }
  if (marker === `${DOCKER_PROBE_MARKER}unusable`) {
    const detail = detailLines.map((line) => line.trim()).filter(Boolean).join('\n')
    return {
      installed: true,
      available: false,
      message: detail || 'Docker daemon 不可访问，请检查服务状态或当前用户权限',
      version: null,
    }
  }
  throw new Error('Docker 探测返回了无法识别的结果')
}
