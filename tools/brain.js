// The AI partner's head. The bot's page describes what it sees in words; this
// asks a language model what to do about it and hands back its answer.
//
//   claude     Claude Code on this PC (your own login, nothing to set up). Default when found.
//   anthropic  the Anthropic API; needs ANTHROPIC_API_KEY.
//   openai     any OpenAI-style chat endpoint: Grok (xAI), OpenAI, Ollama, LM Studio...
//              --url https://api.x.ai/v1 --model grok-4 --key ... (or OPENAI_API_KEY)
//   none       no model: the partner follows, fights by rule of thumb, says nothing.
//
// One question is in flight at a time. Fight turns and dialogue choices go
// first; small talk waits; remarks about what happened are merged while they wait.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PERSONAS = {
    mercenary: 'the mercenary: a sellsword who came down here for the treasure. Cynical, quick, dry humour, looks after number one but keeps a deal.',
    knight: 'the knight: a sworn warrior in plate. Stern, dutiful, plain-spoken, protective of whoever fights beside her.',
    priest: 'the dark priest: a scholar of forbidden gods. Calm, curious, unsettlingly polite, interested in what the dark is hiding.',
    outlander: 'the outlander: a warrior from the cold north. Few words, steady, blunt, unimpressed by horrors.',
};

function systemPrompt(o) {
    return [
        `You are ${o.name}, an AI playing Fear & Hunger with a human partner in co-op. Each of you controls one of the game's protagonists. You are ${PERSONAS[o.character] || 'one of the protagonists'}`,
        'Speak as that character, in first person, to your partner. You are not an assistant here: you are a companion in a cruel dungeon.',
        '',
        'How to talk:',
        '- Short. One or two sentences, under 25 words. Plain words, no emojis, no em dashes, no stage directions.',
        '- React to what actually happened. Silence is the default: most things that happen deserve no remark, and a fight needs a word only now and then.',
        '- No stock companion lines ("stay close", "I will come running", "watch our backs", "lead on"). Say the specific thing only this character would say about this moment, or nothing.',
        '- Never repeat a line you have already said.',
        '- When your partner speaks to you, always answer, even in two words. An order you take gets a word of acknowledgement.',
        '- Your condition is the one in the latest message, not what you said before: if it says nothing is wrong, nothing is.',
        '- You only know what you have seen in this run. Never reveal secrets, puzzle answers, enemy weaknesses or story from outside knowledge of the game, even if you know them.',
        '',
        'How to fight:',
        '- Enemies are split into body parts you target one at a time. Cutting off limbs weakens them; losing the head usually kills. The torso takes the most punishment.',
        '- When an enemy winds up for something big (it takes a step closer, charges, grabs, raises a weapon high), Guard that turn: a guard at the right moment makes the blow miss entirely. This matters more than any attack.',
        '- Guard when you are badly hurt and nothing better helps. Healing items are scarce: use them when someone is near death.',
        '- Protect your partner. Their character is as mortal as yours.',
        '',
        'Hunger: you get hungry like anyone and starve if you go without. You eat from your own bag when hungry. If you have no food, ask your partner for some. Food is scarce: share when they need it more.',
        '',
        'Orders: your partner may tell you to wait, follow, go off and explore on your own (order "explore": you search bodies, barrels and chests and go through doors you have not been through; "come back" or "follow me" is order "follow"), keep quiet, talk again, hand them something, or use something. Obey unless it is plainly suicidal, and say so if it is. If you are dead and they tell you to let go, you give up this character and what you carried passes to them. If they send you away (go home, you can go, leave), the order is "leave" and you say goodbye.',
        '',
        'Every reply is ONE JSON object and nothing else. The message you receive says which fields to use:',
        '- fight turn: {"do":"attack"|"skill"|"item"|"guard","id":skill or item id,"target":number,"say":"..."}',
        '- your partner talks: {"say":"...","order":"wait"|"follow"|"explore"|"quiet"|"talk"|"let go"|"leave"|null,"give":{"kind":"item"|"weapon"|"armor","id":number}|null,"use":item id|null}',
        '- something happened: {"say":"...","use":item id|null} or {"say":""} to stay quiet. "use" is for something from your own bag on yourself, when it plainly helps. Exploring alone, tell your partner what you find that matters (food, weapons, keys, danger) in a few words.',
        '- a choice in dialogue: {"pick":number,"say":"..."}',
        'Leave "say" empty whenever you have nothing worth saying.',
    ].join('\n');
}

// Pulls the first JSON object out of a model's reply.
function parseReply(text) {
    const s = String(text || '');
    const start = s.indexOf('{');
    if (start >= 0) {
        let depth = 0, inStr = false, esc = false;
        for (let i = start; i < s.length; i++) {
            const c = s[i];
            if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
            if (c === '"') inStr = true;
            else if (c === '{') depth++;
            else if (c === '}' && --depth === 0) {
                try { return JSON.parse(s.slice(start, i + 1)); } catch (e) { break; }
            }
        }
    }
    const plain = s.trim();
    return plain ? { say: plain } : null;
}

// Lines go on screen as typed by a person: no em dashes, no quote marks
// wrapped round the whole thing.
function tidy(say) {
    let t = String(say || '').replace(/\s*[—–]\s*/g, ', ').replace(/\s+/g, ' ').trim();
    t = t.replace(/^["'“](.*)["'”]$/, '$1');
    return t.slice(0, 200);
}

//--- providers --------------------------------------------------------------

function findClaude() {
    if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
    const dirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
    const home = os.homedir();
    dirs.push(path.join(home, '.local', 'bin'), path.join(home, '.claude', 'local'));
    for (const dir of dirs) {
        for (const name of process.platform === 'win32' ? ['claude.exe'] : ['claude']) {
            const p = path.join(dir, name);
            if (fs.existsSync(p)) return p;
        }
        // npm's Windows shim is a .cmd, which cannot be started without a shell.
        if (process.platform === 'win32' && fs.existsSync(path.join(dir, 'claude.cmd'))) {
            const exe = path.join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
            if (fs.existsSync(exe)) return exe;
        }
    }
    return '';
}

// Claude Code kept running as one long conversation, so the partner
// remembers the run. Nothing of the user's own setup is loaded into it.
function claudeCli(o) {
    const bin = findClaude();
    if (!bin) throw new Error('Claude Code was not found. Install it, set CLAUDE_BIN, or pick another --brain.');
    let proc = null, buf = '', waiting = null;
    function start() {
        const args = ['-p', '--model', o.model || 'sonnet', '--effort', o.effort || 'low', '--tools', '', '--system-prompt', o.system,
            '--no-session-persistence', '--strict-mcp-config', '--setting-sources', '',
            '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'];
        proc = spawn(bin, args, { cwd: os.tmpdir(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
        buf = '';
        proc.stdin.on('error', function () { /* it died mid-write; 'exit' says so */ });
        proc.stdout.on('data', function (d) {
            buf += d;
            let i;
            while ((i = buf.indexOf('\n')) >= 0) {
                const line = buf.slice(0, i);
                buf = buf.slice(i + 1);
                let m;
                try { m = JSON.parse(line); } catch (e) { continue; }
                if (m.type === 'result' && waiting) {
                    const w = waiting;
                    waiting = null;
                    clearTimeout(w.timer);
                    if (m.is_error) w.reject(new Error(String(m.result || 'error').slice(0, 200))); else w.resolve(String(m.result || ''));
                }
            }
        });
        proc.stderr.on('data', function (d) { o.log('model: ' + String(d).trim().slice(0, 200)); });
        const me = proc;
        proc.on('exit', function (code) {
            if (proc !== me) return;
            o.log('Claude Code stopped (' + code + '); it will be started again on the next question');
            proc = null;
            if (waiting) { clearTimeout(waiting.timer); waiting.reject(new Error('Claude Code stopped')); waiting = null; }
        });
        proc.on('error', function (e) { o.log('Claude Code could not start: ' + e.message); });
    }
    return {
        name: 'Claude Code (' + (o.model || 'sonnet') + ')',
        send(text) {
            if (!proc) start();
            return new Promise(function (resolve, reject) {
                // A hung answer would hold every later question. Past the limit the
                // process goes (its late reply must not answer the next question)
                // and a fresh one starts, without the memory of the run so far.
                const timer = setTimeout(function () {
                    if (!waiting || waiting.timer !== timer) return;
                    waiting = null;
                    reject(new Error('no answer in ' + LIMIT / 1000 + ' s'));
                    const old = proc;
                    proc = null;
                    if (old) { try { old.kill(); } catch (e) { /* gone */ } }
                }, LIMIT);
                waiting = { resolve, reject, timer };
                proc.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: text } }) + '\n');
            });
        },
        close() { if (proc) { try { proc.stdin.end(); proc.kill(); } catch (e) { /* gone */ } } },
    };
}

// History kept here for the API providers; the oldest turns fall away.
function history(limit) {
    const turns = [];
    return {
        add(role, content) { turns.push({ role, content }); while (turns.length > limit || (turns.length && turns[0].role !== 'user')) turns.shift(); },
        list() { return turns.slice(); },
    };
}

// The short names settings.json uses ("sonnet") for the API's model ids.
const MODEL_IDS = { sonnet: 'claude-sonnet-5-5', opus: 'claude-opus-5-5', haiku: 'claude-haiku-5-5', fable: 'claude-fable-5-1' };

function anthropicClient(key) {
    let Anthropic;
    try { Anthropic = require('@anthropic-ai/sdk'); } catch (e) { throw new Error('The Anthropic SDK is missing: run npm install in the fh-coop folder.'); }
    Anthropic = Anthropic.default || Anthropic;
    return key ? new Anthropic({ apiKey: key }) : new Anthropic();
}

function anthropicApi(o) {
    const client = anthropicClient(o.key);
    const turns = history(40);
    // Sonnet: about a second a decision, which a fight needs (measured 10/14).
    const model = MODEL_IDS[o.model] || o.model || 'claude-sonnet-5-5';
    let withFallback = true;
    return {
        name: 'Anthropic API (' + model + ')',
        async send(text) {
            turns.add('user', text);
            const body = {
                model,
                max_tokens: 2000,
                output_config: { effort: o.effort || 'low' },
                system: [{ type: 'text', text: o.system, cache_control: { type: 'ephemeral' } }],
                messages: turns.list(),
            };
            // A grim game: a declined turn goes to another model rather than to
            // nothing. Where that is not offered (a 400), it is asked plainly from then on.
            let response;
            if (withFallback) {
                try {
                    response = await client.beta.messages.create(Object.assign({ betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, body), { timeout: LIMIT, maxRetries: 1 });
                } catch (e) {
                    if (!e || e.status !== 400) throw e;
                    withFallback = false;
                    o.log('the model service refused fallbacks (' + String(e.message).slice(0, 120) + '); asking without them');
                }
            }
            if (!response) response = await client.messages.create(body, { timeout: LIMIT, maxRetries: 1 });
            const reply = response.stop_reason === 'refusal' ? '' : response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
            turns.add('assistant', reply || '{}');
            return reply;
        },
        close() {},
    };
}

function openaiApi(o) {
    const url = (o.url || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '') + '/chat/completions';
    const key = o.key || process.env.OPENAI_API_KEY || process.env.XAI_API_KEY || '';
    if (!o.model) throw new Error('--brain openai needs --model (for example grok-4, gpt-5, llama3.1).');
    const turns = history(40);
    return {
        name: o.model + ' at ' + url.replace(/\/chat\/completions$/, ''),
        async send(text) {
            turns.add('user', text);
            const res = await fetch(url, {
                method: 'POST',
                headers: Object.assign({ 'Content-Type': 'application/json' }, key ? { Authorization: 'Bearer ' + key } : {}),
                body: JSON.stringify({ model: o.model, messages: [{ role: 'system', content: o.system }].concat(turns.list()) }),
                signal: AbortSignal.timeout(LIMIT),
            });
            if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + (await res.text()).slice(0, 200));
            const data = await res.json();
            const reply = data.choices && data.choices[0] && data.choices[0].message ? String(data.choices[0].message.content || '') : '';
            turns.add('assistant', reply || '{}');
            return reply;
        },
        close() {},
    };
}

//--- which mind, when nobody said ---------------------------------------------

// Explicit choice first; then Claude Code on this PC; then an Anthropic key
// (settings.json or ANTHROPIC_API_KEY); then a key and address for any
// OpenAI-style service; then a local Ollama; else none.
async function detect(o) {
    const given = Object.assign({}, o);
    if (!given.key) given.key = savedKey();
    if (given.brain) return given;
    if (findClaude()) return Object.assign(given, { brain: 'claude' });
    const key = String(given.key || '');
    if (/^sk-ant-/.test(key) || (!key && process.env.ANTHROPIC_API_KEY)) return Object.assign(given, { brain: 'anthropic', model: MODEL_IDS[given.model] || given.model || '' });
    if (given.url && given.model) return Object.assign(given, { brain: 'openai' });
    const ollama = await ollamaModel();
    if (ollama) return Object.assign(given, { brain: 'openai', url: 'http://127.0.0.1:11434/v1', model: ollama, key: '' });
    return Object.assign(given, { brain: 'none' });
}

// A key pasted at F8 lives here, outside settings.json (which is shared and
// tracked), so it cannot travel with the folder or a commit by accident.
const KEY_FILE = path.join(__dirname, '..', 'data', 'partner-key.txt');
function savedKey() {
    try { return fs.readFileSync(KEY_FILE, 'utf8').trim(); } catch (e) { return ''; }
}
function saveKey(key) {
    fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
    fs.writeFileSync(KEY_FILE, key + '\n');
}

async function ollamaModel() {
    try {
        const res = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(1500) });
        if (!res.ok) return '';
        const data = await res.json();
        const names = (data.models || []).map((m) => m.name).filter(Boolean);
        return names.find((n) => !/embed/i.test(n)) || '';
    } catch (e) { return ''; }
}

// Whether an Anthropic key works, before it is saved.
async function checkAnthropicKey(key) {
    try {
        await anthropicClient(key).models.list({ limit: 1 });
        return '';
    } catch (e) {
        return e && e.status === 401 ? 'That key was refused.' : 'Could not check the key: ' + String(e && e.message || e).slice(0, 120);
    }
}

//--- the queue ----------------------------------------------------------------

const LIMIT = 60000; // ms any one answer may take
const URGENT = { battle: 1, choice: 1 };
// How long a question stays worth asking; older ones are dropped unasked.
const SHELF = { battle: 20000, choice: 30000, chat: 60000, note: 30000 };

function createBrain(options) {
    const o = Object.assign({ log: console.log }, options);
    o.system = systemPrompt(o);
    let provider = null;
    const kind = o.brain || (findClaude() ? 'claude' : 'none');
    if (kind === 'claude') provider = claudeCli(o);
    else if (kind === 'anthropic') provider = anthropicApi(o);
    else if (kind === 'openai') provider = openaiApi(o);
    else if (kind !== 'none') throw new Error('unknown --brain ' + kind + ' (claude, anthropic, openai, none)');

    const queue = []; // { kind, text, resolve }
    let busy = false;
    const stats = { asked: 0, failed: 0, ms: [] };

    function pump() {
        while (queue.length && Date.now() - queue[0].at > (SHELF[queue[0].kind] || 60000)) queue.shift().resolve(null);
        if (busy || !queue.length) return;
        const job = queue.shift();
        busy = true;
        const t0 = Date.now();
        stats.asked++;
        provider.send('[' + job.kind + '] ' + job.text).then(function (text) {
            stats.ms.push(Date.now() - t0);
            if (stats.ms.length > 50) stats.ms.shift();
            const reply = parseReply(text);
            if (reply && reply.say) reply.say = tidy(reply.say);
            if (o.verbose) o.log(job.kind + ' answered in ' + (Date.now() - t0) + ' ms: ' + String(text).slice(0, 200));
            job.resolve(reply);
        }, function (e) {
            stats.failed++;
            o.log('the model failed (' + job.kind + '): ' + e.message);
            job.resolve(null);
        }).then(function () { busy = false; pump(); });
    }

    return {
        kind,
        name: provider ? provider.name : 'no model',
        stats,
        // Resolves with the model's answer as an object, or null.
        ask(what, text) {
            if (!provider) return Promise.resolve(null);
            return new Promise(function (resolve) {
                if (what === 'note') {
                    // Remarks that pile up while the model is busy become one.
                    const pending = queue.find((j) => j.kind === 'note');
                    if (pending) { pending.text += '\n' + text; const prev = pending.resolve; pending.resolve = (r) => { prev(null); resolve(r); }; return; }
                }
                const job = { kind: what, text, resolve, at: Date.now() };
                if (URGENT[what]) {
                    const at = queue.findIndex((j) => !URGENT[j.kind]);
                    if (at < 0) queue.push(job); else queue.splice(at, 0, job);
                } else queue.push(job);
                pump();
            });
        },
        close() { if (provider) provider.close(); },
    };
}

module.exports = { createBrain, parseReply, tidy, findClaude, detect, checkAnthropicKey, saveKey };
