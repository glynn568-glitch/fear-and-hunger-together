// F8 on a PC with nothing to drive a partner: the host gets a panel to pick
// how it thinks. A pretend OpenAI-style service on this PC stands in for the
// real ones: a bad key is refused, a good one fills the model list, and the
// pick is kept (in a file of the test's own) and a partner called in.
process.env.FH_BOT_ARGS = '--brain none';
process.env.FH_MIND = 'none';
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
process.env.FH_MIND_FILE = path.join(os.tmpdir(), 'fh-setup-' + process.pid + '.json');
const { startServer, launch, openPlayer, waitFor, sleep } = require('./lib');
const { checker } = require('./common');
const install = require('./helpers');

async function press(page, code) {
    await page.keyboard.down(code); await sleep(130); await page.keyboard.up(code); await sleep(250);
}

(async () => {
    const check = checker();
    const port = 8476;
    const service = http.createServer((req, res) => {
        req.resume();
        req.on('end', () => {
            const good = req.headers.authorization === 'Bearer good-key-123';
            res.writeHead(good ? 200 : 401, { 'Content-Type': 'application/json' });
            if (!good) return res.end('{"error":{"message":"bad key"}}');
            if (req.method === 'GET') return res.end(JSON.stringify({ data: [{ id: 'tiny-embed' }, { id: 'model-big' }, { id: 'model-mini' }] }));
            res.end(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }));
        });
    });
    await new Promise((r) => service.listen(0, '127.0.0.1', r));
    const url = 'http://127.0.0.1:' + service.address().port + '/v1';
    const server = await startServer(port);
    const browser = await launch();
    let a;
    const why = () => a.evaluate(() => document.querySelector('#coop-setup .why').textContent);
    try {
        a = await openPlayer(browser, `http://localhost:${port}/?name=Ann`, 'Ann');
        await waitFor(a, () => window.SceneManager && SceneManager._scene instanceof Scene_Title && window.Coop && Coop.connected, 90000, 'title');
        await a.evaluate(install);
        await a.evaluate(() => T.quickStart(1, 27, 67));
        await waitFor(a, () => T.onMap(), 60000, 'Ann on the map');
        await a.evaluate(() => { T.settle(); T.begin(); for (const ev of $gameMap.events()) if (/guard|enemy|chaser/i.test(ev.event().name)) ev.erase(); });
        await waitFor(a, () => Coop.world.live, 10000, 'Ann live');

        await press(a, 'F8');
        await waitFor(a, () => document.querySelector('#coop-setup.open .minds button.on'), 15000, 'the setup panel with its choices');
        const shown = await a.evaluate(() => {
            const el = document.getElementById('coop-setup');
            const r = el.getBoundingClientRect();
            const top = document.elementFromPoint(r.left + r.width / 2, r.top + 10);
            return { onTop: el.contains(top), focused: document.activeElement === el.querySelector('[data-field=key]'),
                minds: Array.from(el.querySelectorAll('.minds button')).map((b) => b.getAttribute('data-mind')), padHeld: Coop.padHeld() };
        });
        check('with no AI on the PC, F8 asks in the game, on top and ready to type a key', shown.onTop && shown.focused, JSON.stringify(shown));
        check('it offers Claude Code, Codex, Grok Build, the API services, local models, any address and none',
            ['claude', 'codex-cli', 'grok-cli', 'anthropic', 'xai', 'openai', 'gemini', 'openrouter', 'ollama', 'lmstudio', 'hermes', 'openai-url', 'none'].every((m) => shown.minds.includes(m)), shown.minds.join(','));
        check('a controller drives the panel while it is open (pad.js looked for a class it never had)', shown.padHeld);

        const x = await a.evaluate(() => $gamePlayer.x);
        await a.keyboard.type('hello');
        await press(a, 'Enter');
        const said = await why();
        check('something that is not a key is turned away, and typing does not move the character', /does not look like/.test(said) && (await a.evaluate(() => $gamePlayer.x)) === x, said);

        await a.evaluate((u) => {
            document.querySelector('#coop-setup [data-mind=openai-url]').click();
            const box = document.getElementById('coop-setup');
            box.querySelector('[data-field=url]').value = u;
            box.querySelector('[data-field=key]').value = 'wrong-key-123';
            box.querySelector('[data-field=model]').value = 'model-mini';
            box.querySelector('[data-do=save]').click();
        }, url);
        await waitFor(a, () => /refused/.test(document.querySelector('#coop-setup .why').textContent), 20000, 'the bad key checked');
        check('a key the service refuses is turned away and not kept', !fs.existsSync(process.env.FH_MIND_FILE), await why());

        await a.evaluate(() => {
            const box = document.getElementById('coop-setup');
            box.querySelector('[data-field=model]').value = '';
            const key = box.querySelector('[data-field=key]');
            key.value = 'good-key-123';
            key.dispatchEvent(new Event('change'));
        });
        await waitFor(a, () => document.querySelector('#coop-setup [data-field=model]').value, 15000, 'the model list');
        const list = await a.evaluate(() => ({ model: document.querySelector('#coop-setup [data-field=model]').value, options: Array.from(document.querySelectorAll('#fh-setup-models option')).map((o) => o.value) }));
        check('a good key fills the model list from the service, a fast one picked, no embedding models', list.model === 'model-mini' && list.options.includes('model-big') && !list.options.includes('tiny-embed'), JSON.stringify(list));

        await a.evaluate(() => document.querySelector('#coop-setup [data-do=save]').click());
        await waitFor(a, () => !document.querySelector('#coop-setup.open'), 20000, 'the panel closes');
        const kept = JSON.parse(fs.readFileSync(process.env.FH_MIND_FILE, 'utf8'));
        check('the pick is kept on this PC with its address, model and key', kept.brain === 'openai' && kept.url === url && kept.model === 'model-mini' && kept.keys['openai-url'] === 'good-key-123', JSON.stringify(Object.assign({}, kept, { keys: Object.keys(kept.keys) })));
        await waitFor(a, () => Coop.others().some((p) => p.bot === 1 && p.st === 'map'), 90000, 'the partner arrives');
        check('saving calls a partner in', true);
        await press(a, 'F8');
        await waitFor(a, () => !Coop.others().some((p) => p.bot), 20000, 'the partner leaves');

        // A pick is kept now, so F8 calls a partner in straight away; the panel is
        // opened from the Together panel's button instead, and this time: no AI.
        await a.evaluate(() => Coop.openPartnerSetup());
        await waitFor(a, () => document.querySelector('#coop-setup.open .minds button.on'), 15000, 'the panel again');
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
    service.close();
    try { fs.unlinkSync(process.env.FH_MIND_FILE); } catch (e) { /* gone */ }
    process.exit(code);
})();
