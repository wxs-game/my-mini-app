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
        const se = document.scrollingElement || document.documentElement;
        const pageAtTop = se.scrollTop <= 0;
        const pageAtBottom = se.scrollTop + window.innerHeight >= se.scrollHeight - 1;
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

    // Вибрация на КАЖДЫЙ тап по кнопкам, плиткам игр, мин, цветам колеса,
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
function calculateCrashPoint(seed, salt) {
    let hash = seed + salt;
    let hex = hash.substring(0, 8);
    let intVal = parseInt(hex, 16);
    const maxVal = 4294967296; // 2^32 — диапазон intVal (8 hex-символов)

    const raw = (CRASH_RTP * maxVal) / (maxVal - intVal);
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

// Вызывать ПОСЛЕ завершения раунда (когда произошел краш) — просто
// показывает уже известный (из строки раунда) секретный ключ в поле.
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
        tile.innerHTML = `<img src="images/bomb.png" alt="bomb" style="width: 32px; height: 32px; object-fit: contain;">`;
        if (tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred("error");
        minesGame.field = res.field;
        endMinesGame(false);
        return;
    }

    minesGame.gemsFound = res.gems;
    tile.className = 'mine-tile revealed-gem';
    tile.innerHTML = `<img src="images/gem.png" alt="gem" style="width: 32px; height: 32px; object-fit: contain;">`;
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
            tile.innerHTML = `<img src="images/gem.png" alt="gem" style="width: 32px; height: 32px; object-fit: contain;">`;
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
const CRASH_HISTORY_MAX = 25;       // сколько прошедших раундов видно в ленте
const CRASH_RESULT_HOLD_MS = 3000;  // пауза с картинкой взрыва перед новым раундом

// Скорость роста коэффициента: x2 за 10 секунд полёта (исходный рост)
const CRASH_GROWTH_PER_MS = Math.log(2) / 10000;
// Время «раскачки» — исходные 6000 мс (6 сек)
const CRASH_SLOW_START_MS = 6000;
const CRASH_SLOW_START_TARGET = 1.5;

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
        return CRASH_SLOW_START_MS * Math.cbrt(x);
    }
    return CRASH_SLOW_START_MS + Math.log(cp / CRASH_SLOW_START_TARGET) / CRASH_GROWTH_PER_MS;
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

    const animationData = getLottieData('EXPLOSION');

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
        const eased = Math.pow(p, 3);
        rawMult = 1 + (CRASH_SLOW_START_TARGET - 1) * eased;
    } else {
        const elapsedAfter = elapsed - CRASH_SLOW_START_MS;
        rawMult = CRASH_SLOW_START_TARGET * Math.exp(CRASH_GROWTH_PER_MS * elapsedAfter);
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
        crashLobby.pollInterval = setInterval(refreshCrashState, 1000);
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

        // Ответ устарел — пока он летел, уже применился более свежий запрос
        if (seq < crashLobby.appliedSeq) return;
        crashLobby.appliedSeq = seq;

        applyCrashRound(round, bets);
        maybeAdvanceCrash();
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
    const mine = crashLobby.bets.find(b => b.isUser);
    if (mine) {
        crashGame.bet = mine.amount;
        crashGame.betPlaced = true;
        if (mine.status === 'cashed_out') crashGame.cashedOut = true;
        crashGame.myBetRowId = mine.id;
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
async function maybeAdvanceCrash() {
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
    if (dom.betInput) dom.betInput.disabled = crashGame.betPlaced;

    renderCrashCountdown(true);
    renderCrashUI();
}

// Обратный отсчёт: меняем DOM только когда цифра реально сменилась, а
// следующую смену ставим на ТОЧНУЮ границу секунды.
function renderCrashCountdown(force) {
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
    if (dom.betInput) dom.betInput.disabled = true;
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
        // нет Lottie — показываем запасной эмодзи и сами убираем
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
    if (!round || round.id !== crashGame.roundId || crashGame.phase !== 'waiting' || crashGame.betPlaced) return;
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

    if (crashGame.phase === 'waiting' && !crashGame.betPlaced) {
        placeCrashBet();
    } else if (crashGame.phase === 'flying' && crashGame.betPlaced && !crashGame.cashedOut) {
        cashOutCrash();
    }
}

function adjustCrashBet(factor) {
    if (crashGame.betPlaced) return;
    applyBetFactor(getCrashDom().betInput, factor);
}

function setCrashMaxBet() {
    if (crashGame.betPlaced) return;
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
    const dom = getCrashDom();
    if (!dom.playersList) return;

    if (dom.playersCount) dom.playersCount.textContent = String(crashLobby.bets.length);

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

            return (
                '<div class="crash-player-row' + (p.isUser ? ' crash-player-row-user' : '') + '">' +
                    '<div class="crash-player-row-avatar">' + iceAvatarHtml(p.avatar) + '</div>' +
                    '<div class="crash-player-row-info">' +
                        '<div class="crash-player-row-name">' + escapeIceName(p.name) + '</div>' +
                        '<div class="crash-player-row-bet">' + p.amount.toFixed(2) + '$</div>' +
                    '</div>' +
                    statusHtml +
                '</div>'
            );
        }).join('');
    }

    // Не трогаем DOM, если ничего не изменилось — список не мигает
    if (html === crashLobby.lastPlayersHtml) return;
    crashLobby.lastPlayersHtml = html;
    dom.playersList.innerHTML = html;
}

// Путь следа + точка на его конце для коэффициента m (без смены классов/прозрачности)
function drawCrashTrail(m) {
    const dom = getCrashDom();
    const stageW = crashStageW;
    const stageH = crashStageH;

    // Скорость полета ракеты: достигает верхнего угла (пика) ровно при 3.00x
    const trailProgress = Math.min(1, Math.max(0, (m - 1) / 2));

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
        const r1 = v => Math.round(v * 10) / 10;
        setTrailD(dom, `M ${r1(trailStartX)},${r1(trailStartY)} Q ${r1(ctrlX)},${r1(ctrlY)} ${r1(headX)},${r1(headY)}`);
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
        dom.actionBtn.textContent = crashGame.cashedOut ? 'Выигрыш забран ✓' : 'Раунд завершён';
        dom.actionBtn.disabled = true;
        return;
    }

    if (crashGame.phase === 'waiting') {
        // Тяжёлая подготовка сцены — в enterWaitingVisual() (один раз),
        // цифры отсчёта — в renderCrashCountdown(). Здесь только кнопка.
        if (dom.betInput) dom.betInput.disabled = crashGame.betPlaced;
        dom.actionBtn.textContent = crashGame.betPlaced ? 'Ставка принята' : 'Сделать ставку';
        dom.actionBtn.disabled = crashGame.betPlaced;
        return;
    }

    // phase === 'flying'
    // Расчёт позиции ракеты и точки следа — дешёвая математика, считаем
    // каждый кадр, чтобы ракета двигалась идеально плавно.
    const currentM = crashGame.currentMult;

    // Скорость полета ракеты: достигает верхнего угла (пика) ровно при 3.00x
    const trailProgress = Math.min(1, Math.max(0, (currentM - 1) / 2));

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
        } else if (crashGame.cashedOut) {
            dom.actionBtn.textContent = 'Выигрыш забран ✓';
            dom.actionBtn.disabled = true;
        } else {
            dom.actionBtn.textContent = 'Ждите следующего раунда';
            dom.actionBtn.disabled = true;
        }
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

// Исход — честный: победа с вероятностью ровно «шанс»%, криптостойкий генератор.
function upgRoll(chance) {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return (a[0] % 100) < chance;
}

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

        const debit = await placeBetServer(bet, 'Апгрейдер');
        if (!debit.ok) {
            restoreBalanceState(snapshot);
            showMessage('Не удалось списать ставку. Проверьте соединение и попробуйте снова.');
            return;
        }
        currentBalance = debit.balance;
        setUIBalance(currentBalance);

        const liveBetId = await broadcastLiveBet(bet, 'Апгрейдер');
        const win = upgRoll(chance);

        // Деньги проводим сразу (как в боте), а на экране баланс и итог
        // раскрываются только когда колесо остановилось.
        let credited = 0;
        if (win) {
            const winSnap = snapshotBalanceState();
            currentTotalWin = roundMoney(currentTotalWin + payout);
            currentWinsCount++;
            if (coef > currentMaxWin) currentMaxWin = coef;
            const cr = await resolveWinServerWithRetry(payout, coef);
            if (!cr.ok) {
                restoreBalanceState(winSnap);
                showMessage('Ошибка сети: выигрыш не был зачислен. Обратитесь в поддержку и укажите время игры.');
            } else {
                credited = payout;
                currentBalance = cr.balance;
            }
        }

        const res = document.getElementById('upgResult');
        upgHideResultText();      // старый итог плавно гаснет, кольцо и стрелка — внутри upgAnimate
        await upgAnimate(win, chance);

        setUIBalance(currentBalance);
        resolveLiveBetWin(liveBetId, bet, credited);
        window.haptic(credited > 0 ? 'success' : 'error');
        if (res) {
            clearTimeout(upgResTimer);
            res.style.opacity = '1';
            res.textContent = credited > 0 ? `Победа! +${credited.toFixed(2)} $ (x${coef.toFixed(2)})` : 'Не повезло. Попробуйте ещё раз';
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
    const pages = ["homePage", "wheelPage", "balancePage", "profilePage", "bonusPage", "minesPage", "crashPage", "upgraderPage", "adminPage", "iceArenaPage"];
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
    resumeMinesGame();
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

function handleBalanceAction() {
    if (typeof balanceMode !== 'undefined' && balanceMode === 'withdraw') {
        handleWithdrawal();
    } else {
        handleDeposit();
    }
}

// ==========================================
// ПОПОЛНЕНИЕ БАЛАНСА
// ==========================================
function handleDeposit() {
    const amountInput = document.querySelector('.sum-input-wrap input');
    const amount = amountInput ? parseFloat(amountInput.value) : 0;

    if (!amount || amount <= 0) {
        alert('Пожалуйста, введите корректную сумму');
        return;
    }

    const tgUser = tg?.initDataUnsafe?.user;
    if (!tgUser) {
        showMessage("Откройте приложение через Telegram, чтобы пополнить баланс.");
        if (typeof unlockEconomy === 'function') unlockEconomy();
        return;
    }

    // Переход напрямую по ссылке Telegram (в зависимости от выбранного способа оплаты)
    const depositLinks = {
        'CryptoBot': 'https://t.me/m/M9xJg5ImYzli',
        'xRocket': 'https://t.me/m/UXK1-ltZODIy'
    };
    const targetUrl = depositLinks[selectedMethod] || depositLinks['CryptoBot'];

    if (tg?.openTelegramLink) {
        tg.openTelegramLink(targetUrl);
    } else {
        window.location.href = targetUrl;
    }

    // Добавление транзакции в локальный список
    transactions.unshift({
        type: 'deposit',
        method: typeof selectedMethod !== 'undefined' ? selectedMethod : 'Telegram',
        icon: typeof selectedMethodIcon !== 'undefined' ? selectedMethodIcon : '',
        amount: amount,
        date: 'Только что',
        status: 'pending'
    });

    if (typeof renderTransactions === 'function') renderTransactions();
    if (typeof unlockEconomy === 'function') unlockEconomy();
}

// ==========================================
// ВЫВОД СРЕДСТВ (ЛОКАЛЬНО)
// ==========================================
function handleWithdrawal() {
    const amountInput = document.querySelector('.sum-input-wrap input');
    const amount = amountInput ? parseFloat(amountInput.value) : 0;

    if (!amount || amount <= 0) {
        showMessage("Введите корректную сумму вывода");
        return;
    }

    if (amount > currentBalance) {
        showMessage("Недостаточно средств");
        if (typeof unlockEconomy === 'function') unlockEconomy();
        return;
    }

    const tgUser = tg?.initDataUnsafe?.user;
    if (!tgUser) {
        showMessage("Откройте приложение через Telegram, чтобы вывести средства.");
        if (typeof unlockEconomy === 'function') unlockEconomy();
        return;
    }

    // Переход напрямую по ссылке Telegram (в зависимости от выбранного способа вывода)
    const withdrawLinks = {
        'CryptoBot': 'https://t.me/m/s7c5WS1MNTE6',
        'xRocket': 'https://t.me/m/mVxu1jNsZTJi'
    };
    const targetUrl = withdrawLinks[selectedMethod] || withdrawLinks['CryptoBot'];

    if (tg?.openTelegramLink) {
        tg.openTelegramLink(targetUrl);
    } else {
        window.location.href = targetUrl;
    }

    // Списание баланса и обновление статистики локально
    currentWithdrawals = roundMoney((currentWithdrawals || 0) + amount);
    currentBalance = roundMoney(currentBalance - amount);
    
    if (typeof setUIBalance === 'function') {
        setUIBalance(currentBalance);
    }

    // Добавление заявки на вывод в историю
    transactions.unshift({
        type: 'withdraw',
        method: typeof selectedMethod !== 'undefined' ? selectedMethod : 'Withdraw',
        icon: typeof selectedMethodIcon !== 'undefined' ? selectedMethodIcon : '',
        amount: amount,
        date: 'Только что',
        status: 'pending'
    });

    if (typeof renderTransactions === 'function') renderTransactions();

    const methodName = typeof selectedMethod !== 'undefined' ? selectedMethod : '';
    showMessage(`Заявка на вывод ${amount.toFixed(2)} $ ${methodName ? 'через ' + methodName + ' ' : ''}принята`);
    
    if (typeof unlockEconomy === 'function') unlockEconomy();
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
    setAdminTab('players');
    loadAdminPlayers();
}

// Переключение вкладок админ-панели: "Игроки" (существующий список) и
// "Действия" (глобальная лента ставок → результатов по всем играм).
function setAdminTab(tab) {
    const isActions = tab === 'actions';

    document.getElementById('adminPlayersView')?.classList.toggle('hidden', isActions);
    document.getElementById('adminActionsView')?.classList.toggle('hidden', !isActions);
    document.getElementById('adminTabPlayersBtn')?.classList.toggle('active', !isActions);
    document.getElementById('adminTabActionsBtn')?.classList.toggle('active', isActions);

    if (isActions) {
        renderActionsFeed();
        loadActionsFeed().then(() => {
            if (!document.getElementById('adminActionsView')?.classList.contains('hidden')) renderActionsFeed();
        });
    }
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

    hideAppLoader(assetsReady);
});

/* =========================
   ПРЕДЗАГРУЗКА РЕСУРСОВ ПРИ СТАРТЕ (во время экрана загрузки)
========================= */

// Все картинки, которые используются в приложении (и в HTML, и из JS).
// Добавляете новую картинку в проект — допишите её сюда.
const PRELOAD_IMAGES = [
    'images/bomb.png',
    'images/gem.png',
    'images/tether.png',
    'images/cryptobot.png',
    'images/xrocket.png',
    'images/copy.png',
    'images/lock.png',
    'images/key.png',
    'images/rocket_game.png',
    'images/mines_game.png',
    'images/dream_catcher_game.png'
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
window.applyMinToActive = applyMinToActive;
window.applyPercentToActive = applyPercentToActive;
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
window.onActiveColorInput = onActiveColorInput;
window.onCustomMinesInputChange = onCustomMinesInputChange;
window.openBalance = openBalance;
window.openBonus = openBonus;
window.openCrash = openCrash;
window.openGamesMenu = openGamesMenu;
window.openMines = openMines;
window.openUpgrader = openUpgrader;
window.playUpgrader = playUpgrader;
window.upgSetChance = upgSetChance;
window.upgAdjustChance = upgAdjustChance;
window.upgBetFactor = upgBetFactor;
window.upgBetMax = upgBetMax;
window.upgOnBetInput = upgOnBetInput;
window.upgOnChanceInput = upgOnChanceInput;
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
window.clampBetInputOnBlur = clampBetInputOnBlur;
window.blockInvalidBetKeys = blockInvalidBetKeys;
window.applyPromoCode = applyPromoCode;
window.loadAdminPlayers = loadAdminPlayers;
window.setAdminTab = setAdminTab;
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

/* ==========================================
   ГЛОБАЛЬНАЯ ЛЕНТА ДЕЙСТВИЙ ИГРОКОВ ("Действия")
   Собирает вместе ставки из live_bets (Мины/Краш/Колесо — начало
   ставки и её конец, выигрыш или проигрыш) и раунды Айс Арены (начало —
   когда игрок присоединился, конец — когда раунд разрешился), сортирует
   по времени и показывает единой лентой с точным временем начала/конца
   каждого действия.
========================== */
const ACTIONS_FEED_MAX = 40;
let actionsFeed = [];
let actionsFeedLoading = null;

function formatActionsTime(ts) {
    return new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatActionsDuration(startTs, endTs) {
    const sec = Math.max(0, Math.round((endTs - startTs) / 1000));
    if (sec < 60) return sec + 'с';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m + 'м' + (s ? ' ' + s + 'с' : '');
}

async function loadActionsFeed() {
    if (actionsFeedLoading) return actionsFeedLoading;

    actionsFeedLoading = (async () => {
        try {
            const myId = myIceTelegramId();

            const [{ data: liveBets, error: liveError }, { data: arenaRounds, error: arenaError }] = await Promise.all([
                supabase
                    .from(LIVE_BETS_TABLE)
                    .select('id, telegram_id, name, amount, game, win_amount, multiplier, result, resolved_at, created_at')
                    .order('created_at', { ascending: false })
                    .limit(ACTIONS_FEED_MAX),
                supabase
                    .from(ICE_ARENA_ROUNDS_TABLE)
                    .select('*')
                    .not('winner_telegram_id', 'is', null)
                    .order('created_at', { ascending: false })
                    .limit(ACTIONS_FEED_MAX)
            ]);

            if (liveError) console.error('Действия (live_bets):', liveError);
            if (arenaError) console.error('Действия (ice_arena_rounds):', arenaError);

            // Ставки Мины/Краш/Колесо — начало (created_at) и конец
            // (resolved_at, пишется resolveLiveBetWin() при любом исходе).
            const liveActions = (liveBets || []).map(b => {
                const startTs = new Date(b.created_at).getTime();
                const endTs = b.resolved_at ? new Date(b.resolved_at).getTime() : null;
                return {
                    id: 'live_' + b.id,
                    source: 'live',
                    game: b.game || 'Игра',
                    name: b.name || 'Игрок',
                    isUser: myId != null && Number(b.telegram_id) === Number(myId),
                    amount: Number(b.amount) || 0,
                    resultAmount: b.win_amount != null ? Number(b.win_amount) : null,
                    multiplier: b.multiplier != null ? Number(b.multiplier) : null,
                    result: b.result || null,
                    startTs,
                    endTs
                };
            });

            // Айс Арена — начало для каждого игрока это момент его ставки
            // (когда он зашёл в раунд), конец — момент, когда раунд разрешился
            // (все ждали одинаково, пока не собрался банк/истекло время).
            let arenaActions = [];
            if ((arenaRounds || []).length) {
                const roundIds = arenaRounds.map(r => r.id);
                const { data: bets, error: betsError } = await supabase
                    .from(ICE_ARENA_BETS_TABLE)
                    .select('*')
                    .in('round_id', roundIds);
                if (betsError) console.error('Действия (ice_arena_bets):', betsError);

                const betsByRound = {};
                (bets || []).forEach(b => {
                    const key = String(b.round_id);
                    (betsByRound[key] = betsByRound[key] || []).push(b);
                });

                arenaRounds.forEach(r => {
                    const endTs = r.resolved_at ? new Date(r.resolved_at).getTime() : null;
                    const roundBets = betsByRound[String(r.id)] || [];
                    roundBets.forEach(b => {
                        const startTs = new Date(b.created_at || r.created_at).getTime();
                        const isWinner = String(b.telegram_id) === String(r.winner_telegram_id);
                        const payout = Number(r.payout) || 0;
                        const stake = Number(b.amount) || 0;
                        arenaActions.push({
                            id: 'arena_' + r.id + '_' + b.telegram_id,
                            source: 'arena',
                            roundId: String(r.id),
                            game: 'Айс Арена',
                            name: b.name || 'Игрок',
                            isUser: myId != null && Number(b.telegram_id) === Number(myId),
                            amount: stake,
                            resultAmount: isWinner ? payout : 0,
                            multiplier: isWinner && stake > 0 ? payout / stake : null,
                            result: isWinner ? 'win' : 'loss',
                            startTs,
                            endTs
                        });
                    });
                });
            }

            actionsFeed = liveActions.concat(arenaActions)
                .sort((a, b) => (b.endTs || b.startTs) - (a.endTs || a.startTs))
                .slice(0, ACTIONS_FEED_MAX);
        } catch (e) {
            console.error('Не удалось загрузить ленту действий:', e);
        } finally {
            actionsFeedLoading = null;
        }
    })();

    return actionsFeedLoading;
}

function renderActionsFeed() {
    const list = document.getElementById('actionsList');
    if (!list) return;

    if (!actionsFeed.length) {
        list.innerHTML = '<div class="ice-history-empty">Пока нет действий</div>';
        return;
    }

    list.innerHTML = actionsFeed.map(a => {
        // Раунды Айс Арены кликабельны — сразу открывают экран реплея этого
        // раунда (как чипы кэфов под полем). У остальных игр реплея нет.
        const clickAttr = a.source === 'arena' ? ' onclick="openArenaActionReplay(\'' + a.roundId + '\')"' : '';

        const startStr = formatActionsTime(a.startTs);
        const timeStr = a.endTs
            ? (startStr + ' → ' + formatActionsTime(a.endTs) + ' (' + formatActionsDuration(a.startTs, a.endTs) + ')')
            : (startStr + ' → идёт…');

        let walletClass = 'pending';
        let walletText = '—';
        if (a.result === 'win') {
            walletClass = '';
            walletText = '💳 +' + (a.resultAmount || 0).toFixed(2) + '$';
        } else if (a.result === 'loss') {
            walletClass = 'loss';
            walletText = '💳 -' + a.amount.toFixed(2) + '$';
        }

        const outcomeLabel = a.result === 'win' ? 'Победа' : (a.result === 'loss' ? 'Проигрыш' : 'В процессе');
        const multLabel = a.multiplier != null ? '×' + a.multiplier.toFixed(2) : '—';

        return '<div class="ice-history-row"' + clickAttr + '>' +
            '<div class="ice-history-row-top">' +
                '<div>' +
                    '<span class="ice-history-row-game">' + escapeIceName(a.game) + '</span>' +
                    '<span class="ice-history-row-time">' + timeStr + '</span>' +
                '</div>' +
                '<div class="ice-history-row-wallet ' + walletClass + '">' + walletText + '</div>' +
            '</div>' +
            '<div class="ice-history-row-body">' +
                '<div class="ice-history-row-name">' + escapeIceName(a.name) + (a.isUser ? ' (Вы)' : '') + '</div>' +
                '<div class="ice-history-row-stats">' +
                    '<div class="ice-history-row-stat"><span class="ice-history-row-stat-val">' + a.amount.toFixed(2) + '$</span><span class="ice-history-row-stat-lbl">Ставка</span></div>' +
                    '<div class="ice-history-row-stat"><span class="ice-history-row-stat-val">' + multLabel + '</span><span class="ice-history-row-stat-lbl">Кэф</span></div>' +
                    '<div class="ice-history-row-stat"><span class="ice-history-row-stat-val">' + outcomeLabel + '</span><span class="ice-history-row-stat-lbl">Итог</span></div>' +
                '</div>' +
            '</div>' +
        '</div>';
    }).join('');
}

// Клик по раунду Айс Арены в ленте действий (вкладка "Действия" в
// админ-панели) — уходит со страницы админки на Айс Арену и сразу
// показывает реплей этого раунда.
function openArenaActionReplay(roundId) {
    openIceArena();
    setTimeout(() => openIceArenaHistoryDirect(roundId), 60);
}

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

window.openArenaActionReplay = openArenaActionReplay;

window.applyBetFactor = applyBetFactor;
window.loadActionsFeed = loadActionsFeed;
window.renderActionsFeed = renderActionsFeed;
window.applyBetMax = applyBetMax;

})();
