import type { SessionProjection } from './projection'

export type ProjectionBatch = readonly SessionProjection[]

/**
 * Coalesces projection updates for one short render window while retaining the
 * newest projection for each Session.
 */
export class ProjectionBatcher {
  private readonly pending = new Map<string, SessionProjection>()
  private readonly windowMs: number
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly onFlush: (projections: ProjectionBatch) => void,
    windowMs = 50,
  ) {
    this.windowMs = Math.max(0, windowMs)
  }

  enqueue(projection: SessionProjection): void {
    this.pending.set(projection.sessionId, projection)
    if (this.timer !== undefined) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.flush()
    }, this.windowMs)
  }

  flush(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    if (this.pending.size === 0) return
    const projections = [...this.pending.values()]
    this.pending.clear()
    this.onFlush(projections)
  }

  cancel(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    this.pending.clear()
  }
}
