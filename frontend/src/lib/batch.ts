// The bounded concurrency pool behind verify-all and verify-selected.
//
// Two hundred labels cannot go out at once: the provider would rate-limit us,
// the browser caps its own connections anyway, and a request that queues for a
// minute inside the network stack reports an elapsed time that is mostly
// waiting. Six at a time is the width approach.md section 5.7 settled on.
//
// The important property is that this never gathers results into one array that
// arrives at the end. Each item is reported the moment it lands, because the
// whole point of the batch screen is that problems surface while the rest is
// still running.
//
// No React and no fetch in here on purpose: the pool is the piece where an
// off-by-one costs an agent a wrong queue, and it is worth being able to run it
// two hundred and fifty times in a unit test without a network.

/** How many verifications are allowed in flight at once. */
export const BATCH_CONCURRENCY = 6

/**
 * Runs one item. Receives the pool's signal so the work it starts is abortable;
 * `verifyLabel` passes it straight to `fetch`.
 */
export type BatchWorker<T> = (id: string, signal: AbortSignal) => Promise<T>

export interface BatchOutcome<T> {
  id: string
  /**
   * `done` the worker resolved, `failed` it threw, `skipped` the run was
   * stopped while this item was in flight.
   *
   * A stopped item is deliberately not a failure. It never got an answer, so
   * presenting it as one would put a red mark against a label nobody read.
   */
  kind: 'done' | 'failed' | 'skipped'
  value?: T
  error?: unknown
}

export interface BatchSummary {
  done: number
  failed: number
  /** In flight when the stop landed, plus everything never started. */
  skipped: number
  /** True when the run ended early rather than exhausting the list. */
  stopped: boolean
}

export interface RunBatchOptions<T> {
  limit?: number
  /** The caller's stop control. Aborting it halts the pool and the in-flight work. */
  signal?: AbortSignal
  /** Called once per item, as it lands. Never batched, never deferred. */
  onSettled?: (outcome: BatchOutcome<T>) => void
}

/**
 * Runs `worker` over `ids`, at most `limit` at a time, reporting each result as
 * it arrives.
 *
 * Items that never start are not reported at all. The caller knows the full
 * list it handed over, so it can clear whatever is left; emitting two hundred
 * skip callbacks to say "nothing happened" would only give the UI more work to
 * do at the moment an agent has asked it to stop.
 */
export async function runBatch<T>(
  ids: readonly string[],
  worker: BatchWorker<T>,
  options: RunBatchOptions<T> = {},
): Promise<BatchSummary> {
  const { limit = BATCH_CONCURRENCY, signal, onSettled } = options

  // One internal controller so the worker always receives a signal, whether or
  // not the caller supplied one, and so a caller's abort reaches work that is
  // already in flight rather than only stopping the next start.
  const controller = new AbortController()
  const forwardAbort = () => controller.abort(signal?.reason)
  if (signal?.aborted) forwardAbort()
  else signal?.addEventListener('abort', forwardAbort, { once: true })

  const summary: BatchSummary = { done: 0, failed: 0, skipped: 0, stopped: false }
  let cursor = 0

  async function runner(): Promise<void> {
    while (!controller.signal.aborted) {
      const index = cursor
      if (index >= ids.length) return
      cursor += 1
      const id = ids[index]
      try {
        const value = await worker(id, controller.signal)
        summary.done += 1
        onSettled?.({ id, kind: 'done', value })
      } catch (error) {
        // An error that arrives after the stop is the abort propagating, not a
        // verdict about the label. Classify by the signal, not by the error
        // type: fetch, our own client, and the worker each throw something
        // different on abort, and sniffing for all three would be a guess.
        if (controller.signal.aborted) {
          summary.skipped += 1
          onSettled?.({ id, kind: 'skipped', error })
        } else {
          summary.failed += 1
          onSettled?.({ id, kind: 'failed', error })
        }
      }
    }
  }

  try {
    const width = Math.max(1, Math.min(Math.trunc(limit), ids.length))
    await Promise.all(Array.from({ length: width }, () => runner()))
  } finally {
    signal?.removeEventListener('abort', forwardAbort)
  }

  summary.stopped = controller.signal.aborted
  summary.skipped = ids.length - summary.done - summary.failed
  return summary
}
