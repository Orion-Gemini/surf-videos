import { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api from "../api";
import { useAuthStore } from "../store/auth";
import { useThemeStore } from "../store/theme";
import { useWebSocket } from "../hooks/useWebSocket";
import { usePlayer } from "../player/usePlayer";
import styles from "./RoomPage.module.css";

function formatTime(sec) {
  if (!isFinite(sec) || sec < 0) return "00:00";
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
  const [volume, setVolume] = useState(100);
  const [isMuted, setIsMuted] = useState(false);
  const [showJoinOverlay, setShowJoinOverlay] = useState(true);
  const [showSyncOverlay, setShowSyncOverlay] = useState(false);
  // Новые фичи
  const [reactions, setReactions] = useState([]);
  const [queue, setQueue] = useState([]);
  const [timeline, setTimeline] = useState([]);
  const [chatTab, setChatTab] = useState("chat"); // "chat" | "actions" | "queue"
  const [chatIndicator, setChatIndicator] = useState({ left: 0, width: 0 });
  const chatTabRefs = useRef({});
  const [isSyncing, setIsSyncing] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [isWaiting, setIsWaiting] = useState(false);
  const [readyUsers, setReadyUsers] = useState([]);
  const [isReady, setIsReady] = useState(false);
  const [countdownVal, setCountdownVal] = useState(null);
  const countdownRef = useRef(null);
  const [onlineUsersData, setOnlineUsersData] = useState([]);
  const [mutedUserIds, setMutedUserIds] = useState([]);
  const [isChatMuted, setIsChatMuted] = useState(false);
  const [queueInput, setQueueInput] = useState("");
  const [videoInfo, setVideoInfo] = useState({});
  const [isCinema, setIsCinema] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const hideControlsTimerRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isChatOverlay, setIsChatOverlay] = useState(false);
  const [overlayMessages, setOverlayMessages] = useState([]);
  const isChatOverlayRef = useRef(false);
  const isFullscreenRef = useRef(false);
  const pageRef = useRef(null);

  const chatBottomRef = useRef(null);
  const iframeRef = useRef(null);
  const pendingStateRef = useRef(null);
  const isAdminRef = useRef(false);
  const suppressPlayRef = useRef(false);
  const suppressPauseRef = useRef(false);
  const applyTimeoutRef = useRef(null);
  const roomRef = useRef(null);
  const currentTimeRef = useRef(0);
  const isPlayingRef = useRef(false);
  const isSeekingRef = useRef(false);
  const timerRef = useRef(null);
  const syncIntervalRef = useRef(null);
  const joinLeaveTimers = useRef({});
  const avatarCache = useRef({});
  const userInfoCache = useRef({});

  roomRef.current = room;

  // ── Player controller ────────────────────────────────────────────────────
  // Handlers are read via handlersRef inside usePlayer, so closures are always
  // fresh even though send/applyToPlayer are defined further below.
  const { controllerRef } = usePlayer(iframeRef, !showJoinOverlay, {
    onReady: () => {
      if (pendingStateRef.current) {
        const s = pendingStateRef.current;
        applyToPlayer(s.action, s.position, s.played_at);
        pendingStateRef.current = null;
        clearTimeout(applyTimeoutRef.current);
        applyTimeoutRef.current = setTimeout(() => setShowSyncOverlay(false), 600);
      } else {
        setShowSyncOverlay(false);
      }
    },
    onDuration: (d) => { if (d?.duration) setDuration(d.duration); },
    onCurrentTime: (d) => {
      if (!isSeekingRef.current && d?.time !== undefined) {
        currentTimeRef.current = d.time;
      }
    },
    onPlay: () => {
      if (!isAdminRef.current) return;
      if (suppressPlayRef.current) { suppressPlayRef.current = false; return; }
      startTimer(currentTimeRef.current);
      send({ type: "player", action: "play", position: currentTimeRef.current, video_id: roomRef.current?.current_video_id });
    },
    onPause: () => {
      if (!isAdminRef.current) return;
      if (suppressPauseRef.current) { suppressPauseRef.current = false; return; }
      stopTimer();
      send({ type: "player", action: "pause", position: currentTimeRef.current, video_id: roomRef.current?.current_video_id });
    },
  });

  function startTimer(fromPosition) {
    clearInterval(timerRef.current);
    const startedAt = Date.now();
    currentTimeRef.current = fromPosition;
    isPlayingRef.current = true;
    setCurrentTime(fromPosition);
    setIsPlaying(true);
    let lastDisplayUpdate = Date.now();
    timerRef.current = setInterval(() => {
      currentTimeRef.current = fromPosition + (Date.now() - startedAt) / 1000;
      const now = Date.now();
      if (!isSeekingRef.current && now - lastDisplayUpdate >= 250) {
        lastDisplayUpdate = now;
        setCurrentTime(currentTimeRef.current);
      }
    }, 100);
  }

  function stopTimer() {
    clearInterval(timerRef.current);
    timerRef.current = null;
    isPlayingRef.current = false;
    setIsPlaying(false);
    setCurrentTime(currentTimeRef.current);
  }

  const applyToPlayer = useCallback((action, position = 0, playedAt = null) => {
    const ctrl = controllerRef.current;
    if (!ctrl) return;

    const safePos = isFinite(Number(position)) ? Number(position) : 0;

    if (action === "play") {
      ctrl.send("player:play");
      // 800мс при первой загрузке (Rutube нужно время до ready), 300мс если плеер уже запущен
      const seekDelay = ctrl.isReady() ? 300 : 800;
      clearTimeout(applyTimeoutRef.current);
      applyTimeoutRef.current = setTimeout(() => {
        let seekPos = safePos;
        if (playedAt && isFinite(Number(playedAt))) {
          seekPos = safePos + Math.max(0, Date.now() / 1000 - Number(playedAt));
        }
        if (!isFinite(seekPos)) seekPos = safePos;
        ctrl.seekTo(seekPos);
        currentTimeRef.current = seekPos;
        startTimer(seekPos);
      }, seekDelay);
    } else if (action === "pause") {
      ctrl.pause();
      currentTimeRef.current = safePos;
      setCurrentTime(safePos);
      stopTimer();
    } else if (action === "seek") {
      ctrl.seekTo(safePos);
      currentTimeRef.current = safePos;
      setCurrentTime(safePos);
    } else if (action === "sync") {
      let seekPos = safePos;
      if (playedAt && isFinite(Number(playedAt))) {
        seekPos = safePos + Math.max(0, Date.now() / 1000 - Number(playedAt));
      }
      if (!isFinite(seekPos)) seekPos = safePos;
      // Только если рассинхрон значительный (> 0.5с), чтобы не дёргать при heartbeat
      const drift = Math.abs(seekPos - currentTimeRef.current);
      if (drift > 0.5) {
        ctrl.seekTo(seekPos);
        currentTimeRef.current = seekPos;
        setCurrentTime(seekPos);
        if (isPlayingRef.current) startTimer(seekPos);
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const { send } = useWebSocket(Number(id), token, {
    onMessage: (data) => {
      if (data.type === "init") {
        (data.chat_history || []).forEach(m => {
          if (m.avatar && m.user_id) avatarCache.current[m.user_id] = m.avatar;
        });
        (data.online_users || []).forEach(u => {
          userInfoCache.current[u.id] = { username: u.username, avatar: u.avatar };
          if (u.avatar) avatarCache.current[u.id] = u.avatar;
        });
        setMessages(data.chat_history || []);
        setOnlineUsers(data.online_user_ids || []);
        setOnlineUsersData(data.online_users || []);
        setMutedUserIds(data.muted_user_ids || []);
        if (user?.id && (data.muted_user_ids || []).includes(user.id)) setIsChatMuted(true);
        setQueue(data.queue || []);
        setTimeline(data.timeline || []);
        if (data.is_waiting) {
          setIsWaiting(true);
          setReadyUsers(data.ready_users || []);
          setIsReady((data.ready_users || []).some(u => u.id === user?.id));
        }
        if (data.player_state) {
          setPlayerState(data.player_state);
          pendingStateRef.current = data.player_state;
          if (controllerRef.current?.isReady()) {
            const s = data.player_state;
            applyToPlayer(s.action, s.position, s.played_at);
            pendingStateRef.current = null;
          }
        }
      } else if (data.type === "chat") {
        if (data.avatar && data.user_id) avatarCache.current[data.user_id] = data.avatar;
        setMessages((prev) => [...prev, data]);
        if (isChatOverlayRef.current) {
          const om = { ...data, _oid: Date.now() + Math.random() };
          setOverlayMessages(prev => [...prev.slice(-4), om]);
          setTimeout(() => setOverlayMessages(prev => prev.filter(m => m._oid !== om._oid)), 4500);
        }
      } else if (data.type === "user_joined") {
        if (data.avatar && data.user_id) avatarCache.current[data.user_id] = data.avatar;
        userInfoCache.current[data.user_id] = { username: data.username, avatar: data.avatar };
        setOnlineUsers((prev) => [...new Set([...prev, data.user_id])]);
        setOnlineUsersData((prev) => {
          if (prev.some(u => u.id === data.user_id)) return prev;
          return [...prev, { id: data.user_id, username: data.username, avatar: data.avatar }];
        });
        if (data.user_id !== user?.id) {
          clearTimeout(joinLeaveTimers.current[data.user_id]);
          joinLeaveTimers.current[data.user_id] = setTimeout(() => {
            delete joinLeaveTimers.current[data.user_id];
            setMessages((prev) => [...prev, { type: "join", text: `${data.username} вошёл в комнату`, id: `join-${Date.now()}` }]);
          }, 800);
        }
      } else if (data.type === "user_left") {
        setOnlineUsers((prev) => prev.filter((uid) => uid !== data.user_id));
        setOnlineUsersData((prev) => prev.filter((u) => u.id !== data.user_id));
        if (data.user_id !== user?.id) {
          clearTimeout(joinLeaveTimers.current[data.user_id]);
          joinLeaveTimers.current[data.user_id] = setTimeout(() => {
            delete joinLeaveTimers.current[data.user_id];
            setMessages((prev) => [...prev, { type: "leave", text: `${data.username} покинул комнату`, id: `leave-${Date.now()}` }]);
          }, 800);
        }
      } else if (data.type === "moderated") {
        if (data.action === "mute") {
          setMutedUserIds((prev) => [...new Set([...prev, data.user_id])]);
          if (data.user_id === user?.id) {
            setIsChatMuted(true);
            setMessages((prev) => [...prev, makeLog("Вы замучены администратором")]);
          } else if (data.username) {
            setMessages((prev) => [...prev, makeLog(`${data.username} замучен`)]);
          }
        } else if (data.action === "unmute") {
          setMutedUserIds((prev) => prev.filter(id => id !== data.user_id));
          if (data.user_id === user?.id) {
            setIsChatMuted(false);
            setMessages((prev) => [...prev, makeLog("Вы размучены")]);
          } else if (data.username) {
            setMessages((prev) => [...prev, makeLog(`${data.username} размучен`)]);
          }
        } else if (data.action === "kick") {
          if (data.user_id === user?.id) {
            goTo("/");
          } else if (data.username) {
            setOnlineUsers((prev) => prev.filter(uid => uid !== data.user_id));
            setOnlineUsersData((prev) => prev.filter(u => u.id !== data.user_id));
            setMessages((prev) => [...prev, makeLog(`${data.username} выкинут из комнаты`)]);
          }
        }
      } else if (data.type === "ready_update") {
        setReadyUsers(data.ready_users || []);
        setIsWaiting((prev) => prev || (data.ready_users?.length > 0));
        if (user?.id && (data.ready_users || []).some(u => u.id === user.id)) {
          setIsReady(true);
        }
      } else if (data.type === "countdown") {
        setIsWaiting(false);
        setIsReady(false);
        setReadyUsers([]);
        clearInterval(countdownRef.current);
        setCountdownVal(3);
        let n = 3;
        countdownRef.current = setInterval(() => {
          n -= 1;
          if (n <= 0) {
            clearInterval(countdownRef.current);
            setCountdownVal(null);
            if (isAdminRef.current) {
              const pos = 0;
              suppressPlayRef.current = true;
              send({ type: "player", action: "play", position: pos, video_id: roomRef.current?.current_video_id });
              controllerRef.current?.send("player:play");
              startTimer(pos);
            }
          } else {
            setCountdownVal(n);
          }
        }, 1000);
      } else if (data.type === "player") {
        setPlayerState(data);
        if (data.action === "play") {
          setIsWaiting(false);
          setCountdownVal(null);
          clearInterval(countdownRef.current);
        }
        if (data.action === "change_video" && data.video_id) {
          // Обновляем видео для всех — iframe перезагрузится с новым src
          setRoom((prev) => prev ? { ...prev, current_video_id: data.video_id } : prev);
          setTimeline([]);
          setIsReady(false);
          setReadyUsers([]);
          setIsWaiting(true);
          setShowJoinOverlay(true);
          controllerRef.current?.reset();
          pendingStateRef.current = null;
        } else if (!isAdminRef.current) {
          if (!controllerRef.current?.isReady()) {
            // sync во время рекламы — запоминаем как play чтобы запустить после рекламы
            const pending = data.action === "sync" ? { ...data, action: "play" } : data;
            pendingStateRef.current = pending;
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


  async function loadRoom() {
    try {
      const { data } = await api.get(`/rooms/${id}`);
      setRoom(data);
      if (data.current_video_id) setVideoInput(data.current_video_id);
    } catch {
      goTo("/");
    }
  }

  function sendChat() {
    if (!chatInput.trim()) return;
    send({ type: "chat", text: chatInput });
    setChatInput("");
  }

  function adminPlayerAction(action) {
    const position = currentTimeRef.current;
    const ctrl = controllerRef.current;
    if (action === "play") { suppressPlayRef.current = true; ctrl?.send("player:play"); startTimer(position); }
    else if (action === "pause") { suppressPauseRef.current = true; ctrl?.pause(); stopTimer(); }
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
    isSeekingRef.current = false;
    controllerRef.current?.seekTo(val);
    currentTimeRef.current = val;
    if (isPlayingRef.current) {
      startTimer(val);
    } else {
      setCurrentTime(val);
    }
    send({ type: "player", action: "seek", position: val, video_id: roomRef.current?.current_video_id });
    setMessages((prev) => [...prev, makeLog(ACTION_LABELS.seek(user?.username || "Вы", val))]);
  }

  function changeVideo() {
    const trimmed = videoInput.trim();
    if (!trimmed) return;
    controllerRef.current?.reset();
    currentTimeRef.current = 0;
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);
    stopTimer();
    setIsWaiting(true);
    setIsReady(false);
    setReadyUsers([]);
    setCountdownVal(null);
    clearInterval(countdownRef.current);
    send({ type: "player", action: "change_video", position: 0, video_id: trimmed });
    setRoom((prev) => prev ? { ...prev, current_video_id: trimmed } : prev);
    setMessages((prev) => [...prev, makeLog(ACTION_LABELS.change_video(user?.username || "Вы"))]);
  }

  function toggleMute() {
    const ctrl = controllerRef.current;
    if (isMuted) {
      setIsMuted(false);
      ctrl?.setMuted(false);
      ctrl?.setVolume(volume / 100);
    } else {
      setIsMuted(true);
      ctrl?.setMuted(true);
    }
  }

  function onVolumeChange(e) {
    const val = Number(e.target.value);
    setVolume(val);
    if (isMuted) {
      setIsMuted(false);
      controllerRef.current?.setMuted(false);
    }
    controllerRef.current?.setVolume(val / 100);
  }

  function handleJoin() {
    // Подавляем autoplay echo у админа — не рассылаем WS play от начала видео
    if (isAdminRef.current) suppressPlayRef.current = true;
    // Показываем sync overlay пока iframe не перемотается на нужную позицию
    if (pendingStateRef.current) setShowSyncOverlay(true);
    setShowJoinOverlay(false);
  }

  function goTo(path) {
    setLeaving(true);
    setTimeout(() => navigate(path), 220);
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      pageRef.current?.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }

  function onCinemaMouseMove() {
    if (!isCinema && !isFullscreenRef.current && !document.fullscreenElement) return;
    setShowControls(true);
    clearTimeout(hideControlsTimerRef.current);
    hideControlsTimerRef.current = setTimeout(() => setShowControls(false), 3000);
  }

  function onCinemaMouseLeave() {
    if (!isCinema && !isFullscreenRef.current && !document.fullscreenElement) return;
    clearTimeout(hideControlsTimerRef.current);
    hideControlsTimerRef.current = setTimeout(() => setShowControls(false), 2500);
  }

  function sendSync() {
    send({ type: "player", action: "sync", position: currentTimeRef.current, video_id: roomRef.current?.current_video_id });
    setIsSyncing(true);
    setTimeout(() => setIsSyncing(false), 600);
  }

  function sendModeration(action, targetUserId) {
    send({ type: "moderation", action, user_id: targetUserId });
  }

  function sendReady() {
    send({ type: "ready" });
    setIsReady(true);
  }

  function startCountdown() {
    send({ type: "countdown" });
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
    }, 3000);
    return () => clearInterval(syncIntervalRef.current);
  }, [send]);

  useEffect(() => {
    if (chatTab === "chat") chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, chatTab]);

  useLayoutEffect(() => {
    const btn = chatTabRefs.current[chatTab];
    if (btn) setChatIndicator({ left: btn.offsetLeft, width: btn.offsetWidth });
  }, [chatTab]);

  useEffect(() => { isChatOverlayRef.current = isChatOverlay; }, [isChatOverlay]);

  useEffect(() => {
    function onFsChange() {
      const fs = !!document.fullscreenElement;
      isFullscreenRef.current = fs;
      setIsFullscreen(fs);
      if (!fs) { setIsChatOverlay(false); setOverlayMessages([]); }
      if (fs) {
        clearTimeout(hideControlsTimerRef.current);
        setShowControls(true);
        hideControlsTimerRef.current = setTimeout(() => setShowControls(false), 3000);
      }
    }

    // document-уровень: iframe не может перехватить эти события
    function onFsMouseMove() {
      if (!isFullscreenRef.current) return;
      setShowControls(true);
      clearTimeout(hideControlsTimerRef.current);
      hideControlsTimerRef.current = setTimeout(() => setShowControls(false), 3000);
    }

    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("mousemove", onFsMouseMove);
    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
      document.removeEventListener("mousemove", onFsMouseMove);
    };
  }, []);

  useEffect(() => { loadRoom(); }, [id]);
  useEffect(() => () => {
    stopTimer();
    clearTimeout(applyTimeoutRef.current);
    clearInterval(countdownRef.current);
    Object.values(joinLeaveTimers.current).forEach(clearTimeout);
    clearTimeout(hideControlsTimerRef.current);
  }, []);

  if (!room) return <div className={styles.loading}>Загрузка комнаты...</div>;

  const isAdmin = room?.owner?.id === user?.id || user?.is_superuser === true;
  isAdminRef.current = isAdmin;
  const embedUrl = room.current_video_id
    ? `https://rutube.ru/play/embed/${room.current_video_id}/?autoplay=1`
    : null;
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const volumeIcon = isMuted ? "🔇" : volume < 50 ? "🔉" : "🔊";

  return (
    <div ref={pageRef} className={`${styles.page}${leaving ? ` ${styles.pageFadeOut}` : ""}${isCinema ? ` ${styles.cinemaMode}` : ""}${isFullscreen ? ` ${styles.fullscreenMode}` : ""}`} onMouseMove={onCinemaMouseMove}>

      {isFullscreen && (
        <button
          className={`${styles.overlayToggleBtn}${isChatOverlay ? ` ${styles.overlayToggleBtnActive}` : ""}`}
          onClick={() => setIsChatOverlay(c => !c)}
          title={isChatOverlay ? "Скрыть оверлей чата" : "Включить оверлей чата"}
        >
          💬 {isChatOverlay ? "Скрыть чат" : "Оверлей чата"}
        </button>
      )}

      {isFullscreen && isChatOverlay && overlayMessages.length > 0 && (
        <div className={styles.chatOverlayMessages}>
          {overlayMessages.map(m => (
            <div key={m._oid} className={styles.chatOverlayMsg}>
              <span className={styles.chatOverlayUser}>{m.username}</span>
              <span className={styles.chatOverlayText}>{m.text}</span>
            </div>
          ))}
        </div>
      )}
      <header className={styles.header}>
        <div className={styles.headerBrand}>
          <img
            src={theme === "dark" ? "/logo-dark.png" : "/logo-light.png"}
            alt="Surf Videos"
            className={styles.logoImg}
          />
        </div>
        <button className={styles.back} onClick={() => goTo("/")}>← Лобби</button>
        {!isAdminRef.current && (
          <button className={styles.btnLeave} onClick={async () => {
            try { await api.delete(`/rooms/${room.id}/leave`); } catch {}
            goTo("/");
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
          <button className={styles.btnTheme} onClick={(e) => toggle(e)} title="Сменить тему">
            {theme === "dark" ? "☀" : "🌙"}
          </button>
        </div>
      </header>

      <div className={styles.layout}>
        <div
          className={`${styles.playerSection}${(isCinema || isFullscreen) && showControls ? ` ${styles.showControls}` : ""}`}
          onMouseMove={onCinemaMouseMove}
          onMouseLeave={onCinemaMouseLeave}
        >
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
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  />
                  <div className={styles.playerOverlay} />
                  {showSyncOverlay && <div className={styles.syncOverlay} />}
                  {countdownVal !== null && (
                    <div className={styles.countdownOverlay}>
                      <div key={countdownVal} className={styles.countdownNum}>{countdownVal}</div>
                    </div>
                  )}
                  {isWaiting && countdownVal === null && (
                    <div className={styles.waitingOverlay}>
                      <div className={styles.waitingCard}>
                        <div className={styles.waitingIcon}>📺</div>
                        <h3 className={styles.waitingTitle}>Реклама перед видео?</h3>
                        <p className={styles.waitingHint}>
                          Дождитесь конца рекламы и нажмите&nbsp;<b>Готов</b>
                        </p>
                        <div className={styles.readyList}>
                          {readyUsers.map(u => (
                            <div key={u.id} className={styles.readyUser}>
                              <span className={styles.readyCheck}>✅</span>
                              <span>{u.username}</span>
                            </div>
                          ))}
                          {Array.from({ length: Math.max(0, onlineUsers.length - readyUsers.length) }).map((_, i) => (
                            <div key={`pending-${i}`} className={styles.readyUser}>
                              <span className={styles.readyCheck}>⌛</span>
                              <span className={styles.readyPending}>ждёт...</span>
                            </div>
                          ))}
                        </div>
                        <div className={styles.waitingCounter}>
                          {readyUsers.length} из {onlineUsers.length} готовы
                        </div>
                        {!isAdmin && !isReady && (
                          <button className={styles.btnReady} onClick={sendReady}>✓ Я готов</button>
                        )}
                        {!isAdmin && isReady && (
                          <div className={styles.readyConfirm}>Ждём остальных...</div>
                        )}
                        {isAdmin && (
                          <button className={styles.btnStartAll} onClick={startCountdown}>▶ Начать для всех</button>
                        )}
                      </div>
                    </div>
                  )}
                  {reactions.map((r) => (
                    <div key={r.id} className={styles.flyingEmoji} style={{ left: `${r.x}%` }}>
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

          {(isCinema || isFullscreen) && (
            <div className={styles.cinemaMouseCatcher} onMouseMove={onCinemaMouseMove} />
          )}

          <div
            className={styles.reactionBar}
            onMouseEnter={() => clearTimeout(hideControlsTimerRef.current)}
          >
            {REACTION_EMOJIS.map((emoji) => (
              <button key={emoji} className={styles.reactionBtn} onClick={() => sendReaction(emoji)}>
                {emoji}
              </button>
            ))}
          </div>
          <div
            className={styles.customControls}
            onMouseEnter={() => clearTimeout(hideControlsTimerRef.current)}
          >
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
                onMouseDown={() => { if (isAdmin) { isSeekingRef.current = true; } }}
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
                    <button className={styles.playBtn} onClick={() => adminPlayerAction(isPlaying ? "pause" : "play")}>
                      <span key={isPlaying ? "pause" : "play"} className={styles.playIcon}>
                        {isPlaying ? "⏸" : "▶"}
                      </span>
                    </button>
                    <button
                      className={`${styles.syncBtn}${isSyncing ? ` ${styles.syncBtnSpin}` : ""}`}
                      onClick={sendSync}
                      title="Синхронизировать всех зрителей"
                    >⟳</button>
                  </>
                )}
                {!isAdmin && <span className={styles.viewerStatus}>{isPlaying ? "▶" : "⏸"}</span>}
                <span className={styles.timeDisplay}>{formatTime(currentTime)} / {formatTime(duration)}</span>
              </div>
              <div className={styles.controlsRight}>
                <div className={styles.volumeControl}>
                  <span className={styles.volumeIcon} onClick={toggleMute} style={{ cursor: "pointer" }}>{volumeIcon}</span>
                  <input
                    type="range" min={0} max={100} step={1}
                    value={volume} onChange={onVolumeChange}
                    className={`${styles.slider} ${styles.volumeSlider}`}
                    style={{ "--progress": `${volume}%` }}
                  />
                </div>
                <button className={styles.cinemaBtn} onClick={() => setIsCinema(c => !c)} title={isCinema ? "Выйти из режима кинотеатра" : "Режим кинотеатра"}>
                  <span className={isCinema ? styles.cinemaBtnIconExit : styles.cinemaBtnIcon} />
                </button>
                <button className={styles.fullscreenBtn} onClick={toggleFullscreen} title={isFullscreen ? "Выйти из полного экрана" : "Полный экран"}>
                  <span className={isFullscreen ? styles.fullscreenBtnIconExit : styles.fullscreenBtnIcon} />
                </button>
              </div>
            </div>
          </div>

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
            <div
              className={styles.chatTabIndicator}
              style={{ left: chatIndicator.left, width: chatIndicator.width }}
            />
            <button
              ref={el => chatTabRefs.current["chat"] = el}
              className={`${styles.chatTab} ${chatTab === "chat" ? styles.chatTabActive : ""}`}
              onClick={() => setChatTab("chat")}
            >
              Чат
            </button>
            <button
              ref={el => chatTabRefs.current["actions"] = el}
              className={`${styles.chatTab} ${chatTab === "actions" ? styles.chatTabActive : ""}`}
              onClick={() => setChatTab("actions")}
            >
              Действия
            </button>
            <button
              ref={el => chatTabRefs.current["queue"] = el}
              className={`${styles.chatTab} ${chatTab === "queue" ? styles.chatTabActive : ""}`}
              onClick={() => setChatTab("queue")}
            >
              Очередь{queue.length > 0 && <span className={styles.queueBadge}>{queue.length}</span>}
            </button>
            <button
              ref={el => chatTabRefs.current["users"] = el}
              className={`${styles.chatTab} ${chatTab === "users" ? styles.chatTabActive : ""}`}
              onClick={() => setChatTab("users")}
            >
              Участники
</button>
          </div>

          {chatTab === "chat" && (
            <>
              <div className={styles.chatMessages}>
                {messages.filter((m) => m.type !== "log").map((m, i) => (
                  m.type === "join" || m.type === "leave" ? (
                    <div key={m.id || i} className={styles.joinLeaveMsg}>{m.text}</div>
                  ) : (
                    <div key={m.id || i} className={`${styles.message} ${m.user_id === user?.id ? styles.own : ""}`}>
                      {m.user_id !== user?.id && (
                        <div className={styles.msgAvatar}>
                          {avatarCache.current[m.user_id]
                            ? <img src={avatarCache.current[m.user_id]} className={styles.msgAvatarImg} alt="" />
                            : <div className={styles.msgAvatarInitials}>{m.username?.slice(0, 2).toUpperCase()}</div>
                          }
                        </div>
                      )}
                      <div className={styles.msgContent}>
                        <span className={styles.msgUser}>{m.username}</span>
                        <span className={styles.msgText}>{m.text}</span>
                      </div>
                    </div>
                  )
                ))}
                <div ref={chatBottomRef} />
              </div>
              <div className={styles.chatInput}>
                {isChatMuted ? (
                  <div className={styles.mutedNotice}>🔇 Вы замучены администратором</div>
                ) : (
                  <>
                    <input
                      className={styles.input}
                      placeholder="Написать сообщение..."
                      value={chatInput}
                      onChange={e => setChatInput(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && sendChat()}
                    />
                    <button className={styles.btn} onClick={sendChat}>→</button>
                  </>
                )}
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

          {chatTab === "users" && (
            <div className={styles.usersPanel}>
              {onlineUsersData.length === 0 ? (
                <div className={styles.queueEmpty}>Нет участников</div>
              ) : (
                <div className={styles.usersList}>
                  {onlineUsersData.map(u => {
                    const isOwner = room?.owner?.id === u.id;
                    const isSelf = u.id === user?.id;
                    const muted = mutedUserIds.includes(u.id);
                    return (
                      <div key={u.id} className={`${styles.userItem} ${muted ? styles.userItemMuted : ""}`}>
                        <div className={styles.userItemAvatar}>
                          {avatarCache.current[u.id]
                            ? <img src={avatarCache.current[u.id]} className={styles.userItemAvatarImg} alt="" />
                            : <div className={styles.userItemAvatarInitials}>{u.username?.slice(0, 2).toUpperCase()}</div>
                          }
                        </div>
                        <div className={styles.userItemInfo}>
                          <span className={styles.userItemName}>
                            {u.username}
                            {isSelf && <span className={styles.userItemSelf}> (вы)</span>}
                          </span>
                          {isOwner && <span className={styles.userItemBadge}>👑 хост</span>}
                          {muted && <span className={styles.userItemBadgeMuted}>🔇 мут</span>}
                        </div>
                        {isAdmin && !isSelf && (!isOwner || user?.is_superuser) && (
                          <div className={styles.userItemActions}>
                            <button
                              className={styles.btnMod}
                              onClick={() => sendModeration(muted ? "unmute" : "mute", u.id)}
                              title={muted ? "Снять мут" : "Замутить"}
                            >
                              {muted ? "🔊" : "🔇"}
                            </button>
                            <button
                              className={`${styles.btnMod} ${styles.btnKick}`}
                              onClick={() => sendModeration("kick", u.id)}
                              title="Выкинуть"
                            >
                              ✕
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
