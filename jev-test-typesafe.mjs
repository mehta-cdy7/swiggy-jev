// Go/no-go check using TypeSafe's own API (no Vercel needed).
// Setup: npm i @typesafe-ai/sdk          (Node 20+)
// Key:   console.typesafe.ai -> API Keys -> create key,
//        then put TYPESAFE_API_KEY=your_key in your .env file
// Run:   node --env-file=.env jev-test-typesafe.mjs
import { readFile } from 'node:fs/promises';
import { TypeSafeClient, choice, noul } from '@typesafe-ai/sdk';

const jev = new TypeSafeClient(); // reads TYPESAFE_API_KEY from the environment

const reviews = JSON.parse(await readFile('reviews.json', 'utf8'));
const sample = reviews.slice(0, 3);

for (const r of sample) {
  const started = performance.now();

  const response = await jev.systemOne({
    model: 'jev-latest',
    state: { rating: r.rating, title: r.title, text: r.text },
    questions: {
      category: choice('What is this app review mainly about?', {
        bug: 'The app itself is broken: crashes, errors, login or payment screens failing',
        feature: 'Asks for something the app does not do yet',
        service: 'Delivery, refund, pricing, restaurant or customer support problem',
        praise: 'The reviewer is happy with the app or the service',
        other: 'Spam, unclear, or none of the above',
      }),
      needsReply: noul('The developer should reply to this review'),
    },
  });

  const ms = Math.round(performance.now() - started);
  const { category, needsReply } = response.answers;

  console.log('\n---');
  console.log(`[${r.rating}★] ${r.title}: ${r.text.slice(0, 120)}`);
  console.log(`category:    ${category.choice}  ${JSON.stringify(category.probabilities)}`);
  console.log(`confidence:  ${category.confidence ?? 'n/a'}`);
  console.log(`needsReply:  ${needsReply.noul}`);
  console.log(`model:       ${response.model ?? 'n/a'}`);
  console.log(`latency:     ${ms} ms`);
}
