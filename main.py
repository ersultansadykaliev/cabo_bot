import asyncio
import json
from contextlib import suppress
from typing import Dict, Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from game_logic import GameState

app = FastAPI()
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

# Global games dict: room_id -> GameState
games: Dict[str, GameState] = {}

# Track host per room (first player to create/join)
room_hosts: Dict[str, str] = {}


class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, Dict[str, WebSocket]] = {}

    async def connect(self, websocket: WebSocket, room_id: str, client_id: str):
        await websocket.accept()
        if room_id not in self.active_connections:
            self.active_connections[room_id] = {}
        self.active_connections[room_id][client_id] = websocket

    def disconnect(self, room_id: str, client_id: str):
        if room_id in self.active_connections:
            if client_id in self.active_connections[room_id]:
                del self.active_connections[room_id][client_id]
            if not self.active_connections[room_id]:
                del self.active_connections[room_id]

    async def broadcast_game_state(self, room_id: str, game_state: GameState):
        if room_id not in self.active_connections:
            return
        stale_clients = []
        for cid, connection in list(self.active_connections[room_id].items()):
            try:
                host = room_hosts.get(room_id)
                state_data = game_state.get_client_state(cid, host_id=host)
                state_data["type"] = "game_state"
                await connection.send_text(json.dumps(state_data))
            except Exception:
                stale_clients.append(cid)
        for cid in stale_clients:
            self.disconnect(room_id, cid)

    async def broadcast_system(self, room_id: str, message: str):
        if room_id not in self.active_connections:
            return
        stale_clients = []
        for cid, connection in list(self.active_connections[room_id].items()):
            try:
                await connection.send_text(json.dumps({"type": "system", "message": message}))
            except Exception:
                stale_clients.append(cid)
        for cid in stale_clients:
            self.disconnect(room_id, cid)


manager = ConnectionManager()
turn_timer_tasks: Dict[str, asyncio.Task] = {}


async def room_turn_timer(room_id: str):
    try:
        while True:
            await asyncio.sleep(1)
            game = games.get(room_id)
            if not game:
                break
            timeout_message = game.check_turn_timeouts()
            if timeout_message:
                await manager.broadcast_system(room_id, timeout_message)
                await manager.broadcast_game_state(room_id, game)
    finally:
        turn_timer_tasks.pop(room_id, None)


def ensure_room_turn_timer(room_id: str):
    existing = turn_timer_tasks.get(room_id)
    if existing and not existing.done():
        return
    turn_timer_tasks[room_id] = asyncio.create_task(room_turn_timer(room_id))


async def stop_room_turn_timer(room_id: str):
    task = turn_timer_tasks.pop(room_id, None)
    if not task:
        return
    task.cancel()
    with suppress(asyncio.CancelledError):
        await task


@app.get("/", response_class=HTMLResponse)
async def get(request: Request):
    return templates.TemplateResponse(request=request, name="index.html")


@app.websocket("/ws/{room_id}/{client_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str, client_id: str):
    global games, room_hosts

    # Create room if needed
    if room_id not in games:
        games[room_id] = GameState()
        room_hosts[room_id] = client_id
    ensure_room_turn_timer(room_id)

    game = games[room_id]
    await manager.connect(websocket, room_id, client_id)

    # Auto-add player in WAITING or START_PEEK
    if game.state == "WAITING":
        if client_id not in game.players:
            try:
                game.add_player(client_id)
                short_name = client_id[-4:]
                await manager.broadcast_system(room_id, f"🎮 Игрок {short_name} присоединился!")
            except ValueError as e:
                await websocket.send_text(json.dumps({"type": "error", "message": str(e)}))
    elif game.state == "START_PEEK":
        if client_id not in game.players:
            try:
                game.add_player_during_start_peek(client_id)
                short_name = client_id[-4:]
                await manager.broadcast_system(room_id, f"🎮 Игрок {short_name} присоединился во время подглядывания!")
            except ValueError as e:
                await websocket.send_text(json.dumps({"type": "error", "message": str(e)}))

    # Send current state to newly connected client
    state_data = game.get_client_state(client_id, host_id=room_hosts.get(room_id))
    state_data["type"] = "game_state"
    await websocket.send_text(json.dumps(state_data))

    # Broadcast updated state to all
    await manager.broadcast_game_state(room_id, game)

    try:
        while True:
            game = games.get(room_id, game)
            data = await websocket.receive_text()
            parsed = json.loads(data)
            action = parsed.get("action")
            short_name = client_id[-4:]

            try:
                # ===== LOBBY ACTIONS =====
                if action == "start_game":
                    # Only host can start
                    if room_hosts.get(room_id) != client_id:
                        raise ValueError("Только хост может запустить игру!")
                    if len(game.players) < 2:
                        raise ValueError("Нужно минимум 2 игрока!")
                    game.start_game()
                    await manager.broadcast_system(room_id, f"🎮 Игра началась! Подглядите 2 свои карты.")

                elif action == "set_settings":
                    if room_hosts.get(room_id) != client_id:
                        raise ValueError("Только хост может менять настройки!")
                    limit_type = parsed.get("limit_type", game.limit_type)
                    limit_value = int(parsed.get("limit_value", game.limit_value))
                    allow_discard = parsed.get("allow_discard_draw", game.allow_discard_draw)
                    turn_timeout = parsed.get("turn_timeout")
                    if turn_timeout is not None:
                        turn_timeout = int(turn_timeout)
                    game.set_settings(limit_type, limit_value, allow_discard, turn_timeout)

                # ===== START_PEEK ACTIONS =====
                elif action == "peek_start":
                    index = parsed.get("index")
                    if index is not None:
                        game.peek_start_card(client_id, int(index))

                elif action == "ready_start":
                    game.set_player_ready(client_id)
                    if game.state == "PLAYING":
                        await manager.broadcast_system(room_id, "🏁 Все готовы! Игра начинается!")

                # ===== PLAYING ACTIONS =====
                elif action == "draw_deck":
                    game.draw_from_deck(client_id)
                    await manager.broadcast_system(room_id, f"🃏 Игрок {short_name} взял карту из колоды")

                elif action == "draw_discard":
                    game.draw_from_discard(client_id)
                    await manager.broadcast_system(room_id, f"♻️ Игрок {short_name} взял карту из сброса")

                elif action == "discard_drawn":
                    game.discard_drawn_card(client_id, trigger_ability=True)
                    if game.turn_phase == "ACTION" and game.active_action:
                        ability = game.active_action["type"]
                        ability_names = {
                            "peek": "👀 Подглядеть свою",
                            "spy": "🕵️ Подглядеть чужую",
                            "swap": "🔄 Слепой обмен (J)",
                            "swap_any": "👸 Обмен любых (Q)",
                            "black_king": "👑 Черный Король (K)"
                        }
                        name = ability_names.get(ability, ability)
                        await manager.broadcast_system(room_id, f"🗑️ Игрок {short_name} сбросил карту → {name}")
                    else:
                        await manager.broadcast_system(room_id, f"🗑️ Игрок {short_name} сбросил вытянутую карту")

                elif action == "swap_drawn":
                    indices = parsed.get("indices", [])
                    if not indices:
                        # Fallback: single index
                        index = parsed.get("index")
                        if index is not None:
                            indices = [int(index)]
                    if indices:
                        result = game.match_and_swap_card(client_id, [int(i) for i in indices])
                        msg = result.get("message", "Обмен выполнен")
                        await manager.broadcast_system(room_id, msg)

                elif action == "call_cabo":
                    game.call_cabo(client_id)
                    await manager.broadcast_system(room_id, f"⚠️ Игрок {short_name} объявил CABO! Последний круг!")

                elif action == "counter_cabo":
                    game.counter_cabo(client_id)
                    await manager.broadcast_system(room_id, f"⚔️ Игрок {short_name} объявил ВСТРЕЧНОЕ CABO!")

                # ===== ABILITY ACTIONS =====
                elif action == "use_ability":
                    game.handle_ability_action(client_id, parsed)

                elif action == "skip_ability":
                    game.skip_ability(client_id)
                    await manager.broadcast_system(room_id, f"Игрок {short_name} пропустил способность")

                # ===== BLACK KING =====
                elif action == "black_king_choice":
                    choice = parsed.get("choice", "cancel")
                    game.make_black_king_choice(client_id, choice)

                elif action == "black_king_swap":
                    game.handle_black_king_swap(client_id, parsed)

                # ===== REVEAL / CLEAR =====
                elif action == "clear_reveal":
                    game.clear_temp_reveal(client_id)

                # ===== MATCHING (self_match / opponent_match) =====
                elif action == "self_match":
                    card_index = parsed.get("card_index")
                    if card_index is not None:
                        result = game.self_match(client_id, int(card_index))
                        msg = result.get("message", "")
                        await manager.broadcast_system(room_id, msg)

                elif action == "opponent_match":
                    target_pid = parsed.get("target_player_id")
                    target_idx = parsed.get("target_card_index")
                    if target_pid and target_idx is not None:
                        result = game.opponent_match(client_id, target_pid, int(target_idx))
                        msg = result.get("message", "")
                        await manager.broadcast_system(room_id, msg)

                # ===== GIVE CARD (after successful opponent_match) =====
                elif action == "give_card_choice":
                    card_index = parsed.get("card_index")
                    if card_index is not None:
                        game.handle_give_card(client_id, int(card_index))
                        await manager.broadcast_system(room_id, f"🎁 Игрок {short_name} передал карту сопернику")

                # ===== ROUND / RESTART =====
                elif action == "next_round":
                    game.reset_round()
                    game.start_game()
                    await manager.broadcast_system(room_id, f"🏁 Раунд {game.current_round}! Подглядите 2 карты.")

                elif action == "restart":
                    # Full reset
                    games[room_id] = GameState()
                    game = games[room_id]
                    ensure_room_turn_timer(room_id)
                    # Re-add all connected players
                    if room_id in manager.active_connections:
                        for cid in list(manager.active_connections[room_id].keys()):
                            try:
                                game.add_player(cid)
                            except ValueError:
                                pass
                    room_hosts[room_id] = client_id
                    await manager.broadcast_system(room_id, "🔄 Игра полностью сброшена. Хост может начать заново!")

                else:
                    raise ValueError(f"Неизвестное действие: {action}")

                # Broadcast updated state after every action
                await manager.broadcast_game_state(room_id, game)

            except ValueError as e:
                await websocket.send_text(json.dumps({
                    "type": "error",
                    "message": str(e)
                }))

    except WebSocketDisconnect:
        manager.disconnect(room_id, client_id)

        # Remove player from WAITING lobby
        if game.state == "WAITING":
            if client_id in game.players:
                del game.players[client_id]
                if client_id in game.turn_order:
                    game.turn_order.remove(client_id)

        short_name = client_id[-4:]
        await manager.broadcast_system(room_id, f"Игрок {short_name} покинул игру.")

        # If room empty, delete it
        if room_id not in manager.active_connections or not manager.active_connections.get(room_id):
            if room_id in games:
                del games[room_id]
            if room_id in room_hosts:
                del room_hosts[room_id]
            await stop_room_turn_timer(room_id)
            print(f"Комната {room_id} удалена (все покинули).")
        else:
            # Reassign host if needed
            if room_hosts.get(room_id) == client_id:
                remaining = list(manager.active_connections[room_id].keys())
                if remaining:
                    room_hosts[room_id] = remaining[0]
            await manager.broadcast_game_state(room_id, game)
