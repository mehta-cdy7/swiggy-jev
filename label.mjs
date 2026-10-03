// Hand-label 100 Swiggy reviews. These labels are the ground truth Jev gets scored against.
// Run:  node label.mjs
// Type 1-5 and press Enter. Type q to quit — progress is saved to labels.json, rerun to resume.
//
// Rule: label by the definitions below, as written. They are the exact text Jev sees,
// so you and Jev are judged against the same rulebook. If a review fits none, it's "other".
// Don't change these definitions once you've seen Jev's answers.
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import readline from 'node:readline';

const CATEGORIES = {
  1: ['bug', 'The app itself is broken: crashes, errors, login or payment screens failing'],
  2: ['feature', 'Asks for something the app does not do yet'],
  3: ['service', 'Delivery, refund, pricing, restaurant or customer support problem'],
  4: ['praise', 'The reviewer is happy with the app or the service'],
  5: ['other', 'Spam, unclear, or none of the above'],
};

const reviews = JSON.parse(await readFile('reviews.json', 'utf8'));
// Take every Nth review so the 100 are spread across the whole set, not just the newest.
const stride = Math.max(1, Math.floor(reviews.length / 100));
const sample = reviews.filter((_, i) => i % stride === 0).slice(0, 100);

const labels = existsSync('labels.json')
  ? JSON.parse(await readFile('labels.json', 'utf8'))
  : {};

const rl = readline.createInterface({ input: process.stdin });
const lines = rl[Symbol.asyncIterator]();
async function ask(question) {
  process.stdout.write(question);
  const { value, done } = await lines.next();
  return done ? 'q' : value; // input closed (Ctrl+D) counts as quit
}

console.log('\nCategories (same text Jev sees):');
for (const [key, [name, desc]] of Object.entries(CATEGORIES)) {
  console.log(`  ${key}  ${name.padEnd(8)} ${desc}`);
}

let done = sample.filter((r) => labels[r.id]).length;
const prompt = '\n1 bug · 2 feature · 3 service · 4 praise · 5 other · q quit > ';

for (const r of sample) {
  if (labels[r.id]) continue;

  console.log(`\n────── ${done + 1}/${sample.length} ──────`);
  console.log(`${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}  ${r.title}`);
  console.log(r.text);

  let answer;
  do {
    answer = (await ask(prompt)).trim().toLowerCase();
  } while (answer !== 'q' && !CATEGORIES[answer]);

  if (answer === 'q') break;

  labels[r.id] = CATEGORIES[answer][0];
  done++;
  await writeFile('labels.json', JSON.stringify(labels, null, 2));
}

rl.close();

const counts = {};
for (const r of sample) if (labels[r.id]) counts[labels[r.id]] = (counts[labels[r.id]] ?? 0) + 1;
console.log(`\nLabelled ${done}/${sample.length}:`, counts);
