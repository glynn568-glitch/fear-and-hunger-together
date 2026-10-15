// Builds the zip for itch.io: everything a player needs, Node included, none
// of the tests or the tools used to make it.
//   node tools/package.js        -> dist/FearAndHunger-Together-<version>.zip
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const NODE_VERSION = 'v24.12.0'; // the same one start.ps1 fetches
// Windows' own tar reads and writes zips; a GNU tar earlier on the PATH takes "C:" for a host.
const TAR = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
// nodejs.org's published SHA-256 for that zip (SHASUMS256.txt).
const NODE_SHA256 = '9c125f61ae947b52e779095830f9cac267846a043ef7192183c84016aaad2812';
const version = require('../package.json').version;
const name = 'FearAndHunger-Together';
// The zip: the exe a player double-clicks, the README, the itch manifest,
// and everything else in app.
const top = path.join(ROOT, 'dist', name);
const out = path.join(top, 'app');
const zip = path.join(ROOT, 'dist', `${name}-${version}.zip`);

const FILES = [
    'server.js', 'room.js', 'partners.js', 'package.json', 'package-lock.json', 'README.md', 'LICENSE', 'start.ps1',
    'Play.cmd', 'start-local.cmd', 'start-online.cmd', 'start-online-private.cmd', 'start-with-ai-partner.cmd', 'bot.cmd',
    'tools/bot.js', 'tools/bot-page.js', 'tools/brain.js', 'tools/find-game.js',
    'tools/version.js', 'tools/scan.js', 'tools/census.js', // the census is rebuilt for a different build of the game
    'tools/tunnel.js',
];

function copy(rel) {
    const from = path.join(ROOT, rel), to = path.join(out, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.cpSync(from, to, { recursive: true });
}

// Every script a packaged one loads or starts has to be packaged too: a zip
// missing tools/tunnel.js once crashed on start.
function missing() {
    const have = new Set(FILES.map((f) => path.normalize(f)));
    const lost = [];
    for (const f of FILES.filter((n) => n.endsWith('.js'))) {
        const dir = path.dirname(f);
        const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
        const named = [];
        for (const m of text.matchAll(/require\(['"](\.\.?\/[^'"]+)['"]\)/g)) named.push(path.join(dir, m[1]));
        // Started by name: spawn(node, [path.join(__dirname, 'tools', 'bot.js')]) and the like.
        for (const m of text.matchAll(/['"]([\w-]+\.js)['"]/g)) {
            for (const d of [dir, path.join(dir, 'tools')]) if (fs.existsSync(path.join(ROOT, d, m[1]))) named.push(path.join(d, m[1]));
        }
        for (let n of named) {
            n = path.normalize(n);
            if (!/\.\w+$/.test(n)) n += fs.existsSync(path.join(ROOT, n + '.js')) ? '.js' : '';
            if (!n.endsWith('.json') && !have.has(n) && fs.existsSync(path.join(ROOT, n))) lost.push(f + ' needs ' + n.replace(/\\/g, '/'));
        }
    }
    return lost;
}
const lost = missing();
if (lost.length) { console.error('Not in the package: ' + lost.join(', ')); process.exit(1); }
if (process.argv.includes('--check')) { console.log('package file list complete'); process.exit(0); }

fs.rmSync(top, { recursive: true, force: true });
fs.rmSync(zip, { force: true });
for (const f of FILES) copy(f);
copy('client');
// The game's own map names: each player's copy writes them from its install at first start.
fs.rmSync(path.join(out, 'client', 'mapnames.json'), { force: true });
// Settings as a new player gets them: nothing of this PC in them.
fs.writeFileSync(path.join(out, 'settings.json'), JSON.stringify({
    game: '', partner: { name: 'Claude', brain: '', model: '', effort: 'low', character: '', follow: '', url: '', key: '' },
}, null, 4) + '\n');

console.log('dependencies...');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
execFileSync(npm, ['ci', '--omit=dev', '--no-audit', '--no-fund'], { cwd: out, stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, PUPPETEER_SKIP_DOWNLOAD: '1' } });

console.log('Node ' + NODE_VERSION + '...');
// Kept beside the zip, not in %TEMP%: the system drive stays clear.
fs.mkdirSync(path.join(ROOT, 'dist', '.cache'), { recursive: true });
const cache = path.join(ROOT, 'dist', '.cache', `node-${NODE_VERSION}-win-x64.zip`);
if (!fs.existsSync(cache)) {
    execFileSync('curl', ['-sSfL', '-o', cache, `https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-win-x64.zip`], { stdio: 'inherit' });
}
const sum = require('crypto').createHash('sha256').update(fs.readFileSync(cache)).digest('hex');
if (sum !== NODE_SHA256) { fs.rmSync(cache, { force: true }); throw new Error('The Node download does not match nodejs.org\'s checksum; deleted it. Run again.'); }
const unpacked = path.join(ROOT, 'dist', '.cache', `node-${NODE_VERSION}-pkg`);
fs.rmSync(unpacked, { recursive: true, force: true });
fs.mkdirSync(unpacked, { recursive: true });
execFileSync(TAR, ['-xf', cache, '-C', unpacked]);
const src = path.join(unpacked, `node-${NODE_VERSION}-win-x64`);
fs.mkdirSync(path.join(out, 'tools', 'node'), { recursive: true });
for (const f of ['node.exe', 'LICENSE']) fs.copyFileSync(path.join(src, f), path.join(out, 'tools', 'node', f));
fs.rmSync(unpacked, { recursive: true, force: true });

console.log('launcher...');
execFileSync(process.execPath, [path.join(__dirname, 'build-launcher.js'), path.join(top, 'Fear & Hunger Together.exe')], { stdio: 'inherit' });
fs.copyFileSync(path.join(ROOT, 'README.md'), path.join(top, 'README.md'));
// The itch app shows a Launch button for this.
fs.writeFileSync(path.join(top, '.itch.toml'), ['[[actions]]', 'name = "play"', 'path = "Fear & Hunger Together.exe"', ''].join('\n'));

console.log('zip...');
execFileSync(TAR, ['-a', '-c', '-f', zip, name], { cwd: path.dirname(top) });
console.log(`${zip}  (${Math.round(fs.statSync(zip).size / 1048576)} MB)`);
