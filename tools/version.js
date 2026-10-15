// Which build of the game is installed, and a census that fits it.
//
// Every player runs the game from their own copy, so two copies must hold the
// same game data or the shared switches mean different things on each side.
// The fingerprint is a hash of www/data; the build number
// is the one RPG Maker writes into System.json each time the project is saved.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const CENSUS = path.join(ROOT, 'client', 'census.json');

function fingerprint(game) {
    const hash = crypto.createHash('sha256');
    const data = path.join(game, 'data');
    for (const name of fs.readdirSync(data).filter((n) => n.endsWith('.json')).sort()) {
        hash.update(name + '\0');
        // Line ends ignored: the same data unpacked on another system is the same game.
        let text = fs.readFileSync(path.join(data, name), 'latin1').replace(/\r\n/g, '\n');
        // A copy decrypted for another mod (Mattie's asks for it) is still the same game.
        if (name === 'System.json') {
            try {
                const sys = JSON.parse(text);
                delete sys.hasEncryptedImages; delete sys.hasEncryptedAudio; delete sys.encryptionKey;
                text = JSON.stringify(sys);
            } catch (e) { /* hashed as it is */ }
        }
        hash.update(text, 'latin1');
    }
    // Not plugins.js: a Steam copy lists Steam-only plugins an itch copy of the
    // same version may not have. Any real update changes the data anyway
    // (the editor rewrites System.json's versionId each time it saves).
    let build = '';
    try { build = String(JSON.parse(fs.readFileSync(path.join(data, 'System.json'), 'utf8')).versionId || ''); } catch (e) { /* unreadable */ }
    return { fp: hash.digest('hex').slice(0, 16), build };
}

// The census in client/ says which build it was made from. A different build
// (an itch copy a patch behind, a newer Steam update) gets a fresh one: the
// scan and census tools take about a second.
// The map names are the game's own text, so they are never shipped: each copy
// writes them from its own install, with the census.
function ensureCensus(game, fp) {
    let have = '';
    try { have = JSON.parse(fs.readFileSync(CENSUS, 'utf8')).fp || ''; } catch (e) { /* none yet */ }
    const namesOnly = have === fp;
    if (namesOnly && fs.existsSync(path.join(ROOT, 'client', 'mapnames.json'))) return false;
    const env = Object.assign({}, process.env, { FH_GAME: game, FH_FP: fp });
    for (const tool of ['scan.js', 'census.js']) {
        const res = spawnSync(process.execPath, [path.join(__dirname, tool)], { env, encoding: 'utf8' });
        if (res.status !== 0) {
            const why = tool + ' failed: ' + (res.stderr || res.stdout).trim().split('\n').pop();
            // The census itself is right; only the place names are missing, and the game runs without them.
            if (namesOnly) { console.log(why + ' (place names will be missing)'); return false; }
            throw new Error(why);
        }
    }
    return !namesOnly;
}

// The co-op code itself: two players on different versions of this mod would
// speak different protocols, so this has to match too.
function modPrint() {
    const hash = crypto.createHash('sha256');
    const client = path.join(ROOT, 'client');
    // Line ends ignored: a git checkout and a zip of the same code must match.
    const text = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    for (const name of fs.readdirSync(client).filter((n) => n.endsWith('.js')).sort()) hash.update(name + '\0').update(text(path.join(client, name)));
    // The census rules too: two players whose mods share different flags would drift apart.
    for (const file of ['room.js', 'tools/scan.js', 'tools/census.js']) hash.update(text(path.join(ROOT, file)));
    const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
    return { mod: hash.digest('hex').slice(0, 12), version };
}

module.exports = { fingerprint, ensureCensus, modPrint };

if (require.main === module) {
    const game = require('./find-game').findGame();
    console.log(fingerprint(game));
}

// The query a socket opened outside a game page (tests, tools) carries, so
// the server knows it is on the same build.
function socketQuery() {
    const b = Object.assign(fingerprint(require('./find-game').findGame()), modPrint());
    return '?fp=' + b.fp + '&build=' + b.build + '&mod=' + b.mod + '&v=' + b.version;
}
module.exports.socketQuery = socketQuery;
