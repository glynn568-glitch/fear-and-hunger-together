// AI partners the host calls in from the game (F8) and sends home again.
// Each one is tools/bot.js in its own process, run by this server so that
// nothing has to be started by hand and nothing outlives the session.
const { spawn } = require('child_process');
const path = require('path');

const MAX = 3; // with the host, the party limit of four
// The names the intro writes on. "Claude", or a blank, in settings is the old default.
const CAST = [
    ['knight', 662, "D'arce"],
    ['outlander', 664, 'Ragnvaldr'],
    ['priest', 663, 'Enki'],
    ['mercenary', 661, 'Cahara'],
];

class Partners {
    constructor(port, settings) {
        this.port = port;
        this.given = String((settings.partner && settings.partner.name) || '').replace(/[^\w \-']/g, '').trim().slice(0, 16);
        this.base = this.given && this.given.toLowerCase() !== 'claude' ? this.given : 'Claude';
        this.running = new Map(); // name -> child process
        this.leaving = new Set(); // sent home, not gone yet
        this.home = []; // sent home, newest last. The next call resumes one whose body is still parked.
        this.cast = new Map(); // name -> knight|outlander|priest|mercenary, kept across send-home so the body matches
        this.parked = null; // (name) => bool, set by the server (a park file still there)
        this.onFail = null; // (name, why) when one stops before it was sent home
        process.on('exit', () => this.stopAll());
        for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { this.stopAll(); process.exit(0); });
    }

    // What would drive a partner started now (see detect in tools/brain.js).
    mind() {
        const { detect } = require('./tools/brain');
        const { SETTINGS } = require('./tools/find-game');
        if (process.env.FH_MIND) return Promise.resolve({ brain: process.env.FH_MIND }); // the tests: "none"
        const p = SETTINGS.partner || {};
        return detect({ brain: p.brain || '', model: p.model || '', url: p.url || '', key: p.key || '' }).catch(() => ({ brain: 'none' }));
    }

    names() { return Array.from(this.running.keys()); }

    // Every name a partner process holds, including those on their way out.
    allNames() { return this.names().concat(Array.from(this.leaving)); }

    // Names already in use, by partners or by players, are skipped. Longer than the name field allows is skipped.
    freeName(base, taken) {
        const skip = taken || new Set();
        for (const suffix of ['', ' II', ' III', ' IV', ' V']) {
            const name = base + suffix;
            if (name.length > 16) continue;
            if (!this.running.has(name) && !this.leaving.has(name) && !skip.has(name.toLowerCase())) return name;
        }
        return '';
    }

    nextName(taken) { return this.freeName(this.base, taken); }

    // A character nobody here already is, including one just spawned whose switch has not been published yet.
    castPick(initials) {
        const used = new Set(initials || []);
        for (const [name, char] of this.cast) {
            if (!char || (!this.running.has(name) && !this.leaving.has(name))) continue;
            const row = CAST.find((c) => c[0] === char);
            if (row) used.add(row[1]);
        }
        const free = CAST.find((c) => !used.has(c[1]));
        return free ? free[0] : '';
    }

    storyName(char) {
        const row = CAST.find((c) => c[0] === char);
        return row ? row[2] : '';
    }

    // Slot order would name the next one Claude and never read the body just sent home.
    homeName(taken) {
        if (typeof this.parked !== 'function') return '';
        for (let i = this.home.length - 1; i >= 0; i--) {
            const name = this.home[i];
            if (this.running.has(name) || this.leaving.has(name) || taken.has(String(name).toLowerCase())) continue;
            if (this.parked(name)) return name;
        }
        return '';
    }

    // Returns why not, or ''. initials: character switches already in the room (661-664).
    start(taken, initials) {
        if (this.running.size >= MAX) return 'There is no room for another partner: four characters at most.';
        const home = this.homeName(taken);
        let name = home;
        let char = home ? (this.cast.get(home) || '') : '';
        // A configured name is kept. Blank or "Claude" means the character's own name.
        if (!name && this.base === 'Claude') {
            char = this.castPick(initials);
            const story = this.storyName(char);
            name = story ? this.freeName(story, taken) : '';
            if (!name) { name = this.nextName(taken); char = ''; }
        } else if (!name) {
            name = this.nextName(taken);
            char = '';
        }
        if (!name) return 'No free name for another partner.';
        if (char) this.cast.set(name, char);
        // FH_BOT_ARGS: extra options for every partner (the tests use "--brain none").
        const extra = (process.env.FH_BOT_ARGS || '').split(' ').filter(Boolean);
        const argv = [path.join(__dirname, 'tools', 'bot.js'), `http://localhost:${this.port}/`, '--name', name, '--stdin-stop'];
        if (char) argv.push('--char', char);
        argv.push(...extra);
        const child = spawn(process.execPath, argv,
            { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
        this.running.set(name, child);
        let last = '';
        const echo = (d) => {
            for (const line of String(d).split('\n')) {
                if (!line.trim()) continue;
                last = line.replace(/^\[bot\]\s*/, '');
                console.log(line.startsWith('[bot]') ? line.replace('[bot]', '[' + name + ']') : '[' + name + '] ' + line);
            }
        };
        child.stdout.on('data', echo);
        child.stderr.on('data', echo);
        child.stdin.on('error', () => { /* it died mid-write; 'exit' says so */ });
        const ended = (code, err) => {
            const failed = this.running.get(name) === child;
            if (failed) this.running.delete(name);
            this.leaving.delete(name);
            if (code || err) console.log(`[${name}] stopped (${err ? err.message : code})`);
            // Stopped without being sent home: the player should hear why.
            if (failed && this.onFail) this.onFail(name, err ? err.message : last || 'it stopped (' + code + ')');
        };
        child.on('exit', (code) => ended(code, null));
        child.on('error', (err) => ended(0, err));
        return '';
    }

    // The most recently called one, or the one named.
    stop(name) {
        const target = name && this.running.has(name) ? name : this.names().pop();
        const child = target && this.running.get(target);
        if (!child) return '';
        this.running.delete(target);
        this.leaving.add(target);
        this.home.push(target);
        if (this.home.length > 8) this.home.shift();
        try { child.stdin.end(); } catch (e) { /* gone */ }
        // A partner that does not leave on its own within a while is stopped.
        setTimeout(() => { try { child.kill(); } catch (e) { /* gone */ } }, 15000);
        return target;
    }

    stopAll() {
        for (const name of this.names()) this.stop(name);
    }
}

module.exports = { Partners };
