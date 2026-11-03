// Every troop in the game as a real two-player fight: A owns it, B is the guest. A few turns of
// hits, guards and read-on text so its pages run, then it is won. What counts: no script error,
// no hang, both back on the map with the same world.
//   node test/troops.js              every troop that has members
//   node test/troops.js 130 122 56   those
// Not in run.js (about half an hour). Report: test/out/troops-<port>.json.
const fs = require('fs');
const path = require('path');
const { findGame } = require('../tools/find-game');
const { sleep } = require('./common');
const { latePair, put } = require('./late');

const KNOWN = /physical_attack_animation|VideoFrame was garbage collected/;
const BASE = Number(process.env.FH_BASE) || 8730;
const PAIRS = 1; // one process per pair: run several with FH_BASE and their own lists
const TURNS = Number(process.env.FH_TURNS) || 4;

function allTroops() {
    const t = JSON.parse(fs.readFileSync(path.join(findGame(), 'data', 'Troops.json'), 'utf8'));
    return t.filter((x) => x && x.members.length).map((x) => x.id);
}

async function fight(s, id) {
    const { a, b } = s;
    const row = { id, notes: [], errors: [] };
    for (const p of [a, b]) p.errors.length = 0;
    await put(a, 27, 40, 40); await put(b, 27, 41, 40);
    await a.evaluate((id, turns) => {
        D.win = false; D.lose = false; D.read = true; D.picks = [];
        const f = window.__fight = { id, turns, last: null, chosen: 0, startedTurn: 0, over: false, name: $dataTroops[id].name };
        for (const m of $gameParty.members()) m.recoverAll();
        BattleManager.setup(id, true, true);
        SceneManager.push(Scene_Battle);
        // Choose for everyone, as the partner does; everyone stays standing so the pages keep running.
        f.timer = setInterval(() => {
            if (!(SceneManager._scene instanceof Scene_Battle)) return;
            const list = $gameMessage.isChoice() ? $gameMessage.choices() : null;
            if (list && !D.picks.length) D.picks = [Math.floor(Math.random() * list.length)];
            for (const m of $gameParty.members()) if (m.hp < m.mhp * 0.5) m.setHp(m.mhp);
            const actor = BattleManager.actor(), act = BattleManager.inputtingAction();
            if (!BattleManager.isInputting() || !actor || !act || f.last === act) return;
            f.last = act;
            f.chosen++;
            const parts = $gameTroop.aliveMembers();
            const pick = Math.random() < 0.25 ? { do: 'guard' } : { do: 'attack', target: parts.length ? $gameTroop.members().indexOf(parts[Math.floor(Math.random() * parts.length)]) : 0 };
            const why = Coop.applyPick(actor, pick);
            if (why) Coop.applyPick(actor, { do: 'guard' });
            if ($gameTroop.turnCount() >= turns) D.win = true;
        }, 60);
    }, id, TURNS);
    const t0 = Date.now();
    let guest = false;
    let ended = '';
    while (Date.now() - t0 < 90000) {
        const [sa, sb] = await Promise.all([a, b].map((p) => p.evaluate(() => D.state()).catch((e) => ({ scene: 'gone ' + e.message }))));
        if (sb.role === 'guest') guest = true;
        if (Date.now() - t0 > 35000) await a.evaluate(() => { D.win = true; });
        const home = (x) => x.scene === 'Scene_Map' && !x.role;
        if (home(sa) && home(sb) && Date.now() - t0 > 1500) { ended = 'map'; break; }
        if (/Gameover|CoopDead|Title/.test(sa.scene) || /Gameover|CoopDead|Title/.test(sb.scene)) { ended = sa.scene + '/' + sb.scene; if (Date.now() - t0 > 5000) break; }
        await sleep(300);
    }
    const f = await a.evaluate(() => { const f = window.__fight; clearInterval(f.timer); return { chosen: f.chosen, turn: $gameTroop.turnCount(), name: f.name }; });
    row.name = f.name; row.chosen = f.chosen;
    if (!guest) row.notes.push('B never a guest');
    if (!ended) {
        const st = await Promise.all([a, b].map((p) => p.evaluate(() => Object.assign(D.state(), { phase: BattleManager._phase, msg: $gameMessage.allText().slice(0, 60), coop: Coop.log.slice(-3) })).catch((e) => e.message)));
        row.errors.push('never ended: ' + JSON.stringify(st).slice(0, 700));
    } else if (ended !== 'map') row.notes.push('ended ' + ended);
    for (const p of [a, b]) for (const e of p.errors) if (!KNOWN.test(e)) row.errors.push(p.label + ': ' + e.slice(0, 400));
    if (ended === 'map') {
        await sleep(400);
        const [fa, fb] = await Promise.all([a, b].map((p) => p.evaluate(() => Coop.world.fingerprint())));
        if (fa !== fb) row.errors.push('shared state differs after the fight');
    }
    row.restart = ended !== 'map';
    return row;
}

(async () => {
    const asked = process.argv.slice(2).map(Number).filter(Boolean);
    const queue = asked.length ? asked : allTroops();
    const report = [];
    const total = queue.length;
    const started = Date.now();
    await Promise.all(Array.from({ length: Math.min(PAIRS, queue.length) }, async (_, n) => {
        const port = BASE + n * 2;
        let s = null;
        while (queue.length) {
            const id = queue.shift();
            let row;
            try {
                if (!s) s = await latePair(port, { speed: 4, actorA: 1, actorB: 3 });
                row = await fight(s, id);
            } catch (e) {
                row = { id, notes: [], errors: ['test: ' + e.message], restart: true };
            }
            report.push(row);
            console.log(`${row.errors.length ? 'ERR' : 'ok '} ${String(id).padStart(3)} ${row.name || ''} chose ${row.chosen} ${row.notes.join('; ')}${row.errors.length ? '\n     ' + row.errors.join('\n     ') : ''}`);
            if (row.restart && s) { await s.close().catch(() => {}); s = null; }
        }
        if (s) await s.close().catch(() => {});
    }));
    fs.writeFileSync(path.join(__dirname, 'out', 'troops-' + BASE + '.json'), JSON.stringify(report, null, 1));
    const bad = report.filter((r) => r.errors.length);
    console.log(`${total} troops in ${Math.round((Date.now() - started) / 60000)} min, errors: ${bad.map((r) => r.id).join(' ') || 'none'}`);
    process.exit(bad.length ? 1 : 0);
})();
