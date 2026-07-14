export interface EditContainerUpdateOptions {
  memory?: string
  cpus?: string
  restart?: string
}

export interface EditContainerPlan {
  originalName: string
  targetName: string
  nextUpdate: EditContainerUpdateOptions
  previousUpdate: EditContainerUpdateOptions
  disconnectNetworks: string[]
  connectNetworks: string[]
}

export interface EditContainerOperations {
  rename: (container: string, newName: string) => Promise<void>
  update: (container: string, options: EditContainerUpdateOptions) => Promise<void>
  disconnectNetwork: (network: string, container: string) => Promise<void>
  connectNetwork: (network: string, container: string) => Promise<void>
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function hasUpdate(options: EditContainerUpdateOptions): boolean {
  return Object.values(options).some((value) => value !== undefined)
}

export async function editContainerTransaction(
  plan: EditContainerPlan,
  operations: EditContainerOperations,
): Promise<void> {
  const shouldRename = plan.targetName !== plan.originalName
  const shouldUpdate = hasUpdate(plan.nextUpdate)
  let renamed = false
  let updateAttempted = false
  const disconnectedNetworks: string[] = []
  const connectedNetworks: string[] = []

  try {
    if (shouldRename) {
      await operations.rename(plan.originalName, plan.targetName)
      renamed = true
    }

    if (shouldUpdate) {
      updateAttempted = true
      await operations.update(plan.targetName, plan.nextUpdate)
    }

    for (const network of plan.disconnectNetworks) {
      await operations.disconnectNetwork(network, plan.targetName)
      disconnectedNetworks.push(network)
    }
    for (const network of plan.connectNetworks) {
      await operations.connectNetwork(network, plan.targetName)
      connectedNetworks.push(network)
    }
  } catch (error: unknown) {
    const rollbackErrors: string[] = []

    for (const network of connectedNetworks.reverse()) {
      try {
        await operations.disconnectNetwork(network, plan.targetName)
      } catch (rollbackError: unknown) {
        rollbackErrors.push(`断开新增网络 ${network} 失败：${errorMessage(rollbackError)}`)
      }
    }
    for (const network of disconnectedNetworks.reverse()) {
      try {
        await operations.connectNetwork(network, plan.targetName)
      } catch (rollbackError: unknown) {
        rollbackErrors.push(`恢复原网络 ${network} 失败：${errorMessage(rollbackError)}`)
      }
    }

    if (updateAttempted) {
      try {
        await operations.update(plan.targetName, plan.previousUpdate)
      } catch (rollbackError: unknown) {
        rollbackErrors.push(`恢复资源配置失败：${errorMessage(rollbackError)}`)
      }
    }

    if (renamed) {
      try {
        await operations.rename(plan.targetName, plan.originalName)
      } catch (rollbackError: unknown) {
        rollbackErrors.push(`恢复容器名称失败：${errorMessage(rollbackError)}`)
      }
    }

    const originalError = errorMessage(error)
    if (rollbackErrors.length > 0) {
      throw new Error(`${originalError}；自动回滚未完全成功：${rollbackErrors.join('；')}`)
    }
    throw error instanceof Error ? error : new Error(originalError)
  }
}
