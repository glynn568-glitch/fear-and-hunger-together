//=============================================================================
// fh-coop: holding Tab shows every partner's character as they stand: health,
// hunger, what they wear and what they carry. Each player's own machine
// answers for its own character; AI partners answer the same way.
//=============================================================================
(function () {
    const style = document.createElement('style');
    style.textContent = [
        '#coop-sheets { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 81; pointer-events: none; display: none;',
        '  gap: 14px; flex-wrap: wrap; justify-content: center; max-width: 96vw;',
        '  font: 15px/1.4 Georgia, "Times New Roman", serif; color: #d8c9a8; }',
        '#coop-sheets.on { display: flex; }',
        '#coop-sheets .sheet { background: rgba(12, 8, 7, 0.93); border: 1px solid #4a3c30; padding: 12px 16px; min-width: 15em; max-width: 22em; }',
        '#coop-sheets h2 { margin: 0 0 2px; font-size: 1.15em; font-weight: normal; color: #f2d28a; }',
        '#coop-sheets .sub { color: #8d8370; margin-bottom: 8px; }',
        '#coop-sheets .k { color: #8d8370; }',
        '#coop-sheets ul { margin: 2px 0 8px; padding-left: 1.1em; }',
        '#coop-sheets .empty { color: #8d8370; font-style: italic; }',
    ].join('\n');
    document.head.appendChild(style);
    const box = document.createElement('div');
    box.id = 'coop-sheets';
    (document.body ? Promise.resolve() : new Promise((r) => window.addEventListener('DOMContentLoaded', r))).then(() => document.body.appendChild(box));

    // The game keeps hunger as experience points: 157 is full, below 58 starves.
    function hunger(actor) {
        const e = actor.currentExp();
        return e >= 140 ? 'full' : e >= 108 ? 'fed' : e >= 88 ? 'hungry' : e >= 58 ? 'weak with hunger' : 'starving';
    }

    function mySheet() {
        const me = window.$gameParty && $gameParty.leader();
        if (!me || !Coop.world.live) return null;
        const bag = [];
        for (const it of $gameParty.items()) bag.push(it.name + ($gameParty.numItems(it) > 1 ? ' x' + $gameParty.numItems(it) : ''));
        for (const w of $gameParty.weapons()) bag.push(w.name);
        for (const a of $gameParty.armors()) bag.push(a.name);
        return {
            name: Coop.name, character: me.name(), hp: me.hp, mhp: me.mhp, mp: me.mp, mmp: me.mmp,
            hunger: hunger(me), dead: !!Coop.dead, bot: !!Coop.isBot,
            states: me.states().map((s) => s.name).filter((n) => n && n !== n.toUpperCase()),
            worn: me.equips().filter(Boolean).map((e) => e.name),
            bag,
        };
    }

    Coop.on('to:sheet?', function (msg) {
        const sheet = mySheet();
        if (sheet) Coop.sendTo(msg.from, 'sheet', { sheet });
    });

    const sheets = new Map(); // player id -> sheet
    Coop.on('to:sheet', function (msg) {
        if (msg.sheet && box.classList.contains('on')) { sheets.set(msg.from, msg.sheet); draw(); }
    });
    Coop.on('leave', function (peer) { sheets.delete(peer.id); });

    function esc(s) {
        return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    }
    function list(items) {
        return items.length ? '<ul>' + items.map((i) => '<li>' + esc(i) + '</li>').join('') + '</ul>' : '<div class="empty">nothing</div>';
    }
    function draw() {
        const scale = Math.max(1, Math.min(2, (Graphics._realScale || 1) * 0.7));
        box.style.fontSize = Math.round(15 * scale) + 'px';
        const rows = [];
        for (const s of sheets.values()) {
            rows.push('<div class="sheet"><h2>' + esc(s.character) + '</h2>'
                + '<div class="sub">' + esc(s.name) + (s.bot ? ' (AI partner)' : '') + '</div>'
                + '<div><span class="k">Health</span> ' + (s.dead ? 'dead' : s.hp + ' / ' + s.mhp) + ' &nbsp; <span class="k">Mind</span> ' + s.mp + ' / ' + s.mmp + '</div>'
                + '<div><span class="k">Hunger</span> ' + esc(s.hunger) + (s.states.length ? ' &nbsp; <span class="k">State</span> ' + esc(s.states.join(', ')) : '') + '</div>'
                + '<div class="k" style="margin-top:6px">Wearing</div>' + list(s.worn)
                + '<div class="k">Carrying</div>' + list(s.bag) + '</div>');
        }
        box.innerHTML = rows.length ? rows.join('') : '<div class="sheet"><div class="empty">Nobody else is in the dungeon.</div></div>';
    }

    // Held, not toggled: the sheets show while Tab is down.
    let asking = 0;
    function show() {
        if (box.classList.contains('on') || !Coop.world.live) return;
        sheets.clear();
        box.classList.add('on');
        draw();
        const ask = function () { for (const p of Coop.others()) if (p.st && p.st !== 'title') Coop.sendTo(p.id, 'sheet?', {}); };
        ask();
        asking = setInterval(ask, 1000);
    }
    function hide() {
        box.classList.remove('on');
        clearInterval(asking);
    }
    window.addEventListener('keydown', function (e) {
        if (e.code !== 'Tab' || e.ctrlKey || e.altKey || e.metaKey) return;
        if (document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!e.repeat) show();
    }, true);
    window.addEventListener('keyup', function (e) {
        if (e.code !== 'Tab') return;
        e.preventDefault();
        e.stopImmediatePropagation();
        hide();
    }, true);
    window.addEventListener('blur', hide);
})();
