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
    // Nothing walks into someone who is in. The courtyard hound reached Ann while she waited through
    // Bo's opening; the test then saved her mid-fight, and that save loads onto the map still "in battle".
    const touch = Game_Event.prototype.checkEventTriggerTouch;
    Game_Event.prototype.checkEventTriggerTouch = function () { if (Coop.world.live) return; return touch.apply(this, arguments); };
}

// The opening, by the action key alone, until the player stands in the shared world.
async function playIn(pages, ms) {
    const started = Date.now();
    const done = pages.map(() => false);
    while (Date.now() - started < ms && done.some((d) => !d)) {
        for (let i = 0; i < pages.length; i++) {
            if (done[i]) continue;
            const p = pages[i];
            const st = await p.evaluate(() => {
                const s = SceneManager._scene;
                if (s instanceof Scene_Name) { const w = s._inputWindow; if (w) w.select(89); }
                return { live: Coop.world.live && s instanceof Scene_Map && !!$gameSwitches.value(79), title: s instanceof Scene_Title };
            });
            if (st.live) { done[i] = true; continue; }
            await p.keyboard.down('Enter');
            await sleep(80);
            await p.keyboard.up('Enter');
        }
        await sleep(120);
    }
    return done;
}

const toTitle = async (p) => { await p.evaluate(() => SceneManager.goto(Scene_Title)); await waitFor(p, titleReady, 20000, p.label + ' at the title'); };
const who = (p) => p.evaluate(() => ({ is: [661, 662, 663, 664].filter((id) => $gameSwitches.value(id)), shown: window.__shown, founded: Coop.log.some((l) => /founded the world/.test(l)) }));
const errorsOf = async (pages) => { const out = []; for (const p of pages) out.push(...await p.evaluate(() => (window.__errs || []).splice(0))); return out; };

module.exports = { titleReady, menu, hud, hudIs, dimRows, key, choose, menuIs, watch, playIn, toTitle, who, errorsOf };
