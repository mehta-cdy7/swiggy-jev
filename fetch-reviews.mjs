// Fetch up to 500 recent Swiggy reviews (India storefront) from Apple's public RSS feed.
// No API key needed. Run: node fetch-reviews.mjs
import { writeFile } from 'node:fs/promises';

const APP_ID = '989540920'; // Swiggy
const COUNTRY = 'in';
const PAGES = 10; // Apple serves at most 10 pages x 50 reviews

const reviews = new Map();

for (let page = 1; page <= PAGES; page++) {
  const url = `https://itunes.apple.com/${COUNTRY}/rss/customerreviews/page=${page}/id=${APP_ID}/sortby=mostrecent/json`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`Page ${page}: HTTP ${res.status}, stopping.`);
    break;
  }

  const data = await res.json();
  const entries = [].concat(data?.feed?.entry ?? []);
  let added = 0;

  for (const e of entries) {
    if (!e['im:rating']) continue; // the first entry is sometimes app metadata, not a review
    const id = e.id?.label;
    if (!id || reviews.has(id)) continue;
    reviews.set(id, {
      id,
      rating: Number(e['im:rating'].label),
      title: e.title?.label ?? '',
      text: e.content?.label ?? '',
      version: e['im:version']?.label ?? '',
      date: e.updated?.label ?? '',
    });
    added++;
  }

  console.log(`Page ${page}: +${added} (total ${reviews.size})`);
  if (entries.length === 0) break;
  await new Promise((r) => setTimeout(r, 500)); // be polite to Apple's servers
}

await writeFile('reviews.json', JSON.stringify([...reviews.values()], null, 2));
console.log(`Saved ${reviews.size} reviews to reviews.json`);
