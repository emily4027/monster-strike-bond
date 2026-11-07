// =====================================================
// 羈絆計算與資料處理 (純函式，不碰 DOM / Firebase)
// 瀏覽器：window.BondLogic；Node (測試)：require('./bond.js')
// =====================================================
(function (root) {
    'use strict';

    // ---------------- 設定常數 ----------------

    // 跑滿一次羈絆條需要的體力 (依等級差，原表為大約值)。maxDiff 是這一格的等級差上限 (含)。
    const STAMINA_TABLE = [
        { maxDiff: 25, stamina: 215 },
        { maxDiff: 50, stamina: 175 },
        { maxDiff: 75, stamina: 150 },
        { maxDiff: 100, stamina: 125 },
        { maxDiff: 150, stamina: 115 },
        { maxDiff: 200, stamina: 100 },
        { maxDiff: 300, stamina: 75 },
        { maxDiff: Infinity, stamina: 50 },
    ];

    // 每輪 20 次的獎勵；orbTicket 標記寶珠交換券 (「還差幾天」依這個標記計算)
    const REWARDS = [
        { name: '紅億經驗龜 x3體' },
        { name: '藍億經驗龜 x3體' },
        { name: '獸神龍・紅 x1體' },
        { name: '綠億經驗龜 x3體' },
        { name: '體力罐 x1個' },
        { name: '光億經驗龜 x3體' },
        { name: '獸神龍・蒼 x1體' },
        { name: '億經驗龜 x3體' },
        { name: '紅億經驗龜 x3體' },
        { name: '寶珠交換券 x1張', orbTicket: true },
        { name: '獸神龍・碧 x1體' },
        { name: '藍億經驗龜 x3體' },
        { name: '綠億經驗龜 x3體' },
        { name: '獸神龍・光 x1體' },
        { name: '降神玉 x1個' },
        { name: '光億經驗龜 x3體' },
        { name: '億經驗龜 x3體' },
        { name: '獸神龍・闇 x1體' },
        { name: '綠億經驗龜 x3體' },
        { name: '寶珠交換券 x1張', orbTicket: true },
    ];
    const CYCLE_LENGTH = REWARDS.length;

    // 「今天」一律用台灣時間 (UTC+8) 判斷，不看裝置時區；每天 DAY_RESET_HOUR 點換日
    const TIMEZONE_OFFSET_HOURS = 8;
    const DAY_RESET_HOUR = 0;

    const DEFAULT_STAMINA_PER_GAME = 60;
    const MAX_BONDS_PER_ACCOUNT = 3;
    const LEVEL_MIN = 1;
    const LEVEL_MAX = 9999;
    const STAMINA_PER_GAME_MAX = 999;
    const SOCIAL_PLATFORMS = ['LINE', 'Discord', 'Facebook', 'Instagram', '其他'];

    // ---------------- 日期 ----------------

    const HOUR_MS = 3600 * 1000;

    // 遊戲日 (YYYY-MM-DD)。所有「今天」的判斷都要經過這個函式
    function getGameDate(now = Date.now()) {
        const ms = now instanceof Date ? now.getTime() : now;
        return new Date(ms + (TIMEZONE_OFFSET_HOURS - DAY_RESET_HOUR) * HOUR_MS).toISOString().slice(0, 10);
    }

    function addDays(dateStr, days) {
        const d = new Date(dateStr + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() + days);
        return d.toISOString().slice(0, 10);
    }

    // ---------------- 數字驗證 ----------------

    // 正整數字串 → 數字；不合法回傳 null
    function parseIntInRange(value, min, max) {
        const s = String(value === undefined || value === null ? '' : value).trim();
        if (!/^\d+$/.test(s)) return null;
        const n = Number(s);
        return n >= min && n <= max ? n : null;
    }
    const parseLevel = (v) => parseIntInRange(v, LEVEL_MIN, LEVEL_MAX);
    const parseStaminaPerGame = (v) => parseIntInRange(v, 1, STAMINA_PER_GAME_MAX);

    // ---------------- 場數計算 ----------------

    const levelDiff = (myLevel, partnerLevel) => Math.abs(myLevel - partnerLevel);
    const bracketIndexFor = (diff) => STAMINA_TABLE.findIndex((row) => diff <= row.maxDiff);
    const staminaForDiff = (diff) => STAMINA_TABLE[bracketIndexFor(diff)].stamina;

    const staminaPerGameFor = (bond, settings) =>
        (Number.isInteger(bond.staminaPerGame) && bond.staminaPerGame > 0)
            ? bond.staminaPerGame
            : (settings && settings.staminaPerGame) || DEFAULT_STAMINA_PER_GAME;

    const estimateGames = (stamina, staminaPerGame) => Math.max(1, Math.ceil(stamina / staminaPerGame));

    // 修正過的場數只在「等級差同一格、每場體力相同」時有效
    function overrideBasisFor(bond, myLevel, settings) {
        return {
            bracketIndex: bracketIndexFor(levelDiff(myLevel, bond.partnerLevel)),
            staminaPerGame: staminaPerGameFor(bond, settings),
        };
    }
    function isOverrideValid(bond, myLevel, settings) {
        if (!Number.isInteger(bond.gamesOverride) || bond.gamesOverride < 1 || !bond.overrideBasis) return false;
        const now = overrideBasisFor(bond, myLevel, settings);
        return bond.overrideBasis.bracketIndex === now.bracketIndex
            && bond.overrideBasis.staminaPerGame === now.staminaPerGame;
    }

    // 跑滿一次需要幾場，以及計算用的中間值
    function gameLimit(bond, myLevel, settings) {
        const diff = levelDiff(myLevel, bond.partnerLevel);
        const bracketIndex = bracketIndexFor(diff);
        const stamina = STAMINA_TABLE[bracketIndex].stamina;
        const staminaPerGame = staminaPerGameFor(bond, settings);
        const estimate = estimateGames(stamina, staminaPerGame);
        const overridden = isOverrideValid(bond, myLevel, settings);
        return { diff, bracketIndex, stamina, staminaPerGame, estimate, overridden, limit: overridden ? bond.gamesOverride : estimate };
    }

    const isCompletedToday = (bond, today) => bond.lastCompletedDate === today;

    // 今天還差幾場、大約幾體
    function todayStatus(bond, myLevel, settings, today) {
        const info = gameLimit(bond, myLevel, settings);
        const completedToday = isCompletedToday(bond, today);
        const played = bond.gamesPlayed || 0;
        const remainingGames = completedToday ? 0 : Math.max(0, info.limit - played);
        const remainingStamina = completedToday ? 0 : info.overridden
            ? remainingGames * info.staminaPerGame
            : Math.max(0, info.stamina - played * info.staminaPerGame);
        return { ...info, completedToday, played, remainingGames, remainingStamina };
    }

    // ---------------- 達成次數與獎勵 ----------------

    // 第 n 次 (1–20) 的獎勵
    const rewardFor = (n) => REWARDS[n - 1];
    const nextCompletionNumber = (cycleCount) => cycleCount + 1;

    // 寶珠交換券還差幾次 / 幾天
    function ticketInfo(cycleCount, completedToday) {
        const next = cycleCount + 1;
        let ticketNo = null;
        for (let n = next; n <= CYCLE_LENGTH; n++) if (REWARDS[n - 1].orbTicket) { ticketNo = n; break; }
        if (ticketNo === null) {   // 本輪後面沒有券：下一輪的第一張
            const first = REWARDS.findIndex((r) => r.orbTicket) + 1;
            ticketNo = CYCLE_LENGTH + first;
        }
        const remaining = ticketNo - cycleCount;
        return {
            ticketNo: ((ticketNo - 1) % CYCLE_LENGTH) + 1,
            remaining,                                  // 還要達成幾次 (= 還差幾天)
            days: remaining,
            includesToday: !completedToday,             // 今天還沒達成：天數含今天
            todayGetsTicket: !completedToday && remaining === 1,
            tomorrowGetsTicket: completedToday && remaining === 1,
        };
    }

    const cloneBond = (b) => JSON.parse(JSON.stringify(b));

    // 達成一次：次數 +1 (第 20 次後回到 0)、羈絆條歸 0
    function applyCompletion(bond, today, auto) {
        const b = cloneBond(bond);
        const number = b.cycleCount + 1;
        b.lastCompletion = {
            date: today,
            auto: !!auto,
            gamesAtCompletion: b.gamesPlayed || 0,
            prevCycleCount: b.cycleCount,
            prevTotalCycles: b.totalCycles,
            prevLastCompletedDate: b.lastCompletedDate || null,
            prevGamesOverride: Number.isInteger(b.gamesOverride) ? b.gamesOverride : null,
            prevOverrideBasis: b.overrideBasis || null,
        };
        b.cycleCount = number >= CYCLE_LENGTH ? 0 : number;
        if (number >= CYCLE_LENGTH) b.totalCycles = (b.totalCycles || 0) + 1;
        b.lastCompletedDate = today;
        b.gamesPlayed = 0;
        return { bond: b, number, reward: rewardFor(number) };
    }

    // 打完一場：場數 +1，到達上限就自動達成
    function addGame(bond, myLevel, settings, today) {
        if (isCompletedToday(bond, today)) return { bond, completion: null, blocked: true };
        const b = cloneBond(bond);
        b.gamesPlayed = (b.gamesPlayed || 0) + 1;
        const { limit } = gameLimit(b, myLevel, settings);
        if (b.gamesPlayed >= limit) {
            const c = applyCompletion(b, today, true);
            return { bond: c.bond, completion: { number: c.number, reward: c.reward } };
        }
        return { bond: b, completion: null };
    }

    // 按錯「＋1 場」時減回來
    function removeGame(bond) {
        const b = cloneBond(bond);
        b.gamesPlayed = Math.max(0, (b.gamesPlayed || 0) - 1);
        return b;
    }

    function setOverride(b, games, myLevel, settings) {
        b.gamesOverride = games;
        b.overrideBasis = overrideBasisFor(b, myLevel, settings);
    }

    // 「已經滿了」：比估計的早跑滿 → 立刻達成，上限改成目前的場數
    function markFull(bond, myLevel, settings, today) {
        if (isCompletedToday(bond, today)) return { bond, completion: null, blocked: true };
        const b = cloneBond(bond);
        const played = b.gamesPlayed || 0;
        const c = applyCompletion(b, today, false);
        if (played >= 1) setOverride(c.bond, played, myLevel, settings);
        return { bond: c.bond, completion: { number: c.number, reward: c.reward }, newLimit: played >= 1 ? played : null };
    }

    const canUndoCompletion = (bond, today) =>
        !!bond.lastCompletion && bond.lastCompletion.date === today && bond.lastCompletedDate === today;

    // 「還沒滿」：撤銷今天這次達成，上限改成「達成時的場數 + 1」
    function notFullYet(bond, myLevel, settings, today) {
        if (!canUndoCompletion(bond, today)) return { bond, undone: false };
        const b = cloneBond(bond);
        const lc = b.lastCompletion;
        b.cycleCount = lc.prevCycleCount;
        b.totalCycles = lc.prevTotalCycles;
        b.lastCompletedDate = lc.prevLastCompletedDate;
        b.gamesPlayed = lc.gamesAtCompletion;
        b.gamesOverride = lc.prevGamesOverride;
        b.overrideBasis = lc.prevOverrideBasis;
        delete b.lastCompletion;
        const newLimit = Math.max(lc.gamesAtCompletion, 0) + 1;
        setOverride(b, newLimit, myLevel, settings);
        return { bond: b, undone: true, newLimit };
    }

    // 等級或每場體力改變後：修正值失效就清掉
    function reconcileOverride(bond, myLevel, settings) {
        if (bond.gamesOverride == null) return { bond, cleared: false };
        if (isOverrideValid(bond, myLevel, settings)) return { bond, cleared: false };
        const b = cloneBond(bond);
        b.gamesOverride = null;
        b.overrideBasis = null;
        return { bond: b, cleared: true };
    }

    // 「修改次數」：直接設定次數、今天是否已達成、目前場數、上限 (null = 用估算)
    function setCounts(bond, { cycleCount, completedToday, gamesPlayed, limit }, myLevel, settings, today) {
        const b = cloneBond(bond);
        b.cycleCount = cycleCount;
        b.gamesPlayed = gamesPlayed;
        if (completedToday) b.lastCompletedDate = today;
        else if (b.lastCompletedDate === today) b.lastCompletedDate = null;
        delete b.lastCompletion;
        if (limit == null) { b.gamesOverride = null; b.overrideBasis = null; }
        else setOverride(b, limit, myLevel, settings);
        return b;
    }

    // ---------------- 建立 / 結束 / 找回 ----------------

    function newId(prefix) {
        return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }

    function makeAccount({ name, level }, now = Date.now()) {
        return { id: newId('acc_'), name, level, createdAt: now, bonds: [], history: [] };
    }

    function makeBond({ partnerGameName, partnerSocial, partnerLevel, staminaPerGame, note }, today, now = Date.now()) {
        return {
            id: newId('bond_'),
            partnerGameName,
            partnerSocial: partnerSocial || { platform: 'LINE', handle: '' },
            partnerLevel,
            staminaPerGame: Number.isInteger(staminaPerGame) ? staminaPerGame : null,
            cycleCount: 0,
            totalCycles: 0,
            gamesPlayed: 0,
            gamesOverride: null,
            overrideBasis: null,
            lastCompletedDate: null,
            startedAt: today,
            createdAt: now,
            note: note || '',
        };
    }

    // 結束羈絆：完整進度留在歷史紀錄，之後可以找回
    function endBond(bond, today) {
        const b = cloneBond(bond);
        delete b.lastCompletion;
        return { ...b, endedAt: today };
    }

    function restoreBond(entry, now = Date.now()) {
        const b = cloneBond(entry);
        delete b.endedAt;
        b.createdAt = now;
        return b;
    }

    // ---------------- 資料格式整理 ----------------

    const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
    const str = (v, max = 100) => (typeof v === 'string' ? v : '').slice(0, max);
    const intOr = (v, min, max, fallback) => (Number.isInteger(v) && v >= min && v <= max ? v : fallback);
    const dateOr = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

    function sanitizeBond(raw) {
        if (!isObj(raw) || typeof raw.id !== 'string' || !raw.id) return null;
        const social = isObj(raw.partnerSocial) ? raw.partnerSocial : {};
        const b = {
            id: raw.id,
            partnerGameName: str(raw.partnerGameName),
            partnerSocial: {
                platform: SOCIAL_PLATFORMS.includes(social.platform) ? social.platform : '其他',
                customPlatform: str(social.customPlatform, 30),
                handle: str(social.handle),
            },
            partnerLevel: intOr(raw.partnerLevel, LEVEL_MIN, LEVEL_MAX, LEVEL_MIN),
            staminaPerGame: intOr(raw.staminaPerGame, 1, STAMINA_PER_GAME_MAX, null),
            cycleCount: intOr(raw.cycleCount, 0, CYCLE_LENGTH - 1, 0),
            totalCycles: intOr(raw.totalCycles, 0, 1e6, 0),
            gamesPlayed: intOr(raw.gamesPlayed, 0, 999, 0),
            gamesOverride: intOr(raw.gamesOverride, 1, 999, null),
            overrideBasis: isObj(raw.overrideBasis)
                && Number.isInteger(raw.overrideBasis.bracketIndex) && Number.isInteger(raw.overrideBasis.staminaPerGame)
                ? { bracketIndex: raw.overrideBasis.bracketIndex, staminaPerGame: raw.overrideBasis.staminaPerGame } : null,
            lastCompletedDate: dateOr(raw.lastCompletedDate),
            startedAt: dateOr(raw.startedAt),
            createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : 0,
            note: str(raw.note, 300),
        };
        if (isObj(raw.lastCompletion) && dateOr(raw.lastCompletion.date)) b.lastCompletion = raw.lastCompletion;
        if (dateOr(raw.endedAt)) b.endedAt = raw.endedAt;
        return b;
    }

    function sanitizeAccount(raw) {
        if (!isObj(raw) || typeof raw.id !== 'string' || !raw.id) return null;
        return {
            id: raw.id,
            name: str(raw.name) || '未命名帳號',
            level: intOr(raw.level, LEVEL_MIN, LEVEL_MAX, LEVEL_MIN),
            createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : 0,
            bonds: (Array.isArray(raw.bonds) ? raw.bonds : []).map(sanitizeBond).filter(Boolean),
            history: (Array.isArray(raw.history) ? raw.history : []).map(sanitizeBond).filter(Boolean),
        };
    }

    function emptyData() {
        return { settings: { staminaPerGame: DEFAULT_STAMINA_PER_GAME }, accounts: [] };
    }

    function sanitizeData(raw) {
        const data = emptyData();
        if (!isObj(raw)) return data;
        if (isObj(raw.settings)) data.settings.staminaPerGame = intOr(raw.settings.staminaPerGame, 1, STAMINA_PER_GAME_MAX, DEFAULT_STAMINA_PER_GAME);
        data.accounts = (Array.isArray(raw.accounts) ? raw.accounts : []).map(sanitizeAccount).filter(Boolean);
        return data;
    }

    // ---------------- 雲端同步：版本比對與三方合併 ----------------

    const cloudStampOf = (data) => ({
        version: data && Number.isInteger(data.version) ? data.version : 0,
        updatedAt: (data && data.lastUpdated && typeof data.lastUpdated.toMillis === 'function') ? data.lastUpdated.toMillis() : null,
    });
    const sameStamp = (a, b) => !!a && !!b && a.version === b.version && a.updatedAt === b.updatedAt;

    const stableStringify = (v) => {
        if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
        if (v && typeof v === 'object') {
            return '{' + Object.keys(v).filter((k) => v[k] !== undefined).sort()
                .map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
        }
        return JSON.stringify(v === undefined ? null : v);
    };
    const sameRecord = (a, b) => (a === undefined || b === undefined) ? a === b : stableStringify(a) === stableStringify(b);

    // 巢狀資料 → 以 id 為單位的扁平紀錄 (設定 / 帳號 / 羈絆 / 歷史各自一筆)
    function flatten(data) {
        const out = [{ key: 'settings', value: data.settings }];
        data.accounts.forEach((a) => {
            const { bonds, history, ...acc } = a;
            out.push({ key: 'a:' + a.id, value: acc });
            bonds.forEach((b) => out.push({ key: 'b:' + b.id, value: { ...b, accountId: a.id } }));
            history.forEach((h) => out.push({ key: 'h:' + h.id, value: { ...h, accountId: a.id } }));
        });
        return out;
    }

    function unflatten(records) {
        const data = emptyData();
        const byCreated = (x, y) => (x.createdAt || 0) - (y.createdAt || 0);
        const accounts = new Map();
        records.filter((r) => r.key.startsWith('a:')).map((r) => r.value).sort(byCreated)
            .forEach((a) => accounts.set(a.id, { ...a, bonds: [], history: [] }));
        records.forEach(({ key, value }) => {
            if (key === 'settings') data.settings = value;
            const list = key.startsWith('b:') ? 'bonds' : key.startsWith('h:') ? 'history' : null;
            if (!list) return;
            const acc = accounts.get(value.accountId);
            if (!acc) return;   // 帳號已被刪除
            const { accountId, ...rest } = value;
            acc[list].push(rest);
        });
        accounts.forEach((a) => { a.bonds.sort(byCreated); a.history.sort((x, y) => String(y.endedAt).localeCompare(String(x.endedAt))); });
        data.accounts = [...accounts.values()];
        return data;
    }

    // 以 id 逐筆比較：只有一邊改了 → 用改了的那邊；兩邊都改了同一筆 → 以本機為準 (計入 conflicts)
    function mergeData(base, local, remote) {
        const toMap = (d) => new Map(flatten(d).map((r) => [r.key, r.value]));
        const b = toMap(base), l = toMap(local), r = toMap(remote);
        const keys = [...new Set([...r.keys(), ...l.keys(), ...b.keys()])];
        const merged = [];
        let conflicts = 0;
        keys.forEach((key) => {
            const bv = b.get(key), lv = l.get(key), rv = r.get(key);
            let v;
            if (sameRecord(lv, rv)) v = lv;
            else if (sameRecord(lv, bv)) v = rv;
            else if (sameRecord(rv, bv)) v = lv;
            else if (!lv || !rv) v = lv || rv;   // 一邊刪除、另一邊修改 → 保留修改
            else { v = lv; conflicts++; }
            if (v !== undefined) merged.push({ key, value: v });
        });
        return { data: unflatten(merged), conflicts };
    }

    const sameData = (a, b) => stableStringify(unflatten(flatten(a))) === stableStringify(unflatten(flatten(b)));

    function countChanges(base, local) {
        const bm = new Map(flatten(base).map((r) => [r.key, r.value]));
        const lm = new Map(flatten(local).map((r) => [r.key, r.value]));
        let n = 0;
        lm.forEach((v, k) => { if (!sameRecord(bm.get(k), v)) n++; });
        bm.forEach((_, k) => { if (!lm.has(k)) n++; });
        return n;
    }

    const api = {
        STAMINA_TABLE, REWARDS, CYCLE_LENGTH, TIMEZONE_OFFSET_HOURS, DAY_RESET_HOUR,
        DEFAULT_STAMINA_PER_GAME, MAX_BONDS_PER_ACCOUNT, LEVEL_MIN, LEVEL_MAX, STAMINA_PER_GAME_MAX, SOCIAL_PLATFORMS,
        getGameDate, addDays, parseLevel, parseStaminaPerGame, parseIntInRange,
        levelDiff, bracketIndexFor, staminaForDiff, staminaPerGameFor, estimateGames,
        isOverrideValid, gameLimit, isCompletedToday, todayStatus,
        rewardFor, nextCompletionNumber, ticketInfo,
        addGame, removeGame, markFull, notFullYet, canUndoCompletion, reconcileOverride, setCounts,
        makeAccount, makeBond, endBond, restoreBond,
        emptyData, sanitizeData,
        cloudStampOf, sameStamp, stableStringify, mergeData, sameData, countChanges,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.BondLogic = api;
})(this);
