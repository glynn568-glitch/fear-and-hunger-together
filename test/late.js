// Shared by the end-game suites: two players put on a late map with flags set, and a
// driver that reads text on and answers choices the way a player would.
const { twoPlayers, waitFor, sleep } = require('./common');

// Installed in each tab. Text is read on; choices come from `picks` (a number, or a
// regular expression's source to match the choice's text); a fight can be won at once.
function installDriver() {
    const D = window.D = { picks: [], seen: [], choices: [], win: false, lose: false, read: true, timer: 0 };
    let up = false;
    D.speed = function (n) { SceneManager._deltaTime = 1 / 60 / n; };
    D.tick = function () {
        const s = SceneManager._scene;
        if (!s) return;
        if (s instanceof Scene_Battle) {
            if (D.win && BattleManager._phase && !BattleManager.isBattleEnd() && $gameTroop.members().some((e) => e.isAlive())) {
                for (const e of $gameTroop.members()) { e.setHp(0); e.addState(e.deathStateId()); }
            }
            // A turn has to be played for the fight to see it is over: whoever chooses, guards.
            const actor = BattleManager.actor(), act = BattleManager.inputtingAction();
            if ((D.win || D.lose) && BattleManager.isInputting() && actor && act && D._chose !== act && Coop.applyPick) { D._chose = act; Coop.applyPick(actor, { do: 'guard' }); }
            if (D.lose && BattleManager._phase && !BattleManager.isBattleEnd()) {
                for (const m of $gameParty.members()) { m.setHp(0); m.addState(m.deathStateId()); }
            }
        }
        const w = s._messageWindow && s._messageWindow._choiceWindow;
        if ($gameMessage.isChoice() && w && w.active) {
            const texts = $gameMessage.choices();
            const list = texts.join(' | ');
            if (D._choiceText !== list) { D._choiceText = list; D.choices.push(list); }
            if (D.picks.length) {
                const p = D.picks[0];
                const i = typeof p === 'number' ? p : texts.findIndex((t) => new RegExp(p).test(t));
                if (i >= 0) { w.select(i); D.picks.shift(); }
            }
            if (!D.read) return;
            up = !up;
            Input._currentState.ok = up;
            return;
        }
        D._choiceText = '';
        if (D.read && $gameMessage.isBusy()) { up = !up; Input._currentState.ok = up; return; }
        if (up) { up = false; Input._currentState.ok = false; }
    };
    D.timer = setInterval(D.tick, 50);
    // Puts a player on a spot, nothing running, the map's own opening scene done or skipped as asked.
    D.go = function (m, x, y) {
        $gameMap._interpreter.clear();
        $gameMessage.clear();
        $gamePlayer.reserveTransfer(m, x, y, 2, 0);
    };
    D.state = function () {
        const s = SceneManager._scene;
        const it = $gameMap._interpreter;
        return {
            scene: s ? s.constructor.name : '', map: $gameMap.mapId(), x: $gamePlayer.x, y: $gamePlayer.y, dead: !!Coop.dead,
            live: Coop.world.live, running: it.isRunning() ? it.eventId() : 0, msg: $gameMessage.isBusy(), party: $gameParty._actors.slice(),
            role: Coop.battle ? Coop.battle.role : '', fp: Coop.world.fingerprint().length,
        };
    };
}

// Two players (A Cahara, B D'arce by default) with the driver in, the game sped up.
async function latePair(port, opts) {
    const s = await twoPlayers(port, opts);
    for (const p of [s.a, s.b]) {
        await p.evaluate(installDriver);
        await p.evaluate((n) => D.speed(n), (opts && opts.speed) || 4);
    }
    return s;
}

const onMap = (p, m, ms) => waitFor(p, (m) => $gameMap.mapId() === m && SceneManager._scene instanceof Scene_Map && !$gamePlayer.isTransferring() && !SceneManager.isSceneChanging(), ms || 30000, p.label + ' on map ' + m, m);

async function put(p, m, x, y) {
    await p.evaluate((m, x, y) => D.go(m, x, y), m, x, y);
    await onMap(p, m);
}

// Sets flags as the game would, so shared ones reach everyone.
const flags = (p, on) => p.evaluate((on) => { for (const id of on) $gameSwitches.setValue(id, true); }, on);

// Waits until both reach the end of the run: Game Over or the title.
async function bothEnd(pages, ms) {
    const atEnd = () => SceneManager._scene instanceof Scene_Gameover || SceneManager._scene instanceof Scene_Title;
    const t0 = Date.now();
    let done = [];
    while (Date.now() - t0 < (ms || 180000)) {
        done = await Promise.all(pages.map((p) => p.evaluate(atEnd)));
        if (done.every(Boolean)) return true;
        await sleep(300);
    }
    return false;
}

module.exports = { latePair, onMap, put, flags, bothEnd, installDriver };
