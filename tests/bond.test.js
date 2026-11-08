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
    assert.deepEqual(first.roster.map((p) => p.name).sort(), ['小明', '阿強']);
    assert.deepEqual(first.roster.map((p) => p.id), second.roster.map((p) => p.id), '兩台裝置各自轉換得到同一個 id');
    const ming = first.roster.find((p) => p.name === '小明');
    assert.equal(ming.note, '週末才上線');
    assert.equal(first.accounts[0].bonds[0].partnerPlayerId, ming.id);
    assert.equal(first.accounts[1].bonds[0].partnerPlayerId, ming.id);
});

test('隊友名單：改名單裡的等級，所有羈絆一起更新', () => {
    let d = L.sanitizeData({ roster: [{ id: 'p1', name: '小明', level: 1490, createdAt: 1 }], accounts: [
        { id: 'a1', name: '主帳', level: 1500, bonds: [{ id: 'b1', partnerPlayerId: 'p1', createdAt: 1 }] },
        { id: 'a2', name: '副帳', level: 1200, bonds: [{ id: 'b2', partnerPlayerId: 'p1', createdAt: 1 }] },
    ] });
    d = L.normalizeData(d).data;
    assert.equal(d.accounts[0].bonds[0].partnerGameName, '小明');
    d.roster[0].level = 1300;
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
