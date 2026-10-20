// The four protagonists in their own words: lines they speak in the game as
// recruited companions, and the story of how each came to the dungeon. Read
// at startup from this PC's own copy of the game (nothing of the game's text
// ships with the mod), for the AI partner to speak in that voice.
const fs = require('fs');
const path = require('path');

const SPEAKER = { mercenary: 'Cahara', knight: "D'arce", priest: 'Enki', outlander: 'Ragnvaldr' };
const IDENTITY = { mercenary: 246, knight: 242, priest: 243, outlander: 244 }; // who-am-I switches in the intro
const INTRO_MAP = 73;
// Lines from the deep levels, the old city and the endings give the story
// away; only the upper dungeon and the companion talk are sampled.
const EARLY = /^Level \d/;

function lists(dataDir) {
    const out = [];
    const names = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'client', 'mapnames.json'), 'utf8'));
    for (const file of fs.readdirSync(dataDir)) {
        const m = /^Map(\d+)\.json$/.exec(file);
        if (!m || !EARLY.test(names[Number(m[1])] || '')) continue;
        const map = JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8'));
        for (const ev of map.events || []) if (ev) for (const page of ev.pages) out.push({ kind: 'map', list: page.list });
    }
    for (const ev of JSON.parse(fs.readFileSync(path.join(dataDir, 'CommonEvents.json'), 'utf8'))) {
        if (ev) out.push({ kind: /FEAR|Miasma/i.test(ev.name) ? 'fear' : 'talk', list: ev.list });
    }
    return out;
}

const clean = (s) => s.replace(/\\[A-Za-z]+\[\d+\]/g, '').replace(/\s+/g, ' ').trim();

// Every line the character says, by kind; "\N[1]" (the player's name) becomes "you".
function linesOf(character, dataDir) {
    const tag = new RegExp('\\\\c\\[\\d+\\]' + SPEAKER[character].replace(/'/g, "'") + '\\\\c\\[0\\]');
    const said = { talk: new Map(), fear: new Map() }; // keyed by the words alone, so near-repeats count once
    for (const { kind, list } of lists(dataDir)) {
        for (let i = 0; i < list.length; i++) {
            if (list[i].code !== 401 || !tag.test(list[i].parameters[0])) continue;
            const text = [];
            for (let j = i + 1; j < list.length && list[j].code === 401; j++) text.push(list[j].parameters[0]);
            const line = clean(text.join(' ').replace(/\\N\[1\]/g, 'you'));
            // Short grunts teach nothing; the tower gives the deep levels away; "party" lines are the game's recruiting.
            if (line.split(' ').length < 4 || /tower|party/i.test(line)) continue;
            // The fear scenes also hold the replies to being talked round; only the cracking lines are fear.
            const bucket = kind === 'fear' && /\.\.\./.test(line) ? said.fear : said.talk;
            bucket.set(line.toLowerCase().replace(/[^a-z ]/g, ''), line);
        }
    }
    return { talk: [...said.talk.values()], fear: [...said.fear.values()] };
}

// The intro the game tells for this character, choices shown as "[either: ... | ...]".
function introOf(character, dataDir) {
    const map = JSON.parse(fs.readFileSync(path.join(dataDir, `Map${String(INTRO_MAP).padStart(3, '0')}.json`), 'utf8'));
    for (const ev of map.events || []) {
        if (!ev) continue;
        for (const page of ev.pages) {
            const list = page.list;
            for (let i = 0; i < list.length; i++) {
                const c = list[i];
                if (c.code !== 111 || c.parameters[0] !== 0 || c.parameters[1] !== IDENTITY[character] || c.parameters[2] !== 0) continue;
                const text = [];
                for (let j = i + 1; j < list.length && list[j].indent > c.indent; j++) {
                    if (list[j].code === 401) text.push(clean(list[j].parameters[0]));
                    if (list[j].code === 102) text.push('[either: ' + list[j].parameters[0].join(' | ') + ']');
                }
                if (text.length > 4) return story(text.join(' '));
            }
        }
    }
    return '';
}

// The intro without what it hands out ("You learn Steal.", "You get 30 Silver
// coins.") and without a sentence two branches both tell.
function story(text) {
    const seen = new Set();
    return text.replace(/\s+/g, ' ').split(/(?<=[.!?\]])\s+/).filter((s) => {
        if (/^You (learn|get|also get) /.test(s) || seen.has(s)) return false;
        seen.add(s);
        return true;
    }).join(' ');
}

// A spread of lines across the whole set, so one place's talk does not dominate.
function spread(lines, n) {
    if (lines.length <= n) return lines.slice();
    const step = lines.length / n;
    return Array.from({ length: n }, (_, i) => lines[Math.floor(i * step)]);
}

// What the AI partner is told about the character it plays, or '' when the
// game's data cannot be read.
function voice(character, dataDir) {
    if (!SPEAKER[character] || !dataDir) return '';
    try {
        const name = SPEAKER[character];
        const { talk, fear } = linesOf(character, dataDir);
        const intro = introOf(character, dataDir);
        if (!talk.length && !intro) return '';
        const out = [`Your character is ${name}. Speak the way ${name} speaks in the game. These are some of ${name}'s own lines from it, so you hear the voice: the rhythm, the slang, the humour, what gets under the skin. Never repeat them or lean on their phrases; say new things in that voice, about what is happening now.`];
        out.push(spread(talk, 24).map((l) => '- ' + l).join('\n'));
        if (fear.length) out.push(`When ${name}'s mind is going (your Mind is low, or something horrifying just happened), the voice cracks like this:\n` + spread(fear, 8).map((l) => '- ' + l).join('\n'));
        if (intro) out.push(`How ${name} came to the dungeon, as the game tells it in the second person. The player chose at the [either: ...] points and you do not know which way; never claim a choice as fact. Draw on this past rarely and only when it fits: it is who you are, not a story to recite.\n` + intro);
        return out.join('\n\n');
    } catch (e) {
        return '';
    }
}

module.exports = { voice, linesOf, introOf, SPEAKER };

// node tools/voices.js mercenary   prints what the partner is told
if (require.main === module) {
    const { findGame } = require('./find-game');
    const game = findGame();
    console.log(voice(process.argv[2] || 'mercenary', game && path.join(game, 'data')) || '(nothing: the game data was not found)');
}
