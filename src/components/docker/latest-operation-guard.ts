export class LatestOperationGuard {
  private version = 0

  begin(): number {
    this.version += 1
    return this.version
  }

  invalidate(): void {
    this.version += 1
  }

  isCurrent(version: number): boolean {
    return version === this.version
  }
}
