// The pool's contract: never wider than the limit, every result reported as it
// lands, one failure does not sink the run, and a stop halts the rest without
// inventing verdicts for the labels it skipped.

import { describe, expect, it, vi } from 'vitest'

import { BATCH_CONCURRENCY, runBatch, type BatchOutcome } from './batch'

function ids(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `item-${index}`)
}

/** Resolves on the next macrotask, so the pool actually has to interleave. */
function tick(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('runBatch', () => {
  it('never runs more than the limit at once', async () => {
    let inFlight = 0
    let peak = 0

    await runBatch(
      ids(50),
      async () => {
        inFlight += 1
        peak = Math.max(peak, inFlight)
        await tick()
        inFlight -= 1
      },
      { limit: 6 },
    )

    expect(peak).toBe(6)
  })

  it('runs every item exactly once', async () => {
    const seen: string[] = []
    const summary = await runBatch(ids(30), async (id) => {
      await tick()
      seen.push(id)
    })

    expect(seen).toHaveLength(30)
    expect(new Set(seen).size).toBe(30)
    expect(summary).toEqual({ done: 30, failed: 0, skipped: 0, stopped: false })
  })

  it('reports each item as it lands rather than collecting them for the end', async () => {
    const settled: string[] = []
    // The last item is the slowest, so if results were gathered and flushed at
    // the end this assertion would still pass on count but not on ordering.
    const run = runBatch(
      ['slow', 'fast'],
      async (id) => {
        await tick(id === 'slow' ? 20 : 0)
        return id
      },
      { limit: 2, onSettled: (outcome) => settled.push(outcome.id) },
    )

    await run
    expect(settled).toEqual(['fast', 'slow'])
  })

  it('keeps going when one item throws, and counts it as failed rather than done', async () => {
    const outcomes: BatchOutcome<string>[] = []
    const summary = await runBatch(
      ids(10),
      async (id) => {
        if (id === 'item-3') throw new Error('provider exploded')
        return id
      },
      { onSettled: (outcome) => outcomes.push(outcome) },
    )

    expect(summary).toEqual({ done: 9, failed: 1, skipped: 0, stopped: false })
    const failure = outcomes.find((outcome) => outcome.kind === 'failed')
    expect(failure?.id).toBe('item-3')
    expect((failure?.error as Error).message).toBe('provider exploded')
  })

  it('stops starting new work once the caller aborts', async () => {
    const controller = new AbortController()
    const started: string[] = []

    const summary = await runBatch(
      ids(100),
      async (id) => {
        started.push(id)
        if (started.length === 10) controller.abort()
        await tick()
      },
      { limit: 2, signal: controller.signal },
    )

    // Ten started; the pool is two wide, so at most one more can already have
    // been pulled before the abort was observed.
    expect(started.length).toBeLessThanOrEqual(11)
    expect(summary.stopped).toBe(true)
    expect(summary.done + summary.failed + summary.skipped).toBe(100)
    expect(summary.skipped).toBeGreaterThan(85)
  })

  it('reports work that was in flight when the stop landed as skipped, not failed', async () => {
    const controller = new AbortController()
    const outcomes: BatchOutcome<void>[] = []

    const run = runBatch(
      ['a', 'b'],
      async (_id, signal) => {
        await tick(20)
        // What an aborted fetch does: throw rather than resolve.
        if (signal.aborted) throw new Error('The operation was aborted.')
      },
      { limit: 2, signal: controller.signal, onSettled: (outcome) => outcomes.push(outcome) },
    )

    await tick()
    controller.abort()
    const summary = await run

    expect(outcomes.every((outcome) => outcome.kind === 'skipped')).toBe(true)
    expect(summary.failed).toBe(0)
    expect(summary.skipped).toBe(2)
  })

  it('starts nothing at all when the signal is already aborted', async () => {
    const worker = vi.fn()
    const summary = await runBatch(ids(5), worker, { signal: AbortSignal.abort() })

    expect(worker).not.toHaveBeenCalled()
    expect(summary).toEqual({ done: 0, failed: 0, skipped: 5, stopped: true })
  })

  it('handles an empty list without hanging', async () => {
    await expect(runBatch([], async () => undefined)).resolves.toEqual({
      done: 0,
      failed: 0,
      skipped: 0,
      stopped: false,
    })
  })

  it('carries a 250 item run, which is the scenario the queue exists for', async () => {
    const outcomes: BatchOutcome<number>[] = []
    let inFlight = 0
    let peak = 0

    const summary = await runBatch(
      ids(250),
      async (id) => {
        inFlight += 1
        peak = Math.max(peak, inFlight)
        // Uneven durations so results genuinely arrive out of dispatch order.
        await tick(Number(id.split('-')[1]) % 3)
        inFlight -= 1
        return 1
      },
      { onSettled: (outcome) => outcomes.push(outcome) },
    )

    expect(summary).toEqual({ done: 250, failed: 0, skipped: 0, stopped: false })
    expect(peak).toBe(BATCH_CONCURRENCY)
    expect(new Set(outcomes.map((outcome) => outcome.id)).size).toBe(250)
  })
})
