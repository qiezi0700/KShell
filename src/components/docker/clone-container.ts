export interface CloneContainerPlan {
  image: string
  originalName: string
  targetName: string
  shouldPullImage: boolean
  shouldStopOriginal: boolean
  additionalNetworks?: string[]
}

export interface CloneContainerOperations {
  exists: (container: string) => Promise<boolean>
  pull: (image: string) => Promise<void>
  inspectState: (container: string) => Promise<string>
  stop: (container: string) => Promise<void>
  run: () => Promise<void>
  connectNetwork: (network: string, container: string) => Promise<void>
  remove: (container: string, force: boolean) => Promise<void>
  start: (container: string) => Promise<void>
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function wasContainerActive(state: string): boolean {
  return ['running', 'restarting', 'paused'].includes(state.trim().toLowerCase())
}

export async function cloneContainerTransaction(
  plan: CloneContainerPlan,
  operations: CloneContainerOperations,
): Promise<void> {
  if (await operations.exists(plan.targetName)) {
    throw new Error(`目标容器名 ${plan.targetName} 已存在，请更换名称`)
  }

  let originalStopped = false
  let runAttempted = false
  let newContainerCreated = false

  try {
    if (plan.shouldPullImage) {
      await operations.pull(plan.image)
    }

    if (plan.shouldStopOriginal) {
      const state = await operations.inspectState(plan.originalName)
      if (wasContainerActive(state)) {
        await operations.stop(plan.originalName)
        originalStopped = true
      }
    }

    runAttempted = true
    await operations.run()
    newContainerCreated = true

    for (const network of plan.additionalNetworks ?? []) {
      await operations.connectNetwork(network, plan.targetName)
    }
  } catch (error: unknown) {
    const rollbackErrors: string[] = []

    if (runAttempted && !newContainerCreated) {
      try {
        newContainerCreated = await operations.exists(plan.targetName)
      } catch (rollbackError: unknown) {
        rollbackErrors.push(`检查克隆容器残留失败：${errorMessage(rollbackError)}`)
      }
    }

    if (newContainerCreated) {
      try {
        await operations.remove(plan.targetName, true)
      } catch (rollbackError: unknown) {
        rollbackErrors.push(`清理克隆容器残留失败：${errorMessage(rollbackError)}`)
      }
    }

    if (originalStopped) {
      try {
        await operations.start(plan.originalName)
      } catch (rollbackError: unknown) {
        rollbackErrors.push(`重新启动原容器失败：${errorMessage(rollbackError)}`)
      }
    }

    const originalError = errorMessage(error)
    if (rollbackErrors.length > 0) {
      throw new Error(`${originalError}；自动恢复未完全成功：${rollbackErrors.join('；')}`)
    }
    throw error instanceof Error ? error : new Error(originalError)
  }
}
