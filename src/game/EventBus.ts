type Handler = (...args: unknown[]) => void;

class SimpleEventEmitter {
  private listeners = new Map<string, Set<Handler>>();

  on(event: string, handler: Handler) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(handler);
  }

  off(event: string, handler: Handler) {
    this.listeners.get(event)?.delete(handler);
  }

  emit(event: string, ...args: unknown[]) {
    this.listeners.get(event)?.forEach((h) => h(...args));
  }
}

export const EventBus = new SimpleEventEmitter();
