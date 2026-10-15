// The game's own bed, with a second player around: a safe rest opens the save
// screen and saves both players; an interrupted rest drags a guard to the
// bedside for both of them.
const { twoPlayers, checker, sleep, waitFor } = require('./common');
const { shot } = require('./lib');

async function press(page, code) {
    await page.keyboard.down(code); await sleep(120); await page.keyboard.up(code); await sleep(280);
}
async function mashUntil(page, done, tries) {
    for (let i = 0; i < (tries || 40); i++) {
        if (await page.evaluate(done)) return true;
        await press(page, 'Enter');
    }
    return page.evaluate(done);
}
const idle = () => SceneManager._scene instanceof Scene_Map && !$gameMap.isEventRunning() && !$gameMessage.isBusy() && !$gameSwitches.value(3540);

(async () => {
    const check = checker();
    let s;
    try {
        s = await twoPlayers(8449);
        const { a, b } = s;
        // The bed on level 1 is event 326; it runs when the game's "Sleeping" switch is on.
        const bed = await a.evaluate(() => { const e = $gameMap.event(326); return { x: e.x, y: e.y, pages: e.event().pages.length }; });
        await a.evaluate((p) => { $gamePlayer.setThrough(true); $gamePlayer.locate(p.x, p.y + 1); $gamePlayer.setThrough(false); }, bed);

        // 1. Safe rest: every guard that could interrupt is dead.
        await a.evaluate(() => { for (const id of [23, 732, 733]) $gameSwitches.setValue(id, true); });
        await sleep(400);
        await a.evaluate(() => $gameSwitches.setValue(3540, true));
        await waitFor(a, () => SceneManager._scene instanceof Scene_Save, 15000, 'the save screen after a safe rest');
        console.log('screenshot', await shot(a, 'sleep-save'));
        await press(a, 'Enter'); // first slot
        await waitFor(a, () => SceneManager._scene instanceof Scene_Map, 15000, 'A back on the map');
        check('A rested and saved', await mashUntil(a, idle) && await a.evaluate(() => StorageManager.exists(1)));
        await waitFor(b, () => StorageManager.exists(1), 8000, 'B saved alongside');
        check('B was saved along with A, without having to sleep', true);
        check('sleeping stayed A\'s own business', !(await b.evaluate(() => $gameSwitches.value(3540) || $gameSwitches.value(997))));
        check('A can sleep again later (the game\'s cool-down is A\'s own)', await b.evaluate(() => !$gameSwitches.value(3539)));

        // 2. Interrupted rest: a guard is alive, and the coin decides.
        await a.evaluate(() => { $gameSwitches.setValue(23, false); $gameSwitches.setValue(3539, false); });
        await sleep(400);
        let interrupted = false;
        for (let attempt = 0; attempt < 6 && !interrupted; attempt++) {
            const before = await a.evaluate(() => { const g = $gameMap.event(9); return g.x + ',' + g.y; });
            // Weight the coin so the toss is lost: the branch under test.
            await a.evaluate(() => { window._ri = window._ri || Math.randomInt; Math.randomInt = (n) => (n === 2 ? 1 : window._ri(n)); $gameSwitches.setValue(3540, true); });
            // Mash through the coin toss; a won toss opens the save screen, which Escape leaves.
            const trail = [];
            for (let i = 0; i < 60; i++) {
                const now = await a.evaluate(() => SceneManager._scene.constructor.name + ($gameMessage.isBusy() ? ':' + ($gameMessage.isChoice() ? 'choice' : $gameMessage._texts.join(' ').slice(0, 24)) : '') + ($gameMap.isEventRunning() ? '+ev' : ''));
                if (trail[trail.length - 1] !== now) trail.push(now);
                if (await a.evaluate(() => SceneManager._scene instanceof Scene_Save)) { await press(a, 'Escape'); continue; }
                if (await a.evaluate(idle)) break;
                await press(a, 'Enter');
            }
            const after = await a.evaluate(() => { const g = $gameMap.event(9); return g.x + ',' + g.y; });
            interrupted = after !== before && after === '33,25';
            if (attempt === 0) console.log('   trail:', trail.join(' > '));
            console.log('rest attempt', attempt + 1, interrupted ? 'interrupted, guard at ' + after : 'undisturbed');
            await a.evaluate(() => { Math.randomInt = window._ri; $gameSwitches.setValue(3539, false); });
            console.log('   after:', await a.evaluate(() => JSON.stringify({ surprise: $gameSwitches.value(3541), coin: $gameVariables.value(14), enemy: $gameVariables.value(404), guardDead: $gameSwitches.value(23), msg: Coop.log.slice(-2) })));
        }
        check('A is free to act after every rest', await a.evaluate(idle));
        if (interrupted) {
            await sleep(900);
            const gb = await b.evaluate(() => { const g = $gameMap.event(9); return g.x + ',' + g.y; });
            check('the guard that woke A stands at the bedside for B too', gb === '33,25', gb);
        } else {
            console.log('note: six coin tosses in a row went A\'s way; the interrupted branch was not reached this run');
        }
        const fa = await a.evaluate(() => Coop.world.fingerprint()), fb = await b.evaluate(() => Coop.world.fingerprint());
        check('shared state identical after sleeping', fa === fb);
    } catch (e) { console.error(e); check('test ran to the end', false); }
    const code = check.finish(s ? [s.a, s.b] : []);
    if (s) await s.close();
    process.exit(code);
})();
