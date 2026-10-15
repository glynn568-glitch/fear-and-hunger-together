// Builds "Fear & Hunger Together.exe" from tools/launcher/Launcher.cs with
// the C# compiler that comes with Windows (.NET Framework 4).
//   node tools/build-launcher.js [out.exe]
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CSC = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
const out = path.resolve(process.argv[2] || path.join(ROOT, 'Fear & Hunger Together.exe'));
const icon = path.join(__dirname, 'launcher', 'icon.ico');

const args = ['/nologo', '/target:winexe', '/optimize+', '/out:' + out,
    '/r:System.Windows.Forms.dll', '/r:System.Management.dll', '/r:Microsoft.VisualBasic.dll'];
if (fs.existsSync(icon)) args.push('/win32icon:' + icon);
args.push(path.join(__dirname, 'launcher', 'Launcher.cs'));
fs.mkdirSync(path.dirname(out), { recursive: true }); // a fresh checkout has no dist folder yet
execFileSync(CSC, args, { stdio: 'inherit' });
console.log('built ' + out);
