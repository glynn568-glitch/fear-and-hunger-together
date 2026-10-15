// The AI partner with its real mind (tools/bot.js, Claude Code by default).
// Spends model calls, so it is kept out of run.js. Run it alone:
//   node test/ai-live.js [--model sonnet] [--brain anthropic] ...
// Prints how long each decision took and everything the partner said.
const { spawn } = require('child_process');
const path = require('path');
const { startServer, launch, openPlayer, waitFor, sleep } = require('./lib');
const { checker } = require('./common');
const install = require('./helpers');

async function press(page, code, ms) {
    await page.keyboard.down(code); await sleep(ms || 130); await page.keyboard.up(code); await sleep(220);
}

(async () => {
    const check = checker();
    const port = 8452;
    const server = await startServer(port);
    const browser = await launch();
    let a, botProc;
    const botLog = [];
    try {
        a = await openPlayer(browser, `http://localhost:${port}/?name=Ann`, 'human');
        await waitFor(a, () => window.SceneManager && SceneManager._scene instanceof Scene_Title && window.Coop && Coop.connected, 90000, 'title');
        await a.evaluate(install);
        await a.evaluate(() => T.quickStart(1, 27, 67));
        await waitFor(a, () => T.onMap(), 60000, 'on the map');
        await a.evaluate(() => { T.settle(); T.begin(); });
        await waitFor(a, () => Coop.world.live, 10000, 'live');
        await a.evaluate(() => {
            window.heard = [];
            Coop.on('heard', (m) => window.heard.push({ at: Date.now(), name: m.name, text: m.text }));
            window.picks = [];
            const orig = Coop.applyPick;
            Coop.applyPick = function (actor, pick) { const r = orig.apply(this, arguments); window.picks.push({ at: Date.now(), actor: actor.actorId(), pick, r, target: pick.target >= 0 && $gameTroop.members()[pick.target] ? $gameTroop.members()[pick.target].name() : '' }); return r; };
            window.turnsSent = [];
            const send = Coop.sendTo;
            Coop.sendTo = function (id, kind) { if (kind === 'bturn') window.turnsSent.push(Date.now()); return send.apply(this, arguments); };
        });

        botProc = spawn(process.execPath, [path.join(__dirname, '..', 'tools', 'bot.js'), `http://localhost:${port}/`, '--name', 'Claude', '--verbose', '--stdin-stop', ...process.argv.slice(2)], { stdio: ['pipe', 'pipe', 'pipe'] });
        botProc.stdout.on('data', (d) => { for (const l of String(d).split('\n')) if (l.trim()) { botLog.push(l); console.log('  ' + l.slice(0, 220)); } });
        botProc.stderr.on('data', (d) => console.log('  [bot err] ' + String(d).slice(0, 300)));
        await waitFor(a, () => Coop.others().some((p) => p.bot === 1 && p.st === 'map'), 120000, 'the partner arrives');
        await a.evaluate(() => { for (const ev of $gameMap.events()) if (/guard|enemy|chaser/i.test(ev.event().name)) ev.erase(); });
        await sleep(12000); // its greeting

        async function talk(text) {
            const n = await a.evaluate(() => window.heard.length);
            const t0 = Date.now();
            await a.evaluate((t) => Coop.say(t), text);
            try { await waitFor(a, (k) => window.heard.length > k, 45000, 'a reply', n); } catch (e) { return { text, reply: '(no reply)', ms: Date.now() - t0 }; }
            const r = await a.evaluate((k) => window.heard[k], n);
            return { text, reply: r.text, ms: r.at - t0 };
        }
        const talks = [];
        talks.push(await talk('hey. this place reeks. you ready?'));
        talks.push(await talk('wait here, I want to check the corridor alone'));
        const mode1 = await a.evaluate(() => Coop.others().find((p) => p.bot));
        talks.push(await talk('ok, follow me'));
        for (const t of talks) console.log(`TALK "${t.text}" -> "${t.reply}" (${t.ms} ms)`);
        check('it answers when spoken to', talks.every((t) => t.reply !== '(no reply)'));

        // A real guard fight, three rounds.
        const bx = await a.evaluate(() => { const p = Coop.others().find((q) => q.bot); return [p.x, p.y]; });
        await a.evaluate((x, y) => { $gamePlayer.locate(x, y + 1); }, bx[0], bx[1]);
        await sleep(800);
        await a.evaluate(() => { BattleManager.setup(1, true, true); SceneManager.push(Scene_Battle); });
        await waitFor(a, () => SceneManager._scene instanceof Scene_Battle && BattleManager._phase === 'input', 30000, 'the fight begins');
        for (let round = 0; round < 3; round++) {
            // A person reads the fight's text and presses on; so does this one.
            for (let i = 0; i < 180; i++) {
                const st = await a.evaluate(() => ({ mine: BattleManager._phase === 'input' && !!BattleManager.actor() && BattleManager.actor().actorId() === 1, over: BattleManager._phase === 'battleEnd' || !(SceneManager._scene instanceof Scene_Battle), text: $gameMessage.isBusy() }));
                if (st.mine || st.over) break;
                if (st.text) await press(a, 'KeyZ'); else await sleep(500);
            }
            if (await a.evaluate(() => !(SceneManager._scene instanceof Scene_Battle) || BattleManager._phase === 'battleEnd')) break;
            await press(a, 'KeyZ'); await press(a, 'KeyZ'); await press(a, 'KeyZ');
            const n = round + 1;
            await waitFor(a, (k) => window.picks.length >= k, 60000, 'the partner\'s move', n);
        }
        const picks = await a.evaluate(() => window.picks.map((p, i) => ({ ms: p.at - (window.turnsSent[i] || p.at), pick: p.pick, target: p.target, r: p.r })));
        for (const p of picks) console.log(`MOVE ${JSON.stringify(p.pick)} -> ${p.target || '-'} ${p.r ? 'REFUSED ' + p.r : ''} (${p.ms} ms)`);
        check('it chose its own moves in the fight', picks.length >= 1 && picks.every((p) => p.r === ''));
        // Won already, or cut short: through the closing text and back to the map.
        await a.evaluate(() => { if (SceneManager._scene instanceof Scene_Battle && ['input', 'turn'].indexOf(BattleManager._phase) >= 0) BattleManager.abort(); });
        for (let i = 0; i < 40 && !(await a.evaluate(() => SceneManager._scene instanceof Scene_Map)); i++) await press(a, 'KeyZ');
        await waitFor(a, () => SceneManager._scene instanceof Scene_Map, 20000, 'back on the map');
        console.log('FIGHT ' + (await a.evaluate(() => $gameTroop.members().map((e) => e.name() + (e.isDead() ? ' down' : '')).join(', '))));
        await sleep(8000);

        // Dying, and being fetched.
        await a.evaluate(() => SceneManager.goto(Scene_Gameover));
        const t0 = Date.now();
        await waitFor(a, () => !Coop.dead && SceneManager._scene instanceof Scene_Map, 240000, 'being called back');
        console.log(`REVIVED after ${Math.round((Date.now() - t0) / 1000)} s`);
        check('it walked to a circle and called me back', true);
        await sleep(15000);
        const all = await a.evaluate(() => window.heard.map((h) => h.text));
        console.log('EVERYTHING IT SAID:\n' + all.map((t) => '  - ' + t).join('\n'));
    } catch (e) {
        console.error(e);
        check('test ran to the end', false);
        if (a) console.log('STATE', JSON.stringify(await a.evaluate(() => ({ scene: SceneManager._scene.constructor.name, phase: BattleManager._phase, actor: BattleManager.actor() && BattleManager.actor().actorId(), inputting: BattleManager.isInputting(), turnsSent: window.turnsSent, picks: window.picks, battle: Coop.battle && { role: Coop.battle.role, seq: Coop.battle.turnSeq, key: Coop.battle.turnKey, guests: [...(Coop.battle.guests || new Map()).keys()] }, msg: $gameMessage.isBusy(), party: $gameParty._actors, turn: document.getElementById('coop-turn').textContent })).catch((x) => String(x))));
        console.log('BOT LOG TAIL:'); console.log(botLog.slice(-25).join(String.fromCharCode(10)));
    }
    if (botProc) { botProc.stdin.end(); await new Promise((r) => { botProc.on('exit', r); setTimeout(r, 10000); }); }
    const code = check.finish([a].filter(Boolean));
    await browser.close();
    server.kill();
    process.exit(code);
})();
