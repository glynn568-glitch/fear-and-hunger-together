// Runs after plugins.js and before main.js. Appends the co-op scripts to the
// plugin list so they load after everything the game ships with.
(function () {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', 'coop/scripts.json', false);
    xhr.send();
    const names = JSON.parse(xhr.responseText);
    for (const name of names) {
        $plugins.push({ name: '../../coop/' + name, status: true, description: '', parameters: {} });
    }
})();
