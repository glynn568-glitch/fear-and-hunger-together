// One test run at a time (test/run.js, test/twins.js): two would share every suite's
// ports and join each other's games. The lock is created only if absent (no two can
// take it at once) and touched every 20 s; one untouched for a minute belongs to a run
// that was killed, and is taken over. False: another run holds it.
const fs = require('fs');
const path = require('path');

const LOCK = path.join(__dirname, 'out', 'run.lock');

function create() {
    try { fs.closeSync(fs.openSync(LOCK, 'wx')); return true; } catch (e) { return false; }
}

module.exports = function takeLock() {
    fs.mkdirSync(path.dirname(LOCK), { recursive: true });
    if (!create()) {
        let age = 0;
        try { age = Date.now() - fs.statSync(LOCK).mtimeMs; } catch (e) { return module.exports(); }
        if (age < 60000) return false;
        fs.rmSync(LOCK, { force: true });
        if (!create()) return false;
    }
    fs.writeFileSync(LOCK, String(process.pid));
    setInterval(() => { try { const now = new Date(); fs.utimesSync(LOCK, now, now); } catch (e) { /* gone */ } }, 20000).unref();
    process.on('exit', () => { try { if (Number(fs.readFileSync(LOCK, 'utf8')) === process.pid) fs.rmSync(LOCK); } catch (e) { /* gone */ } });
    return true;
};
