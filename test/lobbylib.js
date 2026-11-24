// What the lobby suites share (test/lobby.js, test/lobbysave.js, test/lobbysoak.js): the real
// title's menu worked with real keys, and the corner list read off the page.
const { waitFor, sleep } = require('./lib');

const titleReady = () => window.SceneManager && SceneManager._scene instanceof Scene_Title && SceneManager.isCurrentSceneStarted() && !SceneManager.isSceneChanging() && window.Coop && Coop.connected && !!Coop.name;
const menu = (p) => p.evaluate(() => {
    const w = SceneManager._scene && SceneManager._scene._commandWindow;
    if (!w) return { lines: [], at: -1, shown: false };
    return { lines: w._list.map((c) => c.name + (c.enabled ? '' : '~')), at: w.index(), shown: w.visible && w.isOpen(), active: w.active };
});
const hud = (p) => p.evaluate(() => document.getElementById('coop-hud').innerText.replace(/\n+/g, ' | '));
const dimRows = (p) => p.evaluate(() => Array.from(document.querySelectorAll('#coop-hud .row.dim')).map((r) => r.innerText));

// The corner list is redrawn four times a second: a line the room has just changed is waited for.
const hudIs = (p, re, ms) => waitFor(p, (src) => new RegExp(src).test(document.getElementById('coop-hud').innerText.replace(/\n+/g, ' | ')),
    ms || 5000, 'the corner list to say ' + re.source, re.source).then(() => true, () => false);

async function key(p, k) {
    await p.keyboard.down(k);
    await sleep(110);
    await p.keyboard.up(k);
    await sleep(190);
}
// Down to the line with this name, then the action key, as a player would.
async function choose(p, name) {
    await waitFor(p, (n) => { const w = SceneManager._scene && SceneManager._scene._commandWindow; return w && w.active && w.isOpen() && w._list.some((c) => c.name === n); }, 15000, 'the menu line "' + name + '"', name);
    for (let i = 0; i < 8; i++) {
        const m = await menu(p);
        if (m.lines[m.at] && m.lines[m.at].replace(/~$/, '') === name) break;
        await key(p, 'ArrowDown');
    }
    await key(p, 'Enter');
}
const menuIs = (p, lines, ms) => waitFor(p, (want) => {
    const w = SceneManager._scene && SceneManager._scene._commandWindow;
    return !!w && w._list.map((c) => c.name + (c.enabled ? '' : '~')).join('|') === want;
}, ms || 15000, 'the menu to read ' + lines.join(' / '), lines.join('|')).then(() => true, () => false);

// In the page: script errors kept, and who the picker showed when the choice was confirmed.
function watch() {
    window.__errs = [];
    const note = Coop.note;
    Coop.note = function (text) { if (/script error/.test(String(text))) window.__errs.push(String(text).slice(0, 300)); return note.apply(this, arguments); };
    const set = Game_Switches.prototype.setValue;
    Game_Switches.prototype.setValue = function (id, value) {
        if (id === 214 && value) window.__shown = $gameVariables.value(9);
        return set.apply(this, arguments);
    };
    // The courtyard hounds wait until everyone is in the run (11/22), so one no longer reaches
    // someone already in while a friend is still in the opening. The stub that stopped that fight
    // (the save then loaded still "in battle") is gone.
}

// A standard pad. A button is down while window.__padDown[i] is set. playIn plugs this,
// and so does a title choice made on the pad before the opening (test/inputs.js).
function plugPad() {
    window.__padDown = {};
    const buttons = [];
    for (let i = 0; i < 17; i++) buttons.push({
        get pressed() { return !!window.__padDown[i]; },
        get value() { return window.__padDown[i] ? 1 : 0; },
    });
    const pad = { id: 'test pad', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons, timestamp: 0 };
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad, null, null, null] });
}

async function tapPad(p, i) {
    await p.evaluate((i) => { window.__padDown[i] = 1; }, i);
    await sleep(80);
    await p.evaluate((i) => { window.__padDown[i] = 0; }, i);
    await sleep(160);
}

// One step toward the name grid's OK (cell 89). Up from the top row wraps to the bottom,
// and Left from the bottom-left cell wraps onto OK: that is the walk a player makes
// (the same two keys as test/scroll.js), not a jump of the cursor.
function nameStep(at) {
    const col = at % 10, row = Math.floor(at / 10);
    if (row !== 8) return row === 0 ? 'up' : 'down';
    if (col === 0) return 'left';
    if (col < 9) return 'right';
    return 'ok';
}

const PAD_BTN = { ok: 0, up: 12, down: 13, left: 14, right: 15 };
const KEY = { ok: 'Enter', up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };

// Held under the engine's key repeat (24 frames), so one press is one step.
async function press(p, which, pad) {
    if (pad) {
        const i = PAD_BTN[which];
        await p.evaluate((i) => { window.__padDown[i] = 1; }, i);
        await sleep(80);
        await p.evaluate((i) => { window.__padDown[i] = 0; }, i);
    } else {
        await p.keyboard.down(KEY[which]);
        await sleep(80);
        await p.keyboard.up(KEY[which]);
    }
    await sleep(150);
}

// The opening, by the action key (or a controller's A and D-pad), until the player stands in the shared world.
async function playIn(pages, ms, pad) {
    if (pad) for (const p of pages) await p.evaluate(plugPad);
    const started = Date.now();
    const done = pages.map(() => false);
    while (Date.now() - started < ms && done.some((d) => !d)) {
        for (let i = 0; i < pages.length; i++) {
            if (done[i]) continue;
            const p = pages[i];
            const st = await p.evaluate(() => {
                const s = SceneManager._scene;
                const w = s instanceof Scene_Name ? s._inputWindow : null;
                // The picker held to the lobby's pick takes it by itself: nothing is pressed there (11/22).
                const held = !!(Coop.lobby && Coop.lobby.locked && window.$gameMap && $gameMap.mapId() === 10 && $gameSwitches.value(296) && !$gameSwitches.value(214));
                return { live: Coop.world.live && s instanceof Scene_Map && !!$gameSwitches.value(79), held, nameOn: !!(w && w.active), at: w ? w.index() : -1 };
            });
            if (st.live) { done[i] = true; continue; }
            if (st.held) continue;
            if (st.nameOn && st.at !== 89) { await press(p, nameStep(st.at), pad); continue; }
            await press(p, 'ok', pad);
        }
        await sleep(120);
    }
    return done;
}

const toTitle = async (p) => { await p.evaluate(() => SceneManager.goto(Scene_Title)); await waitFor(p, titleReady, 20000, p.label + ' at the title'); };
const who = (p) => p.evaluate(() => ({ is: [661, 662, 663, 664].filter((id) => $gameSwitches.value(id)), shown: window.__shown, founded: Coop.log.some((l) => /founded the world/.test(l)) }));
const errorsOf = async (pages) => { const out = []; for (const p of pages) out.push(...await p.evaluate(() => (window.__errs || []).splice(0))); return out; };

module.exports = { titleReady, menu, hud, hudIs, dimRows, key, choose, menuIs, watch, playIn, toTitle, who, errorsOf, plugPad, tapPad };
