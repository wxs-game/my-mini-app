const tg = window.Telegram?.WebApp;

if (tg) {
    tg.ready();
    tg.expand();
}

/* =========================
   БЭКЕНД И АВТОРИЗАЦИЯ
========================= */

const API_BASE_URL = "https://dghbc-5-248-188-249.free.pinggy.net";

let currentBalance = 0.00;
let currentTurnover = 0.00;

let balanceMode = "deposit";
let selectedMethod = "CryptoBot";
let selectedMethodSub = "Криптовалюта";
let selectedMethodIcon = "cryptobot.png";

const COLOR_PALETTE = [
    { id: 'slate', start: '#2c3e50', end: '#1a252f' },
    { id: 'purple', start: '#8e44ad', end: '#2c3e50' },
    { id: 'green', start: '#27ae60', end: '#114b27' },
    { id: 'brown', start: '#d35400', end: '#2c1e13' },
    { id: 'dark', start: '#1f1f1f', end: '#0a0a0a' },
    { id: 'crimson', start: '#c0392b', end: '#3d0c07' },
    { id: 'ocean', start: '#2980b9', end: '#0f3047' },
    { id: 'gold', start: '#f39c12', end: '#4a3004' }
];

let profileDesign = JSON.parse(localStorage.getItem('wxs_profile')) || {
    colorId: 'slate',
    start: '#2c3e50',
    end: '#1a252f'
};

let colorBets = { green: 0, red: 0, blue: 0, yellow: 0, gold: 0 };
let activeColor = 'green';

let transactions = [
    { type: 'deposit', method: 'CryptoBot', icon: 'cryptobot.png', amount: 50.00, date: 'Сегодня, 14:20', status: 'success' },
    { type: 'withdraw', method: 'xRocket', icon: 'xrocket.png', amount: 20.00, date: 'Вчера, 18:05', status: 'success' },
    { type: 'deposit', method: 'CryptoBot', icon: 'cryptobot.png', amount: 95.50, date: '21 Июля', status: 'success' }
];

const COLOR_CONFIG = {
    green:  { label: '1x',  mult: 1,  color: '#2ecc71', name: 'Зеленый' },
    red:    { label: '2x',  mult: 2,  color: '#e74c3c', name: 'Красный' },
    blue:   { label: '3x',  mult: 3,  color: '#3498db', name: 'Синий' },
    yellow: { label: '5x',  mult: 5,  color: '#f1c40f', name: 'Желтый' },
    gold:   { label: '50x', mult: 50, color: '#ffd700', name: 'Золото' }
};

const sectors = [
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

let wheelRotation = 0;
let wheelSpinning = false;
let isBetProcessing = false;

/* =========================
   ИГРОВОЕ СОСТОЯНИЕ МИН
========================= */

let minesGame = {
    active: false,
    bet: 0.10,
    minesCount: 3,
    field: [],
    revealed: [],
    gemsFound: 0,
    isProcessing: false
};

function selectMinesCount(count, btn) {
    if (minesGame.active) return;
    minesGame.minesCount = count;

    document.querySelectorAll('.mines-count-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    renderMinesCoefBar();
}

function adjustMinesBet(factor) {
    if (minesGame.active) return;
    const input = document.getElementById('minesBetInput');
    if (!input) return;

    let current = parseFloat(input.value);
    if (isNaN(current) || current < 0.10) {
        current = 0.10;
    } else {
        current = Math.max(0.10, current * factor);
    }
    input.value = current.toFixed(2);
}

function setMinesMaxBet() {
    if (minesGame.active) return;
    const input = document.getElementById('minesBetInput');
    if (input) input.value = currentBalance.toFixed(2);
}

function getMinesMultiplier(gemsFound, minesCount) {
    if (gemsFound === 0) return 1.0;
    const totalTiles = 25;
    let mult = 1.0;
    for (let i = 0; i < gemsFound; i++) {
        mult *= (totalTiles - i) / (totalTiles - minesCount - i);
    }
    return Math.floor(mult * 100) / 100;
}

function renderMinesCoefBar() {
    const bar = document.getElementById('minesCoefBar');
    if (!bar) return;

    let html = '';
    const maxGems = 25 - minesGame.minesCount;
    for (let step = 1; step <= Math.min(10, maxGems); step++) {
        const mult = getMinesMultiplier(step, minesGame.minesCount);
        const isActive = step === minesGame.gemsFound;
        html += `
            <div class="coef-item ${isActive ? 'active' : ''}">
                <span class="step-num">${step}</span>
                <strong class="mult-val">${mult.toFixed(2)}x</strong>
            </div>
        `;
    }
    bar.innerHTML = html;
}

function initMinesGrid() {
    const grid = document.getElementById('minesGrid');
    if (!grid) return;

    grid.innerHTML = '';
    for (let i = 0; i < 25; i++) {
        grid.innerHTML += `<div class="mine-tile disabled" id="tile-${i}" onclick="clickMinesTile(${i})"></div>`;
    }
    renderMinesCoefBar();
}

function handleMinesAction() {
    if (minesGame.isProcessing) return;
    
    if (minesGame.active) {
        cashoutMines();
    } else {
        startMinesGame();
    }
}

async function startMinesGame() {
    if (minesGame.isProcessing) return;

    const input = document.getElementById('minesBetInput');
    const bet = parseFloat(input.value);

    if (isNaN(bet) || bet < 0.10) {
        showMessage("Минимальная ставка — 0.10 $!");
        return;
    }
    if (bet > currentBalance) {
        showMessage("Недостаточно средств!");
        return;
    }

    minesGame.isProcessing = true;

    const success = await apiRecordBet(bet);
    if (!success) {
        showMessage("Ошибка проведения ставки на сервере!");
        minesGame.isProcessing = false;
        return;
    }

    minesGame.active = true;
    minesGame.bet = bet;
    minesGame.gemsFound = 0;
    minesGame.revealed = Array(25).fill(false);
    minesGame.field = Array(25).fill('gem');

    let placedMines = 0;
    while (placedMines < minesGame.minesCount) {
        let randIndex = Math.floor(Math.random() * 25);
        if (minesGame.field[randIndex] !== 'bomb') {
            minesGame.field[randIndex] = 'bomb';
            placedMines++;
        }
    }

    const actionBtn = document.getElementById('minesActionBtn');
    const autoBtn = document.getElementById('minesAutoBtn');
    if (actionBtn) actionBtn.textContent = 'ОТКРОЙТЕ КЛЕТКУ';
    if (autoBtn) autoBtn.disabled = false;

    for (let i = 0; i < 25; i++) {
        const tile = document.getElementById(`tile-${i}`);
        if (tile) {
            tile.className = 'mine-tile';
            tile.innerHTML = '';
            tile.removeAttribute('style');
        }
    }

    renderMinesCoefBar();
    minesGame.isProcessing = false;
}

function clickMinesTile(index) {
    if (!minesGame.active || minesGame.revealed[index] || minesGame.isProcessing) return;

    minesGame.revealed[index] = true;
    const tile = document.getElementById(`tile-${index}`);

    if (minesGame.field[index] === 'bomb') {
        tile.className = 'mine-tile revealed-bomb';
        tile.innerHTML = `<img src="bomb.png" alt="bomb" style="width: 32px; height: 32px; object-fit: contain;">`;
        if (tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred("error");
        endMinesGame(false);
    } else {
        minesGame.gemsFound++;
        tile.className = 'mine-tile revealed-gem';
        
        tile.innerHTML = `<img src="gem.png" alt="gem" style="width: 32px; height: 32px; object-fit: contain;">`;

        if (tg?.HapticFeedback) tg.HapticFeedback.impactOccurred("light");

        const mult = getMinesMultiplier(minesGame.gemsFound, minesGame.minesCount);
        const currentWin = (minesGame.bet * mult).toFixed(2);

        const actionBtn = document.getElementById('minesActionBtn');
        if (actionBtn) actionBtn.textContent = `ЗАБРАТЬ ${currentWin}$`;

        renderMinesCoefBar();

        if (minesGame.gemsFound === 25 - minesGame.minesCount) {
            cashoutMines();
        }
    }
}

function autoPickMinesTile() {
    if (!minesGame.active || minesGame.isProcessing) return;
    let unrevealed = [];
    for (let i = 0; i < 25; i++) {
        if (!minesGame.revealed[i]) unrevealed.push(i);
    }
    if (unrevealed.length > 0) {
        let rand = unrevealed[Math.floor(Math.random() * unrevealed.length)];
        clickMinesTile(rand);
    }
}

async function cashoutMines() {
    if (minesGame.gemsFound < 1) {
        showMessage("Откройте хотя бы одну ячейку!");
        return;
    }

    if (minesGame.isProcessing) return;
    minesGame.isProcessing = true;

    const mult = getMinesMultiplier(minesGame.gemsFound, minesGame.minesCount);
    const winAmount = minesGame.bet * mult;

    const success = await apiAddWin(winAmount);

    if (success) {
        if (tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred("success");
        showMessage(`Выигрыш: +${winAmount.toFixed(2)}$ (${mult.toFixed(2)}x)`);
    }

    endMinesGame(true);
}

function endMinesGame(isWin) {
    minesGame.active = false;

    for (let i = 0; i < 25; i++) {
        const tile = document.getElementById(`tile-${i}`);
        if (!tile) continue;

        tile.classList.add('disabled');

        if (!minesGame.revealed[i]) {
            tile.classList.add('end-show');
            if (minesGame.field[i] === 'bomb') {
                tile.innerHTML = `<img src="bomb.png" alt="bomb" style="width: 32px; height: 32px; object-fit: contain; opacity: 0.6;">`;
            } else {
                tile.innerHTML = `<img src="gem.png" alt="gem" style="width: 32px; height: 32px; object-fit: contain; opacity: 0.6;">`;
            }
        }
    }

    const actionBtn = document.getElementById('minesActionBtn');
    const autoBtn = document.getElementById('minesAutoBtn');
    if (actionBtn) actionBtn.textContent = 'Начать игру';
    if (autoBtn) autoBtn.disabled = true;

    minesGame.isProcessing = false;
}

/* =========================
   TELEGRAM USER & БАЛАНС
========================= */

function loadTelegramUser() {
    if (!tg) return;
    const user = tg.initDataUnsafe?.user;
    if (!user) return;

    const usernameElement = document.getElementById("username");
    const avatarElement = document.getElementById("avatar");
    const profileName = document.getElementById("profileName");
    const profileUsername = document.getElementById("profileUsername");
    const profileAvatar = document.getElementById("profileAvatar");

    const name = user.first_name || user.username || "Игрок";

    if (usernameElement) usernameElement.textContent = name;
    if (profileName) profileName.textContent = name;

    if (profileUsername) {
        profileUsername.textContent = user.username ? "@" + user.username : "Telegram пользователь";
    }

    if (user.photo_url) {
        const imageHTML = `<img src="${user.photo_url}" alt="avatar" style="width:100%; height:100%; object-fit:cover; border-radius:50%;">`;
        if (avatarElement) avatarElement.innerHTML = imageHTML;
        if (profileAvatar) profileAvatar.innerHTML = imageHTML;
    }
}

function setUIBalance(newBalance) {
    currentBalance = parseFloat(newBalance) || 0.00;
    const formatted = currentBalance.toFixed(2) + " $";
    const turnoverValue = "$" + currentTurnover.toFixed(2);

    const elementsMap = {
        "topBalance": formatted,
        "balanceCardValue": formatted,
        "profileBalance": formatted,
        "statTurnover": turnoverValue,
        "betBalanceText": `Баланс: ${formatted}`
    };

    Object.keys(elementsMap).forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = elementsMap[id];
    });

    document.querySelectorAll('.balance-val, .profile-balance-val').forEach(el => {
        el.textContent = formatted;
    });

    updateTotalBet();
}

async function updateBalance() {
    loadTelegramUser();
    await fetchUserProfileFromApi();
}

/* =========================
   API ВЗАИМОДЕЙСТВИЕ
========================= */

async function fetchUserProfileFromApi() {
    if (!tg?.initData) {
        console.warn("⚠️ tg.initData отсутствует! Возможно, скрипт запущен вне Telegram.");
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/api/user/profile`, {
            method: 'GET',
            headers: {
                'Authorization': tg.initData,
                'Content-Type': 'application/json',
                'ngrok-skip-browser-warning': 'true'
            }
        });

        if (!response.ok) {
            console.error(`❌ Ошибка сервера API: Статус ${response.status}`);
            const errorText = await response.text();
            console.error("Детали ошибки сервера:", errorText);
            return;
        }

        const data = await response.json();
        console.log("✅ Успешно получены данные пользователя:", data);

        if (data.status === "ok") {
            currentTurnover = data.turnover || 0;
            setUIBalance(data.balance);
        }
    } catch (error) {
        console.error("❌ Ошибка при получении профиля:", error);
    }
}

async function apiRecordBet(amount) {
    if (!tg?.initData) {
        console.warn("⚠️ tg.initData отсутствует при попытке сделать ставку.");
        return false;
    }

    try {
        const res = await fetch(`${API_BASE_URL}/api/user/play`, {
            method: 'POST',
            headers: {
                'Authorization': tg.initData,
                'Content-Type': 'application/json',
                'ngrok-skip-browser-warning': 'true'
            },
            body: JSON.stringify({ amount: amount })
        });

        if (!res.ok) {
            console.error(`❌ Ошибка списания ставки: Статус ${res.status}`);
            return false;
        }

        const data = await res.json();
        currentTurnover = data.turnover || 0;
        setUIBalance(data.balance);
        return true;
    } catch (e) {
        console.error("❌ Ошибка при списывании ставки:", e);
        return false;
    }
}

async function apiAddWin(amount, retries = 3) {
    if (!tg?.initData) {
        console.warn("⚠️ tg.initData отсутствует при попытке зачислить выигрыш.");
        return false;
    }

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const res = await fetch(`${API_BASE_URL}/api/user/add-win`, {
                method: 'POST',
                headers: {
                    'Authorization': tg.initData,
                    'Content-Type': 'application/json',
                    'ngrok-skip-browser-warning': 'true'
                },
                body: JSON.stringify({ amount: amount })
            });

            if (res.ok) {
                const data = await res.json();
                currentTurnover = data.turnover || 0;
                setUIBalance(data.balance);
                return true;
            }
        } catch (e) {
            console.error(`Попытка ${attempt} зачислить выигрыш не удалась:`, e);
        }
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    showMessage("Ошибка зачисления выигрыша на сервере! Проверьте интернет-соединение.");
    return false;
}

/* =========================
   НАВИГАЦИЯ
========================= */

function hideAllPages() {
    const pages = ["homePage", "wheelPage", "balancePage", "profilePage", "bonusPage", "minesPage"];
    pages.forEach(id => {
        const page = document.getElementById(id);
        if (page) page.classList.add("hidden");
    });
    closeMethodsDropdown();
}

function showPage(id) {
    hideAllPages();
    const page = document.getElementById(id);
    if (page) page.classList.remove("hidden");
    window.scrollTo({ top: 0, behavior: "smooth" });
}

function goHome() {
    showPage("homePage");
    updateNav("home");
    loadTelegramUser();
    updateBalance();
}

function openGamesMenu() {
    const homePage = document.getElementById('homePage');
    const gamesSection = document.getElementById('gamesListSection');

    if (homePage && homePage.classList.contains('hidden')) {
        showPage("homePage");
    }

    updateNav("games");

    if (gamesSection) {
        gamesSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function openWheel() {
    showPage("wheelPage");
    updateNav("games");
    updateBalance();
    loadTelegramUser(); 
    drawWheel();
    renderColorTabs();
    selectColorTab(activeColor);
}

function openMines() {
    showPage("minesPage");
    updateNav("games");
    updateBalance();
    initMinesGrid();
}

function openBalance(mode = "deposit") {
    showPage("balancePage");
    setBalanceMode(mode);
    updateNav("balance");
    updateBalance();
    renderTransactions();
}

function openProfile() {
    showPage("profilePage");
    updateNav("profile");
    updateBalance();
    loadTelegramUser();
    applyDesign();
    renderCustomizerControls();
}

function openBonus() {
    showPage("bonusPage");
    updateNav("bonus");
}

function updateNav(active) {
    const navItems = document.querySelectorAll(".nav-item");
    navItems.forEach(item => item.classList.remove("active"));

    const map = { home: "homeNav", games: "gamesNav", balance: "balanceNav", bonus: "bonusNav", profile: "profileNav" };
    const activeElement = document.getElementById(map[active]);
    if (activeElement) activeElement.classList.add("active");
}

/* =========================
   ОТРИСОВКА SVG КОЛЕСА
========================= */

function drawWheel() {
    const wheelSvg = document.getElementById('wheelSvg');
    const rewardList = document.getElementById('rewardList');
    if (!wheelSvg) return;

    const total = sectors.length;
    const sliceAngle = 360 / total;
    const radius = 150;
    const center = 150;

    let svgContent = '';

    sectors.forEach((sector, i) => {
        const startAngle = i * sliceAngle - 90;
        const endAngle = startAngle + sliceAngle;

        const x1 = center + radius * Math.cos((Math.PI * startAngle) / 180);
        const y1 = center + radius * Math.sin((Math.PI * startAngle) / 180);
        const x2 = center + radius * Math.cos((Math.PI * endAngle) / 180);
        const y2 = center + radius * Math.sin((Math.PI * endAngle) / 180);

        const pathData = `M ${center} ${center} L ${x1} ${y1} A ${radius} ${radius} 0 0 1 ${x2} ${y2} Z`;

        const textAngle = startAngle + sliceAngle / 2;
        const textRadius = radius * 0.75;
        const textX = center + textRadius * Math.cos((Math.PI * textAngle) / 180);
        const textY = center + textRadius * Math.sin((Math.PI * textAngle) / 180);

        svgContent += `
            <path d="${pathData}" fill="${sector.color}" class="wheel-sector" />
            <text x="${textX}" y="${textY}" class="wheel-sector-text" style="font-size: 8px;" transform="rotate(${textAngle + 90}, ${textX}, ${textY})">
                ${sector.label}
            </text>
        `;
    });

    wheelSvg.innerHTML = svgContent;

    if (rewardList) {
        rewardList.innerHTML = Object.keys(COLOR_CONFIG).map(key => {
            const cfg = COLOR_CONFIG[key];
            return `
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

function renderColorTabs() {
    const row = document.getElementById('colorTabsRow');
    if (!row) return;

    row.innerHTML = Object.keys(COLOR_CONFIG).map(key => {
        const cfg = COLOR_CONFIG[key];
        const hasBet = colorBets[key] > 0;

        return `
            <div class="color-tab-btn ${key === activeColor ? 'active' : ''}" 
                 id="tab-${key}" 
                 onclick="selectColorTab('${key}')">
                <span class="tab-indicator" style="background: ${cfg.color};"></span>
                <span class="tab-name">${cfg.name}</span>
                <span class="tab-mult" id="tab-val-${key}">
                    ${hasBet ? colorBets[key] + ' $' : cfg.label}
                </span>
            </div>
        `;
    }).join('');
}

function selectColorTab(color) {
    if (wheelSpinning) return;

    const currentInput = document.getElementById('activeBetInput');
    if (currentInput) {
        onActiveColorInput(currentInput.value);
    }

    activeColor = color;

    document.querySelectorAll('.color-tab-btn').forEach(btn => btn.classList.remove('active'));
    const currentTab = document.getElementById(`tab-${color}`);
    if (currentTab) currentTab.classList.add('active');

    const cfg = COLOR_CONFIG[color];
    const titleBox = document.getElementById('activeColorTitle');
    if (titleBox) {
        titleBox.innerHTML = `
            <span class="color-indicator" style="background: ${cfg.color};"></span>
            <div>
                <span>Ставка на ${cfg.name}</span><br>
                <span style="color: #888888; font-size: 11px; font-weight: 700;">(${cfg.label})</span>
            </div>
        `;
    }

    if (currentInput) {
        const savedVal = colorBets[color];
        currentInput.value = savedVal > 0 ? savedVal : '';
    }

    updateTotalBet();
}

function onActiveColorInput(val) {
    let parsed = parseFloat(val);
    if (isNaN(parsed) || parsed < 0.10) {
        colorBets[activeColor] = 0;
    } else {
        colorBets[activeColor] = parsed;
    }

    const tabVal = document.getElementById(`tab-val-${activeColor}`);
    if (tabVal) {
        const cfg = COLOR_CONFIG[activeColor];
        tabVal.textContent = colorBets[activeColor] > 0 ? `${colorBets[activeColor]} $` : cfg.label;
    }

    updateTotalBet();
}

function applyMinToActive() {
    if (wheelSpinning) return;
    colorBets[activeColor] = 0.10;

    const input = document.getElementById('activeBetInput');
    if (input) input.value = '0.10';

    const tabVal = document.getElementById(`tab-val-${activeColor}`);
    if (tabVal) tabVal.textContent = '0.10 $';

    updateTotalBet();
}

function applyPercentToActive(pct) {
    if (wheelSpinning) return;

    let otherBetsSum = 0;
    Object.keys(colorBets).forEach(key => {
        if (key !== activeColor) otherBetsSum += colorBets[key];
    });

    const availableBalance = currentBalance - otherBetsSum;
    if (availableBalance < 0.10) {
        showMessage("Недостаточно средств для минимальной ставки!");
        return;
    }

    let amount = Math.floor(availableBalance * pct * 100) / 100;
    if (amount < 0.10) {
        amount = 0.10;
    }

    colorBets[activeColor] = amount;

    const input = document.getElementById('activeBetInput');
    if (input) input.value = amount.toFixed(2);

    const tabVal = document.getElementById(`tab-val-${activeColor}`);
    if (tabVal) {
        tabVal.textContent = `${amount.toFixed(2)} $`;
    }

    updateTotalBet();
}

function resetActiveBet() {
    if (wheelSpinning) return;
    colorBets[activeColor] = 0;

    const input = document.getElementById('activeBetInput');
    if (input) input.value = '';

    const tabVal = document.getElementById(`tab-val-${activeColor}`);
    if (tabVal) {
        const cfg = COLOR_CONFIG[activeColor];
        tabVal.textContent = cfg.label;
    }

    updateTotalBet();
}

function updateTotalBet() {
    const totalInfo = document.getElementById('totalBetInfo');
    let totalSum = 0;

    Object.values(colorBets).forEach(val => {
        totalSum += val;
    });

    if (totalInfo) {
        totalInfo.textContent = `Общая ставка: ${totalSum.toFixed(2)} $`;
    }
}

/* =========================
   ВРАЩЕНИЕ КОЛЕСА
========================= */

async function spinWheel() {
    if (wheelSpinning || isBetProcessing) return;

    const button = document.getElementById('spinButton');
    if (!button) return;

    isBetProcessing = true;
    button.disabled = true;

    const currentInput = document.getElementById('activeBetInput');
    if (currentInput && currentInput.value !== '') {
        onActiveColorInput(currentInput.value);
    }

    let totalBet = 0;
    Object.keys(colorBets).forEach(key => {
        colorBets[key] = parseFloat(colorBets[key]) || 0;
        totalBet += colorBets[key];
    });

    if (totalBet < 0.10) {
        showMessage("Минимальная общая ставка — 0.10 $!");
        button.disabled = false;
        isBetProcessing = false;
        return;
    }

    if (totalBet > currentBalance) {
        showMessage("Недостаточно средств на балансе!");
        button.disabled = false;
        isBetProcessing = false;
        return;
    }

    const success = await apiRecordBet(totalBet);
    if (!success) {
        showMessage("Ошибка проведения ставки!");
        button.disabled = false;
        isBetProcessing = false;
        return;
    }

    wheelSpinning = true;
    button.innerHTML = '<span>↻ Вращение...</span>';

    const result = document.getElementById('wheelResult');
    const resultValue = document.getElementById('resultValue');
    const wheelSvg = document.getElementById('wheelSvg');
    const wheelStage = document.querySelector('.wheel-stage');

    if (result) result.classList.remove('show');
    if (resultValue) resultValue.textContent = '?';

    const rewardIndex = Math.floor(Math.random() * sectors.length);
    const totalSectors = sectors.length;
    const sectorAngle = 360 / totalSectors;

    const padding = 0.15; 
    const randomOffset = (Math.random() * (1 - 2 * padding) + padding) * sectorAngle;

    const targetAngleInSector = (rewardIndex * sectorAngle) + randomOffset;
    const stopAngle = 360 - targetAngleInSector;

    const fullSpins = 6;
    wheelRotation += fullSpins * 360 + (stopAngle - (wheelRotation % 360));

    if (wheelSvg) wheelSvg.style.transform = `rotate(${wheelRotation}deg)`;

    setTimeout(() => {
        if (wheelStage) wheelStage.classList.add('zoomed');
    }, 3600);

    setTimeout(async () => {
        if (wheelStage) wheelStage.classList.remove('zoomed');

        const wonSector = sectors[rewardIndex];
        const sectorType = wonSector.type; 
        
        const betOnWonColor = parseFloat(colorBets[sectorType]) || 0;
        const multiplier = parseFloat(wonSector.mult) || 0;

        let totalWin = 0;

        if (betOnWonColor > 0 && multiplier > 0) {
            totalWin = betOnWonColor * multiplier;
            await apiAddWin(totalWin);
        }

        if (resultValue) {
            if (totalWin > 0) {
                resultValue.textContent = `Победа +${totalWin.toFixed(2)} $ (${wonSector.label})`;
                resultValue.style.color = '#2ecc71';
            } else {
                resultValue.textContent = `Выпал ${wonSector.name} (${wonSector.label})`;
                resultValue.style.color = '#e74c3c';
            }
        }

        if (result) result.classList.add('show');

        if (tg?.HapticFeedback) {
            tg.HapticFeedback.notificationOccurred(totalWin > 0 ? "success" : "error");
        }

        wheelSpinning = false;
        isBetProcessing = false;
        button.disabled = false;
        button.innerHTML = '<span>↻ Сделать ставку</span>';

    }, 5000);
}

/* =========================
   ПОПОЛНЕНИЕ И ВЫВОД
========================= */

function renderTransactions() {
    const list = document.getElementById("historyList");
    const count = document.getElementById("txCount");
    if (!list) return;

    if (count) count.textContent = `${transactions.length} операций`;

    if (transactions.length === 0) {
        list.innerHTML = `<div style="text-align:center; color:#666; font-size:13px; padding:15px;">История пуста</div>`;
        return;
    }

    list.innerHTML = transactions.map(tx => {
        const isDep = tx.type === 'deposit';
        const sign = isDep ? '+' : '-';
        const title = isDep ? 'Пополнение' : 'Вывод средств';
        const statusText = tx.status === 'success' ? 'Успешно' : 'В обработке';

        const iconHTML = tx.icon.includes('.')
            ? `<img src="${tx.icon}" style="width: 16px; height: 16px; object-fit: contain; vertical-align: middle;">`
            : tx.icon;

        return `
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

function closeMethodsDropdown() {
    const dropdown = document.getElementById("methodsDropdown");
    const arrow = document.getElementById("methodArrow");
    if (dropdown) dropdown.classList.remove("open");
    if (arrow) arrow.textContent = "▼";
}

function setBalanceMode(mode) {
    balanceMode = mode;
    closeMethodsDropdown();

    const depositTab = document.getElementById("depositTab");
    const withdrawTab = document.getElementById("withdrawTab");
    const title = document.getElementById("formTitle");
    const subtitle = document.getElementById("formSubtitle");
    const action = document.getElementById("balanceAction");

    if (!depositTab || !withdrawTab || !title || !subtitle || !action) return;

    depositTab.classList.remove("active");
    withdrawTab.classList.remove("active");

    if (mode === "deposit") {
        depositTab.classList.add("active");
        title.textContent = "Пополнение баланса";
        subtitle.textContent = "Выберите удобный способ пополнения";
        action.textContent = "Пополнить";
    }

    if (mode === "withdraw") {
        withdrawTab.classList.add("active");
        title.textContent = "Вывод средств";
        subtitle.textContent = "Выберите способ вывода средств";
        action.textContent = "Вывести";
    }
}

function toggleMethods() {
    const dropdown = document.getElementById("methodsDropdown");
    const arrow = document.getElementById("methodArrow");

    if (!dropdown) return;
    dropdown.classList.toggle("open");

    if (arrow) {
        arrow.textContent = dropdown.classList.contains("open") ? "▲" : "▼";
    }
}

function selectMethod(method, icon, sub) {
    selectedMethod = method;
    selectedMethodIcon = icon;
    selectedMethodSub = sub;

    const selected = document.getElementById("selectedMethod");
    const selectedSub = document.getElementById("selectedMethodSub");
    const iconElement = document.getElementById("selectedMethodIcon");

    if (selected) selected.textContent = method;
    if (selectedSub) selectedSub.textContent = sub;

    if (iconElement) {
        if (icon.includes('.')) {
            iconElement.src = icon;
        } else {
            iconElement.textContent = icon;
        }
    }

    closeMethodsDropdown();
}

function demoBalanceAction() {
    const input = document.getElementById("amountInput");
    if (!input) return;

    const amount = parseFloat(input.value);

    if (!amount || amount <= 0) {
        showMessage("Введите сумму");
        return;
    }

    if (balanceMode === "deposit") {
        setUIBalance(currentBalance + amount);

        transactions.unshift({
            type: 'deposit',
            method: selectedMethod,
            icon: selectedMethodIcon,
            amount: amount,
            date: 'Только что',
            status: 'success'
        });
        renderTransactions();

        showMessage(`Демо: пополнено ${amount.toFixed(2)} $ через ${selectedMethod}`);
        return;
    }

    if (amount > currentBalance) {
        showMessage("Недостаточно средств");
        return;
    }

    setUIBalance(currentBalance - amount);

    transactions.unshift({
        type: 'withdraw',
        method: selectedMethod,
        icon: selectedMethodIcon,
        amount: amount,
        date: 'Только что',
        status: 'pending'
    });
    renderTransactions();

    showMessage(`Демо: отправлено на вывод ${amount.toFixed(2)} $ через ${selectedMethod}`);
}

function claimBonus() {
    showMessage("Демо: ежедневный бонус пока не подключён");
}

function showMessage(text) {
    if (tg?.showAlert) {
        tg.showAlert(text);
        return;
    }
    alert(text);
}

/* =========================
   ПРОФИЛЬ И КАСТОМИЗАЦИЯ ФОНА
========================= */

function applyDesign() {
    const cover = document.getElementById('profileCover');
    if (cover) {
        cover.style.background = `linear-gradient(180deg, ${profileDesign.start} 0%, ${profileDesign.end} 100%)`;
    }
}

function renderCustomizerControls() {
    const colorGrid = document.getElementById('colorPickerGrid');
    if (colorGrid) {
        colorGrid.innerHTML = COLOR_PALETTE.map(item => `
            <div class="color-option ${item.id === profileDesign.colorId ? 'active' : ''}" 
                 style="background: linear-gradient(135deg, ${item.start}, ${item.end});"
                 onclick="selectGradient('${item.id}', '${item.start}', '${item.end}')">
            </div>
        `).join('');
    }
}

function selectGradient(id, start, end) {
    profileDesign.colorId = id;
    profileDesign.start = start;
    profileDesign.end = end;
    renderCustomizerControls();
    applyDesign();
}

function toggleProfileCustomizer() {
    const box = document.getElementById('customizerBox');
    if (box) box.classList.toggle('hidden');
}

function saveProfileCustomization() {
    localStorage.setItem('wxs_profile', JSON.stringify(profileDesign));
    applyDesign();
    toggleProfileCustomizer();
    showMessage("Настройки сохранены!");
}

/* =========================
   ЗАПУСК
========================= */

document.addEventListener("DOMContentLoaded", async () => {
    loadTelegramUser();
    await updateBalance();
    renderTransactions();
    goHome();
    applyDesign();
});
