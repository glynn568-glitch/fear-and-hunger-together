// A fight seen over narrow links (FH_RATE: about 4 and 1 Mbit/s to each player),
// with Hide my IP at its default: the guest's picture is video through the
// relay, and it, the owner's messages and the guest's keys stay fresh instead
// of queueing up behind pictures for seconds.
const { twoPlayers, checker, sleep, waitFor } = require('./common');

async function link(check, port, rate, lag, label) {
    const w = await twoPlayers(port, { env: { FH_RELAY: null, FH_RATE: String(rate), FH_LAG: String(lag) } });
    const { a, b } = w;
    try {
        check(label + ': pictures go through the host', await a.evaluate(() => Coop.relayOnly));
        await a.evaluate(() => { BattleManager.setup(1, true, true); SceneManager.push(Scene_Battle); });
        await waitFor(a, () => BattleManager._phase === 'input', 30000, 'the fight is under way');
        await b.evaluate((id) => Coop.askToJoinBattle(id), w.idA);
        await waitFor(b, () => SceneManager._scene instanceof Scene_CoopSpectate && Coop.viewer.frames > 3, 30000, 'the guest sees the fight');
        await waitFor(a, () => Coop.battle && Coop.battle.guests.size === 1, 30000, 'the guest is in');
        // The picture settles to what the link carries.
        await sleep(6000);
        // Messages from the owner travel the same narrow link as the pictures.
        await b.evaluate(() => { window.PINGS = []; Coop.on('to:zping', (m) => PINGS.push(Date.now() - m.at)); Coop.viewer.ages = []; window.F0 = Coop.viewer.frames; });
        await a.evaluate(() => { window.UP = 0; const sb = Coop.sendBinary; Coop.sendBinary = function (k, id, buf) { const ok = sb.apply(this, arguments); if (ok) UP += buf.byteLength; return ok; }; });
        await a.evaluate(() => { window.PINGER = setInterval(() => { for (const id of Coop.battle.guests.keys()) Coop.sendTo(id, 'zping', { at: Date.now() }); }, 250); });
        await a.evaluate(() => { window.KEYLAG = []; Coop.on('to:bin', (m) => { if (m.at) KEYLAG.push(Date.now() - m.at); }); });
        await b.evaluate(() => { const send = Coop.sendTo; Coop.sendTo = function (id, kind, body) { if (kind === 'bin') body.at = Date.now(); return send.call(this, id, kind, body); }; });
        const t0 = Date.now();
        // The owner's screen keeps changing, as in a real turn.
        for (let i = 0; i < 16; i++) { const k = ['Enter', 'ArrowDown', 'ArrowDown', 'Escape'][i % 4]; await a.keyboard.down(k); await sleep(80); await a.keyboard.up(k); await sleep(240); }
        for (let i = 0; i < 6; i++) { await b.keyboard.down('ArrowDown'); await sleep(90); await b.keyboard.up('ArrowDown'); await sleep(250); }
        const secs = (Date.now() - t0) / 1000;
        await a.evaluate(() => clearInterval(PINGER));
        const got = await b.evaluate(() => ({ ages: Coop.viewer.ages.slice(), pings: PINGS.slice(), frames: Coop.viewer.frames - F0, clip: Coop.viewer.clip }));
        const keys = await a.evaluate(() => KEYLAG.slice());
        const up = await a.evaluate(() => UP);
        const q = (list, p) => { const s = list.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : Infinity; };
        const detail = `${got.clip ? 'video' : 'stills'} ${Math.round(up * 8 / secs / 1000)} kbit/s, ${(got.frames / secs).toFixed(1)} pictures/s, age typical ${q(got.ages, 0.5)} p95 ${q(got.ages, 0.95)} ms; messages typical ${q(got.pings, 0.5)} p95 ${q(got.pings, 0.95)} ms; keys worst ${q(keys, 1)} ms`;
        console.log(label + ': ' + detail);
        check(label + ': the picture is video, not stills', got.clip, detail);
        check(label + ': pictures keep coming', got.frames / secs >= 25, detail);
        check(label + ': pictures are fresh', q(got.ages, 0.5) < 300 + lag && q(got.ages, 0.95) < 700 + lag, detail);
        check(label + ': the owner\'s messages do not wait behind pictures', got.pings.length >= 20 && q(got.pings, 0.95) < 700 + lag, detail);
        check(label + ': the guest\'s keys reach the owner at once', keys.length >= 6 && q(keys, 1) < 300 + lag * 2, detail);
    } catch (e) { console.error(e); check(label + ': ran to the end', false); }
    const errs = [a, b].map((p) => p.errors.filter((e) => !/physical_attack_animation/.test(e)));
    check(label + ': no script errors', !errs[0].length && !errs[1].length, [...errs[0], ...errs[1]].slice(0, 3).join(' || ').slice(0, 500));
    await w.close();
}

(async () => {
    const check = checker();
    await link(check, 8495, 500000, 40, '4 Mbit/s');
    await link(check, 8496, 130000, 80, '1 Mbit/s');
    process.exit(check.finish([]));
})();
