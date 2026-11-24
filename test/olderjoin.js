// A joiner on an older mod, as a page: they paste the host's link and are told to use the same download.
// The ports named for this suite were already taken, so this file uses the next free pair.
// FH_OLDER_MOD=hook (this file required as the joiner's server starts) only changes that server's
// mod fingerprint. The suite itself runs when the variable is unset. Not FH_TWIN: that is another job.
if (process.env.FH_OLDER_MOD === 'hook') {
    const Module = require('module');
    const orig = Module.prototype.require;
    Module.prototype.require = function (id) {
        const exp = orig.apply(this, arguments);
        const norm = String(id).replace(/\\/g, '/');
        if ((norm.endsWith('tools/version') || norm.endsWith('tools/version.js')) && exp && typeof exp.modPrint === 'function' && !exp.__older) {
            const real = exp.modPrint;
            exp.modPrint = function () {
                const b = real();
                return { mod: ('old' + b.mod).slice(0, 12), version: '0.1.22' };
            };
            exp.__older = true;
        }
        return exp;
    };
    module.exports = {};
    return;
}

const fs = require('fs');
const path = require('path');
const { startServer, launch, openPlayer, waitFor, sleep } = require('./lib');
const { checker } = require('./common');
const { titleReady, choose } = require('./lobbylib');

const HOST = 8592;
const FRIEND = HOST + 100;

(async () => {
    const check = checker();
    let host, joiner, browser, pages = [];
    try {
        const hook = __filename.replace(/\\/g, '/');
        host = await startServer(HOST, { FH_MIND: 'none', FH_TUNNEL_FAKE: 'http://localhost:' + HOST });
        joiner = await startServer(FRIEND, { FH_MIND: 'none', FH_OLDER_MOD: 'hook', NODE_OPTIONS: '--require ' + hook });
        browser = await launch();
        const a = await openPlayer(browser, `http://localhost:${HOST}/?name=Ann`, 'Ann');
        const b = await openPlayer(browser, `http://localhost:${FRIEND}/?name=Bo`, 'Bo');
        pages = [a, b];
        for (const p of pages) await waitFor(p, titleReady, 90000, p.label + ' at the title');
        await choose(a, 'Together');
        await a.evaluate(() => Coop.together.act('online'));
        await waitFor(a, () => !!(document.querySelector('[data-field=link]') || {}).value, 15000, 'the host\'s link');
        const link = await a.evaluate(() => document.querySelector('[data-field=link]').value);
        check('the host is handing out a link', /^http:\/\/localhost:\d+\/\?k=[0-9a-f]{16}$/.test(link), link);
        await choose(b, 'Together');
        await b.evaluate((l) => { document.querySelector('[data-field=join]').value = l; }, link);
        await b.click('#coop-together [data-do=join]');
        let why = '';
        for (let i = 0; i < 30 && !/Use the same download/.test(why); i++) {
            await sleep(500);
            why = await b.evaluate(() => (document.querySelector('#coop-together .why') || {}).textContent || '');
        }
        check('the panel says to use the same download', /Use the same download/.test(why), why.slice(0, 300));
        await sleep(500);
        const mem = await b.evaluate(() => Coop.log.join('\n'));
        const logPath = path.join(path.dirname(joiner.saves), 'server-' + FRIEND + '.log');
        const disk = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
        const noted = mem + '\n' + disk + '\n' + b.logs.join('\n');
        const hit = noted.split('\n').find((l) => /same download|not the same version|turned away/i.test(l));
        check('the joiner\'s log notes the refusal', !!hit, hit ? hit.slice(0, 300) : 'no refusal line');
        check('the joiner stays on the title', await b.evaluate(() => SceneManager._scene instanceof Scene_Title), await b.evaluate(() => SceneManager._scene.constructor.name));
    } catch (e) {
        console.error(e);
        check('test ran to the end', false);
    }
    const code = check.finish(pages);
    if (browser) await browser.close();
    if (joiner) joiner.kill();
    if (host) host.kill();
    process.exit(code);
})();
