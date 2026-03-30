import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api from "../api";
import { useAuthStore } from "../store/auth";
import { useThemeStore } from "../store/theme";
import { useWebSocket } from "../hooks/useWebSocket";
import styles from "./RoomPage.module.css";

function postToPlayer(iframe, type, data = {}) {
  iframe?.contentWindow?.postMessage(JSON.stringify({ type, data }), "*");
}

function formatTime(sec) {
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const ss = String(s % 60).padStart(2, "0");
  const mm = String(m % 60).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function makeLog(text) {
  return { type: "log", text, id: `log-${Date.now()}-${Math.random()}` };
}

const ACTION_LABELS = {
  play: (by) => `${by} запустил воспроизведение`,
  pause: (by) => `${by} поставил на паузу`,
  seek: (by, pos) => `${by} перемотал на ${formatTime(pos)}`,
  change_video: (by) => `${by} сменил видео`,
};

const REACTION_EMOJIS = ["❤️", "😂", "😮", "👏", "🔥", "😢"];

export default function RoomPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, token } = useAuthStore();
  const { theme, toggle } = useThemeStore();

  const [room, setRoom] = useState(null);
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [, setPlayerState] = useState(null);
  const [videoInput, setVideoInput] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);
  const [volume, setVolume] = useState(100);
  const [isMuted, setIsMuted] = useState(false);
  const [showJoinOverlay, setShowJoinOverlay] = useState(true);
  const [pendingIsPlaying, setPendingIsPlaying] = useState(false);
  // Новые фичи
  const [reactions, setReactions] = useState([]);
  const [queue, setQueue] = useState([]);
  const [timeline, setTimeline] = useState([]);
  const [chatTab, setChatTab] = useState("chat"); // "chat" | "actions" | "queue"
  const [queueInput, setQueueInput] = useState("");
  const [videoInfo, setVideoInfo] = useState({});

  const chatBottomRef = useRef(null);
  const iframeRef = useRef(null);
  const playerReadyRef = useRef(false);
  const pendingStateRef = useRef(null);
  const isAdminRef = useRef(false);
  const roomRef = useRef(null);
  const currentTimeRef = useRef(0);
  const isPlayingRef = useRef(false);
  const timerRef = useRef(null);
  const displayTimerRef = useRef(null);
  const syncIntervalRef = useRef(null);

  useEffect(() => {
    isAdminRef.current = room?.owner?.id === user?.id;
    roomRef.current = room;
  }, [room, user]);

  function startTimer(fromPosition) {
    clearInterval(timerRef.current);
    clearInterval(displayTimerRef.current);
    currentTimeRef.current = fromPosition;
    isPlayingRef.current = true;
    setCurrentTime(fromPosition);
    setIsPlaying(true);
    timerRef.current = setInterval(() => { currentTimeRef.current += 1; }, 1000);
    displayTimerRef.current = setInterval(() => { setCurrentTime(currentTimeRef.current); }, 500);
  }

  function stopTimer() {
    clearInterval(timerRef.current);
    clearInterval(displayTimerRef.current);
    timerRef.current = null;
    displayTimerRef.current = null;
    isPlayingRef.current = false;
    setIsPlaying(false);
    setCurrentTime(currentTimeRef.current);
  }

  const applyToPlayer = useCallback((action, position = 0, playedAt = null) => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const safePos = isFinite(Number(position)) ? Number(position) : 0;

    if (action === "play") {
      postToPlayer(iframe, "player:play");
      setTimeout(() => {
        let seekPos = safePos;
        if (playedAt && isFinite(Number(playedAt))) {
          seekPos = safePos + Math.max(0, Date.now() / 1000 - Number(playedAt));
        }
        if (!isFinite(seekPos)) seekPos = safePos;
        postToPlayer(iframe, "player:setCurrentTime", { time: seekPos });
        currentTimeRef.current = seekPos;
        startTimer(seekPos);
      }, 800);
    } else if (action === "pause") {
      postToPlayer(iframe, "player:pause");
      currentTimeRef.current = safePos;
      setCurrentTime(safePos);
      stopTimer();
    } else if (action === "seek") {
      postToPlayer(iframe, "player:setCurrentTime", { time: safePos });
      currentTimeRef.current = safePos;
      setCurrentTime(safePos);
    } else if (action === "sync") {
      // Тихая коррекция позиции — учитываем задержку с played_at
      let seekPos = safePos;
      if (playedAt && isFinite(Number(playedAt))) {
        seekPos = safePos + Math.max(0, Date.now() / 1000 - Number(playedAt));
      }
      if (!isFinite(seekPos)) seekPos = safePos;
      postToPlayer(iframe, "player:setCurrentTime", { time: seekPos });
      currentTimeRef.current = seekPos;
      setCurrentTime(seekPos);
    }
  }, []);

  const { send } = useWebSocket(Number(id), token, {
    onMessage: (data) => {
      if (data.type === "init") {
        setMessages(data.chat_history || []);
        setOnlineUsers(data.online_user_ids || []);
        setQueue(data.queue || []);
        setTimeline(data.timeline || []);
        if (data.player_state) {
          setPlayerState(data.player_state);
          pendingStateRef.current = data.player_state;
          setPendingIsPlaying(data.player_state.is_playing === true);
          if (playerReadyRef.current) {
            const s = data.player_state;
            applyToPlayer(s.action, s.position, s.played_at);
            pendingStateRef.current = null;
          }
        }
      } else if (data.type === "chat") {
        setMessages((prev) => [...prev, data]);
      } else if (data.type === "user_joined") {
        setOnlineUsers((prev) => [...new Set([...prev, data.user_id])]);
      } else if (data.type === "user_left") {
        setOnlineUsers((prev) => prev.filter((uid) => uid !== data.user_id));
      } else if (data.type === "player") {
        setPlayerState(data);
        if (data.action === "change_video" && data.video_id) {
          // Обновляем видео для всех — iframe перезагрузится с новым src
          setRoom((prev) => prev ? { ...prev, current_video_id: data.video_id } : prev);
          setTimeline([]);
          playerReadyRef.current = false;
          pendingStateRef.current = null;
          setPendingIsPlaying(false);
        } else if (!isAdminRef.current) {
          if (!playerReadyRef.current) {
            // sync во время рекламы — запоминаем как play чтобы запустить после рекламы
            const pending = data.action === "sync" ? { ...data, action: "play" } : data;
            pendingStateRef.current = pending;
            setPendingIsPlaying(pending.is_playing === true || data.action === "sync");
          } else {
            applyToPlayer(data.action, data.position, data.played_at);
          }
        }
        const label = ACTION_LABELS[data.action];
        if (label) {
          setMessages((prev) => [
            ...prev,
            makeLog(label(data.by || "Админ", data.position)),
          ]);
        }
      } else if (data.type === "reaction") {
        const rid = `r-${Date.now()}-${Math.random()}`;
        const x = Math.floor(Math.random() * 75) + 10;
        setReactions((prev) => [...prev, { id: rid, emoji: data.emoji, x }]);
        setTimeout(() => setReactions((prev) => prev.filter((r) => r.id !== rid)), 2400);
      } else if (data.type === "queue_update") {
        setQueue(data.queue || []);
      } else if (data.type === "timeline_update") {
        setTimeline(data.timeline || []);
      }
    },
  });

  useEffect(() => {
    function handleMessage(event) {
      let data;
      try { data = JSON.parse(event.data); } catch { return; }

      if (data.type === "player:ready") {
        playerReadyRef.current = true;
        if (pendingStateRef.current) {
          const s = pendingStateRef.current;
          applyToPlayer(s.action, s.position, s.played_at);
          pendingStateRef.current = null;
        }
      }
      if (data.type === "player:durationChange" && data.data?.duration) {
        setDuration(data.data.duration);
      }
      if (data.type === "player:currentTime" && data.data?.time !== undefined) {
        currentTimeRef.current = data.data.time;
        if (!isSeeking) setCurrentTime(data.data.time);
      }
      if (isAdminRef.current) {
        if (data.type === "player:play") {
          startTimer(currentTimeRef.current);
          send({ type: "player", action: "play", position: currentTimeRef.current, video_id: roomRef.current?.current_video_id });
        }
        if (data.type === "player:pause") {
          stopTimer();
          send({ type: "player", action: "pause", position: currentTimeRef.current, video_id: roomRef.current?.current_video_id });
        }
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [applyToPlayer, send, isSeeking]);

  async function loadRoom() {
    try {
      const { data } = await api.get(`/rooms/${id}`);
      setRoom(data);
      if (data.current_video_id) setVideoInput(data.current_video_id);
    } catch {
      navigate("/");
    }
  }

  function sendChat() {
    if (!chatInput.trim()) return;
    send({ type: "chat", text: chatInput });
    setChatInput("");
  }

  function adminPlayerAction(action) {
    const position = currentTimeRef.current;
    const iframe = iframeRef.current;
    if (action === "play") { postToPlayer(iframe, "player:play"); startTimer(position); }
    else if (action === "pause") { postToPlayer(iframe, "player:pause"); stopTimer(); }
    send({ type: "player", action, position, video_id: roomRef.current?.current_video_id });
    const label = ACTION_LABELS[action];
    if (label) {
      setMessages((prev) => [...prev, makeLog(label(user?.username || "Вы", position))]);
    }
  }

  function onSeekChange(e) {
    const val = Number(e.target.value);
    setCurrentTime(val);
    currentTimeRef.current = val;
  }

  function onSeekCommit(e) {
    const val = Number(e.target.value);
    setIsSeeking(false);
    postToPlayer(iframeRef.current, "player:setCurrentTime", { time: val });
    currentTimeRef.current = val;
    setCurrentTime(val);
    send({ type: "player", action: "seek", position: val, video_id: roomRef.current?.current_video_id });
    setMessages((prev) => [...prev, makeLog(ACTION_LABELS.seek(user?.username || "Вы", val))]);
  }

  function changeVideo() {
    const trimmed = videoInput.trim();
    if (!trimmed) return;
    playerReadyRef.current = false;
    currentTimeRef.current = 0;
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);
    stopTimer();
    send({ type: "player", action: "change_video", position: 0, video_id: trimmed });
    setRoom((prev) => ({ ...prev, current_video_id: trimmed }));
    setMessages((prev) => [...prev, makeLog(ACTION_LABELS.change_video(user?.username || "Вы"))]);
  }

  function toggleMute() {
    if (isMuted) {
      setIsMuted(false);
      postToPlayer(iframeRef.current, "player:unmute");
      postToPlayer(iframeRef.current, "player:setVolume", { volume: volume / 100 });
    } else {
      setIsMuted(true);
      postToPlayer(iframeRef.current, "player:mute");
    }
  }

  function onVolumeChange(e) {
    const val = Number(e.target.value);
    setVolume(val);
    if (isMuted) {
      setIsMuted(false);
      postToPlayer(iframeRef.current, "player:unmute");
    }
    postToPlayer(iframeRef.current, "player:setVolume", { volume: val / 100 });
  }

  function handleJoin() {
    setShowJoinOverlay(false);
  }

  function sendSync() {
    send({ type: "player", action: "sync", position: currentTimeRef.current, video_id: roomRef.current?.current_video_id });
  }

  function sendReaction(emoji) {
    send({ type: "reaction", emoji, time: currentTimeRef.current });
  }

  function addToQueue() {
    const trimmed = queueInput.trim();
    if (!trimmed) return;
    send({ type: "queue", action: "add", video_id: trimmed });
    setQueueInput("");
  }

  function removeFromQueue(index) {
    send({ type: "queue", action: "remove", index });
  }

  function skipQueue() {
    send({ type: "queue", action: "skip" });
  }

  // Получаем название и превью через backend-прокси (обходим CORS Rutube)
  async function fetchVideoInfo(videoId) {
    if (!videoId || videoInfo[videoId] !== undefined) return;
    setVideoInfo((prev) => ({ ...prev, [videoId]: null })); // null = загружается
    try {
      const { data } = await api.get(`/rooms/video-info/${videoId}`);
      setVideoInfo((prev) => ({
        ...prev,
        [videoId]: { title: data.title || null, thumbnail: data.thumbnail || null },
      }));
    } catch {
      setVideoInfo((prev) => ({ ...prev, [videoId]: { title: null, thumbnail: null } }));
    }
  }

  useEffect(() => {
    queue.forEach((videoId) => {
      if (videoInfo[videoId] === undefined) fetchVideoInfo(videoId);
    });
  }, [queue]); // eslint-disable-line react-hooks/exhaustive-deps

  // Автоматический sync-heartbeat каждые 5 секунд (только админ)
  useEffect(() => {
    syncIntervalRef.current = setInterval(() => {
      if (isAdminRef.current && isPlayingRef.current) {
        send({ type: "player", action: "sync", position: currentTimeRef.current, video_id: roomRef.current?.current_video_id });
      }
    }, 5000);
    return () => clearInterval(syncIntervalRef.current);
  }, [send]);

  useEffect(() => {
    if (chatTab === "chat") chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, chatTab]);

  useEffect(() => { loadRoom(); }, [id]);
  useEffect(() => () => { stopTimer(); }, []);

  if (!room) return <div className={styles.loading}>Загрузка комнаты...</div>;

  const isAdmin = room?.owner?.id === user?.id;
  const embedUrl = room.current_video_id
    ? `https://rutube.ru/play/embed/${room.current_video_id}/${!isAdmin && pendingIsPlaying ? "?autoplay=1" : ""}`
    : null;
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const volumeIcon = isMuted ? "🔇" : volume < 50 ? "🔉" : "🔊";

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerBrand}>
          <img
            src={theme === "dark" ? "/logo-dark.png" : "/logo-light.png"}
            alt="Surf Videos"
            className={styles.logoImg}
          />
        </div>
        <button className={styles.back} onClick={() => navigate("/")}>← Лобби</button>
        {!isAdminRef.current && (
          <button className={styles.btnLeave} onClick={async () => {
            try { await api.delete(`/rooms/${room.id}/leave`); } catch {}
            navigate("/");
          }} title="Покинуть комнату">
            Покинуть
          </button>
        )}
        <span className={styles.roomName}>{room.name}</span>
        {room.invite_code && (
          <span className={styles.code}>Код: <b>{room.invite_code}</b></span>
        )}
        <div className={styles.headerRight}>
          <span className={styles.online}>{onlineUsers.length} онлайн</span>
          <button className={styles.btnTheme} onClick={toggle} title="Сменить тему">
            {theme === "dark" ? "☀" : "🌙"}
          </button>
        </div>
      </header>

      <div className={styles.layout}>
        <div className={styles.playerSection}>
          {embedUrl ? (
            <div className={styles.playerWrapper}>
              {showJoinOverlay ? (
                <div className={styles.joinOverlay} onClick={handleJoin}>
                  <div className={styles.joinBox}>
                    <div className={styles.joinIcon}>▶</div>
                    <div className={styles.joinText}>Нажмите чтобы начать просмотр</div>
                  </div>
                </div>
              ) : (
                <>
                  <iframe
                    ref={iframeRef}
                    src={embedUrl}
                    className={styles.player}
                    allowFullScreen
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                  />
                  <div className={styles.playerOverlay} />
                  {reactions.map((r) => (
                    <div
                      key={r.id}
                      className={styles.flyingEmoji}
                      style={{ left: `${r.x}%` }}
                    >
                      {r.emoji}
                    </div>
                  ))}
                </>
              )}
            </div>
          ) : (
            <div className={styles.playerEmpty}>
              <p>Видео не выбрано</p>
              {isAdmin && <p className={styles.hint}>Введи ID видео Rutube ниже</p>}
            </div>
          )}

          {embedUrl && !showJoinOverlay && (
            <div className={styles.reactionBar}>
              {REACTION_EMOJIS.map((emoji) => (
                <button key={emoji} className={styles.reactionBtn} onClick={() => sendReaction(emoji)}>
                  {emoji}
                </button>
              ))}
            </div>
          )}

          {embedUrl && (
            <div className={styles.customControls}>
              <div className={styles.seekBar}>
                {timeline.length > 0 && duration > 0 && (
                  <div className={styles.timelineBar}>
                    {timeline.map((dot, i) => (
                      <div
                        key={i}
                        className={styles.timelineDot}
                        style={{ left: `${(dot.time / duration) * 100}%` }}
                        title={`${dot.emoji} ${dot.username} · ${formatTime(dot.time)}`}
                      >
                        {dot.emoji}
                      </div>
                    ))}
                  </div>
                )}
                <input
                  type="range" min={0} max={duration || 100} step={1}
                  value={currentTime} disabled={!isAdmin}
                  onChange={onSeekChange}
                  onMouseDown={() => isAdmin && setIsSeeking(true)}
                  onMouseUp={isAdmin ? onSeekCommit : undefined}
                  onTouchEnd={isAdmin ? onSeekCommit : undefined}
                  className={styles.slider}
                  style={{ "--progress": `${progress}%` }}
                />
              </div>

              <div className={styles.controlsRow}>
                <div className={styles.controlsLeft}>
                  {isAdmin && (
                    <>
                      <button className={styles.playBtn}
                        onClick={() => adminPlayerAction(isPlaying ? "pause" : "play")}>
                        {isPlaying ? "⏸" : "▶"}
                      </button>
                      <button className={styles.syncBtn} onClick={sendSync} title="Синхронизировать всех зрителей">
                        ⟳
                      </button>
                    </>
                  )}
                  {!isAdmin && (
                    <span className={styles.viewerStatus}>
                      {isPlaying ? "▶" : "⏸"}
                    </span>
                  )}
                  <span className={styles.timeDisplay}>
                    {formatTime(currentTime)} / {formatTime(duration)}
                  </span>
                </div>

                <div className={styles.volumeControl}>
                  <span className={styles.volumeIcon} onClick={toggleMute} style={{ cursor: "pointer" }}>{volumeIcon}</span>
                  <input
                    type="range" min={0} max={100} step={1}
                    value={volume}
                    onChange={onVolumeChange}
                    className={`${styles.slider} ${styles.volumeSlider}`}
                    style={{ "--progress": `${volume}%` }}
                  />
                </div>
              </div>
            </div>
          )}

          {isAdmin && (
            <div className={styles.videoInputRow}>
              <input
                className={styles.input}
                placeholder="ID видео Rutube"
                value={videoInput}
                onChange={e => setVideoInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && changeVideo()}
              />
              <button className={styles.btn} onClick={changeVideo}>Загрузить</button>
              <span className={styles.videoHint}>
                ID из URL: rutube.ru/video/<b>xxxxxxxx</b>/
              </span>
            </div>
          )}
        </div>

        <div className={styles.chatSection}>
          <div className={styles.chatTabs}>
            <button
              className={`${styles.chatTab} ${chatTab === "chat" ? styles.chatTabActive : ""}`}
              onClick={() => setChatTab("chat")}
            >
              Чат
            </button>
            <button
              className={`${styles.chatTab} ${chatTab === "actions" ? styles.chatTabActive : ""}`}
              onClick={() => setChatTab("actions")}
            >
              Действия
            </button>
            <button
              className={`${styles.chatTab} ${chatTab === "queue" ? styles.chatTabActive : ""}`}
              onClick={() => setChatTab("queue")}
            >
              Очередь{queue.length > 0 && <span className={styles.queueBadge}>{queue.length}</span>}
            </button>
          </div>

          {chatTab === "chat" && (
            <>
              <div className={styles.chatMessages}>
                {messages.filter((m) => m.type !== "log").map((m, i) => (
                  <div key={m.id || i} className={`${styles.message} ${m.user_id === user?.id ? styles.own : ""}`}>
                    <span className={styles.msgUser}>{m.username}</span>
                    <span className={styles.msgText}>{m.text}</span>
                  </div>
                ))}
                <div ref={chatBottomRef} />
              </div>
              <div className={styles.chatInput}>
                <input
                  className={styles.input}
                  placeholder="Написать сообщение..."
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && sendChat()}
                />
                <button className={styles.btn} onClick={sendChat}>→</button>
              </div>
            </>
          )}

          {chatTab === "actions" && (
            <div className={styles.actionsPanel}>
              {messages.filter((m) => m.type === "log").length === 0 ? (
                <div className={styles.queueEmpty}>Нет действий</div>
              ) : (
                messages.filter((m) => m.type === "log").map((m, i) => (
                  <div key={m.id || i} className={styles.actionItem}>
                    {m.text}
                  </div>
                ))
              )}
            </div>
          )}

          {chatTab === "queue" && (
            <div className={styles.queuePanel}>
              {queue.length === 0 ? (
                <div className={styles.queueEmpty}>Очередь пуста</div>
              ) : (
                <div className={styles.queueList}>
                  {queue.map((videoId, i) => {
                    const info = videoInfo[videoId];
                    return (
                      <div key={i} className={styles.queueItem}>
                        <span className={styles.queueIndex}>{i + 1}</span>
                        {info?.thumbnail ? (
                          <img className={styles.queueThumb} src={info.thumbnail} alt="" loading="lazy" />
                        ) : (
                          <div className={styles.queueThumbPlaceholder} />
                        )}
                        <div className={styles.queueInfo}>
                          <span className={styles.queueTitle}>
                            {info === undefined ? "Загрузка..." : (info?.title || videoId)}
                          </span>
                          {info?.title && (
                            <span className={styles.queueVideoId}>{videoId}</span>
                          )}
                        </div>
                        {isAdmin && (
                          <button className={styles.queueRemoveBtn} onClick={() => removeFromQueue(i)} title="Удалить">✕</button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {isAdmin && (
                <div className={styles.queueControls}>
                  <button className={`${styles.btn} ${styles.btnSkip}`} onClick={skipQueue} disabled={queue.length === 0}>
                    ⏭ Следующее
                  </button>
                  <div className={styles.queueInputRow}>
                    <input
                      className={styles.input}
                      placeholder="ID видео Rutube"
                      value={queueInput}
                      onChange={e => setQueueInput(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && addToQueue()}
                    />
                    <button className={styles.btn} onClick={addToQueue}>+</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
