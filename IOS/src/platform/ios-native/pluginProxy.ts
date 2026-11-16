/**
 * Capacitor 8 generates a function for every proxy property, including `then`.
 * Promise resolution invokes that phantom native method and never settles.
 * Hide only `then` before a plugin crosses an async return boundary.
 */
export function nonThenablePlugin<T extends object>(plugin: T): T {
  return new Proxy(plugin, {
    get(target, property) { return property === 'then' ? undefined : Reflect.get(target, property); },
  });
}
