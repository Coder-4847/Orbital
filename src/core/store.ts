/** Tiny observable state container. Immutable updates; subscribers get (next, prev). */
export class Store<T extends object> {
  private listeners = new Set<(next: T, prev: T) => void>();

  constructor(protected state: T) {}

  get(): T {
    return this.state;
  }

  set(next: T): void {
    if (next === this.state) return;
    const prev = this.state;
    this.state = next;
    this.listeners.forEach((fn) => fn(next, prev));
  }

  update(fn: (current: T) => T): void {
    this.set(fn(this.state));
  }

  subscribe(fn: (next: T, prev: T) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
