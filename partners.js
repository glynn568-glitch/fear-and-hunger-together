// AI partners the host calls in from the game (F8) and sends home again.
// Each one is tools/bot.js in its own process, run by this server so that
// nothing has to be started by hand and nothing outlives the session.
const { spawn } = require('child_process');
const path = require('path');

const MAX = 3; // with the host, the party limit of four

class Partners {
    constructor(port, settings) {
        this.port = port;
        this.base = String((settings.partner && settings.partner.name) || 'Claude').replace(/[^\w \-']/g, '').trim().slice(0, 12) || 'Claude';
        this.running = new Map(); // name -> child process
        this.leaving = new Set(); // sent home, not gone yet
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

    // Names already in use, by partners or by players, are skipped.
    nextName(taken) {
        for (const suffix of ['', ' II', ' III', ' IV', ' V']) {
            const name = this.base + suffix;
            if (!this.running.has(name) && !this.leaving.has(name) && !taken.has(name.toLowerCase())) return name;
        }
        return '';
    }

    // Returns why not, or ''.
    start(taken) {
        if (this.running.size >= MAX) return 'There is no room for another partner: four characters at most.';
        const name = this.nextName(taken);
        if (!name) return 'No free name for another partner.';
        // FH_BOT_ARGS: extra options for every partner (the tests use "--brain none").
        const extra = (process.env.FH_BOT_ARGS || '').split(' ').filter(Boolean);
        const child = spawn(process.execPath, [path.join(__dirname, 'tools', 'bot.js'), `http://localhost:${this.port}/`, '--name', name, '--stdin-stop', ...extra],
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
