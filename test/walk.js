// A partner walking across the map walks without stopping on the other screen,
// over a shaky line (FH_LAG 60 ms, FH_JITTER up to 150 ms more, in order, as on
// Wi-Fi). His 10/21: "still feels slow and low framerate". Their position comes
// once a step; a late one used to stop their character between tiles.
const { twoPlayers, checker, sleep, waitFor } = require('./common');

const STEPS = 16;

(async () => {
    const check = checker();
    let s;
    try {
        s = await twoPlayers(8733, { env: { FH_LAG: '60', FH_JITTER: '150' } });
        const { a, b, idA } = s;
        await a.evaluate(() => $gamePlayer.locate(10, 67));
        await sleep(2500);

        // B watches A's character every frame.
        await b.evaluate((id) => {
            window.__seen = [];
            const _upd = Game_Map.prototype.update;
            Game_Map.prototype.update = function (active) {
                _upd.call(this, active);
                const av = Coop.avatars.get(id);
                if (av) window.__seen.push([av.isMoving() ? 1 : 0, av._realX, Date.now(), av._stopCount, av._pattern]);
            };
        }, idA);

        // A walks east without stopping.
        const t0 = await a.evaluate((n) => new Promise((done) => {
            let left = n;
            const start = Date.now();
            const _upd = Game_Player.prototype.update;
            Game_Player.prototype.update = function (active) {
                if (left > 0 && !this.isMoving()) {
                    this.setThrough(true); this.moveStraight(6); this.setThrough(false);
                    left--;
                    if (!left) setTimeout(() => done(Date.now() - start), 600);
                }
                _upd.call(this, active);
            };
        }), STEPS);
        await sleep(2000);

        const seen = await b.evaluate(() => window.__seen);
        const startX = 10, endX = 10 + STEPS;
        const first = seen.findIndex((f) => f[1] > startX + 0.01);
        const last = seen.findIndex((f) => f[1] >= endX - 0.001);
        const walk = first >= 0 && last > first ? seen.slice(first, last) : [];
        // A stop: a frame that began with them standing still (the engine counts it).
        const stalls = walk.filter((f) => f[3] > 0).length;
        const patterns = new Set(walk.filter((f) => f[0]).map((f) => f[4])).size;
        const changes = walk.filter((f, i) => i && f[4] !== walk[i - 1][4]).length;
        const took = walk.length ? walk[walk.length - 1][2] - walk[0][2] : 0;
        check('B sees A walk the whole way', first >= 0 && last > first, 'first ' + first + ' last ' + last + ' of ' + seen.length);
        check('without stopping between tiles', stalls <= 1, stalls + ' stalled frames in ' + walk.length + ' (A took ' + t0 + ' ms, B ' + took + ' ms)');
        check('stepping as they walk (legs moving, not sliding)', patterns >= 3 && changes >= STEPS, patterns + ' patterns, ' + changes + ' changes');
        check('at A\'s pace', took > 0 && Math.abs(took - (t0 - 600)) < 500, 'A ' + (t0 - 600) + ' ms, B ' + took + ' ms');
    } catch (e) { console.error(e); check('test ran to the end', false); }
    const code = check.finish(s ? [s.a, s.b] : []);
    if (s) await s.close();
    process.exit(code);
})();
