import RssParser from 'rss-parser';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import db from './db.js';

const parser = new RssParser({ timeout: 15000, headers: { 'User-Agent': 'selfrss/1.0' } });
const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
let refreshing = false;

function extractContent(html, baseUrl) {
  try {
    const dom = new JSDOM(html, { url: baseUrl || 'https://example.com' });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    if (article && article.content) return turndown.turndown(article.content);
  } catch {}
  return null;
}

function extractRssContent(html) {
  if (!html) return null;
  try { return turndown.turndown(html); } catch {}
  return null;
}

function stripTags(html) {
  if (!html) return '';
  return html.replace(/<[^>]*>/g, '').replace(/&[^;]+;/g, ' ').trim();
}

function decodeWithDetection(bytes) {
  const encodings = ['euc-jp', 'shift_jis', 'utf-8'];
  for (const enc of encodings) {
    try {
      const decoded = new TextDecoder(enc, { fatal: true }).decode(bytes);
      if (!decoded.includes('\ufffd')) return decoded;
    } catch {}
  }
  return new TextDecoder('utf-8').decode(bytes);
}

async function fetchFullText(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; selfrss/1.0)' }, signal: AbortSignal.timeout(10000), redirect: 'follow' });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) return null;
    let encoding = 'utf-8';
    const ctMatch = contentType.match(/charset=([^\s;]+)/i);
    if (ctMatch) encoding = ctMatch[1].toLowerCase();
    const buffer = await res.arrayBuffer();
    let html;
    if (encoding === 'euc-jp' || encoding === 'shift_jis' || encoding === 'sjis' || encoding === 'iso-2022-jp') {
      try { html = new TextDecoder(encoding).decode(buffer); } catch { html = decodeWithDetection(new Uint8Array(buffer)); }
    } else {
      html = new TextDecoder('utf-8').decode(buffer);
      if (html.includes('\ufffd')) html = decodeWithDetection(new Uint8Array(buffer));
    }
    return extractContent(html, url);
  } catch { return null; }
}

async function processItems(items, feedId, insertArticle) {
  let added = 0;
  const CONCURRENCY = 3;
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const batch = items.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(async (item) => {
      const url = item.link || item.guid;
      if (!url) return null;
      let content = null;
      if (item.content) content = extractRssContent(item.content);
      if (!content && item['content:encoded']) content = extractRssContent(item['content:encoded']);
      if (!content || (content && content.length < 1000)) {
        const fullText = await fetchFullText(url);
        if (fullText && fullText.length > (content ? content.length : 0)) content = fullText;
      }
      const summary = item.contentSnippet ? item.contentSnippet.substring(0, 500) : (item.content ? stripTags(item.content).substring(0, 500) : '');
      const pubDate = item.isoDate || item.pubDate || new Date().toISOString();
      return insertArticle.run(feedId, item.title || 'Untitled', url, item.creator || item.author || null, content, summary, pubDate);
    }));
    for (const r of results) { if (r && r.changes > 0) added++; }
  }
  return added;
}

export async function fetchFeed(feedId) {
  const feed = db.prepare('SELECT * FROM feeds WHERE id = ?').get(feedId);
  if (!feed) return { added: 0, error: 'Feed not found' };
  try {
    const res = await fetch(feed.url, { headers: { 'User-Agent': 'selfrss/1.0' }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const contentType = res.headers.get('content-type') || '';
    let encoding = 'utf-8';
    const ctMatch = contentType.match(/charset=([^\s;]+)/i);
    if (ctMatch) encoding = ctMatch[1].toLowerCase();
    const buffer = await res.arrayBuffer();
    let xml;
    if (encoding === 'euc-jp' || encoding === 'shift_jis' || encoding === 'sjis' || encoding === 'iso-2022-jp') {
      try { xml = new TextDecoder(encoding).decode(buffer); } catch { xml = new TextDecoder('utf-8').decode(buffer); }
    } else {
      xml = new TextDecoder('utf-8').decode(buffer);
      if (xml.includes('\ufffd')) { try { xml = new TextDecoder('euc-jp').decode(buffer); } catch {} }
    }
    const parsed = await parser.parseString(xml);
    db.prepare("UPDATE feeds SET title = ?, site_url = ?, last_fetched_at = datetime('now'), fetch_error = NULL WHERE id = ?").run(parsed.title || feed.title, parsed.link || feed.site_url, feedId);
    const insertArticle = db.prepare('INSERT OR IGNORE INTO articles (feed_id, title, url, author, content, summary, published_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const items = (parsed.items || []).slice(0, 30);
    const added = await processItems(items, feedId, insertArticle);
    return { added, total: items.length };
  } catch (err) {
    db.prepare("UPDATE feeds SET fetch_error = ?, last_fetched_at = datetime('now') WHERE id = ?").run(err.message, feedId);
    return { added: 0, error: err.message };
  }
}

export async function fetchAllFeeds() {
  if (refreshing) return { error: 'Refresh already in progress' };
  refreshing = true;
  try {
    const feeds = db.prepare('SELECT id FROM feeds').all();
    const results = [];
    const CONCURRENCY = 3;
    for (let i = 0; i < feeds.length; i += CONCURRENCY) {
      const batch = feeds.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(batch.map(async (feed) => {
        const result = await fetchFeed(feed.id);
        return { feedId: feed.id, ...result };
      }));
      results.push(...batchResults);
    }
    return results;
  } finally { refreshing = false; }
}
