type Listener = (payload: any) => void;

export class EventEmitter {
  events: Record<string, Listener[]> = {};

  on(event: string, listener: Listener) {
    if (!this.events[event]) {
      this.events[event] = [];
    }
    this.events[event].push(listener);
    return () => this.off(event, listener);
  }

  off(event: string, listener: Listener) {
    if (!this.events[event]) return;
    this.events[event] = this.events[event].filter(l => l !== listener);
    if (this.events[event].length === 0) {
      delete this.events[event];
    }
  }

  emit(event: string, payload?: any) {
    if (!this.events[event]) return;
    const listeners = [...this.events[event]];
    for (const listener of listeners) {
      try {
        listener(payload);
      } catch (err) {
        console.error(`Error in event listener for "${event}":`, err);
      }
    }
  }
}

export const appEvents = new EventEmitter();
