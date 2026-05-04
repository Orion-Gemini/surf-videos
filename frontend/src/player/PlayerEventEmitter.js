export class PlayerEventEmitter {
  constructor() {
    this._listeners = new Map();
  }

  on(event, handler) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(handler);
  }

  off(event, handler) {
    this._listeners.get(event)?.delete(handler);
  }

  emit(event, data) {
    this._listeners.get(event)?.forEach((h) => h(data));
  }

  removeAllListeners() {
    this._listeners.clear();
  }
}
