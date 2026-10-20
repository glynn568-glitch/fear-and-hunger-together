// Loaded with `node -r` into a test's server when FH_TWIN is set (test/lib.js), and into the
// suite itself (test/twins.js): the repo's own modules are compiled with that twin's fix taken
// out. See test/twins.js.
const Module = require('module');
const path = require('path');
const { twinSource } = require('./twins');

const ROOT = path.join(__dirname, '..');
const compile = Module.prototype._compile;
Module.prototype._compile = function (content, filename) {
    const rel = path.relative(ROOT, filename).split(path.sep).join('/');
    const twin = rel.startsWith('..') || rel.startsWith('node_modules/') ? null : twinSource(process.env.FH_TWIN, rel, content);
    return compile.call(this, twin === null ? content : twin, filename);
};
