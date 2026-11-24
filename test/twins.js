// Broken twins: each one takes a single fix back out of the mod, in the test's own copy of the
// code as it is served or loaded (never the files on disk), and runs the suite that proves the
// fix. That suite has to FAIL. A suite that still passes with its fix gone was proving nothing.
//   node test/twins.js            every twin (its suite once clean, then broken; six suites at a time,
//                                 one suite's twins one after another; FH_TEST_JOBS as run.js)
//   node test/twins.js paste-box  some of them
//   node test/twins.js --check    only that every twin still finds its code (lint runs this)
// FH_TWIN=<name> is read by test/lib.js (pages: the served /coop/ file) and test/twin-hook.js
// (the server: any of its own modules as Node loads it).
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'out', 'twins');

// file: relative to the repo. find must occur exactly once in it.
const TWINS = {
    // g19 (11/22 review): someone playing alone held the hounds and the call; a bed with no world was saved alongside
    'alone-says': {
        why: '11/22: a page refused into its own game said only up, so every page took it for someone on the way in',
        suite: 'houndhold', file: 'client/presence.js',
        find: "            const alone = Coop.world.otherRun || Coop.world.sameAs ? 1 : 0;",
        put: "            const alone = 0;",
    },
    'alone-no-bark': {
        why: '11/22: the yard and forest hounds waited for good on someone playing a game of their own',
        suite: 'houndhold', file: 'client/events.js',
        find: "            if (p.alone) continue; // playing a game of their own: not coming in\n",
        put: "",
    },
    'alone-off-line': {
        why: '11/22: called, then refused into a game of their own: the call waited on them for good (up never went off)',
        suite: 'lobbyroom', file: 'room.js',
        find: "            if (peer.named && !peer.live && msg.st === 'title' && (!msg.up || msg.alone) && this.inLine(peer)) {",
        put: "            if (peer.named && !peer.live && msg.st === 'title' && !msg.up && this.inLine(peer)) {",
    },
    'bed-no-world': {
        why: '11/22: the room could not keep a bed\'s world and said nothing; its saves would carry on into an empty world',
        suite: 'roomfix', file: 'room.js',
        find: "                this.send(peer, { t: 'savefail', stamp: Number(msg.stamp), why: writeWhy(e) });\n",
        put: "",
    },
    'bed-no-world-said': {
        why: '11/22: the page did not say a bed whose world the host could not keep',
        suite: 'roomfix', file: 'client/save.js',
        find: "        failSave(false);\n    });\n    function putBack(b) {\n",
        put: "    });\n    function putBack(b) {\n",
    },
    'save-no-char-said': {
        why: '11/24 review: the host choosing a save with no character in it got a buzz and nothing said',
        suite: 'lobbysave', file: 'client/lobby.js',
        find: "            if (Coop.toast) Coop.toast(why, 6000);\n",
        put: "",
    },
    'bed-put-back': {
        why: '11/24 review: a bed whose world the host could not keep stayed in its slot over the good save, while the page said it did not write',
        suite: 'roomfix', file: 'client/save.js',
        find: "        if (before && Number(msg && msg.stamp) === before.stamp) putBack(before);\n",
        put: "",
    },
    'bed-put-back-stamp': {
        why: '11/24 review: the room\'s savefail did not say which bed, so the page could not put the slot back',
        suite: 'roomfix', file: 'room.js',
        find: "                this.send(peer, { t: 'savefail', stamp: Number(msg.stamp), why: writeWhy(e) });\n",
        put: "                this.send(peer, { t: 'savefail', why: writeWhy(e) });\n",
    },
    // g18 (11/22 save stamps on the host clock), from docs/grok/g18-twins.txt
    'host-now': {
        why: '11/22: hello did not carry the host clock, so a page set 15 minutes off stamped its own',
        suite: 'stamps', file: 'room.js',
        find: "        this.send(peer, { t: 'hello', id, peers: this.roster(), relayOnly: this.relayOnly, rules: this.rules, now: Date.now() });",
        put: "        this.send(peer, { t: 'hello', id, peers: this.roster(), relayOnly: this.relayOnly, rules: this.rules });",
    },
    'clock-offset': {
        why: '11/22: the page ignored the host clock on hello, so its beds stayed on its own clock',
        suite: 'stamps', file: 'client/net.js',
        find: "        Coop.clockOffset = typeof msg.now === 'number' ? msg.now - Date.now() : 0;",
        put: '        Coop.clockOffset = 0;',
    },
    'bed-clock': {
        why: '11/22: a bed in a run was stamped with the page clock',
        suite: 'stamps', file: 'client/save.js',
        find: '        const stamp = quiet && pending ? pending.stamp : (Coop.world.live ? Coop.now() : Date.now());',
        put: '        const stamp = quiet && pending ? pending.stamp : Date.now();',
    },
    // g16a (11/22 design review), from docs/grok/g16a-twins.txt
    'focus-join': {
        why: '11/22: a join link at the title focused Host online, so A or Enter hosted',
        suite: 'uifix', file: 'client/together.js',
        find: "        setTimeout(() => { const joinBtn = $('[data-do=join]'); const b = focusJoin && joinBtn && !joinBtn.closest('[hidden]') ? joinBtn : box.querySelector('button.big:not([hidden])'); if (b) b.focus(); }, 0);",
        put: "        setTimeout(() => { const b = box.querySelector('button.big:not([hidden])'); if (b) b.focus(); }, 0);",
    },
    'host-link': {
        why: '11/22: a joiner whose host was gone said "Trying again" for ever',
        suite: 'uifix', file: 'client/ui.js',
        find: '            hostLinkTimer = setTimeout(sayHostLink, 30000);',
        put: '            hostLinkTimer = setTimeout(sayHostLink, 3000000);',
    },
    'script-error': {
        why: '11/22: SceneManager.catchException drew the red screen and the log never saw the stack',
        suite: 'uifix', file: 'client/fixes.js',
        find: "        if (window.Coop && Coop.note) Coop.note(Coop._scriptError = 'script error: ' + text);",
        put: '',
    },
    'report-unread': {
        why: '11/22: a bug report whose server log could not be read still said it was copied',
        suite: 'uifix', file: 'client/together.js',
        find: "        const unread = 'The server log could not be read. Send app\\\\data\\\\server-*.log and launcher.log.';",
        put: "        const unread = 'Bug report copied. Paste it into your message about the bug.';",
    },
    'report-state': {
        why: '11/22: the bug report said nothing about the line, the world or this PC\'s saves once the socket was down',
        suite: 'uifix', file: 'client/together.js',
        find: "        return [connection, world, 'saves: ' + saveList(), 'last error: ' + (Coop._scriptError || 'none')].join('\\n');",
        put: "        return '';",
    },
    'name-pad': {
        why: '11/22: a controller could not submit or leave the name box',
        suite: 'uifix', file: 'client/pad.js',
        find: "            // The title will not start without a name, and this box had no pad way out (11/22).\n            if (down(A)) send('keydown', ['Enter', 13, 'Enter'], document.activeElement);\n            if (down(B)) send('keydown', ['Escape', 27, 'Escape'], document.activeElement);",
        put: '',
    },
    'name-held': {
        why: '11/22: A on the name box would also have been OK in the game',
        suite: 'uifix', file: 'client/pad.js',
        find: '    Coop.padHeld = function () { return !!(panel() || chatOpen() || nameOpen()); };',
        put: '    Coop.padHeld = function () { return !!(panel() || chatOpen()); };',
    },
    'name-steam': {
        why: '11/22: after a controller, "Type a name first" did not say how a Steam Deck opens the keyboard',
        suite: 'uifix', file: 'client/ui.js',
        find: "            ? 'Type a name first (bottom left). Steam+X opens the keyboard on a Steam Deck.'",
        put: "            ? 'Type a name first (bottom left).'",
    },
    'name-mouse': {
        why: '11/22: New Game could run before the name box blurred, so a click started on an empty name',
        suite: 'uifix', file: 'client/ui.js',
        find: '        if (typed) Coop.setName(typed);',
        put: '        if (false) Coop.setName(typed);',
    },
    'banner-click': {
        why: '11/22: the carry-on line was pointer-events none, so a mouse could not take it',
        suite: 'uifix', file: 'client/recover.js',
        find: "    box.style.cssText = 'position:fixed;left:50%;top:9%;transform:translateX(-50%);z-index:56;pointer-events:auto;cursor:pointer;display:none;white-space:nowrap;'",
        put: "    box.style.cssText = 'position:fixed;left:50%;top:9%;transform:translateX(-50%);z-index:56;pointer-events:none;display:none;white-space:nowrap;'",
    },
    'banner-listen': {
        why: '11/22: the carry-on line had no click, so the mouse could not do what R does',
        suite: 'uifix', file: 'client/recover.js',
        find: "    box.addEventListener('click', carryOn);",
        put: '',
    },
    'banner-text': {
        why: '11/22: the carry-on line did not say a click would do it',
        suite: 'uifix', file: 'client/recover.js',
        find: "        box.textContent = 'You dropped out ' + (offer.ageSec < 90 ? 'a moment' : mins + ' minutes') + ' ago. Press ' + Coop.keyName('R') + ' to carry on from there. Or click here.';",
        put: "        box.textContent = 'You dropped out ' + (offer.ageSec < 90 ? 'a moment' : mins + ' minutes') + ' ago. Press ' + Coop.keyName('R') + ' to carry on from there.';",
    },
    'park-empty': {
        why: '11/22: R with an empty park did nothing',
        suite: 'uifix', file: 'client/recover.js',
        find: "            const said = 'Nothing was kept from that drop. The last bed save is the safe point.';",
        put: "            const said = '';",
    },
    'parkno': {
        why: '11/22: a park that did not write was only a silence',
        suite: 'uifix', file: 'client/recover.js',
        find: "        const said = 'Your place could not be kept. The last bed save is the safe point.';",
        put: "        const said = '';",
    },
    'chat-keys': {
        why: '11/22: the chat line kept saying Enter and Esc after a controller was in use',
        suite: 'uifix', file: 'client/chat.js',
        find: "        input.placeholder = 'Say something (' + Coop.keyName('Enter') + ' sends, ' + Coop.keyName('Esc') + ' cancels)';",
        put: "        input.placeholder = 'Say something (Enter sends, Esc cancels)';",
    },
    'names-enter': {
        why: '11/22: Coop.keyName had no pad name for Enter, so prompts could not say A',
        suite: 'uifix', file: 'client/pad.js',
        find: "    const NAMES = { F: 'R3', Y: 'Start', R: 'RT', Esc: 'B', Tab: 'LT', F1: 'View', Enter: 'A' };",
        put: "    const NAMES = { F: 'R3', Y: 'Start', R: 'RT', Esc: 'B', Tab: 'LT', F1: 'View' };",
    },
    'help-keys': {
        why: '11/22: the help key column was written once, so it stayed on keyboard names after a controller',
        suite: 'uifix', file: 'client/ui.js',
        find: '        fillKeys();',
        put: '',
    },
    'help-f8': {
        why: '11/22: F8 has no pad button and the help did not say Together does the same thing',
        suite: 'uifix', file: 'client/ui.js',
        find: "        ['F8', 'Host: call an AI partner in, or send it home. Together on the title does this too.'],",
        put: "        ['F8', 'Host: call an AI partner in, or send it home.'],",
    },
    'help-g': {
        why: '11/22: G has no pad button and the help did not say the bag lays the trap too',
        suite: 'uifix', file: 'client/ui.js',
        find: "        + '<footer><b>F9</b> lag meter &nbsp;&middot;&nbsp; <b>F4</b> full screen &nbsp;&middot;&nbsp; <b>Ctrl+Shift+U</b> unstuck &nbsp;&middot;&nbsp; <b>Ctrl+Shift+B</b> bug report &nbsp;&middot;&nbsp; <b>Tab</b> everyone&rsquo;s gear &nbsp;&middot;&nbsp; <b>G</b> bear trap, also from the bag &nbsp;&middot;&nbsp; <b>F1</b> close</footer>';",
        put: "        + '<footer><b>F9</b> lag meter &nbsp;&middot;&nbsp; <b>F4</b> full screen &nbsp;&middot;&nbsp; <b>Ctrl+Shift+U</b> unstuck &nbsp;&middot;&nbsp; <b>Ctrl+Shift+B</b> bug report &nbsp;&middot;&nbsp; <b>Tab</b> everyone&rsquo;s gear &nbsp;&middot;&nbsp; <b>G</b> bear trap &nbsp;&middot;&nbsp; <b>F1</b> close</footer>';",
    },
    'version-note': {
        why: '11/22: a version refusal was toasted on the joiner and not written down',
        suite: 'uifix', file: 'client/net.js',
        find: '        Coop.note(Coop.refused);',
        put: '',
    },
    'replaced': {
        why: '11/22: the tab that lost its token kept reconnecting and pushed the new one off',
        suite: 'uifix', file: 'client/net.js',
        find: "        Coop.refused = 'This game is open in another tab or window.';",
        put: '',
    },
    // g16b (11/22 design review), from docs/grok/g16b-twins.txt
    'bring-keeps-trying': {
        why: '11/22: a fight longer than 15 seconds left a brought character on the other run\'s map',
        suite: 'roomfix', file: 'client/state.js',
        find: '        if (!World._bringBy || !World.live) return;',
        put: '        if (Date.now() > World._bringBy || !World.live) { World._bringBy = 0; return; }',
    },
    'turned-told': {
        why: '11/22: the host\'s page was never told who had been turned away, or why',
        suite: 'roomfix', file: 'server.js',
        find: "        for (const p of room.peers.values()) if (p.host && !room.isBot(p)) room.send(p, { t: 'turned', text });",
        put: "        if (false) for (const p of room.peers.values()) if (p.host && !room.isBot(p)) room.send(p, { t: 'turned', text });",
    },
    'save-told': {
        why: '11/22: a save that did not write only buzzed',
        suite: 'roomfix', file: 'client/save.js',
        find: '        if (!ok && !quiet) failSave(false);',
        put: '        if (false) failSave(false);',
    },
    'save-alongside-told': {
        why: '11/22: the save made beside someone else\'s failed the same way, and said nothing',
        suite: 'roomfix', file: 'client/save.js',
        find: '        } else failSave(true);',
        put: '        } else if (false) failSave(true);',
    },
    'save-write-lives': {
        why: '11/22: a save write that threw killed the process (nothing handles uncaughtException)',
        suite: 'roomfix', file: 'server.js',
        find: "                console.error('could not write a save: ' + (e && e.message));",
        put: '                throw e;',
    },
    'world-write-lives': {
        why: '11/22: persisting the world threw the same way and killed the process',
        suite: 'roomfix', file: 'room.js',
        find: "        } catch (e) { console.error('could not save the world: ' + (e && e.message)); }",
        put: '        } catch (e) { throw e; }',
    },
    'bed-write-lives': {
        why: '11/22: keeping the world beside a save threw and killed the process',
        suite: 'roomfix', file: 'room.js',
        find: "                console.error('could not keep the save: ' + (e && e.message));",
        put: '                throw e;',
    },
    'saves-where': {
        why: '11/22: the readme still said saves live on the host\'s PC',
        suite: 'roomfix', file: 'README.md',
        find: "- Saves live in `app\\data\\saves` on each player's own PC, not in the game's own save folder.",
        put: "- Saves live in `app\\data\\saves` on the host's PC (a friend's saves too), not in the game's own save folder.",
    },
    'worldfail-answered': {
        why: '11/22: a world ask that threw was only logged, and the page stayed entering',
        suite: 'roomfix', file: 'room.js',
        find: "                if (msg.t === 'world?') this.send(peer, { t: 'worldfail', why: String(e && e.message || 'failed').slice(0, 180) });",
        put: "                if (false) this.send(peer, { t: 'worldfail', why: String(e && e.message || 'failed').slice(0, 180) });",
    },
    'park-told': {
        why: '11/22: a park that did not write was a line in the host\'s log and nothing on that player\'s page',
        suite: 'roomfix', file: 'room.js',
        find: "                this.send(peer, { t: 'parkno', why });",
        put: "                if (false) this.send(peer, { t: 'parkno', why });",
    },
    'slot-unread': {
        why: '11/22: a slot that could not be read left the success toast up and dropped the player on the title',
        suite: 'roomfix', file: 'client/state.js',
        find: '                if (Coop.toast) Coop.toast(unread, 9000);',
        put: '                if (false) Coop.toast(unread, 9000);',
    },
    'tab-replaced': {
        why: '11/22: the old tab was cut off before it could be told its own tab had come back',
        suite: 'roomfix', file: 'room.js',
        find: "                this.send(clash, { t: 'replaced' });",
        put: "                if (false) this.send(clash, { t: 'replaced' });",
    },
    'no-host-saves': {
        why: '11/22: a joiner with no save under a name was handed whatever the host still had filed there',
        suite: 'roomfix', file: 'server.js',
        find: '    handleStore(req, res, own);',
        put: `    if (req.method === 'GET' && !fs.existsSync(own)) {
            const headers = { 'x-forwarded-for': '203.0.113.9' };
            if (req.headers['x-fh-token']) headers['x-fh-token'] = req.headers['x-fh-token'];
            fetch(JOIN.origin + req.url, { headers }).then((r) => (r.ok ? r.arrayBuffer() : null)).then((buf) => {
                if (!buf) { res.writeHead(404); res.end(); return; }
                try { fs.mkdirSync(path.dirname(own), { recursive: true }); fs.writeFileSync(own, Buffer.from(buf)); } catch (err) { /* still answer */ }
                res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
                res.end(Buffer.from(buf));
            }).catch(() => { if (!res.headersSent) { res.writeHead(404); res.end(); } });
            return;
        }
        handleStore(req, res, own);`,
    },
    // g16c (11/22 design review), from docs/grok/g16c-twins.txt
    'bark-held': {
        why: '11/22: the yard bark timer (variable 211) called the hounds while a friend was still in the opening',
        suite: 'houndhold', file: 'client/events.js',
        find: "        if (id === BARK && value > (this._data[id] || 0) && Ev.barkHeld() && [100, 180, 220].indexOf(this._data[id] || 0) < 0) return;",
        put: "        if (false) return;",
    },
    'flaky-blocks': {
        why: '11/22 ruling: a suite that fails in the run and passes three times alone is flaky, and that blocks the release',
        suite: 'houndhold', file: 'test/gate.js',
        find: "    return !broken.length && !flaky.length;",
        put: "    return !broken.length;",
    },
    'one-tunnel': {
        why: '11/22: start.ps1 -Online started its own cloudflared, so the game stayed on this PC and Host online replaced the key',
        suite: 'houndhold', file: 'start.ps1',
        find: '    $state = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/coop/app/online" -Method Post -Headers @{ \'x-fh-app\' = \'1\' } -ContentType \'application/json\' -Body (@{ on = $true; private = ($env:FH_RELAY -ne \'0\') } | ConvertTo-Json) -TimeoutSec 90',
        put: "    $state = @{ mode = 'local'; link = '' }",
    },
    'second-window': {
        why: '11/22: a second Play while the server was up opened another game window, a second player from one PC',
        suite: 'houndhold', file: 'start.ps1',
        find: "if ((Get-Hello).fh -eq 'together') {",
        put: "if ($false) {",
    },
    'picker-waits': {
        why: '11/21 live: the picker held to the lobby\'s pick waited for a button; by touch on a Deck there was none ("stuck on enki")',
        suite: 'lobby', file: 'client/lobby.js',
        find: "                if (name === 'ok') return shown;", put: "                if (name === 'ok' && !shown) return false;",
    },
    'dead-brought': {
        why: 'advisor 11/22: a save made dead (alongside someone else\'s) was offered as a character to bring into a new run',
        suite: 'lobbysave', file: 'client/lobby.js',
        find: "            if (!save || !save.char || save.dead) return;", put: "            if (!save || !save.char) return;",
    },
    'other-run-busy': {
        why: '11/21 ruling: a friend\'s save of another run was turned away (worldbusy); the host\'s run takes priority, nobody\'s save is blocked',
        suite: 'lobbysave', file: 'room.js',
        find: '            if (other && this.isBot(peer)) {', put: '            if (other) {',
    },
    'other-run-unlisted': {
        why: '11/21 live: only a save of the run being played showed; the friend\'s saves of other runs were nowhere on screen',
        suite: 'lobbysave', file: 'client/lobby.js',
        find: '            const saves = (L.own ? [L.own] : []).concat(otherSaves().filter((o) => !L.own || o.char !== L.own.char));', put: '            const saves = L.own ? [L.own] : [];',
    },
    'other-run-unasked': {
        why: 'his 11/22 "we should be clear": a save of another run was brought in without saying its run\'s progress stays behind',
        suite: 'lobbysave', file: 'client/lobby.js',
        find: '            if (save && save.other) {', put: '            if (false) {',
    },
    'other-run-where': {
        why: 'a character brought from another run stood where that run left them, maybe floors past the host',
        suite: 'lobbysave', file: 'client/state.js',
        find: '        if (msg.other) {\n            World._bringBy = Date.now() + 15000;', put: '        if (msg.other) {\n            World._bringBy = 0;',
    },
    'other-run-worldwhen': {
        why: 'advisor 11/22: with worldbusy gone, a save of another run met the carried-on-moment check and bounced',
        suite: 'lobbyswitch', file: 'room.js',
        find: "if (this.founded && how === 'load' && !other && msg.runId", put: "if (this.founded && how === 'load' && msg.runId",
    },
    'grey-unnamed': {
        why: '11/21 live: a greyed character said nothing of whose it was ("Cahara blocked")',
        suite: 'lobby', file: 'client/lobby.js',
        find: "            return { name: c.name + (by ? ' (' + by + ')' : ''), act: 'pick:' + c.id,", put: "            return { name: c.name, act: 'pick:' + c.id,",
    },
    'start-unsaid': {
        why: 'his 11/21 "the menu system wasnt clear enough": a greyed Start did not say whom it waited on',
        suite: 'lobby', file: 'client/lobby.js',
        find: "                { name: 'Start' + (wait.length ? ' (waiting on ' + wait.join(', ') + ')' : ''),", put: "                { name: 'Start',",
    },
    'rechoose-stuck': {
        why: '11/22: choosing again while ready was refused (the room keeps a ready player\'s character): the ready goes first',
        suite: 'lobby', file: 'client/lobby.js',
        find: "        if (me.ready) say('ready', { on: false });\n", put: '',
    },
    'lobby-silent': {
        why: '11/21 live: the room dropped picks, readies and joins without a word, twice "nothing works"',
        suite: 'lobbyroom', file: 'room.js',
        find: '            this.send(peer, { t: \'lobbyno\', do: msg.do, why });\n', put: '',
    },
    'joiner-log': {
        why: '11/21 live: a joiner\'s PC logged nothing past "joined"; the evidence sat on the host\'s Deck',
        suite: 'lobbysave', file: 'server.js',
        find: '        if (!isBinary) keepNotes(data);\n', put: '',
    },
    'home-body': {
        why: 'his call 11/20: a living partner F8 sent home was thrown away; the next call was somebody new',
        suite: 'partner', file: 'room.js',
        find: 'else if (sent) this.keepHome(peer.name);', put: 'else if (sent) this.unpark(peer.name);',
    },
    'home-beside': {
        why: 'his call 11/20: a body called back after F8 came in where it had left, maybe floors away from the host',
        suite: 'partner', file: 'tools/bot-page.js',
        find: '            if (who && who.m && !near && !$gamePlayer.isTransferring()) { Coop.transferTo(who, 2); log(\'back from home; joining \' + who.name); }\n', put: '',
    },
    'home-fight': {
        why: 'advisor 11/20: F8 in a fight kept the body from before it, so a losing partner could be sent home and called back whole',
        suite: 'partner', file: 'room.js',
        find: '            if (sent && sent.fight && parked.at < sent.at && parked.droppedAs !== \'dead\') parked.droppedAs = sent.fight;\n', put: '',
    },
    'home-dead': {
        why: 'his call 11/20: a dead partner sent home kept its body only 20 minutes; then the next call was alive and fresh',
        suite: 'partner', file: 'room.js',
        find: '        if (peer.named && this.sentHome.has(peer.name.toLowerCase()) && !this.recallHolds(peer)) this.keepHome(peer.name);\n', put: '',
    },
    'home-dies-leaving': {
        why: 'review 11/21: F8 in a fight, killed in it before it left: it went to the title as if alive and came back at 1 HP',
        suite: 'partner', file: 'tools/bot.js',
        find: '                if (Coop.dead) return (Coop.parkNow && Coop.parkNow(true)) || \'\';\n', put: '',
    },
    'home-death-stays': {
        why: 'review 11/21: a park marked dead before the F8 press was turned into a fight drop (1 HP)',
        suite: 'partner', file: 'room.js',
        find: ' && parked.droppedAs !== \'dead\') parked.droppedAs = sent.fight;', put: ') parked.droppedAs = sent.fight;',
    },
    'home-taken': {
        why: 'a kept body whose character someone now plays was turned away at the door and spent',
        suite: 'partner', file: 'partners.js',
        find: ' || (row && new Set(initials || []).has(row[1]))', put: '',
    },
    'bot-dressing': {
        why: '10/21 marathons froze the host: the bot\'s change of clothes handed pieces back, each asking for another change',
        suite: 'ai', file: 'tools/bot-page.js',
        find: ' && Coop.world.live && !BOT.dressing) {', put: ' && Coop.world.live) {',
    },
    'log-late': {
        why: 'review 10/21: a second start (Play pressed twice) moved the running session\'s log away before finding the port taken',
        suite: 'meterline', file: 'server.js',
        find: 'let LOG = null;\n', put: 'let LOG = null;\nprocess.nextTick(() => openLog());\n',
    },
    'notes-cap': {
        why: 'review 10/21: a page throwing in a loop could fill the host\'s disk with notes',
        suite: 'meterline', file: 'room.js',
        find: '                if (peer.notesN > NOTES_PER_MIN) continue;\n', put: '',
    },
    'flatpak-partner': {
        why: 'his 10/21: a Steam Deck player could not call an AI partner in (its Chrome is a Flatpak)',
        suite: 'deck', file: 'tools/bot.js',
        find: "    ...(process.platform === 'linux' ? linuxBrowsers() : [])].find(", put: '    ].find(',
    },
    'second-rider': {
        why: 'field 11/11: the second of two players to ride the lift down stood hidden at the bottom for good (the switch was on already, so the arrival was never theirs)',
        suite: 'lift', file: 'client/state.js',
        find: "        } else if (after && byHand() && World.isShared('sw', id)) {", put: '        } else if (false) {',
    },
    'loot-claim': {
        why: 'itch 11/13: two players searching one crate while the first one\'s "You find" box was up both got its loot (the crate is marked taken only after the box)',
        suite: 'loot', file: 'client/state.js',
        find: '            if (mark && World.isShared(mark[0], mark[1])) {', put: '            if (false) {',
    },
    'loot-claim-jumps': {
        why: 'a chest\'s Open branch plays the coin flip, which jumps back to its own label: stopping at any jump left the chest open to a second player until the flip was over',
        suite: 'loot', file: 'client/state.js',
        find: '                    if (c.code === 119) { jumps.push(labels[c.parameters[0]]); continue; }', put: '                    if (c.code === 119) break;',
    },
    'loot-instanced-switch': {
        why: 'Instanced loot covered crates marked by their own letter but not the chests, shelves and crates marked by a shared switch (chest1, bookshelf1: 268 of them)',
        suite: 'loot', file: 'client/state.js',
        find: 'const swShared = (id) => worldSw.has(id) && !(Coop.rules.loot && lootSw.has(id));', put: 'const swShared = (id) => worldSw.has(id);',
    },
    'loot-instanced': {
        why: 'itch 11/13 ask: with the host\'s Instanced loot on, a crate one player took must still hold the other player\'s find',
        suite: 'loot', file: 'client/state.js',
        find: 'const ssLocal = (key) => privateSs.has(key) || (Coop.rules.loot && lootSs.has(key));', put: 'const ssLocal = (key) => privateSs.has(key);',
    },
    'loot-off-shares': {
        why: 'Grok g16: the host turning Instanced loot off left each player\'s taken crates full for the others, two worlds',
        suite: 'loot', file: 'client/state.js',
        find: "            for (const k of lootSs) if ($gameSelfSwitches._data[k]) queue('ss', k, 1);\n", put: '',
    },
    'follow-late-tileset': {
        why: 'gate 11/15: following through the Ancient city door before the partner\'s next word gave the follower the map\'s old walls',
        suite: 'follow', file: 'client/presence.js',
        find: "            && !$gamePlayer.isTransferring() && peer.ts && $gameMap.tilesetId() !== peer.ts) $gameMap.changeTileset(peer.ts);", put: '            && false) $gameMap.changeTileset(peer.ts);',
    },
    'loot-body': {
        why: 'his 11/15: guard and priest bodies still went to whoever searched first, with Instanced loot on or off (the census judged the whole page, soul stone and seed arms included)',
        suite: 'loot', file: 'client/census.json',
        find: '"swLoot":[1061,45,', put: '"swLoot":[1061,',
    },
    'loot-skip': {
        why: 'guard1 on three Entrance layouts: his search also turns his "dead" switch off, so with Instanced loot on the partner met him alive again',
        suite: 'loot', file: 'client/state.js',
        find: '                if (c && c.coopSkip) { this._index++; return true; }\n', put: '',
    },
    'loot-skip-reload': {
        why: 'advisor 11/16, before 0.1.21 shipped: the skips were tagged at map setup only, and back from the guard\'s fight (or the menu) the game loads the map\'s file again without one, so the search after his fight turned him alive for the partner',
        suite: 'loot', file: 'client/state.js',
        find: '        if (object === window.$dataMap) tagSkips();\n    };\n',
        put: '    };\n    const _setupTwin = Game_Map.prototype.setup;\n    Game_Map.prototype.setup = function (mapId) { _setupTwin.call(this, mapId); tagSkips(); };\n',
    },
    'loot-rules-restart': {
        why: 'Grok g16: a restarted server said Instanced loot was off to whoever came back before the host, whose finds then went into the shared world',
        suite: 'loot', file: 'room.js',
        find: '                if (saved) this.takeRules(saved.rules);\n', put: '',
    },
    'plate-is-no-ride': {
        why: 'Grok g13: a second player stepping on a plate that only turns a flag on was given the scene it opens (Francois: hidden, thrown into his fight)',
        suite: 'lift', file: 'client/state.js',
        find: 'ev._trigger <= 2 && carriesOff(this._interpreter._list);', put: 'ev._trigger <= 2;',
    },
    'still-in-a-scene': {
        why: 'field 11/11: enemies walked up to a player in a conversation and ringed him (alone, the game stops every event then)',
        suite: 'encounter', file: 'client/events.js',
        find: "        if (target.st === 'event') return;\n", put: '',
    },
    'whose-scene': {
        why: 'world switches started other players\' scenes on everyone (the hound, the elevator, Trortur)',
        suite: 'scenes', file: 'client/state.js',
        find: 'return leadsToActing(page, ev._mapId, ev._eventId, new Set());', put: 'return false;',
    },
    'passages-way-back': {
        why: 'a follower onto the Passages of Ma\'habre had no way back: map 0, black for good (11/02)',
        suite: 'mahabre', file: 'client/presence.js',
        find: '        keepWayBack(peer.m);\n', put: '',
    },
    'scene-steps': {
        why: 'the Beacon of the Depths ran its steps on a bystander: tint and light for good (11/02)',
        suite: 'mahabre', file: 'client/state.js',
        find: 'if (!yes && window.$dataMap && $dataMap.events) {', put: 'if (false) {',
    },
    'whoever-alone': {
        why: 'Le\'garde waited on the next plane only for whoever set his flag: the other stood there unseen, no menu (11/02)',
        suite: 'mahabre', file: 'client/state.js',
        find: "        if (WHOEVER_IS_THERE.has(ev._mapId + ',' + ev._eventId) && !Coop.peersHere().length) return false;\n", put: '',
    },
    'ending-of-this-run': {
        why: 'someone still in the credits pulled a fresh New Game back into the old ending (11/02)',
        suite: 'endpartner', file: 'client/death.js',
        find: '(!msg.run || msg.run === Coop.world.runId)', put: 'true',
    },
    'ending-exact': {
        why: 'the ending hand-off OR\'ed switches: a player partway along ending A got A when the partner walked out (Grok 11/02)',
        suite: 'endings', file: 'client/death.js', env: { FH_ENDINGS: 'mix-a' },
        find: '        setExactly(ENDINGS, e.sw || []);\n', put: '        for (const id of e.sw || []) $gameSwitches.setValue(id, true);\n',
    },
    'teller-of-s': {
        why: 'ending S told every machine its own story: Cahara\'s crown read to D\'arce as Le\'garde raised (11/02)',
        suite: 'endings', file: 'client/death.js', env: { FH_ENDINGS: 's-crown' },
        find: '            ini = tellerOfS();\n', put: '            ini = INITIALS.filter((id) => $gameSwitches.value(id));\n',
    },
    'teller-at-gate': {
        why: 'Grok 11/02: the crown flag stays on, so a later S (the god beaten, Le\'garde raised) was told as Cahara\'s crown',
        suite: 'endings', file: 'client/death.js', env: { FH_ENDINGS: 's-god-after-crown' },
        find: ' || $gameMap.mapId() !== GATE || Coop.world.mine.has', put: ' || Coop.world.mine.has',
    },
    'second-at-fight': {
        why: 'the second player at the Void\'s god of themselves skipped the fight and walked into ending D (Grok 11/02)',
        suite: 'endings', file: 'client/battle.js', env: { FH_ENDINGS: 'two-gods' },
        find: "                this.setWaitMode('coopFight');\n", put: '',
    },
    'run-after-ending': {
        why: 'a New Game while the partner was still in the credits joined the finished run (11/02)',
        suite: 'endpartner', file: 'room.js',
        find: "            if (how === 'new') for (const p of [...this.peers.values()]) if (p !== peer && p.live && p.last && p.last.m === 86) this.leaveWorld(p);\n", put: '',
    },
    'settle-start': {
        why: 'his 10/20: the Cave Mother, just won in Enki\'s fight, fought him again at full health and left him stuck',
        suite: 'refight', file: 'client/events.js',
        find: "        if (hold && hold.k === 'talk' && hold.won) return;\n", put: '',
    },
    'hold-flush': {
        why: 'the word that a beaten boss\'s scene was over could reach a partner before her "dead" switch',
        suite: 'refight', file: 'client/events.js',
        find: '        Coop.world.flush();\n        Coop.send(msg);', put: '        Coop.send(msg);',
    },
    'rules-cut': {
        why: 'playtest 11/14: the Options help of Balance changes and Instanced loot ran past the edge of its box, and "Set by the host" was never seen',
        suite: 'hostrun', file: 'client/pointer.js',
        find: 'coin has loot for each of you.\\nOFF:', put: 'coin has loot for each of you. OFF:',
    },
    'rules-faint': {
        why: 'his playtest 11/14: the friend\'s greyed run option boxes were too faint to read',
        suite: 'lobby', file: 'client/together.js',
        find: 'input.tabIndex = mine ? 0 : -1;', put: 'input.tabIndex = mine ? 0 : -1; input.disabled = !mine;',
    },
    'rules-clickable': {
        why: 'his playtest 11/14: on the friend\'s screen the run options looked like his to change, and a click did nothing',
        suite: 'lobby', file: 'client/together.js',
        find: "'#coop-together label.rule.theirs { pointer-events: none; }',", put: '',
    },
    'ready-hidden': {
        why: 'his playtest 11/14: before the host chose the run the friend\'s menu was a lone Together, which was disorienting',
        suite: 'lobby', file: 'client/lobby.js',
        find: "if (!L.run) return [{ name: 'As: (' + nameOf(L.host) + ' is choosing the run)', act: 'as', enabled: false }, { name: 'Together', symbol: 'together' }];", put: "if (!L.run) return [{ name: 'Together', symbol: 'together' }];",
    },
    'title-click': {
        why: 'his playtest 11/14: Together is worked with the mouse, and the title menu beneath it took no clicks',
        suite: 'lobby', file: 'client/fixes.js',
        find: 'if (event.button === 0 && mouseScene() && onPicture(event)) this._onLeftButtonDown(event);', put: '',
    },
    'title-point': {
        why: 'his playtest 11/14: pointing at a line of the title menu did not move the cursor there',
        suite: 'lobby', file: 'client/fixes.js',
        find: 'if (i >= 0 && i !== w.index() && w.isCursorMovable())', put: 'if (false)',
    },
    'ready-buzz': {
        why: 'his playtest 11/14: Ready with no character was greyed and only buzzed until "Come in as..." had been used',
        suite: 'lobby', file: 'client/lobby.js',
        find: "else if (what === 'join' || what === 'as') { L.mode = 'pick'; L.pickFor = what; }", put: "else if (what === 'as') say('ready', { on: true });\n        else if (what === 'join') { L.mode = 'pick'; L.pickFor = what; }",
    },
    'ready-after-pick': {
        why: 'Ready opened the character list, and the pick left the friend still not ready (11/22: choosing is the ready)',
        suite: 'lobby', file: 'client/lobby.js',
        find: "        else say('ready', { on: true, pick });\n", put: '',
    },
    'lobby-heard-late': {
        why: 'gate 11/14: on a slow PC the room\'s word on the lobby came before lobby.js, and the friend sat out the lobby',
        suite: 'lobby', file: 'client/lobby.js',
        find: 'if (Coop.lastLobby) heard(Coop.lastLobby);', put: '',
    },
    'ready-old-pick': {
        why: 'Grok 11/14: a pick the room dropped (taken meanwhile) was followed by a Ready that stood as the earlier pick',
        suite: 'lobby', file: 'room.js',
        find: '            if (!this.asPicked(lob, msg)) break;\n            if (lob.away)', put: '            if (lob.away)',
    },
    'join-old-pick': {
        why: 'Grok 11/14: the same for Join, into the run as the earlier pick',
        suite: 'lobby', file: 'room.js',
        find: '            if (!this.asPicked(lob, msg)) break;\n            if (!this.founded)', put: '            if (!this.founded)',
    },
    'rules-stale-host': {
        why: 'Grok 11/14: a friend who hosted their own page and then joined by link showed their own run options, not the run\'s',
        suite: 'app', file: 'client/net.js',
        find: 'Coop.decides = null;', put: '',
    },
    'rules-untold': {
        why: 'playtest 11/14: the host changing Instanced loot mid-run told nobody, and F1 still said an emptied chest stays empty',
        suite: 'loot', file: 'client/state.js',
        find: 'if (say && said.length && World.live && Coop.toast)', put: 'if (false)',
    },
    'witch-fights': {
        why: 'his call 11/14: the black witch woke and fought on one machine only, invisible to the partner, and a room change sent her away on one screen and left her fighting on the other',
        suite: 'hounds', file: 'client/census.json',
        find: '"swFloor":[3451,3453,3454,3457]', put: '"swFloor":[3453,3454,3457]',
    },
    'witch-shows': {
        why: 'his call 11/14: the black witch\'s first page (3454) left on one machine after a room change: she stood on one screen only',
        suite: 'hounds', file: 'client/census.json',
        find: '"swFloor":[3451,3453,3454,3457]', put: '"swFloor":[3451,3453,3457]',
    },
    'witch-other-floor': {
        why: 'Grok 11/14, the known issue in the 0.1.20 and 0.1.21 notes: a wake on one of her floors woke the other floor\'s copy of the black witch for a partner standing there',
        suite: 'hounds', file: 'client/state.js',
        find: 'if (!$gameMap || $gameMap.mapId() !== mapId || !!$gameSwitches._data[id] === !!value) return false;',
        put: 'if (!$gameMap || !!$gameSwitches._data[id] === !!value) return false;',
    },
    'witch-arrival': {
        why: 'the fix weighed 11/14 and not built: her switches kept per floor with no reload on arrival, so a partner walking onto her floor while she was out was hunted by a witch they could not see',
        suite: 'hounds', file: 'client/state.js',
        find: '        if (World.live) showFloor(mapId);\n', put: '',
    },
    'recruit-flag': {
        why: 'Grok hunt 10/31 (#4): a solo save holding a recruit joined a run where her flag was off, and her cage showed her again, a second Girl on another machine',
        suite: 'buckman', file: 'client/state.js',
        find: "                if (kind === 'sw' && holdsRecruit(key)) { mine.push([kind, key, value]); continue; }\n", put: '',
    },
    'recruit-twice': {
        why: 'BUG HUNT 11/13 (tools/hunt/recruit.js): the flag that closes a recruit is set after the Add Actor, so two players on one skeleton\'s body, or the Void\'s recruits, a moment apart both raised it',
        suite: 'rules', file: 'client/state.js',
        find: 'if (add && add.code === 129 && add.parameters[1] === 0 && joinedElsewhere(', put: 'if (false && joinedElsewhere(',
    },
    'recruit-cage': {
        why: 'found 11/17 checking every recruit page: the Girl\'s cage opens (81) half a second before she joins, so a look only after the Add Actor missed the 28 cage pages',
        suite: 'rules', file: 'client/state.js',
        find: '            for (let j = i - 1; j >= 0 && list[j].indent >= d; j--) { const f = closes(list[j], d); if (f) return f; }\n', put: '',
    },
    'parallel-claim': {
        why: 'field 11/11: Enki pulled the Blue Sin without the book after pho\'s cave-in; its parallel page turned 3142 on again, the mine never came down on him, and the page rumbled every two seconds for good',
        suite: 'lift', file: 'client/state.js',
        find: '!World.live || !page || (page.trigger !== 3 && page.trigger !== 4)', put: '!World.live || !page || page.trigger !== 3',
    },
    'pit-gone': {
        why: 'known since 11/14, listed 11/20: a reload or a dropped line during the smash pit guard\'s blow left 2934 on, and he stood still for everyone for the rest of the run',
        suite: 'smashpit', file: 'client/death.js',
        find: '        $gameSwitches.setValue(2934, false);\n    };\n', put: '    };\n',
    },
    'autorun-claim': {
        why: 'advisor 11/20, the same rule for steps that start by themselves: B used the Beacon of the Depths as A\'s write of its next step landed first, and B was left standing in the city, the beacon shut to them',
        suite: 'lift', file: 'client/state.js',
        find: '!World.live || !page || (page.trigger !== 3 && page.trigger !== 4)', put: '!World.live || !page || page.trigger !== 4',
    },
    'chain-running-page': {
        why: 'advisor 11/20: whose step a write is goes by the page the interpreter runs; the event had already turned to the next step (A\'s), so the Beacon left B behind',
        suite: 'lift', file: 'client/state.js',
        find: '        const page = data && data.pages[it._coopPage];\n', put: '        const page = data && $gameMap.event(it._eventId) && $gameMap.event(it._eventId).page();\n',
    },
    'recruit-void': {
        why: 'Grok round 3 (11/17): the Void\'s two-at-once page closes both on 2611, so a partner taking 2 a moment before lost 7 for the run',
        suite: 'rules', file: 'client/state.js',
        find: '                if (own && own !== close) return own;\n', put: '',
    },
    'guest-row': {
        why: 'known since 11/01 (his report: a party mate\'s status "disappears or is inconsistent" in the menu): a mate who was a guest in someone\'s fight did not answer the lineup, so their row kept its copy from before the fight',
        suite: 'party', file: 'client/party.js',
        find: "        if (b && b.role === 'guest') { if (b.owner !== undefined) Coop.sendTo(b.owner, 'pactors?', { for: msg.from }); return; }\n",
        put: "        if (b && b.role === 'guest') return;\n",
    },
    'rename-hold': {
        why: 'his friend 10/20: dropped mid-fight as "Enki", back in the same tab as "Gandalf the Wizz"; nobody matched the new name to the fight, so its enemy stood frozen five minutes',
        suite: 'holds', file: 'client/events.js',
        find: "    Coop.on('was', function (msg) {\n",
        put: "    Coop.on('was', function (msg) {\n        return;\n",
    },
    'rename-told': {
        why: 'the room never said which old player a tab back under a new name was (the 10/20 rename freeze)',
        suite: 'lobbyroom', file: 'room.js',
        find: "            if (gone) { this.goneTabs.delete(token); this.tellWas(peer, gone); }\n",
        put: "            if (gone) this.goneTabs.delete(token);\n",
    },
    'rename-told-late': {
        why: 'a tab back under a new name before its old line was noticed dead was never matched to it',
        suite: 'lobbyroom', file: 'room.js',
        find: "            if (back) this.tellWas(back, peer);\n",
        put: "            if (back) { /* not told */ }\n",
    },
    'rename-duplicate': {
        why: 'Sonnet 11/17: a duplicated tab (Chrome copies the token) still playing was taken for the first one coming back, freeing the enemy of a fight that first tab was still in',
        suite: 'lobbyroom', file: 'room.js',
        find: ' && p.token === peer.token && peer.heard < p.at);', put: ' && p.token === peer.token);',
    },
    'decider-told': {
        why: 'known 11/14: the host person moving (two on the host\'s PC, the first gone) was never said; the second\'s Options never showed the run\'s options',
        suite: 'lobbyroom', file: 'room.js',
        find: "        if (now) this.send(now, { t: 'decides', on: true });\n", put: '',
    },
    'decider-stale': {
        why: 'Sonnet 11/17: the new host person sent their own saved options, which can predate the first one\'s change mid-run, and undid it for everyone',
        suite: 'app', file: 'client/state.js',
        find: '            ConfigManager.coopLoot = Coop.rules.loot;\n', put: '',
    },
    'witch-save': {
        why: 'Grok 11/17, round 1 of the floor switches: a save kept only the floor it stood on, so a run carried on from saves without the bed\'s world copy forgot the witch out on the other floor',
        suite: 'carry', file: 'client/state.js',
        find: ', el: el, fs: Object.keys(World.fs) };', put: ', el: el };',
    },
    'witch-load-overlay': {
        why: 'Grok 11/17, round 2: a load took the floor the save stood on from its switches, which after a door taken with the line down still showed the floor left, so the save lost her or woke the other floor\'s copy',
        suite: 'carry', file: 'client/state.js',
        find: '            for (const k of floors) if (/^\\d+,\\d+$/.test(k)) World.fs[k] = 1;\n',
        put: '            for (const k of floors) if (/^\\d+,\\d+$/.test(k)) World.fs[k] = 1;\n            const here = $gameMap.mapId();\n            if (here) for (const id of floorSw) if ($gameSwitches._data[id]) World.fs[here + \',\' + id] = 1; else delete World.fs[here + \',\' + id];\n',
    },
    'witch-line-back': {
        why: 'found designing the fix 11/17: a game that took a door while its line was down came back in still showing the witch of the floor it had left',
        suite: 'hounds', file: 'client/state.js',
        find: '        if (window.$gameMap && showFloor($gameMap.mapId())) changed = true;\n', put: '',
    },
    'pit-armed': {
        why: 'his call 11/14: the smash pit\'s guard armed himself by each machine\'s own timer and hunted one player while the partner saw him stand still',
        suite: 'smashpit', file: 'client/census.json',
        find: ',2932,2933,2934,', put: ',2932,2934,',
    },
    'pit-strikes': {
        why: 'his call 11/14: the smash pit\'s guard went on walking on the partner\'s screen while he struck the other player',
        suite: 'smashpit', file: 'client/census.json',
        find: ',2933,2934,2939,', put: ',2933,2939,',
    },
    'pit-blows': {
        why: 'the smash pit counted blows across both players (only ever turned on, so taken for world latches): one player\'s blow cost the other theirs',
        suite: 'smashpit', file: 'client/census.json',
        find: ',2933,2934,2939,', put: ',2933,2934,2937,2938,2939,',
    },
    'pit-death': {
        why: 'the third blow is a game over, so the pit never stood its guard down: in co-op the run goes on, and he stood frozen for the partner',
        suite: 'smashpit', file: 'client/death.js',
        find: 'for (const id of [2933, 2934, 2937, 2938]) $gameSwitches.setValue(id, false);', put: '',
    },
    'hounds-out': {
        why: 'report 11/13: the Fortress hounds came out on one machine only (each bark timer is its own), and invisible hounds fought the partner',
        suite: 'hounds', file: 'client/census.json',
        find: ',1780,1781,1783,', put: ',1780,1783,',
    },
    'knight-zone': {
        why: 'the level 5 knight spectre\'s zone switch stayed on the machine whose player stepped in',
        suite: 'hounds', file: 'client/census.json',
        find: ',359,360,361,', put: ',359,361,',
    },
    'knight-roll': {
        why: 'each player threw their own knight_random at the start, so the level 5 knight stood for one of them only',
        suite: 'hounds', file: 'room.js',
        find: "try { ONCE = JSON.parse(fs.readFileSync(path.join(__dirname, 'client', 'census.json'), 'utf8')).once || []; }",
        put: "try { ONCE = JSON.parse(fs.readFileSync(path.join(__dirname, 'client', 'census.json'), 'utf8')).once.filter((id) => id !== 61); }",
    },
    'crossed-writes': {
        why: 'fuzz 11/13: both players set Moonless\'s body down at once, and each screen ended with it at the other one\'s feet (a partner\'s write was applied over one of ours still on the way)',
        suite: 'crossed', file: 'client/state.js',
        find: '            if (inFlight.has(kind + key)) continue;\n', put: '',
    },
    'crossed-offline': {
        why: 'a write whose answer was lost with a broken line stayed counted on the way, so the partner\'s writes to that key were skipped for good',
        suite: 'crossed', file: 'client/state.js',
        find: '        inFlight.clear();\n', put: '',
    },
    'gnome-dead': {
        why: 'a cave gnome one player killed was alive for the other (its dead switch was kept on one machine)',
        suite: 'refight', file: 'client/census.json',
        find: ',302,303,304,305,306,307,', put: ',302,303,307,',
    },
    'beaten-scene': {
        why: 'a scene under way when its enemy was beaten in another fight started that fight again',
        suite: 'refight', file: 'client/battle.js',
        find: 'if (beaten && this._coopSince && this._coopSince <= beaten) {', put: 'if (false) {',
    },
    'meter-line': {
        why: 'his 10/21 "high ping": nothing measured the line to the host or kept either player\'s numbers',
        suite: 'meterline', file: 'room.js',
        find: "this.send(peer, { t: 'rtt', at: msg.at });", put: '',
    },
    'meter-relay': {
        why: 'the room kept players\' meters to its log and stopped passing them on: tools/stats.js heard nobody',
        suite: 'meterline', file: 'room.js',
        find: "            this.broadcast(msg, peer.id); // and passed on as before: tools/stats.js listens for it\n", put: '',
    },
    'host-notes': {
        why: 'players\' notes stayed in their own games: a session could not be read back from the host\'s PC (10/21)',
        suite: 'meterline', file: 'room.js',
        find: "                console.log(who + line.slice(0, 300).replace(/[\\r\\n]+/g, ' '));\n", put: '',
    },
    'log-rotate': {
        why: 'each start wrote over the last session\'s log, so his 10/20 session before the last one was gone',
        suite: 'meterline', file: 'server.js',
        find: "        try { fs.renameSync(n ? older(n) : LOG_FILE, older(n + 1)); } catch (e) { /* not there yet */ }\n", put: '',
    },
    'layout-once': {
        why: 'his 10/21: the Blood pit lizardman missing; any layout dice but three could be thrown again mid-run, changing a floor under everyone',
        suite: 'slips', file: 'room.js',
        find: "try { ONCE = JSON.parse(fs.readFileSync(path.join(__dirname, 'client', 'census.json'), 'utf8')).once || []; }", put: 'try { ONCE = [24, 25, 29]; }',
    },
    'player-route': {
        why: 'his friend 10/20: the lift\'s arrival walked the partner and left the cage hanging a tile up, unusable',
        suite: 'lift', file: 'client/state.js',
        find: 'if (c.code === 205 && c.parameters[0] === -1) { yes = true; break; }', put: '',
    },
    'walk-buffer': {
        why: 'his 10/21: a partner walking over a shaky line stopped between tiles whenever a step came late',
        suite: 'walk', file: 'client/presence.js',
        find: 'const WALK_DELAY = 200; // ms', put: 'const WALK_DELAY = 0; // ms',
    },
    'snake-slip': {
        why: 'his 10/20: the Salmonsnake on map 184 moved him to map 11, away from his partner, into a fight they could not join',
        suite: 'slips', file: 'client/fixes.js',
        find: "const SNAKE_SLIP = { '39:263': 11, '184:263': 11 };", put: 'const SNAKE_SLIP = {};',
    },
    'paste-box': {
        why: 'the Together link box took no clicks (0.1.0 to 0.1.3)',
        suite: 'paste', file: 'client/fixes.js',
        find: "strip.textContent = '#ErrorPrinter { pointer-events: none; } #ErrorPrinter * { pointer-events: auto; }';", put: "strip.textContent = '';",
    },
    'just-guard': {
        why: 'a guest\'s Just Guard never counted, and the charge killed him',
        suite: 'ai', file: 'client/battle.js',
        find: 'if (asksProtagonistGuard(this) && playersGuarding()) {', put: 'if (asksProtagonistGuard(this) && false) {',
    },
    'hidden-loop': {
        why: 'a minimised or covered window froze fights for everyone',
        suite: 'humans', file: 'client/fixes.js',
        find: 'if (document.hidden && othersHere()) nextBeat(go); else requestAnimationFrame(go);', put: 'requestAnimationFrame(go);',
    },
    'menu-trade': {
        why: 'nothing could be handed to a player standing in their own menu',
        suite: 'trade', file: 'client/trade.js',
        find: "const REACHABLE = ['map', 'event', 'menu'];", put: "const REACHABLE = ['map', 'event'];",
    },
    'version-gate': {
        why: 'another release of the game or the mod would share a world it cannot',
        suite: 'server', file: 'server.js',
        find: 'if (theirs.build !== BUILD.build || theirs.mod !== BUILD.mod) {', put: 'if (false) {',
    },
    'dns-wait': {
        why: 'links were handed out before Cloudflare published them',
        suite: 'publish', file: 'tools/tunnel.js',
        find: 'zoneServers().then(viaZone).catch(() => viaHttps());', put: 'done();',
    },
    'dns-authoritative': {
        why: 'links were held up to 90 s: asked too early, the public resolver remembered "no such name" for a minute',
        suite: 'publish', file: 'tools/tunnel.js',
        find: 'zoneServers().then(viaZone).catch(() => viaHttps());', put: 'viaHttps();',
    },
    'quiet-line': {
        why: 'a joiner\'s line that died without closing went unnoticed: his game played on alone for minutes',
        suite: 'quietline', file: 'server.js',
        find: 'if (Date.now() - heard > DEAD_AFTER) {', put: 'if (false) {',
    },
    'quiet-handshake': {
        why: 'a try to reach the host whose handshake a dead line swallowed waited forever, so the joiner never got back',
        suite: 'quietline', file: 'server.js',
        find: ', handshakeTimeout: 10000 });', put: ' });',
    },
    'own-ghost': {
        why: 'a joiner back before the host noticed its old line was dead took its own old self for another player and stayed out of the world',
        suite: 'quietline', file: 'client/state.js',
        find: 'if (Coop.name && String(peer.name).toLowerCase() === Coop.name.toLowerCase()) continue;', put: '',
    },
    'chat-resend': {
        why: 'a chat line said while the line was down, or into a line that had died, was lost',
        suite: 'chat', file: 'client/chat.js',
        find: "for (const l of unsent) Coop.send({ t: 'chat', text: l.text, id: l.id });", put: '',
    },
    'chat-once': {
        why: 'a chat line said again after a reconnect showed twice when it had arrived the first time',
        suite: 'chat', file: 'room.js',
        find: 'if (!id || !this.chatSeen.has(id)) this.broadcast(msg, peer.id);', put: 'this.broadcast(msg, peer.id);',
    },
    'service-address': {
        why: 'Cloudflare\'s own service, named in cloudflared\'s errors, became the link and the panel waited for nothing',
        suite: 'publish', file: 'tools/tunnel.js',
        find: '(?!api\\.)', put: '',
    },
    'drop-notice': {
        why: 'a host whose tunnel dropped was not told, and friends were left with a dead link',
        suite: 'publish', file: 'client/together.js',
        find: 'if (dropSeen !== null && s.droppedAt && s.mode === \'local\') {', put: 'if (false) {',
    },
    'hunger-rate': {
        why: 'hunger drained at the solo rate in co-op, where nobody can pause',
        suite: 'hunger', file: 'client/rules.js',
        find: 'if (this._waitCount > 0 && isHungerDrain(this._list) && Coop.playingTogether()) {', put: 'if (false) {',
    },
    'restart-host': {
        why: 'Stop hosting then Host online at once: the old cloudflared\'s exit took the new tunnel\'s place, and no link came',
        suite: 'humans', file: 'tools/tunnel.js', env: { FH_TEST_TUNNEL: '1', FH_TEST_RELAY: '1' },
        find: "if (this.proc !== proc) { reject(new Error('stopped')); return; }", put: '',
    },
    'name-trim': {
        why: 'the box added the letter under its cursor on Enter, "O LORD " was not the prayer, and a Steam Deck player got no Black orb',
        suite: 'scroll', file: 'client/fixes.js',
        find: 'return this._name.trim();', put: 'return this._name;',
    },
    'typed-key': {
        why: 'the space bar typed a space and also pressed the name box\'s OK: it finished the box when its cursor was on OK',
        suite: 'scroll', file: 'client/fixes.js',
        find: "for (const b of ['ok', 'cancel']) if (Input.isTriggered(b)) held[b] = true;", put: '',
    },
    'typing-enter': {
        why: 'Enter after a typed word put the letter under the name box\'s grid cursor in: "o lord" became "o lordA"',
        suite: 'scroll', file: 'client/fixes.js',
        find: 'if (this._coopTyping && this.character()) SoundManager.playBuzzer();', put: 'if (false) SoundManager.playBuzzer();',
    },
    'verse-case': {
        why: 'the scroll\'s verses were compared capitals and all: "o lord teach black orb" taught nothing',
        suite: 'scroll', file: 'client/fixes.js',
        find: 'actor.name().toUpperCase() === String(p[3]).toUpperCase();', put: 'actor.name() === String(p[3]);',
    },
    'slow-host': {
        why: 'a host who took over 25 s on their own move left the AI partner never asked for its turn',
        suite: 'plain', file: 'client/battle.js',
        find: '            if (newTurn) b.ctlAt = Date.now();\n            const who = controller(b);\n',
        put: '            const who = controller(b);\n            if (newTurn) b.ctlAt = Date.now();\n',
    },
    'chat-trim': {
        why: 'a chat line from a sender that is not Coop.say kept the spaces at its ends',
        suite: 'scroll', file: 'client/chat.js',
        find: "const text = String(msg.text || '').trim().slice(0, 200);", put: "const text = String(msg.text || '').slice(0, 200);",
    },
    'load-fade': {
        why: 'his 11/03: Continue from a fresh page into a run under way read the title\'s map for a shelf\'s home, the join threw, Enki stood "at the title"',
        suite: 'loadfade', file: 'client/state.js',
        find: 'return !!(window.$gameMap && window.$dataMap && $dataMap.events && dataMapId === $gameMap.mapId());',
        put: 'return !!(window.$gameMap && window.$dataMap && $dataMap.events);',
    },
    'title-ghost': {
        why: 'his 11/03: a join that broke kept Enki in the run for good, and pho could not load his own save',
        suite: 'ghost', file: 'room.js',
        find: "if (peer.live && msg.st === 'title') {", put: 'if (false) {',
    },
    'named-only': {
        why: 'his 11/03 ("only answer when named"): with Enki at the title the partner counted one person and answered every line',
        suite: 'plain', file: 'tools/bot-page.js',
        find: 'if (humans().filter((p) => p.st).length >= 2)', put: "if (humans().filter((p) => p.st && p.st !== 'title').length >= 2)",
    },
    'plays-pick': {
        why: 'his 11/03: pick who the partner plays',
        suite: 'setup', file: 'partners.js',
        find: 'const free = CAST.find((c) => c[0] === want && !used.has(c[1])) || CAST.find((c) => !used.has(c[1]));',
        put: 'const free = CAST.find((c) => !used.has(c[1]));',
    },
    'plays-home': {
        why: 'his 11/03 pick: a body sent home of another character came back instead of the one picked',
        suite: 'plays', file: 'partners.js',
        find: '(want && this.cast.get(home) && this.cast.get(home) !== want) || ', put: '',
    },
    'plays-name': {
        why: 'Grok 11/03: under a configured name, another pick took the parked body\'s name, read its park and spent it',
        suite: 'plays', file: 'partners.js',
        find: '            taken = new Set([...taken, home.toLowerCase()]);\n', put: '',
    },
    'ask-owner': {
        why: 'Grok 11/03: its question opened the reply window for whoever spoke to it last, not the one it asked',
        suite: 'plain', file: 'tools/bot-page.js',
        find: 'if (to && /\\?/.test(text)) BOT.askedYou = { id: to, until: Date.now() + 15000 };',
        put: 'if (/\\?/.test(text)) BOT.askedYou = { id: 0, until: Date.now() + 15000 };',
    },
    'way-choice': {
        why: 'field 11/06: a Cahara partner on a circle trip kept pressing the Blood pit\'s hole; its Jump down was left to the model, which looked instead',
        suite: 'pit', file: 'tools/bot-page.js', env: { FH_PIT: 'A' },
        find: 'const way = wayChoice();', put: 'const way = -1;',
    },
    'shut-corridor': {
        why: '11/06: the Caverns landing leads to a Mines corner where Nosramus blocks the circle; the plan by maps sent the partner down the hole anyway (since 11/08 anyone standing who does not step aside; without the wall A plans through the Caverns and finds no path)',
        suite: 'pit', file: 'tools/bot-page.js', env: { FH_PIT: 'A' },
        find: 'if (stands(page) && !door && !(sets && stepsAside(ev, page, sets, on))) wall[y * w + x] = 1;', put: 'if (false) wall[y * w + x] = 1;',
    },
    'clear-way': {
        why: 'his call 11/08 ("what would players want"): Nosramus in the Mines corridor left the partner no way to the circle; a player waits for him to walk away',
        suite: 'pit', file: 'tools/bot-page.js', env: { FH_PIT: 'B' },
        find: 'await Nav.plan(isGoal, { clear: e.kind === \'circle\' });', put: 'await Nav.plan(isGoal, { clear: false });',
    },
    'clear-choice': {
        why: '11/08: walking up to Nosramus, the question that sends him off is the trip\'s to answer ("Wait", never "Show yourself"), not the model\'s',
        suite: 'pit', file: 'tools/bot-page.js', env: { FH_PIT: 'B' },
        find: 'const clear = clearChoice();', put: 'const clear = -1;',
    },
    'locked-door-walk': {
        why: 'his call 11/06: the long way to Level 1\'s circle stopped at the Level 2 basement\'s locked door, a wall to the partner\'s walking',
        suite: 'pitc', file: 'tools/bot-page.js', rests: ['test/pit.js'],
        find: '|| (force ? Nav.search(goalX, goalY, eventId, adjacentOk, false, true) : null);', put: ';',
    },
    'locked-door-answer': {
        why: '11/06: at a locked door on a circle trip the question went to the model (which can say Leave)',
        suite: 'pitc', file: 'tools/bot-page.js', rests: ['test/pit.js'],
        find: 'const door = doorChoice();', put: 'const door = null;',
    },
    'fight-through': {
        why: 'his call 11/06 "fight thru": a monster left standing in a corridor ended a circle trip for minutes',
        suite: 'pitc', file: 'tools/bot-page.js', rests: ['test/pit.js'],
        find: '!(force && (lockedDoor(ev) || foe(ev)))', put: '!(force && lockedDoor(ev))',
    },
    'sight-mid-transfer': {
        why: '11/06: the partner\'s remark timer read its surroundings while a transfer had the next map\'s data in: an event id that map has not got, a crash that halted its game',
        suite: 'pitc', file: 'tools/bot-page.js', rests: ['test/pit.js'],
        find: "    function sightList() {\n        if (!window.$gameMap || !window.$dataMap || !(SceneManager._scene instanceof Scene_Map) || $gamePlayer.isTransferring()) return [];",
        put: "    function sightList() {\n        if (!window.$gameMap || !window.$dataMap || !(SceneManager._scene instanceof Scene_Map)) return [];",
    },
    // The lobby's rules at the room (spec/Lobby.tla): one twin per guard a night depends on.
    'lob-rename-line': {
        why: 'Grok g14: a name changed while called in left the old name loading for ever (the partner never came in) and freed their character',
        suite: 'lobbyroom', file: 'room.js',
        find: 'if (this.lobby.line.delete(was)) this.lobby.line.add(name.toLowerCase());', put: '',
    },
    'lob-hold-call': {
        why: 'Grok g14: a line that dropped during the opening lost the call; a third person could take the character and the first was refused at the door',
        suite: 'lobbyroom', file: 'room.js',
        find: 'if (!here && !cancel && this.lobby.line.has(who)) {', put: 'if (false) {',
    },
    'lob-hold-door': {
        why: 'Grok g14: a held character is held at the door too, against a game that never asked the lobby',
        suite: 'lobbyroom', file: 'room.js',
        find: "                || (!called && [...this.lobby.held.values()].find((hold) => ini.indexOf(hold.char) >= 0));\n", put: ';\n',
    },
    'lob-hold-ends': {
        why: 'a call held for someone who never comes back would keep the partner out for ever',
        suite: 'lobbyroom', file: 'room.js',
        find: 'const timer = setTimeout(() => { this.holdEnds(who); this.lobbyTell(); }, LINE_HOLD);', put: 'const timer = setTimeout(() => {}, LINE_HOLD);',
    },
    'lob-rename-entered': {
        why: 'Grok g14: a name changed after leaving a run let that person\'s old save back into it (their body from the past)',
        suite: 'lobbyroom', file: 'room.js',
        find: 'if (this.entered.has(was)) this.entered.add(name.toLowerCase());', put: '',
    },
    'lob-all-ready': {
        why: 'his rule 11/08: Start only when every person here is ready',
        suite: 'lobbyroom', file: 'room.js',
        find: '            if (waiting.length) { no(', put: '            if (false) { no(',
    },
    'lob-away': {
        why: 'his rule 11/08: someone idle at the title is away and does not hold Start up',
        suite: 'lobbyroom', file: 'room.js',
        find: 'this.atTitle(p) && !(p.lob && p.lob.away) && !(p.lob && p.lob.ready)', put: 'this.atTitle(p) && !(p.lob && p.lob.ready)',
    },
    'lob-host-founds': {
        why: 'called by the host\'s Start, a joiner done loading first went on alone after two minutes and founded the run',
        suite: 'lobbyroom', file: 'room.js',
        find: 'if (now - peer.hostWaitSince < HOST_WAIT || this.inLine(host)) {', put: 'if (now - peer.hostWaitSince < HOST_WAIT) {',
    },
    'lob-one-each': {
        why: 'two saves of one character both ready: the second is refused only after loading',
        suite: 'lobbyroom', file: 'room.js',
        find: 'if (others.some((p) => (p === host || (p.lob && p.lob.ready)) && this.lobbyChar(p) === mine)) { no(taken(mine)); break; }', put: '',
    },
    'lob-pick-taken': {
        why: 'a character someone here has picked, or someone in the run plays, could be picked again',
        suite: 'lobbyroom', file: 'room.js',
        find: '            if (want && (others.some((p) => this.lobbyChar(p) === want) || this.lobbyBusy().has(want))) { no(taken(want)); break; }\n', put: '',
    },
    'lob-ready-holds': {
        why: 'ready says what that person will load: no other pick while ready',
        suite: 'lobbyroom', file: 'room.js',
        find: '            if (lob.ready) { no(', put: '            if (false) { no(',
    },
    'lob-save-turns': {
        why: 'a ready person whose save turned out to be another character stayed ready for the first',
        suite: 'lobbyroom', file: 'room.js',
        find: '            if (!lob.pick) lob.ready = false;\n', put: '',
    },
    'lob-run-resets': {
        why: 'another run chosen: ready and picks given for the last one carried into it',
        suite: 'lobbyroom', file: 'room.js',
        find: '            this.lobbyReset();\n            const run = msg.run || {};\n', put: '            const run = msg.run || {};\n',
    },
    'lob-host-drop': {
        why: '11/08 design hole: the host\'s game dropped during the start and the start went on without them',
        suite: 'lobbyroom', file: 'room.js',
        find: 'if (cancel) this.lobbyReset();', put: '',
    },
    'lob-called-off': {
        why: 'a game called by a start that was then called off founded a run on its way back to the title',
        suite: 'lobbyroom', file: 'room.js',
        find: 'if (peer.calledOff && !this.founded) {', put: 'if (false) {',
    },
    'lob-run-lost': {
        why: '11/11 (spec): the run ended under someone called in by Join, and their game founded a run of its own',
        suite: 'lobbyroom', file: 'room.js',
        find: '        for (const p of this.peers.values()) if (p.named && this.inLine(p)) p.calledOff = true;\n', put: '',
    },
    'lob-line-title': {
        why: 'called in and never started: everyone (or the partner) waited on them for ever',
        suite: 'lobbyroom', file: 'room.js',
        find: 'else if (Date.now() - peer.lineSince > LINE_TITLE) {', put: 'else if (false) {',
    },
    'lob-bot-waits': {
        why: 'an AI partner came in before the people called, and could take the character one of them had picked',
        suite: 'lobbyroom', file: 'room.js',
        find: 'if (this.isBot(peer) && this.lobby.line.size) {', put: 'if (false) {',
    },
    'lob-bot-founds': {
        why: '11/11 (spec): a partner still loading when the only person in dropped founded a run of its own, and that person\'s game was refused its own run',
        suite: 'lobbyroom', file: 'room.js',
        find: 'if (this.isBot(peer) && !this.founded && !msg.lead) {', put: 'if (false) {',
    },
    'lob-uncalled': {
        why: '11/11 (spec): an uncalled game arrived as a called person\'s character, and the called one was refused at the door',
        suite: 'lobbyroom', file: 'room.js',
        find: ': !called && this.inLine(p) && ini.indexOf(this.lobbyChar(p)) >= 0))', put: ': false))',
    },
    'lob-other-night': {
        why: '11/11 (spec): a run founded by someone uncalled left the others ready and picked for the night that never started',
        suite: 'lobbyroom', file: 'room.js',
        find: '            if (founded && !called) this.lobbyReset();\n            else if (founded) this.lobby.run = null;\n', put: '            if (founded) this.lobby.run = null;\n',
    },
    // ...and on the page (client/lobby.js), through the real title.
    'lob-game-up': {
        why: '11/10, the first browser run: presence said "title" through the opening, so the start was called off after 15 s',
        suite: 'lobby', file: 'client/presence.js',
        find: 'const up = scene && !(scene instanceof Scene_Title || scene instanceof Scene_Boot || scene instanceof Scene_Load || scene instanceof Scene_Options) ? 1 : 0;', put: 'const up = 0;',
    },
    'lob-picker': {
        why: 'his rule 11/08: the game\'s own select screen plays, held to the character picked in the lobby',
        suite: 'lobby', file: 'client/lobby.js',
        find: '            if (picking()) {\n', put: '            if (false) {\n',
    },
    'lob-bounce': {
        why: 'the host\'s game dropped during the start: the friend\'s game played on into a run that would never be',
        suite: 'lobbysave', file: 'client/lobby.js',
        find: "{ World._bounce = true; if (Coop.toast) Coop.toast('The start was called off. Back to the title.', 6000); }", put: '{ }',
    },
    'locked-door-order': {
        why: '11/06: force first (free, the door never strikes back); a key is spent only once forcing failed',
        suite: 'pitc', file: 'tools/bot-page.js', rests: ['test/pit.js'],
        find: "const o = pick('open') || (d.forced ? pick('item') || pick('force') : pick('force') || pick('item'));", put: "const o = pick('open') || pick('item') || pick('force');",
    },
};

// The twin's source for `file` (repo-relative, forward slashes), or null when the twin is not for it.
function twinSource(name, file, text) {
    const t = TWINS[name];
    if (!t || t.file !== file) return null;
    const nl = text.includes('\r\n') ? '\r\n' : '\n';
    const find = t.find.split('\n').join(nl), put = t.put.split('\n').join(nl);
    const at = text.indexOf(find);
    if (at < 0 || text.indexOf(find, at + 1) >= 0) throw new Error(`twin ${name}: its code in ${file} is gone or not unique; update test/twins.js`);
    // Each page and server that got the twin says so: a run where nothing did is no run.
    try { fs.mkdirSync(OUT, { recursive: true }); fs.appendFileSync(path.join(OUT, name + '.applied'), file + '\n'); } catch (e) { /* counted elsewhere */ }
    return text.slice(0, at) + put + text.slice(at + find.length);
}

function check() {
    let bad = 0;
    for (const [name, t] of Object.entries(TWINS)) {
        const text = fs.readFileSync(path.join(ROOT, t.file), 'utf8').split('\r\n').join('\n');
        const n = text.split(t.find).length - 1;
        if (n !== 1) { bad++; console.log(`FAIL twin ${name}: found ${n} times in ${t.file} (needs exactly 1)`); }
        if (!fs.existsSync(path.join(__dirname, t.suite + '.js'))) { bad++; console.log(`FAIL twin ${name}: no suite test/${t.suite}.js`); }
    }
    return bad;
}

const LOGS = process.env.FH_TEST_LOGS_DIR || OUT;

// One suite, with a twin in place or none. Its whole output goes to LOGS.
function runSuite(suite, twin, log, vars) {
    return new Promise((resolve) => {
        const env = Object.assign({}, process.env, vars || {});
        if (twin) env.FH_TWIN = twin;
        // The suite too: a check that calls the mod's own code directly gets the twin.
        const hook = twin ? ['-r', path.join(__dirname, 'twin-hook.js')] : [];
        const child = spawn(process.execPath, [...hook, path.join(__dirname, suite + '.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '', killed = false;
        child.stdout.on('data', (d) => { out += d; });
        child.stderr.on('data', (d) => { out += d; });
        const timer = setTimeout(() => {
            killed = true;
            out += '\nkilled after 10 minutes';
            if (process.platform === 'win32') spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
            else child.kill();
        }, 600000);
        child.on('close', (code) => {
            clearTimeout(timer);
            fs.mkdirSync(LOGS, { recursive: true });
            fs.writeFileSync(path.join(LOGS, log + '.txt'), out);
            resolve({ code, out, killed });
        });
    });
}

// What a twin's verdict rests on: its own definition, the file it breaks and the suite that
// has to notice (and what that suite is built on: rests, pitc on pit.js). While none of them has changed
// since it was last caught, the verdict stands (FH_TWINS_CHANGED=1, the gate: 55 twins one at a time
// were 15 minutes of every run).
const PROVEN = path.join(__dirname, 'out', 'twins-proven.json');
function stampOf(name) {
    const t = TWINS[name];
    const h = require('crypto').createHash('sha1');
    h.update(JSON.stringify(t));
    for (const f of [t.file, 'test/' + t.suite + '.js'].concat(t.rests || [])) h.update(fs.readFileSync(path.join(ROOT, f)));
    return h.digest('hex');
}

const clean = {};
async function runTwin(name) {
    const t = TWINS[name];
    const started = Date.now();
    // The control: the suite passes as shipped, here and now. Otherwise its failure with the
    // twin says nothing. (The gate has just run every suite clean, and says so.)
    // A twin's env: the way of playing its suite must run in (a real tunnel, say).
    const key = t.suite + (t.env ? ' ' + JSON.stringify(t.env) : '');
    if (!process.env.FH_TWINS_CLEAN_RUN && clean[key] === undefined) {
        const r = await runSuite(t.suite, null, t.suite + '.clean', t.env);
        clean[key] = r.code === 0 && /^all [1-9]\d* passed$/m.test(r.out);
    }
    if (clean[key] === false) {
        console.log(`FAIL ${name.padEnd(16)} ${t.suite.padEnd(9)} the suite fails without the twin too: no verdict (log ${t.suite}.clean.txt)`);
        return false;
    }
    const applied = path.join(OUT, name + '.applied');
    fs.rmSync(applied, { force: true });
    const { code, out, killed } = await runSuite(t.suite, name, name, t.env);
    let times = 0;
    try { times = fs.readFileSync(applied, 'utf8').trim().split('\n').filter(Boolean).length; } catch (e) { /* never applied */ }
    // Caught = the suite's own checks failed with the twin in place: a FAIL line, not a
    // crash or a run killed for taking too long. The line is shown, to read that it failed
    // for the right reason.
    const reason = out.split('\n').find((l) => /^FAIL /.test(l)) || '';
    const caught = code !== 0 && times > 0 && !!reason && !killed;
    const secs = Math.round((Date.now() - started) / 1000);
    const verdict = times === 0 ? 'NOT APPLIED' : killed ? 'TIMED OUT' : caught ? 'caught' : code !== 0 ? 'NO FAIL LINE' : 'MISSED';
    console.log(`${caught ? 'ok  ' : 'FAIL'} ${name.padEnd(16)} ${t.suite.padEnd(9)} ${secs}s  ${verdict}${times ? ' (applied ' + times + 'x)' : ''}  ${reason.trim().slice(0, 160)}`);
    if (!caught) console.log(`       the fix: ${t.why}`);
    return caught;
}

module.exports = { TWINS, twinSource };

if (require.main === module) {
    const args = process.argv.slice(2);
    if (args[0] === '--check') {
        const bad = check();
        console.log(bad ? `${bad} twin problem(s)` : `all ${Object.keys(TWINS).length} passed`);
        process.exit(bad ? 1 : 0);
    }
    if (process.env.FH_TWIN) { console.error('FH_TWIN is set in this shell: unset it first.'); process.exit(2); }
    let names = args.length ? args : Object.keys(TWINS);
    let proven = {};
    try { proven = JSON.parse(fs.readFileSync(PROVEN, 'utf8')); } catch (e) { /* none caught yet */ }
    let stood = 0;
    if (process.env.FH_TWINS_CHANGED && !args.length) {
        const all = names.length;
        names = names.filter((n) => proven[n] !== stampOf(n));
        stood = all - names.length;
        console.log(stood + ' twin(s) stand as last caught (nothing they rest on changed); ' + names.length + ' to run');
    }
    for (const n of names) if (!TWINS[n]) { console.error('no such twin: ' + n + ' (' + Object.keys(TWINS).join(', ') + ')'); process.exit(2); }
    if (check()) process.exit(1);
    if (!require('./lock')()) { console.error('Another test run is using the ports (test/out/run.lock). Wait for it, or end it.'); process.exit(2); }
    (async () => {
        const started = Date.now();
        const missed = [];
        // Each runs a whole suite with its usual ports, and every suite has ports of its own (run.js runs six
        // at once), so the twins of different suites run side by side and one suite's twins one after another
        // (11/20: 81 twins one at a time were two and a half hours of the gate). Only run.js's suites are kept
        // apart; any other (endings: its cases sit on lift's, publish's, quietline's ports) runs alone, after:
        // a twin failing on a taken port would pass for caught.
        const jobs = Math.max(1, Number(process.env.FH_TEST_JOBS) || Math.min(6, Math.floor(require('os').cpus().length / 2)));
        const inRun = new Set((fs.readFileSync(path.join(__dirname, 'run.js'), 'utf8').match(/const ALL = \[([^\]]*)\]/)[1].match(/'[\w-]+'/g) || []).map((s) => s.slice(1, -1)));
        const bySuite = new Map();
        for (const n of names) bySuite.set(TWINS[n].suite, (bySuite.get(TWINS[n].suite) || []).concat(n));
        const lanes = [...bySuite.values()].filter((g) => inRun.has(TWINS[g[0]].suite)).sort((a, b) => b.length - a.length);
        const alone = [...bySuite.values()].filter((g) => !inRun.has(TWINS[g[0]].suite)).flat();
        const one = async (n) => {
            if (await runTwin(n)) proven[n] = stampOf(n); else { missed.push(n); delete proven[n]; }
            fs.writeFileSync(PROVEN, JSON.stringify(proven, null, 1));
        };
        await Promise.all(Array.from({ length: Math.min(jobs, lanes.length) }, async () => {
            while (lanes.length) for (const n of lanes.shift()) await one(n);
        }));
        for (const n of alone) await one(n);
        const secs = Math.round((Date.now() - started) / 1000);
        console.log(missed.length ? `${missed.length} twin(s) not caught (${secs}s): ${missed.join(' ')}` : names.length ? `all ${names.length} passed (${secs}s): every twin was caught` : 'no twin to run: all ' + stood + ' stand');
        if (process.env.FH_TEST_RESULT) fs.writeFileSync(process.env.FH_TEST_RESULT, JSON.stringify({ suites: names.length, stood, broken: missed, flaky: [], secs }));
        process.exit(missed.length ? 1 : 0);
    })();
}
