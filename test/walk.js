// A partner walking across the map walks without stopping on the other screen,
// over a shaky line (FH_LAG 60 ms, FH_JITTER up to 150 ms more, in order, as on
// Wi-Fi). His 10/21: "still feels slow and low framerate". Their position comes
// once a step; a late one used to stop their character between tiles.
const { twoPlayers, checker, sleep, waitFor } = require('./common');

// Several walks from a standstill: a late step stops them mostly as they set
// off (once a few steps are queued, the queue carries them), so one long walk
// is one throw of the dice.
const STEPS = 8;
const WALKS = 4;

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

        // A walks east without stopping, WALKS times, standing still in between.
        await a.evaluate(() => {
            const _upd = Game_Player.prototype.update;
            Game_Player.prototype.update = function (active) {
                const w = window.__walk;
                if (w && w.left > 0 && !this.isMoving()) {
                    this.setThrough(true); this.moveStraight(6); this.setThrough(false);
                    if (!--w.left) setTimeout(() => w.done(Date.now() - w.start), 600);
                }
                _upd.call(this, active);
            };
        });
        const t0 = [];
        for (let i = 0; i < WALKS; i++) {
            t0.push(await a.evaluate((n) => new Promise((done) => { window.__walk = { left: n, start: Date.now(), done }; }), STEPS));
            await sleep(1500);
        }

        const seen = await b.evaluate(() => window.__seen);
        const walks = t0.map((t, i) => {
            const startX = 10 + i * STEPS, endX = startX + STEPS;
            const first = seen.findIndex((f) => f[1] > startX + 0.01);
            const last = seen.findIndex((f) => f[1] >= endX - 0.001);
            const walk = first >= 0 && last > first ? seen.slice(first, last) : [];
            return { first, last, walk, a: t - 600, b: walk.length ? walk[walk.length - 1][2] - walk[0][2] : 0 };
        });
        const walk = [].concat(...walks.map((w) => w.walk));
        // A stop: a frame that began with them standing still (the engine counts it).
        const stalls = walk.filter((f) => f[3] > 0).length;
        const patterns = new Set(walk.filter((f) => f[0]).map((f) => f[4])).size;
        const changes = walks.reduce((n, w) => n + w.walk.filter((f, i) => i && f[4] !== w.walk[i - 1][4]).length, 0);
        const paces = walks.map((w) => 'A ' + w.a + ' ms, B ' + w.b + ' ms').join('; ');
        check('B sees A walk the whole way', walks.every((w) => w.first >= 0 && w.last > w.first), walks.map((w) => w.first + '..' + w.last).join(' ') + ' of ' + seen.length);
        check('without stopping between tiles', stalls <= 1, stalls + ' stalled frames in ' + walk.length + ' (' + paces + ')');
        check('stepping as they walk (legs moving, not sliding)', patterns >= 3 && changes >= STEPS * WALKS, patterns + ' patterns, ' + changes + ' changes');
        check('at A\'s pace', walks.every((w) => w.b > 0 && Math.abs(w.b - w.a) < 500), paces);
    } catch (e) { console.error(e); check('test ran to the end', false); }
    const code = check.finish(s ? [s.a, s.b] : []);
    if (s) await s.close();
    process.exit(code);
})();
