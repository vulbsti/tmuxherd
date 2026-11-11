#!/usr/bin/env node
import { main } from '../src/cli.js';

main().then((code) => process.exit(code), (e) => {
  process.stderr.write(`tmuxherd: ${e.stack || e.message}\n`);
  process.exit(1);
});
