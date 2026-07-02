import { invoke } from '@tauri-apps/api/core'

// ============================================================
// 类型定义(与后端 store/model.rs 的 SshKey 对齐)
// ============================================================

export interface SshKey {
  id: string
  name: string
  /** 算法标识:ed25519 / rsa-2048 / rsa-3072 / rsa-4096 / ecdsa-p256 / ecdsa-p384 / ecdsa-p521 / rsa */
  algorithm: string
  /** SHA256 指纹 */
  fingerprint: string
  /** 私钥文件绝对路径 */
  keyPath: string
  comment: string | null
  createdAt: string
}

// ============================================================
// 命令封装
// ============================================================

export async function sshKeysList(): Promise<SshKey[]> {
  return await invoke<SshKey[]>('ssh_keys_list')
}

export interface GenerateKeyInput {
  name: string
  algorithm: string
  comment?: string | null
  passphrase?: string | null
}

export async function sshKeyGenerate(input: GenerateKeyInput): Promise<SshKey> {
  return await invoke<SshKey>('ssh_key_generate', { input })
}

export interface ImportKeyInput {
  name: string
  sourcePath: string
  passphrase?: string | null
}

export async function sshKeyImport(input: ImportKeyInput): Promise<SshKey> {
  return await invoke<SshKey>('ssh_key_import', { input })
}

export async function sshKeyDelete(id: string): Promise<void> {
  await invoke('ssh_key_delete', { id })
}

export async function sshKeyRename(id: string, name: string): Promise<void> {
  await invoke('ssh_key_rename', { id, name })
}

/** 获取密钥的 OpenSSH 公钥字符串 */
export async function sshKeyPublicKey(id: string): Promise<string> {
  return await invoke<string>('ssh_key_public_key', { id })
}

/** 部署公钥到远端服务器(通过已有 SSH 会话) */
export async function sshKeyDeploy(sessionId: string, keyId: string): Promise<string> {
  return await invoke<string>('ssh_key_deploy', { sessionId, keyId })
}

/** 获取密钥的 passphrase(解密后返回,供私钥认证时使用) */
export async function sshKeyPassphrase(id: string): Promise<string | null> {
  return await invoke<string | null>('ssh_key_passphrase', { id })
}
