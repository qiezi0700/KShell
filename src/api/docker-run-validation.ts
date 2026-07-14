const PORT_NUMBER_RE = /^[0-9]+$/
const IPV4_WITH_PORT_RE = /^([0-9]{1,3}(?:\.[0-9]{1,3}){3}):([0-9]+)$/
const CONTAINER_PORT_RE = /^([0-9]+)(?:\/(tcp|udp|sctp))?$/

function validatePortNumber(value: string, label: string): void {
  const port = Number(value)
  if (!PORT_NUMBER_RE.test(value) || !Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${label}需在 1-65535 之间: ${value}`)
  }
}

function validateIpv4(address: string): void {
  const octets = address.split('.')
  if (octets.length !== 4 || octets.some((octet) => Number(octet) > 255)) {
    throw new Error(`宿主 IP 不合法: ${address}`)
  }
}

export function validateDockerPortMapping(host: string, container: string): void {
  if (PORT_NUMBER_RE.test(host)) {
    validatePortNumber(host, '宿主端口')
  } else {
    const hostMatch = IPV4_WITH_PORT_RE.exec(host)
    if (!hostMatch) throw new Error(`宿主端口不合法: ${host}`)
    validateIpv4(hostMatch[1])
    validatePortNumber(hostMatch[2], '宿主端口')
  }

  const containerMatch = CONTAINER_PORT_RE.exec(container)
  if (!containerMatch) throw new Error(`容器端口不合法: ${container}`)
  validatePortNumber(containerMatch[1], '容器端口')
}
