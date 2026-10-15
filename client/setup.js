//=============================================================================
// fh-coop: F8 on a PC with no AI to drive a partner. The host can paste an
// Anthropic API key here (checked, then kept on this PC in data/partner-key.txt), or
// call the partner in anyway, to follow and fight without words.
//=============================================================================
(function () {
    const style = document.createElement('style');
    style.textContent = [
        '#coop-setup { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 60; display: none;',
        '  width: min(86vw, 560px); box-sizing: border-box; padding: 18px 20px; background: rgba(14, 9, 8, 0.96); border: 1px solid #6b5a45;',
        '  font: 16px/1.45 Georgia, "Times New Roman", serif; color: #e0d4bc; }',
        '#coop-setup.open { display: block; }',
        '#coop-setup h2 { margin: 0 0 8px; font-size: 1.15em; font-weight: normal; color: #f2d28a; }',
        '#coop-setup p { margin: 0 0 10px; }',
        '#coop-setup input { width: 100%; box-sizing: border-box; font: inherit; color: #e8dcc0; background: rgba(20, 12, 10, 0.9);',
        '  border: 1px solid #6b5a45; padding: 5px 8px; outline: none; }',
        '#coop-setup .row { display: flex; gap: 10px; margin-top: 12px; flex-wrap: wrap; }',
        '#coop-setup button { font: inherit; color: #e8dcc0; background: #2a1d17; border: 1px solid #6b5a45; padding: 4px 12px; cursor: pointer; }',
        '#coop-setup .why { min-height: 1.4em; margin-top: 8px; color: #e7a07a; }',
    ].join('\n');
    document.head.appendChild(style);

    const box = document.createElement('div');
    box.id = 'coop-setup';
    box.innerHTML = '<h2>No AI found for a partner</h2>'
        + '<p>Paste an Anthropic API key (it starts sk-ant-). It is checked, then kept on this PC only, in data/partner-key.txt.</p>'
        + '<p>Other ways: install Claude Code and log in, or run Ollama. Then press F8 again.</p>'
        + '<input type="password" spellcheck="false" autocomplete="off" placeholder="sk-ant-...">'
        + '<div class="why"></div>'
        + '<div class="row"><button data-do="save">Save and call it in</button><button data-do="anyway">Call it in without AI</button><button data-do="close">Close</button></div>';
    (document.body ? Promise.resolve() : new Promise((r) => window.addEventListener('DOMContentLoaded', r))).then(() => document.body.appendChild(box));
    const input = box.querySelector('input');
    const why = box.querySelector('.why');

    function open() {
        why.textContent = '';
        input.value = '';
        box.classList.add('open');
        Input.clear();
        input.focus();
    }
    function close() {
        box.classList.remove('open');
        input.blur();
        Input.clear();
    }

    function act(what) {
        if (what === 'save') {
            const key = input.value.trim();
            if (!/^sk-ant-/.test(key)) { why.textContent = 'That does not look like an Anthropic key.'; return; }
            why.textContent = 'Checking the key...';
            Coop.send({ t: 'partnerkey', key });
        } else if (what === 'anyway') {
            close();
            Coop.send({ t: 'partner', on: true, anyway: true });
        } else close();
    }

    box.addEventListener('click', function (e) {
        const b = e.target.closest('button');
        if (b) act(b.getAttribute('data-do'));
    });
    // Keys typed here never reach the game.
    for (const type of ['keydown', 'keyup', 'keypress']) {
        box.addEventListener(type, function (e) {
            e.stopPropagation();
            if (type !== 'keydown') return;
            if (e.key === 'Enter') act(document.activeElement === input ? 'save' : (document.activeElement.getAttribute('data-do') || 'save'));
            else if (e.key === 'Escape') close();
        });
    }

    Coop.on('partnersetup', open);
    Coop.on('partnerkeyok', close);
    Coop.on('partnerkeybad', function (msg) { why.textContent = String(msg.text || 'That key did not work.'); });
})();
