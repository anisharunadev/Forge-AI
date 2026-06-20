#!/usr/bin/env node
// Entrypoint for the FORA identity-broker.
// Resolves the compiled dist/index.js relative to this file.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '..', 'dist', 'index.js');
const mod = await import(dist);
await mod.startServer();
