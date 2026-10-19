// A new link Cloudflare has not published yet (on a bad day, for minutes):
// the host is not handed a link that does not work yet, it is copied as soon
// as it does; a friend who pastes a link too soon is told to try again in a
// minute, not that nobody is hosting.
const { startServer, launch, openPlayer, waitFor } = require('./lib');
const { checker } = require('./common');

const HOST = 8484, FRIEND = 8584;
const panel = (p) => p.evaluate(() => {
    const box = document.getElementById('coop-together');
    const el = box.querySelector('[data-part=link]');
    return { status: box.querySelector('.status').textContent, why: box.querySelector('.why').textContent, linkShown: !el.hidden, link: box.querySelector('[data-field=link]').value };
});

(async () => {
    const check = checker();
    const host = await startServer(HOST, { FH_TUNNEL_FAKE: `http://localhost:${HOST}`, FH_TUNNEL_FAKE_DELAY: '14000' });
    const friend = await startServer(FRIEND);
    const browser = await launch();
    let a, b;
    try {
        a = await openPlayer(browser, `http://localhost:${HOST}/?name=Ann`, 'host');
        b = await openPlayer(browser, `http://localhost:${FRIEND}/?name=Bo`, 'friend');
        for (const p of [a, b]) await waitFor(p, () => window.SceneManager && SceneManager._scene instanceof Scene_Title && window.Coop && Coop.connected && window.Coop.together, 90000, 'title');
        await a.browserContext().overridePermissions(`http://localhost:${HOST}`, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);

        await a.evaluate(() => { Coop.together.open(); Coop.together.act('online'); });
        await waitFor(a, () => /being published/.test(document.querySelector('#coop-together .status').textContent), 20000, 'online, link not yet published');
        const early = await panel(a);
        check('while Cloudflare has not published it, the link is not shown or copied', !early.linkShown && /being published/.test(early.status), JSON.stringify(early));
        await waitFor(a, () => /works now and is copied/.test(document.querySelector('#coop-together .why').textContent), 20000, 'the link is copied once it works');
        const later = await panel(a);
        const clip = await a.evaluate(() => navigator.clipboard.readText());
        check('once it works it is shown and copied', later.linkShown && /^Online\. Send/.test(later.status) && clip === later.link && /\?k=[0-9a-f]{16}$/.test(clip), JSON.stringify(later) + ' clipboard ' + clip);

        // A friend pastes a quick-tunnel link that does not exist (yet).
        await b.evaluate(() => { Coop.together.open(); document.querySelector('#coop-together [data-field=join]').value = 'https://not-published-yet-zz9q.trycloudflare.com/?k=0123456789abcdef'; Coop.together.act('join'); });
        await waitFor(b, () => document.querySelector('#coop-together .why').textContent && !/Joining/.test(document.querySelector('#coop-together .why').textContent), 20000, 'the friend is answered');
        const said = (await panel(b)).why;
        check('a friend who pastes it too soon is told to try again in a minute', /not live yet.*Try again in a minute/.test(said), said);
    } catch (e) { console.error(e); check('test ran to the end', false); }
    const code = check.finish([a, b].filter(Boolean));
    await browser.close();
    host.kill(); friend.kill();
    process.exit(code);
})();
