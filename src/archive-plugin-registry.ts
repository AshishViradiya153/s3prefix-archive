/**
 * Minimal **plugin registry** for optional integrations (storage backends, hooks bundles, etc.).
 * Thread-safe for single-threaded Node; for concurrent registration use external synchronization.
 */
export class ArchivePluginRegistry<T = unknown> {
  private readonly plugins = new Map<string, T>();

  register(name: string, plugin: T): void {
    if (name.length === 0) {
      throw new TypeError(
        "ArchivePluginRegistry.register: name must be non-empty",
      );
    }
    this.plugins.set(name, plugin);
  }

  get(name: string): T | undefined {
    return this.plugins.get(name);
  }

  has(name: string): boolean {
    return this.plugins.has(name);
  }

  /** Registered names in insertion order. */
  names(): string[] {
    return [...this.plugins.keys()];
  }

  unregister(name: string): boolean {
    return this.plugins.delete(name);
  }
}
