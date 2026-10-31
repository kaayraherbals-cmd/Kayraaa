#!/bin/bash
# usage: run.sh <test file relative to /tmp/strip>
cd /tmp/strip; export RATE_LIMIT_SHARED=off
f="$1"
node --experimental-transform-types --no-warnings -e "
import('/tmp/shim/vitest.ts').then(async (v) => { await import('/tmp/strip/$f'); await v.run('$f'); }).catch((e) => console.log('LOADERROR $f ' + String(e.message).split('\n')[0].slice(0,200)));
" 2>&1 | grep -E "^(RESULT|FAIL|LOADERROR|   )" 
