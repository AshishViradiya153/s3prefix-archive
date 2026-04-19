/**
 * Minimum surface for throughput-driven ZIP cap adjustments (`ThroughputZipAdaptiveController.observe`).
 */
export interface ThroughputAdaptiveZipLimiter {
  getCap(): number;
  getInitialCap(): number;
  decreaseCapForExternalSignal(): void;
  increaseCapTowardMax(): void;
}

/**
 * Dynamic concurrency limiter for ZIP parallel {@link GetObject} calls (same call shape as `p-limit`).
 * Lowers cap on {@link onThrottleRetry}; optionally recovers toward the initial cap after a quiet period.
 */
export class AdaptiveZipGetObjectLimit implements ThroughputAdaptiveZipLimiter {
  readonly #initial: number;
  readonly #min = 1;
  readonly #max: number;
  #cap: number;
  #active = 0;
  readonly #waiters: Array<() => void> = [];
  #minCapObserved: number;
  /** Peak length of the FIFO wait queue (jobs waiting for a slot, excluding in-flight). */
  #maxWaiterQueueDepth = 0;
  /** Peak in-flight `limit()` jobs (`#active` after each start). */
  #maxActiveConcurrent = 0;
  #lastThrottleAt = 0;
  readonly #recoveryTickMs: number;
  readonly #recoveryQuietMs: number;
  #recoveryTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * @param initialConcurrency — same as configured ZIP `concurrency` (also {@link #max}).
   * @param recoveryTickMs — `0` disables recovery (downshift only). Otherwise interval for recovery checks.
   * @param recoveryQuietMs — ms since last throttle before allowing +1 cap toward {@link #max}.
   */
  constructor(
    initialConcurrency: number,
    recoveryTickMs: number,
    recoveryQuietMs: number,
  ) {
    this.#initial = Math.max(1, initialConcurrency);
    this.#max = this.#initial;
    this.#cap = this.#initial;
    this.#minCapObserved = this.#cap;
    this.#recoveryTickMs = Math.max(0, recoveryTickMs);
    this.#recoveryQuietMs = Math.max(0, recoveryQuietMs);
  }

  getCap(): number {
    return this.#cap;
  }

  getMinCapObserved(): number {
    return this.#minCapObserved;
  }

  getInitialCap(): number {
    return this.#initial;
  }

  getMaxWaiterQueueDepth(): number {
    return this.#maxWaiterQueueDepth;
  }

  getMaxActiveConcurrent(): number {
    return this.#maxActiveConcurrent;
  }

  /**
   * Lower cap by one toward 1 (used by throughput-adaptive path). Does not touch throttle-recovery
   * timers or {@link #lastThrottleAt}.
   */
  decreaseCapForExternalSignal(): void {
    const next = Math.max(this.#min, this.#cap - 1);
    if (next < this.#cap) {
      this.#cap = next;
      this.#minCapObserved = Math.min(this.#minCapObserved, this.#cap);
    }
  }

  /** Raise cap by one toward the configured maximum (throughput-adaptive up-shifts). */
  increaseCapTowardMax(): void {
    if (this.#cap < this.#max) {
      this.#cap = Math.min(this.#max, this.#cap + 1);
      this.#pump();
    }
  }

  #pump(): void {
    while (this.#active < this.#cap && this.#waiters.length > 0) {
      const w = this.#waiters.shift()!;
      w();
    }
  }

  /**
   * p-limit–compatible: run `fn` when under the current cap; queue otherwise.
   */
  limit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const start = () => {
        this.#active++;
        this.#maxActiveConcurrent = Math.max(
          this.#maxActiveConcurrent,
          this.#active,
        );
        void fn().then(
          (v) => {
            this.#active--;
            this.#pump();
            resolve(v);
          },
          (err) => {
            this.#active--;
            this.#pump();
            reject(err);
          },
        );
      };
      if (this.#active < this.#cap) start();
      else {
        this.#waiters.push(() => start());
        this.#maxWaiterQueueDepth = Math.max(
          this.#maxWaiterQueueDepth,
          this.#waiters.length,
        );
      }
    });
  }

  /** Call when an S3 retry was classified as throttling (e.g. 429 / `ThrottlingException`). */
  onThrottleRetry(): void {
    const next = Math.max(this.#min, this.#cap - 1);
    if (next < this.#cap) {
      this.#cap = next;
      this.#minCapObserved = Math.min(this.#minCapObserved, this.#cap);
    }
    this.#lastThrottleAt = Date.now();
    if (
      this.#recoveryTickMs > 0 &&
      this.#cap < this.#max &&
      !this.#recoveryTimer
    ) {
      this.#recoveryTimer = setInterval(
        () => this.#tickRecovery(),
        this.#recoveryTickMs,
      );
      if (typeof this.#recoveryTimer.unref === "function")
        this.#recoveryTimer.unref();
    }
  }

  #tickRecovery(): void {
    if (this.#cap >= this.#max) {
      this.dispose();
      return;
    }
    if (Date.now() - this.#lastThrottleAt < this.#recoveryQuietMs) return;
    this.#cap = Math.min(this.#max, this.#cap + 1);
    this.#pump();
  }

  dispose(): void {
    if (this.#recoveryTimer) {
      clearInterval(this.#recoveryTimer);
      this.#recoveryTimer = null;
    }
  }
}
