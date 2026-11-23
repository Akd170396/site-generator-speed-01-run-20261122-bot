import { setFlagsFromString } from 'node:v8';
import { readFileSync, writeFileSync } from 'node:fs';

setFlagsFromString('--no-incremental-marking');

const { run } = await import('./solve.js');

const cases = JSON.parse(readFileSync('/input/cases.json', 'utf8'));
const answers = cases.map((c) => run(c.input));
writeFileSync('/output/answers.json', JSON.stringify(answers));
