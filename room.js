// One co-op session. The server is a relay plus the keeper of what must
// outlive a browser tab: the shared world state of the current run.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LAG = Number(process.env.FH_LAG || 0);
const HOST_WAIT = Number(process.env.FH_HOST_WAIT) || 120000; // how long someone in first waits for the host to start or continue
const RATE = Number(process.env.FH_RATE || 0);
const JITTER = Number(process.env.FH_JITTER || 0);
const METER_LOG_MS = Number(process.env.FH_METER_LOG_MS) || 60000; // how often a player's meter goes in the log
const NOTES_PER_MIN = 120; // a player's notes kept in the host's log, at most, each minute
let ONCE = [];
try { ONCE = JSON.parse(fs.readFileSync(path.join(__dirname, 'client', 'census.json'), 'utf8')).once || []; } catch (e) { /* no census yet */ }

class Room {
    constructor(saveDir) {
        this.saveDir = saveDir;
        this.peers = new Map(); // id -> peer
        this.nextId = 1;
        this.freedAt = new Map(); // player id -> when its connection closed
        this.runId = '';
        this.world = { sw: {}, va: {}, ss: {} };
        this.balance = true; // host's "Balance changes", for the whole run; on unless they turn it off
        this.founded = false; // a run is in progress with at least one player in it
        this.entered = new Set(); // names that have been in the current run since it was founded
        this.baseStamp = 0; // the save the run was carried on from, if it was
        this.baseBy = '';
        this.owed = new Map(); // name -> fight results waiting for a player who dropped out, oldest first
        this.chatSeen = new Map(); // ids of the last chat lines passed on, oldest first
        this.mapOwners = new Map(); // mapId -> peer id simulating that map's events
        this.dirty = false;
        this.relayOnly = process.env.FH_RELAY !== '0'; // private hosting (the default): no direct browser-to-browser video
        setInterval(() => this.persist(), 5000).unref();
        // A machine that went to sleep or lost its network never says
        // goodbye; one that misses a ping is dropped so the rest move on.
        setInterval(() => {
            for (const peer of this.peers.values()) {
                if (peer.ws.isAlive === false) { peer.ws.terminate(); this.drop(peer, 'no answer to a ping'); continue; }
                peer.ws.isAlive = false;
                try { peer.ws.ping(); } catch (e) { /* closing */ }
            }
        }, 15000).unref();
    }

    runDir(runId) {
        return path.join(this.saveDir, 'runs', String(runId).replace(/[^\w-]/g, ''));
    }

    persist() {
        if (!this.dirty || !this.runId) return;
        this.dirty = false;
        const dir = this.runDir(this.runId);
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, 'world.json');
        fs.writeFileSync(file + '.tmp', JSON.stringify(this.world));
        fs.renameSync(file + '.tmp', file);
    }

    readWorld(runId, stamp) {
        const dir = this.runDir(runId);
        // A save from a bed reads that bed's world only: the live world.json
        // may be from a later night, or from when this PC last hosted it.
        for (const name of stamp ? [`world@${Number(stamp)}.json`] : ['world.json']) {
            try { return JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); } catch (e) { /* try next */ }
        }
        return null;
    }

    // host: the connection is the host's own browser (this PC, not the tunnel).
    accept(ws, host) {
        const id = this.freshId();
        if (!id) { console.log('turned away a connection: no free player number'); ws.close(1013, 'full'); return; }
        const peer = { ws, id, name: 'Player ' + id, mapId: 0, live: false, canOwn: false, host: !!host };
        this.peers.set(id, peer);
        console.log('player ' + id + ' connected' + (host ? ' (this PC)' : ''));
        this.send(peer, { t: 'hello', id, peers: this.roster(), relayOnly: this.relayOnly, balance: this.balance });
        this.broadcast({ t: 'join', id, name: peer.name, host: peer.host }, id);
        ws.on('message', (raw, isBinary) => {
            if (isBinary) { this.onBinary(peer, raw); return; }
            let msg;
            try { msg = JSON.parse(raw); } catch (e) { return; }
            if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return;
            try { this.onMessage(peer, msg); } catch (e) { console.error('bad message from player ' + peer.id, e.message); }
        });
        ws.isAlive = true;
        ws.on('pong', () => { ws.isAlive = true; });
        ws.on('close', (code) => this.drop(peer, 'closed ' + code));
        ws.on('error', (e) => this.drop(peer, 'error ' + (e && e.message)));
    }

    // Ids travel in one byte (1-250). A free one not used for ten minutes is
    // preferred; failing that, the one freed longest ago.
    freshId() {
        let id = 0, oldest = Infinity;
        for (let i = 0; i < 250; i++) {
            if (this.nextId > 250) this.nextId = 1;
            const n = this.nextId++;
            if (this.peers.has(n)) continue;
            const freed = this.freedAt.get(n) || 0;
            if (Date.now() - freed > 600000) return n;
            if (freed < oldest) { oldest = freed; id = n; }
        }
        return id;
    }

    // Whether the tab holding this token is the player of this name, here now.
    ownsName(name, token) {
        const want = String(name || '').trim().toLowerCase();
        if (!token || !want) return false;
        for (const p of this.peers.values()) if (p.named && p.token === String(token) && p.name.toLowerCase() === want) return true;
        return false;
    }

    // The person hosting (their own browser on this PC), not an AI partner run from here.
    hostPerson() {
        return [...this.peers.values()].find((p) => p.host && p.named && !p.deadWait && !this.isBot(p)) || null;
    }

    // An AI partner: one this server started, or any that says so itself.
    isBot(peer) {
        if (peer.last && peer.last.bot) return true;
        return !!(this.partners && peer.named && this.partners.allNames().some((n) => n.toLowerCase() === peer.name.toLowerCase()));
    }

    // The run being played, for someone at the title deciding what to load.
    runNow() {
        return this.founded && this.baseStamp ? { runId: this.runId, stamp: this.baseStamp, by: this.baseBy } : null;
    }

    // Which save a run was last carried on from is kept beside its world, so
    // a dropped line or a restarted server does not forget it.
    readBase(runId) {
        try { return JSON.parse(fs.readFileSync(path.join(this.runDir(runId), 'base.json'), 'utf8')); } catch (e) { return null; }
    }

    writeBase() {
        try {
            fs.mkdirSync(this.runDir(this.runId), { recursive: true });
            fs.writeFileSync(path.join(this.runDir(this.runId), 'base.json'), JSON.stringify({ stamp: this.baseStamp, by: this.baseBy }));
        } catch (e) { /* the next save writes it */ }
    }

    // What someone at the title is told about the run being played: nothing,
    // if they have already been in it (their saves are from its past).
    runFor(peer) {
        return peer.named && this.entered.has(peer.name.toLowerCase()) ? null : this.runNow();
    }

    // The last time a run was saved, by anyone.
    latestStamp(runId) {
        let latest = 0;
        try {
            for (const file of fs.readdirSync(this.runDir(runId))) {
                const m = /^world@(\d+)\.json$/.exec(file);
                if (m) latest = Math.max(latest, Number(m[1]));
            }
        } catch (e) { /* never saved */ }
        return latest;
    }

    roster() {
        return [...this.peers.values()].map((p) => ({ id: p.id, name: p.name, mapId: p.mapId, last: p.last || null, host: p.host }));
    }

    // Everything leaves through here. FH_LAG (ms) holds each message back by
    // that long, give or take a third, in order: a slow link for the tests.
    // FH_RATE (bytes a second) narrows it: each message also waits for the ones
    // ahead of it, while the socket's own buffer stays empty, as behind a tunnel.
    // FH_JITTER (ms) adds up to that much more to each message, still in order:
    // a line that is now and then late, as on Wi-Fi.
    deliver(peer, data, binary) {
        const ws = peer.ws;
        if (!LAG && !RATE && !JITTER) { if (ws.readyState === 1) ws.send(data, { binary: !!binary }); return; }
        let start = Date.now();
        if (RATE) start = peer.wire = Math.max(peer.wire || 0, start) + data.length / RATE * 1000;
        const due = Math.max(start + LAG * (0.67 + Math.random() * 0.66) + Math.random() * JITTER, (peer.lastDue || 0) + 1);
        peer.lastDue = due;
        // One queue per player, let out in order: separate timers can fire out of
        // order, and a real line (one TCP stream) never reorders.
        const q = peer.lagQ || (peer.lagQ = []);
        q.push({ data, binary, due });
        if (q.length === 1) this.drainLag(peer);
    }

    drainLag(peer) {
        const q = peer.lagQ;
        while (q.length && q[0].due <= Date.now()) {
            const m = q.shift();
            if (peer.ws.readyState === 1) peer.ws.send(m.data, { binary: !!m.binary });
        }
        if (q.length) setTimeout(() => this.drainLag(peer), q[0].due - Date.now());
    }

    send(peer, msg) {
        this.deliver(peer, JSON.stringify(msg), false);
    }

    broadcast(msg, exceptId) {
        const raw = JSON.stringify(msg);
        for (const p of this.peers.values()) {
            if (p.id !== exceptId) this.deliver(p, raw, false);
        }
    }

    onBinary(peer, raw) {
        if (raw.length < 2) return;
        const target = this.peers.get(raw[1]);
        if (!target || target.ws.readyState !== 1) return;
        if (target.ws.bufferedAmount > 3000000) return; // receiver is behind; drop
        raw[1] = peer.id;
        this.deliver(target, raw, true);
    }

    // A pick from the partner panel, as tools/brain.js takes it. A key left
    // empty means the one kept for that service (tools/brain.js keyFor).
    mindPick(msg) {
        const custom = msg.brain === 'openai-url';
        return { brain: custom ? 'openai' : String(msg.brain || ''), model: String(msg.model || '').trim().slice(0, 120),
            url: custom ? String(msg.url || '').trim().slice(0, 300) : '', key: String(msg.key || '').trim() };
    }

    // Character switches already published (who plays the knight, and so on).
    takenInitials() {
        const s = new Set();
        for (const p of this.peers.values()) if (Array.isArray(p.ini)) for (const id of p.ini) s.add(id);
        return s;
    }

    parkFile(name) {
        return path.join(this.saveDir, 'parked', String(name).toLowerCase().replace(/[^a-z0-9 _'-]/g, '') + '.json');
    }

    markParked(name, droppedAs) {
        try {
            const file = this.parkFile(name);
            const parked = JSON.parse(fs.readFileSync(file, 'utf8'));
            parked.droppedAs = droppedAs;
            fs.writeFileSync(file, JSON.stringify(parked));
        } catch (e) { /* nothing parked */ }
    }

    deliverOwed(peer) {
        const key = peer.name.toLowerCase();
        const list = this.owed.get(key);
        if (!list) return;
        this.owed.delete(key);
        for (const owed of list) if (Date.now() - owed.at < 30 * 60 * 1000) this.send(peer, { t: 'owed', fight: owed.fight, actors: owed.actors, inv: owed.inv });
    }

    unpark(name) {
        // unlinkSync, not rmSync: Node 24's rmSync does nothing at all in a folder whose name is not plain ASCII (José, Иван).
        try { fs.unlinkSync(this.parkFile(name)); } catch (e) { /* nothing parked */ }
    }

    // Good for twenty minutes: long enough to restart a browser, too short to be a save.
    readParked(name) {
        try {
            const parked = JSON.parse(fs.readFileSync(this.parkFile(name), 'utf8'));
            if (Date.now() - parked.at > 20 * 60 * 1000) { this.unpark(name); return null; }
            return parked;
        } catch (e) { return null; }
    }

    drop(peer, why) {
        if (!this.peers.delete(peer.id)) return;
        // Who came and went, and why: a session can be read back from the log.
        console.log('player ' + peer.id + ' (' + peer.name + ') left: ' + (why || 'dropped'));
        this.freedAt.set(peer.id, Date.now());
        // Vanishing mid-fight or while dead does not get to undo either:
        // the parked state remembers it, and carrying on picks up from there.
        const st = peer.last && peer.last.st;
        if (peer.named && (st === 'battle' || st === 'dead')) this.markParked(peer.name, st === 'dead' ? 'dead' : (peer.last.br === 'g' ? 'guest' : 'owner'));
        this.leaveMap(peer);
        this.leaveWorld(peer);
        this.broadcast({ t: 'leave', id: peer.id });
    }

    leaveWorld(peer) {
        peer.live = false;
        peer.ini = null;
        if (![...this.peers.values()].some((p) => p.live)) {
            this.persist();
            if (this.founded) this.broadcast({ t: 'runover' });
            this.founded = false; // the next player in decides which run this is
        }
    }

    // One player simulates each map's wandering events and the rest follow.
    // Ownership goes to whoever is on the map with their map scene running.
    assignOwner(mapId) {
        const current = this.peers.get(this.mapOwners.get(mapId));
        if (current && current.mapId === mapId && current.canOwn) return;
        const heir = [...this.peers.values()].find((p) => p.mapId === mapId && p.canOwn);
        const id = heir ? heir.id : 0;
        if (this.mapOwners.get(mapId) === id) return;
        if (id) this.mapOwners.set(mapId, id); else this.mapOwners.delete(mapId);
        this.broadcast({ t: 'owner', mapId, id });
    }

    leaveMap(peer) {
        const mapId = peer.mapId;
        peer.mapId = 0;
        peer.canOwn = false;
        if (mapId) this.assignOwner(mapId);
    }

    onMessage(peer, msg) {
        msg.from = peer.id;
        switch (msg.t) {
        case 'name': {
            // Saves are filed under the name, so two players cannot share one.
            const name = String(msg.name || '').replace(/[^\w \-']/g, '').trim().slice(0, 16);
            if (!name) break;
            const token = String(msg.token || '').slice(0, 40);
            const clash = [...this.peers.values()].find((p) => p !== peer && p.named && p.name.toLowerCase() === name.toLowerCase());
            if (clash) {
                if (!token || clash.token !== token) { this.send(peer, { t: 'nametaken', name }); break; }
                // The same browser tab coming back before its old line was noticed dead.
                clash.ws.terminate();
                this.drop(clash, 'its own tab came back');
            }
            peer.name = name;
            peer.named = true;
            peer.token = token;
            this.broadcast({ t: 'name', id: peer.id, name: peer.name });
            this.send(peer, { t: 'nameok', name, run: this.runFor(peer), decides: peer === this.hostPerson() });
            break;
        }
        case 'map': { // { mapId, canOwn }
            const mapId = msg.mapId | 0;
            if (peer.mapId !== mapId) this.leaveMap(peer);
            peer.mapId = mapId;
            peer.canOwn = !!msg.canOwn;
            if (mapId) {
                this.assignOwner(mapId);
                this.send(peer, { t: 'owner', mapId, id: this.mapOwners.get(mapId) || 0 });
            }
            break;
        }
        case 'world?': {
            let founded = false;
            const who = peer.name.toLowerCase();
            const how = ['new', 'load', 'park', 'again'].indexOf(msg.how) >= 0 ? msg.how : 'new';
            const ini = Array.isArray(msg.ini) ? msg.ini.filter((n) => Number.isInteger(n)).slice(0, 8) : [];
            // One player per protagonist: the game keeps each character's
            // body and death in flags named after the character.
            const twin = [...this.peers.values()].find((p) => p !== peer && p.live && p.ini && p.ini.some((n) => ini.indexOf(n) >= 0));
            if (twin) { this.send(peer, { t: 'worldclash', name: twin.name }); break; }
            // Someone loading a save from another run does not get to pour
            // it into the one being played.
            if (this.founded && msg.runId && String(msg.runId) !== this.runId) {
                this.send(peer, { t: 'worldbusy', runId: this.runId });
                break;
            }
            // Nor may a save be loaded into a run its owner has already been
            // part of this session: that would be their body from the past.
            if (this.founded && how === 'load' && msg.runId && String(msg.runId) === this.runId && this.entered.has(who)) {
                this.send(peer, { t: 'worldstale', others: [...this.peers.values()].filter((p) => p.live && p !== peer).map((p) => p.name) });
                break;
            }
            // A run carried on from a save is carried on from one moment.
            // Whoever loads a different save of it is pointed at the right
            // one; someone who has none from that moment may still come in
            // as they last were, provided that was earlier.
            let behind = false;
            const stamp = Number(msg.stamp) || 0;
            if (this.founded && how === 'load' && msg.runId && this.baseStamp && stamp !== this.baseStamp) {
                const have = Array.isArray(msg.have) ? msg.have.map(Number) : [];
                const swap = have.indexOf(this.baseStamp) >= 0;
                if (swap || stamp > this.baseStamp) {
                    this.send(peer, { t: 'worldwhen', runId: this.runId, stamp: this.baseStamp, by: this.baseBy, swap });
                    break;
                }
                behind = true;
            }
            // Someone loading a save they were dead in does not decide the
            // moment either: they wait for a living player to carry the run on.
            // (A host waiting like that does not hold anyone else up.)
            if (!this.founded && how === 'load' && msg.dead) { peer.deadWait = true; this.send(peer, { t: 'worldwait' }); break; }
            // The host's game says which run this is (a new one, or the save they
            // continue): anyone else in first, an AI partner too, waits for them
            // instead of starting a run of their own that the host's then cannot
            // join. Not for ever: a host who has not started after two minutes is
            // not coming, and the one waiting goes on alone.
            const host = this.hostPerson();
            if (!this.founded && host && peer !== host && (!peer.host || this.isBot(peer))) {
                const now = Date.now();
                if (!peer.hostWaitSince || now - (peer.hostWaitLast || 0) > 15000) peer.hostWaitSince = now; // a fresh try starts a fresh wait
                peer.hostWaitLast = now;
                if (now - peer.hostWaitSince < HOST_WAIT) { this.send(peer, { t: 'worldhost', by: host.name }); break; }
            }
            let mode = 'join';
            let newer = 0;
            if (this.founded && how === 'again' && this.entered.has(who) && String(msg.runId || '') === this.runId) mode = 'again';
            if (!this.founded) {
                mode = 'found';
                this.entered = new Set();
                const saved = msg.runId ? this.readWorld(msg.runId, msg.stamp) : null;
                // A save of a known run carries that run on, even on a PC that
                // holds no copy of its world: the founder's save holds what
                // the world was then, and partners' saves of the run still fit.
                const carried = !!msg.runId && (!!saved || how === 'load');
                const kept = carried && how !== 'load' && how !== 'new' ? this.readBase(msg.runId) : null;
                this.baseStamp = carried && how === 'load' ? stamp : (kept && Number(kept.stamp)) || 0;
                this.baseBy = kept && kept.by ? String(kept.by) : peer.name;
                const latest = this.baseStamp ? this.latestStamp(msg.runId) : 0;
                if (latest > this.baseStamp) newer = latest;
                this.persist();
                this.runId = carried ? String(msg.runId) : crypto.randomBytes(6).toString('hex');
                this.world = saved || { sw: {}, va: {}, ss: {} };
                for (const k of ['sw', 'va', 'ss']) this.world[k] = this.world[k] || {};
                this.founded = true;
                this.dirty = true;
                founded = true;
                if (carried && how === 'load') this.writeBase();
            }
            peer.live = true;
            peer.ini = ini;
            peer.deadWait = false;
            peer.hostWaitSince = 0;
            this.entered.add(who);
            // The host's game says whether the balance changes are in this run.
            // Told to the one entering here, and to everyone already in if it moved.
            if (peer === this.hostPerson() && typeof msg.balance === 'boolean' && this.balance !== msg.balance) {
                this.balance = msg.balance;
                this.broadcast({ t: 'balance', on: this.balance }, peer.id);
            }
            this.send(peer, { t: 'world', runId: this.runId, world: this.world, founded, mode, stamp: this.baseStamp, by: this.baseBy, behind, newer, balance: this.balance });
            if (founded) for (const p of this.peers.values()) if (p !== peer) this.send(p, { t: 'run', run: this.runFor(p) });
            this.deliverOwed(peer);
            break;
        }
        case 'balance': { // the host turns Balance changes on or off; a joiner's word is dropped
            if (peer !== this.hostPerson() || typeof msg.on !== 'boolean' || this.balance === msg.on) break;
            this.balance = msg.on;
            this.broadcast({ t: 'balance', on: this.balance });
            break;
        }
        case 'p': // where a player is; kept so that someone joining later
            // learns it at once, even from a player whose tab is asleep
            peer.last = msg;
            this.broadcast(msg, peer.id);
            break;
        case 'partner': { // { toggle } F8, or { on }: call an AI partner in, or send one home
            const say = (text) => this.send(peer, { t: 'partnernote', text });
            if (!this.partners) { say('AI partners are not available on this server.'); break; }
            if (!peer.host) { say('Only the player hosting the game can call an AI partner.'); break; }
            // The server knows about partners still starting up, which the game cannot see yet.
            const on = msg.toggle ? this.partners.names().length === 0 : !!msg.on;
            if (!on) {
                const gone = this.partners.stop();
                say(gone ? gone + ' is going home.' : 'There is no AI partner here to send home.');
                break;
            }
            const partners = new Set(this.partners.allNames().map((n) => n.toLowerCase()));
            const taken = new Set();
            let people = 0;
            for (const p of this.peers.values()) if (p.named) { taken.add(p.name.toLowerCase()); if (!partners.has(p.name.toLowerCase())) people++; }
            if (people + this.partners.names().length >= 4) { say('There is no room for another partner: four characters at most.'); break; }
            const callIn = () => {
                const why = this.partners.start(taken, this.takenInitials());
                say(why || 'An AI partner is on the way. It joins once you are in the dungeon. Press Y to talk to it, F8 to send it home.');
            };
            // Nothing to think with: the host is asked first, unless they chose none themselves.
            const chosen = (require('./tools/find-game').SETTINGS.partner || {}).brain || require('./tools/brain').savedMind().brain;
            if (msg.anyway || chosen || this.partners.names().length) { callIn(); break; }
            if (this.partners.asking) break; // a second F8 while the first is still looking
            this.partners.asking = true;
            this.partners.mind().then((m) => {
                this.partners.asking = false;
                if (m.brain === 'none') this.send(peer, { t: 'partnersetup' }); else callIn();
            });
            break;
        }
        case 'partnerminds': // the host opened the partner panel: what could think here
            if (!this.partners || !peer.host) break;
            require('./tools/brain').minds().then((m) => this.send(peer, Object.assign({ t: 'partnerminds' }, m)), () => {});
            break;
        case 'partnermodels': { // the models a service offers, for the panel's list
            if (!this.partners || !peer.host) break;
            const brain = require('./tools/brain');
            const pick = this.mindPick(msg);
            brain.listModels(pick).then((models) => this.send(peer, { t: 'partnermodels', brain: msg.brain, models: models.slice(0, 200) }),
                (e) => this.send(peer, { t: 'partnermodels', brain: msg.brain, models: [], why: String(e && e.message || e).slice(0, 160) }));
            break;
        }
        case 'partnermind': { // the host picked how a partner thinks: checked, then kept on this PC
            if (!this.partners || !peer.host) break;
            const brain = require('./tools/brain');
            const pick = this.mindPick(msg);
            const bad = (text) => this.send(peer, { t: 'partnermindbad', text });
            if (pick.key && !/^[\x21-\x7e]{8,300}$/.test(pick.key)) { bad('That does not look like a key.'); break; }
            if (pick.brain === 'openai' && !/^https?:\/\/\S+$/.test(pick.url)) { bad('Give the service\'s address, starting http:// or https://.'); break; }
            if (this.partners.checking) break; // Save pressed twice
            this.partners.checking = true;
            brain.checkMind(pick).then((why) => {
                this.partners.checking = false;
                if (why) { bad(why); return; }
                brain.saveMind(pick);
                this.send(peer, { t: 'partnermindok' });
                const running = this.partners.names().length;
                const taken = new Set([...this.peers.values()].filter((p) => p.named).map((p) => p.name.toLowerCase()));
                this.send(peer, { t: 'partnernote', text: 'Saved. ' + (running ? 'Partners called in from now on think that way.' : (this.partners.start(taken, this.takenInitials()) || 'An AI partner is on the way.')) });
            }, (e) => { this.partners.checking = false; bad(String(e && e.message || e).slice(0, 160)); });
            break;
        }
        case 'leftworld':
            // Back to the title on purpose: nothing to carry on from.
            this.unpark(peer.name);
            this.leaveWorld(peer);
            break;
        case 'park': // a player's own state, parked against a dropped connection
            if (!peer.live || !peer.named || typeof msg.blob !== 'string' || msg.blob.length > 24 * 1024 * 1024) break;
            try {
                fs.mkdirSync(path.join(this.saveDir, 'parked'), { recursive: true });
                // Sync: a send-home closes the page as soon as this is answered, and an async write can lose the race.
                fs.writeFileSync(this.parkFile(peer.name), JSON.stringify({ at: Date.now(), runId: String(msg.runId || ''), blob: msg.blob }));
            } catch (e) { console.log('park failed for ' + peer.name + ': ' + (e && e.message)); break; }
            this.send(peer, { t: 'parkok', n: msg.n | 0 });
            break;
        case 'park?': {
            // Before the name is in, "nothing" would be a wrong answer; it asks again on nameok.
            if (!peer.named) break;
            const parked = this.readParked(peer.name);
            this.send(peer, { t: 'parked', has: !!parked, ageSec: parked ? Math.round((Date.now() - parked.at) / 1000) : 0 });
            break;
        }
        case 'park!': {
            const parked = peer.named ? this.readParked(peer.name) : null;
            this.send(peer, { t: 'parkdata', blob: parked ? parked.blob : null, droppedAs: parked ? parked.droppedAs || '' : '' });
            if (parked) this.unpark(peer.name); // once; it is not a save
            break;
        }
        case 'owed': { // a fight ended for a guest who is no longer there to be told
            const name = String(msg.name || '').toLowerCase();
            if (!name || !Array.isArray(msg.actors)) break;
            const list = this.owed.get(name) || [];
            list.push({ fight: String(msg.fight || ''), actors: msg.actors, inv: msg.inv, at: Date.now() });
            this.owed.set(name, list);
            const there = [...this.peers.values()].find((p) => p.live && p.name.toLowerCase() === name);
            if (there) this.deliverOwed(there);
            break;
        }
        case 'w': // world writes: [kind, key, value]
            if (!peer.live || !Array.isArray(msg.w)) break;
            msg.w = msg.w.filter(validWrite);
            {
                // Some dice are thrown once per world (which enemies stand on
                // a floor). The first throw stands; a later one is sent back.
                const fixed = [];
                msg.w = msg.w.filter(([kind, key]) => {
                    if (kind !== 'va' || ONCE.indexOf(key) < 0 || !(key in this.world.va)) return true;
                    fixed.push(['va', key, this.world.va[key]]);
                    return false;
                });
                if (fixed.length) this.send(peer, { t: 'w', w: fixed });
            }
            if (!msg.w.length) break;
            for (const [kind, key, value] of msg.w) this.world[kind][key] = value;
            this.dirty = true;
            for (const p of this.peers.values()) if (p.live && p.id !== peer.id) this.send(p, msg);
            break;
        case 'savepoint': { // freeze a copy of the world next to a save
            if (!this.runId || !peer.live) break;
            const dir = this.runDir(this.runId);
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, `world@${Number(msg.stamp)}.json`), JSON.stringify(this.world));
            this.persist();
            this.broadcast(msg, peer.id);
            // Each player from another PC keeps this copy too, so any of them
            // can host the run another night (server.js keepWorld).
            const copy = JSON.stringify({ t: 'worldcopy', runId: this.runId, stamp: Number(msg.stamp), world: this.world });
            for (const p of this.peers.values()) if (!p.host && p.named && p.ws.bufferedAmount < 4 * 1024 * 1024) this.deliver(p, copy, false);
            break;
        }
        case 'demote':
            fs.mkdirSync(this.saveDir, { recursive: true });
            fs.appendFileSync(path.join(this.saveDir, 'demoted.log'), `${new Date().toISOString()} ${msg.key}\n`);
            this.broadcast(msg, peer.id);
            break;
        case 'to': { // direct message to one peer
            // Private hosting: the browsers' handshake for a direct connection
            // never passes, so no player learns another's address. Watchers
            // keep the relayed stills. Enforced here, whatever page they run.
            if (this.relayOnly && /^rtc/.test(String(msg.k))) break;
            const target = this.peers.get(msg.to);
            if (target) this.send(target, msg);
            break;
        }
        case 'chat': {
            // A line said into a line that dropped is said again once the sender is back
            // (client/chat.js): each is passed on once, and the sender is told it arrived.
            const id = typeof msg.id === 'string' ? msg.id.slice(0, 24) : '';
            if (!id || !this.chatSeen.has(id)) this.broadcast(msg, peer.id);
            if (id) {
                this.chatSeen.set(id, true);
                if (this.chatSeen.size > 500) this.chatSeen.delete(this.chatSeen.keys().next().value);
                this.send(peer, { t: 'chatok', id });
            }
            break;
        }
        case 'relay': // the server's own word on private hosting, never a player's
            break;
        case 'rtt': // a page timing its line to the host: answered at once, to that page only
            this.send(peer, { t: 'rtt', at: msg.at });
            break;
        case 'stats': { // a player's own lag meter (every five seconds): a line a minute in the host's log
            const now = Date.now();
            if (msg.s && typeof msg.s === 'object' && now - (peer.statsAt || 0) >= METER_LOG_MS) {
                peer.statsAt = now;
                console.log('meter ' + (peer.name || 'player ' + peer.id) + ': ' + meterLine(msg.s));
            }
            this.broadcast(msg, peer.id); // and passed on as before: tools/stats.js listens for it
            break;
        }
        case 'notes': // a player's own notes (fights joined or skipped, script errors): kept in the host's log
            if (!Array.isArray(msg.lines)) break;
            // At most NOTES_PER_MIN lines a minute each: a page throwing in a loop must not fill the host's disk.
            if (Date.now() - (peer.notesAt || 0) >= 60000) { peer.notesAt = Date.now(); peer.notesN = 0; }
            for (const line of msg.lines.slice(0, 50)) {
                if (typeof line !== 'string') continue;
                const who = 'note ' + (peer.name || 'player ' + peer.id) + ': ';
                if (++peer.notesN === NOTES_PER_MIN + 1) console.log(who + '(more notes this minute left out)');
                if (peer.notesN > NOTES_PER_MIN) continue;
                console.log(who + line.slice(0, 300).replace(/[\r\n]+/g, ' '));
            }
            break;
        default: // everything else is relayed as-is
            this.broadcast(msg, peer.id);
        }
    }
}

// What a player's meter says, in one line: is it this machine, the line, or the fight picture.
function meterLine(s) {
    const n = (v) => (typeof v === 'number' ? v : '?');
    const parts = [n(s.stepsPerSec) + ' steps/s', 'screen ' + n(s.screenHz) + ' Hz', 'late ' + n(s.lateSteps), 'stalls ' + n(s.stalls)];
    // Which part is slow: the game's own steps or the drawing; and where, and how much memory.
    if (s.stepCostMs != null) parts.push('step ' + n(s.stepCostMs) + ' ms (worst ' + n(s.stepCostWorstMs) + ')');
    if (s.drawWorstMs != null) parts.push('draw worst ' + n(s.drawWorstMs) + ' ms');
    if (s.map) parts.push('map ' + n(s.map));
    if (s.heapMB != null) parts.push('heap ' + n(s.heapMB) + ' MB');
    if (s.lineMs != null) parts.push('line ' + n(s.lineMs) + ' ms (worst ' + n(s.lineWorstMs) + ')');
    if (s.keyToPictureMs != null) parts.push('key to picture ' + n(s.keyToPictureMs) + ' ms');
    if (s.watching) parts.push('watching ' + String(s.watching).slice(0, 20) + ' at ' + n(s.watchFps) + ' fps');
    if (s.streamingTo) parts.push('streaming to ' + n(s.streamingTo));
    if (s.hidden) parts.push('window hidden');
    // Software drawing (no GPU in that browser) runs the game at a fraction of 60.
    if (s.gpu) parts.push('gpu ' + String(s.gpu).slice(0, 48));
    return parts.join(', ');
}

// A world write is [kind, key, value]: a switch or variable id, or a self
// switch key like "12,34,A", with a plain value.
function validWrite(row) {
    if (!Array.isArray(row) || row.length !== 3) return false;
    const [kind, key, value] = row;
    if (kind !== 'sw' && kind !== 'va' && kind !== 'ss') return false;
    if (kind === 'ss' ? !/^\d+,\d+,[A-Z]$/.test(String(key)) : !(Number.isInteger(key) && key > 0 && key < 100000)) return false;
    return typeof value === 'number' || (kind === 'va' && typeof value === 'string' && value.length < 2000);
}

module.exports = { Room };
