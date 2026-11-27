// 執行：node --test tests/
// 雲端同步：以帳號 / 羈絆 id 為單位的三方合併 (bond.js)
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../bond.js');

const clone = (x) => JSON.parse(JSON.stringify(x));
const base = () => L.sanitizeData({
    settings: { staminaPerGame: 60 },
    accounts: [{
        id: 'a1', name: '主帳', level: 1500, createdAt: 1,
        bonds: [
            { id: 'b1', partnerGameName: '小明', partnerLevel: 1490, cycleCount: 3, createdAt: 1 },
            { id: 'b2', partnerGameName: '小華', partnerLevel: 1400, cycleCount: 5, createdAt: 2 },
        ],
        history: [],
    }],
});

test('版本比對', () => {
    const ts = (ms) => ({ toMillis: () => ms });
    assert.equal(L.sameStamp(L.cloudStampOf(null), L.cloudStampOf(null)), true);
    assert.equal(L.sameStamp(L.cloudStampOf({ version: 2, lastUpdated: ts(5) }), L.cloudStampOf({ version: 2, lastUpdated: ts(6) })), false);
});

test('兩台各改不同羈絆：兩邊都保留', () => {
    const b = base();
    const local = clone(b); local.accounts[0].bonds[0].cycleCount = 4;
    const remote = clone(b); remote.accounts[0].bonds[1].cycleCount = 6;
    const { data, conflicts } = L.mergeData(b, local, remote);
    assert.equal(conflicts, 0);
    assert.deepEqual(data.accounts[0].bonds.map((x) => x.cycleCount), [4, 6]);
});

test('同一段羈絆兩邊都改：以本機為準', () => {
    const b = base();
    const local = clone(b); local.accounts[0].bonds[0].cycleCount = 4;
    const remote = clone(b); remote.accounts[0].bonds[0].cycleCount = 9;
    const { data, conflicts } = L.mergeData(b, local, remote);
    assert.equal(conflicts, 1);
    assert.equal(data.accounts[0].bonds[0].cycleCount, 4);
});

test('本機結束羈絆、雲端改另一段：刪除與修改都保留', () => {
    const b = base();
    const local = clone(b);
    local.accounts[0].history.push({ ...local.accounts[0].bonds[0], endedAt: '2026-11-08' });
    local.accounts[0].bonds.splice(0, 1);
    const remote = clone(b); remote.accounts[0].bonds[1].partnerLevel = 1410;
    const { data } = L.mergeData(b, local, remote);
    assert.deepEqual(data.accounts[0].bonds.map((x) => x.id), ['b2']);
    assert.equal(data.accounts[0].bonds[0].partnerLevel, 1410);
    assert.equal(data.accounts[0].history.length, 1);
});

test('帳號被刪除：底下的羈絆一起消失', () => {
    const b = base();
    const local = clone(b); local.accounts = [];
    const { data } = L.mergeData(b, local, clone(b));
    assert.equal(data.accounts.length, 0);
});

test('sanitizeData：不合法的值改回預設', () => {
    const d = L.sanitizeData({ settings: { staminaPerGame: -1 }, accounts: [{ id: 'x', level: 'abc', bonds: [{ id: 'y', cycleCount: 25, partnerSocial: { platform: 'MySpace' } }] }] });
    assert.equal(d.settings.staminaPerGame, 60);
    assert.equal(d.accounts[0].level, 1);
    assert.equal(d.accounts[0].bonds[0].cycleCount, 0);
    assert.equal(d.accounts[0].bonds[0].partnerSocial.platform, '其他');
});

test('隊友名單也以 id 為單位合併', () => {
    const b = L.sanitizeData({ roster: [{ id: 'p1', name: '小明', level: 1400, createdAt: 1 }], accounts: [] });
    const local = clone(b); local.roster[0].members[0].level = 1450;
    const remote = clone(b); remote.roster.push({ id: 'person_p2', social: { platform: 'LINE', customPlatform: '', handle: '' }, note: '', createdAt: 2, members: [{ id: 'p2', name: '小華', level: 1000, createdAt: 2 }] });
    const { data } = L.mergeData(b, local, remote);
    assert.deepEqual(data.roster.map((p) => [p.id, p.members[0].level]), [['person_p1', 1450], ['person_p2', 1000]]);
});

test('隊友名單：雲端合併時舊格式和新格式的同一位玩家不會重複', () => {
    const oldFmt = { id: 'p1', name: '小明', level: 1400, social: { platform: 'LINE', customPlatform: '', handle: '' }, note: '', createdAt: 1 };
    const newFmt = { id: 'person_p1', social: { platform: 'LINE', customPlatform: '', handle: '' }, note: '', createdAt: 1, members: [{ id: 'p1', name: '小明', level: 1450, createdAt: 1 }] };
    const d = L.normalizeData({ settings: { staminaPerGame: 60 }, roster: [newFmt, oldFmt], accounts: [] }).data;
    assert.equal(d.roster.length, 1);
    assert.equal(d.roster[0].members.length, 1);
});

test('一邊羈完移到歷史、另一邊改同一段：合併後只留一份 (進度多的勝)', () => {
    const b = base();
    const local = clone(b);   // 裝置 A：羈完，從隊伍移到歷史
    const done = { ...local.accounts[0].bonds[0], cycleCount: 4, lastCompletedDate: '2026-11-08', endedAt: '2026-11-08' };
    local.accounts[0].bonds.splice(0, 1);
    local.accounts[0].history.push(done);
    const remote = clone(b); remote.accounts[0].bonds[0].gamesPlayed = 1;   // 裝置 B：同一天 +1 場
    const { data } = L.mergeData(b, local, remote);
    ['merge', 'normalize'].forEach((step) => {
        const acc = (step === 'merge' ? data : L.normalizeData(data, '2026-11-09').data).accounts[0];
        const inBonds = acc.bonds.filter((x) => x.id === 'b1').length;
        const inHist = acc.history.filter((x) => x.id === 'b1').length;
        assert.equal(inBonds + inHist, 1, step);
        assert.equal(inHist, 1, step);   // 進度多的歷史勝
    });
});

test('同一 id 進度相同：以歷史為準；隊伍進度較多：隊伍勝', () => {
    const mk = (bondCycle, histCycle) => {
        const d = base();
        d.accounts[0].bonds[0].cycleCount = bondCycle;
        d.accounts[0].history.push({ ...d.accounts[0].bonds[0], cycleCount: histCycle, endedAt: '2026-11-08' });
        return L.normalizeData(d).data.accounts[0];
    };
    let acc = mk(3, 3);
    assert.equal(acc.history.some((x) => x.id === 'b1'), true);
    assert.equal(acc.bonds.some((x) => x.id === 'b1'), false);
    acc = mk(5, 3);
    assert.equal(acc.bonds.some((x) => x.id === 'b1'), true);
    assert.equal(acc.history.some((x) => x.id === 'b1'), false);
});

test('自己帳號鏡射的羈絆也一致：兩邊各自去重後都在歷史', () => {
    const entry = (id, partner, extra) => ({ id, partnerAccountId: partner, partnerGameName: 'x', partnerLevel: 1, cycleCount: 4, totalCycles: 0, createdAt: 1, ...extra });
    const b = L.sanitizeData({ accounts: [
        { id: 'a1', name: 'A', level: 1500, createdAt: 1, bonds: [entry('x1', 'a2')], history: [] },
        { id: 'a2', name: 'B', level: 1500, createdAt: 2, bonds: [entry('x2', 'a1')], history: [] },
    ] });
    const local = clone(b);   // A 羈完：兩邊都進歷史
    const fin = (e) => ({ ...e, cycleCount: 5, lastCompletedDate: '2026-11-08', endedAt: '2026-11-08' });
    local.accounts.forEach((a) => { a.history.push(fin(a.bonds[0])); a.bonds = []; });
    const remote = clone(b); remote.accounts.forEach((a) => { a.bonds[0].gamesPlayed = 2; });   // B 同天各改一份
    const { data } = L.mergeData(b, local, remote);
    const n = L.normalizeData(data, '2026-11-09').data;
    n.accounts.forEach((a) => { assert.equal(a.bonds.length, 0); assert.equal(a.history.length, 1); });
    assert.equal(n.accounts[0].history[0].cycleCount, n.accounts[1].history[0].cycleCount);
});
