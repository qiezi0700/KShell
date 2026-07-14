export interface CreateContainerPlan {
  targetName?: string
  additionalNetworks: string[]
}

export interface CreateContainerOperations {
  run: () => Promise<string>
  exists: (container: string) => Promise<boolean>
  connectNetwork: (network: string, container: string) => Promise<void>
  remove: (container: string, force: boolean) => Promise<void>
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function createContainerTransaction(
  plan: CreateContainerPlan,
  operations: CreateContainerOperations,
): Promise<string> {
  let target = plan.targetName?.trim() ?? ''
  let runAttempted = false
  let containerCreated = false

  try {
    runAttempted = true
    const createdId = (await operations.run()).trim()
    target ||= createdId
    if (!target) {
      throw new Error('docker run 未返回容器 ID，无法继续附加网络')
    }
    containerCreated = true

    for (const network of plan.additionalNetworks) {
      await operations.connectNetwork(network, target)
    }
    return target
  } catch (error: unknown) {
    const rollbackErrors: string[] = []

    if (runAttempted && !containerCreated && target) {
      try {
        containerCreated = await operations.exists(target)
      } catch (rollbackError: unknown) {
        rollbackErrors.push(`检查新容器残留失败：${errorMessage(rollbackError)}`)
      }
    }

    if (containerCreated && target) {
      try {
        await operations.remove(target, true)
      } catch (rollbackError: unknown) {
        rollbackErrors.push(`删除新容器失败：${errorMessage(rollbackError)}`)
      }
    }

    const originalError = errorMessage(error)
    if (rollbackErrors.length > 0) {
      throw new Error(`${originalError}；自动回滚未完全成功：${rollbackErrors.join('；')}`)
    }
    throw error instanceof Error ? error : new Error(originalError)
  }
}
