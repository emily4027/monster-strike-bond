// 執行：node --test tests/
// 羈絆計算 (bond.js)：計畫書第 3.5 節的範例
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../bond.js');

const settings = { staminaPerGame: 60 };
const TODAY = '2026-11-08';
const bondWith = (partnerLevel, extra = {}) => ({ ...L.makeBond({ partnerGameName: 'P', partnerLevel }, '2026-11-01', 1), ...extra });

test('遊戲日：固定台灣時間 00:00 換日，不看裝置時區', () => {
    assert.equal(L.getGameDate(Date.UTC(2026, 10, 7, 15, 59)), '2026-11-07');   // 台灣 23:59
    assert.equal(L.getGameDate(Date.UTC(2026, 10, 7, 16, 0)), '2026-11-08');    // 台灣 00:00
    assert.equal(L.addDays('2026-12-31', 1), '2027-01-01');
});

test('查表：等級差取絕對值，邊界值', () => {
    const cases = [[0, 215], [25, 215], [26, 175], [50, 175], [51, 150], [75, 150], [76, 125], [100, 125],
        [101, 115], [150, 115], [151, 100], [200, 100], [201, 75], [300, 75], [301, 50], [5000, 50]];
    for (const [diff, stamina] of cases) assert.equal(L.staminaForDiff(diff), stamina, `diff ${diff}`);
    assert.equal(L.levelDiff(800, 1200), 400);
    assert.equal(L.levelDiff(1200, 800), 400);
});

test('場數：第 3.5 節範例', () => {
    const rows = [
        { my: 1500, partner: 1490, played: 0, spg: null, diff: 10, stamina: 215, games: 4, remaining: 4 },
        { my: 1500, partner: 1450, played: 1, spg: null, diff: 50, stamina: 175, games: 3, remaining: 2 },
        { my: 1500, partner: 1449, played: 0, spg: null, diff: 51, stamina: 150, games: 3, remaining: 3 },
        { my: 800, partner: 1200, played: 0, spg: null, diff: 400, stamina: 50, games: 1, remaining: 1 },
        { my: 1500, partner: 1250, played: 0, spg: 40, diff: 250, stamina: 75, games: 2, remaining: 2 },
    ];
    for (const r of rows) {
        const s = L.todayStatus(bondWith(r.partner, { gamesPlayed: r.played, staminaPerGame: r.spg }), r.my, settings, TODAY);
        assert.equal(s.diff, r.diff);
        assert.equal(s.stamina, r.stamina);
        assert.equal(s.limit, r.games);
        assert.equal(s.remainingGames, r.remaining);
    }
    // 還差體力：沒修正時用「表上體力 − 已打場數 × 每場體力」
    assert.equal(L.todayStatus(bondWith(1450, { gamesPlayed: 1 }), 1500, settings, TODAY).remainingStamina, 115);
});

test('寶珠券還差幾天', () => {
    let t = L.ticketInfo(0, false);
    assert.equal(t.days, 10); assert.equal(t.includesToday, true); assert.equal(t.ticketNo, 10);
    assert.equal(L.rewardFor(L.nextCompletionNumber(0)).name, '紅億經驗龜 x3體');

    t = L.ticketInfo(8, false);
    assert.equal(t.days, 2); assert.equal(t.includesToday, true);

    t = L.ticketInfo(9, false);
    assert.equal(t.todayGetsTicket, true);

    t = L.ticketInfo(9, true);
    assert.equal(t.days, 1); assert.equal(t.includesToday, false); assert.equal(t.tomorrowGetsTicket, true);

    t = L.ticketInfo(10, false);
    assert.equal(t.days, 10); assert.equal(t.ticketNo, 20);

    t = L.ticketInfo(19, false);
    assert.equal(t.todayGetsTicket, true); assert.equal(t.ticketNo, 20);
});

test('＋1 場：跑滿自動達成，次數 +1、羈絆條歸 0', () => {
    let b = bondWith(1490);   // 4 場
    for (let i = 0; i < 3; i++) {
        const r = L.addGame(b, 1500, settings, TODAY);
        assert.equal(r.completion, null);
        b = r.bond;
    }
    assert.equal(b.gamesPlayed, 3);
    const r = L.addGame(b, 1500, settings, TODAY);
    assert.equal(r.completion.number, 1);
    assert.equal(r.completion.reward.name, '紅億經驗龜 x3體');
    assert.equal(r.bond.cycleCount, 1);
    assert.equal(r.bond.gamesPlayed, 0);
    assert.equal(r.bond.lastCompletedDate, TODAY);
    // 今天已達成：不能再加場數
    assert.equal(L.addGame(r.bond, 1500, settings, TODAY).blocked, true);
    // 隔天可以繼續，次數不中斷
    assert.equal(L.addGame(r.bond, 1500, settings, '2026-11-10').bond.gamesPlayed, 1);
});

test('羈絆條換日不歸零', () => {
    const b = bondWith(1490, { gamesPlayed: 2 });
    assert.equal(L.todayStatus(b, 1500, settings, '2026-11-09').remainingGames, 2);
});

test('第 20 次後回到第 1 次、輪數 +1', () => {
    const b = bondWith(1200, { cycleCount: 19, totalCycles: 2 });   // 等級差 300 → 75 體 → 2 場
    let r = L.addGame(b, 1500, settings, TODAY);
    r = L.addGame(r.bond, 1500, settings, TODAY);
    assert.equal(r.completion.number, 20);
    assert.equal(r.completion.reward.name, '寶珠交換券 x1張');
    assert.equal(r.bond.cycleCount, 0);
    assert.equal(r.bond.totalCycles, 3);
});

test('還沒滿：撤銷自動達成，上限 +1，之後照新上限', () => {
    let b = bondWith(1450);   // 175 體 → 3 場
    for (let i = 0; i < 3; i++) b = L.addGame(b, 1500, settings, TODAY).bond;
    assert.equal(b.cycleCount, 1);
    const u = L.notFullYet(b, 1500, settings, TODAY);
    assert.equal(u.undone, true);
    assert.equal(u.newLimit, 4);
    assert.equal(u.bond.cycleCount, 0);
    assert.equal(u.bond.gamesPlayed, 3);
    assert.equal(u.bond.lastCompletedDate, null);
    assert.equal(L.todayStatus(u.bond, 1500, settings, TODAY).limit, 4);
    const r = L.addGame(u.bond, 1500, settings, TODAY);
    assert.equal(r.completion.number, 1);
    // 之後幾天都照 4 場
    assert.equal(L.todayStatus(r.bond, 1500, settings, '2026-11-09').limit, 4);
});

test('還沒滿：第 20 次撤銷後回到第 19 次、輪數也還原', () => {
    let b = bondWith(1200, { cycleCount: 19, totalCycles: 0, gamesPlayed: 1 });
    b = L.addGame(b, 1500, settings, TODAY).bond;
    assert.equal(b.cycleCount, 0);
    const u = L.notFullYet(b, 1500, settings, TODAY).bond;
    assert.equal(u.cycleCount, 19);
    assert.equal(u.totalCycles, 0);
});

test('已經滿了：提早達成，上限改成目前場數', () => {
    let b = bondWith(1490);   // 估 4 場
    for (let i = 0; i < 3; i++) b = L.addGame(b, 1500, settings, TODAY).bond;
    const r = L.markFull(b, 1500, settings, TODAY);
    assert.equal(r.completion.number, 1);
    assert.equal(r.newLimit, 3);
    assert.equal(L.todayStatus(r.bond, 1500, settings, '2026-11-09').limit, 3);
});

test('修正值：等級差跨格或每場體力改變就清除', () => {
    let b = L.notFullYet(L.addGame(bondWith(1490, { gamesPlayed: 3 }), 1500, settings, TODAY).bond, 1500, settings, TODAY).bond;
    assert.equal(L.reconcileOverride(b, 1510, settings).cleared, false, '同一格 (差 20)');
    assert.equal(L.reconcileOverride(b, 1530, settings).cleared, true, '跨格 (差 40)');
    assert.equal(L.reconcileOverride(b, 1500, { staminaPerGame: 40 }).cleared, true, '每場體力改變');
    // 就算還沒清，跨格後也不會套用舊修正值
    assert.equal(L.todayStatus(b, 1530, settings, TODAY).overridden, false);
});

test('修改次數', () => {
    const b = L.setCounts(bondWith(1490), { cycleCount: 9, completedToday: true, gamesPlayed: 0, limit: 5 }, 1500, settings, TODAY);
    assert.equal(b.cycleCount, 9);
    assert.equal(L.isCompletedToday(b, TODAY), true);
    assert.equal(L.todayStatus(b, 1500, settings, '2026-11-09').limit, 5);
    const c = L.setCounts(b, { cycleCount: 9, completedToday: false, gamesPlayed: 2, limit: null }, 1500, settings, TODAY);
    assert.equal(L.isCompletedToday(c, TODAY), false);
    assert.equal(L.todayStatus(c, 1500, settings, TODAY).limit, 4);
});

test('結束羈絆後找回，進度接續', () => {
    const b = bondWith(1490, { cycleCount: 7, totalCycles: 1, gamesOverride: 5, overrideBasis: { bracketIndex: 0, staminaPerGame: 60 } });
    const h = L.endBond(b, TODAY);
    assert.equal(h.endedAt, TODAY);
    const r = L.restoreBond(h);
    assert.equal(r.endedAt, undefined);
    assert.equal(r.cycleCount, 7);
    assert.equal(r.totalCycles, 1);
    assert.equal(L.todayStatus(r, 1500, settings, TODAY).limit, 5);
});

test('等級輸入驗證', () => {
    assert.equal(L.parseLevel('1500'), 1500);
    for (const bad of ['', '0', '-3', '1.5', 'abc', '10000']) assert.equal(L.parseLevel(bad), null, bad);
});

test('隊友是自己的帳號：名稱、等級跟著那個帳號；帳號刪除後改成一般隊友', () => {
    const main = { ...L.makeAccount({ name: '主帳', level: 1500 }, 1), id: 'main' };
    const sub = { ...L.makeAccount({ name: '副帳', level: 1490 }, 2), id: 'sub' };
    main.bonds.push(L.makeBond({ partnerAccountId: 'sub', partnerGameName: '', partnerLevel: 1 }, TODAY, 1));
    let { data } = L.normalizeData({ settings, accounts: [main, sub] });
    let b = data.accounts[0].bonds[0];
    assert.equal(b.partnerGameName, '副帳');
    assert.equal(b.partnerLevel, 1490);
    assert.equal(sub.bonds.length, 0, '各自獨立：副帳那邊不會自動出現');

    // 副帳升級跨格 → 主帳這段的修正場數清掉
    data.accounts[0].bonds[0] = L.notFullYet(L.addGame({ ...b, gamesPlayed: 3 }, 1500, settings, TODAY).bond, 1500, settings, TODAY).bond;
    data.accounts[1].level = 1460;
    data.accounts[1].name = '副帳改名';
    const n = L.normalizeData(data);
    assert.equal(n.cleared, 1);
    b = n.data.accounts[0].bonds[0];
    assert.equal(b.partnerGameName, '副帳改名');
    assert.equal(b.partnerLevel, 1460);
    assert.equal(b.gamesOverride, null);

    // 刪除副帳 → 保留最後的名稱、等級和進度
    n.data.accounts.splice(1, 1);
    b = L.normalizeData(n.data).data.accounts[0].bonds[0];
    assert.equal(b.partnerAccountId, null);
    assert.ok(b.partnerPlayerId, "改成名單裡的其他玩家");
    assert.equal(b.partnerGameName, '副帳改名');
    assert.equal(b.gamesPlayed, 4, "進度保留");
});

test('隊友名單：舊資料轉換，同名同社群帳號合併成一筆，id 固定', () => {
    const oldBond = (id, name, handle, extra = {}) => ({ id, partnerGameName: name, partnerSocial: { platform: 'LINE', handle }, partnerLevel: 1400, createdAt: 1, ...extra });
    const raw = {
        accounts: [
            { id: 'a1', name: '主帳', level: 1500, bonds: [oldBond('b1', '小明', 'ming', { note: '週末才上線' })], history: [] },
            { id: 'a2', name: '副帳', level: 1500, bonds: [oldBond('b2', '小明', 'ming')], history: [oldBond('h1', '阿強', '', { endedAt: '2026-11-01' })] },
        ],
    };
    const first = L.normalizeData(L.sanitizeData(raw)).data;
    const second = L.normalizeData(L.sanitizeData(raw)).data;
    assert.deepEqual(first.roster.flatMap((p) => p.members.map((m) => m.name)).sort(), ['小明', '阿強']);
    assert.deepEqual(L.rosterMembers(first.roster).map((x) => x.member.id), L.rosterMembers(second.roster).map((x) => x.member.id), '兩台裝置各自轉換得到同一個 id');
    const ming = first.roster.find((p) => p.members.some((m) => m.name === '小明'));
    assert.equal(ming.note, '週末才上線');
    assert.equal(L.playerName(ming), 'ming', '以社群帳號為主');
    assert.equal(first.accounts[0].bonds[0].partnerPlayerId, ming.members[0].id);
    assert.equal(first.accounts[1].bonds[0].partnerPlayerId, ming.members[0].id);
});

test('隊友名單：改名單裡的等級，所有羈絆一起更新', () => {
    let d = L.sanitizeData({ roster: [{ id: 'p1', name: '小明', level: 1490, createdAt: 1 }], accounts: [
        { id: 'a1', name: '主帳', level: 1500, bonds: [{ id: 'b1', partnerPlayerId: 'p1', createdAt: 1 }] },
        { id: 'a2', name: '副帳', level: 1200, bonds: [{ id: 'b2', partnerPlayerId: 'p1', createdAt: 1 }] },
    ] });
    d = L.normalizeData(d).data;
    assert.equal(d.accounts[0].bonds[0].partnerGameName, '小明');
    d.roster[0].members[0].level = 1300;
    d = L.normalizeData(d).data;
    assert.equal(d.accounts[0].bonds[0].partnerLevel, 1300);
    assert.equal(d.accounts[1].bonds[0].partnerLevel, 1300);
});

test('從名單選隊友：上限 3 位、不能重複、以前羈絆過就接續', () => {
    let acc = { ...L.makeAccount({ name: '主帳', level: 1500 }, 1), id: 'a1' };
    let r = L.selectPartner(acc, { type: 'player', id: 'p1' }, TODAY, 1);
    assert.equal(r.resumedFrom, null);
    acc = r.account;
    assert.equal(L.selectPartner(acc, { type: 'player', id: 'p1' }, TODAY).error, 'duplicate');
    assert.equal(L.selectPartner(acc, { type: 'account', id: 'a1' }, TODAY).error, 'self');

    // 結束後再選回來 → 接續
    const b = { ...acc.bonds[0], cycleCount: 7 };
    acc = { ...acc, bonds: [], history: [L.endBond(b, '2026-11-01')] };
    r = L.selectPartner(acc, { type: 'player', id: 'p1' }, TODAY, 2);
    assert.equal(r.resumedFrom.cycleCount, 7);
    assert.equal(r.account.bonds[0].cycleCount, 7);
    assert.equal(r.account.history.length, 0);

    acc = r.account;
    acc = L.selectPartner(acc, { type: 'player', id: 'p2' }, TODAY).account;
    acc = L.selectPartner(acc, { type: 'account', id: 'a2' }, TODAY).account;
    assert.equal(L.selectPartner(acc, { type: 'player', id: 'p3' }, TODAY).error, 'full');
});

test('羈完自動退出隊伍、空出位子；同一天不能再選回；還沒滿放回隊伍', () => {
    let acc = { ...L.makeAccount({ name: '主帳', level: 1500 }, 1), id: 'a1' };
    for (const id of ['p1', 'p2', 'p3']) acc = L.selectPartner(acc, { type: 'player', id }, TODAY).account;
    acc.bonds = acc.bonds.map((b) => ({ ...b, partnerLevel: 1200 }));   // 等級差 300 → 2 場
    // p1 打兩場羈完
    let b = acc.bonds[0];
    b = L.addGame(b, 1500, settings, TODAY).bond;
    b = L.addGame(b, 1500, settings, TODAY).bond;
    acc.bonds[0] = b;
    const roster = ["p1","p2","p3","p4"].map((id) => ({ id, name: id, social: { platform: "LINE", customPlatform: "", handle: "" }, level: 1200, note: "", createdAt: 1 }));
    let d = L.normalizeData({ settings, roster, accounts: [acc] }, TODAY).data;
    acc = d.accounts[0];
    assert.equal(acc.bonds.length, 2, '羈完的退出');
    assert.equal(acc.history[0].cycleCount, 1);
    assert.equal(acc.history[0].endedAt, TODAY);

    // 空出的位子可以選別人；今天羈完的不能再選回
    assert.equal(L.selectPartner(acc, { type: 'player', id: 'p1' }, TODAY).error, 'doneToday');
    acc = L.selectPartner(acc, { type: 'player', id: 'p4' }, TODAY).account;
    assert.equal(acc.bonds.length, 3);

    // 還沒滿：隊伍滿了就不能放回
    assert.equal(L.undoDoneToday(acc, acc.history[0].id, settings, TODAY).error, 'full');
    acc.bonds.pop();
    const u = L.undoDoneToday(acc, acc.history[0].id, settings, TODAY);
    assert.equal(u.newLimit, 3);
    assert.equal(u.account.bonds.length, 3);
    const back = u.account.bonds.find((x) => x.partnerPlayerId === 'p1');
    assert.equal(back.cycleCount, 0);
    assert.equal(back.gamesPlayed, 2);

    // 隔天可以再選回，次數接續
    const next = L.normalizeData({ settings, roster, accounts: [acc] }, '2026-11-09').data.accounts[0];
    const r = L.selectPartner(next, { type: 'player', id: 'p1' }, '2026-11-09');
    assert.equal(r.error, undefined);
    assert.equal(r.bond.cycleCount, 1, '隔天選回，接續第 1 次');
});

test('不用拉進隊伍也能調整進度，之後選進隊伍會接續', () => {
    let acc = { ...L.makeAccount({ name: '主帳', level: 1500 }, 1), id: 'a1' };
    const ref = { type: 'player', id: 'p1' };
    assert.equal(L.findPair(acc, ref), null);
    acc = L.setPairProgress(acc, ref, { cycleCount: 12, totalCycles: 2, completedToday: false }, TODAY);
    assert.equal(acc.bonds.length, 0, '沒有拉進隊伍');
    assert.equal(L.findPair(acc, ref).entry.cycleCount, 12);
    const r = L.selectPartner(acc, ref, TODAY);
    assert.equal(r.resumedFrom.cycleCount, 12);
    assert.equal(r.bond.totalCycles, 2);

    // 隊伍中的也可以改；勾今天已羈完 → 下次整理時退出隊伍
    acc = L.setPairProgress(r.account, ref, { cycleCount: 13, totalCycles: 2, completedToday: true }, TODAY);
    assert.equal(acc.bonds[0].cycleCount, 13);
    const d = L.normalizeData({ settings, roster: [{ id: 'p1', name: 'P', social: { platform: 'LINE', customPlatform: '', handle: '' }, level: 1400, note: '', createdAt: 1 }], accounts: [acc] }, TODAY).data;
    assert.equal(d.accounts[0].bonds.length, 0);
    assert.equal(L.selectPartner(d.accounts[0], ref, TODAY).error, 'doneToday');
});

// 自己兩個帳號之間的羈絆：同一段，兩邊各存一份、保持一致
const twoAccounts = () => {
    const a = { ...L.makeAccount({ name: '羽入', level: 764 }), id: 'acc_a' };
    const b = { ...L.makeAccount({ name: '梨花', level: 551 }), id: 'acc_b' };
    return { settings, roster: [], accounts: [a, b] };
};
const step = (before, mutate, today = TODAY) => {
    const after = JSON.parse(JSON.stringify(before));
    mutate(after);
    return L.normalizeData(L.mirrorOwnPairs(before, after, today), today).data;
};
const pairOf = (d, accId, otherId) => {
    const acc = d.accounts.find((a) => a.id === accId);
    return L.findPair(acc, { type: 'account', id: otherId });
};

test('自己帳號之間：一邊選了對方，兩邊隊伍都有；+1 場、羈完、還沒滿都同步', () => {
    let d = L.normalizeData(twoAccounts(), TODAY).data;
    d = step(d, (x) => { x.accounts[0] = L.selectPartner(x.accounts[0], { type: 'account', id: 'acc_b' }, TODAY).account; });
    assert.equal(pairOf(d, 'acc_b', 'acc_a').active, true);
    assert.equal(d.accounts[1].bonds[0].partnerGameName, '羽入');

    // 從梨花那邊 +1 場 → 羽入那邊也 +1
    d = step(d, (x) => { const acc = x.accounts[1]; acc.bonds[0] = L.addGame(acc.bonds[0], acc.level, settings, TODAY).bond; });
    assert.equal(pairOf(d, 'acc_a', 'acc_b').entry.gamesPlayed, 1);

    // 已經滿了 → 兩邊都今天羈完、退出隊伍
    d = step(d, (x) => { const acc = x.accounts[0]; acc.bonds[0] = L.markFull(acc.bonds[0], acc.level, settings, TODAY).bond; });
    for (const [me, other] of [['acc_a', 'acc_b'], ['acc_b', 'acc_a']]) {
        const p = pairOf(d, me, other);
        assert.equal(p.active, false);
        assert.equal(p.entry.lastCompletedDate, TODAY);
        assert.equal(p.entry.cycleCount, 1);
    }

    // 還沒滿 (從羽入那邊) → 兩邊都放回隊伍、次數撤銷
    d = step(d, (x) => {
        const acc = x.accounts[0];
        x.accounts[0] = L.undoDoneToday(acc, acc.history[0].id, settings, TODAY).account;
    });
    for (const [me, other] of [['acc_a', 'acc_b'], ['acc_b', 'acc_a']]) {
        const p = pairOf(d, me, other);
        assert.equal(p.active, true);
        assert.equal(p.entry.cycleCount, 0);
    }
});

test('自己帳號之間：調整進度、結束羈絆、刪除歷史都同步', () => {
    let d = L.normalizeData(twoAccounts(), TODAY).data;
    d = step(d, (x) => { x.accounts[0] = L.setPairProgress(x.accounts[0], { type: 'account', id: 'acc_b' }, { cycleCount: 5, totalCycles: 1, completedToday: false }, TODAY); });
    assert.equal(pairOf(d, 'acc_b', 'acc_a').entry.cycleCount, 5);
    assert.equal(pairOf(d, 'acc_b', 'acc_a').entry.totalCycles, 1);

    // 梨花選羽入 → 接續 5 次，羽入那邊也進隊伍
    d = step(d, (x) => { x.accounts[1] = L.selectPartner(x.accounts[1], { type: 'account', id: 'acc_a' }, TODAY).account; });
    assert.equal(pairOf(d, 'acc_a', 'acc_b').active, true);
    assert.equal(pairOf(d, 'acc_a', 'acc_b').entry.cycleCount, 5);

    // 羽入結束羈絆 → 梨花那邊也結束
    d = step(d, (x) => {
        const acc = x.accounts[0];
        const b = acc.bonds[0];
        acc.bonds = [];
        acc.history.unshift(L.endBond(b, TODAY));
    });
    assert.equal(pairOf(d, 'acc_b', 'acc_a').active, false);
    assert.equal(d.accounts[1].bonds.length, 0);

    // 刪除歷史 → 另一邊也刪
    d = step(d, (x) => { x.accounts[1].history = []; });
    assert.equal(pairOf(d, 'acc_a', 'acc_b'), null);
});

test('自己帳號之間：舊資料兩邊不一致時，以隊伍中 / 次數多的那邊為準；對方隊伍滿了不能選', () => {
    const d0 = twoAccounts();
    d0.accounts[0].bonds.push({ ...L.makeBond({ partnerAccountId: 'acc_b' }, TODAY), cycleCount: 1, lastCompletedDate: '2026-11-07' });
    d0.accounts[1].history.push({ ...L.makeBond({ partnerAccountId: 'acc_a' }, TODAY), cycleCount: 0, endedAt: '2026-11-01' });
    const d = L.normalizeData(d0, TODAY).data;
    assert.equal(pairOf(d, 'acc_b', 'acc_a').active, true);
    assert.equal(pairOf(d, 'acc_b', 'acc_a').entry.cycleCount, 1);

    const full = twoAccounts();
    for (let i = 0; i < L.MAX_BONDS_PER_ACCOUNT; i++) full.accounts[1].bonds.push(L.makeBond({ partnerPlayerId: 'p' + i }, TODAY));
    assert.equal(L.ownPairHasRoom(full, 'acc_b', 'acc_a'), false);
    assert.equal(L.ownPairHasRoom(full, 'acc_a', 'acc_b'), true);
});

test('隊友名單：一位玩家 (社群帳號) 底下有多個遊戲帳號，各自是不同的羈絆；同社群帳號的舊資料合併', () => {
    const d = L.normalizeData(L.sanitizeData({ roster: [
        { id: 'p1', name: 'Z', level: 1200, social: { platform: 'LINE', customPlatform: '', handle: '小明' }, note: '', createdAt: 1 },
        { id: 'p2', name: 'X', level: 900, social: { platform: 'LINE', customPlatform: '', handle: '小明' }, note: '', createdAt: 2 },
        { id: 'p3', name: 'Q', level: 900, social: { platform: 'LINE', customPlatform: '', handle: '' }, note: '', createdAt: 3 },
    ], accounts: [{ id: 'a1', name: '羽入', level: 1000, bonds: [{ id: 'b1', partnerPlayerId: 'p1', createdAt: 1 }, { id: 'b2', partnerPlayerId: 'p2', createdAt: 1 }] }] })).data;
    assert.equal(d.roster.length, 2, '同 LINE 帳號合併；沒填帳號名稱的不合併');
    assert.deepEqual(d.roster[0].members.map((m) => m.name), ['Z', 'X']);
    assert.deepEqual(d.accounts[0].bonds.map((b) => [b.partnerGameName, b.partnerLevel]), [['Z', 1200], ['X', 900]]);
    assert.equal(L.findMember(d.roster, 'p2').player.id, d.roster[0].id);
});

// 今天一起打：選了其他玩家的遊戲帳號，排出每場帶哪幾個自己的帳號
test('排程：每場帶 k 個帳號，總場數最少 = max(最多的, ceil(總和 / k))', () => {
    const cases = [
        [[3, 3, 3], 2, 5],
        [[4, 1, 1], 2, 4],
        [[2, 2, 0], 2, 2],
        [[1, 1, 1], 3, 1],
        [[5, 2, 2], 3, 5],
        [[0, 0, 0], 2, 0],
    ];
    for (const [needs, k, total] of cases) {
        const r = L.scheduleGames(needs.map((need, order) => ({ id: 'a' + order, need, order })), k);
        assert.equal(r.total, total, `${needs} k=${k}`);
        // 每個帳號出場次數 ≥ 需要的場數
        const count = {};
        r.steps.forEach((s) => s.accountIds.forEach((id) => { count[id] = (count[id] || 0) + s.games; }));
        needs.forEach((need, i) => assert.ok((count['a' + i] || 0) >= need));
        r.steps.forEach((s) => assert.ok(s.accountIds.length <= k));
    }
});

test('今天一起打：規劃考慮隊伍位子；記錄一場時全部組合各 +1，不在隊伍的自動加入，自己帳號之間不算', () => {
    const member = (id, name, level) => ({ id, name, level, createdAt: 1 });
    const data = L.normalizeData({
        settings,
        roster: [{ id: 'person_1', social: { platform: 'LINE', customPlatform: '', handle: '小明' }, note: '', createdAt: 1, members: [member('Z', 'Z', 1490), member('X', 'X', 1450)] }],
        accounts: [
            { ...L.makeAccount({ name: 'A', level: 1500 }), id: 'A' },
            { ...L.makeAccount({ name: 'B', level: 1500 }), id: 'B' },
            { ...L.makeAccount({ name: 'C', level: 1500 }), id: 'C' },
        ],
    }, TODAY).data;
    // A、B 互相羈絆 (自己帳號，佔位子但不計算)
    data.accounts[0] = L.selectPartner(data.accounts[0], { type: 'account', id: 'B' }, TODAY).account;
    // C 的隊伍已經滿了 2 位，再加 Z、X 會超過 3 位
    data.accounts[2].bonds.push(L.makeBond({ partnerAccountId: 'A' }, TODAY), L.makeBond({ partnerAccountId: 'B' }, TODAY));

    const plan = L.planPlayTogether(data, ['A', 'B', 'C'], ['Z', 'X'], TODAY);
    assert.equal(plan.slots, 2);
    const row = (id) => plan.rows.find((r) => r.accountId === id);
    assert.equal(row('C').full, true);
    // 等級差 10 → 215 體 → 4 場；等級差 50 → 175 體 → 3 場；A 要 max(4,3) = 4 場
    assert.equal(row('A').need, 4);
    assert.equal(row('B').need, 4);
    assert.equal(plan.total, 4);
    assert.deepEqual(plan.steps, [{ accountIds: ['A', 'B'], games: 4 }]);

    const r = L.recordPlayTogether(data, ['A', 'B'], ['Z', 'X'], TODAY);
    assert.equal(r.added, 4);
    const a = r.data.accounts.find((x) => x.id === 'A');
    assert.deepEqual(a.bonds.map((b) => [b.partnerAccountId || b.partnerPlayerId, b.gamesPlayed]), [['B', 0], ['Z', 1], ['X', 1]]);
    assert.equal(a.bonds.find((b) => b.partnerPlayerId === 'Z').partnerLevel, 1490);

    // C 只剩 1 個位子：Z 加得進去，X 跳過
    const r2 = L.recordPlayTogether(data, ['C'], ['Z', 'X'], TODAY);
    assert.deepEqual(r2.skipped.map((s) => [s.memberId, s.reason]), [['X', 'full']]);

    // 打到第 3 場，X 那組 (3 場) 達成
    let d = r.data;
    let last;
    for (let i = 0; i < 2; i++) { last = L.recordPlayTogether(d, ['A', 'B'], ['Z', 'X'], TODAY); d = last.data; }
    assert.deepEqual(last.completions.map((c) => [c.accountId, c.memberId]), [['A', 'X'], ['B', 'X']]);
    const plan2 = L.planPlayTogether(L.normalizeData(d, TODAY).data, ['A', 'B', 'C'], ['Z', 'X'], TODAY);
    assert.equal(plan2.total, 1, 'Z 還差 1 場');
});
