//=============================================================================
// fh-coop: overhearing. A conversation belongs to the player who started it:
// only they get the text box and make the choices. A partner standing nearby
// sees the same lines as captions at the top of their screen, and which
// answer was picked, without being stopped or asked anything.
//=============================================================================
(function () {
    const EARSHOT = 9; // tiles

    const box = document.createElement('div');
    box.id = 'coop-caption';
    box.style.cssText = 'position:fixed;left:50%;top:4%;transform:translateX(-50%);z-index:58;pointer-events:none;max-width:62%;'
        + 'font:16px/1.4 Georgia,"Times New Roman",serif;color:#e0d4bc;background:rgba(12,8,7,0.78);border:1px solid #4a3c30;'
        + 'padding:8px 14px;text-align:left;white-space:pre-line;opacity:0;transition:opacity 0.35s;';
    (document.body ? Promise.resolve() : new Promise((r) => window.addEventListener('DOMContentLoaded', r))).then(() => document.body.appendChild(box));

    // Turns the game's message markup into plain words: names and numbers
    // filled in, colours, pauses and layout codes dropped.
    function plain(text) {
        let speaker = '';
        let t = String(text).replace(/\\/g, '\x1b').replace(/\x1b\x1b/g, '\\');
        for (let pass = 0; pass < 2; pass++) {
            t = t.replace(/\x1bV\[(\d+)\]/gi, (m, n) => $gameVariables.value(Number(n)));
        }
        t = t.replace(/\x1bN\[(\d+)\]/gi, (m, n) => { const a = Number(n) >= 1 ? $gameActors.actor(Number(n)) : null; return a ? a.name() : ''; });
        t = t.replace(/\x1bP\[(\d+)\]/gi, (m, n) => { const a = $gameParty.members()[Number(n) - 1]; return a ? a.name() : ''; });
        t = t.replace(/\x1bG/gi, TextManager.currencyUnit);
        t = t.replace(/\x1bN[CR]?<([^>]*)>/gi, (m, name) => { speaker = name; return ''; });
        t = t.replace(/<(?:WordWrap|br|line break)>/gi, ' ');
        t = t.replace(/\x1b[A-Za-z]+\[[^\]]*\]/g, '').replace(/\x1b[A-Za-z]+<[^>]*>/g, '').replace(/\x1b[A-Za-z]*[.|!><^{}$]?/g, '');
        t = t.replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').trim();
        return { speaker: plain.strip(speaker), text: t };
    }
    plain.strip = (s) => String(s).replace(/\x1b[A-Za-z]+\[[^\]]*\]/g, '').replace(/\x1b./g, '').trim();
    Coop.plainText = plain;

    function listeners() {
        if (!Coop.world.live || $gameParty.inBattle()) return [];
        return Coop.peersHere().filter((p) => Coop.distanceTo(p) <= EARSHOT);
    }

    // Every page of text this player is shown.
    const _startMessage = Window_Message.prototype.startMessage;
    Window_Message.prototype.startMessage = function () {
        try {
            const near = listeners();
            if (near.length) {
                const said = plain($gameMessage.allText());
                if (said.text) for (const p of near) Coop.sendTo(p.id, 'say', said);
            }
        } catch (e) { console.warn('[coop] could not pass a line on', e); }
        _startMessage.call(this);
    };

    // The answer they pick.
    const _choiceOk = Window_ChoiceList.prototype.callOkHandler;
    Window_ChoiceList.prototype.callOkHandler = function () {
        try {
            const near = listeners();
            if (near.length) {
                const picked = plain(this.commandName(this.index())).text;
                if (picked) for (const p of near) Coop.sendTo(p.id, 'say', { choice: picked });
            }
        } catch (e) { console.warn('[coop] could not pass a choice on', e); }
        _choiceOk.call(this);
    };

    let timer = 0;
    Coop.on('to:say', function (msg) {
        const peer = Coop.peers.get(msg.from);
        if (!peer || !Coop.world.live) return;
        let line;
        if (msg.choice) line = peer.name + ' answers: ' + msg.choice;
        else line = (msg.speaker ? msg.speaker + ' (to ' + peer.name + '):' : 'To ' + peer.name + ':') + '\n' + String(msg.text).slice(0, 600);
        box.textContent = line;
        const scale = Math.max(1, Math.min(2.4, (Graphics._realScale || 1) * 0.75));
        box.style.fontSize = Math.round(16 * scale) + 'px';
        box.style.opacity = '1';
        clearTimeout(timer);
        timer = setTimeout(function () { box.style.opacity = '0'; }, Math.max(3000, Math.min(11000, line.length * 70)));
    });
})();
