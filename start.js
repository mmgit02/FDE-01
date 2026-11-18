'use strict';
/**
 * Single-app entry point for Cloud Foundry (the org has no spare routes for a second app).
 *  - the CAP service listens on 127.0.0.1:CAP_PORT, reachable only inside the container
 *  - the SAP approuter owns the public $PORT: XSUAA login, serves app/resources, proxies /api/* to CAP
 * If either process stops, the container exits so Cloud Foundry restarts it.
 */
const { spawn } = require('child_process');
const path = require('path');

const CAP_PORT = process.env.CAP_PORT || '4004';
const publicPort = process.env.PORT || '8080';

const cap = spawn(process.execPath, [require.resolve('@sap/cds/bin/serve.js'), 'all'], {
  cwd: __dirname,
  env: { ...process.env, PORT: CAP_PORT, HOST: '127.0.0.1' },
  stdio: 'inherit',
});
cap.on('exit', (code, sig) => {
  console.error(`[start] CAP service exited (code=${code}, signal=${sig}); stopping container.`);
  process.exit(code || 1);
});

const approuter = require('@sap/approuter');
approuter().start({ port: publicPort, workingDir: path.join(__dirname, 'app') });

for (const s of ['SIGTERM', 'SIGINT']) {
  process.on(s, () => { cap.kill(s); process.exit(0); });
}
