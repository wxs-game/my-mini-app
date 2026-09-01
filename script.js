(function () {
// WXS Ice Arena GLOBAL LOBBY — script.js
// Пакет: WXS_IceArena_GLOBAL
// Все игроки мира — в одном раунде (Supabase ice_arena_rounds / ice_arena_bets).
// ==========================================
// 1. ИНИЦИАЛИЗАЦИЯ TELEGRAM И SUPABASE
// ==========================================
const tg = window.Telegram?.WebApp;
    
// (экран "Доступ только через Telegram"), который не зависит от этого файла.
const isRealTelegramLaunch = !!(tg && typeof tg.initData === 'string' && tg.initData.length > 0);
if (!isRealTelegramLaunch) {
    console.warn('Приложение открыто не из Telegram — инициализация остановлена.');
    return;
}

tg.ready();
tg.expand();

const SUPABASE_URL = 'https://nkovsjhwinbbapsqvpnu.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_GVUZWdR9qVSHwL7aL63W8w_g7rtfJkN';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
    { level: 2, points: 2500,  title: "Гой" },
    { level: 3, points: 7500,  title: "Бурмалда" },
    { level: 4, points: 15000,  title: "Додеп" },
    { level: 5, points: 22500, title: "Лудик" },
    { level: 6, points: 30000, title: "Пепе" },
    { level: 7, points: 30001, title: "Легенда" }
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
// ЛОГИКА PROVABLY FAIR (SHA-256) ДЛЯ ИГРЫ CRASH
// ==========================================

// 1. Генерация SHA-256 хеша (Web Crypto API)
async function generateSHA256(message) {
    const msgUint8 = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// 2. Случайная генерация соли (Secret Key)
function generateRandomSeed(length = 32) {
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    const randomValues = new Uint8Array(length);
    crypto.getRandomValues(randomValues);
    for (let i = 0; i < length; i++) {
        result += charset[randomValues[i] % charset.length];
    }
    return result;
}

// 3. Расчет коэффициента на базе соли и хеша
function calculateCrashPoint(seed, salt) {
    let hash = seed + salt;
    let hex = hash.substring(0, 8);
    let intVal = parseInt(hex, 16);

    // 3% преимущество заведения (House Edge)
    if (intVal % 33 === 0) return 1.00;

    let crash = Math.max(1.00, parseFloat((1 / (1 - (intVal / 4294967296))).toFixed(2)));
    return Math.min(crash, 1000.00);
}

// Переменные состояния раунда
let currentCrashState = {
    salt: '',
    hash: '',
    crashPoint: 1.00,
    isFinished: false
};

// Вызывать ПЕРЕД началом раунда (возвращает коэффициент для анимации).
async function prepareNextCrashRound() {
    const salt = generateRandomSeed(32);
    const hash = await generateSHA256(salt);
    const crashPoint = calculateCrashPoint(hash, salt);

    currentCrashState = {
        salt: salt,
        hash: hash,
        crashPoint: crashPoint,
        isFinished: false
    };

    const hashInput = document.getElementById('crashRoundHashInput');
    if (hashInput) hashInput.value = hash;

    // Новый раунд — новый секрет. Ключ прошлого (уже завершённого) раунда
    // обязательно прячем здесь же, иначе он остаётся видимым в поле все
    // время ожидания и полёта СЛЕДУЮЩЕГО раунда, создавая впечатление,
    // будто текущий раунд уже "раскрыт" до его завершения.
    hideCrashRoundKey();

    return crashPoint;
}

// Вызывать ПОСЛЕ завершения раунда (когда произошел краш)
function revealCrashRoundKey() {
    currentCrashState.isFinished = true;

    const keyInput = document.getElementById('crashRoundKeyInput');
    if (keyInput) keyInput.value = currentCrashState.salt;
}

// Вызывать при выходе со страницы краша — прячет раскрытый ключ обратно,
// чтобы при следующем заходе он снова появился только после нового краша.
function hideCrashRoundKey() {
    const keyInput = document.getElementById('crashRoundKeyInput');
    if (keyInput) keyInput.value = '';
}

// Добавление коэффициента в ленту истории
function addCrashHistoryItem(coef) {
    const historyContainer = document.querySelector('.crash-history-scroll');
    if (!historyContainer) return;

    const span = document.createElement('span');
    span.className = 'crash-history-badge';
    span.textContent = coef.toFixed(2) + 'x';

    if (coef >= 2.0) {
        span.style.color = '#2ecc71';
    } else if (coef < 1.5) {
        span.style.color = '#e74c3c';
    } else {
        span.style.color = '#ffd700';
    }

    span.style.padding = '4px 8px';
    span.style.background = 'rgba(255,255,255,0.05)';
    span.style.borderRadius = '8px';
    span.style.fontSize = '12px';
    span.style.fontWeight = '800';
    span.style.cursor = 'pointer';

    span.onclick = () => {
        if (typeof showMessage === 'function') {
            showMessage(`Коэффициент раунда: ${coef.toFixed(2)}x`);
        }
    };

    historyContainer.insertBefore(span, historyContainer.firstChild);
}

// ==========================================
// ОБРАБОТЧИКИ СОБЫТИЙ ОКНА И КОПИРОВАНИЯ
// ==========================================
function openCrashFairnessModal() {
    document.getElementById('crashFairnessModal')?.classList.remove('hidden');
    document.body.classList.add('fairness-modal-open');
}

function closeCrashFairnessModal() {
    document.getElementById('crashFairnessModal')?.classList.add('hidden');
    document.body.classList.remove('fairness-modal-open');

    const content = document.getElementById('crashFairnessContent');
    if (content) {
        content.classList.remove('dragging');
        content.style.transform = '';
    }
}

// ==========================================
// ПЕРЕТЯГИВАНИЕ ВНИЗ ДЛЯ ЗАКРЫТИЯ ДОК ЧЕСТНОСТИ
// ==========================================
(function initCrashFairnessDrag() {
    const handle = document.getElementById('crashFairnessDragHandle');
    const content = document.getElementById('crashFairnessContent');
    if (!handle || !content) return;

    const CLOSE_THRESHOLD = 80; // px, после которых плашка закрывается при отпускании
    let startY = 0;
    let currentY = 0;
    let dragging = false;
    let moved = false;

    function onPointerDown(e) {
        dragging = true;
        moved = false;
        content.classList.add('dragging');
        startY = (e.touches ? e.touches[0].clientY : e.clientY);
        currentY = 0;
        document.addEventListener('touchmove', onPointerMove, { passive: false });
        document.addEventListener('touchend', onPointerUp);
        document.addEventListener('mousemove', onPointerMove);
        document.addEventListener('mouseup', onPointerUp);
    }

    function onPointerMove(e) {
        if (!dragging) return;
        const y = (e.touches ? e.touches[0].clientY : e.clientY);
        const delta = y - startY;
        currentY = Math.max(0, delta); // тянуть можно только вниз
        if (currentY > 4) moved = true;
        content.style.transform = `translateY(${currentY}px)`;
        if (e.cancelable) e.preventDefault();
    }

    function onPointerUp() {
        if (!dragging) return;
        dragging = false;
        content.classList.remove('dragging');
        document.removeEventListener('touchmove', onPointerMove);
        document.removeEventListener('touchend', onPointerUp);
        document.removeEventListener('mousemove', onPointerMove);
        document.removeEventListener('mouseup', onPointerUp);

        if (currentY > CLOSE_THRESHOLD) {
            closeCrashFairnessModal();
        } else {
            content.style.transform = '';
        }
        currentY = 0;
    }

    handle.addEventListener('touchstart', onPointerDown, { passive: true });
    handle.addEventListener('mousedown', onPointerDown);

    // Просто тап по полоске-хэндлу без перетягивания — закрывает меню
    handle.addEventListener('click', () => {
        if (!moved) {
            closeCrashFairnessModal();
        }
    });
})();

function copyCrashHash() {
    const val = document.getElementById('crashRoundHashInput')?.value;
    if (val) {
        navigator.clipboard.writeText(val);
        if (typeof showMessage === 'function') showMessage('Хеш скопирован в буфер обмена');
    }
}

function copyCrashKey() {
    const val = document.getElementById('crashRoundKeyInput')?.value;
    if (val) {
        navigator.clipboard.writeText(val);
        if (typeof showMessage === 'function') showMessage('Ключ скопирован в буфер обмена');
    }
}

window.openCrashFairnessModal = openCrashFairnessModal;
window.closeCrashFairnessModal = closeCrashFairnessModal;
window.copyCrashHash = copyCrashHash;
window.copyCrashKey = copyCrashKey;

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
        // Создание нового игрока (и обновление ника/аватара для существующего)
        // теперь идёт через защищённую RPC-функцию ensure_player: стартовый
        // баланс 100.00 $ задаётся на сервере, а не тем, что пришлёт клиент —
        // прямой INSERT/UPDATE в wxs_game с браузера запрещён на уровне БД.
        const { data: newUser, error: createError } = await supabase.rpc('ensure_player', {
            p_telegram_id: profileData.telegram_id,
            p_username: profileData.username,
            p_nickname: profileData.nickname,
            p_photo_url: profileData.photo_url
        });

        if (createError) {
            console.error('Ошибка создания записи в Supabase:', createError);
            showMessage("Не удалось создать профиль. Проверьте соединение и перезапустите приложение.");
            return;
        }
        data = newUser;
    } else {
        const { data: updatedUser, error: updateError } = await supabase.rpc('ensure_player', {
            p_telegram_id: profileData.telegram_id,
            p_username: profileData.username,
            p_nickname: profileData.nickname,
            p_photo_url: profileData.photo_url
        });
        if (!updateError && updatedUser) data = updatedUser;
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
   БЕГУЩАЯ СТРОКА СО СТАВКАМИ ИГРОКОВ (LIVE WINS)
   Ставки хранятся в таблице public.live_bets в Supabase — поэтому лента
   переживает перезаход в приложение (последние 10 ставок подгружаются
   при старте) и видна ВСЕМ игрокам: новые строки/обновления в таблице
   ловятся через Supabase Realtime (postgres_changes на INSERT и UPDATE),
   так что у каждого открытого приложения лента обновляется вживую,
   включая чужие ставки и их выигрыши.

   Когда игрок делает ставку — сразу пишется строка с суммой ставки.
   Если позже он выигрывает с множителем от 1.3x — та же строка
   обновляется (UPDATE) и в ленте вместо "просто ставки" появляется
   "ставка → выигрыш". Проигрыши и выигрыши меньше 1.3x строку не меняют.

   Требуется один раз выполнить в Supabase (SQL Editor):

   create table if not exists public.live_bets (
       id bigint generated always as identity primary key,
       telegram_id bigint,
       name text not null,
       amount numeric not null,
       game text not null,
       win_amount numeric,
       multiplier numeric,
       created_at timestamptz not null default now()
   );
   alter table public.live_bets enable row level security;
   create policy "live_bets_select_all" on public.live_bets for select using (true);
   create policy "live_bets_insert_all" on public.live_bets for insert with check (true);
   create policy "live_bets_update_all" on public.live_bets for update using (true) with check (true);
   alter publication supabase_realtime add table public.live_bets;

   (И включить Realtime для таблицы live_bets в Database → Replication,
   если ALTER PUBLICATION выше почему-то не сработает автоматически.)
========================= */
const LIVE_BETS_TABLE = 'live_bets';
const LIVE_BETS_MAX = 10;
const ICE_ARENA_LIVE_GAME = 'Айс Арена';
// От какого множителя выигрыш вообще показываем в ленте как "ставка → выигрыш"
const LIVE_BET_WIN_THRESHOLD = 1.3;
// Минимум записей в одном "круге" ленты — если реальных ставок мало,
// контент дублируется до этого числа, чтобы бегущая строка не обрывалась
// пустым просветом посреди экрана при зацикливании анимации.
const LIVE_BETS_MIN_LOOP_ITEMS = 8;
let liveBetsQueue = [];

// DOM-элементы уже отрисованных карточек в свайпаемой ленте, по id ставки.
// Благодаря этой карте renderLiveBetsTicker не пересоздаёт всю ленту с нуля
// при каждом обновлении, а точечно добавляет/убирает карточки — это и
// позволяет анимировать только новые карточки и не сбрасывать скролл.
let liveWinCardEls = new Map();
let lastPinnedLiveWinId = null;

// Задержка между появлением карточек при самой первой отрисовке ленты
// (когда пользователь только что открыл/вернулся в приложение) — чтобы
// карточки "подтягивались" одна за другой, а не выскакивали все разом.
const LIVE_WINS_STAGGER_MS = 90;

// Инжектим CSS анимации один раз — плавное появление новой карточки
// (fade + лёгкий сдвиг вверх) вместо мгновенной подмены содержимого.
// animation-fill-mode: backwards держит карточку в "исходном" (невидимом)
// состоянии на всё время animation-delay, иначе при пакетном появлении
// (see LIVE_WINS_STAGGER_MS) все карточки на миг мелькнули бы полностью
// видимыми ещё до начала своей анимации.
(function injectLiveWinsAnimationStyles() {
    if (document.getElementById('liveWinsAnimStyles')) return;
    const style = document.createElement('style');
    style.id = 'liveWinsAnimStyles';
    style.textContent =
        '.live-win-card--enter{animation:liveWinCardIn 420ms cubic-bezier(.22,1,.36,1) backwards;}' +
        '@keyframes liveWinCardIn{' +
        'from{opacity:0;transform:translateY(-10px) scale(.96);}' +
        'to{opacity:1;transform:translateY(0) scale(1);}' +
        '}';
    document.head.appendChild(style);
})();

async function initLiveBetsFeed() {
    const pinned = document.getElementById('liveWinPinned');
    const scroll = document.getElementById('liveWinsScroll');
    if (!pinned || !scroll || !window.supabase) return;

    await loadLiveBetsHistory();

    try {
        supabase
            .channel('live_bets_changes')
            .on('postgres_changes',
                { event: 'INSERT', schema: 'public', table: LIVE_BETS_TABLE },
                (payload) => {
                    if (payload?.new) addLiveBetToTicker(payload.new);
                }
            )
            .on('postgres_changes',
                { event: 'UPDATE', schema: 'public', table: LIVE_BETS_TABLE },
                (payload) => {
                    if (payload?.new) updateLiveBetInTicker(payload.new);
                }
            )
            .subscribe();
    } catch (e) {
        console.error('Не удалось подписаться на реалтайм live_bets:', e);
    }
}

// Подгружает последние 10 ставок (своих и чужих) из БД при открытии приложения
async function loadLiveBetsHistory() {
    try {
        const { data, error } = await supabase
            .from(LIVE_BETS_TABLE)
            .select('id, name, amount, game, win_amount, multiplier, created_at')
            .order('created_at', { ascending: false })
            .limit(LIVE_BETS_MAX);

        if (error) {
            console.error('Ошибка загрузки истории live_bets:', error);
            renderLiveBetsTicker();
            return;
        }

        liveBetsQueue = (data || []).slice().reverse();
        renderLiveBetsTicker();
    } catch (e) {
        console.error('Ошибка загрузки истории live_bets:', e);
        renderLiveBetsTicker();
    }
}

// Вызывается сразу после успешного списания ставки в каждой игре
// (Мины, Кирка, Краш, Колесо) — сохраняет ставку в Supabase, откуда её
// через Realtime увидят все игроки (включая нас самих). Возвращает id
// созданной строки — он нужен, чтобы потом дописать в неё выигрыш.
async function broadcastLiveBet(amount, gameLabel) {
    const tgUser = tg?.initDataUnsafe?.user;
    const nameFromUI = document.getElementById('username')?.textContent?.trim();
    const row = {
        telegram_id: tgUser?.id || null,
        name: nameFromUI || 'Игрок',
        amount: roundMoney(amount),
        game: gameLabel
    };

    try {
        const { data, error } = await supabase.from(LIVE_BETS_TABLE).insert(row).select('id').single();
        if (error) {
            console.error('Не удалось сохранить ставку в live_bets:', error);
            return null;
        }
        return data?.id ?? null;
    } catch (e) {
        console.error('Не удалось сохранить ставку в live_bets:', e);
        return null;
    }
    // Realtime-подписка добавит эту запись в ленту сама (и себе, и всем
    // остальным) — локально ничего не дублируем.
}

// Вызывается при выигрыше (Мины/Краш — на "Забрать", Кирка — когда сломалась,
// Колесо — по итогу спина). Если множитель выигрыша меньше LIVE_BET_WIN_THRESHOLD
// или ставка не была сохранена (liveBetId нет) — запись в ленте не трогаем.
async function resolveLiveBetWin(liveBetId, betAmount, winAmount, opts) {
    if (!liveBetId || !betAmount || betAmount <= 0 || !winAmount) return;

    const multiplier = winAmount / betAmount;
    if (!opts?.force && multiplier < LIVE_BET_WIN_THRESHOLD) return;

    const winPatch = { win_amount: roundMoney(winAmount), multiplier: roundMoney(multiplier) };


    // Показываем стрелку "ставка → выигрыш" у автора ставки сразу же, не
    // дожидаясь ответа сервера — так это гарантированно видно на своём
    // экране, даже если запись в БД по какой-то причине задержится.
    patchLiveBetLocally(liveBetId, winPatch);

    try {
        const { error } = await supabase
            .from(LIVE_BETS_TABLE)
            .update(winPatch)
            .eq('id', liveBetId);
        if (error) console.error('Не удалось обновить выигрыш в live_bets:', error);
    } catch (e) {
        console.error('Не удалось обновить выигрыш в live_bets:', e);
    }
    // Остальным игрокам обновление принесёт Realtime-подписка (UPDATE) —
    // при условии, что запись успешно сохранилась в БД.
}

// Точечно обновляет уже показанную запись в ленте по id, не трогая остальные
function patchLiveBetLocally(id, patch) {
    const idx = liveBetsQueue.findIndex(b => String(b.id) === String(id));
    if (idx === -1) return;
    liveBetsQueue[idx] = { ...liveBetsQueue[idx], ...patch };
    renderLiveBetsTicker();
}

function addLiveBetToTicker(bet) {
    liveBetsQueue.push(bet);
    if (liveBetsQueue.length > LIVE_BETS_MAX) {
        liveBetsQueue.splice(0, liveBetsQueue.length - LIVE_BETS_MAX);
    }
    renderLiveBetsTicker();
}

function updateLiveBetInTicker(updatedBet) {
    // Supabase иногда отдаёт bigint id как строку в Realtime-payload (в
    // отличие от обычного select через REST) — сравниваем как строки,
    // чтобы обновление всегда находило нужную запись независимо от типа.
    const idx = liveBetsQueue.findIndex(b => String(b.id) === String(updatedBet.id));
    if (idx === -1) return; // запись уже выпала из последних 10 — не показываем задним числом
    liveBetsQueue[idx] = updatedBet;
    renderLiveBetsTicker();
}

function isIceArenaLiveBet(bet) {
    return (bet?.game || '') === ICE_ARENA_LIVE_GAME;
}

function isLiveTickerWin(bet) {
    const mult = Number(bet.multiplier) || 0;
    if (bet.win_amount == null) return false;
    if (isIceArenaLiveBet(bet)) return true;
    return mult >= LIVE_BET_WIN_THRESHOLD;
}

function isLiveTickerItem(bet) {
    return isLiveTickerWin(bet) || isIceArenaLiveBet(bet);
}

function liveBetCardFingerprint(bet) {
    return [bet.amount, bet.win_amount, bet.multiplier, bet.game].join('|');
}

function liveWinCardMetaHtml(bet) {
    const game = escapeHtml(bet.game || 'Игра');
    if (isLiveTickerWin(bet)) {
        return game + ' • ' +
            '<span class="live-wins-amount">' + Number(bet.amount).toFixed(2) + ' $</span>' +
            '<span class="live-wins-arrow">→</span>' +
            '<span class="live-wins-amount live-wins-win">' + Number(bet.win_amount).toFixed(2) + ' $</span>' +
            '<img class="live-wins-item-icon" src="images/tether.png" alt="USDT" draggable="false">';
    }
    return game + ' • ' +
        '<span class="live-wins-amount">' + Number(bet.amount).toFixed(2) + ' $</span>' +
        '<img class="live-wins-item-icon" src="images/tether.png" alt="USDT" draggable="false">';
}

function renderLiveBetsTicker() {
    const pinned = document.getElementById('liveWinPinned');
    const scroll = document.getElementById('liveWinsScroll');
    if (!pinned || !scroll) return;

    // В этой секции (в отличие от старой бегущей строки) показываем не
    // все подряд ставки, а только те, что доросли до выигрыша от
    // LIVE_BET_WIN_THRESHOLD — именно так подписан пустой стейт
    // ("Пока нет крупных выигрышей").
    const tickerItems = liveBetsQueue.filter(isLiveTickerItem);
    const bigWins = liveBetsQueue.filter(isLiveTickerWin);

    // --- Закреплённая карточка "Выигрыш дня" — крупнейший из загруженных ---
    if (bigWins.length === 0) {
        pinned.innerHTML =
            '<span class="live-win-pinned-label">🏆 Выигрыш дня</span>' +
            '<span class="live-wins-empty-pinned">Пока нет</span>';
        lastPinnedLiveWinId = null;
    } else {
        const topWin = bigWins.reduce(
            (best, b) => (Number(b.win_amount) > Number(best.win_amount) ? b : best),
            bigWins[0]
        );
        const isNewPin = String(topWin.id) !== String(lastPinnedLiveWinId);
        lastPinnedLiveWinId = topWin.id;

        pinned.innerHTML =
            '<span class="live-win-pinned-label">🏆 Выигрыш дня</span>' +
            '<span class="live-wins-name" title="' + escapeHtml(topWin.name) + '">' + escapeHtml(topWin.name) + '</span>' +
            '<span class="live-wins-meta">' +
                escapeHtml(topWin.game || 'Игра') + ' • ' +
                '<span class="live-wins-amount live-wins-win">' + Number(topWin.win_amount).toFixed(2) + ' $</span>' +
                '<img class="live-wins-item-icon" src="images/tether.png" alt="USDT" draggable="false">' +
            '</span>';

        // Перезапускаем анимацию появления только когда реально сменился
        // лидер (иначе при каждом ре-рендере пиновая карточка бы моргала).
        if (isNewPin) {
            pinned.classList.remove('live-win-card--enter');
            void pinned.offsetWidth; // форсируем reflow, чтобы анимация точно перезапустилась
            pinned.classList.add('live-win-card--enter');
        }
    }

    // --- Свайпаемый список последних крупных выигрышей ---
    // Самые новые выигрыши — в начало списка.
    const ordered = bigWins.slice().reverse();
    renderLiveWinsScrollList(scroll, ordered);
}

// Создаёт DOM-карточку одного выигрыша в свайпаемой ленте.
function createLiveWinCardEl(bet, animateEnter) {
    const el = document.createElement('div');
    el.className = 'live-win-card' + (animateEnter ? ' live-win-card--enter' : '');
    el.innerHTML =
        '<span class="live-wins-name" title="' + escapeHtml(bet.name) + '">' + escapeHtml(bet.name) + '</span>' +
        '<span class="live-wins-meta">' +
            escapeHtml(bet.game || 'Игра') + ' • ' +
            '<span class="live-wins-amount">' + Number(bet.amount).toFixed(2) + ' $</span>' +
            '<span class="live-wins-arrow">→</span>' +
            '<span class="live-wins-amount live-wins-win">' + Number(bet.win_amount).toFixed(2) + ' $</span>' +
            '<img class="live-wins-item-icon" src="images/tether.png" alt="USDT" draggable="false">' +
        '</span>';
    return el;
}

// Точечно обновляет свайпаемую ленту выигрышей вместо полной пересборки
// innerHTML — так лента не "телепортирует" пользователя к началу, если он
// в этот момент пролистал её куда-то ещё (например, смотрит самую старую,
// десятую, карточку). Новая карточка вставляется на своё место с анимацией
// появления, устаревшая — просто убирается из DOM, а позиция скролла
// компенсируется на ширину добавленного, чтобы видимое содержимое не
// прыгало у пользователя перед глазами.
function renderLiveWinsScrollList(scroll, ordered) {
    if (ordered.length === 0) {
        scroll.innerHTML = '<span class="live-wins-empty">Пока нет крупных выигрышей</span>';
        liveWinCardEls.clear();
        return;
    }

    // Первая отрисовка (например, пользователь только что открыл или
    // вернулся в приложение) — рисуем карточки с анимацией появления
    // по очереди, с нарастающей задержкой, а не все разом.
    if (liveWinCardEls.size === 0 || scroll.querySelector('.live-wins-empty')) {
        scroll.innerHTML = '';
        ordered.forEach((bet, idx) => {
            const el = createLiveWinCardEl(bet, true);
            el.style.animationDelay = (idx * LIVE_WINS_STAGGER_MS) + 'ms';
            liveWinCardEls.set(String(bet.id), el);
            scroll.appendChild(el);
        });
        return;
    }

    const desiredIds = ordered.map((bet) => String(bet.id));

    // 1) Убираем карточки, которых больше нет в списке (выпали из очереди
    //    последних ставок). Если пользователь как раз смотрел именно эту
    //    карточку в самом конце ленты — браузер сам аккуратно подожмёт
    //    scrollLeft до нового максимума, и она просто "уедет" за край.
    Array.from(liveWinCardEls.keys()).forEach((id) => {
        if (!desiredIds.includes(id)) {
            const el = liveWinCardEls.get(id);
            if (el && el.parentNode) el.parentNode.removeChild(el);
            liveWinCardEls.delete(id);
        }
    });

    // 2) Запоминаем позицию и ширину ленты ДО вставки новых карточек.
    const scrollLeftBefore = scroll.scrollLeft;
    const scrollWidthBefore = scroll.scrollWidth;

    // 3) Расставляем карточки в нужном порядке: существующие — переставляем
    //    без анимации, новые — создаём с анимацией появления.
    let prevEl = null;
    ordered.forEach((bet) => {
        const id = String(bet.id);
        const refNode = prevEl ? prevEl.nextSibling : scroll.firstChild;
        let el = liveWinCardEls.get(id);

        if (!el) {
            el = createLiveWinCardEl(bet, true);
            liveWinCardEls.set(id, el);
            scroll.insertBefore(el, refNode);
        } else if (refNode !== el) {
            scroll.insertBefore(el, refNode);
        }
        prevEl = el;
    });

    // 4) Компенсируем добавленную ширину: если пользователь был не в самом
    //    начале ленты, сдвигаем scrollLeft ровно на столько же, на сколько
    //    выросла лента слева от него — визуально для него ничего не
    //    прыгает, просто где-то за пределами экрана появилась новая
    //    карточка. Если же он и так был в начале — ничего не трогаем,
    //    и он увидит, как новая карточка красиво появляется на его глазах.
    const addedWidth = scroll.scrollWidth - scrollWidthBefore;
    if (addedWidth > 0 && scrollLeftBefore > 0.5) {
        scroll.scrollLeft = scrollLeftBefore + addedWidth;
    }
}

/* =========================
   БЕЗОПАСНАЯ РАБОТА С ДЕНЬГАМИ
========================= */

function roundMoney(value) {
    const n = Number(value);
    if (!isFinite(n)) return 0;
    return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Округление ВНИЗ (в пользу заведения, не игрока) — используется там, где
// нужно отсечь дробные центы в финальной выплате, а не округлить их к игроку.
function roundMoneyDown(value) {
    const n = Number(value);
    if (!isFinite(n)) return 0;
    return Math.floor((n + Number.EPSILON) * 100) / 100;
}

/* =========================
   ЕДИНАЯ ЛОГИКА ПОЛЯ СТАВКИ (Мины / Краш / Кирка)
   Кнопки ½ / x2 / MAX и защита поля от некорректных чисел
   работают одинаково во всех трёх играх.
========================= */

const MIN_BET = 0.10;

// Применяет множитель (½ или x2) к текущему значению поля ставки.
// Пустое/некорректное значение → минимальная ставка.
// Итог всегда зажат в диапазон [MIN_BET; currentBalance] — выше баланса
// сумма никогда не выставляется, даже кнопкой x2.
function applyBetFactor(input, factor) {
    if (!input) return;
    let current = parseFloat(input.value);

    if (isNaN(current) || current < MIN_BET) {
        current = MIN_BET;
    } else {
        current = roundMoney(current * factor);
        if (current < MIN_BET) current = MIN_BET;
    }

    if (current > currentBalance) {
        current = roundMoney(Math.max(0, currentBalance));
    }

    input.value = current.toFixed(2);
}

// Кнопка MAX — ставит в поле весь доступный баланс.
function applyBetMax(input) {
    if (!input) return;
    input.value = roundMoney(Math.max(0, currentBalance)).toFixed(2);
}

// При потере фокуса поля ставки (после ручного ввода с клавиатуры)
// значение проверяется и зажимается тем же диапазоном [MIN_BET; currentBalance],
// чтобы вручную нельзя было вписать сумму выше баланса или отрицательное число.
function clampBetInputOnBlur(e) {
    const input = e.target;
    if (!input || input.value.trim() === '') return;

    let v = parseFloat(input.value);
    if (isNaN(v) || v <= 0) {
        input.value = '';
        return;
    }

    v = roundMoney(v);
    if (v > currentBalance) v = roundMoney(Math.max(0, currentBalance));
    input.value = v.toFixed(2);
}

// Блокирует символы, которые ломают number-поле на некоторых мобильных
// клавиатурах (научная запись "e", повторные "+"/"-").
function blockInvalidBetKeys(e) {
    if (e.key === 'e' || e.key === 'E' || e.key === '+' || e.key === '-') {
        e.preventDefault();
    }
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

/* =========================
   ЗАЩИЩЁННЫЕ ДЕНЕЖНЫЕ ОПЕРАЦИИ (через Supabase RPC)
   Баланс больше НИКОГДА не отправляется с клиента готовым числом —
   раньше saveUserData() делал обычный .update({ balance: currentBalance,
   ... }), а currentBalance можно было переписать прямо в консоли
   браузера перед вызовом. Теперь клиент может только ПОПРОСИТЬ
   сервер списать ставку / начислить выигрыш / списать на вывод —
   place_bet/resolve_win/request_withdrawal сами атомарно проверяют
   баланс и сами меняют цифру в Supabase (см. supabase_security_v2.sql).
   Прямой UPDATE в wxs_game с клиентским ключом запрещён на уровне БД,
   поэтому даже полностью переписанный script.js не даст списать
   больше, чем реально есть на счету, или начислить себе выигрыш
   без сервера.
========================= */

async function placeBetServer(amount, gameLabel) {
    const tgUser = tg?.initDataUnsafe?.user;
    if (!tgUser) return { ok: true, balance: currentBalance }; // запуск вне Telegram — локальный демо-режим

    const runCall = () => supabase.rpc('place_bet', {
        p_telegram_id: tgUser.id,
        p_amount: amount,
        p_game: gameLabel
    });

    const task = saveQueue.then(runCall, runCall);
    saveQueue = task.then(() => {}, () => {});

    try {
        const { data, error } = await task;
        if (error) {
            console.error('place_bet отклонён сервером:', error);
            return { ok: false, error };
        }
        return { ok: true, balance: Number(data) };
    } catch (e) {
        console.error('place_bet: сетевая ошибка:', e);
        return { ok: false, error: e };
    }
}

async function resolveWinServer(winAmount, multiplier) {
    const tgUser = tg?.initDataUnsafe?.user;
    if (!tgUser) return { ok: true, balance: currentBalance };

    const runCall = () => supabase.rpc('resolve_win', {
        p_telegram_id: tgUser.id,
        p_win_amount: winAmount,
        p_multiplier: multiplier ?? null
    });

    const task = saveQueue.then(runCall, runCall);
    saveQueue = task.then(() => {}, () => {});

    try {
        const { data, error } = await task;
        if (error) {
            console.error('resolve_win отклонён сервером:', error);
            return { ok: false, error };
        }
        return { ok: true, balance: Number(data) };
    } catch (e) {
        console.error('resolve_win: сетевая ошибка:', e);
        return { ok: false, error: e };
    }
}

// Ретраит начисление выигрыша (как раньше saveUserDataWithRetry) —
// используется там, где деньги уже "выиграны" и повторная попытка
// важнее, чем быстрый отказ.
async function resolveWinServerWithRetry(winAmount, multiplier, attempts = 2) {
    let last = { ok: false };
    for (let i = 0; i < attempts; i++) {
        last = await resolveWinServer(winAmount, multiplier);
        if (last.ok) return last;
    }
    return last;
}

async function requestWithdrawalServer(amount) {
    const tgUser = tg?.initDataUnsafe?.user;
    if (!tgUser) return { ok: true, balance: currentBalance };

    const runCall = () => supabase.rpc('request_withdrawal', {
        p_telegram_id: tgUser.id,
        p_amount: amount
    });

    const task = saveQueue.then(runCall, runCall);
    saveQueue = task.then(() => {}, () => {});

    try {
        const { data, error } = await task;
        if (error) {
            console.error('request_withdrawal отклонён сервером:', error);
            return { ok: false, error };
        }
        return { ok: true, balance: Number(data) };
    } catch (e) {
        console.error('request_withdrawal: сетевая ошибка:', e);
        return { ok: false, error: e };
    }
}

/* =========================
   СОСТОЯНИЕ ПРИЛОЖЕНИЯ
========================= */

let balanceMode = "deposit";
let selectedMethod = "CryptoBot";
let selectedMethodSub = "Криптовалюта";
let selectedMethodIcon = "images/cryptobot.png";

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
    applyBetFactor(document.getElementById('minesBetInput'), factor);
}

function setMinesMaxBet() {
    if (minesGame.active) return;
    applyBetMax(document.getElementById('minesBetInput'));
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

    // Списание считает и проверяет сервер (place_bet) — локально только
    // сразу показываем уменьшенный баланс, чтобы UI не подвисал.
    currentTurnover = roundMoney(currentTurnover + bet);
    currentBetsCount++;
    setUIBalance(roundMoney(currentBalance - bet));

    const debitResult = await placeBetServer(bet, 'Мины');
    if (!debitResult.ok) {
        restoreBalanceState(snapshot);
        showMessage("Не удалось списать ставку. Проверьте соединение и попробуйте снова.");
        minesGame.isProcessing = false;
        unlockEconomy();
        return;
    }
    currentBalance = debitResult.balance;
    setUIBalance(currentBalance);

    minesGame.active = true;
    minesGame.bet = bet;
    minesGame.liveBetId = await broadcastLiveBet(bet, 'Мины');
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
        tile.innerHTML = `<img src="images/bomb.png" alt="bomb" style="width: 32px; height: 32px; object-fit: contain;">`;
        if (tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred("error");
        endMinesGame(false);
    } else {
        minesGame.gemsFound++;
        tile.className = 'mine-tile revealed-gem';

        tile.innerHTML = `<img src="images/gem.png" alt="gem" style="width: 32px; height: 32px; object-fit: contain;">`;

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

    currentTotalWin = roundMoney(currentTotalWin + winAmount);
    currentWinsCount++;
    if (mult > currentMaxWin) currentMaxWin = mult;

    setUIBalance(roundMoney(currentBalance + winAmount));
    const creditResult = await resolveWinServerWithRetry(winAmount, mult);

    if (!creditResult.ok) {
        restoreBalanceState(snapshot);
        showMessage("Не удалось зачислить выигрыш. Проверьте соединение и нажмите «Забрать» ещё раз.");
        minesGame.isProcessing = false;
        unlockEconomy();
        return;
    }
    currentBalance = creditResult.balance;
    setUIBalance(currentBalance);

    if (tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred("success");
    showMessage(`Выигрыш: +${winAmount.toFixed(2)}$ (${mult.toFixed(2)}x)`);
    resolveLiveBetWin(minesGame.liveBetId, minesGame.bet, winAmount);

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
                tile.innerHTML = `<img src="images/bomb.png" alt="bomb" style="width: 32px; height: 32px; object-fit: contain; opacity: 0.6;">`;
            } else {
                tile.innerHTML = `<img src="images/gem.png" alt="gem" style="width: 32px; height: 32px; object-fit: contain; opacity: 0.6;">`;
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

const CRASH_HISTORY_MAX = 25; // сколько прошедших раундов видно в ленте

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
    isProcessing: false,
    betQueued: false,  // ставка поставлена заранее (во время полёта/паузы) и ждёт начала приёма ставок
    queuedBet: null     // сумма отложенной ставки
};

let crashAnimHandle = null;
let crashLoopStarted = false;
// Локально мы узнаём о конце полёта раньше сервера (по формуле времени),
// но статус раунда в БД меняется отдельным запросом (advance_crash_round),
// который может занять доли секунды. Пока идёт это уточнение, кэшаут
// временно блокируем — иначе игрок успевает нажать «Забрать» в это окно,
// запрос уходит на уже фактически завершённый раунд, и сервер его отклоняет.
let crashRoundSettling = false;
let crashHistory = [];      // последние коэффициенты, самый новый — первый
let lastCrashPoint = null;  // коэффициент прошлого раунда (для отображения в паузе)
let crashTrailPoints = [];  // точки следа ракеты за текущий полёт
let crashRocketAnim = null; // экземпляр Lottie-анимации ракеты
let crashExplosionAnim = null; // экземпляр Lottie-анимации взрыва
let crashExplosionTotalFrames = 0; // общее число кадров анимации взрыва (берётся из её JSON)
let crashExplosionHideTimeout = null; // таймер плавного скрытия взрыва после проигрывания нужной части

// "Тяжёлые" визуальные обновления (SVG-след со стековыми drop-shadow,
// текст с text-shadow) обновляем не чаще ~30 раз/сек вместо 60 — глазом
// разница незаметна, а нагрузка на рендер падает почти вдвое. Ракета и
// тряска экрана (дешёвые transform) продолжают обновляться каждый кадр.
let crashLastHeavyUpdate = 0;
const CRASH_HEAVY_UPDATE_INTERVAL_MS = 33;

// Доля анимации взрыва, которая реально проигрывается при краше — по ТЗ
// нужна только самая первая часть (меньше половины), дальше идёт "хвост"
// анимации, который не нужен. Меняйте это число, чтобы точнее подогнать
// момент остановки под нужный кадр.
const EXPLOSION_PLAY_FRACTION = 0.34;
// Длительность плавного исчезновения взрыва после того, как проигранная
// часть анимации закончилась (должна совпадать с transition opacity в HTML).
const EXPLOSION_FADE_MS = 150;

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
            historyList: document.getElementById('crashHistoryList'),
            reconnectBadge: document.getElementById('crashReconnectBadge')
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
        renderer: 'canvas',
        loop: true,
        autoplay: true,
        animationData: animationData,
        rendererSettings: {
            clearCanvas: true,
            progressiveLoad: true,
            preserveAspectRatio: 'xMidYMid meet'
        }
    });
}

// Загружает анимацию взрыва (проигрывается один раз в момент краша, без цикла)
function initCrashExplosionAnim() {
    const dom = getCrashDom();
    if (!dom.explosionEl || crashExplosionAnim) return;

    let animationData = null;
    if (window.EXPLOSION_DATA_CHUNKS && window.EXPLOSION_DATA_CHUNKS.length) {
        try {
            animationData = JSON.parse(window.EXPLOSION_DATA_CHUNKS.join(''));
        } catch (e) {
            animationData = null;
        }
    }

    if (typeof lottie === 'undefined' || !animationData) {
        dom.explosionEl.textContent = '💥';
        dom.explosionEl.style.fontSize = '100px';
        dom.explosionEl.style.lineHeight = '200px';
        dom.explosionEl.style.textAlign = 'center';
        return;
    }

    crashExplosionAnim = lottie.loadAnimation({
        container: dom.explosionEl,
        renderer: 'canvas',
        loop: false,
        autoplay: false,
        animationData: animationData,
        rendererSettings: {
            clearCanvas: true,
            progressiveLoad: true,
            preserveAspectRatio: 'xMidYMid meet'
        }
    });
    crashExplosionTotalFrames = animationData.op || 0;

    // Как только проигранный отрезок (0 → EXPLOSION_PLAY_FRACTION) доигрывает
    // до конца, сразу плавно прячем взрыв — а не держим его "заморожен­ным"
    // на последнем кадре до самого начала следующего раунда.
    crashExplosionAnim.addEventListener('complete', hideExplosionSmoothly);
}

function hideExplosionSmoothly() {
    const dom = getCrashDom();
    if (!dom.explosionEl) return;

    clearTimeout(crashExplosionHideTimeout);
    dom.explosionEl.style.opacity = '0';
    crashExplosionHideTimeout = setTimeout(() => {
        if (dom.explosionEl) dom.explosionEl.style.display = 'none';
    }, EXPLOSION_FADE_MS);
}

function openCrash() {
    showPage("crashPage");
    updateNav("games");
    initCrashPage();
}

// Кэш размеров сцены — чтения clientWidth/clientHeight на каждом кадре
// requestAnimationFrame вызывают принудительный синхронный reflow, что и было
// основной причиной лагов/фризов даже на мощных телефонах. Меряем размеры
// только когда они реально могут измениться (открытие страницы, начало
// раунда, поворот экрана/ресайз), а не 60 раз в секунду.
let crashStageW = 300;
let crashStageH = 340;

function syncCrashStageDims() {
    const dom = getCrashDom();
    if (!dom.stageEl) return;
    crashStageW = dom.stageEl.clientWidth || crashStageW;
    crashStageH = dom.stageEl.clientHeight || crashStageH;
}

window.addEventListener('resize', syncCrashStageDims);
window.addEventListener('orientationchange', syncCrashStageDims);

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

/* =========================
   ИГРА «КИРКА» (Infinite Mining Grid)
========================= */

const PICKAXE_TYPES = [
    { id: "wood",    name: "Деревянная", hp: 40,  weight: 50, emoji: "🪵" },
    { id: "stone",   name: "Каменная",   hp: 70,  weight: 25, emoji: "🪨" },
    { id: "copper",  name: "Медная",     hp: 100, weight: 13, emoji: "🥉" },
    { id: "iron",    name: "Железная",   hp: 140, weight: 7,  emoji: "⚔️" },
    { id: "gold",    name: "Золотая",    hp: 180, weight: 4,  emoji: "👑" },
    { id: "diamond", name: "Алмазная",   hp: 240, weight: 1,  emoji: "💎" }
];

// Типы блоков. baseDur/depthStep — прочность руды: чем глубже, тем больше ударов
// киркой нужно, чтобы её разрушить (и получить "+"). Трава и камень всегда
// ломаются с одного удара и никогда не дают награду — только отнимают 1 HP.
// ВАЖНО: у STONE/GRASS depthStep = Infinity — их прочность НИКОГДА не растёт
// с глубиной (раньше depthStep был равен 1, из-за чего durability = 1+глубина,
// и камень на глубине становился практически неразрушимым — кирка "залипала").
const BLOCK_TYPES = {
    AIR:     { id: 'air',     class: 'b-air',     multiplier: 0.00, baseDur: 0, depthStep: Infinity },
    GRASS:   { id: 'grass',   class: 'b-grass',   multiplier: 0.00, baseDur: 1, depthStep: Infinity },
    STONE:   { id: 'stone',   class: 'b-stone',   multiplier: 0.00, baseDur: 1, depthStep: Infinity },
    COAL:    { id: 'coal',    class: 'b-coal',    multiplier: 0.02, baseDur: 2, depthStep: 40  },
    COPPER:  { id: 'copper',  class: 'b-copper',  multiplier: 0.04, baseDur: 3, depthStep: 30  },
    IRON:    { id: 'iron',    class: 'b-iron',    multiplier: 0.07, baseDur: 4, depthStep: 26  },
    GOLD:    { id: 'gold',    class: 'b-gold',    multiplier: 0.11, baseDur: 5, depthStep: 22  },
    LAPIS:   { id: 'lapis',   class: 'b-lapis',   multiplier: 0.15, baseDur: 5, depthStep: 20  },
    EMERALD: { id: 'emerald', class: 'b-emerald', multiplier: 0.18, baseDur: 5, depthStep: 16  },
    DIAMOND: { id: 'diamond', class: 'b-diamond', multiplier: 0.30, baseDur: 5, depthStep: 12  }
};
const ORE_IDS = ['coal', 'copper', 'iron', 'gold', 'lapis', 'emerald', 'diamond'];

/* =========================
   КАРТИНКИ БЛОКОВ И КИРОК ИЗ ВНЕШНИХ ФАЙЛОВ (например, с GitHub)
   ---------------------------------------------------------------
   Никакой загрузки внутри приложения — картинки просто лежат у вас в
   репозитории (или на любом хостинге) и подключаются по прямой ссылке.
   Имя файла ДОЛЖНО совпадать с id блока/кирки — так игра понимает,
   какая картинка к какому предмету относится.

   Как подключить:
   1. Залейте на GitHub PNG-файлы со следующими именами (имена блоков и
      кирок специально сделаны разными — например, ore_stone.png и
      pickaxe_stone.png, — чтобы они никогда не путались и не перезаписывали
      друг друга, даже если вы храните всё в одной папке):

        images/blocks/ore_grass.png     — трава
        images/blocks/ore_stone.png     — камень
        images/blocks/ore_coal.png      — уголь
        images/blocks/ore_copper.png    — медь
        images/blocks/ore_iron.png      — железо
        images/blocks/ore_gold.png      — золото
        images/blocks/ore_lapis.png     — лазурит
        images/blocks/ore_emerald.png   — изумруд
        images/blocks/ore_diamond.png   — алмаз

        images/pickaxes/pickaxe_wood.png    — деревянная кирка
        images/pickaxes/pickaxe_stone.png   — каменная кирка
        images/pickaxes/pickaxe_copper.png  — медная кирка
        images/pickaxes/pickaxe_iron.png    — железная кирка
        images/pickaxes/pickaxe_gold.png    — золотая кирка
        images/pickaxes/pickaxe_diamond.png — алмазная кирка

   2. Ниже, в IMAGES_BASE_URL, укажите путь к папке images:
        - если index.html и папка images лежат в одном репозитории и сайт
          открывается прямо оттуда (например, GitHub Pages) — оставьте 'images'
        - если хотите тянуть картинки напрямую из репозитория на GitHub без
          GitHub Pages — впишите сюда прямую ссылку через raw.githubusercontent.com,
          например:
          'https://raw.githubusercontent.com/ИМЯ_ПОЛЬЗОВАТЕЛЯ/НАЗВАНИЕ_РЕПО/main/images'

   Если для какого-то блока/кирки файл не найден (404) — игра автоматически
   вернётся к стандартной нарисованной текстуре/эмодзи для этого предмета,
   ничего не сломается.
========================= */
const IMAGES_BASE_URL = 'images';

// Список id, для которых поддерживается своя картинка (воздух — не нужен)
const CUSTOMIZABLE_BLOCK_IDS = Object.values(BLOCK_TYPES)
    .map(t => t.id)
    .filter(id => id !== 'air');

function blockImageUrl(blockId) {
    return `${IMAGES_BASE_URL}/blocks/ore_${blockId}.png`;
}
function pickaxeImageUrl(pickaxeId) {
    return `${IMAGES_BASE_URL}/pickaxes/pickaxe_${pickaxeId}.png`;
}

// Кэш результата загрузки: id -> рабочий url (если картинка нашлась) или null
// (если файла нет/ошибка) или undefined (ещё не проверяли).
const blockImageCache = {};
const pickaxeImageCache = {};

// Стандартные (заводские) названия — используются в подписях в игре
// (например, во всплывающей надписи выигрыша над разрушенным блоком).
const BLOCK_DEFAULT_NAMES = {
    grass: 'Трава', stone: 'Камень', coal: 'Уголь', copper: 'Медь',
    iron: 'Железо', gold: 'Золото', lapis: 'Лазурит', emerald: 'Изумруд', diamond: 'Алмаз'
};

function getBlockDisplayName(blockId) {
    return BLOCK_DEFAULT_NAMES[blockId] || blockId;
}

function getPickaxeDisplayName(pickaxeObj) {
    return pickaxeObj.name;
}

// Проверяет по одному разу на id, существует ли картинка по вычисленному
// URL — грузит её через объект Image() (без единого запроса на каждый блок
// в сетке: результат кэшируется, а браузер и сам закэширует сам файл).
function preloadTypeImages() {
    CUSTOMIZABLE_BLOCK_IDS.forEach(id => {
        const url = blockImageUrl(id);
        const img = new Image();
        img.onload = () => {
            blockImageCache[id] = url;
            refreshAllRenderedBlockImages();
        };
        img.onerror = () => { blockImageCache[id] = null; };
        img.src = url;
    });

    PICKAXE_TYPES.forEach(p => {
        const url = pickaxeImageUrl(p.id);
        const img = new Image();
        img.onload = () => {
            pickaxeImageCache[p.id] = url;
            // Раньше здесь вызывался renderIdleReel(), который полностью
            // пересоздавал барабан и перезапускал CSS-анимацию заново — это
            // и было причиной рывков/лагов в превью-прокрутке (каждая из 6
            // картинок кирок догружается в свой момент). Теперь картинка
            // подставляется точечно, в уже существующие элементы, без
            // сброса позиции и перезапуска анимации.
            refreshAllRenderedPickaxeImages();
        };
        img.onerror = () => { pickaxeImageCache[p.id] = null; };
        img.src = url;
    });
}

// Применяет (или сбрасывает — если файла нет) картинку блока на конкретном
// DOM-элементе. Не трогает сам класс блока (crack/hit-flash и т.д.) — просто
// накладывает картинку поверх фона через отдельный CSS-класс.
function applyCustomBlockImage(div, blockId) {
    const url = blockImageCache[blockId];
    if (url) {
        div.style.backgroundImage = `url("${url}")`;
        div.classList.add('custom-img');
    } else {
        div.style.backgroundImage = '';
        div.classList.remove('custom-img');
    }
}

// Применяет (или сбрасывает) картинку кирки на элементе-спрайте
// (эмодзи-текст скрывается, вместо него — фон-изображение).
function applyCustomPickaxeVisual(el, pickaxeObj) {
    const url = pickaxeImageCache[pickaxeObj.id];
    if (url) {
        el.textContent = '';
        el.style.backgroundImage = `url("${url}")`;
        el.classList.add('custom-img');
    } else {
        el.style.backgroundImage = '';
        el.classList.remove('custom-img');
        el.textContent = pickaxeObj.emoji;
    }
}

// Точечно обновляет картинку уже отрисованных ячеек барабана (и в режиме
// ожидания, и во время прокрутки) — без пересоздания DOM и без сброса
// transform/анимации, чтобы подгрузка картинок не дёргала прокрутку.
function refreshAllRenderedPickaxeImages() {
    document.querySelectorAll('.pickaxe-reel-item[data-pickaxe-id]').forEach(el => {
        const p = PICKAXE_TYPES.find(pt => pt.id === el.dataset.pickaxeId);
        if (p) applyCustomPickaxeVisual(el, p);
    });
}

// Перекрашивает уже отрисованные в DOM блоки шахты после того, как картинка
// для их типа успешно подгрузилась (preloadTypeImages может завершиться уже
// после того, как сетка отрисована).
function refreshAllRenderedBlockImages() {
    document.querySelectorAll('#mineGrid .mine-block[data-block-id]').forEach(div => {
        applyCustomBlockImage(div, div.dataset.blockId);
    });
}

// Пороги глубины и веса появления руды. Работает в 2 шага:
//  1) baseSeedChance(rowIndex) — ОБЩИЙ шанс (%), что новая ячейка вообще
//     станет затравкой руды (а не камнем). Он растёт с глубиной, но
//     жёстко ограничен потолком — поэтому руды всегда заметно МЕНЬШЕ
//     камня, даже в самой глубокой части шахты.
//  2) если ячейка стала рудой — тип выбирается по весам (baseWeight) среди
//     ярусов, уже открытых на этой глубине (rowIndex >= minRow). growth/maxMult
//     увеличивают вес более дорогих ярусов по мере углубления ЗА порог их
//     открытия — поэтому дорогая руда действительно чаще встречается ниже,
//     а не просто "включается" на пороге и остаётся редкой навсегда.
const ORE_TIERS = [
    { id: 'diamond', minRow: 46, baseWeight: 1.0, growth: 0.05,  maxMult: 4.0 },
    { id: 'emerald', minRow: 36, baseWeight: 1.6, growth: 0.045, maxMult: 3.4 },
    { id: 'lapis',   minRow: 26, baseWeight: 2.4, growth: 0.035, maxMult: 2.8 },
    { id: 'gold',    minRow: 20, baseWeight: 3.2, growth: 0.03,  maxMult: 2.4 },
    { id: 'iron',    minRow: 16, baseWeight: 4.4, growth: 0.02,  maxMult: 2.0 },
    { id: 'copper',  minRow: 9,  baseWeight: 6.5, growth: 0.012, maxMult: 1.6 },
    { id: 'coal',    minRow: 4,  baseWeight: 8.5, growth: 0.006, maxMult: 1.3 }
];
// Вероятность того, что жила продолжится в соседнюю ячейку (вертикально/горизонтально) —
// это и создаёт "скопления" (кластеры) руды. Размер каждой жилы дополнительно
// жёстко ограничен ОБЩИМ бюджетом (см. generateRow) — 3-6 блоков максимум СУММАРНО
// на всю жилу (включая любые её ответвления), а не на каждое направление отдельно,
// поэтому рудники никогда не превращаются в огромные сплошные залежи.
const VEIN_VERTICAL_CHANCE = 0.55;
const VEIN_HORIZONTAL_CHANCE = 0.3;
const VEIN_MIN_SIZE = 3;
const VEIN_MAX_SIZE = 6;

const GRID_COLS = 7;
const BLOCK_SIZE = 44; // Должно совпадать с --block-size в style.css
const SPRITE_SIZE = 38;
// Падение замедлено ещё в 2 раза (итого ~8 раз медленнее исходных значений) —
// кирка падает заметно медленнее, удары по блокам легче отслеживать глазами.
const GRAVITY = 0.07;       // Ускорение свободного падения кирки (px/кадр²)
const MAX_FALL_SPEED = 3;   // Максимальная скорость падения
const BOUNCE_SPEED = -0.8;  // Лёгкий отскок при ударе о ещё не разрушенную руду
const BOUNCE_MAX = -1.5;    // Верхний предел скорости отскока (реалистичное затухание)
const BOUNCE_RESTITUTION = 0.5; // Доля скорости удара, возвращаемая при отскоке
const START_FALL_SPEED = 0.3;
const SQUASH_FRAMES = 12;   // Длительность визуального "сплющивания" кирки при ударе

let mineGridMap = [];  // Массив блоков шахты (каждая ячейка — независимый объект с durability)
let isPickaxeRunning = false;
let pickaxePhysicsRAF = null;
let pickaxeSpeedMult = 1;       // Множитель скорости текущего забега (1 = обычная, 2.5 = ускорено)
let pickaxeSpeedUsed = false;   // "Ускорить" можно применить только один раз за забег
let pickaxeSkipRequested = false; // Флаг: скип до 15% HP запрошен, но ещё не выполнен
let pickaxeSkipUsed = false;    // "Скип" можно применить только один раз за забег

function adjustPickaxeBet(factor) {
    applyBetFactor(document.getElementById('pickaxeBetInput'), factor);
}

// Ускоряет текущий забег в 2.5 раза (гравитация/скорость падения/отскок).
// Действует один раз за забег — после нажатия кнопка блокируется.
function acceleratePickaxeGame() {
    if (!isPickaxeRunning || pickaxeSpeedUsed) return;
    pickaxeSpeedMult = 2.5;
    pickaxeSpeedUsed = true;
    const btn = document.getElementById('pickaxeSpeedBtn');
    if (btn) btn.disabled = true;
}

// Мгновенно прокручивает забег вперёд до момента, когда у кирки останется
// 15% HP от стартового запаса, дальше игра продолжается как обычно (анимированно).
// Действует один раз за забег — после нажатия кнопка блокируется.
function skipPickaxeGame() {
    if (!isPickaxeRunning || pickaxeSkipUsed) return;
    pickaxeSkipRequested = true;
    pickaxeSkipUsed = true;
    const btn = document.getElementById('pickaxeSkipBtn');
    if (btn) btn.disabled = true;
}

function setPickaxeMaxBet() {
    applyBetMax(document.getElementById('pickaxeBetInput'));
}

function openPickaxe() {
    showPage("pickaxePage");
    updateNav("games");
    resetMineWorld();
    // Барабан уже подготовлен и крутится с момента загрузки приложения
    // (см. renderIdleReel() в DOMContentLoaded) — пересоздаём его здесь
    // только если он почему-то ещё пуст, чтобы не дёргать/не сбрасывать
    // уже идущую прокрутку при каждом повторном заходе на страницу.
    const track = document.getElementById('pickaxeReelTrack');
    if (!track || !track.children.length) {
        renderIdleReel();
    }
}

// Создаёт независимую ячейку блока (со своей прочностью), а не общую ссылку —
// это нужно, чтобы каждую руду можно было "долбить" по несколько раз отдельно.
// veinBudget — общий (расшаренный по ссылке) счётчик "сколько ещё блоков может
// занять эта жила" — единый на все её ответвления (вертикальные и горизонтальные),
// поэтому итоговый размер жилы гарантированно не превышает 3-6 блоков суммарно.
function makeCell(type, rowIndex, veinBudget) {
    const durability = type.id === 'air' ? 0 : (type.baseDur + Math.floor(rowIndex / type.depthStep));
    return {
        id: type.id,
        class: type.class,
        multiplier: type.multiplier,
        isOre: ORE_IDS.includes(type.id),
        durability,
        maxDurability: durability,
        veinBudget: veinBudget || null
    };
}

// Общий шанс (%), что ячейка вообще станет затравкой руды на данной глубине.
// Растёт с глубиной, но ограничен потолком (30%) — примерно 1/3 площади шахты
// занята рудой, 2/3 — камнем (немного плотнее, чем "редкая" версия, но
// рудники по-прежнему не превращаются в сплошную руду).
function baseSeedChance(rowIndex) {
    return Math.min(30, 12 + rowIndex * 0.12);
}

// Выбирает "затравку" новой жилы руды для текущей глубины (или null → камень).
// Шаг 1: решаем, будет ли эта ячейка рудой вообще (см. baseSeedChance).
// Шаг 2: если да — выбираем ЧЕЙ тип по весам среди уже открытых на этой
// глубине ярусов; вес дорогих ярусов растёт по мере углубления ЗА порог их
// открытия (growth/maxMult), поэтому дорогая руда реально чаще встречается
// ниже, а не просто "включается" на пороге.
function pickOreSeed(rowIndex) {
    if (Math.random() * 100 >= baseSeedChance(rowIndex)) return null;

    const available = ORE_TIERS.filter(t => rowIndex >= t.minRow);
    if (!available.length) return null;

    let totalWeight = 0;
    const weighted = available.map(t => {
        const depthPast = rowIndex - t.minRow;
        const w = t.baseWeight * Math.min(t.maxMult, 1 + depthPast * t.growth);
        totalWeight += w;
        return { id: t.id, w };
    });

    let r = Math.random() * totalWeight;
    for (const item of weighted) {
        r -= item.w;
        if (r <= 0) return item.id;
    }
    return weighted[weighted.length - 1].id;
}

function generateRow(rowIndex) {
    const row = [];
    for (let c = 0; c < GRID_COLS; c++) {
        if (rowIndex === 0) {
            row.push(makeCell(BLOCK_TYPES.GRASS, rowIndex, null));
            continue;
        }

        // Скопления руды: если сосед сверху/слева — руда, у которой ЕЩЁ ОСТАЛСЯ
        // общий бюджет жилы (veinBudget.remaining > 0), есть шанс, что жила
        // продолжится сюда тем же типом. Как только бюджет исчерпан — жила
        // гарантированно обрывается ВО ВСЕХ направлениях (бюджет один на всю
        // жилу, а не отдельно на каждую ветку), поэтому итоговый размер
        // скопления не превышает 3-6 блоков. Если продолжения нет — обычная
        // случайная "затравка" новой жилы по глубине, либо камень.
        const aboveCell = (mineGridMap[rowIndex - 1] || [])[c];
        const leftCell = row[c - 1];
        let oreId = null;
        let veinBudget = null;

        const aboveCanContinue = aboveCell && aboveCell.isOre && aboveCell.veinBudget && aboveCell.veinBudget.remaining > 0;
        const leftCanContinue = leftCell && leftCell.isOre && leftCell.veinBudget && leftCell.veinBudget.remaining > 0;

        if (aboveCanContinue && Math.random() < VEIN_VERTICAL_CHANCE) {
            oreId = aboveCell.id;
            veinBudget = aboveCell.veinBudget;
            veinBudget.remaining--;
        } else if (leftCanContinue && Math.random() < VEIN_HORIZONTAL_CHANCE) {
            oreId = leftCell.id;
            veinBudget = leftCell.veinBudget;
            veinBudget.remaining--;
        } else {
            oreId = pickOreSeed(rowIndex);
            if (oreId) {
                // Новая жила: сразу выдаём ей общий случайный "бюджет" размера
                // 3-6 блоков суммарно (эта ячейка + остаток на продолжение).
                const veinSize = VEIN_MIN_SIZE + Math.floor(Math.random() * (VEIN_MAX_SIZE - VEIN_MIN_SIZE + 1));
                veinBudget = { remaining: veinSize - 1 };
            }
        }

        if (oreId) {
            row.push(makeCell(BLOCK_TYPES[oreId.toUpperCase()], rowIndex, veinBudget));
        } else {
            row.push(makeCell(BLOCK_TYPES.STONE, rowIndex, null));
        }
    }
    return row;
}

function blockCellEl(row, col) {
    return document.querySelector(`.mine-block[data-row="${row}"][data-col="${col}"]`);
}

// Задаёт случайные CSS-переменные смещения текстуры, чтобы соседние блоки
// одного типа не выглядели как один и тот же повторяющийся тайл (реалистичность).
function applyBlockTexture(div) {
    div.style.setProperty('--tx', Math.floor(Math.random() * 26) + 'px');
    div.style.setProperty('--ty', Math.floor(Math.random() * 26) + 'px');
    div.style.setProperty('--tr', (Math.random() * 8 - 4).toFixed(1) + 'deg');
    div.style.setProperty('--tb', (0.9 + Math.random() * 0.2).toFixed(2));
}

function appendRowsDOM(fromIndex, rows) {
    const gridEl = document.getElementById('mineGrid');
    const frag = document.createDocumentFragment();
    rows.forEach((row, i) => {
        const rIdx = fromIndex + i;
        row.forEach((block, cIdx) => {
            const div = document.createElement('div');
            div.className = `mine-block ${block.class}`;
            div.dataset.row = rIdx;
            div.dataset.col = cIdx;
            div.dataset.blockId = block.id;
            if (block.isOre) div.dataset.ore = "1";
            applyBlockTexture(div);
            applyCustomBlockImage(div, block.id);
            frag.appendChild(div);
        });
    });
    gridEl.appendChild(frag);
}

function ensureRowsUpTo(rowIndex) {
    const need = rowIndex + 15 - mineGridMap.length;
    if (need <= 0) return;
    const newRows = [];
    const startIdx = mineGridMap.length;
    for (let i = 0; i < need; i++) {
        const r = generateRow(mineGridMap.length);
        mineGridMap.push(r);
        newRows.push(r);
    }
    appendRowsDOM(startIdx, newRows);
}

function resetMineWorld() {
    const gridEl = document.getElementById('mineGrid');
    const worldEl = document.getElementById('mineWorld');
    const sprite = document.getElementById('activePickaxeSprite');

    if (pickaxePhysicsRAF) {
        cancelAnimationFrame(pickaxePhysicsRAF);
        pickaxePhysicsRAF = null;
    }

    gridEl.innerHTML = '';
    worldEl.style.transform = `translate(-50%, 0px)`;
    sprite.classList.add('hidden');
    sprite.style.transform = 'translate(-50%, 0) rotate(0deg)';

    mineGridMap = [];
    for (let r = 0; r < 20; r++) {
        mineGridMap.push(generateRow(r));
    }
    renderGridDOM();

    const hudHp = document.getElementById('hudHp');
    const hudWin = document.getElementById('hudWin');
    const hudDepth = document.getElementById('hudDepth');
    if (hudHp) hudHp.textContent = '0';
    if (hudWin) hudWin.textContent = '0.00 $';
    if (hudDepth) hudDepth.textContent = '0';
}

function renderGridDOM() {
    const gridEl = document.getElementById('mineGrid');
    gridEl.innerHTML = '';

    mineGridMap.forEach((row, rIdx) => {
        row.forEach((block, cIdx) => {
            const div = document.createElement('div');
            div.className = `mine-block ${block.class}`;
            div.dataset.row = rIdx;
            div.dataset.col = cIdx;
            div.dataset.blockId = block.id;
            if (block.isOre) div.dataset.ore = "1";
            applyBlockTexture(div);
            applyCustomBlockImage(div, block.id);
            gridEl.appendChild(div);
        });
    });
}

function getPickaxeByWeight() {
    const totalWeight = PICKAXE_TYPES.reduce((s, p) => s + p.weight, 0);
    let rand = Math.random() * totalWeight;
    for (const p of PICKAXE_TYPES) {
        if (rand < p.weight) return p;
        rand -= p.weight;
    }
    return PICKAXE_TYPES[0];
}

/* =========================
   БАРАБАН ВЫБОРА КИРКИ ("кейс")
   - renderIdleReel(): режим ожидания — лента медленно и БЕСКОНЕЧНО крутится
     по кругу (превью, ещё не открыто).
   - spinPickaxeReel(): режим открытия — длинная лента с случайными кирками
     быстро прокручивается и плавно тормозит ровно на выпавшей кирке под
     указателем, как открытие кейса.
   Ширина ячейки (REEL_ITEM_WIDTH) должна совпадать с .pickaxe-reel-item в CSS.
========================= */
const REEL_ITEM_WIDTH = 64;

function makeReelItemEl(p) {
    const div = document.createElement('div');
    div.className = 'pickaxe-reel-item';
    div.dataset.pickaxeId = p.id;
    applyCustomPickaxeVisual(div, p);
    return div;
}

// Режим ожидания: зацикленная медленная прокрутка (превью кейса до открытия).
function renderIdleReel() {
    const viewport = document.getElementById('pickaxeReelViewport');
    const track = document.getElementById('pickaxeReelTrack');
    const nameLabel = document.getElementById('pickaxeName');
    if (!track) return;

    track.style.transition = 'none';
    track.style.animation = 'none';
    track.innerHTML = '';

    // Несколько копий полного набора кирок подряд — чтобы прокрутка на ширину
    // одного набора выглядела как бесшовная бесконечная петля.
    const REPEATS = 4;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < REPEATS; i++) {
        PICKAXE_TYPES.forEach(p => frag.appendChild(makeReelItemEl(p)));
    }
    track.appendChild(frag);

    // Трек позиционируется через left:50%, поэтому при transform:translateX(0)
    // первая кирка начинается ровно от ЦЕНТРА вьюпорта — вся левая половина
    // оставалась пустой (это и было причиной "разрывов"/пропавших кирок в
    // начале). Стартуем сразу со сдвигом на половину ширины вьюпорта, чтобы
    // лента с первого кадра была заполнена целиком, без пустот.
    const viewportWidth = (viewport && viewport.clientWidth) || 320;
    const startOffset = Math.ceil(viewportWidth / 2);
    track.style.transform = `translateX(-${startOffset}px)`;

    void track.offsetWidth; // форсируем reflow, чтобы анимация стартовала чисто

    const setWidth = PICKAXE_TYPES.length * REEL_ITEM_WIDTH;
    track.style.setProperty('--idle-loop-start', `-${startOffset}px`);
    track.style.setProperty('--idle-loop-shift', `-${startOffset + setWidth}px`);
    track.style.animation = `pickaxeIdleScroll ${(PICKAXE_TYPES.length * 1.3).toFixed(1)}s linear infinite`;

    if (nameLabel) nameLabel.textContent = '';
}

// Режим открытия: настоящая "кейс"-прокрутка с торможением на выпавшей кирке.
// Возвращает Promise, который резолвится, когда лента полностью остановилась.
function spinPickaxeReel(finalPickaxe) {
    return new Promise(resolve => {
        const track = document.getElementById('pickaxeReelTrack');
        const nameLabel = document.getElementById('pickaxeName');
        if (!track) { resolve(); return; }

        track.style.animation = 'none';
        track.style.transition = 'none';

        // Длинная лента: много случайных кирок "пролетают" мимо, финальная
        // (выигранная) кирка стоит на заранее выбранной позиции недалеко от
        // конца ленты — именно на ней лента и остановится под указателем.
        const TOTAL_ITEMS = 46;
        const TARGET_INDEX = TOTAL_ITEMS - 6;
        const frag = document.createDocumentFragment();
        for (let i = 0; i < TOTAL_ITEMS; i++) {
            const p = (i === TARGET_INDEX) ? finalPickaxe : PICKAXE_TYPES[Math.floor(Math.random() * PICKAXE_TYPES.length)];
            frag.appendChild(makeReelItemEl(p));
        }
        track.innerHTML = '';
        track.appendChild(frag);
        track.style.transform = 'translateX(0px)';
        void track.offsetWidth;

        if (nameLabel) nameLabel.textContent = '';

        // Трек стоит на left:50%, поэтому чтобы центр выигрышной ячейки
        // совпал с центром вьюпорта (и с указателем-селектором), нужно
        // сдвинуть трек ещё и на половину ширины ячейки. Раньше здесь был
        // случайный "казино"-джиттер, из-за которого лента тормозила мимо
        // центра — теперь кирка всегда останавливается ровно по центру.
        const targetOffset = -(TARGET_INDEX * REEL_ITEM_WIDTH + REEL_ITEM_WIDTH / 2);

        // rAF x2, чтобы браузер гарантированно применил transition ПОСЛЕ
        // сброса transform выше (иначе транзишен может "съесться" в один кадр).
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                track.style.transition = 'transform 3.2s cubic-bezier(0.12, 0.85, 0.15, 1)';
                track.style.transform = `translateX(${targetOffset}px)`;
            });
        });

        const onEnd = (e) => {
            if (e.target !== track || e.propertyName !== 'transform') return;
            track.removeEventListener('transitionend', onEnd);
            if (nameLabel) nameLabel.textContent = `${getPickaxeDisplayName(finalPickaxe)} (${finalPickaxe.hp} HP)`;
            resolve();
        };
        track.addEventListener('transitionend', onEnd);
    });
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
    document.getElementById('pickaxeActionBtn').disabled = true;
    pickaxeSpeedMult = 1;
    pickaxeSpeedUsed = false;
    pickaxeSkipRequested = false;
    pickaxeSkipUsed = false;
    const speedBtn = document.getElementById('pickaxeSpeedBtn');
    const skipBtn = document.getElementById('pickaxeSkipBtn');
    if (speedBtn) speedBtn.disabled = false;
    if (skipBtn) skipBtn.disabled = false;

    // Списание баланса — считает и проверяет сервер (place_bet)
    const snapshot = snapshotBalanceState();
    currentTurnover = roundMoney(currentTurnover + bet);
    currentBetsCount++;
    setUIBalance(roundMoney(currentBalance - bet));

    const debitResult = await placeBetServer(bet, 'Кирка');
    if (!debitResult.ok) {
        restoreBalanceState(snapshot);
        showMessage("Ошибка сети при списании.");
        isPickaxeRunning = false;
        document.getElementById('pickaxeActionBtn').disabled = false;
        unlockEconomy();
        return;
    }
    currentBalance = debitResult.balance;
    setUIBalance(currentBalance);

    resetMineWorld();
    const liveBetId = await broadcastLiveBet(bet, 'Кирка');

    // 1. Вращение рулетки — как открытие кейса: лента быстро прокручивается
    // и тормозит ровно на выпавшей (уже определённой заранее) кирке.
    const picked = getPickaxeByWeight();
    await spinPickaxeReel(picked);
    runMiningPhysics(picked, bet, liveBetId);
}

// Бросок кирки вниз с гравитацией: она разгоняется, врезается в блоки,
// отскакивает от ещё не разрушенной прочной руды и продолжает падать
// после того как блок сломан. Трава/камень ломаются с 1 удара без награды,
// руда — по её прочности (зависит от глубины), награда начисляется только
// в момент полного разрушения блока.
function runMiningPhysics(pickaxe, bet, liveBetId) {
    let hp = pickaxe.hp;
    let accumulatedMultiplier = 0;

    let curCol = Math.floor(GRID_COLS / 2); // Стартовая колонка — центр
    let posY = 0;        // Пиксельная позиция кирки по вертикали (растёт только вниз)
    let vy = START_FALL_SPEED;
    let rotation = 0;
    let brokenRow = 0; // ниже этой строки всё уже пройдено кабиной
    let cameraY = 0;    // Плавная, МОНОТОННАЯ камера — никогда не откатывается назад,
                         // поэтому отскок от прочной руды не выглядит как "полёт вверх"
    let squashTimer = 0; // кадры, оставшиеся до конца эффекта "сплющивания" при ударе

    const sprite = document.getElementById('activePickaxeSprite');
    const worldEl = document.getElementById('mineWorld');
    const viewportEl = document.getElementById('mineViewport');
    const hudHp = document.getElementById('hudHp');
    const hudWin = document.getElementById('hudWin');
    const hudDepth = document.getElementById('hudDepth');

    applyCustomPickaxeVisual(sprite, pickaxe);
    sprite.classList.remove('hidden');
    hudHp.textContent = hp;
    hudWin.textContent = "0.00 $";
    hudDepth.textContent = "0";

    const runControls = document.getElementById('pickaxeRunControls');
    const actionBtn = document.getElementById('pickaxeActionBtn');
    if (runControls) runControls.classList.remove('hidden');
    if (actionBtn) actionBtn.classList.add('hidden');

    const maxHp = pickaxe.hp;
    const skipThresholdHp = Math.ceil(maxHp * 0.15); // Порог для кнопки "Скип" — 15% от стартового HP

    // posX хранится как смещение от центра колонки (в px, для колонки curCol)
    let xOffset = 0; // текущее смещение спрайта от центра его колонки (для эффекта покачивания)

    const finish = async () => {
        cancelAnimationFrame(pickaxePhysicsRAF);
        pickaxePhysicsRAF = null;
        sprite.classList.add('hidden');
        if (runControls) runControls.classList.add('hidden');
        if (actionBtn) actionBtn.classList.remove('hidden');

        // Итоговая выплата округляется ВНИЗ (не в пользу игрока) — если накопленный
        // множитель даёт, например, 1.2347x от ставки, дробные центы свыше двух
        // знаков отбрасываются, а не округляются вверх.
        const totalWin = roundMoneyDown(bet * accumulatedMultiplier);
        let creditFailed = false;
        if (totalWin > 0) {
            const winSnapshot = snapshotBalanceState();
            currentTotalWin = roundMoney(currentTotalWin + totalWin);
            currentWinsCount++;
            setUIBalance(roundMoney(currentBalance + totalWin));

            const creditResult = await resolveWinServerWithRetry(totalWin, accumulatedMultiplier);
            if (!creditResult.ok) {
                restoreBalanceState(winSnapshot);
                creditFailed = true;
            } else {
                currentBalance = creditResult.balance;
                setUIBalance(currentBalance);
            }
        }

        if (creditFailed) {
            showMessage("Не удалось зачислить выигрыш. Обратитесь в поддержку, если баланс не обновится.");
        } else {
            showMessage(`Кирка сломалась! Итоговый выигрыш: +${totalWin.toFixed(2)}$ (${accumulatedMultiplier.toFixed(2)}x)`);
            resolveLiveBetWin(liveBetId, bet, totalWin);
        }

        isPickaxeRunning = false;
        document.getElementById('pickaxeActionBtn').disabled = false;
        unlockEconomy();
        renderIdleReel(); // барабан снова медленно крутится в режиме ожидания
    };

    // Всплывающая надпись с приростом выигрыша над разрушенным блоком руды —
    // визуально показывает, что каждый "иксовый" блок сразу засчитывается в вин,
    // и подписывает, какая именно руда сломалась (с учётом своего названия).
    const spawnWinPopup = (rowIdx, colIdx, multGain, blockId) => {
        if (!multGain) return;
        const popup = document.createElement('div');
        popup.className = 'mine-win-popup';
        popup.textContent = `+${roundMoney(bet * multGain).toFixed(2)}$ ${getBlockDisplayName(blockId)}`;
        popup.style.left = `${colIdx * BLOCK_SIZE + BLOCK_SIZE / 2}px`;
        popup.style.top = `${rowIdx * BLOCK_SIZE}px`;
        worldEl.appendChild(popup);
        setTimeout(() => popup.remove(), 700);
    };

    // Короткая пыль/осколки в момент удара — усиливает ощущение реального разрушения.
    const spawnImpactDust = (rowIdx, colIdx, big) => {
        const dust = document.createElement('div');
        dust.className = big ? 'mine-impact-dust dust-big' : 'mine-impact-dust';
        dust.style.left = `${colIdx * BLOCK_SIZE + BLOCK_SIZE / 2}px`;
        dust.style.top = `${rowIdx * BLOCK_SIZE + BLOCK_SIZE / 2}px`;
        worldEl.appendChild(dust);
        setTimeout(() => dust.remove(), 420);
    };

    const registerHit = (rowIdx, colIdx) => {
        ensureRowsUpTo(rowIdx + 1);
        const cell = mineGridMap[rowIdx][colIdx];
        if (!cell || cell.id === 'air' || cell.durability <= 0) return { solid: false };

        hp--;
        cell.durability--;
        if (tg?.HapticFeedback) tg.HapticFeedback.impactOccurred(cell.durability <= 0 ? "medium" : "light");

        const el = blockCellEl(rowIdx, colIdx);

        if (cell.durability <= 0) {
            // Блок разрушен с этого удара — засчитываем "+", если это руда.
            // Запоминаем исходный id ДО его сброса на 'air', чтобы правильно
            // подписать название руды во всплывающей надписи.
            const brokenBlockId = cell.id;
            accumulatedMultiplier += cell.multiplier;
            cell.id = 'air';
            cell.class = 'b-air';
            if (el) {
                el.classList.add('block-break-anim');
                // Гарантированное 100%-е исчезновение блока: элемент НЕ удаляется
                // из DOM (это сломало бы раскладку CSS grid, которая опирается
                // на порядок элементов), но полностью сбрасывается — включая
                // data-ore и кастомную картинку, которые раньше могли "просвечивать"
                // через ::before/::after даже после смены класса на b-air.
                setTimeout(() => {
                    el.className = 'mine-block b-air';
                    el.dataset.blockId = 'air';
                    el.removeAttribute('data-ore');
                    el.style.backgroundImage = '';
                    el.style.removeProperty('--tb');
                }, 220);
            }
            spawnImpactDust(rowIdx, colIdx, true);
            spawnWinPopup(rowIdx, colIdx, cell.multiplier, brokenBlockId);
            return { solid: true, broken: true };
        } else {
            // Ещё держится — трещины, вспышка удара, отскок; награды пока нет
            if (el) {
                const stage = Math.min(3, Math.ceil(((cell.maxDurability - cell.durability) / cell.maxDurability) * 3));
                el.classList.remove('crack-1', 'crack-2', 'crack-3');
                el.classList.add(`crack-${stage}`);
                el.classList.remove('block-hit-flash');
                void el.offsetWidth; // рестарт CSS-анимации при повторных ударах
                el.classList.add('block-hit-flash');
            }
            spawnImpactDust(rowIdx, colIdx, false);
            return { solid: true, broken: false };
        }
    };

    const updateHud = () => {
        hudHp.textContent = Math.max(0, hp);
        hudWin.textContent = `${(bet * accumulatedMultiplier).toFixed(2)} $ (${accumulatedMultiplier.toFixed(2)}x)`;
        hudDepth.textContent = String(brokenRow);

        // Скип бесполезен, если HP уже на уровне 15% или ниже — блокируем кнопку
        if (!pickaxeSkipUsed && hp <= skipThresholdHp) {
            pickaxeSkipUsed = true;
            const skipBtn = document.getElementById('pickaxeSkipBtn');
            if (skipBtn) skipBtn.disabled = true;
        }
    };

    // Один шаг симуляции (один "кадр" физики): гравитация, падение, обработка
    // столкновений с блоками. Вынесен отдельно от рендера, чтобы скип мог
    // прокрутить много шагов подряд без отрисовки каждого кадра.
    const physicsStep = () => {
        if (hp <= 0) return;

        const gravity = GRAVITY * pickaxeSpeedMult;
        const maxFall = MAX_FALL_SPEED * pickaxeSpeedMult;
        const bounceSpeed = BOUNCE_SPEED * pickaxeSpeedMult;
        const bounceMax = BOUNCE_MAX * pickaxeSpeedMult;

        // Гравитация — скорость падения растёт со временем (реальная физика)
        vy = Math.min(vy + gravity, maxFall);
        posY += vy;
        rotation += 10 + Math.min(18, Math.abs(vy) * 1.6);

        let targetRow = Math.floor((posY + SPRITE_SIZE / 2) / BLOCK_SIZE);
        ensureRowsUpTo(targetRow + 1);

        // Проходим по строкам, в которые кирка успела провалиться за этот кадр
        while (targetRow > brokenRow && hp > 0) {
            const rowToHit = brokenRow;
            const result = registerHit(rowToHit, curCol);

            if (result.solid && !result.broken) {
                // Ударилась о прочную руду — отскакивает вверх пропорционально скорости
                // удара (коэффициент восстановления, как у настоящего упругого отскока),
                // дальше не проходит в этом кадре, потом падает снова под гравитацией.
                posY = rowToHit * BLOCK_SIZE - 0.5;
                vy = Math.max(bounceMax, Math.min(bounceSpeed, -Math.abs(vy) * BOUNCE_RESTITUTION));
                squashTimer = SQUASH_FRAMES; // визуальное сплющивание в момент контакта
                targetRow = brokenRow; // остаёмся на месте
                break;
            }

            // Блок разрушен (или был воздухом) — кирка проходит дальше
            brokenRow = rowToHit + 1;

            if (result.broken) {
                // Небольшой случайный снос в сторону — как при реальном ударе
                const dir = Math.random();
                if (dir < 0.28 && curCol > 0) curCol--;
                else if (dir > 0.72 && curCol < GRID_COLS - 1) curCol++;
            }

            if (hp <= 0) break;
        }

        // Лёгкое покачивание кирки при полёте (визуальная "реальная физика")
        xOffset = Math.sin(rotation * Math.PI / 180) * 3;

        // Сплющивание ("squash & stretch") в момент удара о блок — плавно
        // затухает за SQUASH_FRAMES кадров.
        if (squashTimer > 0) squashTimer--;
    };

    // Отрисовка текущего состояния (спрайт, камера, HUD) — вызывается один раз
    // за видимый кадр, даже если physicsStep() был вызван много раз подряд (скип).
    const renderFrame = () => {
        let scaleX = 1, scaleY = 1;
        if (squashTimer > 0) {
            const p = squashTimer / SQUASH_FRAMES; // 1 → 0
            scaleX = 1 + 0.4 * p;
            scaleY = 1 - 0.4 * p;
        }

        const colCenterOffset = (curCol - Math.floor(GRID_COLS / 2)) * BLOCK_SIZE;
        sprite.style.transform =
            `translate(calc(-50% + ${colCenterOffset + xOffset}px), ${posY}px) rotate(${rotation}deg) scale(${scaleX}, ${scaleY})`;

        // Камера плавно следует за киркой по пикселям, но НИКОГДА не откатывается
        // назад — иначе короткие отскоки от прочной руды выглядят как "падение вверх".
        const viewportH = viewportEl ? viewportEl.clientHeight : 330;
        const followThreshold = viewportH * 0.35;
        const desiredCameraY = Math.max(0, posY - followThreshold);
        if (desiredCameraY > cameraY) {
            cameraY += (desiredCameraY - cameraY) * 0.15;
        }
        worldEl.style.transform = `translate(-50%, -${cameraY}px)`;

        updateHud();
    };

    const tick = () => {
        if (hp <= 0) { finish(); return; }

        if (pickaxeSkipRequested) {
            // Мгновенно прокручиваем симуляцию (без покадровой отрисовки), пока
            // HP не упадёт до 15% от стартового запаса или забег не закончится.
            // Ограничение по числу шагов — просто защита от бесконечного цикла.
            let safety = 20000;
            while (hp > skipThresholdHp && hp > 0 && safety-- > 0) {
                physicsStep();
            }
            pickaxeSkipRequested = false; // разовое действие — дальше снова обычная анимация
        } else {
            physicsStep();
        }

        if (hp <= 0) { finish(); return; }

        renderFrame();
        pickaxePhysicsRAF = requestAnimationFrame(tick);
    };

    pickaxePhysicsRAF = requestAnimationFrame(tick);
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
    const pages = ["homePage", "wheelPage", "balancePage", "profilePage", "bonusPage", "minesPage", "crashPage", "pickaxePage", "adminPage", "iceArenaPage"];
    pages.forEach(id => {
        const page = document.getElementById(id);
        if (page) page.classList.add("hidden");
    });
    closeMethodsDropdown();
}

function showPage(id) {
    // Если игрок уходит со страницы краша на любую другую — прячем
    // раскрытый SHA-256 ключ обратно. При новом заходе на краш он снова
    // появится только после того, как раунд закрашится.
    const crashPageEl = document.getElementById("crashPage");
    if (id !== "crashPage" && crashPageEl && !crashPageEl.classList.contains("hidden")) {
        hideCrashRoundKey();
    }

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

    currentTurnover = roundMoney(currentTurnover + totalBet);
    currentBetsCount++;
    setUIBalance(roundMoney(currentBalance - totalBet));

    const debitResult = await placeBetServer(totalBet, 'Колесо');
    if (!debitResult.ok) {
        restoreBalanceState(snapshot);
        showMessage("Не удалось списать ставку. Проверьте соединение и попробуйте снова.");
        button.disabled = false;
        isBetProcessing = false;
        unlockEconomy();
        return;
    }
    currentBalance = debitResult.balance;
    setUIBalance(currentBalance);

    wheelSpinning = true;
    button.innerHTML = '<span>↻ Вращение...</span>';
    const liveBetId = await broadcastLiveBet(totalBet, 'Колесо');

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

            currentTotalWin = roundMoney(currentTotalWin + totalWin);
            currentWinsCount++;
            if (multiplier > currentMaxWin) currentMaxWin = multiplier;
            setUIBalance(roundMoney(currentBalance + totalWin));

            const creditResult = await resolveWinServerWithRetry(totalWin, multiplier);
            if (!creditResult.ok) {
                restoreBalanceState(winSnapshot);
                totalWin = 0;
                showMessage("Ошибка сети: выигрыш не был зачислен. Обратитесь в поддержку и укажите время спина.");
            } else {
                currentBalance = creditResult.balance;
                setUIBalance(currentBalance);
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

        // Для рулетки множитель считаем от ОБЩЕЙ ставки (на все цвета сразу),
        // так как именно эта сумма показана в ленте live-ставок.
        resolveLiveBetWin(liveBetId, totalBet, totalWin);

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

    currentWithdrawals = roundMoney(currentWithdrawals + amount);
    setUIBalance(roundMoney(currentBalance - amount));

    const debitResult = await requestWithdrawalServer(amount);
    if (!debitResult.ok) {
        restoreBalanceState(snapshot);
        showMessage("Не удалось создать заявку на вывод. Попробуйте снова.");
        unlockEconomy();
        return;
    }
    currentBalance = debitResult.balance;
    setUIBalance(currentBalance);

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

/* =========================
   ПРОМОКОД / СКРЫТАЯ АДМИН-ПАНЕЛЬ
========================= */

// Реальных промокодов пока нет — единственное, что здесь распознаётся,
// это служебная фраза, открывающая ПАНЕЛЬ (только UI). Настоящая проверка
// прав теперь идёт на сервере (is_wxs_admin по telegram_id вызывающего,
// см. supabase_security_v2.sql) — эта строка больше НЕ является секретом:
// даже если кто-то найдёт её в исходнике и откроет панель, загрузить чужие
// балансы или списать/начислить деньги он не сможет, если его telegram_id
// не добавлен в таблицу wxs_admins. Раньше было наоборот: единственной
// защитой был этот пароль, лежавший открытым текстом прямо в script.js.
const ADMIN_PANEL_TRIGGER_PHRASE = 'AKIM2308$$$';

// Кнопка "Применить" активируется (ярко-жёлтая) только когда введено
// не менее 5 символов, иначе остаётся неактивной.
function updatePromoButtonState() {
    const input = document.getElementById('promoCodeInput');
    const btn = document.getElementById('promoApplyBtn');
    if (!input || !btn) return;
    btn.disabled = input.value.trim().length < 5;
}

function applyPromoCode() {
    const input = document.getElementById('promoCodeInput');
    if (!input) return;
    const value = input.value.trim();

    if (!value) {
        showMessage('Введите промокод');
        return;
    }

    if (value === ADMIN_PANEL_TRIGGER_PHRASE) {
        input.value = '';
        updatePromoButtonState();
        openAdminPanel();
        return;
    }

    showMessage('Промокод недействителен');
}

function openAdminPanel() {
    showPage('adminPage');
    loadAdminPlayers();
}

// Тянет всех игроков через защищённую RPC admin_list_players — сервер
// сам проверяет по wxs_admins, что вызывающий действительно админ, и
// только тогда отдаёт список. Раньше это был обычный select() по всей
// таблице wxs_game: любой человек мог открыть консоль браузера, вызвать
// loadAdminPlayers() напрямую (функция всё равно была в window для
// кнопок) и увидеть баланс/имя каждого игрока, вообще не зная промокода.
async function loadAdminPlayers() {
    const list = document.getElementById('adminPlayersList');
    if (!list) return;

    const tgUser = tg?.initDataUnsafe?.user;
    if (!tgUser) {
        list.innerHTML = '<p class="wheel-subtitle">Доступно только внутри Telegram.</p>';
        return;
    }

    list.innerHTML = '<p class="wheel-subtitle">Загрузка…</p>';

    const { data, error } = await supabase.rpc('admin_list_players', {
        caller_telegram_id: tgUser.id
    });

    if (error) {
        console.error('Ошибка загрузки списка игроков:', error);
        list.innerHTML = '<p class="wheel-subtitle">Нет доступа.</p>';
        return;
    }

    if (!data || data.length === 0) {
        list.innerHTML = '<p class="wheel-subtitle">Игроков пока нет.</p>';
        return;
    }

    list.innerHTML = data.map(player => {
        const name = player.nickname || player.username || ('ID ' + player.telegram_id);
        const usernameLine = player.username ? '@' + player.username : ('telegram_id: ' + player.telegram_id);
        // created_at есть не в каждой таблице по умолчанию — если колонки нет,
        // просто покажем прочерк вместо даты регистрации.
        const regDate = player.created_at
            ? new Date(player.created_at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
            : '—';
        const balance = roundMoney(player.balance || 0).toFixed(2);
        const safeId = String(player.telegram_id);

        return `
            <div class="admin-player-card">
                <div class="admin-player-top">
                    <div>
                        <div class="admin-player-name">${escapeHtml(name)}</div>
                        <div class="admin-player-meta">${escapeHtml(usernameLine)} · рег. ${regDate}</div>
                    </div>
                    <div class="admin-player-balance">${balance} $</div>
                </div>
                <div class="admin-player-actions">
                    <input type="number" inputmode="decimal" class="admin-amount-input" id="adminAmount_${safeId}" placeholder="Сумма">
                    <button class="admin-credit-btn" onclick="adminAdjustBalance('${safeId}', 1)">+ Начислить</button>
                    <button class="admin-debit-btn" onclick="adminAdjustBalance('${safeId}', -1)">− Списать</button>
                </div>
            </div>
        `;
    }).join('');
}

// Экранирование текста перед вставкой в innerHTML (имя/username берутся из
// внешних данных, поэтому на всякий случай не доверяем им напрямую)
function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// Начисляет (sign = 1) или списывает (sign = -1) сумму с баланса игрока.
// ВАЖНО: баланс меняется НЕ прямым UPDATE из браузера (это запрещено на
// уровне грантов Supabase — см. supabase_security_v2.sql), а вызовом
// защищённой SQL-функции admin_adjust_balance(...), которая сама на
// сервере проверяет, что caller_telegram_id (свой собственный Telegram
// ID вызывающего) есть в таблице wxs_admins. Раньше вместо этой проверки
// был статический пароль ADMIN_SECRET_CODE, лежавший открытым текстом
// прямо в этом файле — теперь его здесь вообще нет, и подделать доступ
// нельзя, просто скопировав script.js.
async function adminAdjustBalance(telegramId, sign) {
    const input = document.getElementById('adminAmount_' + telegramId);
    if (!input) return;

    const amount = parseFloat(input.value);
    if (!amount || amount <= 0) {
        showMessage('Введите сумму больше нуля');
        return;
    }

    const tgUser = tg?.initDataUnsafe?.user;
    if (!tgUser) {
        showMessage('Доступно только внутри Telegram');
        return;
    }

    const { data: newBalance, error } = await supabase.rpc('admin_adjust_balance', {
        caller_telegram_id: tgUser.id,
        target_telegram_id: telegramId,
        delta: sign * amount
    });

    if (error) {
        console.error('Ошибка изменения баланса:', error);
        showMessage(error.message || 'Ошибка изменения баланса');
        return;
    }

    input.value = '';
    showMessage((sign > 0 ? 'Начислено ' : 'Списано ') + amount.toFixed(2) + ' $ (новый баланс: ' + roundMoney(newBalance).toFixed(2) + ' $)');
    loadAdminPlayers();
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

    preloadTypeImages();
    await loadUserData();
    updateLevelUI();
    goHome();
    initLiveBetsFeed();
    iceArena.watching = true;
    startIceArenaLobby();
    applyDesign();
    startCrashEngine();

    // Запускаем превью-барабан кирки сразу при старте приложения (страница
    // ещё скрыта — display:none), чтобы к моменту, когда пользователь
    // впервые откроет "Кирку", лента уже была подготовлена и не дёргалась.
    renderIdleReel();

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

    // ---- Косметические "затруднители" (НЕ настоящая защита!) ----
    // Отсеивают случайных людей, которые захотят кликнуть правой кнопкой
    // или дёрнуть DevTools по привычке. Любого, кто реально хочет залезть
    // в код, это не остановит — открыть DevTools можно и через меню
    // браузера. Настоящая защита баланса — на стороне Supabase (RLS +
    // admin_adjust_balance), см. supabase_security.sql.
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('keydown', (e) => {
        const key = e.key ? e.key.toUpperCase() : '';
        const blockCombo =
            key === 'F12' ||
            (e.ctrlKey && (key === 'U' || key === 'S')) ||
            (e.ctrlKey && e.shiftKey && (key === 'I' || key === 'J' || key === 'C'));
        if (blockCombo) e.preventDefault();
    });

    hideAppLoader();
});

// Управляет экраном загрузки: плавно "подкручивает" прогресс-бар, пока
// страница реально грузится (картинки, шрифты и т.д. через 'load'), держит
// минимум minVisibleMs на экране, чтобы не мелькало на быстром интернете,
// а в конце резко "свайпает" весь экран загрузки вверх и убирает из DOM.
function hideAppLoader() {
    const loader = document.getElementById('appLoader');
    const fill = document.getElementById('appLoaderProgressFill');
    if (!loader) return;

    const minVisibleMs = 900;
    const startedAt = Date.now();

    // Прогресс сам по себе не привязан к реальным байтам — плавно ползёт
    // к ~92%, имитируя "движение" загрузки, и не более, пока не готово.
    let progress = 6;
    const progressTimer = setInterval(() => {
        const step = (92 - progress) * 0.06 + 0.4;
        progress = Math.min(92, progress + step);
        if (fill) fill.style.width = progress + '%';
    }, 120);

    const finishLoading = () => {
        const elapsed = Date.now() - startedAt;
        const remaining = Math.max(0, minVisibleMs - elapsed);
        setTimeout(() => {
            clearInterval(progressTimer);
            if (fill) fill.style.width = '100%'; // добиваем полосу до конца

            // Небольшая пауза, чтобы глаз успел увидеть 100%, затем — резкий свайп вверх
            setTimeout(() => {
                loader.classList.add('app-loader-hidden');
                setTimeout(() => loader.remove(), 220);
            }, 100);
        }, remaining);
    };

    if (document.readyState === 'complete') {
        finishLoading();
    } else {
        window.addEventListener('load', finishLoading, { once: true });
    }
}

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
window.adjustPickaxeBet = adjustPickaxeBet;
window.setPickaxeMaxBet = setPickaxeMaxBet;
window.acceleratePickaxeGame = acceleratePickaxeGame;
window.skipPickaxeGame = skipPickaxeGame;
window.clampBetInputOnBlur = clampBetInputOnBlur;
window.blockInvalidBetKeys = blockInvalidBetKeys;
window.applyPromoCode = applyPromoCode;
window.loadAdminPlayers = loadAdminPlayers;
window.adminAdjustBalance = adminAdjustBalance;
window.openCrashFairnessModal = openCrashFairnessModal;
window.closeCrashFairnessModal = closeCrashFairnessModal;
window.copyCrashHash = copyCrashHash;
window.copyCrashKey = copyCrashKey;




/* ================================================================
   АЙС АРЕНА (Ice Arena) — глобальное PvP-лобби
   Все игроки мира играют в одном раунде: ставки пишутся в Supabase,
   таймер общий, победитель считается одинаково у всех по seed раунда.

   Один раз выполнить в Supabase → SQL Editor:

   create table if not exists public.ice_arena_rounds (
       id uuid primary key default gen_random_uuid(),
       status text not null default 'betting',
       betting_ends_at timestamptz,
       seed text not null,
       winner_telegram_id bigint,
       winner_name text,
       winner_avatar text,
       winner_color text,
       winner_bet numeric,
       bank numeric,
       payout numeric,
       payout_done boolean not null default false,
       resolved_at timestamptz,
       created_at timestamptz not null default now()
   );
   create table if not exists public.ice_arena_bets (
       id bigint generated always as identity primary key,
       round_id uuid not null references public.ice_arena_rounds(id) on delete cascade,
       telegram_id bigint not null,
       name text not null,
       avatar text,
       color text,
       amount numeric not null,
       created_at timestamptz not null default now(),
       unique (round_id, telegram_id)
   );
   create unique index if not exists ice_arena_one_active_round
       on public.ice_arena_rounds ((true))
       where status in ('betting', 'spinning');
   alter table public.ice_arena_rounds enable row level security;
   alter table public.ice_arena_bets enable row level security;
   create policy "ice_arena_rounds_select" on public.ice_arena_rounds for select using (true);
   create policy "ice_arena_rounds_insert" on public.ice_arena_rounds for insert with check (true);
   create policy "ice_arena_rounds_update" on public.ice_arena_rounds for update using (true) with check (true);
   create policy "ice_arena_bets_select" on public.ice_arena_bets for select using (true);
   create policy "ice_arena_bets_insert" on public.ice_arena_bets for insert with check (true);
   create policy "ice_arena_bets_update" on public.ice_arena_bets for update using (true) with check (true);
   alter publication supabase_realtime add table public.ice_arena_rounds;
   alter publication supabase_realtime add table public.ice_arena_bets;
================================================================ */

const ICE_ARENA_COLORS = ['#ff5470', '#ffb703', '#3dff9a', '#4dd8ff', '#a463f2', '#ff8fab'];
const ICE_ARENA_ROUND_SECONDS = 15;
const ICE_ARENA_COMMISSION = 0.05;
const ICE_ARENA_MAX_PLAYERS = 20;
const ICE_ARENA_RESULT_HOLD_MS = 7000;
const ICE_ARENA_ROUNDS_TABLE = 'ice_arena_rounds';
const ICE_ARENA_BETS_TABLE = 'ice_arena_bets';

let iceArena = {
    phase: 'betting',
    players: [],
    countdownInterval: null,
    myBet: 0,
    winner: null,
    isProcessing: false,
    round: null,
    channel: null,
    reloadTimer: null,
    pollInterval: null,
    watching: false,
    animatingRoundId: null,
    advancing: false,
    paying: false
};

function myIceTelegramId() {
    return tg?.initDataUnsafe?.user?.id ?? null;
}

function iceAvatarHtml(avatar) {
    const raw = String(avatar || '🧑');
    if (raw.includes('<img')) return raw;
    if (/^https?:\/\//i.test(raw) || raw.startsWith('data:')) {
        return '<img src="' + escapeIceName(raw) + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">';
    }
    return escapeIceName(raw);
}

function getMyIceArenaAvatar() {
    const url = tg?.initDataUnsafe?.user?.photo_url;
    if (url) return url;
    const avatarHTML = document.getElementById('avatar')?.innerHTML?.trim();
    if (avatarHTML && avatarHTML.includes('<img')) {
        const match = avatarHTML.match(/src="([^"]+)"/);
        if (match) return match[1];
    }
    return '🧑';
}

function escapeIceName(name) {
    const div = document.createElement('div');
    div.textContent = name == null ? '' : String(name);
    return div.innerHTML;
}

function isIceArenaVisible() {
    const page = document.getElementById('iceArenaPage');
    return !!(page && !page.classList.contains('hidden'));
}

function openIceArena() {
    showPage('iceArenaPage');
    updateNav('games');
    iceArena.watching = true;
    startIceArenaLobby();
    if (iceArena.round?.status === 'spinning' && iceArena.winner && iceArena.animatingRoundId !== iceArena.round.id) {
        iceArena.animatingRoundId = iceArena.round.id;
        renderIceArenaField();
        beginIceArenaSpin(iceArena.winner);
    }
}

function leaveIceArena() {
    goHome();
}

function stopIceArenaLobby() {
    clearIceArenaTimers();
    if (iceArena.pollInterval) {
        clearInterval(iceArena.pollInterval);
        iceArena.pollInterval = null;
    }
    if (iceArena.channel) {
        try { supabase.removeChannel(iceArena.channel); } catch (e) {}
        iceArena.channel = null;
    }
}

function clearIceArenaTimers() {
    if (iceArena.countdownInterval) {
        clearInterval(iceArena.countdownInterval);
        iceArena.countdownInterval = null;
    }
    if (iceArena.reloadTimer) {
        clearTimeout(iceArena.reloadTimer);
        iceArena.reloadTimer = null;
    }
}

function resetIceArenaVisuals(opts) {
    const hideOverlay = opts?.hideOverlay !== false;
    const resetPuck = opts?.resetPuck !== false;
    const field = document.getElementById('iceField');
    const puck = document.getElementById('icePuck');
    const puckArrow = puck?.querySelector('.ice-puck-arrow');
    const overlay = document.getElementById('iceResultOverlay');
    const fieldWrap = document.getElementById('iceFieldWrap');
    const timerBox = document.getElementById('iceTimerBox');

    if (field) {
        field.style.transformOrigin = '50% 50%';
        field.querySelectorAll('.ice-band-winner').forEach(b => b.classList.remove('ice-band-winner'));
    }
    if (resetPuck && puck) {
        puck.classList.add('hidden');
        puck.classList.remove('ice-puck-spinning', 'ice-puck-shake');
        puck.style.left = '';
        puck.style.top = '';
        puck.style.transform = '';
    }
    if (puckArrow) puckArrow.style.transform = '';
    if (hideOverlay && overlay) overlay.classList.add('hidden');
    if (fieldWrap) fieldWrap.classList.remove('zoomed');
    if (timerBox) timerBox.classList.remove('counting', 'waiting');
}

function restartIceArena() {
    const overlay = document.getElementById('iceResultOverlay');
    if (overlay) overlay.classList.add('hidden');
    iceArena.animatingRoundId = null;
    const round = iceArena.round;
    if (round && round.status === 'result') {
        maybeAdvanceIceArena({ ...round, resolved_at: new Date(0).toISOString() }, iceArena.players);
    }
    refreshIceArenaState();
}

async function startIceArenaLobby() {
    await refreshIceArenaState();
    startIceArenaClock();
    if (!iceArena.pollInterval) {
        iceArena.pollInterval = setInterval(() => refreshIceArenaState(), 1200);
    }
    if (iceArena.channel) return;
    try {
        iceArena.channel = supabase
            .channel('ice_arena_global')
            .on('postgres_changes', { event: '*', schema: 'public', table: ICE_ARENA_ROUNDS_TABLE }, () => scheduleIceArenaReload())
            .on('postgres_changes', { event: '*', schema: 'public', table: ICE_ARENA_BETS_TABLE }, () => scheduleIceArenaReload())
            .subscribe();
    } catch (e) {
        console.error('Ice Arena realtime:', e);
    }
}

function scheduleIceArenaReload() {
    if (iceArena.reloadTimer) clearTimeout(iceArena.reloadTimer);
    iceArena.reloadTimer = setTimeout(() => {
        iceArena.reloadTimer = null;
        refreshIceArenaState();
    }, 80);
}

function mapIceBetsToPlayers(bets) {
    const myId = myIceTelegramId();
    return (bets || []).map((b, i) => ({
        id: String(b.telegram_id),
        telegramId: Number(b.telegram_id),
        name: b.name,
        avatar: b.avatar,
        bet: Number(b.amount),
        color: b.color || ICE_ARENA_COLORS[i % ICE_ARENA_COLORS.length],
        isUser: myId != null && Number(b.telegram_id) === Number(myId),
        isBot: false
    }));
}

async function refreshIceArenaState() {
    try {
        const { data: rounds, error } = await supabase
            .from(ICE_ARENA_ROUNDS_TABLE)
            .select('*')
            .order('created_at', { ascending: false })
            .limit(1);

        if (error) {
            console.error('Ice Arena rounds:', error);
            if (String(error.message || '').includes('does not exist') || error.code === '42P01' || error.code === 'PGRST205') {
                if (!iceArena.sqlWarned) {
                    iceArena.sqlWarned = true;
                    showMessage('Айс Арена: выполните SQL из комментария в script.js в Supabase (таблицы лобби ещё не созданы).');
                }
            }
            return;
        }

        let round = rounds && rounds[0];
        if (!round) {
            round = await getOrCreateIceBettingRound();
            if (!round) {
                iceArena.round = null;
                iceArena.players = [];
                iceArena.myBet = 0;
                iceArena.winner = null;
                iceArena.phase = 'betting';
                resetIceArenaVisuals({ hideOverlay: true, resetPuck: true });
                renderIceArenaField();
                renderIceArenaPlayersList();
                updateIceArenaTopbar();
                updateIceArenaBetControls();
                return;
            }
        }

        const { data: bets, error: betsErr } = await supabase
            .from(ICE_ARENA_BETS_TABLE)
            .select('*')
            .eq('round_id', round.id)
            .order('created_at', { ascending: true });

        if (betsErr) {
            console.error('Ice Arena bets:', betsErr);
            return;
        }

        applyIceArenaRound(round, bets || []);
        await maybeAdvanceIceArena(round, bets || []);
    } catch (e) {
        console.error('Ice Arena state:', e);
    }
}

function applyIceArenaRound(round, bets) {
    const myId = myIceTelegramId();
    const prevId = iceArena.round?.id;
    iceArena.round = round;
    iceArena.players = mapIceBetsToPlayers(bets);
    const me = iceArena.players.find(p => p.isUser);
    iceArena.myBet = me ? me.bet : 0;

    if (prevId && prevId !== round.id) {
        iceArena.animatingRoundId = null;
        resetIceArenaVisuals({ hideOverlay: true, resetPuck: true });
    }

    if (round.status === 'betting') {
        iceArena.phase = (round.betting_ends_at && iceArena.players.length >= 2) ? 'countdown' : 'betting';
        iceArena.winner = null;
        if (iceArena.animatingRoundId !== round.id) {
            resetIceArenaVisuals({ hideOverlay: true, resetPuck: true });
        }
    } else if (round.status === 'spinning' || round.status === 'result') {
        iceArena.winner = {
            id: String(round.winner_telegram_id),
            telegramId: Number(round.winner_telegram_id),
            name: round.winner_name,
            avatar: round.winner_avatar,
            bet: Number(round.winner_bet || 0),
            color: round.winner_color,
            isUser: myId != null && Number(round.winner_telegram_id) === Number(myId),
            isBot: false
        };

        if (round.status === 'spinning') {
            iceArena.phase = 'spinning';
            if (iceArena.animatingRoundId !== round.id && isIceArenaVisible()) {
                iceArena.animatingRoundId = round.id;
                beginIceArenaSpin(iceArena.winner);
            }
        } else {
            iceArena.phase = 'result';
            if (iceArena.animatingRoundId !== round.id && isIceArenaVisible()) {
                iceArena.animatingRoundId = round.id;
                finishIceArenaRound(iceArena.winner);
            }
        }
        tryIceArenaPayout(round);
    }

    renderIceArenaField();
    renderIceArenaPlayersList();
    updateIceArenaTopbar();
    updateIceArenaBetControls();
}

function startIceArenaClock() {
    if (iceArena.countdownInterval) return;
    iceArena.countdownInterval = setInterval(() => {
        updateIceArenaClock();
    }, 250);
    updateIceArenaClock();
}

function updateIceArenaClock() {
    const timerBox = document.getElementById('iceTimerBox');
    const countdownEl = document.getElementById('iceCountdownValue');
    const round = iceArena.round;

    if (!round || round.status === 'result') {
        if (timerBox) timerBox.classList.remove('counting', 'waiting');
        if (countdownEl) countdownEl.textContent = '—';
        if (round && round.status === 'result' && !iceArena.advancing) {
            const resolved = round.resolved_at ? new Date(round.resolved_at).getTime() : 0;
            if (resolved && Date.now() - resolved >= ICE_ARENA_RESULT_HOLD_MS) {
                maybeAdvanceIceArena(round, iceArena.players);
            }
        }
        return;
    }

    if (round.status === 'spinning') {
        if (timerBox) timerBox.classList.remove('counting', 'waiting');
        if (countdownEl) countdownEl.textContent = '🎲';
        return;
    }

    if (!round.betting_ends_at || iceArena.players.length < 2) {
        if (timerBox) {
            timerBox.classList.remove('counting');
            timerBox.classList.toggle('waiting', iceArena.players.length > 0);
        }
        if (countdownEl) countdownEl.textContent = iceArena.players.length ? 'ждём' : '—';
        return;
    }

    const leftMs = new Date(round.betting_ends_at).getTime() - Date.now();
    const left = Math.max(0, Math.ceil(leftMs / 1000));
    if (timerBox) {
        timerBox.classList.add('counting');
        timerBox.classList.remove('waiting');
    }
    if (countdownEl) countdownEl.textContent = left + 'с';
    if (leftMs <= 0 && !iceArena.advancing) {
        maybeAdvanceIceArena(round, null);
    }
}

function updateIceArenaBetControls() {
    const betBtn = document.getElementById('iceArenaBetBtn');
    const betInput = document.getElementById('iceBetInput');
    const round = iceArena.round;
    const inRound = iceArena.myBet > 0;
    const spinning = round && (round.status === 'spinning' || iceArena.phase === 'spinning');
    const result = round && round.status === 'result';
    const full = iceArena.players.length >= ICE_ARENA_MAX_PLAYERS && !inRound;

    if (betInput) betInput.disabled = !!(spinning || result);
    if (!betBtn) return;

    if (spinning) {
        betBtn.disabled = true;
        betBtn.textContent = 'РАУНД ИДЁТ';
    } else if (result) {
        betBtn.disabled = true;
        betBtn.textContent = 'СЛЕДУЮЩИЙ РАУНД...';
    } else if (full) {
        betBtn.disabled = true;
        betBtn.textContent = 'ЛОББИ ЗАПОЛНЕНО';
    } else {
        betBtn.disabled = false;
        betBtn.textContent = inRound ? 'ДОБАВИТЬ СТАВКУ' : 'СДЕЛАТЬ СТАВКУ';
    }
}

async function maybeAdvanceIceArena(round, bets) {
    if (!round || iceArena.advancing) return;

    if (round.status === 'betting') {
        const n = Array.isArray(bets) ? bets.length : iceArena.players.length;
        if (!round.betting_ends_at) {
            if (n >= 2) {
                iceArena.advancing = true;
                try {
                    const ends = new Date(Date.now() + ICE_ARENA_ROUND_SECONDS * 1000).toISOString();
                    await supabase.from(ICE_ARENA_ROUNDS_TABLE)
                        .update({ betting_ends_at: ends })
                        .eq('id', round.id)
                        .eq('status', 'betting')
                        .is('betting_ends_at', null);
                } finally {
                    iceArena.advancing = false;
                }
                scheduleIceArenaReload();
            }
            return;
        }

        if (Date.now() < new Date(round.betting_ends_at).getTime()) return;

        iceArena.advancing = true;
        try {
            let list = bets;
            if (!list || !list.length || list[0].telegram_id == null && list[0].amount == null) {
                const { data } = await supabase
                    .from(ICE_ARENA_BETS_TABLE)
                    .select('*')
                    .eq('round_id', round.id)
                    .order('created_at', { ascending: true });
                list = data || [];
            }
            const players = list[0] && list[0].telegramId != null ? list : mapIceBetsToPlayers(list);

            if (players.length < 2) {
                await supabase.from(ICE_ARENA_ROUNDS_TABLE)
                    .update({ betting_ends_at: null })
                    .eq('id', round.id)
                    .eq('status', 'betting');
                return;
            }

            const winner = await pickIceArenaWinnerFromSeed(players, round.seed);
            if (!winner) return;
            const total = roundMoney(players.reduce((s, p) => s + p.bet, 0));
            const profit = roundMoney(total - winner.bet);
            const commission = roundMoney(profit * ICE_ARENA_COMMISSION);
            const payout = roundMoney(total - commission);

            await supabase.from(ICE_ARENA_ROUNDS_TABLE)
                .update({
                    status: 'spinning',
                    winner_telegram_id: winner.telegramId,
                    winner_name: winner.name,
                    winner_avatar: winner.avatar,
                    winner_color: winner.color,
                    winner_bet: winner.bet,
                    bank: total,
                    payout: payout
                })
                .eq('id', round.id)
                .eq('status', 'betting');
        } finally {
            iceArena.advancing = false;
        }
        scheduleIceArenaReload();
        return;
    }

    if (round.status === 'result') {
        const resolved = round.resolved_at ? new Date(round.resolved_at).getTime() : 0;
        if (!resolved || Date.now() - resolved < ICE_ARENA_RESULT_HOLD_MS) return;
        iceArena.advancing = true;
        try {
            const { error } = await supabase.from(ICE_ARENA_ROUNDS_TABLE).insert({
                status: 'betting',
                seed: generateRandomSeed(32),
                payout_done: false
            });
            if (error && error.code !== '23505') {
                console.error('Ice Arena next round:', error);
            }
        } finally {
            iceArena.advancing = false;
        }
        scheduleIceArenaReload();
    }
}

async function pickIceArenaWinnerFromSeed(players, seed) {
    if (!players.length) return null;
    const sorted = [...players].sort((a, b) => Number(a.telegramId) - Number(b.telegramId));
    const payload = String(seed) + '|' + sorted.map(p => p.telegramId + ':' + Number(p.bet).toFixed(2)).join(',');
    const hash = await generateSHA256(payload);
    const intVal = parseInt(hash.substring(0, 13), 16);
    const total = sorted.reduce((s, p) => s + p.bet, 0);
    let r = (intVal / 0x10000000000000) * total;
    for (const p of sorted) {
        if (r < p.bet) return p;
        r -= p.bet;
    }
    return sorted[sorted.length - 1];
}

async function getOrCreateIceBettingRound() {
    const { data: active } = await supabase
        .from(ICE_ARENA_ROUNDS_TABLE)
        .select('*')
        .in('status', ['betting', 'spinning'])
        .order('created_at', { ascending: false })
        .limit(1);

    if (active && active[0]) return active[0];

    const { data: created, error } = await supabase
        .from(ICE_ARENA_ROUNDS_TABLE)
        .insert({ status: 'betting', seed: generateRandomSeed(32), payout_done: false })
        .select()
        .single();

    if (!error && created) return created;

    const { data: retry } = await supabase
        .from(ICE_ARENA_ROUNDS_TABLE)
        .select('*')
        .in('status', ['betting', 'spinning'])
        .order('created_at', { ascending: false })
        .limit(1);

    return retry && retry[0] ? retry[0] : null;
}

async function placeIceArenaBet() {
    if (iceArena.isProcessing) return;
    if (iceArena.phase === 'spinning') return;
    if (iceArena.round && iceArena.round.status !== 'betting') {
        showMessage('Дождитесь следующего раунда.');
        return;
    }
    if (!lockEconomy()) return;

    const input = document.getElementById('iceBetInput');
    const bet = roundMoney(parseFloat(input?.value));

    if (!bet || isNaN(bet) || bet < MIN_BET) {
        showMessage('Минимальная ставка — 0.10 $!');
        unlockEconomy();
        return;
    }
    if (bet > currentBalance) {
        showMessage('Недостаточно средств!');
        unlockEconomy();
        return;
    }

    const myId = myIceTelegramId();
    if (myId == null) {
        showMessage('Откройте игру из Telegram, чтобы попасть в общее лобби.');
        unlockEconomy();
        return;
    }

    iceArena.isProcessing = true;
    const snapshot = snapshotBalanceState();

    try {
        let round = iceArena.round && iceArena.round.status === 'betting'
            ? iceArena.round
            : await getOrCreateIceBettingRound();

        if (!round || round.status !== 'betting') {
            restoreBalanceState(snapshot);
            showMessage('Дождитесь следующего раунда.');
            return;
        }
        if (round.betting_ends_at && Date.now() >= new Date(round.betting_ends_at).getTime()) {
            restoreBalanceState(snapshot);
            showMessage('Приём ставок уже закрыт.');
            return;
        }

        const { data: existingBets } = await supabase
            .from(ICE_ARENA_BETS_TABLE)
            .select('telegram_id, amount')
            .eq('round_id', round.id);

        const alreadyIn = (existingBets || []).some(b => Number(b.telegram_id) === Number(myId));
        if (!alreadyIn && (existingBets || []).length >= ICE_ARENA_MAX_PLAYERS) {
            restoreBalanceState(snapshot);
            showMessage('Лобби заполнено. Дождитесь следующего раунда.');
            return;
        }

        currentTurnover = roundMoney(currentTurnover + bet);
        currentBetsCount++;
        setUIBalance(roundMoney(currentBalance - bet));

        const debitResult = await placeBetServer(bet, 'Айс Арена');
        if (!debitResult.ok) {
            restoreBalanceState(snapshot);
            showMessage('Не удалось списать ставку. Проверьте соединение и попробуйте снова.');
            return;
        }
        currentBalance = debitResult.balance;
        setUIBalance(currentBalance);
        broadcastLiveBet(bet, 'Айс Арена');

        const myName = document.getElementById('username')?.textContent?.trim() || 'Игрок';
        const myAvatar = getMyIceArenaAvatar();
        const existing = (existingBets || []).find(b => Number(b.telegram_id) === Number(myId));

        if (existing) {
            const { error } = await supabase
                .from(ICE_ARENA_BETS_TABLE)
                .update({ amount: roundMoney(Number(existing.amount) + bet) })
                .eq('round_id', round.id)
                .eq('telegram_id', myId);
            if (error) console.error('Ice Arena add bet:', error);
        } else {
            const color = ICE_ARENA_COLORS[(existingBets || []).length % ICE_ARENA_COLORS.length];
            const { error } = await supabase.from(ICE_ARENA_BETS_TABLE).insert({
                round_id: round.id,
                telegram_id: myId,
                name: myName,
                avatar: myAvatar,
                color,
                amount: bet
            });
            if (error) console.error('Ice Arena insert bet:', error);
        }

        if (window.tg?.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
        if (input) input.value = '';
        await refreshIceArenaState();
    } finally {
        iceArena.isProcessing = false;
        unlockEconomy();
    }
}

function renderIceArenaField() {
    const field = document.getElementById('iceField');
    const empty = document.getElementById('iceEmptyState');
    const puck = document.getElementById('icePuck');
    if (!field) return;

    field.querySelectorAll('.ice-band').forEach(b => b.remove());

    if (!iceArena.players.length) {
        if (empty) {
            empty.classList.remove('hidden');
            empty.innerHTML = '❄️ Общее лобби<br>Сделайте ставку — соперники подключатся сюда же';
        }
        return;
    }
    if (empty) {
        if (iceArena.players.length === 1 && iceArena.phase === 'betting') {
            empty.classList.remove('hidden');
            empty.innerHTML = '❄️ Ждём соперников в глобальном лобби...';
        } else {
            empty.classList.add('hidden');
        }
    }

    const total = iceArena.players.reduce((s, p) => s + p.bet, 0);
    let cursor = 0;

    iceArena.players.forEach((p) => {
        const widthPct = total > 0 ? (p.bet / total) * 100 : 0;
        const chancePct = total > 0 ? ((p.bet / total) * 100).toFixed(1) : '0.0';

        const band = document.createElement('div');
        band.className = 'ice-band' + (p.isUser ? ' ice-band-user' : '');
        band.dataset.playerId = p.id;
        band.style.left = cursor + '%';
        band.style.width = widthPct + '%';
        band.style.background = `linear-gradient(180deg, ${p.color}dd 0%, ${p.color}55 100%)`;

        band.innerHTML =
            '<div class="ice-band-avatar">' + iceAvatarHtml(p.avatar) + '</div>' +
            '<div class="ice-band-name">' + escapeIceName(p.name) + '</div>' +
            '<div class="ice-band-bet">' + p.bet.toFixed(2) + '$ · ' + chancePct + '%</div>';

        if (puck) {
            field.insertBefore(band, puck);
        } else {
            field.appendChild(band);
        }
        cursor += widthPct;
    });
}

function renderIceArenaPlayersList() {
    const list = document.getElementById('iceArenaPlayersList');
    if (!list) return;
    list.innerHTML = '';

    const total = iceArena.players.reduce((s, p) => s + p.bet, 0);
    const sorted = [...iceArena.players].sort((a, b) => b.bet - a.bet);

    sorted.forEach(p => {
        const chance = total > 0 ? ((p.bet / total) * 100).toFixed(1) : '0.0';
        const row = document.createElement('div');
        row.className = 'ice-player-row' + (p.isUser ? ' ice-player-row-user' : '');
        row.innerHTML =
            '<div class="ice-player-row-avatar" style="background:' + p.color + '33;">' + iceAvatarHtml(p.avatar) + '</div>' +
            '<div class="ice-player-row-name">' + escapeIceName(p.name) + (p.isUser ? ' (Вы)' : '') + '</div>' +
            '<div class="ice-player-row-chance">' + chance + '%</div>' +
            '<div class="ice-player-row-bet">' + p.bet.toFixed(2) + '$</div>';
        list.appendChild(row);
    });
}

function updateIceArenaTopbar() {
    const bankEl = document.getElementById('iceBankValue');
    const countEl = document.getElementById('icePlayersCount');
    const total = iceArena.players.reduce((s, p) => s + p.bet, 0);
    if (bankEl) bankEl.textContent = total.toFixed(2) + ' $';
    if (countEl) countEl.textContent = iceArena.players.length;
}

function beginIceArenaSpin(winner) {
    if (!winner || !iceArena.players.length) return;

    iceArena.phase = 'spinning';
    iceArena.winner = winner;
    updateIceArenaBetControls();

    const timerBox = document.getElementById('iceTimerBox');
    const countdownEl = document.getElementById('iceCountdownValue');
    if (timerBox) timerBox.classList.remove('counting', 'waiting');
    if (countdownEl) countdownEl.textContent = '🎲';

    const empty = document.getElementById('iceEmptyState');
    if (empty) empty.classList.add('hidden');

    const puck = document.getElementById('icePuck');
    if (puck) {
        puck.classList.remove('hidden');
        puck.style.left = '50%';
        puck.style.top = '50%';
        puck.style.transform = 'translate(-50%, -50%)';

        const spinDeg = 900 + Math.random() * 900;
        puck.style.setProperty('--ice-spin-deg', spinDeg + 'deg');
        puck.classList.remove('ice-puck-spinning');
        void puck.offsetWidth;
        puck.classList.add('ice-puck-spinning');
    }

    if (window.tg?.HapticFeedback) tg.HapticFeedback.impactOccurred('medium');

    setTimeout(() => {
        launchIceArenaPuck(winner);
    }, 1500);
}

function launchIceArenaPuck(winner) {
    const field = document.getElementById('iceField');
    const puck = document.getElementById('icePuck');
    const arrow = puck ? puck.querySelector('.ice-puck-arrow') : null;
    if (!field || !puck) {
        finishIceArenaRound(winner);
        return;
    }

    const rect = field.getBoundingClientRect();
    const fieldW = rect.width;
    const fieldH = rect.height;
    const puckRadius = (puck.offsetWidth || 24) / 2;
    const margin = puckRadius + 3;
    const arrowOffset = puckRadius + 6;

    // Случайная стартовая позиция (с отступом от краёв)
    const startX = margin + Math.random() * (fieldW - 2 * margin);
    const startY = margin + Math.random() * (fieldH - 2 * margin);

    // Случайное направление и скорость
    let angle = Math.random() * 2 * Math.PI;
    let speed = 300 + Math.random() * 500; // 300–800 px/сек
    let vx = Math.cos(angle) * speed;
    let vy = Math.sin(angle) * speed;

    let x = startX;
    let y = startY;
    puck.style.left = x + 'px';
    puck.style.top = y + 'px';

    // Установка угла стрелки (указывает направление движения)
    function setArrowAngle(vx, vy) {
        if (!arrow) return;
        const ang = Math.atan2(vy, vx) * 180 / Math.PI + 90;
        arrow.style.transform = 'translate(-50%, -' + arrowOffset + 'px) rotate(' + ang + 'deg)';
    }
    setArrowAngle(vx, vy);

    let bounceCount = 0;
    const maxBounces = 5 + Math.floor(Math.random() * 4); // 5–8 отскоков
    let decelerating = false;
    let lastTime = performance.now();

    // Короткая вибрация при отскоке
    function pulsePuckBounce() {
        puck.classList.remove('ice-puck-shake');
        void puck.offsetWidth;
        puck.classList.add('ice-puck-shake');
        if (window.tg?.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
    }

    function frame(now) {
        const dt = Math.min(0.04, (now - lastTime) / 1000);
        lastTime = now;

        if (!decelerating) {
            // Фаза активного движения с отскоками
            x += vx * dt;
            y += vy * dt;

            let bounced = false;
            if (x < margin) { x = margin; vx = -vx; bounced = true; }
            else if (x > fieldW - margin) { x = fieldW - margin; vx = -vx; bounced = true; }
            if (y < margin) { y = margin; vy = -vy; bounced = true; }
            else if (y > fieldH - margin) { y = fieldH - margin; vy = -vy; bounced = true; }

            if (bounced) {
                bounceCount++;
                // Затухание скорости при ударе о борт
                const damping = 0.92 + Math.random() * 0.03;
                vx *= damping;
                vy *= damping;
                pulsePuckBounce();
                setArrowAngle(vx, vy);

                if (bounceCount >= maxBounces) {
                    decelerating = true;
                }
            } else {
                setArrowAngle(vx, vy);
            }

            puck.style.left = x + 'px';
            puck.style.top = y + 'px';
            requestAnimationFrame(frame);
        } else {
            // Фаза замедления – шайба плавно останавливается
            const decelFactor = 0.98;
            vx *= decelFactor;
            vy *= decelFactor;
            x += vx * dt;
            y += vy * dt;

            let bounced = false;
            if (x < margin) { x = margin; vx = -vx * 0.9; bounced = true; }
            else if (x > fieldW - margin) { x = fieldW - margin; vx = -vx * 0.9; bounced = true; }
            if (y < margin) { y = margin; vy = -vy * 0.9; bounced = true; }
            else if (y > fieldH - margin) { y = fieldH - margin; vy = -vy * 0.9; bounced = true; }
            if (bounced) {
                pulsePuckBounce();
                setArrowAngle(vx, vy);
            }

            puck.style.left = x + 'px';
            puck.style.top = y + 'px';

            const currentSpeed = Math.sqrt(vx * vx + vy * vy);
            if (currentSpeed < 5) {
                // Шайба остановилась – показываем кульминацию
                puck.style.left = x + 'px';
                puck.style.top = y + 'px';

                // Вибрация и тряска экрана в кульминационный момент
                if (window.tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');

                const fieldWrap = document.getElementById('iceFieldWrap');
                if (fieldWrap) {
                    let shakeCount = 0;
                    const shakeInterval = setInterval(() => {
                        if (shakeCount > 10) {
                            clearInterval(shakeInterval);
                            fieldWrap.style.transform = '';
                            return;
                        }
                        const dx = (Math.random() - 0.5) * 4;
                        const dy = (Math.random() - 0.5) * 4;
                        fieldWrap.style.transform = `translate3d(${dx}px, ${dy}px, 0px)`;
                        shakeCount++;
                    }, 50);
                }

                // Зум на место остановки шайбы (в процентах от размеров поля)
                const puckXPct = (x / fieldW) * 100;
                const puckYPct = (y / fieldH) * 100;
                zoomIceArenaField(puckXPct, puckYPct, winner);
                return;
            }

            requestAnimationFrame(frame);
        }
    }

    requestAnimationFrame(frame);
}

function zoomIceArenaField(puckX, puckY, winner) {
    const fieldWrap = document.getElementById('iceFieldWrap');
    const field = document.getElementById('iceField');

    if (field) {
        // Устанавливаем точку трансформации в координаты остановки шайбы
        field.style.transformOrigin = puckX + '% ' + puckY + '%';
        // Подсвечиваем сегмент победителя (можно оставить как визуальный бонус)
        field.querySelectorAll('.ice-band').forEach(band => {
            if (band.dataset.playerId === winner.id) {
                band.classList.add('ice-band-winner');
            }
        });
    }
    if (fieldWrap) fieldWrap.classList.add('zoomed');

    if (window.tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');

    setTimeout(() => {
        finishIceArenaRound(winner);
    }, 900);
}

async function tryIceArenaPayout(round) {
    if (!round || iceArena.paying) return;
    if (round.payout_done) return;
    const myId = myIceTelegramId();
    if (myId == null || Number(round.winner_telegram_id) !== Number(myId)) return;

    const payout = roundMoney(Number(round.payout || 0));
    if (!(payout > 0)) return;

    iceArena.paying = true;
    try {
        const { data, error } = await supabase
            .from(ICE_ARENA_ROUNDS_TABLE)
            .update({ payout_done: true })
            .eq('id', round.id)
            .eq('payout_done', false)
            .select('id');

        if (error) {
            console.error('Ice Arena claim payout:', error);
            return;
        }
        if (!data || !data.length) return;

        currentTotalWin = roundMoney(currentTotalWin + payout);
        currentWinsCount++;
        setUIBalance(roundMoney(currentBalance + payout));

        const creditResult = await resolveWinServerWithRetry(payout, null);
        if (creditResult.ok) {
            currentBalance = creditResult.balance;
            setUIBalance(currentBalance);
        } else {
            showMessage('Не удалось зачислить выигрыш. Откройте Айс Арену ещё раз — сервер попробует снова.');
            await supabase.from(ICE_ARENA_ROUNDS_TABLE)
                .update({ payout_done: false })
                .eq('id', round.id);
        }
    } finally {
        iceArena.paying = false;
    }
}

async function finishIceArenaRound(winner) {
    iceArena.phase = 'result';
    iceArena.winner = winner;

    const round = iceArena.round;
    const total = round?.bank != null
        ? roundMoney(Number(round.bank))
        : roundMoney(iceArena.players.reduce((s, p) => s + p.bet, 0));
    const chance = total > 0 ? ((winner.bet / total) * 100).toFixed(1) : '0.0';

    const overlay = document.getElementById('iceResultOverlay');
    const avatarEl = document.getElementById('iceResultAvatar');
    const nameEl = document.getElementById('iceResultName');
    const chanceEl = document.getElementById('iceResultChance');
    const winEl = document.getElementById('iceResultWin');

    if (avatarEl) avatarEl.innerHTML = iceAvatarHtml(winner.avatar);
    if (nameEl) nameEl.textContent = winner.name + (winner.isUser ? ' (Вы)' : '');
    if (chanceEl) chanceEl.textContent = chance + '%';

    const payout = round?.payout != null
        ? roundMoney(Number(round.payout))
        : roundMoney(total - roundMoney((total - winner.bet) * ICE_ARENA_COMMISSION));

    if (winEl) winEl.textContent = 'Выигрыш: +' + payout.toFixed(2) + ' $';

    if (overlay) overlay.classList.remove('hidden');
    updateIceArenaBetControls();

    if (round && round.status === 'spinning') {
        await supabase.from(ICE_ARENA_ROUNDS_TABLE)
            .update({ status: 'result', resolved_at: new Date().toISOString() })
            .eq('id', round.id)
            .eq('status', 'spinning');
        tryIceArenaPayout({ ...round, payout_done: round.payout_done, payout, winner_telegram_id: winner.telegramId });
    }
}

window.openIceArena = openIceArena;
window.leaveIceArena = leaveIceArena;
window.placeIceArenaBet = placeIceArenaBet;
window.restartIceArena = restartIceArena;

window.applyBetFactor = applyBetFactor;
window.applyBetMax = applyBetMax;

/* ================================================================
   CRASH — глобальный раунд через Supabase

   Один раз выполнить в Supabase → SQL Editor:

   create extension if not exists pgcrypto;
   create table if not exists public.crash_rounds (
       id uuid primary key default gen_random_uuid(),
       status text not null default 'betting'
           check (status in ('betting', 'flying', 'crashed')),
       betting_ends_at timestamptz not null,
       started_at timestamptz,
       crashed_at timestamptz,
       seed text not null,
       round_hash text not null,
       crash_point numeric(12,2) not null,
       reveal_key text,
       created_at timestamptz not null default now()
   );
   create table if not exists public.crash_bets (
       id bigint generated always as identity primary key,
       round_id uuid not null references public.crash_rounds(id) on delete cascade,
       telegram_id bigint not null,
       name text not null,
       avatar text,
       amount numeric(18,2) not null check (amount >= 0.10),
       status text not null default 'active'
           check (status in ('active', 'cashed_out', 'lost')),
       cashout_multiplier numeric(12,2),
       win_amount numeric(18,2),
       payout_done boolean not null default false,
       created_at timestamptz not null default now(),
       unique (round_id, telegram_id)
   );
   create unique index if not exists crash_one_active_round
       on public.crash_rounds ((true))
       where status in ('betting', 'flying');
   alter table public.crash_rounds enable row level security;
   alter table public.crash_bets enable row level security;
   drop policy if exists crash_rounds_read on public.crash_rounds;
   drop policy if exists crash_bets_read on public.crash_bets;
   create policy crash_rounds_read on public.crash_rounds
       for select using (true);
   create policy crash_bets_read on public.crash_bets
       for select using (true);

   -- INSERT/UPDATE прав на таблицы клиенту не выдаём. Все переходы
   -- выполняются атомарными SECURITY DEFINER RPC-функциями.
   create or replace function public.get_or_create_crash_round()
   returns public.crash_rounds language plpgsql security definer
   set search_path = public as $$
   declare r public.crash_rounds; v_seed text; v_hash text;
           v_int numeric; v_point numeric;
   begin
       select * into r from public.crash_rounds
       where status in ('betting', 'flying')
       order by created_at desc limit 1;
       if found then return r; end if;
       v_seed := encode(gen_random_bytes(24), 'hex');
       v_hash := encode(digest(v_seed, 'sha256'), 'hex');
       v_int := ('x' || substr(v_hash, 1, 8))::bit(32)::bigint;
       if mod(v_int, 33) = 0 then v_point := 1.00;
       else v_point := least(1000.00,
           greatest(1.00, round(100 / (1 - v_int / 4294967296.0), 2)));
       end if;
       insert into public.crash_rounds
           (status, betting_ends_at, seed, round_hash, crash_point)
       values ('betting', now() + interval '5 seconds', v_seed, v_hash, v_point)
       returning * into r;
       return r;
   exception when unique_violation then
       select * into r from public.crash_rounds
       where status in ('betting', 'flying')
       order by created_at desc limit 1;
       return r;
   end; $$;

   create or replace function public.advance_crash_round(p_round_id uuid)
   returns public.crash_rounds language plpgsql security definer
   set search_path = public as $$
   declare r public.crash_rounds; v_flight_seconds numeric;
   begin
       select * into r from public.crash_rounds where id = p_round_id for update;
       if not found then return null; end if;
       if r.status = 'betting' and r.betting_ends_at <= now() then
           update public.crash_rounds set status = 'flying', started_at = now()
           where id = r.id and status = 'betting' returning * into r;
       elsif r.status = 'flying' and r.started_at is not null then
           if r.crash_point <= 1.5 then
               v_flight_seconds := 6 * power(greatest(0, (r.crash_point - 1) / 0.5), 1.0 / 3.0);
           else
               v_flight_seconds := 6 + ln(r.crash_point / 1.5) / (ln(2) / 10);
           end if;
           if r.started_at + make_interval(secs => v_flight_seconds) <= now() then
               update public.crash_rounds
               set status = 'crashed', crashed_at = now(), reveal_key = seed
               where id = r.id and status = 'flying' returning * into r;
               update public.crash_bets set status = 'lost'
               where round_id = r.id and status = 'active';
           end if;
       end if;
       return r;
   end; $$;

   create or replace function public.register_crash_bet(
       p_round_id uuid, p_telegram_id bigint, p_name text,
       p_avatar text, p_amount numeric
   ) returns public.crash_bets language plpgsql security definer
   set search_path = public as $$
   declare b public.crash_bets;
   begin
       insert into public.crash_bets (round_id, telegram_id, name, avatar, amount)
       select p_round_id, p_telegram_id, left(coalesce(p_name, 'Игрок'), 80),
              p_avatar, round(p_amount, 2)
       where exists (select 1 from public.crash_rounds
           where id = p_round_id and status = 'betting' and betting_ends_at > now())
       returning * into b;
       if not found then raise exception 'Раунд уже начался или ставка уже существует'; end if;
       return b;
   end; $$;

   create or replace function public.claim_crash_cashout(
       p_round_id uuid, p_telegram_id bigint,
       p_multiplier numeric, p_win_amount numeric
   ) returns public.crash_bets language plpgsql security definer
   set search_path = public as $$
   declare b public.crash_bets;
   begin
       update public.crash_bets b
       set status = 'cashed_out', cashout_multiplier = round(p_multiplier, 2),
           win_amount = round(p_win_amount, 2), payout_done = false
       where b.round_id = p_round_id and b.telegram_id = p_telegram_id
         and b.status = 'active'
         and exists (select 1 from public.crash_rounds r
           where r.id = b.round_id and r.status = 'flying'
             and p_multiplier >= 1 and p_multiplier <= r.crash_point
             and r.started_at + make_interval(secs =>
               case when r.crash_point <= 1.5
                    then 6 * power(greatest(0, (r.crash_point - 1) / 0.5), 1.0 / 3.0)
                    else 6 + ln(r.crash_point / 1.5) / (ln(2) / 10)
               end) > now())
       returning b.* into b;
       if not found then raise exception 'Кэшаут уже выполнен или раунд завершён'; end if;
       return b;
   end; $$;

   create or replace function public.complete_crash_payout(p_bet_id bigint)
   returns boolean language sql security definer set search_path = public as $$
       update public.crash_bets set payout_done = true
       where id = p_bet_id and status = 'cashed_out' and not payout_done
       returning true;
   $$;
   create or replace function public.release_crash_cashout(p_bet_id bigint)
   returns boolean language sql security definer set search_path = public as $$
       update public.crash_bets
       set status = 'active', cashout_multiplier = null, win_amount = null
       where id = p_bet_id and status = 'cashed_out' and not payout_done
       returning true;
   $$;

   revoke all on function public.get_or_create_crash_round() from public;
   revoke all on function public.advance_crash_round(uuid) from public;
   revoke all on function public.register_crash_bet(uuid,bigint,text,text,numeric) from public;
   revoke all on function public.claim_crash_cashout(uuid,bigint,numeric,numeric) from public;
   revoke all on function public.complete_crash_payout(bigint) from public;
   revoke all on function public.release_crash_cashout(bigint) from public;
   grant execute on function public.get_or_create_crash_round() to anon, authenticated;
   grant execute on function public.advance_crash_round(uuid) to anon, authenticated;
   grant execute on function public.register_crash_bet(uuid,bigint,text,text,numeric) to anon, authenticated;
   grant execute on function public.claim_crash_cashout(uuid,bigint,numeric,numeric) to anon, authenticated;
   grant execute on function public.complete_crash_payout(bigint) to anon, authenticated;
   grant execute on function public.release_crash_cashout(bigint) to anon, authenticated;
   alter publication supabase_realtime add table public.crash_rounds;
   alter publication supabase_realtime add table public.crash_bets;
   ================================================================ */

const CRASH_ROUNDS_TABLE = 'crash_rounds';
const CRASH_BETS_TABLE = 'crash_bets';
const CRASH_GLOBAL_RESULT_HOLD_MS = 3000;
const CRASH_GLOBAL_POLL_MS = 1000;
const CRASH_GLOBAL_GAME_LABEL = 'Краш';
let crashGlobal = {
    round: null, bets: [], channel: null, pollHandle: null,
    refreshInFlight: false, lastRenderedRoundId: null, lastRenderedPhase: null
};

function crashRpcRow(data) {
    return Array.isArray(data) ? (data[0] || null) : (data || null);
}

function crashTelegramId() {
    return tg?.initDataUnsafe?.user?.id || null;
}

function crashPlayerName() {
    const user = tg?.initDataUnsafe?.user;
    return document.getElementById('username')?.textContent?.trim() ||
        [user?.first_name, user?.last_name].filter(Boolean).join(' ') || 'Игрок';
}

function crashFlightMs(point) {
    const value = Math.max(1, Number(point) || 1);
    if (value <= 1.5) return 6000 * Math.pow(Math.max(0, (value - 1) / 0.5), 1 / 3);
    return 6000 + Math.log(value / 1.5) / (Math.log(2) / 10000);
}

function crashMultiplierAt(round, now = Date.now()) {
    if (!round?.started_at) return 1;
    const elapsed = Math.max(0, now - Date.parse(round.started_at));
    let raw;
    if (elapsed < CRASH_SLOW_START_MS) {
        raw = 1 + (CRASH_SLOW_START_TARGET - 1) * Math.pow(elapsed / CRASH_SLOW_START_MS, 3);
    } else {
        raw = CRASH_SLOW_START_TARGET *
            Math.exp(CRASH_GROWTH_PER_MS * (elapsed - CRASH_SLOW_START_MS));
    }
    return Math.min(Number(round.crash_point) || 1, Math.floor(raw * 100) / 100);
}

function crashOwnBet() {
    const id = crashTelegramId();
    return id == null ? null : crashGlobal.bets.find(
        bet => String(bet.telegram_id) === String(id)
    ) || null;
}

function ensureCrashGlobalRoomUi() {
    if (document.getElementById('crashGlobalRoom')) return;
    const dom = getCrashDom();
    if (!dom.historyList?.parentElement) return;
    const panel = document.createElement('div');
    panel.id = 'crashGlobalRoom';
    panel.style.cssText =
        'margin:10px 0 12px;padding:9px 11px;border-radius:12px;' +
        'background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.08);' +
        'color:rgba(255,255,255,.78);font-size:11px;line-height:1.35;';
    dom.historyList.parentElement.insertBefore(panel, dom.historyList);
}

function renderCrashGlobalRoom() {
    const panel = document.getElementById('crashGlobalRoom');
    if (!panel) return;
    const active = crashGlobal.bets.filter(bet => bet.status === 'active');
    const total = active.reduce((sum, bet) => sum + (Number(bet.amount) || 0), 0);
    const players = crashGlobal.bets.slice(0, 8).map(bet => {
        const result = bet.status === 'cashed_out'
            ? ` · забрал ${Number(bet.win_amount || 0).toFixed(2)}$`
            : bet.status === 'lost' ? ' · проигрыш' : '';
        return `<span style="white-space:nowrap">${escapeHtml(bet.name || 'Игрок')}${result}</span>`;
    }).join(' · ');
    panel.innerHTML =
        `<div style="font-weight:800;color:#fff">Всего ${active.length} ставок ● ${total.toFixed(2)}$</div>` +
        (players ? `<div style="margin-top:4px;opacity:.72">${players}</div>` : '');
}

// ==========================================
// ПЕРЕПОДКЛЮЧЕНИЕ ПОСЛЕ ВОЗВРАТА В ПРИЛОЖЕНИЕ
// Если игрок свернул приложение (или ушёл с телефона) и вернулся —
// вместо того чтобы просто "доиграть" по устаревшим данным, показываем
// внизу под ракетой бейдж "Переподключение…" и тихо подтягиваем
// актуальное состояние раунда. Как только оно применится (через
// applyCrashGlobalRound → renderCrashUI), бейдж прячем — игрок увидит
// раунд таким, какой он есть по-настоящему прямо сейчас.
// ==========================================
let crashWasHidden = false;

function isCrashPageOpen() {
    const el = document.getElementById('crashPage');
    return !!el && !el.classList.contains('hidden');
}

function showCrashReconnectBadge() {
    const dom = getCrashDom();
    if (dom.reconnectBadge) dom.reconnectBadge.style.display = 'flex';
}

function hideCrashReconnectBadge() {
    const dom = getCrashDom();
    if (dom.reconnectBadge) dom.reconnectBadge.style.display = 'none';
}

async function resyncCrashAfterReturn() {
    if (!crashLoopStarted || !isCrashPageOpen()) return;
    showCrashReconnectBadge();
    try {
        await refreshCrashGlobalState();
        await loadCrashGlobalHistory();
    } catch (error) {
        console.error('Не удалось переподключиться к Crash после возврата:', error);
    } finally {
        hideCrashReconnectBadge();
    }
}

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
        crashWasHidden = true;
    } else if (document.visibilityState === 'visible' && crashWasHidden) {
        crashWasHidden = false;
        resyncCrashAfterReturn();
    }
});

// Подстраховка: в некоторых WebView (в т.ч. иногда в Telegram)
// visibilitychange срабатывает не всегда надёжно — pageshow/focus
// дублируют триггер, но resyncCrashAfterReturn ничего не сделает,
// если crashWasHidden уже false, так что двойного вызова не будет.
window.addEventListener('pageshow', () => {
    if (crashWasHidden) {
        crashWasHidden = false;
        resyncCrashAfterReturn();
    }
});
window.addEventListener('focus', () => {
    if (crashWasHidden) {
        crashWasHidden = false;
        resyncCrashAfterReturn();
    }
});

async function loadCrashGlobalHistory() {
    const { data, error } = await supabase
        .from(CRASH_ROUNDS_TABLE)
        .select('crash_point, crashed_at, created_at')
        .eq('status', 'crashed')
        .order('crashed_at', { ascending: false })
        .limit(CRASH_HISTORY_MAX);
    if (error) {
        console.error('Ошибка загрузки истории crash_rounds:', error);
        return;
    }
    crashHistory = (data || [])
        .map(row => Number(row.crash_point))
        .filter(point => Number.isFinite(point));
    lastCrashPoint = crashHistory.length ? crashHistory[0] : null;
    renderCrashHistory();
}

async function getCrashGlobalRound() {
    const { data, error } = await supabase
        .from(CRASH_ROUNDS_TABLE)
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    if (error) {
        console.error('Ошибка загрузки общего Crash-раунда:', error);
        return null;
    }
    return data || null;
}

async function getCrashGlobalBets(roundId) {
    if (!roundId) return [];
    const { data, error } = await supabase
        .from(CRASH_BETS_TABLE)
        .select('*')
        .eq('round_id', roundId)
        .order('created_at', { ascending: true });
    if (error) {
        console.error('Ошибка загрузки ставок общего Crash-раунда:', error);
        return [];
    }
    return data || [];
}

function setCrashFairnessFromRound(round) {
    currentCrashState = {
        salt: round?.status === 'crashed' ? (round.reveal_key || round.seed || '') : '',
        hash: round?.round_hash || '',
        crashPoint: Number(round?.crash_point) || 1,
        isFinished: round?.status === 'crashed'
    };
    const hashInput = document.getElementById('crashRoundHashInput');
    if (hashInput) hashInput.value = currentCrashState.hash;
    if (round?.status !== 'crashed') hideCrashRoundKey();
    else revealCrashRoundKey();
}

function applyCrashGlobalRound(round, bets) {
    if (!round) return;
    const previousId = crashGlobal.round?.id;
    const previousStatus = crashGlobal.round?.status;
    crashGlobal.round = round;
    crashGlobal.bets = bets || [];
    setCrashFairnessFromRound(round);
    // Пришло свежее состояние раунда с сервера — снимаем временную
    // блокировку кэшаута, поставленную в tickCrash() при локальном
    // обнаружении конца полёта.
    crashRoundSettling = false;

    const own = crashOwnBet();
    crashGame.roundId = round.id;
    crashGame.bet = Number(own?.amount) || 0;
    crashGame.betPlaced = !!own;
    crashGame.cashedOut = own?.status === 'cashed_out';
    crashGame.crashPoint = Number(round.crash_point) || 1;
    crashGame.currentMult = round.status === 'flying'
        ? crashMultiplierAt(round)
        : round.status === 'crashed' ? crashGame.crashPoint : 1;
    crashGame.phase = round.status === 'flying'
        ? 'flying' : round.status === 'crashed' ? 'crashed' : 'waiting';
    crashGame.startTime = round.started_at ? Date.parse(round.started_at) : 0;
    crashGame.phaseEndsAt = round.betting_ends_at ? Date.parse(round.betting_ends_at) : 0;

    renderCrashGlobalRoom();
    if (previousId !== round.id || previousStatus !== round.status) {
        crashGlobal.lastRenderedRoundId = round.id;
        crashGlobal.lastRenderedPhase = round.status;
        if (round.status === 'flying') beginFlyingPhase(round);
        else if (round.status === 'crashed') endCrashRound(round);
        else beginWaitingPhase(round);
    }
    renderCrashUI();
}

async function advanceCrashGlobalRound(round) {
    if (!round?.id) return round;
    const { data, error } = await supabase.rpc('advance_crash_round', {
        p_round_id: round.id
    });
    if (error) {
        console.error('Не удалось атомарно продвинуть Crash-раунд:', error);
        return round;
    }
    return crashRpcRow(data) || round;
}

async function refreshCrashGlobalState() {
    if (crashGlobal.refreshInFlight) return;
    crashGlobal.refreshInFlight = true;
    try {
        let round = await getCrashGlobalRound();
        if (!round) {
            const { data, error } = await supabase.rpc('get_or_create_crash_round');
            if (error) throw error;
            round = crashRpcRow(data);
        }

        if (round?.status === 'betting' &&
            Date.parse(round.betting_ends_at) <= Date.now()) {
            round = await advanceCrashGlobalRound(round);
        } else if (round?.status === 'flying' &&
            Date.parse(round.started_at) + crashFlightMs(round.crash_point) <= Date.now()) {
            round = await advanceCrashGlobalRound(round);
        } else if (round?.status === 'crashed') {
            const endedAt = Date.parse(round.crashed_at || round.created_at);
            if (Number.isFinite(endedAt) &&
                Date.now() - endedAt >= CRASH_GLOBAL_RESULT_HOLD_MS) {
                const { data, error } = await supabase.rpc('get_or_create_crash_round');
                if (!error) round = crashRpcRow(data) || round;
                else console.error('Не удалось создать следующий Crash-раунд:', error);
            }
        }

        if (round) {
            const bets = await getCrashGlobalBets(round.id);
            applyCrashGlobalRound(round, bets);
            if (round.status === 'crashed') await loadCrashGlobalHistory();
        }
    } catch (error) {
        console.error('Ошибка синхронизации общего Crash-раунда:', error);
    } finally {
        crashGlobal.refreshInFlight = false;
    }
}

function subscribeCrashGlobal() {
    if (crashGlobal.channel) return;
    try {
        crashGlobal.channel = supabase
            .channel('crash_global_room')
            .on('postgres_changes', {
                event: '*', schema: 'public', table: CRASH_ROUNDS_TABLE
            }, () => refreshCrashGlobalState())
            .on('postgres_changes', {
                event: '*', schema: 'public', table: CRASH_BETS_TABLE
            }, () => refreshCrashGlobalState())
            .subscribe((status) => {
                if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    console.warn('Realtime Crash недоступен, работает polling-подстраховка.');
                }
            });
    } catch (error) {
        console.error('Не удалось подписаться на realtime Crash:', error);
    }
}

function startCrashEngine() {
    if (crashLoopStarted) return;
    crashLoopStarted = true;
    ensureCrashGlobalRoomUi();
    renderCrashHistory();
    subscribeCrashGlobal();
    loadCrashGlobalHistory();
    refreshCrashGlobalState();
    clearInterval(crashGlobal.pollHandle);
    crashGlobal.pollHandle = setInterval(refreshCrashGlobalState, CRASH_GLOBAL_POLL_MS);
}

function initCrashPage() {
    ensureCrashGlobalRoomUi();
    renderCrashHistory();
    renderCrashUI();
    initCrashRocketAnim();
    initCrashExplosionAnim();
    syncCrashStageDims();
    requestAnimationFrame(syncCrashStageDims);
}

function beginWaitingPhase(round = crashGlobal.round) {
    if (!round) return;
    crashGame.phase = 'waiting';
    crashGame.currentMult = 1;
    crashGame.phaseEndsAt = Date.parse(round.betting_ends_at) || Date.now();
    crashGame.crashPoint = Number(round.crash_point) || 1;
    crashGame.startTime = 0;

    // Полный сброс ракеты/взрыва перед новым раундом. Без этого блока
    // ракета оставалась скрытой (opacity 0) с прошлого краша и
    // "никуда не улетала" во время паузы, а взрыв мог зависнуть
    // поверх сцены до следующего запуска.
    resetCrashVisuals();

    // Если ставка была поставлена заранее (во время полёта или во время
    // паузы предыдущего раунда) — автоматически регистрируем её сейчас,
    // как только открылся приём ставок на новый раунд.
    if (crashGame.betQueued && !crashGame.betPlaced) {
        const queuedAmount = crashGame.queuedBet;
        crashGame.betQueued = false;
        crashGame.queuedBet = null;
        const dom = getCrashDom();
        if (dom.betInput && queuedAmount) dom.betInput.value = queuedAmount;
        placeCrashBet();
    }

    renderCrashUI();
}

// Приводит ракету и взрыв в исходное состояние — вызывается и в начале
// паузы, и в начале полёта (на случай, если фаза "пауза" была
// пропущена, например, после возврата в приложение через долгое время).
function resetCrashVisuals() {
    const dom = getCrashDom();
    syncCrashStageDims();
    clearTimeout(crashExplosionHideTimeout);
    if (dom.explosionEl) {
        dom.explosionEl.style.opacity = '0';
        dom.explosionEl.style.display = 'none';
        dom.explosionEl.style.transform = '';
    }
    if (crashExplosionAnim) crashExplosionAnim.goToAndStop(0, true);
    if (crashRocketAnim) crashRocketAnim.goToAndPlay(0, true);
    if (dom.rocketEl) {
        dom.rocketEl.style.opacity = '1';
        // Важно: во время полёта ракета не "летит" по сцене — она всегда
        // стоит в одной и той же точке (см. tickCrash: centerX/centerY
        // не зависят от прогресса) и только поворачивается. Раньше здесь
        // стоял другой якорь (0,0 — левый нижний угол), из-за чего между
        // паузой и стартом полёта ракета визуально "прыгала". Теперь
        // используем ту же формулу, что и в полёте, чтобы точка покоя и
        // точка полёта совпадали и ракета оставалась на месте.
        const centerX = (crashStageW - 200) / 2 - 16;
        const centerY = 16 - (crashStageH - 200) / 2;
        dom.rocketEl.style.transform = `translate3d(${centerX}px,${centerY}px,0) rotate(45deg)`;
    }
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
}

function beginFlyingPhase(round = crashGlobal.round) {
    if (!round) return;
    crashGame.phase = 'flying';
    crashGame.crashPoint = Number(round.crash_point) || 1;
    crashGame.startTime = Date.parse(round.started_at) || Date.now();
    crashGame.currentMult = crashMultiplierAt(round);
    crashLastHeavyUpdate = 0;
    syncCrashStageDims();
    crashTrailPoints = [];

    // Та же защита, что и в beginWaitingPhase: если этот раунд —
    // первый, который приложение увидело после возврата (пауза была
    // пропущена), взрыв с прошлого краша не должен оставаться висеть.
    resetCrashVisuals();

    const dom = getCrashDom();
    if (dom.trailLine) {
        dom.trailLine.setAttribute('d', '');
        dom.trailLine.classList.remove('crash-trail-crashed');
        dom.trailLine.style.opacity = '1';
    }
    if (dom.trailDot) {
        dom.trailDot.classList.remove('crash-trail-crashed');
        dom.trailDot.style.opacity = '0';
    }
    if (dom.topLeftMult) {
        dom.topLeftMult.textContent = '1.00x';
        dom.topLeftMult.classList.remove('crashed');
        dom.topLeftMult.style.display = 'block';
    }
    if (dom.countdownEl) dom.countdownEl.style.display = 'none';
    if (dom.centerInfoEl) dom.centerInfoEl.style.opacity = '0';
    if (dom.rocketEl) dom.rocketEl.style.opacity = '1';
    // Разрешаем набрать сумму для ставки на следующий раунд, пока свою
    // ставку в текущем полёте игрок не поставил и не поставил в очередь —
    // финальное состояние (disabled/enabled) выставит renderCrashUI().
    if (dom.betInput) dom.betInput.disabled = crashGame.betPlaced || crashGame.betQueued;
    cancelAnimationFrame(crashAnimHandle);
    tickCrash();
}

function tickCrash() {
    if (crashGlobal.round?.status !== 'flying') return;
    const now = Date.now();
    crashGame.currentMult = crashMultiplierAt(crashGlobal.round, now);
    const heavy = now - crashLastHeavyUpdate >= CRASH_HEAVY_UPDATE_INTERVAL_MS;
    if (heavy) crashLastHeavyUpdate = now;
    if (Date.parse(crashGlobal.round.started_at) +
        crashFlightMs(crashGlobal.round.crash_point) <= now) {
        crashRoundSettling = true;
        refreshCrashGlobalState();
    }
    renderCrashUI(heavy);
    crashAnimHandle = requestAnimationFrame(tickCrash);
}

function endCrashRound(round = crashGlobal.round) {
    if (!round) return;
    cancelAnimationFrame(crashAnimHandle);
    crashGame.phase = 'crashed';
    crashGame.crashPoint = Number(round.crash_point) || 1;
    crashGame.currentMult = crashGame.crashPoint;
    lastCrashPoint = crashGame.crashPoint;
    setCrashFairnessFromRound(round);
    renderCrashHistory();

    const dom = getCrashDom();
    if (crashRocketAnim) crashRocketAnim.pause();
    if (dom.rocketEl) dom.rocketEl.style.opacity = '0';
    if (dom.trailLine) dom.trailLine.classList.add('crash-trail-crashed');
    if (dom.trailDot) {
        dom.trailDot.classList.remove('crash-dot-live');
        dom.trailDot.classList.add('crash-trail-crashed');
        dom.trailDot.style.opacity = '1';
    }
    if (dom.explosionEl) {
        dom.explosionEl.style.opacity = '1';
        dom.explosionEl.style.display = 'block';
        if (crashExplosionAnim) {
            const endFrame = Math.max(
                1, Math.round(crashExplosionTotalFrames * EXPLOSION_PLAY_FRACTION)
            );
            if (crashExplosionTotalFrames) {
                crashExplosionAnim.playSegments([0, endFrame], true);
            } else {
                crashExplosionAnim.goToAndPlay(0, true);
            }
        }
    }
    if (dom.multEl) dom.multEl.style.color = '#e74c3c';
    if (dom.topLeftMult) {
        dom.topLeftMult.textContent = crashGame.crashPoint.toFixed(2) + 'x';
        dom.topLeftMult.classList.add('crashed');
        dom.topLeftMult.style.display = 'block';
    }
    // Текст/состояние кнопки ставки (включая «Ставка принята» для заранее
    // поставленной ставки) выставляет renderCrashUI(), вызываемый сразу
    // после этой функции из applyCrashGlobalRound().
    explosionShake(dom.stageEl, 500, 20);
}

function renderCrashHistory() {
    const dom = getCrashDom();
    if (!dom.historyList) return;
    dom.historyList.innerHTML = crashHistory.map(point => {
        const color = point < 1.5 ? '#e74c3c' : point >= 2 ? '#2ecc71' : '#f1c40f';
        return `<span style="display:inline-block;background:rgba(255,255,255,.06);` +
            `border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:4px 8px;` +
            `font-size:11px;font-weight:800;color:${color};">${Number(point).toFixed(2)}x</span>`;
    }).join('');
}

function renderCrashUI(heavy = true) {
    const dom = getCrashDom();
    if (!dom.statusEl || !dom.multEl || !dom.actionBtn) return;
    const round = crashGlobal.round;

    if (crashGame.phase === 'waiting' || !round) {
        const secLeft = round
            ? Math.max(0, Math.ceil((crashGame.phaseEndsAt - Date.now()) / 1000)) : 0;
        dom.statusEl.textContent = lastCrashPoint !== null
            ? `Прошлый раунд: ${lastCrashPoint.toFixed(2)}x · Старт через ${secLeft}с`
            : `Старт через ${secLeft}с`;
        dom.multEl.textContent = '1.00x';
        dom.multEl.style.color = '#fff';
        if (dom.countdownEl) {
            dom.countdownEl.textContent = String(secLeft);
            dom.countdownEl.className = 'crash-countdown ' +
                (secLeft === 5 ? 'cc-green' : secLeft >= 3 ? 'cc-yellow' : 'cc-red');
            dom.countdownEl.style.display = secLeft > 0 && secLeft <= 5 ? 'flex' : 'none';
        }
        if (dom.centerInfoEl) dom.centerInfoEl.style.opacity = secLeft > 0 ? '0' : '1';
        if (dom.rocketEl) dom.rocketEl.style.opacity = '1';
        // pending — ставка уже принята (в этом раунде) либо ещё обрабатывается
        // (например, только что была автоматически поставлена из очереди).
        const pending = crashGame.betPlaced || crashGame.isProcessing;
        if (dom.betInput) dom.betInput.disabled = pending;
        dom.actionBtn.textContent = pending ? 'Ставка принята' : 'Сделать ставку';
        dom.actionBtn.disabled = pending;
        return;
    }

    if (crashGame.phase === 'crashed') {
        dom.statusEl.textContent =
            `Краш на ${crashGame.crashPoint.toFixed(2)}x · следующий раунд скоро`;
        dom.multEl.textContent = crashGame.crashPoint.toFixed(2) + 'x';
        dom.multEl.style.color = '#e74c3c';
        // Пауза между раундами: разрешаем поставить на следующий раунд заранее.
        if (dom.actionBtn) {
            if (crashGame.cashedOut) {
                dom.actionBtn.textContent = 'Выигрыш забран ✓';
                dom.actionBtn.disabled = true;
            } else if (crashGame.betQueued) {
                dom.actionBtn.textContent = 'Ставка принята';
                dom.actionBtn.disabled = true;
            } else {
                dom.actionBtn.textContent = 'Сделать ставку';
                dom.actionBtn.disabled = false;
            }
        }
        if (dom.betInput) dom.betInput.disabled = crashGame.betQueued;
        return;
    }

    const currentM = crashGame.currentMult;
    const trailProgress = Math.min(1, Math.max(0, (currentM - 1) / 2));
    const stageW = crashStageW;
    const stageH = crashStageH;
    const centerX = (stageW - 200) / 2 - 16;
    const centerY = 16 - (stageH - 200) / 2;
    dom.multEl.textContent = currentM.toFixed(2) + 'x';
    dom.multEl.style.color = '#fff';
    dom.statusEl.textContent = 'Раунд идёт · общая комната';
    if (dom.rocketEl) {
        dom.rocketEl.style.transform =
            `translate3d(${centerX}px,${centerY}px,0) rotate(${45 - 90 * trailProgress}deg)`;
    }

    if (heavy) {
        if (dom.topLeftMult) dom.topLeftMult.textContent = currentM.toFixed(2) + 'x';
        const sx = stageW * .05;
        const sy = stageH * .95;
        const ex = stageW * .95;
        const ey = stageH * .05;
        const hx = sx + (ex - sx) * trailProgress;
        const hy = sy + (ey - sy) * trailProgress;
        if (dom.trailLine) {
            const dx = hx - sx;
            const dy = hy - sy;
            const len = Math.hypot(dx, dy) || 1;
            const bow = .25 * len;
            dom.trailLine.setAttribute('d',
                `M ${sx},${sy} Q ${(sx + hx) / 2 - dy / len * bow},` +
                `${(sy + hy) / 2 + dx / len * bow} ${hx},${hy}`);
        }
        if (dom.trailDot) {
            dom.trailDot.setAttribute('cx', hx);
            dom.trailDot.setAttribute('cy', hy);
            dom.trailDot.style.opacity = '1';
            dom.trailDot.classList.add('crash-dot-live');
        }
    }

    if (dom.betInput) dom.betInput.disabled = crashGame.betPlaced || crashGame.betQueued;

    if (crashGame.betPlaced && !crashGame.cashedOut && !crashRoundSettling) {
        dom.actionBtn.textContent = `Забрать ${(crashGame.bet * currentM).toFixed(2)}$`;
        dom.actionBtn.disabled = false;
    } else if (crashGame.betPlaced && !crashGame.cashedOut && crashRoundSettling) {
        // Раунд по нашим расчётам уже должен был завершиться — ждём
        // подтверждения от сервера, кэшаут временно недоступен.
        dom.actionBtn.textContent = 'Раунд завершается…';
        dom.actionBtn.disabled = true;
    } else if (crashGame.cashedOut) {
        dom.actionBtn.textContent = 'Выигрыш забран ✓';
        dom.actionBtn.disabled = true;
    } else if (crashGame.betQueued) {
        // Ставка ещё не поставлена в этом раунде, но уже поставлена
        // "в очередь" — она будет автоматически сделана на старте
        // следующего раунда.
        dom.actionBtn.textContent = 'Ставка принята';
        dom.actionBtn.disabled = true;
    } else {
        // Своей ставки в этом раунде нет — можно поставить на следующий.
        dom.actionBtn.textContent = 'Сделать ставку';
        dom.actionBtn.disabled = false;
    }
}

async function placeCrashBet() {
    if (crashGame.phase !== 'waiting' || crashGame.betPlaced || crashGame.isProcessing) return;
    const round = crashGlobal.round;
    const telegramId = crashTelegramId();
    if (!round || round.status !== 'betting' || !telegramId) {
        showMessage('Раунд уже начался или профиль ещё загружается.');
        return;
    }
    if (!lockEconomy()) return;

    const dom = getCrashDom();
    const bet = roundMoney(parseFloat(dom.betInput?.value));
    if (!bet || isNaN(bet) || bet < 0.10) {
        showMessage('Минимальная ставка — 0.10 $!');
        unlockEconomy();
        return;
    }
    if (bet > currentBalance) {
        showMessage('Недостаточно средств!');
        unlockEconomy();
        return;
    }

    crashGame.isProcessing = true;
    const snapshot = snapshotBalanceState();
    currentTurnover = roundMoney(currentTurnover + bet);
    currentBetsCount++;
    setUIBalance(roundMoney(currentBalance - bet));

    const debitResult = await placeBetServer(bet, CRASH_GLOBAL_GAME_LABEL);
    if (!debitResult.ok) {
        restoreBalanceState(snapshot);
        showMessage('Не удалось списать ставку. Проверьте соединение и попробуйте снова.');
        crashGame.isProcessing = false;
        unlockEconomy();
        return;
    }
    currentBalance = debitResult.balance;
    setUIBalance(currentBalance);

    const user = tg?.initDataUnsafe?.user;
    const { data, error } = await supabase.rpc('register_crash_bet', {
        p_round_id: round.id,
        p_telegram_id: telegramId,
        p_name: crashPlayerName(),
        p_avatar: user?.photo_url || null,
        p_amount: bet
    });
    if (error || !crashRpcRow(data)) {
        // place_bet уже успел списать деньги, поэтому при гонке за
        // последним слотом возвращаем сумму через тот же серверный RPC.
        const refundResult = await resolveWinServerWithRetry(bet, 1);
        if (refundResult.ok) {
            currentBalance = refundResult.balance;
            setUIBalance(currentBalance);
        } else {
            restoreBalanceState(snapshot);
        }
        showMessage('Раунд уже начался. Ставка не принята; обновите приложение.');
        crashGame.isProcessing = false;
        unlockEconomy();
        return;
    }

    const savedBet = crashRpcRow(data);
    crashGlobal.bets.push(savedBet);
    crashGame.bet = bet;
    crashGame.betPlaced = true;
    crashGame.cashedOut = false;
    crashGame.liveBetId = await broadcastLiveBet(bet, CRASH_GLOBAL_GAME_LABEL);
    crashGame.isProcessing = false;
    unlockEconomy();
    renderCrashGlobalRoom();
    renderCrashUI();
}

async function cashOutCrash() {
    const round = crashGlobal.round;
    const telegramId = crashTelegramId();
    const own = crashOwnBet();
    if (crashGame.phase !== 'flying' || !round || !own ||
        own.status !== 'active' || crashGame.isProcessing || !telegramId ||
        crashRoundSettling) return;
    if (!lockEconomy()) return;

    crashGame.isProcessing = true;
    const mult = Math.min(crashMultiplierAt(round), Number(round.crash_point) || 1);
    const winAmount = roundMoney(crashGame.bet * mult);
    const { data, error } = await supabase.rpc('claim_crash_cashout', {
        p_round_id: round.id,
        p_telegram_id: telegramId,
        p_multiplier: mult,
        p_win_amount: winAmount
    });
    if (error || !crashRpcRow(data)) {
        showMessage('Кэшаут не успел выполниться — раунд уже завершён.');
        crashGame.isProcessing = false;
        unlockEconomy();
        refreshCrashGlobalState();
        return;
    }

    const claimed = crashRpcRow(data);
    const snapshot = snapshotBalanceState();
    currentTotalWin = roundMoney(currentTotalWin + winAmount);
    currentWinsCount++;
    if (mult > currentMaxWin) currentMaxWin = mult;
    setUIBalance(roundMoney(currentBalance + winAmount));

    const creditResult = await resolveWinServerWithRetry(winAmount, mult);
    if (!creditResult.ok) {
        await supabase.rpc('release_crash_cashout', { p_bet_id: claimed.id });
        restoreBalanceState(snapshot);
        showMessage('Не удалось зачислить выигрыш. Нажмите «Забрать» ещё раз.');
        crashGame.isProcessing = false;
        unlockEconomy();
        refreshCrashGlobalState();
        return;
    }
    currentBalance = creditResult.balance;
    setUIBalance(currentBalance);
    await supabase.rpc('complete_crash_payout', { p_bet_id: claimed.id });

    const index = crashGlobal.bets.findIndex(
        bet => String(bet.id) === String(claimed.id)
    );
    if (index >= 0) crashGlobal.bets[index] = claimed;
    crashGame.cashedOut = true;
    crashGame.isProcessing = false;
    if (window.tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
    showMessage(`Забрано: +${winAmount.toFixed(2)}$ (${mult.toFixed(2)}x)`);
    resolveLiveBetWin(crashGame.liveBetId, crashGame.bet, winAmount);
    renderCrashGlobalRoom();
    renderCrashUI();
    unlockEconomy();
}

// Ставит "в очередь" ставку на следующий раунд — используется, когда
// игрок нажимает "Сделать ставку" пока идёт полёт текущего раунда или
// пока раунд на паузе (только что завершился). Деньги не списываются
// сразу — реальная ставка (placeCrashBet) уйдёт на сервер автоматически,
// как только откроется приём ставок на новый раунд (см. beginWaitingPhase).
function queueCrashBet() {
    if (crashGame.betQueued || crashGame.betPlaced || crashGame.isProcessing) return;
    const dom = getCrashDom();
    const bet = roundMoney(parseFloat(dom.betInput?.value));
    if (!bet || isNaN(bet) || bet < 0.10) {
        showMessage('Минимальная ставка — 0.10 $!');
        return;
    }
    if (bet > currentBalance) {
        showMessage('Недостаточно средств!');
        return;
    }
    crashGame.betQueued = true;
    crashGame.queuedBet = bet;
    if (dom.betInput) dom.betInput.disabled = true;
    renderCrashUI();
}

function handleCrashAction() {
    if (crashGame.isProcessing) return;
    if (crashGame.phase === 'waiting' && !crashGame.betPlaced) {
        placeCrashBet();
    } else if (crashGame.phase === 'flying' && crashGame.betPlaced && !crashGame.cashedOut) {
        cashOutCrash();
    } else if (
        (crashGame.phase === 'flying' || crashGame.phase === 'crashed') &&
        !crashGame.betPlaced && !crashGame.betQueued && !crashGame.cashedOut
    ) {
        queueCrashBet();
    }
}

function adjustCrashBet(factor) {
    if (!crashGame.betPlaced && !crashGame.betQueued) applyBetFactor(getCrashDom().betInput, factor);
}

function setCrashMaxBet() {
    if (!crashGame.betPlaced && !crashGame.betQueued) applyBetMax(getCrashDom().betInput);
}

})();
