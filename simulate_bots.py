import random
import traceback
import sys
from game_logic import GameState

def try_match(game: GameState):
    """Попытка перехвата или сброса своей карты случайным игроком."""
    player_id = random.choice(list(game.players.keys()))
    player = game.players[player_id]
    
    if not player.hand or not game.discard_pile:
        return

    # Выбираем случайную карту (свою или чужую)
    target_player_id = random.choice(list(game.players.keys()))
    target_player = game.players[target_player_id]
    
    if not target_player.hand:
        return
        
    card_idx = random.randint(0, len(target_player.hand) - 1)
    
    try:
        if target_player_id == player_id:
            game.self_match(player_id, card_idx)
        else:
            game.opponent_match(player_id, target_player_id, card_idx)
    except ValueError:
        pass # Игнорируем логические ошибки


def handle_ability(game: GameState, player_id: str):
    action = game.active_action
    act_type = action.get("type")
    
    players = list(game.players.keys())
    opponents = [p for p in players if p != player_id]
    opp_id = random.choice(opponents) if opponents else player_id
    
    my_hand_len = len(game.players[player_id].hand)
    opp_hand_len = len(game.players[opp_id].hand)
    
    my_idx = random.randint(0, my_hand_len - 1) if my_hand_len > 0 else 0
    opp_idx = random.randint(0, opp_hand_len - 1) if opp_hand_len > 0 else 0
    
    data = {}
    
    if act_type == "peek":
        data = {"card_index": my_idx}
    elif act_type == "spy":
        data = {"target_player_id": opp_id, "card_index": opp_idx}
    elif act_type == "swap":
        data = {"my_card_index": my_idx, "target_player_id": opp_id, "target_card_index": opp_idx}
    elif act_type == "swap_any":
        data = {"p1_id": player_id, "p1_idx": my_idx, "p2_id": opp_id, "p2_idx": opp_idx}
    elif act_type == "black_king":
        step = action.get("step")
        if step == "init":
            data = {"target_player_id": opp_id, "card_index": opp_idx}
            game.handle_ability_action(player_id, data)
        elif step == "pending_choice":
            choice = random.choice(["swap_mine", "swap_other", "keep"])
            game.make_black_king_choice(player_id, choice)
        elif step == "swap_mine":
            data = {"my_card_index": my_idx}
            game.handle_black_king_swap(player_id, data)
        elif step == "swap_other":
            data = {"other_player_id": opp_id, "other_card_index": opp_idx}
            game.handle_black_king_swap(player_id, data)
        return

    game.handle_ability_action(player_id, data)


def run_simulation(num_games=300, limit_type='rounds', limit_value=3):
    print(f"Запуск симуляции: {num_games} игр...")
    
    success_games = 0
    errors_log = []
    
    for i in range(1, num_games + 1):
        try:
            game = GameState()
            game.limit_type = limit_type
            game.limit_value = limit_value
            bots = [f"bot{i}" for i in range(1, 7)]
            for bot_id in bots:
                game.add_player(bot_id)
            
            moves_in_game = 0
            
            while not game.game_over:
                if moves_in_game > 10000:  # Увеличим лимит шагов для 6 игроков
                    raise Exception("Превышен лимит ходов (возможно бесконечный цикл)!")
                    
                moves_in_game += 1
                
                if game.state == "WAITING":
                    game.start_game()
                elif game.state == "START_PEEK":
                    for bot_id in bots:
                        game.peek_start_card(bot_id, 0)
                        game.peek_start_card(bot_id, 1)
                        game.set_player_ready(bot_id)
                elif game.state == "PLAYING":
                    current_turn = game.get_current_player_id()
                    
                    # Иногда кто-то случайный пытается сделать перехват или сброс (редко, чтобы не спамить штрафами)
                    if random.random() < 0.02:
                        try_match(game)
                        continue
                        
                    if game.active_action:
                        if game.active_action["type"] == "give_card":
                            giver_id = game.active_action["player_id"]
                            hand_len = len(game.players[giver_id].hand)
                            if hand_len > 0:
                                game.handle_give_card(giver_id, random.randint(0, hand_len - 1))
                            else:
                                game.active_action = None # Fallback
                        else:
                            handle_ability(game, current_turn)
                    else:
                        if game.turn_phase == "DRAW":
                            choices = ["deck", "deck", "discard", "cabo"]
                            if not game.allow_discard_draw or not game.discard_pile:
                                if "discard" in choices: choices.remove("discard")
                                
                            if game.cabo_caller is not None:
                                choices = ["deck", "counter_cabo"]
                                if game.allow_discard_draw and game.discard_pile: 
                                    choices.append("discard")
                                
                            choice = random.choice(choices)
                            
                            if choice == "deck": 
                                game.draw_from_deck(current_turn)
                            elif choice == "discard": 
                                game.draw_from_discard(current_turn)
                            elif choice == "cabo": 
                                game.call_cabo(current_turn)
                            elif choice == "counter_cabo":
                                if current_turn != game.cabo_caller:
                                    game.counter_cabo(current_turn)
                                else:
                                    game.draw_from_deck(current_turn)
                                    
                        elif game.turn_phase == "CHOICE":
                            if random.random() < 0.4:
                                game.discard_drawn_card(current_turn)
                            else:
                                hand_len = len(game.players[current_turn].hand)
                                if hand_len > 0:
                                    game.match_and_swap_card(current_turn, [random.randint(0, hand_len - 1)])
                                else:
                                    game.discard_drawn_card(current_turn)
                                    
                        elif game.turn_phase == "MUST_SWAP":
                            hand_len = len(game.players[current_turn].hand)
                            if hand_len > 0:
                                game.match_and_swap_card(current_turn, [random.randint(0, hand_len - 1)])
                                
                elif game.state == "ROUND_END":
                    game.reset_round()
                    
            success_games += 1
            if i % 1000 == 0:
                print(f"Обработано {i} игр...")
                
        except Exception as e:
            # Логируем ошибку, но продолжаем симуляцию
            error_details = {
                "game_num": i,
                "error": str(e),
                "traceback": traceback.format_exc(),
                "state": getattr(game, 'state', 'Unknown'),
                "phase": getattr(game, 'turn_phase', 'Unknown'),
                "active_action": getattr(game, 'active_action', 'Unknown'),
                "current_turn": game.get_current_player_id() if hasattr(game, 'get_current_player_id') else 'Unknown',
                "hands": {pid: len(p.hand) for pid, p in game.players.items()} if hasattr(game, 'players') else {}
            }
            errors_log.append(error_details)
            print(f"❌ Ошибка в игре #{i}! Записана в лог. Продолжаем...")
            
    print(f"\n========================================")
    print(f"🏁 Результаты симуляции {num_games} игр:")
    print(f"Успешно завершено: {success_games}")
    print(f"Ошибок обнаружено: {len(errors_log)}")
    print(f"========================================\n")
    
    if errors_log:
        print("🛑 СПИСОК ОБНАРУЖЕННЫХ ОШИБОК:")
        for err in errors_log:
            print(f"\n❌ ОШИБКА В ИГРЕ #{err['game_num']}: {err['error']}")
            print(f"  Состояние: State={err['state']}, Phase={err['phase']}, Active Action={err['active_action']}, Current Turn={err['current_turn']}")
            print(f"  Карты в руках: {err['hands']}")
            print(f"  Трассировка:")
            print(err['traceback'])
            print("-" * 40)
    else:
        print("✅ Симуляция успешно завершена! Все игры сыграны без ошибок и зависаний.")

if __name__ == "__main__":
    run_simulation(10000)
