// Runs before the engine. The Steam build expects NW.js; in a browser the
// Steam plugin's bare require() would throw and take the plugin chain with it.
// `process` stays undefined so Utils.isNwjs() keeps answering false.
(function () {
    function inert() {
        const fn = function () { return false; };
        return new Proxy(fn, {
            get(target, key) {
                if (key === Symbol.toPrimitive) return () => '';
                if (key === 'then') return undefined;
                return inert();
            },
            apply() { return false; },
        });
    }
    window.require = function (name) {
        console.info('[coop] require("' + name + '") stubbed');
        return inert();
    };
})();
