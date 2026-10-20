// Ships the version in package.json everywhere at once:
//   1. builds the zip (tools/package.js);
//   2. refreshes the public GitHub copy from this commit: one commit per release,
//      under the GitHub no-reply address, without the working notes (dist/public, its own git);
//   3. makes the GitHub release with the zip, notes from docs/releases/<version>.md;
//   4. pushes the same build to itch.io with butler (the itch app then patches
//      players' installs instead of downloading everything again).
//
//   node tools/release.js            all four
//   node tools/release.js --dry-run  says what it would do
//   --no-github / --no-itch          leave one out
//   node tools/release.js --source-only   only refresh the public GitHub copy (docs, CI), no new version
//
// Needs: a clean working tree, gh signed in, butler logged in (D:\Tools\butler or
// BUTLER=<path>), and the notes file for this version.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const REPO = 'glynn568-glitch/fear-and-hunger-together';
const ITCH = 'phosphopho/fear-and-hunger-together:windows';
const BUTLER = process.env.BUTLER || 'D:\\Tools\\butler\\butler.exe';
const PUBLIC = path.join(ROOT, 'dist', 'public');
const BUILD = path.join(ROOT, 'dist', 'FearAndHunger-Together');
const args = new Set(process.argv.slice(2));
const dry = args.has('--dry-run');
const sourceOnly = args.has('--source-only');
const version = require('../package.json').version;
const zip = path.join(ROOT, 'dist', `FearAndHunger-Together-${version}.zip`);
const notes = path.join(ROOT, 'docs', 'releases', version + '.md');

const run = (cmd, argv, opts) => {
    console.log('> ' + [cmd, ...argv].join(' '));
    if (dry) return '';
    return execFileSync(cmd, argv, Object.assign({ encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }, opts));
};
const git = (argv, cwd) => execFileSync('git', argv, { cwd: cwd || ROOT, encoding: 'utf8' }).trim();

// Refusals first: nothing half-shipped.
if (git(['status', '--porcelain'])) throw new Error('Commit or stash your changes first: a release is made from a commit.');
if (!sourceOnly && !fs.existsSync(notes)) throw new Error('Write the release notes first: docs/releases/' + version + '.md');
if (!sourceOnly && !args.has('--no-github')) {
    let tags = '';
    try { tags = execFileSync('gh', ['release', 'view', 'v' + version, '-R', REPO, '--json', 'tagName'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch (e) { /* none yet */ }
    if (tags) throw new Error('v' + version + ' is already released. Raise the version in package.json first (npm version patch --no-git-tag-version).');
}
if (!sourceOnly && !args.has('--no-itch') && !fs.existsSync(BUTLER)) throw new Error('butler not found at ' + BUTLER);
// Only a commit that passed the whole release gate (node test/gate.js) ships.
if (!sourceOnly) {
    let gate = null;
    try { gate = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'out', 'gate.json'), 'utf8')); } catch (e) { /* never run */ }
    if (!gate || gate.commit !== git(['rev-parse', 'HEAD'])) throw new Error('This commit has not passed the release gate. Run: node test/gate.js');
}
console.log(`${sourceOnly ? 'Updating the public source at' : 'Releasing'} ${version} from ${git(['rev-parse', '--short', 'HEAD'])}${dry ? ' (dry run)' : ''}`);

// 1. The build.
if (!sourceOnly) run(process.execPath, [path.join(__dirname, 'package.js')], { stdio: 'inherit' });

// 2. The public copy: this commit's files, nothing of the working notes or history.
if (!args.has('--no-github')) {
    if (!dry) {
        for (const name of fs.readdirSync(PUBLIC)) if (name !== '.git') fs.rmSync(path.join(PUBLIC, name), { recursive: true, force: true });
        execFileSync('git', ['archive', '--format=tar', 'HEAD', '-o', path.join(ROOT, 'dist', 'public.tar')], { cwd: ROOT });
        execFileSync(process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar', ['-xf', path.join(ROOT, 'dist', 'public.tar'), '-C', PUBLIC]);
        fs.rmSync(path.join(ROOT, 'dist', 'public.tar'));
        // Working notes, and the real saves the tests load, stay private.
        for (const f of ['TASKS.md', 'docs/signpath-application.md', 'docs/grok', 'test/fixtures', 'test/oldsaves.js']) fs.rmSync(path.join(PUBLIC, f), { recursive: true, force: true });
    }
    const id = dry ? '0' : execFileSync('gh', ['api', 'user', '-q', '.id'], { encoding: 'utf8' }).trim();
    const who = ['-c', 'user.name=glynn568-glitch', '-c', `user.email=${id}+glynn568-glitch@users.noreply.github.com`];
    run('git', ['add', '-A'], { cwd: PUBLIC });
    run('git', [...who, 'commit', '-q', '-m', sourceOnly ? 'Source update (' + version + ')' : 'Fear & Hunger Together ' + version], { cwd: PUBLIC });
    run('git', ['push', '-q', 'origin', 'main'], { cwd: PUBLIC });

    // 3. The GitHub release.
    if (!sourceOnly) run('gh', ['release', 'create', 'v' + version, zip, '-R', REPO, '--title', 'Fear & Hunger Together ' + version, '--notes-file', notes, '--target', 'main', '--latest']);
}

// 4. itch: the unpacked build, so the itch app can patch it.
if (!sourceOnly && !args.has('--no-itch')) run(BUTLER, ['push', BUILD, ITCH, '--userversion', version], { stdio: 'inherit' });

console.log(dry ? 'Dry run done.' : sourceOnly ? 'Public source updated.' : `Released ${version}.`);
