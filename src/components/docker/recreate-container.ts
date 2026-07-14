export interface RecreateContainerPlan {
  image: string
  originalName: string
  targetName: string
  backupName: string
  additionalNetworks: string[]
}

export interface RecreateContainerOperations {
  pull: (image: string) => Promise<void>
  inspectState: (container: string) => Promise<string>
  exists: (container: string) => Promise<boolean>
  stop: (container: string) => Promise<void>
  rename: (container: string, newName: string) => Promise<void>
  run: () => Promise<void>
  connectNetwork: (network: string, container: string) => Promise<void>
  remove: (container: string, force: boolean) => Promise<void>
  start: (container: string) => Promise<void>
}

export interface RecreateContainerResult {
  backupCleanupWarning: string | null
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function wasContainerActive(state: string): boolean {
  return ['running', 'restarting', 'paused'].includes(state.trim().toLowerCase())
}

export async function recreateContainerTransaction(
  plan: RecreateContainerPlan,
  operations: RecreateContainerOperations,
): Promise<RecreateContainerResult> {
  let wasActive = false
  let originalStopped = false
  let backupCreated = false
  let newContainerCreated = false

  try {
    await operations.pull(plan.image)
    wasActive = wasContainerActive(await operations.inspectState(plan.originalName))
    if (plan.targetName !== plan.originalName && await operations.exists(plan.targetName)) {
      throw new Error(`目标容器名 ${plan.targetName} 已存在,请更换名称`)
    }

    if (wasActive) {
      await operations.stop(plan.originalName)
      originalStopped = true
    }

    await operations.rename(plan.originalName, plan.backupName)
    backupCreated = true

    await operations.run()
    newContainerCreated = true

    for (const network of plan.additionalNetworks) {
      await operations.connectNetwork(network, plan.targetName)
    }
  } catch (error: unknown) {
    const rollbackErrors: string[] = []

    if (backupCreated && !newContainerCreated) {
      try {
        newContainerCreated = await operations.exists(plan.targetName)
      } catch (rollbackError: unknown) {
        rollbackErrors.push(`检查新容器残留失败：${errorMessage(rollbackError)}`)
      }
    }

    if (newContainerCreated) {
      try {
        await operations.remove(plan.targetName, true)
      } catch (rollbackError: unknown) {
        rollbackErrors.push(`删除新容器失败：${errorMessage(rollbackError)}`)
      }
    }

    let originalNameRestored = !backupCreated
    if (backupCreated) {
      try {
        await operations.rename(plan.backupName, plan.originalName)
        originalNameRestored = true
      } catch (rollbackError: unknown) {
        rollbackErrors.push(`恢复旧容器名称失败：${errorMessage(rollbackError)}`)
      }
    }

    if (wasActive && originalStopped && originalNameRestored) {
      try {
        await operations.start(plan.originalName)
      } catch (rollbackError: unknown) {
        rollbackErrors.push(`重新启动旧容器失败：${errorMessage(rollbackError)}`)
      }
    }

    const originalError = errorMessage(error)
    if (rollbackErrors.length > 0) {
      throw new Error(`${originalError}；自动回滚未完全成功：${rollbackErrors.join('；')}`)
    }
    throw error instanceof Error ? error : new Error(originalError)
  }

  try {
    await operations.remove(plan.backupName, false)
    return { backupCleanupWarning: null }
  } catch (error: unknown) {
    return {
      backupCleanupWarning: `新容器已创建，但旧容器备份清理失败：${errorMessage(error)}`,
    }
  }
}
