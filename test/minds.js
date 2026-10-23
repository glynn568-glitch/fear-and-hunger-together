// Any model for the AI partner (tools/brain.js): a pretend OpenAI-style service
// on this PC stands in for xAI, OpenAI, Gemini, OpenRouter and the rest. Its
// model list is sorted best first, a bad key is refused before anything is
// kept, an empty model is picked from the list, a service that will not take
// response_format is asked without it, and a pick made at F8 drives the next
// partner over Claude Code found on the PC. Hermes's proxy is told apart from
// another program on its port, and only its owner stops it. No Chrome, no real model.
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { checker } = require('./common');

process.env.FH_MIND_FILE = path.join(os.tmpdir(), 'fh-minds-' + process.pid + '.json');
for (const k of ['XAI_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'OPENROUTER_API_KEY', 'ANTHROPIC_API_KEY', 'FH_SERVER_PORT']) delete process.env[k];
process.env.FH_HERMES_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fh-hermes-'));

(async () => {
    const check = checker();
    // A stand-in on Hermes's port: Hermes's proxy (it has /health), or another program.
    let hermesLike = false;
    const hermes = http.createServer((req, res) => {
        res.writeHead(req.url === '/health' && !hermesLike ? 404 : 200, { 'Content-Type': 'application/json' });
        res.end(req.url === '/health' ? JSON.stringify({ status: 'ok', upstream: 'xAI Grok OAuth', authenticated: true }) : JSON.stringify({ data: [{ id: 'grok-4.20-0309-non-reasoning' }] }));
    });
    await new Promise((r) => hermes.listen(0, '127.0.0.1', r));
    process.env.FH_HERMES_URL = 'http://127.0.0.1:' + hermes.address().port + '/v1';
    const brain = require('../tools/brain');
    const asked = [];
    let strict = true; // answers 400 to response_format, as some services do
    let camel = false; // answers 400 naming reasoning_effort in camelCase, as xAI does
    const service = http.createServer((req, res) => {
        let body = '';
        req.on('data', (d) => { body += d; });
        req.on('end', () => {
            const json = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
            if (req.headers.authorization !== 'Bearer good-key') return json(401, { error: { message: 'Incorrect API key' } });
            if (req.method === 'GET' && req.url === '/v1/models') {
                return json(200, { data: ['text-embedding-3', 'grok-2', 'grok-4.1-fast-non-reasoning', 'grok-4-fast-non-reasoning', 'grok-imagine-video', 'grok-4.1-fast-reasoning'].map((id) => ({ id })) });
            }
            if (req.method === 'POST' && req.url === '/v1/chat/completions') {
                const q = JSON.parse(body);
                asked.push(q);
                if (camel && q.reasoning_effort) return json(400, { code: 'invalid-argument', error: 'Model grok-x does not support parameter reasoningEffort.' });
                if (strict && q.response_format) return json(400, { error: { message: 'Argument not supported: response_format' } });
                return json(200, { choices: [{ message: { content: 'Sure. {"say":"Lead on, then.","order":null}' } }] });
            }
            json(404, { error: { message: 'no' } });
        });
    });
    await new Promise((r) => service.listen(0, '127.0.0.1', r));
    const url = 'http://127.0.0.1:' + service.address().port + '/v1';
    try {
        const models = await brain.listModels({ brain: 'xai', url, key: 'good-key' });
        check('a service\'s model list leaves out what cannot talk and puts the fast, newest one first',
            models[0] === 'grok-4.1-fast-non-reasoning' && models[1] === 'grok-4-fast-non-reasoning' && !models.some((m) => /embed|video/.test(m)), models.join(', '));

        const refused = await brain.checkMind({ brain: 'openai', url, key: 'bad-key', model: '' });
        check('a bad key is refused with a plain reason', refused === 'That key was refused.', refused);

        const pick = { brain: 'openai', url, key: 'good-key', model: '' };
        const ok = await brain.checkMind(pick);
        check('a good key with no model named passes, and the model is taken from the list', ok === '' && pick.model === 'grok-4.1-fast-non-reasoning', ok + ' / ' + pick.model);
        check('the check dropped response_format after the 400 and asked again', asked.length === 2 && asked[0].response_format && !asked[1].response_format, JSON.stringify(asked.map((q) => !!q.response_format)));

        brain.saveMind(pick);
        const kept = JSON.parse(fs.readFileSync(process.env.FH_MIND_FILE, 'utf8'));
        check('the pick is kept with its key under its own slot, apart from the OpenAI key', kept.brain === 'openai' && kept.keys['openai-url'] === 'good-key' && !kept.keys.openai, JSON.stringify(Object.keys(kept.keys)));

        const d = await brain.detect({ model: 'sonnet', key: 'sk-ant-settings-key' });
        check('the kept pick wins over Claude Code on this PC; "sonnet" and the Anthropic key from settings are not sent to it',
            d.brain === 'openai' && d.url === url && d.key === 'good-key' && d.model === 'grok-4.1-fast-non-reasoning', JSON.stringify(Object.assign({}, d, { key: d.key ? '(set)' : '' })));

        strict = false;
        asked.length = 0;
        const logs = [];
        const b = brain.createBrain(Object.assign({}, d, { effort: 'low', name: 'Claude', character: 'mercenary', log: (t) => logs.push(t) }));
        const reply = await b.ask('chat', 'Your partner says: "follow me"');
        check('a partner on that service answers through the queue as one JSON object', reply && reply.say === 'Lead on, then.', JSON.stringify(reply));
        check('a service that takes JSON mode is asked for it, and for low effort', asked[0] && asked[0].response_format && asked[0].response_format.type === 'json_object' && asked[0].reasoning_effort === 'low', JSON.stringify(asked[0] && Object.keys(asked[0])));
        check('its name says the model and where it is', b.name === 'grok-4.1-fast-non-reasoning at ' + url, b.name);
        b.close();

        // xAI (through the Hermes proxy, 10/23) names the field "reasoningEffort".
        camel = true;
        asked.length = 0;
        const c = brain.createBrain(Object.assign({}, d, { effort: 'low', name: 'Claude', character: 'mercenary', log: () => {} }));
        const camelReply = await c.ask('chat', 'Your partner says: "follow me"');
        check('a refusal that names the field in camelCase drops it and asks again', camelReply && camelReply.say === 'Lead on, then.' && asked.length === 2 && !('reasoning_effort' in asked[1]) && !!asked[1].response_format, JSON.stringify(asked.map((q) => Object.keys(q))));
        c.close();
        camel = false;

        const thought = brain.parseReply('<think>\nThe partner wants...\n</think>\n{"say":"Fine."}');
        const bare = brain.parseReply('<think> </think> "Ann! I owe you this."');
        check('a local reasoning model\'s <think> block never reaches the screen (Qwen in LM Studio, 10/23)', thought.say === 'Fine.' && !/think/.test(bare.say), JSON.stringify([thought, bare]));

        process.env.XAI_API_KEY = 'xai-test';
        fs.unlinkSync(process.env.FH_MIND_FILE);
        const viaEnv = await brain.detect({ brain: 'xai', model: 'grok-test' });
        check('a named service takes its key from its own variable', viaEnv.key === 'xai-test' && viaEnv.model === 'grok-test', viaEnv.key ? 'key set' : 'no key');
        const elsewhere = await brain.detect({ brain: 'xai', model: 'grok-test', url: 'https://elsewhere.example/v1' });
        check('a named service given some other address in settings does not send its key there', elsewhere.key === '', elsewhere.key ? 'key sent' : 'no key');

        const m = await brain.minds();
        const ids = m.list.map((x) => x.id);
        check('the F8 panel is offered every way to think, keys never shown whole',
            ['claude', 'codex-cli', 'grok-cli', 'anthropic', 'xai', 'openai', 'gemini', 'openrouter', 'ollama', 'lmstudio', 'hermes', 'openai-url', 'none'].every((id) => ids.includes(id))
            && !JSON.stringify(m).includes('xai-test') && m.list.find((x) => x.id === 'xai').key === '...test', ids.join(','));

        // Hermes (Grok review 6, #2): another program answering on its port is not taken for it.
        const other = await brain.listModels({ brain: 'hermes' }).then((l) => 'used: ' + l.join(','), (e) => e.message);
        check('another program on Hermes\'s port is named, not used as the partner', /Something other than Hermes is using port/.test(other), other);
        const notFound = await brain.listModels({ brain: 'hermes', start: false });
        check('and detection does not find Hermes there', notFound.length === 0, notFound.join(','));
        hermesLike = true;
        const found = await brain.listModels({ brain: 'hermes' });
        check('Hermes\'s proxy already running is used as it is', found[0] === 'grok-4.20-0309-non-reasoning', found.join(','));

        // Only the owner stops the proxy (#3, #4), and only a process that is Hermes (the pid may be reused after a crash).
        const fake = path.join(process.env.FH_HERMES_DIR, process.platform === 'win32' ? 'hermes.exe' : 'hermes');
        try { fs.linkSync(process.execPath, fake); } catch (e) { fs.copyFileSync(process.execPath, fake); fs.chmodSync(fake, 0o755); }
        const idle = (bin) => require('child_process').spawn(bin, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });
        const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return false; } };
        const pidFile = path.join(process.env.FH_HERMES_DIR, 'hermes.pid');
        const proxy = idle(fake), stranger = idle(process.execPath);
        await new Promise((r) => setTimeout(r, 500));
        fs.writeFileSync(pidFile, proxy.pid + ' 7777');
        brain.ownHermes(9001);
        check('a proxy another server (or a partner on its own) started is left running', alive(proxy.pid) && fs.existsSync(pidFile));
        fs.writeFileSync(pidFile, proxy.pid + ' 9001');
        brain.ownHermes(9001);
        await new Promise((r) => setTimeout(r, 500));
        check('the server that owns it stops one a crash left running', !alive(proxy.pid) && !fs.existsSync(pidFile));
        fs.writeFileSync(pidFile, stranger.pid + ' 9001');
        brain.ownHermes(9001);
        await new Promise((r) => setTimeout(r, 300));
        check('a kept pid that is no longer Hermes is not stopped', alive(stranger.pid) && !fs.existsSync(pidFile));
        try { stranger.kill(); proxy.kill(); } catch (e) { /* gone */ }
    } catch (e) {
        console.error(e);
        check('test ran to the end', false);
    }
    service.close();
    hermes.close();
    try { fs.unlinkSync(process.env.FH_MIND_FILE); } catch (e) { /* gone */ }
    try { fs.rmSync(process.env.FH_HERMES_DIR, { recursive: true, force: true }); } catch (e) { /* in use */ }
    process.exit(check.finish([]));
})();
