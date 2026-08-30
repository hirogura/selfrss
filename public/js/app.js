const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

let currentView = 'all';
let currentFeedId = null;
let currentFolderId = null;
let currentArticleId = null;
let articleOffset = 0;
let articleTotal = 0;
let articleLoading = false;
let currentSearchQuery = '';
let searchTimeout = null;
let compactMode = localStorage.getItem('selfrss-compact') === '1';
let sidebarVisible = localStorage.getItem('selfrss-sidebar') !== '0';
let articleWidth = localStorage.getItem('selfrss-article-width') || '';
let sidebarNarrow = localStorage.getItem('selfrss-sidebar-narrow') === '1';
let hideRead = localStorage.getItem('selfrss-hide-read') === '1';
let autoScrollNext = localStorage.getItem('selfrss-auto-scroll') === '1';
let hideRelated = localStorage.getItem('selfrss-hide-related') === '1';
let currentArticleData = null;

async function api(path, opts = {}) {
  const headers = opts.body ? { 'Content-Type': 'application/json' } : {};
  const res = await fetch('/api' + path, { ...opts, headers: { ...headers, ...opts.headers }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  return res.json();
}

function initTheme() {
  const saved = localStorage.getItem('selfrss-theme');
  if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) document.documentElement.classList.add('dark');
}
function toggleTheme() {
  document.documentElement.classList.toggle('dark');
  localStorage.setItem('selfrss-theme', document.documentElement.classList.contains('dark') ? 'dark' : 'light');
}

function renderStats(stats) {
  $('#stats').textContent = stats.total + ' articles · ' + stats.feeds + ' feeds';
  const ab = $('#badge-all');
  if (ab) { ab.textContent = stats.total || ''; ab.className = stats.total ? 'badge badge-plain' : 'badge'; }
  $('#badge-unread').textContent = stats.unread || '';
  const sb = $('#badge-starred');
  if (sb) { sb.textContent = stats.starred || ''; sb.className = stats.starred ? 'badge badge-plain' : 'badge'; }
}

function renderFeedList(feeds, folders) {
  const container = $('#feed-list');
  container.innerHTML = '';
  const grouped = {};
  for (const f of feeds) { const key = f.folder_name || '__root__'; if (!grouped[key]) grouped[key] = []; grouped[key].push(f); }
  for (const [folder, items] of Object.entries(grouped)) {
    if (folder !== '__root__') {
      const totalUnread = items.reduce((sum, f) => sum + (f.unread_count || 0), 0);
      const folderId = items[0] ? items[0].folder_id : null;
      const el = document.createElement('div');
      el.className = 'folder-item' + (currentView === 'folder' && currentFolderId === folderId ? ' active' : '');
      el.dataset.folderId = folderId;
      el.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg><span>' + folder + '</span>' + (totalUnread > 0 ? '<span class="badge badge-muted">' + totalUnread + '</span>' : '');
      el.addEventListener('click', (function(fid,fn){return function(){selectFolder(fid,fn)}})(folderId,folder));
      container.appendChild(el);
    }
    for (const feed of items) {
      const el = document.createElement('div');
      el.className = 'feed-item' + (currentView === 'feed' && currentFeedId === feed.id ? ' active' : '');
      el.dataset.feedId = feed.id;
      el.innerHTML = '<span class="feed-title">' + esc(feed.title) + '</span>' + (feed.unread_count ? '<span class="badge">' + feed.unread_count + '</span>' : '');
      el.addEventListener('click', (function(id,title){return function(){selectFeed(id,title)}})(feed.id,feed.title));
      container.appendChild(el);
    }
  }
  if (folders && folders.length > 0) {
    for (const folder of folders) {
      if (!grouped[folder.name]) {
        const el = document.createElement('div');
        el.className = 'folder-item' + (currentView === 'folder' && currentFolderId === folder.id ? ' active' : '');
        el.dataset.folderId = folder.id;
        el.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg><span>' + esc(folder.name) + '</span>';
        el.addEventListener('click', (function(id,name){return function(){selectFolder(id,name)}})(folder.id,folder.name));
        container.appendChild(el);
      }
    }
  }
  if (feeds.length === 0 && (!folders || folders.length === 0)) {
    container.innerHTML = '<div class="empty-state"><p>フィードがありません。追加しましょう！</p></div>';
  }
}

function renderArticles(articles) {
  const container = $('#article-list');
  container.innerHTML = '';
  if (hideRead && currentView !== 'starred') articles = articles.filter(function(a){ return !a.is_read; });
  if (articles.length === 0) { container.innerHTML = '<div class="empty-state"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><p>記事がありません</p></div>'; return; }
  container.classList.toggle('compact', compactMode);
  appendArticleCards(container, articles);
}

function appendArticleCards(container, articles) {
  if (hideRead && currentView !== 'starred') articles = articles.filter(function(a){ return !a.is_read; });
  for (const a of articles) {
    const el = document.createElement('div');
    el.className = 'article-card' + (a.is_read ? '' : ' unread') + (currentArticleId === a.id ? ' active' : '');
    el.dataset.articleId = a.id;
    if (compactMode) { el.innerHTML = '<div class="article-card-title">' + esc(a.title) + '</div>'; }
    else { el.innerHTML = '<div class="article-card-title">' + esc(a.title) + '</div><div class="article-card-meta"><span class="article-card-feed">' + esc(a.feed_title) + '</span><span>' + timeAgo(a.published_at) + '</span>' + (a.is_starred ? '<span class="article-card-star">&#9733;</span>' : '') + '</div>' + (a.summary ? '<div class="article-card-summary">' + esc(a.summary) + '</div>' : ''); }
    el.addEventListener('click', (function(id){return function(){selectArticle(id)}})(a.id));
    container.appendChild(el);
  }
}

function appendArticles(articles) {
  const container = $('#article-list');
  appendArticleCards(container, articles);
}

function renderContent(article) {
  currentArticleData = article;
  var navTitle = $('#content-nav-title'); if (navTitle) navTitle.textContent = article ? article.title : '';
  if (!article) { $('#content-placeholder').style.display = 'flex'; $('#content-view').style.display = 'none'; return; }
  $('#content-placeholder').style.display = 'none'; $('#content-view').style.display = 'flex'; $('#content-pane').scrollTop = 0;
  $('#content-title').textContent = article.title;
  $('#content-feed').textContent = article.feed_title;
  $('#content-author').textContent = article.author ? 'by ' + article.author : '';
  $('#content-date').textContent = formatDate(article.published_at);
  var body = article.content || article.summary || '<p>コンテンツがありません。</p>';
  $('#content-body').innerHTML = '<div class="prose">' + markdownToHtml(body) + '</div>';
  applyHideRelated();
  updateStarButton(article.is_starred);
  $('#btn-open-original').onclick = function(){ window.open(article.url, '_blank'); };
}

function updateStarButton(s) {
  var b = $('#btn-star'); b.dataset.starred = String(s || 0);
  b.innerHTML = s
    ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="#f59e0b" stroke="#f59e0b" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>'
    : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
}

async function loadFeeds() { var f = await api('/feeds'); var fl = await api('/folders'); renderFeedList(f, fl); }
async function loadStats() { renderStats(await api('/stats')); }

async function loadArticles(p, append) {
  p = p || {};
  if (hideRead && currentView !== 'starred') p.unread = '1';
  if (!append) { articleOffset = 0; }
  p.limit = 100;
  p.offset = articleOffset;
  var qs = new URLSearchParams(p).toString();
  var d = await api('/articles' + (qs ? '?' + qs : ''));
  articleTotal = d.total;
  articleOffset = articleOffset + d.articles.length;
  if (append) { appendArticles(d.articles); }
  else { renderArticles(d.articles); }
}

async function loadMoreArticles() {
  if (articleLoading || articleOffset >= articleTotal) return;
  articleLoading = true;
  var p = {};
  if (currentSearchQuery) { p.search = currentSearchQuery; }
  else if (currentView === 'feed') p.feed_id = currentFeedId;
  else if (currentView === 'folder') p.folder_id = currentFolderId;
  else if (currentView === 'unread') p.unread = '1';
  else if (currentView === 'starred') p.starred = '1';
  await loadArticles(p, true);
  articleLoading = false;
}

async function selectFeed(id, title) {
  currentView = 'feed'; currentFeedId = id; currentFolderId = null; currentArticleId = null;
  $('#article-pane-title').textContent = title;
  $$('.nav-item').forEach(function(n){n.classList.remove('active')});
  $$('.feed-item').forEach(function(f){f.classList.toggle('active', parseInt(f.dataset.feedId) === id)});
  $$('.folder-item').forEach(function(f){f.classList.remove('active')});
  var d = $('#btn-delete-feed'); if (d) { d.style.display = ''; d.title = 'フィード削除'; }
  renderContent(null); await loadArticles({ feed_id: id });
}

async function selectFolder(id, name) {
  currentView = 'folder'; currentFolderId = id; currentFeedId = null; currentArticleId = null;
  $('#article-pane-title').textContent = name;
  $$('.nav-item').forEach(function(n){n.classList.remove('active')});
  $$('.feed-item').forEach(function(f){f.classList.remove('active')});
  $$('.folder-item').forEach(function(f){f.classList.toggle('active', parseInt(f.dataset.folderId) === id)});
  var d = $('#btn-delete-feed'); if (d) { d.style.display = ''; d.title = 'カテゴリー削除'; }
  renderContent(null); await loadArticles({ folder_id: id });
}

async function selectArticle(id) {
  currentArticleId = id;
  var article = await api('/articles/' + id);
  renderContent(article);
  await api('/articles/' + id + '/read', { method: 'PUT' });
  var card = $('.article-card[data-article-id="' + id + '"]');
  if (card) {
    card.classList.remove('unread');
    var list = $('#article-list');
    var cardRect = card.getBoundingClientRect();
    var listRect = list.getBoundingClientRect();
    if (cardRect.top < listRect.top || cardRect.bottom > listRect.bottom) {
      card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }
  await Promise.all([loadStats(), loadFeeds()]);
}

function setView(view) {
  currentView = view; currentFeedId = null; currentFolderId = null; currentArticleId = null; currentSearchQuery = '';
  renderContent(null);
  $$('.nav-item').forEach(function(n){n.classList.toggle('active', n.dataset.view === view)});
  $$('.feed-item').forEach(function(f){f.classList.remove('active')});
  $$('.folder-item').forEach(function(f){f.classList.remove('active')});
  var d = $('#btn-delete-feed'); if (d) d.style.display = 'none';
  var t = { all: '全記事', unread: '未読', starred: 'お気に入り' };
  $('#article-pane-title').textContent = t[view] || '記事';
  var p = {};
  if (view === 'unread') p.unread = '1';
  if (view === 'starred') p.starred = '1';
  loadArticles(p);
}

function hideModal() { $('#modal-overlay').style.display = 'none'; var d = $('#modal-discover'); if (d) d.style.display = 'none'; }
function esc(s) { if (!s) return ''; return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function timeAgo(d) { if (!d) return ''; var diff = Date.now() - new Date(d).getTime(); var m = Math.floor(diff / 60000); if (m < 1) return 'just now'; if (m < 60) return m + 'm ago'; var h = Math.floor(m / 60); if (h < 24) return h + 'h ago'; var dy = Math.floor(h / 24); if (dy < 30) return dy + 'd ago'; return new Date(d).toLocaleDateString('ja-JP'); }
function formatDate(d) { if (!d) return ''; return new Date(d).toLocaleString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
function markdownToHtml(md) { if (!md) return ''; return md.replace(/^### (.+)$/gm, '<h3>$1</h3>').replace(/^## (.+)$/gm, '<h2>$1</h2>').replace(/^# (.+)$/gm, '<h1>$1</h1>').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>').replace(/`(.+?)`/g, '<code>$1</code>').replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>').replace(/^\> (.+)$/gm, '<blockquote>$1</blockquote>').replace(/^- (.+)$/gm, '<li>$1</li>').replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>').replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" loading="lazy">').replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>').replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>'); }

var RELATED_HEAD_PATTERN = /^(関連\s*(?:記事|する記事|エントリー|エントリ|リンク|情報|ページ|コンテンツ|ニュース|まとめ)|あわせて\s*(?:読みたい|よみたい)|おすすめ(?:\s*の?\s*(?:記事|エントリー|コンテンツ|本|書籍|記事一覧)|\s*$)|注目記事|新着記事|(?:アクセス|週間|月間|人気|総合)?ランキング|ranking|人気(?:\s*の\s*)?(?:記事|エントリー|ブログ記事)|こちらもおすすめ|こちらの記事も|続きを読む|次の記事|前の記事|この記事を書いた人|プロフィール|スポンサー(?:ド)?リンク|広告|advertisement|advertising|sponsored(?:\s*links)?|related(?:\s*(?:posts|articles|entries))?|recommended(?:\s*(?:for\s*you|posts|articles))?|you\s*may\s*also\s*like)/i;
var RELATED_BLOCK_PATTERN = /^(関連\s*(?:記事|する記事|エントリー|エントリ|コンテンツ|ニュース|まとめ)|あわせて\s*(?:読みたい|よみたい)|おすすめ(?:\s*の?\s*(?:記事|エントリー|コンテンツ|本|書籍|記事一覧)|\s*$)|注目記事|(?:アクセス|週間|月間|人気|総合)?ランキング|ranking|人気(?:\s*の\s*)?(?:記事|エントリー|ブログ記事)|こちらもおすすめ|続きを読む|次の記事|前の記事|この記事を書いた人|スポンサー(?:ド)?リンク|広告|advertisement|advertising|sponsored(?:\s*links)?|related(?:\s*(?:posts|articles|entries))?|recommended(?:\s*(?:for\s*you|posts|articles))?|you\s*may\s*also\s*like)/i;

function hideFrom(root, el) {
  while (el.parentNode && el.parentNode !== root) {
    var parent = el.parentNode;
    var s = el.nextSibling;
    while (s) { var ns = s.nextSibling; s.remove(); s = ns; }
    el = parent;
  }
  var s = el.nextSibling;
  while (s) { var ns = s.nextSibling; s.remove(); s = ns; }
  el.remove();
}

function applyHideRelated() {
  if (!hideRelated) return;
  var body = $('#content-body');
  if (!body) return;
  var root = body.querySelector('.prose') || body;
  var nodes = root.querySelectorAll('h1,h2,h3,h4,h5,h6,strong,b,p,div,section,li,dt');
  var cut = null;
  for (var i = 0; i < nodes.length; i++) {
    var el = nodes[i];
    var tag = el.tagName;
    var isHead = tag === 'H1' || tag === 'H2' || tag === 'H3' || tag === 'H4' || tag === 'H5' || tag === 'H6' || tag === 'STRONG' || tag === 'B';
    var t = (el.textContent || '').trim().replace(/^[・■◆●○◎◇□▶▷◀◁★☆※→←⇒⇔∴•◦·\-\u2013\u2014]+/, '');
    if (!t) continue;
    var sample = t.slice(0, 50);
    if (!(isHead ? RELATED_HEAD_PATTERN : RELATED_BLOCK_PATTERN).test(sample)) continue;
    if (!isHead && t.length > 30 && !el.querySelector('ul,ol,p,div,h1,h2,h3,h4,h5,h6,li')) continue;
    var range = document.createRange();
    range.selectNodeContents(root);
    range.setEnd(el, 0);
    var before = range.toString().length;
    var total = root.textContent.length;
    if (total > 100 && before / total < 0.15) continue;
    cut = el;
    break;
  }
  if (cut) hideFrom(root, cut);
}

function applyArticleWidth() {
  var pane = $('#article-pane');
  var navBar = $('#article-nav-bar');
  $$('.width-btn').forEach(function(b){b.classList.toggle('active', b.dataset.width === articleWidth)});
  if (articleWidth) {
    var sidebarW = ($('#sidebar').style.display === 'none') ? 0 : (sidebarNarrow ? 130 : 260);
    var avail = window.innerWidth - sidebarW;
    var base = Math.min(avail, 420);
    pane.style.width = Math.round(base * parseInt(articleWidth) / 100) + 'px';
    pane.style.flex = 'none';
    pane.classList.add('narrow');
    navBar.style.display = 'flex';
  } else {
    pane.style.width = '';
    pane.style.flex = '';
    pane.classList.remove('narrow');
    navBar.style.display = 'none';
  }
}

function navigatePrevArticle() {
  var cards = Array.prototype.slice.call($$('.article-card'));
  if (!cards.length) return;
  var idx = -1;
  for (var i = 0; i < cards.length; i++) { if (cards[i].dataset.articleId == currentArticleId) { idx = i; break; } }
  var prev = idx > 0 ? cards[idx - 1] : cards[cards.length - 1];
  if (prev) selectArticle(parseInt(prev.dataset.articleId));
}

function navigateNextUnread() {
  var cards = Array.prototype.slice.call($$('.article-card'));
  if (!cards.length) return;
  var idx = -1;
  for (var i = 0; i < cards.length; i++) { if (cards[i].dataset.articleId == currentArticleId) { idx = i; break; } }
  for (var i = idx + 1; i < cards.length; i++) {
    if (cards[i].classList.contains('unread')) { selectArticle(parseInt(cards[i].dataset.articleId)); return; }
  }
  for (var i = 0; i <= idx; i++) {
    if (cards[i].classList.contains('unread')) { selectArticle(parseInt(cards[i].dataset.articleId)); return; }
  }
  loadFeeds().then(async function(){
    var feeds=await api('/feeds');
    var ci=-1;for(var i=0;i<feeds.length;i++){if(feeds[i].id===currentFeedId){ci=i;break}}
    for(var i=(ci>=0?ci+1:0);i<feeds.length;i++){if(feeds[i].unread_count>0){await selectFeed(feeds[i].id,feeds[i].title);var d=await api('/articles?feed_id='+feeds[i].id+'&unread=1&limit=1');if(d.articles&&d.articles.length>0)selectArticle(d.articles[0].id);return;}}
    for(var i=0;i<=ci;i++){if(feeds[i].unread_count>0){await selectFeed(feeds[i].id,feeds[i].title);var d=await api('/articles?feed_id='+feeds[i].id+'&unread=1&limit=1');if(d.articles&&d.articles.length>0)selectArticle(d.articles[0].id);return;}}
  });
}

initTheme();
$$('.nav-item').forEach(function(n){n.addEventListener('click', function(e){e.preventDefault();setView(n.dataset.view)})});
$('#btn-toggle-sidebar') && $('#btn-toggle-sidebar').addEventListener('click', function(){$('#sidebar').classList.toggle('open')});
$('#btn-back') && $('#btn-back').addEventListener('click', function(){$('#content-pane').classList.remove('show')});
$('#btn-theme').addEventListener('click', toggleTheme);
$('#btn-toggle-sidebar-desktop') && $('#btn-toggle-sidebar-desktop').addEventListener('click', function(){sidebarVisible=!sidebarVisible;localStorage.setItem('selfrss-sidebar',sidebarVisible?'1':'0');$('#sidebar').style.display=sidebarVisible?'':'none';$('#btn-toggle-sidebar-desktop').classList.toggle('active',sidebarVisible);applyArticleWidth()});
$('#btn-sidebar-half') && $('#btn-sidebar-half').addEventListener('click', function(){
  sidebarNarrow=!sidebarNarrow;
  localStorage.setItem('selfrss-sidebar-narrow',sidebarNarrow?'1':'0');
  $('#sidebar').classList.toggle('sidebar-narrow',sidebarNarrow);
  this.classList.toggle('active',sidebarNarrow);
  applyArticleWidth();
});
$('#btn-view-mode') && $('#btn-view-mode').addEventListener('click', function(){compactMode=!compactMode;localStorage.setItem('selfrss-compact',compactMode?'1':'0');$('#btn-view-mode').innerHTML=compactMode?'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>':'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>';setView(currentView)});
if (!sidebarVisible) { $('#sidebar').style.display='none'; var bsd=$('#btn-toggle-sidebar-desktop');if(bsd)bsd.classList.remove('active'); }
if (sidebarNarrow) { $('#sidebar').classList.add('sidebar-narrow'); var bh=$('#btn-sidebar-half'); if(bh)bh.classList.add('active'); }
if (compactMode) { var vm=$('#btn-view-mode');if(vm)vm.innerHTML='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>'; }

$('#btn-add-feed').addEventListener('click', async function() {
  var folders = await api('/folders');
  var select = $('#modal-folder-select');
  select.innerHTML = '<option value="">カテゴリーを選択（任意）</option>';
  for (var i = 0; i < folders.length; i++) { select.innerHTML += '<option value="'+folders[i].id+'">'+esc(folders[i].title||folders[i].name)+'</option>'; }
  if (currentFolderId) select.value = currentFolderId;
  $('#modal-title').textContent = 'フィード追加';
  $('#modal-input').placeholder = 'https://example.com/feed.xml';
  $('#modal-input').value = '';
  $('#modal-error').textContent = '';
  $('#modal-discover').style.display = 'none';
  $('#modal-overlay').style.display = 'flex';
  $('#modal-input').focus();
  var composing = false;
  var onStart = function(){composing=true};
  var onEnd = function(){composing=false};
  $('#modal-input').addEventListener('compositionstart', onStart);
  $('#modal-input').addEventListener('compositionend', onEnd);
  var handler = async function() {
    if (composing) return;
    var url = $('#modal-input').value.trim();
    if (!url) return;
    var folderId = $('#modal-folder-select').value || null;
    var looksLikeFeed = /\.(xml|rss|atom|rdf)(\?[^]*)?$/i.test(url) || /\/feed(\/)?(\?[^]*)?$/i.test(url) || /\/rss(\/)?(\?[^]*)?$/i.test(url);
    try {
      if (looksLikeFeed) {
        var res = await api('/feeds', { method: 'POST', body: { url: url, folder_id: folderId } });
        if (res.error) throw new Error(res.error);
        hideModal(); await loadFeeds(); await loadStats();
      } else {
        var d = $('#modal-discover');
        d.style.display = 'block';
        d.innerHTML = 'フィードを探しています...';
        var disc = await api('/feeds/discover', { method: 'POST', body: { url: url } });
        if (disc.feeds && disc.feeds.length > 0) {
          d.innerHTML = '<strong>以下のフィードが見つかりました:</strong><br>';
          for (var i = 0; i < disc.feeds.length; i++) {
            var f = disc.feeds[i];
            d.innerHTML += '<div style="margin:6px 0"><a href="#" class="discover-link" data-url="'+esc(f.url)+'" data-title="'+esc(f.title)+'" style="color:var(--accent)">'+esc(f.title||f.url)+'</a><br><span style="font-size:11px;color:var(--text-muted)">'+esc(f.url)+'</span></div>';
          }
          d.querySelectorAll('.discover-link').forEach(function(link){
            link.addEventListener('click', async function(e){
              e.preventDefault();
              var r = await api('/feeds', { method: 'POST', body: { url: link.dataset.url, folder_id: folderId } });
              if (r.error) throw new Error(r.error);
              hideModal(); await loadFeeds(); await loadStats();
            });
          });
          return;
        } else { throw new Error('フィードが見つかりませんでした。URLを確認してください。'); }
      }
    } catch(e) { $('#modal-error').textContent = e.message; }
  };
  $('#btn-modal-confirm').onclick = handler;
  $('#btn-modal-cancel').onclick = function(){hideModal();$('#modal-input').removeEventListener('compositionstart',onStart);$('#modal-input').removeEventListener('compositionend',onEnd)};
  $('#btn-modal-close').onclick = function(){hideModal();$('#modal-input').removeEventListener('compositionstart',onStart);$('#modal-input').removeEventListener('compositionend',onEnd)};
  $('#modal-input').onkeydown = function(e){if(e.key==='Enter'&&!composing)handler()};
});

$('#btn-add-folder').addEventListener('click', function() {
  var fs=$('#modal-folder-select'); if(fs)fs.style.display='none';
  var d=$('#modal-discover'); if(d)d.style.display='none';
  $('#modal-title').textContent='カテゴリー追加';
  $('#modal-input').placeholder='カテゴリー名';
  $('#modal-input').value='';
  $('#modal-error').textContent='';
  $('#modal-overlay').style.display='flex';
  $('#modal-input').focus();
  var composing=false;
  var onStart=function(){composing=true};
  var onEnd=function(){composing=false};
  $('#modal-input').addEventListener('compositionstart',onStart);
  $('#modal-input').addEventListener('compositionend',onEnd);
  var handler=async function(){
    if(composing)return;
    var name=$('#modal-input').value.trim();
    if(!name)return;
    try{var r=await api('/folders',{method:'POST',body:{name:name}});if(r.error)throw new Error(r.error);hideModal();if(fs)fs.style.display='';$('#modal-input').removeEventListener('compositionstart',onStart);$('#modal-input').removeEventListener('compositionend',onEnd);await loadFeeds();await loadStats();}
    catch(e){$('#modal-error').textContent=e.message;}
  };
  var cleanup=function(){if(fs)fs.style.display='';$('#modal-input').removeEventListener('compositionstart',onStart);$('#modal-input').removeEventListener('compositionend',onEnd)};
  $('#btn-modal-confirm').onclick=handler;
  $('#btn-modal-cancel').onclick=function(){hideModal();cleanup()};
  $('#btn-modal-close').onclick=function(){hideModal();cleanup()};
  $('#modal-input').onkeydown=function(e){if(e.key==='Enter'&&!composing)handler()};
});

$('#btn-import-opml').addEventListener('click', function() {
  var o=$('#opml-modal-overlay');o.style.display='flex';$('#opml-modal-error').textContent='';$('#opml-result').style.display='none';$('#opml-file-input').value='';
  var close=function(){o.style.display='none'};
  $('#btn-opml-modal-cancel').onclick=close;$('#btn-opml-modal-close').onclick=close;
  o.addEventListener('click',function(e){if(e.target===o)close()},{once:true});
  $('#btn-opml-modal-confirm').onclick=async function(){
    var file=$('#opml-file-input').files[0];
    if(!file){$('#opml-modal-error').textContent='ファイルを選択してください';return;}
    try{var text=await file.text();var res=await api('/opml/import',{method:'POST',body:{opml:text}});if(res.error)throw new Error(res.error);$('#opml-result').style.display='block';$('#opml-result').innerHTML='<strong>インポート完了</strong><br>インポート: '+res.imported+'件 / スキップ: '+res.skipped+'件 / 合計: '+res.total+'件';await loadFeeds();await loadStats();}
    catch(e){$('#opml-modal-error').textContent=e.message;}
  };
});

$('#btn-export-opml').addEventListener('click', function(){ window.location.href='/api/opml/export'; });

$('#btn-refresh-all').addEventListener('click', async function() {
  var b=$('#btn-refresh-all');b.style.animation='spin 1s linear infinite';
  await api('/feeds/refresh-all',{method:'POST'});b.style.animation='';
  await loadFeeds();await loadStats();
  if(currentFeedId)await loadArticles({feed_id:currentFeedId});
  else if(currentFolderId)await loadArticles({folder_id:currentFolderId});
  else setView(currentView);
});

$('#btn-mark-all-read').addEventListener('click', async function() {
  if(currentFeedId){
    await api('/feeds/'+currentFeedId+'/mark-all-read',{method:'PUT'});
    await loadFeeds();await loadStats();
    var feeds=await api('/feeds');
    var idx=feeds.findIndex(function(f){return f.id===currentFeedId});
    for(var i=idx+1;i<feeds.length;i++){if(feeds[i].unread_count>0){await selectFeed(feeds[i].id,feeds[i].title);return;}}
    for(var i=0;i<idx;i++){if(feeds[i].unread_count>0){await selectFeed(feeds[i].id,feeds[i].title);return;}}
    setView(currentView);
  } else if(currentFolderId){
    var feeds=await api('/feeds');
    for(var i=0;i<feeds.length;i++){if(feeds[i].folder_id===currentFolderId)await api('/feeds/'+feeds[i].id+'/mark-all-read',{method:'PUT'});}
    await loadFeeds();await loadStats();setView(currentView);
  } else { await api('/mark-all-read',{method:'PUT'});await loadFeeds();await loadStats();setView(currentView); }
});

$('#btn-star').addEventListener('click', async function() {
  if(!currentArticleId)return;
  var s=$('#btn-star').dataset.starred==='1';
  await api('/articles/'+currentArticleId+'/'+(s?'unstar':'star'),{method:'PUT'});
  var a=await api('/articles/'+currentArticleId);renderContent(a);
  if(currentView==='starred')setView('starred');
});

$('#btn-delete-feed').addEventListener('click', async function() {
  if(currentView==='folder'&&currentFolderId){
    var folders=await api('/folders');var folder=folders.find(function(f){return f.id===currentFolderId});
    var feeds=await api('/feeds');var folderFeeds=feeds.filter(function(f){return f.folder_id===currentFolderId});
    if(!confirm('「'+(folder?folder.name:'このカテゴリー')+'」を削除しますか？\n中のフィード('+folderFeeds.length+'件)も全て削除されます。'))return;
    for(var i=0;i<folderFeeds.length;i++)await api('/feeds/'+folderFeeds[i].id,{method:'DELETE'});
    setView('all');await loadFeeds();await loadStats();
  } else if(currentFeedId){
    var feeds=await api('/feeds');var feed=feeds.find(function(f){return f.id===currentFeedId});
    if(!feed)return;
    if(!confirm('「'+feed.title+'」を削除しますか？\nこのフィードの全記事も削除されます。'))return;
    await api('/feeds/'+currentFeedId,{method:'DELETE'});
    setView('all');await loadFeeds();await loadStats();
  }
});

$('#search-input').addEventListener('input',function(e){clearTimeout(searchTimeout);var q=e.target.value.trim();searchTimeout=setTimeout(function(){currentSearchQuery=q;q?loadArticles({search:q}):setView(currentView)},300)});
$('#modal-overlay').addEventListener('click',function(e){if(e.target===e.currentTarget)hideModal()});

document.addEventListener('keydown',function(e){
  if(e.target.tagName==='INPUT')return;
  var cards=Array.prototype.slice.call($$('.article-card'));
  var idx=-1;for(var i=0;i<cards.length;i++){if(cards[i].dataset.articleId==currentArticleId){idx=i;break}}
  if(e.key==='j'||e.key==='ArrowDown'){e.preventDefault();var n=idx<cards.length-1?cards[idx+1]:cards[0];if(n)selectArticle(parseInt(n.dataset.articleId))}
  if(e.key==='k'||e.key==='ArrowUp'){e.preventDefault();var p=idx>0?cards[idx-1]:cards[cards.length-1];if(p)selectArticle(parseInt(p.dataset.articleId))}
  if(e.key==='g'){e.preventDefault();var n=idx<cards.length-1?cards[idx+1]:cards[0];if(n)selectArticle(parseInt(n.dataset.articleId))}
  if(e.key==='f'){
    e.preventDefault();
    for(var i=idx+1;i<cards.length;i++){if(cards[i].classList.contains('unread')){selectArticle(parseInt(cards[i].dataset.articleId));return;}}
    for(var i=0;i<=idx;i++){if(cards[i].classList.contains('unread')){selectArticle(parseInt(cards[i].dataset.articleId));return;}}
    loadFeeds().then(async function(){
      var feeds=await api('/feeds');
      var ci=-1;for(var i=0;i<feeds.length;i++){if(feeds[i].id===currentFeedId){ci=i;break}}
      for(var i=(ci>=0?ci+1:0);i<feeds.length;i++){if(feeds[i].unread_count>0){await selectFeed(feeds[i].id,feeds[i].title);var d=await api('/articles?feed_id='+feeds[i].id+'&unread=1&limit=1');if(d.articles&&d.articles.length>0)selectArticle(d.articles[0].id);return;}}
      for(var i=0;i<=ci;i++){if(feeds[i].unread_count>0){await selectFeed(feeds[i].id,feeds[i].title);var d=await api('/articles?feed_id='+feeds[i].id+'&unread=1&limit=1');if(d.articles&&d.articles.length>0)selectArticle(d.articles[0].id);return;}}
    });
  }
  if(e.key==='d'){e.preventDefault();var p=idx>0?cards[idx-1]:cards[cards.length-1];if(p)selectArticle(parseInt(p.dataset.articleId))}
  if(e.key==='r')$('#btn-refresh-all').click();
  if(e.key==='/'){e.preventDefault();$('#search-input').focus()}
});

var st=document.createElement('style');st.textContent='@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}';document.head.appendChild(st);

$$('.width-btn').forEach(function(btn){
  btn.addEventListener('click', function(){
    if (!btn.dataset.width) return;
    if (articleWidth === btn.dataset.width) { articleWidth = ''; }
    else { articleWidth = btn.dataset.width; }
    localStorage.setItem('selfrss-article-width', articleWidth);
    applyArticleWidth();
  });
});
$('#btn-hide-read').addEventListener('click', function(){
  hideRead = !hideRead;
  localStorage.setItem('selfrss-hide-read', hideRead ? '1' : '0');
  this.classList.toggle('active', hideRead);
  reloadCurrentView();
});
function reloadCurrentView() {
  var p = {};
  if (currentSearchQuery) { p.search = currentSearchQuery; }
  else if (currentView === 'feed') p.feed_id = currentFeedId;
  else if (currentView === 'folder') p.folder_id = currentFolderId;
  else if (currentView === 'unread') p.unread = '1';
  else if (currentView === 'starred') p.starred = '1';
  renderContent(null); currentArticleId = null;
  loadArticles(p);
}
if (hideRead) { var hr=$('#btn-hide-read'); if(hr) hr.classList.add('active'); }
$('#btn-prev-article').addEventListener('click', navigatePrevArticle);
$('#btn-next-unread').addEventListener('click', navigateNextUnread);
$('#btn-mobile-prev') && $('#btn-mobile-prev').addEventListener('click', navigatePrevArticle);
$('#btn-mobile-next') && $('#btn-mobile-next').addEventListener('click', navigateNextUnread);

window.addEventListener('resize', function(){ if (articleWidth) applyArticleWidth(); });
applyArticleWidth();

var autoScrollBtn = $('#btn-auto-scroll');
if (autoScrollBtn) {
  autoScrollBtn.classList.toggle('active', autoScrollNext);
  autoScrollBtn.addEventListener('click', function() {
    autoScrollNext = !autoScrollNext;
    localStorage.setItem('selfrss-auto-scroll', autoScrollNext ? '1' : '0');
    autoScrollBtn.classList.toggle('active', autoScrollNext);
  });
}

var hideRelatedBtn = $('#btn-hide-related');
if (hideRelatedBtn) {
  hideRelatedBtn.classList.toggle('active', hideRelated);
  hideRelatedBtn.title = hideRelated ? '関連記事を再表示' : '関連記事を非表示（ON/OFF切替）';
  hideRelatedBtn.addEventListener('click', function() {
    hideRelated = !hideRelated;
    localStorage.setItem('selfrss-hide-related', hideRelated ? '1' : '0');
    hideRelatedBtn.classList.toggle('active', hideRelated);
    hideRelatedBtn.title = hideRelated ? '関連記事を再表示' : '関連記事を非表示（ON/OFF切替）';
    if (currentArticleData) renderContent(currentArticleData);
  });
}

var autoScrolling = false;
$('#content-pane').addEventListener('scroll', function() {
  if (!autoScrollNext || autoScrolling) return;
  var el = this;
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 50) {
    autoScrolling = true;
    navigateNextUnread();
    setTimeout(function(){ autoScrolling = false; }, 500);
  }
});

$('#article-list').addEventListener('scroll', function() {
  var el = this;
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 100) {
    loadMoreArticles();
  }
});

async function waitForServer(maxMs) {
  var deadline = Date.now() + (maxMs || 60000);
  await new Promise(function(r){ setTimeout(r, 2000); });
  while (Date.now() < deadline) {
    try { var res = await fetch('/api/version', { cache: 'no-store' }); if (res.ok) return true; } catch(e){}
    await new Promise(function(r){ setTimeout(r, 1000); });
  }
  return false;
}

$('#btn-admin-restart').addEventListener('click', async function() {
  var b = this;
  if (!confirm('selfrss サービスを再起動しますか？')) return;
  b.disabled = true; b.textContent = '再起動中…';
  try { await api('/admin/restart', { method: 'POST' }); } catch(e){}
  await waitForServer();
  location.reload();
});

$('#btn-admin-update').addEventListener('click', async function() {
  var b = this;
  if (!confirm('GitHub から最新版を取得してアップデートしますか？\n完了後、サービスは自動で再起動されます。')) return;
  b.disabled = true; b.textContent = '更新中…';
  try {
    var res = await api('/admin/update', { method: 'POST' });
    if (res && res.error) { alert('アップデートに失敗しました\n' + res.error); b.disabled = false; b.textContent = 'アップデート'; return; }
  } catch(e){}
  b.textContent = '再起動中…';
  await waitForServer(120000);
  location.reload();
});

api('/version').then(function(v){ if (v && v.version) $('#app-version').textContent = 'v.' + v.version; }).catch(function(){});

loadFeeds();loadStats();setView('all');
