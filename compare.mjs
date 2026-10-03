// Score Jev and a regular LLM (gpt-oss-20b on Groq's free tier) against your hand labels.
// Setup: npm i @typesafe-ai/sdk        (the LLM is called with plain fetch, no extra package)
// .env:  TYPESAFE_API_KEY=...  and  GROQ_API_KEY=...   (free key: console.groq.com, no card)
// Run:   node --env-file=.env compare.mjs
// Safe to rerun: every finished call is saved in results.json and never repeated,
// so Jev's 100 answers from the last run are reused as they are.
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { TypeSafeClient, choice } from '@typesafe-ai/sdk';

// ---- Settings ----
const JEV_MODEL = 'jev-latest'; // only used if Jev has reviews left to answer
const LLM_MODEL = 'openai/gpt-oss-20b'; // OpenAI's small open-weight model, served by Groq
const LLM_GAP_MS = Number(process.env.LLM_GAP_MS ?? 4500); // free tier: 30 requests and 8,000 tokens per minute
const PRICE = {
  // US$ per 1 million tokens, paid list prices. Leave llm as null and send me the token counts if unsure.
  jev: { input: 0.042, output: 0 },
  llm: { input: null, output: null }, // from Groq's pricing page for gpt-oss-20b
};

// Same definitions as label.mjs. Don't change them after seeing results.
const INSTRUCTION = 'What is this app review mainly about?';
const CATEGORIES = {
  bug: 'The app itself is broken: crashes, errors, login or payment screens failing',
  feature: 'Asks for something the app does not do yet',
  service: 'Delivery, refund, pricing, restaurant or customer support problem',
  praise: 'The reviewer is happy with the app or the service',
  other: 'Spam, unclear, or none of the above',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const reviewState = (r) => ({ rating: r.rating, title: r.title, text: r.text });

// ---- Jev ----
const jev = new TypeSafeClient(); // reads TYPESAFE_API_KEY

async function askJev(r) {
  const started = performance.now();
  const res = await jev.systemOne({
    model: JEV_MODEL,
    state: reviewState(r),
    questions: { category: choice(INSTRUCTION, CATEGORIES) },
  });
  const ms = performance.now() - started;
  const a = res.answers.category;
  return {
    answer: a.choice,
    probability: a.probabilities?.[a.choice] ?? null,
    confidence: a.confidence ?? null,
    ms,
    model: res.model ?? JEV_MODEL,
    inputTokens: res.usage?.input_tokens ?? res.usage?.inputTokens ?? null,
    outputTokens: 0,
  };
}

// ---- Regular LLM via Groq (OpenAI-compatible API) ----
function llmPrompt(r) {
  const list = Object.entries(CATEGORIES)
    .map(([key, desc]) => `- ${key}: ${desc}`)
    .join('\n');
  return `${INSTRUCTION}\n\nCategories:\n${list}\n\nReview:\n${JSON.stringify(reviewState(r))}\n\nPick the single best category. Reply with JSON only, like {"category": "service"}.`;
}

async function askLLM(r) {
  const started = performance.now();
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages: [{ role: 'user', content: llmPrompt(r) }],
      response_format: { type: 'json_object' },
      reasoning_effort: 'low', // a quick classification, not a long think
    }),
  });
  const ms = performance.now() - started;

  if (!res.ok) {
    const err = new Error(`${res.status} ${(await res.text()).slice(0, 300)}`);
    err.status = res.status;
    err.retryAfter = Number(res.headers.get('retry-after')) || null;
    throw err;
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content ?? '';
  let answer = 'invalid'; // an LLM can reply with something outside the five keys; that counts as wrong
  try {
    const c = JSON.parse(content).category;
    if (c in CATEGORIES) answer = c;
  } catch {}
  return {
    answer,
    raw: answer === 'invalid' ? content.slice(0, 200) : undefined,
    ms,
    model: data.model ?? LLM_MODEL,
    inputTokens: data.usage?.prompt_tokens ?? null,
    outputTokens: data.usage?.completion_tokens ?? 0, // includes its reasoning tokens
  };
}

// Retries only rate limits, server errors and network drops. A bad request (wrong key,
// wrong model name) stops at once, and a successful answer is never re-asked.
async function withRetry(fn, name) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = err?.status ?? err?.statusCode;
      const retryable = status == null || status === 429 || status >= 500;
      if (!retryable || attempt >= 5) throw err;
      const wait =
        status === 429 ? (err.retryAfter ? err.retryAfter * 1000 + 500 : 20_000) : 5_000 * attempt;
      console.log(`    ${name} error (${String(err?.message ?? err).slice(0, 90)}), retrying in ${Math.round(wait / 1000)}s`);
      await sleep(wait);
    }
  }
}

// ---- Run ----
const reviews = JSON.parse(await readFile('reviews.json', 'utf8'));
const labels = JSON.parse(await readFile('labels.json', 'utf8'));
const labelled = reviews.filter((r) => labels[r.id]);
if (labelled.length === 0) {
  console.error('No labelled reviews found. Run node label.mjs first.');
  process.exit(1);
}

const results = existsSync('results.json') ? JSON.parse(await readFile('results.json', 'utf8')) : {};
const save = () => writeFile('results.json', JSON.stringify(results, null, 2));
const n = labelled.length;
const line = (i, res, r) =>
  `  ${i + 1}/${n}  ${res.answer === labels[r.id] ? '✓' : '✗'} ${res.answer.padEnd(8)} you: ${labels[r.id].padEnd(8)} ${Math.round(res.ms)} ms`;

const jevTodo = labelled.filter((r) => !results[r.id]?.jev).length;
console.log(`\nJev on ${n} labelled reviews (${jevTodo} to go)`);
for (const [i, r] of labelled.entries()) {
  results[r.id] ??= {};
  if (results[r.id].jev) continue;
  results[r.id].jev = await withRetry(() => askJev(r), 'Jev');
  await save();
  console.log(line(i, results[r.id].jev, r));
}

const llmTodo = labelled.filter((r) => !results[r.id].llm).length;
console.log(`\n${LLM_MODEL} on ${n} labelled reviews (${llmTodo} to go, about ${Math.ceil((llmTodo * LLM_GAP_MS) / 60000)} min on the free tier)`);
let lastCall = 0;
for (const [i, r] of labelled.entries()) {
  if (results[r.id].llm) continue;
  const wait = lastCall + LLM_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
  results[r.id].llm = await withRetry(() => askLLM(r), 'LLM');
  await save();
  console.log(line(i, results[r.id].llm, r));
}

// ---- Score ----
function score(model) {
  const rows = labelled.map((r) => ({ r, res: results[r.id][model] })).filter((x) => x.res);
  const correct = rows.filter((x) => x.res.answer === labels[x.r.id]).length;
  const times = rows.map((x) => x.res.ms).sort((a, b) => a - b);
  const inTok = rows.reduce((s, x) => s + (x.res.inputTokens ?? 0), 0);
  const outTok = rows.reduce((s, x) => s + (x.res.outputTokens ?? 0), 0);
  const tokensKnown = rows.every((x) => x.res.inputTokens != null);
  const p = PRICE[model];
  const cost = tokensKnown && p.input != null ? (inTok * p.input + outTok * p.output) / 1e6 : null;
  return {
    reviews: rows.length,
    accuracy: `${Math.round((correct / rows.length) * 100)}% (${correct}/${rows.length})`,
    'avg latency': `${Math.round(times.reduce((s, t) => s + t, 0) / times.length)} ms`,
    'median latency': `${Math.round(times[Math.floor(times.length / 2)])} ms`,
    'cost (US$)': cost == null ? (tokensKnown ? 'set PRICE' : 'see console usage') : `$${cost.toFixed(4)}`,
    'input tokens': tokensKnown ? inTok : 'not reported',
    'output tokens': outTok,
    invalid: rows.filter((x) => x.res.answer === 'invalid').length,
    model: rows[0]?.res.model,
  };
}

const summary = { jev: score('jev'), llm: score('llm') };
console.log('\nResults vs your labels');
console.table(summary);

const counts = {};
for (const r of labelled) counts[labels[r.id]] = (counts[labels[r.id]] ?? 0) + 1;
const [topCat, topN] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
summary.labels = counts;
summary.alwaysMostCommon = { category: topCat, accuracy: `${Math.round((topN / n) * 100)}%` };
console.log(`\nYour labels: ${JSON.stringify(counts)}`);
console.log(`Answering "${topCat}" every time would score ${Math.round((topN / n) * 100)}%. That's the floor both models must beat.`);

const wrong = (model) => labelled.filter((r) => results[r.id][model]?.answer !== labels[r.id]);
const jevMisses = wrong('jev').sort(
  (a, b) => (results[b.id].jev.probability ?? 0) - (results[a.id].jev.probability ?? 0),
);
const bothWrong = jevMisses.filter((r) => results[r.id].llm && results[r.id].llm.answer !== labels[r.id]);
console.log(`\nJev's misses (${jevMisses.length}), most confident first. Pick one for image 2:`);
for (const r of jevMisses) {
  const j = results[r.id].jev;
  const sure = j.probability == null ? '' : ` · ${Math.round(j.probability * 100)}% sure`;
  console.log(`\n  ${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}  ${r.title}`);
  console.log(`  "${r.text.slice(0, 220)}${r.text.length > 220 ? '…' : ''}"`);
  console.log(`  you: ${labels[r.id]} · Jev: ${j.answer}${sure} · LLM: ${results[r.id].llm?.answer ?? '-'}`);
}

console.log(`\nLLM misses (${wrong('llm').length}):`);
for (const r of wrong('llm')) {
  const l = results[r.id].llm;
  console.log(`  "${r.title}" · you: ${labels[r.id]} · LLM: ${l.answer}${l.raw ? ` (replied: ${l.raw})` : ''}`);
}
console.log(`\nBoth wrong on ${bothWrong.length} review(s).`);

await writeFile('summary.json', JSON.stringify(summary, null, 2));
console.log('\nSaved results.json (every answer) and summary.json (the table).');
