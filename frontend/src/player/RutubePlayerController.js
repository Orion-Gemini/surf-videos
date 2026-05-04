import { PlayerEventEmitter } from "./PlayerEventEmitter";
import { PostMessageBridge } from "./PostMessageBridge";
import { CommandQueue } from "./CommandQueue";

export class RutubePlayerController {
  constructor(iframe) {
    this._emitter = new PlayerEventEmitter();
    this._bridge = new PostMessageBridge(iframe, this._emitter);
    this._queue = new CommandQueue();
    this.ready = false;
    this.currentTime = 0;
    this.isPlaying = false;
    this._justSeeked = false;
    this._justSeekedTimer = null;

    this._emitter.on("player:ready", () => {
      this.ready = true;
      this._queue.flush((cmd) => this[cmd.method](...cmd.args));
    });

    this._emitter.on("player:currentTime", (data) => {
      if (!this._justSeeked && data?.time !== undefined) {
        this.currentTime = data.time;
      }
    });

    this._emitter.on("player:started", () => { this.isPlaying = true; });
    this._emitter.on("player:play",    () => { this.isPlaying = true; });
    this._emitter.on("player:paused",  () => { this.isPlaying = false; });
    this._emitter.on("player:pause",   () => { this.isPlaying = false; });

    this._initTimeout = setTimeout(() => {
      if (!this.ready) this._emitter.emit("error:timeout", {});
    }, 10000);
  }

  // ── Public commands ────────────────────────────────────────────────────────

  play() {
    if (!this.ready) { this._queue.enqueue({ method: "play", args: [] }); return; }
    this._bridge.send("player:play");
  }

  pause() {
    if (!this.ready) { this._queue.enqueue({ method: "pause", args: [] }); return; }
    this._bridge.send("player:pause");
  }

  seekTo(time) {
    if (!this.ready) { this._queue.enqueue({ method: "seekTo", args: [time] }); return; }
    this._bridge.send("player:setCurrentTime", { time });
    this._markJustSeeked();
  }

  setMuted(muted) {
    if (!this.ready) { this._queue.enqueue({ method: "setMuted", args: [muted] }); return; }
    this._bridge.send(muted ? "player:mute" : "player:unMute");
  }

  setVolume(vol) {
    this._bridge.send("player:setVolume", { volume: vol });
  }

  changeVideo(videoId) {
    this._bridge.send("player:changeVideo", { id: videoId });
  }

  // Raw postMessage for timing-sensitive sequences (e.g. play → delayed seek)
  send(type, data = {}) {
    this._bridge.send(type, data);
  }

  // Reset when iframe src changes (video change without overlay cycle)
  reset() {
    this.ready = false;
    this.currentTime = 0;
    this.isPlaying = false;
    this._queue.clear();
    clearTimeout(this._justSeekedTimer);
    this._justSeeked = false;
  }

  // ── Accessors ──────────────────────────────────────────────────────────────

  isReady()        { return this.ready; }
  getCurrentTime() { return this.currentTime; }

  on(event, handler)  { this._emitter.on(event, handler); }
  off(event, handler) { this._emitter.off(event, handler); }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  destroy() {
    clearTimeout(this._initTimeout);
    clearTimeout(this._justSeekedTimer);
    this._bridge.destroy();
    this._queue.clear();
    this._emitter.removeAllListeners();
  }

  // ── Private ────────────────────────────────────────────────────────────────

  _markJustSeeked() {
    this._justSeeked = true;
    clearTimeout(this._justSeekedTimer);
    this._justSeekedTimer = setTimeout(() => { this._justSeeked = false; }, 500);
  }
}
