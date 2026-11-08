// =====================================================
// 羈絆場次工具：畫面、存檔、雲端同步
// 計算邏輯都在 bond.js (window.BondLogic)
// =====================================================
document.addEventListener('DOMContentLoaded', () => {
    'use strict';
    const L = window.BondLogic;

    // ---------------- 常數 ----------------
    const THIS_TOOL_ID = 'bond';
    const TOOLBOX_TOOLS_URL = 'https://emily4027.github.io/monster-strike-toolbox/tools.js';
    const CLOUD_COLLECTION = 'bond_data';
    const CLOUD_DOC = 'bond_tracker';
    const LOCAL_DATA_KEY = 'bond_tracker_data_v1';         // localStorage：本機資料
    const UNSYNCED_KEY = 'bond_unsynced_v1';               // localStorage：有還沒存到雲端的修改
    const SYNC_BASE_PREFIX = 'bond_sync_base_v1_';         // localStorage：上次和雲端同步時的資料 (三方合併基準)
    const LAST_UID_KEY = 'bond_last_uid_v1';               // localStorage：本機資料最後對應的雲端帳號
    const CURRENT_ACCOUNT_KEY = 'bond_current_account_v1'; // localStorage：目前選的帳號
    const USER_CACHE_KEY = 'bond_user_cache_v1';           // sessionStorage：登入者資訊 (避免按鈕閃爍)
    const CLOUD_SAVE_DELAY_MS = 1000;
    const TOAST_DURATION_MS = 3500;
    const TOAST_ACTION_DURATION_MS = 8000;
    const TOAST_COLORS = { error: '#dc3545', info: '#0d6efd', success: '#28a745', reward: '#c2185b' };
    const PLATFORM_ICONS = { LINE: 'bi-line', Discord: 'bi-discord', Facebook: 'bi-facebook', Instagram: 'bi-instagram', 其他: 'bi-person-badge' };

    // ---------------- 狀態 ----------------
    let data = L.emptyData();
    let currentAccountId = null;
    let currentUser = null;
    let isCloudMode = false;
    let isCloudLoading = false;
    let knownCloudStamp = null;
    let saveTimer = null;
    let hasPendingCloudSave = false;
    let lastRenderedDate = L.getGameDate();

    const $ = (id) => document.getElementById(id);
    const today = () => L.getGameDate();

    // ---------------- 儲存空間 (可能被封鎖，一律包 try/catch) ----------------
    const store = {
        get(k, s = localStorage) { try { return s.getItem(k); } catch (e) { return null; } },
        set(k, v, s = localStorage) { try { s.setItem(k, v); } catch (e) { /* 忽略 */ } },
        del(k, s = localStorage) { try { s.removeItem(k); } catch (e) { /* 忽略 */ } },
    };

    // ---------------- DOM 工具：一律用 textContent，不拼 innerHTML ----------------
    function h(tag, attrs = {}, ...children) {
        const el = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs || {})) {
            if (v === null || v === undefined || v === false) continue;
            if (k === 'class') el.className = v;
            else if (k === 'text') el.textContent = v;
            else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
            else if (k === 'style') el.style.cssText = v;
            else el.setAttribute(k, v === true ? '' : v);
        }
        for (const c of children.flat()) {
            if (c === null || c === undefined || c === false) continue;
            el.append(c instanceof Node ? c : document.createTextNode(String(c)));
        }
        return el;
    }
    const icon = (name) => h('i', { class: 'bi ' + name, 'aria-hidden': 'true' });

    // ---------------- Toast ----------------
    let toastTimer = null;
    function showToast(message, type = 'success', action = null) {
        const toast = $('toast');
        $('toastText').textContent = message;
        toast.style.backgroundColor = TOAST_COLORS[type] || TOAST_COLORS.success;
        const btn = $('toastAction');
        btn.hidden = !action;
        btn.onclick = null;
        if (action) {
            btn.textContent = action.label;
            btn.onclick = () => { hideToast(); action.run(); };
        }
        toast.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(hideToast, action ? TOAST_ACTION_DURATION_MS : TOAST_DURATION_MS);
    }
    function hideToast() { $('toast').classList.remove('show'); }

    function downloadJson(obj, fileName) {
        const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = fileName;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }

    // ---------------- 資料存取 ----------------
    const clone = (x) => JSON.parse(JSON.stringify(x));
    const currentAccount = () => data.accounts.find((a) => a.id === currentAccountId) || null;
    const findBond = (acc, bondId) => acc.bonds.find((b) => b.id === bondId);

    function loadLocal() {
        const raw = store.get(LOCAL_DATA_KEY);
        if (raw) {
            try { data = L.sanitizeData(JSON.parse(raw)); }
            catch (e) {
                console.warn('本機資料格式損毀，已另存備份', e);
                store.set(LOCAL_DATA_KEY + '_corrupt_backup', raw);
                data = L.emptyData();
            }
        }
        const saved = store.get(CURRENT_ACCOUNT_KEY);
        currentAccountId = data.accounts.some((a) => a.id === saved) ? saved : (data.accounts[0] || {}).id || null;
    }

    const saveLocal = () => store.set(LOCAL_DATA_KEY, JSON.stringify(data));
    const setUnsynced = (flag) => (flag ? store.set(UNSYNCED_KEY, '1') : store.del(UNSYNCED_KEY));
    const hasUnsynced = () => store.get(UNSYNCED_KEY) === '1';

    // 每次修改後呼叫：一律存本機；雲端模式再延遲寫入 Firestore
    function saveData() {
        saveLocal();
        setUnsynced(true);
        if (isCloudMode && currentUser && !isCloudLoading) {
            updateCloudStatus('saving', '儲存中...');
            hasPendingCloudSave = true;
            clearTimeout(saveTimer);
            saveTimer = setTimeout(saveToCloud, CLOUD_SAVE_DELAY_MS);
        } else if (!isCloudMode) {
            updateCloudStatus('offline', '離線模式 (已存本機)');
        }
    }

    // 修改資料的唯一入口：改完存檔、重畫
    // 改完後統一整理：自己帳號隊友的名稱 / 等級跟著更新、失效的修正場數清掉 (bond.js normalizeData)
    function commit(mutate) {
        mutate();
        const n = L.normalizeData(data);
        data = n.data;
        saveData();
        render();
        if (n.cleared > 0) showToast(`等級差或每場體力變了，${n.cleared} 段羈絆的場數已重新估算`, 'info');
    }

    // ---------------- 雲端 ----------------
    function updateCloudStatus(status, text) {
        $('cloudStatusText').textContent = text;
        $('statusDot').className = 'status-dot status-' + status;
    }

    function renderAuthUI(user) {
        $('google-login-btn').style.display = user ? 'none' : 'inline-flex';
        $('user-info').style.display = user ? 'flex' : 'none';
        $('user-display-name').textContent = user ? (user.displayName || '使用者') : '';
        const avatar = $('user-avatar');
        if (user && user.photoURL) avatar.src = user.photoURL; else avatar.removeAttribute('src');
    }

    function checkAuthCache() {
        const cached = store.get(USER_CACHE_KEY, sessionStorage);
        if (!cached) return;
        try { renderAuthUI(JSON.parse(cached)); } catch (e) { store.del(USER_CACHE_KEY, sessionStorage); }
    }

    const cloudRef = () => window.doc(window.db, 'artifacts', window.envAppId || 'default-app-id', 'users', currentUser.uid, CLOUD_COLLECTION, CLOUD_DOC);

    function readSyncBase(uid) {
        try {
            const raw = store.get(SYNC_BASE_PREFIX + uid);
            return raw ? L.sanitizeData(JSON.parse(raw)) : null;
        } catch (e) { return null; }
    }
    const writeSyncBase = (uid, d) => store.set(SYNC_BASE_PREFIX + uid, JSON.stringify(d));

    // 寫入雲端：version / lastUpdated 和上次看到的不同 → 其他裝置改過，先三方合併再寫入
    async function saveToCloud() {
        hasPendingCloudSave = false;
        if (!currentUser || !isCloudMode || isCloudLoading) return;
        const uid = currentUser.uid;
        const localSnapshot = clone(data);
        const base = readSyncBase(uid) || L.emptyData();
        try {
            const ref = cloudRef();
            const stamp = Date.now();
            const result = await window.runTransaction(window.db, async (tx) => {
                const snap = await tx.get(ref);
                const remoteRaw = snap.exists() ? snap.data() : null;
                const current = L.cloudStampOf(remoteRaw);
                let written = localSnapshot;
                let merge = null;
                if (!L.sameStamp(current, knownCloudStamp)) {
                    merge = L.mergeData(base, localSnapshot, L.sanitizeData(remoteRaw));
                    written = merge.data;
                }
                const version = current.version + 1;
                tx.set(ref, { settings: written.settings, accounts: written.accounts, version, lastUpdated: new Date(stamp) }, { merge: true });
                return { written, merge, version };
            });
            if (!currentUser || currentUser.uid !== uid) return;

            knownCloudStamp = { version: result.version, updatedAt: stamp };
            writeSyncBase(uid, result.written);
            if (result.merge) {
                // 套用合併結果，同時保留存檔期間又做的修改
                data = L.mergeData(localSnapshot, data, result.written).data;
                saveLocal();
                render();
                showToast('雲端資料已被其他裝置更新，已自動合併兩邊的修改。' +
                    (result.merge.conflicts > 0 ? `（${result.merge.conflicts} 筆兩邊都改過，採用這台的版本）` : ''), 'info');
            }
            const stillDirty = !L.sameData(data, result.written);
            setUnsynced(stillDirty);
            if (stillDirty) saveData();
            else updateCloudStatus('online', '雲端就緒 (已同步)');
        } catch (error) {
            console.error('[CLOUD] 存檔失敗', error);
            updateCloudStatus('offline', '儲存失敗 (修改先存在本機)');
        }
    }

    const hasAnyData = (d) => d.accounts.length > 0;

    async function loadFromCloud() {
        if (!currentUser) return;
        const uid = currentUser.uid;
        try {
            const snap = await window.getDoc(cloudRef());
            if (!currentUser || currentUser.uid !== uid) return;
            isCloudLoading = false;
            const raw = snap.exists() ? snap.data() : null;
            knownCloudStamp = L.cloudStampOf(raw);
            const cloudData = L.sanitizeData(raw);
            const oldBase = readSyncBase(uid);

            if (raw) {
                // 本機有還沒上傳的修改：有同步基準就合併，沒有就以雲端為準並先下載備份
                const unsyncedLocal = hasUnsynced() && hasAnyData(data) ? clone(data) : null;
                writeSyncBase(uid, cloudData);
                setUnsynced(false);
                data = clone(cloudData);
                let offlineChanges = 0;
                if (unsyncedLocal && oldBase) {
                    offlineChanges = L.countChanges(oldBase, unsyncedLocal);
                    data = L.mergeData(oldBase, unsyncedLocal, cloudData).data;
                }
                saveLocal();
                fixCurrentAccount();
                render();
                if (!L.sameData(data, cloudData)) saveData();

                if (offlineChanges > 0) showToast(`已載入雲端資料，並合併 ${offlineChanges} 筆離線時的修改`);
                else if (unsyncedLocal && !oldBase && !L.sameData(unsyncedLocal, cloudData)) {
                    downloadJson(unsyncedLocal, `bond_local_backup_${today()}.json`);
                    showToast('本機有還沒上傳的資料，已下載備份，並改用雲端資料。', 'info');
                } else showToast('已載入雲端資料');
                updateCloudStatus('online', '雲端就緒 (已載入)');
            } else if (hasAnyData(data)) {
                writeSyncBase(uid, L.emptyData());
                const lastUid = store.get(LAST_UID_KEY);
                const upload = !lastUid || lastUid === uid || confirm(
                    '本機還留著另一個帳號的資料，而目前登入的帳號在雲端還沒有資料。\n\n' +
                    '按「確定」：上傳到目前登入的帳號。\n按「取消」：不上傳，並清空本機資料。');
                if (upload) { saveData(); showToast('已將本機資料同步到雲端', 'info'); }
                else {
                    data = L.emptyData();
                    saveLocal();
                    setUnsynced(false);
                    fixCurrentAccount();
                    render();
                    updateCloudStatus('online', '雲端就緒 (尚無資料)');
                }
            } else {
                writeSyncBase(uid, L.emptyData());
                updateCloudStatus('online', '雲端就緒 (尚無資料)');
            }
            store.set(LAST_UID_KEY, uid);
        } catch (error) {
            // 讀不到雲端：改回離線模式，避免用本機資料覆蓋雲端；下次連上時再合併
            isCloudLoading = false;
            isCloudMode = false;
            console.error('[CLOUD] 載入失敗', error);
            updateCloudStatus('offline', '雲端載入失敗 (修改先存在本機)');
            showToast('無法載入雲端資料，修改會先存在本機，下次連上時合併。', 'error');
        }
    }

    // 登出後不把雲端資料留在這台電腦上
    function clearLocalCopy(uid) {
        clearTimeout(saveTimer);
        hasPendingCloudSave = false;
        store.del(LOCAL_DATA_KEY);
        store.del(SYNC_BASE_PREFIX + uid);
        setUnsynced(false);
        knownCloudStamp = null;
        data = L.emptyData();
        fixCurrentAccount();
        render();
    }

    function initFirebaseAuth(retries = 0) {
        if (!window.firebaseAuth || !window.onAuthStateChanged) {
            if (retries < 50) setTimeout(() => initFirebaseAuth(retries + 1), 100);
            else {
                updateCloudStatus('offline', 'SDK 載入失敗 (離線模式)');
                renderAuthUI(null);
            }
            return;
        }
        window.onAuthStateChanged(window.firebaseAuth, async (user) => {
            const previous = currentUser;
            currentUser = user;
            if (user) {
                const u = { uid: user.uid, displayName: user.displayName, photoURL: user.photoURL };
                store.set(USER_CACHE_KEY, JSON.stringify(u), sessionStorage);
                renderAuthUI(u);
                isCloudMode = true;
                isCloudLoading = true;
                updateCloudStatus('saving', '正在從雲端載入...');
                await loadFromCloud();
            } else {
                store.del(USER_CACHE_KEY, sessionStorage);
                renderAuthUI(null);
                isCloudMode = false;
                isCloudLoading = false;
                updateCloudStatus('offline', '未登入 (離線模式，資料存在本機)');
                if (previous) clearLocalCopy(previous.uid);
            }
        });

        $('logout-btn').addEventListener('click', async () => {
            try {
                if (isCloudMode && currentUser && hasPendingCloudSave) {
                    clearTimeout(saveTimer);
                    await saveToCloud();
                }
                if (hasUnsynced() && hasAnyData(data)) {
                    if (!confirm('有修改還沒存到雲端，登出後會從這台電腦清除。\n\n按「確定」：先下載備份再登出。\n按「取消」：不登出。')) return;
                    downloadJson(data, `bond_tracker_${today()}.json`);
                }
                await window.signOut(window.firebaseAuth);
                showToast('已登出，本機上的雲端資料已清除', 'info');
            } catch (e) { console.error(e); }
        });

        $('google-login-btn').addEventListener('click', async () => {
            try { await window.signInWithPopup(window.firebaseAuth, new window.GoogleAuthProvider()); }
            catch (e) { console.error('登入失敗', e); showToast('登入失敗', 'error'); }
        });
    }

    // ---------------- 畫面 ----------------
    function fixCurrentAccount() {
        if (!data.accounts.some((a) => a.id === currentAccountId)) currentAccountId = (data.accounts[0] || {}).id || null;
    }

    function selectAccount(id) {
        currentAccountId = id;
        store.set(CURRENT_ACCOUNT_KEY, id);
        render();
    }

    function socialLabel(social) {
        const name = social.platform === '其他' ? (social.customPlatform || '其他') : social.platform;
        return social.handle ? `${name}：${social.handle}` : name;
    }

    const partnerLabel = (b) => (b.partnerAccountId ? '👤 ' : '') + b.partnerGameName;

    function render() {
        lastRenderedDate = today();
        $('todayLabel').textContent = lastRenderedDate;
        $('globalStaminaPerGame').value = data.settings.staminaPerGame;
        renderAllOverview();
        renderTabs();
        renderAccount();
    }

    // 全部帳號今日總覽：2 個帳號以上才顯示 (只有 1 個帳號時和帳號底下的總覽重複)
    function renderAllOverview() {
        const box = $('allOverview');
        const withBonds = data.accounts.filter((a) => a.bonds.length > 0);
        box.hidden = data.accounts.length < 2 || withBonds.length === 0;
        if (box.hidden) { box.replaceChildren(); return; }
        const t = today();
        const rows = withBonds.map((acc) => ({
            acc,
            pending: acc.bonds.map((b) => ({ b, s: L.todayStatus(b, acc.level, data.settings, t) })).filter((x) => !x.s.completedToday),
        }));
        const total = rows.reduce((n, r) => n + r.pending.length, 0);
        box.replaceChildren(
            h('h2', { class: 'section-title mt-0' }, icon('bi-list-check'), total === 0 ? ' 🎉 全部帳號今天都達成了' : ` 全部帳號今日總覽：還有 ${total} 段沒達成`),
            total === 0 ? null : h('div', { class: 'all-overview-rows' }, rows.map(({ acc, pending }) => h('div', { class: 'all-overview-row' },
                h('button', { type: 'button', class: 'btn btn-sm btn-link fw-bold p-0 account-link', onclick: () => selectAccount(acc.id) }, acc.name),
                pending.length === 0
                    ? h('span', { class: 'overview-item done', text: '✅ 全部達成' })
                    : pending.map(({ b, s }) => h('span', { class: 'overview-item' + (b.partnerAccountId ? ' own' : ''), text: `${partnerLabel(b)}：還差 ${s.remainingGames} 場` }))))));
    }

    function renderTabs() {
        const nav = $('accountTabs');
        nav.replaceChildren(
            ...data.accounts.map((a) => h('button', {
                type: 'button',
                class: 'account-tab' + (a.id === currentAccountId ? ' active' : ''),
                'aria-pressed': String(a.id === currentAccountId),
                onclick: () => selectAccount(a.id),
            }, `${a.name}（${a.level}）`)),
            h('button', { type: 'button', class: 'account-tab add', onclick: () => openAccountModal(null) }, icon('bi-plus-lg'), ' 新增帳號'),
        );
    }

    function renderAccount() {
        const panel = $('accountPanel');
        const acc = currentAccount();
        if (!acc) {
            panel.replaceChildren(h('section', { class: 'section-card empty-state' },
                h('p', { class: 'fs-5 mb-2', text: '還沒有帳號' }),
                h('p', { text: '先新增自己的遊戲帳號和等級，再加入羈絆隊友。' }),
                h('button', { type: 'button', class: 'btn btn-accent', onclick: () => openAccountModal(null) }, icon('bi-plus-lg'), ' 新增帳號')));
            return;
        }
        const t = today();
        const statuses = acc.bonds.map((b) => ({ bond: b, s: L.todayStatus(b, acc.level, data.settings, t) }));
        const pending = statuses.filter((x) => !x.s.completedToday);

        const levelInput = h('input', {
            type: 'number', inputmode: 'numeric', min: L.LEVEL_MIN, max: L.LEVEL_MAX,
            class: 'form-control form-control-sm level-input', value: acc.level, 'aria-label': '我的等級',
        });
        levelInput.addEventListener('change', () => changeMyLevel(acc.id, levelInput));

        const head = h('div', { class: 'account-head' },
            h('h2', { text: acc.name }),
            h('label', { class: 'inline-field' }, '我的等級', levelInput),
            h('div', { class: 'actions' },
                h('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary', onclick: () => openAccountModal(acc.id) }, icon('bi-pencil'), ' 改名'),
                h('button', { type: 'button', class: 'btn btn-sm btn-outline-danger', onclick: () => deleteAccount(acc.id) }, icon('bi-trash'), ' 刪除帳號')));

        let overview;
        if (acc.bonds.length === 0) overview = null;
        else if (pending.length === 0) {
            overview = h('div', { class: 'overview' }, h('span', { class: 'overview-title' }, '🎉 今天 ', String(acc.bonds.length), ' 段羈絆都達成了'));
        } else {
            overview = h('div', { class: 'overview' },
                h('span', { class: 'overview-title', text: `今天還有 ${pending.length} 段沒達成` }),
                ...pending.map(({ bond, s }) => h('span', { class: 'overview-item', text: `${partnerLabel(bond)}：還差 ${s.remainingGames} 場` })),
                h('button', { type: 'button', class: 'btn btn-accent btn-sm', onclick: () => openPlayedModal() }, icon('bi-controller'), ' 打完一場…'));
        }

        const full = acc.bonds.length >= L.MAX_BONDS_PER_ACCOUNT;
        const addBtn = h('button', {
            type: 'button', class: 'btn btn-outline-primary', disabled: full,
            onclick: () => openBondModal(null),
        }, icon('bi-person-plus'), ' 新增隊友');

        const bondsArea = acc.bonds.length === 0
            ? h('div', { class: 'empty-state' }, h('p', { text: '還沒有羈絆隊友。' }), addBtn)
            : h('div', {}, h('div', { class: 'bond-grid' }, statuses.map(({ bond, s }) => bondCard(acc, bond, s))),
                h('div', { class: 'mt-3 d-flex align-items-center gap-2 flex-wrap' }, addBtn,
                    full ? h('span', { class: 'text-muted small', text: `一個帳號最多同時和 ${L.MAX_BONDS_PER_ACCOUNT} 位隊友羈絆。` }) : null));

        panel.replaceChildren(h('section', { class: 'section-card' },
            head, overview,
            h('h3', { class: 'section-title' }, icon('bi-people-fill'), ` 羈絆隊友（${acc.bonds.length} / ${L.MAX_BONDS_PER_ACCOUNT}）`),
            bondsArea,
            historySection(acc)));
    }

    function bondCard(acc, bond, s) {
        const t = today();
        const levelInput = h('input', {
            type: 'number', inputmode: 'numeric', min: L.LEVEL_MIN, max: L.LEVEL_MAX,
            class: 'form-control form-control-sm', value: bond.partnerLevel, 'aria-label': `${bond.partnerGameName} 的等級`,
        });
        levelInput.addEventListener('change', () => changePartnerLevel(acc.id, bond.id, levelInput));
        const linked = !!bond.partnerAccountId;
        // 自己的帳號：等級跟著那個帳號，在這裡不能改；可以點名稱切到那個帳號
        const levelField = linked
            ? h('span', { text: `隊友等級 ${bond.partnerLevel}（跟著帳號）` })
            : h('label', { class: 'inline-field' }, '隊友等級', levelInput);
        const socialLine = linked
            ? h('div', { class: 'bond-social' }, h('span', { class: 'own-badge', text: '👤 自己的帳號' }), ' ',
                h('button', { type: 'button', class: 'btn btn-link btn-sm p-0 align-baseline', onclick: () => selectAccount(bond.partnerAccountId) }, '切換到這個帳號'))
            : h('div', { class: 'bond-social' }, icon(PLATFORM_ICONS[bond.partnerSocial.platform] || PLATFORM_ICONS.其他), ' ', socialLabel(bond.partnerSocial));

        const needBox = s.completedToday
            ? h('div', { class: 'need-box done' }, h('div', { class: 'need-main' }, '✅ 今天已達成'),
                h('div', { class: 'need-sub', text: '明天再繼續' }))
            : h('div', { class: 'need-box' },
                h('div', { class: 'need-main', text: `還差 ${s.remainingGames} 場` }),
                h('div', { class: 'need-sub', text: `約 ${s.remainingStamina} 體（每場 ${s.staminaPerGame} 體）` }));

        const gamesPct = s.completedToday ? 100 : Math.min(100, Math.round((s.played / s.limit) * 100));
        const barLabel = h('span', { class: 'bar-label' },
            s.completedToday ? `羈絆條：上限 ${s.limit} 場` : `羈絆條：${s.played} / ${s.limit} 場`,
            h('span', { class: 'tag', text: s.overridden ? '已修正' : `估算（約 ${s.stamina} 體）` }));
        const progress = (pct, cls, label) => h('div', { class: 'progress', role: 'progressbar', 'aria-label': label, 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100 },
            h('div', { class: 'progress-bar ' + cls, style: `width:${pct}%` }));

        const buttons = s.completedToday
            ? h('div', { class: 'btn-row' },
                L.canUndoCompletion(bond, t)
                    ? h('button', { type: 'button', class: 'btn btn-outline-secondary', onclick: () => undoCompletion(acc.id, bond.id) }, '還沒滿？撤銷今天這次')
                    : h('button', { type: 'button', class: 'btn btn-outline-secondary', disabled: true }, '今天已達成'))
            : h('div', { class: 'btn-row' },
                h('button', { type: 'button', class: 'btn btn-outline-secondary', style: 'flex:0 0 auto', 'aria-label': '減 1 場', disabled: s.played === 0, onclick: () => minusGame(acc.id, bond.id) }, '−1'),
                h('button', { type: 'button', class: 'btn btn-accent', onclick: () => plusGame(acc.id, [bond.id]) }, '＋1 場'),
                h('button', { type: 'button', class: 'btn btn-outline-success', onclick: () => markFull(acc.id, bond.id) }, '已經滿了'));

        const nextNo = bond.cycleCount + 1;
        const nextReward = L.rewardFor(nextNo);
        const ticket = L.ticketInfo(bond.cycleCount, s.completedToday);
        let ticketText;
        let ticketNow = false;
        if (ticket.todayGetsTicket) { ticketText = '💎 今天達成就能拿到寶珠交換券！'; ticketNow = true; }
        else if (ticket.tomorrowGetsTicket) { ticketText = '💎 寶珠券還差 1 天（明天）'; }
        else ticketText = `💎 寶珠券還差 ${ticket.days} 天（${ticket.includesToday ? '含今天' : '從明天起算'}，第 ${ticket.ticketNo} 次）`;

        return h('article', { class: 'bond-card' + (s.completedToday ? ' done' : '') },
            h('div', { class: 'bond-top' },
                h('div', { style: 'min-width:0' },
                    h('h4', { class: 'bond-name', text: bond.partnerGameName }),
                    socialLine,
                    bond.note ? h('div', { class: 'bond-note', text: bond.note }) : null),
                h('div', { class: 'actions' },
                    h('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary icon-btn', title: '編輯隊友', 'aria-label': '編輯隊友', onclick: () => openBondModal(bond.id) }, icon('bi-pencil')),
                    h('button', { type: 'button', class: 'btn btn-sm btn-outline-danger icon-btn', title: '結束羈絆', 'aria-label': '結束羈絆', onclick: () => endBond(acc.id, bond.id) }, icon('bi-box-arrow-right')))),
            h('div', { class: 'bond-level' },
                levelField,
                h('span', { text: `等級差 ${s.diff}` })),
            needBox,
            h('div', { class: 'bar-row' }, barLabel, progress(gamesPct, 'games', '羈絆條進度')),
            buttons,
            h('div', { class: 'bar-row' },
                h('span', { class: 'bar-label', text: `本輪已達成 ${bond.cycleCount} / ${L.CYCLE_LENGTH} 次` + (bond.totalCycles ? `・已完成 ${bond.totalCycles} 輪` : '') }),
                progress(Math.round((bond.cycleCount / L.CYCLE_LENGTH) * 100), 'cycle', '本輪達成次數')),
            h('div', { class: 'reward-line' + (nextReward.orbTicket ? ' orb' : ''), text: `下一次：第 ${nextNo} 次 ${nextReward.name}` }),
            h('div', { class: 'ticket-line' + (ticketNow ? ' now' : ''), text: ticketText }),
            h('div', { class: 'btn-row' },
                h('button', { type: 'button', class: 'btn btn-sm btn-link text-secondary', style: 'min-height:auto', onclick: () => openCountsModal(bond.id) }, icon('bi-sliders'), ' 修改次數')));
    }

    function historySection(acc) {
        if (acc.history.length === 0) return null;
        const full = acc.bonds.length >= L.MAX_BONDS_PER_ACCOUNT;
        return h('details', { class: 'mt-4' },
            h('summary', { class: 'fw-bold' }, `歷史紀錄（${acc.history.length}）`),
            h('ul', { class: 'list-group mt-2' }, acc.history.map((e) => h('li', { class: 'list-group-item history-item' },
                h('strong', { text: partnerLabel(e) }),
                e.partnerAccountId ? null : h('span', { class: 'meta', text: socialLabel(e.partnerSocial) }),
                h('span', { class: 'meta', text: `第 ${e.cycleCount} / ${L.CYCLE_LENGTH} 次・${e.totalCycles} 輪・${e.startedAt || '?'} ～ ${e.endedAt}` }),
                h('span', { class: 'actions' },
                    h('button', { type: 'button', class: 'btn btn-sm btn-outline-primary', disabled: full, title: full ? '隊友已滿 3 位' : null, onclick: () => restoreBond(acc.id, e.id) }, icon('bi-arrow-counterclockwise'), ' 找回'),
                    h('button', { type: 'button', class: 'btn btn-sm btn-outline-danger', onclick: () => deleteHistory(acc.id, e.id) }, icon('bi-trash'), ' 刪除'))))));
    }

    // ---------------- 操作 ----------------
    function withAccount(accId, fn) {
        const acc = data.accounts.find((a) => a.id === accId);
        if (acc) fn(acc);
    }

    function replaceBond(acc, bond) {
        acc.bonds = acc.bonds.map((b) => (b.id === bond.id ? bond : b));
    }

    function reportCompletion(acc, bond, completion) {
        const nameText = `${bond.partnerGameName} 第 ${completion.number} 次達成：${completion.reward.name}${completion.reward.orbTicket ? ' 🎉' : ''}`;
        showToast(nameText, 'reward', { label: '還沒滿', run: () => undoCompletion(acc.id, bond.id) });
    }

    function plusGame(accId, bondIds) {
        withAccount(accId, (acc) => {
            const t = today();
            const done = [];
            commit(() => {
                bondIds.forEach((id) => {
                    const b = findBond(acc, id);
                    if (!b) return;
                    const r = L.addGame(b, acc.level, data.settings, t);
                    if (r.blocked) return;
                    replaceBond(acc, r.bond);
                    if (r.completion) done.push({ bond: r.bond, completion: r.completion });
                });
            });
            if (done.length === 1) reportCompletion(acc, done[0].bond, done[0].completion);
            else if (done.length > 1) {
                showToast(done.map((d) => `${d.bond.partnerGameName} 第 ${d.completion.number} 次：${d.completion.reward.name}`).join('；') +
                    '（還沒滿的話，到卡片上按「還沒滿」）', 'reward');
            } else if (bondIds.length > 1) showToast(`已記錄 ${bondIds.length} 段羈絆各 ＋1 場`);
        });
    }

    function minusGame(accId, bondId) {
        withAccount(accId, (acc) => commit(() => { const b = findBond(acc, bondId); if (b) replaceBond(acc, L.removeGame(b)); }));
    }

    function markFull(accId, bondId) {
        withAccount(accId, (acc) => {
            const b = findBond(acc, bondId);
            if (!b) return;
            const played = b.gamesPlayed || 0;
            const msg = played >= 1
                ? `確定「${b.partnerGameName}」已經跑滿了？\n會算達成一次，之後跑滿上限改成 ${played} 場。`
                : `確定「${b.partnerGameName}」已經跑滿了？\n目前沒有記錄場數，會算達成一次，上限不變。`;
            if (!confirm(msg)) return;
            let r;
            commit(() => { r = L.markFull(b, acc.level, data.settings, today()); replaceBond(acc, r.bond); });
            if (r.completion) reportCompletion(acc, r.bond, r.completion);
        });
    }

    function undoCompletion(accId, bondId) {
        withAccount(accId, (acc) => {
            const b = findBond(acc, bondId);
            if (!b) return;
            let r;
            commit(() => { r = L.notFullYet(b, acc.level, data.settings, today()); if (r.undone) replaceBond(acc, r.bond); });
            if (r.undone) showToast(`已撤銷，${b.partnerGameName} 之後跑滿上限改成 ${r.newLimit} 場`, 'info');
            else showToast('已經換日，無法撤銷，請用「修改次數」調整', 'error');
        });
    }

    function changeMyLevel(accId, input) {
        const level = L.parseLevel(input.value);
        withAccount(accId, (acc) => {
            if (level === null) { showToast(`等級請輸入 ${L.LEVEL_MIN}–${L.LEVEL_MAX} 的整數`, 'error'); input.value = acc.level; return; }
            if (level === acc.level) return;
            commit(() => { acc.level = level; });
        });
    }

    function changePartnerLevel(accId, bondId, input) {
        const level = L.parseLevel(input.value);
        withAccount(accId, (acc) => {
            const b = findBond(acc, bondId);
            if (!b) return;
            if (level === null) { showToast(`等級請輸入 ${L.LEVEL_MIN}–${L.LEVEL_MAX} 的整數`, 'error'); input.value = b.partnerLevel; return; }
            if (level === b.partnerLevel) return;
            commit(() => replaceBond(acc, { ...b, partnerLevel: level }));
        });
    }

    function endBond(accId, bondId) {
        withAccount(accId, (acc) => {
            const b = findBond(acc, bondId);
            if (!b || !confirm(`結束和「${b.partnerGameName}」的羈絆？\n目前的次數會留在歷史紀錄，之後可以找回接續。`)) return;
            commit(() => {
                acc.bonds = acc.bonds.filter((x) => x.id !== bondId);
                acc.history.unshift(L.endBond(b, today()));
            });
            showToast(`已結束和 ${b.partnerGameName} 的羈絆`, 'info');
        });
    }

    function restoreBond(accId, entryId) {
        withAccount(accId, (acc) => {
            if (acc.bonds.length >= L.MAX_BONDS_PER_ACCOUNT) { showToast('隊友已滿 3 位，請先結束一段羈絆', 'error'); return; }
            const e = acc.history.find((x) => x.id === entryId);
            if (!e) return;
            commit(() => {
                acc.history = acc.history.filter((x) => x.id !== entryId);
                acc.bonds.push(L.restoreBond(e));
            });
            showToast(`已找回 ${e.partnerGameName}，從第 ${e.cycleCount + 1} 次接續`);
        });
    }

    function deleteHistory(accId, entryId) {
        withAccount(accId, (acc) => {
            const e = acc.history.find((x) => x.id === entryId);
            if (!e || !confirm(`永久刪除「${e.partnerGameName}」的歷史紀錄？刪除後無法找回。`)) return;
            commit(() => { acc.history = acc.history.filter((x) => x.id !== entryId); });
        });
    }

    function deleteAccount(accId) {
        withAccount(accId, (acc) => {
            const linkedFrom = data.accounts.filter((a) => a.id !== accId && a.bonds.some((b) => b.partnerAccountId === accId)).map((a) => a.name);
            if (!confirm(`刪除帳號「${acc.name}」？\n會一起刪除 ${acc.bonds.length} 段羈絆和 ${acc.history.length} 筆歷史紀錄，無法復原。` +
                (linkedFrom.length ? `\n\n${linkedFrom.join('、')} 和這個帳號的羈絆會保留，改成一般的其他玩家。` : ''))) return;
            commit(() => {
                data.accounts = data.accounts.filter((a) => a.id !== accId);
                fixCurrentAccount();
                store.set(CURRENT_ACCOUNT_KEY, currentAccountId || '');
            });
            showToast(`已刪除帳號 ${acc.name}`, 'info');
        });
    }

    // ---------------- Modal：帳號 ----------------
    const modal = (id) => window.bootstrap.Modal.getOrCreateInstance($(id));
    let editingAccountId = null;

    function openAccountModal(accId) {
        editingAccountId = accId;
        const acc = accId ? data.accounts.find((a) => a.id === accId) : null;
        $('accountModalTitle').textContent = acc ? '修改帳號' : '新增帳號';
        $('accountName').value = acc ? acc.name : '';
        $('accountLevel').value = acc ? acc.level : '';
        modal('accountModal').show();
    }

    $('accountForm').addEventListener('submit', (ev) => {
        ev.preventDefault();
        const name = $('accountName').value.trim();
        const level = L.parseLevel($('accountLevel').value);
        if (!name) { showToast('請輸入帳號名稱', 'error'); return; }
        if (level === null) { showToast(`等級請輸入 ${L.LEVEL_MIN}–${L.LEVEL_MAX} 的整數`, 'error'); return; }
        commit(() => {
            const acc = editingAccountId && data.accounts.find((a) => a.id === editingAccountId);
            if (acc) {
                acc.name = name;
                acc.level = level;
            } else {
                const a = L.makeAccount({ name, level });
                data.accounts.push(a);
                currentAccountId = a.id;
                store.set(CURRENT_ACCOUNT_KEY, a.id);
            }
        });
        modal('accountModal').hide();
    });

    // ---------------- Modal：隊友 ----------------
    let editingBondId = null;

    $('partnerPlatform').replaceChildren(...L.SOCIAL_PLATFORMS.map((p) => h('option', { value: p, text: p })));
    const syncCustomPlatform = () => { $('partnerCustomPlatform').hidden = $('partnerPlatform').value !== '其他'; };
    $('partnerPlatform').addEventListener('change', syncCustomPlatform);
    $('restoreToggle').addEventListener('click', () => { $('restoreList').hidden = !$('restoreList').hidden; });

    // 隊友類型：其他玩家 / 自己的帳號
    const partnerIsOwn = () => $('partnerTypeOwn').checked;
    function syncPartnerType() {
        $('otherPlayerFields').hidden = partnerIsOwn();
        $('ownAccountFields').hidden = !partnerIsOwn();
    }
    $('partnerTypeOther').addEventListener('change', syncPartnerType);
    $('partnerTypeOwn').addEventListener('change', syncPartnerType);

    // 可以選的自己帳號：不含目前帳號、不含這個帳號已經有的自己帳號隊友 (編輯中的那位除外)
    function ownAccountChoices(acc, editingBond) {
        const taken = new Set(acc.bonds.filter((b) => b !== editingBond && b.partnerAccountId).map((b) => b.partnerAccountId));
        return data.accounts.filter((a) => a.id !== acc.id && !taken.has(a.id));
    }

    function openBondModal(bondId) {
        const acc = currentAccount();
        if (!acc) return;
        if (!bondId && acc.bonds.length >= L.MAX_BONDS_PER_ACCOUNT) { showToast('一個帳號最多 3 位隊友', 'error'); return; }
        editingBondId = bondId;
        const b = bondId ? findBond(acc, bondId) : null;
        $('bondModalTitle').textContent = b ? '編輯隊友' : '新增隊友';

        const choices = ownAccountChoices(acc, b);
        $('partnerAccount').replaceChildren(...choices.map((a) => h('option', { value: a.id, text: `${a.name}（等級 ${a.level}）` })));
        $('partnerTypeOwn').disabled = choices.length === 0;
        $('ownAccountHint').hidden = choices.length > 0;
        const own = !!(b && b.partnerAccountId);
        $('partnerTypeOwn').checked = own;
        $('partnerTypeOther').checked = !own;
        if (own) $('partnerAccount').value = b.partnerAccountId;
        syncPartnerType();

        $('partnerName').value = b ? b.partnerGameName : '';
        $('partnerPlatform').value = b ? b.partnerSocial.platform : 'LINE';
        $('partnerCustomPlatform').value = b ? (b.partnerSocial.customPlatform || '') : '';
        $('partnerHandle').value = b ? b.partnerSocial.handle : '';
        $('partnerLevel').value = b ? b.partnerLevel : '';
        $('bondStaminaPerGame').value = b && b.staminaPerGame ? b.staminaPerGame : '';
        $('bondStaminaPerGame').placeholder = `預設 ${data.settings.staminaPerGame}`;
        $('bondNote').value = b ? b.note : '';
        syncCustomPlatform();

        // 從歷史紀錄找回 (只在新增時顯示)
        const showRestore = !b && acc.history.length > 0;
        $('restoreSection').hidden = !showRestore;
        $('restoreList').hidden = true;
        $('restoreList').replaceChildren(...acc.history.map((e) => h('button', {
            type: 'button', class: 'list-group-item list-group-item-action',
            onclick: () => { modal('bondModal').hide(); restoreBond(acc.id, e.id); },
        }, h('strong', { text: partnerLabel(e) }), h('span', { class: 'text-muted small', text: `　第 ${e.cycleCount} 次・結束於 ${e.endedAt}` }))));
        modal('bondModal').show();
    }

    $('bondForm').addEventListener('submit', (ev) => {
        ev.preventDefault();
        const acc = currentAccount();
        if (!acc) return;
        const spgRaw = $('bondStaminaPerGame').value.trim();
        const spg = spgRaw === '' ? null : L.parseStaminaPerGame(spgRaw);
        if (spgRaw !== '' && spg === null) { showToast(`每場體力請輸入 1–${L.STAMINA_PER_GAME_MAX} 的整數`, 'error'); return; }
        const note = $('bondNote').value.trim();

        let fields;
        if (partnerIsOwn()) {
            const target = data.accounts.find((a) => a.id === $('partnerAccount').value);
            if (!target) { showToast('請選擇自己的帳號', 'error'); return; }
            // 名稱與等級由 normalizeData 跟著那個帳號更新
            fields = { partnerAccountId: target.id, partnerGameName: target.name, partnerLevel: target.level, partnerSocial: { platform: '其他', customPlatform: '', handle: '' } };
        } else {
            const name = $('partnerName').value.trim();
            const level = L.parseLevel($('partnerLevel').value);
            if (!name) { showToast('請輸入隊友遊戲名稱', 'error'); return; }
            if (level === null) { showToast(`等級請輸入 ${L.LEVEL_MIN}–${L.LEVEL_MAX} 的整數`, 'error'); return; }
            fields = {
                partnerAccountId: null, partnerGameName: name, partnerLevel: level,
                partnerSocial: {
                    platform: $('partnerPlatform').value,
                    customPlatform: $('partnerPlatform').value === '其他' ? $('partnerCustomPlatform').value.trim() : '',
                    handle: $('partnerHandle').value.trim(),
                },
            };
        }
        commit(() => {
            const b = editingBondId && findBond(acc, editingBondId);
            if (b) replaceBond(acc, { ...b, ...fields, staminaPerGame: spg, note });
            else if (acc.bonds.length < L.MAX_BONDS_PER_ACCOUNT) acc.bonds.push(L.makeBond({ ...fields, staminaPerGame: spg, note }, today()));
        });
        modal('bondModal').hide();
    });

    // ---------------- Modal：修改次數 ----------------
    let countsBondId = null;

    function openCountsModal(bondId) {
        const acc = currentAccount();
        const b = acc && findBond(acc, bondId);
        if (!b) return;
        countsBondId = bondId;
        const s = L.todayStatus(b, acc.level, data.settings, today());
        $('countsModalTitle').textContent = `修改次數：${b.partnerGameName}`;
        $('countsCycle').value = b.cycleCount;
        $('countsToday').checked = s.completedToday;
        $('countsGames').value = b.gamesPlayed || 0;
        $('countsLimit').value = s.overridden ? s.limit : '';
        $('countsLimit').placeholder = `估算 ${s.estimate} 場`;
        $('countsLimitHint').textContent = `留空 = 用估算（等級差 ${s.diff}，約 ${s.stamina} 體 ÷ 每場 ${s.staminaPerGame} 體 = ${s.estimate} 場）。`;
        modal('countsModal').show();
    }

    $('countsForm').addEventListener('submit', (ev) => {
        ev.preventDefault();
        const acc = currentAccount();
        const b = acc && findBond(acc, countsBondId);
        if (!b) return;
        const cycleCount = L.parseIntInRange($('countsCycle').value, 0, L.CYCLE_LENGTH - 1);
        const gamesPlayed = L.parseIntInRange($('countsGames').value, 0, 999);
        const limitRaw = $('countsLimit').value.trim();
        const limit = limitRaw === '' ? null : L.parseIntInRange(limitRaw, 1, 999);
        if (cycleCount === null) { showToast(`次數請輸入 0–${L.CYCLE_LENGTH - 1}`, 'error'); return; }
        if (gamesPlayed === null) { showToast('場數請輸入 0 以上的整數', 'error'); return; }
        if (limitRaw !== '' && limit === null) { showToast('上限請輸入 1 以上的整數，或留空', 'error'); return; }
        commit(() => replaceBond(acc, L.setCounts(b, { cycleCount, completedToday: $('countsToday').checked, gamesPlayed, limit }, acc.level, data.settings, today())));
        modal('countsModal').hide();
        showToast('已更新次數');
    });

    // ---------------- Modal：打完一場 ----------------
    function openPlayedModal() {
        const acc = currentAccount();
        if (!acc) return;
        const t = today();
        const pending = acc.bonds.filter((b) => !L.isCompletedToday(b, t));
        if (pending.length === 0) { showToast('今天的羈絆都達成了', 'info'); return; }
        $('playedList').replaceChildren(...pending.map((b) => {
            const s = L.todayStatus(b, acc.level, data.settings, t);
            return h('label', { class: 'list-group-item d-flex align-items-center gap-2' },
                h('input', { type: 'checkbox', class: 'form-check-input m-0', value: b.id, checked: true }),
                h('span', { class: 'flex-grow-1', text: partnerLabel(b) }),
                h('span', { class: 'text-muted small', text: `${s.played} / ${s.limit} 場` }));
        }));
        modal('playedModal').show();
    }

    $('playedForm').addEventListener('submit', (ev) => {
        ev.preventDefault();
        const acc = currentAccount();
        const ids = [...$('playedList').querySelectorAll('input:checked')].map((i) => i.value);
        modal('playedModal').hide();
        if (acc && ids.length > 0) plusGame(acc.id, ids);
    });

    // ---------------- 設定與備份 ----------------
    $('globalStaminaPerGame').addEventListener('change', (ev) => {
        const v = L.parseStaminaPerGame(ev.target.value);
        if (v === null) { showToast(`每場體力請輸入 1–${L.STAMINA_PER_GAME_MAX} 的整數`, 'error'); ev.target.value = data.settings.staminaPerGame; return; }
        if (v === data.settings.staminaPerGame) return;
        commit(() => { data.settings.staminaPerGame = v; });
        if (!$('toast').classList.contains('show')) showToast(`每場體力預設改為 ${v}`);
    });

    $('exportBtn').addEventListener('click', () => downloadJson(data, `bond_tracker_${today()}.json`));
    $('importBtn').addEventListener('click', () => $('importFile').click());
    $('importFile').addEventListener('change', async (ev) => {
        const file = ev.target.files[0];
        ev.target.value = '';
        if (!file) return;
        try {
            const parsed = JSON.parse(await file.text());
            if (!parsed || !Array.isArray(parsed.accounts)) throw new Error('格式不符');
            const next = L.sanitizeData(parsed);
            if (!confirm(`載入備份會取代目前的資料（${next.accounts.length} 個帳號）。確定嗎？`)) return;
            commit(() => { data = next; fixCurrentAccount(); });
            showToast('已載入備份');
        } catch (e) {
            console.error(e);
            showToast('備份檔格式不正確', 'error');
        }
    });

    // ---------------- 懸浮工具箱 ----------------
    function renderToolboxMenu() {
        const list = document.querySelector('.toolbox-items-list');
        const tools = (Array.isArray(window.MS_TOOLS) ? window.MS_TOOLS : [])
            .filter((t) => t && typeof t.name === 'string' && typeof t.url === 'string' && /^https:\/\//.test(t.url));
        if (!list || tools.length === 0) return;
        const home = list.querySelector('.toolbox-home');
        const links = tools.map((t) => {
            const active = t.id === THIS_TOOL_ID;
            return h('a', { href: t.url, class: 'toolbox-item' + (active ? ' active' : '') },
                (typeof t.emoji === 'string' ? t.emoji + ' ' : '') + t.name + (active ? ' (現行)' : ''));
        });
        // 工具箱還沒加入這個工具時，保留自己的連結
        if (!tools.some((t) => t.id === THIS_TOOL_ID)) links.push(list.querySelector('.toolbox-item.active'));
        list.replaceChildren(...[home, ...links].filter(Boolean));
    }

    function loadToolboxMenu() {
        const s = document.createElement('script');
        s.src = TOOLBOX_TOOLS_URL;
        s.async = true;
        s.onload = renderToolboxMenu;
        s.onerror = () => console.warn('[TOOLBOX] 讀不到工具箱的 tools.js，使用內建連結');
        document.head.appendChild(s);
    }

    // ---------------- 啟動 ----------------
    checkAuthCache();
    loadLocal();
    render();
    updateCloudStatus('offline', '離線模式 (資料存在本機)');
    initFirebaseAuth();
    loadToolboxMenu();

    // 換日時自動重畫 (頁面開著跨過 00:00)
    setInterval(() => { if (today() !== lastRenderedDate) render(); }, 30 * 1000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && today() !== lastRenderedDate) render(); });
});
