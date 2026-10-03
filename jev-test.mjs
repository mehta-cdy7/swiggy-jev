// Go/no-go check: can we call Jev and get typed answers back?
// Setup: npm i ai            (needs ai 7.0.105+ and Node 22+)
// Key:   create an AI Gateway API key in your Vercel dashboard,
//        then put AI_GATEWAY_API_KEY=your_key in a .env file
// Run:   node --env-file=.env jev-test.mjs
import { readFile } from 'node:fs/promises';
import { experimental_evaluate as evaluate } from 'ai';

const reviews = JSON.parse(await readFile('reviews.json', 'utf8'));
const sample = reviews.slice(0, 3);

for (const r of sample) {
  const started = performance.now();

  const result = await evaluate({
    model: 'typesafe-ai/jev',
    state: { rating: r.rating, title: r.title, text: r.text },
    questions: {
      category: {
        type: 'choice',
        instructions: 'What is this app review mainly about?',
        criteria: {
          bug: 'The app itself is broken: crashes, errors, login or payment screens failing',
          feature: 'Asks for something the app does not do yet',
          service: 'Delivery, refund, pricing, restaurant or customer support problem',
          praise: 'The reviewer is happy with the app or the service',
          other: 'Spam, unclear, or none of the above',
        },
      },
      needsReply: {
        type: 'boolean',
        instructions: 'The developer should reply to this review',
      },
    },
  });

  const ms = Math.round(performance.now() - started);
  const { category, needsReply } = result.answers;
  const confidence = result.providerMetadata?.typesafe?.confidence?.category;

  console.log('\n---');
  console.log(`[${r.rating}★] ${r.title}: ${r.text.slice(0, 120)}`);
  console.log(`category:    ${category.choice}  ${JSON.stringify(category.probabilities)}`);
  console.log(`confidence:  ${confidence ?? 'n/a'}`);
  console.log(`needsReply:  ${needsReply.probability}`);
  console.log(`latency:     ${ms} ms`);
}
