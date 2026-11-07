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
