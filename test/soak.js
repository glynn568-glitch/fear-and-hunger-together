// Two bots wander the first dungeon floor of the real game for a few minutes,
// walking at random and mashing confirm through whatever they run into.
// Reports script errors, switches that had to be demoted, and whether the two
// machines still agree about the world at the end.
const { twoPlayers, sleep } = require('./common');
const { shot } = require('./lib');

const SECONDS = Number(process.argv[2] || 150);

(async () => {
    let s;
    let code = 1;
    try {
        s = await twoPlayers(8477, { ax: 49, ay: 60, bx: 48, by: 60 });
        const { a, b } = s;
        const seen = { A: new Set(), B: new Set() };
        const started = Date.now();
        let tick = 0;
        // Worlds are compared whenever both players are in it, not only at the end:
        // a run that ends at the title (both dead) or offline still has to have agreed.
        let checks = 0, agree = true;
        const compare = async () => {
            const live = async (p) => p.evaluate(() => !!(Coop.world && Coop.world.live)).catch(() => false);
            if (!(await live(a)) || !(await live(b))) return;
            let fa, fb;
            for (let i = 0; i < 4; i++) {
                if (i) await sleep(1000);
                fa = await a.evaluate(() => Coop.world.fingerprint()); fb = await b.evaluate(() => Coop.world.fingerprint());
                if (fa === fb) { checks++; return; }
            }
            agree = false;
            const sa = new Set(fa.split(';')), sb = new Set(fb.split(';'));
            console.log('only A:', [...sa].filter((k) => !sb.has(k)).slice(0, 20).join(' '));
            console.log('only B:', [...sb].filter((k) => !sa.has(k)).slice(0, 20).join(' '));
        };
        while (Date.now() - started < SECONDS * 1000) {
            tick++;
            for (const p of [a, b]) {
                const st = await p.evaluate(() => {
                    const scene = SceneManager._scene;
                    const name = scene ? scene.constructor.name : 'none';
                    if (name === 'Scene_Map' && !$gameMap.isEventRunning() && !$gameMessage.isBusy() && !$gamePlayer.isMoving() && $gamePlayer.canMove()) {
                        $gamePlayer.moveStraight([2, 4, 6, 8][Math.randomInt(4)]);
                        return name;
                    }
                    return name + (window.$gameMap && $gameMap.isEventRunning() ? '+event' : '');
                }).catch(() => 'gone');
                seen[p.label].add(st);
                if (st !== 'Scene_Map') {
                    await p.keyboard.down('Enter'); await sleep(60); await p.keyboard.up('Enter');
                    if (tick % 7 === 0) { await p.keyboard.down('ArrowDown'); await sleep(60); await p.keyboard.up('ArrowDown'); }
                }
            }
            await sleep(140);
            if (tick % 120 === 0) {
                const where = async (p) => p.evaluate(() => (SceneManager._scene ? SceneManager._scene.constructor.name : '') + (window.$gameMap ? ' map' + $gameMap.mapId() + ' ' + $gamePlayer.x + ',' + $gamePlayer.y : '') + (Coop.battle ? ' battle:' + Coop.battle.role : '') + (Coop.dead ? ' dead' : '') + ' hp' + (window.$gameParty && $gameParty.leader() ? $gameParty.leader().hp : '?'));
                console.log(Math.round((Date.now() - started) / 1000) + 's  A: ' + await where(a) + '  |  B: ' + await where(b));
                await compare();
            }
        }
        console.log('scenes A:', [...seen.A].join(', '));
        console.log('scenes B:', [...seen.B].join(', '));
        const report = async (p) => p.evaluate(() => ({
            demoted: Array.from(Coop.world.demoted),
            live: Coop.world.live,
            scene: SceneManager._scene ? SceneManager._scene.constructor.name : '',
            stopped: SceneManager._stopped,
            log: Coop.log.slice(-8),
        }));
        const ra = await report(a), rb = await report(b);
        console.log('A', JSON.stringify(ra));
        console.log('B', JSON.stringify(rb));
        if (ra.live && rb.live) { await sleep(1500); await compare(); }
        console.log('worlds agree:', agree, '(' + checks + ' checks)');
        const errs = [...a.errors, ...b.errors].filter((e) => !/physical_attack_animation/.test(e));
        console.log('script errors:', errs.length);
        for (const e of [...new Set(errs)].slice(0, 6)) console.log('   ', e.slice(0, 600));
        console.log('screenshots', await shot(a, 'soak-a'), await shot(b, 'soak-b'));
        code = errs.length === 0 && !ra.stopped && !rb.stopped && agree && checks > 0 ? 0 : 1;
    } catch (e) { console.error(e); }
    if (s) await s.close();
    console.log(code ? 'SOAK FAILED' : 'SOAK OK');
    process.exit(code);
})();
