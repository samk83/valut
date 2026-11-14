// `npm run ota -- --message "what changed"`: sends the current JavaScript to TestFlight beta
// builds (made with `eas build --profile beta`) as an over-the-air update. Sets APP_VARIANT=beta
// so the update matches those builds (same in Windows PowerShell, cmd and macOS/Linux).
// Only builds whose native code is identical (same fingerprint) receive it; after a native
// change (new library, app.json plugin) a new beta build is needed first.
const { spawn } = require('child_process');

const args = ['eas-cli', 'update', '--channel', 'beta', '--platform', 'ios', ...process.argv.slice(2)];
const child = spawn('npx', args, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, APP_VARIANT: 'beta' },
});
child.on('error', (err) => {
  console.error(`Could not start eas update: ${err.message}`);
  process.exit(1);
});
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
