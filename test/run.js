// Runs every suite in turn. `npm test`, or `node test/run.js battle death` for some.
const { spawnSync } = require('child_process');
const path = require('path');

const ALL = ['lint', 'server', 'join', 'four', 'app', 'boot', 'title', 'intro', 'two', 'events', 'transfer', 'follow', 'followers', 'battle', 'encounter', 'death', 'sleep', 'rules', 'trade', 'cast', 'talk', 'softlocks', 'gaps', 'lifecycle', 'resume', 'reconnect', 'bot', 'ai', 'ai-resume', 'partner', 'setup', 'soak'];
const names = process.argv.slice(2).length ? process.argv.slice(2) : ALL;
let failed = 0;
for (const name of names) {
    const started = Date.now();
    const res = spawnSync(process.execPath, [path.join(__dirname, name + '.js')], { encoding: 'utf8', timeout: 600000 });
    const ok = res.status === 0;
    if (!ok) failed++;
    const lines = (res.stdout || '').trim().split('\n');
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(10)} ${Math.round((Date.now() - started) / 1000)}s  ${lines[lines.length - 1] || ''}`);
    if (!ok) console.log(lines.filter((l) => /^FAIL|Error/.test(l)).slice(0, 8).map((l) => '       ' + l.slice(0, 300)).join('\n'));
    // An exception a suite caught goes to stderr: its first lines say where.
    if (!ok && res.stderr) console.log(res.stderr.trim().split('\n').slice(0, 6).map((l) => '       ' + l.slice(0, 300)).join('\n'));
}
console.log(failed ? `${failed} suite(s) failed` : `all ${names.length} suites passed`);
process.exit(failed ? 1 : 0);
