// Where Fear & Hunger is installed, for the server and the tools.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

// A file's text as the game's own loader reads it: a UTF-8 or UTF-16 byte-order mark
// (Notepad, PowerShell's Out-File, some editors and translation tools) is read past.
function decodeText(buf) {
    if (buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le', 2);
    if (buf[0] === 0xfe && buf[1] === 0xff) return Buffer.from(buf.subarray(2, buf.length - (buf.length % 2))).swap16().toString('utf16le');
    return buf.toString('utf8').replace(/^﻿/, '');
}

const SETTINGS = (() => {
    let text;
    try { text = decodeText(fs.readFileSync(path.join(ROOT, 'settings.json'))); } catch (e) { return {}; }
    try { return JSON.parse(text); } catch (e) {
        console.error('settings.json could not be read, so it is ignored: ' + e.message + '\n(Backslashes in paths must be doubled: D:\\\\Games, not D:\\Games.)');
        return {};
    }
})();

// Where the game is: FH_GAME, or "game" in settings.json, or found through
// Steam's own list of library folders.
function findGame() {
    const www = (dir) => (fs.existsSync(path.join(dir, 'www', 'index.html')) ? path.join(dir, 'www') : fs.existsSync(path.join(dir, 'index.html')) ? dir : '');
    for (const given of [process.env.FH_GAME, SETTINGS.game]) if (given) return www(given) || given;
    const steams = [];
    if (process.platform === 'win32') {
        try {
            // UTF-8 first: in the system's own code page (866 on a Russian PC) a Steam folder named in Cyrillic
            // comes back mangled. Put back after, or a console the player started this from stays in UTF-8.
            const { execSync } = require('child_process');
            let was = '';
            try { was = (/(\d+)\s*$/.exec(execSync('chcp', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()) || [])[1] || ''; } catch (e) { /* no console */ }
            const out = execSync((was ? 'chcp 65001 >nul & ' : '') + 'reg query "HKCU\\Software\\Valve\\Steam" /v SteamPath' + (was ? ' & chcp ' + was + ' >nul' : ''), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
            const m = /SteamPath\s+REG_SZ\s+(.+)/.exec(out);
            if (m) steams.push(m[1].trim());
        } catch (e) { /* no Steam in the registry */ }
        steams.push('C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam');
    } else {
        const home = require('os').homedir();
        steams.push(path.join(home, '.steam', 'steam'), path.join(home, '.local', 'share', 'Steam'), path.join(home, 'Library', 'Application Support', 'Steam'),
            path.join(home, '.var', 'app', 'com.valvesoftware.Steam', '.local', 'share', 'Steam')); // Steam as a Flatpak
    }
    const libraries = new Set();
    for (const steam of steams) {
        libraries.add(path.normalize(steam));
        try {
            const vdf = fs.readFileSync(path.join(steam, 'steamapps', 'libraryfolders.vdf'), 'utf8');
            for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) libraries.add(path.normalize(m[1].replace(/\\\\/g, '\\')));
        } catch (e) { /* not this one */ }
    }
    for (const lib of libraries) {
        const found = www(path.join(lib, 'steamapps', 'common', 'Fear & Hunger'));
        if (found) return found;
    }
    // The itch app installs into %APPDATA%\itch\apps\<name>, sometimes with
    // the game one folder further down. Termina (the sequel) is not this game.
    const isOne = (name) => /fear.*hunger/i.test(name) && !/termina|\b2\b/i.test(name);
    const itch = process.platform === 'win32' ? path.join(process.env.APPDATA || '', 'itch', 'apps')
        : path.join(require('os').homedir(), '.config', 'itch', 'apps');
    let apps = [];
    try { apps = fs.readdirSync(itch).filter(isOne); } catch (e) { /* no itch app */ }
    for (const app of apps) {
        const dir = path.join(itch, app);
        const found = www(dir);
        if (found) return found;
        let inner = [];
        try { inner = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch (e) { /* unreadable */ }
        for (const name of inner) {
            const deeper = www(path.join(dir, name));
            if (deeper) return deeper;
        }
    }
    return '';
}

// One of the game's data files, decoded as the game's own loader does
// (decodeText), where JSON.parse alone would stop on a byte-order mark.
function readGameJson(file) {
    const buf = fs.readFileSync(file);
    try { return JSON.parse(decodeText(buf)); } catch (e) { throw new Error(file + ': ' + e.message); }
}

module.exports = { findGame, SETTINGS, readGameJson, decodeText };

// For the start script:
//   node tools/find-game.js             prints the game's www folder, or nothing
//   node tools/find-game.js --set DIR   remembers DIR as the game in settings.json
if (require.main === module) {
    const i = process.argv.indexOf('--set');
    if (i >= 0 && process.argv[i + 1]) {
        const file = path.join(ROOT, 'settings.json');
        let settings = {};
        try { settings = JSON.parse(decodeText(fs.readFileSync(file))); } catch (e) { /* start afresh */ }
        settings.game = path.resolve(process.argv[i + 1]);
        fs.writeFileSync(file, JSON.stringify(settings, null, 4) + '\n');
    } else {
        const found = findGame();
        if (found && fs.existsSync(path.join(found, 'index.html'))) console.log(found);
    }
}
