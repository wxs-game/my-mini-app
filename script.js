(function () {
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

// ==========================================
// ЗАЩИТА ИНТЕРФЕЙСА: без боковых свайпов, без "оттягивания",
// без выделения текста
// ==========================================
(function setupTouchGuards() {
    // Telegram: запрет закрытия приложения свайпом вниз
    try { if (typeof tg.disableVerticalSwipes === 'function') tg.disableVerticalSwipes(); } catch (e) {}

    const asElement = (n) => (n && n.nodeType === 1) ? n : (n && n.parentElement) || null;
    const isEditable = (n) => {
        const el = asElement(n);
        return !!(el && el.closest && el.closest('input, textarea, [contenteditable="true"]'));
    };

    // --- Запрет выделения текста (кроме полей ввода) ---
    document.addEventListener('selectstart', (e) => {
        if (!isEditable(e.target)) e.preventDefault();
    }, true);
    document.addEventListener('dragstart', (e) => e.preventDefault());
    document.addEventListener('selectionchange', () => {
        const a = document.activeElement;
        if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) return;
        const sel = window.getSelection && window.getSelection();
        if (sel && !sel.isCollapsed) sel.removeAllRanges();
    });

    // --- Страница никогда не должна быть сдвинута по горизонтали ---
    const resetHScroll = () => {
        if (window.scrollX !== 0) {
            window.scrollTo({ left: 0, top: window.scrollY, behavior: 'instant' });
        }
    };
    window.addEventListener('scroll', resetHScroll, { passive: true });
    document.addEventListener('focusout', () => setTimeout(resetHScroll, 60));

    // --- Блок боковых свайпов и "резинки" сверху/снизу ---
    let sx = 0, sy = 0;
    document.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
            sx = e.touches[0].clientX;
            sy = e.touches[0].clientY;
        }
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
        if (e.touches.length !== 1) return;
        const t = e.touches[0];
        const dx = t.clientX - sx;
        const dy = t.clientY - sy;
        if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;

        const horizontal = Math.abs(dx) > Math.abs(dy);

        // Если палец на внутреннем прокручиваемом блоке (лента, список, модалка),
        // и он ещё может ехать в эту сторону — не мешаем.
        let el = asElement(e.target);
        while (el && el !== document.body && el !== document.documentElement) {
            const cs = getComputedStyle(el);
            if (horizontal) {
                if (/(auto|scroll)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1) {
                    const atLeft = el.scrollLeft <= 0;
                    const atRight = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
                    if (!((dx > 0 && atLeft) || (dx < 0 && atRight))) return;
                    break;
                }
            } else {
                if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1) {
                    const atTop = el.scrollTop <= 0;
                    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
                    if (!((dy > 0 && atTop) || (dy < 0 && atBottom))) return;
                    break;
                }
            }
            el = el.parentElement;
        }

        if (horizontal) {
            if (e.cancelable) e.preventDefault();
            return;
        }

        // Вертикально: блокируем только когда страница уже у верха/низа (нет "оттягивания")
        const se = document.body;   // страница прокручивается body (окно не скроллится)
        const pageAtTop = se.scrollTop <= 0;
        const pageAtBottom = se.scrollTop + se.clientHeight >= se.scrollHeight - 1;
        if ((dy > 0 && pageAtTop) || (dy < 0 && pageAtBottom)) {
            if (e.cancelable) e.preventDefault();
        }
    }, { passive: false });
})();

// ==========================================
// 2. ВИБРАЦИЯ (Telegram HapticFeedback)
// ==========================================
window.tg = tg;

(function setupHaptics() {
    const hf = tg && tg.HapticFeedback;

    // Защита от "двойной" вибрации: если два impact-вызова приходят
    // почти одновременно (глобальный клик + вибрация самой игры),
    // второй отбрасывается.
    if (hf && typeof hf.impactOccurred === 'function' && !hf.__wrapped) {
        try {
            const origImpact = hf.impactOccurred.bind(hf);
            let lastImpactAt = 0;
            hf.impactOccurred = function (style) {
                const now = Date.now();
                if (now - lastImpactAt < 45) return hf;
                lastImpactAt = now;
                try { origImpact(style); } catch (e) {}
                return hf;
            };
            hf.__wrapped = true;
        } catch (e) {}
    }

    // type: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft' | 'select' | 'success' | 'error' | 'warning'
    window.haptic = function (type) {
        type = type || 'light';
        try {
            if (hf) {
                if (type === 'success' || type === 'error' || type === 'warning') hf.notificationOccurred(type);
                else if (type === 'select') hf.selectionChanged();
                else hf.impactOccurred(type);
                return;
            }
            if (navigator.vibrate) navigator.vibrate(type === 'heavy' ? 30 : 12);
        } catch (e) {}
    };

    // Вибрация на КАЖДЫЙ тап по кнопкам, плиткам игр, мин, 
    // нижнему меню и любым элементам с onclick. Слушатель один, на уровне
    // документа, поэтому работает и для элементов, которые создаются позже.
    const CLICKABLE = 'button, a, [onclick], .game, .nav-item, .mines-tile, .mine-tile, .pct-btn, .action, label, select, input[type="checkbox"], input[type="radio"]';
    document.addEventListener('click', function (e) {
        const el = e.target && e.target.closest ? e.target.closest(CLICKABLE) : null;
        if (!el) return;
        if (el.disabled || el.getAttribute('aria-disabled') === 'true') return;
        window.haptic('light');
    }, true);
})();


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
    { level: 2, points: 5000,  title: "Гой" },
    { level: 3, points: 12500,  title: "Бурмалда" },
    { level: 4, points: 20000,  title: "Додеп" },
    { level: 5, points: 27500, title: "Лудик" },
    { level: 6, points: 38000, title: "Пепе" },
    { level: 7, points: 50001, title: "Легенда" }
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

// ============================================================
// RTP игры (Return To Player) — доля от каждой ставки, которая в среднем
// (по всем раундам и любой стратегии кэшаута) возвращается игрокам.
// House edge заведения = 1 - CRASH_RTP. Меняйте ТОЛЬКО эту константу —
// и вероятность мгновенного краха на 1.00x, и скорость роста коэффициента
// в calculateCrashPoint() ниже автоматически подстроятся под новое
// значение, ничего больше трогать не нужно.
const CRASH_RTP = 0.95;
// ============================================================

// 3. Расчет коэффициента на базе соли и хеша.
//
// Математика (стандартная provably-fair формула crash-игр): пусть X —
// равномерно случайное число в [0, 1), полученное из хеша раунда.
// Коэффициент считается как crash = CRASH_RTP / (1 - X).
//
// Тогда для любого m >= 1 верно: P(crash > m) = CRASH_RTP / m, а значит
// матожидание выплаты игроку, кэшаутнувшемуся на любом фиксированном m,
// равно m * P(crash >= m) = CRASH_RTP — ровно заявленный RTP, для КАЖДОГО
// m, а не только "в среднем по больнице". Мгновенный крах на 1.00x
// получается из этой же формулы сам по себе (когда X настолько мало, что
// crash < 1.00 и округляется вверх до 1.00) — его частота автоматически
// равна ровно (1 - CRASH_RTP), без отдельной "магической" ветки.
// ВАЖНО: тот же расчёт делает сервер в crash_tick() (crash_server.sql) —
// если меняешь формулу тут, меняй и там.
//
// Новое распределение: P(crash >= m) = m^(-CRASH_TAIL_ALPHA).
// При alpha = 1.5 крах на 4.00x и выше выпадает примерно раз в 8 игр
// (12.5%), на 3.00x и выше — ~19%, на 2.00x и выше — ~35%.
const CRASH_TAIL_ALPHA = 1.5;
function calculateCrashPoint(seed, salt) {
    let hash = seed + salt;
    let hex = hash.substring(0, 8);
    let intVal = parseInt(hex, 16);
    const maxVal = 4294967296; // 2^32 — диапазон intVal (8 hex-символов)

    const u = (intVal + 1) / maxVal;                 // (0, 1]
    const raw = Math.pow(u, -1 / CRASH_TAIL_ALPHA);  // >= 1
    let crash = Math.floor(raw * 100) / 100;

    crash = Math.max(1.00, crash);
    return Math.min(crash, 1000.00);
}

// Переменные состояния раунда — теперь это просто зеркало того, что лежит
// в общей строке раунда (crashLobby.round), см. applyCrashRound() ниже.
// Раунд один на ВСЕХ игроков сразу, поэтому ничего не генерируется на
// каждом клиенте отдельно — только тем клиентом, который реально создаёт
// новую строку в public.crash_rounds (см. generateCrashRoundSecrets()).
let currentCrashState = {
    salt: '',
    hash: '',
    crashPoint: 1.00,
    isFinished: false
};

// Генерирует hash/salt/crashPoint для НОВОГО раунда — вызывается только
// тем клиентом, который в этот момент реально создаёт строку раунда в
// Supabase (см. getOrCreateCrashRound() / maybeAdvanceCrash()).
async function generateCrashRoundSecrets() {
    const salt = generateRandomSeed(32);
    const hash = await generateSHA256(salt);
    const crashPoint = calculateCrashPoint(hash, salt);
    return { salt, hash, crashPoint };
}

// Вызывать при выходе со страницы краша — прячет раскрытый ключ обратно,
// чтобы при следующем заходе он снова появился только после нового краша.
function hideCrashRoundKey() {
    const keyInput = document.getElementById('crashRoundKeyInput');
    if (keyInput) keyInput.value = '';
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

// Создание/обновление профиля идёт через Edge Function ensure-player:
// сервер сам берёт id, ник и аватар из ПОДПИСАННОГО initData, поэтому
// подменить чужой профиль (отправив чужой telegram_id) больше нельзя.
async function ensurePlayerSecure() {
    // Мобильная сеть бывает нестабильной: при сетевой ошибке или битом ответе
    // пробуем ещё до 2 раз с паузой (ошибки сервера вроде INVALID_INIT_DATA не повторяем).
    let last = { data: null, error: 'NETWORK' };
    for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt) await new Promise(r => setTimeout(r, attempt * 900));
        try {
            const res = await fetch(SUPABASE_URL + '/functions/v1/ensure_player', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    apikey: SUPABASE_ANON_KEY,
                    Authorization: 'Bearer ' + SUPABASE_ANON_KEY
                },
                body: JSON.stringify({ init_data: tg?.initData || '' })
            });
            const j = await res.json().catch(() => null);
            if (j && j.ok && j.player) return { data: j.player, error: null };
            last = { data: null, error: j?.error || ('HTTP_' + res.status) };
            if (j && j.error) return last;          // сервер ответил осмысленной ошибкой
        } catch (e) {
            last = { data: null, error: 'NETWORK' };
        }
    }
    return last;
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
        const { data: newUser, error: createError } = await ensurePlayerSecure();

        if (createError) {
            console.error('Ошибка создания записи в Supabase:', createError);
            showMessage("Не удалось создать профиль. Проверьте соединение и перезапустите приложение. (код: " + (typeof createError === 'string' ? createError : 'ERR') + ")");
            return;
        }
        data = newUser;
    } else {
        const { data: updatedUser, error: updateError } = await ensurePlayerSecure();
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
       result text,
       resolved_at timestamptz,
       created_at timestamptz not null default now()
   );
   alter table public.live_bets enable row level security;
   create policy "live_bets_select_all" on public.live_bets for select using (true);
   create policy "live_bets_insert_all" on public.live_bets for insert with check (true);
   create policy "live_bets_update_all" on public.live_bets for update using (true) with check (true);
   alter publication supabase_realtime add table public.live_bets;

   (И включить Realtime для таблицы live_bets в Database → Replication,
   если ALTER PUBLICATION выше почему-то не сработает автоматически.)

   Если таблица live_bets уже существует (создана до полей result/resolved_at
   для вкладки "Действия" — начало и конец каждой ставки), докатить миграцией:

   alter table public.live_bets add column if not exists result text;
   alter table public.live_bets add column if not exists resolved_at timestamptz;
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
// (Мины, Краш, Колесо) — сохраняет ставку в Supabase, откуда её
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

// Вызывается по завершении КАЖДОЙ ставки (Мины/Краш — на "Забрать" или при
// проигрыше, Колесо — по итогу раунда, каким бы он ни был). Всегда
// дописывает время окончания (resolved_at) и результат — это и есть данные
// для глобальной вкладки "Действия" (начало ставки → её конец). Бегущая
// строка LIVE WINS по-прежнему показывает только заметные выигрыши — это
// решается отдельно, через isLiveTickerWin(), а не здесь.
async function resolveLiveBetWin(liveBetId, betAmount, winAmount) {
    if (!liveBetId) return;

    const bet = Number(betAmount) || 0;
    const amount = Number(winAmount) || 0;
    const multiplier = bet > 0 ? amount / bet : 0;

    const patch = {
        win_amount: roundMoney(amount),
        multiplier: roundMoney(multiplier),
        result: amount > 0 ? 'win' : 'loss',
        resolved_at: new Date().toISOString()
    };

    // Показываем стрелку "ставка → выигрыш" у автора ставки сразу же, не
    // дожидаясь ответа сервера — так это гарантированно видно на своём
    // экране, даже если запись в БД по какой-то причине задержится.
    patchLiveBetLocally(liveBetId, patch);

    try {
        const { error } = await supabase
            .from(LIVE_BETS_TABLE)
            .update(patch)
            .eq('id', liveBetId);
        if (error) console.error('Не удалось обновить live_bets:', error);
    } catch (e) {
        console.error('Не удалось обновить live_bets:', e);
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
                '<img class="live-wins-item-icon" src="images/crypto/tether.png" alt="USDT" draggable="false">' +
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
            '<img class="live-wins-item-icon" src="images/crypto/tether.png" alt="USDT" draggable="false">' +
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

/* =========================
   ЕДИНАЯ ЛОГИКА ПОЛЯ СТАВКИ (Мины / Краш)
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

/* =========================
   СОСТОЯНИЕ ПРИЛОЖЕНИЯ
========================= */

let balanceMode = "deposit";
let selectedMethod = "CryptoBot";
let selectedMethodSub = "Криптовалюта";
let selectedMethodIcon = "images/crypto/cryptobot.png";

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

let transactions = [];

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

// Мины считает Supabase (SQL-функции mines_*), поле с минами клиенту не отдаётся
async function minesApi(path, body) {
    const fn = { '/api/mines/start': 'mines_start', '/api/mines/reveal': 'mines_reveal',
                 '/api/mines/cashout': 'mines_cashout', '/api/mines/state': 'mines_state' }[path];
    const args = { p_init: tg?.initData || '' };
    if (fn === 'mines_start') { args.p_bet = body.bet; args.p_mines = body.mines; }
    if (fn === 'mines_reveal') { args.p_index = body.index; }
    try {
        const { data, error } = await supabase.rpc(fn, args);
        if (error) return { ok: false, error: error.message || 'Ошибка сервера' };
        return data;
    } catch (e) {
        return { ok: false, error: 'Нет соединения с сервером' };
    }
}

function applyMinesWin(res) {
    const winAmount = roundMoney(res.win);
    currentTotalWin = roundMoney(currentTotalWin + winAmount);
    currentWinsCount++;
    if (res.mult > currentMaxWin) currentMaxWin = res.mult;
    currentBalance = res.balance;
    setUIBalance(currentBalance);
    if (tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred("success");
    showMessage(`Выигрыш: +${winAmount.toFixed(2)}$ (${Number(res.mult).toFixed(2)}x)`);
    resolveLiveBetWin(minesGame.liveBetId, minesGame.bet, winAmount);
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
    currentTurnover = roundMoney(currentTurnover + bet);
    currentBetsCount++;
    setUIBalance(roundMoney(currentBalance - bet));

    // Ставку списывает и поле генерирует сервер — клиент поле не получает до конца игры
    const res = await minesApi('/api/mines/start', { bet, mines: minesGame.minesCount });
    if (!res.ok) {
        restoreBalanceState(snapshot);
        showMessage(res.error || "Не удалось начать игру.");
        minesGame.isProcessing = false;
        unlockEconomy();
        return;
    }
    currentBalance = res.balance;
    setUIBalance(currentBalance);

    minesGame.active = true;
    minesGame.bet = bet;
    minesGame.liveBetId = await broadcastLiveBet(bet, 'Мины');
    minesGame.gemsFound = 0;
    minesGame.revealed = Array(25).fill(false);
    minesGame.field = [];

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

async function clickMinesTile(index) {
    if (!minesGame.active || minesGame.revealed[index] || minesGame.isProcessing) return;
    minesGame.isProcessing = true;

    const res = await minesApi('/api/mines/reveal', { index });
    if (!res.ok) {
        showMessage(res.error || "Ошибка соединения");
        minesGame.isProcessing = false;
        return;
    }

    minesGame.revealed[index] = true;
    const tile = document.getElementById(`tile-${index}`);

    if (res.bomb) {
        tile.className = 'mine-tile revealed-bomb';
        tile.innerHTML = `<img src="images/mines/bomb.png" alt="bomb" style="width: 32px; height: 32px; object-fit: contain;">`;
        if (tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred("error");
        minesGame.field = res.field;
        endMinesGame(false);
        return;
    }

    minesGame.gemsFound = res.gems;
    tile.className = 'mine-tile revealed-gem';
    tile.innerHTML = `<img src="images/mines/gem.png" alt="gem" style="width: 32px; height: 32px; object-fit: contain;">`;
    if (tg?.HapticFeedback) tg.HapticFeedback.impactOccurred("light");

    const actionBtn = document.getElementById('minesActionBtn');
    if (res.finished) {
        minesGame.field = res.field;
        applyMinesWin(res);
        endMinesGame(true);
        return;
    }
    if (actionBtn) actionBtn.textContent = `ЗАБРАТЬ ${Number(res.potential).toFixed(2)}$`;
    renderMinesCoefBar();
    minesGame.isProcessing = false;
}

function autoPickMinesTile() {
    if (!minesGame.active || minesGame.isProcessing) return;
    let unrevealed = [];
    for (let i = 0; i < 25; i++) {
        if (!minesGame.revealed[i]) unrevealed.push(i);
    }
    if (unrevealed.length > 0) {
        clickMinesTile(unrevealed[Math.floor(Math.random() * unrevealed.length)]);
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

    const res = await minesApi('/api/mines/cashout');
    if (!res.ok) {
        showMessage(res.error || "Не удалось зачислить выигрыш. Нажмите «Забрать» ещё раз.");
        minesGame.isProcessing = false;
        unlockEconomy();
        return;
    }
    minesGame.field = res.field;
    applyMinesWin(res);
    endMinesGame(true);
    unlockEconomy();
}

// Если приложение закрыли посреди раунда — сервер хранит игру, возвращаем её на экран
async function resumeMinesGame() {
    if (!tg?.initData) return;
    const res = await minesApi('/api/mines/state');
    if (!res.ok || !res.active) return;
    if (!minesGame.active) minesGame.liveBetId = null;
    minesGame.active = true;
    minesGame.bet = res.bet;
    minesGame.minesCount = res.mines;
    minesGame.gemsFound = res.gems;
    minesGame.revealed = Array(25).fill(false);
    minesGame.field = [];
    for (let i = 0; i < 25; i++) {
        const tile = document.getElementById(`tile-${i}`);
        if (!tile) continue;
        tile.className = 'mine-tile';
        tile.innerHTML = '';
    }
    res.opened.forEach(i => {
        minesGame.revealed[i] = true;
        const tile = document.getElementById(`tile-${i}`);
        if (tile) {
            tile.className = 'mine-tile revealed-gem';
            tile.innerHTML = `<img src="images/mines/gem.png" alt="gem" style="width: 32px; height: 32px; object-fit: contain;">`;
        }
    });
    const actionBtn = document.getElementById('minesActionBtn');
    const autoBtn = document.getElementById('minesAutoBtn');
    if (actionBtn) actionBtn.textContent = res.gems > 0 ? `ЗАБРАТЬ ${Number(res.potential).toFixed(2)}$` : 'ОТКРОЙТЕ КЛЕТКУ';
    if (autoBtn) autoBtn.disabled = false;
    renderMinesCoefBar();
}

function endMinesGame(isWin) {
    minesGame.active = false;

    // Проигрыш (взорвалась бомба) тоже фиксируем как завершённое действие —
    // с временем окончания, для вкладки "Действия". При выигрыше это уже
    // делает resolveLiveBetWin() из cashoutMines().
    if (!isWin) {
        resolveLiveBetWin(minesGame.liveBetId, minesGame.bet, 0);
    }

    for (let i = 0; i < 25; i++) {
        const tile = document.getElementById(`tile-${i}`);
        if (!tile) continue;

        tile.classList.add('disabled');

        if (!minesGame.revealed[i]) {
            tile.classList.add('end-show');
            if (minesGame.field[i] === 'bomb') {
                tile.innerHTML = `<img src="images/mines/bomb.png" alt="bomb" style="width: 32px; height: 32px; object-fit: contain; opacity: 0.6;">`;
            } else {
                tile.innerHTML = `<img src="images/mines/gem.png" alt="gem" style="width: 32px; height: 32px; object-fit: contain; opacity: 0.6;">`;
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

// Хранение ленты прошлых коэффициентов — переживает перезаход в приложение.
/* ================================================================
   КРАШ — общий глобальный раунд (как Айс Арена)
   Раунд один на ВСЕХ игроков: момент старта полёта, коэффициент
   краша и таймер ожидания хранятся в Supabase, поэтому у всех
   открытых приложений одновременно летит ОДНА И ТА ЖЕ ракета с
   одинаковым исходом. Ниже поля ставки виден список игроков этого
   раунда — кто сейчас летит, кто уже забрал (и на сколько x), а кто
   проиграл — обновляется вживую через Supabase Realtime.

   Один раз выполнить в Supabase → SQL Editor:

   create table if not exists public.crash_rounds (
       id uuid primary key default gen_random_uuid(),
       game_number bigint generated always as identity,
       status text not null default 'waiting',   -- waiting | flying | crashed
       hash text not null,
       salt text not null,
       crash_point numeric not null,
       waiting_ends_at timestamptz,
       starts_at timestamptz,
       crashed_at timestamptz,
       created_at timestamptz not null default now()
   );
   create table if not exists public.crash_bets (
       id bigint generated always as identity primary key,
       round_id uuid not null references public.crash_rounds(id) on delete cascade,
       telegram_id bigint not null,
       name text not null,
       avatar text,
       amount numeric not null,
       status text not null default 'active',     -- active | cashed_out | lost
       cashout_mult numeric,
       win_amount numeric,
       created_at timestamptz not null default now(),
       unique (round_id, telegram_id)
   );

   create unique index if not exists crash_one_active_round
       on public.crash_rounds ((true))
       where status in ('waiting', 'flying');

   alter table public.crash_rounds enable row level security;
   alter table public.crash_bets enable row level security;
   create policy "crash_rounds_select" on public.crash_rounds for select using (true);
   create policy "crash_rounds_insert" on public.crash_rounds for insert with check (true);
   create policy "crash_rounds_update" on public.crash_rounds for update using (true) with check (true);
   create policy "crash_bets_select" on public.crash_bets for select using (true);
   create policy "crash_bets_insert" on public.crash_bets for insert with check (true);
   create policy "crash_bets_update" on public.crash_bets for update using (true) with check (true);
   alter publication supabase_realtime add table public.crash_rounds;
   alter publication supabase_realtime add table public.crash_bets;

   ВАЖНО про честность: salt и crash_point лежат в строке раунда с
   момента её создания, а select-политика открыта всем (как и у Айс
   Арены) — значит, теоретически их можно прочитать напрямую через
   Supabase API до краша. Это тот же уровень доверия, что и у
   остальных игр в этом файле (честность подтверждается постфактум
   через SHA-256, а не прячется настоящим сервером). Если нужна
   крипто-надёжная защита коэффициента до краша — понадобится
   Postgres RPC / Edge Function, которая отдаёт crash_point только
   после того, как раунд реально закрашился.
================================================================ */

const CRASH_ROUNDS_TABLE = 'crash_rounds';
const CRASH_BETS_TABLE = 'crash_bets';
// Очередь ставок на следующий раунд (SQL для таблицы — в crash_queue.sql)
const CRASH_QUEUE_TABLE = 'crash_queue';
const CRASH_QUEUE_MIN_AGE_MS = 2000;   // не переносим ставку в раунд раньше, чем закончилось её списание
const CRASH_HISTORY_MAX = 25;       // сколько прошедших раундов видно в ленте
const CRASH_RESULT_HOLD_MS = 3000;  // пауза с картинкой взрыва перед новым раундом

// КРИВАЯ РОСТА (одна и та же у коэффициента, следа и цифр; сервер считает так же):
//  1) до 1.45x — очень медленно, скорость плавно нарастает (степень POW);
//  2) с 1.45x рост продолжается с ТОЙ ЖЕ скоростью, на которой закончился
//     этап 1 (без скачка), и дальше непрерывно ускоряется до самого краша.
const CRASH_SLOW_START_TARGET = 1.45;
const CRASH_SLOW_START_MS = 7000;          // за сколько мс дорастаем до 1.45x
const CRASH_SLOW_POW = 2.5;                // «мягкость» разгона на этапе 1
// скорость роста (в долях/мс) в точке 1.45x — продолжение скорости этапа 1
const CRASH_GROWTH_PER_MS =
    ((CRASH_SLOW_START_TARGET - 1) * CRASH_SLOW_POW) / (CRASH_SLOW_START_MS * CRASH_SLOW_START_TARGET);
// дальнейшее ускорение: скорость роста удваивается примерно каждые 30 сек
const CRASH_GROWTH_ACCEL = CRASH_GROWTH_PER_MS / 30000;

/* ================================================================
   СИНХРОНИЗАЦИЯ ВРЕМЕНИ (почему раньше «скипались» пауза и взрыв)

   Раньше момент старта полёта, момент краша и конец паузы после
   взрыва считались по Date.now() КАЖДОГО телефона и сравнивались
   с отметками времени, которые записал другой телефон. Если часы
   у кого-то уходят вперёд хотя бы на пару секунд — он видел «пауза
   уже закончилась», сам создавал новый раунд, и у всех взрыв
   обрезался, а пауза пропадала.

   Теперь все считают по ВРЕМЕНИ СЕРВЕРА: при старте и раз в 90 сек
   клиент замеряет разницу между своими часами и серверными.
   Лучший способ — RPC server_now (SQL ниже). Если функции в БД
   нет, берём заголовок Date из ответа Supabase (точность ±0.5 с),
   а если и его нет — работаем по локальным часам, но со
   страховками от «кривых» отметок.

   Один раз выполнить в Supabase → SQL Editor:

   create or replace function public.server_now()
   returns timestamptz language sql as $$ select clock_timestamp() $$;
   grant execute on function public.server_now() to anon, authenticated;
================================================================ */
const CRASH_TIME_TOLERANCE_MS = 1500;   // допуск «отметка из будущего»
const CRASH_STALE_START_MS = 4000;      // старт просрочен дольше — не «задним числом»
const CRASH_TICK_MS = 250;              // страховочный тик (точные переходы — по таймерам)
const CRASH_ADVANCE_RETRY_MS = 500;     // не чаще — повтор записи перехода фазы в БД
const CRASH_CLOCK_RESYNC_MS = 90000;
const CRASH_EXPLOSION_REPLAY_WINDOW_MS = 1800; // открыл страницу сразу после краша — доигрываем взрыв

let crashClockOffset = 0;   // serverMs - localMs

function crashNow() { return Date.now() + crashClockOffset; }

async function syncCrashClockViaRpc() {
    let best = null;
    for (let i = 0; i < 4; i++) {
        const t0 = Date.now();
        const { data, error } = await supabase.rpc('server_now');
        const t1 = Date.now();
        if (error || !data) return null;
        const serverMs = new Date(data).getTime();
        if (!isFinite(serverMs)) return null;
        const rtt = t1 - t0;
        const off = serverMs + rtt / 2 - t1;
        if (!best || rtt < best.rtt) best = { rtt, off };
    }
    return best;
}

async function syncCrashClockViaHttpDate() {
    try {
        const t0 = Date.now();
        const res = await fetch(SUPABASE_URL + '/rest/v1/', {
            method: 'HEAD',
            headers: { apikey: SUPABASE_ANON_KEY },
            cache: 'no-store'
        });
        const t1 = Date.now();
        const h = res.headers.get('date');
        if (!h) return null;
        const d = new Date(h).getTime();
        if (!isFinite(d)) return null;
        // Date в заголовке — с точностью до секунды, берём середину секунды
        return { rtt: t1 - t0, off: d + 500 - (t0 + t1) / 2 };
    } catch (e) {
        return null;
    }
}

async function syncCrashClock() {
    let best = null;
    try { best = await syncCrashClockViaRpc(); } catch (e) { best = null; }
    if (!best) best = await syncCrashClockViaHttpDate();
    if (best) crashClockOffset = best.off;
}

// Математика полёта: за сколько мс коэффициент дорастает до crashPoint.
// Обратная функция к computeCrashMultAt() — по ней момент краша известен
// ЗАРАНЕЕ и одинаков у всех: старт полёта + эта длительность.
function computeCrashDurationMs(crashPoint) {
    const cp = Number(crashPoint) || 1;
    if (cp <= 1) return 0;
    if (cp <= CRASH_SLOW_START_TARGET) {
        const x = (cp - 1) / (CRASH_SLOW_START_TARGET - 1);
        return CRASH_SLOW_START_MS * Math.pow(x, 1 / CRASH_SLOW_POW);
    }
    // ln(m/1.45) = k*s + a*s^2/2  →  s = (-k + sqrt(k^2 + 2*a*L)) / a
    const L = Math.log(cp / CRASH_SLOW_START_TARGET);
    const k = CRASH_GROWTH_PER_MS, a = CRASH_GROWTH_ACCEL;
    const s = (-k + Math.sqrt(k * k + 2 * a * L)) / a;
    return CRASH_SLOW_START_MS + s;
}

function crashParseTime(iso) {
    const t = iso ? new Date(iso).getTime() : NaN;
    return isFinite(t) ? t : null;
}

// Отметки времени раунда неизменны, поэтому считаем их ОДИН раз при первом
// взгляде на раунд — так «кривая» отметка не может раз за разом сдвигать фазы.
const crashTimeCache = Object.create(null);

function crashStableTime(round, kind) {
    const key = round.id + ':' + kind;
    if (key in crashTimeCache) return crashTimeCache[key];

    const now = crashNow();
    let ms;
    if (kind === 'waitEnds') {
        ms = crashParseTime(round.waiting_ends_at);
        if (ms == null) {
            const c = crashParseTime(round.created_at);
            ms = (c != null ? c : now) + CRASH_WAIT_MS;
        }
        // создатель раунда с «убежавшими» часами — не ждём лишнего
        if (ms - now > CRASH_WAIT_MS + CRASH_TIME_TOLERANCE_MS) ms = now + CRASH_WAIT_MS;
    } else if (kind === 'plan') {
        // полёт стартует ровно в момент, когда отсчёт дошёл до нуля
        const ends = crashStableTime(round, 'waitEnds');
        ms = (now - ends > CRASH_STALE_START_MS) ? now : ends;
    } else { // 'start'
        ms = crashParseTime(round.starts_at);
        if (ms == null || ms - now > CRASH_TIME_TOLERANCE_MS) ms = now;
    }

    crashTimeCache[key] = ms;
    const keys = Object.keys(crashTimeCache);
    if (keys.length > 16) delete crashTimeCache[keys[0]];
    return ms;
}

/* ================================================================
   СОСТОЯНИЕ
================================================================ */
let crashGame = {
    phase: 'pending',   // 'pending' — раунд ещё не показан, 'waiting' — приём ставок, 'flying' — полёт, 'crashed' — пауза с итогом
    roundId: null,
    crashPoint: 0,
    currentMult: 1.00,
    bet: 0,
    betPlaced: false,
    cashedOut: false,
    cashoutMult: null,   // локально запомненный кэшаут (чтобы список игроков не «откатывался»)
    cashoutWin: null,
    cashoutRoundId: null,
    liveBetId: null,     // id строки в live_bets (общая лента всех игр)
    liveBetResolved: false,
    myBetRowId: null,    // id своей строки в crash_bets (для апдейта при кэшауте)
    queued: null,        // моя ставка в очереди на следующий раунд: {id, amount}
    queuedGraceUntil: 0, // пока не прошло это время — не сбрасываем queued, даже если опрос ещё не увидел строку
    queuedLive: null,    // запись в общей ленте для ставки из очереди: {id, amount, fromRoundId}
    startTime: 0,        // момент старта полёта (время сервера, общий для всех)
    waitEndsAt: 0,       // конец обратного отсчёта
    phaseEndsAt: 0,
    crashAt: 0,          // момент краша = startTime + длительность полёта до crashPoint
    explosionPlayed: false,
    isProcessing: false
};

// Общее состояние синхронизированного лобби краша — аналог iceArena.
let crashLobby = {
    round: null,        // последняя известная строка раунда из БД
    bets: [],           // мапленные ставки текущего раунда (для списка игроков)
    queue: [],          // ставки, ждущие следующий раунд
    queueMissing: false,// таблицы crash_queue ещё нет в БД
    promoting: false,
    channel: null,
    pollInterval: null,
    clockInterval: null,
    phaseTimer: null,   // точный таймер на ближайшую смену фазы
    countdownTimer: null,
    reloadTimer: null,
    advancing: false,
    lastAdvanceTry: 0,
    fetchSeq: 0,        // нумерация запросов — устаревший ответ не перетирает свежий
    appliedSeq: 0,
    lastCountdownDigit: null,
    lastPlayersHtml: null,
    sqlWarned: false
};

const CRASH_STATUS_RANK = { waiting: 0, flying: 1, crashed: 2 };
const CRASH_PHASE_ORDER = { pending: -1, waiting: 0, flying: 1, crashed: 2 };

let crashAnimHandle = null;
let crashLoopStarted = false;
let crashHistory = [];      // последние коэффициенты, самый новый — первый
let crashHistoryIds = new Set();
let lastCrashPoint = null;  // коэффициент прошлого раунда (для отображения в паузе)
let crashTrailPoints = [];  // точки следа ракеты за текущий полёт
let crashTrailTimers = [];
let crashRocketAnim = null; // экземпляр Lottie-анимации ракеты
let crashExplosionAnim = null; // экземпляр Lottie-анимации взрыва
let crashExplosionTotalFrames = 0; // общее число кадров анимации взрыва (берётся из её JSON)
let crashExplosionHideTimeout = null; // таймер плавного скрытия взрыва после проигрывания нужной части

// "Тяжёлые" визуальные обновления (SVG-след со стековыми drop-shadow,
// текст с text-shadow) обновляем не чаще ~30 раз/сек вместо 60 — глазом
// разница незаметна, а нагрузка на рендер падает почти вдвое. Ракета и
// тряска экрана (дешёвые transform) продолжают обновляться каждый кадр.
let crashLastHeavyUpdate = 0;
const CRASH_HEAVY_UPDATE_INTERVAL_MS = 50;   // след/текст ~20 раз/сек — на глаз то же, а нагрузка ниже

// Доля анимации взрыва, которая реально проигрывается при краше — по ТЗ
// нужна только самая первая часть (меньше половины), дальше идёт "хвост"
// анимации, который не нужен. Меняйте это число, чтобы точнее подогнать
// момент остановки под нужный кадр.
const EXPLOSION_PLAY_FRACTION = 0.34;
// Длительность плавного исчезновения взрыва после того, как проигранная
// часть анимации закончилась (совпадает с transition opacity в HTML).
const EXPLOSION_FADE_MS = 300;

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
            trailGlow: document.getElementById('crashTrailGlow'),
            trailHead: document.getElementById('crashTrailHead'),
            trailDotGlow: document.getElementById('crashTrailDotGlow'),
            topLeftMult: document.getElementById('crashMultTopLeft'),
            historyList: document.getElementById('crashHistoryList'),
            playersList: document.getElementById('crashPlayersList'),
            playersCount: document.getElementById('crashPlayersCount')
        };
    }
    return crashDomCache;
}

// ---- Хелперы следа: линия+свечение и точка+свечение всегда меняются вместе ----
function setTrailD(dom, d) {
    if (dom.trailLine) dom.trailLine.setAttribute('d', d);
    if (dom.trailGlow) dom.trailGlow.setAttribute('d', d);
}
function setTrailOpacity(dom, v) {
    if (dom.trailLine) dom.trailLine.style.opacity = v;
    if (dom.trailGlow) dom.trailGlow.style.opacity = v;
}
function setTrailCrashed(dom, on) {
    if (dom.trailLine) dom.trailLine.classList.toggle('crash-trail-crashed', on);
    if (dom.trailGlow) dom.trailGlow.classList.toggle('crash-trail-crashed', on);
}
function setDotOpacity(dom, v) {
    if (dom.trailDot) dom.trailDot.style.opacity = v;
    if (dom.trailDotGlow) dom.trailDotGlow.style.opacity = v;
}
function setDotCrashed(dom, on) {
    if (dom.trailDot) dom.trailDot.classList.toggle('crash-trail-crashed', on);
    if (dom.trailDotGlow) dom.trailDotGlow.classList.toggle('crash-trail-crashed', on);
}
function setDotLive(dom, on) {
    if (dom.trailDot) dom.trailDot.classList.toggle('crash-dot-live', on);
}

function isCrashPageVisible() {
    const page = document.getElementById('crashPage');
    return !!(page && !page.classList.contains('hidden'));
}

// Загружает анимацию ракеты
function initCrashRocketAnim() {
    const dom = getCrashDom();
    if (!dom.rocketEl || crashRocketAnim) return;

    const animationData = getLottieData('ROCKET');

    if (typeof lottie === 'undefined' || !animationData) {
        dom.rocketEl.innerHTML = '<span class="tge-spinner crash-anim-spinner"></span>';
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

    const animationData = getLottieData('EXPLOSION');

    if (typeof lottie === 'undefined' || !animationData) {
        dom.explosionEl.innerHTML = '<span class="tge-spinner crash-anim-spinner"></span>';
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
    // до конца, сразу плавно прячем взрыв — а не держим его "замороженным"
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

// Центр сцены, где стоит ракета (и где рисуется взрыв)
function crashRocketCenter() {
    return {
        x: (crashStageW - 200) / 2 - 16,
        y: 16 - (crashStageH - 200) / 2
    };
}

function initCrashPage() {
    initCrashRocketAnim();
    initCrashExplosionAnim();
    syncCrashStageDims();
    renderCrashHistory();
    renderCrashPlayersList();
    // Страница могла быть закрыта в момент краша/старта — подтягиваем
    // картинку под текущую фазу (и доигрываем взрыв, если пауза ещё идёт).
    resumeCrashVisualsOnOpen();
    // Подстраховка: сразу после открытия страницы её CSS-переход может ещё
    // не завершиться, поэтому один раз перемеряем на следующем кадре.
    requestAnimationFrame(syncCrashStageDims);
}

// Чистая математика роста коэффициента от прошедшего времени — вынесена
// отдельно, чтобы использовать и в tickCrash() (анимация), и при кэшауте.
function computeCrashMultAt(elapsedMs, crashPointCap) {
    const elapsed = Math.max(0, elapsedMs);
    let rawMult;
    if (elapsed < CRASH_SLOW_START_MS) {
        const p = elapsed / CRASH_SLOW_START_MS;
        const eased = Math.pow(p, CRASH_SLOW_POW);
        rawMult = 1 + (CRASH_SLOW_START_TARGET - 1) * eased;
    } else {
        const s = elapsed - CRASH_SLOW_START_MS;
        rawMult = CRASH_SLOW_START_TARGET *
            Math.exp(CRASH_GROWTH_PER_MS * s + 0.5 * CRASH_GROWTH_ACCEL * s * s);
    }
    const floored = Math.floor(rawMult * 100) / 100;
    return crashPointCap != null ? Math.min(crashPointCap, floored) : floored;
}

/* =========================
   СИНХРОНИЗАЦИЯ ОБЩЕГО РАУНДА (Supabase)
========================= */

// Запускается один раз при старте приложения (см. DOMContentLoaded ниже) —
// раунды крутятся всё время, пока хотя бы у одного игрока открыто
// приложение, независимо от того, на какой странице он сейчас находится
// (ровно как уже сделано для Айс Арены).
function makePagePoller(pageId, fn, offEvery) {
    let n = 0;
    return function () {
        if (document.hidden) return;
        const pg = document.getElementById(pageId);
        if (pg && pg.classList.contains('hidden')) {
            n = (n + 1) % offEvery;
            if (n !== 0) return;
        }
        fn();
    };
}

async function startCrashEngine() {
    if (crashLoopStarted) return;
    crashLoopStarted = true;

    // Часы — ПЕРВЫМ делом (но не дольше 2.5 сек, чтобы не тормозить запуск)
    await Promise.race([syncCrashClock(), new Promise(r => setTimeout(r, 2500))]);
    setInterval(syncCrashClock, CRASH_CLOCK_RESYNC_MS);
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) return;
        // вернулись из фона — таймеры могли «проспать», сверяем всё заново
        syncCrashClock().finally(() => { advanceLocalPhase(); });
        refreshCrashState();
    });

    await loadCrashHistoryFromServer();
    renderCrashHistory();

    await refreshCrashState();
    startCrashClock();

    if (!crashLobby.pollInterval) {
        crashLobby.pollInterval = setInterval(makePagePoller('crashPage', refreshCrashState, 3), 1000);
    }
    if (crashLobby.channel) return;
    try {
        crashLobby.channel = supabase
            .channel('crash_global')
            .on('postgres_changes', { event: '*', schema: 'public', table: CRASH_ROUNDS_TABLE }, () => scheduleCrashReload())
            .on('postgres_changes', { event: '*', schema: 'public', table: CRASH_BETS_TABLE }, () => scheduleCrashReload())
            .subscribe();
    } catch (e) {
        console.error('Crash realtime:', e);
    }
    // Очередь — отдельным каналом: если таблицы ещё нет, это не ломает основной канал краша
    try {
        supabase
            .channel('crash_queue_global')
            .on('postgres_changes', { event: '*', schema: 'public', table: CRASH_QUEUE_TABLE }, () => scheduleCrashReload())
            .subscribe();
    } catch (e) {
        console.error('Crash queue realtime:', e);
    }
}

function scheduleCrashReload() {
    if (crashLobby.reloadTimer) clearTimeout(crashLobby.reloadTimer);
    crashLobby.reloadTimer = setTimeout(() => {
        crashLobby.reloadTimer = null;
        refreshCrashState();
    }, 80);
}

// Страховочный тик. Основные переходы (старт полёта, краш, конец паузы)
// происходят по ТОЧНЫМ таймерам (scheduleCrashPhaseTimer) и не зависят от
// ответа сервера — тик лишь подстраховывает, если таймер «проспал» в фоне
// или запись перехода в БД не прошла с первого раза.
function startCrashClock() {
    if (crashLobby.clockInterval) return;
    crashLobby.clockInterval = setInterval(crashClockTick, CRASH_TICK_MS);
}

function crashClockTick() {
    advanceLocalPhase();
    maybeAdvanceCrash();
}

function scheduleCrashPhaseTimer() {
    clearTimeout(crashLobby.phaseTimer);
    let at;
    if (crashGame.phase === 'waiting') at = crashGame.waitEndsAt;
    else if (crashGame.phase === 'flying') at = crashGame.crashAt;
    else if (crashGame.phase === 'crashed') at = crashGame.crashAt + CRASH_RESULT_HOLD_MS;
    else return;
    crashLobby.phaseTimer = setTimeout(crashClockTick, Math.max(0, at - crashNow()) + 2);
}

function myCrashTelegramId() {
    return tg?.initDataUnsafe?.user?.id ?? null;
}

function mapCrashQueue(rows) {
    const myId = myCrashTelegramId();
    return (rows || []).map(q => ({
        id: q.id,
        telegramId: Number(q.telegram_id),
        name: q.name,
        avatar: q.avatar,
        amount: Number(q.amount),
        createdMs: crashParseTime(q.created_at),
        isUser: myId != null && Number(q.telegram_id) === Number(myId)
    }));
}

// Своя ставка в очереди определяется по БД; короткая «льгота» после нажатия
// нужна, чтобы опрос, пришедший раньше записи, не сбросил состояние.
function syncMyCrashQueue() {
    const mine = crashLobby.queue.find(q => q.isUser);
    if (mine) crashGame.queued = { id: mine.id, amount: mine.amount };
    else if (Date.now() >= crashGame.queuedGraceUntil) crashGame.queued = null;
}

// Когда начался новый раунд (ожидание ставок) — переносим все ставки из очереди в него.
// Делает КАЖДЫЙ открытый клиент: вставка идемпотентна (unique round_id+telegram_id,
// дубликаты игнорируются), поэтому гонка между клиентами безвредна.
async function promoteCrashQueue() {
    const round = crashLobby.round;
    if (crashLobby.promoting || crashLobby.queueMissing || !crashLobby.queue.length) return;
    if (!round || round.id !== crashGame.roundId || round.status !== 'waiting' || crashGame.phase !== 'waiting') return;
    if (crashNow() >= crashGame.waitEndsAt - 300) return;   // поздно — ставка уйдёт в следующий раунд

    const now = crashNow();
    const ready = crashLobby.queue.filter(q => q.createdMs == null || now - q.createdMs >= CRASH_QUEUE_MIN_AGE_MS);
    if (!ready.length) return;

    crashLobby.promoting = true;
    try {
        for (const q of ready) {
            const { error } = await supabase.from(CRASH_BETS_TABLE).upsert({
                round_id: round.id,
                telegram_id: q.telegramId,
                name: q.name,
                avatar: q.avatar,
                amount: q.amount,
                status: 'active'
            }, { onConflict: 'round_id,telegram_id', ignoreDuplicates: true });
            if (error) { console.error('Crash queue promote:', error); continue; }
            const { error: delErr } = await supabase.from(CRASH_QUEUE_TABLE).delete().eq('id', q.id);
            if (delErr) console.error('Crash queue cleanup:', delErr);
        }
    } catch (e) {
        console.error('Crash queue promote:', e);
    } finally {
        crashLobby.promoting = false;
    }
    scheduleCrashReload();
}

// Можно ли сейчас поставить «на следующий раунд» (идёт полёт или пауза после краша).
function crashCanQueue() {
    if (crashGame.queued) return false;
    if (crashGame.phase === 'crashed') return true;
    if (crashGame.phase === 'flying') return !crashGame.betPlaced || crashGame.cashedOut;
    return false;
}

function crashCanEditBet() {
    if (crashGame.queued) return false;
    if (crashGame.phase === 'waiting') return !crashGame.betPlaced;
    return crashCanQueue();
}

async function queueCrashBet() {
    advanceLocalPhase();
    if (!crashCanQueue() || crashGame.isProcessing) return;
    if (crashLobby.queueMissing) {
        showMessage('Ставки на следующий раунд: таблица crash_queue ещё не создана в базе.');
        return;
    }
    const myId = myCrashTelegramId();
    if (myId == null) return;
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
    const fromRoundId = crashGame.roundId;
    const myName = document.getElementById('username')?.textContent?.trim() || 'Игрок';
    const myAvatar = getMyIceArenaAvatar();

    // 1) Сначала занимаем место в очереди (unique по игроку — вторую не создать)
    const { data: row, error: qErr } = await supabase.from(CRASH_QUEUE_TABLE).insert({
        telegram_id: myId, name: myName, avatar: myAvatar, amount: bet
    }).select('id, created_at').single();
    if (qErr || !row) {
        if (qErr && qErr.code === '23505') showMessage('Ваша ставка уже стоит в очереди.');
        else showMessage('Не удалось поставить на следующий раунд. Попробуйте ещё раз.');
        if (qErr && qErr.code !== '23505') console.error('Crash queue insert:', qErr);
        crashGame.isProcessing = false;
        unlockEconomy();
        scheduleCrashReload();
        return;
    }

    // 2) Списываем деньги
    const snapshot = snapshotBalanceState();
    currentTurnover = roundMoney(currentTurnover + bet);
    currentBetsCount++;
    setUIBalance(roundMoney(currentBalance - bet));

    const debitResult = await placeBetServer(bet, 'Краш');
    if (!debitResult.ok) {
        restoreBalanceState(snapshot);
        await supabase.from(CRASH_QUEUE_TABLE).delete().eq('id', row.id);
        showMessage("Не удалось списать ставку. Проверьте соединение и попробуйте снова.");
        crashGame.isProcessing = false;
        unlockEconomy();
        scheduleCrashReload();
        return;
    }
    currentBalance = debitResult.balance;
    setUIBalance(currentBalance);

    crashGame.queued = { id: row.id, amount: bet };
    crashGame.queuedGraceUntil = Date.now() + 5000;
    // сразу показываем себя в «Ожидании», не дожидаясь опроса
    crashLobby.queue = crashLobby.queue.filter(q => !q.isUser).concat([{
        id: row.id, telegramId: Number(myId), name: myName, avatar: myAvatar,
        amount: bet, createdMs: crashParseTime(row.created_at), isUser: true
    }]);
    renderCrashPlayersList();
    renderCrashUI();

    const liveId = await broadcastLiveBet(bet, 'Краш');
    crashGame.queuedLive = { id: liveId, amount: bet, fromRoundId };

    crashGame.isProcessing = false;
    unlockEconomy();
    renderCrashUI();
    scheduleCrashReload();
}

function mapCrashBetsToPlayers(bets) {
    const myId = myCrashTelegramId();
    return (bets || []).map(b => {
        const isUser = myId != null && Number(b.telegram_id) === Number(myId);
        let status = b.status || 'active';   // active | cashed_out | lost
        let cashoutMult = b.cashout_mult != null ? Number(b.cashout_mult) : null;
        let winAmount = b.win_amount != null ? Number(b.win_amount) : null;

        // Свой кэшаут показываем сразу, не дожидаясь, пока он долетит до БД
        if (isUser && crashGame.cashedOut && crashGame.cashoutRoundId === b.round_id && status !== 'cashed_out') {
            status = 'cashed_out';
            cashoutMult = crashGame.cashoutMult;
            winAmount = crashGame.cashoutWin;
        }

        return {
            id: b.id,
            telegramId: Number(b.telegram_id),
            name: b.name,
            avatar: b.avatar,
            amount: Number(b.amount),
            status,
            cashoutMult,
            winAmount,
            isUser
        };
    });
}

let lastCrashBetsRaw = [];

async function refreshCrashState() {
    const seq = ++crashLobby.fetchSeq;
    try {
        // 1. Сначала ищем АКТИВНЫЙ раунд (waiting/flying), а не просто самый свежий
        let round = null;
        const { data: active, error } = await supabase
            .from(CRASH_ROUNDS_TABLE)
            .select('*')
            .in('status', ['waiting', 'flying'])
            .order('created_at', { ascending: true })
            .limit(1);

        if (error) {
            console.error('Crash rounds:', error);
            if (String(error.message || '').includes('does not exist') || error.code === '42P01' || error.code === 'PGRST205') {
                if (!crashLobby.sqlWarned) {
                    crashLobby.sqlWarned = true;
                    showMessage('Краш: выполните SQL из комментария в script.js в Supabase (таблицы раунда ещё не созданы).');
                }
            }
            return;
        }
        round = active && active[0];

        // 2. Активного нет — берём последний завершённый (для паузы после краша)
        if (!round) {
            const { data: last } = await supabase
                .from(CRASH_ROUNDS_TABLE)
                .select('*')
                .order('created_at', { ascending: false })
                .limit(1);
            round = last && last[0];
        }

        // 3. Раундов вообще нет — создаём первый
        if (!round) {
            round = await getOrCreateCrashRound();
            if (!round) return;
        }

        // 4. Ставки: если запрос упал, игра всё равно идёт со старым списком
        let bets = lastCrashBetsRaw;
        const { data: betsData, error: betsErr } = await supabase
            .from(CRASH_BETS_TABLE)
            .select('*')
            .eq('round_id', round.id)
            .order('created_at', { ascending: true });

        if (betsErr) {
            console.error('Crash bets:', betsErr);
        } else {
            bets = betsData || [];
            lastCrashBetsRaw = bets;
        }

        // 5. Очередь ставок на следующий раунд (если таблицы нет — просто пропускаем)
        let queueRaw = null;
        if (!crashLobby.queueMissing) {
            const { data: qd, error: qe } = await supabase
                .from(CRASH_QUEUE_TABLE)
                .select('*')
                .order('created_at', { ascending: true });
            if (qe) {
                const missing = qe.code === '42P01' || qe.code === 'PGRST205' ||
                    /does not exist|could not find the table/i.test(qe.message || '');
                if (missing) {
                    crashLobby.queueMissing = true;
                    console.warn('crash_queue не найдена в БД — выполни crash_queue.sql');
                } else console.error('Crash queue:', qe);
            } else {
                queueRaw = qd || [];
            }
        }

        // Ответ устарел — пока он летел, уже применился более свежий запрос
        if (seq < crashLobby.appliedSeq) return;
        crashLobby.appliedSeq = seq;

        if (queueRaw) {
            crashLobby.queue = mapCrashQueue(queueRaw);
            syncMyCrashQueue();
        }
        applyCrashRound(round, bets);
        maybeAdvanceCrash();
        promoteCrashQueue();
    } catch (e) {
        console.error('Crash state:', e);
    }
}

async function getOrCreateCrashRound() {
    const { data: active } = await supabase
        .from(CRASH_ROUNDS_TABLE)
        .select('*')
        .in('status', ['waiting', 'flying'])
        .order('created_at', { ascending: false })
        .limit(1);

    if (active && active[0]) return active[0];

    const secrets = await generateCrashRoundSecrets();
    const { data: created, error } = await supabase
        .from(CRASH_ROUNDS_TABLE)
        .insert({
            status: 'waiting',
            hash: secrets.hash,
            salt: secrets.salt,
            crash_point: secrets.crashPoint,
            waiting_ends_at: new Date(crashNow() + CRASH_WAIT_MS).toISOString()
        })
        .select()
        .single();

    if (!error && created) return created;

    const { data: retry } = await supabase
        .from(CRASH_ROUNDS_TABLE)
        .select('*')
        .in('status', ['waiting', 'flying'])
        .order('created_at', { ascending: false })
        .limit(1);

    return retry && retry[0] ? retry[0] : null;
}

// Раскладывает отметки времени раунда по локальному состоянию.
function setCrashRoundTimes(round) {
    if (round.status === 'waiting') {
        crashGame.waitEndsAt = crashStableTime(round, 'waitEnds');
        crashGame.phaseEndsAt = crashGame.waitEndsAt;
        crashGame.startTime = crashStableTime(round, 'plan');
    } else {
        crashGame.startTime = crashStableTime(round, 'start');
    }
    // Раунд закрашен, а starts_at в БД нет (ручная запись) — не ждём «полёта»
    const noStamp = round.status === 'crashed' && !round.starts_at;
    crashGame.crashAt = crashGame.startTime + (noStamp ? 0 : computeCrashDurationMs(crashGame.crashPoint));
}

// Применяет строку раунда из БД к локальному состоянию экрана — вызывается
// у КАЖДОГО открытого клиента при каждом опросе/realtime-событии. БД даёт
// только «опорные точки» (кто выиграл/проиграл, когда стартовал полёт), а
// сами фазы и их визуал идут по локальному таймлайну — поэтому взрыв и
// конец паузы не зависят от того, как быстро долетел ответ сервера.
function applyCrashRound(round, bets) {
    const cur = crashLobby.round;
    const sameRound = !!(cur && cur.id === round.id);

    // Устаревший снимок того же раунда (например, опрос с «flying» пришёл
    // позже, чем realtime-событие «crashed») — статус назад не откатываем.
    if (sameRound && (CRASH_STATUS_RANK[round.status] ?? 0) < (CRASH_STATUS_RANK[cur.status] ?? 0)) {
        crashLobby.bets = mapCrashBetsToPlayers(bets);
        renderCrashPlayersList();
        return;
    }
    // Ответ про раунд старее того, что уже на экране — игнорируем
    if (cur && !sameRound && round.created_at && cur.created_at &&
        new Date(round.created_at).getTime() < new Date(cur.created_at).getTime()) {
        return;
    }

    // ЗАЩИТА ПАУЗЫ: новый раунд мог быть создан в БД раньше времени (чьи-то
    // «убежавшие» часы, гонка клиентов). Пока у НАС идёт пауза после краша
    // предыдущего раунда — не переключаемся, а применяем новый раунд ровно
    // в конце паузы. Так пауза со взрывом не пропадает ни у кого.
    // Опираемся на ЛОКАЛЬНУЮ фазу, а не на статус из БД: при медленной сети
    // клиент может так и не получить 'flying'/'crashed', хотя по времени
    // раунд уже взорвался (в этом случае cur.status застревает на 'waiting').
    if (cur && !sameRound && crashGame.roundId === cur.id &&
        (crashGame.phase === 'flying' || crashGame.phase === 'crashed')) {
        const holdEnd = crashGame.crashAt + CRASH_RESULT_HOLD_MS;
        const wait = Math.min(holdEnd - crashNow(), 120000);
        if (wait > 0) {
            crashLobby.deferredRound = { round, bets };
            clearTimeout(crashLobby.deferTimer);
            crashLobby.deferTimer = setTimeout(() => {
                const d = crashLobby.deferredRound;
                crashLobby.deferredRound = null;
                if (d) applyCrashRound(d.round, d.bets);
            }, wait + 5);
            return;
        }
    }
    crashLobby.deferredRound = null;

    crashLobby.round = round;

    if (!sameRound) {
        if (crashGame.roundId) {
            // Начался НОВЫЙ раунд — сбрасываем локальный след своей ставки.
            crashGame.bet = 0;
            crashGame.betPlaced = false;
            crashGame.cashedOut = false;
            crashGame.cashoutMult = null;
            crashGame.cashoutWin = null;
            crashGame.cashoutRoundId = null;
            crashGame.liveBetId = null;
            crashGame.liveBetResolved = false;
            crashGame.myBetRowId = null;
        }
        crashGame.roundId = round.id;
        crashGame.phase = 'pending';
        crashGame.currentMult = 1.00;
        crashGame.explosionPlayed = false;
    }
    crashGame.crashPoint = Number(round.crash_point) || 1;
    setCrashRoundTimes(round);

    crashLobby.bets = mapCrashBetsToPlayers(bets);

    // Блок "доказуемой честности" — хеш виден всегда, ключ (salt) только
    // после краша этого раунда.
    currentCrashState = {
        salt: round.status === 'crashed' ? (round.salt || '') : '',
        hash: round.hash || '',
        crashPoint: Number(round.crash_point) || 1,
        isFinished: round.status === 'crashed'
    };
    const hashInput = document.getElementById('crashRoundHashInput');
    if (hashInput) hashInput.value = currentCrashState.hash;
    const keyInput = document.getElementById('crashRoundKeyInput');
    if (keyInput) keyInput.value = currentCrashState.salt;

    // Подхватываем свою уже сделанную в этом раунде ставку — например,
    // если игрок перезашёл в приложение посреди ожидания/полёта.
    // ВАЖНО: cashedOut только поднимаем в true и никогда не сбрасываем назад —
    // иначе опрос, пришедший раньше, чем кэшаут записался в БД, на секунду
    // возвращал кнопку «Забрать» (и можно было нажать второй раз).
    updateCrashTopbar();
    const mine = crashLobby.bets.find(b => b.isUser);
    if (mine) {
        crashGame.bet = mine.amount;
        crashGame.betPlaced = true;
        if (mine.status === 'cashed_out') crashGame.cashedOut = true;
        crashGame.myBetRowId = mine.id;
        // ставка переехала из очереди в этот раунд — подхватываем её запись в ленте
        const ql = crashGame.queuedLive;
        if (ql && round.id !== ql.fromRoundId && Math.abs(ql.amount - mine.amount) < 0.005) {
            crashGame.liveBetId = ql.id;
            crashGame.liveBetResolved = false;
            crashGame.queuedLive = null;
        }
    }

    advanceLocalPhase();
    renderCrashUI();
    renderCrashPlayersList();
    scheduleCrashPhaseTimer();
}

// Двигает ЛОКАЛЬНУЮ фазу вперёд: waiting → flying → crashed. Фаза определяется
// и БД (если там статус уже ушёл вперёд), и серверными часами — что раньше.
// Назад фаза никогда не идёт.
function advanceLocalPhase() {
    const round = crashLobby.round;
    if (!round || round.id !== crashGame.roundId) return;

    const now = crashNow();
    const dbRank = CRASH_STATUS_RANK[round.status] ?? 0;

    let want = 'waiting';
    if (dbRank >= 1 || now >= crashGame.startTime) want = 'flying';
    if (dbRank >= 2 || (want === 'flying' && now >= crashGame.crashAt)) want = 'crashed';

    if (CRASH_PHASE_ORDER[want] <= CRASH_PHASE_ORDER[crashGame.phase]) {
        scheduleCrashPhaseTimer();
        return;
    }

    crashGame.phase = want;
    updateCrashTopbar();
    if (want === 'waiting') {
        enterWaitingVisual();
    } else if (want === 'flying') {
        beginFlyingPhaseVisual();
    } else {
        // Взрыв играем всегда, пока идёт пауза после краша (даже если пришли
        // с запозданием); если пауза давно прошла — просто итоговая картинка.
        endCrashRoundVisual(now - crashGame.crashAt < CRASH_RESULT_HOLD_MS);
    }
    renderCrashPlayersList();
    scheduleCrashPhaseTimer();
}

// Записывает переход фазы в БД (чтобы остальные клиенты и новые игроки видели
// то же самое). Вызывается у КАЖДОГО открытого клиента — реально применится
// у того, кто первым успеет с условным UPDATE (условие "eq status" защищает
// от гонки, как и в Айс Арене). Отметки времени пишем ДЕТЕРМИНИРОВАННЫЕ
// (конец отсчёта / расчётный момент краша), а не «когда мы успели» — поэтому
// задержка сети или медленный клиент ничего не сдвигают.
// Серверная версия: переходы фаз делает Postgres-функция crash_tick()
// (см. crash_server.sql) по ВРЕМЕНИ СЕРВЕРА. Клиент лишь «подталкивает» её,
// когда по его расчётам фаза должна смениться, — результат при этом от
// клиента не зависит. Если SQL ещё не установлен — работает прежняя логика.
let crashTickMissing = false;
async function maybeAdvanceCrash() {
    if (crashTickMissing) return maybeAdvanceCrashLegacy();
    const round = crashLobby.round;
    if (!round || crashLobby.advancing) return;
    if (round.id !== crashGame.roundId) return;

    const now = crashNow();
    if (now - crashLobby.lastAdvanceTry < 1000) return;

    const due =
        (now >= crashGame.waitEndsAt && (round.status === 'waiting')) ||
        (now >= crashGame.crashAt && (round.status === 'flying' || round.status === 'waiting')) ||
        (now >= crashGame.crashAt + CRASH_RESULT_HOLD_MS);
    if (!due) return;

    crashLobby.advancing = true;
    crashLobby.lastAdvanceTry = now;
    try {
        const { error } = await supabase.rpc('crash_tick');
        if (error) {
            const missing = error.code === 'PGRST202' || error.code === '42883' ||
                /could not find the function|does not exist/i.test(error.message || '');
            if (missing) {
                crashTickMissing = true;
                console.warn('crash_tick не найден в БД — выполни crash_server.sql; пока работает старая логика');
            } else {
                console.error('crash_tick:', error);
            }
        }
    } catch (e) {
        console.error('crash_tick:', e);
    } finally {
        crashLobby.advancing = false;
    }
    scheduleCrashReload();
}

async function maybeAdvanceCrashLegacy() {
    const round = crashLobby.round;
    if (!round || crashLobby.advancing) return;
    if (round.id !== crashGame.roundId) return;

    const now = crashNow();
    if (now - crashLobby.lastAdvanceTry < CRASH_ADVANCE_RETRY_MS) return;

    let action = null;
    if (round.status === 'waiting' && now >= crashGame.waitEndsAt) action = 'start';
    else if (round.status === 'flying' && now >= crashGame.crashAt) action = 'crash';
    else if (round.status === 'crashed' && now >= crashGame.crashAt + CRASH_RESULT_HOLD_MS) action = 'next';
    if (!action) return;

    crashLobby.advancing = true;
    crashLobby.lastAdvanceTry = now;
    try {
        if (action === 'start') {
            const startIso = new Date(crashStableTime(round, 'plan')).toISOString();
            const { data, error } = await supabase.from(CRASH_ROUNDS_TABLE)
                .update({ status: 'flying', starts_at: startIso })
                .eq('id', round.id)
                .eq('status', 'waiting')
                .select('id');
            if (error) throw error;
            if (data && data.length && crashLobby.round && crashLobby.round.id === round.id && crashLobby.round.status === 'waiting') {
                crashLobby.round = { ...crashLobby.round, status: 'flying', starts_at: startIso };
            }
        } else if (action === 'crash') {
            const crashedIso = new Date(crashGame.crashAt).toISOString();
            const { data, error } = await supabase.from(CRASH_ROUNDS_TABLE)
                .update({ status: 'crashed', crashed_at: crashedIso })
                .eq('id', round.id)
                .eq('status', 'flying')
                .select('id');
            if (error) throw error;

            // Раунд закрашили именно мы — заодно помечаем всех, кто не успел
            // забрать выигрыш, как проигравших (для списка игроков у ВСЕХ,
            // даже если их приложение к этому моменту уже закрыто).
            if (data && data.length) {
                if (crashLobby.round && crashLobby.round.id === round.id && crashLobby.round.status === 'flying') {
                    crashLobby.round = { ...crashLobby.round, status: 'crashed', crashed_at: crashedIso };
                }
                await supabase.from(CRASH_BETS_TABLE)
                    .update({ status: 'lost', win_amount: 0 })
                    .eq('round_id', round.id)
                    .eq('status', 'active');
            }
        } else {
            const secrets = await generateCrashRoundSecrets();
            const { error } = await supabase.from(CRASH_ROUNDS_TABLE).insert({
                status: 'waiting',
                hash: secrets.hash,
                salt: secrets.salt,
                crash_point: secrets.crashPoint,
                waiting_ends_at: new Date(Math.max(crashNow(), crashGame.crashAt + CRASH_RESULT_HOLD_MS) + CRASH_WAIT_MS).toISOString()
            });
            // 23505 — гонка: кто-то другой уже успел создать новый раунд,
            // это нормально и не является ошибкой.
            if (error && error.code !== '23505') console.error('Crash next round:', error);
        }
    } catch (e) {
        console.error('Crash advance (' + action + '):', e);
    } finally {
        crashLobby.advancing = false;
    }
    scheduleCrashReload();
}

/* =========================
   ИСТОРИЯ ПРОШЕДШИХ РАУНДОВ (общая, из Supabase)
========================= */

async function loadCrashHistoryFromServer() {
    try {
        const { data, error } = await supabase
            .from(CRASH_ROUNDS_TABLE)
            .select('id, crash_point, created_at')
            .eq('status', 'crashed')
            .order('created_at', { ascending: false })
            .limit(CRASH_HISTORY_MAX);

        if (error) {
            console.error('Crash history:', error);
            return;
        }
        crashHistory = (data || []).map(r => Number(r.crash_point));
        crashHistoryIds = new Set((data || []).map(r => r.id));
    } catch (e) {
        console.error('Crash history:', e);
    }
}

function pushCrashHistoryPoint(point) {
    crashHistory.unshift(point);
    if (crashHistory.length > CRASH_HISTORY_MAX) crashHistory.length = CRASH_HISTORY_MAX;
}

/* =========================
   ВИЗУАЛЬНЫЕ ФАЗЫ: ОЖИДАНИЕ / ПОЛЁТ / КРАШ
========================= */

function clearCrashTrailTimers() {
    crashTrailTimers.forEach(clearTimeout);
    crashTrailTimers = [];
}

function resetCrashTrail() {
    const dom = getCrashDom();
    clearCrashTrailTimers();
    crashTrailPoints = [];
    setTrailD(dom, '');
    setTrailCrashed(dom, false);
    setTrailOpacity(dom, '1');
    setDotCrashed(dom, false);
    setDotLive(dom, false);
    setDotOpacity(dom, '0');
}

// Вход в фазу ожидания: ЕДИНОРАЗОВАЯ подготовка сцены (раньше она повторялась
// каждые 250 мс и заодно стирала взрыв и перезапускала ракету).
function enterWaitingVisual() {
    const dom = getCrashDom();
    syncCrashStageDims();
    crashLobby.lastCountdownDigit = null;
    crashGame.currentMult = 1.00;

    clearTimeout(crashExplosionHideTimeout);
    if (dom.explosionEl) dom.explosionEl.style.display = 'none';
    if (crashExplosionAnim) crashExplosionAnim.goToAndStop(0, true);
    if (dom.stageEl) dom.stageEl.style.transform = 'translate3d(0px, 0px, 0px)';

    resetCrashTrail();

    if (dom.topLeftMult) {
        dom.topLeftMult.classList.remove('crashed');
        dom.topLeftMult.style.display = 'none';
    }
    if (dom.multEl) {
        dom.multEl.textContent = '1.00x';
        dom.multEl.style.color = '#fff';
    }
    if (dom.rocketEl) {
        const c = crashRocketCenter();
        dom.rocketEl.style.transform = `translate3d(${c.x}px, ${c.y}px, 0px) rotate(45deg)`;
    }
    if (crashRocketAnim) crashRocketAnim.goToAndPlay(0, true);
    if (dom.betInput) dom.betInput.disabled = crashGame.betPlaced || !!crashGame.queued;

    renderCrashCountdown(true);
    renderCrashUI();
}

// Номер раунда для показа: +1 только за раунды, в которых была хотя бы одна ставка.
// game_number в БД — identity и растёт на каждый новый раунд (даже пустой), поэтому
// считаем сами: сколько раундов ДО текущего имели ставки, плюс 1. Пустые раунды
// подряд показывают один и тот же номер, пока кто-то не поставит.
const crashNumCache = { roundId: null, base: null, loading: false };
function crashDisplayNumber(round) {
    if (!round || !round.game_number) return null;
    if (crashNumCache.roundId === round.id && crashNumCache.base !== null) return crashNumCache.base + 1;
    if (crashNumCache.loading !== round.id) {
        crashNumCache.loading = round.id;
        supabase
            .from(CRASH_ROUNDS_TABLE)
            .select('id, ' + CRASH_BETS_TABLE + '!inner(id)', { count: 'exact', head: true })
            .lt('game_number', round.game_number)
            .then(({ count, error }) => {
                if (crashNumCache.loading === round.id) crashNumCache.loading = false;
                if (error || count === null || count === undefined) { console.error('Crash round number:', error); return; }
                crashNumCache.roundId = round.id;
                crashNumCache.base = count;
                updateCrashTopbar();
            });
    }
    // пока считаем — показываем прошлое значение для того же раунда, иначе прочерк
    return crashNumCache.base !== null && crashNumCache.roundId === round.id ? crashNumCache.base + 1 : null;
}

// Верхняя панель краша: БАНК (все ставки раунда), ИГРА (#номер раунда
// с сервера), СТАРТ ЧЕРЕЗ (цифры отсчёта только во время ожидания).
let crashTopbarLastTimer = '';
function updateCrashTopbar() {
    const bankEl = document.getElementById('crashBankValue');
    const numEl = document.getElementById('crashGameNumber');
    const timerEl = document.getElementById('crashTimerValue');
    if (bankEl) {
        const bank = (crashLobby.bets || []).reduce((s, b) => s + (Number(b.amount) || 0), 0);
        bankEl.textContent = bank.toFixed(2) + ' $';
    }
    if (numEl) {
        const n = crashDisplayNumber(crashLobby.round);
        numEl.textContent = n ? '#' + n : '—';
    }
    if (timerEl) {
        let text = '—', cls = '';
        if (crashGame.phase === 'waiting') {
            const sec = Math.ceil((crashGame.waitEndsAt - crashNow()) / 1000);
            if (sec >= 1) {
                text = String(Math.min(sec, 99));
                cls = sec >= 4 ? 'tb-green' : (sec >= 2 ? 'tb-yellow' : 'tb-red');
            }
        }
        if (text !== crashTopbarLastTimer) {
            crashTopbarLastTimer = text;
            timerEl.textContent = text;
            timerEl.className = cls;
            if (cls) { void timerEl.offsetWidth; timerEl.classList.add('tb-pop'); }
        }
    }
}

// Обратный отсчёт: меняем DOM только когда цифра реально сменилась, а
// следующую смену ставим на ТОЧНУЮ границу секунды.
function renderCrashCountdown(force) {
    updateCrashTopbar();
    if (crashGame.phase !== 'waiting') return;
    const dom = getCrashDom();
    const msLeft = crashGame.waitEndsAt - crashNow();
    const secLeft = Math.ceil(msLeft / 1000);

    clearTimeout(crashLobby.countdownTimer);
    if (msLeft > 0) {
        crashLobby.countdownTimer = setTimeout(() => renderCrashCountdown(false), (msLeft % 1000 || 1000) + 3);
    }

    if (secLeft < 1) return;                      // старт полёта — за него отвечает таймер фазы
    if (!force && secLeft === crashLobby.lastCountdownDigit) return;
    crashLobby.lastCountdownDigit = secLeft;

    if (dom.statusEl) {
        dom.statusEl.textContent = lastCrashPoint !== null
            ? `Прошлый раунд: ${lastCrashPoint.toFixed(2)}x · Старт через ${secLeft}с`
            : `Старт через ${secLeft}с`;
    }

    if (secLeft <= 5) {
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
}

// Общая «обвязка» экрана для фазы полёта (используется и при старте, и
// когда игрок открывает страницу посреди полёта).
function showFlyingChrome() {
    const dom = getCrashDom();
    if (dom.countdownEl) dom.countdownEl.style.display = 'none';
    if (dom.centerInfoEl) dom.centerInfoEl.style.opacity = '0';
    if (dom.rocketEl) dom.rocketEl.style.opacity = '1';
    if (dom.explosionEl) dom.explosionEl.style.display = 'none';
    if (dom.topLeftMult) {
        dom.topLeftMult.classList.remove('crashed');
        dom.topLeftMult.style.display = 'block';
    }
    setTrailCrashed(dom, false);
    setTrailOpacity(dom, '1');
    setDotCrashed(dom, false);
    if (dom.betInput) dom.betInput.disabled = !!crashGame.queued || (crashGame.betPlaced && !crashGame.cashedOut);
}

function startCrashRaf() {
    if (crashAnimHandle || !isCrashPageVisible()) return;
    crashAnimHandle = requestAnimationFrame(tickCrash);
}

function beginFlyingPhaseVisual() {
    crashLastHeavyUpdate = 0;
    crashGame.liveBetResolved = false;

    syncCrashStageDims();
    resetCrashTrail();
    showFlyingChrome();

    crashGame.currentMult = computeCrashMultAt(crashNow() - crashGame.startTime, crashGame.crashPoint);
    if (crashRocketAnim) crashRocketAnim.play();

    renderCrashUI();
    cancelAnimationFrame(crashAnimHandle);
    crashAnimHandle = null;
    startCrashRaf();
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
    crashAnimHandle = null;
    if (crashGame.phase !== 'flying') return;
    if (!isCrashPageVisible()) return;   // страницу открыли/закрыли — цикл перезапустится в initCrashPage()

    const now = crashNow();

    // Время краша пришло — взрыв стартует МГНОВЕННО, по локальному таймлайну,
    // не дожидаясь ответа сервера (раньше ждали realtime/опрос и иногда
    // терялись). Запись в БД делает maybeAdvanceCrash() параллельно.
    if (now >= crashGame.crashAt) {
        advanceLocalPhase();
        maybeAdvanceCrash();
        return;
    }

    crashGame.currentMult = computeCrashMultAt(now - crashGame.startTime, crashGame.crashPoint);

    const perf = performance.now();
    let heavy;
    if (perf - crashLastHeavyUpdate >= CRASH_HEAVY_UPDATE_INTERVAL_MS) {
        crashLastHeavyUpdate = perf;
        heavy = true;
    } else {
        heavy = false;
    }

    renderCrashUI(heavy);
    crashAnimHandle = requestAnimationFrame(tickCrash);
}

// Итоговая «статичная» картинка краша (без анимаций): ракеты нет, множитель
// красным, кнопка заблокирована.
function showCrashedStatic() {
    const dom = getCrashDom();
    const crashPoint = crashGame.crashPoint;

    if (crashRocketAnim) crashRocketAnim.pause();
    if (dom.rocketEl) dom.rocketEl.style.opacity = '0';
    if (dom.countdownEl) dom.countdownEl.style.display = 'none';
    if (dom.centerInfoEl) dom.centerInfoEl.style.opacity = '0';
    if (dom.multEl) dom.multEl.style.color = '#e74c3c';
    if (dom.topLeftMult) {
        dom.topLeftMult.textContent = crashPoint.toFixed(2) + 'x';
        dom.topLeftMult.classList.add('crashed');
        dom.topLeftMult.style.display = 'block';
    }
    if (dom.actionBtn) {
        dom.actionBtn.textContent = crashGame.cashedOut ? 'Выигрыш забран ✓' : 'Раунд завершён';
        dom.actionBtn.disabled = true;
    }
    if (dom.betInput) dom.betInput.disabled = false;
}

function playCrashExplosion() {
    const dom = getCrashDom();
    if (!dom.explosionEl) return;

    syncCrashStageDims();
    const c = crashRocketCenter();
    dom.explosionEl.style.transform = `translate3d(${c.x}px, ${c.y}px, 0px)`;

    clearTimeout(crashExplosionHideTimeout);
    dom.explosionEl.style.opacity = '1';
    dom.explosionEl.style.display = 'block';

    if (!crashExplosionAnim) {
        // нет Lottie — показываем запасной спиннер и сами убираем
        crashExplosionHideTimeout = setTimeout(hideExplosionSmoothly, 900);
        return;
    }

    // Страховка: если событие 'complete' у Lottie не придёт — всё равно уберём
    // взрыв до конца паузы.
    crashExplosionHideTimeout = setTimeout(hideExplosionSmoothly, Math.max(600, CRASH_RESULT_HOLD_MS - 300));

    // Контейнер только что стал видимым — resize() читает layout (синхронный
    // reflow), поэтому анимацию можно запускать СРАЗУ, без ожидания кадра.
    crashExplosionAnim.resize();
    if (crashExplosionTotalFrames > 0) {
        const endFrame = Math.max(1, Math.round(crashExplosionTotalFrames * EXPLOSION_PLAY_FRACTION));
        crashExplosionAnim.playSegments([0, endFrame], true);
    } else {
        crashExplosionAnim.goToAndPlay(0, true);
    }
    requestAnimationFrame(() => { if (crashExplosionAnim) crashExplosionAnim.resize(); });
}

// animate = true  → полный краш: след, взрыв, тряска, вибрация
// animate = false → пауза уже прошла (поздний вход): только итоговая картинка
function endCrashRoundVisual(animate) {
    const dom = getCrashDom();
    const crashPoint = crashGame.crashPoint;

    cancelAnimationFrame(crashAnimHandle);
    crashAnimHandle = null;
    crashGame.currentMult = crashPoint;

    // Если ставка была сделана этим игроком и он не успел забрать —
    // дописываем результат в общую ленту "Действия"/LIVE WINS (только
    // свою запись — её liveBetId знает только этот клиент).
    if (crashGame.betPlaced && !crashGame.cashedOut && !crashGame.liveBetResolved && crashGame.liveBetId) {
        crashGame.liveBetResolved = true;
        resolveLiveBetWin(crashGame.liveBetId, crashGame.bet, 0);
    }

    lastCrashPoint = crashPoint;
    if (crashGame.roundId && !crashHistoryIds.has(crashGame.roundId)) {
        crashHistoryIds.add(crashGame.roundId);
        pushCrashHistoryPoint(crashPoint);
    }
    renderCrashHistory();

    const visible = isCrashPageVisible();

    // Вибрация краха — только если игрок прямо сейчас находится в игре
    // «Ракетка» (страница краша открыта). В других разделах — без вибрации.
    if (animate && visible && window.tg?.HapticFeedback) {
        tg.HapticFeedback.notificationOccurred((crashGame.betPlaced && crashGame.cashedOut) ? "success" : "error");
    }

    showCrashedStatic();
    clearCrashTrailTimers();

    if (animate) {
        drawCrashTrail(crashPoint);
        setTrailCrashed(dom, true);
        setTrailOpacity(dom, '1');
        setDotLive(dom, false);
        setDotCrashed(dom, true);
        setDotOpacity(dom, '1');
        crashTrailTimers.push(setTimeout(() => {
            setTrailOpacity(dom, '0');
            setDotOpacity(dom, '0');
        }, 1200));
        crashTrailTimers.push(setTimeout(() => {
            setTrailD(dom, '');
            crashTrailPoints = [];
        }, 2200));
    } else {
        setTrailD(dom, '');
        setTrailOpacity(dom, '0');
        setDotOpacity(dom, '0');
    }

    crashGame.explosionPlayed = !!(animate && visible);
    if (crashGame.explosionPlayed) {
        playCrashExplosion();
        explosionShake(dom.stageEl, 500, 20);
    }

    renderCrashUI();
}

// Игрок открыл страницу краша — подтягиваем картинку под текущую фазу.
function resumeCrashVisualsOnOpen() {
    advanceLocalPhase();

    if (crashGame.phase === 'waiting') {
        enterWaitingVisual();
    } else if (crashGame.phase === 'flying') {
        showFlyingChrome();
        crashGame.currentMult = computeCrashMultAt(crashNow() - crashGame.startTime, crashGame.crashPoint);
        startCrashRaf();
    } else if (crashGame.phase === 'crashed') {
        showCrashedStatic();
        // Краш произошёл, пока страница была закрыта, а пауза ещё идёт —
        // доигрываем взрыв, чтобы игрок его всё-таки увидел.
        const ago = crashNow() - crashGame.crashAt;
        if (!crashGame.explosionPlayed && ago < CRASH_EXPLOSION_REPLAY_WINDOW_MS) {
            crashGame.explosionPlayed = true;
            playCrashExplosion();
            explosionShake(getCrashDom().stageEl, 500, 20);
        }
    }
    renderCrashUI();
}

/* =========================
   СТАВКА / КЭШАУТ
========================= */

async function placeCrashBet() {
    const round = crashLobby.round;
    if (!round || round.id !== crashGame.roundId || crashGame.phase !== 'waiting' || crashGame.betPlaced || crashGame.queued) return;
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

    currentTurnover = roundMoney(currentTurnover + bet);
    currentBetsCount++;
    setUIBalance(roundMoney(currentBalance - bet));

    const debitResult = await placeBetServer(bet, 'Краш');
    if (!debitResult.ok) {
        restoreBalanceState(snapshot);
        showMessage("Не удалось списать ставку. Проверьте соединение и попробуйте снова.");
        crashGame.isProcessing = false;
        unlockEconomy();
        return;
    }
    currentBalance = debitResult.balance;
    setUIBalance(currentBalance);

    crashGame.bet = bet;
    crashGame.betPlaced = true;
    crashGame.cashedOut = false;
    crashGame.liveBetResolved = false;
    crashGame.liveBetId = await broadcastLiveBet(bet, 'Краш');

    const myId = myCrashTelegramId();
    if (myId != null) {
        const myName = document.getElementById('username')?.textContent?.trim() || 'Игрок';
        const myAvatar = getMyIceArenaAvatar();
        const { data, error } = await supabase.from(CRASH_BETS_TABLE).insert({
            round_id: round.id,
            telegram_id: myId,
            name: myName,
            avatar: myAvatar,
            amount: bet,
            status: 'active'
        }).select('id').single();
        if (error) console.error('Crash bet insert:', error);
        else crashGame.myBetRowId = data?.id ?? null;
    }

    crashGame.isProcessing = false;
    unlockEconomy();
    renderCrashUI();
    scheduleCrashReload();
}

async function cashOutCrash() {
    advanceLocalPhase();
    if (crashGame.phase !== 'flying' || !crashGame.betPlaced || crashGame.cashedOut) return;
    if (crashGame.isProcessing) return;
    if (!lockEconomy()) return;

    crashGame.isProcessing = true;
    const snapshot = snapshotBalanceState();

    // Коэффициент берём по серверному времени в момент нажатия, а не из
    // последнего отрисованного кадра — так «забрал» == ровно то, что видел.
    const mult = computeCrashMultAt(crashNow() - crashGame.startTime, crashGame.crashPoint);
    const winAmount = roundMoney(crashGame.bet * mult);

    currentTotalWin = roundMoney(currentTotalWin + winAmount);
    currentWinsCount++;
    if (mult > currentMaxWin) currentMaxWin = mult;

    setUIBalance(roundMoney(currentBalance + winAmount));
    const creditResult = await resolveWinServerWithRetry(winAmount, mult);

    if (!creditResult.ok) {
        restoreBalanceState(snapshot);
        showMessage("Не удалось зачислить выигрыш. Проверьте соединение и нажмите «Забрать» ещё раз.");
        crashGame.isProcessing = false;
        unlockEconomy();
        return;
    }
    currentBalance = creditResult.balance;
    setUIBalance(currentBalance);

    crashGame.cashedOut = true;
    crashGame.cashoutMult = mult;
    crashGame.cashoutWin = winAmount;
    crashGame.cashoutRoundId = crashGame.roundId;
    crashGame.liveBetResolved = true;
    crashGame.isProcessing = false;

    if (window.tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred("success");
    showMessage(`Забрано: +${winAmount.toFixed(2)}$ (${mult.toFixed(2)}x)`);
    resolveLiveBetWin(crashGame.liveBetId, crashGame.bet, winAmount);

    if (crashGame.myBetRowId != null) {
        supabase.from(CRASH_BETS_TABLE)
            .update({ status: 'cashed_out', cashout_mult: mult, win_amount: winAmount })
            .eq('id', crashGame.myBetRowId)
            .then(({ error }) => { if (error) console.error('Crash bet cashout update:', error); });
    }

    // Сразу показываем свой кэшаут в списке игроков
    crashLobby.bets = crashLobby.bets.map(b => b.isUser
        ? { ...b, status: 'cashed_out', cashoutMult: mult, winAmount }
        : b);
    renderCrashPlayersList();
    renderCrashUI();
    unlockEconomy();
}

function handleCrashAction() {
    if (crashGame.isProcessing) return;
    advanceLocalPhase();

    if (crashGame.phase === 'waiting' && !crashGame.betPlaced && !crashGame.queued) {
        placeCrashBet();
    } else if (crashGame.phase === 'flying' && crashGame.betPlaced && !crashGame.cashedOut) {
        cashOutCrash();
    } else if (crashCanQueue()) {
        queueCrashBet();   // полёт / пауза после краша — ставка уйдёт в следующий раунд
    }
}

function adjustCrashBet(factor) {
    if (!crashCanEditBet()) return;
    applyBetFactor(getCrashDom().betInput, factor);
}

function setCrashMaxBet() {
    if (!crashCanEditBet()) return;
    applyBetMax(getCrashDom().betInput);
}

/* =========================
   ОТРИСОВКА
========================= */

// Цвет коэффициента в истории по диапазонам
function crashMultColor(m) {
    if (m <= 1.25) return '#ff3b3b';   // 1.00–1.25  красный
    if (m <= 1.85) return '#ffd21f';   // 1.26–1.85  жёлтый
    if (m <= 3.00) return '#2ecc71';   // 1.86–3.00  зелёный
    if (m <= 5.00) return '#3da5ff';   // 3.01–5.00  синий
    return '#ffc400';                  // 5.01+      ярко-золотой
}

function renderCrashHistory() {
    const dom = getCrashDom();
    if (!dom.historyList) return;

    dom.historyList.innerHTML = crashHistory.map(point => {
        const color = crashMultColor(point);
        const gold = point > 5.00;
        const extra = gold ? ' text-shadow:0 0 8px rgba(255,196,0,0.85); border-color:rgba(255,196,0,0.6); background:rgba(255,196,0,0.12);' : '';
        return `<span style="display:inline-block; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.1); border-radius:10px; padding:4px 8px; font-size:11px; font-weight:800; color:${color};${extra}">${point.toFixed(2)}x</span>`;
    }).join('');
}

// Эффективный статус игрока: после краша все, кто не забрал, — проиграли
// (показываем сразу, не дожидаясь, пока это запишется в БД).
function crashEffectiveStatus(p) {
    if (p.status === 'active' && crashGame.phase === 'crashed') return 'lost';
    return p.status;
}

function renderCrashPlayersList() {
    updateCrashTopbar();
    const dom = getCrashDom();
    if (!dom.playersList) return;

    if (dom.playersCount) dom.playersCount.textContent = String(crashLobby.bets.length);

    const rowHtml = (p, statusHtml) => (
        '<div class="crash-player-row' + (p.isUser ? ' crash-player-row-user' : '') + '">' +
            '<div class="crash-player-row-avatar">' + iceAvatarHtml(p.avatar) + '</div>' +
            '<div class="crash-player-row-info">' +
                '<div class="crash-player-row-name">' + escapeIceName(p.name) + '</div>' +
                '<div class="crash-player-row-bet">' + p.amount.toFixed(2) + '$</div>' +
            '</div>' +
            statusHtml +
        '</div>'
    );

    let html;
    if (!crashLobby.bets.length) {
        html = '<div class="crash-players-empty">Пока никто не поставил в этом раунде</div>';
    } else {
        // Сортировка: сначала те, кто ещё летит, потом забравшие, потом
        // проигравшие; внутри группы — по размеру ставки.
        const rank = { active: 0, cashed_out: 1, lost: 2 };
        const sorted = [...crashLobby.bets].sort((a, b) => {
            return (rank[crashEffectiveStatus(a)] ?? 3) - (rank[crashEffectiveStatus(b)] ?? 3) || b.amount - a.amount;
        });

        html = sorted.map(p => {
            const st = crashEffectiveStatus(p);
            let statusHtml;
            if (st === 'cashed_out') {
                const multTxt = p.cashoutMult != null ? p.cashoutMult.toFixed(2) + 'x' : '';
                statusHtml =
                    '<div class="crash-player-status crash-player-status-win">' +
                        '<span class="crash-status-main">✓ ' + multTxt + '</span>' +
                        '<span class="crash-status-sub">+' + (p.winAmount ?? 0).toFixed(2) + '$</span>' +
                    '</div>';
            } else if (st === 'lost') {
                statusHtml =
                    '<div class="crash-player-status crash-player-status-lost">' +
                        '<span class="crash-status-main">Проиграл</span>' +
                        '<span class="crash-status-sub">−' + p.amount.toFixed(2) + '$</span>' +
                    '</div>';
            } else {
                statusHtml =
                    '<div class="crash-player-status crash-player-status-live">' +
                        '<span class="crash-status-main"><i class="crash-live-dot"></i>В игре</span>' +
                    '</div>';
            }

            return rowHtml(p, statusHtml);
        }).join('');
    }

    // Ставки, ждущие следующий раунд: подпись слева и тонкая линия под активными игроками
    if (crashLobby.queue.length) {
        const waitStatus =
            '<div class="crash-player-status crash-player-status-wait">' +
                '<span class="crash-status-main"><i class="crash-wait-dot"></i>Ждёт</span>' +
            '</div>';
        html += '<div class="crash-queue-divider"><span>Ожидание</span></div>' +
            crashLobby.queue.map(q => rowHtml(q, waitStatus)).join('');
    }

    // Не трогаем DOM, если ничего не изменилось — список не мигает
    if (html === crashLobby.lastPlayersHtml) return;
    crashLobby.lastPlayersHtml = html;
    dom.playersList.innerHTML = html;
}

// Путь следа + точка на его конце для коэффициента m (без смены классов/прозрачности)
// Прогресс следа 0..1. Раньше пик достигался на 3.00x; теперь след идёт
// на 10% медленнее — пик на ~3.22x.
const CRASH_TRAIL_SPEED = 0.9;
function crashTrailProgress(m) {
    return Math.min(1, Math.max(0, CRASH_TRAIL_SPEED * (m - 1) / 2));
}

function drawCrashTrail(m) {
    const dom = getCrashDom();
    const stageW = crashStageW;
    const stageH = crashStageH;

    const trailProgress = crashTrailProgress(m);

    const trailStartX = stageW * 0.05;
    const trailStartY = stageH * 0.95;
    const trailEndX = stageW * 0.95;
    const trailEndY = stageH * 0.05;

    // След — это начало ФИКСИРОВАННОЙ кривой (квадратичная Безье от старта
    // к верхнему углу с изгибом). Голова ползёт по этой кривой, а сам след —
    // её кусочек от старта до головы (алгоритм де Кастельжо). Форма не
    // «плывёт», а именно вытягивается — как график, который дорисовывают.
    const fullDx = trailEndX - trailStartX;
    const fullDy = trailEndY - trailStartY;
    const fullLen = Math.hypot(fullDx, fullDy) || 1;
    const bow = 0.22 * fullLen;
    const ctrlX = (trailStartX + trailEndX) / 2 + (-fullDy / fullLen) * bow;
    const ctrlY = (trailStartY + trailEndY) / 2 + (fullDx / fullLen) * bow;

    const t = trailProgress;
    const u1 = 1 - t;
    const headX = u1 * u1 * trailStartX + 2 * u1 * t * ctrlX + t * t * trailEndX;
    const headY = u1 * u1 * trailStartY + 2 * u1 * t * ctrlY + t * t * trailEndY;

    if (dom.trailLine) {
        const subCx = trailStartX + t * (ctrlX - trailStartX);
        const subCy = trailStartY + t * (ctrlY - trailStartY);
        const r1 = v => Math.round(v * 10) / 10;
        setTrailD(dom, `M ${r1(trailStartX)},${r1(trailStartY)} Q ${r1(subCx)},${r1(subCy)} ${r1(headX)},${r1(headY)}`);
    }

    {
        const tr = `translate(${Math.round(headX * 10) / 10},${Math.round(headY * 10) / 10})`;
        if (dom.trailHead) dom.trailHead.setAttribute('transform', tr);
        if (dom.trailDotGlow) dom.trailDotGlow.setAttribute('transform', tr);
    }
}

function renderCrashUI(heavy = true) {
    const dom = getCrashDom();
    if (!dom.statusEl || !dom.multEl || !dom.actionBtn) return;

    if (crashGame.phase === 'pending') return;

    if (crashGame.phase === 'crashed') {
        dom.statusEl.textContent = `Крах на ${crashGame.crashPoint.toFixed(2)}x · Следующий раунд скоро`;
        dom.multEl.textContent = crashGame.crashPoint.toFixed(2) + 'x';
        dom.multEl.style.color = '#e74c3c';
        if (dom.betInput) dom.betInput.disabled = !!crashGame.queued;
        dom.actionBtn.textContent = crashGame.queued ? 'Ставка в очереди ✓' : 'Поставить на след. раунд';
        dom.actionBtn.disabled = !!crashGame.queued;
        return;
    }

    if (crashGame.phase === 'waiting') {
        // Тяжёлая подготовка сцены — в enterWaitingVisual() (один раз),
        // цифры отсчёта — в renderCrashCountdown(). Здесь только кнопка.
        const hold = crashGame.betPlaced || !!crashGame.queued;
        if (dom.betInput) dom.betInput.disabled = hold;
        dom.actionBtn.textContent = crashGame.betPlaced ? 'Ставка принята' : (crashGame.queued ? 'Ставка в очереди ✓' : 'Сделать ставку');
        dom.actionBtn.disabled = hold;
        return;
    }

    // phase === 'flying'
    // Расчёт позиции ракеты и точки следа — дешёвая математика, считаем
    // каждый кадр, чтобы ракета двигалась идеально плавно.
    const currentM = crashGame.currentMult;

    const trailProgress = crashTrailProgress(currentM);

    // Поворот ракеты адаптирован под траекторию до 3.00x
    const angle = 45 - (90 * trailProgress);

    if (dom.rocketEl) {
        const c = crashRocketCenter();
        dom.rocketEl.style.transform = `translate3d(${c.x}px, ${c.y}px, 0px) rotate(${angle}deg)`;
    }

    // "Тяжёлые" обновления — текст с text-shadow и SVG-след с несколькими
    // drop-shadow — троттлим до ~30 раз/сек (см. CRASH_HEAVY_UPDATE_INTERVAL_MS
    // в tickCrash), чтобы не грузить рендер на каждый из 60 кадров.
    if (heavy) {
        if (dom.topLeftMult) {
            dom.topLeftMult.textContent = currentM.toFixed(2) + 'x';
        }

        drawCrashTrail(currentM);
        setDotOpacity(dom, '1');
        setDotLive(dom, true);

        if (crashGame.betPlaced && !crashGame.cashedOut) {
            const potential = (crashGame.bet * currentM).toFixed(2);
            dom.actionBtn.textContent = `Забрать ${potential}$`;
            dom.actionBtn.disabled = false;
        } else if (crashGame.queued) {
            dom.actionBtn.textContent = 'Ставка в очереди ✓';
            dom.actionBtn.disabled = true;
        } else {
            dom.actionBtn.textContent = 'Поставить на след. раунд';
            dom.actionBtn.disabled = false;
        }
        if (dom.betInput) dom.betInput.disabled = !!crashGame.queued || (crashGame.betPlaced && !crashGame.cashedOut);
    }

    // Тряска экрана — дешёвый compositor-only transform, оставляем на каждый
    // кадр ради плавности вибрации.
    if (dom.stageEl) {
        const shakeStrength = Math.min(8, (crashGame.currentMult - 1) * 1.2);
        const dx = (Math.random() - 0.5) * shakeStrength;
        const dy = (Math.random() - 0.5) * shakeStrength;
        dom.stageEl.style.transform = `translate3d(${dx}px, ${dy}px, 0px)`;
    }
}

/* =========================
   ИГРА «АПГРЕЙДЕР»
   Колесо, формула и тайминг анимации — как в версии для Telegram-бота:
   payout = ставка * (1 - 5%) / (шанс / 100). Фон колеса прозрачный —
   страница остаётся с фоном приложения.
========================= */

const UPG_HOUSE_EDGE = 0.05;
const UPG_MIN_CHANCE = 1;
const UPG_MAX_CHANCE = 90;
const UPG_STEP = 5;
const UPG_START = -40;       // где стрелка стоит до запуска
const UPG_WINDUP = 12;       // замах назад, градусы
const UPG_T = { pause: 400, windup: 600, spin: 6000, land: 390 };   // мс, как в боте
const UPG_FONT = '"Carlito","Helvetica Neue",Arial,sans-serif';
const UPG_ARROW = [[0, 0], [29, 15], [21, 4.6], [56, 4.6], [71, 12], [64, 0], [71, -12], [56, -4.6], [21, -4.6], [29, -15]];

const upg = { chance: 50, busy: false, result: null, fade: 1, theta: UPG_START, glow: 0, scenes: {}, cv: null, ctx: null, size: 0, raf: 0, fadeRaf: 0 };

function upgCalc(bet, chance) {
    const coef = (1 - UPG_HOUSE_EDGE) * 100 / chance;
    return { payout: roundMoney(Math.floor(bet * coef * 100 + 1e-6) / 100), coef: roundMoney(coef) };
}

function upgMinBet(chance) {
    for (let c = 10; c < 100000; c++) {
        if (upgCalc(c / 100, chance).payout > c / 100) return c / 100;
    }
    return MIN_BET;
}

// Исход броска считает сервер (SQL-функция upgrader_play) — в браузере его нет.

function upgBet() {
    const v = parseFloat(document.getElementById('upgBetInput')?.value);
    return isFinite(v) && v > 0 ? roundMoney(v) : 0;
}

const upgSmooth = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
const upgPt = (r, deg) => { const a = deg * Math.PI / 180; return [360 + r * Math.sin(a), 315 - r * Math.cos(a)]; };

/* ---------- статичные слои колеса (кэшируются по шансу) ----------
   Раньше каждый кадр перерисовывал ВСЁ: 2 полноразмерные картинки с альфой,
   ~10 текстов (с measureText в цикле) и 120 рисок. Теперь слои раздельные:
     1. base  — колесо, плашка (рисуется только при смене шанса)
     2. hot   — красное свечение сектора (двигаем ТОЛЬКО css-opacity, без перерисовки)
     3. text  — тексты (перерисовываются только когда реально поменялись)
     4. fx    — золотой хвост + стрелка (единственное, что рисуется каждый кадр) */
// Колесо БЕЗ красного сектора — от шанса не зависит, строится один раз.
function upgWheel() {
    if (upg.wheel && upg.wheel.width === upg.size) return upg.wheel;
    const S = upg.size / 720;
    const c = document.createElement('canvas');
    c.width = c.height = upg.size;
    const x = c.getContext('2d');
    x.setTransform(S, 0, 0, S, 0, 0);
    const grad = (y1, y2, a, b) => { const g = x.createLinearGradient(0, y1, 0, y2); g.addColorStop(0, a); g.addColorStop(1, b); return g; };
    const disc = (r, a, b) => { x.beginPath(); x.arc(360, 315, r, 0, Math.PI * 2); x.fillStyle = grad(315 - r, 315 + r, a, b); x.fill(); };

    x.save();
    x.shadowColor = 'rgba(0,0,0,0.55)'; x.shadowBlur = 28 * S; x.shadowOffsetY = 16 * S;
    x.fillStyle = '#000'; x.beginPath(); x.arc(360, 315, 254, 0, Math.PI * 2); x.fill();
    x.restore();

    x.strokeStyle = 'rgb(150,152,168)'; x.lineWidth = 1.3;
    for (let i = 0; i < 120; i++) {
        const a = i * 3, [x1, y1] = upgPt(262, a), [x2, y2] = upgPt(254 + (i % 5 === 0 ? 17 : 12), a);
        x.beginPath(); x.moveTo(x1, y1); x.lineTo(x2, y2); x.stroke();
    }
    disc(254, '#60606c', '#1e1e24');
    disc(250.5, '#2c2c32', '#161618');
    disc(180, '#1f1f24', '#121216');

    // плашка «ставка / выигрыш»
    x.fillStyle = '#161618';
    x.beginPath();
    const [px0, py0, px1, py1, rr] = [62, 619, 658, 695, 18];
    x.moveTo(px0 + rr, py0); x.arcTo(px1, py0, px1, py1, rr); x.arcTo(px1, py1, px0, py1, rr);
    x.arcTo(px0, py1, px0, py0, rr); x.arcTo(px0, py0, px1, py0, rr); x.closePath(); x.fill();
    x.strokeStyle = '#323238'; x.lineWidth = 1;
    x.beginPath(); x.moveTo(360, 633); x.lineTo(360, 681); x.stroke();
    return (upg.wheel = c);
}

// Путь сектора для ЛЮБОГО (в т.ч. дробного) шанса — нужен для плавной анимации.
function upgSectorPath(x, chance) {
    const half = chance * 1.8, k = Math.PI / 180;
    x.beginPath();
    x.arc(360, 315, 250.5, (180 - half) * k - Math.PI / 2, (180 + half) * k - Math.PI / 2);
    x.arc(360, 315, 180, (180 + half) * k - Math.PI / 2, (180 - half) * k - Math.PI / 2, true);
    x.closePath();
}

// Красный сектор + тонкое кольцо по внутреннему краю (рисуется поверх колеса)
function upgPaintSector(x, chance) {
    const g = x.createLinearGradient(0, 495, 0, 569); g.addColorStop(0, '#f04854'); g.addColorStop(1, '#c01c2e');
    upgSectorPath(x, chance);
    x.fillStyle = g; x.fill();
    x.beginPath(); x.arc(360, 315, 180, 0, Math.PI * 2); x.strokeStyle = '#34343c'; x.lineWidth = 1.6; x.stroke();
}

// Слой свечения. Центр (r < 180) вырезан, чтобы ореол не залезал на центральный диск.
function upgPaintHot(x, S, chance) {
    x.setTransform(S, 0, 0, S, 0, 0);
    x.save();
    x.beginPath(); x.rect(0, 0, 720, 720); x.arc(360, 315, 180, 0, Math.PI * 2, true); x.clip('evenodd');
    x.save(); x.shadowColor = 'rgba(255,70,84,1)'; x.shadowBlur = 34 * S; x.fillStyle = '#ff4654';
    upgSectorPath(x, chance); x.fill(); x.restore();
    const g = x.createLinearGradient(0, 495, 0, 569); g.addColorStop(0, '#ff6872'); g.addColorStop(1, '#e22c3c');
    upgSectorPath(x, chance); x.fillStyle = g; x.fill();
    x.restore();
}

// Готовое свечение для «устоявшегося» шанса (кэш) — чтобы во время вращения ничего не строить.
function upgHotSprite(chance) {
    const key = chance + ':' + upg.size;
    if (!upg.scenes[key]) {
        if (Object.keys(upg.scenes).length >= 8) upg.scenes = {};
        const c = document.createElement('canvas');
        c.width = c.height = upg.size;
        upgPaintHot(c.getContext('2d'), upg.size / 720, chance);
        upg.scenes[key] = c;
    }
    return upg.scenes[key];
}

// Плавный «рост/убывание» сектора к новому шансу (по времени, не по кадрам)
function upgChanceAnim() {
    if (upg.chRaf) return;
    let last = performance.now();
    const step = (now) => {
        upg.chRaf = 0;
        if (upg.busy) { upg.shown = upg.chance; upgDraw(); return; }
        const dt = Math.min(64, now - last); last = now;
        const diff = upg.chance - upg.shown;
        if (Math.abs(diff) < 0.04) {
            upg.shown = upg.chance; upgDraw();
            setTimeout(() => { if (!upg.busy && upg.ctx) upgHotSprite(upg.chance); }, 80);   // заранее готовим свечение
            return;
        }
        upg.shown += diff * (1 - Math.exp(-dt / 70));
        upgDraw();
        upg.chRaf = requestAnimationFrame(step);
    };
    upg.chRaf = requestAnimationFrame(step);
}

/* ---------- текст (ширины кэшируются — measureText в кадре был очень дорогим) ---------- */
const upgWCache = new Map();
function upgMeasure(x, font, text) {
    const key = font + '|' + text;
    let w = upgWCache.get(key);
    if (w === undefined) {
        x.font = font; w = x.measureText(text).width;
        if (upgWCache.size > 400) upgWCache.clear();
        upgWCache.set(key, w);
    }
    return w;
}

function upgSpaced(x, text, cx, cy, size, color, sp) {
    const font = `700 ${size}px ${UPG_FONT}`;
    x.font = font; x.fillStyle = color; x.textBaseline = 'middle'; x.textAlign = 'left';
    const chars = [...text], ws = chars.map(ch => upgMeasure(x, font, ch));
    let cur = cx - (ws.reduce((a, b) => a + b, 0) + sp * (chars.length - 1)) / 2;
    chars.forEach((ch, i) => { x.fillText(ch, cur, cy); cur += ws[i] + sp; });
}

const upgFitCache = new Map();
function upgFit(x, text, cx, cy, size, maxW, color) {
    const ck = text + '|' + size + '|' + maxW;
    let s = upgFitCache.get(ck);
    if (s === undefined) {
        s = size;
        while (s > 10 && upgMeasure(x, `700 ${s}px ${UPG_FONT}`, text) > maxW) s--;
        if (upgFitCache.size > 400) upgFitCache.clear();
        upgFitCache.set(ck, s);
    }
    x.fillStyle = color; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = `700 ${s}px ${UPG_FONT}`;
    x.fillText(text, cx, cy);
}

function upgCenterText(x, kind, alpha, chance, payout) {
    if (alpha <= 0) return;
    x.save(); x.globalAlpha = alpha;
    if (kind === 'win') {
        upgFit(x, 'ПОБЕДА', 360, 293, 56, 300, '#6eeb8c');
        upgFit(x, `+${payout.toFixed(2)} $`, 360, 353, 28, 306, '#ffd61e');
    } else if (kind === 'lose') {
        upgFit(x, 'МИМО', 360, 295, 64, 300, '#ebebf0');
        upgSpaced(x, 'ПОПРОБУЙ ЕЩЁ', 360, 355, 15, '#7d7d87', 3);
    } else {
        upgFit(x, `${chance}%`, 360, 297, 80, 300, '#ffffff');
        upgSpaced(x, 'ШАНС ПОБЕДЫ', 360, 359, 15, '#7d7d87', 3);
    }
    x.restore();
}

/* ---------- кадр ---------- */
// Геометрия рисок считается один раз
const UPG_TICKS = (() => {
    const t = [];
    for (let i = 0; i < 120; i++) {
        const a = i * 3, big = i % 5 === 0;
        const [x1, y1] = upgPt(262, a), [x2, y2] = upgPt(254 + (big ? 24 : 19), a);
        t.push([x1, y1, x2, y2]);
    }
    return t;
})();

function upgDraw() {
    const base = upg.ctx;
    if (!base) return;
    const S = upg.size / 720, chance = upg.chance;

    // во время вращения ставку из DOM не читаем (она заблокирована)
    if (!upg.busy || upg.betC == null) upg.betC = upgBet() || MIN_BET;
    const bet = upg.betC;

    // 1) колесо + сектор (перерисовка только пока сектор реально меняется)
    const shown = upg.shown;
    const sKey = shown.toFixed(2) + ':' + upg.size;
    if (upg.sceneKey !== sKey) {
        base.setTransform(1, 0, 0, 1, 0, 0);
        base.clearRect(0, 0, upg.size, upg.size);
        base.drawImage(upgWheel(), 0, 0);
        base.setTransform(S, 0, 0, S, 0, 0);
        upgPaintSector(base, shown);
        upg.sceneKey = sKey;
    }

    // 2) свечение — прозрачность слоя (GPU); сам слой перерисовываем лишь если оно видно
    const g = Math.max(0, Math.min(1, upg.glow));
    const gv = g < 0.01 ? 0 : Math.round(g * 1000) / 1000;
    if (gv > 0 && upg.hotKey !== sKey) {
        const h = upg.hotCtx;
        h.setTransform(1, 0, 0, 1, 0, 0);
        h.clearRect(0, 0, upg.size, upg.size);
        if (shown === chance) h.drawImage(upgHotSprite(chance), 0, 0);
        else upgPaintHot(h, S, shown);
        upg.hotKey = sKey;
    }
    if (upg.glowVal !== gv) { upg.hotCv.style.opacity = gv; upg.glowVal = gv; }

    // 3) тексты — только если что-то изменилось
    const disp = Math.round(shown);
    const tKey = disp + '|' + chance + '|' + bet + '|' + (upg.result || '') + '|' + (upg.result ? Math.round(upg.fade * 200) : 0) + '|' + upg.size;
    if (upg.textKey !== tKey) {
        upg.textKey = tKey;
        const x = upg.txCtx;
        const { payout } = upgCalc(bet, chance);
        x.setTransform(1, 0, 0, 1, 0, 0);
        x.clearRect(0, 0, upg.size, upg.size);
        x.setTransform(S, 0, 0, S, 0, 0);
        if (upg.result) {
            upgCenterText(x, null, 1 - upg.fade, disp, payout);
            upgCenterText(x, upg.result, upg.fade, disp, payout);
        } else {
            upgCenterText(x, null, 1, disp, payout);
        }
        upgSpaced(x, 'СТАВКА', 211, 639, 13, '#8c8c96', 1);
        upgSpaced(x, 'ВЫИГРЫШ', 509, 639, 13, '#8c8c96', 1);
        upgFit(x, `${bet.toFixed(2)} $`, 211, 667, 28, 258, '#ffffff');
        upgFit(x, `${payout.toFixed(2)} $`, 509, 667, 28, 258, '#ffd61e');
    }

    // 4) хвост + стрелка — каждый кадр, но это ~20 линий и один многоугольник
    const x = upg.fxCtx;
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.clearRect(0, 0, upg.size, upg.size);
    x.setTransform(S, 0, 0, S, 0, 0);

    x.strokeStyle = '#ffd61e'; x.lineWidth = 1.8;
    const th = upg.theta;
    for (let i = 0; i < 120; i++) {
        const behind = ((((th - i * 3 + 180) % 360) + 360) % 360) - 180;
        if (behind > 46 || behind < -12) continue;
        const w = behind >= 0 ? 1 - behind / 46 : 1 + behind / 12;
        const a = w * w;
        if (a < 0.05) continue;
        const t = UPG_TICKS[i];
        x.globalAlpha = a;
        x.beginPath(); x.moveTo(t[0], t[1]); x.lineTo(t[2], t[3]); x.stroke();
    }
    x.globalAlpha = 1;

    const tr = th * Math.PI / 180, ux = Math.sin(tr), uy = -Math.cos(tr), vx = Math.cos(tr), vy = Math.sin(tr);
    x.beginPath();
    for (let i = 0; i < UPG_ARROW.length; i++) {
        const lx = UPG_ARROW[i][0], ly = UPG_ARROW[i][1];
        const r = 182 + lx, px = 360 + ux * r + vx * ly, py = 315 + uy * r + vy * ly;
        if (i) x.lineTo(px, py); else x.moveTo(px, py);
    }
    x.closePath();
    x.lineJoin = 'round'; x.lineWidth = 4.4; x.strokeStyle = '#1e1e22'; x.stroke();
    x.fillStyle = '#ffd000'; x.fill();
}

/* ---------- анимация вращения ---------- */
function upgPickTarget(lo, hi) {
    const len = hi - lo, m = Math.min(4, len * 0.35);
    let t;
    if (Math.random() < 0.55) {
        const d = Math.min(m + Math.random() * 4, len / 2);
        t = Math.random() < 0.5 ? lo + d : hi - d;
    } else {
        t = lo + m + Math.random() * (len - 2 * m);
    }
    return ((t % 360) + 360) % 360;
}

function upgAnimate(win, chance) {
    cancelAnimationFrame(upg.fadeRaf);
    const half = chance * 1.8;
    const [lo, hi] = win ? [180 - half, 180 + half] : [180 + half, 180 - half + 360];
    // Стартуем оттуда, куда стрелка упала в прошлом раунде (а не из исходной точки)
    const startTh = ((upg.theta % 360) + 360) % 360;
    const origin = startTh - UPG_WINDUP;
    const target = upgPickTarget(lo, hi);
    const delta = (((target - startTh) % 360) + 360) % 360;
    const final = startTh + (Math.random() < 0.5 ? 3 : 4) * 360 + delta;
    const { pause, windup, spin, land } = UPG_T;
    const total = pause + windup + spin + land;
    const spinStart = pause + windup;
    cancelAnimationFrame(upg.chRaf); upg.chRaf = 0; upg.shown = upg.chance;   // сектор на месте до начала вращения
    upg.betC = null;                           // перечитаем ставку один раз и закэшируем
    const g0 = upg.glow, f0 = upg.fade;      // свечение и итог прошлого раунда — гасим плавно

    return new Promise(resolve => {
        let done = false, prev = startTh, prevT = 0, lastK = null, lastTick = 0;
        const t0 = performance.now();

        const finish = () => {
            if (done) return;
            done = true;
            cancelAnimationFrame(upg.raf);
            upg.theta = final; upg.glow = 1; upg.result = win ? 'win' : 'lose'; upg.fade = 1;
            upgDraw();
            resolve();
        };

        const step = (now) => {
            if (done) return;
            const t = now - t0;
            let theta, calm = 1;
            if (t < pause) {
                theta = startTh;
            } else if (t < spinStart) {
                theta = startTh - UPG_WINDUP * upgSmooth((t - pause) / windup);
            } else if (t < spinStart + spin) {
                const u = (t - spinStart) / spin;
                theta = origin + (final - origin) * (1 - Math.pow(1 - u, 3)) * upgSmooth(u / 0.05);
                const speed = Math.abs(theta - prev) * 30 / Math.max(8, t - prevT);   // °/кадр при 30 мс
                calm = upgSmooth(1 - speed / 8);
                const k = Math.floor(theta / 3);                                      // «тик» на каждой риске
                if (lastK !== null && k !== lastK && now - lastTick > 75) { setTimeout(() => window.haptic('select'), 0); lastTick = now; }
                lastK = k;
            } else {
                theta = final;
            }

            const gap = Math.abs((((theta % 360) + 360) % 360) - 180);
            const ramp = upgSmooth((t - spinStart) / 600);       // свечение зажигается заново только в полёте
            let glow = upgSmooth(1 - gap / (half + 24)) * 0.85 * calm * ramp;

            if (t < spinStart) {
                // замах: прошлое свечение плавно гаснет
                glow = g0 * (1 - upgSmooth(t / spinStart));
                if (upg.result) {
                    const k = upgSmooth(Math.min(1, t / 500));
                    upg.fade = f0 * (1 - k);
                    if (k >= 1) { upg.result = null; upg.fade = 1; }
                }
            }
            if (t >= spinStart + spin) {
                const f = upgSmooth((t - spinStart - spin) / land);
                glow += (1 - glow) * f;
                upg.result = win ? 'win' : 'lose'; upg.fade = f;
            }
            upg.theta = theta; upg.glow = glow;
            prev = theta; prevT = t;
            upgDraw();
            if (t >= total) finish(); else upg.raf = requestAnimationFrame(step);
        };
        upg.raf = requestAnimationFrame(step);
        setTimeout(finish, total + 400);     // страховка, если rAF «заснул» в фоне
    });
}

/* ---------- интерфейс ---------- */
function upgInit() {
    if (upg.cv) return;
    const cv = document.getElementById('upgCanvas');
    if (!cv) return;
    upg.cv = cv;
    upg.size = Math.round(600 * Math.min(window.devicePixelRatio || 1, 2));
    cv.width = cv.height = upg.size;
    upg.ctx = cv.getContext('2d');

    // обёртка + 3 слоя поверх базового канваса
    // Позиционирование слоёв задаём инлайн-стилями: без них (если CSS
    // .upg-stack/.upg-layer не подхватился) 4 канваса идут друг под другом,
    // текст/стрелка уезжают за экран, а кнопки ставки оказываются на несколько
    // экранов ниже — со стороны выглядит как «апгрейдер не работает».
    const stack = document.createElement('div');
    stack.className = 'upg-stack';
    stack.style.position = 'relative';
    stack.style.width = '100%';
    stack.style.maxWidth = '420px';
    stack.style.margin = '0 auto';
    stack.style.aspectRatio = '1 / 1';
    cv.parentNode.insertBefore(stack, cv);
    stack.appendChild(cv);
    const layerStyle = (c) => {
        c.style.position = 'absolute';
        c.style.left = '0';
        c.style.top = '0';
        c.style.width = '100%';
        c.style.height = '100%';
        c.style.display = 'block';
        c.style.maxWidth = 'none';
        c.style.margin = '0';
    };
    cv.classList.add('upg-layer');
    layerStyle(cv);
    const mk = (name) => {
        const c = document.createElement('canvas');
        c.width = c.height = upg.size;
        c.className = 'upg-layer upg-layer-' + name;
        c.setAttribute('aria-hidden', 'true');
        layerStyle(c);
        c.style.pointerEvents = 'none';
        stack.appendChild(c);
        return c;
    };
    upg.hotCv = mk('hot'); upg.hotCv.style.opacity = '0'; upg.hotCtx = upg.hotCv.getContext('2d');
    upg.txCv = mk('text');  upg.txCtx = upg.txCv.getContext('2d');
    upg.fxCv = mk('fx');    upg.fxCtx = upg.fxCv.getContext('2d');
    upg.sceneKey = null; upg.textKey = null; upg.hotKey = null; upg.glowVal = -1; upg.betC = null;
    upg.shown = upg.chance; upg.chRaf = 0;
}

function upgRefresh(resetResult = true) {
    if (resetResult) upgFadeOut();     // стрелка остаётся где упала, свечение гаснет плавно
    document.querySelectorAll('.upg-chance-row .pct-btn').forEach(b =>
        b.classList.toggle('active', Number(b.dataset.chance) === upg.chance));
    const chanceInput = document.getElementById('upgChanceInput');
    if (chanceInput && document.activeElement !== chanceInput) chanceInput.value = upg.chance;

    const bet = upgBet() || MIN_BET;
    const { payout, coef } = upgCalc(bet, upg.chance);
    const info = document.getElementById('upgInfo');
    if (info) {
        info.textContent = payout > bet
            ? `Коэффициент x${coef.toFixed(2)} · при победе +${roundMoney(payout - bet).toFixed(2)} $`
            : `При шансе ${upg.chance}% минимальная ставка — ${upgMinBet(upg.chance).toFixed(2)} $`;
    }
    if (resetResult) upgHideResultText();
    upgDraw();
    if (upg.shown !== upg.chance) upgChanceAnim();      // сектор плавно догоняет новый шанс
}

// Плавно гасит свечение кольца и итог прошлого раунда (без резкого сброса)
function upgFadeOut(ms = 450) {
    cancelAnimationFrame(upg.fadeRaf);
    if (upg.busy) return;
    const g0 = upg.glow, f0 = upg.result ? upg.fade : 0;
    if (g0 < 0.01 && !upg.result) { upg.glow = 0; upg.fade = 1; return; }
    const t0 = performance.now();
    const step = (now) => {
        const k = upgSmooth((now - t0) / ms);
        upg.glow = g0 * (1 - k);
        if (upg.result) upg.fade = f0 * (1 - k);
        upgDraw();
        if (k < 1) upg.fadeRaf = requestAnimationFrame(step);
        else { upg.result = null; upg.fade = 1; upg.glow = 0; upgDraw(); }
    };
    upg.fadeRaf = requestAnimationFrame(step);
}

let upgResTimer = 0;
function upgHideResultText() {
    const res = document.getElementById('upgResult');
    if (!res || !res.textContent) return;
    res.style.transition = 'opacity .35s ease';
    res.style.opacity = '0';
    clearTimeout(upgResTimer);
    upgResTimer = setTimeout(() => { res.textContent = ''; res.className = 'upg-result'; }, 360);
}

function openUpgrader() {
    showPage('upgraderPage');
    updateNav('games');
    upgInit();
    if (!upg.busy) upgRefresh(true);
}

function upgSetChance(c) {
    if (upg.busy) return;
    c = parseInt(c, 10);
    if (!isFinite(c)) return;
    upg.chance = Math.max(UPG_MIN_CHANCE, Math.min(UPG_MAX_CHANCE, c));
    upgRefresh(true);
}

function upgAdjustChance(delta) { upgSetChance(upg.chance + delta); }

function upgBetFactor(f) {
    if (upg.busy) return;
    applyBetFactor(document.getElementById('upgBetInput'), f);
    upgRefresh(true);
}

function upgBetMax() {
    if (upg.busy) return;
    applyBetMax(document.getElementById('upgBetInput'));
    upgRefresh(true);
}

function upgOnBetInput() {
    if (upg.busy) return;
    upgRefresh(true);
}

function upgOnChanceInput(commit) {
    if (upg.busy) return;
    const input = document.getElementById('upgChanceInput');
    const v = parseInt(input.value, 10);
    if (isFinite(v) && (commit || (v >= UPG_MIN_CHANCE && v <= UPG_MAX_CHANCE))) {
        upg.chance = Math.max(UPG_MIN_CHANCE, Math.min(UPG_MAX_CHANCE, v));
        upgRefresh(true);
    }
    if (commit) input.value = upg.chance;
}

function upgRelease() {
    upg.busy = false;
    isBetProcessing = false;
    unlockEconomy();
    const btn = document.getElementById('upgPlayBtn');
    if (btn) { btn.disabled = false; btn.textContent = 'ИГРАТЬ'; }
    document.getElementById('upgraderPage')?.classList.remove('upg-locked');
    document.body.classList.remove('upg-spinning');
}

// Ставку, бросок и выплату делает Supabase (upgrader_play), клиент только показывает итог
async function upgApi(bet, chance) {
    try {
        const { data, error } = await supabase.rpc('upgrader_play', {
            p_init: tg?.initData || '', p_bet: bet, p_chance: chance
        });
        if (error) return { ok: false, error: error.message || 'Ошибка сервера' };
        return data;
    } catch (e) {
        return { ok: false, error: 'Нет соединения с сервером' };
    }
}

async function playUpgrader() {
    if (upg.busy || isBetProcessing) return;
    const bet = upgBet(), chance = upg.chance;
    if (bet < MIN_BET) return showMessage('Минимальная ставка — 0.10 $!');
    if (bet > currentBalance) return showMessage('Недостаточно средств на балансе!');
    const { payout, coef } = upgCalc(bet, chance);
    if (payout <= bet) return showMessage(`При шансе ${chance}% минимальная ставка — ${upgMinBet(chance).toFixed(2)} $. Увеличьте ставку или уменьшите шанс.`);
    if (!lockEconomy()) return;

    upg.busy = true;
    isBetProcessing = true;
    const btn = document.getElementById('upgPlayBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Вращение...'; }
    document.getElementById('upgraderPage')?.classList.add('upg-locked');
    document.body.classList.add('upg-spinning');

    try {
        const snapshot = snapshotBalanceState();
        currentTurnover = roundMoney(currentTurnover + bet);
        currentBetsCount++;
        setUIBalance(roundMoney(currentBalance - bet));

        const srv = await upgApi(bet, chance);
        if (!srv || !srv.ok) {
            restoreBalanceState(snapshot);
            showMessage((srv && srv.error) || 'Не удалось сыграть. Проверьте соединение и попробуйте снова.');
            return;
        }
        const win = !!srv.win;
        const credited = win ? roundMoney(srv.payout) : 0;
        const srvCoef = Number(srv.coef);
        // на экране сначала показываем баланс после списания ставки,
        // а выигрыш раскрываем, когда колесо остановилось
        setUIBalance(roundMoney(Number(srv.balance) - credited));

        const liveBetId = await broadcastLiveBet(bet, 'Апгрейдер');

        if (win) {
            currentTotalWin = roundMoney(currentTotalWin + credited);
            currentWinsCount++;
            if (srvCoef > currentMaxWin) currentMaxWin = srvCoef;
        }

        const res = document.getElementById('upgResult');
        upgHideResultText();      // старый итог плавно гаснет, кольцо и стрелка — внутри upgAnimate
        await upgAnimate(win, chance);

        setUIBalance(Number(srv.balance));
        resolveLiveBetWin(liveBetId, bet, credited);
        window.haptic(credited > 0 ? 'success' : 'error');
        if (res) {
            clearTimeout(upgResTimer);
            res.style.opacity = '1';
            res.textContent = credited > 0 ? `Победа! +${credited.toFixed(2)} $ (x${srvCoef.toFixed(2)})` : 'Не повезло. Попробуйте ещё раз';
            res.className = 'upg-result ' + (credited > 0 ? 'win' : 'lose');
        }
    } finally {
        upgRelease();
    }
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
        "statBetsCount": betsCountValue
    };

    Object.keys(elementsMap).forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = elementsMap[id];
    });

    document.querySelectorAll('.balance-val, .profile-balance-val').forEach(el => {
        el.textContent = formatted;
    });

    updateLevelUI();
}

/* =========================
   НАВИГАЦИЯ
========================= */

function hideAllPages() {
    const pages = ["homePage", "balancePage", "profilePage", "bonusPage", "topPage", "minesPage", "crashPage", "upgraderPage", "iceArenaPage", "tgEmojiPage", "diceGamePage", "footballGamePage"];
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

    const page = document.getElementById(id);
    // Тап по вкладке/играми, где уже находимся, — анимацию появления не повторяем
    const alreadyOpen = !!page && !page.classList.contains("hidden");
    hideAllPages();
    if (page) page.classList.remove("hidden");
    // На страницах с Lottie-анимациями отключаем размытие фона у нижнего меню
    // и ставим на паузу фоновые анимации неактивных экранов, чтобы держать стабильные 60 FPS.
    const isAnimPage = id === "tgEmojiPage" || id === "diceGamePage" || id === "footballGamePage";
    document.body.classList.toggle("anim-page", isAnimPage);
    if (typeof window.syncTgEmojiPageState === "function") window.syncTgEmojiPageState(id);
    window.scrollTo(0, 0);
    document.body.scrollTop = 0;
    if (!alreadyOpen) playPageEnter(page);
}

// Появление страницы/игры: блоки по очереди «вылетают» снизу (как во вкладке «Топ»).
// Только opacity + translateY — размеры и раскладка не меняются, поэтому игры
// (canvas, Lottie, замеры сцены) работают как раньше. У «Топ» своя анимация.
function playPageEnter(page) {
    if (!page || page.id === 'topPage' || page.id === 'tgEmojiPage' || page.id === 'diceGamePage' || page.id === 'footballGamePage') return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const kids = Array.from(page.children).filter(el => el.tagName !== 'SCRIPT' && el.tagName !== 'STYLE');
    kids.forEach(el => el.classList.remove('page-enter'));
    void page.offsetWidth;   // один перезапуск анимации сразу для всех блоков
    kids.forEach((el, i) => {
        el.style.setProperty('--pi', Math.min(i, 8));
        el.classList.add('page-enter');
    });
    clearTimeout(page._enterTimer);
    page._enterTimer = setTimeout(() => kids.forEach(el => el.classList.remove('page-enter')), 1100);
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

function openTgEmoji() {
    showPage("tgEmojiPage");
    updateNav("games");
    if (typeof window.initTgEmojiBanners === "function") window.initTgEmojiBanners();
}

function openTgEmojiMode(mode) {
    if (mode === "dice") { openDiceGame(); return; }
    if (mode === "football") { openFootballGame(); return; }
    // Остальные режимы пока не реализованы
    showMessage("Режим скоро появится");
}

/* ---------- КУБ ---------- */
const diceGame = { cubes: 1, mode: null, busy: false };
const DICE_MODE_COEFS = {
    high: 1.95, low: 1.95,      // 4-6 / 1-3
    even: 1.95, odd: 1.95,      // чёт / нечёт
    edges: 2.93, center: 2.93,  // края (1 или 6) / центр (3 или 4)
    // два куба (логика пока не реализована, только оформление)
    high2: 3.89, low2: 3.89, even2: 3.89, odd2: 3.89
};

// Какие плитки показываем при 1 и при 2 кубах
const DICE_MODE_SETS = {
    1: ["high", "low", "even", "odd", "edges", "center"],
    2: ["high2", "low2", "even2", "odd2"]
};

const DICE_MODE_NAMES = {
    high: "Больше", low: "Меньше",
    even: "Чёт", odd: "Нечёт",
    edges: "Края", center: "Центр",
    high2: "2 Больше", low2: "2 Меньше",
    even2: "2 Чёт", odd2: "2 Нечёт"
};

// Плитки режимов строятся из таблиц DICE_MODE_SETS / DICE_MODE_NAMES / DICE_MODE_COEFS,
// поэтому плитка и кнопка «Играть» всегда показывают одно и то же число.
// animate=true — плавная смена набора плиток (при переключении 1 куб ↔ 2 куба).
function renderDiceModes(animate) {
    const box = document.getElementById("diceModes");
    if (!box) return;
    const keys = DICE_MODE_SETS[diceGame.cubes] || DICE_MODE_SETS[1];
    const oldH = box.offsetHeight;

    box.innerHTML = keys.map((k, i) =>
        '<button class="dice-tile dice-mode' + (animate ? ' enter' : '') + '" style="--i:' + i + '" data-mode="' + k +
        '" onclick="selectDiceMode(\'' + k + '\', this)">' +
        '<span class="dice-mode-name">' + DICE_MODE_NAMES[k] + '</span> ' +
        '<span class="dice-mode-coef">(' + DICE_MODE_COEFS[k].toFixed(2) + '×)</span></button>'
    ).join("");

    // плавное изменение высоты блока (6 плиток → 4 и обратно), чтобы нижняя часть не прыгала
    if (animate && oldH) {
        box.style.height = "auto";
        const newH = box.offsetHeight;
        box.style.height = oldH + "px";
        box.classList.add("resizing");
        void box.offsetHeight;
        box.style.height = newH + "px";
        setTimeout(() => { box.style.height = ""; box.classList.remove("resizing"); }, 520);
    }
}

function openDiceGame() {
    renderDiceModes(false);
    showPage("diceGamePage");
    updateNav("games");
    if (typeof window.initDicePreview === "function") window.initDicePreview();
}

function updateDicePlayLabel() {
    const btn = document.getElementById("dicePlayBtn");
    if (!btn) return;
    const c = diceGame.mode ? DICE_MODE_COEFS[diceGame.mode] : null;
    btn.textContent = c ? "Играть (" + c.toFixed(2) + "×)" : "Играть";
}

function selectDiceMode(mode, btn) {
    diceGame.mode = mode;
    document.querySelectorAll("#diceModes .dice-mode").forEach(b => b.classList.remove("selected"));
    if (btn) btn.classList.add("selected");
    updateDicePlayLabel();
    // результат (галочка/крестик) остаётся на экране до начала новой игры
}

function selectDiceCubes(n, btn) {
    if (n !== 1 && n !== 2) { showMessage("Скоро появится"); return; }
    if (diceGame.busy || n === diceGame.cubes) return;
    diceGame.cubes = n;
    diceGame.mode = null;                       // набор режимов другой — выбор сбрасываем
    document.querySelectorAll(".dice-count-btn").forEach(b => b.classList.remove("active"));
    if (btn) btn.classList.add("active");
    renderDiceModes(true);
    updateDicePlayLabel();
    if (window.DiceStage) window.DiceStage.setCubes(n);   // раздвоение / склейка кубиков
}

function adjustDiceBet(factor) {
    applyBetFactor(document.getElementById("diceBetInput"), factor);
}

function setDiceMaxBet() {
    applyBetMax(document.getElementById("diceBetInput"));
}

function setDiceBusy(on) {
    diceGame.busy = on;
    const page = document.getElementById("diceGamePage");
    if (page) page.classList.toggle("is-busy", on);
}

// Честный бросок 1..6 без смещения (crypto вместо Math.random)
function rollDie() {
    const a = new Uint32Array(1);
    do { crypto.getRandomValues(a); } while (a[0] >= 4294967292); // 6 * 715827882
    return (a[0] % 6) + 1;
}

// Выигрыш = ставка × коэффициент, округлённый ВНИЗ до цента (не в пользу игрока).
// Считаем в целых центах, чтобы не ловить ошибки дробных чисел
// (например 1.2 × 1.95 в обычной арифметике даёт 2.3399999… и терял бы цент).
function calcDiceWin(bet, coef) {
    const cents = Math.round(bet * 100);
    const coefHundredths = Math.round(coef * 100);
    return Math.floor((cents * coefHundredths) / 100) / 100;
}

function isDiceWin(mode, r) {
    switch (mode) {
        case "high":   return r >= 4;
        case "low":    return r <= 3;
        case "even":   return r % 2 === 0;
        case "odd":    return r % 2 === 1;
        case "edges":  return r === 1 || r === 6;
        case "center": return r === 3 || r === 4;
    }
    return false;
}

async function handleDicePlay() {
    if (diceGame.busy) return;
    if (!diceGame.mode) { showMessage("Выберите режим ставки!"); return; }
    if (!lockEconomy()) return;

    const input = document.getElementById("diceBetInput");
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

    setDiceBusy(true);
    const mode = diceGame.mode;
    const coef = DICE_MODE_COEFS[mode];

    // --- 1. списываем ставку ---
    const snapshot = snapshotBalanceState();
    currentTurnover = roundMoney(currentTurnover + bet);
    currentBetsCount++;
    setUIBalance(roundMoney(currentBalance - bet));

    const debit = await placeBetServer(bet, "Куб");
    if (!debit.ok) {
        restoreBalanceState(snapshot);
        showMessage("Не удалось списать ставку. Проверьте соединение и попробуйте снова.");
        setDiceBusy(false);
        unlockEconomy();
        return;
    }
    currentBalance = debit.balance;
    setUIBalance(currentBalance);
    const liveBetId = await broadcastLiveBet(bet, "Куб");

    // --- 2. броски и расчёт ---
    // 1 куб: один бросок должен подойти под режим.
    // 2 куба: первый бросок должен подойти — тогда кидается второй, и он тоже должен подойти.
    // Если первый не подошёл — второй не кидается. Выигрыш только при (2/2).
    const twoCubes = diceGame.cubes === 2;
    const baseMode = mode.replace(/2$/, "");       // "even2" → "even"
    const roll1 = rollDie();
    const pass1 = isDiceWin(baseMode, roll1);
    let roll2 = null, pass2 = false;
    if (twoCubes && pass1) {
        roll2 = rollDie();
        pass2 = isDiceWin(baseMode, roll2);
    }
    const win = twoCubes ? (pass1 && pass2) : pass1;
    if (window.DiceStage) window.DiceStage.prepare(roll1);   // заранее собираем анимацию выпавшей грани
    const winAmount = win ? calcDiceWin(bet, coef) : 0;
    let finalBalance = currentBalance;

    if (win) {
        const afterBet = snapshotBalanceState();
        currentTotalWin = roundMoney(currentTotalWin + winAmount);
        currentWinsCount++;
        if (coef > currentMaxWin) currentMaxWin = coef;

        // Выигрыш зачисляем на сервер сразу, а на экране баланс покажем после анимации
        const credit = await resolveWinServerWithRetry(winAmount, coef, 3);
        if (!credit.ok) {
            restoreBalanceState(afterBet);
            showMessage("Не удалось зачислить выигрыш. Обратитесь в поддержку.");
            setDiceBusy(false);
            unlockEconomy();
            if (window.DiceStage) window.DiceStage.reset();
            return;
        }
        finalBalance = credit.balance;
    }
    unlockEconomy();

    // --- 3. анимация ---
    const amountText = win ? "+" + winAmount.toFixed(2) + "$" : "-" + bet.toFixed(2) + "$";
    try {
        if (window.DiceStage) {
            if (!twoCubes) {
                await window.DiceStage.play({ roll: roll1, win, amountText });
            } else {
                // бросок 1/2
                await window.DiceStage.play({
                    roll: roll1,
                    win: pass1,
                    title: pass1 ? "Ставка зашла (1/2)" : "Ставка не зашла (1/2)",
                    amountText: pass1 ? "" : amountText,       // сумма — только в финале
                    nextRoll: pass1 ? roll2 : null
                });
                // бросок 2/2 (только если первый подошёл)
                if (pass1) {
                    await window.DiceStage.play({
                        roll: roll2,
                        win: pass2,
                        title: pass2 ? "Ставка зашла (2/2)" : "Ставка не зашла (2/2)",
                        amountText
                    });
                }
            }
        }
    } catch (e) {
        console.error("Dice animation error:", e);
    }

    // --- 4. итог: баланс на экране, вибрация, лента ставок ---
    setUIBalance(finalBalance);
    if (tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred(win ? "success" : "error");
    resolveLiveBetWin(liveBetId, bet, winAmount);
    setDiceBusy(false);
}

/* ---------- ФУТБОЛ ---------- */
const footballGame = { kicks: 1, mode: null, busy: false };
const FOOTBALL_MODE_COEFS = {
    goal: 1.62,         // Гол
    miss: 2.43,         // Промах
    bar: 2.43           // Удар об штангу
};

// Какие плитки показываем при разном количестве ударов
const FOOTBALL_MODE_SETS = {
    1: ["goal", "miss", "bar"]
};

const FOOTBALL_MODE_NAMES = {
    goal: "Гол",
    miss: "Промах",
    bar: "Удар об штангу"
};

function renderFootballModes(animate) {
    const box = document.getElementById("footballModes");
    if (!box) return;
    const keys = FOOTBALL_MODE_SETS[footballGame.kicks] || FOOTBALL_MODE_SETS[1];
    const oldH = box.offsetHeight;

    box.innerHTML = keys.map((k, i) =>
        '<button class="dice-tile dice-mode' + (animate ? ' enter' : '') + '" style="--i:' + i + '" data-mode="' + k +
        '" onclick="selectFootballMode(\'' + k + '\', this)">' +
        '<span class="dice-mode-name">' + FOOTBALL_MODE_NAMES[k] + '</span> ' +
        '<span class="dice-mode-coef">(' + FOOTBALL_MODE_COEFS[k].toFixed(2) + '×)</span></button>'
    ).join("");

    if (animate && oldH) {
        box.style.height = "auto";
        const newH = box.offsetHeight;
        box.style.height = oldH + "px";
        box.classList.add("resizing");
        void box.offsetHeight;
        box.style.height = newH + "px";
        setTimeout(() => { box.style.height = ""; box.classList.remove("resizing"); }, 520);
    }
}

function openFootballGame() {
    renderFootballModes(false);
    showPage("footballGamePage");
    updateNav("games");
    if (typeof window.initFootballPreview === "function") window.initFootballPreview();
}

function updateFootballPlayLabel() {
    const btn = document.getElementById("footballPlayBtn");
    if (!btn) return;
    const c = footballGame.mode ? FOOTBALL_MODE_COEFS[footballGame.mode] : null;
    btn.textContent = c ? "Играть (" + c.toFixed(2) + "×)" : "Играть";
}

function selectFootballMode(mode, btn) {
    footballGame.mode = mode;
    document.querySelectorAll("#footballModes .dice-mode").forEach(b => b.classList.remove("selected"));
    if (btn) btn.classList.add("selected");
    updateFootballPlayLabel();
}

function selectFootballKicks(n, btn) {
    if (n !== 1) { showMessage("Скоро появится"); return; }
    if (footballGame.busy || n === footballGame.kicks) return;
    footballGame.kicks = n;
    footballGame.mode = null;
    document.querySelectorAll(".dice-count-btn").forEach(b => b.classList.remove("active"));
    if (btn) btn.classList.add("active");
    renderFootballModes(true);
    updateFootballPlayLabel();
}

function adjustFootballBet(factor) {
    applyBetFactor(document.getElementById("footballBetInput"), factor);
}

function setFootballMaxBet() {
    applyBetMax(document.getElementById("footballBetInput"));
}

function setFootballBusy(on) {
    footballGame.busy = on;
    const page = document.getElementById("footballGamePage");
    if (page) page.classList.toggle("is-busy", on);
}

// Честный бросок 1..5 для футбола
function rollFootball() {
    const a = new Uint32Array(1);
    do { crypto.getRandomValues(a); } while (a[0] >= 4294967295); // 5 * 858993459
    return (a[0] % 5) + 1;
}

function calcFootballWin(bet, coef) {
    const cents = Math.round(bet * 100);
    const coefHundredths = Math.round(coef * 100);
    return Math.floor((cents * coefHundredths) / 100) / 100;
}

// football 1,2 = промах; football 3,4,5 = гол; football 2,4 = штанга
function isFootballWin(mode, roll) {
    if (mode === "goal") return roll >= 3;              // football 3,4,5 = гол
    if (mode === "miss") return roll <= 2;              // football 1,2 = промах
    if (mode === "bar") return roll === 2 || roll === 4;  // football 2,4 = штанга
    return false;
}

async function handleFootballPlay() {
    if (footballGame.busy) return;
    if (!footballGame.mode) { showMessage("Выберите режим ставки!"); return; }
    if (!lockEconomy()) return;

    const input = document.getElementById("footballBetInput");
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

    setFootballBusy(true);
    const mode = footballGame.mode;
    const coef = FOOTBALL_MODE_COEFS[mode];

    // --- 1. списываем ставку ---
    const snapshot = snapshotBalanceState();
    currentTurnover = roundMoney(currentTurnover + bet);
    currentBetsCount++;
    setUIBalance(roundMoney(currentBalance - bet));

    const debit = await placeBetServer(bet, "Футбол");
    if (!debit.ok) {
        restoreBalanceState(snapshot);
        showMessage("Не удалось списать ставку. Проверьте соединение и попробуйте снова.");
        setFootballBusy(false);
        unlockEconomy();
        return;
    }
    currentBalance = debit.balance;
    setUIBalance(currentBalance);
    const liveBetId = await broadcastLiveBet(bet, "Футбол");

    // --- 2. бросок и расчёт ---
    const roll = rollFootball();
    const win = isFootballWin(mode, roll);
    if (window.FootballStage) window.FootballStage.prepare(roll);
    const winAmount = win ? calcFootballWin(bet, coef) : 0;
    let finalBalance = currentBalance;

    if (win) {
        const afterBet = snapshotBalanceState();
        currentTotalWin = roundMoney(currentTotalWin + winAmount);
        currentWinsCount++;
        if (coef > currentMaxWin) currentMaxWin = coef;

        const credit = await resolveWinServerWithRetry(winAmount, coef, 3);
        if (!credit.ok) {
            restoreBalanceState(afterBet);
            showMessage("Не удалось зачислить выигрыш. Обратитесь в поддержку.");
            setFootballBusy(false);
            unlockEconomy();
            if (window.FootballStage) window.FootballStage.reset();
            return;
        }
        finalBalance = credit.balance;
    }
    unlockEconomy();

    // --- 3. анимация ---
    const amountText = win ? "+" + winAmount.toFixed(2) + "$" : "-" + bet.toFixed(2) + "$";
    try {
        if (window.FootballStage) {
            await window.FootballStage.play({ roll, win, amountText });
        }
    } catch (e) {
        console.error("Ошибка анимации футбола:", e);
    }

    // --- 4. итог ---
    setUIBalance(finalBalance);
    if (tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred(win ? "success" : "error");
    resolveLiveBetWin(liveBetId, bet, winAmount);
    setFootballBusy(false);
}

function openMines() {
    showPage("minesPage");
    updateNav("games");
    initMinesGrid();
    resumeMinesGame();
}

function openBalance(mode = "deposit") {
    showPage("balancePage");
    setBalanceMode(mode);
    updateNav("balance");
    renderTransactions();
    loadWalletHistory(true);      // актуальные пополнения/выводы и баланс с сервера
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

    const map = { home: "homeNav", games: "homeNav", balance: "balanceNav", bonus: "bonusNav", top: "topNav", profile: "profileNav" };
    const activeElement = document.getElementById(map[active]);
    if (activeElement) activeElement.classList.add("active");
    if (typeof window.navSync === "function") window.navSync(active === "games" ? "home" : active);
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
        const statusText = tx.status === 'success' ? 'Успешно' : tx.status === 'failed' ? 'Отменено' : 'В обработке';

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

function handleBalanceAction() {
    if (typeof balanceMode !== 'undefined' && balanceMode === 'withdraw') {
        handleWithdrawal();
    } else {
        handleDeposit();
    }
}

// ==========================================
// РЕАЛЬНЫЕ ПЛАТЕЖИ: CryptoBot (Crypto Pay API)
// Клиент ничего не зачисляет сам: он только просит Edge Function создать счёт /
// выплату. Деньги на баланс попадают на сервере — после подписанного вебхука
// от CryptoBot (см. supabase/functions и CRYPTOBOT_SETUP.md).
// ==========================================
const WALLET_FN_URL = SUPABASE_URL + '/functions/v1/';
const MIN_DEPOSIT_UI = 1;
const MIN_WITHDRAW_UI = 2;
let walletBusy = false;
let depositWatchTimer = null;

async function walletCall(fn, body) {
    try {
        const res = await fetch(WALLET_FN_URL + fn, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
            body: JSON.stringify(Object.assign({ init_data: tg?.initData || '' }, body || {}))
        });
        const data = await res.json().catch(() => null);
        return data || { ok: false, error: 'BAD_RESPONSE' };
    } catch (e) {
        return { ok: false, error: 'NETWORK' };
    }
}

function walletErrorText(r) {
    switch (r && r.error) {
        case 'AMOUNT':             return r.min ? `Минимальная сумма — ${r.min} $` : 'Некорректная сумма';
        case 'INSUFFICIENT_FUNDS': return 'Недостаточно средств';
        case 'DEPOSIT_REQUIRED':   return 'Для вывода сначала пополните баланс';
        case 'WAGER_REQUIRED':     return 'Для вывода нужно отыграть сумму пополнений';
        case 'TOO_MANY':           return 'Слишком много неоплаченных счетов. Попробуйте позже';
        case 'PROVIDER':           return 'CryptoBot отклонил операцию. Убедитесь, что вы запускали @CryptoBot, и попробуйте позже';
        case 'AUTH':               return 'Не удалось подтвердить пользователя. Перезапустите приложение';
        case 'NETWORK':            return 'Нет соединения с сервером';
        default:                   return 'Ошибка сервера. Попробуйте позже';
    }
}

function setBalanceActionLoading(on) {
    const btn = document.getElementById('balanceAction');
    if (!btn) return;
    btn.disabled = on;
    btn.style.opacity = on ? '0.6' : '';
}

function formatTxDate(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// Подтягивает баланс и историю операций с сервера
async function loadWalletHistory(silent) {
    if (!tg?.initData) return null;
    const r = await walletCall('wallet-history');
    if (!r.ok) {
        if (!silent) showMessage(walletErrorText(r));
        return r;
    }

    const statusMap = { paid: 'success', completed: 'success', pending: 'pending', processing: 'pending',
                        review: 'pending', failed: 'failed', expired: 'failed' };
    transactions.length = 0;
    r.items.forEach(x => transactions.push({
        id: x.id,
        type: x.type,
        method: 'CryptoBot',
        icon: 'images/crypto/cryptobot.png',
        amount: Number(x.amount),
        date: formatTxDate(x.created_at),
        status: statusMap[x.status] || 'pending'
    }));
    renderTransactions();

    // баланс не трогаем, пока идёт ставка (иначе раньше времени «спойлерим» исход игры)
    const dice = (typeof diceGame !== 'undefined') ? diceGame : null;
    if (!isEconomyLocked && !(dice && dice.busy)) {
        currentDeposits = Number(r.deposits) || 0;
        currentWithdrawals = Number(r.withdrawals) || 0;
        setUIBalance(r.balance);
    }
    return r;
}

// После открытия счёта ждём оплату: раз в 4 секунды спрашиваем статус (до 20 минут)
function watchDeposit(depositId) {
    if (depositWatchTimer) clearInterval(depositWatchTimer);
    const started = Date.now();
    depositWatchTimer = setInterval(async () => {
        if (Date.now() - started > 20 * 60 * 1000) { clearInterval(depositWatchTimer); depositWatchTimer = null; return; }
        if (document.visibilityState !== 'visible') return;
        const r = await loadWalletHistory(true);
        const tx = r && r.ok && r.items.find(x => x.id === depositId);
        if (tx && tx.status === 'paid') {
            clearInterval(depositWatchTimer);
            depositWatchTimer = null;
            if (tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
            showMessage(`Пополнение +${Number(tx.amount).toFixed(2)}$ зачислено`);
        } else if (tx && (tx.status === 'expired' || tx.status === 'failed')) {
            clearInterval(depositWatchTimer);
            depositWatchTimer = null;
        }
    }, 4000);
}

// вернулись в приложение из CryptoBot — сразу обновляем баланс
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const onBalance = !document.getElementById('balancePage')?.classList.contains('hidden');
    if (depositWatchTimer || onBalance) loadWalletHistory(true);
});

function readBalanceAmount() {
    const input = document.querySelector('.sum-input-wrap input');
    const amount = input ? Math.round(parseFloat(input.value) * 100) / 100 : 0;
    return { input, amount };
}

async function handleDeposit() {
    if (walletBusy) return;
    const { input, amount } = readBalanceAmount();

    if (!amount || amount <= 0) { showMessage('Введите корректную сумму'); return; }
    if (amount < MIN_DEPOSIT_UI) { showMessage(`Минимальное пополнение — ${MIN_DEPOSIT_UI} $`); return; }
    if (!tg?.initData) { showMessage('Откройте приложение через Telegram, чтобы пополнить баланс.'); return; }
    if (selectedMethod !== 'CryptoBot') { showMessage(selectedMethod + ' скоро появится'); return; }

    walletBusy = true;
    setBalanceActionLoading(true);
    const r = await walletCall('cryptobot-create-invoice', { amount });
    walletBusy = false;
    setBalanceActionLoading(false);

    if (!r.ok) { showMessage(walletErrorText(r)); return; }

    // открываем счёт прямо в Telegram (мини-приложение CryptoBot)
    const url = r.mini_app_url || r.url;
    if (tg?.openTelegramLink && /^https:\/\/t\.me\//.test(url)) tg.openTelegramLink(url);
    else if (tg?.openLink) tg.openLink(url);
    else window.open(url, '_blank', 'noopener');

    if (input) input.value = '';
    loadWalletHistory(true);
    watchDeposit(r.deposit_id);
}

async function handleWithdrawal() {
    if (walletBusy) return;
    const { input, amount } = readBalanceAmount();

    if (!amount || amount <= 0) { showMessage('Введите корректную сумму вывода'); return; }
    if (amount < MIN_WITHDRAW_UI) { showMessage(`Минимальный вывод — ${MIN_WITHDRAW_UI} $`); return; }
    if (amount > currentBalance) { showMessage('Недостаточно средств'); return; }
    if (!tg?.initData) { showMessage('Откройте приложение через Telegram, чтобы вывести средства.'); return; }
    if (selectedMethod !== 'CryptoBot') { showMessage(selectedMethod + ' скоро появится'); return; }

    walletBusy = true;
    setBalanceActionLoading(true);
    const r = await walletCall('cryptobot-withdraw', { amount });
    walletBusy = false;
    setBalanceActionLoading(false);

    if (typeof r.balance === 'number') setUIBalance(r.balance);   // сервер вернул актуальный баланс (в т.ч. после возврата)
    if (!r.ok) { showMessage(walletErrorText(r)); loadWalletHistory(true); return; }

    if (input) input.value = '';
    if (r.status === 'completed') {
        if (tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
        showMessage(`Выплата ${amount.toFixed(2)} $ отправлена в CryptoBot`);
    } else if (r.status === 'review') {
        showMessage(`Заявка на ${amount.toFixed(2)} $ принята — выплата после проверки`);
    } else {
        showMessage(`Заявка на ${amount.toFixed(2)} $ в обработке`);
    }
    loadWalletHistory(true);
}

function claimBonus() {
    showMessage("Ежедневный бонус временно недоступен");
}
    
/* =========================
   ЗАГОТОВЛЕННОЕ СООБЩЕНИЕ (savePreparedInlineMessage)
========================= */
const SHARE_TEST_CHROME_URL = 'https://www.google.com/chrome/';

function openShareTestChrome() {
    if (tg?.openLink) {
        tg.openLink(SHARE_TEST_CHROME_URL);
        return;
    }
    window.open(SHARE_TEST_CHROME_URL, '_blank', 'noopener');
}

function getTelegramUserId() {
    const unsafeId = Number(tg?.initDataUnsafe?.user?.id);
    if (Number.isFinite(unsafeId) && unsafeId > 0) return unsafeId;

    try {
        const params = new URLSearchParams(tg?.initData || '');
        const userRaw = params.get('user');
        if (!userRaw) return 0;
        const user = JSON.parse(userRaw);
        const parsed = Number(user?.id);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    } catch (e) {
        return 0;
    }
}

async function requestPreparedMessageId() {
    const userId = getTelegramUserId();
    const { data, error } = await supabase.functions.invoke('create-prepared-share-message', {
        body: { user_id: userId }
    });

    if (error) {
        throw new Error(error.message || 'Не удалось сохранить заготовку');
    }
    if (data && data.error) {
        throw new Error(data.error);
    }

    const preparedId = data && data.prepared_message_id;
    if (!preparedId) {
        throw new Error('Сервер не вернул id заготовки');
    }

    return preparedId;
}

async function sharePreparedInvite() {
    const btn = document.getElementById('shareInviteBtn');
    if (btn?.disabled) return;

    if (!tg) {
        showMessage('Откройте приложение через Telegram');
        return;
    }

    if (typeof tg.shareMessage !== 'function') {
        showMessage('Обновите Telegram: нужен клиент с Bot API 8.0 (shareMessage).');
        return;
    }

    if (!getTelegramUserId()) {
        showMessage('Не удалось определить Telegram ID');
        return;
    }

    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Готовим сообщение…';
    }

    try {
        const preparedId = await requestPreparedMessageId();
        tg.shareMessage(preparedId, (sent) => {
            if (sent) {
                showMessage('Сообщение отправлено');
            }
        });
    } catch (err) {
        const text = String(err && err.message ? err.message : err);
        showMessage(text);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Отправить…';
        }
    }
}

/* =========================
   ПРОМОКОД
========================= */

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

    showMessage('Промокод недействителен');
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

    let resolveCrashReady;
    const crashReady = new Promise(r => { resolveCrashReady = r; });
    const assetsReady = preloadAppAssets([crashReady]);

    if (window.Telegram?.WebApp) {
        window.Telegram.WebApp.ready();
        window.Telegram.WebApp.expand();
    }

    console.log('[init] загрузка профиля из Supabase...');
    // Если Supabase не отвечает — через 8 сек всё равно открываем приложение
    await Promise.race([
        loadUserData().catch(e => console.error('[init] loadUserData упала:', e)),
        new Promise(r => setTimeout(() => { console.warn('[init] Supabase не ответил за 8 сек'); r(); }, 8000))
    ]);
    console.log('[init] профиль готов, открываем главную');
    updateLevelUI();
    goHome();
    initLiveBetsFeed();
    iceArena.watching = true;
    startIceArenaLobby();
    applyDesign();
    startCrashEngine().finally(resolveCrashReady);
    routeStartParam();   // deep link: t.me/бот?startapp=mines → сразу открыть нужную страницу


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
    // браузера. Настоящая защита баланса — на стороне Supabase (RLS),
    // см. supabase_security.sql.
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('keydown', (e) => {
        const key = e.key ? e.key.toUpperCase() : '';
        const blockCombo =
            key === 'F12' ||
            (e.ctrlKey && (key === 'U' || key === 'S')) ||
            (e.ctrlKey && e.shiftKey && (key === 'I' || key === 'J' || key === 'C'));
        if (blockCombo) e.preventDefault();
    });

    hideAppLoader(assetsReady);
});

/* =========================
   DEEP LINKS (startapp)
   Ссылка вида  https://t.me/wxs_robot?startapp=mines
   (или https://t.me/wxs_robot/НАЗВАНИЕ_ПРИЛОЖЕНИЯ?startapp=mines)
   Значение после startapp= приходит в start_param и открывает нужную страницу.
   В start_param можно только латиницу, цифры, _ и - (до 512 символов).
========================= */
const START_ROUTES = {
    mines:      () => openMines(),
    crash:      () => openCrash(),
    upgrader:   () => openUpgrader(),
    ice:        () => openIceArena(),
    emoji:      () => openTgEmoji(),
    dice:       () => { openTgEmoji(); openDiceGame(); },
    football:   () => { openTgEmoji(); openFootballGame(); },
    bonus:      () => openBonus(),
    profile:    () => openProfile(),
    deposit:    () => openBalance('deposit'),
    withdraw:   () => openBalance('withdraw')
};

function getStartParam() {
    let p = window.Telegram?.WebApp?.initDataUnsafe?.start_param;
    if (!p) {
        // запасной путь: Telegram кладёт параметр в адрес как tgWebAppStartParam
        const m = (location.hash + '&' + location.search).match(/tgWebAppStartParam=([^&]+)/);
        if (m) { try { p = decodeURIComponent(m[1]); } catch (e) { p = m[1]; } }
    }
    return p ? String(p).trim().toLowerCase() : '';
}

function routeStartParam() {
    const param = getStartParam();
    if (!param) return;
    const route = START_ROUTES[param];
    if (!route) { console.warn('[deeplink] неизвестный параметр:', param); return; }
    try { route(); } catch (e) { console.error('[deeplink] не удалось открыть', param, e); }
}

/* =========================
   ПРЕДЗАГРУЗКА РЕСУРСОВ ПРИ СТАРТЕ (во время экрана загрузки)
========================= */

// Все картинки, которые используются в приложении (и в HTML, и из JS).
// Добавляете новую картинку в проект — допишите её сюда.
const PRELOAD_IMAGES = [
    'images/mines/bomb.png',
    'images/mines/gem.png',
    'images/crypto/tether.png',
    'images/crypto/cryptobot.png',
    'images/crypto/xrocket.png',
    'images/ui/copy.png',
    'images/ui/lock.png',
    'images/ui/key.png',
    'images/banners/rocket_game.png',
    'images/banners/mines_game.png',
    'images/banners/telegram_emoji_banner.jpg',
    'images/banners/upgrader_game.png'
];

const PRELOAD_TASK_TIMEOUT_MS = 8000;   // один зависший файл не должен вешать загрузку
let appLoadProgress = 0;                // 0..1, читает экран загрузки
window.__preloadedImages = [];          // держим ссылки, чтобы браузер не выкинул из кэша

function preloadImage(src) {
    return new Promise(resolve => {
        const img = new Image();
        let done = false;
        const finish = () => { if (!done) { done = true; resolve(); } };
        img.onload = () => {
            // decode() заранее раскодирует картинку, чтобы не было мигания при первом показе
            if (img.decode) img.decode().then(finish, finish); else finish();
        };
        img.onerror = finish;               // нет файла — просто идём дальше
        img.src = src;
        window.__preloadedImages.push(img);
        setTimeout(finish, PRELOAD_TASK_TIMEOUT_MS);
    });
}

// Lottie-данные ракеты/взрыва склеиваются из кусков и парсятся ОДИН раз —
// это самая тяжёлая операция, поэтому делаем её на экране загрузки.
function getLottieData(kind) {   // kind: 'ROCKET' | 'EXPLOSION'
    const cacheKey = '__LOTTIE_' + kind;
    if (window[cacheKey] !== undefined) return window[cacheKey];
    let data = null;
    const chunks = window[kind + '_DATA_CHUNKS'];
    if (chunks && chunks.length) {
        try { data = JSON.parse(chunks.join('')); } catch (e) { data = null; }
    }
    window[cacheKey] = data;
    return data;
}

// extraTasks — доп. промисы (например, первый запрос состояния краша).
function preloadAppAssets(extraTasks = []) {
    const tasks = [
        ...PRELOAD_IMAGES.map(preloadImage),
        (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).catch(() => {}),
        new Promise(resolve => setTimeout(() => {
            getLottieData('ROCKET');
            getLottieData('EXPLOSION');
            resolve();
        }, 0)),
        ...extraTasks.map(p => Promise.race([
            Promise.resolve(p).catch(() => {}),
            new Promise(r => setTimeout(r, 6000))
        ]))
    ];

    let done = 0;
    const total = tasks.length;
    appLoadProgress = 0;
    return Promise.all(tasks.map(t => t.then(() => {
        done++;
        appLoadProgress = done / total;
    })));
}

function hideAppLoader(assetsReady) {
    const loader = document.getElementById('appLoader');
    const fill = document.getElementById('appLoaderProgressFill');
    if (!loader) return;

    const minVisibleMs = 900;
    const maxVisibleMs = 15000;   // страховка: не держим экран загрузки вечно
    const startedAt = Date.now();

    // Полоса теперь показывает РЕАЛЬНЫЙ прогресс предзагрузки (плавно догоняет)
    let shown = 6;
    const progressTimer = setInterval(() => {
        const target = 6 + 90 * appLoadProgress;
        shown += (target - shown) * 0.25;
        if (fill) fill.style.width = shown + '%';
    }, 80);

    const windowLoaded = document.readyState === 'complete'
        ? Promise.resolve()
        : new Promise(r => window.addEventListener('load', r, { once: true }));

    const everythingReady = Promise.all([windowLoaded, assetsReady || Promise.resolve()]);
    const safetyTimeout = new Promise(r => setTimeout(r, maxVisibleMs));

    Promise.race([everythingReady, safetyTimeout]).then(() => {
        const remaining = Math.max(0, minVisibleMs - (Date.now() - startedAt));
        setTimeout(() => {
            clearInterval(progressTimer);
            if (fill) fill.style.width = '100%';
            setTimeout(() => {
                loader.classList.add('app-loader-hidden');
                setTimeout(() => loader.remove(), 220);
            }, 100);
        }, remaining);
    });
}

// Экспорт функций в глобальную область для onclick-обработчиков в HTML
window.adjustMinesBet = adjustMinesBet;
window.adjustCrashBet = adjustCrashBet;
window.autoPickMinesTile = autoPickMinesTile;
window.changeMinesBy = changeMinesBy;
window.claimBonus = claimBonus;
window.handleDeposit = handleDeposit;
window.handleWithdrawal = handleWithdrawal;
window.handleBalanceAction = handleBalanceAction;
window.sharePreparedInvite = sharePreparedInvite;
window.openShareTestChrome = openShareTestChrome;
window.goHome = goHome;
window.handleCrashAction = handleCrashAction;
window.handleMinesAction = handleMinesAction;
window.onCustomMinesInputChange = onCustomMinesInputChange;
window.openBalance = openBalance;
window.openBonus = openBonus;
window.showPage = showPage;
window.updateNav = updateNav;
window.wxsSupabase = supabase;   // клиент Supabase (window.supabase — это сама библиотека CDN)
window.openCrash = openCrash;
window.openGamesMenu = openGamesMenu;
window.openMines = openMines;
window.openTgEmoji = openTgEmoji;
window.openTgEmojiMode = openTgEmojiMode;
window.openDiceGame = openDiceGame;
window.selectDiceMode = selectDiceMode;
window.selectDiceCubes = selectDiceCubes;
window.adjustDiceBet = adjustDiceBet;
window.setDiceMaxBet = setDiceMaxBet;
window.handleDicePlay = handleDicePlay;
window.openFootballGame = openFootballGame;
window.selectFootballMode = selectFootballMode;
window.selectFootballKicks = selectFootballKicks;
window.adjustFootballBet = adjustFootballBet;
window.setFootballMaxBet = setFootballMaxBet;
window.handleFootballPlay = handleFootballPlay;
window.openUpgrader = openUpgrader;
window.playUpgrader = playUpgrader;
window.upgSetChance = upgSetChance;
window.upgAdjustChance = upgAdjustChance;
window.upgBetFactor = upgBetFactor;
window.upgBetMax = upgBetMax;
window.upgOnBetInput = upgOnBetInput;
window.upgOnChanceInput = upgOnChanceInput;
window.openProfile = openProfile;
window.saveProfileCustomization = saveProfileCustomization;
window.selectMethod = selectMethod;
window.selectMinesCount = selectMinesCount;
window.setBalanceMode = setBalanceMode;
window.setCrashMaxBet = setCrashMaxBet;
window.setMinesMaxBet = setMinesMaxBet;
window.showMessage = showMessage;
window.toggleMethods = toggleMethods;
window.toggleProfileCustomizer = toggleProfileCustomizer;
window.clickMinesTile = clickMinesTile;
window.selectGradient = selectGradient;
window.clampBetInputOnBlur = clampBetInputOnBlur;
window.blockInvalidBetKeys = blockInvalidBetKeys;
window.applyPromoCode = applyPromoCode;
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
       game_number bigint generated always as identity,
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
   -- Если таблица ice_arena_rounds уже существует (создана раньше без
   -- этого столбца), выполните отдельно:
   -- alter table public.ice_arena_rounds add column if not exists game_number bigint generated always as identity;

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
    loadIceArenaHistory();
    if (iceArena.round?.status === 'spinning' && iceArena.winner && iceArena.animatingRoundId !== iceArena.round.id) {
        iceArena.animatingRoundId = iceArena.round.id;
        renderIceArenaField();
        beginIceArenaSpin(iceArena.winner);
    }
}

function leaveIceArena() {
    goHome();
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
    resetIceArenaVisuals({ hideOverlay: true, resetPuck: true });
    renderIceArenaField();
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
        iceArena.pollInterval = setInterval(makePagePoller('iceArenaPage', () => refreshIceArenaState(), 3), 1200);
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
        if (countdownEl) countdownEl.textContent = '—';
        return;
    }

    if (!round.betting_ends_at) {
        if (timerBox) timerBox.classList.remove('counting', 'waiting');
        if (countdownEl) countdownEl.textContent = '—';
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
            empty.innerHTML = '❄️ Ждём игроков...<br>Чем выше ставка - больше шанс забрать всё!';
        }
        return;
    }
    if (empty) {
        if (iceArena.players.length === 1 && iceArena.phase === 'betting') {
            empty.classList.remove('hidden');
            empty.innerHTML = '❄️ Ждём еще минимум одного игрока...';
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
    const gameNumberEl = document.getElementById('iceGameNumber');
    const total = iceArena.players.reduce((s, p) => s + p.bet, 0);
    if (bankEl) bankEl.textContent = total.toFixed(2) + ' $';
    if (gameNumberEl) {
        const num = iceArena.round?.game_number;
        gameNumberEl.textContent = num ? ('#' + num) : '—';
    }
}

function beginIceArenaSpin(winner) {
    if (!winner || !iceArena.players.length) return;

    iceArena.phase = 'spinning';
    iceArena.winner = winner;
    updateIceArenaBetControls();

    const timerBox = document.getElementById('iceTimerBox');
    const countdownEl = document.getElementById('iceCountdownValue');
    if (timerBox) timerBox.classList.remove('counting', 'waiting');
    if (countdownEl) countdownEl.textContent = '—';

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

    puck.classList.remove('ice-puck-spinning');

    const total = iceArena.players.reduce((s, p) => s + p.bet, 0);
    let cursor = 0;
    let targetXPct = 50;
    for (const p of iceArena.players) {
        const w = total > 0 ? (p.bet / total) * 100 : 0;
        if (p.id === winner.id) {
            targetXPct = cursor + w / 2;
            break;
        }
        cursor += w;
    }

    const rect = field.getBoundingClientRect();
    const fieldW = rect.width;
    const fieldH = rect.height;

    const puckRadius = (puck.offsetWidth || 24) / 2;
    const margin = puckRadius + 3;
    const arrowOffset = puckRadius + 6;

    const minX = margin, maxX = fieldW - margin;
    const minY = margin, maxY = fieldH - margin;

    let x = fieldW / 2;
    let y = fieldH / 2;

    const targetX = (targetXPct / 100) * fieldW;
    const targetY = fieldH * (0.35 + Math.random() * 0.3);

    function setArrowAngle(dirX, dirY) {
        if (!arrow) return;
        const ang = Math.atan2(dirY, dirX) * 180 / Math.PI + 90;
        arrow.style.transform = 'translate(-50%, -' + arrowOffset + 'px) rotate(' + ang + 'deg)';
    }

    function pulsePuckBounce() {
        puck.classList.remove('ice-puck-shake');
        void puck.offsetWidth;
        puck.classList.add('ice-puck-shake');
        if (window.tg?.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
    }

    let angle = Math.random() * Math.PI * 2;
    let speed = 2000 + Math.random() * 900;
    let vx = Math.cos(angle) * speed;
    let vy = Math.sin(angle) * speed;

    const bounceTarget = 2 + Math.floor(Math.random() * 2);
    let bounceCount = 0;

    const stopPlanned = Math.random() < 0.55;
    const stopAtBounce = stopPlanned ? 1 + Math.floor(Math.random() * Math.max(1, bounceTarget - 1)) : -1;
    let stopUntil = 0;

    setArrowAngle(vx, vy);

    let phase = 'bounce';
    let homeStartX = x, homeStartY = y, homeStartTime = 0;
    const homeDuration = 480 + Math.random() * 220;
    const launchStart = performance.now();
    let lastTime = launchStart;

    function easeOutStrong(t) {
        return 1 - Math.pow(1 - t, 3);
    }

    function frame(now) {
        const dt = Math.min(0.04, (now - lastTime) / 1000);
        lastTime = now;

        if (phase === 'bounce' && now - launchStart > 3000) {
            phase = 'home';
            homeStartX = x; homeStartY = y; homeStartTime = now;
        }

        if (phase === 'stop') {
            puck.style.left = x + 'px';
            puck.style.top = y + 'px';
            if (now < stopUntil) {
                requestAnimationFrame(frame);
                return;
            }
            phase = 'bounce';
        }

        if (phase === 'bounce') {
            x += vx * dt;
            y += vy * dt;

            let bounced = false;
            if (x < minX) { x = minX; vx = -vx; bounced = true; }
            else if (x > maxX) { x = maxX; vx = -vx; bounced = true; }
            if (y < minY) { y = minY; vy = -vy; bounced = true; }
            else if (y > maxY) { y = maxY; vy = -vy; bounced = true; }

            if (bounced) {
                bounceCount++;
                vx *= 0.85;
                vy *= 0.85;
                pulsePuckBounce();
                setArrowAngle(vx, vy);

                if (bounceCount >= bounceTarget) {
                    phase = 'home';
                    homeStartX = x; homeStartY = y; homeStartTime = now;
                } else if (stopPlanned && bounceCount === stopAtBounce) {
                    phase = 'stop';
                    stopUntil = now + 150 + Math.random() * 220;
                    if (window.tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred('warning');
                }
            } else {
                setArrowAngle(vx, vy);
            }

            puck.style.left = x + 'px';
            puck.style.top = y + 'px';
            requestAnimationFrame(frame);
            return;
        }

        const elapsed = now - homeStartTime;
        const t = Math.min(1, elapsed / homeDuration);
        const eased = easeOutStrong(t);

        x = homeStartX + (targetX - homeStartX) * eased;
        y = homeStartY + (targetY - homeStartY) * eased;
        const scale = 1 - 0.06 * eased;

        puck.style.left = x + 'px';
        puck.style.top = y + 'px';
        puck.style.transform = 'translate(-50%, -50%) scale(' + scale + ')';
        setArrowAngle(targetX - homeStartX, targetY - homeStartY);

        if (t < 1) {
            requestAnimationFrame(frame);
        } else {
            puck.style.left = targetX + 'px';
            puck.style.top = targetY + 'px';
            puck.style.transform = 'translate(-50%, -50%) scale(1)';
            zoomIceArenaField(targetXPct, winner);
        }
    }
    requestAnimationFrame(frame);
}

function zoomIceArenaField(targetXPct, winner) {
    const fieldWrap = document.getElementById('iceFieldWrap');
    const field = document.getElementById('iceField');

    if (field) {
        field.style.transformOrigin = targetXPct + '% 50%';
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

    if (round && !iceArenaHistory.some(h => String(h.id) === String(round.id))) {
        pushIceArenaHistory({
            id: String(round.id),
            gameNumber: round.game_number || null,
            ts: Date.now(),
            bank: total,
            payout,
            multiplier: winner.bet > 0 ? payout / winner.bet : 0,
            winner: {
                id: winner.id,
                name: winner.name,
                avatar: winner.avatar,
                bet: winner.bet,
                isUser: !!winner.isUser
            },
            players: iceArena.players.map(p => ({
                id: p.id,
                name: p.name,
                avatar: p.avatar,
                bet: p.bet,
                color: p.color,
                isUser: !!p.isUser
            }))
        });
    }

    if (round && round.status === 'spinning') {
        await supabase.from(ICE_ARENA_ROUNDS_TABLE)
            .update({ status: 'result', resolved_at: new Date().toISOString() })
            .eq('id', round.id)
            .eq('status', 'spinning');
        tryIceArenaPayout({ ...round, payout_done: round.payout_done, payout, winner_telegram_id: winner.telegramId });
    }
}

// ==========================================
// ИСТОРИЯ РАУНДОВ АЙС АРЕНЫ (× победителя, реплей шайбы)
// Хранится глобально в Supabase (таблицы ice_arena_rounds / ice_arena_bets),
// а не в localStorage — поэтому видна всем игрокам и не сбрасывается
// при перезаходе или смене устройства.
// ==========================================
const ICE_ARENA_HISTORY_MAX = 30;
let iceArenaHistory = [];
let iceArenaHistoryDetailEntry = null;
let iceArenaHistoryReplaying = false;
let iceArenaHistoryLoading = null;

// Подтягивает последние завершённые раунды и ставки всех игроков из
// Supabase и собирает их в том же формате, что раньше хранился локально.
async function loadIceArenaHistory() {
    if (iceArenaHistoryLoading) return iceArenaHistoryLoading;

    iceArenaHistoryLoading = (async () => {
        try {
            const { data: rounds, error } = await supabase
                .from(ICE_ARENA_ROUNDS_TABLE)
                .select('*')
                .not('winner_telegram_id', 'is', null)
                .order('created_at', { ascending: false })
                .limit(ICE_ARENA_HISTORY_MAX);

            if (error) {
                console.error('Ice Arena history load:', error);
                return;
            }

            const roundList = rounds || [];
            if (!roundList.length) {
                iceArenaHistory = [];
                return;
            }

            const roundIds = roundList.map(r => r.id);
            const { data: bets, error: betsError } = await supabase
                .from(ICE_ARENA_BETS_TABLE)
                .select('*')
                .in('round_id', roundIds);

            if (betsError) console.error('Ice Arena history bets:', betsError);

            const betsByRound = {};
            (bets || []).forEach(b => {
                const key = String(b.round_id);
                (betsByRound[key] = betsByRound[key] || []).push(b);
            });

            const myId = myIceTelegramId();

            iceArenaHistory = roundList.map(r => {
                const roundBets = betsByRound[String(r.id)] || [];
                const players = roundBets.map((b, i) => ({
                    id: String(b.telegram_id),
                    name: b.name,
                    avatar: b.avatar,
                    bet: Number(b.amount),
                    color: b.color || ICE_ARENA_COLORS[i % ICE_ARENA_COLORS.length],
                    isUser: myId != null && Number(b.telegram_id) === Number(myId)
                }));

                const bank = r.bank != null ? Number(r.bank) : roundMoney(players.reduce((s, p) => s + p.bet, 0));
                const payout = r.payout != null ? Number(r.payout) : 0;
                const winnerFromBets = players.find(p => p.id === String(r.winner_telegram_id));
                const winnerBet = r.winner_bet != null ? Number(r.winner_bet) : (winnerFromBets ? winnerFromBets.bet : 0);

                return {
                    id: String(r.id),
                    gameNumber: r.game_number || null,
                    ts: r.resolved_at ? new Date(r.resolved_at).getTime() : new Date(r.created_at).getTime(),
                    bank,
                    payout,
                    multiplier: winnerBet > 0 ? payout / winnerBet : 0,
                    winner: {
                        id: String(r.winner_telegram_id),
                        name: r.winner_name,
                        avatar: r.winner_avatar,
                        bet: winnerBet,
                        isUser: myId != null && Number(r.winner_telegram_id) === Number(myId)
                    },
                    players
                };
            });
        } catch (e) {
            console.error('Ice Arena history load:', e);
        } finally {
            renderIceHistoryStrip();
            iceArenaHistoryLoading = null;
        }
    })();

    return iceArenaHistoryLoading;
}

// Оптимистичное локальное добавление раунда, который этот клиент только
// что досмотрел вживую — чтобы кэф появился в ленте сразу, не дожидаясь
// следующей подгрузки из Supabase (сами данные там уже сохранены сервером).
function pushIceArenaHistory(entry) {
    iceArenaHistory.unshift(entry);
    if (iceArenaHistory.length > ICE_ARENA_HISTORY_MAX) iceArenaHistory.length = ICE_ARENA_HISTORY_MAX;
    renderIceHistoryStrip();
}

function iceHistoryMultColor(mult) {
    if (mult >= 2) return '#2ecc71';
    if (mult < 1.5) return '#e74c3c';
    return '#ffd700';
}

// Лента кэфов последних раундов под игровым полем. Каждый чип кликабелен
// и сразу открывает экран реплея этого раунда (см. openIceArenaHistoryDirect),
// минуя список истории.
function renderIceHistoryStrip() {
    const strip = document.getElementById('iceHistoryStrip');
    if (!strip) return;

    if (!iceArenaHistory.length) {
        strip.innerHTML = '';
        return;
    }

    strip.innerHTML = iceArenaHistory.map(entry => {
        const color = iceHistoryMultColor(entry.multiplier);
        return '<span class="ice-history-chip" style="color:' + color + ';" onclick="openIceArenaHistoryDirect(\'' + entry.id + '\')">×' + entry.multiplier.toFixed(2) + '</span>';
    }).join('');
}

// Открывает модалку истории сразу на экране реплея конкретного раунда
// (используется чипами кэфов под полем) — список истории при этом не
// показывается, только рендерится "под капотом", чтобы кнопка "Назад"
// в детальном экране продолжала работать корректно.
function openIceArenaHistoryDirect(id) {
    renderIceArenaHistoryList();
    document.getElementById('iceHistoryModal')?.classList.remove('hidden');
    document.body.classList.add('ice-history-modal-open');
    openIceArenaHistoryDetail(id);
}

function openIceArenaHistory() {
    renderIceArenaHistoryList();
    showIceArenaHistoryList();
    document.getElementById('iceHistoryModal')?.classList.remove('hidden');
    document.body.classList.add('ice-history-modal-open');

    // Подтягиваем самую свежую глобальную историю (могли пройти раунды на
    // других устройствах/у других игроков) и перерисовываем список, если
    // модалка всё ещё открыта и пользователь не ушёл в детальный экран.
    loadIceArenaHistory().then(() => {
        const modalOpen = !document.getElementById('iceHistoryModal')?.classList.contains('hidden');
        const listVisible = !document.getElementById('iceHistoryListView')?.classList.contains('hidden');
        if (modalOpen && listVisible) renderIceArenaHistoryList();
    });
}

function closeIceArenaHistory() {
    document.getElementById('iceHistoryModal')?.classList.add('hidden');
    document.body.classList.remove('ice-history-modal-open');

    const content = document.getElementById('iceHistoryContent');
    if (content) {
        content.classList.remove('dragging');
        content.style.transform = '';
    }
    iceArenaHistoryDetailEntry = null;
    iceArenaHistoryReplaying = false;
}

function renderIceArenaHistoryList() {
    const list = document.getElementById('iceHistoryList');
    if (!list) return;

    if (!iceArenaHistory.length) {
        list.innerHTML = '<div class="ice-history-empty">Пока нет завершённых раундов</div>';
        return;
    }

    list.innerHTML = iceArenaHistory.map(entry => {
        const date = new Date(entry.ts).toLocaleString('ru-RU', { day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' });
        const color = iceHistoryMultColor(entry.multiplier);
        const chance = entry.bank > 0 ? ((entry.winner.bet / entry.bank) * 100).toFixed(0) : '0';

        // Клик по всей карточке сразу открывает экран реплея этого раунда —
        // отдельных кнопок "Честность"/"Повтор" в списке нет.
        return '<div class="ice-history-row" onclick="openIceArenaHistoryDetail(\'' + entry.id + '\')">' +
            '<div class="ice-history-row-top">' +
                '<div>' +
                    '<span class="ice-history-row-game">' + (entry.gameNumber ? 'Раунд #' + entry.gameNumber : 'Раунд') + '</span>' +
                    '<span class="ice-history-row-time">' + date + '</span>' +
                '</div>' +
                '<div class="ice-history-row-wallet"><span class="ice-history-row-wallet-icon">💳</span>' + entry.payout.toFixed(2) + '$</div>' +
            '</div>' +
            '<div class="ice-history-row-body">' +
                '<div class="ice-history-row-avatar">' + iceAvatarHtml(entry.winner.avatar) + '</div>' +
                '<div class="ice-history-row-name">' + escapeIceName(entry.winner.name) + (entry.winner.isUser ? ' (Вы)' : '') + '</div>' +
                '<div class="ice-history-row-stats">' +
                    '<div class="ice-history-row-stat"><span class="ice-history-row-stat-val">' + entry.winner.bet.toFixed(2) + '$</span><span class="ice-history-row-stat-lbl">Ставка</span></div>' +
                    '<div class="ice-history-row-stat"><span class="ice-history-row-stat-val" style="color:' + color + ';">×' + entry.multiplier.toFixed(2) + '</span><span class="ice-history-row-stat-lbl">Кэф</span></div>' +
                    '<div class="ice-history-row-stat"><span class="ice-history-row-stat-val">' + chance + '%</span><span class="ice-history-row-stat-lbl">Шанс</span></div>' +
                '</div>' +
            '</div>' +
        '</div>';
    }).join('');
}

function showIceArenaHistoryList() {
    document.getElementById('iceHistoryListView')?.classList.remove('hidden');
    document.getElementById('iceHistoryDetailView')?.classList.add('hidden');
    iceArenaHistoryDetailEntry = null;
}

function openIceArenaHistoryDetail(id) {
    const entry = iceArenaHistory.find(h => h.id === id);
    if (!entry) return;
    iceArenaHistoryDetailEntry = entry;

    document.getElementById('iceHistoryListView')?.classList.add('hidden');
    document.getElementById('iceHistoryDetailView')?.classList.remove('hidden');

    const gameEl = document.getElementById('iceHistoryDetailGame');
    if (gameEl) gameEl.textContent = entry.gameNumber ? ('#' + entry.gameNumber) : '—';

    renderIceArenaHistoryPreview(entry);

    const chance = entry.bank > 0 ? ((entry.winner.bet / entry.bank) * 100).toFixed(1) : '0.0';
    const color = iceHistoryMultColor(entry.multiplier);
    const info = document.getElementById('iceHistoryDetailInfo');
    if (info) {
        info.innerHTML =
            '<div class="ice-history-detail-row"><span>Победитель</span><strong>' + escapeIceName(entry.winner.name) + (entry.winner.isUser ? ' (Вы)' : '') + '</strong></div>' +
            '<div class="ice-history-detail-row"><span>Шанс на победу</span><strong>' + chance + '%</strong></div>' +
            '<div class="ice-history-detail-row"><span>Банк</span><strong>' + entry.bank.toFixed(2) + ' $</strong></div>' +
            '<div class="ice-history-detail-row"><span>Выигрыш</span><strong style="color:' + color + ';">+' + entry.payout.toFixed(2) + ' $ (×' + entry.multiplier.toFixed(2) + ')</strong></div>';
    }
}

function renderIceArenaHistoryPreview(entry) {
    const field = document.getElementById('iceHistoryPreviewField');
    const puck = document.getElementById('iceHistoryPuck');
    if (!field) return;

    field.querySelectorAll('.ice-band').forEach(b => b.remove());

    const total = entry.players.reduce((s, p) => s + p.bet, 0);
    let cursor = 0;
    entry.players.forEach(p => {
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

        if (puck) field.insertBefore(band, puck); else field.appendChild(band);
        cursor += widthPct;
    });

    if (puck) {
        puck.classList.add('hidden');
        puck.style.left = '';
        puck.style.top = '';
        puck.style.transform = '';
    }

    const btn = document.getElementById('iceHistoryReplayBtn');
    if (btn) btn.classList.remove('ice-replay-hidden');
}

function replayIceArenaHistoryRound() {
    const entry = iceArenaHistoryDetailEntry;
    const field = document.getElementById('iceHistoryPreviewField');
    const puck = document.getElementById('iceHistoryPuck');
    const btn = document.getElementById('iceHistoryReplayBtn');
    if (!entry || !field || !puck || iceArenaHistoryReplaying) return;

    field.querySelectorAll('.ice-band').forEach(b => b.classList.remove('ice-band-winner'));

    iceArenaHistoryReplaying = true;
    if (btn) btn.classList.add('ice-replay-hidden');
    puck.classList.remove('hidden');
    puck.style.transform = 'translate(-50%, -50%) scale(1)';

    runIceReplayPuckAnimation(field, puck, entry.players, entry.winner.id, () => {
        field.querySelectorAll('.ice-band').forEach(band => {
            if (band.dataset.playerId === entry.winner.id) band.classList.add('ice-band-winner');
        });
        if (window.tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
        setTimeout(() => {
            iceArenaHistoryReplaying = false;
            if (btn) btn.classList.remove('ice-replay-hidden');
        }, 500);
    });
}

// Упрощённая версия анимации шайбы (launchIceArenaPuck), параметризованная
// произвольным полем/шайбой/списком игроков — используется для реплея
// уже завершённого раунда из истории, не трогая живую игру.
function runIceReplayPuckAnimation(field, puck, players, winnerId, onDone) {
    const arrow = puck.querySelector('.ice-puck-arrow');

    const total = players.reduce((s, p) => s + p.bet, 0);
    let cursor = 0;
    let targetXPct = 50;
    for (const p of players) {
        const w = total > 0 ? (p.bet / total) * 100 : 0;
        if (p.id === winnerId) {
            targetXPct = cursor + w / 2;
            break;
        }
        cursor += w;
    }

    const rect = field.getBoundingClientRect();
    const fieldW = rect.width;
    const fieldH = rect.height;

    const puckRadius = (puck.offsetWidth || 20) / 2;
    const margin = puckRadius + 3;
    const arrowOffset = puckRadius + 6;
    const minX = margin, maxX = fieldW - margin;
    const minY = margin, maxY = fieldH - margin;

    let x = fieldW / 2;
    let y = fieldH / 2;
    const targetX = (targetXPct / 100) * fieldW;
    const targetY = fieldH * (0.35 + Math.random() * 0.3);

    function setArrowAngle(dirX, dirY) {
        if (!arrow) return;
        const ang = Math.atan2(dirY, dirX) * 180 / Math.PI + 90;
        arrow.style.transform = 'translate(-50%, -' + arrowOffset + 'px) rotate(' + ang + 'deg)';
    }

    let angle = Math.random() * Math.PI * 2;
    let speed = 1500 + Math.random() * 700;
    let vx = Math.cos(angle) * speed;
    let vy = Math.sin(angle) * speed;

    const bounceTarget = 2 + Math.floor(Math.random() * 2);
    let bounceCount = 0;
    setArrowAngle(vx, vy);

    let phase = 'bounce';
    let homeStartX = x, homeStartY = y, homeStartTime = 0;
    const homeDuration = 420 + Math.random() * 180;
    const launchStart = performance.now();
    let lastTime = launchStart;

    function easeOutStrong(t) { return 1 - Math.pow(1 - t, 3); }

    function frame(now) {
        const dt = Math.min(0.04, (now - lastTime) / 1000);
        lastTime = now;

        if (phase === 'bounce' && now - launchStart > 2200) {
            phase = 'home';
            homeStartX = x; homeStartY = y; homeStartTime = now;
        }

        if (phase === 'bounce') {
            x += vx * dt;
            y += vy * dt;
            let bounced = false;
            if (x < minX) { x = minX; vx = -vx; bounced = true; }
            else if (x > maxX) { x = maxX; vx = -vx; bounced = true; }
            if (y < minY) { y = minY; vy = -vy; bounced = true; }
            else if (y > maxY) { y = maxY; vy = -vy; bounced = true; }

            if (bounced) {
                bounceCount++;
                vx *= 0.85; vy *= 0.85;
                puck.classList.remove('ice-puck-shake');
                void puck.offsetWidth;
                puck.classList.add('ice-puck-shake');
                setArrowAngle(vx, vy);
                if (bounceCount >= bounceTarget) {
                    phase = 'home';
                    homeStartX = x; homeStartY = y; homeStartTime = now;
                }
            } else {
                setArrowAngle(vx, vy);
            }

            puck.style.left = x + 'px';
            puck.style.top = y + 'px';
            requestAnimationFrame(frame);
            return;
        }

        const elapsed = now - homeStartTime;
        const t = Math.min(1, elapsed / homeDuration);
        const eased = easeOutStrong(t);
        x = homeStartX + (targetX - homeStartX) * eased;
        y = homeStartY + (targetY - homeStartY) * eased;
        const scale = 1 - 0.06 * eased;

        puck.style.left = x + 'px';
        puck.style.top = y + 'px';
        puck.style.transform = 'translate(-50%, -50%) scale(' + scale + ')';
        setArrowAngle(targetX - homeStartX, targetY - homeStartY);

        if (t < 1) {
            requestAnimationFrame(frame);
        } else {
            puck.style.left = targetX + 'px';
            puck.style.top = targetY + 'px';
            puck.style.transform = 'translate(-50%, -50%) scale(1)';
            onDone();
        }
    }
    requestAnimationFrame(frame);
}

// Перетягивание вниз для закрытия истории Айс Арены (как в доке честности)
(function initIceHistoryDrag() {
    const handle = document.getElementById('iceHistoryDragHandle');
    const content = document.getElementById('iceHistoryContent');
    if (!handle || !content) return;

    const CLOSE_THRESHOLD = 80;
    let startY = 0, currentY = 0, dragging = false, moved = false;

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
        currentY = Math.max(0, delta);
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
            closeIceArenaHistory();
        } else {
            content.style.transform = '';
        }
        currentY = 0;
    }

    handle.addEventListener('touchstart', onPointerDown, { passive: true });
    handle.addEventListener('mousedown', onPointerDown);
    handle.addEventListener('click', () => {
        if (!moved) closeIceArenaHistory();
    });
})();

loadIceArenaHistory();

window.openIceArena = openIceArena;
window.leaveIceArena = leaveIceArena;
window.placeIceArenaBet = placeIceArenaBet;
window.restartIceArena = restartIceArena;
window.openIceArenaHistory = openIceArenaHistory;
window.closeIceArenaHistory = closeIceArenaHistory;
window.openIceArenaHistoryDetail = openIceArenaHistoryDetail;
window.openIceArenaHistoryDirect = openIceArenaHistoryDirect;
window.showIceArenaHistoryList = showIceArenaHistoryList;
window.replayIceArenaHistoryRound = replayIceArenaHistoryRound;


window.applyBetFactor = applyBetFactor;
window.applyBetMax = applyBetMax;

})();


/* =========================
   СТИКЕРЫ ВМЕСТО ЭМОДЗИ В БЫСТРЫХ ДЕЙСТВИЯХ (Пополнить, Вывод, VIP, Задания)
   Положи по ОДНОМУ файлу в animations/stickers/: deposit, withdraw, vip, tasks + <расширение>:
   .tgs (рекомендуется, весит ~20 КБ), .json (Lottie), .webp или .gif.
   Пока файл грузится — спиннер; если файла нет, иконка остаётся пустой.
========================= */
(function () {
    const STICKER_DIR = 'animations/stickers/';
    const STICKER_EXTS = ['tgs', 'json', 'webp', 'gif'];   // порядок поиска

    // .tgs — это gzip-архив с Lottie-JSON. Распаковываем встроенным API, а если его нет — через pako.
    async function readLottieJson(buf) {
        const bytes = new Uint8Array(buf);
        const isGzip = bytes[0] === 0x1f && bytes[1] === 0x8b;
        if (!isGzip) return JSON.parse(new TextDecoder().decode(bytes));
        if (typeof DecompressionStream !== 'undefined') {
            const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
            return JSON.parse(await new Response(stream).text());
        }
        if (window.pako) return JSON.parse(window.pako.ungzip(bytes, { to: 'string' }));
        throw new Error('no gzip support');
    }

    function tryImage(url) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.draggable = false;
            img.alt = '';
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = url;
        });
    }

    // Анимации играют только пока видны на экране (и вкладка активна).
    // Раньше все 8 SVG-стикеров крутились всегда, даже на скрытых страницах.
    const stickerRecs = new Map();
    function syncSticker(rec) {
        if (rec.visible && !document.hidden) rec.anim.play(); else rec.anim.pause();
    }
    const stickerIO = ('IntersectionObserver' in window)
        ? new IntersectionObserver(entries => {
            entries.forEach(e => {
                const rec = stickerRecs.get(e.target);
                if (rec) { rec.visible = e.isIntersecting; syncSticker(rec); }
            });
        }, { threshold: 0.01 })
        : null;
    document.addEventListener('visibilitychange', () => stickerRecs.forEach(syncSticker));
    function trackSticker(box, anim) {
        if (anim.setSubframe) anim.setSubframe(false);      // только целые кадры
        const rec = { anim, visible: !stickerIO };
        stickerRecs.set(box, rec);
        if (stickerIO) stickerIO.observe(box); else syncSticker(rec);
    }

    async function buildStickerNode(base, ext) {
        const url = base + '.' + ext;
        if (ext === 'tgs' || ext === 'json') {
            if (typeof lottie === 'undefined') throw new Error('no lottie');
            const res = await fetch(url);
            if (!res.ok) throw new Error('not found');
            const data = await readLottieJson(await res.arrayBuffer());
            const box = document.createElement('div');
            box.className = 'sticker-lottie';
            const anim = lottie.loadAnimation({
                container: box,
                renderer: 'svg',
                loop: true,
                autoplay: false,
                animationData: data,
                rendererSettings: { progressiveLoad: true, hideOnTransparent: true, preserveAspectRatio: 'xMidYMid meet' }
            });
            trackSticker(box, anim);
            return box;
        }
        return tryImage(url);
    }

    async function loadStickerInto(el, base) {
        if (!el) return;
        for (const ext of STICKER_EXTS) {
            try {
                const node = await buildStickerNode(base, ext);
                el.textContent = '';
                el.appendChild(node);
                el.classList.add('has-sticker');
                return;
            } catch (e) { /* пробуем следующий формат */ }
        }
        // ни один файл не подошёл — убираем спиннер, эмодзи не показываем
        el.textContent = '';
    }

    // id иконки в index.html -> имя файла в animations/stickers/ (без расширения)
    const QUICK_ACTION_STICKERS = {
        depositSticker:  'deposit',
        withdrawSticker: 'withdraw',
        vipSticker:      'vip',
        tasksSticker:    'tasks'
    };
    function initQuickActionStickers() {
        Object.entries(QUICK_ACTION_STICKERS).forEach(([id, name]) => {
            loadStickerInto(document.getElementById(id), STICKER_DIR + name);
        });
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initQuickActionStickers);
    } else {
        initQuickActionStickers();
    }

    // ---- Стикеры в карточках статистики профиля ----
    // Файлы: animations/stickers/turnover.tgs, koef.tgs, wins.tgs, bets.tgs
    const STAT_STICKERS = {
        statStickerTurnover: 'turnover',
        statStickerKoef:     'koef',
        statStickerWins:     'wins',
        statStickerBets:     'bets'
    };
    function initStatStickers() {
        Object.entries(STAT_STICKERS).forEach(([id, name]) => {
            loadStickerInto(document.getElementById(id), STICKER_DIR + name);
        });
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initStatStickers);
    } else {
        initStatStickers();
    }
})();


/* =========================
   СТАБИЛЬНЫЕ 60 FPS ДЛЯ TELEGRAM EMOJI И ИГР (КУБ, ФУТБОЛ)
   • Честные 60 кадров/с (16.67 мс) без искусственного урезания до 24/30 к/с.
   • Быстрый Canvas-рендерер с аппаратным ускорением и предпрогревом кадров:
     в отличие от тяжёлого DOM/SVG-рендерера, он не пересчитывает сотни SVG-узлов
     и масок на каждом кадре, поэтому анимации идут идеально плавно в 60 FPS.
   • Строгая изоляция активной страницы: когда открыт список баннеров — работают
     только баннеры; когда открыта игра («Куб» или «Футбол») — баннеры мгновенно
     встают на паузу и отдают 100% ресурсов текущей игре.
   • Предварительное кэширование всех граней кубика и ударов футбола в памяти
     при входе в игру — при нажатии «Играть» бросок стартует мгновенно без лагов.
========================= */
window.WXS_ANIM_FRAME_MS = 1000 / 60;

(function () {
    const DIRS = ['animations/dice/banners/', 'animations/dice/banner/'];
    const IMG_EXTS = ['webp', 'gif', 'png'];
    const BANNER_DPR = Math.min(window.devicePixelRatio || 1, 1.5);
    const STAGE_DPR = Math.min(window.devicePixelRatio || 1, 1.75);
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const nextFrame = () => new Promise(r => requestAnimationFrame(r));

    async function readLottieJson(buf) {
        const bytes = new Uint8Array(buf);
        const isGzip = bytes[0] === 0x1f && bytes[1] === 0x8b;
        if (!isGzip) return JSON.parse(new TextDecoder().decode(bytes));
        if (typeof DecompressionStream !== 'undefined') {
            const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
            return JSON.parse(await new Response(stream).text());
        }
        if (window.pako) return JSON.parse(window.pako.ungzip(bytes, { to: 'string' }));
        throw new Error('no gzip support');
    }

    // Глубокое клонирование JSON для Lottie (чтобы мутации lottie-web не портили кэш)
    function cloneAnimData(data) {
        if (!data) return null;
        if (typeof structuredClone === 'function') {
            try { return structuredClone(data); } catch (e) {}
        }
        return JSON.parse(JSON.stringify(data));
    }

    /* ---------- общий кэш .tgs ---------- */
    const cache = new Map();   // base (без расширения) -> Promise<json|null>
    function loadTgs(base) {
        if (cache.has(base)) return cache.get(base);
        const p = (async () => {
            for (const ext of ['tgs', 'json']) {
                try {
                    const res = await fetch(base + '.' + ext);
                    if (!res.ok) continue;
                    return await readLottieJson(await res.arrayBuffer());
                } catch (e) { /* следующий формат */ }
            }
            return null;
        })();
        cache.set(base, p);
        return p;
    }
    window.TgsCache = {
        load: async (base) => {
            const d = await loadTgs(base);
            return d ? cloneAnimData(d) : null;
        },
        peekRaw: loadTgs
    };

    async function loadFirst(bases) {
        for (const b of bases) {
            const d = await loadTgs(b);
            if (d) return cloneAnimData(d);
        }
        return null;
    }

    /* ---------- предзагрузка в фоне без блокировки UI ---------- */
    const idle = window.requestIdleCallback || (cb => setTimeout(cb, 16));
    const idleWait = () => new Promise(r => idle(() => r()));

    let preloadPromise = null;
    window.preloadTgEmoji = function () {
        if (preloadPromise) return preloadPromise;
        preloadPromise = (async () => {
            const els = document.querySelectorAll('.tge-banner[data-banner]');
            for (const el of els) {
                await idleWait();
                for (const d of DIRS) {
                    if (await loadTgs(d + el.dataset.banner)) break;
                }
            }
        })();
        return preloadPromise;
    };

    function schedulePreload() {
        setTimeout(() => {
            window.preloadTgEmoji()
                .then(() => wait(200))
                .then(() => { if (window.preloadDice) return window.preloadDice(); })
                .then(() => wait(200))
                .then(() => { if (window.preloadFootball) return window.preloadFootball(); });
        }, 1200);
    }
    if (document.readyState === 'complete') schedulePreload();
    else window.addEventListener('load', schedulePreload, { once: true });

    /* ---------- проигрыватели баннеров (60 FPS, активны только на tgEmojiPage) ---------- */
    let started = false;
    let pageActive = false;
    const players = new Map();   // элемент баннера -> { anim, frame, last, total, fr, visible }
    let rafId = 0;
    let lastTick = 0;

    function isTgEmojiPageVisible() {
        const pg = document.getElementById('tgEmojiPage');
        return !!(pg && !pg.classList.contains('hidden')) && !document.hidden;
    }

    function tick(now) {
        rafId = 0;
        if (!pageActive || !isTgEmojiPageVisible()) return;
        let any = false;
        players.forEach(p => { if (p.visible) any = true; });
        if (!any) return;
        rafId = requestAnimationFrame(tick);

        const dt = lastTick ? Math.min((now - lastTick) / 1000, 0.05) : (1 / 60);
        lastTick = now;
        players.forEach(p => {
            if (!p.visible) return;
            p.frame += dt * p.fr;
            if (p.frame >= p.total) p.frame %= p.total;
            const fi = Math.floor(p.frame);
            if (fi === p.last) return;
            p.last = fi;
            p.anim.goToAndStop(fi, true);
        });
    }

    function ensureLoop() {
        if (!rafId && pageActive && isTgEmojiPageVisible()) {
            lastTick = 0;
            rafId = requestAnimationFrame(tick);
        }
    }

    function stopLoop() {
        if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = 0;
        }
        lastTick = 0;
    }

    const observer = ('IntersectionObserver' in window)
        ? new IntersectionObserver(entries => {
            entries.forEach(e => { const p = players.get(e.target); if (p) p.visible = e.isIntersecting; });
            ensureLoop();
        }, { rootMargin: '20px 0px', threshold: 0.15 })
        : null;

    function tryImage(url) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.draggable = false;
            img.alt = '';
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = url;
        });
    }

    function mountAnim(el, name, data) {
        const box = document.createElement('div');
        box.className = 'sticker-lottie';
        el.textContent = '';
        el.appendChild(box);
        const anim = lottie.loadAnimation({
            container: box,
            renderer: 'canvas',
            loop: false,
            autoplay: false,
            animationData: data,
            rendererSettings: {
                clearCanvas: true,
                dpr: BANNER_DPR,
                progressiveLoad: false,
                preserveAspectRatio: 'xMidYMid meet'
            }
        });
        if (anim.setSubframe) anim.setSubframe(false);
        anim.goToAndStop(0, true);
        players.set(el, {
            anim,
            frame: 0,
            last: 0,
            total: Math.max(1, anim.totalFrames || 1),
            fr: anim.frameRate || 60,
            visible: !observer || isTgEmojiPageVisible()
        });
        if (observer) observer.observe(el);
        el.classList.add('has-anim');
        ensureLoop();
    }

    async function loadInto(el, name) {
        const data = (typeof lottie !== 'undefined') ? await loadFirst(DIRS.map(d => d + name)) : null;
        if (data) { mountAnim(el, name, data); return; }

        for (const dir of DIRS) {
            for (const ext of IMG_EXTS) {
                try {
                    const img = await tryImage(dir + name + '.' + ext);
                    el.textContent = '';
                    el.appendChild(img);
                    el.classList.add('has-anim');
                    return;
                } catch (e) { /* дальше */ }
            }
        }
        console.warn('[Telegram Emoji] анимация не найдена для режима:', name);
        el.textContent = '';
    }

    window.initTgEmojiBanners = async function () {
        pageActive = true;
        if (started) {
            players.forEach(p => {
                if (p.anim && typeof p.anim.resize === 'function') p.anim.resize();
            });
            ensureLoop();
            return;
        }
        started = true;
        const els = Array.from(document.querySelectorAll('.tge-banner[data-banner]'));
        // Загружаем данные параллельно из кэша/сети, а монтируем по одному в кадр (60 FPS без фриза)
        const loaded = await Promise.all(els.map(el => loadFirst(DIRS.map(d => d + el.dataset.banner))));
        for (let i = 0; i < els.length; i++) {
            const el = els[i];
            const data = loaded[i];
            if (data && typeof lottie !== 'undefined') {
                mountAnim(el, el.dataset.banner, data);
            } else {
                await loadInto(el, el.dataset.banner);
            }
            await nextFrame();
        }
        // После того как баннеры отрисованы — тихо подгружаем Куб и Футбол в фоне
        idle(() => {
            if (window.preloadDice) window.preloadDice();
            if (window.preloadFootball) window.preloadFootball();
        });
    };

    window.setTgEmojiBannersActive = function (active) {
        pageActive = !!active;
        if (pageActive) ensureLoop();
        else stopLoop();
    };

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) stopLoop();
        else ensureLoop();
    });

    window.WXS_STAGE_DPR = STAGE_DPR;
})();


/* =========================
   КУБ — сцена 60 FPS: превью → выпавший кубик → результат
   • Используется быстрый Canvas-рендерер (или лёгкий SVG без тяжёлых пересчётов)
     с полными 60 кадрами в секунду и предзаготовленным пулом анимаций граней 1..6.
   • Все 6 граней создаются и прогреваются заранее, поэтому в момент нажатия
     «Играть» ничего не парсится и не создаётся — анимация стартует мгновенно в 60 FPS.
========================= */
(function () {
    const PREVIEW_SRC = 'animations/dice/preview/cube';
    const ROLL_DIR = 'animations/dice/';   // cube1 … cube6
    const ROLL_MS = 4000;                  // общее время броска: анимация + удержание последнего кадра
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const nextFrame = () => new Promise(r => requestAnimationFrame(r));
    const $ = id => document.getElementById(id);
    const reflow = el => void el.offsetWidth;
    const loadRaw = base => (window.TgsCache && typeof lottie !== 'undefined')
        ? window.TgsCache.peekRaw(base) : Promise.resolve(null);
    const loadClone = base => (window.TgsCache && typeof lottie !== 'undefined')
        ? window.TgsCache.load(base) : Promise.resolve(null);

    function createAnim(box, data) {
        const anim = lottie.loadAnimation({
            container: box,
            renderer: 'svg',
            loop: false,
            autoplay: false,
            animationData: data,
            rendererSettings: {
                preserveAspectRatio: 'xMidYMid meet',
                progressiveLoad: false,
                hideOnTransparent: true
            }
        });
        if (anim.setSubframe) anim.setSubframe(false);
        return anim;
    }

    /* ---------- предзагрузка файлов ---------- */
    let preloadPromise = null;
    window.preloadDice = function () {
        if (preloadPromise) return preloadPromise;
        preloadPromise = (async () => {
            await loadRaw(PREVIEW_SRC);
            for (let n = 1; n <= 6; n++) {
                await loadRaw(ROLL_DIR + 'cube' + n);
                await wait(25);
            }
        })();
        return preloadPromise;
    };

    /* ---------- превью (крутится в 60 FPS, только когда страница Куба открыта) ---------- */
    let preview = null;      // { anim, frame, last, total, fr, visible, paused }
    let pageActive = false;
    let rafId = 0, lastTick = 0, previewStarted = false;

    function isDicePageVisible() {
        const pg = $('diceGamePage');
        return !!(pg && !pg.classList.contains('hidden')) && !document.hidden;
    }

    function tick(now) {
        rafId = 0;
        if (!pageActive || !preview || !preview.visible || preview.paused || !isDicePageVisible()) return;
        rafId = requestAnimationFrame(tick);
        const dt = lastTick ? Math.min((now - lastTick) / 1000, 0.05) : (1 / 60);
        lastTick = now;
        preview.frame += dt * preview.fr;
        if (preview.frame >= preview.total) preview.frame %= preview.total;
        const fi = Math.floor(preview.frame);
        if (fi !== preview.last) {
            preview.last = fi;
            preview.anim.goToAndStop(fi, true);
            if (pairActive && previewB) previewB.goToAndStop(fi, true);
        }
    }
    function ensureLoop() {
        if (!rafId && pageActive && preview && preview.visible && !preview.paused && isDicePageVisible()) {
            lastTick = 0;
            rafId = requestAnimationFrame(tick);
        }
    }
    function setPreviewPaused(v) {
        if (preview) {
            preview.paused = v;
            if (v && rafId) { cancelAnimationFrame(rafId); rafId = 0; }
            else ensureLoop();
        }
    }

    /* ---------- два куба: раздвоение превью ---------- */
    let cells = null;          // { a, b } — ячейки внутри превью
    let previewData = null;
    let previewB = null;       // второй экземпляр анимации
    let pairActive = false;    // обновлять ли второй кубик
    let mergeTimer = 0;

    function buildPair(el, emoji) {
        el.textContent = '';
        const pair = document.createElement('div');
        pair.className = 'dice-pair' + (emoji ? ' is-fallback' : '');
        const a = document.createElement('div'); a.className = 'dice-cell a';
        const b = document.createElement('div'); b.className = 'dice-cell b';
        if (emoji) { a.textContent = '🎲'; b.textContent = '🎲'; }
        pair.appendChild(a); pair.appendChild(b);
        el.appendChild(pair);
        return { a, b };
    }

    function ensurePreviewB() {
        if (previewB || !previewData || !cells) return;
        const box = document.createElement('div');
        box.className = 'sticker-lottie';
        cells.b.appendChild(box);
        previewB = createAnim(box, window.TgsCache ? JSON.parse(JSON.stringify(previewData)) : previewData);
        previewB.goToAndStop(preview ? Math.max(preview.last, 0) : 0, true);
    }

    function setCubes(n) {
        const el = $('dicePreview');
        if (!el) return;
        clearTimeout(mergeTimer);
        if (n === 2) {
            pairActive = true;
            ensurePreviewB();
            if (previewB && preview) previewB.goToAndStop(Math.max(preview.last, 0), true);
            el.classList.add('pair');
        } else {
            el.classList.remove('pair');
            mergeTimer = setTimeout(() => { pairActive = false; }, 900);
        }
    }

    /* ---------- пул готовых анимаций граней 1..6 (мгновенный старт без пересборки DOM) ---------- */
    const rollPool = new Map(); // roll (1..6) -> Promise<{ box, anim }>
    function getPooledRoll(roll) {
        if (rollPool.has(roll)) return rollPool.get(roll);
        const p = (async () => {
            const data = await loadClone(ROLL_DIR + 'cube' + roll);
            if (!data) return { box: null, anim: null };
            const box = document.createElement('div');
            box.className = 'sticker-lottie';
            const anim = createAnim(box, data);
            anim.goToAndStop(0, true);
            return { box, anim };
        })();
        rollPool.set(roll, p);
        return p;
    }

    async function warmUpDicePool() {
        for (let n = 1; n <= 6; n++) {
            if (!pageActive) break;
            await getPooledRoll(n);
            await nextFrame();
        }
    }

    window.initDicePreview = async function () {
        pageActive = true;
        if (previewStarted) {
            ensureLoop();
            warmUpDicePool();
            return;
        }
        previewStarted = true;
        const el = $('dicePreview');
        if (!el) return;
        const data = await loadClone(PREVIEW_SRC);
        cells = buildPair(el, !data);
        if (!data) return;

        previewData = data;
        const box = document.createElement('div');
        box.className = 'sticker-lottie';
        cells.a.appendChild(box);
        el.classList.add('has-anim');
        const anim = createAnim(box, data);
        anim.goToAndStop(0, true);
        preview = { anim, frame: 0, last: 0, total: Math.max(1, anim.totalFrames || 1), fr: anim.frameRate || 60, visible: true, paused: false };
        ensureLoop();
        setTimeout(() => {
            ensurePreviewB();
            warmUpDicePool();
        }, 120);
    };

    /* ---------- подготовка выпавшей грани ---------- */
    let prepared = null;
    function prepare(roll) {
        const rollEl = $('diceRoll');
        if (!rollEl) return null;
        if (prepared && prepared.roll === roll && !prepared.used) return prepared.ready;

        const side = Math.random() < 0.5 ? 'left' : 'right';
        rollEl.className = 'dice-layer dice-roll from-' + side;
        rollEl.innerHTML = '';

        const st = { roll, side, box: null, anim: null, used: false };
        st.ready = (async () => {
            const pooled = await getPooledRoll(roll);
            if (pooled && pooled.anim && pooled.box) {
                st.box = pooled.box;
                st.anim = pooled.anim;
                st.anim.goToAndStop(0, true);
                rollEl.appendChild(st.box);
            } else {
                const fb = document.createElement('div');
                fb.className = 'sticker-lottie';
                rollEl.appendChild(fb);
                st.box = fb;
            }
            return st;
        })();
        prepared = st;
        return st.ready;
    }

    /* ---------- 60 FPS воспроизведение броска ---------- */
    function playRoll(anim, totalMs) {
        return new Promise(resolve => {
            const fr = anim.frameRate || 60;
            const last = Math.max((anim.totalFrames || 2) - 1, 1);
            const nativeMs = last / fr * 1000;
            let prevTarget = -1;
            const t0 = performance.now();
            (function step(now) {
                const target = Math.min(Math.floor((now - t0) / 1000 * fr), last);
                if (target !== prevTarget) {
                    anim.goToAndStop(target, true);
                    prevTarget = target;
                }
                if (target < last) {
                    requestAnimationFrame(step);
                } else {
                    setTimeout(resolve, Math.max(0, totalMs - nativeMs));
                }
            })(t0);
        });
    }

    async function fallbackRoll(box, roll, ms) {
        box.className = 'dice-fallback';
        box.innerHTML = '<span class="tge-spinner big"></span>';
        await wait(ms * 0.75);
        box.textContent = '⚀⚁⚂⚃⚄⚅'[roll - 1];
        await wait(ms * 0.25);
    }

    function sparkles() {
        const stars = [[26, 60, 0.36], [176, 124, 0.44], [70, 170, 0.50]];
        const dots = [[58, 32, 0.40], [164, 70, 0.48], [30, 130, 0.54], [130, 176, 0.42]];
        const star = 'M0-10 L2.6-2.6 L10 0 L2.6 2.6 L0 10 L-2.6 2.6 L-10 0 L-2.6-2.6Z';
        return stars.map(([x, y, d]) =>
                '<g transform="translate(' + x + ' ' + y + ')"><path class="dr-spark" style="--d:' + d + 's" d="' + star + '"/></g>').join('') +
            dots.map(([x, y, d]) =>
                '<circle class="dr-dot" style="--d:' + d + 's" cx="' + x + '" cy="' + y + '" r="4.6"/>').join('');
    }

    function resultHtml(win, amountText, title) {
        const mark = win
            ? '<path class="dr-mark" pathLength="1" d="M76 102 L94 120 L126 83"/>'
            : '<path class="dr-mark" pathLength="1" d="M81 81 L119 119"/>' +
              '<path class="dr-mark dr-second" pathLength="1" d="M119 81 L81 119"/>';
        return '' +
            '<svg class="dr-icon" viewBox="0 0 200 200" aria-hidden="true">' +
                '<circle class="dr-ring" cx="100" cy="100" r="54"/>' +
                '<circle class="dr-disc" cx="100" cy="100" r="44"/>' +
                mark + sparkles() +
            '</svg>' +
            '<div class="dice-result-title">' + (title || (win ? 'Ставка сыграла' : 'Ставка не сыграла')) + '</div>' +
            '<div class="dice-result-amount' + (amountText ? '' : ' is-empty') + '">' + (amountText || '+0.00$') + '</div>';
    }

    function hideResult(slideUp) {
        const res = $('diceResult');
        if (!res || !res.classList.contains('show')) return;
        res.classList.remove('show');
        if (slideUp) res.classList.add('hide-up');
        setTimeout(() => { if (!res.classList.contains('show')) res.innerHTML = ''; }, 650);
    }

    function showPreview() {
        const prev = $('dicePreview');
        if (!prev || !prev.classList.contains('out')) {
            setPreviewPaused(false);
            return;
        }
        prev.style.transition = 'none';
        prev.classList.remove('out');
        prev.style.opacity = '0';
        prev.style.transform = 'translateY(40px) scale(0.94)';
        reflow(prev);
        prev.style.transition = '';
        prev.style.opacity = '';
        prev.style.transform = '';
        setPreviewPaused(false);
    }

    function reset() {
        hideResult(false);
        showPreview();
    }

    async function play({ roll, win, amountText, title, nextRoll }) {
        const prev = $('dicePreview'), rollEl = $('diceRoll'), res = $('diceResult');
        if (!prev || !rollEl || !res) return;

        const st = await ((prepared && prepared.roll === roll && !prepared.used) ? prepared.ready : prepare(roll));
        prepared.used = true;
        const { box, anim } = st;

        // 1) превью (или прошлый результат) плавно уплывает вверх, затем заезжает новый кубик
        const hadResult = res.classList.contains('show');
        hideResult(true);
        setPreviewPaused(true);
        prev.classList.add('out');
        if (hadResult) await wait(160);
        else await nextFrame();
        rollEl.classList.add('in');

        // 2) играет в полные 60 FPS и замирает на последнем кадре
        if (anim) await playRoll(anim, ROLL_MS);
        else await fallbackRoll(box, roll, ROLL_MS);
        await wait(350);

        // 3) кубик плавно уходит, появляется галочка / крестик
        rollEl.classList.add('away');
        res.style.transition = 'none';
        res.classList.remove('show', 'hide-up');
        res.innerHTML = resultHtml(win, amountText, title);
        res.classList.toggle('win', win);
        res.classList.toggle('lose', !win);
        reflow(res);
        res.style.transition = '';
        res.classList.add('show');

        // Даём анимации галочки/крестика, искр и текста («Ставка зашла (1/2)»)
        // полностью доиграть и зафиксироваться на экране перед вылетом второго куба
        await wait(1150);
        if (box && box.parentNode === rollEl) rollEl.removeChild(box);
        rollEl.className = 'dice-layer dice-roll';
        prepared = null;
        if (nextRoll) {
            await prepare(nextRoll);
            await wait(350);
            return;
        }
        await wait(300);
    }

    function setPageActive(active) {
        pageActive = !!active;
        if (pageActive) ensureLoop();
        else if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    }

    document.addEventListener('visibilitychange', () => {
        if (document.hidden && rafId) { cancelAnimationFrame(rafId); rafId = 0; }
        else ensureLoop();
    });

    window.DiceStage = { play, reset, prepare, setCubes, setPageActive };
})();

/* ==========================================
   ФУТБОЛ — сцена 60 FPS: превью → удар → результат
   • Полные 60 кадров/с без пропуска кадров.
   • Все 5 анимаций ударов (football1 … football5) предзаготавливаются в пуле,
     чтобы удар запускался мгновенно и шёл без единого фриза.
========================================== */
(function () {
    const PREVIEW_SRC = 'animations/dice/banners/football';
    const ROLL_DIR = 'animations/dice/';     // football1 … football5
    const ROLL_MS = 4000;
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const nextFrame = () => new Promise(r => requestAnimationFrame(r));
    const $ = id => document.getElementById(id);
    const reflow = el => void el.offsetWidth;
    const loadRaw = base => (window.TgsCache && typeof lottie !== 'undefined')
        ? window.TgsCache.peekRaw(base) : Promise.resolve(null);
    const loadClone = base => (window.TgsCache && typeof lottie !== 'undefined')
        ? window.TgsCache.load(base) : Promise.resolve(null);

    function createAnim(box, data) {
        const anim = lottie.loadAnimation({
            container: box,
            renderer: 'svg',
            loop: false,
            autoplay: false,
            animationData: data,
            rendererSettings: {
                preserveAspectRatio: 'xMidYMid meet',
                progressiveLoad: false,
                hideOnTransparent: true
            }
        });
        if (anim.setSubframe) anim.setSubframe(false);
        return anim;
    }

    /* ---------- предзагрузка файлов ---------- */
    let preloadPromise = null;
    window.preloadFootball = function () {
        if (preloadPromise) return preloadPromise;
        preloadPromise = (async () => {
            await loadRaw(PREVIEW_SRC);
            for (let n = 1; n <= 5; n++) {
                await loadRaw(ROLL_DIR + 'football' + n);
                await wait(25);
            }
        })();
        return preloadPromise;
    };

    /* ---------- превью (60 FPS) ---------- */
    let preview = null;
    let pageActive = false;
    let rafId = 0, lastTick = 0, previewStarted = false;

    function isFootballPageVisible() {
        const pg = $('footballGamePage');
        return !!(pg && !pg.classList.contains('hidden')) && !document.hidden;
    }

    function tick(now) {
        rafId = 0;
        if (!pageActive || !preview || !preview.visible || preview.paused || !isFootballPageVisible()) return;
        rafId = requestAnimationFrame(tick);
        const dt = lastTick ? Math.min((now - lastTick) / 1000, 0.05) : (1 / 60);
        lastTick = now;
        preview.frame += dt * preview.fr;
        if (preview.frame >= preview.total) preview.frame %= preview.total;
        const fi = Math.floor(preview.frame);
        if (fi !== preview.last) {
            preview.last = fi;
            preview.anim.goToAndStop(fi, true);
        }
    }
    function ensureLoop() {
        if (!rafId && pageActive && preview && preview.visible && !preview.paused && isFootballPageVisible()) {
            lastTick = 0;
            rafId = requestAnimationFrame(tick);
        }
    }
    function setPreviewPaused(v) {
        if (preview) {
            preview.paused = v;
            if (v && rafId) { cancelAnimationFrame(rafId); rafId = 0; }
            else ensureLoop();
        }
    }

    /* ---------- пул анимаций ударов 1..5 ---------- */
    const rollPool = new Map();
    function getPooledRoll(roll) {
        if (rollPool.has(roll)) return rollPool.get(roll);
        const p = (async () => {
            const data = await loadClone(ROLL_DIR + 'football' + roll);
            if (!data) return { box: null, anim: null };
            const box = document.createElement('div');
            box.className = 'sticker-lottie';
            const anim = createAnim(box, data);
            anim.goToAndStop(0, true);
            return { box, anim };
        })();
        rollPool.set(roll, p);
        return p;
    }

    async function warmUpFootballPool() {
        for (let n = 1; n <= 5; n++) {
            if (!pageActive) break;
            await getPooledRoll(n);
            await nextFrame();
        }
    }

    window.initFootballPreview = async function () {
        pageActive = true;
        if (previewStarted) {
            ensureLoop();
            warmUpFootballPool();
            return;
        }
        previewStarted = true;
        const el = $('footballPreview');
        if (!el) return;
        const data = await loadClone(PREVIEW_SRC);
        if (!data) {
            el.innerHTML = '<span class="dice-fallback">⚽</span>';
            el.classList.add('is-fallback');
            return;
        }
        const box = document.createElement('div');
        box.className = 'sticker-lottie';
        el.textContent = '';
        el.appendChild(box);
        el.classList.add('has-anim');
        const anim = createAnim(box, data);
        anim.goToAndStop(0, true);
        preview = { anim, frame: 0, last: 0, total: Math.max(1, anim.totalFrames || 1), fr: anim.frameRate || 60, visible: true, paused: false };
        ensureLoop();
        setTimeout(warmUpFootballPool, 120);
    };

    /* ---------- подготовка анимации удара ---------- */
    let prepared = null;
    function prepare(roll) {
        const rollEl = $('footballRoll');
        if (!rollEl) return null;
        if (prepared && prepared.roll === roll && !prepared.used) return prepared.ready;

        const side = Math.random() < 0.5 ? 'left' : 'right';
        rollEl.className = 'dice-layer dice-roll from-' + side;
        rollEl.innerHTML = '';

        const st = { roll, side, box: null, anim: null, used: false };
        st.ready = (async () => {
            const pooled = await getPooledRoll(roll);
            if (pooled && pooled.anim && pooled.box) {
                st.box = pooled.box;
                st.anim = pooled.anim;
                st.anim.goToAndStop(0, true);
                rollEl.appendChild(st.box);
            } else {
                const fb = document.createElement('div');
                fb.className = 'sticker-lottie';
                rollEl.appendChild(fb);
                st.box = fb;
            }
            return st;
        })();
        prepared = st;
        return st.ready;
    }

    /* ---------- удар: честные 60 FPS ---------- */
    function playRoll(anim, totalMs) {
        return new Promise(resolve => {
            const fr = anim.frameRate || 60;
            const last = Math.max((anim.totalFrames || 2) - 1, 1);
            const nativeMs = last / fr * 1000;
            let prevTarget = -1;
            const t0 = performance.now();
            (function step(now) {
                const target = Math.min(Math.floor((now - t0) / 1000 * fr), last);
                if (target !== prevTarget) {
                    anim.goToAndStop(target, true);
                    prevTarget = target;
                }
                if (target < last) requestAnimationFrame(step);
                else setTimeout(resolve, Math.max(0, totalMs - nativeMs));
            })(t0);
        });
    }

    async function fallbackRoll(box, roll, ms) {
        box.className = 'dice-fallback';
        box.innerHTML = '<span class="tge-spinner big"></span>';
        await wait(ms * 0.75);
        box.textContent = '';
        await wait(ms * 0.25);
    }

    function sparkles() {
        const stars = [[26, 60, 0.36], [176, 124, 0.44], [70, 170, 0.50]];
        const dots = [[58, 32, 0.40], [164, 70, 0.48], [30, 130, 0.54], [130, 176, 0.42]];
        const star = 'M0-10 L2.6-2.6 L10 0 L2.6 2.6 L0 10 L-2.6 2.6 L-10 0 L-2.6-2.6Z';
        return stars.map(([x, y, d]) =>
                '<g transform="translate(' + x + ' ' + y + ')"><path class="dr-spark" style="--d:' + d + 's" d="' + star + '"/></g>').join('') +
            dots.map(([x, y, d]) =>
                '<circle class="dr-dot" style="--d:' + d + 's" cx="' + x + '" cy="' + y + '" r="4.6"/>').join('');
    }

    function resultHtml(win, amountText, title) {
        const mark = win
            ? '<path class="dr-mark" pathLength="1" d="M76 102 L94 120 L126 83"/>'
            : '<path class="dr-mark" pathLength="1" d="M81 81 L119 119"/>' +
              '<path class="dr-mark dr-second" pathLength="1" d="M119 81 L81 119"/>';
        return '' +
            '<svg class="dr-icon" viewBox="0 0 200 200" aria-hidden="true">' +
                '<circle class="dr-ring" cx="100" cy="100" r="54"/>' +
                '<circle class="dr-disc" cx="100" cy="100" r="44"/>' +
                mark + sparkles() +
            '</svg>' +
            '<div class="dice-result-title">' + (title || (win ? 'Ставка сыграла' : 'Ставка не сыграла')) + '</div>' +
            '<div class="dice-result-amount' + (amountText ? '' : ' is-empty') + '">' + (amountText || '+0.00$') + '</div>';
    }

    function hideResult(slideUp) {
        const res = $('footballResult');
        if (!res || !res.classList.contains('show')) return;
        res.classList.remove('show');
        if (slideUp) res.classList.add('hide-up');
        setTimeout(() => { if (!res.classList.contains('show')) res.innerHTML = ''; }, 650);
    }

    function showPreview() {
        const prev = $('footballPreview');
        if (!prev || !prev.classList.contains('out')) {
            setPreviewPaused(false);
            return;
        }
        prev.style.transition = 'none';
        prev.classList.remove('out');
        prev.style.opacity = '0';
        prev.style.transform = 'translateY(40px) scale(0.94)';
        reflow(prev);
        prev.style.transition = '';
        prev.style.opacity = '';
        prev.style.transform = '';
        setPreviewPaused(false);
    }

    function reset() {
        hideResult(false);
        showPreview();
    }

    async function play({ roll, win, amountText, title }) {
        const prev = $('footballPreview'), rollEl = $('footballRoll'), res = $('footballResult');
        if (!prev || !rollEl || !res) return;

        const st = await ((prepared && prepared.roll === roll && !prepared.used) ? prepared.ready : prepare(roll));
        prepared.used = true;
        const { box, anim } = st;

        // 1) превью уплывает вверх, заезжает удар
        hideResult(true);
        setPreviewPaused(true);
        prev.classList.add('out');
        await nextFrame();
        rollEl.classList.add('in');

        // 2) играет анимация удара в 60 FPS и замирает на последнем кадре
        if (anim) await playRoll(anim, ROLL_MS);
        else await fallbackRoll(box, roll, ROLL_MS);
        await wait(350);

        // 3) анимация уходит, появляется галочка / крестик
        rollEl.classList.add('away');
        res.style.transition = 'none';
        res.classList.remove('show', 'hide-up');
        res.innerHTML = resultHtml(win, amountText, title);
        res.classList.toggle('win', win);
        res.classList.toggle('lose', !win);
        reflow(res);
        res.style.transition = '';
        res.classList.add('show');

        await wait(600);
        if (box && box.parentNode === rollEl) rollEl.removeChild(box);
        rollEl.className = 'dice-layer dice-roll';
        prepared = null;
        await wait(250);
    }

    function setPageActive(active) {
        pageActive = !!active;
        if (pageActive) ensureLoop();
        else if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    }

    document.addEventListener('visibilitychange', () => {
        if (document.hidden && rafId) { cancelAnimationFrame(rafId); rafId = 0; }
        else ensureLoop();
    });

    window.FootballStage = { play, reset, prepare, setPageActive };
})();

/* Переключение активности анимаций при смене страниц — чтобы в играх 100% CPU/GPU шло на 60 FPS */
window.syncTgEmojiPageState = function (pageId) {
    if (typeof window.setTgEmojiBannersActive === 'function') {
        window.setTgEmojiBannersActive(pageId === 'tgEmojiPage');
    }
    if (window.DiceStage && typeof window.DiceStage.setPageActive === 'function') {
        window.DiceStage.setPageActive(pageId === 'diceGamePage');
    }
    if (window.FootballStage && typeof window.FootballStage.setPageActive === 'function') {
        window.FootballStage.setPageActive(pageId === 'footballGamePage');
    }
};


/* ==========================================
   LIQUID GLASS НИЖНЯЯ ПАНЕЛЬ: тап / зажать и тянуть
========================================== */
(function () {
    function init() {
        const nav = document.getElementById('bottomNav');
        const lens = document.getElementById('navLens');
        const pill = document.getElementById('navPill');
        if (!nav || !lens || !pill) return;
        const glass = lens.querySelector('.lens-glass');
        const rim = lens.querySelector('.lens-rim');
        const items = Array.from(nav.querySelectorAll('.nav-item'));
        const KEYS = ['home', 'balance', 'bonus', 'top', 'profile'];
        const actions = [
            () => goHome(),
            () => openBalance('deposit'),
            () => openBonus(),
            () => openTop(),
            () => openProfile()
        ];
        const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
        const hap = t => { try { window.haptic && window.haptic(t); } catch (e) {} };

        // Качество стекла: 2 — полное, 1 — облегчённое, 0 — только размытие.
        // Если кадры начинают проседать, панель сама переключается на уровень ниже и запоминает это.
        const ua = navigator.userAgent;
        const chromium = /Chrome\/|Chromium|CriOS/.test(ua) && !/iPhone|iPad|iPod/.test(ua);
        const strong = (navigator.hardwareConcurrency || 4) >= 8 && (navigator.deviceMemory || 4) >= 6;
        let tier = chromium ? (strong ? 2 : 1) : 0;
        try {
            const saved = localStorage.getItem('navGlassTier2');
            if (saved !== null && +saved < tier) tier = +saved;
        } catch (e) {}
        function applyTier() {
            nav.classList.toggle('svgglass', tier === 2);
            nav.classList.toggle('svglite', tier === 1);
        }
        applyTier();

        let W = 0, H = 0, itemW = 0, restW = 0, restH = 0, dragW = 0, dragH = 0;
        const cx = i => (i + 0.5) * itemW;
        function measure() {
            W = nav.clientWidth; H = nav.clientHeight;
            itemW = W / items.length;
            restW = itemW - 10;  restH = H - 12;
            dragW = itemW * 1.3; dragH = H + 16;
            // размеры задаём один раз: фильтр стекла работает с постоянным размером
            pill.style.width = restW + 'px';  pill.style.height = restH + 'px';
            pill.style.borderRadius = restH / 2 + 'px';
            lens.style.width = dragW + 'px';  lens.style.height = dragH + 'px';
            lens.style.borderRadius = dragH / 2 + 'px';
        }

        // x — центр линзы, g — «раздутость» (0 плашка, 1 стекло), sq — сжатие о стенку
        const st = { x: 0, vx: 0, g: 0, vg: 0, sq: 0, vsq: 0, side: 0 };
        const tgt = { x: 0, g: 0, sq: 0 };
        let activeIdx = 0, hoverIdx = 0, pressed = false, moved = false, activePointerId = null;
        let startX = 0, fingerX = 0, raf = 0, lastFrame = 0, busyFrames = 0, slow = 0;

        function setOn(i) { items.forEach((el, k) => el.classList.toggle('on', k === i)); }
        function idxAt(x) { return clamp(Math.floor(x / itemW), 0, items.length - 1); }
        const rubber = o => 9 * (1 - Math.exp(-o / 20));

        function render() {
            const g = clamp(st.g, 0, 1.06);
            const sq = clamp(st.sq, 0, 1);
            const bw = restW + (dragW - restW) * g;
            const bh = restH + (dragH - restH) * g;
            const sp = Math.min(Math.abs(st.vx) / 1800, 1) * 0.14 * Math.min(g, 1);
            const sw = bw * (1 + sp);
            const w = sw * (1 - 0.2 * sq);
            const h = bh * (1 - sp * 0.35) * (1 + 0.07 * sq);
            const centered = st.x - w / 2;
            const pinned = st.side < 0 ? st.x - sw / 2 : st.x + sw / 2 - w;
            const left = centered + (pinned - centered) * sq;
            // только transform и opacity — без пересчёта layout
            lens.style.transform = 'translate3d(' + left + 'px,' + (-dragH / 2) + 'px,0) scale(' + (w / dragW) + ',' + (h / dragH) + ')';
            pill.style.transform = 'translate3d(' + (st.x - restW / 2) + 'px,' + (-restH / 2) + 'px,0)';
            const go = clamp((g - 0.05) / 0.55, 0, 1);
            glass.style.opacity = go;
            rim.style.opacity = go;
            const vis = go > 0.01 ? 'visible' : 'hidden';
            if (glass.style.visibility !== vis) { glass.style.visibility = vis; rim.style.visibility = vis; }
            pill.style.opacity = 1 - clamp(g * 2, 0, 1);
        }

        function step(dt) {
            const sp = (p, v, t, k, c) => {
                v += (k * (t - p) - c * v) * dt;
                return [p + v * dt, v];
            };
            [st.x, st.vx]   = sp(st.x, st.vx, tgt.x, 420, 30);
            [st.g, st.vg]   = sp(st.g, st.vg, tgt.g, 300, 24);
            [st.sq, st.vsq] = sp(st.sq, st.vsq, tgt.sq, 520, 30);
        }
        function frame(now) {
            const raw = (now - lastFrame) / 1000 || 0.016;
            const dt = Math.min(0.034, raw);
            lastFrame = now;
            step(dt / 2); step(dt / 2);
            render();

            // авто-снижение качества, если стекло тормозит
            if (tier > 0 && st.g > 0.3) {
                busyFrames++;
                if (busyFrames > 10) {
                    slow = raw > 0.030 ? slow + 1 : Math.max(0, slow - 1);
                    if (slow >= 20) {
                        tier--; applyTier(); slow = 0; busyFrames = 0;
                        try { localStorage.setItem('navGlassTier2', String(tier)); } catch (e) {}
                    }
                }
            } else { busyFrames = 0; }

            // когда всё успокоилось (в т.ч. палец стоит на месте) — цикл останавливается
            const settled =
                Math.abs(st.x - tgt.x) < 0.1 && Math.abs(st.vx) < 0.5 &&
                Math.abs(st.g - tgt.g) < 0.002 && Math.abs(st.vg) < 0.01 &&
                Math.abs(st.sq - tgt.sq) < 0.002 && Math.abs(st.vsq) < 0.01;
            if (settled) {
                st.x = tgt.x; st.g = tgt.g; st.sq = tgt.sq; st.vx = st.vg = st.vsq = 0;
                render(); raf = 0; return;
            }
            raf = requestAnimationFrame(frame);
        }
        function kick() { if (!raf) { lastFrame = performance.now(); raf = requestAnimationFrame(frame); } }

        function updateTarget() {
            const cmin = cx(0), cmax = cx(items.length - 1);
            if (fingerX < cmin) {
                const o = cmin - fingerX;
                tgt.x = cmin - rubber(o); tgt.sq = Math.min(o / 36, 1); st.side = -1;
            } else if (fingerX > cmax) {
                const o = fingerX - cmax;
                tgt.x = cmax + rubber(o); tgt.sq = Math.min(o / 36, 1); st.side = 1;
            } else {
                tgt.x = fingerX; tgt.sq = 0;
            }
        }
        function restTo(i) { tgt.x = cx(i); tgt.g = 0; tgt.sq = 0; kick(); }

        function updateHover() {
            const i = idxAt(fingerX);
            if (i !== hoverIdx) { hoverIdx = i; setOn(i); hap('select'); }
        }
        function localX(e) {
            const r = nav.getBoundingClientRect();
            return e.clientX - r.left - nav.clientLeft;
        }

        nav.addEventListener('pointerdown', e => {
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            // уже зажат первый палец — второй игнорируем
            if (pressed) return;
            activePointerId = e.pointerId;
            measure();
            pressed = true; moved = false;
            startX = e.clientX; fingerX = localX(e);
            try { nav.setPointerCapture(e.pointerId); } catch (_) {}
            hoverIdx = idxAt(fingerX); setOn(hoverIdx);
            nav.classList.add('pressing');
            tgt.g = 1; updateTarget(); kick();
        });
        nav.addEventListener('pointermove', e => {
            if (!pressed || e.pointerId !== activePointerId) return;
            fingerX = localX(e);
            if (Math.abs(e.clientX - startX) > 6) moved = true;
            updateTarget(); updateHover(); kick();
        });
        function release(e, cancelled) {
            if (!pressed || e.pointerId !== activePointerId) return;
            pressed = false;
            activePointerId = null;
            nav.classList.remove('pressing');
            let i;
            if (cancelled) i = activeIdx;
            else if (!moved) i = idxAt(fingerX);
            else i = idxAt(clamp(st.x + st.vx * 0.1, 0, W));
            hoverIdx = i; setOn(i); restTo(i);
            if (!cancelled && (!moved || i !== activeIdx)) {
                hap('light');
                actions[i]();
            } else if (cancelled || i === activeIdx) {
                setOn(activeIdx);
            }
        }
        nav.addEventListener('pointerup', e => release(e, false));
        nav.addEventListener('pointercancel', e => release(e, true));
        nav.addEventListener('contextmenu', e => e.preventDefault());
        // клавиатура / программный click
        nav.addEventListener('click', e => {
            if (e.detail !== 0) return;
            const b = e.target.closest && e.target.closest('.nav-item');
            if (b) actions[items.indexOf(b)]();
        });

        window.navSync = function (key) {
            const i = KEYS.indexOf(key);
            if (i < 0) return;
            activeIdx = i;
            if (!pressed) { setOn(i); restTo(i); }
        };

        function snap() {
            measure();
            st.x = tgt.x = cx(pressed ? hoverIdx : activeIdx);
            st.g = tgt.g = 0; st.sq = tgt.sq = 0; st.vx = st.vg = st.vsq = 0;
            render();
        }
        measure(); snap();
        if (window.ResizeObserver) new ResizeObserver(() => { if (!pressed) snap(); }).observe(nav);
        window.addEventListener('resize', () => { if (!pressed) snap(); });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();


/* ==========================================
   ВКЛАДКА «ТОП»: рейтинг игроков
   Данные: RPC wxs_leaderboard (см. leaderboard.sql). Если функции в базе ещё нет —
   считаем напрямую из wxs_game / live_bets.
========================================== */
(function () {
    const $ = id => document.getElementById(id);
    const supabase = window.wxsSupabase;
    const TTL = 20000;
    const st = { metric: 'turnover', period: 'all', date: null, seq: 0, cache: new Map(), bound: false };

    /* ---------- анимированный доллар (dollar.tgs) ----------
       Один раз раскладываем анимацию на кадры и рисуем их во все маленькие canvas одним таймером —
       так даже 50 строк с анимированным значком почти ничего не стоят. */
    const DOLLAR = 'animations/stickers/dollar';
    const dollarCanvases = new Set();
    let dollarSprite, dollarPromise = null, dRaf = 0, dLast = -1;

    async function readLottieJson(buf) {
        const bytes = new Uint8Array(buf);
        if (!(bytes[0] === 0x1f && bytes[1] === 0x8b)) return JSON.parse(new TextDecoder().decode(bytes));
        if (typeof DecompressionStream !== 'undefined') {
            const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
            return JSON.parse(await new Response(stream).text());
        }
        if (window.pako) return JSON.parse(window.pako.ungzip(bytes, { to: 'string' }));
        throw new Error('no gzip');
    }
    function buildFrames(data) {
        return new Promise(resolve => {
            const host = document.createElement('div');
            host.style.cssText = 'position:fixed;left:-9999px;top:0;width:72px;height:72px;pointer-events:none;visibility:hidden';
            document.body.appendChild(host);
            const anim = lottie.loadAnimation({
                container: host, renderer: 'canvas', loop: false, autoplay: false, animationData: data,
                rendererSettings: { clearCanvas: true, dpr: 1, preserveAspectRatio: 'xMidYMid meet' }
            });
            const run = () => {
                try {
                    const src = host.querySelector('canvas');
                    const total = Math.max(1, Math.floor(anim.totalFrames || 1));
                    const n = Math.min(total, 40);
                    const frames = [];
                    for (let i = 0; i < n; i++) {
                        anim.goToAndStop(Math.floor(i * total / n), true);
                        const c = document.createElement('canvas');
                        c.width = c.height = 72;
                        c.getContext('2d').drawImage(src, 0, 0, 72, 72);
                        frames.push(c);
                    }
                    const dur = Math.max(400, total / (anim.frameRate || 30) * 1000);
                    anim.destroy(); host.remove();
                    resolve({ frames, dur });
                } catch (e) { try { anim.destroy(); } catch (_) {} host.remove(); resolve(null); }
            };
            if (anim.isLoaded) run(); else anim.addEventListener('DOMLoaded', run);
        });
    }
    function tryImage(url) {
        return new Promise((res, rej) => { const i = new Image(); i.alt = ''; i.draggable = false; i.onload = () => res(i); i.onerror = rej; i.src = url; });
    }
    function loadDollar() {
        if (dollarPromise) return dollarPromise;
        dollarPromise = (async () => {
            if (typeof lottie !== 'undefined') {
                for (const ext of ['tgs', 'json']) {
                    try {
                        const r = await fetch(DOLLAR + '.' + ext);
                        if (!r.ok) continue;
                        const sprite = await buildFrames(await readLottieJson(await r.arrayBuffer()));
                        if (sprite) return sprite;
                    } catch (e) {}
                }
            }
            for (const ext of ['webp', 'gif', 'png']) {
                try { return { img: await tryImage(DOLLAR + '.' + ext) }; } catch (e) {}
            }
            return null;
        })().then(s => { dollarSprite = s; return s; });
        return dollarPromise;
    }
    function paintDollar(c, frame) {
        const ctx = c.getContext('2d');
        ctx.clearRect(0, 0, c.width, c.height);
        ctx.drawImage(frame, 0, 0, c.width, c.height);
    }
    function topVisible() { const p = $('topPage'); return !!p && !p.classList.contains('hidden'); }
    function dTick(now) {
        dRaf = 0;
        const s = dollarSprite;
        if (!s || !s.frames || !dollarCanvases.size || !topVisible() || document.hidden) return;
        const idx = Math.floor((now % s.dur) / s.dur * s.frames.length);
        if (idx !== dLast) {
            dLast = idx;
            dollarCanvases.forEach(c => { if (!c.isConnected) dollarCanvases.delete(c); else paintDollar(c, s.frames[idx]); });
        }
        dRaf = requestAnimationFrame(dTick);
    }
    function startDollarLoop() { if (!dRaf && dollarSprite && dollarSprite.frames) dRaf = requestAnimationFrame(dTick); }
    document.addEventListener('visibilitychange', startDollarLoop);

    function dollarEl() {
        const c = document.createElement('canvas');
        const px = Math.round(20 * Math.min(window.devicePixelRatio || 1, 2));
        c.width = c.height = px;
        c.className = 'lb-dollar';
        loadDollar().then(s => {
            if (!c.isConnected && !c.parentNode) return;
            if (s && s.frames) {
                paintDollar(c, s.frames[0]);
                dollarCanvases.add(c);
                startDollarLoop();
            } else {
                const f = s && s.img ? s.img.cloneNode() : document.createElement('span');
                if (s && s.img) f.className = 'lb-dollar'; else { f.className = 'lb-dollar-fb'; f.textContent = '$'; }
                c.replaceWith(f);
            }
        });
        return c;
    }

    /* ---------- данные ---------- */
    const num = v => Number(v) || 0;
    const fmt = v => num(v).toLocaleString('ru-RU', { maximumFractionDigits: 2 });
    const pname = r => r.nickname || r.username || 'Игрок';

    function range(period, date) {
        const now = new Date();
        const sod = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const DAY = 86400000;
        switch (period) {
            case 'today': return { from: sod, to: null };
            case 'yesterday': return { from: new Date(sod - DAY), to: sod };
            case 'week': return { from: new Date(now - 7 * DAY), to: null };
            case 'month': return { from: new Date(now - 30 * DAY), to: null };
            case 'date': {
                const [y, m, d] = String(date).split('-').map(Number);
                const a = new Date(y, m - 1, d);
                return { from: a, to: new Date(a.getTime() + DAY) };
            }
            default: return { from: null, to: null };
        }
    }

    async function fallbackRows(metric, from, to) {
        let rows = null;
        if (metric === 'balance' || (!from && !to)) {
            const col = metric === 'balance' ? 'balance' : (metric === 'wins' ? 'total_win' : 'turnover');
            const { data, error } = await supabase
                .from('wxs_game')
                .select('telegram_id,nickname,username,photo_url,balance,turnover,total_win')
                .order(col, { ascending: false })
                .limit(metric === 'losses' ? 300 : 50);
            if (error || !data) return null;
            rows = data.map(r => ({
                id: r.telegram_id, name: pname(r), photo: r.photo_url || '',
                value: metric === 'balance' ? num(r.balance)
                     : metric === 'turnover' ? num(r.turnover)
                     : metric === 'wins' ? num(r.total_win)
                     : Math.max(0, num(r.turnover) - num(r.total_win))
            }));
        } else {
            const agg = new Map();
            for (let p = 0; p < 5; p++) {
                let q = supabase.from('live_bets').select('telegram_id,name,amount,win_amount,resolved_at').not('telegram_id', 'is', null);
                if (from) q = q.gte('created_at', from.toISOString());
                if (to) q = q.lt('created_at', to.toISOString());
                const { data, error } = await q.order('id', { ascending: false }).range(p * 1000, p * 1000 + 999);
                if (error || !data) { if (p === 0) return null; break; }
                data.forEach(b => {
                    const a = agg.get(b.telegram_id) || { id: b.telegram_id, name: b.name || 'Игрок', photo: '', turnover: 0, wins: 0, loss: 0 };
                    const amount = num(b.amount), win = num(b.win_amount);
                    a.turnover += amount; a.wins += win;
                    if (b.resolved_at) a.loss += amount - win;
                    agg.set(b.telegram_id, a);
                });
                if (data.length < 1000) break;
            }
            rows = Array.from(agg.values()).map(a => ({
                id: a.id, name: a.name, photo: '',
                value: metric === 'turnover' ? a.turnover : metric === 'wins' ? a.wins : Math.max(0, a.loss)
            }));
            rows = rows.filter(r => r.value > 0).sort((a, b) => b.value - a.value).slice(0, 50);
            if (rows.length) {
                try {
                    const { data } = await supabase.from('wxs_game')
                        .select('telegram_id,nickname,username,photo_url')
                        .in('telegram_id', rows.map(r => r.id));
                    const map = new Map((data || []).map(r => [r.telegram_id, r]));
                    rows.forEach(r => { const u = map.get(r.id); if (u) { r.name = pname(u); r.photo = u.photo_url || ''; } });
                } catch (e) {}
            }
        }
        return rows.filter(r => r.value > 0).sort((a, b) => b.value - a.value).slice(0, 50);
    }

    const dayStr = d => d ? d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') : null;

    async function fetchRows(metric, period, date) {
        const { from, to } = range(period, date);
        if (metric === 'balance') {
            // максимальный баланс игрока за период (дневные пики из wxs_balance_daily)
            try {
                const { data, error } = await supabase.rpc('wxs_balance_peaks', {
                    p_from: dayStr(from), p_to: dayStr(to), p_limit: 50
                });
                if (!error && Array.isArray(data)) {
                    return data.map(r => ({ id: r.telegram_id, name: r.name || 'Игрок', photo: r.photo_url || '', value: num(r.value) }));
                }
            } catch (e) { /* функции ещё нет — покажем текущий баланс */ }
            return fallbackRows('balance', null, null);
        }
        try {
            const { data, error } = await supabase.rpc('wxs_leaderboard', {
                p_metric: metric,
                p_from: from ? from.toISOString() : null,
                p_to: to ? to.toISOString() : null,
                p_limit: 50
            });
            if (!error && Array.isArray(data)) {
                return data.map(r => ({ id: r.telegram_id, name: r.name || 'Игрок', photo: r.photo_url || '', value: num(r.value) }));
            }
        } catch (e) { /* функции ещё нет — считаем напрямую */ }
        return fallbackRows(metric, from, to);
    }

    /* ---------- отрисовка ---------- */
    const MEDAL_COLORS = { 1: ['#ffe27a', '#f0a500', '#e0301e'], 2: ['#e4ebff', '#9db0e6', '#3a63d8'], 3: ['#ffc58a', '#e08a3c', '#d4401e'] };
    function medalSVG(n) {
        const [a, b, r] = MEDAL_COLORS[n];
        return '<svg class="lb-medal" viewBox="0 0 34 40" aria-hidden="true">' +
            '<path d="M9 22 5 37l6-3 3 5 3-13z" fill="' + r + '"/><path d="M25 22l4 15-6-3-3 5-3-13z" fill="' + r + '"/>' +
            '<circle cx="17" cy="15" r="13" fill="' + b + '"/><circle cx="17" cy="15" r="10.4" fill="' + a + '"/>' +
            '<text x="17" y="21" text-anchor="middle" font-size="16" font-weight="900" fill="#3a2600" font-family="system-ui,sans-serif">' + n + '</text></svg>';
    }
    function letterOf(name) { return (String(name || '?').trim()[0] || '?').toUpperCase(); }
    function avatarEl(row) {
        const a = document.createElement('div');
        a.className = 'lb-av';
        const letter = () => { a.textContent = letterOf(row.name); };
        if (row.photo) {
            const img = new Image();
            img.alt = ''; img.decoding = 'async'; img.loading = 'lazy'; img.draggable = false;
            img.onerror = () => { img.remove(); letter(); };
            img.src = row.photo;
            a.appendChild(img);
        } else letter();
        return a;
    }
    function amountEl(v) {
        const s = document.createElement('span');
        s.className = 'lb-amt';
        const t = document.createElement('span');
        t.textContent = fmt(v);
        s.append(t, dollarEl());
        return s;
    }
    function myId() { return (typeof tg !== 'undefined' && tg?.initDataUnsafe?.user?.id) || null; }

    function render(rows) {
        const podium = $('lbPodium'), list = $('lbList');
        dollarCanvases.clear(); dLast = -1;
        podium.classList.remove('lb-dim'); list.classList.remove('lb-dim');
        podium.textContent = ''; list.textContent = '';

        if (!rows || !rows.length) {
            podium.style.minHeight = '0';
            const e = document.createElement('div');
            e.className = 'lb-empty';
            e.textContent = 'Пока нет данных за этот период';
            list.appendChild(e);
            return;
        }
        podium.style.minHeight = '';
        const order = [1, 0, 2];
        order.forEach((ri, pos) => {
            const row = rows[ri];
            const col = document.createElement('div');
            col.className = 'lb-col lb-col--' + (ri + 1) + (row ? '' : ' lb-col--empty');
            const delay = ri === 0 ? 120 : ri === 1 ? 0 : 60;
            col.style.setProperty('--d', delay);
            const body = document.createElement('div');
            body.className = 'lb-col-body';
            if (row) {
                const medal = document.createElement('div');
                medal.innerHTML = medalSVG(ri + 1);
                const name = document.createElement('div');
                name.className = 'lb-name'; name.textContent = row.name;
                body.append(medal.firstChild, avatarEl(row), name, amountEl(row.value));
            }
            const block = document.createElement('div');
            block.className = 'lb-block';
            block.textContent = ri + 1;
            col.append(body, block);
            podium.appendChild(col);
        });

        const me = myId();
        rows.slice(3).forEach((row, i) => {
            const el = document.createElement('div');
            el.className = 'lb-row' + (me && String(row.id) === String(me) ? ' me' : '');
            el.style.setProperty('--d', Math.min(i * 35, 500) + 250);
            const rank = document.createElement('div');
            rank.className = 'lb-rank'; rank.textContent = i + 4;
            const name = document.createElement('div');
            name.className = 'lb-name'; name.textContent = row.name;
            el.append(rank, avatarEl(row), name, amountEl(row.value));
            list.appendChild(el);
        });
        startDollarLoop();
    }

    function renderLoading() {
        const podium = $('lbPodium'), list = $('lbList');
        if (podium.childElementCount === 0 && list.childElementCount === 0) {
            podium.style.minHeight = '0';
            for (let i = 0; i < 4; i++) { const s = document.createElement('div'); s.className = 'lb-skel'; list.appendChild(s); }
        } else {
            podium.classList.add('lb-dim'); list.classList.add('lb-dim');
        }
    }
    function renderError() {
        const podium = $('lbPodium'), list = $('lbList');
        podium.textContent = ''; list.textContent = ''; podium.style.minHeight = '0';
        podium.classList.remove('lb-dim'); list.classList.remove('lb-dim');
        const e = document.createElement('div');
        e.className = 'lb-empty';
        e.textContent = 'Не удалось загрузить рейтинг';
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'lb-retry'; b.textContent = 'Повторить';
        b.onclick = () => load(true);
        e.append(document.createElement('br'), b);
        list.appendChild(e);
    }

    async function load(force) {
        const period = st.period;
        const key = st.metric + '|' + period + '|' + (period === 'date' ? st.date : '');
        const hit = st.cache.get(key);
        if (!force && hit && Date.now() - hit.t < TTL) { render(hit.rows); return; }
        const seq = ++st.seq;
        renderLoading();
        let rows = null;
        try { rows = await fetchRows(st.metric, period, st.date); } catch (e) { rows = null; }
        if (seq !== st.seq) return;               // пока грузили, выбрали другое
        if (!rows) { renderError(); return; }
        st.cache.set(key, { t: Date.now(), rows });
        render(rows);
    }

    /* ---------- управление ---------- */
    const hap = t => { try { window.haptic && window.haptic(t); } catch (e) {} };
    function setActive(container, attr, value) {
        container.querySelectorAll('.lb-chip').forEach(b => b.classList.toggle('active', b.dataset[attr] === value));
    }
    function bind() {
        if (st.bound) return;
        st.bound = true;
        const metrics = $('lbMetrics'), periods = $('lbPeriods'), wrap = $('lbPeriodsWrap');
        const dateBtn = $('lbDateBtn'), dateIn = $('lbDateInput'), dateLabel = $('lbDateLabel');
        dateIn.max = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

        metrics.addEventListener('click', e => {
            const b = e.target.closest('.lb-chip'); if (!b || b.dataset.metric === st.metric) return;
            hap('select');
            st.metric = b.dataset.metric;
            setActive(metrics, 'metric', st.metric);
            b.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
            load(false);
        });
        periods.addEventListener('click', e => {
            const b = e.target.closest('.lb-chip'); if (!b) return;
            if (b.dataset.period === st.period && !st.date) return;
            hap('select');
            st.period = b.dataset.period; st.date = null;
            dateIn.value = ''; dateLabel.textContent = 'Выбрать дату'; dateBtn.classList.remove('active');
            setActive(periods, 'period', st.period);
            b.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
            load(false);
        });
        dateIn.addEventListener('change', () => {
            if (!dateIn.value) return;
            hap('select');
            st.period = 'date'; st.date = dateIn.value;
            const [y, m, d] = st.date.split('-').map(Number);
            dateLabel.textContent = new Date(y, m - 1, d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
            dateBtn.classList.add('active');
            periods.querySelectorAll('.lb-chip').forEach(b => b.classList.remove('active'));
            load(false);
        });
    }

    window.openTop = function () {
        const pg = $('topPage');
        const alreadyOpen = !!pg && !pg.classList.contains('hidden');
        window.showPage('topPage');
        window.updateNav('top');
        if (alreadyOpen) return;     // повторный тап по «Топ» — без перерисовки и повтора анимации
        bind();
        load(false);
        loadDollar().then(startDollarLoop);
    };
})();

/* Свернули мини-апп — не крутим бесконечные CSS-анимации */
document.addEventListener('visibilitychange', function () {
    document.documentElement.classList.toggle('app-paused', document.hidden);
});