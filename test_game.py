from game_logic import GameState, Card, Player

def test_default_limits():
    print("Testing default limits...")
    game = GameState()
    assert game.limit_type == "rounds"
    assert game.limit_value == 10
    print("Default limits test passed!")

def test_lobby_player_limit():
    print("Testing lobby max player limit...")
    game = GameState()
    for i in range(6):
        game.add_player(f"p{i+1}")
    try:
        game.add_player("p7")
        raise AssertionError("Expected ValueError for full lobby")
    except ValueError as e:
        assert "Лобби заполнено" in str(e)
    print("Lobby max player limit test passed!")

def test_matching():
    print("Testing matching...")
    game = GameState()
    game.add_player("p1")
    game.add_player("p2")
    
    # Manually configure hands for testing matching
    p1 = game.players["p1"]
    p1.hand = [
        Card("hearts", "5", 5),
        Card("diamonds", "5", 5),
        Card("clubs", "A", 1),
        Card("spades", "2", 2)
    ]
    p1.drawn_card = Card("clubs", "3", 3)
    
    game.state = "PLAYING"
    game.turn_phase = "CHOICE"
    game.current_turn_index = 0 # p1's turn
    
    # Test successful matching (index 0 and 1, rank "5")
    res = game.match_and_swap_card("p1", [0, 1])
    assert res["success"] is True
    # hand should now be: Card("clubs", "3", 3) [replace_idx], Card("clubs", "A", 1), Card("spades", "2", 2)
    assert len(p1.hand) == 3
    assert p1.hand[0].rank == "3"
    assert p1.hand[1].rank == "A"
    assert p1.hand[2].rank == "2"
    print("Successful matching test passed!")
    
    # Reset hand for failed matching test
    p1.hand = [
        Card("hearts", "5", 5),
        Card("diamonds", "6", 6),
        Card("clubs", "A", 1),
        Card("spades", "2", 2)
    ]
    p1.drawn_card = Card("clubs", "3", 3)
    game.turn_phase = "CHOICE"
    game.current_turn_index = 0
    
    # Test failed matching (index 0 and 1, ranks "5" and "6")
    res = game.match_and_swap_card("p1", [0, 1])
    assert res["success"] is False
    # hand should keep all cards and append the drawn card as penalty
    assert len(p1.hand) == 5
    assert p1.hand[-1].rank == "3"
    print("Failed matching (penalty) test passed!")

def test_cabo_and_counter():
    print("Testing Counter-CABO and scoring...")
    game = GameState()
    game.limit_type = "rounds"
    game.limit_value = 2
    
    game.add_player("p1")
    game.add_player("p2")
    
    game.state = "PLAYING"
    game.current_turn_index = 0 # p1's turn
    game.turn_phase = "DRAW"
    
    # p1 calls CABO
    game.call_cabo("p1")
    assert game.cabo_caller == "p1"
    assert game.turns_left_after_cabo == 1
    
    # Now it is p2's turn (since it's p1's turn + next_turn)
    # p2 decides to counter-cabo!
    assert game.get_current_player_id() == "p2"
    assert game.turn_phase == "DRAW"
    
    game.counter_cabo("p2")
    assert game.cabo_caller == "p2"
    
    # End round by simulating turns left going to 0
    p1 = game.players["p1"]
    p2 = game.players["p2"]
    
    # Let's set hands to check scoring
    # p1 score: 2 + 3 = 5
    p1.hand = [Card("hearts", "2", 2), Card("diamonds", "3", 3)]
    # p2 (caller) score: 4 + 4 = 8
    p2.hand = [Card("clubs", "4", 4), Card("spades", "4", 4)]
    
    # Since p2 (caller) score (8) is NOT strictly less than p1 score (5), it fails!
    # p2 should get 8 + 10 = 18 points. p1 should get 5 points.
    scores = game.calculate_scores()
    assert scores["p2"]["round_score"] == 18
    assert scores["p2"]["cabo_status"] == "fail"
    assert scores["p1"]["round_score"] == 5
    print("Counter-CABO scoring test passed!")

def test_opponent_matching():
    print("Testing opponent matching...")
    game = GameState()
    game.add_player("p1")
    game.add_player("p2")
    
    p1 = game.players["p1"]
    p2 = game.players["p2"]
    
    # top of discard pile is "8"
    game.discard_pile = [Card("hearts", "8", 8)]
    
    # p2 has an "8" at index 1 and "2" at index 0
    p2.hand = [Card("diamonds", "2", 2), Card("spades", "8", 8)]
    p1.hand = [Card("clubs", "A", 1), Card("hearts", "K", 13)]
    
    game.state = "PLAYING"
    
    # 1. Test successful opponent match: p1 matches p2's card at index 1 (which is "8")
    res = game.opponent_match("p1", "p2", 1)
    assert res["success"] is True
    # Card is removed from p2's hand and moved to discard pile
    assert len(p2.hand) == 1
    assert p2.hand[0].rank == "2"
    assert game.discard_pile[-1].rank == "8"
    assert game.discard_pile[-1].suit == "spades"
    
    # active_action should now be "give_card"
    assert game.active_action["type"] == "give_card"
    assert game.active_action["player_id"] == "p1"
    assert game.active_action["target_player_id"] == "p2"
    assert game.active_action["target_index"] == 1
    
    # p1 gives card at index 0 (the Ace "A") to p2
    game.handle_give_card("p1", 0)
    assert game.active_action is None
    # p1's hand should now be just Card("hearts", "K", 13)
    assert len(p1.hand) == 1
    assert p1.hand[0].rank == "K"
    # p2's hand should now have Card("diamonds", "2", 2) at index 0 and Card("clubs", "A", 1) at index 1
    assert len(p2.hand) == 2
    assert p2.hand[0].rank == "2"
    assert p2.hand[1].rank == "A"
    
    # 2. Test failed opponent match: p1 tries to match p2's card at index 0 (which is "2" but discard top is "8")
    game.discard_pile = [Card("hearts", "8", 8)]
    res = game.opponent_match("p1", "p2", 0)
    assert res["success"] is False
    # p1's hand size should increase by 1 (single penalty card by rules)
    assert len(p1.hand) == 2
    # p2's target card remains unchanged in hand
    assert p2.hand[0].rank == "2"
    print("Opponent matching test passed!")

def test_turn_timer_settings():
    print("Testing turn timer settings...")
    game = GameState()
    game.add_player("p1")
    game.add_player("p2")

    game.set_settings("rounds", 3, True, 90)
    assert game.turn_timeout == 90

    game.set_settings("rounds", 3, True, None)
    assert game.turn_timeout is None

    game.state = "PLAYING"
    game.turn_start_time = 0
    assert game.check_turn_timeouts() is None
    state = game.get_client_state("p1")
    assert state["turn_timeout"] is None
    assert state["time_left"] is None
    print("Turn timer settings test passed!")

def test_self_match_penalty_single_card():
    print("Testing self match single-card penalty...")
    game = GameState()
    game.add_player("p1")
    game.add_player("p2")

    game.state = "PLAYING"
    game.discard_pile = [Card("hearts", "9", 9)]
    p1 = game.players["p1"]
    p1.hand = [Card("clubs", "2", 2)]

    before = len(p1.hand)
    res = game.self_match("p1", 0)
    assert res["success"] is False
    assert len(p1.hand) == before + 1
    print("Self match single-card penalty test passed!")

def test_join_during_start_peek():
    print("Testing late join during start peek...")
    game = GameState()
    game.add_player("p1")
    game.add_player("p2")
    game.start_game()

    game.add_player_during_start_peek("p3")
    assert "p3" in game.players
    assert game.turn_order[-1] == "p3"
    assert len(game.players["p3"].hand) == 4
    assert game.players["p3"].is_ready is False
    print("Late join during start peek test passed!")

if __name__ == "__main__":
    test_default_limits()
    test_lobby_player_limit()
    test_matching()
    test_cabo_and_counter()
    test_opponent_matching()
    test_turn_timer_settings()
    test_self_match_penalty_single_card()
    test_join_during_start_peek()
    print("All unit tests passed successfully!")
