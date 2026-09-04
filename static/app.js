// Telegram WebApp — безопасная инициализация (работает и вне Telegram)
let tg = null;
try {
    tg = window.Telegram?.WebApp;
    if (tg) tg.expand();
} catch (e) {
    console.warn('Telegram WebApp SDK не доступен:', e);
}

const navEntry = performance.getEntriesByType?.('navigation')?.[0];
const isPageReload = navEntry?.type === 'reload';
const telegramUserId = tg?.initDataUnsafe?.user?.id;
let clientId = sessionStorage.getItem('cabo_client_id');
if (telegramUserId) {
    clientId = String(telegramUserId);
    sessionStorage.setItem('cabo_client_id', clientId);
} else if (!clientId || !isPageReload) {
    clientId = String(window.crypto?.randomUUID?.() || Math.floor(Math.random() * 1000000000));
    sessionStorage.setItem('cabo_client_id', clientId);
}

// Получаем ID комнаты из URL
const urlParams = new URLSearchParams(window.location.search);
const roomId = urlParams.get('room')?.toUpperCase() || '';

// DOM элементы для Лобби комнат
const lobbyScreen = document.getElementById('lobby-screen');
const gameContainer = document.getElementById('game-container');
const btnCreateRoom = document.getElementById('btn-create-room');
const btnJoinRoom = document.getElementById('btn-join-room');
const inputRoomCode = document.getElementById('input-room-code');
const roomCodeDisplay = document.getElementById('room-code-display');
const roomInfoBadge = document.getElementById('room-info-badge');
const btnInviteRoom = document.getElementById('btn-invite-room');

// Таймер хода
const turnTimerContainer = document.getElementById('turn-timer-container');
const turnTimerBar = document.getElementById('turn-timer-bar');
let localTimeLeft = 0;
let localTurnTimeout = 30;
let timerInterval = null;

let socket;
let gameState = null;
let prevGameState = null;
let selectedMyCardForSwap = null;
let selectedSwapAnyCards = [];
let selectedMyMatchingCards = [];
let selectedCardForMatch = null;
let activeOverflowPlayer = null;

// Инициализация отображения лобби или стола
if (!roomId) {
    if (lobbyScreen) lobbyScreen.style.display = 'flex';
    if (gameContainer) gameContainer.style.display = 'none';
} else {
    if (lobbyScreen) lobbyScreen.style.display = 'none';
    if (gameContainer) gameContainer.style.display = 'flex';
    if (roomCodeDisplay) roomCodeDisplay.textContent = roomId;
    if (roomInfoBadge) roomInfoBadge.style.display = 'flex';
    if (btnInviteRoom) btnInviteRoom.style.display = 'block';
}

// Генерация / вход в комнату
if (btnCreateRoom) {
    btnCreateRoom.onclick = () => {
        const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        let code = '';
        for (let i = 0; i < 4; i++) {
            code += letters.charAt(Math.floor(Math.random() * letters.length));
        }
        window.location.search = `?room=${code}`;
    };
}

if (btnJoinRoom) {
    btnJoinRoom.onclick = () => {
        const code = inputRoomCode.value.trim().toUpperCase();
        if (!/^[A-Z]{4}$/.test(code)) {
            showToast("Введите код комнаты из 4 латинских букв!", true);
            return;
        }
        window.location.search = `?room=${code}`;
    };
}

function getRoomInviteLink() {
    return window.location.href;
}

function getRoomInviteText() {
    return `Присоединяйся к игре CABO: ${getRoomInviteLink()}`;
}

function copyRoomInviteLink() {
    const joinLink = getRoomInviteLink();
    return navigator.clipboard.writeText(joinLink).then(() => {
        showToast("📋 Ссылка на комнату скопирована!");
    }).catch(() => {
        showToast("Не удалось скопировать, скопируйте URL браузера", true);
    });
}

function inviteRoom() {
    const joinLink = getRoomInviteLink();
    const inviteText = getRoomInviteText();
    
    if (tg?.switchInlineQuery) {
        tg.switchInlineQuery(inviteText, ["users", "groups"]);
        return;
    }
    
    if (tg?.openTelegramLink) {
        const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(joinLink)}&text=${encodeURIComponent("Присоединяйся к игре CABO")}`;
        tg.openTelegramLink(shareUrl);
        return;
    }
    
    copyRoomInviteLink();
}

if (roomInfoBadge) {
    roomInfoBadge.onclick = copyRoomInviteLink;
}

if (btnInviteRoom) {
    btnInviteRoom.onclick = inviteRoom;
}

// DOM Elements
const statusEl = document.getElementById('connection-status');
const caboBtn = document.getElementById('btn-cabo');
const playerHandEl = document.getElementById('player-hand');
const discardPileEl = document.getElementById('discard-pile');
const deckEl = document.getElementById('deck');
const opponentsAreaEl = document.getElementById('opponents-area');
const drawnCardZoneEl = document.getElementById('drawn-card-zone');
const drawnCardEl = document.getElementById('drawn-card');
const hintText = document.getElementById('hint-text');
const tableEl = document.getElementById('table');
const toastContainer = document.getElementById('toast-container');

// Modal elements
const revealModal = document.getElementById('reveal-modal');
const revealText = document.getElementById('reveal-text');
const revealCardPlaceholder = document.getElementById('reveal-card-placeholder');
const btnCloseReveal = document.getElementById('btn-close-reveal');
const blackKingOptions = document.getElementById('black-king-options');
const btnBkSwapMine = document.getElementById('btn-bk-swap-mine');
const btnBkSwapOther = document.getElementById('btn-bk-swap-other');
const btnBkCancel = document.getElementById('btn-bk-cancel');

// Score modal
const scoreModal = document.getElementById('score-modal');
const scoreboard = document.getElementById('scoreboard');
const btnRestart = document.getElementById('btn-restart');

// Overflow modal
const overflowModal = document.getElementById('overflow-modal');
const overflowCardsGrid = document.getElementById('overflow-cards-grid');
const btnCloseOverflow = document.getElementById('btn-close-overflow');

const suitSymbols = { 'hearts': '♥', 'diamonds': '♦', 'clubs': '♣', 'spades': '♠', 'joker': '🃏' };
const suitColors = { 'hearts': '#ef4444', 'diamonds': '#ef4444', 'clubs': '#1e293b', 'spades': '#1e293b', 'joker': '#8b5cf6' };
const playerColors = ['#f59e0b', '#06b6d4', '#ec4899', '#8b5cf6'];

// ===== TOAST NOTIFICATIONS =====
function showToast(message, isWarning = false) {
    const toast = document.createElement('div');
    toast.className = 'toast' + (isWarning ? ' toast-warning' : '');
    toast.textContent = message;
    toastContainer.appendChild(toast);
    
    setTimeout(() => {
        if (toast.parentNode) toast.remove();
    }, 3000);
}

// ===== HINT SYSTEM =====
function setHint(icon, text) {
    hintText.textContent = text;
    const hintIcon = document.querySelector('.hint-icon');
    if (hintIcon) hintIcon.textContent = icon;
}

// ===== WEBSOCKET =====
function connect() {
    if (!roomId) return;
    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProto}//${window.location.host}/ws/${roomId}/${clientId}`;
    socket = new WebSocket(wsUrl);
    
    socket.onopen = () => {
        statusEl.textContent = "В игре";
        statusEl.className = "status-connected";
    };
    
    socket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        if (data.type === 'system') {
            showToast(data.message, data.message.includes('CABO'));
            
            // Воспроизводим звуки на основе символов в системном логе
            if (data.message.includes("🎮") || data.message.includes("🏁")) {
                sounds.playDeal();
            } else if (data.message.includes("🃏") || data.message.includes("♻️")) {
                sounds.playDraw();
            } else if (data.message.includes("🗑️") || data.message.includes("🔄") || data.message.includes("🎁")) {
                sounds.playDiscard();
            } else if (data.message.includes("🔥")) {
                sounds.playSuccess();
            } else if (data.message.includes("💥")) {
                sounds.playError();
            } else if (data.message.includes("⚠️") || data.message.includes("⚔️") || data.message.includes("CABO")) {
                sounds.playCabo();
            }
        } else if (data.type === 'game_state') {
            const prevState = gameState?.state;
            const prevPhase = gameState?.turn_phase;
            const prevTurn = gameState?.current_turn;
            
            prevGameState = gameState ? JSON.parse(JSON.stringify(gameState)) : null;
            gameState = data;
            
            // Обновляем таймер хода
            if (gameState.state === "PLAYING" && gameState.turn_timeout !== null && gameState.time_left !== null && gameState.time_left !== undefined) {
                if (turnTimerContainer) turnTimerContainer.style.display = 'block';
                localTimeLeft = gameState.time_left;
                localTurnTimeout = gameState.turn_timeout || 30;
                
                if (timerInterval) clearInterval(timerInterval);
                updateTimerUI();
                timerInterval = setInterval(() => {
                    localTimeLeft = Math.max(0, localTimeLeft - 0.1);
                    updateTimerUI();
                    if (localTimeLeft <= 0) {
                        clearInterval(timerInterval);
                    }
                }, 100);
            } else {
                if (turnTimerContainer) turnTimerContainer.style.display = 'none';
                if (timerInterval) {
                    clearInterval(timerInterval);
                    timerInterval = null;
                }
            }
            
            // Сброс выбора при смене хода/фазы/раунда
            if (prevState !== gameState.state || prevPhase !== gameState.turn_phase || prevTurn !== gameState.current_turn) {
                selectedMyMatchingCards = [];
                selectedMyCardForSwap = null;
                selectedSwapAnyCards = [];
                selectedCardForMatch = null;
            }
            
            // Запуск анимации обмена
            let animated = false;
            if (prevGameState && prevGameState.drawn_card && !gameState.drawn_card && prevGameState.current_turn === clientId) {
                const myHand = gameState.players[clientId]?.hand || [];
                const oldDrawn = prevGameState.drawn_card;
                const idx = myHand.findIndex(c => c.rank === oldDrawn.rank && c.suit === oldDrawn.suit);
                
                if (idx !== -1) {
                    const oldHandCardData = prevGameState.players[clientId].hand[idx];
                    animateSwap(idx, oldDrawn, oldHandCardData);
                    animated = true;
                }
            }
            
            if (!animated) {
                renderGame();
            }
        } else if (data.type === 'error') {
            showToast(`❌ ${data.message}`, true);
        }
    };
    
    socket.onclose = () => {
        statusEl.textContent = "Отключено";
        statusEl.className = "status-disconnected";
        setTimeout(connect, 3000);
    };
}

// ===== CARD UI =====
function createCardUI(cardData, isHidden, addAnim = false) {
    const cardEl = document.createElement('div');
    
    if (isHidden) {
        cardEl.className = 'card card-back' + (addAnim ? ' card-deal-anim' : '');
        cardEl.innerHTML = '<span>CABO</span>';
    } else {
        const suit = cardData.suit;
        const rank = cardData.rank;
        const symbol = suitSymbols[suit] || '';
        const color = suitColors[suit] || 'black';
        
        let cardClass = 'card';
        if (suit === 'joker') {
            cardClass += ' card-joker';
        } else if (rank === 'K') {
            const isRed = (suit === 'hearts' || suit === 'diamonds');
            cardClass += ' card-king ' + (isRed ? 'king-red' : 'king-black');
        }
        
        cardEl.className = cardClass + (addAnim ? ' card-flip-anim' : '');
        cardEl.style.color = color;
        
        if (suit === 'joker') {
            cardEl.innerHTML = `
                <div class="card-face">
                    <div class="card-corner"><span>🃏</span></div>
                    <div class="card-center-suit" style="font-size: 1.8rem;">🃏</div>
                    <div class="card-corner card-corner-bottom"><span>🃏</span></div>
                </div>`;
        } else {
            cardEl.innerHTML = `
                <div class="card-face">
                    <div class="card-corner">
                        <span>${rank}</span>
                        <span class="corner-suit">${symbol}</span>
                    </div>
                    <div class="card-center-suit">${symbol}</div>
                    <div class="card-corner card-corner-bottom">
                        <span>${rank}</span>
                        <span class="corner-suit">${symbol}</span>
                    </div>
                </div>`;
        }
    }
    return cardEl;
}

function isCardSelectedForSwapAny(pId, idx) {
    return selectedSwapAnyCards.some(item => item.pId === pId && item.idx === idx);
}

function getPlayerColor(pId) {
    const ids = Object.keys(gameState?.players || {});
    const index = ids.indexOf(pId);
    return playerColors[index % playerColors.length];
}

function getPlayerIdsForState() {
    if (!gameState) return [];
    return Array.isArray(gameState.players) ? gameState.players : Object.keys(gameState.players || {});
}

function applyTableLayout() {
    const playerIds = getPlayerIdsForState();
    const totalPlayers = playerIds.length;
    const boardMode = gameState && gameState.state !== "WAITING";
    
    tableEl.classList.remove('table-board', 'circular-table', 'player-count-2', 'player-count-3', 'player-count-4', 'player-count-5', 'player-count-6');
    opponentsAreaEl.className = '';
    
    if (boardMode) {
        tableEl.classList.add('table-board', `player-count-${Math.min(Math.max(totalPlayers, 2), 6)}`);
        if (totalPlayers >= 5) {
            tableEl.classList.add('circular-table');
        }
        opponentsAreaEl.className = `seat-layout player-count-${Math.min(Math.max(totalPlayers, 2), 6)}`;
    }
}

function getOrderedOpponents() {
    const allIds = getPlayerIdsForState();
    const myIndex = allIds.indexOf(clientId);
    const ordered = [];
    
    if (myIndex !== -1) {
        // Начиная со следующего игрока после меня по часовой стрелке
        for (let i = 1; i < allIds.length; i++) {
            ordered.push(allIds[(myIndex + i) % allIds.length]);
        }
    } else {
        // Для наблюдателя
        ordered.push(...allIds);
    }
    return ordered;
}

function getSeatIndex(opponentIndexPlusOne, totalPlayers) {
    if (totalPlayers <= 2) {
        return 3; // Строго напротив сверху
    }
    if (totalPlayers === 3) {
        const slots = [1, 5]; // Слева, справа
        return slots[opponentIndexPlusOne - 1] || 3;
    }
    if (totalPlayers === 4) {
        const slots = [1, 3, 5]; // Слева, сверху, справа (квадрат)
        return slots[opponentIndexPlusOne - 1] || 3;
    }
    if (totalPlayers === 5) {
        const slots = [1, 2, 4, 5]; // Слева-низ, слева-вверх, справа-вверх, справа-низ (круг)
        return slots[opponentIndexPlusOne - 1] || 3;
    }
    if (totalPlayers >= 6) {
        const slots = [1, 2, 3, 4, 5]; // Все 5 слотов по кругу
        return slots[opponentIndexPlusOne - 1] || 3;
    }
    return opponentIndexPlusOne;
}

// ===== MAIN RENDER =====
function renderGame() {
    if (!gameState) return;
    const isMyTurn = gameState.current_turn === clientId;
    applyTableLayout();

    // В фазе WAITING players — массив строк. В остальных — объект.
    const amIPlayer = gameState.state === "WAITING"
        ? gameState.players.includes(clientId)
        : !!gameState.players[clientId];
    const myData = (gameState.state !== "WAITING" && amIPlayer) ? gameState.players[clientId] : null;
    const isSpectator = !amIPlayer;

    // Footer скрываем в лобби (WAITING), чтобы не дублировать кнопку старта
    const playerArea = document.getElementById('player-area');
    const footer = document.querySelector('footer');
    if (footer) footer.style.display = gameState.state === 'WAITING' ? 'none' : 'flex';
    if (playerArea) playerArea.style.display = gameState.state === 'WAITING' ? 'none' : 'block';

    // Скрываем настройки лобби по умолчанию
    const lobbySettingsEl = document.getElementById('lobby-settings');
    if (lobbySettingsEl) lobbySettingsEl.style.display = 'none';

    // Сброс центральной зоны к игровому виду (если мы вышли из лобби)
    const centerArea = document.getElementById('center-area');
    if (centerArea) {
        centerArea.style.flexDirection = 'row';
        centerArea.style.alignItems = 'center';
        centerArea.style.gap = '25px';
        const existingLobbyBtn = document.getElementById('lobby-start-btn');
        if (existingLobbyBtn) existingLobbyBtn.remove();
    }
    if (deckEl) deckEl.style.display = 'block';
    if (discardPileEl) discardPileEl.style.display = 'block';

    // ----- Temp reveal modal -----
    if (gameState.temp_reveal_card) {
        revealModal.style.display = 'flex';
        revealText.textContent = gameState.temp_reveal_card.text || "Вы заглянули в карту:";
        revealCardPlaceholder.innerHTML = '';
        const revealPile = document.createElement('div');
        revealPile.className = 'card-pile';
        revealPile.appendChild(createCardUI(gameState.temp_reveal_card.card, false, true));
        revealCardPlaceholder.appendChild(revealPile);
        
        if (gameState.temp_reveal_card.is_black_king) {
            blackKingOptions.style.display = 'flex';
            btnCloseReveal.style.display = 'none';
        } else {
            blackKingOptions.style.display = 'none';
            btnCloseReveal.style.display = 'block';
        }
    } else {
        revealModal.style.display = 'none';
    }

    // ----- Score modal -----
    if (gameState.state === "ROUND_END" && gameState.scores) {
        scoreModal.style.display = 'flex';
        renderScoreboard();
    } else {
        scoreModal.style.display = 'none';
    }

    // ----- Table glow -----
    tableEl.classList.remove('my-turn', 'not-my-turn');
    if (gameState.state === "PLAYING") {
        tableEl.classList.add(isMyTurn ? 'my-turn' : 'not-my-turn');
    }

    // ===== STATE: WAITING =====
    if (gameState.state === "WAITING") {
        console.log('[CABO DEBUG] WAITING state:', JSON.stringify(gameState.players), 'clientId:', clientId);
        
        const playersArr = gameState.players;
        const hostId = gameState.host_id;
        const isHost = hostId === clientId;
        const isMember = Array.isArray(playersArr) && playersArr.includes(clientId);
        const canStart = Array.isArray(playersArr) && playersArr.length >= 2;

        console.log('[CABO DEBUG] isHost:', isHost, 'hostId:', hostId, 'canStart:', canStart);

        statusEl.textContent = `Лобби (${playersArr.length}/6)`;
        statusEl.className = "status-disconnected";

        // Рендерим настройки серии лобби
        renderLobbySettings(isHost);

        // Показываем список игроков в лобби
        opponentsAreaEl.className = '';
        opponentsAreaEl.innerHTML = '';
        playersArr.forEach((pid, i) => {
            const div = document.createElement('div');
            div.className = 'opponent-name';
            const isMe = pid === clientId;
            div.innerHTML = `<span class="player-avatar" style="background:${playerColors[i % playerColors.length]}">${pid.slice(-2)}</span> Игрок ${pid.slice(-4)} ${isMe ? '(вы)' : ''} ${pid === hostId ? '👑' : ''}`;
            opponentsAreaEl.appendChild(div);
        });

        // Скрываем колоду/сброс/руку — они не нужны в лобби
        playerHandEl.innerHTML = '';
        drawnCardZoneEl.style.display = 'none';

        // КНОПКА СТАРТА — прямо в center-area, видна всем
        const centerArea = document.getElementById('center-area');
        // Скрываем колоду и сброс, но не удаляем их из DOM!
        if (deckEl) deckEl.style.display = 'none';
        if (discardPileEl) discardPileEl.style.display = 'none';

        centerArea.style.flexDirection = 'column';
        centerArea.style.alignItems = 'center';
        centerArea.style.gap = '15px';

        // Убеждаемся, что старой кнопки нет, чтобы не дублировать
        const existingLobbyBtn = document.getElementById('lobby-start-btn');
        if (existingLobbyBtn) existingLobbyBtn.remove();

        if (isHost && canStart) {
            setHint('👑', `Вы хост! Нажмите кнопку чтобы начать.`);
        } else if (isHost && !canStart) {
            setHint('👑', `Вы хост. Ждём ещё игроков (мин. 2)...`);
        } else if (isMember) {
            setHint('⏳', `Вы в лобби. Ждём, пока хост запустит игру...`);
        } else {
            setHint('👁️', `Вы зритель. Нажмите «Сбросить» чтобы войти.`);
        }

        // Создаём кнопку для ВСЕХ — для хоста активную, для остальных неактивную
        const startBtn = document.createElement('button');
        startBtn.id = 'lobby-start-btn';
        startBtn.style.cssText = `
            background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
            color: white;
            border: none;
            padding: 18px 40px;
            border-radius: 14px;
            font-family: 'Outfit', sans-serif;
            font-size: 1.3rem;
            font-weight: 800;
            cursor: pointer;
            text-transform: uppercase;
            letter-spacing: 1px;
            box-shadow: 0 6px 20px rgba(59, 130, 246, 0.5);
            transition: all 0.2s ease;
            margin-top: 10px;
        `;

        if (isHost && canStart) {
            startBtn.textContent = '🚀 НАЧАТЬ ИГРУ';
            startBtn.onclick = () => {
                socket.send(JSON.stringify({ action: "start_game" }));
            };
        } else if (isHost && !canStart) {
            startBtn.textContent = '⏳ ЖДЁМ ИГРОКОВ...';
            startBtn.disabled = true;
            startBtn.style.background = '#334155';
            startBtn.style.color = '#64748b';
            startBtn.style.boxShadow = 'none';
            startBtn.style.cursor = 'not-allowed';
        } else {
            startBtn.textContent = '⏳ ОЖИДАНИЕ ХОСТА...';
            startBtn.disabled = true;
            startBtn.style.background = '#334155';
            startBtn.style.color = '#64748b';
            startBtn.style.boxShadow = 'none';
            startBtn.style.cursor = 'not-allowed';
        }

        centerArea.appendChild(startBtn);
        console.log('[CABO DEBUG] Start button appended, text:', startBtn.textContent);

        // Footer кнопку тоже обновляем
        caboBtn.textContent = isHost ? "Начать игру" : "Ожидание...";
        caboBtn.disabled = !(isHost && canStart);

        return;
    }

    // ===== STATE: START_PEEK =====
    if (gameState.state === "START_PEEK") {
        const peekedCount = myData ? myData.hand.filter(c => c.state !== 'hidden').length : 0;
        const isReady = myData?.is_ready;
        
        statusEl.textContent = "Подглядите карты";
        statusEl.className = "status-disconnected";
        caboBtn.textContent = isReady ? "Ожидание соперника..." : "Я готов!";
        caboBtn.disabled = isReady;
        
        setHint('👀', isReady ? 'Вы готовы. Ожидание соперника...' : `Нажмите на любые 2 свои карты, чтобы подглядеть (${peekedCount}/2)`);

        opponentsAreaEl.innerHTML = '';
        const orderedOpponents = getOrderedOpponents();
        const totalPlayers = getPlayerIdsForState().length;
        
        orderedOpponents.forEach((pId, idx) => {
            const oppData = gameState.players[pId];
            const div = document.createElement('div');
            const seatIdx = getSeatIndex(idx + 1, totalPlayers);
            div.className = `opponent-block seat-${seatIdx}`;
            div.innerHTML = `
                <div class="opponent-name">
                    <div class="opponent-avatar" style="background: ${getPlayerColor(pId)};">${pId.slice(-2)}</div>
                    Игрок ${pId.slice(-4)}
                    ${oppData.is_ready ? ' 🟢' : ' 🔴'}
                </div>
            `;
            opponentsAreaEl.appendChild(div);
        });

        // Отрисовываем реальную колоду в фазе подглядывания
        deckEl.innerHTML = '';
        if (gameState.deck_count > 0) {
            const deckCard = document.createElement('div');
            deckCard.className = 'card card-back';
            deckCard.innerHTML = `<span>CABO</span><div style="position:absolute; bottom: 4px; right: 6px; font-size: 0.65rem; color: #60a5fa; z-index: 3;">x${gameState.deck_count}</div>`;
            deckEl.appendChild(deckCard);
        } else {
            deckEl.innerHTML = '<div class="card empty">Пусто</div>';
        }
        deckEl.classList.remove('clickable-glow');

        // Отрисовываем реальный сброс в фазе подглядывания
        discardPileEl.innerHTML = '';
        const peekHistory = gameState.discard_history || [];
        if (peekHistory.length > 0) {
            peekHistory.forEach((card, idx) => {
                const cardUI = createCardUI(card, false);
                const fanClass = 'discard-fan-' + (2 - (peekHistory.length - 1 - idx));
                cardUI.classList.add(fanClass);
                discardPileEl.appendChild(cardUI);
            });
        } else {
            discardPileEl.innerHTML = '<div class="card empty">Сброс</div>';
        }
        discardPileEl.classList.remove('clickable-glow');

        drawnCardZoneEl.style.display = 'none';

        playerHandEl.innerHTML = '';
        if (myData) {
            myData.hand.forEach((card, idx) => {
                const pile = document.createElement('div');
                pile.className = 'card-pile';
                const isPeeked = card.state !== 'hidden';
                pile.appendChild(createCardUI(card, !isPeeked, isPeeked));
                
                if (!isReady) {
                    pile.classList.add('clickable-glow');
                }
                
                pile.onclick = () => {
                    if (!isReady) {
                        socket.send(JSON.stringify({ action: "peek_start", index: idx }));
                    }
                };
                playerHandEl.appendChild(pile);
            });
        }
        return;
    }

    if (gameState.state === "PLAYING") {
        if (gameState.active_action) {
            renderAbilityStatus(gameState.active_action);
            if (gameState.active_action.type === "give_card") {
                caboBtn.disabled = true;
            } else {
                caboBtn.textContent = "Пропустить действие";
                caboBtn.disabled = !isMyTurn;
            }
        } else if (isMyTurn) {
            statusEl.className = "status-connected";
            if (gameState.turn_phase === "DRAW") {
                statusEl.textContent = "Ваш ход!";
                if (gameState.cabo_caller !== null) {
                    setHint('⚠️', 'Последний круг! Нажмите «ВСТРЕЧНОЕ CABO!» или возьмите карту.');
                    caboBtn.textContent = "⚔️ ВСТРЕЧНОЕ CABO!";
                    caboBtn.disabled = (gameState.cabo_caller === clientId); // нельзя встречное самому себе
                } else {
                    if (gameState.allow_discard_draw) {
                        setHint('🃏', 'Возьмите карту из колоды или из сброса');
                    } else {
                        setHint('🃏', 'Возьмите карту из колоды (брать из сброса отключено)');
                    }
                    caboBtn.textContent = "Сказать CABO!";
                    caboBtn.disabled = false;
                }
            } else if (gameState.turn_phase === "CHOICE" || gameState.turn_phase === "MUST_SWAP") {
                statusEl.textContent = "Ваш ход!";
                if (gameState.turn_phase === "CHOICE") {
                    setHint('🔄', 'Выберите карты в руке для замены или нажмите на сброс');
                } else {
                    setHint('🔄', 'Выберите карты в руке для замены (обязательно)');
                }
                
                if (selectedMyMatchingCards.length > 0) {
                    caboBtn.textContent = selectedMyMatchingCards.length > 1 ? "🔥 Сбросить с матчингом" : "🔄 Поменять карту";
                    caboBtn.disabled = false;
                } else {
                    caboBtn.textContent = "Выберите карты...";
                    caboBtn.disabled = true;
                }
            }
        } else {
            statusEl.textContent = "Ход соперника";
            statusEl.className = "status-disconnected";
            setHint('⏳', 'Подождите, пока соперник сделает ход');
            caboBtn.textContent = "Сказать CABO!";
            caboBtn.disabled = true;
        }

        if (gameState.cabo_caller) {
            setHint('⚠️', `CABO объявлен! Последний круг ходов.`);
        }
        if (isSpectator) {
            setHint('👁️', 'Вы — наблюдатель. Идет игра между другими игроками.');
        }
    } else if (gameState.state === "ROUND_END") {
        statusEl.textContent = "Раунд завершен!";
        statusEl.className = "status-connected";
        caboBtn.disabled = true;
        setHint('🏆', 'Посмотрите результаты раунда!');
    }

    // ----- Opponents -----
    opponentsAreaEl.innerHTML = '';
    const orderedOpponents = getOrderedOpponents();
    const totalPlayers = getPlayerIdsForState().length;
    
    orderedOpponents.forEach((pId, idx) => {
        const oppData = gameState.players[pId];
        const oppDiv = document.createElement('div');
        const seatIdx = getSeatIndex(idx + 1, totalPlayers);
        oppDiv.className = `opponent-block seat-${seatIdx}`;
            
            const isOppTurn = gameState.current_turn === pId;
            
            oppDiv.innerHTML = `
                <div class="opponent-name">
                    <div class="opponent-avatar" style="background: ${getPlayerColor(pId)};">${pId.slice(-2)}</div>
                    Игрок ${pId.slice(-4)} (${oppData.hand_count})
                    ${isOppTurn ? '<span class="turn-indicator"></span>' : ''}
                </div>
            `;

            const handDiv = document.createElement('div');
            handDiv.className = 'hand';
            
            const totalCards = oppData.hand.length;
            const maxVisible = 6;
            
            oppData.hand.forEach((card, idx) => {
                if (totalCards > maxVisible && idx === maxVisible - 1) {
                    const overflowCard = document.createElement('div');
                    overflowCard.className = 'card-pile card card-overflow';
                    overflowCard.innerHTML = `<span>+${totalCards - (maxVisible - 1)}</span><div class="overflow-label">карты</div>`;
                    overflowCard.onclick = () => openOverflowModal(pId);
                    handDiv.appendChild(overflowCard);
                    return;
                }
                if (totalCards > maxVisible && idx >= maxVisible - 1) {
                    return;
                }
                
                const pile = document.createElement('div');
                pile.className = 'card-pile';
                
                const isMatchSelected = selectedCardForMatch && selectedCardForMatch.type === 'opponent' && selectedCardForMatch.oppId === pId && selectedCardForMatch.index === idx;
                if (isCardSelectedForSwapAny(pId, idx)) pile.classList.add('card-selected-blue');
                if (isMatchSelected) pile.classList.add('card-selected');
                
                const showOppClickable = (amIPlayer && !gameState.active_action && gameState.state === "PLAYING") || (
                    isMyTurn && gameState.turn_phase === "ACTION" && (
                        gameState.active_action?.type === "spy" ||
                        gameState.active_action?.type === "swap" ||
                        gameState.active_action?.type === "swap_any" ||
                        (gameState.active_action?.type === "black_king" && gameState.active_action?.step === "init") ||
                        (gameState.active_action?.type === "black_king" && gameState.active_action?.step === "swap_other")
                    )
                );
                if (showOppClickable) pile.classList.add('clickable-glow');
                
                pile.appendChild(createCardUI(card, card.state === 'hidden'));
                pile.onclick = () => handleOpponentCardClick(pId, idx);
                handDiv.appendChild(pile);
            });
            oppDiv.appendChild(handDiv);
            opponentsAreaEl.appendChild(oppDiv);
    });

    // ----- Deck -----
    deckEl.innerHTML = '';
    if (gameState.deck_count > 0) {
        const deckCard = document.createElement('div');
        deckCard.className = 'card card-back';
        deckCard.innerHTML = `<span>CABO</span><div style="position:absolute; bottom: 4px; right: 6px; font-size: 0.65rem; color: #60a5fa; z-index: 3;">x${gameState.deck_count}</div>`;
        
        if (isMyTurn && gameState.turn_phase === "DRAW") {
            deckEl.classList.add('clickable-glow');
        } else {
            deckEl.classList.remove('clickable-glow');
        }
        
        deckEl.appendChild(deckCard);
    } else {
        deckEl.innerHTML = '<div class="card empty">Пусто</div>';
        deckEl.classList.remove('clickable-glow');
    }

    // ----- Discard -----
    discardPileEl.innerHTML = '';
    const history = gameState.discard_history || [];
    if (history.length > 0) {
        history.forEach((card, idx) => {
            const isTop = idx === history.length - 1;
            const prevTop = prevGameState?.discard_history ? prevGameState.discard_history[prevGameState.discard_history.length - 1] : null;
            const isNew = isTop && (!prevTop || prevTop.suit !== card.suit || prevTop.rank !== card.rank);
            
            const cardUI = createCardUI(card, false, isNew);
            const fanClass = 'discard-fan-' + (2 - (history.length - 1 - idx));
            cardUI.classList.add(fanClass);
            
            discardPileEl.appendChild(cardUI);
        });
        
        const showDiscardClickable = (isMyTurn && (
            (gameState.turn_phase === "DRAW" && gameState.allow_discard_draw) || 
            gameState.turn_phase === "CHOICE"
        )) || (selectedCardForMatch !== null);
        if (showDiscardClickable) {
            discardPileEl.classList.add('clickable-glow');
        } else {
            discardPileEl.classList.remove('clickable-glow');
        }
    } else {
        discardPileEl.innerHTML = '<div class="card empty">Сброс</div>';
        discardPileEl.classList.remove('clickable-glow');
    }

    // ----- Drawn card -----
    if (gameState.drawn_card) {
        drawnCardZoneEl.style.display = 'block';
        drawnCardEl.innerHTML = '';
        const prevDrawn = prevGameState?.drawn_card;
        const isNewDrawn = !prevDrawn || prevDrawn.suit !== gameState.drawn_card.suit || prevDrawn.rank !== gameState.drawn_card.rank;
        drawnCardEl.appendChild(createCardUI(gameState.drawn_card, false, isNewDrawn));
    } else {
        drawnCardZoneEl.style.display = 'none';
    }

    // ----- Player hand -----
    playerHandEl.innerHTML = '';
    if (myData) {
        const totalCards = myData.hand.length;
        const maxVisible = 6;
        
        myData.hand.forEach((card, idx) => {
            if (totalCards > maxVisible && idx === maxVisible - 1) {
                const overflowCard = document.createElement('div');
                overflowCard.className = 'card-pile card card-overflow';
                overflowCard.innerHTML = `<span>+${totalCards - (maxVisible - 1)}</span><div class="overflow-label">карты</div>`;
                overflowCard.onclick = () => openOverflowModal(clientId);
                playerHandEl.appendChild(overflowCard);
                return;
            }
            if (totalCards > maxVisible && idx >= maxVisible - 1) {
                return;
            }
            
            const pile = document.createElement('div');
            pile.className = 'card-pile';
            
            const isMatchSelected = selectedCardForMatch && selectedCardForMatch.type === 'mine' && selectedCardForMatch.index === idx;
            if (selectedMyCardForSwap === idx || selectedMyMatchingCards.includes(idx) || isMatchSelected) pile.classList.add('card-selected');
            if (isCardSelectedForSwapAny(clientId, idx)) pile.classList.add('card-selected-blue');
            
            const showClickable = (amIPlayer && !gameState.active_action && gameState.state === "PLAYING") || (isMyTurn && (
                gameState.turn_phase === "CHOICE" || 
                gameState.turn_phase === "MUST_SWAP" ||
                (gameState.turn_phase === "ACTION" && gameState.active_action?.type === "peek") ||
                (gameState.turn_phase === "ACTION" && gameState.active_action?.type === "swap") ||
                (gameState.turn_phase === "ACTION" && gameState.active_action?.type === "swap_any") ||
                (gameState.turn_phase === "ACTION" && gameState.active_action?.step === "swap_mine")
            )) || (gameState.active_action?.type === "give_card" && gameState.active_action?.player_id === clientId);
            if (showClickable) pile.classList.add('clickable-glow');
            
            pile.appendChild(createCardUI(card, card.state === 'hidden'));
            pile.onclick = () => handleMyHandCardClick(idx);
            playerHandEl.appendChild(pile);
        });
    }
    
    // Обновляем окно переполнения, если оно открыто
    if (activeOverflowPlayer) {
        const player = gameState.players[activeOverflowPlayer];
        if (!player || player.hand.length <= 6 || gameState.state !== "PLAYING") {
            closeOverflowModal();
        } else {
            renderOverflowModal();
        }
    }
}

function renderAbilityStatus(action) {
    const ability = action.type;
    const step = action.step;
    statusEl.className = "status-connected";
    caboBtn.disabled = true;

    if (ability === "give_card") {
        const isMyAction = action.player_id === clientId;
        if (isMyAction) {
            statusEl.textContent = "🎁 Отдайте карту!";
            setHint('🎁', `Нажмите на любую свою карту, чтобы передать её Игроку ${action.target_player_id.slice(-4)}`);
            caboBtn.textContent = "Выберите карту...";
        } else {
            statusEl.textContent = "🎁 Передача карты";
            setHint('⏳', `Игрок ${action.player_id.slice(-4)} выбирает карту для передачи Игроку ${action.target_player_id.slice(-4)}`);
            caboBtn.textContent = "Ожидание...";
        }
    } else if (ability === "peek") {
        statusEl.textContent = "Способность карты";
        setHint('👀', '7/8 — Нажмите на свою карту, чтобы подглядеть');
    } else if (ability === "spy") {
        statusEl.textContent = "Способность карты";
        setHint('🕵️', '9/10 — Нажмите на карту соперника, чтобы подглядеть');
    } else if (ability === "swap") {
        if (selectedMyCardForSwap === null) {
            statusEl.textContent = "Валет (J)";
            setHint('🔄', 'Выберите СВОЮ карту для обмена');
        } else {
            statusEl.textContent = "Валет (J)";
            setHint('🔄', 'Теперь нажмите на карту СОПЕРНИКА для обмена');
        }
    } else if (ability === "swap_any") {
        if (selectedSwapAnyCards.length === 0) {
            statusEl.textContent = "Дама (Q)";
            setHint('👸', 'Выберите первую карту (любого игрока) для обмена');
        } else {
            statusEl.textContent = "Дама (Q)";
            setHint('👸', 'Выберите вторую карту (любого игрока) для обмена');
        }
    } else if (ability === "black_king") {
        if (step === "init") {
            statusEl.textContent = "Черный Король (K)";
            setHint('👑', 'Нажмите на карту соперника, чтобы подглядеть');
        } else if (step === "swap_mine") {
            statusEl.textContent = "Черный Король (K)";
            setHint('👑', 'Нажмите на свою карту, чтобы поменять с просмотренной');
        } else if (step === "swap_other") {
            statusEl.textContent = "Черный Король (K)";
            setHint('👑', 'Нажмите на карту другого игрока для обмена');
        } else {
            statusEl.textContent = "Черный Король (K)";
            setHint('👑', 'Сделайте выбор во всплывающем окне');
        }
    }
}

function renderScoreboard() {
    scoreboard.innerHTML = '';
    if (!gameState.scores) return;
    
    // Показываем текущий раунд и лимиты
    const roundTitle = document.createElement('div');
    roundTitle.style.cssText = 'font-size: 0.9rem; font-weight: bold; color: #60a5fa; margin-bottom: 15px; text-align: center;';
    
    const limitInfo = gameState.limit_type === 'rounds' ? `раундов: ${gameState.limit_value}` : `очков: ${gameState.limit_value}`;
    const isOver = gameState.game_over ? ' (Серия завершена!)' : '';
    roundTitle.textContent = `Серия раундов (Лимит ${limitInfo}) — Раунд ${gameState.current_round}${isOver}`;
    scoreboard.appendChild(roundTitle);
    
    // Сортируем по суммарным очкам
    const sortedPlayers = Object.entries(gameState.scores).sort((a, b) => a[1].total_score - b[1].total_score);
    
    sortedPlayers.forEach(([pId, data]) => {
        const row = document.createElement('div');
        row.className = 'scoreboard-row';
        if (gameState.game_over && data.is_match_winner) {
            row.className += ' winner';
        } else if (!gameState.game_over && data.is_winner) {
            row.className += ' winner';
        }
        
        const isMe = pId === clientId;
        const nameLabel = isMe ? 'Вы' : `Игрок ${pId.slice(-4)}`;
        
        // Описание статуса CABO
        let caboBadge = '';
        if (data.is_cabo_caller) {
            if (data.cabo_status === 'success') {
                caboBadge = ' <span class="winner-badge" style="background:#10b981; color:white;">🔥 Успешный CABO</span>';
            } else if (data.cabo_status === 'fail') {
                caboBadge = ' <span class="winner-badge" style="background:#ef4444; color:white;">💥 Неудачный CABO (+10)</span>';
            }
        }
        
        // Перечисление карт
        const cardsList = data.cards.map(c => {
            const sym = suitSymbols[c.suit] || '';
            return c.rank === 'Joker' ? '🃏' : `${c.rank}${sym}`;
        }).join(' ');
        
        row.innerHTML = `
            <div>
                <div class="scoreboard-name">${nameLabel} ${caboBadge} ${gameState.game_over && data.is_match_winner ? '<span class="winner-badge">🏆 Победитель серии</span>' : ''}</div>
                <div style="font-size: 0.75rem; color: #94a3b8; margin-top: 3px;">Карты: ${cardsList}</div>
            </div>
            <div style="text-align: right;">
                <div class="scoreboard-score" style="font-size: 1.1rem; font-weight: 800; color: #e2e8f0; margin-bottom: 2px;">${data.total_score} <span style="font-size:0.75rem; font-weight:normal; color:#94a3b8;">общ.</span></div>
                <div style="font-size: 0.7rem; color: #94a3b8;">+${data.round_score} за раунд</div>
            </div>
        `;
        scoreboard.appendChild(row);
    });

    // Изменяем текст и функционал кнопки в зависимости от game_over
    const nextBtn = document.getElementById('btn-restart');
    if (nextBtn) {
        if (gameState.game_over) {
            nextBtn.textContent = "🏆 СБРОСИТЬ И НАЧАТЬ ЗАНОВО";
            nextBtn.style.background = "linear-gradient(135deg, #10b981 0%, #059669 100%)";
            nextBtn.onclick = () => {
                socket.send(JSON.stringify({ action: "restart" }));
                scoreModal.style.display = 'none';
            };
        } else {
            nextBtn.textContent = "🏁 СЛЕДУЮЩИЙ РАУНД";
            nextBtn.style.background = "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)";
            nextBtn.onclick = () => {
                socket.send(JSON.stringify({ action: "next_round" }));
                scoreModal.style.display = 'none';
            };
        }
    }
}

function openOverflowModal(playerId) {
    activeOverflowPlayer = playerId;
    overflowModal.style.display = 'flex';
    renderOverflowModal();
}

function closeOverflowModal() {
    activeOverflowPlayer = null;
    overflowModal.style.display = 'none';
}

function renderOverflowModal() {
    if (!activeOverflowPlayer || !gameState) {
        overflowModal.style.display = 'none';
        return;
    }
    
    overflowCardsGrid.innerHTML = '';
    const player = gameState.players[activeOverflowPlayer];
    if (!player) return;
    
    const isMyTurn = gameState.current_turn === clientId;
    const isMe = activeOverflowPlayer === clientId;
    const amIPlayer = !!gameState.players[clientId];
    const startIndex = 5; // Отображаем карты с 6-й (индекс 5) и дальше
    
    player.hand.slice(startIndex).forEach((card, offsetIdx) => {
        const idx = startIndex + offsetIdx;
        const pile = document.createElement('div');
        pile.className = 'card-pile';
        
        if (isMe) {
            const isMatchSelected = selectedCardForMatch && selectedCardForMatch.type === 'mine' && selectedCardForMatch.index === idx;
            if (selectedMyCardForSwap === idx || selectedMyMatchingCards.includes(idx) || isMatchSelected) pile.classList.add('card-selected');
            if (isCardSelectedForSwapAny(clientId, idx)) pile.classList.add('card-selected-blue');
        } else {
            const isMatchSelected = selectedCardForMatch && selectedCardForMatch.type === 'opponent' && selectedCardForMatch.oppId === activeOverflowPlayer && selectedCardForMatch.index === idx;
            if (isCardSelectedForSwapAny(activeOverflowPlayer, idx)) pile.classList.add('card-selected-blue');
            if (isMatchSelected) pile.classList.add('card-selected');
        }
        
        let showClickable = false;
        if (isMe) {
            showClickable = (amIPlayer && !gameState.active_action && gameState.state === "PLAYING") || (isMyTurn && (
                gameState.turn_phase === "CHOICE" || 
                gameState.turn_phase === "MUST_SWAP" ||
                (gameState.turn_phase === "ACTION" && gameState.active_action?.type === "peek") ||
                (gameState.turn_phase === "ACTION" && gameState.active_action?.type === "swap") ||
                (gameState.turn_phase === "ACTION" && gameState.active_action?.type === "swap_any") ||
                (gameState.turn_phase === "ACTION" && gameState.active_action?.step === "swap_mine")
            )) || (gameState.active_action?.type === "give_card" && gameState.active_action?.player_id === clientId);
        } else {
            showClickable = (amIPlayer && !gameState.active_action && gameState.state === "PLAYING") || (
                isMyTurn && gameState.turn_phase === "ACTION" && (
                    gameState.active_action?.type === "spy" ||
                    gameState.active_action?.type === "swap" ||
                    gameState.active_action?.type === "swap_any" ||
                    (gameState.active_action?.type === "black_king" && gameState.active_action?.step === "init") ||
                    (gameState.active_action?.type === "black_king" && gameState.active_action?.step === "swap_other")
                )
            );
        }
        if (showClickable) pile.classList.add('clickable-glow');
        
        pile.appendChild(createCardUI(card, card.state === 'hidden'));
        pile.onclick = () => {
            if (isMe) {
                handleMyHandCardClick(idx);
            } else {
                handleOpponentCardClick(activeOverflowPlayer, idx);
            }
            renderOverflowModal();
        };
        overflowCardsGrid.appendChild(pile);
    });
}

// ===== EVENT HANDLERS =====
function handleMyHandCardClick(index) {
    if (!gameState) return;
    if (!gameState.players?.[clientId]) return;
    const isMyTurn = gameState.current_turn === clientId;
    
    // Если нужно передать карту сопернику (give_card для МЕНЯ)
    if (gameState.active_action?.type === "give_card" && gameState.active_action?.player_id === clientId) {
        socket.send(JSON.stringify({ action: "give_card_choice", card_index: index }));
        return;
    }

    // Если идет выбор способности - только в свой ход
    if (isMyTurn && gameState.active_action && gameState.turn_phase === "ACTION") {
        if (gameState.active_action?.type === "peek") {
            socket.send(JSON.stringify({ action: "use_ability", card_index: index }));
        } else if (gameState.active_action?.type === "swap") {
            selectedMyCardForSwap = index;
            renderGame();
        } else if (gameState.active_action?.type === "swap_any") {
            handleSwapAnySelection(clientId, index);
        } else if (gameState.active_action?.type === "black_king" && gameState.active_action?.step === "swap_mine") {
            socket.send(JSON.stringify({ action: "black_king_swap", my_card_index: index }));
        }
        return;
    }

    if (isMyTurn && (gameState.turn_phase === "CHOICE" || gameState.turn_phase === "MUST_SWAP")) {
        // Добавление / удаление из мультивыбора карт (Матчинг)
        const idx = selectedMyMatchingCards.indexOf(index);
        if (idx > -1) {
            selectedMyMatchingCards.splice(idx, 1);
        } else {
            selectedMyMatchingCards.push(index);
        }
        renderGame();
    } else if (gameState.state === "PLAYING" && !gameState.active_action) {
        // Выбор своей карты для сброса по совпадению (self_match)
        if (selectedCardForMatch && selectedCardForMatch.type === 'mine' && selectedCardForMatch.index === index) {
            selectedCardForMatch = null;
        } else {
            selectedCardForMatch = { type: 'mine', index: index };
        }
        renderGame();
    }
}

// Рендеринг селекторов параметров лобби
function renderLobbySettings(isHost) {
    const lobbySettingsEl = document.getElementById('lobby-settings');
    if (!lobbySettingsEl) return;
    
    lobbySettingsEl.style.display = 'block';
    
    const limitTypeSelect = document.getElementById('settings-limit-type');
    const limitValueSelect = document.getElementById('settings-limit-value');
    const allowDiscardCheckbox = document.getElementById('settings-allow-discard-draw');
    const turnTimeoutSelect = document.getElementById('settings-turn-timeout');
    
    if (!limitTypeSelect || !limitValueSelect || !allowDiscardCheckbox || !turnTimeoutSelect) return;
    
    limitTypeSelect.disabled = !isHost;
    limitValueSelect.disabled = !isHost;
    allowDiscardCheckbox.disabled = !isHost;
    turnTimeoutSelect.disabled = !isHost;
    
    if (limitTypeSelect.value !== gameState.limit_type) {
        limitTypeSelect.value = gameState.limit_type;
    }
    
    if (allowDiscardCheckbox.checked !== gameState.allow_discard_draw) {
        allowDiscardCheckbox.checked = gameState.allow_discard_draw;
    }
    
    const timeoutValue = gameState.turn_timeout === null ? 'none' : String(gameState.turn_timeout || 30);
    if (turnTimeoutSelect.value !== timeoutValue) {
        turnTimeoutSelect.value = timeoutValue;
    }
    
    const currentVal = limitValueSelect.value;
    limitValueSelect.innerHTML = '';
    
    const roundOptions = [1, 3, 5, 7, 10];
    const pointOptions = [50, 100, 150];
    const currentOptions = gameState.limit_type === 'rounds' ? roundOptions : pointOptions;
    
    currentOptions.forEach(val => {
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = val;
        limitValueSelect.appendChild(opt);
    });
    
    const expectedVal = String(gameState.limit_value);
    if (currentOptions.includes(gameState.limit_value)) {
        limitValueSelect.value = expectedVal;
    } else {
        limitValueSelect.value = currentOptions[gameState.limit_type === 'rounds' ? 4 : 1]; // 10 раундов или 100 очков по умолчанию
    }
    
    const sendSettings = () => {
        socket.send(JSON.stringify({
            action: "set_settings",
            limit_type: limitTypeSelect.value,
            limit_value: parseInt(limitValueSelect.value),
            allow_discard_draw: allowDiscardCheckbox.checked,
            turn_timeout: turnTimeoutSelect.value === 'none' ? null : parseInt(turnTimeoutSelect.value)
        }));
    };
    
    limitTypeSelect.onchange = () => {
        const newType = limitTypeSelect.value;
        const defaultValue = newType === 'rounds' ? 10 : 100;
        socket.send(JSON.stringify({
            action: "set_settings",
            limit_type: newType,
            limit_value: defaultValue,
            allow_discard_draw: allowDiscardCheckbox.checked,
            turn_timeout: turnTimeoutSelect.value === 'none' ? null : parseInt(turnTimeoutSelect.value)
        }));
    };
    
    limitValueSelect.onchange = sendSettings;
    allowDiscardCheckbox.onchange = sendSettings;
    turnTimeoutSelect.onchange = sendSettings;
}

function handleOpponentCardClick(oppId, cardIndex) {
    if (!gameState) return;
    if (!gameState.players?.[clientId]) return;
    const isMyTurn = gameState.current_turn === clientId;

    // Способности — только в мой ход
    if (isMyTurn && gameState.active_action && gameState.turn_phase === "ACTION") {
        if (gameState.active_action?.type === "spy") {
            socket.send(JSON.stringify({ action: "use_ability", target_player_id: oppId, card_index: cardIndex }));
        } else if (gameState.active_action?.type === "swap") {
            if (selectedMyCardForSwap !== null) {
                socket.send(JSON.stringify({ action: "use_ability", my_card_index: selectedMyCardForSwap, target_player_id: oppId, target_card_index: cardIndex }));
                selectedMyCardForSwap = null;
            } else {
                showToast("Сначала выберите свою карту!");
            }
        } else if (gameState.active_action?.type === "swap_any") {
            handleSwapAnySelection(oppId, cardIndex);
        } else if (gameState.active_action?.type === "black_king" && gameState.active_action?.step === "init") {
            socket.send(JSON.stringify({ action: "use_ability", target_player_id: oppId, card_index: cardIndex }));
        } else if (gameState.active_action?.type === "black_king" && gameState.active_action?.step === "swap_other") {
            socket.send(JSON.stringify({ action: "black_king_swap", other_player_id: oppId, other_card_index: cardIndex }));
        }
    } else if (gameState.state === "PLAYING" && !gameState.active_action) {
        // Выбор карты соперника для перехвата (opponent_match)
        if (selectedCardForMatch && selectedCardForMatch.type === 'opponent' && selectedCardForMatch.oppId === oppId && selectedCardForMatch.index === cardIndex) {
            selectedCardForMatch = null;
        } else {
            selectedCardForMatch = { type: 'opponent', oppId: oppId, index: cardIndex };
        }
        renderGame();
    }
}

function handleSwapAnySelection(pId, idx) {
    const existingIndex = selectedSwapAnyCards.findIndex(item => item.pId === pId && item.idx === idx);
    
    if (existingIndex !== -1) {
        selectedSwapAnyCards.splice(existingIndex, 1);
    } else {
        selectedSwapAnyCards.push({ pId, idx });
    }
    
    if (selectedSwapAnyCards.length === 2) {
        socket.send(JSON.stringify({
            action: "use_ability",
            p1_id: selectedSwapAnyCards[0].pId, p1_idx: selectedSwapAnyCards[0].idx,
            p2_id: selectedSwapAnyCards[1].pId, p2_idx: selectedSwapAnyCards[1].idx
        }));
        selectedSwapAnyCards = [];
    } else {
        renderGame();
    }
}

// ===== BUTTON EVENTS =====
deckEl.onclick = () => {
    if (!gameState || gameState.current_turn !== clientId) return;
    if (gameState.turn_phase === "DRAW") {
        socket.send(JSON.stringify({ action: "draw_deck" }));
    }
};

discardPileEl.onclick = () => {
    if (!gameState) return;
    const amIPlayer = !!gameState.players?.[clientId];
    
    // Если выбрана карта для перехвата/сброса по совпадению
    if (selectedCardForMatch) {
        if (!amIPlayer) return;
        if (selectedCardForMatch.type === 'mine') {
            socket.send(JSON.stringify({
                action: "self_match",
                card_index: selectedCardForMatch.index
            }));
        } else if (selectedCardForMatch.type === 'opponent') {
            socket.send(JSON.stringify({
                action: "opponent_match",
                target_player_id: selectedCardForMatch.oppId,
                target_card_index: selectedCardForMatch.index
            }));
        }
        selectedCardForMatch = null;
        renderGame();
        return;
    }
    
    // Если сейчас наш ход и фаза выбора/обмена, и выбрана одна карта в руке
    if (gameState.current_turn === clientId && (gameState.turn_phase === "CHOICE" || gameState.turn_phase === "MUST_SWAP") && selectedMyMatchingCards.length === 1) {
        const cardIndex = selectedMyMatchingCards[0];
        const myCard = gameState.players[clientId].hand[cardIndex];
        const discardHistory = gameState.discard_history || [];
        const topDiscard = discardHistory[discardHistory.length - 1];
        
        if (topDiscard && myCard && myCard.rank === topDiscard.rank) {
            // Успешное совпадение — выполняем самосброс!
            socket.send(JSON.stringify({
                action: "self_match",
                card_index: cardIndex
            }));
            selectedMyMatchingCards = [];
            renderGame();
            return;
        } else if (topDiscard && myCard) {
            // Выбранная карта не совпадает с верхней картой сброса
            showToast("Выбранная карта не совпадает с картой в сбросе! Сбросить её нельзя.", true);
            return;
        }
    }
    
    if (gameState.current_turn !== clientId) return;
    
    if (gameState.turn_phase === "DRAW") {
        if (!gameState.allow_discard_draw) {
            showToast("Взятие карт из сброса отключено правилами стола!", true);
            return;
        }
        socket.send(JSON.stringify({ action: "draw_discard" }));
    } else if (gameState.turn_phase === "CHOICE") {
        socket.send(JSON.stringify({ action: "discard_drawn" }));
    }
};

caboBtn.onclick = () => {
    if (!gameState) return;
    if (gameState.state === "WAITING") {
        socket.send(JSON.stringify({ action: "start_game" }));
        return;
    }
    if (gameState.state === "START_PEEK") {
        socket.send(JSON.stringify({ action: "ready_start" }));
        return;
    }
    if (gameState.state === "PLAYING" && gameState.active_action) {
        socket.send(JSON.stringify({ action: "skip_ability" }));
        return;
    }
    if (gameState.current_turn === clientId) {
        if (gameState.turn_phase === "DRAW") {
            if (gameState.cabo_caller !== null) {
                socket.send(JSON.stringify({ action: "counter_cabo" }));
            } else {
                socket.send(JSON.stringify({ action: "call_cabo" }));
            }
        } else if ((gameState.turn_phase === "CHOICE" || gameState.turn_phase === "MUST_SWAP") && selectedMyMatchingCards.length > 0) {
            socket.send(JSON.stringify({
                action: "swap_drawn",
                indices: selectedMyMatchingCards
            }));
            selectedMyMatchingCards = [];
            renderGame();
        }
    }
};

btnCloseReveal.onclick = () => {
    if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ action: "clear_reveal" }));
    }
};

btnBkSwapMine.onclick = () => socket.send(JSON.stringify({ action: "black_king_choice", choice: "swap_mine" }));
btnBkSwapOther.onclick = () => socket.send(JSON.stringify({ action: "black_king_choice", choice: "swap_other" }));
btnBkCancel.onclick = () => socket.send(JSON.stringify({ action: "black_king_choice", choice: "cancel" }));

btnRestart.onclick = () => {
    socket.send(JSON.stringify({ action: "restart" }));
    scoreModal.style.display = 'none';
};

if (btnCloseOverflow) {
    btnCloseOverflow.onclick = () => closeOverflowModal();
}

const btnResetHeader = document.getElementById('btn-reset-header');
if (btnResetHeader) {
    btnResetHeader.onclick = () => {
        if (confirm("Вы уверены, что хотите сбросить игру и начать заново?")) {
            socket.send(JSON.stringify({ action: "restart" }));
        }
    };
}

// Анимация визуального скрещивания при обмене карт (FLIP)
function animateSwap(swappedIdx, oldDrawnCardData, oldHandCardData) {
    const drawnEl = document.getElementById('drawn-card');
    const handCardEl = playerHandEl.children[swappedIdx];
    
    if (!drawnEl || !handCardEl) {
        renderGame();
        return;
    }
    
    const drawnRect = drawnEl.getBoundingClientRect();
    const handRect = handCardEl.getBoundingClientRect();
    const discardRect = discardPileEl.getBoundingClientRect();
    
    // Рендерим новое состояние, чтобы подготовить DOM, но временно скрываем целевые элементы
    renderGame();
    
    const newHandCardEl = playerHandEl.children[swappedIdx];
    const newDiscardTopEl = discardPileEl.querySelector('.card:last-child');
    
    if (newHandCardEl) newHandCardEl.style.opacity = '0';
    if (newDiscardTopEl) newDiscardTopEl.style.opacity = '0';
    
    // Создаем летящие клоны
    const cloneDrawn = createCardUI(oldDrawnCardData, false);
    cloneDrawn.style.position = 'fixed';
    cloneDrawn.style.top = drawnRect.top + 'px';
    cloneDrawn.style.left = drawnRect.left + 'px';
    cloneDrawn.style.width = drawnRect.width + 'px';
    cloneDrawn.style.height = drawnRect.height + 'px';
    cloneDrawn.style.margin = '0';
    cloneDrawn.style.zIndex = '10000';
    cloneDrawn.style.transition = 'all 0.45s cubic-bezier(0.25, 1, 0.5, 1)';
    
    const cloneHand = createCardUI(oldHandCardData, false);
    cloneHand.style.position = 'fixed';
    cloneHand.style.top = handRect.top + 'px';
    cloneHand.style.left = handRect.left + 'px';
    cloneHand.style.width = handRect.width + 'px';
    cloneHand.style.height = handRect.height + 'px';
    cloneHand.style.margin = '0';
    cloneHand.style.zIndex = '10001';
    cloneHand.style.transition = 'all 0.45s cubic-bezier(0.25, 1, 0.5, 1)';
    
    document.body.appendChild(cloneDrawn);
    document.body.appendChild(cloneHand);
    
    // Вынуждаем пересчет
    cloneDrawn.getBoundingClientRect();
    
    // Анимируем
    cloneDrawn.style.top = handRect.top + 'px';
    cloneDrawn.style.left = handRect.left + 'px';
    
    cloneHand.style.top = discardRect.top + 'px';
    cloneHand.style.left = discardRect.left + 'px';
    
    let completed = 0;
    const onEnd = () => {
        completed++;
        if (completed === 2) {
            cloneDrawn.remove();
            cloneHand.remove();
            if (newHandCardEl) newHandCardEl.style.opacity = '';
            if (newDiscardTopEl) newDiscardTopEl.style.opacity = '';
        }
    };
    
    cloneDrawn.addEventListener('transitionend', onEnd);
    cloneHand.addEventListener('transitionend', onEnd);
}

tableEl.onclick = (e) => {
    if (!e.target.closest('.card-pile') && !e.target.closest('.card-back') && !e.target.closest('button')) {
        if (selectedCardForMatch) {
            selectedCardForMatch = null;
            renderGame();
        }
    }
};

// ===== SOUND EFFECTS (Web Audio API) =====
class SoundEffects {
    constructor() {
        this.ctx = null;
    }
    
    init() {
        if (!this.ctx) {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        }
    }
    
    playDeal() {
        this.init();
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        
        const bufferSize = this.ctx.sampleRate * 0.12;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }
        
        const noise = this.ctx.createBufferSource();
        noise.buffer = buffer;
        
        const filter = this.ctx.createBiquadFilter();
        filter.type = "bandpass";
        filter.frequency.setValueAtTime(1000, now);
        filter.frequency.exponentialRampToValueAtTime(150, now + 0.12);
        
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
        
        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.ctx.destination);
        
        noise.start(now);
    }
    
    playDraw() {
        this.init();
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        
        const osc = this.ctx.createOscillator();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(250, now);
        osc.frequency.exponentialRampToValueAtTime(80, now + 0.08);
        
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
        
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        
        osc.start(now);
        osc.stop(now + 0.08);
    }
    
    playDiscard() {
        this.init();
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        
        const osc = this.ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.setValueAtTime(180, now);
        osc.frequency.exponentialRampToValueAtTime(60, now + 0.15);
        
        const bufferSize = this.ctx.sampleRate * 0.05;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }
        const noise = this.ctx.createBufferSource();
        noise.buffer = buffer;
        
        const filter = this.ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.setValueAtTime(300, now);
        
        const oscGain = this.ctx.createGain();
        oscGain.gain.setValueAtTime(0.25, now);
        oscGain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
        
        const noiseGain = this.ctx.createGain();
        noiseGain.gain.setValueAtTime(0.12, now);
        noiseGain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
        
        osc.connect(oscGain);
        oscGain.connect(this.ctx.destination);
        
        noise.connect(filter);
        filter.connect(noiseGain);
        noiseGain.connect(this.ctx.destination);
        
        osc.start(now);
        osc.stop(now + 0.15);
        noise.start(now);
    }
    
    playCabo() {
        this.init();
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        
        const notes = [261.63, 329.63, 392.00, 523.25];
        notes.forEach((freq, index) => {
            const osc = this.ctx.createOscillator();
            osc.type = "sine";
            osc.frequency.setValueAtTime(freq, now + index * 0.1);
            
            const gain = this.ctx.createGain();
            gain.gain.setValueAtTime(0, now + index * 0.1);
            gain.gain.linearRampToValueAtTime(0.12, now + index * 0.1 + 0.05);
            gain.gain.exponentialRampToValueAtTime(0.01, now + index * 0.1 + 0.6);
            
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            
            osc.start(now + index * 0.1);
            osc.stop(now + index * 0.1 + 0.6);
        });
    }
    
    playError() {
        this.init();
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        
        const playTone = (time) => {
            const osc = this.ctx.createOscillator();
            osc.type = "sawtooth";
            osc.frequency.setValueAtTime(120, time);
            
            const filter = this.ctx.createBiquadFilter();
            filter.type = "lowpass";
            filter.frequency.setValueAtTime(400, time);
            
            const gain = this.ctx.createGain();
            gain.gain.setValueAtTime(0.18, time);
            gain.gain.exponentialRampToValueAtTime(0.01, time + 0.22);
            
            osc.connect(filter);
            filter.connect(gain);
            gain.connect(this.ctx.destination);
            
            osc.start(time);
            osc.stop(time + 0.22);
        };
        
        playTone(now);
        playTone(now + 0.25);
    }
    
    playSuccess() {
        this.init();
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        
        const freqs = [392.00, 523.25, 659.25];
        freqs.forEach((freq, idx) => {
            const osc = this.ctx.createOscillator();
            osc.type = "triangle";
            osc.frequency.setValueAtTime(freq, now + idx * 0.08);
            
            const gain = this.ctx.createGain();
            gain.gain.setValueAtTime(0.15, now + idx * 0.08);
            gain.gain.exponentialRampToValueAtTime(0.01, now + idx * 0.08 + 0.25);
            
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            
            osc.start(now + idx * 0.08);
            osc.stop(now + idx * 0.08 + 0.25);
        });
    }
}

const sounds = new SoundEffects();

// Активируем звуковой контекст по первому клику пользователя (политика браузеров)
window.addEventListener('click', () => sounds.init(), { once: true });
window.addEventListener('touchstart', () => sounds.init(), { once: true });

function updateTimerUI() {
    if (!turnTimerBar) return;
    const percentage = (localTimeLeft / localTurnTimeout) * 100;
    turnTimerBar.style.width = percentage + '%';
    
    if (localTimeLeft <= 5) {
        // Менее 5 секунд - красная подсветка
        turnTimerBar.style.background = 'linear-gradient(90deg, #ef4444 0%, #dc2626 100%)';
        turnTimerBar.style.boxShadow = '0 0 10px rgba(239, 68, 68, 0.5)';
    } else {
        // Стандартная синяя подсветка
        turnTimerBar.style.background = 'linear-gradient(90deg, #60a5fa 0%, #3b82f6 100%)';
        turnTimerBar.style.boxShadow = 'none';
    }
}

connect();
