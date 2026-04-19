import pLimit from "p-limit";

/**
 * Bounded-memory pool over an async iterable: at most `concurrency` `fn` calls in flight.
 * Uses `p-limit` for the concurrency cap and a small `Set` + `Promise.race` window
 * (does not buffer one promise per item).
 */
export async function forEachAsyncIterablePool<T>(
  iterable: AsyncIterable<T>,
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const limit = pLimit(Math.max(1, concurrency));
  const executing = new Set<Promise<void>>();

  for await (const item of iterable) {
    const p = limit(async () => {
      await fn(item);
    });
    executing.add(p);
    void p.finally(() => {
      executing.delete(p);
    });
    if (executing.size >= concurrency) {
      await Promise.race(executing);
    }
  }
  await Promise.all(executing);
}

type HeapEntry<T> = { item: T; score: number; seq: number };

/** Max-heap: pop returns the item with highest score (FIFO among ties). */
class ScoreHeap<T> {
  private readonly a: HeapEntry<T>[] = [];
  private seq = 0;

  size(): number {
    return this.a.length;
  }

  isEmpty(): boolean {
    return this.a.length === 0;
  }

  /** True if `x` should be closer to the root than `y`. */
  private better(x: HeapEntry<T>, y: HeapEntry<T>): boolean {
    if (x.score !== y.score) return x.score > y.score;
    return x.seq < y.seq;
  }

  push(item: T, score: number): void {
    const seq = this.seq++;
    this.a.push({ item, score, seq });
    this.siftUp(this.a.length - 1);
  }

  pop(): T | undefined {
    if (this.a.length === 0) return undefined;
    const top = this.a[0]!;
    const last = this.a.pop()!;
    if (this.a.length > 0) {
      this.a[0] = last;
      this.siftDown(0);
    }
    return top.item;
  }

  private siftUp(i: number): void {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.better(this.a[i]!, this.a[p]!)) break;
      this.swap(i, p);
      i = p;
    }
  }

  private siftDown(i: number): void {
    const n = this.a.length;
    for (;;) {
      let b = i;
      const l = i * 2 + 1;
      const r = l + 1;
      if (l < n && this.better(this.a[l]!, this.a[b]!)) b = l;
      if (r < n && this.better(this.a[r]!, this.a[b]!)) b = r;
      if (b === i) break;
      this.swap(i, b);
      i = b;
    }
  }

  private swap(i: number, j: number): void {
    const t = this.a[i]!;
    this.a[i] = this.a[j]!;
    this.a[j] = t;
  }
}

export interface ForEachAsyncIterablePriorityPoolOptions {
  signal?: AbortSignal;
}

/**
 * Like {@link forEachAsyncIterablePool}, but each `fn` invocation receives the **best-scoring**
 * item among up to `bufferMax` items read ahead from `iterable` (not counting in-flight work).
 * Higher `priority(item)` → scheduled sooner. Non-finite scores are treated as `-Infinity`.
 * Use e.g. `(m) => -m.size` for small-files-first among the buffered window.
 */
export async function forEachAsyncIterablePriorityPool<T>(
  iterable: AsyncIterable<T>,
  concurrency: number,
  priority: (item: T) => number,
  bufferMax: number,
  fn: (item: T) => Promise<void>,
  options?: ForEachAsyncIterablePriorityPoolOptions,
): Promise<void> {
  const concurrencyN = Math.max(1, concurrency);
  const bufferN = Math.max(1, bufferMax);
  const heap = new ScoreHeap<T>();
  const executing = new Set<Promise<void>>();
  const it = iterable[Symbol.asyncIterator]();
  let exhausted = false;

  const start = (item: T): void => {
    const p = (async () => {
      await fn(item);
    })();
    executing.add(p);
    void p.finally(() => {
      executing.delete(p);
    });
  };

  for (;;) {
    options?.signal?.throwIfAborted();

    while (!exhausted && heap.size() < bufferN) {
      options?.signal?.throwIfAborted();
      const step = await it.next();
      if (step.done) {
        exhausted = true;
        break;
      }
      const raw = priority(step.value);
      const score = Number.isFinite(raw) ? raw : -Number.POSITIVE_INFINITY;
      heap.push(step.value, score);
    }

    while (executing.size < concurrencyN && !heap.isEmpty()) {
      const item = heap.pop();
      if (item !== undefined) start(item);
    }

    if (heap.isEmpty() && exhausted && executing.size === 0) break;
    if (executing.size > 0) {
      await Promise.race(executing);
    }
  }
}
