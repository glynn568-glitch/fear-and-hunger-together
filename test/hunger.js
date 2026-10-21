// Hunger drains at four fifths of the game's rate while two or more people are in the
// world (co-op has no pause), and at the game's own rate alone or alone with
// an AI partner. Time is run forward by updating the character's own hunger
// event (HUNGER_of_*) the way the map does each frame.
const { startServer, launch, openPlayer, waitFor, sleep } = require('./lib');
const { checker } = require('./common');
const install = require('./helpers');

const FRAMES = 16100; // the game takes a point every 801 frames: 20 alone, 16 together

// On Ann's page: set her hunger, run her hunger event for some frames, say how much went.
function drain(frames, start) {
    const actor = $gameParty.leader();
    const id = $dataCommonEvents.findIndex((e) => e && e.name === 'HUNGER_of_Mercenary');
    const ce = $gameMap._commonEvents.find((c) => c._commonEventId === id);
    actor.changeExp(start, false);
    ce._interpreter.clear();
    for (let i = 0; i < frames; i++) ce.update();
    return start - actor.currentExp();
}

async function enter(page, actorId, x) {
    await waitFor(page, () => window.SceneManager && SceneManager._scene instanceof Scene_Title && window.Coop && Coop.connected, 90000, 'title + connection');
    await page.evaluate(install);
    await page.evaluate((a, xx) => T.quickStart(a, xx, 67), actorId, x);
    await waitFor(page, () => T.onMap(), 60000, page.label + ' on the map');
    await page.evaluate(() => { T.settle(); T.begin(); for (const ev of $gameMap.events()) if (/guard|enemy|chaser/i.test(ev.event().name)) ev.erase(); });
    await waitFor(page, () => Coop.world.live, 10000, page.label + ' live');
    // The hunger events start on the map's next refresh after the game's START switch.
    await waitFor(page, () => $gameMap._commonEvents.some((c) => /^HUNGER_of_/.test(c.event().name) && c._interpreter), 10000, page.label + ' hunger running');
}

(async () => {
    const check = checker();
    const port = 8710;
    const server = await startServer(port);
    const browser = await launch();
    const pages = [];
    try {
        const ann = await openPlayer(browser, `http://localhost:${port}/?name=Ann`, 'Ann');
        pages.push(ann);
        await enter(ann, 1, 27);

        //--- alone -----------------------------------------------------------
        const alone = await ann.evaluate(drain, FRAMES, 150);
        check('alone, hunger drains at the game\'s own rate', alone >= 19 && alone <= 21, alone + ' points in ' + FRAMES + ' frames');

        //--- alone with an AI partner ----------------------------------------
        // A page that says it is a bot, as tools/bot-page.js does.
        const bot = await openPlayer(browser, `http://localhost:${port}/?name=Robo`, 'Robo');
        pages.push(bot);
        await waitFor(bot, () => window.Coop && Coop.connected, 90000, 'bot connected');
        await bot.evaluate(() => { Coop.isBot = true; });
        await enter(bot, 3, 28);
        await waitFor(ann, () => Coop.others().some((p) => p.bot === 1 && p.st === 'map'), 10000, 'Ann sees the partner in the world');
        const withBot = await ann.evaluate(drain, FRAMES, 150);
        check('with only an AI partner, still the game\'s own rate', withBot >= 19 && withBot <= 21, withBot + ' points');
        check('the AI partner alone with one person keeps the game\'s rate too', !(await bot.evaluate(() => Coop.playingTogether())));

        //--- with another person ---------------------------------------------
        const bo = await openPlayer(browser, `http://localhost:${port}/?name=Bo`, 'Bo');
        pages.push(bo);
        await waitFor(bo, () => window.Coop && Coop.connected, 90000, 'Bo connected');
        // Bo takes the other free character: the partner already has the knight.
        await enter(bo, 4, 29);
        await waitFor(ann, () => Coop.others().some((p) => !p.bot && p.st === 'map'), 10000, 'Ann sees Bo in the world');
        await waitFor(bot, () => Coop.others().filter((p) => !p.bot && p.st === 'map').length === 2, 10000, 'the partner sees both people');
        const together = await ann.evaluate(drain, FRAMES, 150);
        check('with another person, four fifths of the game\'s rate', together >= 15 && together <= 17 && Math.abs(together * 1.25 - alone) <= 2, together + ' points (alone ' + alone + ')');
        check('Bo too', await bo.evaluate(() => Coop.playingTogether()));
        check('and the AI partner keeps the people\'s pace', await bot.evaluate(() => Coop.playingTogether()));

        // Each pass still takes one whole point, so a stage is reached once: one
        // "weak from hunger", not one per pass spent on the same number.
        const stage = await ann.evaluate((frames) => {
            const said = [];
            const _plugin = Game_Interpreter.prototype.pluginCommand;
            Game_Interpreter.prototype.pluginCommand = function (command, args) {
                if (command === 'GabText') said.push(args.join(' '));
                return _plugin.call(this, command, args);
            };
            const actor = $gameParty.leader();
            actor.removeState(39);
            const id = $dataCommonEvents.findIndex((e) => e && e.name === 'HUNGER_of_Mercenary');
            const ce = $gameMap._commonEvents.find((c) => c._commonEventId === id);
            actor.changeExp(112, false);
            ce._interpreter.clear();
            for (let i = 0; i < frames; i++) ce.update();
            Game_Interpreter.prototype.pluginCommand = _plugin;
            return { weak: said.filter((t) => /weak from hunger/.test(t)).length, state: actor.isStateAffected(39), exp: actor.currentExp() };
        }, FRAMES);
        check('the stage is reached once, together', stage.weak === 1 && stage.state && stage.exp < 108, JSON.stringify(stage));

        // Eating is the game's own: an egg fills as much together as the game says.
        const ate = await ann.evaluate(() => {
            const actor = $gameParty.leader();
            actor.changeExp(120, false);
            actor.addState(51); // "ate something small", as the egg's own effect sets it
            const interp = new Game_Interpreter();
            interp.setup([{ code: 117, indent: 0, parameters: [31] }, { code: 0, indent: 0, parameters: [] }], 0);
            for (let i = 0; i < 600 && interp.isRunning(); i++) interp.update();
            return actor.currentExp() - 120;
        });
        check('an egg fills 7 together, as alone', ate === 7, ate + ' points');

        //--- the other person goes -------------------------------------------
        await bo.close();
        await waitFor(ann, () => !Coop.others().some((p) => !p.bot), 15000, 'Bo gone');
        const after = await ann.evaluate(drain, FRAMES, 150);
        check('alone again (but for the AI partner), the game\'s own rate', after >= 19 && after <= 21, after + ' points');
    } catch (e) {
        console.error(e);
        check('test ran to the end', false);
    }
    const code = check.finish(pages);
    await browser.close();
    server.kill();
    process.exit(code);
})();
