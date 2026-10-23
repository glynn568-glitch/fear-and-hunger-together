// Copies of the game, and of this mod, in strange shapes and places: they start.
//   10/22 GitHub #1 (a Russian PC): "The game could not start", with no reason
//   given. The census scan stopped on the copy's data files; the launcher's
//   message showed only stack frames.
// - data files with a UTF-8 or UTF-16 byte-order mark (the game reads past it)
// - the game and the mod in folders named in Cyrillic, with spaces and an &
// - a data file the scan cannot read at all: the census already here is used
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { launch, openPlayer, waitFor, OUT, ROOT } = require('./lib');
const { checker } = require('./common');
const { findGame } = require('../tools/find-game');
const { fingerprint } = require('../tools/version');

const titleReady = () => window.SceneManager && SceneManager._scene instanceof Scene_Title && window.Coop && Coop.connected;
const PLACE = path.join(OUT, 'Игры & Тест');

// The real game's files linked, its data copied, each data file changed by edit(name, bytes).
async function copyGame(dir, edit) {
    const real = findGame();
    await fs.promises.rm(dir, { recursive: true, force: true }); // not rmSync, which does nothing here
    fs.mkdirSync(path.join(dir, 'www', 'data'), { recursive: true });
    for (const name of fs.readdirSync(real)) {
        if (name === 'data' || name === 'save') continue;
        const from = path.join(real, name), to = path.join(dir, 'www', name);
        if (fs.statSync(from).isDirectory()) fs.symlinkSync(from, to, 'junction'); else fs.copyFileSync(from, to);
    }
    for (const name of fs.readdirSync(path.join(real, 'data'))) {
        fs.writeFileSync(path.join(dir, 'www', 'data', name), edit(name, fs.readFileSync(path.join(real, 'data', name))));
    }
    return path.join(dir, 'www');
}

// Not fs.cpSync: Node 24's writes a folder named in Cyrillic somewhere else (its name read as Latin-1).
function copy(from, to) {
    if (!fs.statSync(from).isDirectory()) { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); return; }
    for (const name of fs.readdirSync(from)) copy(path.join(from, name), path.join(to, name));
}

// What the server needs, copied (a junction would be resolved back to this folder).
async function copyMod(dir) {
    await fs.promises.rm(dir, { recursive: true, force: true });
    for (const rel of ['server.js', 'room.js', 'partners.js', 'package.json', 'client', 'node_modules/ws']) copy(path.join(ROOT, rel), path.join(dir, rel));
    for (const name of fs.readdirSync(path.join(ROOT, 'tools')).filter((n) => n.endsWith('.js'))) copy(path.join(ROOT, 'tools', name), path.join(dir, 'tools', name));
    await fs.promises.rm(path.join(dir, 'client', 'mapnames.json'), { force: true });
    return dir;
}

// A server from that copy, all it says kept (the census lines come before its log file is opened).
function serve(mod, port, game, extra) {
    const saves = path.join(OUT, 'saves-' + port);
    fs.rmSync(saves, { recursive: true, force: true });
    const proc = spawn(process.execPath, [path.join(mod, 'server.js')], { cwd: mod, env: { ...process.env, PORT: String(port), FH_SAVES: saves, FH_GAME: game, FH_RELAY: '0', ...(extra || {}) }, stdio: ['ignore', 'pipe', 'pipe'] });
    proc.said = '';
    proc.stdout.on('data', (d) => { proc.said += d; });
    proc.stderr.on('data', (d) => { proc.said += d; });
    proc.up = new Promise((resolve) => {
        const t = setInterval(() => { if (/open http/.test(proc.said) || proc.exitCode !== null) { clearInterval(t); resolve(proc.exitCode === null); } }, 100);
        setTimeout(() => { clearInterval(t); resolve(false); }, 30000);
    });
    return proc;
}

// A tool of that copy, run to the end.
const run = (mod, args, env) => require('child_process').spawnSync(process.execPath, args, { cwd: mod, env: { ...process.env, ...env }, encoding: 'utf8' });

const utf8Bom = (buf) => Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), buf]);
const utf16Bom = (buf) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(buf.toString('utf8'), 'utf16le')]);

(async () => {
    const check = checker();
    let server, browser;
    try {
        // Every file with a UTF-8 mark, the map list and one map in UTF-16, as some editors save them.
        const marked = await copyGame(path.join(PLACE, 'Fear & Hunger'), (name, buf) => (/^(MapInfos|Map001)\.json$/.test(name) ? utf16Bom(buf) : utf8Bom(buf)));
        const plain = await copyGame(path.join(OUT, 'strange-plain'), (name, buf) => buf);
        const utf8Only = await copyGame(path.join(OUT, 'strange-utf8'), (name, buf) => utf8Bom(buf));
        check('a UTF-8 mark does not make the copy another game', fingerprint(utf8Only).fp === fingerprint(plain).fp);
        // A map saved as UTF-16 is the same map: shared with a plain copy, not set apart as changed (Grok review 6, #1).
        const { fileHashes } = require('../tools/version');
        const [hm, hp] = [fileHashes(marked), fileHashes(plain)];
        check('a UTF-16 copy is the same game as a plain one, map for map', fingerprint(marked).fp === fingerprint(plain).fp
            && hm['Map001.json'] && hm['Map001.json'] === hp['Map001.json'] && hm['MapInfos.json'] === hp['MapInfos.json'],
            fingerprint(marked).fp + ' / ' + fingerprint(plain).fp);
        // UTF-16 big-endian with a stray last byte: an error naming the file, not a RangeError.
        const odd = path.join(OUT, 'strange-odd.json');
        fs.writeFileSync(odd, Buffer.from([0xfe, 0xff, 0x00, 0x7b, 0x00, 0x7d, 0x00]));
        let oddSaid = '';
        try { require('../tools/find-game').readGameJson(odd); oddSaid = 'read'; } catch (e) { oddSaid = e.message; }
        check('a UTF-16 file with an odd byte count is read or named, never a bare RangeError', oddSaid === 'read' || oddSaid.startsWith(odd), oddSaid);

        // Saves under a player's own name: a parked state is taken once (Node 24's rmSync left it there for the next rejoin).
        const { Room } = require('../room');
        const room = new Room(path.join(PLACE, 'José', 'saves'));
        fs.mkdirSync(path.dirname(room.parkFile('Ann')), { recursive: true });
        fs.writeFileSync(room.parkFile('Ann'), JSON.stringify({ at: Date.now(), runId: 'r', blob: 'b' }));
        room.unpark('Ann');
        check('a parked state is gone once taken, in a folder whose name is not plain ASCII', !room.readParked('Ann'));

        // That copy, and the mod, both in folders named in Cyrillic: the census is rebuilt and the game starts.
        const mod = await copyMod(path.join(PLACE, 'Fear & Hunger Together'));
        // Its census is of another build, so the scan has to read the marked data there.
        const modCensus = path.join(mod, 'client', 'census.json');
        fs.writeFileSync(modCensus, JSON.stringify(Object.assign(JSON.parse(fs.readFileSync(modCensus, 'utf8')), { fp: 'another-build' })));
        server = serve(mod, 8436, marked);
        check('the server starts from a Cyrillic folder on a copy with marked data', await server.up, server.said.split('\n').filter((l) => /Error|failed/.test(l)).join(' | '));
        check('the census was rebuilt for that copy', /census was rebuilt/.test(server.said) && fs.existsSync(path.join(mod, 'client', 'mapnames.json')));
        browser = await launch();
        const page = await openPlayer(browser, 'http://localhost:8436/?name=Ann', 'strange');
        await waitFor(page, titleReady, 90000, 'title + connection');
        const up = await page.evaluate(() => ({ ok: !SceneManager._stopped && DataManager.isDatabaseLoaded(), stopped: SceneManager._stopped, db: DataManager.isDatabaseLoaded(), error: (document.getElementById('ErrorPrinter') || {}).textContent || '', gl: !!(Graphics._renderer && Graphics._renderer.gl && Graphics._renderer.gl.isContextLost && !Graphics._renderer.gl.isContextLost()) }));
        check('the game reaches its title and connects', up.ok, JSON.stringify(up) + (up.ok ? '' : ' ' + page.errors.concat(page.logs.slice(-12)).join(' / ').slice(0, 2500)));
        server.kill(); server = null;
        const voice = run(mod, [path.join(mod, 'tools', 'voices.js'), 'mercenary'], { FH_GAME: marked });
        check('the partner\'s voice is read from such a copy', voice.status === 0 && /Speak the way/.test(voice.stdout), (voice.stdout + voice.stderr).slice(0, 120));

        // settings.json saved with a byte-order mark (Notepad, PowerShell): its game is used, and picking
        // a folder keeps the rest of it.
        fs.writeFileSync(path.join(mod, 'settings.json'), utf8Bom(Buffer.from(JSON.stringify({ game: path.dirname(marked), partner: { model: 'sonnet' } }))));
        const found = run(mod, [path.join(mod, 'tools', 'find-game.js')], { FH_GAME: '' });
        check('settings.json with a byte-order mark is read', found.stdout.trim() === marked, (found.stdout + found.stderr).trim().slice(0, 160));
        run(mod, [path.join(mod, 'tools', 'find-game.js'), '--set', path.dirname(plain)], { FH_GAME: '' });
        const kept = JSON.parse(fs.readFileSync(path.join(mod, 'settings.json'), 'utf8'));
        check('picking the game folder keeps the other settings', kept.partner && kept.partner.model === 'sonnet' && kept.game === path.dirname(plain), JSON.stringify(kept));
        // Windows PowerShell 5's Out-File writes UTF-16 (Grok review 6, #6).
        fs.writeFileSync(path.join(mod, 'settings.json'), utf16Bom(Buffer.from(JSON.stringify({ game: path.dirname(marked) }))));
        const found16 = run(mod, [path.join(mod, 'tools', 'find-game.js')], { FH_GAME: '' });
        check('settings.json saved as UTF-16 is read', found16.stdout.trim() === marked, (found16.stdout + found16.stderr).trim().slice(0, 160));
        fs.unlinkSync(path.join(mod, 'settings.json'));

        // Looking in the registry for Steam puts the console's code page back (866 on a Russian PC).
        if (process.platform === 'win32') {
            const cp = require('child_process').spawnSync('cmd', ['/c', 'chcp 866 >nul & "' + process.execPath + '" "' + path.join(ROOT, 'tools', 'find-game.js') + '" >nul & chcp'], { encoding: 'utf8', env: { ...process.env, FH_GAME: '' } });
            check('the console keeps its own code page', /866\s*$/.test(cp.stdout.trim()), cp.stdout.trim());
        }

        // A data file nothing can read: the census already here is used, and the game starts.
        const broken = await copyGame(path.join(OUT, 'strange-broken'), (name, buf) => (name === 'Map005.json' ? Buffer.from('{"broken":') : buf));
        const brokenMod = await copyMod(path.join(OUT, 'strange-mod'));
        server = serve(brokenMod, 8464, broken);
        check('an unreadable data file does not stop the game; the census here is used', await server.up && /census already here is used/.test(server.said), server.said.split('\n').slice(0, 6).join(' | '));
        check('the server says which file and why', /Map005\.json: .*JSON/.test(server.said), server.said.split('\n').filter((l) => /census|Map005/.test(l)).join(' | '));

        server.kill(); server = null;

        // Two players on the same data must not share by different censuses. A copy whose rebuild
        // failed here (its own folder would not take the scan's output) keeps another copy's census:
        // as host it hands that to a joiner whose own is right...
        const lockedMod = await copyMod(path.join(OUT, 'strange-locked'));
        const censusFile = path.join(lockedMod, 'client', 'census.json');
        fs.writeFileSync(censusFile, JSON.stringify(Object.assign(JSON.parse(fs.readFileSync(censusFile, 'utf8')), { fp: 'another-copy' })));
        fs.mkdirSync(path.join(lockedMod, 'data', 'usage.json'), { recursive: true });
        const plainMod = await copyMod(path.join(OUT, 'strange-mod2'));
        server = serve(lockedMod, 8464, plain);
        check('a copy whose rebuild fails here starts on the census it has', await server.up && /census already here is used/.test(server.said), server.said.split('\n').slice(0, 4).join(' | '));
        // The host's own game shares by that census as it is: no "your files differ" for the host (Grok review 6, #5).
        const h = await openPlayer(browser, 'http://localhost:8464/?name=Al', 'strange-host');
        await waitFor(h, titleReady, 90000, 'host title + connection');
        check('the host on a census of another copy is not told its files differ from its own', !(await h.evaluate(() => /files differ/.test(Coop.log.join('\n')))) && !/census differ/.test(server.said), server.said.split('\n').filter((l) => /census differ/.test(l)).join(' | '));
        await h.close();
        const joiner = serve(plainMod, 8564, plain, { FH_JOIN: 'http://localhost:8464/' });
        check('the joiner starts', await joiner.up, joiner.said.slice(0, 200));
        const b = await openPlayer(browser, 'http://localhost:8564/?name=Bo', 'strange-joiner');
        await waitFor(b, titleReady, 90000, 'joiner title + connection');
        await waitFor(b, () => Coop.world.census && /host/.test(Coop.log.join('\n')), 10000, 'the host census adopted').catch(() => {});
        check('a host on another copy\'s census hands it to the joiner', await b.evaluate(() => !!Coop.world.census && /host/.test(Coop.log.join('\n'))) && /census of another copy/.test(server.said), server.said.split('\n').filter((l) => /joined/.test(l)).join(' | '));
        await b.close();
        joiner.kill(); server.kill(); server = null;

        // ...and a joiner left with one takes the host's.
        server = serve(plainMod, 8468, plain);
        const stale = serve(lockedMod, 8568, plain, { FH_JOIN: 'http://localhost:8468/' });
        check('both start', await server.up && await stale.up, stale.said.slice(0, 200));
        const c = await openPlayer(browser, 'http://localhost:8568/?name=Cy', 'strange-stale');
        await waitFor(c, titleReady, 90000, 'stale joiner title + connection');
        await waitFor(c, () => Coop.world.census && /host/.test(Coop.log.join('\n')), 10000, 'the host census adopted').catch(() => {});
        check('a joiner on another copy\'s census takes the host\'s', await c.evaluate(() => !!Coop.world.census && /host/.test(Coop.log.join('\n'))) && /census of another copy/.test(server.said), server.said.split('\n').filter((l) => /joined/.test(l)).join(' | '));
        stale.kill();
    } catch (e) { console.error(e); check('test ran to the end', false); }
    if (server) server.kill();
    if (browser) await browser.close();
    process.exit(check.finish([]));
})();
