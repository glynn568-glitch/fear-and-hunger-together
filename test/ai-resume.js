// The AI partner coming back to a run instead of starting over: after a
// dropped connection it carries on from where it was; on another day it
// loads its own save from the bed the two of them slept at.
const { startServer, launch, openPlayer, waitFor, sleep } = require('./lib');
const { checker } = require('./common');
const install = require('./helpers');
const installBot = require('../tools/bot-page');

const save = (page, slot) => page.evaluate((n) => { $gameSystem.onBeforeSave(); DataManager.saveGame(n); }, slot);

async function openBot(browser, port) {
    const bot = await openPlayer(browser, `http://localhost:${port}/?name=Claude`, 'bot');
    await waitFor(bot, () => window.SceneManager && SceneManager._scene instanceof Scene_Title && window.Coop && Coop.connected, 90000, 'bot title');
    await bot.exposeFunction('fhBrainCharacter', () => {});
    await bot.exposeFunction('fhBrain', async () => ({ say: '' }));
    await bot.evaluate(installBot, { character: 'knight', follow: '' });
    return bot;
}

(async () => {
    const check = checker();
    const port = 8444;
    const server = await startServer(port);
    const browser = await launch();
    let a, bot;
    try {
        a = await openPlayer(browser, `http://localhost:${port}/?name=Ann`, 'Ann');
        await waitFor(a, () => window.SceneManager && SceneManager._scene instanceof Scene_Title && window.Coop && Coop.connected, 90000, 'title');
        await a.evaluate(install);
        await a.evaluate(() => T.quickStart(1, 27, 67));
        await waitFor(a, () => T.onMap(), 60000, 'Ann on the map');
        await a.evaluate(() => { T.settle(); T.begin(); for (const ev of $gameMap.events()) if (/guard|enemy|chaser/i.test(ev.event().name)) ev.erase(); });
        await waitFor(a, () => Coop.world.live, 10000, 'Ann live');

        bot = await openBot(browser, port);
        await waitFor(bot, () => BOT.status().character === 'knight' && SceneManager._scene instanceof Scene_Map && Coop.world.live, 60000, 'the bot joins');
        await bot.evaluate(() => { for (const ev of $gameMap.events()) if (/guard|enemy|chaser/i.test(ev.event().name)) ev.erase(); });
        await sleep(1500);

        //--- a bed: both saved, then something changes -------------------------
        await bot.evaluate(() => { $gameParty.gainItem($dataItems[37], 1); }); // Cheese, before the bed
        await sleep(500);
        await save(a, 1);
        await waitFor(bot, () => StorageManager.exists(1), 10000, 'the bot saved alongside');
        await bot.evaluate(() => { $gameParty.gainItem($dataItems[15], 1); $gameActors.actor(3).setHp(55); }); // an Egg, and wounds, after it
        check('the bot saved with Ann at the bed', true);

        //--- dropped connection: it carries on from where it was ----------------
        await waitFor(bot, () => Coop.parkNow(), 10000, 'the bot parks its state');
        await sleep(1000);
        await bot.browserContext().close();
        await sleep(3000);
        bot = await openBot(browser, port);
        await waitFor(bot, () => SceneManager._scene instanceof Scene_Map && Coop.world.live && BOT.character, 60000, 'the bot is back on the map');
        const back = await bot.evaluate(() => ({ character: BOT.character, egg: $gameParty.numItems($dataItems[15]), cheese: $gameParty.numItems($dataItems[37]), hp: $gameActors.actor(3).hp, said: BOT.said }));
        check('after a crash it carries on from where it was, not as somebody new', back.character === 'knight' && back.egg === 1 && back.cheese === 1 && back.hp === 55, JSON.stringify(back));

        //--- another day: Ann continues from the bed; so does the bot -----------
        await a.evaluate(() => SceneManager.goto(Scene_Title));
        await waitFor(bot, () => SceneManager._scene instanceof Scene_Title, 40000, 'the bot leaves when Ann does');
        await sleep(2000);
        await a.evaluate(() => { DataManager.loadGame(1); SceneManager.goto(Scene_Map); $gameSystem.onAfterLoad(); });
        await waitFor(a, () => T.onMap() && Coop.world.live, 30000, 'Ann carries on from the bed');
        await waitFor(bot, () => SceneManager._scene instanceof Scene_Map && Coop.world.live && BOT.character && !$gamePlayer.isTransferring(), 60000, 'the bot carries on too');
        const day2 = await bot.evaluate(() => ({ character: BOT.character, egg: $gameParty.numItems($dataItems[15]), cheese: $gameParty.numItems($dataItems[37]), hp: $gameActors.actor(3).hp, run: Coop.world.runId }));
        const runA = await a.evaluate(() => Coop.world.runId);
        check('another day it loads its own save from that bed', day2.character === 'knight' && day2.cheese === 1 && day2.egg === 0 && day2.hp === 100 && day2.run === runA, JSON.stringify(day2));
    } catch (e) { console.error(e); check('test ran to the end', false); }
    const code = check.finish([a, bot].filter(Boolean));
    await browser.close();
    server.kill();
    process.exit(code);
})();
