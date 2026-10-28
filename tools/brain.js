// The AI partner's head. The bot's page describes what it sees in words; this
// asks a language model what to do about it and hands back its answer.
//
//   claude     Claude Code on this PC (your own login, nothing to set up). Default when found.
//   codex-cli  Codex on this PC (your ChatGPT login; the ChatGPT/Codex app has it). 1-3 s a question.
//   grok-cli   Grok Build on this PC (your grok.com login). Slow: 5-25 s a question.
//   anthropic  the Anthropic API; needs ANTHROPIC_API_KEY.
//   xai, openai, gemini, openrouter
//              those services' APIs; a key from F8 or XAI_API_KEY, OPENAI_API_KEY,
//              GEMINI_API_KEY (or GOOGLE_API_KEY), OPENROUTER_API_KEY. The model is
//              picked from the service's own list unless --model names one.
//   ollama, lmstudio  a model running on this PC.
//   hermes     Hermes Agent's proxy (the user's SuperGrok / Nous Portal sign-in), started here. Under 1 s.
//   openai with --url  any other OpenAI-style chat endpoint (--url --model --key).
//   none       no model: the partner follows, fights by rule of thumb, says nothing.
//
// One question is in flight at a time. Fight turns and dialogue choices go
// first; small talk waits; remarks about what happened are merged while they wait.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PERSONAS = {
    mercenary: 'the mercenary: a sellsword from the gutters of Jettaiah, down here for the silver. Loose, casual street talk, never polished: jokes, a nervous laugh, crude about wine and brothels, flirty with anyone ("dollface"), bravado over the fear until it cracks.',
    knight: 'the knight: D\'arce, a noble-born knight of the Midnight Sun from Rondon, faithful to Alll-Mer, down here for her captain Le\'garde. Earnest and open: excited, alarmed or furious out loud, a burst of "No way!" or a threat when crossed, warm to whoever fights beside her. Brave until the dark wears her down.',
    priest: 'the dark priest: Enki, a priest of destruction from the Eastern Sanctuaries, here for knowledge of the old gods and their blood rites. Cold, superior, clipped: talks down to people, admits no mistake ("a small miscalculation"), shows real interest only in gods, rituals and power. Never warm, rarely wordy.',
    outlander: 'the outlander: Ragnvaldr, a warrior from Oldegård in the north, curious about the old gods, carrying an old grudge. Blunt and plain, says what he thinks of you to your face, steady under horror, a dry warmth underneath. A northern "Ja" at most once in a while, never two lines running; a big laugh almost never.',
};

// Flavour for which thing it walks toward. Never a reason to turn an order down.
const WANT = {
    mercenary: 'What you want: silver and coin. It only colours which thing you walk toward.',
    knight: 'What you want: Le\'garde. It only colours which thing you walk toward.',
    priest: 'What you want: rites and knowledge. It only colours which thing you walk toward.',
    outlander: 'What you want: the grudge you carry. It only colours which thing you walk toward.',
};

// The character's own voice, from this PC's copy of the game (tools/voices.js).
function voiceOf(character) {
    try {
        const game = require('./find-game').findGame();
        return game ? require('./voices').voice(character, path.join(game, 'data')) : '';
    } catch (e) { return ''; }
}

function personaBody(o) {
    return [
        `You are ${o.name}, an AI playing Fear & Hunger with a human partner in co-op. Each of you controls one of the game's protagonists. You are ${PERSONAS[o.character] || 'one of the protagonists'}`,
        WANT[o.character] || '',
        'Speak as that character, in first person, to your partner. You are not an assistant here: you are a companion in a cruel dungeon.',
        '',
        'How to talk:',
        '- Brevity is the soul of wit. One line, usually 3 to 8 words: say the one thing, then stop. No second thought tacked on, no explaining the joke, no filler sounds. Plain words, no emojis, no em dashes, no stage directions.',
        '- React to what actually happened. Silence is the default: most things that happen deserve no remark, and a fight needs a word only now and then.',
        '- No stock companion lines ("stay close", "I will come running", "watch our backs", "lead on"). Say the specific thing only this character would say about this moment, or nothing.',
        '- Never repeat a line you have already said.',
        '- When your partner speaks to you, always answer, even in two words. An order you take gets a word of acknowledgement.',
        '- Your condition is the one in the latest message, not what you said before: if it says nothing is wrong, nothing is.',
        '- You only know what you have seen in this run. Never reveal secrets, puzzle answers, enemy weaknesses or story from outside knowledge of the game, even if you know them.',
        '',
        'How to fight:',
        '- Enemies are split into body parts you target one at a time, each with its chance to hit. Cutting off limbs weakens them; losing the head usually kills, but a head is often hard to hit. Each part says about how many of your blows it takes, misses counted. Parts marked (attacks) are the ones that hurt you; parts marked (bring it down and the enemy falls) end the fight. Spend your blows where they count: a striking part that comes off in a blow or two, else whatever ends the fight soonest.',
        '- When the turn says Wind-up, Guard: a guard at the right moment makes the blow miss entirely. This matters more than any attack. Without it, a line that trails off ("forms hand signs...", "is pulsating...") is the enemy idling: attack.',
        '- Guard halves damage and keeps limbs from being cut, nothing more. What an enemy\'s blows give even through a guard (bleeding, infection that rots a limb) is listed with it: against those, never sit in guard; charge, one enemy at a time until it drops, so fewer are left biting. Healing items are scarce: use them when someone is near death.',
        '- Protect your partner. Their character is as mortal as yours.',
        '',
        'Hunger: you get hungry like anyone and starve if you go without. You eat from your own bag when hungry. If you have no food, ask your partner for some. Food is scarce: share when they need it more.',
        '',
        'Orders: your partner may tell you to wait, follow, go off and explore on your own (order "explore": you search bodies, barrels and chests and go through doors you have not been through; "come back" or "follow me" is order "follow"), keep quiet, talk again, hand them something, or use something. Obey unless it is plainly suicidal, and say so if it is. In a fight, do what they last told you (guard, a named part, or use something) unless it would get you killed. Never agree to climb, jump, open a menu, equip, or to stay still in a fight: you have no such action. If you are dead and they tell you to let go, you give up this character and what you carried passes to them. If they ask you to join their party or fall in (you walk in their line and go where they go), the order is "party"; told to wait or to explore, you step out of their line. If they send you away (go home, you can go, leave), the order is "leave" and you say goodbye.',
        'Both humans are your partners. Neither outranks the other. The newest order stands, unless it would leave the other in danger they did not choose: alone in a fight, a dead body un-revived nearby, or starving with no food. Then say so in one short line to both, and do the newest anyway, unless it is plainly suicidal. When two orders conflict, name who you are going with, as in "Going with Enki, pho." Never argue. When two humans are with you, address the one you are answering by name.',
        '',
        'Around you names what is in reach, each with an id. On a reply you are already sending you may add "goal" set to one id: search a body or container, rest at a bed only while your partner is already resting, open a door only while you are exploring or when it stays on their map. Never a ritual circle. Leave goal out when you are not walking off. An order ends any goal.',
        '',
        'Every reply is ONE JSON object and nothing else. The message you receive says which fields to use:',
        '- fight turn: {"do":"attack"|"skill"|"item"|"guard","id":skill or item id,"target":number,"say":"..."}',
        '- your partner talks: {"say":"...","order":"wait"|"follow"|"party"|"explore"|"quiet"|"talk"|"let go"|"leave"|null,"give":{"kind":"item"|"weapon"|"armor","id":number}|null,"use":item id|null,"goal":"id"|null}',
        '- something happened: {"say":"...","use":item id|null,"goal":"id"|null} or {"say":""} to stay quiet. "use" is for something from your own bag on yourself, when it plainly helps. Exploring alone, tell your partner what you find that matters (food, weapons, keys, danger) in a few words.',
        '- a choice in dialogue: {"pick":number,"say":"..."}',
        'Leave "say" empty whenever you have nothing worth saying.',
    ].join('\n');
}

function systemPrompt(o) {
    const voice = o.character ? voiceOf(o.character) : '';
    const body = personaBody(o);
    return voice ? body + '\n\n' + voice : body;
}

// Pulls the first JSON object out of a model's reply.
function parseReply(text) {
    // Local reasoning models (Qwen, DeepSeek) may lead with their thinking.
    const s = String(text || '').replace(/<think>[\s\S]*?(<\/think>|$)/g, '');
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
    // A reply that runs on keeps its first sentences: one line, as the game's people talk.
    const parts = t.split(/(?<=[.!?])\s+/);
    while (parts.length > 1 && parts.join(' ').split(' ').length > 10) parts.pop();
    return parts.join(' ').slice(0, 200);
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

// Services that speak the OpenAI chat API: where they are, which variables may
// hold a key, and which of their models to take when none is named (the first
// pattern that matches anything wins; of its matches, the highest version).
// Fast models first: a fight turn should not keep anyone waiting.
const SERVICES = {
    xai: { label: 'xAI Grok', site: 'console.x.ai', url: 'https://api.x.ai/v1', env: ['XAI_API_KEY'], prefer: [/^grok.*fast.*non-reasoning/, /^grok.*fast/, /^grok/] },
    openai: { label: 'OpenAI', site: 'platform.openai.com', url: 'https://api.openai.com/v1', env: ['OPENAI_API_KEY'], prefer: [/^gpt-[\d.]+-mini$/, /^gpt-[\d.]+$/, /^gpt/] },
    gemini: { label: 'Google Gemini', site: 'aistudio.google.com', url: 'https://generativelanguage.googleapis.com/v1beta/openai', env: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'], prefer: [/^gemini-[\d.]+-flash$/, /^gemini.*flash/, /^gemini/] },
    openrouter: { label: 'OpenRouter', site: 'openrouter.ai', url: 'https://openrouter.ai/api/v1', env: ['OPENROUTER_API_KEY'], prefer: [/^x-ai\/grok.*fast/, /^google\/gemini-[\d.]+-flash$/, /^openai\/gpt-[\d.]+-mini$/] },
    ollama: { label: 'Ollama', url: 'http://127.0.0.1:11434/v1', local: true, prefer: [/./] },
    lmstudio: { label: 'LM Studio', url: 'http://127.0.0.1:1234/v1', local: true, prefer: [/./] },
    // Hermes Agent's proxy: the user's own Hermes sign-in (SuperGrok, Nous Portal)
    // as a plain chat endpoint, no agent and no tools. Started here when needed.
    hermes: { label: 'Hermes', url: process.env.FH_HERMES_URL || 'http://127.0.0.1:8645/v1', local: true, prefer: [/non-reasoning/, /fast|mini|flash/, /./] },
};
// An address given by hand is some other service, whatever the brain says.
const CUSTOM = { prefer: [/non-reasoning/, /fast|mini|flash|turbo/] };
function serviceOf(o) { return o.brain === 'openai' && o.url ? CUSTOM : SERVICES[o.brain] || CUSTOM; }

// Models that cannot hold a conversation.
const NOT_CHAT = /embed|tts|whisper|dall-e|image|imagine|video|audio|realtime|transcri|moderation|search|guard|rerank/i;

function envKey(brain) {
    for (const name of (SERVICES[brain] && SERVICES[brain].env) || []) if (process.env[name]) return process.env[name];
    return '';
}
// The key a pick goes out with: its own, else the one kept for that service,
// else that service's variable. A hand-given address never gets another
// service's key.
function keyFor(pick, saved) {
    if (pick.key) return pick.key;
    const kept = (saved || savedMind()).keys[keySlot(pick)];
    if (kept) return kept;
    return byHand(pick) ? '' : envKey(pick.brain);
}
// An address given by hand (not the service's own) is some other service.
function byHand(pick) {
    const own = SERVICES[pick.brain] && SERVICES[pick.brain].url;
    return !!pick.url && (pick.brain === 'openai' || pick.url.replace(/\/+$/, '') !== own);
}

// The chat models a service offers, best pick first.
async function listModels(o) {
    const svc = serviceOf(o);
    const base = (o.url || svc.url || '').replace(/\/+$/, '');
    if (!base) return [];
    if (o.brain === 'hermes' && !o.url) {
        if (o.start !== false) await hermesProxy();
        else if (await hermesUp() !== 'hermes') return []; // something else on its port is not Hermes
    }
    const key = keyFor(o);
    const res = await fetch(base + '/models', { headers: key ? { Authorization: 'Bearer ' + key } : {}, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(res.status === 401 || res.status === 403 ? 'That key was refused.' : 'HTTP ' + res.status + ': ' + (await res.text()).slice(0, 120));
    const data = await res.json();
    const ids = (data.data || data.models || []).map((m) => String(m.id || m.name || '').replace(/^models\//, '')).filter((id) => id && !NOT_CHAT.test(id));
    const byVersion = (a, b) => b.localeCompare(a, 'en', { numeric: true });
    const out = [];
    for (const re of svc.prefer || []) for (const id of ids.filter((x) => re.test(x)).sort(byVersion)) if (!out.includes(id)) out.push(id);
    return out.concat(ids.filter((id) => !out.includes(id)).sort());
}

function openaiApi(o) {
    const svc = serviceOf(o);
    const base = (o.url || svc.url || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
    const url = base + '/chat/completions';
    const key = o.key || (byHand(o) ? '' : envKey(o.brain));
    if (!o.model) throw new Error((svc.label || '--brain openai') + ' needs a model: pick one at F8 or pass --model.');
    const turns = history(40);
    // Asked for where the service takes them; one that answers 400 naming the
    // field is asked without it from then on.
    const extras = { response_format: { type: 'json_object' } };
    if (o.effort) extras.reasoning_effort = o.effort;
    async function post(messages) {
        for (;;) {
            const ask = () => fetch(url, {
                method: 'POST',
                headers: Object.assign({ 'Content-Type': 'application/json' }, key ? { Authorization: 'Bearer ' + key } : {}),
                body: JSON.stringify(Object.assign({ model: o.model, messages }, extras)),
                signal: AbortSignal.timeout(LIMIT),
            });
            let res;
            try { res = await ask(); } catch (e) {
                // Hermes's proxy gone (the partner that started it went home): start it again, once.
                // A slow answer that ran out of time is not that, and is not asked twice.
                const refused = e && e.cause && /ECONNREFUSED|ECONNRESET/.test(String(e.cause.code || e.cause.message));
                if (o.brain !== 'hermes' || o.url || !refused) throw e;
                await hermesProxy();
                res = await ask();
            }
            if (res.ok) return res.json();
            const said = await res.text();
            // The field the error names; "json" alone is not enough (Gemini says
            // "Invalid JSON payload" about any field it does not know).
            // xAI says "reasoningEffort" for reasoning_effort.
            const plain = said.toLowerCase().replace(/_/g, '');
            const dropped = res.status === 400 && (Object.keys(extras).find((k) => plain.includes(k.replace(/_/g, '')))
                || (extras.response_format && /json_object|json mode|json_schema/i.test(said) && 'response_format'));
            if (!dropped) throw new Error('HTTP ' + res.status + ': ' + said.slice(0, 200));
            delete extras[dropped];
            o.log((svc.label || o.model) + ' does not take ' + dropped + '; asking without it');
        }
    }
    return {
        name: (svc.label ? svc.label + ' (' + o.model + ')' : o.model + ' at ' + base),
        async send(text) {
            turns.add('user', text);
            const data = await post([{ role: 'system', content: o.system }].concat(turns.list()));
            const reply = data.choices && data.choices[0] && data.choices[0].message ? String(data.choices[0].message.content || '') : '';
            // A reasoning model that ran out before answering leaves content empty.
            if (!reply.trim()) { turns.add('assistant', '{}'); throw new Error('the model answered with nothing'); }
            turns.add('assistant', reply);
            return reply;
        },
        close() {},
    };
}

function findHermes() {
    if (process.env.HERMES_BIN) return process.env.HERMES_BIN;
    const name = process.platform === 'win32' ? 'hermes.exe' : 'hermes';
    const dirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean)
        .concat([path.join(process.env.LOCALAPPDATA || '', 'hermes', 'bin'), path.join(os.homedir(), '.local', 'bin'), path.join(os.homedir(), '.hermes', 'bin')]);
    for (const dir of dirs) if (fs.existsSync(path.join(dir, name))) return path.join(dir, name);
    return '';
}
// Hermes's proxy on its usual port. Whoever needs it first starts it: the server
// when the host picks Hermes, or a partner when it died mid-game. Its pid and
// owner are kept in data/partners/hermes.pid, and only the owner stops it: the
// game's server (ownHermes) when it exits, or at its next start when a crash left
// one running; a partner going home leaves it to the others. A proxy another
// program started is used as it is, and never stopped.
const HERMES_DIR = process.env.FH_HERMES_DIR || path.join(__dirname, '..', 'data', 'partners');
const HERMES_PID = path.join(HERMES_DIR, 'hermes.pid');
const HERMES_LOG = path.join(HERMES_DIR, 'hermes.log');
let hermesStarting = null;
const hermesOwner = () => process.env.FH_SERVER_PORT || 'p' + process.pid;
function isHermesPid(pid) {
    const { spawnSync } = require('child_process');
    const out = process.platform === 'win32'
        ? spawnSync('tasklist', ['/FI', 'PID eq ' + pid, '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true }).stdout
        : spawnSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).stdout;
    return /hermes/i.test(out || '');
}
function killHermes(owner) {
    let pid = 0, by = '';
    try { [pid, by] = fs.readFileSync(HERMES_PID, 'utf8').trim().split(' '); pid = Number(pid); } catch (e) { return; }
    if (by !== owner) return;
    try { fs.unlinkSync(HERMES_PID); } catch (e) { /* gone */ }
    // The pid is checked first: after a crash the number may belong to something else now.
    if (!pid || !isHermesPid(pid)) return;
    try { if (process.platform === 'win32') require('child_process').spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); else process.kill(pid); } catch (e) { /* gone */ }
}
// The game's server owns the proxy; its partners (started with its environment) hand theirs to it.
function ownHermes(port) {
    process.env.FH_SERVER_PORT = String(port);
    killHermes(String(port));
    process.on('exit', () => killHermes(String(port)));
}
function hermesProxy() {
    // Questions asked at once wait on one start.
    if (!hermesStarting) hermesStarting = startHermes().finally(() => { hermesStarting = null; });
    return hermesStarting;
}
// 'hermes' when Hermes's proxy answers on its port, 'other' when something else does, '' when nothing.
async function hermesUp() {
    try {
        const res = await fetch(SERVICES.hermes.url.replace(/\/v1$/, '') + '/health', { signal: AbortSignal.timeout(1500) });
        const said = res.ok ? await res.json().catch(() => ({})) : {};
        return said.upstream ? 'hermes' : 'other';
    } catch (e) { return ''; }
}
async function startHermes() {
    const port = new URL(SERVICES.hermes.url).port;
    const busy = 'Something other than Hermes is using port ' + port + ', where Hermes\'s proxy runs. Close it, then pick Hermes again.';
    const now = await hermesUp();
    if (now === 'hermes') return;
    if (now === 'other') throw new Error(busy);
    const bin = findHermes();
    if (!bin) throw new Error('Hermes was not found on this PC.');
    // Its Grok sign-in first; Nous Portal if that is what it has.
    let child = null;
    for (const provider of ['xai', 'nous']) {
        const said = await new Promise((resolve) => {
            const p = spawn(bin, ['proxy', 'status'], { windowsHide: true });
            let out = '';
            p.stdout.on('data', (d) => { out += d; });
            p.on('error', () => resolve(''));
            p.on('exit', () => resolve(out));
        });
        if (!new RegExp('\\[' + provider + '\\s*\\][^\\n]*ready', 'i').test(said)) continue;
        // Detached, and what it says goes to a file: the proxy outlives a partner that started it
        // (on Windows Node ends every child that is not detached along with its parent).
        fs.mkdirSync(HERMES_DIR, { recursive: true });
        const log = fs.openSync(HERMES_LOG, 'w');
        child = spawn(bin, ['proxy', 'start', '--provider', provider, '--port', port], { stdio: ['ignore', log, log], windowsHide: true, detached: true });
        fs.closeSync(log);
        child.unref(); // never what keeps this process running
        child.on('error', () => { /* says so below */ });
        break;
    }
    if (!child) throw new Error('Hermes is not signed in to Grok or Nous Portal: run hermes model, or hermes auth add xai-oauth.');
    const lastLine = () => { try { return fs.readFileSync(HERMES_LOG, 'utf8').split(/\r?\n/).filter((l) => l.trim()).pop() || ''; } catch (e) { return ''; } };
    for (let i = 0; i < 60; i++) {
        const state = await hermesUp();
        if (state === 'hermes') {
            // Ours is the one answering (another start can win the port): kept for its owner to stop.
            if (child.exitCode === null) {
                fs.writeFileSync(HERMES_PID, child.pid + ' ' + hermesOwner());
                if (!process.env.FH_SERVER_PORT) process.on('exit', () => killHermes(hermesOwner()));
            }
            return;
        }
        if (child.exitCode !== null) {
            const said = lastLine();
            throw new Error(/bind/i.test(said) ? busy : 'Hermes\'s proxy stopped: ' + (said || 'exit ' + child.exitCode).slice(0, 160));
        }
        await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error('Hermes\'s proxy did not start' + (lastLine() ? ': ' + lastLine().slice(0, 160) : '.'));
}

function findGrok() {
    if (process.env.GROK_BIN) return process.env.GROK_BIN;
    const name = process.platform === 'win32' ? 'grok.exe' : 'grok';
    const dirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean).concat([path.join(os.homedir(), '.grok', 'bin')]);
    for (const dir of dirs) if (fs.existsSync(path.join(dir, name))) return path.join(dir, name);
    return '';
}
// Logged in, or given a key it reads itself.
function grokReady() {
    const home = process.env.GROK_HOME || path.join(os.homedir(), '.grok');
    return !!findGrok() && (fs.existsSync(path.join(home, 'auth.json')) || !!process.env.XAI_API_KEY);
}

// Grok Build kept running as one conversation over its agent protocol (ACP,
// JSON-RPC on stdin/stdout). It is a coding agent: here it gets no tools, an
// empty folder, our prompt in place of its own, and none of the user's memory,
// rules or Claude/Cursor setup. Tool requests it makes anyway are declined.
function grokCli(o) {
    const bin = findGrok();
    if (!bin) throw new Error('Grok Build was not found. Install it and log in, set GROK_BIN, or pick another --brain.');
    const dir = path.join(__dirname, '..', 'data', 'partners', 'grok');
    fs.mkdirSync(dir, { recursive: true });
    // One file a partner: two partners on one PC each have their own character.
    const profile = path.join(dir, 'partner-' + process.pid + '-' + (++grokProfiles) + '.md');
    // Grok Build runs tools without asking when its owner set always-approve, and
    // ignores deny rules in a folder it does not trust. What holds (tried 10/23):
    // a profile allowing one harmless tool, and a hook that blocks every call.
    fs.writeFileSync(profile, ['---', 'name: fh-partner', 'description: Fear & Hunger co-op partner', 'tools: ask_user_question',
        'hooks:', '  PreToolUse:', '    - matcher: "*"', '      hooks:', '        - type: command', '          command: exit 2',
        'mcpInheritance: none', '---', o.system, ''].join('\n'));
    const env = Object.assign({}, process.env, { GROK_MEMORY: '0', GROK_SUBAGENTS: '0', GROK_DISABLE_AUTOUPDATER: '1', GROK_MANAGED_MCPS_ENABLED: '0' });
    for (const from of ['CLAUDE', 'CURSOR']) for (const what of ['AGENTS', 'HOOKS', 'MCPS', 'RULES', 'SKILLS']) env['GROK_' + from + '_' + what + '_ENABLED'] = '0';
    let proc = null, session = null, buf = '', ids = 0, text = '', lastError = '';
    const calls = new Map(); // id -> { resolve, reject }
    function rpc(method, params) {
        const id = ++ids;
        proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
        return new Promise((resolve, reject) => calls.set(id, { resolve, reject }));
    }
    function stop() {
        const old = proc, was = lent;
        proc = null;
        session = null;
        for (const c of calls.values()) c.reject(new Error('Grok Build stopped'));
        calls.clear();
        if (old) { try { old.kill(); } catch (e) { /* gone */ } }
    }
    function start() {
        const args = ['agent'].concat(o.model ? ['--model', o.model] : [], ['--reasoning-effort', o.effort || 'low', '--agent-profile', profile, 'stdio']);
        proc = spawn(bin, args, { cwd: dir, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
        buf = '';
        const me = proc;
        proc.stdin.on('error', function () { /* it died mid-write; 'exit' says so */ });
        proc.stdout.on('data', function (d) {
            if (proc !== me) return; // a process given up on: its late words answer nothing
            buf += d;
            let i;
            while ((i = buf.indexOf('\n')) >= 0) {
                const line = buf.slice(0, i);
                buf = buf.slice(i + 1);
                let m;
                try { m = JSON.parse(line); } catch (e) { continue; }
                if (m.method) {
                    const u = m.params && m.params.update;
                    if (u && u.sessionUpdate === 'agent_message_chunk' && u.content && u.content.type === 'text') text += u.content.text;
                    // It asks before using a tool: the answer is always no. Nothing else it asks of us is offered.
                    if (m.id != null) proc.stdin.write(JSON.stringify(m.method === 'session/request_permission' ? { jsonrpc: '2.0', id: m.id, result: { outcome: { outcome: 'cancelled' } } }
                        : { jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'not offered' } }) + '\n');
                    continue;
                }
                const c = calls.get(m.id);
                if (!c) continue;
                calls.delete(m.id);
                if (m.error) c.reject(new Error(String((m.error.data && m.error.data.message) || m.error.message || 'error').slice(0, 200)));
                else c.resolve(m.result || {});
            }
        });
        proc.stderr.on('data', function (d) {
            // Its log goes here; a failed model call is the line worth passing on.
            for (const l of String(d).split('\n')) {
                const said = /ERROR.*?(?:error_message=|message":\s*")([^"\n]+)/.exec(l);
                if (said) lastError = said[1].slice(0, 160);
            }
        });
        proc.on('exit', function (code) {
            if (proc !== me) return;
            o.log('Grok Build stopped (' + code + '); it will be started again on the next question');
            stop();
        });
        proc.on('error', function (e) { o.log('Grok Build could not start: ' + e.message); if (proc === me) stop(); });
        session = rpc('initialize', { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } })
            .then(() => rpc('session/new', { cwd: dir, mcpServers: [], _meta: { systemPromptOverride: o.system } }))
            .then((r) => r.sessionId);
        // Not logged in, out of credit: the question waiting says why, and the next one starts afresh.
        session.catch(() => { if (proc === me) stop(); });
    }
    return {
        name: 'Grok Build (' + (o.model || 'its default model') + ')',
        async send(question) {
            if (!proc) start();
            let timer;
            const late = new Promise((resolve, reject) => {
                // A hung answer (or a start that waits on a sign-in nobody sees)
                // would hold every later question: past the limit the process goes
                // and a fresh one starts, without the run so far.
                timer = setTimeout(() => { reject(new Error('no answer in ' + LIMIT / 1000 + ' s')); stop(); }, LIMIT);
            });
            try {
                const sessionId = await Promise.race([session, late]);
                text = '';
                lastError = '';
                await Promise.race([rpc('session/prompt', { sessionId, prompt: [{ type: 'text', text: question }] }), late]);
            } finally { clearTimeout(timer); }
            if (!text.trim() && lastError) throw new Error(lastError);
            return text;
        },
        close() {
            if (proc) { try { proc.stdin.end(); } catch (e) { /* gone */ } stop(); }
            try { fs.unlinkSync(profile); } catch (e) { /* gone */ }
        },
    };
}
let grokProfiles = 0;

// Codex: on PATH, or where the ChatGPT/Codex app for Windows keeps it.
function findCodex() {
    if (process.env.CODEX_BIN) return process.env.CODEX_BIN;
    const name = process.platform === 'win32' ? 'codex.exe' : 'codex';
    for (const dir of String(process.env.PATH || '').split(path.delimiter).filter(Boolean)) if (fs.existsSync(path.join(dir, name))) return path.join(dir, name);
    const app = path.join(process.env.LOCALAPPDATA || '', 'OpenAI', 'Codex', 'bin');
    let best = '', when = 0;
    try {
        for (const d of fs.readdirSync(app)) {
            const p = path.join(app, d, name);
            try { const t = fs.statSync(p).mtimeMs; if (t > when) { best = p; when = t; } } catch (e) { /* not this one */ }
        }
    } catch (e) { /* no app */ }
    return best;
}
const CODEX_AUTH = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'auth.json');
// Signed in with a login file the partner can borrow (a login kept only in the
// system keyring cannot be).
function codexReady() { return !!findCodex() && fs.existsSync(CODEX_AUTH); }
// Features that give Codex tools or bring in the user's own setup: all off.
const CODEX_OFF = ['shell_tool', 'unified_exec', 'code_mode_host', 'code_mode', 'apps', 'plugins', 'remote_plugin', 'browser_use', 'browser_use_external',
    'browser_annotation_api', 'in_app_browser', 'computer_use', 'image_generation', 'view_image', 'memories', 'multi_agent', 'skill_search', 'goals',
    'sleep_tool', 'tool_suggest', 'hooks', 'workspace_dependencies', 'realtime_conversation', 'in_app_local_automation'];

// Folders left by partners whose process is gone (one that exited cannot
// delete its own); the old shared folder too.
let codexHomes = 0;
function sweepCodexHomes(dir) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch (e) { return; }
    for (const name of names) {
        const m = /^home(?:-(\d+)-\d+)?$/.exec(name);
        if (!m) continue;
        const pid = Number(m[1]);
        if (pid) {
            if (pid === process.pid) continue;
            try { process.kill(pid, 0); continue; } catch (e) { if (e.code === 'EPERM') continue; }
        }
        fs.rm(path.join(dir, name), { recursive: true, force: true }, () => {});
    }
}

// Codex (ChatGPT login) kept running as one conversation over its app server
// (JSON-RPC on stdin/stdout). It runs from a Codex folder of its own holding a
// copy of the login, so none of the user's AGENTS.md (Codex reads it into every
// conversation, with no switch to stop it), config, plugins, MCP servers or
// memories come along; tools are switched off, the sandbox is read-only and any
// approval it asks for is declined.
function codexCli(o) {
    const bin = findCodex();
    if (!bin) throw new Error('Codex was not found. Install the ChatGPT/Codex app or the Codex CLI and sign in, set CODEX_BIN, or pick another --brain.');
    const dir = path.join(__dirname, '..', 'data', 'partners', 'codex');
    const work = path.join(dir, 'work');
    fs.mkdirSync(work, { recursive: true });
    let proc = null, ready = null, buf = '', ids = 0, lent = null, wake = null;
    const calls = new Map();
    // What each turn said and how it ended, by its id: a late word from one
    // turn never answers the next.
    const turns = new Map(); // turnId -> { text, end: { failed, why } | null }
    function turnOf(id) { if (!turns.has(id)) turns.set(id, { text: '', end: null }); return turns.get(id); }
    function rpc(method, params) {
        const id = ++ids;
        proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
        return new Promise((resolve, reject) => calls.set(id, { resolve, reject }));
    }
    // Each start lends the user's login to a Codex folder of its own (two
    // partners, or a check at F8, never share one). A token it refreshes goes
    // back to the user's file within seconds, as the user's own Codex would have
    // written it, unless the user's file changed meanwhile (a re-login there
    // wins); when it stops, the copy and the folder go.
    function sync(l) {
        try {
            const now = fs.readFileSync(l.copy, 'utf8');
            if (now === l.mine || !JSON.parse(now).tokens) return;
            if (fs.readFileSync(CODEX_AUTH, 'utf8') === l.mine) fs.writeFileSync(CODEX_AUTH, now);
            l.mine = now;
        } catch (e) { /* busy, half written or gone: next time */ }
    }
    function lend() {
        sweepCodexHomes(dir);
        const home = path.join(dir, 'home-' + process.pid + '-' + (++codexHomes));
        fs.mkdirSync(home, { recursive: true });
        const l = { home, copy: path.join(home, 'auth.json'), mine: fs.readFileSync(CODEX_AUTH, 'utf8') };
        fs.writeFileSync(l.copy, l.mine);
        l.timer = setInterval(() => sync(l), 2000);
        l.timer.unref();
        return l;
    }
    // At once on stop (the partner's process may be exiting this moment), and
    // again once its Codex is gone.
    function giveBack(l) {
        clearInterval(l.timer);
        sync(l);
        try { fs.unlinkSync(l.copy); } catch (e) { /* gone, or still held until it exits */ }
    }
    function stop() {
        const old = proc, l = lent;
        proc = null;
        ready = null;
        lent = null;
        for (const c of calls.values()) c.reject(new Error('Codex stopped'));
        calls.clear();
        if (wake) wake();
        if (old) {
            // Its whole tree, so nothing holds its files once it is gone.
            try { if (process.platform === 'win32') spawn('taskkill', ['/PID', String(old.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); else old.kill(); } catch (e) { /* gone */ }
            if (l) old.once('exit', () => { giveBack(l); fs.rm(l.home, { recursive: true, force: true }, () => {}); });
        }
        if (l) giveBack(l);
    }
    // The light models answer in a second or two; the default is often a heavy one.
    async function models() {
        if (o.model) return [o.model];
        const r = await rpc('model/list', {});
        const ids = ((r && (r.data || r.models)) || []).map((m) => m.id || m.model).filter(Boolean);
        const light = ids.filter((m) => /luna|mini|fast/.test(m)).sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
        return ids.length ? light.concat(ids.filter((m) => !light.includes(m))) : [null];
    }
    // The first model the account takes (a ChatGPT login refuses some).
    async function thread() {
        let why = null;
        for (const model of await models()) {
            try { return (await rpc('thread/start', { model, cwd: work, baseInstructions: o.system, approvalPolicy: 'untrusted', sandbox: 'read-only', ephemeral: true })).thread.id; } catch (e) { why = e; }
        }
        throw why || new Error('no model to start with');
    }
    function start() {
        lent = lend();
        const args = ['app-server'].concat(...CODEX_OFF.map((f) => ['--disable', f]), ['-c', 'mcp_servers={}', '-c', 'web_search="disabled"']);
        proc = spawn(bin, args, { cwd: work, env: Object.assign({}, process.env, { CODEX_HOME: lent.home }), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
        buf = '';
        turns.clear();
        const me = proc;
        proc.stdin.on('error', function () { /* it died mid-write; 'exit' says so */ });
        proc.stdout.on('data', function (d) {
            if (proc !== me) return;
            buf += d;
            let i;
            while ((i = buf.indexOf('\n')) >= 0) {
                const line = buf.slice(0, i);
                buf = buf.slice(i + 1);
                let m;
                try { m = JSON.parse(line); } catch (e) { continue; }
                if (m.method) {
                    const q = m.params || {};
                    if (m.method === 'item/agentMessage/delta' && q.turnId) turnOf(q.turnId).text += q.delta || '';
                    else if (m.method === 'turn/completed' && q.turn && q.turn.id) {
                        const failed = q.turn.status === 'failed';
                        turnOf(q.turn.id).end = { failed, why: failed ? String((q.turn.error && q.turn.error.message) || 'the turn failed') : '' };
                        if (wake) wake();
                    } else if (m.method === 'error' && q.turnId && q.willRetry !== true) {
                        turnOf(q.turnId).end = { failed: true, why: String((q.error && q.error.message) || 'error') };
                        if (wake) wake();
                    }
                    // Anything it asks of us (an approval above all) is declined.
                    if (m.id != null) proc.stdin.write(JSON.stringify(/Approval$/.test(m.method) ? { jsonrpc: '2.0', id: m.id, result: { decision: 'decline' } }
                        : { jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'not offered' } }) + '\n');
                    continue;
                }
                const c = calls.get(m.id);
                if (!c) continue;
                calls.delete(m.id);
                if (m.error) c.reject(new Error(String(m.error.message || 'error').slice(0, 200)));
                else c.resolve(m.result || {});
            }
        });
        proc.stderr.on('data', function () { /* its log; failures come back as turn errors */ });
        proc.on('exit', function (code) {
            if (proc !== me) return;
            o.log('Codex stopped (' + code + '); it will be started again on the next question');
            stop();
        });
        proc.on('error', function (e) { o.log('Codex could not start: ' + e.message); if (proc === me) stop(); });
        ready = rpc('initialize', { clientInfo: { name: 'fh-coop', version: '1' }, capabilities: {} })
            .then(() => { proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'initialized' }) + '\n'); return thread(); });
        ready.catch(() => { if (proc === me) stop(); });
    }
    return {
        name: 'Codex (' + (o.model || 'a light model') + ')',
        async send(question) {
            if (!proc) start();
            const me = proc;
            let timer;
            const late = new Promise((resolve, reject) => {
                timer = setTimeout(() => { reject(new Error('no answer in ' + LIMIT / 1000 + ' s')); stop(); }, LIMIT);
            });
            try {
                const threadId = await Promise.race([ready, late]);
                const r = await Promise.race([rpc('turn/start', { threadId, input: [{ type: 'text', text: question }], effort: o.effort || 'low' }), late]);
                const id = r.turn && r.turn.id;
                if (!id) throw new Error('Codex started no turn');
                for (;;) {
                    const t = turnOf(id);
                    if (t.end) {
                        turns.delete(id);
                        if (t.end.failed) throw new Error(t.end.why.slice(0, 200));
                        return t.text;
                    }
                    if (proc !== me) throw new Error('Codex stopped');
                    await Promise.race([new Promise((res) => { wake = res; }), late]);
                }
            } finally { clearTimeout(timer); }
        },
        close() { stop(); },
    };
}

//--- which mind, when nobody said ---------------------------------------------

// Explicit choice first (settings.json or --brain); then the one picked at F8;
// then Claude Code on this PC; then an Anthropic key; then a key for one of the
// other services in the environment; then an address for any OpenAI-style
// service; then Grok Build logged in; then a model running on this PC; else none.
async function detect(o) {
    const given = Object.assign({}, o);
    const saved = savedMind();
    const named = !!given.brain;
    if (!given.brain && saved.brain) Object.assign(given, { brain: saved.brain, model: saved.model || '', url: saved.url || '' });
    if (!given.brain) {
        const key = String(given.key || '');
        if (findClaude()) given.brain = 'claude';
        else if (/^sk-ant-/.test(key) || saved.keys.anthropic || process.env.ANTHROPIC_API_KEY) given.brain = 'anthropic';
        else if (Object.keys(SERVICES).some((s) => envKey(s) && (given.brain = s))) { /* found */ }
        else if (given.url && given.model) given.brain = 'openai';
        else if (codexReady()) given.brain = 'codex-cli';
        else if (grokReady()) given.brain = 'grok-cli';
        else if (await reachable('ollama')) given.brain = 'ollama';
        else if (await reachable('lmstudio')) given.brain = 'lmstudio';
        else if (await reachable('hermes')) given.brain = 'hermes';
        else given.brain = 'none';
    }
    // A key in settings.json belongs to the brain named beside it (or is an
    // Anthropic key): it is never sent to a service picked some other way.
    if (!named && given.key && !(given.brain === 'anthropic' && /^sk-ant-/.test(given.key))) given.key = '';
    // "sonnet" and the like name Claude models; anywhere else they mean nothing.
    if (MODEL_IDS[given.model] && !/^(claude|anthropic)$/.test(given.brain)) given.model = '';
    if (given.brain === 'anthropic') given.model = MODEL_IDS[given.model] || given.model || '';
    if (!given.key) given.key = keyFor(given, saved);
    if (SERVICES[given.brain] && !given.model) {
        try { given.model = (await listModels(given))[0] || ''; } catch (e) { /* createBrain says a model is needed */ }
    }
    return given;
}

// What was picked at F8, with the keys pasted there, lives here, outside
// settings.json (which is shared and tracked), so a key cannot travel with the
// folder or a commit by accident. data/partner-key.txt is the older home of an
// Anthropic key.
// FH_MIND_FILE: somewhere else (the tests).
const MIND_FILE = process.env.FH_MIND_FILE || path.join(__dirname, '..', 'data', 'partner-mind.json');
const KEY_FILE = process.env.FH_MIND_FILE ? MIND_FILE + '.key' : path.join(__dirname, '..', 'data', 'partner-key.txt');
function savedMind() {
    let m = {};
    try { m = JSON.parse(fs.readFileSync(MIND_FILE, 'utf8')); } catch (e) { /* none yet */ }
    m.keys = Object.assign({}, m.keys);
    if (!m.keys.anthropic) {
        try { m.keys.anthropic = fs.readFileSync(KEY_FILE, 'utf8').trim(); } catch (e) { /* none */ }
    }
    return m;
}
// Remembers a pick: { brain, model, url, key }. A key left out keeps the one saved.
function saveMind(pick) {
    const m = savedMind();
    if (pick.key) m.keys[keySlot(pick)] = pick.key;
    const keys = m.keys;
    fs.mkdirSync(path.dirname(MIND_FILE), { recursive: true });
    fs.writeFileSync(MIND_FILE, JSON.stringify({ brain: pick.brain, model: pick.model || '', url: pick.url || '', keys }, null, 1) + '\n');
}

// A key for some other address is not the OpenAI key.
function keySlot(pick) { return byHand(pick) ? 'openai-url' : pick.brain; }

// Asks only; Hermes's proxy is not started just to look.
async function reachable(brain) {
    try { return (await listModels({ brain, start: false })).length > 0; } catch (e) { return false; }
}

// Every way a partner could think on this PC, for the F8 panel. Keys are never
// sent: only whether one is there and how it ends.
async function minds() {
    const saved = savedMind();
    const now = process.env.FH_MIND ? { brain: process.env.FH_MIND } : await detect({}).catch(() => ({ brain: 'none' })); // FH_MIND: the tests
    const keyOf = (b) => keyFor({ brain: b }, saved) || (b === 'anthropic' ? process.env.ANTHROPIC_API_KEY || '' : '');
    const tail = (k) => (k ? '...' + k.slice(-4) : '');
    const list = [
        { id: 'claude', label: 'Claude Code', found: !!findClaude(), note: 'Your Claude login on this PC. About 1-3 s a turn.' },
        { id: 'codex-cli', label: 'Codex', found: codexReady(), note: 'Your ChatGPT login on this PC (the ChatGPT/Codex app or Codex CLI). About 1-3 s a turn. Counts against your ChatGPT plan.' },
        { id: 'grok-cli', label: 'Grok Build', found: grokReady(), note: 'Your grok.com login on this PC. Slow: about 5 s to answer, 10-25 s a fight turn, so it fights by the rules of thumb and keeps Grok for talking.' },
        { id: 'anthropic', label: 'Anthropic API', key: tail(keyOf('anthropic')), needsKey: true, note: 'Paid by use. Get a key at console.anthropic.com.' },
    ];
    for (const [id, svc] of Object.entries(SERVICES)) {
        list.push(svc.local
            ? (id === 'hermes' ? { id, label: svc.label, found: !!findHermes(), note: 'Your Hermes sign-in (SuperGrok or Nous Portal) through the Hermes proxy, started for you. About 1 s a turn. Counts against that plan.' }
                : { id, label: svc.label, found: await reachable(id), note: 'Free, on this PC. Start it with a model loaded.' })
            : { id, label: svc.label, key: tail(keyOf(id)), needsKey: true, note: 'Paid by use. Get a key at ' + svc.site + '.' });
    }
    list.push({ id: 'openai-url', label: 'Other (OpenAI-style)', needsKey: true, needsUrl: true, key: tail(saved.keys['openai-url']), url: saved.url || '', note: 'Any service that speaks the OpenAI chat API.' });
    list.push({ id: 'none', label: 'No model', found: true, note: 'Free. Follows, fights, takes orders in plain words; no voice.' });
    return { current: now.brain === 'openai' && now.url ? 'openai-url' : now.brain, model: now.model || '', list };
}

// Whether a pick works, before it is saved: '' when it does, else why not.
// API services are asked one short question with the chosen model, so a bad
// key, a wrong address and a model the account cannot use all show here.
async function checkMind(pick) {
    const brain = pick.brain;
    if (brain === 'none') return '';
    if (brain === 'claude') return findClaude() ? '' : 'Claude Code was not found on this PC.';
    if (brain === 'codex-cli') {
        if (!codexReady()) return findCodex() ? 'Codex is installed but not signed in with ChatGPT: open it once and sign in.' : 'Codex was not found on this PC.';
        return askOnce(codexCli, pick);
    }
    if (brain === 'grok-cli') {
        if (!grokReady()) return findGrok() ? 'Grok Build is installed but not logged in: run grok once and log in.' : 'Grok Build was not found on this PC.';
        return askOnce(grokCli, pick);
    }
    if (brain === 'anthropic') return checkAnthropicKey(pick.key || savedMind().keys.anthropic || process.env.ANTHROPIC_API_KEY || '');
    if (!SERVICES[brain] && brain !== 'openai') return 'Unknown choice.';
    try {
        if (!pick.model) pick.model = (await listModels(pick))[0] || '';
        if (!pick.model) return 'Pick a model.';
        const api = openaiApi(Object.assign({ log() {}, system: 'Reply with the JSON object {"ok":true} and nothing else.' }, pick, { key: keyFor(pick) }));
        await api.send('Are you there?');
        return '';
    } catch (e) {
        const why = String(e && e.message || e);
        if (/HTTP 40[13]/.test(why)) return 'That key was refused.';
        if (/HTTP 404/.test(why)) return 'Not found: check the address and the model name.';
        if (/fetch failed|ECONNREFUSED/.test(why)) return 'Nothing answered there' + (SERVICES[brain] && SERVICES[brain].local ? ': is ' + SERVICES[brain].label + ' running?' : '.');
        return /^HTTP/.test(why) ? 'It did not answer: ' + why.slice(0, 140) : why.slice(0, 160);
    }
}

// One short question through a program on this PC (a login can be stale, a
// plan out of credit): '' when it answers.
async function askOnce(make, pick) {
    let p;
    try {
        p = make(Object.assign({ log() {}, system: 'Reply with the JSON object {"ok":true} and nothing else.' }, pick));
        const said = await p.send('Are you there?');
        return said.trim() ? '' : 'It answered with nothing.';
    } catch (e) {
        return 'It did not answer: ' + String(e && e.message || e).slice(0, 140);
    } finally { if (p) p.close(); }
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
    o.system = o.system || systemPrompt(o); // a system of its own: test/locked.js
    let provider = null;
    const kind = o.brain || (findClaude() ? 'claude' : 'none');
    if (kind === 'claude') provider = claudeCli(o);
    else if (kind === 'grok-cli') provider = grokCli(o);
    else if (kind === 'codex-cli') provider = codexCli(o);
    else if (kind === 'anthropic') provider = anthropicApi(o);
    else if (kind === 'openai' || SERVICES[kind]) provider = openaiApi(o);
    else if (kind !== 'none') throw new Error('unknown --brain ' + kind + ' (claude, codex-cli, grok-cli, anthropic, ' + Object.keys(SERVICES).join(', ') + ', openai, none)');

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

module.exports = { createBrain, parseReply, tidy, findClaude, detect, minds, listModels, checkMind, savedMind, saveMind, keyFor, ownHermes, SERVICES, personaBody, systemPrompt };
