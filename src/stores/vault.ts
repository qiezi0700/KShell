import { ref } from 'vue'

/**
 * 当前 Stronghold 主密码。空串表示尚未解锁。
 * M2.2 安全模型:主密码只存内存,进程退出即失效。
 */
export const vaultPassword = ref('')

/** 是否已解锁 */
export const isVaultUnlocked = () => Boolean(vaultPassword.value)

/** 解锁(设置主密码) */
export function unlockVault(password: string) {
  vaultPassword.value = password
}

/** 退出时/切换用户时清除 */
export function lockVault() {
  vaultPassword.value = ''
}
