#!/usr/bin/env node
import { start } from '../dist/start.js';

start().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[customer-cloud-broker] fatal:', err);
  process.exit(1);
});
