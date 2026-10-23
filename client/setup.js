//=============================================================================
// fh-coop: how the host's AI partner thinks. F8 opens this on a PC with nothing
// to think with; the Together panel opens it any time. The host picks Claude
// Code, Grok Build, an API service (key and model checked on the server, then
// kept on this PC in data/partner-mind.json), a model on this PC, or none.
//=============================================================================
(function () {
    const style = document.createElement('style');
    style.textContent = [
        '#coop-setup { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 61; display: none;',
        '  width: min(92vw, 620px); max-height: 92vh; overflow-y: auto; box-sizing: border-box; padding: 18px 20px; background: rgba(14, 9, 8, 0.97); border: 1px solid #6b5a45;',
        '  font: 16px/1.45 Georgia, "Times New Roman", serif; color: #e0d4bc; }',
        '#coop-setup.open { display: block; }',
        '#coop-setup h2 { margin: 0 0 8px; font-size: 1.15em; font-weight: normal; color: #f2d28a; }',
        '#coop-setup p { margin: 0 0 10px; }',
        '#coop-setup input { width: 100%; box-sizing: border-box; font: inherit; color: #e8dcc0; background: rgba(20, 12, 10, 0.9);',
        '  border: 1px solid #6b5a45; padding: 5px 8px; outline: none; margin-top: 6px; }',
        '#coop-setup input:focus, #coop-setup button:focus { border-color: #f2d28a; }',
        '#coop-setup .minds { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 6px; }',
        '#coop-setup .minds button { text-align: left; }',
        '#coop-setup .minds button.on { background: #4a3324; border-color: #f2d28a; }',
        '#coop-setup .minds small { color: #a8957a; }',
        '#coop-setup .note { margin-top: 10px; color: #c9b998; }',
        '#coop-setup .row { display: flex; gap: 10px; margin-top: 12px; flex-wrap: wrap; }',
        '#coop-setup button { font: inherit; color: #e8dcc0; background: #2a1d17; border: 1px solid #6b5a45; padding: 4px 12px; cursor: pointer; outline: none; }',
        '#coop-setup .why { min-height: 1.4em; margin-top: 8px; color: #e7a07a; }',
    ].join('\n');
    document.head.appendChild(style);

    const box = document.createElement('div');
    box.id = 'coop-setup';
    box.innerHTML = '<h2>How your AI partner thinks</h2>'
        + '<p class="lead"></p>'
        + '<div class="minds"></div>'
        + '<div class="note"></div>'
        + '<input data-field="url" spellcheck="false" autocomplete="off" placeholder="Address, like https://api.example.com/v1">'
        + '<input data-field="key" type="password" spellcheck="false" autocomplete="off">'
        + '<input data-field="model" spellcheck="false" autocomplete="off" list="fh-setup-models">'
        + '<datalist id="fh-setup-models"></datalist>'
        + '<div class="why"></div>'
        + '<div class="row"><button data-do="save">Save and call it in</button><button data-do="anyway">Call it in without AI</button><button data-do="close">Close</button></div>';
    (document.body ? Promise.resolve() : new Promise((r) => window.addEventListener('DOMContentLoaded', r))).then(() => document.body.appendChild(box));
    const $ = (sel) => box.querySelector(sel);
    const why = $('.why');
    const field = { url: $('[data-field=url]'), key: $('[data-field=key]'), model: $('[data-field=model]') };

    let list = [], chosen = null, models = {};

    function show() {
        const m = list.find((x) => x.id === chosen) || {};
        for (const b of box.querySelectorAll('.minds button')) b.classList.toggle('on', b.getAttribute('data-mind') === chosen);
        $('.note').textContent = m.note || '';
        field.url.hidden = !m.needsUrl;
        field.key.hidden = !m.needsKey;
        field.key.placeholder = m.key ? 'Key kept (' + m.key + '). Leave empty to keep it.' : 'Paste a key. It is checked, then kept on this PC only.';
        // Claude Code and Grok Build have a model of their own; the rest need one named.
        field.model.hidden = !m.id || m.id === 'none';
        field.model.placeholder = m.id === 'claude' ? 'Model: sonnet (or opus, haiku)' : m.id === 'grok-cli' ? 'Model: Grok Build\'s own choice' : 'Model (the list fills from the service)';
        $('#fh-setup-models').innerHTML = '';
        for (const id of models[chosen] || []) { const o = document.createElement('option'); o.value = id; $('#fh-setup-models').appendChild(o); }
    }

    function pick(id, model) {
        chosen = id;
        why.textContent = '';
        field.key.value = '';
        field.model.value = model || '';
        const m = list.find((x) => x.id === id) || {};
        if (m.needsUrl) field.url.value = m.url || '';
        show();
        askModels();
    }

    // The service's own list, once there is a key (or none is needed) to ask with.
    function askModels() {
        const m = list.find((x) => x.id === chosen) || {};
        if (!m.id || m.id === 'none' || m.id === 'claude' || m.id === 'grok-cli') return;
        if (m.needsKey && !m.key && !field.key.value.trim()) return;
        if (m.needsUrl && !/^https?:\/\//.test(field.url.value.trim())) return;
        Coop.send({ t: 'partnermodels', brain: chosen, key: field.key.value.trim(), url: field.url.value.trim() });
    }

    function render(msg) {
        list = msg.list || [];
        const minds = $('.minds');
        minds.innerHTML = '';
        for (const m of list) {
            const b = document.createElement('button');
            b.setAttribute('data-mind', m.id);
            const mark = m.found === true ? 'found here' : m.found === false ? 'not found' : m.key ? 'key kept' : 'needs a key';
            b.innerHTML = '<span></span><br><small></small>';
            b.firstChild.textContent = m.label;
            b.lastChild.textContent = mark;
            minds.appendChild(b);
        }
        const start = list.some((x) => x.id === msg.current && x.id !== 'none') ? msg.current : 'anthropic';
        pick(start, start === msg.current ? msg.model : '');
        (field.key.hidden ? box.querySelector('.minds button.on') : field.key).focus();
    }

    function open(lead) {
        why.textContent = '';
        $('.lead').textContent = lead || 'Pick what drives your AI partner. Keys stay on this PC.';
        box.classList.add('open');
        Input.clear();
        Coop.send({ t: 'partnerminds' });
    }
    function close() {
        box.classList.remove('open');
        if (box.contains(document.activeElement)) document.activeElement.blur();
        Input.clear();
    }

    function act(what) {
        if (what === 'save') {
            if (!chosen) return;
            why.textContent = chosen === 'none' ? '' : 'Checking...';
            Coop.send({ t: 'partnermind', brain: chosen, key: field.key.value.trim(), model: field.model.value.trim(), url: field.url.value.trim() });
        } else if (what === 'anyway') {
            close();
            Coop.send({ t: 'partner', on: true, anyway: true });
        } else close();
    }

    box.addEventListener('click', function (e) {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.hasAttribute('data-mind')) pick(b.getAttribute('data-mind'));
        else act(b.getAttribute('data-do'));
    });
    field.key.addEventListener('change', askModels);
    field.url.addEventListener('change', askModels);
    // Keys typed here never reach the game.
    for (const type of ['keydown', 'keyup', 'keypress']) {
        box.addEventListener(type, function (e) {
            e.stopPropagation();
            if (type !== 'keydown') return;
            const at = document.activeElement;
            if (e.key === 'Enter') {
                // The button's own Enter would click it a second time (two partners).
                e.preventDefault();
                if (e.repeat) return;
                if (at && at.tagName === 'INPUT') act('save');
                else if (at && at.hasAttribute('data-mind')) pick(at.getAttribute('data-mind'));
                else act((at && at.getAttribute('data-do')) || 'save');
            } else if (e.key === 'Escape') close();
        });
    }

    Coop.openPartnerSetup = open;
    Coop.on('partnersetup', () => open('Nothing to think with was found on this PC. Pick one, or call the partner in without AI.'));
    Coop.on('partnerminds', function (msg) { if (box.classList.contains('open')) render(msg); });
    Coop.on('partnermodels', function (msg) {
        if (msg.brain !== chosen) return;
        models[msg.brain] = msg.models || [];
        if (msg.why) why.textContent = msg.why;
        if (!field.model.value && models[msg.brain][0]) field.model.value = models[msg.brain][0];
        show();
    });
    Coop.on('partnermindok', close);
    Coop.on('partnermindbad', function (msg) { why.textContent = String(msg.text || 'That did not work.'); });
})();
