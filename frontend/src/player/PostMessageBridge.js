export class PostMessageBridge {
  constructor(iframe, emitter) {
    this._iframe = iframe;
    this._emitter = emitter;
    this._handler = this._handleMessage.bind(this);
    window.addEventListener("message", this._handler);
  }

  send(type, data = {}) {
    this._iframe?.contentWindow?.postMessage(JSON.stringify({ type, data }), "*");
  }

  _handleMessage(event) {
    if (event.origin !== "https://rutube.ru") return;
    if (event.source !== this._iframe?.contentWindow) return;
    let parsed;
    try { parsed = JSON.parse(event.data); } catch { return; }
    this._emitter.emit(parsed.type, parsed.data);
  }

  destroy() {
    window.removeEventListener("message", this._handler);
  }
}
