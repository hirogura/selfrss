import db from './db.js';
import { fetchFeed, fetchAllFeeds } from './feed-fetcher.js';
import RssParser from 'rss-parser';
import { JSDOM } from 'jsdom';
import { execFile } from 'child_process';
import { createRequire } from 'module';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const APP_VERSION = require('../package.json').version;
const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SERVICE_NAME = process.env.SELFRSS_SERVICE || 'selfrss';
const GIT_BRANCH = process.env.SELFRSS_BRANCH || 'main';

function sh(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd: APP_ROOT, timeout: 600000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(String(stderr || err.message).trim()));
      else resolve(String(stdout));
    });
  });
}

function restartService(delayMs = 800) {
  setTimeout(() => { execFile('systemctl', ['restart', SERVICE_NAME], () => {}); }, delayMs);
}

const parser = new RssParser({ timeout: 15000, headers: { 'User-Agent': 'selfrss/1.0' } });

async function discoverFeeds(siteUrl) {
  try {
    let base = siteUrl.replace(/\/$/, '');
    if (!base.match(/^https?:\/\//)) base = 'https://' + base;
    const res = await fetch(base, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; selfrss/1.0)' }, signal: AbortSignal.timeout(10000), redirect: 'follow' });
    if (!res.ok) return [];
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) return [];
    const buffer = await res.arrayBuffer();
    let html;
    const ctMatch = contentType.match(/charset=([^\s;]+)/i);
    const encoding = ctMatch ? ctMatch[1].toLowerCase() : 'utf-8';
    if (encoding === 'euc-jp' || encoding === 'shift_jis' || encoding === 'sjis') {
      try { html = new TextDecoder(encoding).decode(buffer); } catch { html = new TextDecoder('utf-8').decode(buffer); }
    } else { html = new TextDecoder('utf-8').decode(buffer); }
    const dom = new JSDOM(html, { url: base });
    const doc = dom.window.document;
    const feeds = [];
    const links = doc.querySelectorAll('link[type*="rss"], link[type*="atom+xml"], link[type*="feed"]');
    for (const link of links) {
      const href = link.getAttribute('href');
      if (!href) continue;
      let feedUrl = href;
      if (feedUrl.startsWith('/')) { const u = new URL(base); feedUrl = u.origin + feedUrl; }
      else if (!feedUrl.startsWith('http')) feedUrl = base + '/' + feedUrl;
      const title = link.getAttribute('title') || '';
      if (!feeds.find(f => f.url === feedUrl)) feeds.push({ url: feedUrl, title: title });
    }
    return feeds;
  } catch { return []; }
}

function escapeXml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function getAttr(tag, name) {
  const m = tag.match(new RegExp(name + '\\s*=\\s*"([^"]*)"', 'i'));
  return m ? m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'") : null;
}

function parseOpml(xml) {
  const feeds = [];
  let currentFolder = null;
  const lines = xml.split(/(?=<outline\b)|(?=<\/outline>)/i);
  for (const chunk of lines) {
    const closeMatch = chunk.match(/^<\/outline>/i);
    if (closeMatch) {
      if (currentFolder !== null) currentFolder = null;
      continue;
    }
    const openMatch = chunk.match(/^<outline\b([^>]*?)(\/?)>/i);
    if (!openMatch) continue;
    const attrsStr = openMatch[1];
    const selfClosing = openMatch[2] === '/';
    const xmlUrl = getAttr(attrsStr, 'xmlUrl');
    const text = getAttr(attrsStr, 'text') || getAttr(attrsStr, 'title') || '';
    if (xmlUrl) {
      feeds.push({
        title: getAttr(attrsStr, 'title') || text,
        url: xmlUrl,
        siteUrl: getAttr(attrsStr, 'htmlUrl'),
        description: getAttr(attrsStr, 'description'),
        folder: currentFolder
      });
    } else {
      if (!selfClosing) currentFolder = text;
    }
  }
  return feeds;
}

function parseFavorites(text) {
  // 形式: エントリごとに空行区切り。URL 行でエントリを開始する。
  const entries = [];
  let current = null;
  for (const rawLine of String(text).split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([A-Za-z]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toUpperCase();
    const value = m[2].trim();
    if (key === 'URL') {
      if (current) entries.push(current);
      current = { url: value, feed: '', title: '', published_at: '' };
    } else if (current) {
      if (key === 'FEED') current.feed = value;
      else if (key === 'TITLE') current.title = value;
      else if (key === 'DATE') current.published_at = value;
    }
  }
  if (current) entries.push(current);
  return entries;
}

export default async function routes(app) {
  const noBody = { schema: { consumes: [] } };

  app.get('/version', async () => ({ version: APP_VERSION }));

  app.post('/admin/restart', noBody, async () => {
    restartService();
    return { ok: true };
  });

  app.post('/admin/update', noBody, async (req, reply) => {
    try {
      await sh('git', ['fetch', 'origin', GIT_BRANCH]);
      const local = (await sh('git', ['rev-parse', 'HEAD'])).trim();
      const remote = (await sh('git', ['rev-parse', 'origin/' + GIT_BRANCH])).trim();
      if (local === remote) return { ok: true, updated: false, message: 'すでに最新版です' };
      await sh('git', ['reset', '--hard', 'origin/' + GIT_BRANCH]);
      const changed = (await sh('git', ['diff', '--name-only', local, remote])).split('\n');
      let depsUpdated = false;
      if (changed.includes('package.json') || changed.includes('package-lock.json')) {
        await sh('npm', ['install', '--omit=dev']);
        depsUpdated = true;
      }
      restartService();
      return { ok: true, updated: true, message: 'アップデート完了' + (depsUpdated ? '（依存関係も更新）' : '') + '。サービスを再起動します' };
    } catch (err) { return reply.code(500).send({ error: err.message }); }
  });

  app.post('/opml/import', async (req, reply) => {
    const { opml } = req.body;
    if (!opml) return reply.code(400).send({ error: 'OPML content required' });
    try {
      const feeds = parseOpml(opml);
      if (feeds.length === 0) return reply.code(400).send({ error: 'No feeds found in OPML' });
      let imported = 0, skipped = 0;
      const folderMap = {};
      for (const feed of feeds) {
        if (feed.folder) {
          if (!folderMap[feed.folder]) {
            const existing = db.prepare('SELECT id FROM folders WHERE name = ?').get(feed.folder);
            if (existing) folderMap[feed.folder] = existing.id;
            else { const r = db.prepare('INSERT INTO folders (name) VALUES (?)').run(feed.folder); folderMap[feed.folder] = r.lastInsertRowid; }
          }
        }
        if (db.prepare('SELECT id FROM feeds WHERE url = ?').get(feed.url)) { skipped++; continue; }
        db.prepare('INSERT INTO feeds (title, url, site_url, folder_id) VALUES (?, ?, ?, ?)').run(feed.title, feed.url, feed.siteUrl, feed.folder ? folderMap[feed.folder] : null);
        imported++;
      }
      fetchAllFeeds().catch(() => {});
      return { imported, skipped, total: feeds.length };
    } catch (err) { return reply.code(500).send({ error: err.message }); }
  });

  app.post('/feeds/discover', async (req, reply) => {
    const { url } = req.body;
    if (!url) return reply.code(400).send({ error: 'URL required' });
    return { feeds: await discoverFeeds(url) };
  });

  app.get('/feeds', async () => {
    return db.prepare('SELECT f.*, COUNT(a.id) as article_count, SUM(CASE WHEN a.is_read = 0 THEN 1 ELSE 0 END) as unread_count, fl.name as folder_name FROM feeds f LEFT JOIN articles a ON a.feed_id = f.id LEFT JOIN folders fl ON fl.id = f.folder_id GROUP BY f.id ORDER BY fl.name, f.title').all();
  });

  app.post('/feeds', async (req, reply) => {
    const { url, folder_id } = req.body;
    if (!url) return reply.code(400).send({ error: 'URL required' });
    if (db.prepare('SELECT id FROM feeds WHERE url = ?').get(url)) return reply.code(409).send({ error: 'Feed already exists' });
    const result = db.prepare('INSERT INTO feeds (title, url, site_url, folder_id) VALUES (?, ?, ?, ?)').run(url, url, null, folder_id || null);
    fetchFeed(result.lastInsertRowid).catch(() => {});
    return { id: result.lastInsertRowid };
  });

  app.delete('/feeds/:id', async (req) => { db.prepare('DELETE FROM feeds WHERE id = ?').run(req.params.id); return { ok: true }; });

  app.put('/feeds/:id', async (req) => {
    const { title, folder_id } = req.body;
    if (title) db.prepare('UPDATE feeds SET title = ? WHERE id = ?').run(title, req.params.id);
    if (folder_id !== undefined) db.prepare('UPDATE feeds SET folder_id = ? WHERE id = ?').run(folder_id, req.params.id);
    return { ok: true };
  });

  app.post('/feeds/:id/refresh', async (req) => await fetchFeed(parseInt(req.params.id)));
  app.post('/feeds/refresh-all', async () => await fetchAllFeeds());

  app.get('/folders', async () => db.prepare('SELECT * FROM folders ORDER BY name').all());
  app.post('/folders', async (req, reply) => {
    const { name } = req.body;
    if (!name) return reply.code(400).send({ error: 'Name required' });
    try { return { id: db.prepare('INSERT INTO folders (name) VALUES (?)').run(name).lastInsertRowid }; }
    catch { return reply.code(409).send({ error: 'Folder already exists' }); }
  });
  app.delete('/folders/:id', async (req) => { db.prepare('DELETE FROM folders WHERE id = ?').run(req.params.id); return { ok: true }; });

  app.get('/articles', async (req) => {
    const { feed_id, folder_id, starred, unread, search, limit = 100, offset = 0 } = req.query;
    let where = [], params = [];
    if (feed_id) { where.push('a.feed_id = ?'); params.push(feed_id); }
    if (folder_id) { where.push('f.folder_id = ?'); params.push(folder_id); }
    if (starred === '1') where.push('a.is_starred = 1');
    if (unread === '1') where.push('a.is_read = 0');
    if (search) { where.push('(a.title LIKE ? OR a.summary LIKE ?)'); params.push('%' + search + '%', '%' + search + '%'); }
    const wc = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const articles = db.prepare('SELECT a.*, f.title as feed_title, f.site_url as feed_site_url FROM articles a JOIN feeds f ON f.id = a.feed_id ' + wc + ' ORDER BY a.published_at DESC LIMIT ? OFFSET ?').all(...params, parseInt(limit), parseInt(offset));
    const total = db.prepare('SELECT COUNT(*) as total FROM articles a JOIN feeds f ON f.id = a.feed_id ' + wc).get(...params).total;
    return { articles, total };
  });

  app.get('/articles/:id', async (req) => {
    const a = db.prepare('SELECT a.*, f.title as feed_title, f.site_url as feed_site_url FROM articles a JOIN feeds f ON f.id = a.feed_id WHERE a.id = ?').get(req.params.id);
    return a || { error: 'Not found' };
  });

  app.put('/articles/:id/read', noBody, async (req) => { db.prepare('UPDATE articles SET is_read = 1 WHERE id = ?').run(req.params.id); return { ok: true }; });
  app.put('/articles/:id/unread', noBody, async (req) => { db.prepare('UPDATE articles SET is_read = 0 WHERE id = ?').run(req.params.id); return { ok: true }; });
  app.put('/articles/:id/star', noBody, async (req) => { db.prepare('UPDATE articles SET is_starred = 1 WHERE id = ?').run(req.params.id); return { ok: true }; });
  app.put('/articles/:id/unstar', noBody, async (req) => { db.prepare('UPDATE articles SET is_starred = 0 WHERE id = ?').run(req.params.id); return { ok: true }; });
  app.put('/feeds/:id/mark-all-read', noBody, async (req) => { db.prepare('UPDATE articles SET is_read = 1 WHERE feed_id = ?').run(req.params.id); return { ok: true }; });
  app.put('/mark-all-read', noBody, async () => { db.prepare('UPDATE articles SET is_read = 1').run(); return { ok: true }; });

  app.get('/stats', async () => {
    return {
      total: db.prepare('SELECT COUNT(*) as c FROM articles').get().c,
      unread: db.prepare('SELECT COUNT(*) as c FROM articles WHERE is_read = 0').get().c,
      feeds: db.prepare('SELECT COUNT(*) as c FROM feeds').get().c,
      starred: db.prepare('SELECT COUNT(*) as c FROM articles WHERE is_starred = 1').get().c
    };
  });

  app.get('/opml/export', async (req, reply) => {
    const feeds = db.prepare('SELECT f.title, f.url, f.site_url, fl.name as folder_name FROM feeds f LEFT JOIN folders fl ON fl.id = f.folder_id ORDER BY fl.name, f.title').all();
    let opml = '<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">\n  <head>\n    <title>selfrss</title>\n    <dateCreated>' + new Date().toUTCString() + '</dateCreated>\n  </head>\n  <body>\n';
    const grouped = {};
    for (const f of feeds) { const k = f.folder_name || 'Uncategorized'; if (!grouped[k]) grouped[k] = []; grouped[k].push(f); }
    for (const [folder, items] of Object.entries(grouped)) {
      opml += '    <outline text="' + escapeXml(folder) + '">\n';
      for (const f of items) opml += '      <outline text="' + escapeXml(f.title) + '" type="rss" xmlUrl="' + escapeXml(f.url) + '"' + (f.site_url ? ' htmlUrl="' + escapeXml(f.site_url) + '"' : '') + '/>\n';
      opml += '    </outline>\n';
    }
    opml += '  </body>\n</opml>';
    reply.header('Content-Type', 'application/xml; charset=utf-8');
    const dateStr = new Date().toISOString().slice(0, 10);
    reply.header('Content-Disposition', 'attachment; filename="selfrss-export-' + dateStr + '.opml"');
    return reply.send(opml);
  });

  app.get('/favorites/export', async (req, reply) => {
    const rows = db.prepare('SELECT a.title, a.url, a.published_at, f.url as feed_url FROM articles a JOIN feeds f ON f.id = a.feed_id WHERE a.is_starred = 1 ORDER BY a.published_at DESC').all();
    let text = '# selfrss favorites\n# exported: ' + new Date().toISOString() + '\n# total: ' + rows.length + '\n\n';
    for (const r of rows) {
      text += 'URL: ' + r.url + '\n';
      text += 'FEED: ' + r.feed_url + '\n';
      text += 'TITLE: ' + (r.title || '').replace(/\n/g, ' ') + '\n';
      text += 'DATE: ' + (r.published_at || '') + '\n\n';
    }
    reply.header('Content-Type', 'text/plain; charset=utf-8');
    const dateStr = new Date().toISOString().slice(0, 10);
    reply.header('Content-Disposition', 'attachment; filename="selfrss-favorite-' + dateStr + '.txt"');
    return reply.send(text);
  });

  app.post('/favorites/import', async (req, reply) => {
    const { favorites } = req.body;
    if (!favorites) return reply.code(400).send({ error: 'Favorites content required' });
    try {
      const entries = parseFavorites(favorites);
      if (entries.length === 0) return reply.code(400).send({ error: 'No favorites found in file' });
      let imported = 0, skipped = 0;
      const feedByUrl = new Map();
      for (const e of entries) {
        if (!e.url || !e.feed) { skipped++; continue; }
        let feedId = feedByUrl.get(e.feed);
        if (feedId === undefined) {
          const feed = db.prepare('SELECT id FROM feeds WHERE url = ?').get(e.feed);
          feedId = feed ? feed.id : null;
          feedByUrl.set(e.feed, feedId);
        }
        if (!feedId) { skipped++; continue; }
        const article = db.prepare('SELECT id, is_starred FROM articles WHERE feed_id = ? AND url = ?').get(feedId, e.url);
        if (!article) { skipped++; continue; }
        if (article.is_starred) { skipped++; continue; }
        db.prepare('UPDATE articles SET is_starred = 1 WHERE id = ?').run(article.id);
        imported++;
      }
      return { imported, skipped, total: entries.length };
    } catch (err) { return reply.code(500).send({ error: err.message }); }
  });
}
