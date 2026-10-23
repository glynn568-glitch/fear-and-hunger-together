// The Codex partner (tools/brain.js codexCli) against a pretend Codex app
// server: the account refuses the first model and the next is tried; a stale
// turn's words never answer the current one; a turn that ends in an error fails
// that question only; and the login lent to the partner's own Codex folder
// comes back refreshed to the user's file, the copy deleted. No real Codex.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { checker } = require('./common');

const fake = fs.mkdtempSync(path.join(os.tmpdir(), 'fh-codex-'));
process.env.CODEX_HOME = path.join(fake, 'user');
fs.mkdirSync(process.env.CODEX_HOME);
const userAuth = path.join(process.env.CODEX_HOME, 'auth.json');
fs.writeFileSync(userAuth, JSON.stringify({ auth_mode: 'chatgpt', tokens: { access_token: 'old', refresh_token: 'r1' } }));
// The "program" is node itself, which runs the file named app-server in its
// working folder (the partner's own Codex work folder).
process.env.CODEX_BIN = process.execPath;
const work = path.join(__dirname, '..', 'data', 'partners', 'codex', 'work');
fs.mkdirSync(work, { recursive: true });
const server = path.join(work, 'app-server');
fs.writeFileSync(server, `
const fs = require('fs'), path = require('path');
const out = (m) => process.stdout.write(JSON.stringify(m) + '\\n');
let buf = '', turn = 0;
process.stdin.on('data', (d) => {
    buf += d; let i;
    while ((i = buf.indexOf('\\n')) >= 0) {
        const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
        if (m.method === 'initialize') out({ id: m.id, result: {} });
        else if (m.method === 'model/list') out({ id: m.id, result: { data: [{ id: 'gpt-big' }, { id: 'gpt-9-luna' }] } });
        else if (m.method === 'thread/start') {
            if (m.params.model === 'gpt-9-luna') out({ id: m.id, error: { code: 1, message: 'The gpt-9-luna model is not supported with a ChatGPT account.' } });
            else { fs.writeFileSync(path.join(__dirname, '..', 'model.txt'), m.params.model + ' | ' + m.params.sandbox + ' | ' + m.params.approvalPolicy); out({ id: m.id, result: { thread: { id: 'th1' } } }); }
        } else if (m.method === 'turn/start') {
            turn++;
            const id = 't' + turn;
            out({ id: m.id, result: { turn: { id, status: 'inProgress', items: [] } } });
            if (turn === 1) {
                // A refresh of the login while it runs.
                const auth = path.join(process.env.CODEX_HOME, 'auth.json');
                const a = JSON.parse(fs.readFileSync(auth, 'utf8')); a.tokens = { access_token: 'new', refresh_token: 'r2' }; fs.writeFileSync(auth, JSON.stringify(a));
                out({ method: 'item/agentMessage/delta', params: { threadId: 'th1', turnId: 't0', itemId: 'x', delta: 'STALE ' } });
                out({ method: 'item/agentMessage/delta', params: { threadId: 'th1', turnId: id, itemId: 'a', delta: '{"say":' } });
                out({ method: 'item/agentMessage/delta', params: { threadId: 'th1', turnId: id, itemId: 'a', delta: '"One."}' } });
                out({ method: 'turn/completed', params: { threadId: 'th1', turn: { id, status: 'completed', items: [] } } });
            } else if (turn === 2) {
                out({ method: 'item/agentMessage/delta', params: { threadId: 'th1', turnId: id, itemId: 'b', delta: 'half a thou' } });
                out({ method: 'error', params: { threadId: 'th1', turnId: id, willRetry: false, error: { message: 'usage limit reached' } } });
            } else {
                // The failed turn's late end arrives first, then this turn.
                out({ method: 'turn/completed', params: { threadId: 'th1', turn: { id: 't2', status: 'failed', items: [] } } });
                out({ method: 'item/agentMessage/delta', params: { threadId: 'th1', turnId: id, itemId: 'c', delta: '{"say":"Three."}' } });
                setTimeout(() => out({ method: 'turn/completed', params: { threadId: 'th1', turn: { id, status: 'completed', items: [] } } }), 50);
            }
        }
    }
});
`);
const { createBrain } = require('../tools/brain');

(async () => {
    const check = checker();
    const codexDir = path.join(__dirname, '..', 'data', 'partners', 'codex');
    // The login copies this process has lent out right now.
    const copies = () => fs.readdirSync(codexDir).filter((n) => n.startsWith('home-' + process.pid + '-')).map((n) => path.join(codexDir, n, 'auth.json')).filter((f) => fs.existsSync(f));
    let b, b2;
    try {
        b = createBrain({ brain: 'codex-cli', name: 'Claude', character: 'mercenary', effort: 'low', log: () => {} });
        const one = await b.ask('chat', 'Your partner says: "one"');
        check('the first model the account refuses is passed over for the next, in a read-only sandbox that asks', fs.readFileSync(path.join(work, '..', 'model.txt'), 'utf8') === 'gpt-big | read-only | untrusted', fs.readFileSync(path.join(work, '..', 'model.txt'), 'utf8'));
        check('a word from another turn never joins the answer', one && one.say === 'One.', JSON.stringify(one));
        check('while it runs, the login sits in the partner\'s own Codex folder', copies().length === 1, copies().join(', '));
        await new Promise((r) => setTimeout(r, 2600));
        check('a token it refreshes reaches the user\'s login within seconds, while it still runs', JSON.parse(fs.readFileSync(userAuth, 'utf8')).tokens.refresh_token === 'r2');
        b2 = createBrain({ brain: 'codex-cli', name: 'Claude II', character: 'knight', effort: 'low', log: () => {} });
        await b2.ask('chat', 'Your partner says: "one"');
        check('a second partner gets a Codex folder of its own', copies().length === 2, copies().join(', '));
        b2.close();
        b2 = null;
        const two = await b.ask('chat', 'Your partner says: "two"');
        check('a turn that ends in an error fails that question only (no half answer)', two === null, JSON.stringify(two));
        const three = await b.ask('chat', 'Your partner says: "three"');
        check('the failed turn\'s late end does not answer the next question', three && three.say === 'Three.', JSON.stringify(three));
        b.close();
        b = null;
        const t0 = Date.now();
        while (copies().length && Date.now() - t0 < 6000) await new Promise((r) => setTimeout(r, 100));
        const back = JSON.parse(fs.readFileSync(userAuth, 'utf8'));
        check('once they stop, the user\'s login holds the refreshed token and no copy is left', back.tokens.refresh_token === 'r2' && !copies().length, JSON.stringify(back.tokens) + ' copies left: ' + copies().length);
    } catch (e) {
        console.error(e);
        check('test ran to the end', false);
    }
    if (b) b.close();
    if (b2) b2.close();
    for (const f of [server, path.join(work, '..', 'model.txt')]) try { fs.unlinkSync(f); } catch (e) { /* gone */ }
    fs.rmSync(fake, { recursive: true, force: true });
    process.exit(check.finish([]));
})();
