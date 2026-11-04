// Who a partner plays when it is called in: the host's pick (Plays as), a free character when that
// one is taken, and a body sent home resumed only when it is the character picked. Grok 11/03:
// under a configured name, a pick of another character brought the parked body back anyway and
// spent its park. No browser: partners.js with spawn stubbed, every case straight through start().
const fs = require('fs');
const os = require('os');
const path = require('path');
const EventEmitter = require('events');
process.env.FH_MIND_FILE = path.join(os.tmpdir(), 'fh-plays-' + process.pid + '.json');
const cp = require('child_process');
const spawned = [];
cp.spawn = function (exe, argv) {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = new EventEmitter();
    child.stdin.end = () => {};
    child.kill = () => {};
    spawned.push(argv);
    return child;
};
const { Partners } = require('../partners');
const brain = require('../tools/brain');
const { checker } = require('./common');

const check = checker();
function call(p, plays, initials) {
    brain.savePlays(plays);
    p.running.clear();
    spawned.length = 0;
    const why = p.start(new Set(), initials || []);
    const argv = spawned[0] || [];
    const at = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : ''; };
    return { why, name: at('--name'), char: at('--char') };
}
function sentHome(p, name, char) {
    p.home = [name];
    p.cast.set(name, char);
    p.parked = (n) => n === name;
}

try {
    const claude = new Partners(0, { partner: { name: 'Claude' } });
    let got = call(claude, 'outlander');
    check('the pick plays: outlander is Ragnvaldr', got.name === 'Ragnvaldr' && got.char === 'outlander', JSON.stringify(got));
    got = call(claude, 'priest', [663]);
    check('a pick somebody plays gives way to the first free one', got.name === "D'arce" && got.char === 'knight', JSON.stringify(got));

    const home = new Partners(0, { partner: { name: 'Claude' } });
    sentHome(home, "D'arce", 'knight');
    got = call(home, 'outlander');
    check('the knight sent home is not brought back after an outlander pick', got.name === 'Ragnvaldr' && got.char === 'outlander', JSON.stringify(got));
    sentHome(home, "D'arce", 'knight');
    got = call(home, 'knight');
    check('the same pick brings the knight back', got.name === "D'arce" && got.char === 'knight', JSON.stringify(got));
    sentHome(home, "D'arce", 'knight');
    got = call(home, '');
    check('no pick brings the one sent home back', got.name === "D'arce", JSON.stringify(got));

    const buddy = new Partners(0, { partner: { name: 'Buddy' } });
    sentHome(buddy, 'Buddy', 'knight');
    got = call(buddy, 'outlander');
    check('a configured name: another pick comes under another name, so the knight\'s park is not read', got.name && got.name !== 'Buddy' && got.char === 'outlander', JSON.stringify(got));
    buddy.running.clear();
    sentHome(buddy, 'Buddy', 'knight');
    got = call(buddy, 'knight');
    check('picking the knight again brings Buddy back', got.name === 'Buddy' && got.char === 'knight', JSON.stringify(got));
} catch (e) {
    console.error(e);
    check('test ran to the end', false);
}
try { fs.unlinkSync(process.env.FH_MIND_FILE); } catch (e) { /* gone */ }
process.exit(check.finish([]));
