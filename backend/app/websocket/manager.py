from fastapi import WebSocket
from collections import defaultdict


class ConnectionManager:
    def __init__(self):
        # room_id -> {user_id: WebSocket}
        self.rooms: dict[int, dict[int, WebSocket]] = defaultdict(dict)

    def connect(self, room_id: int, user_id: int, ws: WebSocket):
        self.rooms[room_id][user_id] = ws

    def disconnect(self, room_id: int, user_id: int):
        self.rooms[room_id].pop(user_id, None)
        if not self.rooms[room_id]:
            del self.rooms[room_id]

    async def send_to(self, room_id: int, user_id: int, data: dict):
        ws = self.rooms[room_id].get(user_id)
        if ws:
            await ws.send_json(data)

    async def broadcast(self, room_id: int, data: dict, exclude_user_id: int = None):
        dead = []
        for uid, ws in list(self.rooms.get(room_id, {}).items()):
            if uid == exclude_user_id:
                continue
            try:
                await ws.send_json(data)
            except Exception:
                dead.append(uid)
        for uid in dead:
            self.disconnect(room_id, uid)

    async def kick_room(self, room_id: int):
        """Закрывает все WS-соединения в комнате (при удалении комнаты)."""
        for ws in list(self.rooms.get(room_id, {}).values()):
            try:
                await ws.close(code=4010)
            except Exception:
                pass
        self.rooms.pop(room_id, None)

    async def kick_user(self, room_id: int, user_id: int):
        """Выбивает конкретного пользователя из комнаты."""
        ws = self.rooms.get(room_id, {}).get(user_id)
        if ws:
            try:
                await ws.close(code=4011)
            except Exception:
                pass
        self.disconnect(room_id, user_id)

    def get_connected_user_ids(self, room_id: int) -> list[int]:
        return list(self.rooms.get(room_id, {}).keys())


manager = ConnectionManager()
