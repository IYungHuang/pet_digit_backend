import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const functionsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoDir = path.resolve(functionsDir, '..');
const mode = process.argv[2] ?? 'start';
const emulatorArgs = ['emulators:exec', '--project', 'demo-pet-digit', '--only', 'auth,firestore,storage,functions'];
const env = {
  ...process.env,
  GCLOUD_PROJECT: 'demo-pet-digit',
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
  FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9199',
};

function run(command, args, cwd = functionsDir) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (mode === 'start') {
  const child = spawn('firebase', ['emulators:start', '--project', 'demo-pet-digit'], { cwd: repoDir, env, stdio: 'inherit' });
  process.on('SIGINT', () => child.kill('SIGINT'));
  process.on('SIGTERM', () => child.kill('SIGTERM'));
  child.on('exit', code => process.exit(code ?? 0));
} else if (mode === 'rules') {
  run('firebase', [...emulatorArgs, 'npm --prefix functions run test:rules:local'], repoDir);
} else if (mode === 'integration') {
  run('firebase', [...emulatorArgs, 'npm --prefix functions run test:integration:local'], repoDir);
} else if (mode === 'verify') {
  run('firebase', [...emulatorArgs, 'npm --prefix functions run test:emulator:local'], repoDir);
} else {
  console.error(`Unknown emulator mode: ${mode}`);
  process.exit(2);
}
