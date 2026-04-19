/**
 * Serialize async sections (e.g. ZIP append + shared progress) so concurrent workers
 * do not corrupt shared mutable state.
 */
export function createExclusiveRunner(): <T>(
  fn: () => Promise<T>,
) => Promise<T> {
  let chain: Promise<void> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next as Promise<T>;
  };
}
