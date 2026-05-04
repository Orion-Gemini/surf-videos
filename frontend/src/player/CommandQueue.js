export class CommandQueue {
  constructor() {
    this._queue = [];
  }

  enqueue(command) {
    this._queue.push(command);
  }

  // If a seekTo is present, drop all play/pause preceding it (they're stale)
  flush(executor) {
    let lastSeekIdx = -1;
    for (let i = this._queue.length - 1; i >= 0; i--) {
      if (this._queue[i].method === "seekTo") { lastSeekIdx = i; break; }
    }

    const toExecute = lastSeekIdx >= 0
      ? this._queue.filter((cmd, i) => {
          if (i < lastSeekIdx) return cmd.method !== "play" && cmd.method !== "pause";
          return true;
        })
      : [...this._queue];

    this._queue = [];
    toExecute.forEach(executor);
  }

  clear() {
    this._queue = [];
  }

  size() {
    return this._queue.length;
  }
}
