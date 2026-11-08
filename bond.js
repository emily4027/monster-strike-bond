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

    // 隊友名單裡的其他玩家
    function makePlayer({ name, social, level, note }, now = Date.now()) {
        return { id: newId('p_'), name, social: social || { platform: 'LINE', customPlatform: '', handle: '' }, level, note: note || '', createdAt: now };
    }

    // 舊資料轉換用：同名同社群帳號 → 同一個固定 id (兩台裝置各自轉換也會得到同一筆)
    function legacyPlayerId(name, social) {
        const s = [name, social && social.platform, social && social.customPlatform, social && social.handle].map((x) => x || '').join('|');
        let h = 5381;
        for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
        return 'p_legacy_' + h.toString(36);
    }

    // 隊友是誰：{ type: 'account' | 'player', id }
    const partnerRefOf = (b) => (b.partnerAccountId ? { type: 'account', id: b.partnerAccountId }
        : b.partnerPlayerId ? { type: 'player', id: b.partnerPlayerId } : null);
    const sameRef = (b, ref) => {
        const r = partnerRefOf(b);
        return !!r && !!ref && r.type === ref.type && r.id === ref.id;
    };

    // 帳號從名單選一位隊友：以前羈絆過就從歷史接續 (最近結束的那筆)，否則從 0 開始
    // 名稱、等級等顯示用的值由 normalizeData 補上
    function selectPartner(account, ref, today, now = Date.now()) {
        const acc = JSON.parse(JSON.stringify(account));
        if (acc.bonds.length >= MAX_BONDS_PER_ACCOUNT) return { account, error: 'full' };
        if (acc.bonds.some((b) => sameRef(b, ref))) return { account, error: 'duplicate' };
        if (ref.type === 'account' && ref.id === acc.id) return { account, error: 'self' };
        const past = acc.history.filter((h) => sameRef(h, ref))
            .sort((x, y) => String(y.endedAt).localeCompare(String(x.endedAt)))[0];
        if (past && past.lastCompletedDate === today) return { account, error: 'doneToday' };   // 一天只能羈完一次
        let bond;
        if (past) {
            bond = restoreBond(past, now);
            acc.history = acc.history.filter((h) => h.id !== past.id);
        } else {
            bond = makeBond(ref.type === 'account' ? { partnerAccountId: ref.id } : { partnerPlayerId: ref.id }, today, now);
        }
        acc.bonds.push(bond);
        return { account: acc, bond, resumedFrom: past || null };
    }

    function makeBond({ partnerGameName, partnerSocial, partnerLevel, staminaPerGame, note, partnerAccountId, partnerPlayerId }, today, now = Date.now()) {
        return {
            id: newId('bond_'),
            partnerAccountId: partnerAccountId || null,   // 隊友是自己的另一個帳號
            partnerPlayerId: partnerPlayerId || null,     // 隊友是名單裡的其他玩家
            partnerGameName: partnerGameName || '',
            partnerSocial: partnerSocial || { platform: '其他', customPlatform: '', handle: '' },
            partnerLevel: partnerLevel || LEVEL_MIN,
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

    // 「還沒滿」：今天羈完而退出的隊友放回隊伍，並撤銷這次達成 (上限 +1)
    function undoDoneToday(account, entryId, settings, today, now = Date.now()) {
        const acc = JSON.parse(JSON.stringify(account));
        const entry = acc.history.find((e) => e.id === entryId);
        if (!entry || !canUndoCompletion(entry, today)) return { account, error: 'notUndoable' };
        if (acc.bonds.length >= MAX_BONDS_PER_ACCOUNT) return { account, error: 'full' };
        const r = notFullYet(restoreBond(entry, now), acc.level, settings, today);
        acc.history = acc.history.filter((e) => e.id !== entryId);
        acc.bonds.push(r.bond);
        return { account: acc, bond: r.bond, newLimit: r.newLimit };
    }

    // 某個帳號和某位隊友的進度紀錄：隊伍中的那筆，否則歷史裡最近的那筆，都沒有就是 null
    function findPair(account, ref) {
        const active = account.bonds.find((b) => sameRef(b, ref));
        if (active) return { entry: active, active: true };
        const past = account.history.filter((h) => sameRef(h, ref))
            .sort((x, y) => String(y.endedAt).localeCompare(String(x.endedAt)))[0];
        return past ? { entry: past, active: false } : null;
    }

    // 不用拉進隊伍也能調整進度：改隊伍中 / 歷史裡的那筆；都沒有就在歷史建立一筆 (之後選進隊伍會接續)
    function setPairProgress(account, ref, { cycleCount, totalCycles, completedToday }, today, now = Date.now()) {
        const acc = JSON.parse(JSON.stringify(account));
        const found = findPair(acc, ref);
        let entry;
        if (found) entry = found.entry;
        else {
            entry = { ...makeBond(ref.type === 'account' ? { partnerAccountId: ref.id } : { partnerPlayerId: ref.id }, today, now), endedAt: today };
            acc.history.unshift(entry);
        }
        entry.cycleCount = cycleCount;
        entry.totalCycles = totalCycles;
        if (completedToday) entry.lastCompletedDate = today;
        else if (entry.lastCompletedDate === today) entry.lastCompletedDate = null;
        delete entry.lastCompletion;
        return acc;
    }

    // ---------------- 資料格式整理 ----------------

    const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
    const str = (v, max = 100) => (typeof v === 'string' ? v : '').slice(0, max);
    const intOr = (v, min, max, fallback) => (Number.isInteger(v) && v >= min && v <= max ? v : fallback);
    const dateOr = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

    const idOrNull = (v) => (typeof v === 'string' && v ? v : null);
    function sanitizeSocial(raw) {
        const social = isObj(raw) ? raw : {};
        return {
            platform: SOCIAL_PLATFORMS.includes(social.platform) ? social.platform : '其他',
            customPlatform: str(social.customPlatform, 30),
            handle: str(social.handle),
        };
    }

    function sanitizePlayer(raw) {
        if (!isObj(raw) || typeof raw.id !== 'string' || !raw.id) return null;
        return {
            id: raw.id,
            name: str(raw.name) || '未命名',
            social: sanitizeSocial(raw.social),
            level: intOr(raw.level, LEVEL_MIN, LEVEL_MAX, LEVEL_MIN),
            note: str(raw.note, 300),
            createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : 0,
        };
    }

    function sanitizeBond(raw) {
        if (!isObj(raw) || typeof raw.id !== 'string' || !raw.id) return null;
        const b = {
            id: raw.id,
            partnerAccountId: idOrNull(raw.partnerAccountId),
            partnerPlayerId: idOrNull(raw.partnerPlayerId),
            partnerGameName: str(raw.partnerGameName),
            partnerSocial: sanitizeSocial(raw.partnerSocial),
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
        return { settings: { staminaPerGame: DEFAULT_STAMINA_PER_GAME }, roster: [], accounts: [] };
    }

    function sanitizeData(raw) {
        const data = emptyData();
        if (!isObj(raw)) return data;
        if (isObj(raw.settings)) data.settings.staminaPerGame = intOr(raw.settings.staminaPerGame, 1, STAMINA_PER_GAME_MAX, DEFAULT_STAMINA_PER_GAME);
        data.roster = (Array.isArray(raw.roster) ? raw.roster : []).map(sanitizePlayer).filter(Boolean);
        data.accounts = (Array.isArray(raw.accounts) ? raw.accounts : []).map(sanitizeAccount).filter(Boolean);
        return data;
    }

    // 每次修改後 (以及載入時) 整理資料：
    //   1. 隊友是自己的帳號 → 名稱、等級跟著那個帳號；那個帳號被刪除 → 改成名單裡的其他玩家，保留最後的值
    //   2. 隊友是名單裡的玩家 → 名稱、社群帳號、等級跟著名單
    //   3. 舊版資料 (隊友資料直接存在羈絆裡) → 移到名單，同名同社群帳號合併成一筆
    //   4. 等級差跨格或每場體力改變 → 清掉失效的修正場數
    // 回傳新資料與清掉幾段的修正值
    // today 有給的話：今天已羈完的隊友自動退出隊伍 (移到歷史，保留進度與「還沒滿」需要的資料)，空出位子給其他隊友
    function normalizeData(data, today = null) {
        const d = JSON.parse(JSON.stringify(data));
        if (!Array.isArray(d.roster)) d.roster = [];
        const byId = new Map(d.accounts.map((a) => [a.id, a]));
        const players = new Map(d.roster.map((p) => [p.id, p]));
        let cleared = 0;
        const toRosterPlayer = (b) => {
            const id = legacyPlayerId(b.partnerGameName, b.partnerSocial);
            if (!players.has(id)) {
                const p = { id, name: b.partnerGameName || '未命名', social: { ...b.partnerSocial }, level: b.partnerLevel || LEVEL_MIN, note: b.note || '', createdAt: b.createdAt || 0 };
                players.set(id, p);
                d.roster.push(p);
            }
            b.partnerAccountId = null;
            b.partnerPlayerId = id;
        };
        const fix = (acc, b, reconcile) => {
            if (b.partnerAccountId) {
                const target = byId.get(b.partnerAccountId);
                if (target && target.id !== acc.id) {
                    b.partnerPlayerId = null;
                    b.partnerGameName = target.name;
                    b.partnerLevel = target.level;
                } else toRosterPlayer(b);
            } else if (b.partnerPlayerId) {
                const p = players.get(b.partnerPlayerId);
                if (p) {
                    b.partnerGameName = p.name;
                    b.partnerLevel = p.level;
                    b.partnerSocial = { ...p.social };
                } else if (reconcile) toRosterPlayer(b);   // 進行中的羈絆不能沒有隊友
                else b.partnerPlayerId = null;            // 歷史紀錄：玩家已從名單刪除，保留名稱就好
            } else if (reconcile || b.partnerGameName) toRosterPlayer(b);
            if (!reconcile) return b;
            const r = reconcileOverride(b, acc.level, d.settings);
            if (r.cleared) cleared++;
            return r.bond;
        };
        d.accounts.forEach((acc) => {
            acc.bonds = acc.bonds.map((b) => fix(acc, b, true));
            acc.history = acc.history.map((b) => fix(acc, b, false));
        });
        repairOwnPairs(d, today);
        d.accounts.forEach((acc) => {
            if (today) {
                const done = acc.bonds.filter((b) => b.lastCompletedDate === today);
                if (done.length) {
                    acc.bonds = acc.bonds.filter((b) => b.lastCompletedDate !== today);
                    acc.history.unshift(...done.map((b) => ({ ...b, endedAt: today })));
                }
            }
        });
        return { data: d, cleared };
    }

    // ---------------- 自己兩個帳號之間的羈絆：同一段，兩邊各存一份、保持一致 ----------------
    // 羽入和梨花的羈絆 = 梨花和羽入的羈絆：兩個帳號的隊伍都有它 (各佔一個位子)，次數、場數、今天羈完都一樣

    const PAIR_FIELDS = ['cycleCount', 'totalCycles', 'gamesPlayed', 'gamesOverride', 'overrideBasis',
        'lastCompletedDate', 'lastCompletion', 'staminaPerGame', 'startedAt', 'endedAt'];
    const pairKey = (entry, active) => stableStringify([active, ...PAIR_FIELDS.map((f) => (active && f === 'endedAt' ? null : entry[f] === undefined ? null : entry[f]))]);
    const isOwnPair = (acc, e, ids) => !!e.partnerAccountId && e.partnerAccountId !== acc.id && ids.has(e.partnerAccountId);

    // 某帳號裡和 partnerId 那段羈絆的位置：隊伍中優先，否則最近結束的歷史
    function locatePair(acc, partnerId) {
        const ref = { type: 'account', id: partnerId };
        const i = acc.bonds.findIndex((b) => sameRef(b, ref));
        if (i >= 0) return { list: 'bonds', index: i, entry: acc.bonds[i], active: true };
        let best = -1;
        acc.history.forEach((h, j) => {
            if (sameRef(h, ref) && (best < 0 || String(h.endedAt) > String(acc.history[best].endedAt))) best = j;
        });
        return best >= 0 ? { list: 'history', index: best, entry: acc.history[best], active: false } : null;
    }

    // 把 src (在 A 帳號、active 表示在隊伍中) 的進度複製到 B 帳號裡對應的那一筆，位置也跟著 (隊伍 / 歷史)
    function placeCounterpart(A, B, src, active, today) {
        const loc = locatePair(B, A.id);
        let cp;
        if (loc) {
            cp = loc.entry;
            B[loc.list].splice(loc.index, 1);
        } else {
            cp = makeBond({ partnerAccountId: A.id, partnerGameName: A.name, partnerLevel: A.level }, src.startedAt || today);
        }
        PAIR_FIELDS.forEach((f) => {
            if (src[f] === undefined) delete cp[f];
            else cp[f] = JSON.parse(JSON.stringify(src[f]));
        });
        const toActive = active && B.bonds.length < MAX_BONDS_PER_ACCOUNT;
        if (toActive) {
            delete cp.endedAt;
            if (loc && loc.list === 'bonds') B.bonds.splice(loc.index, 0, cp); else B.bonds.push(cp);
        } else {
            if (!cp.endedAt) cp.endedAt = today || src.startedAt || null;
            if (loc && loc.list === 'history') B.history.splice(loc.index, 0, cp); else B.history.unshift(cp);
        }
    }

    // 修改後：把這次有變的「自己帳號之間的羈絆」複製到另一邊；刪掉的歷史另一邊也刪
    function mirrorOwnPairs(before, after, today) {
        const d = JSON.parse(JSON.stringify(after));
        const ids = new Set(d.accounts.map((a) => a.id));
        const prev = new Map();
        (before && before.accounts || []).forEach((acc) => {
            acc.bonds.forEach((e) => prev.set(e.id, { accId: acc.id, entry: e, active: true }));
            acc.history.forEach((e) => prev.set(e.id, { accId: acc.id, entry: e, active: false }));
        });
        const present = new Set();
        const changed = [];
        d.accounts.forEach((acc) => [['bonds', true], ['history', false]].forEach(([list, active]) => acc[list].forEach((e) => {
            present.add(e.id);
            if (!isOwnPair(acc, e, ids)) return;
            const p = prev.get(e.id);
            if (!p || pairKey(p.entry, p.active) !== pairKey(e, active)) changed.push({ accId: acc.id, id: e.id });
        })));
        const done = new Set();
        changed.forEach(({ accId, id }) => {
            const A = d.accounts.find((a) => a.id === accId);
            const where = A.bonds.find((b) => b.id === id) ? 'bonds' : 'history';
            const e = A[where].find((x) => x.id === id);
            const key = [accId, e.partnerAccountId].sort().join('|');
            if (done.has(key)) return;   // 同一次兩邊都改了：以先找到的為準
            done.add(key);
            placeCounterpart(A, d.accounts.find((a) => a.id === e.partnerAccountId), e, where === 'bonds', today);
        });
        prev.forEach((p, id) => {
            if (present.has(id) || p.active || !ids.has(p.accId) || !p.entry.partnerAccountId || !ids.has(p.entry.partnerAccountId)) return;
            const B = d.accounts.find((a) => a.id === p.entry.partnerAccountId);
            const i = B.history.findIndex((h) => h.partnerAccountId === p.accId && h.endedAt === p.entry.endedAt && h.cycleCount === p.entry.cycleCount);
            if (i >= 0) B.history.splice(i, 1);
        });
        return d;
    }

    // 載入 / 合併後：兩邊不一致 (或只有一邊有) 時，用比較「新」的那邊補齊另一邊
    //   隊伍中 > 今天羈完 > 最近結束；再一樣就看次數多的
    function repairOwnPairs(d, today) {
        const ids = new Set(d.accounts.map((a) => a.id));
        const byId = new Map(d.accounts.map((a) => [a.id, a]));
        const score = (loc) => (!loc ? [-1] : [
            loc.active ? 3 : loc.entry.lastCompletedDate && loc.entry.lastCompletedDate === today ? 2 : 1,
            loc.active ? '' : String(loc.entry.endedAt || ''),
            loc.entry.totalCycles * CYCLE_LENGTH + loc.entry.cycleCount,
            loc.entry.gamesPlayed || 0,
        ]);
        const better = (x, y) => {
            for (let i = 0; i < x.length; i++) { if (x[i] > y[i]) return true; if (x[i] < y[i]) return false; }
            return false;
        };
        const seen = new Set();
        d.accounts.forEach((A) => [...A.bonds, ...A.history].forEach((e) => {
            if (!isOwnPair(A, e, ids)) return;
            const B = byId.get(e.partnerAccountId);
            const key = [A.id, B.id].sort().join('|');
            if (seen.has(key)) return;
            seen.add(key);
            const la = locatePair(A, B.id), lb = locatePair(B, A.id);
            if (la && lb && pairKey(la.entry, la.active) === pairKey(lb.entry, lb.active)) return;
            if (better(score(lb), score(la))) placeCounterpart(B, A, lb.entry, lb.active, today);
            else placeCounterpart(A, B, la.entry, la.active, today);
        }));
    }

    // 選自己的另一個帳號當隊友 / 放回隊伍時，對方隊伍也要有位子 (已經在對方隊伍裡就不用)
    function ownPairHasRoom(data, partnerAccountId, accId) {
        const B = data.accounts.find((a) => a.id === partnerAccountId);
        if (!B) return true;
        return B.bonds.length < MAX_BONDS_PER_ACCOUNT || B.bonds.some((b) => b.partnerAccountId === accId);
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
        (data.roster || []).forEach((p) => out.push({ key: 'p:' + p.id, value: p }));
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
        data.roster = records.filter((r) => r.key.startsWith('p:')).map((r) => r.value).sort(byCreated);
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
        makeAccount, makeBond, makePlayer, endBond, restoreBond, legacyPlayerId, partnerRefOf, sameRef, selectPartner, undoDoneToday, findPair, setPairProgress,
        emptyData, sanitizeData, normalizeData, mirrorOwnPairs, ownPairHasRoom,
        cloudStampOf, sameStamp, stableStringify, mergeData, sameData, countChanges,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.BondLogic = api;
})(this);
