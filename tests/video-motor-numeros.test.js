import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

// numeros.py carries its own assert-based self-check (python numeros.py).
test('numeros.py self-check passes', () => {
  const out = execFileSync(process.env.PYTHON_BIN || 'python', ['src/video-motor/numeros.py'], { encoding: 'utf8' });
  assert.match(out, /ok/);
});
