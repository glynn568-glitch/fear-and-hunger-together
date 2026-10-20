// How the AI partner sounds as a given character, with its real mind.
// Spends model calls, so it is kept out of run.js. Run it alone:
//   node test/voice-live.js [mercenary|knight|priest|outlander] [--model sonnet]
// Prints each exchange, then the same with the partner's Mind nearly gone.
const { startServer, launch, openPlayer, waitFor, sleep } = require('./lib');
const install = require('./helpers');
const installBot = require('../tools/bot-page');
const { createBrain, detect } = require('../tools/brain');

const character = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'mercenary';
const flag = (name) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : ''; };
const ACTOR = { mercenary: 1, knight: 3, priest: 4, outlander: 5 };

(async () => {
    const port = 8485;
    const server = await startServer(port);
    const browser = await launch();
    const brain = createBrain(Object.assign(await detect({ model: flag('model') }), { name: 'Claude', character, log: () => {} }));
    let code = 0;
    try {
        const human = Object.keys(ACTOR).find((c) => c !== character);
        const a = await openPlayer(browser, `http://localhost:${port}/?name=Ann`, 'human');
        const bot = await openPlayer(browser, `http://localhost:${port}/?name=Claude`, 'bot');
        for (const p of [a, bot]) await waitFor(p, () => window.SceneManager && SceneManager._scene instanceof Scene_Title && window.Coop && Coop.connected, 90000, 'title');
        await a.evaluate(install);
        await bot.exposeFunction('fhBrainCharacter', () => {});
        await bot.exposeFunction('fhBrain', (kind, text) => brain.ask(kind, text));
        await bot.evaluate(installBot, { character, follow: '' });
        await a.evaluate((id) => T.quickStart(id, 27, 67), ACTOR[human]);
        await waitFor(a, () => T.onMap(), 60000, 'on the map');
        await a.evaluate(() => { T.settle(); T.begin(); window.heard = []; Coop.on('heard', (m) => window.heard.push(m.text)); });
        await waitFor(bot, () => SceneManager._scene instanceof Scene_Map && Coop.world.live, 90000, 'the partner arrives');
        for (const p of [a, bot]) await p.evaluate(() => { for (const ev of $gameMap.events()) if (/guard|enemy|chaser/i.test(ev.event().name)) ev.erase(); });
        await sleep(12000);
        const greeting = await a.evaluate(() => window.heard.slice());

        async function talk(text) {
            const n = await a.evaluate(() => window.heard.length);
            await a.evaluate((t) => Coop.say(t), text);
            try { await waitFor(a, (k) => window.heard.length > k, 60000, 'a reply', n); } catch (e) { return '(no reply)'; }
            await sleep(1500);
            return (await a.evaluate((k) => window.heard.slice(k), n)).join(' / ');
        }
        const lines = [
            'so what brings you down here anyway?',
            'what are you going to do with the money if we get out?',
            'this place reeks. how do you stand it?',
            'you think we make it out of here?',
            'I found a body back there. it was still warm.',
        ];
        console.log(`\n=== ${character} (${brain.name})`);
        console.log('greeting: ' + (greeting.join(' / ') || '(none)'));
        for (const t of lines) console.log(`> ${t}\n  ${await talk(t)}`);
        // Mind nearly gone: the voice should crack.
        await bot.evaluate(() => { const me = $gameParty.leader(); me.setMp(Math.floor(me.mmp * 0.1)); });
        await sleep(500);
        console.log('--- Mind at 10%');
        for (const t of ['hey. you still with me?', 'come on, we have to keep moving']) console.log(`> ${t}\n  ${await talk(t)}`);
    } catch (e) { console.error(e); code = 1; }
    brain.close();
    await browser.close();
    server.kill();
    process.exit(code);
})();
