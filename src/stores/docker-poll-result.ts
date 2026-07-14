export function isDockerPollAvailable(
  results: readonly PromiseSettledResult<unknown>[],
): boolean {
  return results.some((result) => result.status === 'fulfilled')
}
