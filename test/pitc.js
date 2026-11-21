// test/pit.js's case C on its own: the long way round to a circle, through the Level 2 basement's
// locked door. With A and B in one suite it took 540-600 s under the full run's load, at run.js's
// 10-minute kill (11/20: killed once at 600 s); apart, each half runs well inside it, side by side.
process.env.FH_PIT = 'C';
process.env.FH_PIT_PORT = '8395';
require('./pit');
