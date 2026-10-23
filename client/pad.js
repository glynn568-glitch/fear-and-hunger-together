//=============================================================================
// fh-coop: playing on a controller (a Steam Deck, or any pad on a PC). The
// game reads A, B, X, Y, the bumpers and the D-pad itself; everything only a
// keyboard could do (the game's torch and phase, and this mod's keys) is on
// the buttons it leaves free. The mod's own panels are worked with the D-pad,
// A and B. Prompts name the button when a controller was used last.
//   RT torch (T) · L3 phase (C) · LT held: everyone's gear (Tab) · R3 follow (F)
//   Start: talk (Y) · View: how playing together works (F1)
//   View + Start held 2 s: unstuck (Ctrl+Shift+U) · at the title RT carries on (R)
//=============================================================================
(function () {
    const LT = 6, RT = 7, VIEW = 8, START = 9, L3 = 10, R3 = 11;
    const UP = 12, DOWN = 13, A = 0, B = 1;
    // Button -> the key it stands for: [code, keyCode, key].
    const KEYS = {
        torch: ['KeyT', 84, 't'], phase: ['KeyC', 67, 'c'], sheet: ['Tab', 9, 'Tab'], follow: ['KeyF', 70, 'f'],
        talk: ['KeyY', 89, 'y'], help: ['F1', 112, 'F1'], carry: ['KeyR', 82, 'r'],
    };

    Coop.padUsed = false; // the last thing pressed was on a controller
    window.addEventListener('keydown', function (e) { if (e.isTrusted) Coop.padUsed = false; }, true);
    // The key or button to name in a prompt: Coop.keyName('F') -> 'R3' on a controller.
    const NAMES = { F: 'R3', Y: 'Start', R: 'RT', Esc: 'B', Tab: 'LT', F1: 'View' };
    Coop.keyName = function (key) { return Coop.padUsed && NAMES[key] ? NAMES[key] : key; };

    function send(type, k, target, extra) {
        const ev = new KeyboardEvent(type, Object.assign({ code: k[0], key: k[2], bubbles: true, cancelable: true }, extra || {}));
        Object.defineProperty(ev, 'keyCode', { get: () => k[1] });
        Object.defineProperty(ev, 'which', { get: () => k[1] });
        (target || document).dispatchEvent(ev);
    }

    // The mod's panels, when one is up: the D-pad moves between its controls.
    function panel() {
        for (const sel of ['#coop-setup.open', '#coop-together.open']) {
            const el = document.querySelector(sel);
            if (el) return el;
        }
        return null;
    }
    function controls(box) {
        return Array.from(box.querySelectorAll('button, input')).filter((el) => !el.disabled && el.offsetParent !== null);
    }
    function chatOpen() {
        const el = document.activeElement;
        return el && el.tagName === 'INPUT' && el.closest('#coop-chat');
    }
    // While a panel or the chat line has the controller, the game does not.
    Coop.padHeld = function () { return !!(panel() || chatOpen()); };

    // Each pad on its own (a Deck with a controller plugged in has two).
    const pads = new Map(); // index -> { was, chord, sent: Map(button -> key), masked: Set(button) }
    function stateOf(index) {
        if (!pads.has(index)) pads.set(index, { was: [], chord: 0, sent: new Map(), masked: new Set() });
        return pads.get(index);
    }
    // Every key a pad is holding down is let go (a panel took the pad, it was unplugged, the window lost focus).
    function releaseAll(st) {
        for (const k of st.sent.values()) send('keyup', k);
        st.sent.clear();
    }
    window.addEventListener('gamepaddisconnected', function (e) { const st = pads.get(e.gamepad.index); if (st) { releaseAll(st); pads.delete(e.gamepad.index); } });
    window.addEventListener('blur', function () { for (const st of pads.values()) releaseAll(st); });

    const _update = Input._updateGamepadState;
    Input._updateGamepadState = function (pad) {
        const st = stateOf(pad.index);
        const now = pad.buttons.map((b) => b.pressed);
        // The stick moves through a panel as the D-pad does.
        now[UP] = now[UP] || pad.axes[1] < -0.5;
        now[DOWN] = now[DOWN] || pad.axes[1] > 0.5;
        const down = (i) => now[i] && !st.was[i];
        const up = (i) => !now[i] && st.was[i];
        if (now.some(Boolean)) Coop.padUsed = true;
        const heldBefore = Coop.padHeld();
        try { handle(st, now, down, up); } catch (e) { console.error('[coop] controller', e); }
        st.was = now;
        if (heldBefore || Coop.padHeld()) {
            // Whatever the game had down is let go, or it would stay down once the panel closes,
            // and what is held now stays the panel's until it is let go (the A that sent a line
            // does not then talk to whoever is in front; the B that closed it opens no menu).
            const last = this._gamepadStates[pad.index] || [];
            for (let j = 0; j < last.length; j++) if (last[j] && this.gamepadMapper[j]) this._currentState[this.gamepadMapper[j]] = false;
            this._gamepadStates[pad.index] = [];
            now.forEach((on, i) => { if (on) st.masked.add(i); });
            return;
        }
        for (const i of st.masked) if (!now[i]) st.masked.delete(i);
        if (!st.masked.size) { _update.call(this, pad); return; }
        const buttons = pad.buttons.map((b, i) => (st.masked.has(i) ? { pressed: false, value: 0 } : b));
        _update.call(this, { index: pad.index, buttons, axes: pad.axes });
    };

    function handle(st, now, down, up) {
        const box = panel();
        if (box || chatOpen()) releaseAll(st);
        if (box) {
            const list = controls(box);
            const at = list.indexOf(document.activeElement);
            if (down(DOWN) || down(UP)) {
                const next = list[(at + (down(DOWN) ? 1 : list.length - 1) + (at < 0 ? 1 : 0)) % list.length];
                if (next) next.focus();
            }
            if (down(A) && document.activeElement && box.contains(document.activeElement)) {
                const el = document.activeElement;
                if (el.tagName === 'BUTTON' || el.type === 'checkbox') el.click();
                else send('keydown', ['Enter', 13, 'Enter'], el);
            }
            if (down(B)) send('keydown', ['Escape', 27, 'Escape'], document.activeElement && box.contains(document.activeElement) ? document.activeElement : box);
            return;
        }
        if (chatOpen()) {
            if (down(A)) send('keydown', ['Enter', 13, 'Enter'], document.activeElement);
            if (down(B)) send('keydown', ['Escape', 27, 'Escape'], document.activeElement);
            return;
        }
        const title = SceneManager._scene instanceof Scene_Title;
        // Pressed and let go as the button is, so a held button is a held key; let go
        // is the key it pressed, even if the scene changed in between.
        const mirror = (i, k) => {
            if (down(i)) { send('keydown', k); st.sent.set(i, k); }
            if (up(i) && st.sent.has(i)) { send('keyup', st.sent.get(i)); st.sent.delete(i); }
        };
        mirror(RT, title ? KEYS.carry : KEYS.torch);
        mirror(L3, KEYS.phase);
        mirror(LT, KEYS.sheet);
        mirror(R3, KEYS.follow);
        // View and Start: alone on release, together (held) for unstuck.
        if (now[VIEW] && now[START]) {
            st.chord = st.chord || Date.now();
            if (st.chord > 0 && Date.now() - st.chord > 2000) {
                st.chord = -1;
                send('keydown', ['KeyU', 85, 'U'], null, { ctrlKey: true, shiftKey: true });
                send('keyup', ['KeyU', 85, 'U'], null, { ctrlKey: true, shiftKey: true });
            }
        } else if (st.chord) {
            if (!now[VIEW] && !now[START]) st.chord = 0;
        } else {
            if (up(VIEW)) { send('keydown', KEYS.help); send('keyup', KEYS.help); }
            if (up(START)) { send('keydown', KEYS.talk); send('keyup', KEYS.talk); }
        }
    }
})();
