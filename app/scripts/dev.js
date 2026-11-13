// `npm run dev`: starts the dev server for the development build ("PVV Dev" app).
// Sets APP_VARIANT=development (works the same in Windows PowerShell, cmd and macOS/Linux),
// then runs `expo start --dev-client`. Extra arguments are passed on, e.g. `npm run dev -- --tunnel`.
const { spawn } = require('child_process');

const args = ['expo', 'start', '--dev-client', ...process.argv.slice(2)];
const child = spawn('npx', args, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, APP_VARIANT: 'development' },
});
child.on('exit', (code) => process.exit(code ?? 0));
