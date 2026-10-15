// F8 on a PC with nothing to drive a partner: the host gets a panel to paste
// an Anthropic key into (checked before it is kept), or calls one in anyway.
// The good-key path is not run here: it would write the real settings.json.
process.env.FH_BOT_ARGS = '--brain none';
process.env.FH_MIND = 'none';
const { startServer, launch, openPlayer, waitFor, sleep } = require('./lib');
const { checker } = require('./common');
const install = require('./helpers');

async function press(page, code) {
    await page.keyboard.down(code); await sleep(130); await page.keyboard.up(code); await sleep(250);
}

(async () => {
    const check = checker();
    const port = 8463;
    const server = await startServer(port);
    const browser = await launch();
    let a;
    try {
        a = await openPlayer(browser, `http://localhost:${port}/?name=Ann`, 'Ann');
        await waitFor(a, () => window.SceneManager && SceneManager._scene instanceof Scene_Title && window.Coop && Coop.connected, 90000, 'title');
        await a.evaluate(install);
        await a.evaluate(() => T.quickStart(1, 27, 67));
        await waitFor(a, () => T.onMap(), 60000, 'Ann on the map');
        await a.evaluate(() => { T.settle(); T.begin(); for (const ev of $gameMap.events()) if (/guard|enemy|chaser/i.test(ev.event().name)) ev.erase(); });
        await waitFor(a, () => Coop.world.live, 10000, 'Ann live');

        await press(a, 'F8');
        await waitFor(a, () => document.querySelector('#coop-setup.open'), 8000, 'the setup panel');
        const shown = await a.evaluate(() => {
            const el = document.getElementById('coop-setup');
            const r = el.getBoundingClientRect();
            const top = document.elementFromPoint(r.left + r.width / 2, r.top + 10);
            return { onTop: el.contains(top), focused: document.activeElement === el.querySelector('input') };
        });
        check('with no AI on the PC, F8 asks for a key in the game, on top and ready to type', shown.onTop && shown.focused, JSON.stringify(shown));

        const x = await a.evaluate(() => $gamePlayer.x);
        await a.keyboard.type('hello');
        await press(a, 'Enter');
        const said = await a.evaluate(() => document.querySelector('#coop-setup .why').textContent);
        check('something that is not a key is turned away, and typing does not move the character', /does not look like/.test(said) && (await a.evaluate(() => $gamePlayer.x)) === x, said);

        await a.evaluate(() => { document.querySelector('#coop-setup input').value = 'sk-ant-api03-' + 'x'.repeat(40); });
        await a.evaluate(() => document.querySelector('#coop-setup [data-do=save]').click());
        await waitFor(a, () => /refused|Could not check/.test(document.querySelector('#coop-setup .why').textContent), 20000, 'the key checked');
        const verdict = await a.evaluate(() => document.querySelector('#coop-setup .why').textContent);
        check('a made-up key is checked with Anthropic and refused, not saved', /refused|Could not check/.test(verdict), verdict);

        await a.evaluate(() => document.querySelector('#coop-setup [data-do=anyway]').click());
        await waitFor(a, () => Coop.others().some((p) => p.bot === 1 && p.st === 'map'), 90000, 'the partner arrives');
        check('"call it in without AI" still brings a partner that follows and fights', !(await a.evaluate(() => !!document.querySelector('#coop-setup.open'))));
        await press(a, 'F8');
        await waitFor(a, () => !Coop.others().some((p) => p.bot), 20000, 'the partner leaves');
    } catch (e) {
        console.error(e);
        check('test ran to the end', false);
    }
    const code = check.finish([a].filter(Boolean));
    await browser.close();
    server.kill();
    process.exit(code);
})();
