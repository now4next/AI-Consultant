#!/usr/bin/env node
// Turns a password (stdin) into the PBKDF2 hash the worker expects, and prints only the hash.
// Usage (PowerShell, password already copied to the clipboard):
//   ((Get-Clipboard -Raw) -replace '[^\x20-\x7E]','') | node scripts/hash-password.js | npx wrangler secret put ADMIN_PASS_HASH
const crypto = require('crypto');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { input += d; });
process.stdin.on('end', () => {
  const password = input.replace(/[\r\n]+$/, '');
  if (password.length < 8) { process.stderr.write('password must be at least 8 characters\n'); process.exit(1); }
  const iterations = 100000, salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  process.stdout.write(`pbkdf2$${iterations}$${salt.toString('base64')}$${hash.toString('base64')}`);
});
