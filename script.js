Const tg = window.Telegram?.WebApp;

If (tg) {
    Tg.ready();
    Tg.expand();
}

/* =========================
   БЭКЕНД И АВТОРИЗАЦИЯ
========================= */

Const API_BASE_URL = "https://oyexn-178-137-18-3.run.pinggy-free.link";

Let currentBalance = 0.00;
Let currentTurnover = 0.00;

Let balanceMode = "deposit";
Let selectedMethod = "CryptoBot";
Let selectedMethodSub = "Криптовалюта";
Let selectedMethodIcon = "cryptobot.png";

Const COLOR_PALETTE = [
    { id: 'slate', start: '#2c3e50', end: '#1a252f' },
    { id: 'purple', start: '#8e44ad', end: '#2c3e50' },
    { id: 'green', start: '#27ae60', end: '#114b27' },
    { id: 'brown', start: '#d35400', end: '#2c1e13' },
    { id: 'dark', start: '#1f1f1f', end: '#0a0a0a' },
    { id: 'crimson', start: '#c0392b', end: '#3d0c07' },
    { id: 'ocean', start: '#2980b9', end: '#0f3047' },
    { id: 'gold', start: '#f39c12', end: '#4a3004' }
];

Let profileDesign = JSON.parse(localStorage.getItem('wxs_profile')) || {
    ColorId: 'slate',
    Start: '#2c3e50',
    End: '#1a252f'
};

Let colorBets = { green: 0, red: 0, blue: 0, yellow: 0, gold: 0 };
Let activeColor = 'green';

Let transactions = [
    { type: 'deposit', method: 'CryptoBot', icon: 'cryptobot.png', amount: 50.00, date: 'Сегодня, 14:20', status: 'success' },
    { type: 'withdraw', method: 'xRocket', icon: 'xrocket.png', amount: 20.00, date: 'Вчера, 18:05', status: 'success' },
    { type: 'deposit', method: 'CryptoBot', icon: 'cryptobot.png', amount: 95.50, date: '21 Июля', status: 'success' }
];

Const COLOR_CONFIG = {
    Green:  { label: '1x',  mult: 1,  color: '#2ecc71', name: 'Зеленый' },
    Red:    { label: '2x',  mult: 2,  color: '#e74c3c', name: 'Красный' },
    Blue:   { label: '3x',  mult: 3,  color: '#3498db', name: 'Синий' },
    Yellow: { label: '5x',  mult: 5,  color: '#f1c40f', name: 'Желтый' },
    Gold:   { label: '50x', mult: 50, color: '#ffd700', name: 'Золото' }
};

Const sectors = [
    { type: 'gold',   ...COLOR_CONFIG.gold },
    { type: 'green',  ...COLOR_CONFIG.green },
    { type: 'red',    ...COLOR_CONFIG.red },
    { type: 'green',  ...COLOR_CONFIG.green },
    { type: 'blue',   ...COLOR_CONFIG.blue },
    { type: 'green',  ...COLOR_CONFIG.green },
    { type: 'red',    ...COLOR_CONFIG.red },
    { type: 'yellow', ...COLOR_CONFIG.yellow },
    { type: 'green',  ...COLOR_CONFIG.green },
    { type: 'red',    ...COLOR_CONFIG.red },
    { type: 'green',  ...COLOR_CONFIG.green },
    { type: 'blue',   ...COLOR_CONFIG.blue },
    { type: 'green',  ...COLOR_CONFIG.green },
    { type: 'red',    ...COLOR_CONFIG.red },
    { type: 'green',  ...COLOR_CONFIG.green },
    { type: 'yellow', ...COLOR_CONFIG.yellow },
    { type: 'green',  ...COLOR_CONFIG.green },
    { type: 'red',    ...COLOR_CONFIG.red },
    { type: 'green',  ...COLOR_CONFIG.green },
    { type: 'blue',   ...COLOR_CONFIG.blue },
    { type: 'green',  ...COLOR_CONFIG.green },
    { type: 'red',    ...COLOR_CONFIG.red },
    { type: 'green',  ...COLOR_CONFIG.green },
    { type: 'yellow', ...COLOR_CONFIG.yellow },
    { type: 'green',  ...COLOR_CONFIG.green },
    { type: 'red',    ...COLOR_CONFIG.red },
    { type: 'green',  ...COLOR_CONFIG.green },
    { type: 'blue',   ...COLOR_CONFIG.blue },
    { type: 'green',  ...COLOR_CONFIG.green },
    { type: 'red',    ...COLOR_CONFIG.red },
    { type: 'green',  ...COLOR_CONFIG.green },
    { type: 'red',    ...COLOR_CONFIG.red }
];

Let wheelRotation = 0;
Let wheelSpinning = false;
Let isBetProcessing = false;

/* =========================
   ИГРОВОЕ СОСТОЯНИЕ МИН
========================= */

Let minesGame = {
    Active: false,
    Bet: 0.10,
    MinesCount: 3,
    Field: [],
    Revealed: [],
    GemsFound: 0,
    IsProcessing: false
};

Function selectMinesCount(count, btn) {
    If (minesGame.active) return;
    MinesGame.minesCount = count;

    Document.querySelectorAll('.mines-count-btn').forEach(b => b.classList.remove('active'));
    Btn.classList.add('active');

    RenderMinesCoefBar();
}

Function adjustMinesBet(factor) {
    If (minesGame.active) return;
    Const input = document.getElementById('minesBetInput');
    If (!input) return;

    Let current = parseFloat(input.value);
    If (isNaN(current) || current < 0.10) {
        Current = 0.10;
    } else {
        Current = Math.max(0.10, current * factor);
    }
    Input.value = current.toFixed(2);
}

Function setMinesMaxBet() {
    If (minesGame.active) return;
    Const input = document.getElementById('minesBetInput');
    If (input) input.value = currentBalance.toFixed(2);
}

Function getMinesMultiplier(gemsFound, minesCount) {
    If (gemsFound === 0) return 1.0;
    Const totalTiles = 25;
    Let mult = 1.0;
    For (let i = 0; i < gemsFound; i++) {
        Mult *= (totalTiles - i) / (totalTiles - minesCount - i);
    }
    Return Math.floor(mult * 100) / 100;
}

Function renderMinesCoefBar() {
    Const bar = document.getElementById('minesCoefBar');
    If (!bar) return;

    Let html = '';
    Const maxGems = 25 - minesGame.minesCount;
    For (let step = 1; step <= Math.min(10, maxGems); step++) {
        Const mult = getMinesMultiplier(step, minesGame.minesCount);
        Const isActive = step === minesGame.gemsFound;
        Html += `
            <div class="coef-item ${isActive ? 'active' : ''}">
                <span class="step-num">${step}</span>
                <strong class="mult-val">${mult.toFixed(2)}x</strong>
            </div>
        `;
    }
    Bar.innerHTML = html;
}

Function initMinesGrid() {
    Const grid = document.getElementById('minesGrid');
    If (!grid) return;

    Grid.innerHTML = '';
    For (let i = 0; i < 25; i++) {
        Grid.innerHTML += `<div class="mine-tile disabled" id="tile-${i}" onclick="clickMinesTile(${i})"></div>`;
    }
    RenderMinesCoefBar();
}

Function handleMinesAction() {
    If (minesGame.isProcessing) return;
    
    If (minesGame.active) {
        CashoutMines();
    } else {
        StartMinesGame();
    }
}

Async function startMinesGame() {
    If (minesGame.isProcessing) return;

    Const input = document.getElementById('minesBetInput');
    Const bet = parseFloat(input.value);

    If (isNaN(bet) || bet < 0.10) {
        ShowMessage("Минимальная ставка — 0.10 $!");
        Return;
    }
    If (bet > currentBalance) {
        ShowMessage("Недостаточно средств!");
        Return;
    }

    MinesGame.isProcessing = true;

    Const success = await apiRecordBet(bet);
    If (!success) {
        ShowMessage("Ошибка проведения ставки на сервере!");
        MinesGame.isProcessing = false;
        Return;
    }

    MinesGame.active = true;
    MinesGame.bet = bet;
    MinesGame.gemsFound = 0;
    MinesGame.revealed = Array(25).fill(false);
    MinesGame.field = Array(25).fill('gem');

    Let placedMines = 0;
    While (placedMines < minesGame.minesCount) {
        Let randIndex = Math.floor(Math.random() * 25);
        If (minesGame.field[randIndex] !== 'bomb') {
            MinesGame.field[randIndex] = 'bomb';
            PlacedMines++;
        }
    }

    Const actionBtn = document.getElementById('minesActionBtn');
    Const autoBtn = document.getElementById('minesAutoBtn');
    If (actionBtn) actionBtn.textContent = 'ОТКРОЙТЕ КЛЕТКУ';
    If (autoBtn) autoBtn.disabled = false;

    For (let i = 0; i < 25; i++) {
        Const tile = document.getElementById(`tile-${i}`);
        If (tile) {
            Tile.className = 'mine-tile';
            Tile.innerHTML = '';
            Tile.removeAttribute('style');
        }
    }

    RenderMinesCoefBar();
    MinesGame.isProcessing = false;
}

Function clickMinesTile(index) {
    If (!minesGame.active || minesGame.revealed[index] || minesGame.isProcessing) return;

    MinesGame.revealed[index] = true;
    Const tile = document.getElementById(`tile-${index}`);

    If (minesGame.field[index] === 'bomb') {
        Tile.className = 'mine-tile revealed-bomb';
        Tile.innerHTML = `<img src="bomb.png" alt="bomb" style="width: 32px; height: 32px; object-fit: contain;">`;
        If (tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred("error");
        EndMinesGame(false);
    } else {
        MinesGame.gemsFound++;
        Tile.className = 'mine-tile revealed-gem';
        
        Tile.innerHTML = `<img src="gem.png" alt="gem" style="width: 32px; height: 32px; object-fit: contain;">`;

        If (tg?.HapticFeedback) tg.HapticFeedback.impactOccurred("light");

        Const mult = getMinesMultiplier(minesGame.gemsFound, minesGame.minesCount);
        Const currentWin = (minesGame.bet * mult).toFixed(2);

        Const actionBtn = document.getElementById('minesActionBtn');
        If (actionBtn) actionBtn.textContent = `ЗАБРАТЬ ${currentWin}$`;

        RenderMinesCoefBar();

        If (minesGame.gemsFound === 25 - minesGame.minesCount) {
            CashoutMines();
        }
    }
}

Function autoPickMinesTile() {
    If (!minesGame.active || minesGame.isProcessing) return;
    Let unrevealed = [];
    For (let i = 0; i < 25; i++) {
        If (!minesGame.revealed[i]) unrevealed.push(i);
    }
    If (unrevealed.length > 0) {
        Let rand = unrevealed[Math.floor(Math.random() * unrevealed.length)];
        ClickMinesTile(rand);
    }
}

Async function cashoutMines() {
    If (minesGame.gemsFound < 1) {
        ShowMessage("Откройте хотя бы одну ячейку!");
        Return;
    }

    If (minesGame.isProcessing) return;
    MinesGame.isProcessing = true;

    Const mult = getMinesMultiplier(minesGame.gemsFound, minesGame.minesCount);
    Const winAmount = minesGame.bet * mult;

    Const success = await apiAddWin(winAmount);

    If (success) {
        If (tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred("success");
        ShowMessage(`Выигрыш: +${winAmount.toFixed(2)}$ (${mult.toFixed(2)}x)`);
    }

    EndMinesGame(true);
}

Function endMinesGame(isWin) {
    MinesGame.active = false;

    For (let i = 0; i < 25; i++) {
        Const tile = document.getElementById(`tile-${i}`);
        If (!tile) continue;

        Tile.classList.add('disabled');

        If (!minesGame.revealed[i]) {
            Tile.classList.add('end-show');
            If (minesGame.field[i] === 'bomb') {
                Tile.innerHTML = `<img src="bomb.png" alt="bomb" style="width: 32px; height: 32px; object-fit: contain; opacity: 0.6;">`;
            } else {
                Tile.innerHTML = `<img src="gem.png" alt="gem" style="width: 32px; height: 32px; object-fit: contain; opacity: 0.6;">`;
            }
        }
    }

    Const actionBtn = document.getElementById('minesActionBtn');
    Const autoBtn = document.getElementById('minesAutoBtn');
    If (actionBtn) actionBtn.textContent = 'Начать игру';
    If (autoBtn) autoBtn.disabled = true;

    MinesGame.isProcessing = false;
}

/* =========================
   TELEGRAM USER & БАЛАНС
========================= */

Function loadTelegramUser() {
    If (!tg) return;
    Const user = tg.initDataUnsafe?.user;
    If (!user) return;

    Const usernameElement = document.getElementById("username");
    Const avatarElement = document.getElementById("avatar");
    Const profileName = document.getElementById("profileName");
    Const profileUsername = document.getElementById("profileUsername");
    Const profileAvatar = document.getElementById("profileAvatar");

    Const name = user.first_name || user.username || "Игрок";

    If (usernameElement) usernameElement.textContent = name;
    If (profileName) profileName.textContent = name;

    If (profileUsername) {
        ProfileUsername.textContent = user.username ? "@" + user.username : "Telegram пользователь";
    }

    If (user.photo_url) {
        Const imageHTML = `<img src="${user.photo_url}" alt="avatar" style="width:100%; height:100%; object-fit:cover; border-radius:50%;">`;
        If (avatarElement) avatarElement.innerHTML = imageHTML;
        If (profileAvatar) profileAvatar.innerHTML = imageHTML;
    }
}

Function setUIBalance(newBalance) {
    CurrentBalance = parseFloat(newBalance) || 0.00;
    Const formatted = currentBalance.toFixed(2) + " $";
    Const turnoverValue = "$" + currentTurnover.toFixed(2);

    Const elementsMap = {
        "topBalance": formatted,
        "balanceCardValue": formatted,
        "profileBalance": formatted,
        "statTurnover": turnoverValue,
        "betBalanceText": `Баланс: ${formatted}`
    };

    Object.keys(elementsMap).forEach(id => {
        Const el = document.getElementById(id);
        If (el) el.textContent = elementsMap[id];
    });

    Document.querySelectorAll('.balance-val, .profile-balance-val').forEach(el => {
        El.textContent = formatted;
    });

    UpdateTotalBet();
}

Async function updateBalance() {
    LoadTelegramUser();
    Await fetchUserProfileFromApi();
}

/* =========================
   API ВЗАИМОДЕЙСТВИЕ
========================= */

// Добавляем универсальные заголовки для туннеля Pinggy
Function getApiHeaders() {
    Return {
        'Authorization': window.Telegram?.WebApp?.initData || '',
        'Content-Type': 'application/json',
        'pinggy-skip-browser-warning': 'true' // Пропускаем экран защиты Pinggy
    };
}

Async function fetchUserProfileFromApi() {
    Const initData = window.Telegram?.WebApp?.initData || '';

    If (!initData) {
        Console.warn("⚠️ tg.initData отсутствует! Возможно, скрипт запущен вне Telegram.");
        Return;
    }

    Try {
        Console.log("📡 Отправляем запрос на получение профиля...");
        Const response = await fetch(`${API_BASE_URL}/api/user/profile`, {
            Method: 'GET',
            Headers: getApiHeaders()
        });

        If (!response.ok) {
            Console.error(`❌ Ошибка сервера API: Статус ${response.status}`);
            Const errorText = await response.text();
            Console.error("Детали ошибки сервера:", errorText);
            Return;
        }

        Const data = await response.json();
        Console.log("✅ Успешно получены данные пользователя:", data);

        If (data.status === "ok") {
            CurrentTurnover = data.turnover || 0;
            SetUIBalance(data.balance);
        }
    } catch (error) {
        Console.error("❌ Ошибка при получении профиля:", error);
    }
}

Async function apiRecordBet(amount) {
    Const initData = window.Telegram?.WebApp?.initData || '';
    If (!initData) {
        Console.warn("⚠️ tg.initData отсутствует при попытке сделать ставку.");
        Return false;
    }

    Try {
        Const res = await fetch(`${API_BASE_URL}/api/user/play`, {
            Method: 'POST',
            Headers: getApiHeaders(),
            Body: JSON.stringify({ amount: amount })
        });

        If (!res.ok) {
            Console.error(`❌ Ошибка списания ставки: Статус ${res.status}`);
            Return false;
        }

        Const data = await res.json();
        CurrentTurnover = data.turnover || 0;
        SetUIBalance(data.balance);
        Return true;
    } catch (e) {
        Console.error("❌ Ошибка при списывании ставки:", e);
        Return false;
    }
}

Async function apiAddWin(amount, retries = 3) {
    Const initData = window.Telegram?.WebApp?.initData || '';
    If (!initData) {
        Console.warn("⚠️ tg.initData отсутствует при попытке зачислить выигрыш.");
        Return false;
    }

    For (let attempt = 1; attempt <= retries; attempt++) {
        Try {
            Const res = await fetch(`${API_BASE_URL}/api/user/add-win`, {
                Method: 'POST',
                Headers: getApiHeaders(),
                Body: JSON.stringify({ amount: amount })
            });

            If (res.ok) {
                Const data = await res.json();
                CurrentTurnover = data.turnover || 0;
                SetUIBalance(data.balance);
                Return true;
            }
        } catch (e) {
            Console.error(`Попытка ${attempt} зачислить выигрыш не удалась:`, e);
        }
        Await new Promise(resolve => setTimeout(resolve, 500));
    }

    ShowMessage("Ошибка зачисления выигрыша на сервере! Проверьте интернет-соединение.");
    Return false;
}

/* =========================
   НАВИГАЦИЯ
========================= */

Function hideAllPages() {
    Const pages = ["homePage", "wheelPage", "balancePage", "profilePage", "bonusPage", "minesPage"];
    Pages.forEach(id => {
        Const page = document.getElementById(id);
        If (page) page.classList.add("hidden");
    });
    CloseMethodsDropdown();
}

Function showPage(id) {
    HideAllPages();
    Const page = document.getElementById(id);
    If (page) page.classList.remove("hidden");
    Window.scrollTo({ top: 0, behavior: "smooth" });
}

Function goHome() {
    ShowPage("homePage");
    UpdateNav("home");
    LoadTelegramUser();
    UpdateBalance();
}

Function openGamesMenu() {
    Const homePage = document.getElementById('homePage');
    Const gamesSection = document.getElementById('gamesListSection');

    If (homePage && homePage.classList.contains('hidden')) {
        ShowPage("homePage");
    }

    UpdateNav("games");

    If (gamesSection) {
        GamesSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

Function openWheel() {
    ShowPage("wheelPage");
    UpdateNav("games");
    UpdateBalance();
    LoadTelegramUser(); 
    DrawWheel();
    RenderColorTabs();
    SelectColorTab(activeColor);
}

Function openMines() {
    ShowPage("minesPage");
    UpdateNav("games");
    UpdateBalance();
    InitMinesGrid();
}

Function openBalance(mode = "deposit") {
    ShowPage("balancePage");
    SetBalanceMode(mode);
    UpdateNav("balance");
    UpdateBalance();
    RenderTransactions();
}

Function openProfile() {
    ShowPage("profilePage");
    UpdateNav("profile");
    UpdateBalance();
    LoadTelegramUser();
    ApplyDesign();
    RenderCustomizerControls();
}

Function openBonus() {
    ShowPage("bonusPage");
    UpdateNav("bonus");
}

Function updateNav(active) {
    Const navItems = document.querySelectorAll(".nav-item");
    NavItems.forEach(item => item.classList.remove("active"));

    Const map = { home: "homeNav", games: "gamesNav", balance: "balanceNav", bonus: "bonusNav", profile: "profileNav" };
    Const activeElement = document.getElementById(map[active]);
    If (activeElement) activeElement.classList.add("active");
}

/* =========================
   ОТРИСОВКА SVG КОЛЕСА
========================= */

Function drawWheel() {
    Const wheelSvg = document.getElementById('wheelSvg');
    Const rewardList = document.getElementById('rewardList');
    If (!wheelSvg) return;

    Const total = sectors.length;
    Const sliceAngle = 360 / total;
    Const radius = 150;
    Const center = 150;

    Let svgContent = '';

    Sectors.forEach((sector, i) => {
        Const startAngle = i * sliceAngle - 90;
        Const endAngle = startAngle + sliceAngle;

        Const x1 = center + radius * Math.cos((Math.PI * startAngle) / 180);
        Const y1 = center + radius * Math.sin((Math.PI * startAngle) / 180);
        Const x2 = center + radius * Math.cos((Math.PI * endAngle) / 180);
        Const y2 = center + radius * Math.sin((Math.PI * endAngle) / 180);

        Const pathData = `M ${center} ${center} L ${x1} ${y1} A ${radius} ${radius} 0 0 1 ${x2} ${y2} Z`;

        Const textAngle = startAngle + sliceAngle / 2;
        Const textRadius = radius * 0.75;
        Const textX = center + textRadius * Math.cos((Math.PI * textAngle) / 180);
        Const textY = center + textRadius * Math.sin((Math.PI * textAngle) / 180);

        SvgContent += `
            <path d="${pathData}" fill="${sector.color}" class="wheel-sector" />
            <text x="${textX}" y="${textY}" class="wheel-sector-text" style="font-size: 8px;" transform="rotate(${textAngle + 90}, ${textX}, ${textY})">
                ${sector.label}
            </text>
        `;
    });

    WheelSvg.innerHTML = svgContent;

    If (rewardList) {
        RewardList.innerHTML = Object.keys(COLOR_CONFIG).map(key => {
            Const cfg = COLOR_CONFIG[key];
            Return `
                <div style="background:#161616; border:1px solid #222; padding:10px; border-radius:12px; display:flex; align-items:center; gap:8px;">
                    <span style="background:${cfg.color}; width:16px; height:16px; border-radius:50%; display:inline-block;"></span>
                    <b style="font-size:12px;">${cfg.name} (${cfg.label})</b>
                </div>
            `;
        }).join('');
    }
}

/* =========================
   ТАБЫ ЦВЕТОВ И СТАВКИ КОЛЕСА
========================= */

Function renderColorTabs() {
    Const row = document.getElementById('colorTabsRow');
    If (!row) return;

    Row.innerHTML = Object.keys(COLOR_CONFIG).map(key => {
        Const cfg = COLOR_CONFIG[key];
        Const hasBet = colorBets[key] > 0;

        Return `
            <div class="color-tab-btn ${key === activeColor ? 'active' : ''}" 
                 Id="tab-${key}" 
                 Onclick="selectColorTab('${key}')">
                <span class="tab-indicator" style="background: ${cfg.color};"></span>
                <span class="tab-name">${cfg.name}</span>
                <span class="tab-mult" id="tab-val-${key}">
                    ${hasBet ? ColorBets[key] + ' $' : cfg.label}
                </span>
            </div>
        `;
    }).join('');
}

Function selectColorTab(color) {
    If (wheelSpinning) return;

    Const currentInput = document.getElementById('activeBetInput');
    If (currentInput) {
        OnActiveColorInput(currentInput.value);
    }

    ActiveColor = color;

    Document.querySelectorAll('.color-tab-btn').forEach(btn => btn.classList.remove('active'));
    Const currentTab = document.getElementById(`tab-${color}`);
    If (currentTab) currentTab.classList.add('active');

    Const cfg = COLOR_CONFIG[color];
    Const titleBox = document.getElementById('activeColorTitle');
    If (titleBox) {
        TitleBox.innerHTML = `
            <span class="color-indicator" style="background: ${cfg.color};"></span>
            <div>
                <span>Ставка на ${cfg.name}</span><br>
                <span style="color: #888888; font-size: 11px; font-weight: 700;">(${cfg.label})</span>
            </div>
        `;
    }

    If (currentInput) {
        Const savedVal = colorBets[color];
        CurrentInput.value = savedVal > 0 ? SavedVal : '';
    }

    UpdateTotalBet();
}

Function onActiveColorInput(val) {
    Let parsed = parseFloat(val);
    If (isNaN(parsed) || parsed < 0.10) {
        ColorBets[activeColor] = 0;
    } else {
        ColorBets[activeColor] = parsed;
    }

    Const tabVal = document.getElementById(`tab-val-${activeColor}`);
    If (tabVal) {
        Const cfg = COLOR_CONFIG[activeColor];
        TabVal.textContent = colorBets[activeColor] > 0 ? `${colorBets[activeColor]} $` : cfg.label;
    }

    UpdateTotalBet();
}

Function applyMinToActive() {
    If (wheelSpinning) return;
    ColorBets[activeColor] = 0.10;

    Const input = document.getElementById('activeBetInput');
    If (input) input.value = '0.10';

    Const tabVal = document.getElementById(`tab-val-${activeColor}`);
    If (tabVal) tabVal.textContent = '0.10 $';

    UpdateTotalBet();
}

Function applyPercentToActive(pct) {
    If (wheelSpinning) return;

    Let otherBetsSum = 0;
    Object.keys(colorBets).forEach(key => {
        If (key !== activeColor) otherBetsSum += colorBets[key];
    });

    Const availableBalance = currentBalance - otherBetsSum;
    If (availableBalance < 0.10) {
        ShowMessage("Недостаточно средств для минимальной ставки!");
        Return;
    }

    Let amount = Math.floor(availableBalance * pct * 100) / 100;
    If (amount < 0.10) {
        Amount = 0.10;
    }

    ColorBets[activeColor] = amount;

    Const input = document.getElementById('activeBetInput');
    If (input) input.value = amount.toFixed(2);

    Const tabVal = document.getElementById(`tab-val-${activeColor}`);
    If (tabVal) {
        TabVal.textContent = `${amount.toFixed(2)} $`;
    }

    UpdateTotalBet();
}

Function resetActiveBet() {
    If (wheelSpinning) return;
    ColorBets[activeColor] = 0;

    Const input = document.getElementById('activeBetInput');
    If (input) input.value = '';

    Const tabVal = document.getElementById(`tab-val-${activeColor}`);
    If (tabVal) {
        Const cfg = COLOR_CONFIG[activeColor];
        TabVal.textContent = cfg.label;
    }

    UpdateTotalBet();
}

Function updateTotalBet() {
    Const totalInfo = document.getElementById('totalBetInfo');
    Let totalSum = 0;

    Object.values(colorBets).forEach(val => {
        TotalSum += val;
    });

    If (totalInfo) {
        TotalInfo.textContent = `Общая ставка: ${totalSum.toFixed(2)} $`;
    }
}

/* =========================
   ВРАЩЕНИЕ КОЛЕСА
========================= */

Async function spinWheel() {
    If (wheelSpinning || isBetProcessing) return;

    Const button = document.getElementById('spinButton');
    If (!button) return;

    IsBetProcessing = true;
    Button.disabled = true;

    Const currentInput = document.getElementById('activeBetInput');
    If (currentInput && currentInput.value !== '') {
        OnActiveColorInput(currentInput.value);
    }

    Let totalBet = 0;
    Object.keys(colorBets).forEach(key => {
        ColorBets[key] = parseFloat(colorBets[key]) || 0;
        TotalBet += colorBets[key];
    });

    If (totalBet < 0.10) {
        ShowMessage("Минимальная общая ставка — 0.10 $!");
        Button.disabled = false;
        IsBetProcessing = false;
        Return;
    }

    If (totalBet > currentBalance) {
        ShowMessage("Недостаточно средств на балансе!");
        Button.disabled = false;
        IsBetProcessing = false;
        Return;
    }

    Const success = await apiRecordBet(totalBet);
    If (!success) {
        ShowMessage("Ошибка проведения ставки!");
        Button.disabled = false;
        IsBetProcessing = false;
        Return;
    }

    WheelSpinning = true;
    Button.innerHTML = '<span>↻ Вращение...</span>';

    Const result = document.getElementById('wheelResult');
    Const resultValue = document.getElementById('resultValue');
    Const wheelSvg = document.getElementById('wheelSvg');
    Const wheelStage = document.querySelector('.wheel-stage');

    If (result) result.classList.remove('show');
    If (resultValue) resultValue.textContent = '?';

    Const rewardIndex = Math.floor(Math.random() * sectors.length);
    Const totalSectors = sectors.length;
    Const sectorAngle = 360 / totalSectors;

    Const padding = 0.15; 
    Const randomOffset = (Math.random() * (1 - 2 * padding) + padding) * sectorAngle;

    Const targetAngleInSector = (rewardIndex * sectorAngle) + randomOffset;
    Const stopAngle = 360 - targetAngleInSector;

    Const fullSpins = 6;
    WheelRotation += fullSpins * 360 + (stopAngle - (wheelRotation % 360));

    If (wheelSvg) wheelSvg.style.transform = `rotate(${wheelRotation}deg)`;

    SetTimeout(() => {
        If (wheelStage) wheelStage.classList.add('zoomed');
    }, 3600);

    SetTimeout(async () => {
        If (wheelStage) wheelStage.classList.remove('zoomed');

        Const wonSector = sectors[rewardIndex];
        Const sectorType = wonSector.type; 
        
        Const betOnWonColor = parseFloat(colorBets[sectorType]) || 0;
        Const multiplier = parseFloat(wonSector.mult) || 0;

        Let totalWin = 0;

        If (betOnWonColor > 0 && multiplier > 0) {
            TotalWin = betOnWonColor * multiplier;
            Await apiAddWin(totalWin);
        }

        If (resultValue) {
            If (totalWin > 0) {
                ResultValue.textContent = `Победа +${totalWin.toFixed(2)} $ (${wonSector.label})`;
                ResultValue.style.color = '#2ecc71';
            } else {
                ResultValue.textContent = `Выпал ${wonSector.name} (${wonSector.label})`;
                ResultValue.style.color = '#e74c3c';
            }
        }

        If (result) result.classList.add('show');

        If (tg?.HapticFeedback) {
            Tg.HapticFeedback.notificationOccurred(totalWin > 0 ? "success" : "error");
        }

        WheelSpinning = false;
        IsBetProcessing = false;
        Button.disabled = false;
        Button.innerHTML = '<span>↻ Сделать ставку</span>';

    }, 5000);
}

/* =========================
   ПОПОЛНЕНИЕ И ВЫВОД
========================= */

Function renderTransactions() {
    Const list = document.getElementById("historyList");
    Const count = document.getElementById("txCount");
    If (!list) return;

    If (count) count.textContent = `${transactions.length} операций`;

    If (transactions.length === 0) {
        List.innerHTML = `<div style="text-align:center; color:#666; font-size:13px; padding:15px;">История пуста</div>`;
        Return;
    }

    List.innerHTML = transactions.map(tx => {
        Const isDep = tx.type === 'deposit';
        Const sign = isDep ? '+' : '-';
        Const title = isDep ? 'Пополнение' : 'Вывод средств';
        Const statusText = tx.status === 'success' ? 'Успешно' : 'В обработке';

        Const iconHTML = tx.icon.includes('.')
            ? `<img src="${tx.icon}" style="width: 16px; height: 16px; object-fit: contain; vertical-align: middle;">`
            : tx.icon;

        Return `
            <div class="history-item">
                <div class="tx-left">
                    <div class="tx-icon ${tx.type}">
                        ${isDep ? '↙' : '↗'}
                    </div>
                    <div class="tx-details">
                        <span class="tx-title">${title}</span>
                        <span class="tx-subtitle">${iconHTML} ${tx.method} • ${tx.date}</span>
                    </div>
                </div>
                <div class="tx-right">
                    <span class="tx-amount ${tx.type}">${sign}${tx.amount.toFixed(2)} $</span>
                    <span class="tx-status ${tx.status}">${statusText}</span>
                </div>
            </div>
        `;
    }).join('');
}

Function closeMethodsDropdown() {
    Const dropdown = document.getElementById("methodsDropdown");
    Const arrow = document.getElementById("methodArrow");
    If (dropdown) dropdown.classList.remove("open");
    If (arrow) arrow.textContent = "▼";
}

Function setBalanceMode(mode) {
    BalanceMode = mode;
    CloseMethodsDropdown();

    Const depositTab = document.getElementById("depositTab");
    Const withdrawTab = document.getElementById("withdrawTab");
    Const title = document.getElementById("formTitle");
    Const subtitle = document.getElementById("formSubtitle");
    Const action = document.getElementById("balanceAction");

    If (!depositTab || !withdrawTab || !title || !subtitle || !action) return;

    DepositTab.classList.remove("active");
    WithdrawTab.classList.remove("active");

    If (mode === "deposit") {
        DepositTab.classList.add("active");
        Title.textContent = "Пополнение баланса";
        Subtitle.textContent = "Выберите удобный способ пополнения";
        Action.textContent = "Пополнить";
    }

    If (mode === "withdraw") {
        WithdrawTab.classList.add("active");
        Title.textContent = "Вывод средств";
        Subtitle.textContent = "Выберите способ вывода средств";
        Action.textContent = "Вывести";
    }
}

Function toggleMethods() {
    Const dropdown = document.getElementById("methodsDropdown");
    Const arrow = document.getElementById("methodArrow");

    If (!dropdown) return;
    Dropdown.classList.toggle("open");

    If (arrow) {
        Arrow.textContent = dropdown.classList.contains("open") ? "▲" : "▼";
    }
}

Function selectMethod(method, icon, sub) {
    SelectedMethod = method;
    SelectedMethodIcon = icon;
    SelectedMethodSub = sub;

    Const selected = document.getElementById("selectedMethod");
    Const selectedSub = document.getElementById("selectedMethodSub");
    Const iconElement = document.getElementById("selectedMethodIcon");

    If (selected) selected.textContent = method;
    If (selectedSub) selectedSub.textContent = sub;

    If (iconElement) {
        If (icon.includes('.')) {
            IconElement.src = icon;
        } else {
            IconElement.textContent = icon;
        }
    }

    CloseMethodsDropdown();
}

Function demoBalanceAction() {
    Const input = document.getElementById("amountInput");
    If (!input) return;

    Const amount = parseFloat(input.value);

    If (!amount || amount <= 0) {
        ShowMessage("Введите сумму");
        Return;
    }

    If (balanceMode === "deposit") {
        SetUIBalance(currentBalance + amount);

        Transactions.unshift({
            Type: 'deposit',
            Method: selectedMethod,
            Icon: selectedMethodIcon,
            Amount: amount,
            Date: 'Только что',
            Status: 'success'
        });
        RenderTransactions();

        ShowMessage(`Демо: пополнено ${amount.toFixed(2)} $ через ${selectedMethod}`);
        Return;
    }

    If (amount > currentBalance) {
        ShowMessage("Недостаточно средств");
        Return;
    }

    SetUIBalance(currentBalance - amount);

    Transactions.unshift({
        Type: 'withdraw',
        Method: selectedMethod,
        Icon: selectedMethodIcon,
        Amount: amount,
        Date: 'Только что',
        Status: 'pending'
    });
    RenderTransactions();

    ShowMessage(`Демо: отправлено на вывод ${amount.toFixed(2)} $ через ${selectedMethod}`);
}

Function claimBonus() {
    ShowMessage("Демо: ежедневный бонус пока не подключён");
}

Function showMessage(text) {
    If (tg?.showAlert) {
        Tg.showAlert(text);
        Return;
    }
    Alert(text);
}

/* =========================
   ПРОФИЛЬ И КАСТОМИЗАЦИЯ ФОНА
========================= */

Function applyDesign() {
    Const cover = document.getElementById('profileCover');
    If (cover) {
        Cover.style.background = `linear-gradient(180deg, ${profileDesign.start} 0%, ${profileDesign.end} 100%)`;
    }
}

Function renderCustomizerControls() {
    Const colorGrid = document.getElementById('colorPickerGrid');
    If (colorGrid) {
        ColorGrid.innerHTML = COLOR_PALETTE.map(item => `
            <div class="color-option ${item.id === profileDesign.colorId ? 'active' : ''}" 
                 Style="background: linear-gradient(135deg, ${item.start}, ${item.end});"
                 Onclick="selectGradient('${item.id}', '${item.start}', '${item.end}')">
            </div>
        `).join('');
    }
}

Function selectGradient(id, start, end) {
    ProfileDesign.colorId = id;
    ProfileDesign.start = start;
    ProfileDesign.end = end;
    RenderCustomizerControls();
    ApplyDesign();
}

Function toggleProfileCustomizer() {
    Const box = document.getElementById('customizerBox');
    If (box) box.classList.toggle('hidden');
}

Function saveProfileCustomization() {
    LocalStorage.setItem('wxs_profile', JSON.stringify(profileDesign));
    ApplyDesign();
    ToggleProfileCustomizer();
    ShowMessage("Настройки сохранены!");
}

/* =========================
   ЗАПУСК ПРИ СТАРТЕ
========================= */

Document.addEventListener("DOMContentLoaded", async () => {
    Console.log("🚀 Mini App запущен!");
    
    If (window.Telegram?.WebApp) {
        Window.Telegram.WebApp.ready();
        Window.Telegram.WebApp.expand();
    }

    LoadTelegramUser();
    Await fetchUserProfileFromApi();
    RenderTransactions();
    GoHome();
    ApplyDesign();
});
