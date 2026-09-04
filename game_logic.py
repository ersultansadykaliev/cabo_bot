import random
import time
from typing import List, Optional, Dict
from dataclasses import dataclass

@dataclass
class Card:
    suit: str # 'hearts', 'diamonds', 'clubs', 'spades', 'joker'
    rank: str # '2', '3', ..., '10', 'J', 'Q', 'K', 'A', 'Joker'
    value: int
    ability: Optional[str] = None # 'peek', 'spy', 'swap', 'swap_any', 'black_king'

    def to_dict(self):
        return {
            "suit": self.suit,
            "rank": self.rank,
            "value": self.value,
            "ability": self.ability
        }

class Deck:
    def __init__(self):
        self.cards: List[Card] = []
        self._build_deck()
        self.shuffle()

    def _build_deck(self):
        suits = ['hearts', 'diamonds', 'clubs', 'spades']
        for suit in suits:
            for rank in ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']:
                value = 0
                ability = None
                             
                if rank == 'A':
                    value = 1
                elif rank in ['7', '8']:
                    value = int(rank)
                    ability = 'peek' # Посмотреть свою
                elif rank in ['9', '10']:
                    value = int(rank)
                    ability = 'spy' # Посмотреть чужую
                elif rank == 'J':
                    value = 10
                    ability = 'swap' # Слепой обмен (свою с любым)
                elif rank == 'Q':
                    value = 10
                    ability = 'swap_any' # Обмен двух любых игроков
                elif rank == 'K':
                    if suit in ['spades', 'clubs']: # Черный король
                        value = 10
                        ability = 'black_king' # Смотреть чужую, поменять со своей или другим
                    else: # Красный король
                        value = -2
                else:
                    value = int(rank)
                
                self.cards.append(Card(suit, rank, value, ability))
        
        self.cards.append(Card('joker', 'Joker', 0))
        self.cards.append(Card('joker', 'Joker', 0))

    def shuffle(self):
        random.shuffle(self.cards)

    def draw(self) -> Card:
        if not self.cards:
            raise ValueError("Deck is empty")
        return self.cards.pop()

class Player:
    def __init__(self, player_id: str):
        self.player_id = player_id
        self.hand: List[Card] = []
        self.drawn_card: Optional[Card] = None 
        
        # Фаза старта игры
        self.peeked_cards: List[int] = [] 
        self.peeked_history: List[int] = [] 
        self.is_ready = False
        
        # Временная подсказка
        self.temp_reveal_card: Optional[dict] = None

class GameState:
    def __init__(self):
        self.deck = Deck()
        self.discard_pile: List[Card] = []
        self.players: Dict[str, Player] = {}
        self.turn_order: List[str] = []
        self.current_turn_index = 0
        self.state = "WAITING" 
        self.turn_phase = "DRAW" 
        
        # active_action: { "type": "peek" | "spy" | "swap" | "swap_any" | "black_king", "player_id": str, "step": int/str, ... }
        self.active_action: Optional[dict] = None 
        self.cabo_caller: Optional[str] = None
        self.turns_left_after_cabo: Optional[int] = None
        
        # Настройки раундов и накопительные очки
        self.cumulative_scores: Dict[str, int] = {}
        self.game_over = False
        self.current_round = 1
        self.limit_type = "rounds"  # "rounds" или "points"
        self.limit_value = 10       # Лимит по умолчанию: 10 раундов
        self.allow_discard_draw = True # Разрешить брать из сброса
        
        # Таймер ходов
        self.turn_timeout: Optional[int] = 30 # секунд на ход; None отключает таймер
        self.turn_start_time = time.time()

    def set_settings(self, limit_type: str, limit_value: int, allow_discard_draw: bool = True, turn_timeout: Optional[int] = 30):
        if self.state != "WAITING":
            raise ValueError("Настройки можно менять только в лобби")
        if limit_type not in ["rounds", "points"]:
            raise ValueError("Неверный тип лимита")
        if limit_value < 1:
            raise ValueError("Лимит должен быть не меньше 1")
        if turn_timeout is not None and turn_timeout not in [15, 30, 60, 90]:
            raise ValueError("Неверное время хода")
        self.limit_type = limit_type
        self.limit_value = limit_value
        self.allow_discard_draw = allow_discard_draw
        self.turn_timeout = turn_timeout

    def add_player(self, player_id: str):
        if self.state != "WAITING":
            raise ValueError("Game already started")
        if len(self.players) >= 6:
            raise ValueError("Лобби заполнено")
        self.players[player_id] = Player(player_id)
        self.turn_order.append(player_id)

    def add_player_during_start_peek(self, player_id: str):
        if self.state != "START_PEEK":
            raise ValueError("Можно присоединиться только до начала ходов")
        if player_id in self.players:
            return
        if len(self.players) >= 6:
            raise ValueError("Лобби заполнено")
        if len(self.deck.cards) < 4:
            raise ValueError("Недостаточно карт для нового игрока")

        player = Player(player_id)
        for _ in range(4):
            player.hand.append(self.deck.draw())
        self.players[player_id] = player
        self.turn_order.append(player_id)

    def start_game(self):
        if len(self.players) < 2:
            raise ValueError("Need at least 2 players")
        
        self.state = "START_PEEK"
        self.deck = Deck()
        self.discard_pile = []
        
        for player in self.players.values():
            player.hand = []
            player.drawn_card = None
            player.peeked_cards = []
            player.peeked_history = []
            player.is_ready = False
            player.temp_reveal_card = None
            for _ in range(4):
                player.hand.append(self.deck.draw())
        
        self.discard_pile.append(self.deck.draw())
        self.current_turn_index = 0
        self.turn_phase = "DRAW"
        self.cabo_caller = None
        self.turns_left_after_cabo = None
        self.active_action = None

    def get_current_player_id(self) -> str:
        return self.turn_order[self.current_turn_index]

    def next_turn(self):
        self.turn_start_time = time.time()
        if self.turns_left_after_cabo is not None:
            self.turns_left_after_cabo -= 1
            if self.turns_left_after_cabo <= 0:
                self.end_round()
                return

        self.current_turn_index = (self.current_turn_index + 1) % len(self.turn_order)
        if self.turn_order[self.current_turn_index] == self.cabo_caller:
            self.end_round()
            return
            
        self.turn_phase = "DRAW"
        self.active_action = None

    def peek_start_card(self, player_id: str, card_index: int):
        if self.state != "START_PEEK":
            raise ValueError("Not in start peek phase")
        player = self.players.get(player_id)
        if not player:
            return
        
        if card_index in player.peeked_cards:
            player.peeked_cards.remove(card_index)
        else:
            # Разрешаем открыть заново, если эта карта уже была подсмотрена
            if card_index in player.peeked_history:
                player.peeked_cards.append(card_index)
            # Если карта новая, проверяем лимит в 2 уникальные карты
            elif len(player.peeked_history) < 2:
                player.peeked_history.append(card_index)
                player.peeked_cards.append(card_index)
            else:
                raise ValueError("Вы уже подсмотрели 2 другие карты! Больше выбирать другие карты нельзя.")

    def set_player_ready(self, player_id: str):
        if self.state != "START_PEEK":
            raise ValueError("Not in start peek phase")
        player = self.players.get(player_id)
        if not player:
            return
            
        if len(player.peeked_history) < 2:
            raise ValueError("Вы должны подсмотреть ровно 2 карты перед началом игры!")
            
        player.is_ready = True
        
        if all(p.is_ready for p in self.players.values()):
            self.state = "PLAYING"
            self.turn_start_time = time.time()
            for p in self.players.values():
                p.peeked_cards = []

    def draw_from_deck(self, player_id: str):
        if self.state != "PLAYING" or self.get_current_player_id() != player_id:
            raise ValueError("Not your turn")
        if self.turn_phase != "DRAW":
            raise ValueError("Invalid phase")

        # Если колода опустела, перетасовываем сброс
        if not self.deck.cards:
            if len(self.discard_pile) > 1:
                # Оставляем только верхнюю карту в сбросе
                top_card = self.discard_pile.pop()
                self.deck.cards = self.discard_pile.copy()
                self.deck.shuffle()
                self.discard_pile = [top_card]
            else:
                raise ValueError("В колоде и сбросе нет карт! Все карты на руках.")

        player = self.players[player_id]
        player.drawn_card = self.deck.draw()
        self.turn_phase = "CHOICE"

    def draw_from_discard(self, player_id: str):
        if self.state != "PLAYING" or self.get_current_player_id() != player_id:
            raise ValueError("Not your turn")
        if not self.allow_discard_draw:
            raise ValueError("Взятие карт из сброса отключено правилами стола!")
        if self.turn_phase != "DRAW":
            raise ValueError("Invalid phase")
        if not self.discard_pile:
            raise ValueError("Discard pile is empty")

        player = self.players[player_id]
        player.drawn_card = self.discard_pile.pop()
        self.turn_phase = "MUST_SWAP"

    def discard_drawn_card(self, player_id: str, trigger_ability: bool = True):
        if self.state != "PLAYING" or self.get_current_player_id() != player_id:
            raise ValueError("Not your turn")
        if self.turn_phase != "CHOICE":
            raise ValueError("You cannot discard this card")

        player = self.players[player_id]
        card = player.drawn_card
        player.drawn_card = None
        self.discard_pile.append(card)

        if trigger_ability and card.ability:
            self.turn_phase = "ACTION"
            self.active_action = {
                "type": card.ability,
                "player_id": player_id,
                "step": "init"
            }
        else:
            self.next_turn()

    def handle_ability_action(self, player_id: str, data: dict):
        if self.state != "PLAYING" or self.get_current_player_id() != player_id:
            raise ValueError("Not your turn")
        if self.turn_phase != "ACTION" or not self.active_action:
            raise ValueError("No active ability to execute")

        ability_type = self.active_action["type"]
        player = self.players[player_id]

        if ability_type == "peek":
            # 7, 8: Посмотреть на свои карты
            card_idx = data.get("card_index")
            if card_idx is None or card_idx < 0 or card_idx >= len(player.hand):
                raise ValueError("Invalid card index")
                
            player.temp_reveal_card = {
                "text": f"Ваша карта на позиции {card_idx + 1}:",
                "card": player.hand[card_idx].to_dict(),
                "show_ok": True
            }
            self.next_turn()

        elif ability_type == "spy":
            # 9, 10: Посмотреть на чужие карты
            target_id = data.get("target_player_id")
            card_idx = data.get("card_index")
            
            if not target_id or target_id == player_id or target_id not in self.players:
                raise ValueError("Invalid target player")
            target_player = self.players[target_id]
            if card_idx is None or card_idx < 0 or card_idx >= len(target_player.hand):
                raise ValueError("Invalid card index")

            player.temp_reveal_card = {
                "text": f"Карта игрока {target_id} на позиции {card_idx + 1}:",
                "card": target_player.hand[card_idx].to_dict(),
                "show_ok": True
            }
            self.next_turn()

        elif ability_type == "swap":
            # J: Обмен своей карты с любой другой
            my_card_idx = data.get("my_card_index")
            opp_id = data.get("target_player_id")
            opp_card_idx = data.get("target_card_index")

            if my_card_idx is None or my_card_idx < 0 or my_card_idx >= len(player.hand):
                raise ValueError("Invalid your card index")
            if not opp_id or opp_id == player_id or opp_id not in self.players:
                raise ValueError("Invalid target player")
            opp_player = self.players[opp_id]
            if opp_card_idx is None or opp_card_idx < 0 or opp_card_idx >= len(opp_player.hand):
                raise ValueError("Invalid opponent card index")

            player.hand[my_card_idx], opp_player.hand[opp_card_idx] = opp_player.hand[opp_card_idx], player.hand[my_card_idx]
            self.next_turn()

        elif ability_type == "swap_any":
            # Q: Обмен карт двух любых игроков
            p1_id = data.get("p1_id")
            p1_idx = data.get("p1_idx")
            p2_id = data.get("p2_id")
            p2_idx = data.get("p2_idx")

            if not p1_id or p1_id not in self.players or p1_idx is None or p1_idx < 0 or p1_idx >= len(self.players[p1_id].hand):
                raise ValueError("Invalid player 1 card selection")
            if not p2_id or p2_id not in self.players or p2_idx is None or p2_idx < 0 or p2_idx >= len(self.players[p2_id].hand):
                raise ValueError("Invalid player 2 card selection")

            # Производим обмен
            player1 = self.players[p1_id]
            player2 = self.players[p2_id]
            player1.hand[p1_idx], player2.hand[p2_idx] = player2.hand[p2_idx], player1.hand[p1_idx]
            self.next_turn()

        elif ability_type == "black_king":
            # Черный король: посмотреть чужую, поменять со своей или другим
            step = self.active_action.get("step")
            
            if step == "init":
                # Шаг 1: Смотрим чужую карту
                target_id = data.get("target_player_id")
                card_idx = data.get("card_index")
                
                if not target_id or target_id == player_id or target_id not in self.players:
                    raise ValueError("Invalid target player")
                target_player = self.players[target_id]
                if card_idx is None or card_idx < 0 or card_idx >= len(target_player.hand):
                    raise ValueError("Invalid card index")

                # Показываем карту игроку и даем выбор
                player.temp_reveal_card = {
                    "text": f"Черный король. Карта игрока {target_id} на позиции {card_idx + 1}:",
                    "card": target_player.hand[card_idx].to_dict(),
                    "show_ok": False, # Не показывать кнопку "Понятно", нужны кнопки выбора действия
                    "is_black_king": True,
                    "target_player_id": target_id,
                    "card_index": card_idx
                }
                # Переводим во временный шаг выбора
                self.active_action["step"] = "pending_choice"
                self.active_action["target_player_id"] = target_id
                self.active_action["card_index"] = card_idx

    def make_black_king_choice(self, player_id: str, choice: str):
        """Выбор игрока после просмотра карты черным королем"""
        if self.state != "PLAYING" or self.get_current_player_id() != player_id:
            raise ValueError("Not your turn")
        if self.turn_phase != "ACTION" or not self.active_action or self.active_action.get("type") != "black_king":
            raise ValueError("No active black king action")
            
        player = self.players[player_id]
        target_id = self.active_action["target_player_id"]
        target_idx = self.active_action["card_index"]

        # Скрываем временный показ
        player.temp_reveal_card = None

        if choice == "swap_mine":
            # Игрок хочет поменять эту карту со своей
            self.active_action["step"] = "swap_mine"
            # Ждем клика по своей карте
        elif choice == "swap_other":
            # Игрок хочет поменять эту карту с картой другого игрока
            self.active_action["step"] = "swap_other"
            # Ждем клика по карте другого игрока
        else:
            # Ничего не делать/отмена
            self.next_turn()

    def handle_black_king_swap(self, player_id: str, data: dict):
        """Финальный обмен для черного короля"""
        if self.state != "PLAYING" or self.get_current_player_id() != player_id:
            raise ValueError("Not your turn")
        if self.turn_phase != "ACTION" or not self.active_action or self.active_action.get("type") != "black_king":
            raise ValueError("No active black king action")
            
        step = self.active_action["step"]
        player = self.players[player_id]
        
        # Подсмотренная карта
        target_id = self.active_action["target_player_id"]
        target_idx = self.active_action["card_index"]
        target_player = self.players[target_id]

        if step == "swap_mine":
            # Меняем подсмотренную карту с картой текущего игрока
            my_card_idx = data.get("my_card_index")
            if my_card_idx is None or my_card_idx < 0 or my_card_idx >= len(player.hand):
                raise ValueError("Invalid card index")
                
            player.hand[my_card_idx], target_player.hand[target_idx] = target_player.hand[target_idx], player.hand[my_card_idx]
            self.next_turn()
            
        elif step == "swap_other":
            # Меняем подсмотренную карту с картой любого другого игрока
            other_id = data.get("other_player_id")
            other_idx = data.get("other_card_index")
            
            if not other_id or other_id not in self.players or other_idx is None:
                raise ValueError("Invalid other player selection")
            other_player = self.players[other_id]
            if other_idx < 0 or other_idx >= len(other_player.hand):
                raise ValueError("Invalid other card index")

            other_player.hand[other_idx], target_player.hand[target_idx] = target_player.hand[target_idx], other_player.hand[other_idx]
            self.next_turn()

    def clear_temp_reveal(self, player_id: str):
        player = self.players.get(player_id)
        if player:
            player.temp_reveal_card = None

    def check_turn_timeouts(self) -> Optional[str]:
        """
        Проверяет, истек ли таймер текущего хода.
        Если истек, делает авто-ход за игрока.
        """
        if self.state != "PLAYING":
            return None
        if self.turn_timeout is None:
            return None
            
        elapsed = time.time() - self.turn_start_time
        if elapsed < self.turn_timeout:
            return None
            
        player_id = self.get_current_player_id()
        
        # Если идет выбор способности или передача карты, сбрасываем их
        if self.active_action:
            if self.active_action.get("type") == "give_card":
                # Автоматически отдаем первую карту игрока
                if self.players[player_id].hand:
                    self.handle_give_card(player_id, 0)
                    return f"⏰ Время истекло! Игрок {player_id[-4:]} автоматически передал сопернику свою первую карту."
            else:
                # Пропуск способности
                self.skip_ability(player_id)
                return f"⏰ Время истекло! Способность игрока {player_id[-4:]} автоматически пропущена."
                
        if self.turn_phase == "DRAW":
            # Игрок не взял карту. Автоматически берем из колоды и сбрасываем её
            try:
                self.draw_from_deck(player_id)
                self.discard_drawn_card(player_id, trigger_ability=False)
                return f"⏰ Время истекло! Игрок {player_id[-4:]} автоматически взял карту из колоды и сбросил её."
            except Exception:
                # Если колода пуста, объявляем CABO
                self.call_cabo(player_id)
                return f"⏰ Время истекло! Игрок {player_id[-4:]} автоматически объявил CABO."
                
        elif self.turn_phase == "CHOICE":
            # Игрок взял карту, но не решил. Автоматически сбрасываем её
            self.discard_drawn_card(player_id, trigger_ability=False)
            return f"⏰ Время истекло! Игрок {player_id[-4:]} автоматически сбросил вытянутую карту."
            
        elif self.turn_phase == "MUST_SWAP":
            # Игрок обязан поменять карту. Автоматически меняем на первую карту
            if self.players[player_id].hand:
                self.match_and_swap_card(player_id, [0])
                return f"⏰ Время истекло! Игрок {player_id[-4:]} автоматически поменял свою первую карту."
            else:
                self.turn_phase = "CHOICE"
                self.discard_drawn_card(player_id, trigger_ability=False)
                return f"⏰ Время истекло!"
                
        return None

    def skip_ability(self, player_id: str):
        """Пропуск применения способности карты"""
        if self.state != "PLAYING" or self.get_current_player_id() != player_id:
            raise ValueError("Not your turn")
        if self.turn_phase != "ACTION":
            raise ValueError("Нет активной способности для пропуска")
        
        self.next_turn()

    def match_and_swap_card(self, player_id: str, hand_indices: List[int]) -> dict:
        if self.state != "PLAYING" or self.get_current_player_id() != player_id:
            raise ValueError("Not your turn")
        if self.turn_phase not in ["CHOICE", "MUST_SWAP"]:
            raise ValueError("Invalid phase for swapping")
        if not hand_indices:
            raise ValueError("Не выбраны карты для замены")

        player = self.players[player_id]
        
        # Проверяем корректность индексов
        for idx in hand_indices:
            if idx < 0 or idx >= len(player.hand):
                raise ValueError("Неверный индекс карты")

        # Удаляем дубликаты
        hand_indices = list(set(hand_indices))
        drawn_card = player.drawn_card
        if not drawn_card:
            raise ValueError("Нет вытянутой карты")

        # Стандартная замена 1 на 1
        if len(hand_indices) == 1:
            idx = hand_indices[0]
            old_card = player.hand[idx]
            player.hand[idx] = drawn_card
            player.drawn_card = None
            self.discard_pile.append(old_card)
            self.next_turn()
            return {"success": True, "message": "Карта успешно заменена."}

        # Матчинг нескольких карт
        first_card = player.hand[hand_indices[0]]
        match_success = True
        for idx in hand_indices[1:]:
            if player.hand[idx].rank != first_card.rank:
                match_success = False
                break

        if match_success:
            # Успех: сбрасываем все совпадающие карты
            sorted_indices = sorted(hand_indices, reverse=True)
            replace_idx = min(hand_indices)

            discarded_cards = []
            for idx in sorted_indices:
                card = player.hand.pop(idx)
                discarded_cards.append(card)

            # Вставляем вытянутую карту вместо одной из сброшенных
            player.hand.insert(replace_idx, drawn_card)
            player.drawn_card = None

            for card in discarded_cards:
                self.discard_pile.append(card)

            self.next_turn()
            return {"success": True, "message": f"Матчинг успешен! Сброшено {len(hand_indices)} одинаковых карт."}
        else:
            # Штраф: игрок оставляет карты себе и забирает вытянутую карту
            player.hand.append(drawn_card)
            player.drawn_card = None
            self.next_turn()
            return {"success": False, "message": "Карты не совпали! Вы получили штрафную карту в руку."}

    def call_cabo(self, player_id: str):
        if self.state != "PLAYING" or self.get_current_player_id() != player_id:
            raise ValueError("Not your turn")
        if self.turn_phase != "DRAW":
            raise ValueError("You can only call CABO at the start of your turn")
        if self.cabo_caller is not None:
            raise ValueError("CABO has already been called")

        self.cabo_caller = player_id
        self.turns_left_after_cabo = len(self.turn_order)
        self.next_turn()
    def counter_cabo(self, player_id: str):
        if self.state != "PLAYING" or self.get_current_player_id() != player_id:
            raise ValueError("Not your turn")
        if self.turn_phase != "DRAW":
            raise ValueError("You can only call Counter-CABO at the start of your turn")
        if self.cabo_caller is None:
            raise ValueError("CABO has not been called yet")
        if self.cabo_caller == player_id:
            raise ValueError("You are already the CABO caller")

        self.cabo_caller = player_id
        self.next_turn()

    def self_match(self, player_id: str, card_index: int) -> dict:
        if self.state != "PLAYING":
            raise ValueError("Игра не идёт")
        if self.active_action is not None:
            raise ValueError("Нельзя сбрасывать карты во время выполнения способностей")
        if not self.discard_pile:
            raise ValueError("Сброс пуст")
            
        player = self.players.get(player_id)
        if not player:
            raise ValueError("Игрок не найден")
        if card_index < 0 or card_index >= len(player.hand):
            raise ValueError("Неверный индекс карты")
            
        top_discard = self.discard_pile[-1]
        card = player.hand[card_index]
        
        # Сравниваем ранги
        if card.rank == top_discard.rank:
            # Успешный сброс!
            matched_card = player.hand.pop(card_index)
            self.discard_pile.append(matched_card)
            return {"success": True, "message": f"🔥 Успешный сброс по совпадению! Игрок {player_id[-4:]} сбросил свою карту {card.rank}."}
        else:
            # Ошибка сброса — 1 штрафная карта по правилам CABO
            if self.deck.cards:
                penalty_card = self.deck.draw()
                player.hand.append(penalty_card)
            return {"success": False, "message": f"💥 Ошибка сброса! Игрок {player_id[-4:]} ошибся и получил 1 штрафную карту."}

    def opponent_match(self, player_id: str, target_player_id: str, target_card_idx: int) -> dict:
        if self.state != "PLAYING":
            raise ValueError("Игра не идёт")
        if self.active_action is not None:
            raise ValueError("Нельзя сбрасывать карты во время выполнения способностей")
        if not self.discard_pile:
            raise ValueError("Сброс пуст")
            
        target_player = self.players.get(target_player_id)
        player = self.players.get(player_id)
        
        if not target_player or not player:
            raise ValueError("Игрок не найден")
        if target_player_id == player_id:
            raise ValueError("Нельзя перехватить карту самого себя")
        if target_card_idx < 0 or target_card_idx >= len(target_player.hand):
            raise ValueError("Неверный индекс карты")
            
        top_discard = self.discard_pile[-1]
        target_card = target_player.hand[target_card_idx]
        
        # Сравниваем ранги
        if target_card.rank == top_discard.rank:
            # Успешный перехват!
            matched_card = target_player.hand.pop(target_card_idx)
            self.discard_pile.append(matched_card)
            
            # Переводим игру в состояние передачи карты
            self.active_action = {
                "type": "give_card",
                "player_id": player_id,
                "target_player_id": target_player_id,
                "target_index": target_card_idx
            }
            return {"success": True, "message": f"🔥 Успешный перехват! Игрок {player_id[-4:]} избавил соперника от карты {target_card.rank} и должен отдать взамен свою карту."}
        else:
            # Ошибка перехвата — 1 штрафная карта по правилам CABO
            if self.deck.cards:
                penalty_card = self.deck.draw()
                player.hand.append(penalty_card)
            return {"success": False, "message": f"💥 Ошибка перехвата! Игрок {player_id[-4:]} ошибся и получил 1 штрафную карту."}

    def handle_give_card(self, player_id: str, card_index: int):
        if not self.active_action or self.active_action.get("type") != "give_card":
            raise ValueError("Нет активного действия передачи карты")
        if self.active_action.get("player_id") != player_id:
            raise ValueError("Вы не можете передавать карту")
            
        player = self.players.get(player_id)
        target_player_id = self.active_action.get("target_player_id")
        target_player = self.players.get(target_player_id)
        target_idx = self.active_action.get("target_index")
        
        if card_index < 0 or card_index >= len(player.hand):
            raise ValueError("Неверный индекс карты")
            
        # Забираем карту у игрока
        card = player.hand.pop(card_index)
        
        # Вставляем её сопернику на позицию сброшенной
        target_player.hand.insert(target_idx, card)
        
        # Сбрасываем действие
        self.active_action = None


    def end_round(self):
        self.state = "ROUND_END"
        self.scores = self.calculate_scores()

    def reset_round(self):
        if not self.game_over:
            self.current_round += 1

        self.deck = Deck()
        self.discard_pile = []
        self.state = "WAITING"
        self.turn_phase = "DRAW"
        self.active_action = None
        self.cabo_caller = None
        self.turns_left_after_cabo = None

        for player in self.players.values():
            player.hand = []
            player.drawn_card = None
            player.peeked_cards = []
            player.peeked_history = []
            player.is_ready = False
            player.temp_reveal_card = None

    def calculate_scores(self) -> dict:
        """Подсчет очков для каждого игрока с учетом серии раундов"""
        scores = {}
        for p_id, player in self.players.items():
            total = sum(card.value for card in player.hand)
            scores[p_id] = {
                "round_score": total,
                "cards": [card.to_dict() for card in player.hand],
                "is_cabo_caller": p_id == self.cabo_caller,
                "cabo_status": None
            }

        # Начисляем штрафы/бонусы за вызов CABO
        if self.cabo_caller and self.cabo_caller in scores:
            caller_score = scores[self.cabo_caller]["round_score"]
            other_scores = [scores[p_id]["round_score"] for p_id in scores if p_id != self.cabo_caller]
            min_other = min(other_scores) if other_scores else 999

            if caller_score < min_other:
                # Успех: 0 очков за раунд
                scores[self.cabo_caller]["round_score"] = 0
                scores[self.cabo_caller]["cabo_status"] = "success"
            else:
                # Провал: очки + 10 штрафа
                scores[self.cabo_caller]["round_score"] = caller_score + 10
                scores[self.cabo_caller]["cabo_status"] = "fail"

        # Суммируем с накопленными очками серии
        for p_id in self.players:
            round_score = scores[p_id]["round_score"]
            if p_id not in self.cumulative_scores:
                self.cumulative_scores[p_id] = 0
            self.cumulative_scores[p_id] += round_score
            scores[p_id]["total_score"] = self.cumulative_scores[p_id]

        # Проверяем условие завершения всей игры
        game_over = False
        if self.limit_type == "rounds":
            if self.current_round >= self.limit_value:
                game_over = True
        elif self.limit_type == "points":
            for total in self.cumulative_scores.values():
                if total >= self.limit_value:
                    game_over = True
                    break

        self.game_over = game_over

        # Определяем победителя раунда
        min_round_score = min(s["round_score"] for s in scores.values())
        for p_id in scores:
            scores[p_id]["is_winner"] = scores[p_id]["round_score"] == min_round_score

        # Определяем победителя всей серии раундов
        if game_over:
            min_total_score = min(self.cumulative_scores.values())
            for p_id in scores:
                scores[p_id]["is_match_winner"] = self.cumulative_scores[p_id] == min_total_score

        return scores

    def get_client_state(self, client_id: str, host_id: Optional[str] = None) -> dict:
        if self.state == "WAITING":
            return {
                "state": self.state,
                "players": list(self.players.keys()),
                "host_id": host_id,
                "limit_type": self.limit_type,
                "limit_value": self.limit_value,
                "current_round": self.current_round,
                "game_over": self.game_over,
                "cumulative_scores": self.cumulative_scores,
                "allow_discard_draw": self.allow_discard_draw,
                "turn_timeout": self.turn_timeout
            }

        players_data = {}
        my_player = self.players.get(client_id)

        for p_id, player in self.players.items():
            if self.state == "ROUND_END":
                hand_info = [card.to_dict() for card in player.hand]
            elif self.state == "START_PEEK" and p_id == client_id:
                hand_info = []
                for idx, card in enumerate(player.hand):
                    if idx in player.peeked_cards:
                        hand_info.append(card.to_dict())
                    else:
                        hand_info.append({"state": "hidden"})
            else:
                hand_info = [{"state": "hidden"} for _ in player.hand]

            players_data[p_id] = {
                "hand": hand_info,
                "hand_count": len(player.hand),
                "has_drawn": player.drawn_card is not None,
                "is_ready": player.is_ready if self.state == "START_PEEK" else None
            }

        current_player_id = self.get_current_player_id()
        drawn_card_data = None
        if current_player_id == client_id and my_player and my_player.drawn_card:
            drawn_card_data = my_player.drawn_card.to_dict()

        return {
            "state": self.state,
            "turn_phase": self.turn_phase,
            "current_turn": current_player_id,
            "discard_history": [card.to_dict() for card in self.discard_pile[-3:]] if self.discard_pile else [],
            "deck_count": len(self.deck.cards),
            "players": players_data,
            "drawn_card": drawn_card_data,
            "cabo_caller": self.cabo_caller,
            "active_action": self.active_action,
            "temp_reveal_card": my_player.temp_reveal_card if my_player else None,
            "scores": self.scores if self.state == "ROUND_END" and hasattr(self, 'scores') else None,
            "limit_type": self.limit_type,
            "limit_value": self.limit_value,
            "current_round": self.current_round,
            "game_over": self.game_over,
            "cumulative_scores": self.cumulative_scores,
            "allow_discard_draw": self.allow_discard_draw,
            "turn_timeout": self.turn_timeout,
            "time_left": max(0, int(self.turn_timeout - (time.time() - self.turn_start_time))) if self.state == "PLAYING" and self.turn_timeout is not None else None
        }
