(function () {
// ==========================================
// 1. ИНИЦИАЛИЗАЦИЯ TELEGRAM И SUPABASE
// ==========================================
const tg = window.Telegram?.WebApp;

if (tg) {
    tg.ready();
    tg.expand();
}

const SUPABASE_URL = 'https://nkovsjhwinbbapsqvpnu.supabase.co';
// ⚠️ Ваша база данных Supabase:
const SUPABASE_ANON_KEY = 'sb_publishable_GVUZWdR9qVSHwL7aL63W8w_g7rtfJkN';

// Используем имя supabase, чтобы не менять вызовы по всему коду
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ==========================================
// АДРЕС БЭКЕНДА (api.py), поднятого через ngrok
// ==========================================
const API_BASE = 'https://cable-coral-ahead.ngrok-free.dev';

// Переменные состояния пользователя
let currentBalance = 0.00;
let currentTurnover = 0.00;
let currentMaxWin = 0.00;
let currentTotalWin = 0.00;
let currentBetsCount = 0;
let currentWinsCount = 0;
let currentDeposits = 0.00;
let currentWithdrawals = 0.00;

// ==========================================
// СИСТЕМА УРОВНЕЙ (на основе очков)
// ==========================================
const LEVELS = [
    { level: 1, points: 0,     title: "Новичок" },
    { level: 2, points: 1500,  title: "Гой" },
    { level: 3, points: 3750,  title: "Про" },
    { level: 4, points: 7500,  title: "Додеп" },
    { level: 5, points: 11250, title: "Лудик" },
    { level: 6, points: 15000, title: "Король пепе" },
    { level: 7, points: 15001, title: "Легенда" }
];

function calculatePoints() {
    const lossesCount = Math.max(0, currentBetsCount - currentWinsCount);
    return (currentTurnover * 75) + (currentWinsCount * 5) + (lossesCount * 10);
}

function getLevelInfo(points) {
    let current = LEVELS[0];
    let next = LEVELS[1] || null;

    for (let i = 0; i < LEVELS.length; i++) {
        if (points >= LEVELS[i].points) {
            current = LEVELS[i];
            next = LEVELS[i + 1] || null;
        } else {
            break;
        }
    }

    let percent;
    if (!next) {
        percent = 100;
    } else {
        const range = next.points - current.points;
        const progress = points - current.points;
        percent = range > 0 ? Math.min(100, Math.max(0, (progress / range) * 100)) : 100;
    }

    return {
        level: current.level,
        title: current.title,
        percent: percent,
        points: points
    };
}

function updateLevelUI() {
    const points = calculatePoints();
    const info = getLevelInfo(points);
    const percentRounded = Math.round(info.percent);

    const homeLevelText = document.getElementById("homeLevelText");
    const homeLevelBar = document.getElementById("homeLevelBar");
    const profileLevelText = document.getElementById("profileLevelText");
    const profileLevelPercent = document.getElementById("profileLevelPercent");
    const profileLevelFill = document.getElementById("profileLevelFill");

    if (homeLevelText) homeLevelText.textContent = `Уровень ${info.level}`;
    if (homeLevelBar) homeLevelBar.style.width = percentRounded + "%";

    if (profileLevelText) profileLevelText.textContent = `Уровень ${info.level} · ${info.title}`;
    if (profileLevelPercent) profileLevelPercent.textContent = percentRounded + "%";
    if (profileLevelFill) profileLevelFill.style.width = percentRounded + "%";
}

// ==========================================
// 2. ЗАГРУЗКА И СОХРАНЕНИЕ ДАННЫХ В SUPABASE
// ==========================================

function updateProfileUI(data) {
    const name = data.nickname || data.username || "Игрок";

    const usernameElem = document.getElementById("username");
    const profileName = document.getElementById("profileName");
    const profileUsername = document.getElementById("profileUsername");
    const avatarElem = document.getElementById("avatar");
    const profileAvatar = document.getElementById("profileAvatar");

    if (usernameElem) usernameElem.textContent = name;
    if (profileName) profileName.textContent = name;
    if (profileUsername) {
        profileUsername.textContent = data.username ? "@" + data.username : "Telegram пользователь";
    }

    if (data.photo_url) {
        const imageHTML = `<img src="${data.photo_url}" alt="avatar" style="width:100%; height:100%; object-fit:cover; border-radius:50%;">`;
        if (avatarElem) avatarElem.innerHTML = imageHTML;
        if (profileAvatar) profileAvatar.innerHTML = imageHTML;
    }

    setUIBalance(data.balance);
}

async function loadUserData() {
    const tgUser = tg?.initDataUnsafe?.user;

    if (!tgUser) {
        console.warn('Запуск вне Telegram — используются локальные данные');
        return;
    }

    const profileData = {
        telegram_id: tgUser.id,
        username: tgUser.username || '',
        nickname: tgUser.first_name + (tgUser.last_name ? ' ' + tgUser.last_name : ''),
        photo_url: tgUser.photo_url || ''
    };

    let { data, error } = await supabase
        .from('wxs_game')
        .select('*')
        .eq('telegram_id', tgUser.id)
        .maybeSingle();

    if (error && error.code === 'PGRST116') {
        console.error('В таблице wxs_game найдено несколько строк для telegram_id=' + tgUser.id + '. Нужно удалить дубликаты в Supabase и добавить UNIQUE-ограничение на telegram_id.');
        const { data: dupRows, error: dupError } = await supabase
            .from('wxs_game')
            .select('*')
            .eq('telegram_id', tgUser.id)
            .order('id', { ascending: true });

        if (dupError || !dupRows || dupRows.length === 0) {
            showMessage("Не удалось загрузить профиль (дубликаты записей). Обратитесь в поддержку.");
            return;
        }
        data = dupRows[0];
        error = null;
    }

    if (error) {
        console.error('Ошибка загрузки из Supabase:', error);
        showMessage("Не удалось загрузить профиль. Проверьте соединение и перезапустите приложение.");
        return;
    }

    if (!data) {
        const { data: newUser, error: createError } = await supabase
            .from('wxs_game')
            .upsert([{
                ...profileData,
                balance: 100.00,
                turnover: 0,
                max_win: 0,
                total_win: 0,
                bets_count: 0,
                wins_count: 0,
                deposits: 0,
                withdrawals: 0
            }], { onConflict: 'telegram_id', ignoreDuplicates: false })
            .select()
            .single();

        if (createError) {
            console.error('Ошибка создания записи в Supabase:', createError);
            showMessage("Не удалось создать профиль. Проверьте соединение и перезапустите приложение.");
            return;
        }
        data = newUser;
    } else {
        await supabase
            .from('wxs_game')
            .update(profileData)
            .eq('telegram_id', tgUser.id);
    }

    currentTurnover = Number(data.turnover) || 0;
    currentMaxWin = Number(data.max_win) || 0;
    currentTotalWin = Number(data.total_win) || 0;
    currentBetsCount = Number(data.bets_count) || 0;
    currentWinsCount = Number(data.wins_count) || 0;
    currentDeposits = Number(data.deposits) || 0;
    currentWithdrawals = Number(data.withdrawals) || 0;

    updateProfileUI(data);
}

/* =========================
   БЕЗОПАСНАЯ РАБОТА С ДЕНЬГАМИ
========================= */

function roundMoney(value) {
    const n = Number(value);
    if (!isFinite(n)) return 0;
    return Math.round((n + Number.EPSILON) * 100) / 100;
}

let isEconomyLocked = false;

function lockEconomy() {
    if (isEconomyLocked) return false;
    isEconomyLocked = true;
    return true;
}

function unlockEconomy() {
    isEconomyLocked = false;
}

function snapshotBalanceState() {
    return {
        balance: currentBalance,
        turnover: currentTurnover,
        maxWin: currentMaxWin,
        totalWin: currentTotalWin,
        betsCount: currentBetsCount,
        winsCount: currentWinsCount,
        deposits: currentDeposits,
        withdrawals: currentWithdrawals
    };
}

function restoreBalanceState(snap) {
    currentBalance = snap.balance;
    currentTurnover = snap.turnover;
    currentMaxWin = snap.maxWin;
    currentTotalWin = snap.totalWin;
    currentBetsCount = snap.betsCount;
    currentWinsCount = snap.winsCount;
    currentDeposits = snap.deposits;
    currentWithdrawals = snap.withdrawals;
    setUIBalance(currentBalance);
}

let saveQueue = Promise.resolve();

async function saveUserData() {
    const tgUser = tg?.initDataUnsafe?.user;
    if (!tgUser) return true;

    currentBalance = roundMoney(currentBalance);
    currentTurnover = roundMoney(currentTurnover);
    currentTotalWin = roundMoney(currentTotalWin);
    currentDeposits = roundMoney(currentDeposits);
    currentWithdrawals = roundMoney(currentWithdrawals);

    const payload = {
        balance: currentBalance,
        turnover: currentTurnover,
        max_win: currentMaxWin,
        total_win: currentTotalWin,
        bets_count: currentBetsCount,
        wins_count: currentWinsCount,
        deposits: currentDeposits,
        withdrawals: currentWithdrawals
    };

    const runUpdate = () => supabase
        .from('wxs_game')
        .update(payload)
        .eq('telegram_id', tgUser.id);

    const task = saveQueue.then(runUpdate, runUpdate);
    saveQueue = task.then(() => {}, () => {});

    let error;
    try {
        ({ error } = await task);
    } catch (e) {
        error = e;
    }

    if (error) {
        console.error('Ошибка сохранения в Supabase:', error);
        return false;
    }
    return true;
}

async function saveUserDataWithRetry(attempts = 2) {
    for (let i = 0; i < attempts; i++) {
        const ok = await saveUserData();
        if (ok) return true;
    }
    return false;
}

/* =========================
   СОСТОЯНИЕ ПРИЛОЖЕНИЯ
========================= */

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

let transactions = [];

const COLOR_CONFIG = {
    green:  { label: '1x',  mult: 1,  color: '#2ecc71', name: 'Зеленый' },
    red:    { label: '2x',  mult: 2,  color: '#e74c3c', name: 'Красный' },
    blue:   { label: '3x',  mult: 3,  color: '#3498db', name: 'Синий' },
    yellow: { label: '5x',  mult: 5,  color: '#f1c40f', name: 'Желтый' },
    gold:   { label: '20x', mult: 20, color: '#ffd700', name: 'Золото' }
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

// Изменение количества мин кнопками "-" и "+" в капсуле
function changeMinesBy(delta) {
    if (minesGame.active) return; // нельзя менять во время раунда
    const input = document.getElementById('customMinesInput');
    if (!input) return;

    let val = (parseInt(input.value) || minesGame.minesCount) + delta;

    // Ограничиваем диапазон от 3 до 24 мин
    val = Math.max(3, Math.min(24, val));

    input.value = val;
    onCustomMinesInputChange(val);
}

// Обработка ручного ввода числа в капсуле
function onCustomMinesInputChange(val) {
    if (minesGame.active) return;

    const input = document.getElementById('customMinesInput');
    let num = parseInt(val);

    if (isNaN(num)) return;

    // Ограничения от 3 до 24
    num = Math.max(3, Math.min(24, num));

    // Пишем в реальное игровое состояние
    minesGame.minesCount = num;

    // Клэмпим визуальное значение поля, если пользователь вышел за диапазон
    if (input && parseInt(input.value) !== num) {
        input.value = num;
    }

    // Подсвечиваем кнопку пресета, если число совпадает, иначе снимаем подсветку со всех
    document.querySelectorAll('.mines-count-btn').forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.innerText) === num);
    });

    // Пересчитываем полосу коэффициентов под новое количество мин
    renderMinesCoefBar();
}

function selectMinesCount(count, btn) {
    if (minesGame.active) return;
    minesGame.minesCount = count;

    // Синхронизируем капсулу ручного ввода с выбранным пресетом
    const input = document.getElementById('customMinesInput');
    if (input) input.value = count;

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
    const houseEdgeMargin = 0.95;
    return Math.floor(mult * houseEdgeMargin * 100) / 100;
}

function renderMinesCoefBar() {
    const bar = document.getElementById('minesCoefBar');
    if (!bar) return;

    let html = '';
    const maxGems = 25 - minesGame.minesCount;

    for (let step = 1; step <= maxGems; step++) {
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

    const activeElem = bar.querySelector('.coef-item.active');
    if (activeElem) {
        activeElem.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
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
    if (!lockEconomy()) return;

    const input = document.getElementById('minesBetInput');
    const bet = roundMoney(parseFloat(input.value));

    if (!bet || isNaN(bet) || bet < 0.10) {
        showMessage("Минимальная ставка — 0.10 $!");
        unlockEconomy();
        return;
    }
    if (bet > currentBalance) {
        showMessage("Недостаточно средств!");
        unlockEconomy();
        return;
    }

    minesGame.isProcessing = true;
    const snapshot = snapshotBalanceState();

    currentBalance = roundMoney(currentBalance - bet);
    currentTurnover = roundMoney(currentTurnover + bet);
    currentBetsCount++;
    setUIBalance(currentBalance);

    const debited = await saveUserData();
    if (!debited) {
        restoreBalanceState(snapshot);
        showMessage("Не удалось списать ставку. Проверьте соединение и попробуйте снова.");
        minesGame.isProcessing = false;
        unlockEconomy();
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
    unlockEconomy();
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
    if (!lockEconomy()) return;
    minesGame.isProcessing = true;

    const snapshot = snapshotBalanceState();

    const mult = getMinesMultiplier(minesGame.gemsFound, minesGame.minesCount);
    const winAmount = roundMoney(minesGame.bet * mult);

    currentBalance = roundMoney(currentBalance + winAmount);
    currentTotalWin = roundMoney(currentTotalWin + winAmount);
    currentWinsCount++;
    if (mult > currentMaxWin) currentMaxWin = mult;

    setUIBalance(currentBalance);
    const credited = await saveUserDataWithRetry();

    if (!credited) {
        restoreBalanceState(snapshot);
        showMessage("Не удалось зачислить выигрыш. Проверьте соединение и нажмите «Забрать» ещё раз.");
        minesGame.isProcessing = false;
        unlockEconomy();
        return;
    }

    if (tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred("success");
    showMessage(`Выигрыш: +${winAmount.toFixed(2)}$ (${mult.toFixed(2)}x)`);

    endMinesGame(true);
    unlockEconomy();
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
    КРАШ (РАКЕТА)
========================= */

// Пауза между раундами (в это же время принимаются ставки на следующий раунд)
const CRASH_WAIT_MS = 5000;

// Скорость роста коэффициента: x2 за 10 секунд полёта (исходный рост)
const CRASH_GROWTH_PER_MS = Math.log(2) / 10000;
// Время «раскачки» — исходные 6000 мс (6 сек)
const CRASH_SLOW_START_MS = 6000;
const CRASH_SLOW_START_TARGET = 1.5;

let crashGame = {
    phase: 'waiting',   // 'waiting' — приём ставок / пауза, 'flying' — полёт
    crashPoint: 0,
    currentMult: 1.00,
    bet: 0,
    betPlaced: false,
    cashedOut: false,
    startTime: 0,
    phaseEndsAt: 0,
    isProcessing: false
};

let crashAnimHandle = null;
let crashTimerHandle = null;
let crashLoopStarted = false;
let crashHistory = [];      // последние коэффициенты, самый новый — первый
let lastCrashPoint = null;  // коэффициент прошлого раунда (для отображения в паузе)
let crashTrailPoints = [];  // точки следа ракеты за текущий полёт
let crashRocketAnim = null; // экземпляр Lottie-анимации ракеты

// Кэш DOM-элементов для исключения лишних поисков при каждом кадре (60 FPS)
let crashDomCache = null;

function getCrashDom() {
    if (!crashDomCache) {
        crashDomCache = {
            statusEl: document.getElementById('crashStatus'),
            multEl: document.getElementById('crashMultiplier'),
            rocketEl: document.getElementById('crashRocket'),
            actionBtn: document.getElementById('crashActionBtn'),
            betInput: document.getElementById('crashBetInput'),
            stageEl: document.getElementById('crashStage'),
            countdownEl: document.getElementById('crashCountdown'),
            centerInfoEl: document.getElementById('crashCenterInfo'),
            explosionEl: document.getElementById('crashExplosion'),
            trailLine: document.getElementById('crashTrailLine'),
            trailDot: document.getElementById('crashTrailDot'),
            topLeftMult: document.getElementById('crashMultTopLeft'),
            historyList: document.getElementById('crashHistoryList')
        };
    }
    return crashDomCache;
}

// Загружает анимацию ракеты
function initCrashRocketAnim() {
    const dom = getCrashDom();
    if (!dom.rocketEl || crashRocketAnim) return;

    let animationData = null;
    if (window.ROCKET_DATA_CHUNKS && window.ROCKET_DATA_CHUNKS.length) {
        try {
            animationData = JSON.parse(window.ROCKET_DATA_CHUNKS.join(''));
        } catch (e) {
            animationData = null;
        }
    }

    if (typeof lottie === 'undefined' || !animationData) {
        dom.rocketEl.textContent = '🚀';
        dom.rocketEl.style.fontSize = '34px';
        dom.rocketEl.style.lineHeight = '54px';
        dom.rocketEl.style.textAlign = 'center';
        return;
    }

    crashRocketAnim = lottie.loadAnimation({
        container: dom.rocketEl,
        renderer: 'svg',
        loop: true,
        autoplay: true,
        animationData: animationData
    });
}

function openCrash() {
    showPage("crashPage");
    updateNav("games");
    initCrashPage();
}

function initCrashPage() {
    renderCrashHistory();
    renderCrashUI();
    initCrashRocketAnim();
}

function startCrashEngine() {
    if (crashLoopStarted) return;
    crashLoopStarted = true;
    beginWaitingPhase();
}

function beginWaitingPhase() {
    crashGame.phase = 'waiting';
    crashGame.currentMult = 1.00;
    crashGame.betPlaced = false;
    crashGame.cashedOut = false;
    crashGame.bet = 0;
    crashGame.phaseEndsAt = Date.now() + CRASH_WAIT_MS;

    renderCrashUI();

    clearInterval(crashTimerHandle);
    crashTimerHandle = setInterval(() => {
        const msLeft = crashGame.phaseEndsAt - Date.now();
        if (msLeft <= 0) {
            clearInterval(crashTimerHandle);
            beginFlyingPhase();
        } else {
            renderCrashUI();
        }
    }, 100);
}

function generateCrashPoint() {
    const houseEdge = 0.05;
    const r = Math.random();
    if (r < houseEdge) return 1.00;
    const point = (1 - houseEdge) / (1 - r);
    return Math.max(1.00, Math.floor(point * 100) / 100);
}

function beginFlyingPhase() {
    crashGame.phase = 'flying';
    crashGame.crashPoint = generateCrashPoint();
    crashGame.currentMult = 1.00;
    crashGame.startTime = performance.now();

    crashTrailPoints = [];
    const dom = getCrashDom();
    
    if (dom.trailLine) {
        dom.trailLine.setAttribute('d', '');
        dom.trailLine.classList.remove('crash-trail-crashed');
        dom.trailLine.style.opacity = '1';
    }
    if (dom.trailDot) {
        dom.trailDot.classList.remove('crash-trail-crashed', 'crash-dot-live');
        dom.trailDot.style.opacity = '0';
    }

    if (dom.topLeftMult) {
        dom.topLeftMult.textContent = '1.00x';
        dom.topLeftMult.classList.remove('crashed');
        dom.topLeftMult.style.display = 'block';
    }

    renderCrashUI();
    tickCrash();
}

// Резкая тряска экрана с затуханием на GPU
function explosionShake(el, duration = 500, magnitude = 20) {
    if (!el) return;
    const start = performance.now();
    function frame(now) {
        const t = now - start;
        if (t >= duration) {
            el.style.transform = 'translate3d(0px, 0px, 0px)';
            return;
        }
        const decay = 1 - t / duration;
        const dx = (Math.random() - 0.5) * magnitude * decay;
        const dy = (Math.random() - 0.5) * magnitude * decay;
        el.style.transform = `translate3d(${dx}px, ${dy}px, 0px)`;
        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
}

function tickCrash() {
    const elapsed = performance.now() - crashGame.startTime;

    let rawMult;
    if (elapsed < CRASH_SLOW_START_MS) {
        const p = elapsed / CRASH_SLOW_START_MS;
        const eased = Math.pow(p, 3);
        rawMult = 1 + (CRASH_SLOW_START_TARGET - 1) * eased;
    } else {
        const elapsedAfter = elapsed - CRASH_SLOW_START_MS;
        rawMult = CRASH_SLOW_START_TARGET * Math.exp(CRASH_GROWTH_PER_MS * elapsedAfter);
    }

    crashGame.currentMult = Math.min(
        crashGame.crashPoint,
        Math.floor(rawMult * 100) / 100
    );

    renderCrashUI();

    if (crashGame.currentMult >= crashGame.crashPoint) {
        endCrashRound();
        return;
    }

    crashAnimHandle = requestAnimationFrame(tickCrash);
}

function endCrashRound() {
    cancelAnimationFrame(crashAnimHandle);

    lastCrashPoint = crashGame.crashPoint;
    crashHistory.unshift(crashGame.crashPoint);
    if (crashHistory.length > 15) crashHistory.pop();
    renderCrashHistory();

    if (window.tg?.HapticFeedback) {
        tg.HapticFeedback.notificationOccurred((crashGame.betPlaced && crashGame.cashedOut) ? "success" : "error");
    }

    const dom = getCrashDom();

    if (crashRocketAnim) crashRocketAnim.pause();
    if (dom.rocketEl) dom.rocketEl.style.opacity = '0';

    if (dom.trailLine) {
        dom.trailLine.classList.add('crash-trail-crashed');
    }
    if (dom.trailDot) {
        dom.trailDot.classList.remove('crash-dot-live');
        dom.trailDot.classList.add('crash-trail-crashed');
        dom.trailDot.style.opacity = '1';
    }
    
    setTimeout(() => {
        if (dom.trailLine) dom.trailLine.style.opacity = '0';
        if (dom.trailDot) dom.trailDot.style.opacity = '0';
    }, 1200);

    setTimeout(() => {
        if (dom.trailLine) dom.trailLine.setAttribute('d', '');
        crashTrailPoints = [];
    }, 2200);

    if (dom.explosionEl) {
        let offsetTransform = 'translate3d(0px, 0px, 0px)';
        if (dom.rocketEl && dom.rocketEl.style.transform) {
            const m = dom.rocketEl.style.transform.match(/translate3d\(([-\d.]+)px,\s*([-\d.]+)px/);
            if (m) offsetTransform = `translate3d(${m[1]}px, ${m[2]}px, 0px)`;
        }
        dom.explosionEl.style.transform = offsetTransform;
        dom.explosionEl.style.display = 'block';
    }

    if (dom.multEl) dom.multEl.style.color = '#e74c3c';
    if (dom.topLeftMult) {
        dom.topLeftMult.textContent = crashGame.crashPoint.toFixed(2) + 'x';
        dom.topLeftMult.classList.add('crashed');
        dom.topLeftMult.style.display = 'block';
    }
    if (dom.actionBtn) {
        dom.actionBtn.textContent = crashGame.cashedOut ? 'Выигрыш забран ✓' : 'Раунд завершён';
        dom.actionBtn.disabled = true;
    }

    explosionShake(dom.stageEl, 500, 20);
    setTimeout(beginWaitingPhase, 3000);
}

async function placeCrashBet() {
    if (crashGame.phase !== 'waiting' || crashGame.betPlaced) return;
    if (crashGame.isProcessing) return;
    if (!lockEconomy()) return;

    const dom = getCrashDom();
    const bet = roundMoney(parseFloat(dom.betInput?.value));

    if (!bet || isNaN(bet) || bet < 0.10) {
        showMessage("Минимальная ставка — 0.10 $!");
        unlockEconomy();
        return;
    }
    if (bet > currentBalance) {
        showMessage("Недостаточно средств!");
        unlockEconomy();
        return;
    }

    crashGame.isProcessing = true;
    const snapshot = snapshotBalanceState();

    currentBalance = roundMoney(currentBalance - bet);
    currentTurnover = roundMoney(currentTurnover + bet);
    currentBetsCount++;
    setUIBalance(currentBalance);

    const debited = await saveUserData();
    if (!debited) {
        restoreBalanceState(snapshot);
        showMessage("Не удалось списать ставку. Проверьте соединение и попробуйте снова.");
        crashGame.isProcessing = false;
        unlockEconomy();
        return;
    }

    crashGame.bet = bet;
    crashGame.betPlaced = true;
    crashGame.cashedOut = false;
    crashGame.isProcessing = false;
    unlockEconomy();
    renderCrashUI();
}

async function cashOutCrash() {
    if (crashGame.phase !== 'flying' || !crashGame.betPlaced || crashGame.cashedOut) return;
    if (crashGame.isProcessing) return;
    if (!lockEconomy()) return;

    crashGame.isProcessing = true;
    const snapshot = snapshotBalanceState();

    const mult = crashGame.currentMult;
    const winAmount = roundMoney(crashGame.bet * mult);

    currentBalance = roundMoney(currentBalance + winAmount);
    currentTotalWin = roundMoney(currentTotalWin + winAmount);
    currentWinsCount++;
    if (mult > currentMaxWin) currentMaxWin = mult;

    setUIBalance(currentBalance);
    const credited = await saveUserDataWithRetry();

    if (!credited) {
        restoreBalanceState(snapshot);
        showMessage("Не удалось зачислить выигрыш. Проверьте соединение и нажмите «Забрать» ещё раз.");
        crashGame.isProcessing = false;
        unlockEconomy();
        return;
    }

    crashGame.cashedOut = true;
    crashGame.isProcessing = false;

    if (window.tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred("success");
    showMessage(`Забрано: +${winAmount.toFixed(2)}$ (${mult.toFixed(2)}x)`);

    renderCrashUI();
    unlockEconomy();
}

function handleCrashAction() {
    if (crashGame.isProcessing) return;

    if (crashGame.phase === 'waiting' && !crashGame.betPlaced) {
        placeCrashBet();
    } else if (crashGame.phase === 'flying' && crashGame.betPlaced && !crashGame.cashedOut) {
        cashOutCrash();
    }
}

function adjustCrashBet(factor) {
    if (crashGame.betPlaced) return;
    const dom = getCrashDom();
    if (!dom.betInput) return;

    let current = parseFloat(dom.betInput.value);
    if (isNaN(current) || current < 0.10) {
        current = 0.10;
    } else {
        current = Math.max(0.10, current * factor);
    }
    dom.betInput.value = current.toFixed(2);
}

function setCrashMaxBet() {
    if (crashGame.betPlaced) return;
    const dom = getCrashDom();
    if (dom.betInput) dom.betInput.value = currentBalance.toFixed(2);
}

function renderCrashHistory() {
    const dom = getCrashDom();
    if (!dom.historyList) return;

    dom.historyList.innerHTML = crashHistory.map(point => {
        const color = point < 1.5 ? '#e74c3c' : (point >= 2 ? '#2ecc71' : '#f1c40f');
        return `<span style="display:inline-block; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.1); border-radius:10px; padding:4px 8px; font-size:11px; font-weight:800; color:${color};">${point.toFixed(2)}x</span>`;
    }).join('');
}

function renderCrashUI() {
    const dom = getCrashDom();
    if (!dom.statusEl || !dom.multEl || !dom.actionBtn) return;

    if (crashGame.phase === 'waiting') {
        const secLeft = Math.max(0, Math.ceil((crashGame.phaseEndsAt - Date.now()) / 1000));
        dom.statusEl.textContent = lastCrashPoint !== null
            ? `Прошлый раунд: ${lastCrashPoint.toFixed(2)}x · Старт через ${secLeft}с`
            : `Старт через ${secLeft}с`;

        dom.multEl.textContent = '1.00x';
        dom.multEl.style.color = '#fff';

        if (secLeft >= 1 && secLeft <= 5) {
            if (dom.countdownEl) {
                dom.countdownEl.textContent = String(secLeft);
                dom.countdownEl.className = 'crash-countdown ' + (secLeft === 5 ? 'cc-green' : (secLeft >= 3 ? 'cc-yellow' : 'cc-red'));
                dom.countdownEl.style.display = 'flex';
            }
            if (dom.centerInfoEl) dom.centerInfoEl.style.opacity = '0';
            if (dom.rocketEl) dom.rocketEl.style.opacity = '0';
        } else {
            if (dom.countdownEl) dom.countdownEl.style.display = 'none';
            if (dom.centerInfoEl) dom.centerInfoEl.style.opacity = '1';
            if (dom.rocketEl) dom.rocketEl.style.opacity = '1';
        }

        if (dom.rocketEl) {
            const stageW = dom.stageEl ? dom.stageEl.clientWidth : 300;
            const stageH = dom.stageEl ? dom.stageEl.clientHeight : 340;
            const centerXWait = (stageW - 200) / 2 - 16;
            const centerYWait = 16 - (stageH - 200) / 2;
            
            dom.rocketEl.style.transform = `translate3d(${centerXWait}px, ${centerYWait}px, 0px) rotate(45deg)`;
        }
        if (crashRocketAnim) crashRocketAnim.goToAndPlay(0, true);

        if (dom.explosionEl) dom.explosionEl.style.display = 'none';
        if (dom.stageEl) dom.stageEl.style.transform = 'translate3d(0px, 0px, 0px)';

        if (dom.trailLine) {
            dom.trailLine.setAttribute('d', '');
            dom.trailLine.classList.remove('crash-trail-crashed');
            dom.trailLine.style.opacity = '1';
        }

        if (dom.trailDot) {
            dom.trailDot.classList.remove('crash-dot-live', 'crash-trail-crashed');
            dom.trailDot.style.opacity = '0';
        }

        if (dom.topLeftMult) dom.topLeftMult.style.display = 'none';
        if (dom.betInput) dom.betInput.disabled = crashGame.betPlaced;

        dom.actionBtn.textContent = crashGame.betPlaced ? 'Ставка принята' : 'Сделать ставку';
        dom.actionBtn.disabled = crashGame.betPlaced;
        return;
    }

    // phase === 'flying'
    if (dom.topLeftMult) {
        dom.topLeftMult.textContent = crashGame.currentMult.toFixed(2) + 'x';
        dom.topLeftMult.classList.remove('crashed');
        dom.topLeftMult.style.display = 'block';
    }

    if (dom.countdownEl) dom.countdownEl.style.display = 'none';
    if (dom.centerInfoEl) dom.centerInfoEl.style.opacity = '0';
    if (dom.rocketEl) dom.rocketEl.style.opacity = '1';

    if (dom.rocketEl) {
        const stageW = dom.stageEl ? dom.stageEl.clientWidth : 300;
        const stageH = dom.stageEl ? dom.stageEl.clientHeight : 340;

        const centerX = (stageW - 200) / 2 - 16;
        const centerY = 16 - (stageH - 200) / 2;

        const currentM = crashGame.currentMult;

        // Скорость полета ракеты: достигает верхнего угла (пика) ровно при 3.00x
        const trailProgress = Math.min(1, Math.max(0, (currentM - 1) / 2));

        // Поворот ракеты адаптирован под траекторию до 3.00x
        const angle = 45 - (90 * trailProgress);

        dom.rocketEl.style.transform = `translate3d(${centerX}px, ${centerY}px, 0px) rotate(${angle}deg)`;

        const trailStartX = stageW * 0.05;
        const trailStartY = stageH * 0.95;
        const trailEndX = stageW * 0.95;
        const trailEndY = stageH * 0.05;

        const headX = trailStartX + (trailEndX - trailStartX) * trailProgress;
        const headY = trailStartY + (trailEndY - trailStartY) * trailProgress;

        if (dom.trailLine) {
            const segDx = headX - trailStartX;
            const segDy = headY - trailStartY;
            const segLen = Math.hypot(segDx, segDy) || 1;
            const bow = 0.25 * segLen;
            const ctrlX = (trailStartX + headX) / 2 + (-segDy / segLen) * bow;
            const ctrlY = (trailStartY + headY) / 2 + (segDx / segLen) * bow;
            dom.trailLine.setAttribute('d', `M ${trailStartX},${trailStartY} Q ${ctrlX},${ctrlY} ${headX},${headY}`);
        }

        if (dom.trailDot) {
            dom.trailDot.setAttribute('cx', headX);
            dom.trailDot.setAttribute('cy', headY);
            dom.trailDot.style.opacity = '1';
            dom.trailDot.classList.add('crash-dot-live');
        }
    }

    if (dom.stageEl) {
        const shakeStrength = Math.min(8, (crashGame.currentMult - 1) * 1.2);
        const dx = (Math.random() - 0.5) * shakeStrength;
        const dy = (Math.random() - 0.5) * shakeStrength;
        dom.stageEl.style.transform = `translate3d(${dx}px, ${dy}px, 0px)`;
    }

    if (dom.betInput) dom.betInput.disabled = true;

    if (crashGame.betPlaced && !crashGame.cashedOut) {
        const potential = (crashGame.bet * crashGame.currentMult).toFixed(2);
        dom.actionBtn.textContent = `Забрать ${potential}$`;
        dom.actionBtn.disabled = false;
    } else if (crashGame.cashedOut) {
        dom.actionBtn.textContent = 'Выигрыш забран ✓';
        dom.actionBtn.disabled = true;
    } else {
        dom.actionBtn.textContent = 'Ждите следующего раунда';
        dom.actionBtn.disabled = true;
    }
}

/* =========================
   ИГРА «КИРКА»
========================= */
const PICKAXES = [
    { level: 1, name: "Деревянная", hp: 80,  weight: 50, color: "#8B5A2B", emoji: "🪵" },
    { level: 2, name: "Каменная",   hp: 110, weight: 25, color: "#808080", emoji: "🪨" },
    { level: 3, name: "Медная",     hp: 140, weight: 13, color: "#B87333", emoji: "🥉" },
    { level: 4, name: "Железная",   hp: 170, weight: 7,  color: "#D3D3D3", emoji: "⚔️" },
    { level: 5, name: "Золотая",    hp: 200, weight: 4,  color: "#FFD700", emoji: "👑" },
    { level: 6, name: "Алмазная",   hp: 250, weight: 1,  color: "#00FFFF", emoji: "💎" }
];

let isPickaxeRunning = false;

function getRandomPickaxe() {
    const totalWeight = PICKAXES.reduce((sum, p) => sum + p.weight, 0);
    let rand = Math.random() * totalWeight;
    for (const pickaxe of PICKAXES) {
        if (rand < pickaxe.weight) return pickaxe;
        rand -= pickaxe.weight;
    }
    return PICKAXES[0];
}

function openPickaxe() {
    showPage("pickaxePage");
    updateNav("games");
    renderMineGrid();
}

function renderMineGrid() {
    const grid = document.getElementById('mineGrid');
    if (!grid) return;
    grid.innerHTML = '';
    
    // Генерируем шахту 8 колонок на 12 строк
    for (let r = 0; r < 12; r++) {
        for (let c = 0; c < 8; c++) {
            const tile = document.createElement('div');
            tile.className = 'mine-tile-block';
            if (r === 0) tile.classList.add('tile-grass');
            else if (r < 4) tile.classList.add('tile-stone');
            else tile.classList.add('tile-ore');
            grid.appendChild(tile);
        }
    }
}

async function startPickaxeGame() {
    if (isPickaxeRunning) return;
    if (!lockEconomy()) return;

    const betInput = document.getElementById('pickaxeBetInput');
    const bet = roundMoney(parseFloat(betInput.value));

    if (!bet || isNaN(bet) || bet < 0.10) {
        showMessage("Минимальная ставка — 0.10 $!");
        unlockEconomy();
        return;
    }
    if (bet > currentBalance) {
        showMessage("Недостаточно средств!");
        unlockEconomy();
        return;
    }

    isPickaxeRunning = true;
    const btn = document.getElementById('pickaxeActionBtn');
    btn.disabled = true;

    // Списание баланса
    const snapshot = snapshotBalanceState();
    currentBalance = roundMoney(currentBalance - bet);
    currentTurnover = roundMoney(currentTurnover + bet);
    currentBetsCount++;
    setUIBalance(currentBalance);

    const debited = await saveUserData();
    if (!debited) {
        restoreBalanceState(snapshot);
        showMessage("Ошибка сети при списании ставки.");
        isPickaxeRunning = false;
        btn.disabled = false;
        unlockEconomy();
        return;
    }

    // 1. Рулетка выбора кирки
    const selectedPickaxe = getRandomPickaxe();
    const display = document.getElementById('pickaxeDisplay');
    const nameLabel = document.getElementById('pickaxeName');
    
    let spinCount = 0;
    const rouletteInterval = setInterval(() => {
        const temp = PICKAXES[Math.floor(Math.random() * PICKAXES.length)];
        display.textContent = temp.emoji;
        nameLabel.textContent = `${temp.name} (${temp.hp} HP)`;
        spinCount++;
        if (spinCount > 15) {
            clearInterval(rouletteInterval);
            display.textContent = selectedPickaxe.emoji;
            nameLabel.textContent = `${selectedPickaxe.name} (${selectedPickaxe.hp} HP)`;
            animatePickaxeDrop(selectedPickaxe, bet);
        }
    }, 100);
}

function animatePickaxeDrop(pickaxe, bet) {
    let currentHp = pickaxe.hp;
    const fallingPickaxe = document.getElementById('fallingPickaxe');
    fallingPickaxe.textContent = pickaxe.emoji;
    fallingPickaxe.classList.remove('hidden');

    let row = 0;
    let col = Math.floor(Math.random() * 8);

    const dropInterval = setInterval(async () => {
        if (currentHp <= 0 || row >= 12) {
            clearInterval(dropInterval);
            fallingPickaxe.classList.add('hidden');
            
            // Расчет выигрыша на основе глубинного множителя и прочности
            const depthMult = 1 + (row * 0.25);
            const winAmount = roundMoney(bet * depthMult);

            currentBalance = roundMoney(currentBalance + winAmount);
            currentTotalWin = roundMoney(currentTotalWin + winAmount);
            currentWinsCount++;
            setUIBalance(currentBalance);

            await saveUserDataWithRetry();
            showMessage(`Кирка сломалась! Выигрыш: +${winAmount.toFixed(2)}$ (${depthMult.toFixed(2)}x)`);

            isPickaxeRunning = false;
            document.getElementById('pickaxeActionBtn').disabled = false;
            unlockEconomy();
            return;
        }

        // Логика шага: -1 HP за блок
        currentHp--;
        document.getElementById('pickaxeName').textContent = `${pickaxe.name} (${currentHp}/${pickaxe.hp} HP)`;

        // Смещение вниз и случайно влево/вправо
        row++;
        col += Math.random() > 0.5 ? 1 : -1;
        col = Math.max(0, Math.min(7, col));

        // Визуальное позиционирование
        fallingPickaxe.style.top = `${row * 32}px`;
        fallingPickaxe.style.left = `${col * 12.5}%`;
        
        if (tg?.HapticFeedback) tg.HapticFeedback.impactOccurred("light");
    }, 40);
}

/* =========================
   БАЛАНС И UI
========================= */

function setUIBalance(newBalance) {
    currentBalance = parseFloat(newBalance) || 0.00;
    const formatted = currentBalance.toFixed(2) + " $";
    const turnoverValue = "$" + currentTurnover.toFixed(2);
    const maxMultValue = "x" + currentMaxWin.toFixed(2);
    const totalWinValue = "$" + currentTotalWin.toFixed(2);
    const betsCountValue = String(currentBetsCount);

    const elementsMap = {
        "topBalance": formatted,
        "balanceCardValue": formatted,
        "profileBalance": formatted,
        "statTurnover": turnoverValue,
        "statMaxMult": maxMultValue,
        "statTotalWin": totalWinValue,
        "statBetsCount": betsCountValue,
        "betBalanceText": `Баланс: ${formatted}`
    };

    Object.keys(elementsMap).forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = elementsMap[id];
    });

    document.querySelectorAll('.balance-val, .profile-balance-val').forEach(el => {
        el.textContent = formatted;
    });

    updateLevelUI();
    updateTotalBet();
}

/* =========================
   НАВИГАЦИЯ
========================= */

function hideAllPages() {
    const pages = ["homePage", "wheelPage", "balancePage", "profilePage", "bonusPage", "minesPage", "crashPage"];
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
    drawWheel();
    renderColorTabs();
    selectColorTab(activeColor);
}

function openMines() {
    showPage("minesPage");
    updateNav("games");
    initMinesGrid();
}

function openBalance(mode = "deposit") {
    showPage("balancePage");
    setBalanceMode(mode);
    updateNav("balance");
    renderTransactions();
}

function openProfile() {
    showPage("profilePage");
    updateNav("profile");
    applyDesign();
    renderCustomizerControls();
    updateLevelUI();
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
    if (!lockEconomy()) return;

    const button = document.getElementById('spinButton');
    if (!button) { unlockEconomy(); return; }

    isBetProcessing = true;
    button.disabled = true;

    const currentInput = document.getElementById('activeBetInput');
    if (currentInput && currentInput.value !== '') {
        onActiveColorInput(currentInput.value);
    }

    let totalBet = 0;
    Object.keys(colorBets).forEach(key => {
        colorBets[key] = roundMoney(parseFloat(colorBets[key]) || 0);
        totalBet += colorBets[key];
    });
    totalBet = roundMoney(totalBet);

    if (totalBet < 0.10) {
        showMessage("Минимальная общая ставка — 0.10 $!");
        button.disabled = false;
        isBetProcessing = false;
        unlockEconomy();
        return;
    }

    if (totalBet > currentBalance) {
        showMessage("Недостаточно средств на балансе!");
        button.disabled = false;
        isBetProcessing = false;
        unlockEconomy();
        return;
    }

    const betsAtSpinTime = { ...colorBets };
    const snapshot = snapshotBalanceState();

    currentBalance = roundMoney(currentBalance - totalBet);
    currentTurnover = roundMoney(currentTurnover + totalBet);
    currentBetsCount++;
    setUIBalance(currentBalance);

    const debited = await saveUserData();
    if (!debited) {
        restoreBalanceState(snapshot);
        showMessage("Не удалось списать ставку. Проверьте соединение и попробуйте снова.");
        button.disabled = false;
        isBetProcessing = false;
        unlockEconomy();
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

        const betOnWonColor = parseFloat(betsAtSpinTime[sectorType]) || 0;
        const multiplier = parseFloat(wonSector.mult) || 0;

        let totalWin = 0;

        if (betOnWonColor > 0 && multiplier > 0) {
            totalWin = roundMoney(betOnWonColor * multiplier);
            const winSnapshot = snapshotBalanceState();

            currentBalance = roundMoney(currentBalance + totalWin);
            currentTotalWin = roundMoney(currentTotalWin + totalWin);
            currentWinsCount++;
            if (multiplier > currentMaxWin) currentMaxWin = multiplier;
            setUIBalance(currentBalance);

            const credited = await saveUserDataWithRetry();
            if (!credited) {
                restoreBalanceState(winSnapshot);
                totalWin = 0;
                showMessage("Ошибка сети: выигрыш не был зачислен. Обратитесь в поддержку и укажите время спина.");
            }
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
        unlockEconomy();

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

// ==========================================
// ПОПОЛНЕНИЕ ЧЕРЕЗ CRYPTOBOT (реальная оплата)
// ==========================================
async function demoBalanceAction() {
    if (!lockEconomy()) return;

    const input = document.getElementById("amountInput");
    if (!input) { unlockEconomy(); return; }

    const amount = roundMoney(parseFloat(input.value));

    if (!amount || isNaN(amount) || amount <= 0) {
        showMessage("Введите сумму");
        unlockEconomy();
        return;
    }

    const tgUser = tg?.initDataUnsafe?.user;
    if (!tgUser) {
        showMessage("Откройте приложение через Telegram, чтобы пополнить баланс.");
        unlockEconomy();
        return;
    }

    if (balanceMode === "deposit") {
        if (selectedMethod !== "CryptoBot") {
            showMessage("Сейчас доступна оплата только через CryptoBot. Выберите этот способ.");
            unlockEconomy();
            return;
        }

        const actionBtn = document.getElementById("balanceAction");
        if (actionBtn) actionBtn.disabled = true;

        try {
            const res = await fetch(`${API_BASE}/api/create-invoice`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    amount: amount,
                    telegram_id: tgUser.id
                })
            });

            if (!res.ok) {
                throw new Error(`Backend responded with ${res.status}`);
            }

            const payload = await res.json();
            const payUrl = payload?.pay_url;

            if (!payUrl) {
                throw new Error('pay_url missing in response');
            }

            if (tg?.openTelegramLink) {
                tg.openTelegramLink(payUrl);
            } else {
                window.open(payUrl, '_blank');
            }

            transactions.unshift({
                type: 'deposit',
                method: selectedMethod,
                icon: selectedMethodIcon,
                amount: amount,
                date: 'Только что',
                status: 'pending'
            });
            renderTransactions();

            showMessage("Счёт создан. Завершите оплату в открывшемся окне CryptoBot — баланс зачислится автоматически после подтверждения платежа.");
        } catch (e) {
            console.error('Ошибка создания инвойса CryptoBot:', e);
            showMessage("Не удалось создать счёт на оплату. Проверьте соединение и попробуйте снова.");
        } finally {
            if (actionBtn) actionBtn.disabled = false;
            unlockEconomy();
        }
        return;
    }

    if (amount > currentBalance) {
        showMessage("Недостаточно средств");
        unlockEconomy();
        return;
    }

    const snapshot = snapshotBalanceState();

    currentBalance = roundMoney(currentBalance - amount);
    currentWithdrawals = roundMoney(currentWithdrawals + amount);
    setUIBalance(currentBalance);

    const ok = await saveUserData();
    if (!ok) {
        restoreBalanceState(snapshot);
        showMessage("Не удалось создать заявку на вывод. Попробуйте снова.");
        unlockEconomy();
        return;
    }

    transactions.unshift({
        type: 'withdraw',
        method: selectedMethod,
        icon: selectedMethodIcon,
        amount: amount,
        date: 'Только что',
        status: 'pending'
    });
    renderTransactions();

    showMessage(`Заявка на вывод ${amount.toFixed(2)} $ через ${selectedMethod} принята`);
    unlockEconomy();
}

function claimBonus() {
    showMessage("Ежедневный бонус временно недоступен");
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
   ЗАПУСК ПРИ СТАРТЕ
========================= */

document.addEventListener("DOMContentLoaded", async () => {
    console.log("🚀 Mini App запущен!");

    if (window.Telegram?.WebApp) {
        window.Telegram.WebApp.ready();
        window.Telegram.WebApp.expand();
    }

    await loadUserData();
    updateLevelUI();
    goHome();
    applyDesign();
    startCrashEngine();

    document.addEventListener('gesturestart', (e) => e.preventDefault());

    let lastTouchEnd = 0;
    document.addEventListener('touchend', (e) => {
        const now = Date.now();
        if (now - lastTouchEnd <= 300) {
            e.preventDefault();
        }
        lastTouchEnd = now;
    }, { passive: false });

    document.addEventListener('touchmove', (e) => {
        if (e.touches.length > 1) {
            e.preventDefault();
        }
    }, { passive: false });
});

// Экспорт функций в глобальную область для onclick-обработчиков в HTML
window.adjustMinesBet = adjustMinesBet;
window.applyMinToActive = applyMinToActive;
window.applyPercentToActive = applyPercentToActive;
window.adjustCrashBet = adjustCrashBet;
window.autoPickMinesTile = autoPickMinesTile;
window.changeMinesBy = changeMinesBy;
window.claimBonus = claimBonus;
window.demoBalanceAction = demoBalanceAction;
window.goHome = goHome;
window.handleCrashAction = handleCrashAction;
window.handleMinesAction = handleMinesAction;
window.onActiveColorInput = onActiveColorInput;
window.onCustomMinesInputChange = onCustomMinesInputChange;
window.openBalance = openBalance;
window.openBonus = openBonus;
window.openCrash = openCrash;
window.openGamesMenu = openGamesMenu;
window.openMines = openMines;
window.openProfile = openProfile;
window.openWheel = openWheel;
window.resetActiveBet = resetActiveBet;
window.saveProfileCustomization = saveProfileCustomization;
window.selectMethod = selectMethod;
window.selectMinesCount = selectMinesCount;
window.setBalanceMode = setBalanceMode;
window.setCrashMaxBet = setCrashMaxBet;
window.setMinesMaxBet = setMinesMaxBet;
window.showMessage = showMessage;
window.spinWheel = spinWheel;
window.toggleMethods = toggleMethods;
window.toggleProfileCustomizer = toggleProfileCustomizer;
window.clickMinesTile = clickMinesTile;
window.selectColorTab = selectColorTab;
window.selectGradient = selectGradient;
window.openPickaxe = openPickaxe;
window.startPickaxeGame = startPickaxeGame;

})();
