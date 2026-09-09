import { cpSync, readFileSync, writeFileSync } from 'node:fs';
cpSync('public', '.next/standalone/public', {recursive: true});
cpSync('.next/static', '.next/standalone/.next/static', {recursive: true});

// Next's instrumentation is lazy; validate synchronously before starting the listener.
cpSync('lib/runtime-config.cjs','.next/standalone/runtime-config.cjs');
const entry='.next/standalone/server.js';
const marker='// Postial runtime configuration gate';
const source=readFileSync(entry,'utf8');
if(!source.startsWith(marker)) writeFileSync(entry,marker+"\ntry { require('./runtime-config.cjs').validateRuntimeConfig(); } catch(e) { console.error(e.message); process.exit(1); }\n"+source);
