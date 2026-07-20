// packages/overlay/src/utils/source-fetch-queue.ts
//
// Ported from react-grab (packages/react-grab/src/utils/source-fetch-queue.ts).
// Caps ThemeLab's own source-resolution fetches (JS bundle + source map, and on
// Next.js the symbolication POST) so component resolution can't hang when the
// user's app saturates the browser's per-origin connection pool.
//
// In development these run over HTTP/1.1, where Chrome keeps ~6 connections per
// origin. A real app's data fetches routinely hold all of them (a dashboard
// waiting on slow APIs), so a ThemeLab fetch waits in the browser's connection
// queue behind them — which surfaces as a selection that never resolves. We
// can't speed up the app's requests, so we avoid adding to the pressure: cap our
// own in-flight fetches below the pool size, and abort any single resolution
// that exceeds the timeout so its queue slot (and real connection) is freed.

const MAX_CONCURRENT_SOURCE_FETCHES = 3;

// Upper bound on a single queued source resolution. A backstop, not a latency
// budget: a healthy fetch finishes well under it, and app-owned source resolves
// from React's fiber data without any network at all, so a timeout degrades only
// the deeper trace, never the primary source path.
export const SOURCE_FETCH_TIMEOUT_MS = 8000;

let activeFetchCount = 0;
const waitingForSlot: (() => void)[] = [];

const acquireSlot = (): Promise<void> => {
  if (activeFetchCount < MAX_CONCURRENT_SOURCE_FETCHES) {
    activeFetchCount += 1;
    return Promise.resolve();
  }
  // Semaphore pattern: `resolve` must be stashed and invoked later by
  // releaseSlot() from an unrelated call stack — no promise/async equivalent.
  // oxlint-disable-next-line promise/avoid-new -- see comment above
  return new Promise<void>((resolve) => {
    waitingForSlot.push(resolve);
  });
};

const releaseSlot = (): void => {
  // Hand the freed slot straight to the next waiter rather than decrementing,
  // so the active count stays at the cap while work remains queued.
  const nextWaiter = waitingForSlot.shift();
  if (nextWaiter) {
    nextWaiter();
    return;
  }
  activeFetchCount -= 1;
};

/**
 * Run a source-resolution task under the concurrency cap, releasing its slot
 * when the task settles or after `timeoutMs`, whichever comes first. The task
 * receives an AbortSignal that fires on timeout — pass it to the fetches bippy
 * makes (via its fetchFn hook) so a stuck request is cancelled rather than left
 * lingering. Returns `fallback` on timeout.
 */
export const runQueuedSourceFetch = async <T>(
  task: (signal: AbortSignal) => Promise<T>,
  fallback: T,
  timeoutMs: number = SOURCE_FETCH_TIMEOUT_MS
): Promise<T> => {
  await acquireSlot();

  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  // Wraps a setTimeout callback into a promise so it can race against
  // taskPromise; no async/await form of "resolve from a timer callback" exists.
  // oxlint-disable-next-line promise/avoid-new -- see comment above
  const timeout = new Promise<T>((resolve) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      resolve(fallback);
    }, timeoutMs);
  });

  const taskPromise = task(controller.signal);
  // Swallow a late rejection from a fetch that already lost the timeout race, so
  // an aborted request never surfaces as an unhandled rejection. Intentionally
  // NOT awaited here — awaiting would block on taskPromise before the race below
  // even starts, defeating the timeout.
  // oxlint-disable-next-line promise/prefer-await-to-then -- fire-and-forget by design
  taskPromise.catch(() => {
    /* empty */
  });

  try {
    return await Promise.race([taskPromise, timeout]);
  } finally {
    clearTimeout(timeoutId);
    releaseSlot();
  }
};

/** Build a fetch hook for bippy that carries the queue's abort signal and marks
 *  the request high priority so it jumps the app's in-flight data fetches when a
 *  connection frees. */
export const createSourceFetch =
  (signal: AbortSignal) =>
  (url: string): Promise<Response> =>
    fetch(url, { signal, priority: "high" } as RequestInit);
