/* ============================================================
 * NAS歌曲下载 - 前端逻辑
 * ============================================================ */

const API = '';

let authPassword = localStorage.getItem('nas_music_pwd') || '';
let authToken = localStorage.getItem('nas_music_token') || '';
let currentUser = localStorage.getItem('nas_music_user') || '';

// 简单哈希（FNV-1a），兼容HTTP
async function sha256(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return 'h' + (hash >>> 0).toString(36) + '_' + text.length;
}
let currentSource = 'kw';
let currentSongList = [];
let currentSongIdx = -1;
let downloadHistory = JSON.parse(localStorage.getItem('nas_music_history') || '[]');
let currentQuality = 'flac';

const QUALITY_CHAIN = ['flac', '320k', '128k'];
const THEMES = ['classic', 'light'];

const BOARD_CATEGORIES = [
  { name: '🔥 热门', patterns: ['热歌', '飙升', '新歌', '流行', '抖音', '热搜', '热评', '铃声', '推荐', 'TOP'] },
  { name: '🎨 特色', patterns: ['DJ', '电音', '摇滚', '民谣', '古风', '说唱', '网络', 'ACG', '动漫', '游戏', '二次元', '嘻哈', '爵士', '乡村', 'R&B', '粤语', '现场', 'KTV', '儿歌', '轻音乐', '伴奏', '纯音乐'] },
  { name: '🌏 地区', patterns: ['台湾', '香港', '内地', '欧美', '日本', '韩国', '亚洲', '大陆', '华语', '港台'] },
  { name: '🎬 影视', patterns: ['影视', '综艺', '原声', 'OST', '电影', '电视剧', '主题曲', '插曲'] },
];

const $ = (id) => document.getElementById(id);

/* ============================================================
 * 主题切换
 * ============================================================ */
function applyTheme(name) {
  if (!THEMES.includes(name)) name = 'classic';
  document.documentElement.setAttribute('data-theme', name);
  try { localStorage.setItem('nas_music_theme', name); } catch (e) {}
  document.querySelectorAll('.theme-option').forEach(opt => {
    opt.classList.toggle('active', opt.dataset.theme === name);
  });
}

function initThemePicker() {
  const themeBtn = $('themeBtn');
  const themePanel = $('themePanel');
  const picker = $('themePicker');
  if (!themeBtn || !themePanel) return;

  const cur = document.documentElement.getAttribute('data-theme') || 'classic';
  applyTheme(cur);

// 🚀 原版下拉框逻辑已被物理切除



  document.addEventListener('click', (e) => {
    if (!picker.contains(e.target)) {
      themePanel.classList.remove('open');
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') themePanel.classList.remove('open');
  });
}

/* ---------- 请求封装 ---------- */
async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (opts.headers) Object.assign(headers, opts.headers);
  if (!headers['x-frontend-auth'] && authPassword) {
    headers['x-frontend-auth'] = authPassword;
  }
  if (opts.userName) headers['x-user-name'] = opts.userName;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeout || 15000);
  try {
    const res = await fetch(API + path, {
      method: opts.method || 'GET',
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`状态码 ${res.status}: ${t.slice(0, 100)}`);
    }
    const ct = res.headers.get('content-type') || '';
    return ct.includes('json') ? res.json() : res.text();
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- 工具 ---------- */
function fmtTime(s) {
  if (!s || isNaN(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : s;
  return d.innerHTML;
}

function escAttr(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/* ---------- 音质选择弹窗 ---------- */
function pickQuality(action) {
  return new Promise((resolve) => {
    const modal = $('qualityModal');
    const desc = $('qualityModalDesc');
    desc.textContent = action === 'download'
      ? `将下载 ${getSelectedCount()} 首歌曲`
      : `将获取 ${getSelectedCount()} 首歌曲的链接`;
    modal.classList.remove('hidden');

    const close = (val) => {
      modal.classList.add('hidden');
      modal.querySelectorAll('.quality-option').forEach(b => b.onclick = null);
      $('qualityCancel').onclick = null;
      modal.onclick = null;
      resolve(val);
    };

    modal.querySelectorAll('.quality-option').forEach(btn => {
      btn.onclick = () => {
        currentQuality = btn.dataset.quality;
        close(currentQuality);
      };
    });
    $('qualityCancel').onclick = () => close(null);
    modal.onclick = (e) => { if (e.target === modal) close(null); };
  });
}

function getSelectedCount() {
  const el = getActiveList();
  return el ? el.querySelectorAll('.song-check:checked').length : 0;
}

/* ---------- 用户歌单 ---------- */
async function fetchUserLists() {
  const data = await api('/api/user/list?user=_open');
  return {
    defaultList: data.defaultList || [],
    loveList: data.loveList || [],
    userList: data.userList || [],
  };
}
async function saveUserLists(userList) {
  const cur = await fetchUserLists();
  await api('/api/user/list?user=_open', {
    method: 'POST',
    body: { ...cur, userList },
  });
}

/* ---------- 音源 ---------- */
async function fetchSources() {
  const data = await api('/api/custom-source/list?username=open');
  return Array.isArray(data) ? data : [];
}
async function toggleSourceById(id) {
  await api('/api/custom-source/toggle', { method: 'POST', body: { id, username: 'open' } });
}
async function deleteSourceById(id) {
  await api('/api/custom-source/delete', { method: 'POST', body: { id, username: 'open' } });
}

/* ---------- 登录 ---------- */
function showApp() {
  $('loginPage').classList.add('hidden');
  $('app').classList.remove('hidden');
}
function saveAuth(pwd) {
  authPassword = pwd;
  localStorage.setItem('nas_music_pwd', pwd);
}
async function doLogin() {
  const user = $('loginUsername') ? $('loginUsername').value.trim() || 'admin' : 'admin';
  const pwd = $('loginPassword').value;
  if (!pwd) return;
  $('loginError').textContent = '登录中...';
  
  try {
    if (user === 'admin') {
      const r = await fetch(API + '/api/admin/verify', {
        method: 'POST',
        headers: { 'x-frontend-auth': pwd, 'Content-Type': 'application/json' }
      }).then(res => res.json());
      
      if (r && r.success) {
        authPassword = pwd;
        currentUser = 'admin';
        localStorage.setItem('nas_music_pwd', pwd);
        localStorage.setItem('nas_music_user', 'admin');
        showApp(); onAppReady();
        if (typeof applyPermissions === 'function') applyPermissions();
        return;
      }
      throw new Error('管理员密码错误');
    } else {
      const res = await fetch(API + '/api/user/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user, password: pwd })
      });
      if (!res.ok) throw new Error('接口返回 ' + res.status);
      const r = await res.json();
      if (r && r.success && r.token) {
        authToken = r.token;
        currentUser = user;
        localStorage.setItem('nas_music_token', r.token);
        localStorage.setItem('nas_music_user', user);
        showApp(); onAppReady();
        if (typeof applyPermissions === 'function') applyPermissions();
        return;
      }
      throw new Error('账号或密码错误');
    }
  } catch (err) {
    $('loginError').textContent = '登录失败: ' + err.message;
  }
}

/* ---------- 悬浮工具栏 ---------- */
let toolbarVisible = false;

function getActiveList() {
  const active = document.querySelector('.tab-panel.active');
  if (!active) return null;
  const lists = active.querySelectorAll('.song-list');
  for (const el of lists) {
    if (el.offsetParent !== null) return el;
  }
  return lists[0] || null;
}

function positionToolbar() {
  const tb = $('globalToolbar');
  const rect = tb.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;
  const gap = 14;
  let x;
  let fromLeft = false;

  const content = document.querySelector('.content');
  if (content) {
    const cr = content.getBoundingClientRect();
    const rightSpace = window.innerWidth - cr.right;
    const leftSpace = cr.left;
    if (rightSpace >= w + gap) {
      x = cr.right + gap; fromLeft = false;
    } else if (leftSpace >= w + gap) {
      x = cr.left - w - gap; fromLeft = true;
    }
  }
  if (x === undefined) x = window.innerWidth - w - 20;
  if (x + w > window.innerWidth - 8) x = window.innerWidth - w - 8;
  if (x < 8) x = 8;

  const playerH = 72;
  const availableBottom = window.innerHeight - playerH;
  let y = (availableBottom - h) / 2;
  if (y < 8) y = 8;
  if (y + h > availableBottom - 8) y = Math.max(8, availableBottom - h - 8);

  tb.classList.toggle('from-left', fromLeft);
  tb.style.left = x + 'px';
  tb.style.top = y + 'px';
}

function updateToolbarVisibility() {
  const tb = $('globalToolbar');
  if (!tb) return;
  const activePanel = document.querySelector('.tab-panel.active');
  if (!activePanel) {
    tb.classList.remove('show'); toolbarVisible = false; return;
  }
  const detailView = $('playlistDetailView');
  const inDetail = detailView && !detailView.classList.contains('hidden');
  const activeId = activePanel.id;
  const showContext = activeId === 'tab-search' || activeId === 'tab-rank' ||
    (activeId === 'tab-playlist' && inDetail);
  if (!showContext) {
    tb.classList.remove('show'); toolbarVisible = false; return;
  }
  const checked = activePanel.querySelectorAll('.song-check:checked');
  if (!checked.length) {
    tb.classList.remove('show'); toolbarVisible = false; return;
  }
  if (window.innerWidth > 768) {
    if (!toolbarVisible) {
      tb.style.left = '-9999px'; tb.style.top = '0px';
      tb.classList.add('show');
      positionToolbar();
      toolbarVisible = true;
    } else {
      positionToolbar();
    }
  } else {
    tb.classList.add('show');
    toolbarVisible = true;
  }
}

function hideToolbar() {
  $('globalToolbar').classList.remove('show');
  toolbarVisible = false;
}

/* ---------- Tab 切换 ---------- */
let rankLoaded = false;

function switchTab(name) {
  const scrollY = window.scrollY;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));

  const content = document.querySelector('.content');
  if (content) content.classList.toggle('rank-mode', name === 'rank');

  hideToolbar();

  if (name === 'rank' && !rankLoaded) {
    rankLoaded = true;
    $('rankList').innerHTML = '<div class="rank-loading">榜单加载中，请稍等...</div>';
    loadRankCats().then(() => {
      if (window.innerWidth <= 768) openRankSidebar();
    });
  }
  if (name === 'playlist') loadPlaylists();
  if (name === 'download') loadDownloadTasks();
  requestAnimationFrame(() => {
    window.scrollTo(0, scrollY);
    updateToolbarVisibility();
  });
}

/* ---------- 搜索 ---------- */
async function doSearch() {
  const name = $('searchInput').value.trim();
  const source = activeSource;
  if (!name) return;
  const hw = $('hotWords'); if (hw) hw.style.display = 'none';
  const ar = $('hotArrow'); if (ar) ar.textContent = '▸';
  const container = $('searchResults');
  container.innerHTML = '<div style="color:var(--text2);padding:20px">搜索中...</div>';
  try {
    const data = await api(`/api/music/search?name=${encodeURIComponent(name)}&source=${source}&type=song&limit=30&page=1`);
    renderSongList(container, data, 'search');
  } catch (e) {
    container.innerHTML = '<div style="color:var(--red);padding:20px">搜索失败: ' + esc(e.message) + '</div>';
  }
}

async function loadHotSearch() {
  try {
    const data = await api('/api/music/hotSearch?source=kw');
    const el = $('hotSearch');
    const words = data.list || [];
    el.innerHTML = `<span style="cursor:pointer;font-weight:bold">🔥 热门 <span id="hotArrow">▾</span></span>
      <span id="hotWords" style="margin-left:8px">` +
      words.map(w => `<span data-w="${escAttr(w)}">${esc(w)}</span>`).join('') +
      `</span>`;
    el.onclick = (e) => {
      const w = e.target.dataset.w;
      if (w) { $('searchInput').value = w; doSearch(); return; }
      if (e.target.id === 'hotArrow' || e.target.textContent.trim() === '🔥 热门' || e.target.id === 'hotWords') {
        const hw = $('hotWords'); const ar = $('hotArrow');
        const hidden = hw.style.display === 'none';
        hw.style.display = hidden ? '' : 'none';
        ar.textContent = hidden ? '▾' : '▸';
      }
    };
  } catch (e) {}
}

/* ---------- 歌曲列表 ---------- */
function renderSongList(container, songs, context) {
  if (!songs || !songs.length) {
    container.innerHTML = '<div style="color:var(--text2);padding:20px">暂无结果</div>';
    return;
  }
  container.innerHTML = songs.map((s, i) => {
    const types = (s.types || []).map(t => t.type).join('/');
    return `<div class="song-item" data-idx="${i}">
      <input type="checkbox" class="song-check" onchange="window.updateToolbarVisibility && window.updateToolbarVisibility()" onclick="setTimeout(()=>{window.updateToolbarVisibility && window.updateToolbarVisibility();},0)">
      <span class="song-num">${i + 1}</span>
      <div class="song-info">
        <div class="song-name">${esc(s.name)}</div>
        <div class="song-singer">${esc(s.singer)} · ${esc(s.albumName || s.album || '')}</div>
      </div>
      <button class="song-play-btn" data-play="${i}">▶</button>
    </div>`;
  }).join('');
  container._songs = songs;
  container._context = context;

  container.querySelectorAll('[data-play]').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const idx = +btn.dataset.play;
      playSong(songs[idx], songs);
    };
  });
}

/* ---------- 排行榜 ---------- */
function positionRankDrawer() {
  if (window.innerWidth > 768) return;
  const header = $('rankHeader');
  const sidebar = $('rankSidebar');
  if (!header || !sidebar) return;
  if (!sidebar.classList.contains('open')) return;
  const rect = header.getBoundingClientRect();
  sidebar.style.top = Math.max(0, rect.bottom) + 'px';
}

function openRankSidebar() {
  const sb = $('rankSidebar');
  const hd = $('rankHeader');
  if (sb) sb.classList.add('open');
  if (hd) hd.classList.add('open');
  if (window.innerWidth <= 768) {
    positionRankDrawer();
    requestAnimationFrame(positionRankDrawer);
  }
}
function closeRankSidebar() {
  const sb = $('rankSidebar');
  const hd = $('rankHeader');
  if (sb) {
    sb.classList.remove('open');
    sb.style.top = '';
  }
  if (hd) hd.classList.remove('open');
}

function categorizeBoards(boards) {
  if (boards.length < 8) return [{ name: '', items: boards }];
  const groups = BOARD_CATEGORIES.map(r => ({ name: r.name, items: [], patterns: r.patterns }));
  const others = { name: '📦 其它', items: [] };
  boards.forEach(b => {
    const n = b.name || '';
    let placed = false;
    for (const g of groups) {
      if (g.patterns.some(p => n.includes(p))) { g.items.push(b); placed = true; break; }
    }
    if (!placed) others.items.push(b);
  });
  const result = groups.filter(g => g.items.length > 0).map(({ name, items }) => ({ name, items }));
  if (others.items.length) result.push(others);
  return result;
}

function renderRankCats(container, boards) {
  const groups = categorizeBoards(boards);
  let isFirst = true;
  container.innerHTML = groups.map(g => `
    <div class="rank-group">
      ${g.name ? `<div class="rank-group-title">${esc(g.name)}</div>` : ''}
      ${g.items.map(b => {
        const id = b.bangid || b.id;
        const name = b.name;
        const active = isFirst ? 'active' : '';
        isFirst = false;
        return `<button class="rank-cat ${active}"
                        data-id="${escAttr(id)}"
                        data-name="${escAttr(name)}"
                        title="${escAttr(name)}">${esc(name)}</button>`;
      }).join('')}
    </div>
  `).join('');
  container.querySelectorAll('.rank-cat').forEach(btn => {
    btn.onclick = () => {
      container.querySelectorAll('.rank-cat').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      loadRankSongs(btn.dataset.id, btn.dataset.name);
    };
  });
}

async function loadRankCats() {
  const container = $('rankCats');
  container.innerHTML = '<div class="rank-loading-cats">加载中...</div>';
  try {
    const data = await api(`/api/music/leaderboard/boards?source=${currentSource}`);
    const boards = data.list || [];
    if (!boards.length) throw new Error('empty');
    renderRankCats(container, boards);
    if (boards.length) {
      loadRankSongs(boards[0].bangid || boards[0].id, boards[0].name);
    }
  } catch (e) {
    const defaults = { kw: [{ name: '热歌榜', id: '16' }, { name: '新歌榜', id: '17' }] };
    const cats = defaults[currentSource] || defaults.kw;
    renderRankCats(container, cats);
    loadRankSongs(cats[0].id, cats[0].name);
  }
}

let rankSongs = [];

async function loadRankSongs(boardId, boardName) {
  const container = $('rankList');
  const header = $('rankHeader');

  header.innerHTML = `
    <span class="rank-header-title">${esc(boardName || '加载中')}</span>
    <span class="rank-header-arrow" aria-hidden="true">▾</span>
  `;
  container.innerHTML = '<div class="rank-loading">榜单加载中，请稍等...</div>';

  try {
    const data = await api(`/api/music/leaderboard/list?source=${currentSource}&bangid=${boardId}&page=1`);
    rankSongs = data.list || data || [];
    header.innerHTML = `
      <span class="rank-header-title">${esc(boardName)}</span>
      <span class="rank-header-count">· ${rankSongs.length} 首</span>
      <span class="rank-header-arrow" aria-hidden="true">▾</span>
    `;
    renderSongList(container, rankSongs, 'rank');
  } catch (e) {
    try {
      const data = await api(`/api/music/songList/detail?source=${currentSource}&id=${boardId}`);
      rankSongs = data.list || data.musicList || [];
      header.innerHTML = `
        <span class="rank-header-title">${esc(boardName)}</span>
        <span class="rank-header-count">· ${rankSongs.length} 首</span>
        <span class="rank-header-arrow" aria-hidden="true">▾</span>
      `;
      renderSongList(container, rankSongs, 'rank');
    } catch (e2) {
      header.innerHTML = `
        <span class="rank-header-title" style="color:var(--red)">加载失败</span>
        <span class="rank-header-arrow" aria-hidden="true">▾</span>
      `;
      container.innerHTML = '<div class="rank-loading" style="color:var(--red)">' + esc(e2.message) + '</div>';
    }
  }
  closeRankSidebar();
}

/* ---------- 选择/批量 ---------- */
function getSelectedSongs(container) {
  if (!container) return [];
  const checks = container.querySelectorAll('.song-check:checked');
  const songs = container._songs || [];
  return Array.from(checks).map(c => songs[+c.closest('.song-item').dataset.idx]);
}
function selectAllIn(container) {
  if (!container) return;
  container.querySelectorAll('.song-check').forEach(c => c.checked = true);
  updateToolbarVisibility();
}
function invertIn(container) {
  if (!container) return;
  container.querySelectorAll('.song-check').forEach(c => c.checked = !c.checked);
  updateToolbarVisibility();
}
function clearSelIn(container) {
  if (!container) return;
  container.querySelectorAll('.song-check').forEach(c => c.checked = false);
  updateToolbarVisibility();
}

/* ---------- 封面 ---------- */
function setCover(container, imgUrl) {
  let img = container.querySelector('img');
  if (imgUrl) {
    if (!img) {
      img = document.createElement('img');
      img.crossOrigin = 'anonymous';
      container.prepend(img);
    }
    img.src = imgUrl;
    Array.from(container.childNodes).forEach(n => {
      if (n.nodeType === 3) n.textContent = '';
    });
  } else if (img) {
    img.remove();
  }
}

/* ---------- 音源选择 ---------- */
const SOURCE_NAMES = { kw: '酷我', wy: '网易', tx: 'QQ', kg: '酷狗', mg: '咪咕' };
let activeSource = localStorage.getItem('nas_music_source') || 'kw';

async function getBestPlayUrl(song, quality) {
  const order = ['kw','wy','tx','kg','mg'];
  const sources = activeSource ? [activeSource, ...order.filter(s => s !== activeSource)] : order;
  let lastErr;
  for (const src of sources) {
    try {
      let searchSong = song;
      if (src !== song.source) {
        const q = `${song.name} ${song.singer || ''}`.trim();
        const data = await api(`/api/music/search?name=${encodeURIComponent(q)}&source=${src}&type=song&limit=1&page=1`);
        const results = Array.isArray(data) ? data : (data.data || data.songs || []);
        if (!results.length) continue;
        searchSong = results[0];
      }
      const r = await api('/api/music/url', {
        method: 'POST',
        body: { songInfo: searchSong, quality, enableAutoSwitchApiSource: true },
      });
      // 🚀 核心修复：兼容多种后端返回的数据结构
      let realUrl = r.url;
      if (!realUrl && r.data && r.data.url) realUrl = r.data.url;
      if (!realUrl && typeof r.data === 'string' && r.data.startsWith('http')) realUrl = r.data;

      if (realUrl) {
        if (src !== activeSource) {
          activeSource = src;
          localStorage.setItem('nas_music_source', src);
        }
        return { url: realUrl, song: searchSong, source: src, sourceName: SOURCE_NAMES[src], switched: src !== song.source };
      }
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('所有音源均不可用');
}

/* ---------- 播放 ---------- */
async function playSong(song, list) {
  if (!song) return;
  if (list) {
    currentSongList = list;
    currentSongIdx = list.indexOf(song);
  }
  if (!song.id && !song.songmid && !song.hash) {
    $('playerSinger').textContent = song.singer + ' · 搜索中...';
    try {
      const searchData = await api(`/api/music/search?name=${encodeURIComponent(song.name)}&source=${song.source || 'kw'}&type=song&limit=1&page=1`);
      const results = Array.isArray(searchData) ? searchData : (searchData.data || searchData.songs || []);
      if (results.length) song = { ...results[0], ...song };
    } catch (e) {}
  }
  $('playerTitle').textContent = song.name;
  $('playerSinger').textContent = song.singer + ' · 加载中...';
  $('fsTitle').textContent = song.name;
  $('fsSinger').textContent = song.singer;

  setCover($('playerCover'), song.img);
  setCover($('fsCover'), song.img);
  $('fsBg').style.backgroundImage = song.img ? `url("${song.img}")` : '';
  $('fsCover').classList.add('paused');

  if (window._loadLyric) if (typeof window._loadLyric === 'function') { try { window._loadLyric(song); } catch (err) {} }

  try {
    $('playerSinger').textContent = song.singer + ' · 匹配音源...';
    const result = await getBestPlayUrl(song, currentQuality);
    song = result.song;
    if (result.switched) {
      $('playerSinger').textContent = song.singer + ' · 已切换到' + result.sourceName;
    }
    if (typeof window._loadLyric === 'function') { try { window._loadLyric(song); } catch (err) {} }
    if (!result.url) {
      $('playerSinger').textContent = song.singer;
      alert('无法获取播放地址');
      return;
    }
    audioEl = $('audioEl');
    audio = audioEl;
    audio.onerror = () => {
      $('playerSinger').textContent = song.singer + ' · 链接不通';
      setPlayIcon(false);
      $('fsCover').classList.add('paused');
    };
    audio.src = result.url;
    try {
      await audio.play();
      $('playerSinger').textContent = song.singer;
      setPlayIcon(true);
      $('fsCover').classList.remove('paused');
      document.querySelectorAll('.song-item').forEach(it => it.classList.remove('playing'));
    } catch (err) {
      $('playerSinger').textContent = song.singer + ' · 点击播放';
      setPlayIcon(false);
      $('fsCover').classList.add('paused');
    }
  } catch (e) {
    $('playerSinger').textContent = song.singer;
    // 🚀 弹出真实的错误信息
    alert('获取失败: ' + (e.message || e || '未知错误'));
  }
}

function setPlayIcon(playing) {
  const icon = playing ? '⏸' : '▶';
  $('btnPlay').textContent = icon;
  $('fsPlay').textContent = icon;
  $('fsPlayOverlay').textContent = icon;
}
function togglePlay() {
  if (!audio) audio = $('audioEl');
  if (audio.paused) {
    audio.play().then(() => {
      setPlayIcon(true);
      $('fsCover').classList.remove('paused');
    }).catch(() => setPlayIcon(false));
  } else {
    audio.pause();
    setPlayIcon(false);
    $('fsCover').classList.add('paused');
  }
}
function playNext() {
  if (!currentSongList.length) return;
  currentSongIdx = (currentSongIdx + 1) % currentSongList.length;
  playSong(currentSongList[currentSongIdx]);
}
function playPrev() {
  if (!currentSongList.length) return;
  currentSongIdx = (currentSongIdx - 1 + currentSongList.length) % currentSongList.length;
  playSong(currentSongList[currentSongIdx]);
}

/* ---------- 下载 ---------- */
let downloadTasks = [];
let taskId = 0;
let downloadPaused = false;
let downloadCanceled = false;
let downloadPollTimer = null;

function hasActiveDownload() {
  return downloadTasks.some(t =>
    t.status === 'waiting' || t.status === 'fetching' || t.status === 'downloading');
}
function scheduleDownloadPoll() {
  clearTimeout(downloadPollTimer);
  if (!hasActiveDownload()) return;
  downloadPollTimer = setTimeout(async () => {
    await loadDownloadHistory();
    scheduleDownloadPoll();
  }, 2000);
}

async function runSingleDownload(t, song, quality) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (downloadCanceled) return false;
    try {
      t.quality = quality;
      t.status = 'fetching';
      t.msg = '匹配音源...';
      renderDownloadTasks();
      const result = await getBestPlayUrl(song, quality);
      const urlR = { url: result.url };
      song = result.song;
      if (result.switched) {
        t.msg = '切换到' + result.sourceName;
        renderDownloadTasks();
      }
      if (!urlR.url) {
        if (attempt === 1) { await new Promise(r => setTimeout(r, 800)); continue; }
        t.status = 'failed'; t.progress = 0; t.msg = '获取失败，请切换平台再试'; renderDownloadTasks();
        return false;
      }
      t.status = 'downloading'; t.progress = 80; renderDownloadTasks();
      try {
        const dlR = await api('/api/music/cache/download', {
          method: 'POST',
          body: { songInfo: song, url: urlR.url, quality, cacheLyric: true, embedLyric: true },
        });
        if (dlR && dlR.success === false) throw new Error(dlR.error || '下载失败');
      } catch (e) {
        if (attempt === 1) { await new Promise(r => setTimeout(r, 800)); continue; }
        t.status = 'failed'; t.msg = '获取失败，请切换平台再试'; renderDownloadTasks();
        return false;
      }
      let reallyDone = false;
      for (let w = 0; w < 6; w++) {
        await new Promise(r => setTimeout(r, 1000));
        if (downloadCanceled) return false;
        try {
          const list = await api('/api/music/cache/list');
          if ((list.data || []).some(x => x.name === song.name)) { reallyDone = true; break; }
        } catch (e) {}
      }
      if (reallyDone) {
        t.status = 'done'; t.progress = 100; renderDownloadTasks();
        addHistory(song, quality);
        return true;
      }
      if (attempt === 1) { await new Promise(r => setTimeout(r, 800)); continue; }
      t.status = 'failed'; renderDownloadTasks();
      return false;
    } catch (e) {
      if (attempt === 1) { await new Promise(r => setTimeout(r, 800)); continue; }
      t.status = 'failed'; renderDownloadTasks();
      return false;
    }
  }
  t.status = 'failed'; renderDownloadTasks();
  return false;
}

async function runDownloadTask(t, song) {
  const userQ = t.quality;
  const idx = QUALITY_CHAIN.indexOf(userQ);
  const chain = idx >= 0 ? QUALITY_CHAIN.slice(idx) : QUALITY_CHAIN;
  for (const q of chain) {
    if (downloadCanceled) return;
    const ok = await runSingleDownload(t, song, q);
    if (ok) return;
  }
  t.status = 'failed'; renderDownloadTasks();
}

async function downloadToNAS(songs, quality) {
  if (!songs.length) return;
  switchTab('download');
  const newTasks = songs.map(song => ({
    id: ++taskId, name: song.name, singer: song.singer, quality,
    status: 'waiting', progress: 0, _song: song,
  }));
  downloadTasks.push(...newTasks);
  renderDownloadTasks();
  downloadCanceled = false;
  const CONCURRENCY = 3;
  const queue = [...newTasks];
  const workers = Array(Math.min(CONCURRENCY, queue.length)).fill(null).map(async () => {
    while (queue.length && !downloadCanceled) {
      const t = queue.shift();
      if (t.status !== 'waiting') continue;
      await runDownloadTask(t, t._song);
    }
  });
  await Promise.all(workers);
  scheduleDownloadPoll();
  loadDownloadHistory();
}

async function retryDownload(id) {
  const t = downloadTasks.find(x => x.id === id);
  if (!t || t.status !== 'failed' || !t._song) return;
  downloadCanceled = false;
  t.status = 'waiting'; t.progress = 0; renderDownloadTasks();
  for (const q of QUALITY_CHAIN) {
    if (downloadCanceled) return;
    const ok = await runSingleDownload(t, t._song, q);
    if (ok) { scheduleDownloadPoll(); return; }
  }
  t.status = 'failed'; renderDownloadTasks();
}

function renderDownloadTasks() {
  const el = $('downloadTasks');
  const pauseBtn = $('downloadPauseAll');
  const cancelBtn = $('downloadCancelAll');
  const hasActive = hasActiveDownload();
  if (pauseBtn) pauseBtn.style.display = hasActive ? '' : 'none';
  if (cancelBtn) cancelBtn.style.display = hasActive ? '' : 'none';
  if (!downloadTasks.length) {
    el.innerHTML = '<div style="color:var(--text2)">暂无下载任务</div>';
    return;
  }
  const statusText = {
    waiting: '等待中', fetching: '获取链接...',
    downloading: '下载中', done: '完成', failed: '失败',
  };
  const statusColor = {
    waiting: 'var(--text2)', fetching: 'var(--blue)',
    downloading: 'var(--blue)', done: 'var(--green)', failed: 'var(--red)',
  };
  el.innerHTML = downloadTasks.map((t, i) => `
    <div class="task-item">
      <span class="task-index">${i + 1}</span>
      <div class="task-body">
        <div class="task-name">${esc(t.name)}</div>
        <div class="task-meta">${esc(t.singer)} · ${esc(t.quality)}</div>
        ${(t.status === 'downloading' || t.status === 'fetching') ? `
          <div class="task-bar"><div class="task-bar-fill" style="width:${t.progress}%"></div></div>
        ` : ''}
      </div>
      <div class="task-status">
        ${t.status === 'failed' ? `<button class="retry-btn" data-retry="${t.id}">重试</button>` : ''}
        <span class="task-status-text" style="color:${statusColor[t.status]}">${statusText[t.status]}</span>
      </div>
    </div>`).join('');
}

async function downloadToLocal(songs) {
  if (!songs.length) return;
  switchTab('download');
  for (const song of songs) {
    const t = { id: ++taskId, name: song.name, singer: song.singer, quality: currentQuality, status: 'fetching', progress: 0, _song: song };
    downloadTasks.push(t); renderDownloadTasks();
    try {
      const r = await api('/api/music/url', { method: 'POST', body: { songInfo: song, quality: currentQuality } });
      if (!r.url) { t.status = 'failed'; renderDownloadTasks(); continue; }
      t.status = 'downloading'; t.progress = 50; renderDownloadTasks();
      await api('/api/music/cache/download', {
        method: 'POST',
        body: { songInfo: song, url: r.url, quality: currentQuality, cacheLyric: false, embedLyric: false },
      });
      t.progress = 80; renderDownloadTasks();
      const list = await api('/api/music/cache/list');
      const cached = (list.data || []).find(x => x.name === song.name);
      if (cached && cached.filename) {
        const dlUrl = `/server/cache/_open/${encodeURIComponent(cached.filename)}`;
        const ext = cached.ext || 'mp3';
        const safeName = `${song.name} - ${song.singer}`.replace(/[\\/:*?"<>|]/g, '_');
        const a = document.createElement('a');
        a.href = dlUrl; a.download = `${safeName}.${ext}`;
        document.body.appendChild(a); a.click(); a.remove();
      }
      t.status = 'done'; t.progress = 100; renderDownloadTasks();
      addHistory(song, currentQuality);
      await new Promise(r => setTimeout(r, 300));
    } catch (e) {
      t.status = 'failed'; renderDownloadTasks();
    }
  }
  scheduleDownloadPoll();
  loadDownloadHistory();
}

function addHistory(song, quality) {
  downloadHistory.unshift({ name: song.name, singer: song.singer, quality, time: Date.now(), song });
  if (downloadHistory.length > 500) downloadHistory = downloadHistory.slice(0, 500);
  localStorage.setItem('nas_music_history', JSON.stringify(downloadHistory));
  setTimeout(loadDownloadHistory, 800);
}

/* ---------- 歌单 ---------- */
async function loadPlaylists() {
  const container = $('playlistList');
  try {
    const { userList } = await fetchUserLists();
    if (!userList.length) {
      container.innerHTML = '<div style="color:var(--text2);padding:24px 12px;text-align:center">暂无歌单，点击上方按钮导入</div>';
      return;
    }
    container.innerHTML = userList.map((pl, i) => `
      <div class="playlist-card" data-idx="${i}">
        <span class="playlist-icon">🎵</span>
        <div class="playlist-meta">
          <div class="playlist-name">${esc(pl.name)}</div>
          <div class="playlist-count">${(pl.list || []).length} 首歌曲</div>
        </div>
        <button class="tool-btn red" data-del="${i}">删除</button>
      </div>`).join('');
    container.onclick = async (e) => {
      const delBtn = e.target.closest('[data-del]');
      if (delBtn) {
        e.stopPropagation();
        const idx = +delBtn.dataset.del;
        const target = userList[idx];
        if (!confirm(`删除歌单「${target.name}」？`)) return;
        userList.splice(idx, 1);
        try { await saveUserLists(userList); loadPlaylists(); }
        catch (err) { alert('删除失败: ' + err.message); }
        return;
      }
      const card = e.target.closest('.playlist-card');
      if (card) {
        const idx = +card.dataset.idx;
        openPlaylistDetail(userList[idx]);
      }
    };
  } catch (e) {
    container.innerHTML = '<div style="color:var(--red)">加载失败: ' + esc(e.message) + '</div>';
  }
}

function openPlaylistDetail(pl) {
  $('detailPlaylistName').textContent = pl.name;
  const songs = pl.list || [];
  renderSongList($('detailSongList'), songs, 'detail');
  $('playlistView').classList.add('hidden');
  $('playlistDetailView').classList.remove('hidden');
  updateToolbarVisibility();
}

async function loadDownloadTasks() {
  renderDownloadTasks();
  await loadDownloadHistory();
}

/*
 * 下载历史：
 * - 按 mtime 倒序（最新在第一条）
 * - 编号倒叙：最新一条编号 = 总数 N，往下递减到 1
 * - 每条带播放按钮，点击后把整个历史列表作为播放队列
 */
async function loadDownloadHistory() {
  const histEl = $('downloadHistory');
  let songs = [];
  let showSize = false;

  try {
    const list = await api('/api/music/cache/list');
    const cachedSongs = list.data || [];
    if (cachedSongs.length) {
      songs = cachedSongs.slice().sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
      showSize = true;
    }
  } catch (e) {}

  if (!songs.length && downloadHistory.length) {
    songs = downloadHistory.map(h => ({
      name: h.name,
      singer: h.singer,
      quality: h.quality,
      _song: h.song,
    }));
  }

  if (!songs.length) {
    histEl.innerHTML = '<div style="color:var(--text2);padding:12px">暂无下载历史</div>';
    return;
  }

  const total = songs.length;
  histEl.innerHTML = songs.map((s, i) => {
    const num = total - i;
    const meta = showSize
      ? `${esc(s.quality || '')} · ${((s.size || 0) / 1048576).toFixed(1)}MB`
      : esc(s.quality || '');
    return `<div class="song-item" data-idx="${i}">
      <span class="song-num">${num}</span>
      <div class="song-info"><div class="song-name">${esc(s.name)}</div></div>
      <span class="song-singer">${esc(s.singer)}</span>
      <button class="song-play-btn" data-play="${i}" title="播放">▶</button>
    </div>`;
  }).join('');

  const playList = songs.map(s => ({
    name: s.name,
    singer: s.singer,
    source: currentSource,
    ...(s._song || {}),
  }));

  histEl.querySelectorAll('[data-play]').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const idx = +btn.dataset.play;
      playSong(playList[idx], playList);
    };
  });
}

/* ---------- 音源管理 ---------- */
async function loadSources() {
  const el = $('sourceList');
  try {
    let sources;
    try {
      sources = await fetchSources();
    } catch (e1) {
      if (String(e1.message).includes('502')) {
        el.innerHTML = '<div style="color:var(--text2);padding:8px">音源重启中，等待服务就绪...</div>';
        for (let i = 0; i < 20; i++) {
          await new Promise(r => setTimeout(r, 1000));
          try {
            sources = await fetchSources();
            break;
          } catch(e2) {
            if (!String(e2.message).includes('502')) throw e2;
          }
        }
        if (!sources) throw new Error('音源启动超时');
      } else { throw e1; }
    }
    if (!sources.length) {
      el.innerHTML = '<div style="color:var(--text2);padding:8px">暂无音源</div>';
      return;
    }
    el.innerHTML = sources.map(s => {
      const broken = s.status === 'error';
      const badge = broken ? 'off' : (s.enabled ? 'on' : 'off');
      const badgeText = broken ? '加载失败' : (s.enabled ? '已启用' : '已禁用');
      return `
        <div class="source-item" data-id="${escAttr(s.id)}" style="flex-direction:column;align-items:stretch;gap:4px">
          <div style="display:flex;justify-content:space-between;align-items:center;font-size:13px">
            <span>${esc(s.name)} <span style="color:#888">v${esc(s.version || '')}</span></span>
          </div>
          <div style="display:flex;justify-content:flex-end;align-items:center;gap:6px">
            <span class="source-badge ${badge}" style="margin-right:auto">${badgeText}</span>
            <button class="tool-btn src-export-btn" style="padding:3px 10px;font-size:12px">导出</button>
            <button class="tool-btn src-toggle-btn" style="padding:3px 10px;font-size:12px" ${broken ? 'disabled' : ''}>${s.enabled ? '禁用' : '启用'}</button>
            <button class="tool-btn red src-del-btn" style="padding:3px 10px;font-size:12px">删除</button>
          </div>
        </div>`;
    }).join('');
    el.onclick = async (e) => {
      const btn = e.target.closest('button');
      if (!btn || btn.disabled) return;
      const item = btn.closest('.source-item');
      if (!item) return;
      const id = item.dataset.id;
      try {
        if (btn.classList.contains('src-export-btn')) {
          btn.textContent = '导出中...'; btn.disabled = true;
          window.open('/export-source?name=' + encodeURIComponent(id));
          setTimeout(() => { btn.textContent = '导出'; btn.disabled = false; }, 2000);
        } else if (btn.classList.contains('src-toggle-btn')) {
          btn.textContent = '切换中...'; btn.disabled = true;
          const sources = await fetchSources();
          const target = sources.find(s => s.id === id);
          if (!target) return;
          if (!target.enabled) {
            for (const s of sources) {
              if (s.enabled && s.id !== id) await toggleSourceById(s.id);
            }
          }
          await toggleSourceById(id);
          loadSources();
          const src = await fetchSources();
          const t = src.find(s => s.id === id);
          if (t && t.enabled) alert(t.name + ' 已启用');
        } else if (btn.classList.contains('src-del-btn')) {
          if (!confirm('确认删除此音源？')) return;
          btn.textContent = '删除中...'; btn.disabled = true;
          await deleteSourceById(id);
          loadSources();
          alert('已删除');
        }
      } catch (err) {
        alert('操作失败: ' + err.message);
      }
    };
  } catch (e) {
    el.innerHTML = '<div style="color:var(--red)">加载失败: ' + esc(e.message) + '</div>';
  }
}

async function uploadSource(file) {
  const content = await file.text();
  try {
    await api('/api/custom-source/upload', {
      method: 'POST',
      body: { filename: file.name, content, username: 'open', allowUnsafeVM: true },
    });
    try {
      const srcs = await fetchSources();
      const newSrc = srcs.find(s => s.id === file.name)
                  || srcs.find(s => s.name === file.name.replace(/\.js$/i, ''));
      if (newSrc && newSrc.status === 'error') {
        alert('音源上传成功但加载失败，请检查 JS 语法');
      }
    } catch (e) {}
    loadSources();
    alert('音源上传成功');
  } catch (e) {
    alert('上传失败: ' + e.message);
  }
}

async function importSource() {
  const url = $('sourceUrlInput').value.trim();
  if (!url) return;
  try {
    await api('/api/custom-source/import', {
      method: 'POST',
      body: { url, filename: url.split('/').pop(), username: 'open', allowUnsafeVM: true },
    });
    $('sourceUrlInput').value = '';
    alert('音源导入成功，请在列表中启用');
    loadSources();
  } catch (e) {
    alert('导入失败: ' + e.message);
  }
}

/* ---------- 初始化 ---------- */
function onAppReady() {
  loadHotSearch();
  loadDownloadTasks();
}

function startAutoDetect() {
  (async () => {
    const order = ['kw', 'wy', 'tx', 'kg', 'mg'];
    for (const src of order) {
      try {
        const data = await api(`/api/music/search?name=%E5%91%A8%E6%9D%B0%E4%BC%A6&source=${src}&type=song&limit=1&page=1`, { timeout: 3000 });
        const list = Array.isArray(data) ? data : (data.data || data.songs || []);
        if (!list.length) continue;
        const r = await api('/api/music/url', { method: 'POST', body: { songInfo: list[0], quality: '128k', enableAutoSwitchApiSource: true }, timeout: 3000 });
        if (r.url) {
          if (src !== activeSource) {
            activeSource = src;
            localStorage.setItem('nas_music_source', src);
            const ss = $('sourceSelect'); if (ss) ss.value = src;
          }
          return;
        }
      } catch (e) {}
    }
  })();
}

/* ---------- 歌词 ---------- */
let currentLyric = [];
let audio = null;
let lyricScrollLock = false;
let lyricScrollTimer = null;
let lastLyricIdx = -1;

async function loadLyric(song) {
  const el = $('fsLyric');
  el.innerHTML = '加载歌词中...';
  currentLyric = [];
  lastLyricIdx = -1;
  try {
    const src = song.source || currentSource;
    const sm = song.songmid || song.id;
    const data = await api(`/api/music/lyric?source=${src}&songmid=${sm}`);
    const raw = data.lyric || data.content || '';
    currentLyric = raw.split('\n').filter(l => l.trim()).map(line => {
      const m = line.match(/\[(\d+):(\d+)(?:[.:](\d+))?\]/);
      if (!m) return null;
      const ms = m[3] ? (m[3].length === 2 ? +m[3]/100 : +m[3]/1000) : 0;
      const time = (+m[1]) * 60 + (+m[2]) + ms;
      const text = line.replace(/\[.*?\]/g, '').trim();
      return { time, text };
    }).filter(Boolean);
    renderLyric(0);
  } catch (e) {
    el.innerHTML = '暂无歌词';
  }
}

function renderLyric(time) {
  const el = $('fsLyric');
  if (!currentLyric.length) return;
  let activeIdx = 0;
  for (let i = 0; i < currentLyric.length; i++) {
    if (currentLyric[i].time <= time) activeIdx = i;
    else break;
  }
  if (activeIdx === lastLyricIdx) return;
  lastLyricIdx = activeIdx;
  if (el.children.length !== currentLyric.length) {
    el.innerHTML = currentLyric.map((l, i) =>
      `<div class="${i === activeIdx ? 'active' : ''}" data-time="${l.time}" style="cursor:pointer;padding:8px 0;">${esc(l.text)}</div>`
    ).join('');
    el.onclick = (e) => {
      const d = e.target.closest('[data-time]');
      if (!d) return;
      const t = parseFloat(d.dataset.time);
      if (isFinite(t)) audio.currentTime = t;
    };
    el.onscroll = () => {
      lyricScrollLock = true;
      clearTimeout(lyricScrollTimer);
      lyricScrollTimer = setTimeout(() => { lyricScrollLock = false; }, 2000);
    };
  } else {
    Array.from(el.children).forEach((c, i) => c.classList.toggle('active', i === activeIdx));
  }
  const activeEl = el.children[activeIdx];
  if (!lyricScrollLock && activeEl) activeEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

/* ---------- 复制链接弹窗 ---------- */
function showCopyDialog(txt, count) {
  const dlg = document.createElement('div');
  dlg.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.7);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
  dlg.innerHTML = `<div style="background:#1a1a2e;border-radius:12px;padding:20px;max-width:600px;width:100%;max-height:80vh;display:flex;flex-direction:column;">
    <div style="color:#fff;font-size:16px;font-weight:bold;margin-bottom:10px;">获取到 ${count} 条链接</div>
    <textarea readonly style="flex:1;min-height:200px;background:#0d0d1a;color:#eee;border:1px solid #333;border-radius:8px;padding:10px;font-size:13px;font-family:monospace;"></textarea>
    <div style="display:flex;gap:10px;margin-top:10px;">
      <button id="dlgCopy" style="flex:1;padding:10px;background:#4a9eff;color:#fff;border:none;border-radius:8px;cursor:pointer;">一键复制</button>
      <button id="dlgClose" style="flex:1;padding:10px;background:#444;color:#fff;border:none;border-radius:8px;cursor:pointer;">关闭</button>
    </div>
  </div>`;
  document.body.appendChild(dlg);
  dlg.querySelector('textarea').value = txt;
  dlg.querySelector('#dlgClose').onclick = () => dlg.remove();
  dlg.querySelector('#dlgCopy').onclick = async () => {
    const ta = dlg.querySelector('textarea');
    ta.select();
    ta.setSelectionRange(0, 99999);
    const btn = dlg.querySelector('#dlgCopy');
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(txt);
      } else {
        document.execCommand('copy');
      }
      btn.textContent = '已复制!';
    } catch (e) {
      try { document.execCommand('copy'); btn.textContent = '已复制!'; }
      catch (e2) { alert('请手动复制'); }
    }
  };
}

/* ============================================================
 * 页面初始化
 * ============================================================ */
document.addEventListener('DOMContentLoaded', async () => {
  initThemePicker();

  if (authPassword) {
    // 验证已存密码是否有效
    try {
      const r = await api('/api/admin/verify', {
        method: 'POST',
        headers: { 'x-frontend-auth': authPassword },
      });
      if (r && r.success) {
        showApp(); onAppReady();
        startAutoDetect();
      } else {
        throw new Error('auth failed');
      }
    } catch(e) {
      localStorage.removeItem('nas_music_pwd');
      authPassword = '';
      $('loginPage').classList.remove('hidden');
      $('app').classList.add('hidden');
    }
  } else {
    $('loginPage').classList.remove('hidden');
    $('app').classList.add('hidden');
  }

  // 音源选择（已移除UI，后台自动选择）
  const srcSel = $('sourceSelect');
  if (srcSel) {
    srcSel.value = activeSource;
    srcSel.onchange = async () => {
      activeSource = srcSel.value;
      localStorage.setItem('nas_music_source', activeSource);
      let available = false;
      try {
        const data = await api(`/api/music/search?name=%E5%91%A8%E6%9D%B0%E4%BC%A6&source=${activeSource}&type=song&limit=1&page=1`, { timeout: 3000 });
        const list = Array.isArray(data) ? data : (data.data || data.songs || []);
        if (list.length) {
          const r = await api('/api/music/url', { method: 'POST', body: { songInfo: list[0], quality: '128k', enableAutoSwitchApiSource: true }, timeout: 3000 });
          if (r.url) available = true;
        }
      } catch (e) {}
      if (!available) {
        const badSrc = SOURCE_NAMES[activeSource] || activeSource;
        let found = false;
        const order = ['kw', 'wy', 'tx', 'kg', 'mg'];
        for (const src of order) {
          if (src === activeSource) continue;
          try {
            const data = await api(`/api/music/search?name=%E5%91%A8%E6%9D%B0%E4%BC%A6&source=${src}&type=song&limit=1&page=1`, { timeout: 3000 });
            const list = Array.isArray(data) ? data : (data.data || data.songs || []);
            if (!list.length) continue;
            const r = await api('/api/music/url', { method: 'POST', body: { songInfo: list[0], quality: '128k', enableAutoSwitchApiSource: true }, timeout: 3000 });
            if (r.url) {
              activeSource = src;
              localStorage.setItem('nas_music_source', src);
              srcSel.value = src;
              found = true;
              break;
            }
          } catch (e) {}
        }
      }
    };
  }

  $('loginBtn').onclick = doLogin;
  $('loginPassword').addEventListener('keydown', e => {
    if (e.key === 'Enter') doLogin();
  });

  document.querySelectorAll('.tab-btn').forEach(b => {
    b.onclick = () => switchTab(b.dataset.tab);
  });

  $('searchBtn').onclick = doSearch;
  $('searchInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') doSearch();
  });
  $('searchInput').addEventListener('input', () => {
    if (!$('searchInput').value.trim()) {
      const hw = $('hotWords'); if (hw) hw.style.display = '';
      const ar = $('hotArrow'); if (ar) ar.textContent = '▾';
    }
  });

  document.querySelectorAll('.platform-btn').forEach(b => {
    b.onclick = async () => {
      const isSame = b.classList.contains('active');
      if (isSame) {
        if (window.innerWidth <= 768) openRankSidebar();
        return;
      }
      document.querySelectorAll('.platform-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      currentSource = b.dataset.source;
      $('rankList').innerHTML = '<div class="rank-loading">榜单加载中，请稍等...</div>';
      await loadRankCats();
    };
  });

  $('rankHeader').onclick = () => {
    if (window.innerWidth > 768) return;
    const sb = $('rankSidebar');
    if (sb.classList.contains('open')) {
      closeRankSidebar();
    } else {
      openRankSidebar();
    }
  };

  $('catOverlay').onclick = closeRankSidebar;

  $('rankSelectAll').onclick = () => selectAllIn(getActiveList());
  $('rankInvert').onclick = () => invertIn(getActiveList());
  $('rankClearSel').onclick = () => clearSelIn(getActiveList());
  $('rankPlayAll').onclick = () => {
    const el = getActiveList();
    if (!el || !el._songs || !el._songs.length) return;
    playSong(el._songs[0], el._songs);
  };
  $('rankPlaySelected').onclick = () => {
    const el = getActiveList();
    if (!el) return;
    const sel = getSelectedSongs(el);
    if (sel.length) playSong(sel[0], sel);
  };

  $('rankDownloadNAS').onclick = async () => {
    const el = getActiveList();
    if (!el) return alert('未找到歌曲列表');
    const songs = getSelectedSongs(el);
    if (!songs.length) return alert('请先勾选歌曲');
    const q = await pickQuality('download');
    if (!q) return;
    downloadToNAS(songs, q);
    hideToolbar();
  };

  $('rankCopyLinks').onclick = async () => {
    const el = getActiveList();
    if (!el) return alert('未找到歌曲列表');
    const songs = getSelectedSongs(el);
    if (!songs.length) return alert('请先勾选歌曲');
    const quality = await pickQuality('download');
    if (!quality) return;
    window.showDownloadDialog(songs, quality);
  };
  $('closeLinksModal').onclick = () => { $('linksModal').classList.add('hidden'); clearInterval(timer); };
  window.copyText = function(t) {
    const ta = document.createElement('textarea');
    ta.value = t; ta.style.position='fixed'; ta.style.opacity='0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); alert('已复制'); } catch(e) { alert('复制失败'); }
    document.body.removeChild(ta);
  };
  window.downloadUrl = function(url, name) {
    fetch(url).then(r => r.blob()).then(b => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = name;
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }).catch(() => { window.open(url, '_blank'); });
  };

  $('rankSavePlaylist').onclick = async () => {
    const el = getActiveList();
    if (!el) return alert('未找到歌曲列表');
    const songs = getSelectedSongs(el);
    if (!songs.length) return alert('请先勾选歌曲');
    const name = prompt('歌单名称：', `我的歌单 ${new Date().toLocaleDateString()}`);
    if (!name) return;
    const newPl = { id: 'pl_' + Date.now(), name, list: songs };
    try {
      const { userList } = await fetchUserLists();
      await saveUserLists([...userList, newPl]);
      alert(`歌单「${name}」已保存，共 ${songs.length} 首`);
    } catch (e) {
      alert('保存失败: ' + e.message);
    }
  };

  $('uploadPlaylistBtn').onclick = () => $('playlistFileInput').click();
  $('pastePlaylistBtn').onclick = () => $('pastePlaylistModal').classList.remove('hidden');
  $('closePasteModal').onclick = () => $('pastePlaylistModal').classList.add('hidden');

  $('confirmPastePlaylist').onclick = async () => {
    const name = $('pastePlaylistName').value.trim();
    const text = $('pastePlaylistText').value.trim();
    if (!text) return alert('请粘贴歌单内容');
    let songs = [];
    let parsedName = '';
    try {
      const parsed = JSON.parse(text);
      if (parsed.playlist_name) parsedName = parsed.playlist_name;
      if (parsed.songs) {
        songs = parsed.songs.map(s => ({
          name: s.title || s.name,
          singer: s.artist || s.singer || '',
          album: s.album || '', source: currentSource,
        }));
      } else if (parsed.list) { songs = parsed.list; }
      else if (Array.isArray(parsed)) { songs = parsed; }
    } catch (e) {
      songs = text.split('\n').map(line => {
        const [n, s] = line.split('-').map(x => x.trim());
        return { name: n, singer: s || '', source: currentSource };
      }).filter(x => x.name);
    }
    const plName = name || parsedName || '未命名歌单';
    const newPl = { id: 'pl_' + Date.now(), name: plName, list: songs };
    try {
      const { userList } = await fetchUserLists();
      await saveUserLists([...userList, newPl]);
      $('pastePlaylistModal').classList.add('hidden');
      $('pastePlaylistName').value = '';
      $('pastePlaylistText').value = '';
      loadPlaylists();
      alert(`歌单「${plName}」已创建，共 ${songs.length} 首`);
    } catch (e) {
      alert('创建失败: ' + e.message);
    }
  };

  $('playlistFileInput').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    let name = ''; let songs = [];
    try {
      const parsed = JSON.parse(text);
      if (parsed.playlist_name) name = parsed.playlist_name;
      if (parsed.songs) {
        songs = parsed.songs.map(s => ({
          name: s.title || s.name,
          singer: s.artist || s.singer || '',
          album: s.album || '', source: currentSource,
        }));
      } else if (parsed.list) {
        songs = parsed.list;
        name = name || file.name.replace('.json', '');
      } else if (Array.isArray(parsed)) {
        songs = parsed;
        name = name || file.name.replace('.json', '');
      }
    } catch (err) {
      alert('JSON格式错误'); e.target.value = ''; return;
    }
    if (!name) name = file.name.replace('.json', '');
    if (!songs.length) { alert('未找到歌曲数据'); e.target.value = ''; return; }
    const newPl = { id: 'pl_' + Date.now(), name, list: songs };
    try {
      const { userList } = await fetchUserLists();
      await saveUserLists([...userList, newPl]);
      loadPlaylists();
      alert(`歌单「${name}」已创建，共 ${songs.length} 首`);
    } catch (err) { alert('创建失败: ' + err.message); }
    e.target.value = '';
  };

  $('backToPlaylists').onclick = () => {
    $('playlistView').classList.remove('hidden');
    $('playlistDetailView').classList.add('hidden');
    hideToolbar();
  };

  $('downloadTasks').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-retry]');
    if (btn) retryDownload(+btn.dataset.retry);
  });

  $('downloadPauseAll').onclick = function () {
    downloadPaused = !downloadPaused;
    this.textContent = downloadPaused ? '继续' : '暂停';
    this.classList.toggle('yellow', downloadPaused);
  };
  $('downloadCancelAll').onclick = () => {
    if (!downloadTasks.length) return;
    downloadCanceled = true;
    downloadPaused = false;
    downloadTasks = [];
    renderDownloadTasks();
    $('downloadPauseAll').textContent = '暂停';
    $('downloadPauseAll').classList.remove('yellow');
    clearTimeout(downloadPollTimer);
  };
  $('clearHistoryBtn').onclick = async () => {
    if (!confirm('清空下载历史记录？（NAS文件保留）')) return;
    downloadHistory = [];
    localStorage.setItem('nas_music_history', '[]');
    loadDownloadHistory();
  };
  $('refreshHistoryBtn').onclick = async () => {
    const btn = $('refreshHistoryBtn');
    btn.textContent = '刷新中...'; btn.disabled = true;
    await loadDownloadHistory();
    btn.textContent = '刷新'; btn.disabled = false;
  };

  $('settingsBtn').onclick = () => {
    $('settingsModal').classList.remove('hidden');
    loadSources();
    
    // 🚀 强制显示用户管理面板（解决刷新后不显示的问题）
    if (currentUser === 'admin') {
      const mgr = document.getElementById('adminUserMgr');
      if (mgr) mgr.style.display = 'block';
      if (typeof loadUserList === 'function') loadUserList();
    }
  };

  $('closeSettings').onclick = () => $('settingsModal').classList.add('hidden');
  $('uploadSourceBtn').onclick = () => {
    $('uploadSourceBtn').textContent = '选择文件...';
    $('sourceFileInput').click();
  };
  $('sourceFileInput').onchange = async (e) => {
    if (e.target.files[0]) {
      $('uploadSourceBtn').textContent = '上传中...';
      try { await uploadSource(e.target.files[0]); } catch(err) {}
      $('uploadSourceBtn').textContent = '上传音源';
    }
    e.target.value = '';
  };

  $('togglePwd').onclick = () => {
    const inp = $('newPwdInput');
    inp.type = inp.type === 'password' ? 'text' : 'password';
    $('togglePwd').textContent = inp.type === 'password' ? '显示' : '隐藏';
  };
  $('togglePwd2').onclick = () => {
    const inp = $('newPwdConfirm');
    inp.type = inp.type === 'password' ? 'text' : 'password';
    $('togglePwd2').textContent = inp.type === 'password' ? '显示' : '隐藏';
  };
  $('logoutBtn').onclick = () => {
    localStorage.clear();
    sessionStorage.clear();
    window.location.replace(window.location.origin + window.location.pathname + '?logout=' + Date.now());
  };

  $('btnPlay').onclick = togglePlay;
  $('fsPlay').onclick = togglePlay;
  $('fsPlayOverlay').onclick = togglePlay;
  $('btnNext').onclick = playNext;
  $('fsNext').onclick = playNext;
  $('btnPrev').onclick = playPrev;
  $('fsPrev').onclick = playPrev;

  // 播放器栏点击 → 全屏播放（addEventListener 兜底，不覆盖内联 onclick）
  const _openFullscreen = (e) => {
    if (e && e.target && e.target.closest && e.target.closest('button')) return;
    const fs = $('playerFullscreen');
    if (!fs) return;
    fs.classList.remove('hidden');
    fs.style.display = 'flex';
  };
  const _closeFullscreen = () => {
    const fs = $('playerFullscreen');
    if (!fs) return;
    fs.classList.add('hidden');
    fs.style.display = '';
  };
  $('playerBar').addEventListener('click', _openFullscreen);
  if ($('fsClose')) $('fsClose').addEventListener('click', _closeFullscreen);
  // 点全屏播放器背景空白处也能关闭
  const fsEl = $('playerFullscreen');
  if (fsEl) fsEl.addEventListener('click', (e) => {
    if (e.target === fsEl || (e.target.classList && e.target.classList.contains('fs-bg'))) _closeFullscreen();
  });

  if (!audio) audio = $('audioEl');
  audio.addEventListener('timeupdate', () => {
    const pct = audio.duration ? (audio.currentTime / audio.duration * 100) : 0;
    $('progressFill').style.width = pct + '%';
    $('fsProgressFill').style.width = pct + '%';
    $('playerTime').textContent = `${fmtTime(audio.currentTime)} / ${fmtTime(audio.duration)}`;
    $('fsTime').textContent = `${fmtTime(audio.currentTime)} / ${fmtTime(audio.duration)}`;
    renderLyric(audio.currentTime);
  });
  audio.addEventListener('ended', playNext);

  const seek = (bar, e) => {
    const rect = bar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    if (audio.duration) audio.currentTime = pct * audio.duration;
  };
  $('progressBar').onclick = (e) => seek(e.currentTarget, e);
  $('fsProgressBar').onclick = (e) => seek(e.currentTarget, e);

  window._loadLyric = loadLyric;

  document.addEventListener('change', (e) => {
    if (e.target.classList.contains('song-check')) {
      requestAnimationFrame(() => updateToolbarVisibility());
    }
  });
  // 移动端兜底：鸿蒙/部分浏览器 change 事件延迟，click 后立即同步一次工具栏
  document.addEventListener('click', (e) => {
    const cb = e.target && e.target.closest ? e.target.closest('.song-check') : null;
    if (cb) {
      requestAnimationFrame(() => updateToolbarVisibility());
    }
  }, true);

  window.addEventListener('resize', () => {
    const tb = $('globalToolbar');
    if (tb.classList.contains('show')) {
      updateToolbarVisibility();
    }
    if ($('rankSidebar').classList.contains('open')) {
      positionRankDrawer();
    }
  });

  const content = document.querySelector('.content');
  if (content) {
    content.addEventListener('scroll', () => {
      if ($('rankSidebar').classList.contains('open')) {
        positionRankDrawer();
      }
    }, { passive: true });
  }
});
// GitHub音源仓库
document.addEventListener('DOMContentLoaded', function() {
  var repos = [];
  var btn = document.getElementById('ghRepoBtn');
  var modal = document.getElementById('ghModal');
  if (!btn || !modal) return;
  btn.onclick = function() {
    modal.classList.remove('hidden');
    fetch('/get-mirror').then(r=>r.json()).then(d => {
      if (d.ok) {
        if (d.mirror) document.getElementById('ghMirrorInput').value = d.mirror;
        repos = d.repos || [];
        renderRepos();
      }
    });
  };
  document.getElementById('closeGhModal').onclick = function() { modal.classList.add('hidden'); };

  function renderRepos() {
    var box = document.getElementById('repoList');
    box.innerHTML = '';
    repos.forEach(function(r, i) {
      var short = r.replace('https://github.com/','').replace(/\/$/,'');
      var div = document.createElement('div');
      div.style.cssText = 'padding:4px 0;display:flex;justify-content:space-between;align-items:center;font-size:13px';
      div.innerHTML = '<span style="flex:1">'+short+'</span><button class="tool-btn blue" style="padding:2px 8px;margin:0 4px">拉取</button><button class="tool-btn red" style="padding:2px 8px">删除</button>';
      div.querySelectorAll('button')[0].onclick = function() { pullRepo(r); };
      div.querySelectorAll('button')[1].onclick = function() {
        if (confirm('删除 '+short+'？')) { repos.splice(i,1); save(); renderRepos(); }
      };
      box.appendChild(div);
    });
  }
  function save() {
    var m = document.getElementById('ghMirrorInput').value.trim();
    fetch('/set-mirror?url=' + encodeURIComponent(m) + '&repos=' + encodeURIComponent(JSON.stringify(repos)));
  }
  document.getElementById('addRepoBtn').onclick = function() {
    var v = document.getElementById('ghRepoInput').value.trim();
    if (v && repos.indexOf(v) < 0) { repos.push(v); document.getElementById('ghRepoInput').value=''; save(); renderRepos(); }
  };
  document.getElementById('saveMirrorBtn').onclick = function() { save(); alert('已保存'); };
  function pullRepo(r) {
    var box = document.getElementById('ghSearchResults');
    box.innerHTML = '<p style="color:#888">拉取中...</p>';
    fetch('/search-sources?repo=' + encodeURIComponent(r)).then(r=>r.json()).then(function(d) {
      box.innerHTML = '';
      if (!d.releases) { box.innerHTML = '<p style="color:red">'+(d.error||'无结果')+'</p>'; return; }
      d.releases.forEach(function(rel) {
        var h = document.createElement('div');
        h.style.cssText = 'padding:8px;background:var(--bg3);color:var(--text);margin:4px 0;border-radius:4px;cursor:pointer;border:1px solid var(--border)';
        h.innerHTML = '<b>'+rel.tag+'</b> <span style="color:#888;font-size:12px">'+rel.date+'</span> <span style="float:right">▼</span>';
        var list = document.createElement('div');
        list.style.display = 'none';
        var loaded = false;
        h.onclick = function() {
          list.style.display = list.style.display==='none'?'block':'none';
          if (loaded || list.children.length > 0) return;
          list.innerHTML = '<p style="color:#888;padding:8px">加载中...</p>';
          var zipAssets = rel.assets.filter(function(a){return a.type==='zip'});
          if (zipAssets.length > 0) {
            var z = zipAssets[0];
            list.innerHTML = '<p style="color:#888;padding:8px">解压 '+z.name+'...</p>';
            fetch('/extract-zip?url='+encodeURIComponent(z.raw)).then(r=>r.json()).then(function(zd) {
              list.innerHTML = '';
              if (!zd.ok) { list.innerHTML = '<p style="color:red">解压失败</p>'; return; }
              loaded = true;
              zd.items.forEach(function(it) { appendItem(list, it, rel.date); });
            });
          } else {
            list.innerHTML = '';
            rel.assets.forEach(function(a) { appendItem(list, a, rel.date); });
          }
        };
        box.appendChild(h);
        box.appendChild(list);
      });
      function appendItem(list, it, date) {
        var div = document.createElement('div');
        div.style.cssText = 'padding:6px 8px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center';
        div.innerHTML = '<div style="flex:1;min-width:0;font-size:13px">'+it.name+'</div>'+(date?'<span style="color:#888;font-size:11px;margin-right:8px">'+date+'</span>':'')+'<button class="tool-btn blue" style="margin-left:8px;flex-shrink:0">导入</button>';
        div.querySelector('button').onclick = function() {
          var btn = this; btn.textContent='导入中...'; btn.disabled=true;
          var p;
          if (it.inline) {
            p = Promise.resolve();
          } else {
            p = fetch('/fetch-source?raw='+encodeURIComponent(it.raw)).then(r=>r.json()).then(function(f) { it.inline = f.content; });
          }
          p.then(function() {
            return fetch('/save-source',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:it.name,content:it.inline})}).then(r=>r.json());
          }).then(function() {
            btn.textContent='已导入';
            alert('导入成功，请手动启用');
            modal.classList.add('hidden');
            loadSources();
          }).catch(function(e) {
            btn.textContent='失败';
            alert('导入失败: '+e.message);
          });
        };
        list.appendChild(div);
      }
    });
  }
});

// Play mode switch
document.addEventListener('DOMContentLoaded', function() {
  function refreshMode() {
    fetch('/get_playmode').then(r=>r.json()).then(d => {
      if (d.ok) document.getElementById('currentMode').textContent = d.mode === 'download' ? '下完再播' : '边下边播';
    });
  }
  refreshMode();
  var s = document.getElementById('modeStreamBtn');
  var d = document.getElementById('modeDownloadBtn');
  if (s) s.onclick = function() { fetch('/set_playmode?mode=stream').then(()=>{alert('已切换为边下边播');refreshMode();}); };
  if (d) d.onclick = function() { fetch('/set_playmode?mode=download').then(()=>{alert('已切换为下完再播');refreshMode();}); };
});

// ==========================================
// 🔥 外挂模块：后台持久化队列改造（覆盖原有逻辑）
// ==========================================

// 1. 覆盖旧的 downloadToNAS
window.downloadToNAS = async function(songs, quality) {
  if (!songs.length) return;
  switchTab('download');
  
  const el = $('downloadTasks');
  if (el) el.innerHTML = '<div style="padding:10px;color:var(--text2)">正在提交到后台队列...</div>';

  const tasks = songs.map(song => ({ songInfo: song, quality: quality }));

  try {
    const res = await api('/api/music/cache/queue', {
      method: 'POST',
      body: { tasks: tasks, namingPattern: 'name_singer' }
    });
    if (res.success) {
      startQueuePolling();
    } else {
      alert('提交任务失败: ' + (res.message || '未知错误'));
    }
  } catch (e) {
    alert('网络请求失败: ' + e.message);
  }
  if (typeof hideToolbar === 'function') hideToolbar();
};

// 2. 覆盖旧的 loadDownloadTasks
window.loadDownloadTasks = async function() {
  startQueuePolling();
  await loadDownloadHistory();
};

// 3. 新增轮询和渲染逻辑
let queuePollTimer = null;

async function startQueuePolling() {
  clearTimeout(queuePollTimer);
  try {
    const queueRes = await api('/api/music/cache/queue');
    if (!queueRes.success) return;
    
    const queue = queueRes.data || [];
    renderQueueUI(queue);

    const activeTasks = queue.filter(t => t.status === 'downloading' || t.status === 'running');
    if (activeTasks.length > 0) {
      const ids = activeTasks.map(t => t.id).join(',');
      try {
        const progRes = await api(`/api/music/cache/progress?ids=${ids}`);
        if (progRes.success) {
          updateRealProgress(progRes.data);
        }
      } catch (e) {}
    }

    if (queue.some(t => t.status === 'waiting' || t.status === 'downloading' || t.status === 'running')) {
      queuePollTimer = setTimeout(startQueuePolling, 2000);
    }
  } catch (e) {
    console.error('轮询队列失败', e);
    queuePollTimer = setTimeout(startQueuePolling, 5000);
  }
}

function renderQueueUI(queue) {
  const el = $('downloadTasks');
  if (!el) return;
  
  if (!queue.length) {
    el.innerHTML = '<div style="color:var(--text2)">暂无下载任务</div>';
    return;
  }

  const statusText = { waiting: '等待中', downloading: '下载中', completed: '已完成', failed: '失败' };
  const statusColor = { waiting: 'var(--text2)', downloading: 'var(--blue)', completed: 'var(--green)', failed: 'var(--red)' };

  el.innerHTML = queue.map((t, i) => {
    const name = t.songInfo?.name || t.name || '未知歌曲';
    const singer = t.songInfo?.singer || t.singer || '';
    const quality = t.quality || '';
    
    return `
    <div class="task-item" id="queue-item-${t.id}">
      <span class="task-index">${i + 1}</span>
      <div class="task-body">
        <div class="task-name">${esc(name)}</div>
        <div class="task-meta">
          ${esc(singer)} · ${esc(quality)} 
          <span class="real-speed" id="speed-${t.id}"></span>
        </div>
        ${(t.status === 'downloading') ? `
          <div class="task-bar"><div class="task-bar-fill" id="bar-${t.id}" style="width:0%"></div></div>
        ` : ''}
      </div>
      <div class="task-status">
        <span class="task-status-text" style="color:${statusColor[t.status] || ''}">${statusText[t.status] || t.status}</span>
      </div>
    </div>`;
  }).join('');
}

function updateRealProgress(data) {
  for (const [id, info] of Object.entries(data)) {
    const bar = document.getElementById(`bar-${id}`);
    const speedEl = document.getElementById(`speed-${id}`);
    
    if (bar) bar.style.width = `${info.progress || 0}%`;
    
    if (speedEl && info.speed > 0) {
      const speedMB = (info.speed / 1024 / 1024).toFixed(2);
      const totalMB = info.total ? (info.total / 1024 / 1024).toFixed(1) : '?';
      speedEl.innerHTML = ` · <span style="color:var(--green);font-weight:bold;">${speedMB} MB/s</span> (共${totalMB}MB)`;
    }
  }
}

// ==========================================
// 🚀 下载管理 UI 终极修复补丁
// ==========================================

// 覆盖旧的渲染逻辑，修复状态英文和缺失的按钮
window.renderQueueUI = function(queue) {
  const el = $('downloadTasks');
  if (!el) return;
  
  if (!queue.length) {
    el.innerHTML = '<div style="color:var(--text2)">暂无下载任务</div>';
    return;
  }

  // 补全了各种状态的中文映射
  const statusText = { 
    waiting: '等待中', 
    running: '解析中', 
    downloading: '下载中', 
    tagging: '写入标签', 
    completed: '已完成', 
    finished: '已完成', 
    failed: '失败' 
  };
  const statusColor = { 
    waiting: 'var(--text2)', 
    running: 'var(--blue)', 
    downloading: 'var(--blue)', 
    tagging: 'var(--yellow)', 
    completed: 'var(--green)', 
    finished: 'var(--green)', 
    failed: 'var(--red)' 
  };

  el.innerHTML = queue.map((t, i) => {
    const name = t.songInfo?.name || t.name || '未知歌曲';
    const singer = t.songInfo?.singer || t.singer || '';
    const quality = t.quality || t.songInfo?.quality || 'flac';
    
    // 后端状态兼容
    const status = t.status;
    const isDone = status === 'finished' || status === 'completed';
    const isDownloading = status === 'downloading' || status === 'running';
    
    return `
    <div class="task-item" id="queue-item-${t.id}">
      <span class="task-index">${i + 1}</span>
      <div class="task-body">
        <div class="task-name">${esc(name)}</div>
        <div class="task-meta">
          ${esc(singer)} · ${esc(quality)} 
          <span class="real-speed" id="speed-${t.id}" style="color:var(--green);font-weight:bold;"></span>
        </div>
        ${(isDownloading || status === 'waiting') ? `
          <div class="task-bar">
            <!-- 如果没有真实进度，就用 CSS 动画做一个一直在跑的滑动条，视觉上更好看 -->
            <div class="task-bar-fill" id="bar-${t.id}" style="width: ${isDownloading ? '100%' : '0%'}; ${isDownloading ? 'animation: pulse 1.5s infinite;' : ''}"></div>
          </div>
        ` : ''}
      </div>
      <div class="task-status">
        <span class="task-status-text" style="color:${statusColor[status] || ''}">${statusText[status] || status}</span>
      </div>
    </div>`;
  }).join('');
};

// 修复顶部按钮的点击逻辑
document.addEventListener('DOMContentLoaded', () => {
    // 替换“取消任务”按钮逻辑
    const cancelBtn = $('downloadCancelAll');
    if (cancelBtn) {
        cancelBtn.onclick = async () => {
            if (!confirm('确认取消并清空所有后台下载任务吗？')) return;
            try {
                await api('/api/music/cache/queue/remove', {
                    method: 'POST',
                    body: { all: true }
                });
                alert('已清空后台任务');
                startQueuePolling();
            } catch(e) { alert(e.message); }
        };
    }

    // 替换“暂停”按钮逻辑
    const pauseBtn = $('downloadPauseAll');
    if (pauseBtn) {
        pauseBtn.onclick = async () => {
            try {
                await api('/api/music/cache/queue/resume', {
                    method: 'POST',
                    body: { all: true }
                });
                alert('已发送暂停指令');
            } catch(e) { alert(e.message); }
        };
    }
});

// ==========================================
// 🚀 下载管理 UI 终极完美版 (V3: 倒序+百分比+速度+历史刷新)
// ==========================================

// 1. 完美渲染：新任务在最上 + 百分比显示
window.renderQueueUI = function(queue) {
  const el = $('downloadTasks');
  if (!el) return;
  
  if (!queue.length) {
    el.innerHTML = '<div style="color:var(--text2)">暂无下载任务</div>';
    return;
  }

  // 反转数组，让最新添加的任务排在最上面
  const sortedQueue = [...queue].reverse();

  const statusText = { 
    waiting: '等待中', running: '解析中', downloading: '下载中', 
    tagging: '写入标签', completed: '已完成', finished: '已完成', failed: '失败' 
  };
  const statusColor = { 
    waiting: 'var(--text2)', running: 'var(--blue)', downloading: 'var(--blue)', 
    tagging: 'var(--yellow)', completed: 'var(--green)', finished: 'var(--green)', failed: 'var(--red)' 
  };

  el.innerHTML = sortedQueue.map((t, i) => {
    const name = t.songInfo?.name || t.name || '未知歌曲';
    const singer = t.songInfo?.singer || t.singer || '';
    const quality = t.quality || t.songInfo?.quality || 'flac';
    
    const status = t.status;
    const isDone = status === 'finished' || status === 'completed';
    const isDownloading = status === 'downloading' || status === 'running' || status === 'tagging';
    const pct = t.progress || 0;
    
    return `
    <div class="task-item" id="queue-item-${t.id}">
      <span class="task-index">${sortedQueue.length - i}</span>
      <div class="task-body">
        <div class="task-name">${esc(name)}</div>
        <div class="task-meta" style="display:flex; justify-content:space-between; align-items:center;">
          <span>${esc(singer)} · ${esc(quality)}</span>
          <span id="meta-right-${t.id}" style="font-size:12px; color:var(--text2);">
            ${isDownloading ? `<span style="color:var(--blue);" id="pct-${t.id}">${pct}%</span> <span class="real-speed" id="speed-${t.id}"></span>` : ''}
          </span>
        </div>
        ${(isDownloading || status === 'waiting') ? `
          <div class="task-bar" style="margin-top:6px; width:100%; height:4px; background:var(--bg3); border-radius:2px; overflow:hidden;">
            <div class="task-bar-fill" id="bar-${t.id}" style="width: ${pct}%; height:100%; background:var(--blue); transition:width 0.3s; ${isDownloading && pct===0 ? 'animation: pulse 1.5s infinite;' : ''}"></div>
          </div>
        ` : ''}
      </div>
      <div class="task-status" style="margin-left:10px;">
        <span class="task-status-text" style="color:${statusColor[status] || ''}; font-size:12px;">${statusText[status] || status}</span>
      </div>
    </div>`;
  }).join('');
};

// 2. 完美进度更新：更新百分比和真实速度
window.updateRealProgress = function(data) {
  for (const [id, info] of Object.entries(data)) {
    const bar = document.getElementById(`bar-${id}`);
    const pctEl = document.getElementById(`pct-${id}`);
    const speedEl = document.getElementById(`speed-${id}`);
    
    // 更新进度条
    if (bar && info.progress !== undefined) {
      bar.style.width = `${info.progress}%`;
      bar.style.animation = 'none'; // 移除闪烁动画
    }
    // 更新百分比
    if (pctEl && info.progress !== undefined) {
      pctEl.textContent = `${info.progress}%`;
    }
    // 更新速度
    if (speedEl && info.speed > 0) {
      const speedMB = (info.speed / 1024 / 1024).toFixed(2);
      speedEl.innerHTML = `· <span style="color:var(--green);font-weight:bold;">${speedMB} MB/s</span>`;
    }
  }
};

// 3. 完美轮询：自动刷新历史记录
let _lastCompletedCount = 0;
window.startQueuePolling = async function() {
  clearTimeout(queuePollTimer);
  try {
    const queueRes = await api('/api/music/cache/queue');
    if (!queueRes.success) return;
    
    const queue = queueRes.data || [];
    renderQueueUI(queue);

    // 检测是否有新完成的歌曲，如果有，立刻刷新下方下载历史！
    const currentCompletedCount = queue.filter(t => t.status === 'finished' || t.status === 'completed').length;
    if (currentCompletedCount > _lastCompletedCount) {
      _lastCompletedCount = currentCompletedCount;
      loadDownloadHistory(); // 立即刷新历史
    } else if (queue.length === 0 && _lastCompletedCount > 0) {
      _lastCompletedCount = 0;
      loadDownloadHistory();
    }

    const activeTasks = queue.filter(t => t.status === 'downloading' || t.status === 'running' || t.status === 'tagging');
    if (activeTasks.length > 0) {
      const ids = activeTasks.map(t => t.id).join(',');
      try {
        const progRes = await api(`/api/music/cache/progress?ids=${ids}`);
        if (progRes.success) {
          updateRealProgress(progRes.data);
        }
      } catch (e) {}
    }

    // 只要队列里还有任务，就持续轮询
    if (queue.some(t => ['waiting', 'downloading', 'running', 'tagging'].includes(t.status))) {
      queuePollTimer = setTimeout(startQueuePolling, 2000);
    }
  } catch (e) {
    console.error('轮询队列失败', e);
    queuePollTimer = setTimeout(startQueuePolling, 5000);
  }
};

// ==========================================
// 🚀 暴力修复：下载历史不刷新问题 (V4)
// ==========================================

window.loadDownloadHistory = async function() {
  const histEl = $('downloadHistory');
  if (!histEl) return;
  
  histEl.innerHTML = '<div style="color:var(--text2);padding:12px">正在获取历史...</div>';
  let songs = [];
  let showSize = false;

  try {
    // 绕过原有的 api() 封装，直接用原生 fetch 强拉数据
    // 显式加上 ?user=_open 和 请求头，确保后端绝对放行
    const url = '/api/music/cache/list?user=_open';
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'x-user-name': '_open',
        'x-frontend-auth': localStorage.getItem('nas_music_pwd')
      }
    });
    
    if (!res.ok) throw new Error(`HTTP ${res.status} - 权限被拒绝或接口异常`);
    
    const json = await res.json();
    // 兼容多种返回结构
    const cachedSongs = json.data || json || [];
    
    if (Array.isArray(cachedSongs) && cachedSongs.length > 0) {
      // 按修改时间倒序（最新的在最上面）
      songs = cachedSongs.slice().sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
      showSize = true;
    }
  } catch (e) {
    console.error("获取下载历史失败:", e);
    histEl.innerHTML = `<div style="color:var(--red);padding:12px">拉取失败: ${esc(e.message)}</div>`;
    return;
  }

  if (!songs.length) {
    histEl.innerHTML = '<div style="color:var(--text2);padding:12px">暂无下载历史</div>';
    return;
  }

  const total = songs.length;
  histEl.innerHTML = songs.map((s, i) => {
    const num = total - i;
    const meta = showSize
      ? `${esc(s.quality || '')} · ${((s.size || 0) / 1048576).toFixed(1)}MB`
      : esc(s.quality || '');
      
    const singer = s.singer || s.songInfo?.singer || s.artist || '未知';
    
    return `<div class="song-item" data-idx="${i}">
      <span class="song-num">${num}</span>
      <div class="song-info"><div class="song-name">${esc(s.name)}</div></div>
      <span class="song-singer">${esc(singer)}</span>
      <span class="song-quality" style="font-size:11px;color:var(--text2);margin:0 8px;">${meta}</span>
      <button class="song-play-btn" data-play="${i}" title="播放">▶</button>
    </div>`;
  }).join('');

  // 绑定播放按钮事件
  const playList = songs.map(s => ({
    name: s.name,
    singer: s.singer || s.songInfo?.singer || s.artist || '未知',
    source: s.source || 'kw',
    ...(s.songInfo || {}),
  }));

  histEl.querySelectorAll('[data-play]').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const idx = +btn.dataset.play;
      if (typeof playSong === 'function') playSong(playList[idx], playList);
    };
  });
};

// 确保“刷新”按钮绑定的是最新函数
document.addEventListener('DOMContentLoaded', () => {
    const refreshBtn = document.getElementById('refreshHistoryBtn');
    if (refreshBtn) {
        refreshBtn.onclick = async function() {
            this.textContent = '刷新中...'; 
            this.disabled = true;
            await window.loadDownloadHistory();
            this.textContent = '刷新'; 
            this.disabled = false;
        };
    }
});

// ==========================================
// 🚀 修复“清空历史”：彻底删除 NAS 硬盘文件
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    const clearBtn = document.getElementById('clearHistoryBtn');
    if (clearBtn) {
        clearBtn.onclick = async () => {
            if (!confirm('⚠️ 警告：这不仅会清空历史记录，还会删除 NAS 硬盘上已下载的所有歌曲文件！确定吗？')) return;
            
            clearBtn.textContent = '删除中...';
            clearBtn.disabled = true;

            try {
                // 1. 先获取所有文件列表
                const res = await fetch('/api/music/cache/list?user=_open', {
                    headers: { 'x-user-name': '_open', 'x-frontend-auth': localStorage.getItem('nas_music_pwd') }
                });
                const json = await res.json();
                const songs = json.data || json || [];
                
                if (songs.length > 0) {
                    // 2. 构造删除请求的 items
                    const items = songs.map(s => ({ filename: s.filename, folder: s.folder || 'music' }));
                    
                    // 3. 发给后端执行删除
                    await fetch('/api/music/cache/remove', {
                        method: 'POST',
                        headers: { 
                            'Content-Type': 'application/json',
                            'x-user-name': '_open',
                            'x-frontend-auth': localStorage.getItem('nas_music_pwd')
                        },
                        body: JSON.stringify({ items: items })
                    });
                }
                
                // 4. 清空浏览器缓存并刷新
                localStorage.setItem('nas_music_history', '[]');
                await window.loadDownloadHistory();
                alert('已成功清空 NAS 文件和下载历史！');
            } catch (e) {
                alert('清空失败: ' + e.message);
            } finally {
                clearBtn.textContent = '清空历史';
                clearBtn.disabled = false;
            }
        };
    }
});

// ==========================================
// 🚀 终极方案：只清空前端历史，绝不碰 NAS 文件
// ==========================================

// 1. 覆盖加载历史逻辑：过滤掉被用户“隐藏”的旧记录
window.loadDownloadHistory = async function() {
  const histEl = $('downloadHistory');
  if (!histEl) return;
  
  histEl.innerHTML = '<div style="color:var(--text2);padding:12px">正在获取历史...</div>';
  let songs = [];
  let showSize = false;

  // 获取用户上一次点击“清空”的时间戳
  const hideBeforeTime = parseInt(localStorage.getItem('nas_music_hide_before') || '0');

  try {
    const res = await fetch('/api/music/cache/list?user=_open', {
      headers: { 'x-user-name': '_open', 'x-frontend-auth': localStorage.getItem('nas_music_pwd') }
    });
    const json = await res.json();
    const cachedSongs = json.data || json || [];
    
    if (Array.isArray(cachedSongs) && cachedSongs.length > 0) {
      // 核心逻辑：过滤掉修改时间早于隐藏时间点的文件
      const visibleSongs = cachedSongs.filter(s => (s.mtime || 0) > hideBeforeTime);
      
      if (visibleSongs.length > 0) {
        songs = visibleSongs.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
        showSize = true;
      }
    }
  } catch (e) {
    console.error("获取下载历史失败:", e);
    histEl.innerHTML = `<div style="color:var(--red);padding:12px">拉取失败: ${esc(e.message)}</div>`;
    return;
  }

  if (!songs.length) {
    histEl.innerHTML = '<div style="color:var(--text2);padding:12px">暂无下载历史</div>';
    return;
  }

  const total = songs.length;
  histEl.innerHTML = songs.map((s, i) => {
    const num = total - i;
    const meta = showSize ? `${esc(s.quality || '')} · ${((s.size || 0) / 1048576).toFixed(1)}MB` : esc(s.quality || '');
    const singer = s.singer || s.songInfo?.singer || s.artist || '未知';
    
    return `<div class="song-item" data-idx="${i}">
      <span class="song-num">${num}</span>
      <div class="song-info"><div class="song-name">${esc(s.name)}</div></div>
      <span class="song-singer">${esc(singer)}</span>
      <span class="song-quality" style="font-size:11px;color:var(--text2);margin:0 8px;">${meta}</span>
      <button class="song-play-btn" data-play="${i}" title="播放">▶</button>
    </div>`;
  }).join('');

  const playList = songs.map(s => ({
    name: s.name,
    singer: s.singer || s.songInfo?.singer || s.artist || '未知',
    source: s.source || 'kw',
    ...(s.songInfo || {}),
  }));

  histEl.querySelectorAll('[data-play]').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const idx = +btn.dataset.play;
      if (typeof playSong === 'function') playSong(playList[idx], playList);
    };
  });
};

// 2. 彻底接管“清空”按钮，绝不删文件
setTimeout(() => {
    const oldBtn = document.getElementById('clearHistoryBtn');
    if (!oldBtn) return;

    const newBtn = oldBtn.cloneNode(true);
    oldBtn.parentNode.replaceChild(newBtn, oldBtn);

    newBtn.onclick = async () => {
        // 提示语改回最让人放心的那句话
        if (!confirm('清空下载历史记录？（NAS 文件绝对保留）')) return;
        
        newBtn.textContent = '清空中...';
        newBtn.disabled = true;

        try {
            // 记录当前时间，让比这个时间早的文件全部“隐身”
            localStorage.setItem('nas_music_hide_before', Date.now().toString());
            localStorage.setItem('nas_music_history', '[]');
            
            // 重新拉取，此时旧的都会被过滤掉
            await window.loadDownloadHistory();
        } catch (e) {
            alert('清空失败: ' + e.message);
        } finally {
            newBtn.textContent = '清空历史';
            newBtn.disabled = false;
        }
    };
}, 1000);

// ==========================================
// 🚀 终极 UI：带有状态分类的下载管理（类似迅雷）
// ==========================================
let currentQueueFilter = 'all';

window.renderQueueUI = function(queue) {
  const el = $('downloadTasks');
  if (!el) return;

  // 1. 统计各类状态的数量
  const counts = {
    all: queue.length,
    downloading: queue.filter(t => ['waiting', 'running', 'downloading', 'tagging'].includes(t.status)).length,
    completed: queue.filter(t => ['completed', 'finished'].includes(t.status)).length,
    failed: queue.filter(t => ['failed', 'error'].includes(t.status)).length
  };

  // 2. 根据当前选中的标签，过滤数据
  let filteredQueue = queue;
  if (currentQueueFilter === 'downloading') {
    filteredQueue = queue.filter(t => ['waiting', 'running', 'downloading', 'tagging'].includes(t.status));
  } else if (currentQueueFilter === 'completed') {
    filteredQueue = queue.filter(t => ['completed', 'finished'].includes(t.status));
  } else if (currentQueueFilter === 'failed') {
    filteredQueue = queue.filter(t => ['failed', 'error'].includes(t.status));
  }

  // 最新任务在最上面
  const sortedQueue = [...filteredQueue].reverse();

  // 3. 渲染顶部标签栏
  const tabsHtml = `
    <div class="queue-tabs">
      <span class="q-tab ${currentQueueFilter === 'all' ? 'active' : ''}" data-filter="all">全部 (${counts.all})</span>
      <span class="q-tab ${currentQueueFilter === 'downloading' ? 'active' : ''}" data-filter="downloading">下载中 (${counts.downloading})</span>
      <span class="q-tab ${currentQueueFilter === 'completed' ? 'active' : ''}" data-filter="completed">已完成 (${counts.completed})</span>
      <span class="q-tab ${currentQueueFilter === 'failed' ? 'active' : ''}" data-filter="failed">错误 (${counts.failed})</span>
    </div>
  `;

  // 4. 渲染具体的任务列表
  let listHtml = '';
  if (!sortedQueue.length) {
    listHtml = `<div style="color:var(--text2);padding:20px 0;text-align:center;">该分类下暂无任务</div>`;
  } else {
    const statusText = { waiting: '等待中', running: '解析中', downloading: '下载中', tagging: '写入标签', completed: '已完成', finished: '已完成', failed: '失败' };
    const statusColor = { waiting: 'var(--text2)', running: 'var(--blue)', downloading: 'var(--blue)', tagging: 'var(--yellow)', completed: 'var(--green)', finished: 'var(--green)', failed: 'var(--red)' };

    listHtml = sortedQueue.map((t, i) => {
      const name = t.songInfo?.name || t.name || '未知歌曲';
      const singer = t.songInfo?.singer || t.singer || '';
      const quality = t.quality || t.songInfo?.quality || 'flac';
      
      const status = t.status;
      const isDone = status === 'finished' || status === 'completed';
      const isDownloading = status === 'downloading' || status === 'running' || status === 'tagging';
      const pct = t.progress || 0;
      
      return `
      <div class="task-item" id="queue-item-${t.id}" style="padding: 12px 0;">
        <div class="task-body">
          <div class="task-name" style="font-size:14px; color:var(--text);">${esc(name)}</div>
          <div class="task-meta" style="display:flex; justify-content:space-between; align-items:center; margin-top:4px;">
            <span style="font-size:12px; color:var(--text2);">${esc(singer)} · ${esc(quality)}</span>
            <span id="meta-right-${t.id}" style="font-size:12px; color:var(--text2);">
              ${isDownloading ? `<span style="color:var(--blue);" id="pct-${t.id}">${pct}%</span> <span class="real-speed" id="speed-${t.id}"></span>` : ''}
            </span>
          </div>
          ${(isDownloading || status === 'waiting') ? `
            <div class="task-bar" style="margin-top:8px; width:100%; height:4px; background:var(--bg3); border-radius:2px; overflow:hidden;">
              <div class="task-bar-fill" id="bar-${t.id}" style="width: ${pct}%; height:100%; background:var(--blue); transition:width 0.3s; ${isDownloading && pct===0 ? 'animation: pulse 1.5s infinite;' : ''}"></div>
            </div>
          ` : ''}
        </div>
        <div class="task-status" style="margin-left:15px; display:flex; align-items:center;">
          <span class="task-status-text" style="color:${statusColor[status] || ''}; font-size:13px;">${statusText[status] || status}</span>
        </div>
      </div>`;
    }).join('');
  }

  // 组装并塞入页面
  el.innerHTML = tabsHtml + `<div style="display:flex; flex-direction:column;">${listHtml}</div>`;

  // 5. 绑定标签点击事件
  el.querySelectorAll('.q-tab').forEach(tab => {
    tab.onclick = () => {
      currentQueueFilter = tab.dataset.filter;
      renderQueueUI(queue); // 重新渲染
    };
  });
};

// ==========================================
// 🚀 UI 融合：将“下载历史”移动到上方并合并
// ==========================================
setTimeout(() => {
    const tabDownload = document.getElementById('tab-download');
    if (!tabDownload) return;

    const cards = tabDownload.querySelectorAll('.card');
    if (cards.length >= 2) {
        const taskCard = cards[0];   // 下载任务卡片
        const historyCard = cards[1]; // 下载历史卡片

        // 1. 调整历史卡片的样式，去掉多余的边框和背景，使其完美融入任务卡片
        historyCard.style.background = 'transparent';
        historyCard.style.border = 'none';
        historyCard.style.padding = '0';
        historyCard.style.marginTop = '20px';
        historyCard.style.boxShadow = 'none';
        
        // 2. 把历史卡片的标题栏做得像分类标签
        const titleEl = historyCard.querySelector('.card-title');
        if (titleEl) {
            titleEl.innerHTML = '📁 本地历史文件';
            titleEl.style.color = 'var(--blue)';
            titleEl.style.fontSize = '14px';
            titleEl.style.marginBottom = '10px';
            titleEl.style.borderBottom = '1px dashed var(--border)';
            titleEl.style.paddingBottom = '8px';
        }

        // 3. 把历史卡片塞进任务卡片的内部（放在任务列表下面）
        const taskListContainer = taskCard.querySelector('#downloadTasks');
        if (taskListContainer) {
            // 把历史卡片移动到任务列表的下方
            taskListContainer.parentNode.insertBefore(historyCard, taskListContainer.nextSibling);
            
            // 如果原来的任务卡片有底部 padding，稍微清理一下
            taskCard.style.paddingBottom = '20px';
        }
    }
}, 800); // 延迟执行，确保页面完全加载

// ==========================================
// 🚀 终极换位：将“本地历史文件”提到最上方
// ==========================================
setTimeout(() => {
    const tabDownload = document.getElementById('tab-download');
    if (!tabDownload) return;

    // 抓取页面里的两个大卡片（任务卡片 和 历史卡片）
    const cards = tabDownload.querySelectorAll('.card');
    if (cards.length >= 2) {
        const taskCard = cards[0];   
        const historyCard = cards[1]; 

        // 调整样式，去掉历史卡片多余的边框背景，让它像是一个内嵌模块
        historyCard.style.background = 'transparent';
        historyCard.style.border = 'none';
        historyCard.style.padding = '0';
        historyCard.style.marginTop = '0';
        historyCard.style.marginBottom = '20px';
        historyCard.style.boxShadow = 'none';
        
        // 优化标题栏样式
        const titleEl = historyCard.querySelector('.card-title');
        if (titleEl) {
            titleEl.innerHTML = '📁 本地历史文件';
            titleEl.style.color = 'var(--blue)';
            titleEl.style.fontSize = '14px';
            titleEl.style.marginBottom = '10px';
            titleEl.style.borderBottom = '1px dashed var(--border)';
            titleEl.style.paddingBottom = '8px';
        }

        // 核心动作：把历史卡片，插到任务卡片的最前面！
        tabDownload.insertBefore(historyCard, taskCard);
        
        // 给下方任务卡片加点间距
        taskCard.style.marginTop = '10px';
    }
}, 1000); // 延迟 1 秒，确保页面数据加载完毕再移动

// ==========================================
// 🚀 极简 UI：彻底干掉多余的“本地历史文件”面板
// ==========================================
setTimeout(() => {
    const tabDownload = document.getElementById('tab-download');
    if (!tabDownload) return;

    const cards = tabDownload.querySelectorAll('.card');
    if (cards.length >= 2) {
        // 隐藏第二个大卡片（也就是下载历史）
        cards[1].style.display = 'none';
    }
}, 1000);

// ==========================================
// 🚀 精准切除：找到带有“清空历史”的卡片并隐藏
// ==========================================
setTimeout(() => {
    // 先恢复所有显示（防止之前切错的遗留）
    document.querySelectorAll('#tab-download .card').forEach(c => c.style.display = 'block');

    // 精准定位：找到“清空历史”按钮
    const clearBtn = document.getElementById('clearHistoryBtn');
    if (clearBtn) {
        // 找到它所在的那个大卡片
        const historyCard = clearBtn.closest('.card');
        if (historyCard) {
            // 精准干掉这个卡片！
            historyCard.style.display = 'none';
        }
    }
}, 1000);

// ==========================================
// 🚀 终极任务列表渲染：带文件大小显示
// ==========================================
window.renderQueueUI = function(queue) {
  const el = $('downloadTasks');
  if (!el) return;

  // 1. 统计各类状态的数量
  const counts = {
    all: queue.length,
    downloading: queue.filter(t => ['waiting', 'running', 'downloading', 'tagging'].includes(t.status)).length,
    completed: queue.filter(t => ['completed', 'finished'].includes(t.status)).length,
    failed: queue.filter(t => ['failed', 'error'].includes(t.status)).length
  };

  // 2. 根据当前选中的标签，过滤数据
  let filteredQueue = queue;
  if (currentQueueFilter === 'downloading') {
    filteredQueue = queue.filter(t => ['waiting', 'running', 'downloading', 'tagging'].includes(t.status));
  } else if (currentQueueFilter === 'completed') {
    filteredQueue = queue.filter(t => ['completed', 'finished'].includes(t.status));
  } else if (currentQueueFilter === 'failed') {
    filteredQueue = queue.filter(t => ['failed', 'error'].includes(t.status));
  }

  // 最新任务在最上面
  const sortedQueue = [...filteredQueue].reverse();

  // 3. 渲染顶部标签栏
  const tabsHtml = `
    <div class="queue-tabs">
      <span class="q-tab ${currentQueueFilter === 'all' ? 'active' : ''}" data-filter="all">全部 (${counts.all})</span>
      <span class="q-tab ${currentQueueFilter === 'downloading' ? 'active' : ''}" data-filter="downloading">下载中 (${counts.downloading})</span>
      <span class="q-tab ${currentQueueFilter === 'completed' ? 'active' : ''}" data-filter="completed">已完成 (${counts.completed})</span>
      <span class="q-tab ${currentQueueFilter === 'failed' ? 'active' : ''}" data-filter="failed">错误 (${counts.failed})</span>
    </div>
  `;

  // 4. 渲染具体的任务列表
  let listHtml = '';
  if (!sortedQueue.length) {
    listHtml = `<div style="color:var(--text2);padding:20px 0;text-align:center;">该分类下暂无任务</div>`;
  } else {
    const statusText = { waiting: '等待中', running: '解析中', downloading: '下载中', tagging: '写入标签', completed: '已完成', finished: '已完成', failed: '失败' };
    const statusColor = { waiting: 'var(--text2)', running: 'var(--blue)', downloading: 'var(--blue)', tagging: 'var(--yellow)', completed: 'var(--green)', finished: 'var(--green)', failed: 'var(--red)' };

    listHtml = sortedQueue.map((t, i) => {
      const name = t.songInfo?.name || t.name || '未知歌曲';
      const singer = t.songInfo?.singer || t.singer || '';
      const quality = t.quality || t.songInfo?.quality || 'flac';
      
      // 🚀 核心新增：解析文件大小 (兼容不同字段名)
      let sizeStr = '';
      const byteSize = t.size || t.fileSize || t.songInfo?.size || 0;
      if (byteSize > 0) {
        if (byteSize > 1024 * 1024 * 1024) {
          sizeStr = (byteSize / 1024 / 1024 / 1024).toFixed(2) + 'GB';
        } else {
          sizeStr = (byteSize / 1024 / 1024).toFixed(1) + 'MB';
        }
      }

      const status = t.status;
      const isDone = status === 'finished' || status === 'completed';
      const isDownloading = status === 'downloading' || status === 'running' || status === 'tagging';
      const pct = t.progress || 0;
      
      return `
      <div class="task-item" id="queue-item-${t.id}" style="padding: 12px 0;">
        <div class="task-body">
          <div class="task-name" style="font-size:14px; color:var(--text);">${esc(name)}</div>
          <div class="task-meta" style="display:flex; justify-content:space-between; align-items:center; margin-top:4px;">
            <!-- 🚀 将大小拼接到格式后面 -->
            <span style="font-size:12px; color:var(--text2);">${esc(singer)} · ${esc(quality)} ${sizeStr ? '· ' + sizeStr : ''}</span>
            <span id="meta-right-${t.id}" style="font-size:12px; color:var(--text2);">
              ${isDownloading ? `<span style="color:var(--blue);" id="pct-${t.id}">${pct}%</span> <span class="real-speed" id="speed-${t.id}"></span>` : ''}
            </span>
          </div>
          ${(isDownloading || status === 'waiting') ? `
            <div class="task-bar" style="margin-top:8px; width:100%; height:4px; background:var(--bg3); border-radius:2px; overflow:hidden;">
              <div class="task-bar-fill" id="bar-${t.id}" style="width: ${pct}%; height:100%; background:var(--blue); transition:width 0.3s; ${isDownloading && pct===0 ? 'animation: pulse 1.5s infinite;' : ''}"></div>
            </div>
          ` : ''}
        </div>
        <div class="task-status" style="margin-left:15px; display:flex; align-items:center;">
          <span class="task-status-text" style="color:${statusColor[status] || ''}; font-size:13px;">${statusText[status] || status}</span>
        </div>
      </div>`;
    }).join('');
  }

  // 组装并塞入页面
  el.innerHTML = tabsHtml + `<div style="display:flex; flex-direction:column;">${listHtml}</div>`;

  // 5. 绑定标签点击事件
  el.querySelectorAll('.q-tab').forEach(tab => {
    tab.onclick = () => {
      currentQueueFilter = tab.dataset.filter;
      renderQueueUI(queue); // 重新渲染
    };
  });
};

// 确保历史面板依然被隐藏
setTimeout(() => {
    document.querySelectorAll('#tab-download .card').forEach(c => c.style.display = 'block');
    const clearBtn = document.getElementById('clearHistoryBtn');
    if (clearBtn && clearBtn.closest('.card')) {
        clearBtn.closest('.card').style.display = 'none';
    }
}, 1000);

// ==========================================
// 🚀 终极缝合补丁：强行查出大小并渲染
// ==========================================

// 1. 重写轮询，把文件大小注进去
window.startQueuePolling = async function() {
  clearTimeout(queuePollTimer);
  try {
    // 拉取后台队列
    const queueRes = await api('/api/music/cache/queue');
    if (!queueRes.success) return;
    let queue = queueRes.data || [];

    // 拉取已下载的本地文件列表（里面有真实大小）
    let localFiles = [];
    try {
      const listRes = await api('/api/music/cache/list?user=_open');
      localFiles = listRes.data || listRes || [];
    } catch(e) {}

    // 核心：把大小注入到队列任务里
    queue = queue.map(t => {
        const name = t.songInfo?.name || t.name || '';
        const singer = t.songInfo?.singer || t.singer || '';
        
        // 如果队列本身没有大小，去本地列表里找对应文件
        if (!t.size || t.size === 0) {
            const match = localFiles.find(f => f.name === name && (f.singer === singer || (f.singer && f.singer.includes(singer))));
            if (match) {
                t.size = match.size; // 注入真实字节数
            }
        }
        return t;
    });

    renderQueueUI(queue);

    const activeTasks = queue.filter(t => ['waiting', 'running', 'downloading', 'tagging'].includes(t.status));
    if (activeTasks.length > 0) {
      const ids = activeTasks.map(t => t.id).join(',');
      try {
        const progRes = await api(`/api/music/cache/progress?ids=${ids}`);
        if (progRes.success) {
          updateRealProgress(progRes.data);
        }
      } catch (e) {}
    }

    if (queue.some(t => ['waiting', 'downloading', 'running', 'tagging'].includes(t.status))) {
      queuePollTimer = setTimeout(startQueuePolling, 2000);
    }
  } catch (e) {
    console.error('轮询队列失败', e);
    queuePollTimer = setTimeout(startQueuePolling, 5000);
  }
};

// 2. 重写渲染（确保大小字符串拼接成功）
window.renderQueueUI = function(queue) {
  const el = $('downloadTasks');
  if (!el) return;

  const counts = {
    all: queue.length,
    downloading: queue.filter(t => ['waiting', 'running', 'downloading', 'tagging'].includes(t.status)).length,
    completed: queue.filter(t => ['completed', 'finished'].includes(t.status)).length,
    failed: queue.filter(t => ['failed', 'error'].includes(t.status)).length
  };

  let filteredQueue = queue;
  if (currentQueueFilter === 'downloading') {
    filteredQueue = queue.filter(t => ['waiting', 'running', 'downloading', 'tagging'].includes(t.status));
  } else if (currentQueueFilter === 'completed') {
    filteredQueue = queue.filter(t => ['completed', 'finished'].includes(t.status));
  } else if (currentQueueFilter === 'failed') {
    filteredQueue = queue.filter(t => ['failed', 'error'].includes(t.status));
  }

  const sortedQueue = [...filteredQueue].reverse();

  const tabsHtml = `
    <div class="queue-tabs">
      <span class="q-tab ${currentQueueFilter === 'all' ? 'active' : ''}" data-filter="all">全部 (${counts.all})</span>
      <span class="q-tab ${currentQueueFilter === 'downloading' ? 'active' : ''}" data-filter="downloading">下载中 (${counts.downloading})</span>
      <span class="q-tab ${currentQueueFilter === 'completed' ? 'active' : ''}" data-filter="completed">已完成 (${counts.completed})</span>
      <span class="q-tab ${currentQueueFilter === 'failed' ? 'active' : ''}" data-filter="failed">错误 (${counts.failed})</span>
    </div>
  `;

  let listHtml = '';
  if (!sortedQueue.length) {
    listHtml = `<div style="color:var(--text2);padding:20px 0;text-align:center;">该分类下暂无任务</div>`;
  } else {
    const statusText = { waiting: '等待中', running: '解析中', downloading: '下载中', tagging: '写入标签', completed: '已完成', finished: '已完成', failed: '失败' };
    const statusColor = { waiting: 'var(--text2)', running: 'var(--blue)', downloading: 'var(--blue)', tagging: 'var(--yellow)', completed: 'var(--green)', finished: 'var(--green)', failed: 'var(--red)' };

    listHtml = sortedQueue.map((t, i) => {
      const name = t.songInfo?.name || t.name || '未知歌曲';
      const singer = t.songInfo?.singer || t.singer || '';
      const quality = t.quality || t.songInfo?.quality || 'flac';
      
      // 🚀 格式化大小
      let sizeStr = '';
      const byteSize = Number(t.size) || 0;
      if (byteSize > 1024 * 1024 * 1024) {
        sizeStr = (byteSize / 1024 / 1024 / 1024).toFixed(2) + 'GB';
      } else if (byteSize > 1024 * 1024) {
        sizeStr = (byteSize / 1024 / 1024).toFixed(1) + 'MB';
      } else if (byteSize > 0) {
        sizeStr = (byteSize / 1024).toFixed(0) + 'KB';
      }

      const status = t.status;
      const isDownloading = status === 'downloading' || status === 'running' || status === 'tagging';
      const pct = t.progress || 0;
      
      return `
      <div class="task-item" id="queue-item-${t.id}" style="padding: 12px 0;">
        <div class="task-body">
          <div class="task-name" style="font-size:14px; color:var(--text);">${esc(name)}</div>
          <div class="task-meta" style="display:flex; justify-content:space-between; align-items:center; margin-top:4px;">
            <span style="font-size:12px; color:var(--text2);">${esc(singer)} · ${esc(quality)} ${sizeStr ? '· <span style="color:var(--green)">' + sizeStr + '</span>' : ''}</span>
            <span id="meta-right-${t.id}" style="font-size:12px; color:var(--text2);">
              ${isDownloading ? `<span style="color:var(--blue);" id="pct-${t.id}">${pct}%</span> <span class="real-speed" id="speed-${t.id}"></span>` : ''}
            </span>
          </div>
          ${(isDownloading || status === 'waiting') ? `
            <div class="task-bar" style="margin-top:8px; width:100%; height:4px; background:var(--bg3); border-radius:2px; overflow:hidden;">
              <div class="task-bar-fill" id="bar-${t.id}" style="width: ${pct}%; height:100%; background:var(--blue); transition:width 0.3s; ${isDownloading && pct===0 ? 'animation: pulse 1.5s infinite;' : ''}"></div>
            </div>
          ` : ''}
        </div>
        <div class="task-status" style="margin-left:15px; display:flex; align-items:center;">
          <span class="task-status-text" style="color:${statusColor[status] || ''}; font-size:13px;">${statusText[status] || status}</span>
        </div>
      </div>`;
    }).join('');
  }

  el.innerHTML = tabsHtml + `<div style="display:flex; flex-direction:column;">${listHtml}</div>`;

  el.querySelectorAll('.q-tab').forEach(tab => {
    tab.onclick = () => {
      currentQueueFilter = tab.dataset.filter;
      renderQueueUI(queue); 
    };
  });
};

// ==========================================
// 🚀 终极增强：给队列增加本地播放按键
// ==========================================

// 1. 拦截原有获取链接逻辑，直接返回本地播放地址
const _originalGetBestPlayUrl = window.getBestPlayUrl;
window.getBestPlayUrl = async function(song, quality) {
  if (song.source === 'local' && song.filename) {
    return { 
      url: `/api/music/cache/file/_open/${encodeURIComponent(song.filename)}`, 
      song: song, 
      source: 'local', 
      sourceName: '本地', 
      switched: false 
    };
  }
  return _originalGetBestPlayUrl ? _originalGetBestPlayUrl.call(this, song, quality) : Promise.reject('获取下载链接失败');
};

// 2. 在轮询队列时，把本地文件信息注入进去
window.startQueuePolling = async function() {
  clearTimeout(queuePollTimer);
  try {
    const queueRes = await api('/api/music/cache/queue');
    if (!queueRes.success) return;
    let queue = queueRes.data || [];

    let localFiles = [];
    try {
      const listRes = await api('/api/music/cache/list?user=_open');
      localFiles = listRes.data || listRes || [];
    } catch(e) {}

    queue = queue.map(t => {
        const name = t.songInfo?.name || t.name || '';
        const singer = t.songInfo?.singer || t.singer || '';
        
        if (!t.size || t.size === 0 || !t.filename) {
            const match = localFiles.find(f => f.name === name && (f.singer === singer || (f.singer && f.singer.includes(singer))));
            if (match) {
                t.size = match.size;
                t.filename = match.filename;
                t.local_mtime = match.mtime;
                
                if (!t.songInfo) t.songInfo = {};
                t.songInfo.filename = match.filename;
                t.songInfo.source = 'local'; // 强制标记为本地
                t.songInfo.songmid = match.songmid || 'local_' + match.filename;
                t.songInfo.name = match.name;
                t.songInfo.singer = match.singer;
                t.songInfo.img = match.img || ''; 
            }
        }
        return t;
    });

    window._lastQueueData = queue; 
    renderQueueUI(queue);

    const activeTasks = queue.filter(t => ['waiting', 'running', 'downloading', 'tagging'].includes(t.status));
    if (activeTasks.length > 0) {
      const ids = activeTasks.map(t => t.id).join(',');
      try {
        const progRes = await api(`/api/music/cache/progress?ids=${ids}`);
        if (progRes.success) {
          updateRealProgress(progRes.data);
        }
      } catch (e) {}
    }

    if (queue.some(t => ['waiting', 'downloading', 'running', 'tagging'].includes(t.status))) {
      queuePollTimer = setTimeout(startQueuePolling, 2000);
    }
  } catch (e) {
    console.error('轮询队列失败', e);
    queuePollTimer = setTimeout(startQueuePolling, 5000);
  }
};

// 3. 重写渲染，增加 ▶ 播放按钮
window.renderQueueUI = function(queue) {
  const el = $('downloadTasks');
  if (!el) return;

  const counts = {
    all: queue.length,
    downloading: queue.filter(t => ['waiting', 'running', 'downloading', 'tagging'].includes(t.status)).length,
    completed: queue.filter(t => ['completed', 'finished'].includes(t.status)).length,
    failed: queue.filter(t => ['failed', 'error'].includes(t.status)).length
  };

  let filteredQueue = queue;
  if (currentQueueFilter === 'downloading') {
    filteredQueue = queue.filter(t => ['waiting', 'running', 'downloading', 'tagging'].includes(t.status));
  } else if (currentQueueFilter === 'completed') {
    filteredQueue = queue.filter(t => ['completed', 'finished'].includes(t.status));
  } else if (currentQueueFilter === 'failed') {
    filteredQueue = queue.filter(t => ['failed', 'error'].includes(t.status));
  }

  const sortedQueue = [...filteredQueue].reverse();

  const tabsHtml = `
    <div class="queue-tabs">
      <span class="q-tab ${currentQueueFilter === 'all' ? 'active' : ''}" data-filter="all">全部 (${counts.all})</span>
      <span class="q-tab ${currentQueueFilter === 'downloading' ? 'active' : ''}" data-filter="downloading">下载中 (${counts.downloading})</span>
      <span class="q-tab ${currentQueueFilter === 'completed' ? 'active' : ''}" data-filter="completed">已完成 (${counts.completed})</span>
      <span class="q-tab ${currentQueueFilter === 'failed' ? 'active' : ''}" data-filter="failed">错误 (${counts.failed})</span>
    </div>
  `;

  let listHtml = '';
  if (!sortedQueue.length) {
    listHtml = `<div style="color:var(--text2);padding:20px 0;text-align:center;">该分类下暂无任务</div>`;
  } else {
    const statusText = { waiting: '等待中', running: '解析中', downloading: '下载中', tagging: '写入标签', completed: '已完成', finished: '已完成', failed: '失败' };
    const statusColor = { waiting: 'var(--text2)', running: 'var(--blue)', downloading: 'var(--blue)', tagging: 'var(--yellow)', completed: 'var(--green)', finished: 'var(--green)', failed: 'var(--red)' };

    listHtml = sortedQueue.map((t, i) => {
      const name = t.songInfo?.name || t.name || '未知歌曲';
      const singer = t.songInfo?.singer || t.singer || '';
      const quality = t.quality || t.songInfo?.quality || 'flac';
      
      let sizeStr = '';
      const byteSize = Number(t.size) || 0;
      if (byteSize > 1024 * 1024 * 1024) sizeStr = (byteSize / 1024 / 1024 / 1024).toFixed(2) + 'GB';
      else if (byteSize > 1024 * 1024) sizeStr = (byteSize / 1024 / 1024).toFixed(1) + 'MB';
      else if (byteSize > 0) sizeStr = (byteSize / 1024).toFixed(0) + 'KB';

      const status = t.status;
      const isDone = status === 'finished' || status === 'completed';
      const isDownloading = status === 'downloading' || status === 'running' || status === 'tagging';
      const pct = t.progress || 0;
      
      // 核心：增加播放按钮
      let playBtnHtml = '';
      if (isDone && t.filename) {
          playBtnHtml = `<button onclick="event.stopPropagation(); window.playQueueSong('${t.id}')" style="padding:4px 10px; margin-left:10px; border-radius:4px; background:color-mix(in srgb, var(--blue) 20%, transparent); color:var(--blue); border:1px solid var(--blue); font-size:12px; cursor:pointer; display:flex; align-items:center; justify-content:center;">▶</button>`;
      }
      
      return `
      <div class="task-item" id="queue-item-${t.id}" style="padding: 12px 0;">
        <div class="task-body">
          <div class="task-name" style="font-size:14px; color:var(--text);">${esc(name)}</div>
          <div class="task-meta" style="display:flex; justify-content:space-between; align-items:center; margin-top:4px;">
            <span style="font-size:12px; color:var(--text2);">${esc(singer)} · ${esc(quality)} ${sizeStr ? '· <span style="color:var(--green)">' + sizeStr + '</span>' : ''}</span>
            <span id="meta-right-${t.id}" style="font-size:12px; color:var(--text2);">
              ${isDownloading ? `<span style="color:var(--blue);" id="pct-${t.id}">${pct}%</span> <span class="real-speed" id="speed-${t.id}"></span>` : ''}
            </span>
          </div>
          ${(isDownloading || status === 'waiting') ? `
            <div class="task-bar" style="margin-top:8px; width:100%; height:4px; background:var(--bg3); border-radius:2px; overflow:hidden;">
              <div class="task-bar-fill" id="bar-${t.id}" style="width: ${pct}%; height:100%; background:var(--blue); transition:width 0.3s; ${isDownloading && pct===0 ? 'animation: pulse 1.5s infinite;' : ''}"></div>
            </div>
          ` : ''}
        </div>
        <div class="task-status" style="margin-left:15px; display:flex; align-items:center;">
          <span class="task-status-text" style="color:${statusColor[status] || ''}; font-size:13px; margin-right:8px;">${statusText[status] || status}</span>
          ${playBtnHtml}
        </div>
      </div>`;
    }).join('');
  }

  el.innerHTML = tabsHtml + `<div style="display:flex; flex-direction:column;">${listHtml}</div>`;

  el.querySelectorAll('.q-tab').forEach(tab => {
    tab.onclick = () => {
      currentQueueFilter = tab.dataset.filter;
      renderQueueUI(queue); 
    };
  });
};

// 4. 播放本地队列任务
window.playQueueSong = function(id) {
    if (!window._lastQueueData) return;
    const task = window._lastQueueData.find(t => t.id === id);
    if (task && task.songInfo && task.filename) {
        const songToPlay = {
            ...task.songInfo,
            source: 'local',
            filename: task.filename
        };
        currentSongList = [songToPlay];
        currentSongIdx = 0;
        if (typeof playSong === 'function') {
            playSong(songToPlay, [songToPlay]);
        }
    } else {
        alert('无法播放：找不到本地文件，或任务尚未完成');
    }
};

// ==========================================
// 🚀 终极视觉打磨：统一按钮与文字样式
// ==========================================
window.renderQueueUI = function(queue) {
  const el = $('downloadTasks');
  if (!el) return;

  const counts = {
    all: queue.length,
    downloading: queue.filter(t => ['waiting', 'running', 'downloading', 'tagging'].includes(t.status)).length,
    completed: queue.filter(t => ['completed', 'finished'].includes(t.status)).length,
    failed: queue.filter(t => ['failed', 'error'].includes(t.status)).length
  };

  let filteredQueue = queue;
  if (currentQueueFilter === 'downloading') {
    filteredQueue = queue.filter(t => ['waiting', 'running', 'downloading', 'tagging'].includes(t.status));
  } else if (currentQueueFilter === 'completed') {
    filteredQueue = queue.filter(t => ['completed', 'finished'].includes(t.status));
  } else if (currentQueueFilter === 'failed') {
    filteredQueue = queue.filter(t => ['failed', 'error'].includes(t.status));
  }

  const sortedQueue = [...filteredQueue].reverse();

  const tabsHtml = `
    <div class="queue-tabs">
      <span class="q-tab ${currentQueueFilter === 'all' ? 'active' : ''}" data-filter="all">全部 (${counts.all})</span>
      <span class="q-tab ${currentQueueFilter === 'downloading' ? 'active' : ''}" data-filter="downloading">下载中 (${counts.downloading})</span>
      <span class="q-tab ${currentQueueFilter === 'completed' ? 'active' : ''}" data-filter="completed">已完成 (${counts.completed})</span>
      <span class="q-tab ${currentQueueFilter === 'failed' ? 'active' : ''}" data-filter="failed">错误 (${counts.failed})</span>
    </div>
  `;

  let listHtml = '';
  if (!sortedQueue.length) {
    listHtml = `<div style="color:var(--text2);padding:20px 0;text-align:center;">该分类下暂无任务</div>`;
  } else {
    const statusText = { waiting: '等待中', running: '解析中', downloading: '下载中', tagging: '写入标签', completed: '已完成', finished: '已完成', failed: '失败' };
    const statusColor = { waiting: 'var(--text2)', running: 'var(--blue)', downloading: 'var(--blue)', tagging: 'var(--yellow)', completed: 'var(--green)', finished: 'var(--green)', failed: 'var(--red)' };

    listHtml = sortedQueue.map((t, i) => {
      const name = t.songInfo?.name || t.name || '未知歌曲';
      const singer = t.songInfo?.singer || t.singer || '';
      const quality = t.quality || t.songInfo?.quality || 'flac';
      
      let sizeStr = '';
      const byteSize = Number(t.size) || 0;
      if (byteSize > 1024 * 1024 * 1024) sizeStr = (byteSize / 1024 / 1024 / 1024).toFixed(2) + 'GB';
      else if (byteSize > 1024 * 1024) sizeStr = (byteSize / 1024 / 1024).toFixed(1) + 'MB';
      else if (byteSize > 0) sizeStr = (byteSize / 1024).toFixed(0) + 'KB';

      // 文件大小与格式颜色、字号完全统一
      const metaStr = `${esc(singer)} · ${esc(quality)} ${sizeStr ? '· ' + sizeStr : ''}`;
      
      const status = t.status;
      const isDone = status === 'finished' || status === 'completed';
      const isDownloading = status === 'downloading' || status === 'running' || status === 'tagging';
      const pct = t.progress || 0;
      
      // 直接使用原生的 song-play-btn 类，保证与排行榜样式绝对一致
      let playBtnHtml = '';
      if (isDone && t.filename) {
          playBtnHtml = `<button class="song-play-btn" style="margin-left: 8px;" onclick="event.stopPropagation(); window.playQueueSong('${t.id}')">▶</button>`;
      }
      
      return `
      <div class="task-item" id="queue-item-${t.id}" style="padding: 12px 0;">
        <div class="task-body">
          <div class="task-name" style="font-size:14px; color:var(--text);">${esc(name)}</div>
          <div class="task-meta" style="display:flex; justify-content:space-between; align-items:center; margin-top:4px;">
            <span style="font-size:12px; color:var(--text2);">${metaStr}</span>
            <span id="meta-right-${t.id}" style="font-size:12px; color:var(--text2);">
              ${isDownloading ? `<span style="color:var(--blue);" id="pct-${t.id}">${pct}%</span> <span class="real-speed" id="speed-${t.id}"></span>` : ''}
            </span>
          </div>
          ${(isDownloading || status === 'waiting') ? `
            <div class="task-bar" style="margin-top:8px; width:100%; height:4px; background:var(--bg3); border-radius:2px; overflow:hidden;">
              <div class="task-bar-fill" id="bar-${t.id}" style="width: ${pct}%; height:100%; background:var(--blue); transition:width 0.3s; ${isDownloading && pct===0 ? 'animation: pulse 1.5s infinite;' : ''}"></div>
            </div>
          ` : ''}
        </div>
        <!-- 将状态文字和播放按钮放在一起，靠右对齐 -->
        <div class="task-status" style="margin-left:15px; display:flex; align-items:center; justify-content:flex-end; min-width: 80px;">
          <span class="task-status-text" style="color:${statusColor[status] || ''}; font-size:13px;">${statusText[status] || status}</span>
          ${playBtnHtml}
        </div>
      </div>`;
    }).join('');
  }

  el.innerHTML = tabsHtml + `<div style="display:flex; flex-direction:column;">${listHtml}</div>`;

  el.querySelectorAll('.q-tab').forEach(tab => {
    tab.onclick = () => {
      currentQueueFilter = tab.dataset.filter;
      renderQueueUI(queue); 
    };
  });
};

// ==========================================
// 🚀 终极排版修复：播放按钮与状态同行且靠右
// ==========================================
window.renderQueueUI = function(queue) {
  const el = $('downloadTasks');
  if (!el) return;

  const counts = {
    all: queue.length,
    downloading: queue.filter(t => ['waiting', 'running', 'downloading', 'tagging'].includes(t.status)).length,
    completed: queue.filter(t => ['completed', 'finished'].includes(t.status)).length,
    failed: queue.filter(t => ['failed', 'error'].includes(t.status)).length
  };

  let filteredQueue = queue;
  if (currentQueueFilter === 'downloading') {
    filteredQueue = queue.filter(t => ['waiting', 'running', 'downloading', 'tagging'].includes(t.status));
  } else if (currentQueueFilter === 'completed') {
    filteredQueue = queue.filter(t => ['completed', 'finished'].includes(t.status));
  } else if (currentQueueFilter === 'failed') {
    filteredQueue = queue.filter(t => ['failed', 'error'].includes(t.status));
  }

  const sortedQueue = [...filteredQueue].reverse();

  const tabsHtml = `
    <div class="queue-tabs">
      <span class="q-tab ${currentQueueFilter === 'all' ? 'active' : ''}" data-filter="all">全部 (${counts.all})</span>
      <span class="q-tab ${currentQueueFilter === 'downloading' ? 'active' : ''}" data-filter="downloading">下载中 (${counts.downloading})</span>
      <span class="q-tab ${currentQueueFilter === 'completed' ? 'active' : ''}" data-filter="completed">已完成 (${counts.completed})</span>
      <span class="q-tab ${currentQueueFilter === 'failed' ? 'active' : ''}" data-filter="failed">错误 (${counts.failed})</span>
    </div>
  `;

  let listHtml = '';
  if (!sortedQueue.length) {
    listHtml = `<div style="color:var(--text2);padding:20px 0;text-align:center;">该分类下暂无任务</div>`;
  } else {
    const statusText = { waiting: '等待中', running: '解析中', downloading: '下载中', tagging: '写入标签', completed: '已完成', finished: '已完成', failed: '失败' };
    const statusColor = { waiting: 'var(--text2)', running: 'var(--blue)', downloading: 'var(--blue)', tagging: 'var(--yellow)', completed: 'var(--green)', finished: 'var(--green)', failed: 'var(--red)' };

    listHtml = sortedQueue.map((t, i) => {
      const name = t.songInfo?.name || t.name || '未知歌曲';
      const singer = t.songInfo?.singer || t.singer || '';
      const quality = t.quality || t.songInfo?.quality || 'flac';
      
      let sizeStr = '';
      const byteSize = Number(t.size) || 0;
      if (byteSize > 1024 * 1024 * 1024) sizeStr = (byteSize / 1024 / 1024 / 1024).toFixed(2) + 'GB';
      else if (byteSize > 1024 * 1024) sizeStr = (byteSize / 1024 / 1024).toFixed(1) + 'MB';
      else if (byteSize > 0) sizeStr = (byteSize / 1024).toFixed(0) + 'KB';

      const metaStr = `${esc(singer)} · ${esc(quality)} ${sizeStr ? '· ' + sizeStr : ''}`;
      
      const status = t.status;
      const isDone = status === 'finished' || status === 'completed';
      const isDownloading = status === 'downloading' || status === 'running' || status === 'tagging';
      const pct = t.progress || 0;
      
      let playBtnHtml = '';
      if (isDone && t.filename) {
          playBtnHtml = `<button class="song-play-btn" style="margin-left: 6px; padding: 0 4px; font-size: 14px;" onclick="event.stopPropagation(); window.playQueueSong('${t.id}')">▶</button>`;
      }
      
      return `
      <div class="task-item" id="queue-item-${t.id}" style="padding: 12px 0; display: flex; align-items: center; justify-content: space-between;">
        
        <!-- 左侧内容：歌名、信息、进度条 -->
        <div class="task-body" style="flex: 1; min-width: 0; margin-right: 10px;">
          <div class="task-name" style="font-size:14px; color:var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${esc(name)}</div>
          <div class="task-meta" style="display:flex; justify-content:space-between; align-items:center; margin-top:4px;">
            <span style="font-size:12px; color:var(--text2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${metaStr}</span>
            <span id="meta-right-${t.id}" style="font-size:12px; color:var(--text2); flex-shrink: 0;">
              ${isDownloading ? `<span style="color:var(--blue);" id="pct-${t.id}">${pct}%</span> <span class="real-speed" id="speed-${t.id}"></span>` : ''}
            </span>
          </div>
          ${(isDownloading || status === 'waiting') ? `
            <div class="task-bar" style="margin-top:8px; width:100%; height:4px; background:var(--bg3); border-radius:2px; overflow:hidden;">
              <div class="task-bar-fill" id="bar-${t.id}" style="width: ${pct}%; height:100%; background:var(--blue); transition:width 0.3s; ${isDownloading && pct===0 ? 'animation: pulse 1.5s infinite;' : ''}"></div>
            </div>
          ` : ''}
        </div>

        <!-- 右侧内容：状态文字 + 播放按钮 (强制同行，禁止折行) -->
        <div class="task-status" style="display:flex; flex-wrap: nowrap; align-items:center; justify-content:flex-end; flex-shrink: 0;">
          <span class="task-status-text" style="color:${statusColor[status] || ''}; font-size:13px; white-space: nowrap;">${statusText[status] || status}</span>
          ${playBtnHtml}
        </div>

      </div>`;
    }).join('');
  }

  el.innerHTML = tabsHtml + `<div style="display:flex; flex-direction:column;">${listHtml}</div>`;

  el.querySelectorAll('.q-tab').forEach(tab => {
    tab.onclick = () => {
      currentQueueFilter = tab.dataset.filter;
      renderQueueUI(queue); 
    };
  });
};

// ==========================================
// 🚀 强制同行修复：终结手机端上下折行
// ==========================================
window.renderQueueUI = function(queue) {
  const el = $('downloadTasks');
  if (!el) return;

  const counts = {
    all: queue.length,
    downloading: queue.filter(t => ['waiting', 'running', 'downloading', 'tagging'].includes(t.status)).length,
    completed: queue.filter(t => ['completed', 'finished'].includes(t.status)).length,
    failed: queue.filter(t => ['failed', 'error'].includes(t.status)).length
  };

  let filteredQueue = queue;
  if (currentQueueFilter === 'downloading') {
    filteredQueue = queue.filter(t => ['waiting', 'running', 'downloading', 'tagging'].includes(t.status));
  } else if (currentQueueFilter === 'completed') {
    filteredQueue = queue.filter(t => ['completed', 'finished'].includes(t.status));
  } else if (currentQueueFilter === 'failed') {
    filteredQueue = queue.filter(t => ['failed', 'error'].includes(t.status));
  }

  const sortedQueue = [...filteredQueue].reverse();

  const tabsHtml = `
    <div class="queue-tabs">
      <span class="q-tab ${currentQueueFilter === 'all' ? 'active' : ''}" data-filter="all">全部 (${counts.all})</span>
      <span class="q-tab ${currentQueueFilter === 'downloading' ? 'active' : ''}" data-filter="downloading">下载中 (${counts.downloading})</span>
      <span class="q-tab ${currentQueueFilter === 'completed' ? 'active' : ''}" data-filter="completed">已完成 (${counts.completed})</span>
      <span class="q-tab ${currentQueueFilter === 'failed' ? 'active' : ''}" data-filter="failed">错误 (${counts.failed})</span>
    </div>
  `;

  let listHtml = '';
  if (!sortedQueue.length) {
    listHtml = `<div style="color:var(--text2);padding:20px 0;text-align:center;">该分类下暂无任务</div>`;
  } else {
    const statusText = { waiting: '等待中', running: '解析中', downloading: '下载中', tagging: '写入标签', completed: '已完成', finished: '已完成', failed: '失败' };
    const statusColor = { waiting: 'var(--text2)', running: 'var(--blue)', downloading: 'var(--blue)', tagging: 'var(--yellow)', completed: 'var(--green)', finished: 'var(--green)', failed: 'var(--red)' };

    listHtml = sortedQueue.map((t, i) => {
      const name = t.songInfo?.name || t.name || '未知歌曲';
      const singer = t.songInfo?.singer || t.singer || '';
      const quality = t.quality || t.songInfo?.quality || 'flac';
      
      let sizeStr = '';
      const byteSize = Number(t.size) || 0;
      if (byteSize > 1024 * 1024 * 1024) sizeStr = (byteSize / 1024 / 1024 / 1024).toFixed(2) + 'GB';
      else if (byteSize > 1024 * 1024) sizeStr = (byteSize / 1024 / 1024).toFixed(1) + 'MB';
      else if (byteSize > 0) sizeStr = (byteSize / 1024).toFixed(0) + 'KB';

      const metaStr = `${esc(singer)} · ${esc(quality)} ${sizeStr ? '· ' + sizeStr : ''}`;
      
      const status = t.status;
      const isDone = status === 'finished' || status === 'completed';
      const isDownloading = status === 'downloading' || status === 'running' || status === 'tagging';
      const pct = t.progress || 0;
      
      let playBtnHtml = '';
      if (isDone && t.filename) {
          // 去掉原生按钮自带的 margin 干扰，保证紧凑
          playBtnHtml = `<button class="song-play-btn" style="margin: 0 !important; padding: 4px !important;" onclick="event.stopPropagation(); window.playQueueSong('${t.id}')">▶</button>`;
      }
      
      return `
      <div class="task-item" id="queue-item-${t.id}" style="padding: 12px 0; display: flex; align-items: center; justify-content: space-between;">
        
        <!-- 左侧内容：歌名、信息、进度条 -->
        <div class="task-body" style="flex: 1; min-width: 0; margin-right: 10px;">
          <div class="task-name" style="font-size:14px; color:var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${esc(name)}</div>
          <div class="task-meta" style="display:flex; justify-content:space-between; align-items:center; margin-top:4px;">
            <span style="font-size:12px; color:var(--text2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${metaStr}</span>
            <span id="meta-right-${t.id}" style="font-size:12px; color:var(--text2); flex-shrink: 0;">
              ${isDownloading ? `<span style="color:var(--blue);" id="pct-${t.id}">${pct}%</span> <span class="real-speed" id="speed-${t.id}"></span>` : ''}
            </span>
          </div>
          ${(isDownloading || status === 'waiting') ? `
            <div class="task-bar" style="margin-top:8px; width:100%; height:4px; background:var(--bg3); border-radius:2px; overflow:hidden;">
              <div class="task-bar-fill" id="bar-${t.id}" style="width: ${pct}%; height:100%; background:var(--blue); transition:width 0.3s; ${isDownloading && pct===0 ? 'animation: pulse 1.5s infinite;' : ''}"></div>
            </div>
          ` : ''}
        </div>

        <!-- 右侧内容：强制在一行，文字在左，按钮在右 -->
        <div class="task-status" style="display:flex !important; flex-direction: row !important; flex-wrap: nowrap !important; align-items:center !important; justify-content:flex-end !important; flex-shrink: 0; gap: 6px;">
          <span class="task-status-text" style="color:${statusColor[status] || ''}; font-size:13px; white-space: nowrap; margin: 0 !important;">${statusText[status] || status}</span>
          ${playBtnHtml}
        </div>

      </div>`;
    }).join('');
  }

  el.innerHTML = tabsHtml + `<div style="display:flex; flex-direction:column;">${listHtml}</div>`;

  el.querySelectorAll('.q-tab').forEach(tab => {
    tab.onclick = () => {
      currentQueueFilter = tab.dataset.filter;
      renderQueueUI(queue); 
    };
  });
};

// ==========================================
// 🚀 终极增强：下载管理多选与专属工具栏
// ==========================================

// 1. 重写渲染，加入选择框
window.renderQueueUI = function(queue) {
  const el = $('downloadTasks');
  if (!el) return;

  const counts = {
    all: queue.length,
    downloading: queue.filter(t => ['waiting', 'running', 'downloading', 'tagging'].includes(t.status)).length,
    completed: queue.filter(t => ['completed', 'finished'].includes(t.status)).length,
    failed: queue.filter(t => ['failed', 'error'].includes(t.status)).length
  };

  let filteredQueue = queue;
  if (currentQueueFilter === 'downloading') {
    filteredQueue = queue.filter(t => ['waiting', 'running', 'downloading', 'tagging'].includes(t.status));
  } else if (currentQueueFilter === 'completed') {
    filteredQueue = queue.filter(t => ['completed', 'finished'].includes(t.status));
  } else if (currentQueueFilter === 'failed') {
    filteredQueue = queue.filter(t => ['failed', 'error'].includes(t.status));
  }

  const sortedQueue = [...filteredQueue].reverse();

  const tabsHtml = `
    <div class="queue-tabs">
      <span class="q-tab ${currentQueueFilter === 'all' ? 'active' : ''}" data-filter="all">全部 (${counts.all})</span>
      <span class="q-tab ${currentQueueFilter === 'downloading' ? 'active' : ''}" data-filter="downloading">下载中 (${counts.downloading})</span>
      <span class="q-tab ${currentQueueFilter === 'completed' ? 'active' : ''}" data-filter="completed">已完成 (${counts.completed})</span>
      <span class="q-tab ${currentQueueFilter === 'failed' ? 'active' : ''}" data-filter="failed">错误 (${counts.failed})</span>
    </div>
  `;

  let listHtml = '';
  if (!sortedQueue.length) {
    listHtml = `<div style="color:var(--text2);padding:20px 0;text-align:center;">该分类下暂无任务</div>`;
  } else {
    const statusText = { waiting: '等待中', running: '解析中', downloading: '下载中', tagging: '写入标签', completed: '已完成', finished: '已完成', failed: '失败' };
    const statusColor = { waiting: 'var(--text2)', running: 'var(--blue)', downloading: 'var(--blue)', tagging: 'var(--yellow)', completed: 'var(--green)', finished: 'var(--green)', failed: 'var(--red)' };

    listHtml = sortedQueue.map((t, i) => {
      const name = t.songInfo?.name || t.name || '未知歌曲';
      const singer = t.songInfo?.singer || t.singer || '';
      const quality = t.quality || t.songInfo?.quality || 'flac';
      
      let sizeStr = '';
      const byteSize = Number(t.size) || 0;
      if (byteSize > 1024 * 1024 * 1024) sizeStr = (byteSize / 1024 / 1024 / 1024).toFixed(2) + 'GB';
      else if (byteSize > 1024 * 1024) sizeStr = (byteSize / 1024 / 1024).toFixed(1) + 'MB';
      else if (byteSize > 0) sizeStr = (byteSize / 1024).toFixed(0) + 'KB';

      const metaStr = `${esc(singer)} · ${esc(quality)} ${sizeStr ? '· ' + sizeStr : ''}`;
      
      const status = t.status;
      const isDone = status === 'finished' || status === 'completed';
      const isDownloading = status === 'downloading' || status === 'running' || status === 'tagging';
      const pct = t.progress || 0;
      
      let playBtnHtml = '';
      if (isDone && t.filename) {
          playBtnHtml = `<button class="song-play-btn" style="margin: 0 !important; padding: 4px !important;" onclick="event.stopPropagation(); window.playQueueSong('${t.id}')">▶</button>`;
      }
      
      return `
      <div class="task-item" id="queue-item-${t.id}" style="padding: 12px 0; display: flex; align-items: center; justify-content: space-between;">
        
        <!-- 🚀 新增：复选框 -->
        <input type="checkbox" class="song-check queue-check" data-id="${t.id}" style="margin-right: 12px; flex-shrink: 0;" onchange="updateToolbarVisibility()">

        <div class="task-body" style="flex: 1; min-width: 0; margin-right: 10px;">
          <div class="task-name" style="font-size:14px; color:var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${esc(name)}</div>
          <div class="task-meta" style="display:flex; justify-content:space-between; align-items:center; margin-top:4px;">
            <span style="font-size:12px; color:var(--text2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${metaStr}</span>
            <span id="meta-right-${t.id}" style="font-size:12px; color:var(--text2); flex-shrink: 0;">
              ${isDownloading ? `<span style="color:var(--blue);" id="pct-${t.id}">${pct}%</span> <span class="real-speed" id="speed-${t.id}"></span>` : ''}
            </span>
          </div>
          ${(isDownloading || status === 'waiting') ? `
            <div class="task-bar" style="margin-top:8px; width:100%; height:4px; background:var(--bg3); border-radius:2px; overflow:hidden;">
              <div class="task-bar-fill" id="bar-${t.id}" style="width: ${pct}%; height:100%; background:var(--blue); transition:width 0.3s; ${isDownloading && pct===0 ? 'animation: pulse 1.5s infinite;' : ''}"></div>
            </div>
          ` : ''}
        </div>

        <div class="task-status" style="display:flex !important; flex-direction: row !important; flex-wrap: nowrap !important; align-items:center !important; justify-content:flex-end !important; flex-shrink: 0; gap: 6px;">
          <span class="task-status-text" style="color:${statusColor[status] || ''}; font-size:13px; white-space: nowrap; margin: 0 !important;">${statusText[status] || status}</span>
          ${playBtnHtml}
        </div>

      </div>`;
    }).join('');
  }

  el.innerHTML = tabsHtml + `<div style="display:flex; flex-direction:column;">${listHtml}</div>`;

  el.querySelectorAll('.q-tab').forEach(tab => {
    tab.onclick = () => {
      currentQueueFilter = tab.dataset.filter;
      renderQueueUI(queue); 
    };
  });
};

// 2. 让工具栏在下载页也能弹出来
window.updateToolbarVisibility = function() {
  const tb = $('globalToolbar');
  if (!tb) return;
  const activePanel = document.querySelector('.tab-panel.active');
  if (!activePanel) { tb.classList.remove('show'); return; }
  
  const activeId = activePanel.id;
  // 支持搜索、排行榜、歌单详情、下载管理
  const showContext = activeId === 'tab-search' || activeId === 'tab-rank' || activeId === 'tab-download' || 
    (activeId === 'tab-playlist' && !$('playlistDetailView').classList.contains('hidden'));
    
  if (!showContext) { tb.classList.remove('show'); return; }
  
  const checked = activePanel.querySelectorAll('.song-check:checked');
  if (!checked.length) { tb.classList.remove('show'); return; }

  // 唤出工具栏
  if (window.innerWidth > 768) {
    if (!tb.classList.contains('show')) {
      tb.style.left = '-9999px'; tb.style.top = '0px';
      tb.classList.add('show');
      positionToolbar();
    } else { positionToolbar(); }
  } else {
    // 移动端：首次唤出前强制 reflow，确保 CSS transition 从初始状态开始，
    // 否则浏览器把初始 opacity:0/translateY(100%) 与 .show 合并，工具栏停在屏幕外。
    if (!tb.classList.contains('show')) {
      tb.classList.remove('show');
      void tb.offsetHeight;
    }
    tb.classList.add('show');
  }

  // 🚀 动态调整工具栏按钮（根据当前所在页面）
  setTimeout(() => {
    if (activeId === 'tab-download') {
      // 隐藏没用的按钮
      if($('rankPlayAll')) $('rankPlayAll').style.display = 'none';
      if($('rankPlaySelected')) $('rankPlaySelected').style.display = 'none';
      if($('rankSavePlaylist')) $('rankSavePlaylist').style.display = 'none';
      if($('rankSelectAll')) $('rankSelectAll').style.display = 'block';
      if($('rankInvert')) $('rankInvert').style.display = 'block';
      if($('rankClearSel')) $('rankClearSel').style.display = 'block';

      // 改造原有按钮
      const dlBtn = $('rankDownloadNAS');
      if (dlBtn) { dlBtn.style.display = 'block'; dlBtn.textContent = '删除本地'; dlBtn.className = 'tool-btn red'; }
      
      const cpBtn = $('rankCopyLinks');
      if (cpBtn) { cpBtn.style.display = 'block'; cpBtn.textContent = '清除记录'; cpBtn.className = 'tool-btn blue'; }

    } else {
      // 恢复原样 (搜索/排行榜)
      if($('rankPlayAll')) $('rankPlayAll').style.display = 'block';
      if($('rankPlaySelected')) $('rankPlaySelected').style.display = 'block';
      if($('rankSavePlaylist')) $('rankSavePlaylist').style.display = 'block';
      if($('rankSelectAll')) $('rankSelectAll').style.display = 'block';
      if($('rankInvert')) $('rankInvert').style.display = 'block';
      if($('rankClearSel')) $('rankClearSel').style.display = 'block';

      const dlBtn = $('rankDownloadNAS');
      if (dlBtn) { dlBtn.style.display = 'block'; dlBtn.textContent = '下载到NAS'; dlBtn.className = 'tool-btn'; }
      
      const cpBtn = $('rankCopyLinks');
      if (cpBtn) { cpBtn.style.display = 'block'; cpBtn.textContent = '本地下载'; cpBtn.className = 'tool-btn'; }
    }
  }, 50);
};

// 3. 替换工具栏按钮的点击事件
document.addEventListener('DOMContentLoaded', () => {
  // 彻底替换“下载本地”和“清除记录”的旧事件
  setTimeout(() => {
    const oldDlBtn = $('rankDownloadNAS');
    if (oldDlBtn) {
        const newDlBtn = oldDlBtn.cloneNode(true);
        oldDlBtn.parentNode.replaceChild(newDlBtn, oldDlBtn);
        newDlBtn.onclick = async () => {
            if (document.querySelector('.tab-panel.active').id !== 'tab-download') return; // 防呆
            const checks = document.querySelectorAll('.queue-check:checked');
            if (!checks.length) return alert('请先勾选');
            if (!confirm(`⚠️ 确定要彻底删除选中的 ${checks.length} 首本地物理文件吗？`)) return;
            
            const ids = Array.from(checks).map(c => c.dataset.id);
            const tasks = window._lastQueueData.filter(t => ids.includes(t.id) && t.filename);
            
            if (tasks.length > 0) {
                const items = tasks.map(t => ({ filename: t.filename, folder: t.folder || 'cache' }));
                try {
                    await fetch('/api/music/cache/remove', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'x-user-name': '_open', 'x-frontend-auth': localStorage.getItem('nas_music_pwd') },
                        body: JSON.stringify({ items: items })
                    });
                    alert('删除成功！');
                    startQueuePolling();
                    hideToolbar();
                } catch(e) { alert(e.message); }
            } else {
                alert('选中的任务没有实体文件，无法删除。');
            }
        };
    }

    const oldCpBtn = $('rankCopyLinks');
    if (oldCpBtn) {
        const newCpBtn = oldCpBtn.cloneNode(true);
        oldCpBtn.parentNode.replaceChild(newCpBtn, oldCpBtn);
        newCpBtn.onclick = async () => {
            if (document.querySelector('.tab-panel.active').id !== 'tab-download') return;
            const checks = document.querySelectorAll('.queue-check:checked');
            if (!checks.length) return alert('请先勾选');
            
            const ids = Array.from(checks).map(c => c.dataset.id);
            try {
                // 批量从队列中移除任务记录
                for (let id of ids) {
                    await fetch('/api/music/cache/queue/remove', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'x-user-name': '_open', 'x-frontend-auth': localStorage.getItem('nas_music_pwd') },
                        body: JSON.stringify({ id: id })
                    });
                }
                // 如果是已完成的，也需要前端隐藏（利用之前的时间戳黑科技）
                // 这里为了简单，直接刷新后端队列即可。被移除的队列任务就不会再出现了。
                alert('记录清除成功（本地文件保留）！');
                startQueuePolling();
                hideToolbar();
            } catch(e) { alert(e.message); }
        };
    }
  }, 1000);
});

// ==========================================
// 🚀 终极修正：下载页保留所有原按钮，仅替换两个
// ==========================================

// 1. 重写工具栏的显示逻辑
window.updateToolbarVisibility = function() {
  const tb = $('globalToolbar');
  if (!tb) return;
  const activePanel = document.querySelector('.tab-panel.active');
  if (!activePanel) { tb.classList.remove('show'); return; }
  
  const activeId = activePanel.id;
  const showContext = activeId === 'tab-search' || activeId === 'tab-rank' || activeId === 'tab-download' || 
    (activeId === 'tab-playlist' && !$('playlistDetailView').classList.contains('hidden'));
    
  if (!showContext) { tb.classList.remove('show'); return; }
  
  const checked = activePanel.querySelectorAll('.song-check:checked');
  if (!checked.length) { tb.classList.remove('show'); return; }

  // 唤出工具栏
  if (window.innerWidth > 768) {
    if (!tb.classList.contains('show')) {
      tb.style.left = '-9999px'; tb.style.top = '0px';
      tb.classList.add('show');
      positionToolbar();
    } else { positionToolbar(); }
  } else {
    // 移动端：首次唤出前强制 reflow，确保 CSS transition 从初始状态开始，
    // 否则浏览器把初始 opacity:0/translateY(100%) 与 .show 合并，工具栏停在屏幕外。
    if (!tb.classList.contains('show')) {
      tb.classList.remove('show');
      void tb.offsetHeight;
    }
    tb.classList.add('show');
  }

  // 🚀 核心：根据页面动态切换“那两个”按钮
  setTimeout(() => {
    const dlBtn = $('rankDownloadNAS');
    const cpBtn = $('rankCopyLinks');

    if (activeId === 'tab-download') {
      // 在下载页：替换文字和样式
      if (dlBtn) { dlBtn.textContent = '删除本地'; dlBtn.className = 'tool-btn red'; }
      if (cpBtn) { cpBtn.textContent = '清除记录'; cpBtn.className = 'tool-btn yellow'; }
    } else {
      // 在搜索/排行榜：恢复原始文字和样式
      if (dlBtn) { dlBtn.textContent = '下载到NAS'; dlBtn.className = 'tool-btn'; }
      if (cpBtn) { cpBtn.textContent = '本地下载'; cpBtn.className = 'tool-btn'; }
    }
  }, 50);
};

// 2. 重新绑定这两个按钮的点击事件
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    // 替换“下载到NAS / 删除本地”按钮
    const oldDlBtn = $('rankDownloadNAS');
    if (oldDlBtn) {
        const newDlBtn = oldDlBtn.cloneNode(true);
        oldDlBtn.parentNode.replaceChild(newDlBtn, oldDlBtn);
        newDlBtn.onclick = async () => {
            const activeId = document.querySelector('.tab-panel.active').id;
            
            // 如果是下载页，执行“删除本地”
            if (activeId === 'tab-download') {
                const checks = document.querySelectorAll('.queue-check:checked');
                if (!checks.length) return alert('请先勾选');
                if (!confirm(`⚠️ 确定要彻底删除选中的 ${checks.length} 首本地物理文件吗？`)) return;
                
                const ids = Array.from(checks).map(c => c.dataset.id);
                const tasks = window._lastQueueData.filter(t => ids.includes(t.id) && t.filename);
                
                if (tasks.length > 0) {
                    const items = tasks.map(t => ({ filename: t.filename, folder: t.folder || 'cache' }));
                    try {
                        await fetch('/api/music/cache/remove', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'x-user-name': '_open', 'x-frontend-auth': localStorage.getItem('nas_music_pwd') },
                            body: JSON.stringify({ items: items })
                        });
                        alert('本地文件已彻底删除！');
                        startQueuePolling();
                        hideToolbar();
                    } catch(e) { alert(e.message); }
                } else {
                    alert('选中的任务没有实体文件，无法删除。');
                }
            } else {
                // 如果是其他页，执行原本的下载逻辑
                if (typeof window.downloadToNAS === 'function') {
                    const el = getActiveList();
                    if (!el) return alert('未找到歌曲列表');
                    const songs = getSelectedSongs(el);
                    if (!songs.length) return alert('请先勾选歌曲');
                    const q = await pickQuality('download');
                    if (!q) return;
                    const isPlaylistPage = activePanel && activePanel.id === 'tab-playlist';
            window.downloadToNAS(songs, q, isPlaylistPage);
                    hideToolbar();
                }
            }
        };
    }

    // 替换“获取链接 / 清除记录”按钮
    const oldCpBtn = $('rankCopyLinks');
    if (oldCpBtn) {
        const newCpBtn = oldCpBtn.cloneNode(true);
        oldCpBtn.parentNode.replaceChild(newCpBtn, oldCpBtn);
        newCpBtn.onclick = async () => {
            const activeId = document.querySelector('.tab-panel.active').id;
            
            // 如果是下载页，执行“清除记录”
            if (activeId === 'tab-download') {
                const checks = document.querySelectorAll('.queue-check:checked');
                if (!checks.length) return alert('请先勾选');
                
                const ids = Array.from(checks).map(c => c.dataset.id);
                try {
                    for (let id of ids) {
                        await fetch('/api/music/cache/queue/remove', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'x-user-name': '_open', 'x-frontend-auth': localStorage.getItem('nas_music_pwd') },
                            body: JSON.stringify({ id: id })
                        });
                    }
                    alert('记录清除成功（NAS本地文件保留）！');
                    startQueuePolling();
                    hideToolbar();
                } catch(e) { alert(e.message); }
            } else {
                // 如果是其他页，执行原本的获取链接逻辑
                if (typeof window.rankCopyLinksOriginal === 'function') {
                    window.rankCopyLinksOriginal();
                } else {
                    alert('本地下载功能已就绪，请刷新重试。');
                }
            }
        };
    }
  }, 1000);
});

// ==========================================
// 🚀 完美修复：删除本地文件时，同步清除队列记录
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    const oldDlBtn = $('rankDownloadNAS');
    if (!oldDlBtn) return;

    // 克隆替换，清除旧事件
    const newDlBtn = oldDlBtn.cloneNode(true);
    oldDlBtn.parentNode.replaceChild(newDlBtn, oldDlBtn);

    newDlBtn.onclick = async () => {
        const activeId = document.querySelector('.tab-panel.active').id;
        
        // 如果是在下载页，执行“删除本地 + 清除记录”
        if (activeId === 'tab-download') {
            const checks = document.querySelectorAll('.queue-check:checked');
            if (!checks.length) return alert('请先勾选');
            if (!confirm(`⚠️ 确定要彻底删除选中的 ${checks.length} 首本地物理文件并清除记录吗？`)) return;
            
            const ids = Array.from(checks).map(c => c.dataset.id);
            const tasks = window._lastQueueData.filter(t => ids.includes(t.id));
            
            newDlBtn.textContent = '删除中...';
            newDlBtn.disabled = true;

            try {
                // 1. 先剔除有实体文件的物理文件
                const itemsToRemove = tasks.filter(t => t.filename).map(t => ({ 
                    filename: t.filename, 
                    folder: t.folder || 'cache' 
                }));
                
                if (itemsToRemove.length > 0) {
                    await fetch('/api/music/cache/remove', {
                        method: 'POST',
                        headers: { 
                            'Content-Type': 'application/json', 
                            'x-user-name': '_open', 
                            'x-frontend-auth': localStorage.getItem('nas_music_pwd') 
                        },
                        body: JSON.stringify({ items: itemsToRemove })
                    });
                }

                // 2. 无论有没有实体文件，都把这几条任务从队列记录里踢掉
                for (let id of ids) {
                    await fetch('/api/music/cache/queue/remove', {
                        method: 'POST',
                        headers: { 
                            'Content-Type': 'application/json', 
                            'x-user-name': '_open', 
                            'x-frontend-auth': localStorage.getItem('nas_music_pwd') 
                        },
                        body: JSON.stringify({ id: id })
                    });
                }

                alert('所选文件及记录已彻底清除！');
                startQueuePolling(); // 刷新列表
                hideToolbar();       // 隐藏工具栏
                
            } catch(e) { 
                alert('操作失败: ' + e.message); 
            } finally {
                newDlBtn.textContent = '删除本地';
                newDlBtn.disabled = false;
            }
        } else {
            // 其他页面的原逻辑（下载到NAS）
            if (typeof window.downloadToNAS === 'function') {
                const el = getActiveList();
                if (!el) return alert('未找到歌曲列表');
                const songs = getSelectedSongs(el);
                if (!songs.length) return alert('请先勾选歌曲');
                const q = await pickQuality('download');
                if (!q) return;
                const isPlaylistPage = activePanel && activePanel.id === 'tab-playlist';
            window.downloadToNAS(songs, q, isPlaylistPage);
                hideToolbar();
            }
        }
    };
  }, 1200); // 确保 DOM 完全加载后绑定
});

// ==========================================
// 🚀 修复：真正生效的“暂停”与“取消任务”
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    // 1. 彻底接管“暂停”按钮
    const oldPauseBtn = $('downloadPauseAll');
    if (oldPauseBtn) {
        const newPauseBtn = oldPauseBtn.cloneNode(true);
        oldPauseBtn.parentNode.replaceChild(newPauseBtn, oldPauseBtn);
        
        newPauseBtn.onclick = async function() {
            if (!confirm('确定要暂停/中断当前正在下载的所有任务吗？')) return;
            
            this.textContent = '暂停中...';
            this.disabled = true;
            
            try {
                // 调用后端的 stop 接口，强行中断所有下载
                await fetch('/api/music/cache/stop', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-user-name': '_open', 'x-frontend-auth': localStorage.getItem('nas_music_pwd') },
                    body: JSON.stringify({ all: true })
                });
                startQueuePolling(); // 刷新列表
            } catch(e) {
                alert('暂停失败: ' + e.message);
            } finally {
                this.textContent = '暂停';
                this.disabled = false;
            }
        };
    }

    // 2. 彻底接管“取消任务”按钮
    const oldCancelBtn = $('downloadCancelAll');
    if (oldCancelBtn) {
        const newCancelBtn = oldCancelBtn.cloneNode(true);
        oldCancelBtn.parentNode.replaceChild(newCancelBtn, oldCancelBtn);
        
        newCancelBtn.onclick = async function() {
            if (!confirm('确定要取消并清空所有后台下载任务吗？（已下载的文件会保留）')) return;
            
            this.textContent = '取消中...';
            this.disabled = true;
            
            try {
                // 先中断正在下载的流
                await fetch('/api/music/cache/stop', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-user-name': '_open', 'x-frontend-auth': localStorage.getItem('nas_music_pwd') },
                    body: JSON.stringify({ all: true })
                });
                
                // 再把所有任务从队列中彻底移除
                await fetch('/api/music/cache/queue/remove', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-user-name': '_open', 'x-frontend-auth': localStorage.getItem('nas_music_pwd') },
                    body: JSON.stringify({ all: true })
                });
                
                startQueuePolling(); // 刷新列表
            } catch(e) {
                alert('取消失败: ' + e.message);
            } finally {
                this.textContent = '取消任务';
                this.disabled = false;
            }
        };
    }
  }, 1500); // 延迟执行，确保页面完全加载
});

// ==========================================
// 🚀 完美版：暂停/继续 + 安全取消任务
// ==========================================

window._isQueuePaused = false;
window._pausedIds = [];

// 1. 重写暂停与取消的按钮事件
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    const pauseBtn = $('downloadPauseAll');
    const cancelBtn = $('downloadCancelAll');

    // 彻底接管“暂停”
    if (pauseBtn) {
        const newPauseBtn = pauseBtn.cloneNode(true);
        pauseBtn.parentNode.replaceChild(newPauseBtn, pauseBtn);
        
        newPauseBtn.onclick = async function() {
            if (!window._isQueuePaused) {
                // 暂停操作
                window._isQueuePaused = true;
                this.textContent = '继续';
                this.classList.add('yellow'); 
                
                // 记录当前未完成的任务ID
                if (window._lastQueueData) {
                    window._pausedIds = window._lastQueueData.filter(t => ['downloading', 'running', 'waiting', 'tagging'].includes(t.status)).map(t => t.id);
                }
                
                // 通知后端强行中断当前下载流
                await fetch('/api/music/cache/stop', {
                    method: 'POST', 
                    headers: { 'Content-Type': 'application/json', 'x-user-name': '_open', 'x-frontend-auth': localStorage.getItem('nas_music_pwd') },
                    body: JSON.stringify({ all: true })
                });
                
                if(window._lastQueueData) renderQueueUI(window._lastQueueData); // 立即刷新UI
            } else {
                // 继续操作
                window._isQueuePaused = false;
                this.textContent = '暂停';
                this.classList.remove('yellow');
                window._pausedIds = [];
                
                // 通知后端恢复队列
                await fetch('/api/music/cache/queue/resume', {
                    method: 'POST', 
                    headers: { 'Content-Type': 'application/json', 'x-user-name': '_open', 'x-frontend-auth': localStorage.getItem('nas_music_pwd') },
                    body: JSON.stringify({ all: true })
                });
                
                startQueuePolling();
            }
        };
    }

    // 彻底接管“取消任务”
    if (cancelBtn) {
        const newCancelBtn = cancelBtn.cloneNode(true);
        cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
        
        newCancelBtn.onclick = async function() {
            if (!confirm('确定要取消所有【未完成】的下载任务吗？（已下好的歌曲会保留）')) return;
            
            this.textContent = '取消中...';
            this.disabled = true;

            try {
                // 先停止当前下载流
                await fetch('/api/music/cache/stop', { 
                    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user-name': '_open', 'x-frontend-auth': localStorage.getItem('nas_music_pwd') }, 
                    body: JSON.stringify({ all: true }) 
                });

                // 从列表中挑出所有不是“已完成”的任务
                if (window._lastQueueData) {
                    const unfinished = window._lastQueueData.filter(t => !['completed', 'finished'].includes(t.status));
                    for (let t of unfinished) {
                        await fetch('/api/music/cache/queue/remove', {
                            method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user-name': '_open', 'x-frontend-auth': localStorage.getItem('nas_music_pwd') },
                            body: JSON.stringify({ id: t.id })
                        });
                    }
                }
                
                // 重置状态
                window._isQueuePaused = false;
                $('downloadPauseAll').textContent = '暂停';
                $('downloadPauseAll').classList.remove('yellow');
                window._pausedIds = [];
                
                startQueuePolling(); // 刷新列表
            } catch(e) {
                alert('取消失败: ' + e.message);
            } finally {
                this.textContent = '取消任务';
                this.disabled = false;
            }
        };
    }
  }, 1500);
});

// 2. 重写渲染逻辑，增加“已暂停”的UI状态
window.renderQueueUI = function(queue) {
  const el = $('downloadTasks');
  if (!el) return;

  const counts = {
    all: queue.length,
    downloading: queue.filter(t => ['waiting', 'running', 'downloading', 'tagging'].includes(t.status)).length,
    completed: queue.filter(t => ['completed', 'finished'].includes(t.status)).length,
    failed: queue.filter(t => ['failed', 'error'].includes(t.status)).length
  };

  let filteredQueue = queue;
  if (currentQueueFilter === 'downloading') {
    filteredQueue = queue.filter(t => ['waiting', 'running', 'downloading', 'tagging'].includes(t.status));
  } else if (currentQueueFilter === 'completed') {
    filteredQueue = queue.filter(t => ['completed', 'finished'].includes(t.status));
  } else if (currentQueueFilter === 'failed') {
    filteredQueue = queue.filter(t => ['failed', 'error'].includes(t.status));
  }

  const sortedQueue = [...filteredQueue].reverse();

  const tabsHtml = `
    <div class="queue-tabs">
      <span class="q-tab ${currentQueueFilter === 'all' ? 'active' : ''}" data-filter="all">全部 (${counts.all})</span>
      <span class="q-tab ${currentQueueFilter === 'downloading' ? 'active' : ''}" data-filter="downloading">下载中 (${counts.downloading})</span>
      <span class="q-tab ${currentQueueFilter === 'completed' ? 'active' : ''}" data-filter="completed">已完成 (${counts.completed})</span>
      <span class="q-tab ${currentQueueFilter === 'failed' ? 'active' : ''}" data-filter="failed">错误 (${counts.failed})</span>
    </div>
  `;

  let listHtml = '';
  if (!sortedQueue.length) {
    listHtml = `<div style="color:var(--text2);padding:20px 0;text-align:center;">该分类下暂无任务</div>`;
  } else {
    // 🚀 增加 paused 状态字典
    const statusText = { waiting: '等待中', running: '解析中', downloading: '下载中', tagging: '写入标签', completed: '已完成', finished: '已完成', failed: '失败', paused: '已暂停' };
    const statusColor = { waiting: 'var(--text2)', running: 'var(--blue)', downloading: 'var(--blue)', tagging: 'var(--yellow)', completed: 'var(--green)', finished: 'var(--green)', failed: 'var(--red)', paused: 'var(--yellow)' };

    listHtml = sortedQueue.map((t, i) => {
      const name = t.songInfo?.name || t.name || '未知歌曲';
      const singer = t.songInfo?.singer || t.singer || '';
      const quality = t.quality || t.songInfo?.quality || 'flac';
      
      let sizeStr = '';
      const byteSize = Number(t.size) || 0;
      if (byteSize > 1024 * 1024 * 1024) sizeStr = (byteSize / 1024 / 1024 / 1024).toFixed(2) + 'GB';
      else if (byteSize > 1024 * 1024) sizeStr = (byteSize / 1024 / 1024).toFixed(1) + 'MB';
      else if (byteSize > 0) sizeStr = (byteSize / 1024).toFixed(0) + 'KB';

      const metaStr = `${esc(singer)} · ${esc(quality)} ${sizeStr ? '· ' + sizeStr : ''}`;
      
      let status = t.status;
      // 🚀 如果用户点了暂停，且这个任务在暂停名单里，强制改为暂停状态
      if (window._isQueuePaused && window._pausedIds.includes(t.id)) {
          status = 'paused';
      }

      const isDone = status === 'finished' || status === 'completed';
      const isDownloading = status === 'downloading' || status === 'running' || status === 'tagging';
      const pct = t.progress || 0;
      
      let playBtnHtml = '';
      if (isDone && t.filename) {
          playBtnHtml = `<button class="song-play-btn" style="margin: 0 !important; padding: 4px !important;" onclick="event.stopPropagation(); window.playQueueSong('${t.id}')">▶</button>`;
      }
      
      return `
      <div class="task-item" id="queue-item-${t.id}" style="padding: 12px 0; display: flex; align-items: center; justify-content: space-between;">
        <input type="checkbox" class="song-check queue-check" data-id="${t.id}" style="margin-right: 12px; flex-shrink: 0;" onchange="updateToolbarVisibility()">
        <div class="task-body" style="flex: 1; min-width: 0; margin-right: 10px;">
          <div class="task-name" style="font-size:14px; color:var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${esc(name)}</div>
          <div class="task-meta" style="display:flex; justify-content:space-between; align-items:center; margin-top:4px;">
            <span style="font-size:12px; color:var(--text2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${metaStr}</span>
            <span id="meta-right-${t.id}" style="font-size:12px; color:var(--text2); flex-shrink: 0;">
              ${isDownloading && status !== 'paused' ? `<span style="color:var(--blue);" id="pct-${t.id}">${pct}%</span> <span class="real-speed" id="speed-${t.id}"></span>` : ''}
            </span>
          </div>
          ${((isDownloading || status === 'waiting') && status !== 'paused') ? `
            <div class="task-bar" style="margin-top:8px; width:100%; height:4px; background:var(--bg3); border-radius:2px; overflow:hidden;">
              <div class="task-bar-fill" id="bar-${t.id}" style="width: ${pct}%; height:100%; background:var(--blue); transition:width 0.3s; ${isDownloading && pct===0 ? 'animation: pulse 1.5s infinite;' : ''}"></div>
            </div>
          ` : ''}
        </div>
        <div class="task-status" style="display:flex !important; flex-direction: row !important; flex-wrap: nowrap !important; align-items:center !important; justify-content:flex-end !important; flex-shrink: 0; gap: 6px;">
          <span class="task-status-text" style="color:${statusColor[status] || ''}; font-size:13px; white-space: nowrap; margin: 0 !important;">${statusText[status] || status}</span>
          ${playBtnHtml}
        </div>
      </div>`;
    }).join('');
  }

  el.innerHTML = tabsHtml + `<div style="display:flex; flex-direction:column;">${listHtml}</div>`;

  el.querySelectorAll('.q-tab').forEach(tab => {
    tab.onclick = () => {
      currentQueueFilter = tab.dataset.filter;
      renderQueueUI(queue); 
    };
  });
};

// ==========================================
// 🚀 修复：翻译后端返回的 exists 状态
// ==========================================
window.renderQueueUI = function(queue) {
  const el = $('downloadTasks');
  if (!el) return;

  const counts = {
    all: queue.length,
    downloading: queue.filter(t => ['waiting', 'running', 'downloading', 'tagging'].includes(t.status)).length,
    completed: queue.filter(t => ['completed', 'finished', 'exists'].includes(t.status)).length,
    failed: queue.filter(t => ['failed', 'error'].includes(t.status)).length
  };

  let filteredQueue = queue;
  if (currentQueueFilter === 'downloading') {
    filteredQueue = queue.filter(t => ['waiting', 'running', 'downloading', 'tagging'].includes(t.status));
  } else if (currentQueueFilter === 'completed') {
    filteredQueue = queue.filter(t => ['completed', 'finished', 'exists'].includes(t.status));
  } else if (currentQueueFilter === 'failed') {
    filteredQueue = queue.filter(t => ['failed', 'error'].includes(t.status));
  }

  const sortedQueue = [...filteredQueue].reverse();

  const tabsHtml = `
    <div class="queue-tabs">
      <span class="q-tab ${currentQueueFilter === 'all' ? 'active' : ''}" data-filter="all">全部 (${counts.all})</span>
      <span class="q-tab ${currentQueueFilter === 'downloading' ? 'active' : ''}" data-filter="downloading">下载中 (${counts.downloading})</span>
      <span class="q-tab ${currentQueueFilter === 'completed' ? 'active' : ''}" data-filter="completed">已完成 (${counts.completed})</span>
      <span class="q-tab ${currentQueueFilter === 'failed' ? 'active' : ''}" data-filter="failed">错误 (${counts.failed})</span>
    </div>
  `;

  let listHtml = '';
  if (!sortedQueue.length) {
    listHtml = `<div style="color:var(--text2);padding:20px 0;text-align:center;">该分类下暂无任务</div>`;
  } else {
    // 🚀 增加 exists 的映射
    const statusText = { waiting: '等待中', running: '解析中', downloading: '下载中', tagging: '写入标签', completed: '已完成', finished: '已完成', exists: '已存在', failed: '失败', paused: '已暂停' };
    const statusColor = { waiting: 'var(--text2)', running: 'var(--blue)', downloading: 'var(--blue)', tagging: 'var(--yellow)', completed: 'var(--green)', finished: 'var(--green)', exists: 'var(--green)', failed: 'var(--red)', paused: 'var(--yellow)' };

    listHtml = sortedQueue.map((t, i) => {
      const name = t.songInfo?.name || t.name || '未知歌曲';
      const singer = t.songInfo?.singer || t.singer || '';
      const quality = t.quality || t.songInfo?.quality || 'flac';
      
      let sizeStr = '';
      const byteSize = Number(t.size) || 0;
      if (byteSize > 1024 * 1024 * 1024) sizeStr = (byteSize / 1024 / 1024 / 1024).toFixed(2) + 'GB';
      else if (byteSize > 1024 * 1024) sizeStr = (byteSize / 1024 / 1024).toFixed(1) + 'MB';
      else if (byteSize > 0) sizeStr = (byteSize / 1024).toFixed(0) + 'KB';

      const metaStr = `${esc(singer)} · ${esc(quality)} ${sizeStr ? '· ' + sizeStr : ''}`;
      
      let status = t.status;
      // 如果用户点了暂停，且这个任务在暂停名单里，强制改为暂停状态
      if (window._isQueuePaused && window._pausedIds.includes(t.id)) {
          status = 'paused';
      }

      // 🚀 把 exists 当作已完成处理
      const isDone = ['finished', 'completed', 'exists'].includes(status);
      const isDownloading = status === 'downloading' || status === 'running' || status === 'tagging';
      const pct = t.progress || 0;
      
      // 只要有 filename 并且状态是 Done，就出播放按钮
      let playBtnHtml = '';
      if (isDone && t.filename) {
          playBtnHtml = `<button class="song-play-btn" style="margin: 0 !important; padding: 4px !important;" onclick="event.stopPropagation(); window.playQueueSong('${t.id}')">▶</button>`;
      }
      
      return `
      <div class="task-item" id="queue-item-${t.id}" style="padding: 12px 0; display: flex; align-items: center; justify-content: space-between;">
        <input type="checkbox" class="song-check queue-check" data-id="${t.id}" style="margin-right: 12px; flex-shrink: 0;" onchange="updateToolbarVisibility()">
        <div class="task-body" style="flex: 1; min-width: 0; margin-right: 10px;">
          <div class="task-name" style="font-size:14px; color:var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${esc(name)}</div>
          <div class="task-meta" style="display:flex; justify-content:space-between; align-items:center; margin-top:4px;">
            <span style="font-size:12px; color:var(--text2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${metaStr}</span>
            <span id="meta-right-${t.id}" style="font-size:12px; color:var(--text2); flex-shrink: 0;">
              ${isDownloading && status !== 'paused' ? `<span style="color:var(--blue);" id="pct-${t.id}">${pct}%</span> <span class="real-speed" id="speed-${t.id}"></span>` : ''}
            </span>
          </div>
          ${((isDownloading || status === 'waiting') && status !== 'paused') ? `
            <div class="task-bar" style="margin-top:8px; width:100%; height:4px; background:var(--bg3); border-radius:2px; overflow:hidden;">
              <div class="task-bar-fill" id="bar-${t.id}" style="width: ${pct}%; height:100%; background:var(--blue); transition:width 0.3s; ${isDownloading && pct===0 ? 'animation: pulse 1.5s infinite;' : ''}"></div>
            </div>
          ` : ''}
        </div>
        <div class="task-status" style="display:flex !important; flex-direction: row !important; flex-wrap: nowrap !important; align-items:center !important; justify-content:flex-end !important; flex-shrink: 0; gap: 6px;">
          <span class="task-status-text" style="color:${statusColor[status] || ''}; font-size:13px; white-space: nowrap; margin: 0 !important;">${statusText[status] || status}</span>
          ${playBtnHtml}
        </div>
      </div>`;
    }).join('');
  }

  el.innerHTML = tabsHtml + `<div style="display:flex; flex-direction:column;">${listHtml}</div>`;

  el.querySelectorAll('.q-tab').forEach(tab => {
    tab.onclick = () => {
      currentQueueFilter = tab.dataset.filter;
      renderQueueUI(queue); 
    };
  });
};

// ==========================================
// 🚀 终极完美修复：取消任务不卡顿 + 状态完美映射
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    const cancelBtn = $('downloadCancelAll');
    if (cancelBtn) {
        const newCancelBtn = cancelBtn.cloneNode(true);
        cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
        
        newCancelBtn.onclick = async function() {
            if (!confirm('确定要取消所有【未完成】的下载任务吗？（已下好的歌曲会保留）')) return;
            
            this.textContent = '取消中...';
            this.disabled = true;

            try {
                // 1. 先停止当前所有的下载流
                await fetch('/api/music/cache/stop', { 
                    method: 'POST', 
                    headers: { 'Content-Type': 'application/json', 'x-user-name': '_open', 'x-frontend-auth': localStorage.getItem('nas_music_pwd') }, 
                    body: JSON.stringify({ all: true }) 
                });

                // 2. 收集所有“未完成”的任务ID
                if (window._lastQueueData) {
                    const unfinishedIds = window._lastQueueData
                        .filter(t => !['completed', 'finished', 'exists'].includes(t.status))
                        .map(t => t.id);
                    
                    // 🚀 核心修复：使用 Promise.all 并发删除，不再用 for 循环卡死页面！
                    if (unfinishedIds.length > 0) {
                        await Promise.all(unfinishedIds.map(id => {
                            return fetch('/api/music/cache/queue/remove', {
                                method: 'POST', 
                                headers: { 'Content-Type': 'application/json', 'x-user-name': '_open', 'x-frontend-auth': localStorage.getItem('nas_music_pwd') },
                                body: JSON.stringify({ id: id })
                            });
                        }));
                    }
                }
                
                // 3. 重置暂停状态
                window._isQueuePaused = false;
                window._pausedIds = [];
                const pauseBtn = $('downloadPauseAll');
                if (pauseBtn) {
                    pauseBtn.textContent = '暂停';
                    pauseBtn.classList.remove('yellow');
                }
                
                startQueuePolling(); // 刷新列表
            } catch(e) {
                alert('取消失败: ' + e.message);
            } finally {
                this.textContent = '取消任务';
                this.disabled = false;
            }
        };
    }
  }, 1500);
});

// 顺便再次确保渲染字典包含 exists
window.renderQueueUI = function(queue) {
  const el = $('downloadTasks');
  if (!el) return;

  const counts = {
    all: queue.length,
    downloading: queue.filter(t => ['waiting', 'running', 'downloading', 'tagging'].includes(t.status)).length,
    completed: queue.filter(t => ['completed', 'finished', 'exists'].includes(t.status)).length,
    failed: queue.filter(t => ['failed', 'error'].includes(t.status)).length
  };

  let filteredQueue = queue;
  if (currentQueueFilter === 'downloading') {
    filteredQueue = queue.filter(t => ['waiting', 'running', 'downloading', 'tagging'].includes(t.status));
  } else if (currentQueueFilter === 'completed') {
    filteredQueue = queue.filter(t => ['completed', 'finished', 'exists'].includes(t.status));
  } else if (currentQueueFilter === 'failed') {
    filteredQueue = queue.filter(t => ['failed', 'error'].includes(t.status));
  }

  const sortedQueue = [...filteredQueue].reverse();

  const tabsHtml = `
    <div class="queue-tabs">
      <span class="q-tab ${currentQueueFilter === 'all' ? 'active' : ''}" data-filter="all">全部 (${counts.all})</span>
      <span class="q-tab ${currentQueueFilter === 'downloading' ? 'active' : ''}" data-filter="downloading">下载中 (${counts.downloading})</span>
      <span class="q-tab ${currentQueueFilter === 'completed' ? 'active' : ''}" data-filter="completed">已完成 (${counts.completed})</span>
      <span class="q-tab ${currentQueueFilter === 'failed' ? 'active' : ''}" data-filter="failed">错误 (${counts.failed})</span>
    </div>
  `;

  let listHtml = '';
  if (!sortedQueue.length) {
    listHtml = `<div style="color:var(--text2);padding:20px 0;text-align:center;">该分类下暂无任务</div>`;
  } else {
    const statusText = { waiting: '等待中', running: '解析中', downloading: '下载中', tagging: '写入标签', completed: '已完成', finished: '已完成', exists: '已存在', failed: '失败', paused: '已暂停' };
    const statusColor = { waiting: 'var(--text2)', running: 'var(--blue)', downloading: 'var(--blue)', tagging: 'var(--yellow)', completed: 'var(--green)', finished: 'var(--green)', exists: 'var(--green)', failed: 'var(--red)', paused: 'var(--yellow)' };

    listHtml = sortedQueue.map((t, i) => {
      const name = t.songInfo?.name || t.name || '未知歌曲';
      const singer = t.songInfo?.singer || t.singer || '';
      const quality = t.quality || t.songInfo?.quality || 'flac';
      
      let sizeStr = '';
      const byteSize = Number(t.size) || 0;
      if (byteSize > 1024 * 1024 * 1024) sizeStr = (byteSize / 1024 / 1024 / 1024).toFixed(2) + 'GB';
      else if (byteSize > 1024 * 1024) sizeStr = (byteSize / 1024 / 1024).toFixed(1) + 'MB';
      else if (byteSize > 0) sizeStr = (byteSize / 1024).toFixed(0) + 'KB';

      const metaStr = `${esc(singer)} · ${esc(quality)} ${sizeStr ? '· ' + sizeStr : ''}`;
      
      let status = t.status;
      if (window._isQueuePaused && window._pausedIds.includes(t.id)) {
          status = 'paused';
      }

      const isDone = ['finished', 'completed', 'exists'].includes(status);
      const isDownloading = status === 'downloading' || status === 'running' || status === 'tagging';
      const pct = t.progress || 0;
      
      let playBtnHtml = '';
      if (isDone && t.filename) {
          playBtnHtml = `<button class="song-play-btn" style="margin: 0 !important; padding: 4px !important;" onclick="event.stopPropagation(); window.playQueueSong('${t.id}')">▶</button>`;
      }
      
      return `
      <div class="task-item" id="queue-item-${t.id}" style="padding: 12px 0; display: flex; align-items: center; justify-content: space-between;">
        <input type="checkbox" class="song-check queue-check" data-id="${t.id}" style="margin-right: 12px; flex-shrink: 0;" onchange="updateToolbarVisibility()">
        <div class="task-body" style="flex: 1; min-width: 0; margin-right: 10px;">
          <div class="task-name" style="font-size:14px; color:var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${esc(name)}</div>
          <div class="task-meta" style="display:flex; justify-content:space-between; align-items:center; margin-top:4px;">
            <span style="font-size:12px; color:var(--text2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${metaStr}</span>
            <span id="meta-right-${t.id}" style="font-size:12px; color:var(--text2); flex-shrink: 0;">
              ${isDownloading && status !== 'paused' ? `<span style="color:var(--blue);" id="pct-${t.id}">${pct}%</span> <span class="real-speed" id="speed-${t.id}"></span>` : ''}
            </span>
          </div>
          ${((isDownloading || status === 'waiting') && status !== 'paused') ? `
            <div class="task-bar" style="margin-top:8px; width:100%; height:4px; background:var(--bg3); border-radius:2px; overflow:hidden;">
              <div class="task-bar-fill" id="bar-${t.id}" style="width: ${pct}%; height:100%; background:var(--blue); transition:width 0.3s; ${isDownloading && pct===0 ? 'animation: pulse 1.5s infinite;' : ''}"></div>
            </div>
          ` : ''}
        </div>
        <div class="task-status" style="display:flex !important; flex-direction: row !important; flex-wrap: nowrap !important; align-items:center !important; justify-content:flex-end !important; flex-shrink: 0; gap: 6px;">
          <span class="task-status-text" style="color:${statusColor[status] || ''}; font-size:13px; white-space: nowrap; margin: 0 !important;">${statusText[status] || status}</span>
          ${playBtnHtml}
        </div>
      </div>`;
    }).join('');
  }

  el.innerHTML = tabsHtml + `<div style="display:flex; flex-direction:column;">${listHtml}</div>`;

  el.querySelectorAll('.q-tab').forEach(tab => {
    tab.onclick = () => {
      currentQueueFilter = tab.dataset.filter;
      renderQueueUI(queue); 
    };
  });
};

// ==========================================
// 🚀 像素级对齐：下载列表完全套用排行榜结构
// ==========================================
window.renderQueueUI = function(queue) {
  const el = $('downloadTasks');
  if (!el) return;

  const counts = {
    all: queue.length,
    downloading: queue.filter(t => ['waiting', 'running', 'downloading', 'tagging'].includes(t.status)).length,
    completed: queue.filter(t => ['completed', 'finished', 'exists'].includes(t.status)).length,
    failed: queue.filter(t => ['failed', 'error'].includes(t.status)).length
  };

  let filteredQueue = queue;
  if (currentQueueFilter === 'downloading') {
    filteredQueue = queue.filter(t => ['waiting', 'running', 'downloading', 'tagging'].includes(t.status));
  } else if (currentQueueFilter === 'completed') {
    filteredQueue = queue.filter(t => ['completed', 'finished', 'exists'].includes(t.status));
  } else if (currentQueueFilter === 'failed') {
    filteredQueue = queue.filter(t => ['failed', 'error'].includes(t.status));
  }

  const sortedQueue = [...filteredQueue].reverse();

  const tabsHtml = `
    <div class="queue-tabs" style="margin-bottom: 10px; display: flex; gap: 15px; padding-bottom: 8px; border-bottom: 1px solid var(--border);">
      <span class="q-tab ${currentQueueFilter === 'all' ? 'active' : ''}" data-filter="all">全部 (${counts.all})</span>
      <span class="q-tab ${currentQueueFilter === 'downloading' ? 'active' : ''}" data-filter="downloading">下载中 (${counts.downloading})</span>
      <span class="q-tab ${currentQueueFilter === 'completed' ? 'active' : ''}" data-filter="completed">已完成 (${counts.completed})</span>
      <span class="q-tab ${currentQueueFilter === 'failed' ? 'active' : ''}" data-filter="failed">错误 (${counts.failed})</span>
    </div>
  `;

  let listHtml = '';
  if (!sortedQueue.length) {
    listHtml = `<div style="color:var(--text2);padding:20px 0;text-align:center;">该分类下暂无任务</div>`;
  } else {
    const statusText = { waiting: '等待中', running: '解析中', downloading: '下载中', tagging: '写入标签', completed: '已完成', finished: '已完成', exists: '已存在', failed: '失败', paused: '已暂停' };
    const statusColor = { waiting: 'var(--text2)', running: 'var(--blue)', downloading: 'var(--blue)', tagging: 'var(--yellow)', completed: 'var(--green)', finished: 'var(--green)', exists: 'var(--green)', failed: 'var(--red)', paused: 'var(--yellow)' };

    listHtml = sortedQueue.map((t, i) => {
      const name = t.songInfo?.name || t.name || '未知歌曲';
      const singer = t.songInfo?.singer || t.singer || '';
      const quality = t.quality || t.songInfo?.quality || 'flac';
      
      let sizeStr = '';
      const byteSize = Number(t.size) || 0;
      if (byteSize > 1024 * 1024 * 1024) sizeStr = (byteSize / 1024 / 1024 / 1024).toFixed(2) + 'GB';
      else if (byteSize > 1024 * 1024) sizeStr = (byteSize / 1024 / 1024).toFixed(1) + 'MB';
      else if (byteSize > 0) sizeStr = (byteSize / 1024).toFixed(0) + 'KB';

      let status = t.status;
      if (window._isQueuePaused && window._pausedIds.includes(t.id)) {
          status = 'paused';
      }

      const isDone = ['finished', 'completed', 'exists'].includes(status);
      const isDownloading = status === 'downloading' || status === 'running' || status === 'tagging';
      const pct = t.progress || 0;
      
      // 右侧播放按钮：完美复用原生样式
      let playBtnHtml = '';
      if (isDone && t.filename) {
          playBtnHtml = `<button class="song-play-btn" onclick="event.stopPropagation(); window.playQueueSong('${t.id}')">▶</button>`;
      } else {
          // 如果没有按钮，留出跟原生按钮一样宽度的占位，保证上下绝对对齐
          playBtnHtml = `<div style="width: 32px; flex-shrink: 0;"></div>`;
      }
      
      return `
      <div class="song-item" id="queue-item-${t.id}">
        <input type="checkbox" class="song-check queue-check" data-id="${t.id}" onchange="updateToolbarVisibility()">
        <span class="song-num">${sortedQueue.length - i}</span>
        
        <div class="song-info">
          <div class="song-name" title="${esc(name)}">${esc(name)}</div>
          <div class="song-singer" style="display:flex; justify-content:space-between; align-items:center;">
            <!-- 左侧：歌手 · 格式 · 大小 -->
            <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(singer)} · ${esc(quality)} ${sizeStr ? '· ' + sizeStr : ''}</span>
            <!-- 右侧：把状态和进度塞到这里，不再占用外部空间 -->
            <span style="flex-shrink:0; margin-left: 10px; font-weight: bold;">
                ${isDownloading && status !== 'paused' ? `<span style="color:var(--blue);" id="pct-${t.id}">${pct}%</span> <span class="real-speed" style="color:var(--green)" id="speed-${t.id}"></span>` : `<span style="color:${statusColor[status] || 'var(--text2)'};">${statusText[status] || status}</span>`}
            </span>
          </div>
          ${((isDownloading || status === 'waiting') && status !== 'paused') ? `
            <div class="task-bar" style="margin-top:6px; width:100%; height:3px; background:var(--bg3); border-radius:2px; overflow:hidden;">
              <div class="task-bar-fill" id="bar-${t.id}" style="width: ${pct}%; height:100%; background:var(--blue); transition:width 0.3s; ${isDownloading && pct===0 ? 'animation: pulse 1.5s infinite;' : ''}"></div>
            </div>
          ` : ''}
        </div>
        
        <!-- 最右侧：仅播放按钮 -->
        ${playBtnHtml}
      </div>`;
    }).join('');
  }

    // 🚀 核心修改：如果在一键重试分类下，把按钮放到列表上方靠右
  let actionHtml = '';
  if (retryAllBtnHtml) {
      actionHtml = `<div style="display:flex; justify-content:flex-end; margin: 10px 0;">${retryAllBtnHtml}</div>`;
  }

  el.innerHTML = tabsHtml + actionHtml + `<div class="song-list">${listHtml}</div>`;

  el.querySelectorAll('.q-tab').forEach(tab => {
    tab.onclick = () => {
      currentQueueFilter = tab.dataset.filter;
      renderQueueUI(queue); 
    };
  });
};

// ==========================================
// 🚀 终极补全：给错误任务增加“重试”按钮
// ==========================================

// 1. 重写渲染逻辑，判断如果是 failed 或 error，就出重试按钮
window.renderQueueUI = function(queue) {
  const el = $('downloadTasks');
  if (!el) return;

  const counts = {
    all: queue.length,
    downloading: queue.filter(t => ['waiting', 'running', 'downloading', 'tagging'].includes(t.status)).length,
    completed: queue.filter(t => ['completed', 'finished', 'exists'].includes(t.status)).length,
    failed: queue.filter(t => ['failed', 'error'].includes(t.status)).length
  };

  let filteredQueue = queue;
  if (currentQueueFilter === 'downloading') {
    filteredQueue = queue.filter(t => ['waiting', 'running', 'downloading', 'tagging'].includes(t.status));
  } else if (currentQueueFilter === 'completed') {
    filteredQueue = queue.filter(t => ['completed', 'finished', 'exists'].includes(t.status));
  } else if (currentQueueFilter === 'failed') {
    filteredQueue = queue.filter(t => ['failed', 'error'].includes(t.status));
  }

  const sortedQueue = [...filteredQueue].reverse();

  const tabsHtml = `
    <div class="queue-tabs">
      <span class="q-tab ${currentQueueFilter === 'all' ? 'active' : ''}" data-filter="all">全部 (${counts.all})</span>
      <span class="q-tab ${currentQueueFilter === 'downloading' ? 'active' : ''}" data-filter="downloading">下载中 (${counts.downloading})</span>
      <span class="q-tab ${currentQueueFilter === 'completed' ? 'active' : ''}" data-filter="completed">已完成 (${counts.completed})</span>
      <span class="q-tab ${currentQueueFilter === 'failed' ? 'active' : ''}" data-filter="failed">错误 (${counts.failed})</span>
    </div>
  `;

  let listHtml = '';
  if (!sortedQueue.length) {
    listHtml = `<div style="color:var(--text2);padding:20px 0;text-align:center;">该分类下暂无任务</div>`;
  } else {
    const statusText = { waiting: '等待中', running: '解析中', downloading: '下载中', tagging: '写入标签', completed: '已完成', finished: '已完成', exists: '已存在', failed: '下载失败', error: '出错', paused: '已暂停' };
    const statusColor = { waiting: 'var(--text2)', running: 'var(--blue)', downloading: 'var(--blue)', tagging: 'var(--yellow)', completed: 'var(--green)', finished: 'var(--green)', exists: 'var(--green)', failed: 'var(--red)', error: 'var(--red)', paused: 'var(--yellow)' };

    listHtml = sortedQueue.map((t, i) => {
      const name = t.songInfo?.name || t.name || '未知歌曲';
      const singer = t.songInfo?.singer || t.singer || '';
      const quality = t.quality || t.songInfo?.quality || 'flac';
      
      let sizeStr = '';
      const byteSize = Number(t.size) || 0;
      if (byteSize > 1024 * 1024 * 1024) sizeStr = (byteSize / 1024 / 1024 / 1024).toFixed(2) + 'GB';
      else if (byteSize > 1024 * 1024) sizeStr = (byteSize / 1024 / 1024).toFixed(1) + 'MB';
      else if (byteSize > 0) sizeStr = (byteSize / 1024).toFixed(0) + 'KB';

      let status = t.status;
      if (window._isQueuePaused && window._pausedIds.includes(t.id)) {
          status = 'paused';
      }

      const isDone = ['finished', 'completed', 'exists'].includes(status);
      const isFailed = ['failed', 'error'].includes(status);
      const isDownloading = status === 'downloading' || status === 'running' || status === 'tagging';
      const pct = t.progress || 0;
      
      let actionBtnHtml = '';
      if (isDone && t.filename) {
          // 已完成：播放按钮
          actionBtnHtml = `<button class="song-play-btn" title="播放" onclick="event.stopPropagation(); window.playQueueSong('${t.id}')">▶</button>`;
      } else if (isFailed) {
          // 错误状态：重试按钮
          actionBtnHtml = `<button class="song-play-btn" title="重试下载" style="color: var(--red); font-weight: bold;" onclick="event.stopPropagation(); window.retryQueueTask('${t.id}')">↻</button>`;
      } else {
          // 其他状态：占位符保证对齐
          actionBtnHtml = `<div style="width: 32px; flex-shrink: 0;"></div>`;
      }
      
      return `
      <div class="song-item" id="queue-item-${t.id}">
        <input type="checkbox" class="song-check queue-check" data-id="${t.id}" onchange="updateToolbarVisibility()">
        <span class="song-num">${sortedQueue.length - i}</span>
        
        <div class="song-info">
          <div class="song-name" title="${esc(name)}">${esc(name)}</div>
          <div class="song-singer" style="display:flex; justify-content:space-between; align-items:center;">
            <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(singer)} · ${esc(quality)} ${sizeStr ? '· ' + sizeStr : ''}</span>
            <span style="flex-shrink:0; margin-left: 10px; font-weight: bold;">
                ${isDownloading && status !== 'paused' ? `<span style="color:var(--blue);" id="pct-${t.id}">${pct}%</span> <span class="real-speed" style="color:var(--green)" id="speed-${t.id}"></span>` : `<span style="color:${statusColor[status] || 'var(--text2)'};">${statusText[status] || status}</span>`}
            </span>
          </div>
          ${((isDownloading || status === 'waiting') && status !== 'paused') ? `
            <div class="task-bar" style="margin-top:6px; width:100%; height:3px; background:var(--bg3); border-radius:2px; overflow:hidden;">
              <div class="task-bar-fill" id="bar-${t.id}" style="width: ${pct}%; height:100%; background:var(--blue); transition:width 0.3s; ${isDownloading && pct===0 ? 'animation: pulse 1.5s infinite;' : ''}"></div>
            </div>
          ` : ''}
        </div>
        
        ${actionBtnHtml}
      </div>`;
    }).join('');
  }

    // 🚀 核心修改：如果在一键重试分类下，把按钮放到列表上方靠右
  let actionHtml = '';
  if (retryAllBtnHtml) {
      actionHtml = `<div style="display:flex; justify-content:flex-end; margin: 10px 0;">${retryAllBtnHtml}</div>`;
  }

  el.innerHTML = tabsHtml + actionHtml + `<div class="song-list">${listHtml}</div>`;

  el.querySelectorAll('.q-tab').forEach(tab => {
    tab.onclick = () => {
      currentQueueFilter = tab.dataset.filter;
      renderQueueUI(queue); 
    };
  });
};

// 2. 实现重试逻辑
window.retryQueueTask = async function(id) {
    if (!window._lastQueueData) return;
    const task = window._lastQueueData.find(t => t.id === id);
    if (!task) return;
    
    // 更换按钮状态，防止多次点击
    const btn = document.querySelector(`#queue-item-${id} button`);
    if(btn) { btn.textContent = '...'; btn.disabled = true; }

    try {
        // 1. 把旧的失败任务从队列里踢出去
        await fetch('/api/music/cache/queue/remove', {
            method: 'POST', 
            headers: { 'Content-Type': 'application/json', 'x-user-name': '_open', 'x-frontend-auth': localStorage.getItem('nas_music_pwd') },
            body: JSON.stringify({ id: id })
        });
        
        // 2. 重新把这个任务塞进队列
        await fetch('/api/music/cache/queue', {
            method: 'POST', 
            headers: { 'Content-Type': 'application/json', 'x-user-name': '_open', 'x-frontend-auth': localStorage.getItem('nas_music_pwd') },
            body: JSON.stringify({ 
                tasks: [{ 
                    songInfo: task.songInfo || task, 
                    quality: task.quality || 'flac' 
                }], 
                namingPattern: 'name_singer' 
            })
        });
        
        // 3. 刷新列表
        startQueuePolling();
    } catch(e) {
        alert('重试失败: ' + e.message);
        startQueuePolling(); // 恢复UI
    }
};

// ==========================================
// 🚀 UI 最终微调：4 个分类标签一屏完美均分显示
// ==========================================
setTimeout(() => {
    const style = document.createElement('style');
    style.innerHTML = `
        .queue-tabs {
            display: grid !important;
            grid-template-columns: repeat(4, 1fr) !important;
            gap: 0 !important; /* 取消原本的间距 */
            width: 100% !important;
            padding-bottom: 8px !important;
            border-bottom: 1px solid var(--border) !important;
            margin-bottom: 10px !important;
            box-sizing: border-box !important;
        }
        .q-tab {
            text-align: center !important;
            font-size: 13px !important; /* 稍微缩小字体 */
            padding: 6px 0 !important;  /* 减小左右内边距，只留上下 */
            margin: 0 !important;
            white-space: nowrap !important;
            overflow: hidden !important;
            text-overflow: ellipsis !important;
        }
        /* 手机端字体再微调小一点，确保绝对放得下 */
        @media (max-width: 768px) {
            .q-tab {
                font-size: 12px !important;
            }
        }
    `;
    document.head.appendChild(style);
}, 1500);

// ==========================================
// 🚀 纯正线程控制：1~5 线程选择与轻量提示
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        // 清理可能残留的旧元素
        const oldAntiBan = $('antiBanBtn');
        if (oldAntiBan) oldAntiBan.remove();
        
        const cancelBtn = $('downloadCancelAll');
        if (!cancelBtn || $('threadSelect')) return;

        // 1. 注入下拉框
        const selectHtml = `
            <select id="threadSelect" style="margin-left: 10px; padding: 6px 10px; border-radius: 6px; background: var(--bg3); color: var(--text); border: 1px solid var(--border); font-size: 13px; cursor: pointer; outline: none;">
                <option value="1">1 线程</option>
                <option value="2">2 线程</option>
                <option value="3">3 线程</option>
                <option value="4">4 线程</option>
                <option value="5">5 线程</option>
            </select>
        `;
        cancelBtn.insertAdjacentHTML('afterend', selectHtml);

        // 2. 初始化值 (默认 3)
        const selectEl = $('threadSelect');
        const savedThread = localStorage.getItem('downloadConcurrency') || '3';
        selectEl.value = savedThread;

        // 3. 轻量级 Toast 提示函数（不弹系统 alert，防止键盘 bug）
        function showToast(msg) {
            let toast = document.getElementById('sysToast');
            if (!toast) {
                toast = document.createElement('div');
                toast.id = 'sysToast';
                toast.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:rgba(35,134,54,0.95);color:#fff;padding:8px 16px;border-radius:20px;z-index:99999;font-size:13px;transition:opacity 0.3s;box-shadow:0 4px 12px rgba(0,0,0,0.3);backdrop-filter:blur(4px);pointer-events:none;';
                document.body.appendChild(toast);
            }
            toast.textContent = msg;
            toast.style.opacity = '1';
            setTimeout(() => { toast.style.opacity = '0'; }, 2000);
        }

        // 4. 监听改变事件
        selectEl.onchange = (e) => {
            const val = e.target.value;
            localStorage.setItem('downloadConcurrency', val);
            showToast(`✅ 下载线程数已改为 ${val}`);
        };

        // 5. 覆盖核心的下载函数，确保带上并发参数
        window.downloadToNAS = async function(songs, quality) {
            if (!songs.length) return;
            switchTab('download');
            
            const concurrency = parseInt(localStorage.getItem('downloadConcurrency')) || 3;
            const tasks = songs.map(song => ({ songInfo: song, quality: quality }));
            
            try {
                const res = await api('/api/music/cache/queue', {
                    method: 'POST',
                    body: { tasks: tasks, namingPattern: 'name_singer', concurrency: concurrency }
                });
                if (res.success) startQueuePolling();
                else alert('提交任务失败');
            } catch (e) { alert('网络请求失败: ' + e.message); }
            
            if (typeof hideToolbar === 'function') hideToolbar();
        };
    }, 1000);
});

// ==========================================
// 🚀 并发风险提示弹窗（纯前端安全版）
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        const selectEl = $('threadSelect');
        if (!selectEl) return;

        // 1. 动态注入自定义弹窗的 HTML（默认隐藏）
        if (!$('riskWarningModal')) {
            const modalHtml = `
                <div id="riskWarningModal" class="modal hidden" style="z-index: 10000; background: rgba(0,0,0,0.7);">
                    <div class="modal-content" style="max-width: 320px; padding: 25px; text-align: center; border-radius: 12px; background: var(--bg2); border: 1px solid var(--border);">
                        <div style="font-size: 40px; margin-bottom: 10px;">⚠️</div>
                        <h3 style="margin-bottom: 15px; color: var(--text); font-size: 16px;">高风险操作提示</h3>
                        <p style="color: var(--text2); font-size: 13px; line-height: 1.6; margin-bottom: 20px; text-align: left;">
                            您正在开启 <strong style="color: var(--yellow);" id="riskThreadNum">3</strong> 线程并发下载。<br><br>
                            并发过高极易触发音乐平台的 <strong style="color: var(--red);">IP 频率限制（封禁）</strong>，导致大量歌曲下载失败、超时！<br><br>
                            建议日常使用 <strong style="color: var(--green);">1-2 线程</strong>，求稳不封号。
                        </p>
                        <div style="display: flex; gap: 10px;">
                            <button id="riskCancel" class="tool-btn" style="flex: 1; padding: 10px; border-radius: 8px;">退回去</button>
                            <button id="riskConfirm" class="tool-btn red" style="flex: 1; padding: 10px; border-radius: 8px;">确认风险</button>
                        </div>
                    </div>
                </div>
            `;
            document.body.insertAdjacentHTML('beforeend', modalHtml);
        }

        const modal = $('riskWarningModal');
        let previousValue = selectEl.value;

        // 2. 监听下拉框变化
        selectEl.addEventListener('change', (e) => {
            const val = parseInt(e.target.value);
            
            // 如果选择了 3、4、5 线程，触发警告
            if (val >= 3) {
                $('riskThreadNum').textContent = val;
                modal.classList.remove('hidden');
                
                // 点“退回去”恢复原来的选择，并清空全局缓存
                $('riskCancel').onclick = () => {
                    modal.classList.add('hidden');
                    selectEl.value = previousValue; 
                    // 强行覆盖回之前的设置
                    localStorage.setItem('downloadConcurrency', previousValue);
                };
                
                // 点“确认风险”才真正保存
                $('riskConfirm').onclick = () => {
                    modal.classList.add('hidden');
                    localStorage.setItem('downloadConcurrency', val);
                    previousValue = val;
                };
            } else {
                // 选了 1 或 2，直接安全保存
                localStorage.setItem('downloadConcurrency', val);
                previousValue = val;
            }
        });

        // 初始化时，同步一下当前的 previousValue
        previousValue = selectEl.value;

    }, 1500); // 等待之前的代码渲染完再执行
});

// ==========================================
// 🚀 终极瘦身：给下载列表挤出更多显示空间
// ==========================================
setTimeout(() => {
    const style = document.createElement('style');
    style.innerHTML = `
        /* 1. 整体行距和边距压缩 */
        #downloadTasks .song-item {
            padding: 8px 4px !important; /* 减小上下左右内边距 */
            gap: 6px !important; /* 强制缩小各个 flex 子元素之间的间距 */
        }

        /* 2. 压缩复选框 */
        #downloadTasks .song-check {
            margin: 0 !important;
            transform: scale(0.9); /* 稍微缩小复选框 */
        }

        /* 3. 极限压缩序号 */
        #downloadTasks .song-num {
            width: 20px !important; /* 从原本的 32px 砍到 20px */
            font-size: 11px !important; /* 字体稍微缩小 */
            text-align: right;
        }

        /* 4. 歌名区域强制占满并靠左 */
        #downloadTasks .song-info {
            margin: 0 !important;
            padding: 0 !important;
        }

        /* 5. 右侧状态文字与按钮的极限调整 */
        #downloadTasks .task-status {
            margin-left: 0 !important;
            gap: 2px !important; /* 状态文字和播放键死死贴在一起 */
            min-width: auto !important; /* 取消原本可能限制的宽度 */
        }

        #downloadTasks .task-status-text {
            font-size: 11px !important; /* “已完成”字号缩小到11px，节省空间 */
        }

        /* 6. 压缩播放按钮自带的间距 */
        #downloadTasks .song-play-btn {
            padding: 4px 2px !important;
            margin: 0 !important;
        }
    `;
    document.head.appendChild(style);
}, 1500);

// ==========================================
// 🚀 终极瘦身 PLUS：进一步压缩右侧状态文字
// ==========================================
setTimeout(() => {
    const style = document.createElement('style');
    style.innerHTML = `
        /* 极限缩小状态文字，并稍微压低行高 */
        #downloadTasks .task-status-text {
            font-size: 10px !important; /* 从 11px 缩小到 10px */
            line-height: 1 !important;
            letter-spacing: -0.5px; /* 字间距稍微紧凑一点 */
            transform: scale(0.95); /* 加上缩放魔法，视觉上更小 */
            transform-origin: right center; /* 靠右对齐缩放，不改变布局占位 */
        }

        /* 稍微减小播放按钮的尺寸，让它和文字更协调 */
        #downloadTasks .song-play-btn {
            font-size: 14px !important;
            padding: 2px 4px !important;
        }
    `;
    document.head.appendChild(style);
}, 1800); // 延迟一点执行，确保覆盖之前的样式

// ==========================================
// 🚀 终极排版重构：格式与大小移至右侧，歌手独享左侧
// ==========================================
window.renderQueueUI = function(queue) {
  const el = $('downloadTasks');
  if (!el) return;

  const counts = {
    all: queue.length,
    downloading: queue.filter(t => ['waiting', 'running', 'downloading', 'tagging'].includes(t.status)).length,
    completed: queue.filter(t => ['completed', 'finished', 'exists'].includes(t.status)).length,
    failed: queue.filter(t => ['failed', 'error'].includes(t.status)).length
  };

  let filteredQueue = queue;
  if (currentQueueFilter === 'downloading') {
    filteredQueue = queue.filter(t => ['waiting', 'running', 'downloading', 'tagging'].includes(t.status));
  } else if (currentQueueFilter === 'completed') {
    filteredQueue = queue.filter(t => ['completed', 'finished', 'exists'].includes(t.status));
  } else if (currentQueueFilter === 'failed') {
    filteredQueue = queue.filter(t => ['failed', 'error'].includes(t.status));
  }

  const sortedQueue = [...filteredQueue].reverse();

  const tabsHtml = `
    <div class="queue-tabs">
      <span class="q-tab ${currentQueueFilter === 'all' ? 'active' : ''}" data-filter="all">全部 (${counts.all})</span>
      <span class="q-tab ${currentQueueFilter === 'downloading' ? 'active' : ''}" data-filter="downloading">下载中 (${counts.downloading})</span>
      <span class="q-tab ${currentQueueFilter === 'completed' ? 'active' : ''}" data-filter="completed">已完成 (${counts.completed})</span>
      <span class="q-tab ${currentQueueFilter === 'failed' ? 'active' : ''}" data-filter="failed">错误 (${counts.failed})</span>
    </div>
  `;

  let listHtml = '';
  if (!sortedQueue.length) {
    listHtml = `<div style="color:var(--text2);padding:20px 0;text-align:center;">该分类下暂无任务</div>`;
  } else {
    const statusText = { waiting: '等待中', running: '解析中', downloading: '下载中', tagging: '写入标签', completed: '已完成', finished: '已完成', exists: '已存在', failed: '失败', paused: '已暂停' };
    const statusColor = { waiting: 'var(--text2)', running: 'var(--blue)', downloading: 'var(--blue)', tagging: 'var(--yellow)', completed: 'var(--green)', finished: 'var(--green)', exists: 'var(--green)', failed: 'var(--red)', paused: 'var(--yellow)' };

    listHtml = sortedQueue.map((t, i) => {
      const name = t.songInfo?.name || t.name || '未知歌曲';
      const singer = t.songInfo?.singer || t.singer || '';
      const quality = t.quality || t.songInfo?.quality || 'flac';
      
      let sizeStr = '';
      const byteSize = Number(t.size) || 0;
      if (byteSize > 1024 * 1024 * 1024) sizeStr = (byteSize / 1024 / 1024 / 1024).toFixed(2) + 'GB';
      else if (byteSize > 1024 * 1024) sizeStr = (byteSize / 1024 / 1024).toFixed(1) + 'MB';
      else if (byteSize > 0) sizeStr = (byteSize / 1024).toFixed(0) + 'KB';

      // 🚀 核心修改：左侧只保留歌手，右侧保留格式和大小
      const leftMetaStr = `${esc(singer)}`;
      const rightMetaStr = `${esc(quality)} ${sizeStr ? '· ' + sizeStr : ''}`;
      
      let status = t.status;
      if (window._isQueuePaused && window._pausedIds.includes(t.id)) {
          status = 'paused';
      }

      const isDone = ['finished', 'completed', 'exists'].includes(status);
      const isFailed = ['failed', 'error'].includes(status);
      const isDownloading = status === 'downloading' || status === 'running' || status === 'tagging';
      const pct = t.progress || 0;
      
      let actionBtnHtml = '';
      if (isDone && t.filename) {
          actionBtnHtml = `<button class="song-play-btn" title="播放" onclick="event.stopPropagation(); window.playQueueSong('${t.id}')">▶</button>`;
      } else if (isFailed) {
          actionBtnHtml = `<button class="song-play-btn" title="重试下载" style="color: var(--red); font-weight: bold;" onclick="event.stopPropagation(); window.retryQueueTask('${t.id}')">↻</button>`;
      } else {
          actionBtnHtml = `<div style="width: 24px; flex-shrink: 0;"></div>`;
      }
      
      return `
      <div class="song-item" id="queue-item-${t.id}">
        <input type="checkbox" class="song-check queue-check" data-id="${t.id}" onchange="updateToolbarVisibility()">
        <span class="song-num">${sortedQueue.length - i}</span>
        
        <div class="song-info">
          <div class="song-name" title="${esc(name)}">${esc(name)}</div>
          <div class="song-meta" style="display:flex; justify-content:space-between; align-items:center; margin-top:4px; gap: 8px;">
            <!-- 左侧：纯歌手 -->
            <span style="font-size:12px; color:var(--text2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${leftMetaStr}</span>
            
            <!-- 右侧：格式大小 + 状态/进度 -->
            <span style="display:flex; flex-shrink:0; gap: 4px; align-items:center;">
              <span style="font-size:12px; color:var(--text2);">${rightMetaStr}</span>
              <span id="meta-right-${t.id}" style="font-size:12px; color:var(--text2); font-weight: bold;">
                  ${isDownloading && status !== 'paused' ? `<span style="color:var(--blue);" id="pct-${t.id}">${pct}%</span> <span class="real-speed" style="color:var(--green)" id="speed-${t.id}"></span>` : `<span class="task-status-text" style="color:${statusColor[status] || 'var(--text2)'}; font-size:10px !important; transform:scale(0.95); transform-origin:right center; display:inline-block;">${statusText[status] || status}</span>`}
              </span>
            </span>
          </div>
          ${((isDownloading || status === 'waiting') && status !== 'paused') ? `
            <div class="task-bar" style="margin-top:6px; width:100%; height:3px; background:var(--bg3); border-radius:2px; overflow:hidden;">
              <div class="task-bar-fill" id="bar-${t.id}" style="width: ${pct}%; height:100%; background:var(--blue); transition:width 0.3s; ${isDownloading && pct===0 ? 'animation: pulse 1.5s infinite;' : ''}"></div>
            </div>
          ` : ''}
        </div>
        
        ${actionBtnHtml}
      </div>`;
    }).join('');
  }

    // 🚀 核心修改：如果在一键重试分类下，把按钮放到列表上方靠右
  let actionHtml = '';
  if (retryAllBtnHtml) {
      actionHtml = `<div style="display:flex; justify-content:flex-end; margin: 10px 0;">${retryAllBtnHtml}</div>`;
  }

  el.innerHTML = tabsHtml + actionHtml + `<div class="song-list">${listHtml}</div>`;

  el.querySelectorAll('.q-tab').forEach(tab => {
    tab.onclick = () => {
      currentQueueFilter = tab.dataset.filter;
      renderQueueUI(queue); 
    };
  });
};

// ==========================================
// 🚀 终极排版 V2：右侧上下堆叠（上大小、下状态）
// ==========================================
window.renderQueueUI = function(queue) {
  const el = $('downloadTasks');
  if (!el) return;

  const counts = {
    all: queue.length,
    downloading: queue.filter(t => ['waiting', 'running', 'downloading', 'tagging'].includes(t.status)).length,
    completed: queue.filter(t => ['completed', 'finished', 'exists'].includes(t.status)).length,
    failed: queue.filter(t => ['failed', 'error'].includes(t.status)).length
  };

  let filteredQueue = queue;
  if (currentQueueFilter === 'downloading') {
    filteredQueue = queue.filter(t => ['waiting', 'running', 'downloading', 'tagging'].includes(t.status));
  } else if (currentQueueFilter === 'completed') {
    filteredQueue = queue.filter(t => ['completed', 'finished', 'exists'].includes(t.status));
  } else if (currentQueueFilter === 'failed') {
    filteredQueue = queue.filter(t => ['failed', 'error'].includes(t.status));
  }

  const sortedQueue = [...filteredQueue].reverse();

  const tabsHtml = `
    <div class="queue-tabs">
      <span class="q-tab ${currentQueueFilter === 'all' ? 'active' : ''}" data-filter="all">全部 (${counts.all})</span>
      <span class="q-tab ${currentQueueFilter === 'downloading' ? 'active' : ''}" data-filter="downloading">下载中 (${counts.downloading})</span>
      <span class="q-tab ${currentQueueFilter === 'completed' ? 'active' : ''}" data-filter="completed">已完成 (${counts.completed})</span>
      <span class="q-tab ${currentQueueFilter === 'failed' ? 'active' : ''}" data-filter="failed">错误 (${counts.failed})</span>
    </div>
  `;

  let listHtml = '';
  if (!sortedQueue.length) {
    listHtml = `<div style="color:var(--text2);padding:20px 0;text-align:center;">该分类下暂无任务</div>`;
  } else {
    const statusText = { waiting: '等待中', running: '解析中', downloading: '下载中', tagging: '写入标签', completed: '已完成', finished: '已完成', exists: '已存在', failed: '失败', paused: '已暂停' };
    const statusColor = { waiting: 'var(--text2)', running: 'var(--blue)', downloading: 'var(--blue)', tagging: 'var(--yellow)', completed: 'var(--green)', finished: 'var(--green)', exists: 'var(--green)', failed: 'var(--red)', paused: 'var(--yellow)' };

    listHtml = sortedQueue.map((t, i) => {
      const name = t.songInfo?.name || t.name || '未知歌曲';
      const singer = t.songInfo?.singer || t.singer || '';
      const quality = t.quality || t.songInfo?.quality || 'flac';
      
      let sizeStr = '';
      const byteSize = Number(t.size) || 0;
      if (byteSize > 1024 * 1024 * 1024) sizeStr = (byteSize / 1024 / 1024 / 1024).toFixed(2) + 'GB';
      else if (byteSize > 1024 * 1024) sizeStr = (byteSize / 1024 / 1024).toFixed(1) + 'MB';
      else if (byteSize > 0) sizeStr = (byteSize / 1024).toFixed(0) + 'KB';

      const metaStr = `${esc(quality)} ${sizeStr ? '· ' + sizeStr : ''}`;
      
      let status = t.status;
      if (window._isQueuePaused && window._pausedIds.includes(t.id)) {
          status = 'paused';
      }

      const isDone = ['finished', 'completed', 'exists'].includes(status);
      const isFailed = ['failed', 'error'].includes(status);
      const isDownloading = status === 'downloading' || status === 'running' || status === 'tagging';
      const pct = t.progress || 0;
      
      let actionBtnHtml = '';
      if (isDone && t.filename) {
          actionBtnHtml = `<button class="song-play-btn" title="播放" onclick="event.stopPropagation(); window.playQueueSong('${t.id}')">▶</button>`;
      } else if (isFailed) {
          actionBtnHtml = `<button class="song-play-btn" title="重试下载" style="color: var(--red); font-weight: bold;" onclick="event.stopPropagation(); window.retryQueueTask('${t.id}')">↻</button>`;
      } else {
          actionBtnHtml = `<div style="width: 24px; flex-shrink: 0;"></div>`;
      }
      
      // 🚀 核心改动：右侧文本垂直堆叠（上行格式大小，下行状态/进度）
      return `
      <div class="song-item" id="queue-item-${t.id}">
        <input type="checkbox" class="song-check queue-check" data-id="${t.id}" onchange="updateToolbarVisibility()">
        <span class="song-num">${sortedQueue.length - i}</span>
        
        <div class="song-info">
          <div class="song-name" title="${esc(name)}">${esc(name)}</div>
          <div class="song-singer" style="font-size:12px; color:var(--text2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
            ${esc(singer)}
          </div>
          ${((isDownloading || status === 'waiting') && status !== 'paused') ? `
            <div class="task-bar" style="margin-top:6px; width:100%; height:3px; background:var(--bg3); border-radius:2px; overflow:hidden;">
              <div class="task-bar-fill" id="bar-${t.id}" style="width: ${pct}%; height:100%; background:var(--blue); transition:width 0.3s; ${isDownloading && pct===0 ? 'animation: pulse 1.5s infinite;' : ''}"></div>
            </div>
          ` : ''}
        </div>
        
        <!-- 右侧区域：垂直堆叠 + 播放按钮 -->
        <div style="display:flex; align-items:center; flex-shrink:0; gap:8px; margin-left:10px;">
            <!-- 文本堆叠区 -->
            <div style="display:flex; flex-direction:column; align-items:flex-end; gap:2px;">
                <!-- 上行：格式+大小 -->
                <span style="font-size:11px; color:var(--text2); white-space:nowrap;">${metaStr}</span>
                <!-- 下行：状态或进度 -->
                <span style="font-size:12px; font-weight:bold; white-space:nowrap;">
                    ${isDownloading && status !== 'paused' 
                      ? `<span style="color:var(--blue);" id="pct-${t.id}">${pct}%</span> <span class="real-speed" style="color:var(--green)" id="speed-${t.id}"></span>` 
                      : `<span style="color:${statusColor[status] || 'var(--text2)'};">${statusText[status] || status}</span>`}
                </span>
            </div>
            <!-- 按钮区 -->
            ${actionBtnHtml}
        </div>
      </div>`;
    }).join('');
  }

    // 🚀 核心修改：如果在一键重试分类下，把按钮放到列表上方靠右
  let actionHtml = '';
  if (retryAllBtnHtml) {
      actionHtml = `<div style="display:flex; justify-content:flex-end; margin: 10px 0;">${retryAllBtnHtml}</div>`;
  }

  el.innerHTML = tabsHtml + actionHtml + `<div class="song-list">${listHtml}</div>`;

  el.querySelectorAll('.q-tab').forEach(tab => {
    tab.onclick = () => {
      currentQueueFilter = tab.dataset.filter;
      renderQueueUI(queue); 
    };
  });
};

// ==========================================
// 🚀 视觉升级：为下载列表注入“卡片质感”底色
// ==========================================
setTimeout(() => {
    const style = document.createElement('style');
    style.innerHTML = `
        /* 给每一行歌曲加底色，形成卡片感 */
        #downloadTasks .song-item {
            background-color: var(--bg3) !important; /* 使用系统中比背景稍亮一级的颜色 */
            border-radius: 8px !important; /* 圆角让视觉更柔和 */
            margin-bottom: 6px !important; /* 卡片之间的间隙 */
            padding: 12px 10px !important; /* 恢复一点内边距让内容不贴边 */
            border: 1px solid color-mix(in srgb, var(--border) 40%, transparent) !important; /* 极细微的边框，增加立体感 */
            transition: background-color 0.2s; /* 加个平滑过渡 */
        }

        /* 鼠标悬浮/点击时的反馈（如果是电脑端用的话） */
        #downloadTasks .song-item:hover {
            background-color: color-mix(in srgb, var(--bg3) 80%, var(--text) 10%) !important; 
        }
        
        /* 强制覆盖之前的紧凑样式，让卡片好看 */
        #downloadTasks .song-list {
            gap: 0 !important; /* 清空原本的上下间隔，用 margin-bottom 控制 */
        }
    `;
    document.head.appendChild(style);
}, 1800);

// ==========================================
// 🚀 极致瘦身：压缩卡片高度，让列表更紧凑
// ==========================================
setTimeout(() => {
    const style = document.createElement('style');
    style.innerHTML = `
        /* 1. 极度压缩卡片上下内边距和卡片间距 */
        #downloadTasks .song-item {
            padding: 6px 8px !important; /* 上下从 10px 砍到 6px */
            margin-bottom: 4px !important; /* 卡片间距从 8px 砍到 4px */
            border-radius: 6px !important;
        }

        /* 2. 压缩歌名和歌手的行高，让两行字死死贴在一起 */
        #downloadTasks .song-name {
            line-height: 1.2 !important; 
            margin: 0 !important;
        }
        
        #downloadTasks .song-singer {
            line-height: 1.2 !important;
            margin-top: 2px !important; /* 歌手距离歌名的间隙 */
        }

        /* 3. 压缩内部堆叠区的行高 */
        #downloadTasks .song-info {
            margin: 0 !important;
            padding: 0 !important;
        }

        /* 4. 压缩右侧格式/状态堆叠的间距 */
        #downloadTasks .song-info > div:last-child {
            gap: 0px !important;
        }

        /* 5. 如果有进度条，缩短它的上边距 */
        #downloadTasks .task-bar {
            margin-top: 4px !important;
            height: 2px !important;
        }
        
        /* 6. 顺手把复选框也压扁一点 */
        #downloadTasks .song-check {
            margin: 0 4px 0 0 !important;
        }
    `;
    document.head.appendChild(style);
}, 2500); // 延迟 2.5 秒确保覆盖所有之前的渲染样式

// ==========================================
// 🚀 全局视觉统一：纯白字体 + 搜索/排行榜卡片底色
// ==========================================
setTimeout(() => {
    const style = document.createElement('style');
    style.innerHTML = `
        /* 1. 所有列表的歌名全部改为纯白，加一点微加粗提升质感 */
        .song-list .song-name {
            color: #ffffff !important;
            font-weight: 500 !important;
        }

        /* 2. 给“搜索”和“排行榜”也套用卡片底色（保持原本间距不变） */
        #tab-search .song-item,
        #tab-rank .song-item {
            background-color: var(--bg3) !important; 
            border-radius: 8px !important;
            border: 1px solid color-mix(in srgb, var(--border) 40%, transparent) !important;
            padding: 10px 12px !important; /* 保持原有的舒适内边距 */
        }

        /* 3. 确保这两个页面的列表按原有的 gap 间距整齐排列 */
        #tab-search .song-list,
        #tab-rank .song-list {
            gap: 8px !important; /* 间距绝对不能变 */
        }

        /* 4. 微调搜索/排行榜右侧的播放按钮位置，让它和卡片完美融合 */
        #tab-search .song-item .song-play-btn,
        #tab-rank .song-item .song-play-btn {
            margin-left: 5px !important;
        }
    `;
    document.head.appendChild(style);
}, 2000);

// ==========================================
// 🚀 最终排版统一：间距 8px，高度 5px
// ==========================================
setTimeout(() => {
    const style = document.createElement('style');
    style.innerHTML = `
        /* 1. 统一所有列表（下载、搜索、排行榜）的歌曲间距为 8px */
        #downloadTasks .song-list,
        #tab-search .song-list,
        #tab-rank .song-list {
            gap: 8px !important; 
            display: flex !important;
            flex-direction: column !important;
        }

        /* 2. 统一所有卡片的上下高度（内边距）为 5px，并取消下载页原有的底边距 */
        #downloadTasks .song-item,
        #tab-search .song-item,
        #tab-rank .song-item {
            padding: 5px 12px !important; /* 上下 5px，左右 12px */
            margin-bottom: 0 !important; /* 清空下载页之前的 margin，统一由 gap 控制 */
            min-height: auto !important;
        }

        /* 3. 确保字体在极度压缩高度后依然清晰居中 */
        #downloadTasks .song-info,
        #tab-search .song-info,
        #tab-rank .song-info {
            display: flex !important;
            flex-direction: column !important;
            justify-content: center !important;
        }
        
        /* 4. 歌名行高微调，防止 5px 高度下文字被切掉 */
        .song-list .song-name {
            line-height: 1.3 !important;
        }
        .song-list .song-singer {
            line-height: 1.2 !important;
            margin-top: 1px !important;
        }
    `;
    document.head.appendChild(style);
}, 2000);

// ==========================================
// 🚀 绝对像素级统一：强制所有列表高度完全一致
// ==========================================
setTimeout(() => {
    const style = document.createElement('style');
    style.innerHTML = `
        /* 1. 强制所有列表容器，使用一模一样的 flex 布局和间距 */
        #downloadTasks .song-list,
        #tab-search .song-list,
        #tab-rank .song-list {
            display: flex !important;
            flex-direction: column !important;
            gap: 8px !important; 
        }

        /* 2. 强制所有卡片高度、边距、圆角完全死定，不允许内部撑开 */
        #downloadTasks .song-item,
        #tab-search .song-item,
        #tab-rank .song-item {
            padding: 5px 12px !important; 
            margin: 0 !important;
            min-height: 46px !important; /* 强制最小高度，保证一样高 */
            height: 46px !important;     /* 强制死高度，无论内容多长 */
            box-sizing: border-box !important;
            align-items: center !important;
        }

        /* 3. 统一内部文字容器，强制绝对居中，干掉多余的 margin */
        .song-list .song-info {
            display: flex !important;
            flex-direction: column !important;
            justify-content: center !important;
            margin: 0 !important;
            padding: 0 !important;
        }

        /* 4. 死死锁定两行文字的行高，谁也别想多占 1 像素 */
        .song-list .song-name {
            font-size: 14px !important;
            line-height: 1.2 !important;
            margin: 0 !important;
        }
        
        .song-list .song-singer {
            font-size: 12px !important;
            line-height: 1.2 !important;
            margin-top: 2px !important; 
            margin-bottom: 0 !important;
        }
        
        /* 5. 统一复选框大小，防止它撑高 */
        .song-list .song-check {
            margin: 0 6px 0 0 !important;
            width: 16px !important;
            height: 16px !important;
        }
    `;
    document.head.appendChild(style);
}, 2000);

// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        // 强行覆盖平台按钮的点击逻辑
        document.querySelectorAll('.platform-btn').forEach(b => {
            b.onclick = async () => {
                // 1. 切换选中状态
                document.querySelectorAll('.platform-btn').forEach(x => x.classList.remove('active'));
                b.classList.add('active');
                currentSource = b.dataset.source;
                
                // 2. 显示加载中
                $('rankList').innerHTML = '<div class="rank-loading">榜单加载中，请稍等...</div>';
                
                // 3. 加载该平台的榜单分类
                await loadRankCats();
                
                // 4. 强行打开榜单弹窗
                if (window.innerWidth <= 768) {
                    openRankSidebar();
                    // 确保遮罩层显示
                    const overlay = $('catOverlay');
                    if (overlay) overlay.classList.add('show');
                }
            };
        });
        
        // 顺便修复一下关闭逻辑：点击遮罩关闭弹窗
        const overlay = $('catOverlay');
        if (overlay) {
            overlay.onclick = () => {
                closeRankSidebar();
                overlay.classList.remove('show');
            };
        }
    }, 1500); // 延迟确保原版事件绑定完成后再覆盖
});


document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        // 1. 废掉原版的自动弹窗（防止第一次加载时乱弹）
        window.openRankSidebar = function() { /* 什么都不做 */ };
        
        // 2. 定义我们自己的弹窗显示/隐藏
        window.myShowRankModal = function() {
            const sb = $('rankSidebar');
            const overlay = $('catOverlay');
            if (sb) sb.classList.add('open');
            if (overlay) overlay.classList.add('show');
        };
        window.myCloseRankModal = function() {
            const sb = $('rankSidebar');
            const overlay = $('catOverlay');
            if (sb) sb.classList.remove('open');
            if (overlay) overlay.classList.remove('show');
        };

        // 3. 彻底重写平台按钮点击事件（不调用原版逻辑）
        document.querySelectorAll('.platform-btn').forEach(b => {
            b.onclick = async () => {
                // 切换颜色
                document.querySelectorAll('.platform-btn').forEach(x => x.classList.remove('active'));
                b.classList.add('active');
                currentSource = b.dataset.source;
                $('rankList').innerHTML = '<div class="rank-loading">榜单加载中，请稍等...</div>';
                
                try {
                    // 自己拉取数据
                    const data = await api(`/api/music/leaderboard/boards?source=${currentSource}`);
                    const boards = data.list || [];
                    const container = $('rankCats');
                    const groups = categorizeBoards(boards);
                    
                    // 自己渲染列表
                    container.innerHTML = groups.map(g => `
                        <div class="rank-group">
                            ${g.name ? `<div class="rank-group-title">${esc(g.name)}</div>` : ''}
                            ${g.items.map(item => {
                                const id = item.bangid || item.id;
                                const name = item.name;
                                return `<button class="rank-cat" data-id="${escAttr(id)}" data-name="${escAttr(name)}">${esc(name)}</button>`;
                            }).join('')}
                        </div>
                    `).join('');

                    // 自己绑定列表项的点击事件（点了才关闭弹窗）
                    container.querySelectorAll('.rank-cat').forEach(btn => {
                        btn.onclick = () => {
                            container.querySelectorAll('.rank-cat').forEach(x => x.classList.remove('active'));
                            btn.classList.add('active');
                            // 加载歌曲
                            loadRankSongs(btn.dataset.id, btn.dataset.name);
                            // 关闭弹窗
                            window.myCloseRankModal();
                        };
                    });

                    // 弹出弹窗
                    window.myShowRankModal();
                } catch(e) {
                    $('rankList').innerHTML = '<div class="rank-loading" style="color:red">加载失败</div>';
                }
            };
        });

        // 4. 点击遮罩层关闭
        const overlay = $('catOverlay');
        if (overlay) {
            overlay.onclick = () => window.myCloseRankModal();
        }

    }, 1000);
});
setTimeout(() => {
    const headers = document.querySelectorAll('.rank-header, .cat-overlay');
    headers.forEach(h => h.remove());
}, 1000);


// ==========================================
// 🚀 终极覆盖：物理弹窗渲染逻辑
// ==========================================
setTimeout(() => {
    const modalEl = document.getElementById('myGlobalRankModal');
    const contentEl = document.getElementById('myGlobalRankContent');

    // 彻底覆盖原版弹窗打开函数，让它失效
    window.openRankSidebar = function() {};
    
    // 覆盖平台按钮点击事件（使用事件委托，最高优先级）
    document.body.addEventListener('click', async (e) => {
        // 捕获所有平台按钮的点击
        if (e.target.closest('.platform-btn')) {
            const btn = e.target.closest('.platform-btn');
            e.preventDefault();
            e.stopPropagation();

            document.querySelectorAll('.platform-btn').forEach(x => x.classList.remove('active'));
            btn.classList.add('active');
            const source = btn.dataset.source;
            currentSource = source;

            // 显示自定义弹窗
            modalEl.style.display = 'flex';
            contentEl.innerHTML = '<div style="padding:30px;text-align:center;color:var(--text);">榜单加载中...</div>';

            try {
                const data = await api(`/api/music/leaderboard/boards?source=${source}`);
                const boards = data.list || [];
                
                if (!boards.length) throw new Error('未获取到榜单');

                const groups = categorizeBoards(boards);
                let html = `<div style="flex:1; overflow-y:auto; padding:20px;">`;
                
                html += groups.map(g => `
                    <div class="rank-group">
                        ${g.name ? `<div style="text-align:center;font-size:20px;font-weight:900;font-style:italic;margin:15px 0 10px; color:var(--text); border-bottom:1px dashed var(--border); padding-bottom:5px;">${esc(g.name)}</div>` : ''}
                        ${g.items.map(item => {
                            const id = item.bangid || item.id;
                            const name = item.name;
                            return `<button class="modal-cat-btn" data-id="${escAttr(id)}" data-name="${escAttr(name)}" style="display:block;width:100%;text-align:left;padding:12px 16px;margin-bottom:8px;border-radius:8px;background:transparent;border:1px solid transparent;color:var(--text);font-size:15px;cursor:pointer;">${esc(name)}</button>`;
                        }).join('')}
                    </div>
                `).join('');
                
                html += `</div>`;
                contentEl.innerHTML = html;

                // 绑定弹窗内按钮点击
                contentEl.querySelectorAll('.modal-cat-btn').forEach(catBtn => {
                    catBtn.onclick = () => {
                        modalEl.style.display = 'none';
                        loadRankSongs(catBtn.dataset.id, catBtn.dataset.name);
                    };
                });

            } catch (err) {
                contentEl.innerHTML = `<div style="padding:30px;text-align:center;color:red;">加载失败: ${err.message}</div>`;
                setTimeout(() => { modalEl.style.display = 'none'; }, 2000);
            }
        }
    }, true); // 使用捕获阶段拦截，原版绝对抢不过我们

    // 点击黑色背景关闭
    modalEl.onclick = (e) => {
        if (e.target === modalEl) modalEl.style.display = 'none';
    };

    console.log("✅ 物理弹窗接管完毕！");
}, 1000);

// ==========================================
// 🚀 终极修复：弹窗榜单点击无反应
// ==========================================
setTimeout(() => {
    const modalEl = document.getElementById('myGlobalRankModal');
    const contentEl = document.getElementById('myGlobalRankContent');

    // 监听弹窗内所有榜单按钮的点击
    contentEl.addEventListener('click', async (e) => {
        // 找到被点击的按钮
        const catBtn = e.target.closest('.modal-cat-btn');
        if (!catBtn) return;

        e.preventDefault();
        e.stopPropagation();

        // 1. 无论下面发生什么，点完先秒关弹窗，给用户反馈
        modalEl.style.display = 'none';

        const boardId = catBtn.dataset.id;
        const boardName = catBtn.dataset.name;

        const container = document.getElementById('rankList');
        if (container) container.innerHTML = '<div class="rank-loading" style="padding:20px; text-align:center; color:var(--text);">榜单加载中，请稍等...</div>';

        try {
            // 2. 强行调用 API 获取歌曲
            const res = await api(`/api/music/leaderboard/list?source=${currentSource}&bangid=${boardId}&page=1`);
            
            // 3. 把数据强行塞进列表里，绕过原版的错误
            let songs = res.list || res || [];
            if (Array.isArray(songs) && container) {
                // 借用原版的渲染函数（如果有的话），否则简单渲染
                if (typeof renderSongList === 'function') {
                    renderSongList(container, songs, 'rank');
                } else {
                    container.innerHTML = songs.map(s => `<div class="song-item"><span class="song-name">${esc(s.name)}</span></div>`).join('');
                }
            } else {
                if (container) container.innerHTML = '<div style="color:red; padding:20px;">没有加载到歌曲</div>';
            }
        } catch (err) {
            console.error("强制加载失败:", err);
            if (container) container.innerHTML = '<div style="color:red; padding:20px;">加载失败</div>';
        }
    });
    
    console.log("✅ 弹窗点击事件已强力接管！");
}, 1500);


// ==========================================
// 🚀 最终版：强制接管榜单加载，并更新物理显示框
// ==========================================
setTimeout(() => {
    // 1. 重写 loadRankSongs
    window.loadRankSongs = async function(boardId, boardName) {
        // 更新物理显示框
        const displayEl = document.getElementById('currentBoardDisplay');
        if (displayEl) {
            displayEl.innerHTML = `
                <span>${boardName}</span>
                <span style="font-size: 13px; color: var(--text2); font-style: normal; font-weight: normal; margin-left: 8px;">100首</span>
            `;
        }

        // 存入本地记忆
        try {
            localStorage.setItem('nas_last_rank', JSON.stringify({ id: boardId, name: boardName, source: currentSource }));
        } catch (e) {}

        const container = document.getElementById('rankList');
        if (container) {
            container.innerHTML = '<div class="rank-loading" style="padding:20px; text-align:center; color:var(--text2);">加载中...</div>';
        }

        // 强行请求数据
        try {
            const res = await api(`/api/music/leaderboard/list?source=${currentSource}&bangid=${boardId}&page=1`, { timeout: 15000 });
            let songs = res.list || res || [];
            
            if (Array.isArray(songs) && songs.length > 0) {
                if (typeof renderSongList === 'function') {
                    renderSongList(container, songs, 'rank');
                }
            } else {
                if (container) container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text2);">暂无歌曲</div>';
            }
        } catch (err) {
            if (container) container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--red);">加载失败</div>';
        }
    };

    // 2. 重写 loadRankCats，切断原版的默认自动加载逻辑
    window.loadRankCats = async function() {
        const container = $('rankCats');
        if (container) container.innerHTML = '<div style="padding:10px;text-align:center;color:var(--text2);">加载中...</div>';
        
        try {
            const data = await api(`/api/music/leaderboard/boards?source=${currentSource}`);
            const boards = data.list || [];
            if (!boards.length) throw new Error('empty');
            renderRankCats(container, boards);
            
            // 只有在没有记忆的情况下，才自动加载第一个榜单
            let loadedFromMemory = false;
            try {
                const saved = JSON.parse(localStorage.getItem('nas_last_rank'));
                if (saved && currentSource === saved.source) {
                    window.loadRankSongs(saved.id, saved.name);
                    loadedFromMemory = true;
                }
            } catch (e) {}

            if (!loadedFromMemory && boards.length > 0) {
                window.loadRankSongs(boards[0].bangid || boards[0].id, boards[0].name);
            }

        } catch (e) {
            const defaults = { kw: [{ name: '热歌榜', id: '16' }] };
            const cats = defaults[currentSource] || defaults.kw;
            renderRankCats(container, cats);
            if (cats.length > 0) window.loadRankSongs(cats[0].id, cats[0].name);
        }
    };

    // 3. 如果用户刷新了页面，恢复记忆中的文字显示
    setTimeout(() => {
        try {
            const saved = JSON.parse(localStorage.getItem('nas_last_rank'));
            const displayEl = document.getElementById('currentBoardDisplay');
            if (saved && displayEl && currentSource === saved.source) {
                displayEl.innerHTML = `
                    <span>${saved.name}</span>
                    <span style="font-size: 13px; color: var(--text2); font-style: normal; font-weight: normal; margin-left: 8px;">100首</span>
                `;
            }
        } catch (e) {}
    }, 500);

    console.log("✅ 榜单显示逻辑已彻底修复！");
}, 1000);

// ==========================================
// 🚀 完美呈现：平台名 + 榜单名 + 真实动态数量
// ==========================================
setTimeout(() => {
    // 平台中英文映射表
    const platformNames = { kw: '酷我', wy: '网易', tx: 'QQ', kg: '酷狗', mg: '咪咕' };

    // 完全覆盖之前的加载函数
    window.loadRankSongs = async function(boardId, boardName) {
        const displayEl = document.getElementById('currentBoardDisplay');
        const container = document.getElementById('rankList');
        
        // 1. 拿到当前平台的中文名
        const pName = platformNames[currentSource] || currentSource;

        // 2. 请求前：先更新文字为“平台 + 榜单”，数量显示“加载中...”
        if (displayEl) {
            displayEl.innerHTML = `
                <span>${pName} ${boardName}</span>
                <span id="boardSongCount" style="font-size: 13px; color: var(--text2); font-style: normal; font-weight: normal; margin-left: 8px;">加载中...</span>
            `;
        }
        if (container) {
            container.innerHTML = '<div class="rank-loading" style="padding:20px; text-align:center; color:var(--text2);">榜单加载中...</div>';
        }

        // 3. 存入本地记忆
        try {
            localStorage.setItem('nas_last_rank', JSON.stringify({ id: boardId, name: boardName, source: currentSource }));
        } catch (e) {}

        // 4. 向服务器请求真实的榜单数据
        try {
            const res = await api(`/api/music/leaderboard/list?source=${currentSource}&bangid=${boardId}&page=1`, { timeout: 15000 });
            let songs = res.list || res || [];
            
            // 解析真实数量（优先用后端返回的 total，如果没有就数列表长度）
            let count = songs.length;
            if (res.total !== undefined && res.total !== null) {
                count = res.total;
            }

            // 5. 数据回来了，更新真实的“X首”
            const countEl = document.getElementById('boardSongCount');
            if (countEl) {
                countEl.textContent = `${count}首`;
            }

            // 6. 渲染歌曲列表
            if (Array.isArray(songs) && songs.length > 0) {
                if (typeof renderSongList === 'function') {
                    renderSongList(container, songs, 'rank');
                }
            } else {
                if (container) container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text2);">暂无歌曲</div>';
            }
        } catch (err) {
            const countEl = document.getElementById('boardSongCount');
            if (countEl) countEl.textContent = `获取失败`;
            if (container) container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--red);">加载失败</div>';
        }
    };

    // 7. 恢复本地记忆时，也要带上平台名
    setTimeout(() => {
        try {
            const saved = JSON.parse(localStorage.getItem('nas_last_rank'));
            const displayEl = document.getElementById('currentBoardDisplay');
            if (saved && displayEl && currentSource === saved.source) {
                const pName = platformNames[saved.source] || saved.source;
                displayEl.innerHTML = `
                    <span>${pName} ${saved.name}</span>
                    <span id="boardSongCount" style="font-size: 13px; color: var(--text2); font-style: normal; font-weight: normal; margin-left: 8px;">加载中...</span>
                `;
            }
        } catch (e) {}
    }, 500);

    console.log("✅ 平台+榜单+动态数量逻辑已上线！");
}, 1500);

// ==========================================
// 🚀 终极解绑：拆除死锁，直接用 DOM 数量强行显示
// ==========================================
setTimeout(() => {
    // 1. 恢复原本的 api 函数，干掉之前那个导致卡死的防抖锁
    if (window.originalApi) {
        window.api = window.originalApi; 
    }

    // 2. 启动一个“保安”轮询器，只要列表出现，就立刻更新数量
    setInterval(() => {
        const countEl = document.getElementById('boardSongCount');
        const listEl = document.getElementById('rankList');
        const tabRank = document.getElementById('tab-rank');
        
        // 只有在排行榜页面，且当前文字是“加载中”时，才去接管
        if (tabRank && tabRank.classList.contains('active') && countEl && listEl) {
            if (countEl.textContent.includes('加载中') || countEl.textContent.includes('失败')) {
                // 数一数当前列表里到底渲染了多少首歌
                const songCount = listEl.querySelectorAll('.song-item').length;
                if (songCount > 0) {
                    countEl.textContent = `${songCount}首`;
                }
            }
        }
    }, 500); // 每半秒检查一次，绝对漏不掉

    console.log("✅ 页面数量监听器已启动！");
}, 1500);

// ==========================================
// 🚀 终极修复：跳转下载页时强制滚回顶部
// ==========================================
setTimeout(() => {
    // 保存原版函数
    const _originalDownloadToNAS = window.downloadToNAS;
    
    // 重写 downloadToNAS
    window.downloadToNAS = async function(songs, quality) {
        // 先执行原本的下载逻辑（里面包含了 switchTab 跳转）
        if (typeof _originalDownloadToNAS === 'function') {
            await _originalDownloadToNAS.call(window, songs, quality);
        }
        
        // 🚀 核心动作：不管原版怎么滚的，我们强行把所有可能滚动的元素全部归零！
        window.scrollTo(0, 0);
        
        const contentDiv = document.querySelector('.content');
        if (contentDiv) contentDiv.scrollTop = 0;
        
        const bodyDiv = document.body;
        if (bodyDiv) bodyDiv.scrollTop = 0;
        
        // 如果下载页里面有具体的列表容器，也一并归零
        const tabDownload = document.getElementById('tab-download');
        if (tabDownload) tabDownload.scrollTop = 0;

        console.log("✅ 页面已强制滚动到最顶端！");
    };
}, 1500);

// ==========================================
// 🚀 终极防骗：识别 0KB 假完成，强制显示为失败
// ==========================================
window.renderQueueUI = function(queue) {
  const el = $('downloadTasks');
  if (!el) return;

  const counts = {
    all: queue.length,
    downloading: queue.filter(t => ['waiting', 'running', 'downloading', 'tagging'].includes(t.status)).length,
    completed: queue.filter(t => ['completed', 'finished', 'exists'].includes(t.status)).length,
    failed: queue.filter(t => ['failed', 'error'].includes(t.status)).length
  };

  let filteredQueue = queue;
  if (currentQueueFilter === 'downloading') {
    filteredQueue = queue.filter(t => ['waiting', 'running', 'downloading', 'tagging'].includes(t.status));
  } else if (currentQueueFilter === 'completed') {
    filteredQueue = queue.filter(t => ['completed', 'finished', 'exists'].includes(t.status));
  } else if (currentQueueFilter === 'failed') {
    filteredQueue = queue.filter(t => ['failed', 'error'].includes(t.status));
  }

  const sortedQueue = [...filteredQueue].reverse();

  const tabsHtml = `
    <div class="queue-tabs">
      <span class="q-tab ${currentQueueFilter === 'all' ? 'active' : ''}" data-filter="all">全部 (${counts.all})</span>
      <span class="q-tab ${currentQueueFilter === 'downloading' ? 'active' : ''}" data-filter="downloading">下载中 (${counts.downloading})</span>
      <span class="q-tab ${currentQueueFilter === 'completed' ? 'active' : ''}" data-filter="completed">已完成 (${counts.completed})</span>
      <span class="q-tab ${currentQueueFilter === 'failed' ? 'active' : ''}" data-filter="failed">错误 (${counts.failed})</span>
    </div>
  `;

  let listHtml = '';
  if (!sortedQueue.length) {
    listHtml = `<div style="color:var(--text2);padding:20px 0;text-align:center;">该分类下暂无任务</div>`;
  } else {
    const statusText = { waiting: '等待中', running: '解析中', downloading: '下载中', tagging: '写入标签', completed: '已完成', finished: '已完成', exists: '已存在', failed: '下载失败', error: '出错', paused: '已暂停' };
    const statusColor = { waiting: 'var(--text2)', running: 'var(--blue)', downloading: 'var(--blue)', tagging: 'var(--yellow)', completed: 'var(--green)', finished: 'var(--green)', exists: 'var(--green)', failed: 'var(--red)', error: 'var(--red)', paused: 'var(--yellow)' };

    listHtml = sortedQueue.map((t, i) => {
      const name = t.songInfo?.name || t.name || '未知歌曲';
      const singer = t.songInfo?.singer || t.singer || '';
      const quality = t.quality || t.songInfo?.quality || 'flac';
      
      let sizeStr = '';
      const byteSize = Number(t.size) || 0;
      if (byteSize > 1024 * 1024 * 1024) sizeStr = (byteSize / 1024 / 1024 / 1024).toFixed(2) + 'GB';
      else if (byteSize > 1024 * 1024) sizeStr = (byteSize / 1024 / 1024).toFixed(1) + 'MB';
      else if (byteSize > 0) sizeStr = (byteSize / 1024).toFixed(0) + 'KB';

      let status = t.status;
      if (window._isQueuePaused && window._pausedIds.includes(t.id)) {
          status = 'paused';
      }

      // 🚀 核心防骗逻辑：状态是已完成/已存在，但没有大小(0KB)或没有文件名，强行判定为失败！
      if (['completed', 'finished', 'exists'].includes(status)) {
          if (byteSize === 0 || !t.filename) {
              status = 'failed';
          }
      }

      const isDone = ['finished', 'completed', 'exists'].includes(status);
      const isFailed = ['failed', 'error'].includes(status);
      const isDownloading = status === 'downloading' || status === 'running' || status === 'tagging';
      const pct = t.progress || 0;
      
      let actionBtnHtml = '';
      if (isDone && t.filename) {
          actionBtnHtml = `<button class="song-play-btn" title="播放" onclick="event.stopPropagation(); window.playQueueSong('${t.id}')">▶</button>`;
      } else if (isFailed) {
          actionBtnHtml = `<button class="song-play-btn" title="重试下载" style="color: var(--red); font-weight: bold;" onclick="event.stopPropagation(); window.retryQueueTask('${t.id}')">↻</button>`;
      } else {
          actionBtnHtml = `<div style="width: 24px; flex-shrink: 0;"></div>`;
      }
      
      // 如果被判为失败，状态文字也变红
      const displayStatusText = isFailed ? '下载失败' : (statusText[status] || status);
      const displayStatusColor = isFailed ? 'var(--red)' : (statusColor[status] || 'var(--text2)');

      return `
      <div class="song-item" id="queue-item-${t.id}">
        <input type="checkbox" class="song-check queue-check" data-id="${t.id}" onchange="updateToolbarVisibility()">
        <span class="song-num">${sortedQueue.length - i}</span>
        
        <div class="song-info">
          <div class="song-name" title="${esc(name)}">${esc(name)}</div>
          <div class="song-meta" style="display:flex; justify-content:space-between; align-items:center; margin-top:4px; gap: 8px;">
            <span style="font-size:12px; color:var(--text2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${esc(singer)}</span>
            
            <span style="display:flex; flex-shrink:0; gap: 4px; align-items:center;">
              <span style="font-size:12px; color:var(--text2);">${quality} ${sizeStr ? '· ' + sizeStr : ''}</span>
              <span id="meta-right-${t.id}" style="font-size:12px; color:var(--text2); font-weight: bold;">
                  ${isDownloading && status !== 'paused' ? `<span style="color:var(--blue);" id="pct-${t.id}">${pct}%</span> <span class="real-speed" style="color:var(--green)" id="speed-${t.id}"></span>` : `<span class="task-status-text" style="color:${displayStatusColor}; font-size:10px !important; transform:scale(0.95); transform-origin:right center; display:inline-block;">${displayStatusText}</span>`}
              </span>
            </span>
          </div>
          ${((isDownloading || status === 'waiting') && status !== 'paused') ? `
            <div class="task-bar" style="margin-top:6px; width:100%; height:3px; background:var(--bg3); border-radius:2px; overflow:hidden;">
              <div class="task-bar-fill" id="bar-${t.id}" style="width: ${pct}%; height:100%; background:var(--blue); transition:width 0.3s; ${isDownloading && pct===0 ? 'animation: pulse 1.5s infinite;' : ''}"></div>
            </div>
          ` : ''}
        </div>
        
        ${actionBtnHtml}
      </div>`;
    }).join('');
  }

    // 🚀 核心修改：如果在一键重试分类下，把按钮放到列表上方靠右
  let actionHtml = '';
  if (retryAllBtnHtml) {
      actionHtml = `<div style="display:flex; justify-content:flex-end; margin: 10px 0;">${retryAllBtnHtml}</div>`;
  }

  el.innerHTML = tabsHtml + actionHtml + `<div class="song-list">${listHtml}</div>`;

  el.querySelectorAll('.q-tab').forEach(tab => {
    tab.onclick = () => {
      currentQueueFilter = tab.dataset.filter;
      renderQueueUI(queue); 
    };
  });
};

// ==========================================
// 🚀 终极防骗 V2：文件小于 100KB 强制判定为失败
// ==========================================
window.renderQueueUI = function(queue) {
  const el = $('downloadTasks');
  if (!el) return;

  const counts = {
    all: queue.length,
    downloading: queue.filter(t => ['waiting', 'running', 'downloading', 'tagging'].includes(t.status)).length,
    completed: queue.filter(t => ['completed', 'finished', 'exists'].includes(t.status)).length,
    failed: queue.filter(t => ['failed', 'error'].includes(t.status)).length
  };

  let filteredQueue = queue;
  if (currentQueueFilter === 'downloading') {
    filteredQueue = queue.filter(t => ['waiting', 'running', 'downloading', 'tagging'].includes(t.status));
  } else if (currentQueueFilter === 'completed') {
    filteredQueue = queue.filter(t => ['completed', 'finished', 'exists'].includes(t.status));
  } else if (currentQueueFilter === 'failed') {
    filteredQueue = queue.filter(t => ['failed', 'error'].includes(t.status));
  }

  const sortedQueue = [...filteredQueue].reverse();

  const tabsHtml = `
    <div class="queue-tabs">
      <span class="q-tab ${currentQueueFilter === 'all' ? 'active' : ''}" data-filter="all">全部 (${counts.all})</span>
      <span class="q-tab ${currentQueueFilter === 'downloading' ? 'active' : ''}" data-filter="downloading">下载中 (${counts.downloading})</span>
      <span class="q-tab ${currentQueueFilter === 'completed' ? 'active' : ''}" data-filter="completed">已完成 (${counts.completed})</span>
      <span class="q-tab ${currentQueueFilter === 'failed' ? 'active' : ''}" data-filter="failed">错误 (${counts.failed})</span>
    </div>
  `;

  let listHtml = '';
  if (!sortedQueue.length) {
    listHtml = `<div style="color:var(--text2);padding:20px 0;text-align:center;">该分类下暂无任务</div>`;
  } else {
    const statusText = { waiting: '等待中', running: '解析中', downloading: '下载中', tagging: '写入标签', completed: '已完成', finished: '已完成', exists: '已存在', failed: '下载失败', error: '出错', paused: '已暂停' };
    const statusColor = { waiting: 'var(--text2)', running: 'var(--blue)', downloading: 'var(--blue)', tagging: 'var(--yellow)', completed: 'var(--green)', finished: 'var(--green)', exists: 'var(--green)', failed: 'var(--red)', error: 'var(--red)', paused: 'var(--yellow)' };

    listHtml = sortedQueue.map((t, i) => {
      const name = t.songInfo?.name || t.name || '未知歌曲';
      const singer = t.songInfo?.singer || t.singer || '';
      const quality = t.quality || t.songInfo?.quality || 'flac';
      
      let sizeStr = '';
      const byteSize = Number(t.size) || 0;
      if (byteSize > 1024 * 1024 * 1024) sizeStr = (byteSize / 1024 / 1024 / 1024).toFixed(2) + 'GB';
      else if (byteSize > 1024 * 1024) sizeStr = (byteSize / 1024 / 1024).toFixed(1) + 'MB';
      else if (byteSize > 1024) sizeStr = (byteSize / 1024).toFixed(0) + 'KB';

      let status = t.status;
      if (window._isQueuePaused && window._pausedIds.includes(t.id)) {
          status = 'paused';
      }

      // 🚀 核心防骗逻辑 V2：状态是已完成/已存在，但大小异常(小于100KB)或没有文件名，强行判定为失败！
      if (['completed', 'finished', 'exists'].includes(status)) {
          if (byteSize < 100 * 1024 || !t.filename) {
              status = 'failed';
          }
      }

      const isDone = ['finished', 'completed', 'exists'].includes(status);
      const isFailed = ['failed', 'error'].includes(status);
      const isDownloading = status === 'downloading' || status === 'running' || status === 'tagging';
      const pct = t.progress || 0;
      
      let actionBtnHtml = '';
      if (isDone && t.filename) {
          actionBtnHtml = `<button class="song-play-btn" title="播放" onclick="event.stopPropagation(); window.playQueueSong('${t.id}')">▶</button>`;
      } else if (isFailed) {
          actionBtnHtml = `<button class="song-play-btn" title="重试下载" style="color: var(--red); font-weight: bold;" onclick="event.stopPropagation(); window.retryQueueTask('${t.id}')">↻</button>`;
      } else {
          actionBtnHtml = `<div style="width: 24px; flex-shrink: 0;"></div>`;
      }
      
      const displayStatusText = isFailed ? '下载失败' : (statusText[status] || status);
      const displayStatusColor = isFailed ? 'var(--red)' : (statusColor[status] || 'var(--text2)');

      return `
      <div class="song-item" id="queue-item-${t.id}">
        <input type="checkbox" class="song-check queue-check" data-id="${t.id}" onchange="updateToolbarVisibility()">
        <span class="song-num">${sortedQueue.length - i}</span>
        
        <div class="song-info">
          <div class="song-name" title="${esc(name)}">${esc(name)}</div>
          <div class="song-meta" style="display:flex; justify-content:space-between; align-items:center; margin-top:4px; gap: 8px;">
            <span style="font-size:12px; color:var(--text2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${esc(singer)}</span>
            
            <span style="display:flex; flex-shrink:0; gap: 4px; align-items:center;">
              <span style="font-size:12px; color:var(--text2);">${quality} ${sizeStr ? '· ' + sizeStr : ''}</span>
              <span id="meta-right-${t.id}" style="font-size:12px; color:var(--text2); font-weight: bold;">
                  ${isDownloading && status !== 'paused' ? `<span style="color:var(--blue);" id="pct-${t.id}">${pct}%</span> <span class="real-speed" style="color:var(--green)" id="speed-${t.id}"></span>` : `<span class="task-status-text" style="color:${displayStatusColor}; font-size:10px !important; transform:scale(0.95); transform-origin:right center; display:inline-block;">${displayStatusText}</span>`}
              </span>
            </span>
          </div>
          ${((isDownloading || status === 'waiting') && status !== 'paused') ? `
            <div class="task-bar" style="margin-top:6px; width:100%; height:3px; background:var(--bg3); border-radius:2px; overflow:hidden;">
              <div class="task-bar-fill" id="bar-${t.id}" style="width: ${pct}%; height:100%; background:var(--blue); transition:width 0.3s; ${isDownloading && pct===0 ? 'animation: pulse 1.5s infinite;' : ''}"></div>
            </div>
          ` : ''}
        </div>
        
        ${actionBtnHtml}
      </div>`;
    }).join('');
  }

    // 🚀 核心修改：如果在一键重试分类下，把按钮放到列表上方靠右
  let actionHtml = '';
  if (retryAllBtnHtml) {
      actionHtml = `<div style="display:flex; justify-content:flex-end; margin: 10px 0;">${retryAllBtnHtml}</div>`;
  }

  el.innerHTML = tabsHtml + actionHtml + `<div class="song-list">${listHtml}</div>`;

  el.querySelectorAll('.q-tab').forEach(tab => {
    tab.onclick = () => {
      currentQueueFilter = tab.dataset.filter;
      renderQueueUI(queue); 
    };
  });
};

// ==========================================
// 🚀 终极智能重试：跨平台自动搜索并下载
// ==========================================
window.retryQueueTask = async function(id) {
    if (!window._lastQueueData) return;
    const task = window._lastQueueData.find(t => t.id === id);
    if (!task) return;

    // 1. 更改按钮状态，提示正在智能搜索
    const btn = document.querySelector(`#queue-item-${id} button`);
    if (btn) { btn.textContent = '...'; btn.disabled = true; }

    // 提取歌曲信息
    const songInfo = task.songInfo || task;
    const name = songInfo.name || task.name;
    const singer = songInfo.singer || task.singer || '';
    const quality = task.quality || songInfo.quality || 'flac';
    const origSource = songInfo.source || 'kw';

    // 准备搜索的平台顺序（避开原平台，优先搜索其他大平台）
    const allSources = ['kw', 'wy', 'tx', 'kg', 'mg'];
    const sourcesToTry = allSources.filter(s => s !== origSource);

    let finalSongInfo = { ...songInfo }; // 默认兜底用原版信息

    try {
        // 2. 遍历其他平台进行搜索
        for (const src of sourcesToTry) {
            if (btn) btn.textContent = `搜${src}`; // 界面提示正在搜哪个平台
            
            try {
                const q = `${name} ${singer}`.trim();
                const res = await api(`/api/music/search?name=${encodeURIComponent(q)}&source=${src}&type=song&limit=1&page=1`);
                const results = Array.isArray(res) ? res : (res.data || res.list || []);
                
                if (results.length > 0) {
                    // 检查搜到的第一首歌歌名是否对得上（防止搜出完全不相干的）
                    const matchSong = results[0];
                    if (matchSong.name.includes(name.substring(0, 2))) {
                        console.log(`[智能重试] 在 ${src} 找到了平替:`, matchSong);
                        finalSongInfo = {
                            ...songInfo,
                            ...matchSong,
                            source: src,       // 强行替换为新平台
                            quality: quality   // 保持原来选的音质
                        };
                        break; // 找到了就跳出循环，准备下载
                    }
                }
            } catch (e) {
                console.warn(`搜索平台 ${src} 失败:`, e);
            }
        }

        // 3. 清理旧的失败任务
        await fetch('/api/music/cache/queue/remove', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-user-name': '_open', 'x-frontend-auth': localStorage.getItem('nas_music_pwd') },
            body: JSON.stringify({ id: id })
        });

        // 4. 把新搜到的任务重新塞进队列
        await fetch('/api/music/cache/queue', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-user-name': '_open', 'x-frontend-auth': localStorage.getItem('nas_music_pwd') },
            body: JSON.stringify({ 
                tasks: [{ 
                    songInfo: finalSongInfo, 
                    quality: quality 
                }], 
                namingPattern: 'name_singer' 
            })
        });

        // 5. 刷新列表
        startQueuePolling();
        
    } catch (err) {
        console.error("重试发生错误:", err);
        // 如果彻底失败，恢复按钮
        if (btn) { btn.textContent = '↻'; btn.disabled = false; }
        alert('智能重试失败，请检查网络或手动搜索');
    }
};

// ==========================================
// 🚀 终极升级：失败分类重构 + 一键重试
// ==========================================
window.renderQueueUI = function(queue) {
  const el = $('downloadTasks');
  if (!el) return;

  // 🚀 核心防骗判定函数：统一判定什么是“真失败”
  const isTaskFailed = (t) => {
    // 1. 状态本身就是失败/错误
    if (['failed', 'error'].includes(t.status)) return true;
    // 2. 状态是完成，但没有文件、或者文件小于100KB
    if (['completed', 'finished', 'exists'].includes(t.status)) {
        const byteSize = Number(t.size) || 0;
        if (byteSize < 100 * 1024 || !t.filename) return true;
    }
    return false;
  };

  // 🚀 判定函数：判断是否是真正的完成
  const isTaskSuccess = (t) => {
    return ['completed', 'finished', 'exists'].includes(t.status) && !isTaskFailed(t);
  };

  const counts = {
    all: queue.length,
    downloading: queue.filter(t => ['waiting', 'running', 'downloading', 'tagging'].includes(t.status)).length,
    completed: queue.filter(t => isTaskSuccess(t)).length,
    failed: queue.filter(t => isTaskFailed(t)).length
  };

  let filteredQueue = queue;
  if (currentQueueFilter === 'downloading') {
    filteredQueue = queue.filter(t => ['waiting', 'running', 'downloading', 'tagging'].includes(t.status));
  } else if (currentQueueFilter === 'completed') {
    filteredQueue = queue.filter(t => isTaskSuccess(t));
  } else if (currentQueueFilter === 'failed') {
    filteredQueue = queue.filter(t => isTaskFailed(t));
  }

  const sortedQueue = [...filteredQueue].reverse();

  // 新增：一键重试按钮（仅在失败分类下且有失败任务时显示）
  let retryAllBtnHtml = '';
  if (currentQueueFilter === 'failed' && counts.failed > 0) {
      retryAllBtnHtml = `<button class="nav-pill-btn" onclick="window.retryAllFailedTasks()" style="margin-left:auto; white-space:nowrap;">↻ 一键重试</button>`;
  }

  const tabsHtml = `
    <div class="queue-tabs" style="display:flex; align-items:center; flex-wrap:nowrap;">
      <span class="q-tab ${currentQueueFilter === 'all' ? 'active' : ''}" data-filter="all">全部 (${counts.all})</span>
      <span class="q-tab ${currentQueueFilter === 'downloading' ? 'active' : ''}" data-filter="downloading">下载中 (${counts.downloading})</span>
      <span class="q-tab ${currentQueueFilter === 'completed' ? 'active' : ''}" data-filter="completed">已完成 (${counts.completed})</span>
      <span class="q-tab ${currentQueueFilter === 'failed' ? 'active' : ''}" data-filter="failed">失败 (${counts.failed})</span>
      
    </div>
  `;

  let listHtml = '';
  if (!sortedQueue.length) {
    listHtml = `<div style="color:var(--text2);padding:20px 0;text-align:center;">该分类下暂无任务</div>`;
  } else {
    const statusText = { waiting: '等待中', running: '解析中', downloading: '下载中', tagging: '写入标签', completed: '已完成', finished: '已完成', exists: '已存在', failed: '下载失败', error: '出错', paused: '已暂停' };
    const statusColor = { waiting: 'var(--text2)', running: 'var(--blue)', downloading: 'var(--blue)', tagging: 'var(--yellow)', completed: 'var(--green)', finished: 'var(--green)', exists: 'var(--green)', failed: 'var(--red)', error: 'var(--red)', paused: 'var(--yellow)' };

    listHtml = sortedQueue.map((t, i) => {
      const name = t.songInfo?.name || t.name || '未知歌曲';
      const singer = t.songInfo?.singer || t.singer || '';
      const quality = t.quality || t.songInfo?.quality || 'flac';
      
      let sizeStr = '';
      const byteSize = Number(t.size) || 0;
      if (byteSize > 1024 * 1024 * 1024) sizeStr = (byteSize / 1024 / 1024 / 1024).toFixed(2) + 'GB';
      else if (byteSize > 1024 * 1024) sizeStr = (byteSize / 1024 / 1024).toFixed(1) + 'MB';
      else if (byteSize > 1024) sizeStr = (byteSize / 1024).toFixed(0) + 'KB';

      let status = t.status;
      if (window._isQueuePaused && window._pausedIds.includes(t.id)) {
          status = 'paused';
      }

      const isFailed = isTaskFailed(t);
      const isDone = isTaskSuccess(t);
      const isDownloading = status === 'downloading' || status === 'running' || status === 'tagging';
      const pct = t.progress || 0;
      
      let actionBtnHtml = '';
      if (isDone) {
          actionBtnHtml = `<button class="song-play-btn" title="播放" onclick="event.stopPropagation(); window.playQueueSong('${t.id}')">▶</button>`;
      } else if (isFailed) {
          actionBtnHtml = `<button class="song-play-btn" title="重试下载" style="color: var(--red); font-weight: bold;" onclick="event.stopPropagation(); window.retryQueueTask('${t.id}')">↻</button>`;
      } else {
          actionBtnHtml = `<div style="width: 24px; flex-shrink: 0;"></div>`;
      }
      
      const displayStatusText = isFailed ? '下载失败' : (statusText[status] || status);
      const displayStatusColor = isFailed ? 'var(--red)' : (statusColor[status] || 'var(--text2)');

      return `
      <div class="song-item" id="queue-item-${t.id}">
        <input type="checkbox" class="song-check queue-check" data-id="${t.id}" onchange="updateToolbarVisibility()">
        <span class="song-num">${sortedQueue.length - i}</span>
        
        <div class="song-info">
          <div class="song-name" title="${esc(name)}">${esc(name)}</div>
          <div class="song-meta" style="display:flex; justify-content:space-between; align-items:center; margin-top:4px; gap: 8px;">
            <span style="font-size:12px; color:var(--text2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${esc(singer)}</span>
            <span style="display:flex; flex-shrink:0; gap: 4px; align-items:center;">
              <span style="font-size:12px; color:var(--text2);">${quality} ${sizeStr ? '· ' + sizeStr : ''}</span>
              <span id="meta-right-${t.id}" style="font-size:12px; color:var(--text2); font-weight: bold;">
                  ${isDownloading && status !== 'paused' ? `<span style="color:var(--blue);" id="pct-${t.id}">${pct}%</span> <span class="real-speed" style="color:var(--green)" id="speed-${t.id}"></span>` : `<span class="task-status-text" style="color:${displayStatusColor}; font-size:10px !important; transform:scale(0.95); transform-origin:right center; display:inline-block;">${displayStatusText}</span>`}
              </span>
            </span>
          </div>
          ${((isDownloading || status === 'waiting') && status !== 'paused') ? `
            <div class="task-bar" style="margin-top:6px; width:100%; height:3px; background:var(--bg3); border-radius:2px; overflow:hidden;">
              <div class="task-bar-fill" id="bar-${t.id}" style="width: ${pct}%; height:100%; background:var(--blue); transition:width 0.3s; ${isDownloading && pct===0 ? 'animation: pulse 1.5s infinite;' : ''}"></div>
            </div>
          ` : ''}
        </div>
        ${actionBtnHtml}
      </div>`;
    }).join('');
  }

    // 🚀 核心修改：如果在一键重试分类下，把按钮放到列表上方靠右
  let actionHtml = '';
  if (retryAllBtnHtml) {
      actionHtml = `<div style="display:flex; justify-content:flex-end; margin: 10px 0;">${retryAllBtnHtml}</div>`;
  }

  el.innerHTML = tabsHtml + actionHtml + `<div class="song-list">${listHtml}</div>`;

  el.querySelectorAll('.q-tab').forEach(tab => {
    tab.onclick = () => {
      currentQueueFilter = tab.dataset.filter;
      renderQueueUI(queue); 
    };
  });
};

// 🚀 一键重试逻辑
window.retryAllFailedTasks = async function() {
    if (!window._lastQueueData) return;
    
    // 筛选出所有失败的任务
    const failedTasks = window._lastQueueData.filter(t => {
        if (['failed', 'error'].includes(t.status)) return true;
        if (['completed', 'finished', 'exists'].includes(t.status)) {
            const byteSize = Number(t.size) || 0;
            if (byteSize < 100 * 1024 || !t.filename) return true;
        }
        return false;
    });

    if (!failedTasks.length) return alert('当前没有失败的任务');
    if (!confirm(`确定要一键重试这 ${failedTasks.length} 首歌曲吗？`)) return;

    // 依次触发重试（为了防止并发过高，间隔 800 毫秒执行）
    for (let i = 0; i < failedTasks.length; i++) {
        await window.retryQueueTask(failedTasks[i].id);
        await new Promise(r => setTimeout(r, 800));
    }
};

// ==========================================
// 🚀 终极修复：跳转下载页时强制切回“全部”标签
// ==========================================
setTimeout(() => {
    const _originalDownloadToNAS_Final = window.downloadToNAS;
    
    window.downloadToNAS = async function(songs, quality) {
        // 1. 切换前，强行把分类状态重置为“全部”
        window.currentQueueFilter = 'all';
        
        // 2. 如果已经拿到了数据，立刻重绘一次，保证切过去的时候已经是“全部”页
        if (window._lastQueueData && typeof window.renderQueueUI === 'function') {
            window.renderQueueUI(window._lastQueueData);
        }

        // 3. 执行原有的下载逻辑（包含跳转）
        if (typeof _originalDownloadToNAS_Final === 'function') {
            await _originalDownloadToNAS_Final.call(window, songs, quality);
        }

        // 4. 跳过去之后，强行滚动到最顶端
        window.scrollTo(0, 0);
        const contentDiv = document.querySelector('.content');
        if (contentDiv) contentDiv.scrollTop = 0;
        
        console.log("✅ 已强制切回全部并置顶！");
    };
}, 2000);

// ==========================================
// 🚀 终极强制：物理点击“全部”按钮
// ==========================================
setTimeout(() => {
    const _originalDownloadToNAS_Ultimate = window.downloadToNAS;
    
    window.downloadToNAS = async function(songs, quality) {
        // 先执行原本的下载逻辑（里面包含切 Tab）
        if (typeof _originalDownloadToNAS_Ultimate === 'function') {
            await _originalDownloadToNAS_Ultimate.call(window, songs, quality);
        }
        
        // 🚀 核心动作：强制找到“全部”按钮并模拟点击，不管原版怎么重绘！
        const forceClickAll = () => {
            const allTab = document.querySelector('#downloadTasks .q-tab[data-filter="all"]');
            if (allTab && !allTab.classList.contains('active')) {
                allTab.click(); 
            }
        };

        // 立即点一次
        forceClickAll();
        // 原版可能在 500ms 后重绘，我们延迟再点一次
        setTimeout(forceClickAll, 300);
        setTimeout(forceClickAll, 800);
        
        console.log("✅ 已强制点击全部标签！");
    };
}, 2500);

// ==========================================
// 🚀 自定义确认弹窗逻辑封装
// ==========================================
window.showCustomConfirm = function(title, desc, okText = '确定', cancelText = '取消') {
    return new Promise((resolve) => {
        const modal = document.getElementById('customConfirmModal');
        document.getElementById('confirmTitle').textContent = title;
        document.getElementById('confirmDesc').textContent = desc;
        
        const btnOk = document.getElementById('confirmOk');
        const btnCancel = document.getElementById('confirmCancel');
        
        btnOk.textContent = okText;
        btnCancel.textContent = cancelText;

        modal.classList.remove('hidden');

        btnOk.onclick = () => {
            modal.classList.add('hidden');
            resolve(true);
        };
        btnCancel.onclick = () => {
            modal.classList.add('hidden');
            resolve(false);
        };
    });
};

// 覆盖之前的 retryAllFailedTasks
window.retryAllFailedTasks = async function() {
    if (!window._lastQueueData) return;
    
    // 筛选出所有失败的任务
    const failedTasks = window._lastQueueData.filter(t => {
        if (['failed', 'error'].includes(t.status)) return true;
        if (['completed', 'finished', 'exists'].includes(t.status)) {
            const byteSize = Number(t.size) || 0;
            if (byteSize < 100 * 1024 || !t.filename) return true;
        }
        return false;
    });

    if (!failedTasks.length) return alert('当前没有失败的任务');
    
    // 🚀 使用自定义弹窗替换原生 confirm
    const isConfirmed = await window.showCustomConfirm(
        '一键重试', 
        `确定要一键重试这 ${failedTasks.length} 首歌曲吗？\n系统将自动跨平台搜索并重新下载。`
    );
    
    if (!isConfirmed) return;

    // 依次触发重试
    for (let i = 0; i < failedTasks.length; i++) {
        await window.retryQueueTask(failedTasks[i].id);
        await new Promise(r => setTimeout(r, 800));
    }
};

// ==========================================
// 🚀 终极歌单重构：精美卡片 + 单曲移除 + 重命名
// ==========================================

// 强行重写 loadPlaylists
window.loadPlaylists = async function() {
  const container = $('playlistList');
  try {
    const { userList } = await fetchUserLists();
    
    if (!userList.length) {
      container.innerHTML = '<div style="color:var(--text2);padding:40px 12px;text-align:center;">暂无歌单，点击上方按钮导入</div>';
      return;
    }

    // 渲染精美卡片
    container.innerHTML = userList.map((pl, i) => `
      <div class="playlist-card" style="background: var(--bg2); border-radius: 10px; padding: 10px 14px;  display: flex; align-items: center; justify-content: space-between; border: 1px solid var(--border); box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
        <div style="display: flex; align-items: center; gap: 14px; flex: 1; min-width: 0;" onclick="window.openPlaylistDetail(${i})">
          <div style="width: 38px; height: 38px; background: var(--blue); border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 18px; color: #fff; flex-shrink: 0; box-shadow: 0 2px 6px rgba(9,105,218,0.3);">🎵</div>
          <div style="flex: 1; min-width: 0; cursor: pointer;">
            <div style="font-size: 15px; font-weight: bold; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${esc(pl.name)}</div>
            <div style="font-size: 12px; color: var(--text2); margin-top: 2px;">${(pl.list || []).length} 首歌曲</div>
          </div>
        </div>
        <div style="display: flex; gap: 12px; flex-shrink: 0; align-items: center; padding-right: 8px;">
          <button style="background: transparent; border: none; padding: 4px; color: var(--text2); display: flex; align-items: center; justify-content: center; cursor: pointer; transition: color 0.2s;" onclick="event.stopPropagation(); window.renamePlaylist(${i})" onmouseenter="this.style.color='var(--blue)'" onmouseleave="this.style.color='var(--text2)'">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
          </button>
          <button style="background: transparent; border: none; padding: 4px; color: var(--text2); display: flex; align-items: center; justify-content: center; cursor: pointer; transition: color 0.2s;" onclick="event.stopPropagation(); window.deletePlaylist(${i})" onmouseenter="this.style.color='var(--red)'" onmouseleave="this.style.color='var(--text2)'">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
        </div>
      </div>
    `).join('');
    
  } catch (e) {
    container.innerHTML = '<div style="color:var(--red); padding:20px;">加载失败: ' + esc(e.message) + '</div>';
  }
};

// 删除歌单
window.deletePlaylist = async function(idx) {
    const { userList } = await fetchUserLists();
    const target = userList[idx];
    if (!confirm(`确认删除歌单「${target.name}」？`)) return;
    userList.splice(idx, 1);
    await saveUserLists(userList);
    loadPlaylists();
};

// 重命名歌单
window.renamePlaylist = async function(idx) {
    const { userList } = await fetchUserLists();
    const target = userList[idx];
    const newName = prompt('修改歌单名称：', target.name);
    if (!newName || newName === target.name) return;
    target.name = newName;
    await saveUserLists(userList);
    loadPlaylists();
};

// 🚀 核心：重写歌单详情页，增加“单曲移除”
window.openPlaylistDetail = async function(idx) {
    // 每次进入详情页，都重新拉取最新数据，防止缓存
    const { userList } = await fetchUserLists();
    const pl = userList[idx];
    if (!pl) return;
    
    $('detailPlaylistName').textContent = pl.name;
    
    // 把当前的歌单索引和列表存到全局，供内部按钮使用
    window._currentPlaylistIdx = idx;
    window._currentPlaylistObj = pl;
    
    // 自定义渲染（带移除按钮）
    const container = $('detailSongList');
    const songs = pl.list || [];
    
    if (!songs.length) {
        container.innerHTML = '<div style="color:var(--text2); text-align:center; padding:30px;">歌单为空</div>';
    } else {
        container.innerHTML = songs.map((s, i) => `
            <div class="song-item" style="display:flex; align-items:center; justify-content:space-between; padding: 10px 12px;  background: var(--bg3); border-radius: 8px;">
                <div style="display:flex; align-items:center; gap:10px; flex:1; min-width:0;">
                    <span class="song-num" style="width:20px; font-size:12px; color:var(--text2);">${i + 1}</span>
                    <div class="song-info" style="flex:1; min-width:0;">
                        <div class="song-name" style="font-size:14px; color:var(--text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(s.name)}</div>
                        <div class="song-singer" style="font-size:12px; color:var(--text2);">${esc(s.singer || '未知')}</div>
                    </div>
                </div>
                <button class="song-play-btn" style="margin-right: 8px;" onclick="window.playSong(songs[${i}], songs)">▶</button>
                <button class="song-play-btn" style="color: var(--red); font-weight: bold;" onclick="event.stopPropagation(); window.removeSongFromPlaylist(${i})" onmouseenter="this.style.color='var(--red)'" onmouseleave="this.style.color='rgba(255,255,255,0.2)'" style="color: rgba(255,255,255,0.2); font-size: 18px;">✕</button>
            </div>
        `).join('');
    }

    $('playlistView').classList.add('hidden');
    $('playlistDetailView').classList.remove('hidden');
    if (typeof updateToolbarVisibility === 'function') updateToolbarVisibility();
};

// 从歌单移除歌曲
window.removeSongFromPlaylist = async function(songIdx) {
    if (!confirm('确定要把这首歌从歌单中移除吗？')) return;
    
    const { userList } = await fetchUserLists();
    const pl = userList[window._currentPlaylistIdx];
    
    if (pl && pl.list) {
        pl.list.splice(songIdx, 1); // 移除这首歌
        await saveUserLists(userList); // 保存回服务器
        window.openPlaylistDetail(window._currentPlaylistIdx); // 刷新详情页
    }
};


// ==========================================
// 🚀 终极修复：纯文本歌单全平台智能播放
// ==========================================
const _originalPlaySong = window.playSong;

window.playSong = async function(song, list) {
  if (!song) return;
  
  // 如果连 ID 都没有，说明是纯文本导入的，必须强制搜索
  if (!song.id && !song.songmid && !song.hash) {
    if (window.$) window.$('playerSinger').textContent = song.singer + ' · 智能匹配中...';
    
    const allSources = ['kw', 'wy', 'tx', 'kg', 'mg'];
    let found = false;
    
    for (const src of allSources) {
      try {
        const q = `${song.name} ${song.singer || ''}`.trim();
        const searchData = await api(`/api/music/search?name=${encodeURIComponent(q)}&source=${src}&type=song&limit=1&page=1`);
        const results = Array.isArray(searchData) ? searchData : (searchData.data || searchData.songs || []);
        
        if (results.length > 0) {
          // 🚀 核心修复：必须把搜索结果放在后面，覆盖掉原来的空 ID！
          song = { ...song, ...results[0] };
          found = true;
          console.log(`[播放器] 成功在 ${src} 找到平替并覆盖ID`);
          break; // 找到了就跳出循环
        }
      } catch (e) {
        console.warn(`[播放器] 在 ${src} 搜索失败`, e);
      }
    }
    
    if (!found) {
        if (window.$) window.$('playerSinger').textContent = song.singer + ' · 找不到该歌曲';
        return alert('全网都找不到这首歌，可能版权已下架');
    }
  }

  // 拿着带有真实 ID 的 song，调用原版播放器
  if (typeof _originalPlaySong === 'function') {
      _originalPlaySong.call(window, song, list);
  }
};

// ==========================================
// 🚀 精准修复：纯文本歌单播放无反应 Bug
// ==========================================
window.openPlaylistDetail = async function(idx) {
    const { userList } = await fetchUserLists();
    const pl = userList[idx];
    if (!pl) return;
    
    $('detailPlaylistName').textContent = pl.name;
    window._currentPlaylistIdx = idx;
    window._currentPlaylistObj = pl;
    
    const container = $('detailSongList');
    const songs = pl.list || [];
    
    if (!songs.length) {
        container.innerHTML = '<div style="color:var(--text2); text-align:center; padding:30px;">歌单为空</div>';
    } else {
        // 🚀 核心修复：去掉内联 onclick，改用 data-idx 绑定
        container.innerHTML = songs.map((s, i) => `
            <div class="song-item" style="display:flex; align-items:center; justify-content:space-between; padding: 10px 12px;  background: var(--bg3); border-radius: 8px;">
                <div style="display:flex; align-items:center; gap:10px; flex:1; min-width:0;">
                    <span class="song-num" style="width:20px; font-size:12px; color:var(--text2);">${i + 1}</span>
                    <div class="song-info" style="flex:1; min-width:0;">
                        <div class="song-name" style="font-size:14px; color:var(--text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(s.name)}</div>
                        <div class="song-singer" style="font-size:12px; color:var(--text2);">${esc(s.singer || '未知')}</div>
                    </div>
                </div>
                <!-- 用类名和 data-idx 替代内联 onclick -->
                <button class="song-play-btn pl-play-trigger" data-idx="${i}" style="margin-right: 8px;">▶</button>
                <button class="song-play-btn" style="color: var(--red); font-weight: bold;" onclick="event.stopPropagation(); window.removeSongFromPlaylist(${i})" onmouseenter="this.style.color='var(--red)'" onmouseleave="this.style.color='rgba(255,255,255,0.2)'" style="color: rgba(255,255,255,0.2); font-size: 18px;">✕</button>
            </div>
        `).join('');
        
        // 🚀 事件委托：绑定在父容器上，完美避开作用域问题
        container.onclick = (e) => {
            const btn = e.target.closest('.pl-play-trigger');
            if (btn) {
                const playIdx = parseInt(btn.dataset.idx);
                // 直接调用全局的 playSong
                if (typeof window.playSong === 'function') {
                    window.playSong(songs[playIdx], songs);
                }
            }
        };
    }

    $('playlistView').classList.add('hidden');
    $('playlistDetailView').classList.remove('hidden');
    if (typeof updateToolbarVisibility === 'function') updateToolbarVisibility();
};


// ==========================================
// 🚀 终极重构：歌单详情页增加多选框与多选联动
// ==========================================
window.openPlaylistDetail = async function(idx) {
    const { userList } = await fetchUserLists();
    const pl = userList[idx];
    if (!pl) return;
    
    $('detailPlaylistName').textContent = pl.name;
    window._currentPlaylistIdx = idx;
    window._currentPlaylistObj = pl;
    
    const container = $('detailSongList');
    const songs = pl.list || [];
    
    if (!songs.length) {
        container.innerHTML = '<div style="color:var(--text2); text-align:center; padding:30px;">歌单为空</div>';
    } else {
        // 🚀 核心新增：加入多选框 song-check，并给外层加 data-idx 供选中提取
        container.innerHTML = songs.map((s, i) => `
            <div class="song-item" data-idx="${i}" style="display:flex; align-items:center; justify-content:space-between; padding: 10px 12px;  background: var(--bg3); border-radius: 8px;">
                <div style="display:flex; align-items:center; gap:10px; flex:1; min-width:0;">
                    <!-- 多选框 -->
                    <input type="checkbox" class="song-check" onchange="updateToolbarVisibility()">
                    <span class="song-num" style="width:20px; font-size:12px; color:var(--text2);">${i + 1}</span>
                    <div class="song-info" style="flex:1; min-width:0;">
                        <div class="song-name" style="font-size:14px; color:var(--text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(s.name)}</div>
                        <div class="song-singer" style="font-size:12px; color:var(--text2);">${esc(s.singer || '未知')}</div>
                    </div>
                </div>
                <button class="song-play-btn pl-play-trigger" data-idx="${i}" style="margin-right: 8px;">▶</button>
                <button class="song-play-btn" style="color: var(--red); font-weight: bold;" onclick="event.stopPropagation(); window.removeSongFromPlaylist(${i})" onmouseenter="this.style.color='var(--red)'" onmouseleave="this.style.color='rgba(255,255,255,0.2)'" style="color: rgba(255,255,255,0.2); font-size: 18px;">✕</button>
            </div>
        `).join('');
        
        // 🚀 极其关键：必须挂载 _songs，否则底部的 getSelectedSongs 找不到数据！
        container._songs = songs;
        
        // 播放事件绑定
        container.onclick = (e) => {
            const btn = e.target.closest('.pl-play-trigger');
            if (btn) {
                const playIdx = parseInt(btn.dataset.idx);
                if (typeof window.playSong === 'function') {
                    window.playSong(songs[playIdx], songs);
                }
            }
        };
    }

    // 切换视图显示
    $('playlistView').classList.add('hidden');
    $('playlistDetailView').classList.remove('hidden');
    
    // 强行刷新一下工具栏状态（防止残留）
    if (typeof hideToolbar === 'function') hideToolbar();
    if (typeof updateToolbarVisibility === 'function') updateToolbarVisibility();
};

// 🚀 扩展：让底部的悬浮工具栏支持“批量移除”
// 拦截原有的删除本地/清除记录逻辑，如果是歌单页面，则执行“移出歌单”
const _originalToolbarDownload = window.downloadToNAS;
if (document.getElementById('rankDownloadNAS')) {
    // 这段会在下次按钮点击时判断当前在哪个页面
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => {
            const dlBtn = document.getElementById('rankDownloadNAS');
            if (dlBtn) {
/* 🚀 错误代码已切除
*/
            }
        }, 2000);
    });
}

// ==========================================

// ==========================================
// 🚀 最终接管：让“下载到NAS”回归神圣职责
// ==========================================
setTimeout(() => {
    const dlBtn = document.getElementById('rankDownloadNAS');
    if (!dlBtn) return;

    // 克隆并替换，这是最高级别的清除，把身上所有的监听器全洗掉
    const newBtn = dlBtn.cloneNode(true);
    dlBtn.parentNode.replaceChild(newBtn, dlBtn);

    // 重新绑定正确逻辑
    newBtn.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        // 智能判断当前页面该拿哪里的数据
        let listContainer = null;
        const activePanel = document.querySelector('.tab-panel.active');
        if (activePanel && activePanel.id === 'tab-playlist' && !document.getElementById('playlistDetailView').classList.contains('hidden')) {
            listContainer = document.getElementById('detailSongList');
        } else {
            listContainer = getActiveList();
        }

        if (!listContainer) return alert('未找到歌曲列表');
        
        // 获取勾选数据
        const songs = getSelectedSongs(listContainer);
        if (!songs.length) return alert('请先勾选歌曲');
        
        // 唤起音质选择
        const q = await pickQuality('download');
        if (!q) return;
        
        // 执行下载
        const isPlaylistPage = activePanel && activePanel.id === 'tab-playlist';
            window.downloadToNAS(songs, q, isPlaylistPage);
        hideToolbar();
    };
    console.log("✅ 下载按钮已重获新生！");
}, 2500);

// ==========================================
// 🚀 终极前置拦截：纯文本歌单下载智能补全 ID
// ==========================================
setTimeout(() => {
    const _finalDownloadFunc = window.downloadToNAS;

    window.downloadToNAS = async function(songs, quality) {
        if (!songs || !songs.length) return;
        
        // 检查是否有缺乏 ID 的“黑户”歌曲
        const needSearchSongs = songs.filter(s => !s.id && !s.songmid && !s.hash);
        
        // 如果没有黑户，直接放行，不耽误时间
        if (needSearchSongs.length === 0) {
            if (typeof _finalDownloadFunc === 'function') {
                return _finalDownloadFunc.call(window, songs, quality);
            }
            return;
        }

        // 如果有黑户，先弹个提示告诉用户正在找音源
        const toast = document.createElement('div');
        toast.style.cssText = 'position:fixed;top:20%;left:50%;transform:translateX(-50%);background:rgba(31,111,235,0.95);color:#fff;padding:12px 24px;border-radius:8px;z-index:99999;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,0.3);text-align:center;line-height:1.5;';
        toast.innerHTML = `🪄 正在为 ${needSearchSongs.length} 首歌全网匹配音源...<br><span style="font-size:12px;opacity:0.8;">首次下载可能需要几秒钟</span>`;
        document.body.appendChild(toast);

        // 开始智能搜索
        const allSources = ['kw', 'wy', 'tx', 'kg', 'mg'];
        
        // 遍历所有歌曲进行补全
        for (let i = 0; i < songs.length; i++) {
            let s = songs[i];
            // 如果这首是黑户，就去搜
            if (!s.id && !s.songmid && !s.hash) {
                toast.innerHTML = `🪄 正在匹配：${s.name} ...<br><span style="font-size:12px;opacity:0.8;">(${i+1}/${songs.length})</span>`;
                
                const q = `${s.name} ${s.singer || ''}`.trim();
                let found = false;

                for (const src of allSources) {
                    try {
                        const res = await api(`/api/music/search?name=${encodeURIComponent(q)}&source=${src}&type=song&limit=1&page=1`);
                        const results = Array.isArray(res) ? res : (res.data || res.list || []);
                        
                        if (results.length > 0 && results[0].name.includes(s.name.substring(0, 2))) {
                            // 找到了！把真实ID和平台覆盖上去，更新到原数组中
                            songs[i] = { ...s, ...results[0] };
                            found = true;
                            break; // 找到了就跳出平台循环
                        }
                    } catch (e) {
                        console.warn(`搜索平台 ${src} 失败`);
                    }
                }
                // 防封限速：搜完一首稍微等一下
                await new Promise(r => setTimeout(r, 300));
            }
        }

        // 补全完毕，移除提示
        toast.remove();

        // 最后，把所有补全好的歌，安心地交给原来的下载逻辑
        if (typeof _finalDownloadFunc === 'function') {
            _finalDownloadFunc.call(window, songs, quality);
        }
    };
    
    console.log("✅ 智能前置下载补全机制已启动！");
}, 3000); // 延迟3秒执行，确保覆盖掉之前所有的垃圾代码

// ==========================================
// 🚀 终极异步流式下载：秒进下载页 + 后台并发补全
// ==========================================
setTimeout(() => {
    
    // 🚀 最终版：支持强制的全量搜索下载
    window.downloadToNAS = async function(songs, quality, forceSearch = false) {
        if (!songs || !songs.length) return;

        // 1. 瞬间跳转到下载页，并强制切回“全部”和置顶
        switchTab('download');
        window.currentQueueFilter = 'all';
        window.scrollTo(0, 0);
        const contentDiv = document.querySelector('.content');
        if (contentDiv) contentDiv.scrollTop = 0;
        if (window._lastQueueData && typeof window.renderQueueUI === 'function') {
            window.renderQueueUI(window._lastQueueData);
        }

        const concurrency = parseInt(localStorage.getItem('downloadConcurrency')) || 3;

        // 2. 拆分任务：根据是否强制搜索来分配
        const readyTasks = [];
        const needSearchSongs = [];

        songs.forEach(song => {
            // 如果要求强制搜索（歌单来的），或者缺失 ID（纯文本），统统进搜索队列
            if (forceSearch || (!song.id && !song.songmid && !song.hash)) {
                needSearchSongs.push(song);
            } else {
                // 否则（搜索页/排行榜直接下的），有 ID 就直接进下载队列
                readyTasks.push({ songInfo: song, quality: quality });
            }
        });

        // 先把现有能下的直接扔给后端
        if (readyTasks.length > 0) {
            try {
                await api('/api/music/cache/queue', {
                    method: 'POST',
                    body: { tasks: readyTasks, namingPattern: 'name_singer', concurrency: concurrency }
                });
                if (typeof startQueuePolling === 'function') startQueuePolling();
            } catch (e) { console.error("提交直连任务失败", e); }
        }

        // 如果没有需要搜索的，直接结束
        if (needSearchSongs.length === 0) {
            if (typeof hideToolbar === 'function') hideToolbar();
            return;
        }

        // 3. 开启后台并发搜索池
        if (typeof hideToolbar === 'function') hideToolbar();
        
        let toast = document.getElementById('searchToast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'searchToast';
            toast.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:rgba(9,105,218,0.95);color:#fff;padding:10px 20px;border-radius:20px;z-index:100000;font-size:13px;box-shadow:0 4px 12px rgba(0,0,0,0.3);transition:opacity 0.3s;';
            document.body.appendChild(toast);
        }
        toast.style.opacity = '1';
        toast.innerHTML = `🪄 正在后台匹配: 0/${needSearchSongs.length}`;

        let successCount = 0;
        let failCount = 0;
        const allSources = ['kw', 'wy', 'tx', 'kg', 'mg'];

        const searchAndQueue = async (song) => {
            const q = `${song.name} ${song.singer || ''}`.trim();
            let found = false;
            
            for (const src of allSources) {
                try {
                    const res = await api(`/api/music/search?name=${encodeURIComponent(q)}&source=${src}&type=song&limit=1&page=1`);
                    const results = Array.isArray(res) ? res : (res.data || res.list || []);
                    
                    if (results.length > 0 && results[0].name.includes(song.name.substring(0, 2))) {
                        const realSong = { ...song, ...results[0] };
                        await api('/api/music/cache/queue', {
                            method: 'POST',
                            body: { tasks: [{ songInfo: realSong, quality: quality }], namingPattern: 'name_singer', concurrency: concurrency }
                        });
                        found = true;
                        successCount++;
                        break;
                    }
                } catch (e) {}
                await new Promise(r => setTimeout(r, 200));
            }
            
            if (!found) failCount++;
            
            if (typeof startQueuePolling === 'function') startQueuePolling();
            toast.innerHTML = `🪄 正在后台匹配: 成功:${successCount} / 失败:${failCount} / 剩余:${needSearchSongs.length - successCount - failCount}`;
        };

        let index = 0;
        const workers = Array(Math.min(concurrency, needSearchSongs.length)).fill(null).map(async () => {
            while (index < needSearchSongs.length) {
                const i = index++;
                await searchAndQueue(needSearchSongs[i]);
            }
        });

        await Promise.all(workers);
        
        toast.style.opacity = '0';
        setTimeout(() => { if(toast.parentNode) toast.remove(); }, 300);
    };
console.log("✅ 终极暴力跳转与后台分发补丁已生效！");
}, 4000); // 延迟4秒，确保在所有乱七八糟的事件之后执行

// ==========================================
// 🚀 终极改造：完美弹窗 + SVG 垃圾桶图标
// ==========================================
setTimeout(() => {
    // 1. 动态创建通用的自定义弹窗（支持输入框和确认框）
    if (!document.getElementById('myUniversalModal')) {
        const modalHtml = `
        <div id="myUniversalModal" class="modal hidden" style="z-index: 10000; background: rgba(0,0,0,0.4); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);">
            <div class="modal-content" style="max-width: 320px; padding: 25px; text-align: center; border-radius: 16px; background: var(--bg2); border: 1px solid var(--border);">
                <h3 id="uniTitle" style="margin-bottom: 15px; color: var(--text); font-size: 16px;">提示</h3>
                <p id="uniDesc" style="color: var(--text2); font-size: 14px; line-height: 1.5; margin-bottom: 20px;"></p>
                <input type="text" id="uniInput" class="form-input" style="width: 100%; margin-bottom: 20px; text-align: center; display: none; background: var(--bg3); color: var(--text); border: 1px solid var(--border); border-radius: 8px; padding: 10px;">
                <div style="display: flex; gap: 10px;">
                    <button id="uniCancel" class="tool-btn" style="flex: 1; padding: 10px; border-radius: 8px; background: var(--bg3); color: var(--text); border: 1px solid var(--border);">取消</button>
                    <button id="uniOk" class="tool-btn blue" style="flex: 1; padding: 10px; border-radius: 8px; background: var(--blue); color: #fff; border: none;">确定</button>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    }

    // 2. 封装 Promise，替代原生 prompt / confirm
    window.showUniPrompt = function(title, desc, defaultVal = '') {
        return new Promise((resolve) => {
            const modal = document.getElementById('myUniversalModal');
            const input = document.getElementById('uniInput');
            document.getElementById('uniTitle').textContent = title;
            document.getElementById('uniDesc').textContent = desc;
            input.value = defaultVal;
            input.style.display = 'block';
            modal.classList.remove('hidden');
            input.focus();

            document.getElementById('uniOk').onclick = () => { modal.classList.add('hidden'); resolve(input.value); };
            document.getElementById('uniCancel').onclick = () => { modal.classList.add('hidden'); resolve(null); };
        });
    };

    window.showUniConfirm = function(title, desc) {
        return new Promise((resolve) => {
            const modal = document.getElementById('myUniversalModal');
            document.getElementById('uniTitle').textContent = title;
            document.getElementById('uniDesc').textContent = desc;
            document.getElementById('uniInput').style.display = 'none';
            modal.classList.remove('hidden');

            document.getElementById('uniOk').onclick = () => { modal.classList.add('hidden'); resolve(true); };
            document.getElementById('uniCancel').onclick = () => { modal.classList.add('hidden'); resolve(false); };
        });
    };

    // 3. 重写这三个核心函数
    window.renamePlaylist = async function(idx) {
        const { userList } = await fetchUserLists();
        const target = userList[idx];
        const newName = await window.showUniPrompt('修改歌单名称', `请输入「${target.name}」的新名称：`, target.name);
        if (!newName || newName === target.name) return;
        target.name = newName;
        await saveUserLists(userList);
        loadPlaylists();
    };

    window.deletePlaylist = async function(idx) {
        const { userList } = await fetchUserLists();
        const target = userList[idx];
        const isConfirmed = await window.showUniConfirm('确认删除', `确定要删除歌单「${target.name}」吗？此操作不可恢复。`);
        if (!isConfirmed) return;
        userList.splice(idx, 1);
        await saveUserLists(userList);
        loadPlaylists();
    };

    window.removeSongFromPlaylist = async function(songIdx) {
        const isConfirmed = await window.showUniConfirm('移除歌曲', '确定要把这首歌从歌单中移除吗？');
        if (!isConfirmed) return;
        
        const { userList } = await fetchUserLists();
        const pl = userList[window._currentPlaylistIdx];
        
        if (pl && pl.list) {
            pl.list.splice(songIdx, 1);
            await saveUserLists(userList);
            window.openPlaylistDetail(window._currentPlaylistIdx);
        }
    };

    // 4. 重写歌单详情页渲染，把红叉换成垃圾桶 SVG
    const _origOpenDetail = window.openPlaylistDetail;
    window.openPlaylistDetail = async function(idx) {
        if (typeof _origOpenDetail === 'function') {
            await _origOpenDetail.call(window, idx);
        }
        
        const container = document.getElementById('detailSongList');
        if (container) {
            // 找到所有的红叉按钮并替换为垃圾桶 SVG
            container.querySelectorAll('button').forEach(btn => {
                if (btn.innerHTML.includes('✕')) {
                    btn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
                    btn.style.color = 'var(--text2)'; // 默认灰色
                    btn.style.fontSize = '16px';
                    btn.onmouseenter = () => btn.style.color = 'var(--red)';
                    btn.onmouseleave = () => btn.style.color = 'var(--text2)';
                }
            });
        }
    };

}, 1500);

// ==========================================
// 🚀 终极主题切换：太阳/月亮一键切
// ==========================================
setTimeout(() => {
    const themeBtn = document.getElementById('themeBtn');
    const themePanel = document.getElementById('themePanel');
    const themeIcon = document.getElementById('themeIcon');

    // 1. 直接隐藏原来的下拉框面板，永绝后患
    if (themePanel) {
        themePanel.style.display = 'none !important';
        themePanel.remove(); // 直接从 DOM 中物理删除
    }

    // 2. 图标渲染函数
    const renderIcon = (isLight) => {
        if (!themeIcon) return;
        if (isLight) {
            // 太阳图标
            themeIcon.innerHTML = `
                <circle cx="12" cy="12" r="5"></circle>
                <line x1="12" y1="1" x2="12" y2="3"></line>
                <line x1="12" y1="21" x2="12" y2="23"></line>
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
                <line x1="1" y1="12" x2="3" y2="12"></line>
                <line x1="21" y1="12" x2="23" y2="12"></line>
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
            `;
        } else {
            // 月亮图标
            themeIcon.innerHTML = `
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
            `;
        }
    };

    // 初始化图标状态
    const currentTheme = localStorage.getItem('nas_music_theme') || 'classic';
    renderIcon(currentTheme === 'light');

    // 3. 劫持点击事件
    if (themeBtn) {
        // 克隆替换，干掉原版绑定的所有事件
        const newBtn = themeBtn.cloneNode(true);
        themeBtn.parentNode.replaceChild(newBtn, themeBtn);

        newBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();

            const nowTheme = document.documentElement.getAttribute('data-theme');
            const isCurrentlyLight = (nowTheme === 'light');
            
            // 切换主题
            const nextTheme = isCurrentlyLight ? 'classic' : 'light';
            
            // 调用咱们之前的 applyTheme 函数（如果存在的话），或者手动切换
            if (typeof window.applyTheme === 'function') {
                window.applyTheme(nextTheme);
            } else {
                document.documentElement.setAttribute('data-theme', nextTheme);
                localStorage.setItem('nas_music_theme', nextTheme);
            }

            // 更新图标
            const newIcon = document.getElementById('themeIcon');
            if (newIcon) {
                if (!isCurrentlyLight) { // 切换到亮色 -> 显示太阳
                    newIcon.innerHTML = `<circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>`;
                } else { // 切换到暗色 -> 显示月亮
                    newIcon.innerHTML = `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>`;
                }
            }
        };
    }
}, 1000);

// ==========================================
// 🚀 绝对纯净的一键切换（100%无下拉框）
// ==========================================
setTimeout(() => {
    const themeBtn = document.getElementById('themeBtn');
    if (!themeBtn) return;

    // 克隆替换，隔绝一切历史绑定
    const newBtn = themeBtn.cloneNode(true);
    themeBtn.parentNode.replaceChild(newBtn, themeBtn);

    newBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();

        const nowTheme = document.documentElement.getAttribute('data-theme');
        const nextTheme = (nowTheme === 'light') ? 'classic' : 'light';
        
        // 切换主题
        document.documentElement.setAttribute('data-theme', nextTheme);
        localStorage.setItem('nas_music_theme', nextTheme);

        // 更新图标
        const newIcon = document.getElementById('themeIcon');
        if (newIcon) {
            if (nextTheme === 'light') {
                // 太阳图标
                newIcon.innerHTML = `<circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>`;
            } else {
                // 月亮图标
                newIcon.innerHTML = `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>`;
            }
        }
    };
}, 1000);


// 全局劫持原生 alert，替换为项目原有的精美卡片弹窗
window.alert = function(msg) {
    if (!msg) return;
    const modal = document.getElementById('customConfirmModal');
    if (!modal) return;
    document.getElementById('confirmTitle').textContent = '提示';
    document.getElementById('confirmDesc').textContent = msg;
    
    const btnCancel = document.getElementById('confirmCancel');
    const btnOk = document.getElementById('confirmOk');
    
    btnCancel.style.display = 'none'; // 隐藏取消按钮，只留确定
    modal.classList.remove('hidden');
    
    btnOk.onclick = () => {
        modal.classList.add('hidden');
    };
};

// ========== 本地下载对话框 ==========
window.showDownloadDialog = function(songs, quality) {
    let dlg = document.getElementById('dlgDownloadList');
    if (!dlg) {
        dlg = document.createElement('div');
        dlg.id = 'dlgDownloadList';
        dlg.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.7);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(5px);';
        document.body.appendChild(dlg);
    }

    dlg.innerHTML = `
        <div style="background:var(--bg2);border-radius:12px;padding:20px;max-width:600px;width:100%;max-height:80vh;display:flex;flex-direction:column;border:1px solid var(--border);">
            <div style="color:var(--text);font-size:16px;font-weight:bold;margin-bottom:10px;">📥 本地下载列表</div>
            <button id="dlgCopyAll" class="tool-btn yellow" style="margin-bottom:10px;padding:8px;border-radius:8px;width:100%;color:#000;font-weight:bold;">📋 一键复制全部直链 (配合1DM+使用)</button>
            <div id="dlgDownloadItems" style="flex:1;overflow-y:auto;font-size:13px;color:var(--text2);margin-bottom:10px;min-height: 150px;"></div>
            <button id="dlgDownloadClose" class="tool-btn" style="width:100%;padding:10px;border-radius:8px;background:var(--bg3);">关闭窗口</button>
        </div>
    `;
    dlg.style.display = 'flex';
    dlg.querySelector('#dlgDownloadClose').onclick = () => dlg.style.display = 'none';

    const container = dlg.querySelector('#dlgDownloadItems');
    const copyAllBtn = dlg.querySelector('#dlgCopyAll');
    container.innerHTML = '';

    let allUrls = [];

    songs.forEach((s, i) => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border);';
        row.innerHTML = `
            <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text);margin-right:10px;">${i+1}. ${esc(s.name)} - ${esc(s.singer || '未知')}</span>
            <button class="tool-btn blue" style="padding:6px 12px;border-radius:6px;font-size:12px;width:80px;" data-idx="${i}">获取中...</button>
        `;
        container.appendChild(row);
    });

    copyAllBtn.onclick = async () => {
        if (allUrls.length === 0) return alert('请稍等，正在获取链接，或者暂无可用音源。');
        const textToCopy = allUrls.join('\n');
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(textToCopy);
            } else {
                const ta = document.createElement('textarea');
                ta.value = textToCopy;
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                ta.remove();
            }
            copyAllBtn.textContent = '✅ 直链已复制！快去1DM+粘贴';
            copyAllBtn.style.background = 'var(--green)';
            setTimeout(() => {
                copyAllBtn.textContent = '📋 一键复制全部直链 (配合1DM+使用)';
                copyAllBtn.style.background = 'var(--yellow)';
            }, 3000);
        } catch (e) {
            alert('复制失败，请手动长按复制。');
        }
    };

    songs.forEach(async (s, i) => {
        const btn = container.querySelector(`button[data-idx="${i}"]`);
        try {
            const r = await api('/api/music/url', {
                method: 'POST',
                body: { songInfo: s, quality: quality, enableAutoSwitchApiSource: true }
            });
            if (r && r.url) {
                const safeName = `${s.name} - ${s.singer || '未知'}`;
                const proxyUrl = window.location.origin + `/api/music/download?url=${encodeURIComponent(r.url)}&filename=${encodeURIComponent(safeName)}&inline=0`;
                allUrls.push(proxyUrl);
                btn.textContent = '⬇ 下载';
                btn.className = 'tool-btn green';
                btn.onclick = () => {
                    const iframe = document.createElement('iframe');
                    iframe.style.display = 'none';
                    iframe.src = proxyUrl;
                    document.body.appendChild(iframe);
                    setTimeout(() => iframe.remove(), 60000);
                    btn.textContent = '✅ 成功';
                    btn.className = 'tool-btn';
                    btn.disabled = true;
                };
            } else {
                btn.textContent = '无音源'; btn.className = 'tool-btn red'; btn.disabled = true;
            }
        } catch(e) {
            btn.textContent = '失败'; btn.className = 'tool-btn red'; btn.disabled = true;
        }
    });
};

// ====== 全新弹窗列表本地下载逻辑 (后置覆盖版) ======
window.showDownloadDialog = function(songs, quality) {
    let dlg = document.getElementById('dlgDownloadList');
    if (!dlg) {
        dlg = document.createElement('div');
        dlg.id = 'dlgDownloadList';
        dlg.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.5);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(8px);';
        document.body.appendChild(dlg);
    }
    
    dlg.innerHTML = `
        <div style="background:var(--bg2);border-radius:16px;padding:20px;max-width:600px;width:100%;max-height:80vh;display:flex;flex-direction:column;border:1px solid var(--border);box-shadow:0 10px 40px rgba(0,0,0,.4);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:15px;">
                <span style="color:var(--text);font-size:16px;font-weight:bold;">📥 本地下载列表</span>
                <button id="dlgDownloadAll" class="tool-btn blue" style="padding:6px 12px;border-radius:6px;font-size:13px;margin:0;">⬇ 一键下载全部</button>
            </div>
            <div id="dlgDownloadItems" style="flex:1;overflow-y:auto;font-size:14px;color:var(--text2);margin-bottom:15px;min-height:100px;display:flex;flex-direction:column;gap:10px;"></div>
            <button id="dlgDownloadClose" class="tool-btn" style="width:100%;padding:12px;border-radius:8px;background:var(--bg3);border:1px solid var(--border);font-size:15px;color:var(--text);">关闭窗口</button>
        </div>
    `;
    dlg.style.display = 'flex';
    dlg.querySelector('#dlgDownloadClose').onclick = () => dlg.style.display = 'none';
    
    const container = dlg.querySelector('#dlgDownloadItems');
    container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text2);">正在获取下载链接，请稍候...</div>';
    
    const readyButtons = [];
    let index = 0;
    const CONCURRENCY = 3; 
    
    async function worker() {
        while (index < songs.length) {
            const i = index++;
            const s = songs[i];
            
            let row = document.getElementById(`dl-row-${i}`);
            if (!row) {
                row = document.createElement('div');
                row.id = `dl-row-${i}`;
                row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:12px;background:var(--bg3);border-radius:10px;border:1px solid var(--border);';
                row.innerHTML = `
                    <div style="flex:1;min-width:0;margin-right:10px;">
                        <div style="font-size:14px;font-weight:500;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(s.name)}</div>
                        <div style="font-size:12px;color:var(--text2);margin-top:2px;">${esc(s.singer || '未知')}</div>
                    </div>
                    <button class="tool-btn" style="padding:6px 14px;border-radius:6px;font-size:13px;width:86px;margin:0;" id="dl-btn-${i}">获取中...</button>
                `;
                if (container.innerHTML.includes('正在获取')) container.innerHTML = '';
                container.appendChild(row);
            }
            
            const btn = document.getElementById(`dl-btn-${i}`);
            try {
                const r = await api('/api/music/url', {
                    method: 'POST',
                    body: { songInfo: s, quality: quality, enableAutoSwitchApiSource: true }
                });
                if (r && r.url) {
                    let ext = quality === 'flac' ? 'flac' : 'mp3';
                    const match = r.url.match(/\.(flac|mp3|m4a|wav|ape)(?:\?|$)/i);
                    if (match) ext = match[1];
                    
                    const safeName = `${s.name} - ${s.singer || '未知'}`.replace(/[\\/:*?"<>|]/g, '_');
                    const finalName = `${safeName}.${ext}`;
                    
                    btn.textContent = '⬇ 下载';
                    btn.className = 'tool-btn green';
                    btn.disabled = false;
                    btn.onclick = () => {
                        const proxyUrl = `/api/music/download?url=${encodeURIComponent(r.url)}&filename=${encodeURIComponent(finalName)}&inline=0`;
                        const iframe = document.createElement('iframe');
                        iframe.style.display = 'none';
                        iframe.src = proxyUrl;
                        document.body.appendChild(iframe);
                        setTimeout(() => iframe.remove(), 60000);
                        btn.textContent = '✅ 已下载';
                        btn.className = 'tool-btn';
                        btn.disabled = true;
                    };
                    readyButtons.push(btn);
                } else {
                    btn.textContent = '无音源'; btn.className = 'tool-btn red'; btn.disabled = true;
                }
            } catch(e) {
                btn.textContent = '失败'; btn.className = 'tool-btn red'; btn.disabled = true;
            }
        }
    }
    
    Promise.all(Array.from({length: Math.min(CONCURRENCY, songs.length)}, worker)).then(() => {
         if (container.children.length === 0) {
             container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--red);">获取下载链接失败，请检查音源是否正常</div>';
         }
    });
    
    dlg.querySelector('#dlgDownloadAll').onclick = () => {
        if (!readyButtons.length) return alert('暂无可下载的歌曲，请等待获取完成');
        const avail = readyButtons.filter(b => !b.disabled);
        if (!avail.length) return alert('所有歌曲均已触发下载或获取失败');
        
        avail.forEach((btn, idx) => {
            setTimeout(() => {
                if (!btn.disabled) btn.click();
            }, idx * 1000);
        });
    };
};

// ====== 全新弹窗列表本地下载逻辑 (后置覆盖版) ======
window.showDownloadDialog = function(songs, quality) {
    let dlg = document.getElementById('dlgDownloadList');
    if (!dlg) {
        dlg = document.createElement('div');
        dlg.id = 'dlgDownloadList';
        dlg.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.5);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(8px);';
        document.body.appendChild(dlg);
    }
    
    dlg.innerHTML = `
        <div style="background:var(--bg2);border-radius:16px;padding:20px;max-width:600px;width:100%;max-height:80vh;display:flex;flex-direction:column;border:1px solid var(--border);box-shadow:0 10px 40px rgba(0,0,0,.4);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:15px;">
                <span style="color:var(--text);font-size:16px;font-weight:bold;">📥 本地下载列表</span>
                <button id="dlgDownloadAll" class="tool-btn blue" style="padding:6px 12px;border-radius:6px;font-size:13px;margin:0;">⬇ 一键下载全部</button>
            </div>
            <div id="dlgDownloadItems" style="flex:1;overflow-y:auto;font-size:14px;color:var(--text2);margin-bottom:15px;min-height:100px;display:flex;flex-direction:column;gap:10px;"></div>
            <button id="dlgDownloadClose" class="tool-btn" style="width:100%;padding:12px;border-radius:8px;background:var(--bg3);border:1px solid var(--border);font-size:15px;color:var(--text);">关闭窗口</button>
        </div>
    `;
    dlg.style.display = 'flex';
    dlg.querySelector('#dlgDownloadClose').onclick = () => dlg.style.display = 'none';
    
    const container = dlg.querySelector('#dlgDownloadItems');
    container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text2);">正在获取下载链接，请稍候...</div>';
    
    const readyButtons = [];
    let index = 0;
    const CONCURRENCY = 3; 
    
    async function worker() {
        while (index < songs.length) {
            const i = index++;
            const s = songs[i];
            
            let row = document.getElementById(`dl-row-${i}`);
            if (!row) {
                row = document.createElement('div');
                row.id = `dl-row-${i}`;
                row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:12px;background:var(--bg3);border-radius:10px;border:1px solid var(--border);';
                row.innerHTML = `
                    <div style="flex:1;min-width:0;margin-right:10px;">
                        <div style="font-size:14px;font-weight:500;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(s.name)}</div>
                        <div style="font-size:12px;color:var(--text2);margin-top:2px;">${esc(s.singer || '未知')}</div>
                    </div>
                    <button class="tool-btn" style="padding:6px 14px;border-radius:6px;font-size:13px;width:86px;margin:0;" id="dl-btn-${i}">获取中...</button>
                `;
                if (container.innerHTML.includes('正在获取')) container.innerHTML = '';
                container.appendChild(row);
            }
            
            const btn = document.getElementById(`dl-btn-${i}`);
            try {
                const r = await api('/api/music/url', {
                    method: 'POST',
                    body: { songInfo: s, quality: quality, enableAutoSwitchApiSource: true }
                });
                if (r && r.url) {
                    let ext = quality === 'flac' ? 'flac' : 'mp3';
                    const match = r.url.match(/\.(flac|mp3|m4a|wav|ape)(?:\?|$)/i);
                    if (match) ext = match[1];
                    
                    const safeName = `${s.name} - ${s.singer || '未知'}`.replace(/[\\/:*?"<>|]/g, '_');
                    const finalName = `${safeName}.${ext}`;
                    
                    btn.textContent = '⬇ 下载';
                    btn.className = 'tool-btn green';
                    btn.disabled = false;
                    btn.onclick = () => {
                        const proxyUrl = `/api/music/download?url=${encodeURIComponent(r.url)}&filename=${encodeURIComponent(finalName)}&inline=0`;
                        const iframe = document.createElement('iframe');
                        iframe.style.display = 'none';
                        iframe.src = proxyUrl;
                        document.body.appendChild(iframe);
                        setTimeout(() => iframe.remove(), 60000);
                        btn.textContent = '✅ 已下载';
                        btn.className = 'tool-btn';
                        btn.disabled = true;
                    };
                    readyButtons.push(btn);
                } else {
                    btn.textContent = '无音源'; btn.className = 'tool-btn red'; btn.disabled = true;
                }
            } catch(e) {
                btn.textContent = '失败'; btn.className = 'tool-btn red'; btn.disabled = true;
            }
        }
    }
    
    Promise.all(Array.from({length: Math.min(CONCURRENCY, songs.length)}, worker)).then(() => {
         if (container.children.length === 0) {
             container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--red);">获取下载链接失败，请检查音源是否正常</div>';
         }
    });
    
    dlg.querySelector('#dlgDownloadAll').onclick = () => {
        if (!readyButtons.length) return alert('暂无可下载的歌曲，请等待获取完成');
        const avail = readyButtons.filter(b => !b.disabled);
        if (!avail.length) return alert('所有歌曲均已触发下载或获取失败');
        
        avail.forEach((btn, idx) => {
            setTimeout(() => {
                if (!btn.disabled) btn.click();
            }, idx * 1000);
        });
    };
};

// ====== 全新弹窗列表本地下载逻辑 (破缓存最终版) ======
window.showDownloadDialog = function(songs, quality) {
    let dlg = document.getElementById('dlgDownloadList');
    if (!dlg) {
        dlg = document.createElement('div');
        dlg.id = 'dlgDownloadList';
        dlg.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.5);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(8px);';
        document.body.appendChild(dlg);
    }
    
    dlg.innerHTML = `
        <div style="background:var(--bg2);border-radius:16px;padding:20px;max-width:600px;width:100%;max-height:80vh;display:flex;flex-direction:column;border:1px solid var(--border);box-shadow:0 10px 40px rgba(0,0,0,.4);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:15px;">
                <span style="color:var(--text);font-size:16px;font-weight:bold;">📥 本地下载列表</span>
                <button id="dlgDownloadAll" class="tool-btn blue" style="padding:6px 12px;border-radius:6px;font-size:13px;margin:0;">⬇ 一键下载全部</button>
            </div>
            <div id="dlgDownloadItems" style="flex:1;overflow-y:auto;font-size:14px;color:var(--text2);margin-bottom:15px;min-height:100px;display:flex;flex-direction:column;gap:10px;"></div>
            <button id="dlgDownloadClose" class="tool-btn" style="width:100%;padding:12px;border-radius:8px;background:var(--bg3);border:1px solid var(--border);font-size:15px;color:var(--text);">关闭窗口</button>
        </div>
    `;
    dlg.style.display = 'flex';
    dlg.querySelector('#dlgDownloadClose').onclick = () => dlg.style.display = 'none';
    
    const container = dlg.querySelector('#dlgDownloadItems');
    container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text2);">正在获取下载链接，请稍候...</div>';
    
    const readyButtons = [];
    let index = 0;
    const CONCURRENCY = 3; 
    
    async function worker() {
        while (index < songs.length) {
            const i = index++;
            const s = songs[i];
            
            let row = document.getElementById(`dl-row-${i}`);
            if (!row) {
                row = document.createElement('div');
                row.id = `dl-row-${i}`;
                row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:12px;background:var(--bg3);border-radius:10px;border:1px solid var(--border);';
                row.innerHTML = `
                    <div style="flex:1;min-width:0;margin-right:10px;">
                        <div style="font-size:14px;font-weight:500;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(s.name)}</div>
                        <div style="font-size:12px;color:var(--text2);margin-top:2px;">${esc(s.singer || '未知')}</div>
                    </div>
                    <button class="tool-btn" style="padding:6px 14px;border-radius:6px;font-size:13px;width:86px;margin:0;" id="dl-btn-${i}">获取中...</button>
                `;
                if (container.innerHTML.includes('正在获取')) container.innerHTML = '';
                container.appendChild(row);
            }
            
            const btn = document.getElementById(`dl-btn-${i}`);
            try {
                const r = await api('/api/music/url', {
                    method: 'POST',
                    body: { songInfo: s, quality: quality, enableAutoSwitchApiSource: true }
                });
                if (r && r.url) {
                    let ext = quality === 'flac' ? 'flac' : 'mp3';
                    const match = r.url.match(/\.(flac|mp3|m4a|wav|ape)(?:\?|$)/i);
                    if (match) ext = match[1];
                    
                    const safeName = `${s.name} - ${s.singer || '未知'}`.replace(/[\\/:*?"<>|]/g, '_');
                    const finalName = `${safeName}.${ext}`;
                    
                    btn.textContent = '⬇ 下载';
                    btn.className = 'tool-btn green';
                    btn.disabled = false;
                    btn.onclick = () => {
                        const proxyUrl = `/api/music/download?url=${encodeURIComponent(r.url)}&filename=${encodeURIComponent(finalName)}&inline=0`;
                        const iframe = document.createElement('iframe');
                        iframe.style.display = 'none';
                        iframe.src = proxyUrl;
                        document.body.appendChild(iframe);
                        setTimeout(() => iframe.remove(), 60000);
                        btn.textContent = '✅ 已下载';
                        btn.className = 'tool-btn';
                        btn.disabled = true;
                    };
                    readyButtons.push(btn);
                } else {
                    btn.textContent = '无音源'; btn.className = 'tool-btn red'; btn.disabled = true;
                }
            } catch(e) {
                btn.textContent = '失败'; btn.className = 'tool-btn red'; btn.disabled = true;
            }
        }
    }
    
    Promise.all(Array.from({length: Math.min(CONCURRENCY, songs.length)}, worker)).then(() => {
         if (container.children.length === 0) {
             container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--red);">获取下载链接失败，请检查音源是否正常</div>';
         }
    });
    
    dlg.querySelector('#dlgDownloadAll').onclick = () => {
        if (!readyButtons.length) return alert('暂无可下载的歌曲，请等待获取完成');
        const avail = readyButtons.filter(b => !b.disabled);
        if (!avail.length) return alert('所有歌曲均已触发下载或获取失败');
        
        avail.forEach((btn, idx) => {
            setTimeout(() => {
                if (!btn.disabled) btn.click();
            }, idx * 1000);
        });
    };
};

// ====== 终极接管逻辑 ======
window.showDownloadDialog = function(songs, quality) {
    let dlg = document.getElementById('dlgDownloadList');
    if (!dlg) {
        dlg = document.createElement('div');
        dlg.id = 'dlgDownloadList';
        dlg.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.5);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(8px);';
        document.body.appendChild(dlg);
    }
    dlg.innerHTML = `
        <div style="background:var(--bg2);border-radius:16px;padding:20px;max-width:600px;width:100%;max-height:80vh;display:flex;flex-direction:column;border:1px solid var(--border);box-shadow:0 10px 40px rgba(0,0,0,.4);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:15px;">
                <span style="color:var(--text);font-size:16px;font-weight:bold;">📥 本地下载列表</span>
                <button id="dlgDownloadAll" class="tool-btn blue" style="padding:6px 12px;border-radius:6px;font-size:13px;margin:0;">⬇ 一键下载全部</button>
            </div>
            <div id="dlgDownloadItems" style="flex:1;overflow-y:auto;font-size:14px;color:var(--text2);margin-bottom:15px;min-height:100px;display:flex;flex-direction:column;gap:10px;"></div>
            <button id="dlgDownloadClose" class="tool-btn" style="width:100%;padding:12px;border-radius:8px;background:var(--bg3);border:1px solid var(--border);font-size:15px;color:var(--text);">关闭窗口</button>
        </div>
    `;
    dlg.style.display = 'flex';
    dlg.querySelector('#dlgDownloadClose').onclick = () => dlg.style.display = 'none';
    const container = dlg.querySelector('#dlgDownloadItems');
    container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text2);">正在获取下载链接，请稍候...</div>';
    const readyButtons = [];
    let index = 0;
    async function worker() {
        while (index < songs.length) {
            const i = index++;
            const s = songs[i];
            let row = document.getElementById(`dl-row-${i}`);
            if (!row) {
                row = document.createElement('div');
                row.id = `dl-row-${i}`;
                row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:12px;background:var(--bg3);border-radius:10px;border:1px solid var(--border);';
                row.innerHTML = `<div style="flex:1;min-width:0;margin-right:10px;"><div style="font-size:14px;font-weight:500;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(s.name)}</div><div style="font-size:12px;color:var(--text2);margin-top:2px;">${esc(s.singer || '未知')}</div></div><button class="tool-btn" style="padding:6px 14px;border-radius:6px;font-size:13px;width:86px;margin:0;" id="dl-btn-${i}">获取中...</button>`;
                if (container.innerHTML.includes('正在获取')) container.innerHTML = '';
                container.appendChild(row);
            }
            const btn = document.getElementById(`dl-btn-${i}`);
            try {
                const r = await api('/api/music/url', { method: 'POST', body: { songInfo: s, quality: quality, enableAutoSwitchApiSource: true } });
                if (r && r.url) {
                    let ext = quality === 'flac' ? 'flac' : 'mp3';
                    const match = r.url.match(/\.(flac|mp3|m4a|wav|ape)(?:\?|$)/i);
                    if (match) ext = match[1];
                    const finalName = `${s.name} - ${s.singer || '未知'}`.replace(/[\\/:*?"<>|]/g, '_') + `.${ext}`;
                    btn.textContent = '⬇ 下载'; btn.className = 'tool-btn green'; btn.disabled = false;
                    btn.onclick = () => {
                        const iframe = document.createElement('iframe');
                        iframe.style.display = 'none';
                        iframe.src = `/api/music/download?url=${encodeURIComponent(r.url)}&filename=${encodeURIComponent(finalName)}&inline=0`;
                        document.body.appendChild(iframe);
                        setTimeout(() => iframe.remove(), 60000);
                        btn.textContent = '✅ 已下载'; btn.className = 'tool-btn'; btn.disabled = true;
                    };
                    readyButtons.push(btn);
                } else { btn.textContent = '无音源'; btn.className = 'tool-btn red'; btn.disabled = true; }
            } catch(e) { btn.textContent = '失败'; btn.className = 'tool-btn red'; btn.disabled = true; }
        }
    }
    Promise.all([worker(), worker(), worker()]);
    dlg.querySelector('#dlgDownloadAll').onclick = () => {
        readyButtons.filter(b => !b.disabled).forEach((btn, idx) => setTimeout(() => btn.click(), idx * 1000));
    };
};

// 强行抹除旧绑定，重新生成按钮
setTimeout(() => {
    const oldBtn = document.getElementById('rankCopyLinks');
    if (oldBtn) {
        const newBtn = oldBtn.cloneNode(true);
        newBtn.textContent = '本地下载';
        oldBtn.parentNode.replaceChild(newBtn, oldBtn);
        newBtn.onclick = async () => {
            const el = getActiveList();
            if (!el) return alert('未找到歌曲列表');
            const songs = getSelectedSongs(el);
            if (!songs.length) return alert('请先勾选歌曲');
            const q = await pickQuality('download');
            if (!q) return;
            showDownloadDialog(songs, q);
        };
    }
}, 2000);

// ==========================================
// 🚀 终极斩杀：直接替换带有历史毒瘤的按钮
// ==========================================
window.showDownloadDialog = function(songs, quality) {
    let dlg = document.getElementById('dlgDownloadList');
    if (!dlg) {
        dlg = document.createElement('div');
        dlg.id = 'dlgDownloadList';
        dlg.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.5);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(8px);';
        document.body.appendChild(dlg);
    }
    dlg.innerHTML = `
        <div style="background:var(--bg2);border-radius:16px;padding:20px;max-width:600px;width:100%;max-height:80vh;display:flex;flex-direction:column;border:1px solid var(--border);box-shadow:0 10px 40px rgba(0,0,0,.4);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:15px;">
                <span style="color:var(--text);font-size:16px;font-weight:bold;">📥 本地下载列表</span>
                <button id="dlgDownloadAll" class="tool-btn blue" style="padding:6px 12px;border-radius:6px;font-size:13px;margin:0;">⬇ 一键下载全部</button>
            </div>
            <div id="dlgDownloadItems" style="flex:1;overflow-y:auto;font-size:14px;color:var(--text2);margin-bottom:15px;min-height:100px;display:flex;flex-direction:column;gap:10px;"></div>
            <button id="dlgDownloadClose" class="tool-btn" style="width:100%;padding:12px;border-radius:8px;background:var(--bg3);border:1px solid var(--border);font-size:15px;color:var(--text);">关闭窗口</button>
        </div>
    `;
    dlg.style.display = 'flex';
    dlg.querySelector('#dlgDownloadClose').onclick = () => dlg.style.display = 'none';
    const container = dlg.querySelector('#dlgDownloadItems');
    container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text2);">正在获取下载链接，请稍候...</div>';
    const readyButtons = [];
    let index = 0;
    async function worker() {
        while (index < songs.length) {
            const i = index++;
            const s = songs[i];
            let row = document.getElementById(`dl-row-${i}`);
            if (!row) {
                row = document.createElement('div');
                row.id = `dl-row-${i}`;
                row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:12px;background:var(--bg3);border-radius:10px;border:1px solid var(--border);';
                row.innerHTML = `<div style="flex:1;min-width:0;margin-right:10px;"><div style="font-size:14px;font-weight:500;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(s.name)}</div><div style="font-size:12px;color:var(--text2);margin-top:2px;">${esc(s.singer || '未知')}</div></div><button class="tool-btn" style="padding:6px 14px;border-radius:6px;font-size:13px;width:86px;margin:0;" id="dl-btn-${i}">获取中...</button>`;
                if (container.innerHTML.includes('正在获取')) container.innerHTML = '';
                container.appendChild(row);
            }
            const btn = document.getElementById(`dl-btn-${i}`);
            try {
                const r = await api('/api/music/url', { method: 'POST', body: { songInfo: s, quality: quality, enableAutoSwitchApiSource: true } });
                if (r && r.url) {
                    let ext = quality === 'flac' ? 'flac' : 'mp3';
                    const match = r.url.match(/\.(flac|mp3|m4a|wav|ape)(?:\?|$)/i);
                    if (match) ext = match[1];
                    const finalName = `${s.name} - ${s.singer || '未知'}`.replace(/[\\/:*?"<>|]/g, '_') + `.${ext}`;
                    btn.textContent = '⬇ 下载'; btn.className = 'tool-btn green'; btn.disabled = false;
                    btn.onclick = () => {
                        const iframe = document.createElement('iframe');
                        iframe.style.display = 'none';
                        iframe.src = `/api/music/download?url=${encodeURIComponent(r.url)}&filename=${encodeURIComponent(finalName)}&inline=0`;
                        document.body.appendChild(iframe);
                        setTimeout(() => iframe.remove(), 60000);
                        btn.textContent = '✅ 已下载'; btn.className = 'tool-btn'; btn.disabled = true;
                    };
                    readyButtons.push(btn);
                } else { btn.textContent = '无音源'; btn.className = 'tool-btn red'; btn.disabled = true; }
            } catch(e) { btn.textContent = '失败'; btn.className = 'tool-btn red'; btn.disabled = true; }
        }
    }
    Promise.all([worker(), worker(), worker()]);
    dlg.querySelector('#dlgDownloadAll').onclick = () => {
        readyButtons.filter(b => !b.disabled).forEach((btn, idx) => setTimeout(() => btn.click(), idx * 1000));
    };
};

// 延迟 3.5 秒执行，彻底熬死上面那个 1000ms 的毒瘤代码
setTimeout(() => {
    const oldBtn = document.getElementById('rankCopyLinks');
    if (oldBtn) {
        const newBtn = oldBtn.cloneNode(true);
        newBtn.textContent = '本地下载';
        // 把新按钮塞回页面，旧按钮的 onclick 绑定全部丢失
        oldBtn.parentNode.replaceChild(newBtn, oldBtn);
        
        newBtn.onclick = async () => {
            const el = getActiveList();
            if (!el) return alert('未找到歌曲列表');
            const songs = getSelectedSongs(el);
            if (!songs.length) return alert('请先勾选歌曲');
            const q = await pickQuality('download');
            if (!q) return;
            window.showDownloadDialog(songs, q);
        };
    }
}, 3500);

// ==========================================
// 🚀 终极完美版：使用 getBestPlayUrl 高容错获取，修复失败问题
// ==========================================
window.showDownloadDialog = function(songs, quality) {
    let dlg = document.getElementById('dlgDownloadList');
    if (!dlg) {
        dlg = document.createElement('div');
        dlg.id = 'dlgDownloadList';
        dlg.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.5);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(8px);';
        document.body.appendChild(dlg);
    }
    dlg.innerHTML = `
        <div style="background:var(--bg2);border-radius:16px;padding:20px;max-width:600px;width:100%;max-height:80vh;display:flex;flex-direction:column;border:1px solid var(--border);box-shadow:0 10px 40px rgba(0,0,0,.4);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:15px;">
                <span style="color:var(--text);font-size:16px;font-weight:bold;">📥 本地下载列表</span>
                <button id="dlgDownloadAll" class="tool-btn blue" style="padding:6px 12px;border-radius:6px;font-size:13px;margin:0;">⬇ 一键下载全部</button>
            </div>
            <div id="dlgDownloadItems" style="flex:1;overflow-y:auto;font-size:14px;color:var(--text2);margin-bottom:15px;min-height:100px;display:flex;flex-direction:column;gap:10px;"></div>
            <button id="dlgDownloadClose" class="tool-btn" style="width:100%;padding:12px;border-radius:8px;background:var(--bg3);border:1px solid var(--border);font-size:15px;color:var(--text);">关闭窗口</button>
        </div>
    `;
    dlg.style.display = 'flex';
    dlg.querySelector('#dlgDownloadClose').onclick = () => dlg.style.display = 'none';
    const container = dlg.querySelector('#dlgDownloadItems');
    container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text2);">正在获取下载链接，请稍候...</div>';
    
    const readyButtons = [];
    let index = 0;
    async function worker() {
        while (index < songs.length) {
            const i = index++;
            const s = songs[i];
            let row = document.getElementById(`dl-row-${i}`);
            if (!row) {
                row = document.createElement('div');
                row.id = `dl-row-${i}`;
                row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:12px;background:var(--bg3);border-radius:10px;border:1px solid var(--border);';
                row.innerHTML = `<div style="flex:1;min-width:0;margin-right:10px;"><div style="font-size:14px;font-weight:500;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(s.name)}</div><div style="font-size:12px;color:var(--text2);margin-top:2px;">${esc(s.singer || '未知')}</div></div><button class="tool-btn" style="padding:6px 14px;border-radius:6px;font-size:13px;width:86px;margin:0;" id="dl-btn-${i}">获取中...</button>`;
                if (container.innerHTML.includes('正在获取')) container.innerHTML = '';
                container.appendChild(row);
            }
            const btn = document.getElementById(`dl-btn-${i}`);
            try {
                // 🚀 核心修复：调用原有的高容错函数
                const result = await getBestPlayUrl(s, quality);
                if (result && result.url) {
                    let ext = quality === 'flac' ? 'flac' : 'mp3';
                    const match = result.url.match(/\.(flac|mp3|m4a|wav|ape)(?:\?|$)/i);
                    if (match) ext = match[1];
                    
                    const realSong = result.song || s; // 如果切换了音源，用真实的歌曲名
                    const finalName = `${realSong.name} - ${realSong.singer || '未知'}`.replace(/[\\/:*?"<>|]/g, '_') + `.${ext}`;
                    
                    btn.textContent = '⬇ 下载'; btn.className = 'tool-btn green'; btn.disabled = false;
                    btn.onclick = () => {
                        const iframe = document.createElement('iframe');
                        iframe.style.display = 'none';
                        iframe.src = `/api/music/download?url=${encodeURIComponent(result.url)}&filename=${encodeURIComponent(finalName)}&inline=0`;
                        document.body.appendChild(iframe);
                        setTimeout(() => iframe.remove(), 60000);
                        btn.textContent = '✅ 已下载'; btn.className = 'tool-btn'; btn.disabled = true;
                    };
                    readyButtons.push(btn);
                } else { btn.textContent = '无音源'; btn.className = 'tool-btn red'; btn.disabled = true; }
            } catch(e) { 
                console.error("下载解析失败", e);
                btn.textContent = '失败'; btn.className = 'tool-btn red'; btn.disabled = true; 
            }
        }
    }
    Promise.all([worker(), worker()]); // 并发降为2，更稳
    dlg.querySelector('#dlgDownloadAll').onclick = () => {
        readyButtons.filter(b => !b.disabled).forEach((btn, idx) => setTimeout(() => btn.click(), idx * 1000));
    };
};

// 🚀 强行把旧按钮文字改成“本地下载”
setTimeout(() => {
    const oldBtn = document.getElementById('rankCopyLinks');
    if (oldBtn) {
        oldBtn.textContent = '本地下载'; 
        oldBtn.onclick = async () => {
            const el = getActiveList();
            if (!el) return alert('未找到歌曲列表');
            const songs = getSelectedSongs(el);
            if (!songs.length) return alert('请先勾选歌曲');
            const q = await pickQuality('download');
            if (!q) return;
            window.showDownloadDialog(songs, q);
        };
    }
}, 3500);

// ==========================================
// 🚀 终极弹窗 Plus：增加一键复制链接，修复反馈与歌名截断
// ==========================================
window.showDownloadDialog = function(songs, quality) {
    let dlg = document.getElementById('dlgDownloadList');
    if (!dlg) {
        dlg = document.createElement('div');
        dlg.id = 'dlgDownloadList';
        dlg.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.5);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(8px);';
        document.body.appendChild(dlg);
    }
    dlg.innerHTML = `
        <div style="background:var(--bg2);border-radius:16px;padding:20px;max-width:600px;width:100%;max-height:80vh;display:flex;flex-direction:column;border:1px solid var(--border);box-shadow:0 10px 40px rgba(0,0,0,.4);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:15px;">
                <span style="color:var(--text);font-size:16px;font-weight:bold;">📥 本地下载列表</span>
                <button id="dlgDownloadAll" class="tool-btn blue" style="padding:6px 12px;border-radius:6px;font-size:13px;margin:0;">⬇ 一键下载全部</button>
            </div>
            <div id="dlgDownloadItems" style="flex:1;overflow-y:auto;font-size:14px;color:var(--text2);margin-bottom:15px;min-height:100px;display:flex;flex-direction:column;gap:10px;"></div>
            <button id="dlgDownloadClose" class="tool-btn" style="width:100%;padding:12px;border-radius:8px;background:var(--bg3);border:1px solid var(--border);font-size:15px;color:var(--text);">关闭窗口</button>
        </div>
    `;
    dlg.style.display = 'flex';
    dlg.querySelector('#dlgDownloadClose').onclick = () => dlg.style.display = 'none';
    const container = dlg.querySelector('#dlgDownloadItems');
    container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text2);">正在获取下载链接，请稍候...</div>';
    
    const readyButtons = [];
    let index = 0;
    async function worker() {
        while (index < songs.length) {
            const i = index++;
            const s = songs[i];
            let row = document.getElementById(`dl-row-${i}`);
            if (!row) {
                row = document.createElement('div');
                row.id = `dl-row-${i}`;
                row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:12px;background:var(--bg3);border-radius:10px;border:1px solid var(--border);';
                row.innerHTML = `
                    <div style="flex:1;min-width:0;margin-right:10px;">
                        <div style="font-size:14px;font-weight:500;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(s.name)}</div>
                        <div style="font-size:12px;color:var(--text2);margin-top:2px;">${esc(s.singer || '未知')}</div>
                    </div>
                    <div style="display:flex;gap:6px;flex-shrink:0;">
                        <button class="tool-btn" style="padding:6px 10px;border-radius:6px;font-size:13px;margin:0;display:none;background:var(--blue);color:#fff;" id="dl-cp-btn-${i}">复制</button>
                        <button class="tool-btn" style="padding:6px 10px;border-radius:6px;font-size:13px;margin:0;width:70px;" id="dl-btn-${i}">获取中...</button>
                    </div>
                `;
                if (container.innerHTML.includes('正在获取')) container.innerHTML = '';
                container.appendChild(row);
            }
            const btn = document.getElementById(`dl-btn-${i}`);
            const cpBtn = document.getElementById(`dl-cp-btn-${i}`);
            try {
                const result = await getBestPlayUrl(s, quality);
                if (result && result.url) {
                    let ext = quality === 'flac' ? 'flac' : 'mp3';
                    const match = result.url.match(/\.(flac|mp3|m4a|wav|ape)(?:\?|$)/i);
                    if (match) ext = match[1];
                    
                    // 优先使用后端返回的真实完整歌名（修复截断）
                    const realSong = result.song || s;
                    const finalName = `${realSong.name} - ${realSong.singer || '未知'}`.replace(/[\\/:*?"<>|]/g, '_') + `.${ext}`;
                    
                    // 显示复制按钮
                    cpBtn.style.display = 'block';
                    cpBtn.onclick = async () => {
                        try {
                            await navigator.clipboard.writeText(result.url);
                            cpBtn.textContent = '✅ 已复制';
                        } catch(e) {
                            const ta = document.createElement('textarea');
                            ta.value = result.url;
                            document.body.appendChild(ta);
                            ta.select();
                            document.execCommand('copy');
                            document.body.removeChild(ta);
                            cpBtn.textContent = '✅ 已复制';
                        }
                        setTimeout(() => cpBtn.textContent = '复制', 2000);
                    };
                    
                    btn.textContent = '⬇ 下载'; btn.className = 'tool-btn green'; btn.disabled = false;
                    btn.onclick = () => {
                        const iframe = document.createElement('iframe');
                        iframe.style.display = 'none';
                        iframe.src = `/api/music/download?url=${encodeURIComponent(result.url)}&filename=${encodeURIComponent(finalName)}&inline=0`;
                        document.body.appendChild(iframe);
                        setTimeout(() => iframe.remove(), 60000);
                        
                        // 网页上的视觉反馈
                        btn.textContent = '✅ 已下载'; btn.className = 'tool-btn'; btn.disabled = true;
                    };
                    readyButtons.push(btn);
                } else { 
                    btn.textContent = '无音源'; btn.className = 'tool-btn red'; btn.disabled = true; 
                }
            } catch(e) { 
                console.error(e);
                btn.textContent = '失败'; btn.className = 'tool-btn red'; btn.disabled = true; 
            }
        }
    }
    Promise.all([worker(), worker()]);
    dlg.querySelector('#dlgDownloadAll').onclick = () => {
        const avail = readyButtons.filter(b => !b.disabled);
        if (!avail.length) return alert('暂无可下载的歌曲，或均已触发');
        avail.forEach((btn, idx) => setTimeout(() => btn.click(), idx * 1200));
    };
};

// ==========================================
// 🚀 终极兼容版：完美复制（支持1DM绝对路径）+ 视觉反馈
// ==========================================
window.showDownloadDialog = function(songs, quality) {
    let dlg = document.getElementById('dlgDownloadList');
    if (!dlg) {
        dlg = document.createElement('div');
        dlg.id = 'dlgDownloadList';
        dlg.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.5);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(8px);';
        document.body.appendChild(dlg);
    }
    dlg.innerHTML = `
        <div style="background:var(--bg2);border-radius:16px;padding:20px;max-width:600px;width:100%;max-height:80vh;display:flex;flex-direction:column;border:1px solid var(--border);box-shadow:0 10px 40px rgba(0,0,0,.4);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:15px;">
                <span style="color:var(--text);font-size:16px;font-weight:bold;">📥 本地下载列表</span>
                <button id="dlgDownloadAll" class="tool-btn blue" style="padding:6px 12px;border-radius:6px;font-size:13px;margin:0;">⬇ 一键下载全部</button>
            </div>
            <div id="dlgDownloadItems" style="flex:1;overflow-y:auto;font-size:14px;color:var(--text2);margin-bottom:15px;min-height:100px;display:flex;flex-direction:column;gap:10px;"></div>
            <button id="dlgDownloadClose" class="tool-btn" style="width:100%;padding:12px;border-radius:8px;background:var(--bg3);border:1px solid var(--border);font-size:15px;color:var(--text);">关闭窗口</button>
        </div>
    `;
    dlg.style.display = 'flex';
    dlg.querySelector('#dlgDownloadClose').onclick = () => dlg.style.display = 'none';
    const container = dlg.querySelector('#dlgDownloadItems');
    container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text2);">正在获取下载链接，请稍候...</div>';
    
    const readyButtons = [];
    let index = 0;
    
    // 获取当前域名，确保 1DM 能识别
    const baseUrl = window.location.origin;

    async function worker() {
        while (index < songs.length) {
            const i = index++;
            const s = songs[i];
            let row = document.getElementById(`dl-row-${i}`);
            if (!row) {
                row = document.createElement('div');
                row.id = `dl-row-${i}`;
                row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:12px;background:var(--bg3);border-radius:10px;border:1px solid var(--border);';
                row.innerHTML = `
                    <div style="flex:1;min-width:0;margin-right:10px;">
                        <div style="font-size:14px;font-weight:500;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(s.name)}</div>
                        <div style="font-size:12px;color:var(--text2);margin-top:2px;">${esc(s.singer || '未知')}</div>
                    </div>
                    <div style="display:flex;gap:6px;flex-shrink:0;">
                        <button class="tool-btn" style="padding:6px 10px;border-radius:6px;font-size:13px;margin:0;display:none;background:var(--blue);color:#fff;" id="dl-cp-btn-${i}">复制</button>
                        <button class="tool-btn" style="padding:6px 10px;border-radius:6px;font-size:13px;margin:0;width:70px;" id="dl-btn-${i}">获取中...</button>
                    </div>
                `;
                if (container.innerHTML.includes('正在获取')) container.innerHTML = '';
                container.appendChild(row);
            }
            const btn = document.getElementById(`dl-btn-${i}`);
            const cpBtn = document.getElementById(`dl-cp-btn-${i}`);
            try {
                const result = await getBestPlayUrl(s, quality);
                if (result && result.url) {
                    let ext = quality === 'flac' ? 'flac' : 'mp3';
                    const match = result.url.match(/\.(flac|mp3|m4a|wav|ape)(?:\?|$)/i);
                    if (match) ext = match[1];
                    
                    const realSong = result.song || s;
                    const finalName = `${realSong.name} - ${realSong.singer || '未知'}`.replace(/[\\/:*?"<>|]/g, '_') + `.${ext}`;
                    
                    // 拼装绝对路径，1DM 最爱
                    const fullUrl = `${baseUrl}/api/music/download?url=${encodeURIComponent(result.url)}&filename=${encodeURIComponent(finalName)}&inline=0`;

                    // 显示复制按钮
                    cpBtn.style.display = 'block';
                    cpBtn.onclick = () => {
                        // 🚀 无敌兼容复制大法
                        const textArea = document.createElement("textarea");
                        textArea.value = fullUrl; // 复制完整的绝对路径
                        textArea.style.position = "fixed";
                        textArea.style.top = "0";
                        textArea.style.left = "0";
                        textArea.style.opacity = "0";
                        document.body.appendChild(textArea);
                        textArea.focus();
                        textArea.select();
                        try {
                            const successful = document.execCommand('copy');
                            if (successful) {
                                cpBtn.textContent = '✅ 已复制';
                                cpBtn.style.background = 'var(--green)';
                            } else {
                                cpBtn.textContent = '❌ 失败';
                            }
                        } catch (err) {
                            cpBtn.textContent = '❌ 失败';
                        }
                        document.body.removeChild(textArea);
                        setTimeout(() => {
                            cpBtn.textContent = '复制';
                            cpBtn.style.background = 'var(--blue)';
                        }, 2000);
                    };
                    
                    btn.textContent = '⬇ 下载'; btn.className = 'tool-btn green'; btn.disabled = false;
                    btn.onclick = () => {
                        const iframe = document.createElement('iframe');
                        iframe.style.display = 'none';
                        iframe.src = fullUrl; // 走绝对路径
                        document.body.appendChild(iframe);
                        setTimeout(() => iframe.remove(), 60000);
                        
                        btn.textContent = '✅ 已下载'; btn.className = 'tool-btn'; btn.disabled = true;
                    };
                    readyButtons.push(btn);
                } else { 
                    btn.textContent = '无音源'; btn.className = 'tool-btn red'; btn.disabled = true; 
                }
            } catch(e) { 
                console.error(e);
                btn.textContent = '失败'; btn.className = 'tool-btn red'; btn.disabled = true; 
            }
        }
    }
    Promise.all([worker(), worker()]);
    dlg.querySelector('#dlgDownloadAll').onclick = () => {
        const avail = readyButtons.filter(b => !b.disabled);
        if (!avail.length) return alert('暂无可下载的歌曲，或均已触发');
        avail.forEach((btn, idx) => setTimeout(() => btn.click(), idx * 1200));
    };
};

// ==========================================
// 🚀 最终真·一键复制全部：批量直链给 1DM
// ==========================================
window.showDownloadDialog = function(songs, quality) {
    let dlg = document.getElementById('dlgDownloadList');
    if (!dlg) {
        dlg = document.createElement('div');
        dlg.id = 'dlgDownloadList';
        dlg.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.5);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(8px);';
        document.body.appendChild(dlg);
    }
    dlg.innerHTML = `
        <div style="background:var(--bg2);border-radius:16px;padding:20px;max-width:600px;width:100%;max-height:80vh;display:flex;flex-direction:column;border:1px solid var(--border);box-shadow:0 10px 40px rgba(0,0,0,.4);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:15px;flex-wrap:wrap;gap:10px;">
                <span style="color:var(--text);font-size:16px;font-weight:bold;">📥 本地下载列表</span>
                <div style="display:flex;gap:8px;">
                    <button id="dlgCopyAll" class="tool-btn" style="padding:6px 12px;border-radius:6px;font-size:13px;margin:0;background:var(--bg3);border:1px solid var(--border);color:var(--text);">📋 一键复制全部</button>
                    <button id="dlgDownloadAll" class="tool-btn blue" style="padding:6px 12px;border-radius:6px;font-size:13px;margin:0;">⬇ 一键下载全部</button>
                </div>
            </div>
            <div id="dlgDownloadItems" style="flex:1;overflow-y:auto;font-size:14px;color:var(--text2);margin-bottom:15px;min-height:100px;display:flex;flex-direction:column;gap:10px;"></div>
            <button id="dlgDownloadClose" class="tool-btn" style="width:100%;padding:12px;border-radius:8px;background:var(--bg3);border:1px solid var(--border);font-size:15px;color:var(--text);">关闭窗口</button>
        </div>
    `;
    dlg.style.display = 'flex';
    dlg.querySelector('#dlgDownloadClose').onclick = () => dlg.style.display = 'none';
    const container = dlg.querySelector('#dlgDownloadItems');
    container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text2);">正在获取下载链接，请稍候...</div>';
    
    const readyButtons = [];
    const allUrls = []; // 专门用来装批量复制的链接
    let index = 0;
    const baseUrl = window.location.origin;

    async function worker() {
        while (index < songs.length) {
            const i = index++;
            const s = songs[i];
            let row = document.getElementById(`dl-row-${i}`);
            if (!row) {
                row = document.createElement('div');
                row.id = `dl-row-${i}`;
                row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:12px;background:var(--bg3);border-radius:10px;border:1px solid var(--border);';
                row.innerHTML = `
                    <div style="flex:1;min-width:0;margin-right:10px;">
                        <div style="font-size:14px;font-weight:500;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(s.name)}</div>
                        <div style="font-size:12px;color:var(--text2);margin-top:2px;">${esc(s.singer || '未知')}</div>
                    </div>
                    <div style="display:flex;gap:6px;flex-shrink:0;">
                        <button class="tool-btn" style="padding:6px 10px;border-radius:6px;font-size:13px;margin:0;width:70px;" id="dl-btn-${i}">获取中...</button>
                    </div>
                `;
                if (container.innerHTML.includes('正在获取')) container.innerHTML = '';
                container.appendChild(row);
            }
            const btn = document.getElementById(`dl-btn-${i}`);
            try {
                const result = await getBestPlayUrl(s, quality);
                if (result && result.url) {
                    let ext = quality === 'flac' ? 'flac' : 'mp3';
                    const match = result.url.match(/\.(flac|mp3|m4a|wav|ape)(?:\?|$)/i);
                    if (match) ext = match[1];
                    
                    const realSong = result.song || s;
                    const finalName = `${realSong.name} - ${realSong.singer || '未知'}`.replace(/[\\/:*?"<>|]/g, '_') + `.${ext}`;
                    
                    // 拼接完整的绝对路径
                    const fullUrl = `${baseUrl}/api/music/download?url=${encodeURIComponent(result.url)}&filename=${encodeURIComponent(finalName)}&inline=0`;
                    
                    // 🚀 塞入批量复制的数组里
                    allUrls.push(fullUrl);

                    btn.textContent = '⬇ 下载'; btn.className = 'tool-btn green'; btn.disabled = false;
                    btn.onclick = () => {
                        const iframe = document.createElement('iframe');
                        iframe.style.display = 'none';
                        iframe.src = fullUrl;
                        document.body.appendChild(iframe);
                        setTimeout(() => iframe.remove(), 60000);
                        btn.textContent = '✅ 已下载'; btn.className = 'tool-btn'; btn.disabled = true;
                    };
                    readyButtons.push(btn);
                } else { 
                    btn.textContent = '无音源'; btn.className = 'tool-btn red'; btn.disabled = true; 
                }
            } catch(e) { 
                console.error(e);
                btn.textContent = '失败'; btn.className = 'tool-btn red'; btn.disabled = true; 
            }
        }
    }
    Promise.all([worker(), worker()]);
    
    // 一键下载全部（浏览器行为）
    dlg.querySelector('#dlgDownloadAll').onclick = () => {
        const avail = readyButtons.filter(b => !b.disabled);
        if (!avail.length) return alert('暂无可下载的歌曲，或均已触发');
        avail.forEach((btn, idx) => setTimeout(() => btn.click(), idx * 1200));
    };

    // 🚀 一键复制全部（直接甩给 1DM）
    dlg.querySelector('#dlgCopyAll').onclick = () => {
        if (!allUrls.length) return alert('还没有获取到任何链接，请稍候再试');
        const text = allUrls.join('\n'); // 把所有链接换行拼接
        
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed";
        textArea.style.top = "0";
        textArea.style.left = "0";
        textArea.style.opacity = "0";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        
        try {
            const successful = document.execCommand('copy');
            const cpBtn = dlg.querySelector('#dlgCopyAll');
            if (successful) {
                cpBtn.textContent = '✅ 全部已复制';
                cpBtn.style.color = 'var(--green)';
                cpBtn.style.borderColor = 'var(--green)';
            } else {
                cpBtn.textContent = '❌ 复制失败';
            }
            setTimeout(() => {
                cpBtn.textContent = '📋 一键复制全部';
                cpBtn.style.color = 'var(--text)';
                cpBtn.style.borderColor = 'var(--border)';
            }, 2000);
        } catch (err) {
            alert('复制失败，请手动选中');
        }
        document.body.removeChild(textArea);
    };
};

// ==========================================
// 🚀 终极联动版：一键静默复制 + 唤醒 1DM 批量接管
// ==========================================
window.showDownloadDialog = function(songs, quality) {
    let dlg = document.getElementById('dlgDownloadList');
    if (!dlg) {
        dlg = document.createElement('div');
        dlg.id = 'dlgDownloadList';
        dlg.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.5);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(8px);';
        document.body.appendChild(dlg);
    }
    dlg.innerHTML = `
        <div style="background:var(--bg2);border-radius:16px;padding:20px;max-width:600px;width:100%;max-height:80vh;display:flex;flex-direction:column;border:1px solid var(--border);box-shadow:0 10px 40px rgba(0,0,0,.4);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:15px;flex-wrap:wrap;gap:10px;">
                <span style="color:var(--text);font-size:16px;font-weight:bold;">📥 本地下载列表</span>
                <div style="display:flex;gap:8px;">
                    <button id="dlgCopyAll" class="tool-btn" style="padding:6px 12px;border-radius:6px;font-size:13px;margin:0;background:var(--bg3);border:1px solid var(--border);color:var(--text);">📋 一键复制</button>
                    <button id="dlgSend1DM" class="tool-btn blue" style="padding:6px 12px;border-radius:6px;font-size:13px;margin:0;">🚀 发往 1DM</button>
                </div>
            </div>
            <div id="dlgDownloadItems" style="flex:1;overflow-y:auto;font-size:14px;color:var(--text2);margin-bottom:15px;min-height:100px;display:flex;flex-direction:column;gap:10px;"></div>
            <button id="dlgDownloadClose" class="tool-btn" style="width:100%;padding:12px;border-radius:8px;background:var(--bg3);border:1px solid var(--border);font-size:15px;color:var(--text);">关闭窗口</button>
        </div>
    `;
    dlg.style.display = 'flex';
    dlg.querySelector('#dlgDownloadClose').onclick = () => dlg.style.display = 'none';
    const container = dlg.querySelector('#dlgDownloadItems');
    container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text2);">正在获取下载链接，请稍候...</div>';
    
    const allUrls = []; 
    let index = 0;
    const baseUrl = window.location.origin;

    async function worker() {
        while (index < songs.length) {
            const i = index++;
            const s = songs[i];
            let row = document.getElementById(`dl-row-${i}`);
            if (!row) {
                row = document.createElement('div');
                row.id = `dl-row-${i}`;
                row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:12px;background:var(--bg3);border-radius:10px;border:1px solid var(--border);';
                row.innerHTML = `
                    <div style="flex:1;min-width:0;margin-right:10px;">
                        <div style="font-size:14px;font-weight:500;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(s.name)}</div>
                        <div style="font-size:12px;color:var(--text2);margin-top:2px;">${esc(s.singer || '未知')}</div>
                    </div>
                    <div style="display:flex;gap:6px;flex-shrink:0;">
                        <button class="tool-btn" style="padding:6px 10px;border-radius:6px;font-size:13px;margin:0;width:70px;" id="dl-btn-${i}">获取中...</button>
                    </div>
                `;
                if (container.innerHTML.includes('正在获取')) container.innerHTML = '';
                container.appendChild(row);
            }
            const btn = document.getElementById(`dl-btn-${i}`);
            try {
                const result = await getBestPlayUrl(s, quality);
                if (result && result.url) {
                    let ext = quality === 'flac' ? 'flac' : 'mp3';
                    const match = result.url.match(/\.(flac|mp3|m4a|wav|ape)(?:\?|$)/i);
                    if (match) ext = match[1];
                    
                    const realSong = result.song || s;
                    const finalName = `${realSong.name} - ${realSong.singer || '未知'}`.replace(/[\\/:*?"<>|]/g, '_') + `.${ext}`;
                    const fullUrl = `${baseUrl}/api/music/download?url=${encodeURIComponent(result.url)}&filename=${encodeURIComponent(finalName)}&inline=0`;
                    
                    allUrls.push(fullUrl);

                    btn.textContent = '⬇ 下载'; btn.className = 'tool-btn green'; btn.disabled = false;
                    btn.onclick = () => {
                        const iframe = document.createElement('iframe');
                        iframe.style.display = 'none';
                        iframe.src = fullUrl;
                        document.body.appendChild(iframe);
                        setTimeout(() => iframe.remove(), 60000);
                        btn.textContent = '✅ 已下载'; btn.className = 'tool-btn'; btn.disabled = true;
                    };
                } else { 
                    btn.textContent = '无音源'; btn.className = 'tool-btn red'; btn.disabled = true; 
                }
            } catch(e) { 
                btn.textContent = '失败'; btn.className = 'tool-btn red'; btn.disabled = true; 
            }
        }
    }
    Promise.all([worker(), worker(), worker()]);
    
    // 提取复制功能为公共函数
    function copyToClipboard(text) {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed";
        textArea.style.top = "0";
        textArea.style.left = "0";
        textArea.style.opacity = "0";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        let res = false;
        try { res = document.execCommand('copy'); } catch(e) {}
        document.body.removeChild(textArea);
        return res;
    }

    // 📋 一键复制（不跳转）
    dlg.querySelector('#dlgCopyAll').onclick = () => {
        if (!allUrls.length) return alert('还没有获取到任何链接，请稍候再试');
        const cpBtn = dlg.querySelector('#dlgCopyAll');
        if (copyToClipboard(allUrls.join('\n'))) {
            cpBtn.textContent = '✅ 已复制';
            cpBtn.style.color = 'var(--green)';
            cpBtn.style.borderColor = 'var(--green)';
            setTimeout(() => { cpBtn.textContent = '📋 一键复制'; cpBtn.style.color = 'var(--text)'; cpBtn.style.borderColor = 'var(--border)'; }, 2000);
        }
    };

    // 🚀 发往 1DM (一键复制 + 自动唤醒)
    dlg.querySelector('#dlgSend1DM').onclick = () => {
        if (!allUrls.length) return alert('还没有获取到任何链接，请稍候再试');
        if (copyToClipboard(allUrls.join('\n'))) {
            alert(`✅ 已成功复制 ${allUrls.length} 条直链！\n\n即将为你唤醒 1DM，请在 1DM 内点击『从剪贴板批量下载』即可瞬间全拉取！`);
            setTimeout(() => {
                // 尝试调起 1DM (如果安装了的话)
                window.location.href = 'idm://';
                // 备用 scheme: intent://#Intent;package=idm.internet.download.manager;end
            }, 500);
        } else {
            alert('复制失败，请使用“一键复制”后手动去 1DM 粘贴。');
        }
    };
};

// ==========================================
// 🚀 极简版：只保留一键复制，点击后提示去下载器
// ==========================================
window.showDownloadDialog = function(songs, quality) {
    let dlg = document.getElementById('dlgDownloadList');
    if (!dlg) {
        dlg = document.createElement('div');
        dlg.id = 'dlgDownloadList';
        dlg.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.5);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(8px);';
        document.body.appendChild(dlg);
    }
    
    // 顶部只保留一个“一键复制”按钮
    dlg.innerHTML = `
        <div style="background:var(--bg2);border-radius:16px;padding:20px;max-width:600px;width:100%;max-height:80vh;display:flex;flex-direction:column;border:1px solid var(--border);box-shadow:0 10px 40px rgba(0,0,0,.4);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:15px;">
                <span style="color:var(--text);font-size:16px;font-weight:bold;">📥 本地下载列表</span>
                <button id="dlgCopyAll" class="tool-btn blue" style="padding:6px 12px;border-radius:6px;font-size:13px;margin:0;">📋 一键复制全部</button>
            </div>
            <div id="dlgDownloadItems" style="flex:1;overflow-y:auto;font-size:14px;color:var(--text2);margin-bottom:15px;min-height:100px;display:flex;flex-direction:column;gap:10px;"></div>
            <button id="dlgDownloadClose" class="tool-btn" style="width:100%;padding:12px;border-radius:8px;background:var(--bg3);border:1px solid var(--border);font-size:15px;color:var(--text);">关闭窗口</button>
        </div>
    `;
    dlg.style.display = 'flex';
    dlg.querySelector('#dlgDownloadClose').onclick = () => dlg.style.display = 'none';
    const container = dlg.querySelector('#dlgDownloadItems');
    container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text2);">正在获取下载链接，请稍候...</div>';
    
    const allUrls = []; 
    let index = 0;
    const baseUrl = window.location.origin;

    async function worker() {
        while (index < songs.length) {
            const i = index++;
            const s = songs[i];
            let row = document.getElementById(`dl-row-${i}`);
            if (!row) {
                row = document.createElement('div');
                row.id = `dl-row-${i}`;
                row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:12px;background:var(--bg3);border-radius:10px;border:1px solid var(--border);';
                row.innerHTML = `
                    <div style="flex:1;min-width:0;margin-right:10px;">
                        <div style="font-size:14px;font-weight:500;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(s.name)}</div>
                        <div style="font-size:12px;color:var(--text2);margin-top:2px;">${esc(s.singer || '未知')}</div>
                    </div>
                    <div style="display:flex;gap:6px;flex-shrink:0;">
                        <button class="tool-btn" style="padding:6px 10px;border-radius:6px;font-size:13px;margin:0;width:70px;" id="dl-btn-${i}">获取中...</button>
                    </div>
                `;
                if (container.innerHTML.includes('正在获取')) container.innerHTML = '';
                container.appendChild(row);
            }
            const btn = document.getElementById(`dl-btn-${i}`);
            try {
                const result = await getBestPlayUrl(s, quality);
                if (result && result.url) {
                    let ext = quality === 'flac' ? 'flac' : 'mp3';
                    const match = result.url.match(/\.(flac|mp3|m4a|wav|ape)(?:\?|$)/i);
                    if (match) ext = match[1];
                    
                    const realSong = result.song || s;
                    const finalName = `${realSong.name} - ${realSong.singer || '未知'}`.replace(/[\\/:*?"<>|]/g, '_') + `.${ext}`;
                    const fullUrl = `${baseUrl}/api/music/download?url=${encodeURIComponent(result.url)}&filename=${encodeURIComponent(finalName)}&inline=0`;
                    
                    allUrls.push(fullUrl);

                    btn.textContent = '⬇ 下载'; btn.className = 'tool-btn green'; btn.disabled = false;
                    btn.onclick = () => {
                        const iframe = document.createElement('iframe');
                        iframe.style.display = 'none';
                        iframe.src = fullUrl;
                        document.body.appendChild(iframe);
                        setTimeout(() => iframe.remove(), 60000);
                        btn.textContent = '✅ 已下载'; btn.className = 'tool-btn'; btn.disabled = true;
                    };
                } else { 
                    btn.textContent = '无音源'; btn.className = 'tool-btn red'; btn.disabled = true; 
                }
            } catch(e) { 
                btn.textContent = '失败'; btn.className = 'tool-btn red'; btn.disabled = true; 
            }
        }
    }
    Promise.all([worker(), worker(), worker()]);
    
    function copyToClipboard(text) {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed";
        textArea.style.top = "0";
        textArea.style.left = "0";
        textArea.style.opacity = "0";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        let res = false;
        try { res = document.execCommand('copy'); } catch(e) {}
        document.body.removeChild(textArea);
        return res;
    }

    // 点击一键复制，弹窗提示去下载器
    dlg.querySelector('#dlgCopyAll').onclick = () => {
        if (!allUrls.length) return alert('还没有获取到任何链接，请稍候再试');
        const cpBtn = dlg.querySelector('#dlgCopyAll');
        if (copyToClipboard(allUrls.join('\n'))) {
            cpBtn.textContent = '✅ 已复制';
            cpBtn.style.background = 'var(--green)';
            cpBtn.style.borderColor = 'var(--green)';
            setTimeout(() => {
                cpBtn.textContent = '📋 一键复制全部';
                cpBtn.style.background = 'var(--blue)';
                cpBtn.style.borderColor = 'var(--blue)';
            }, 2000);
            
            // 弹出提示语
            alert(`✅ 成功复制 ${allUrls.length} 条下载链接！\n\n请打开你的下载器（如 1DM/IDM），选择“从剪贴板添加”即可开始批量下载。`);
        } else {
            alert('复制失败，请重试或手动单条复制。');
        }
    };
};

// ==========================================
// 🚀 修复提示层级被遮挡：使用自定义悬浮提示
// ==========================================
window.showDownloadDialog = function(songs, quality) {
    let dlg = document.getElementById('dlgDownloadList');
    if (!dlg) {
        dlg = document.createElement('div');
        dlg.id = 'dlgDownloadList';
        dlg.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.5);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(8px);';
        document.body.appendChild(dlg);
    }
    
    dlg.innerHTML = `
        <div style="background:var(--bg2);border-radius:16px;padding:20px;max-width:600px;width:100%;max-height:80vh;display:flex;flex-direction:column;border:1px solid var(--border);box-shadow:0 10px 40px rgba(0,0,0,.4);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:15px;">
                <span style="color:var(--text);font-size:16px;font-weight:bold;">📥 本地下载列表</span>
                <button id="dlgCopyAll" class="tool-btn blue" style="padding:6px 12px;border-radius:6px;font-size:13px;margin:0;">📋 一键复制全部</button>
            </div>
            <div id="dlgDownloadItems" style="flex:1;overflow-y:auto;font-size:14px;color:var(--text2);margin-bottom:15px;min-height:100px;display:flex;flex-direction:column;gap:10px;"></div>
            <button id="dlgDownloadClose" class="tool-btn" style="width:100%;padding:12px;border-radius:8px;background:var(--bg3);border:1px solid var(--border);font-size:15px;color:var(--text);">关闭窗口</button>
        </div>
    `;
    dlg.style.display = 'flex';
    dlg.querySelector('#dlgDownloadClose').onclick = () => dlg.style.display = 'none';
    const container = dlg.querySelector('#dlgDownloadItems');
    container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text2);">正在获取下载链接，请稍候...</div>';
    
    const allUrls = []; 
    let index = 0;
    const baseUrl = window.location.origin;

    async function worker() {
        while (index < songs.length) {
            const i = index++;
            const s = songs[i];
            let row = document.getElementById(`dl-row-${i}`);
            if (!row) {
                row = document.createElement('div');
                row.id = `dl-row-${i}`;
                row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:12px;background:var(--bg3);border-radius:10px;border:1px solid var(--border);';
                row.innerHTML = `
                    <div style="flex:1;min-width:0;margin-right:10px;">
                        <div style="font-size:14px;font-weight:500;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(s.name)}</div>
                        <div style="font-size:12px;color:var(--text2);margin-top:2px;">${esc(s.singer || '未知')}</div>
                    </div>
                    <div style="display:flex;gap:6px;flex-shrink:0;">
                        <button class="tool-btn" style="padding:6px 10px;border-radius:6px;font-size:13px;margin:0;width:70px;" id="dl-btn-${i}">获取中...</button>
                    </div>
                `;
                if (container.innerHTML.includes('正在获取')) container.innerHTML = '';
                container.appendChild(row);
            }
            const btn = document.getElementById(`dl-btn-${i}`);
            try {
                const result = await getBestPlayUrl(s, quality);
                if (result && result.url) {
                    let ext = quality === 'flac' ? 'flac' : 'mp3';
                    const match = result.url.match(/\.(flac|mp3|m4a|wav|ape)(?:\?|$)/i);
                    if (match) ext = match[1];
                    
                    const realSong = result.song || s;
                    const finalName = `${realSong.name} - ${realSong.singer || '未知'}`.replace(/[\\/:*?"<>|]/g, '_') + `.${ext}`;
                    const fullUrl = `${baseUrl}/api/music/download?url=${encodeURIComponent(result.url)}&filename=${encodeURIComponent(finalName)}&inline=0`;
                    
                    allUrls.push(fullUrl);

                    btn.textContent = '⬇ 下载'; btn.className = 'tool-btn green'; btn.disabled = false;
                    btn.onclick = () => {
                        const iframe = document.createElement('iframe');
                        iframe.style.display = 'none';
                        iframe.src = fullUrl;
                        document.body.appendChild(iframe);
                        setTimeout(() => iframe.remove(), 60000);
                        btn.textContent = '✅ 已下载'; btn.className = 'tool-btn'; btn.disabled = true;
                    };
                } else { 
                    btn.textContent = '无音源'; btn.className = 'tool-btn red'; btn.disabled = true; 
                }
            } catch(e) { 
                btn.textContent = '失败'; btn.className = 'tool-btn red'; btn.disabled = true; 
            }
        }
    }
    Promise.all([worker(), worker(), worker()]);
    
    function copyToClipboard(text) {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed";
        textArea.style.top = "0";
        textArea.style.left = "0";
        textArea.style.opacity = "0";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        let res = false;
        try { res = document.execCommand('copy'); } catch(e) {}
        document.body.removeChild(textArea);
        return res;
    }

    // 🚀 自定义最高层级 Toast 提示框，绝对不被遮挡
    function showToast(msg) {
        let toast = document.createElement('div');
        toast.style.cssText = 'position:fixed;top:30%;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.85);color:#fff;padding:14px 24px;border-radius:10px;font-size:15px;z-index:99999999;text-align:center;box-shadow:0 4px 12px rgba(0,0,0,0.5);pointer-events:none;transition:opacity 0.3s;line-height:1.5;white-space:nowrap;';
        toast.innerHTML = msg;
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 2500);
    }

    // 点击一键复制
    dlg.querySelector('#dlgCopyAll').onclick = () => {
        if (!allUrls.length) return alert('还没有获取到任何链接，请稍候再试');
        const cpBtn = dlg.querySelector('#dlgCopyAll');
        if (copyToClipboard(allUrls.join('\n'))) {
            cpBtn.textContent = '✅ 已复制';
            cpBtn.style.background = 'var(--green)';
            cpBtn.style.borderColor = 'var(--green)';
            
            // 显示自定义悬浮提示，并自动关闭下载框
            showToast(`✅ 已复制 ${allUrls.length} 条链接<br><span style="font-size:13px;color:#aaa">请去下载器粘贴</span>`);
            
            setTimeout(() => {
                cpBtn.textContent = '📋 一键复制全部';
                cpBtn.style.background = 'var(--blue)';
                cpBtn.style.borderColor = 'var(--blue)';
                // 复制完顺便把下载框关掉，方便你直接切去下载器
                dlg.style.display = 'none';
            }, 1500);
            
        } else {
            alert('复制失败，请重试或手动单条复制。');
        }
    };
};

// ==========================================
// 🚀 多用户管理系统终极补丁
// ==========================================

// ==========================================
// 🚀 原生多用户管理逻辑
// ==========================================
function applyPermissions() {
  const isAdmin = (currentUser === 'admin');
  if (isAdmin) {
    document.body.classList.add('is-admin');
  } else {
    document.body.classList.remove('is-admin');
  }
  const mgr = document.getElementById('adminUserMgr');
  if (mgr) mgr.style.display = isAdmin ? 'block' : 'none';
  
  const setBtn = document.getElementById('settingsBtn');
  if (setBtn) setBtn.style.display = isAdmin ? '' : 'none';
  
  const dlTab = document.querySelector('.tab-btn[data-tab="download"]');
  if (dlTab) dlTab.style.display = isAdmin ? '' : 'none';
  
  const dlNasBtn = document.getElementById('rankDownloadNAS');
  if (dlNasBtn) dlNasBtn.style.display = isAdmin ? '' : 'none';

  // 核心优化：控制顶部退出按钮的显示
  const logoutBtnTop = document.getElementById('logoutBtnTop');
  if (logoutBtnTop) {
    logoutBtnTop.style.display = isAdmin ? 'none' : 'flex';
  }
}

async function loadUserList() {
  const listEl = document.getElementById('adminUserList');
  if (!listEl) return;
  try {
    const res = await fetch('/api/users', { headers: { 'x-frontend-auth': localStorage.getItem('nas_music_pwd') } });
    const users = await res.json();
    const realUsers = users.filter(u => u.name !== '_open');
    
    listEl.innerHTML = realUsers.map(u => `
      <div style="display:flex;justify-content:space-between;align-items:center;background:var(--bg3);padding:8px 12px;border-radius:8px;">
        <span style="font-size:14px;color:var(--text);">${u.name}${u.name === 'admin' ? ' (管理员)' : ''}</span>
        ${u.name !== 'admin' ? `<button class="tool-btn red" style="padding:4px 8px;font-size:12px;" onclick="window.delUser('${u.name}')">删除</button>` : ''}
      </div>
    `).join('');
    if (!realUsers.length) listEl.innerHTML = '<div style="color:var(--text2);font-size:13px;">暂无用户</div>';
  } catch(e) {
    listEl.innerHTML = '<div style="color:var(--red);font-size:13px;">获取用户列表失败</div>';
  }
}

window.delUser = async (name) => {
  if (!confirm(`确定删除用户 [${name}] 吗？`)) return;
  try {
    await fetch('/api/users', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'x-frontend-auth': localStorage.getItem('nas_music_pwd') },
      body: JSON.stringify({ name: name })
    });
    alert('✅ 用户已删除');
    loadUserList();
  } catch(e) { alert('删除失败'); }
};

document.addEventListener('DOMContentLoaded', () => {
  // 绑定添加用户按钮
  const addBtn = document.getElementById('addUserBtn');
  if (addBtn) {
    addBtn.onclick = async () => {
      const name = document.getElementById('newUserName').value.trim();
      const pwd = document.getElementById('newUserPwd').value.trim();
      if (!name || !pwd) return alert('请输入用户名和密码');
      if (pwd.length < 3) return alert('密码至少3位');
      
      try {
        addBtn.textContent = '添加中...';
        const res = await fetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-frontend-auth': localStorage.getItem('nas_music_pwd') },
          body: JSON.stringify({ name, password: pwd })
        });
        if (!res.ok) throw new Error(await res.text());
        alert(`✅ 用户「${name}」创建成功`);
        document.getElementById('newUserName').value = '';
        document.getElementById('newUserPwd').value = '';
        loadUserList();
      } catch(e) { alert('创建失败: ' + e.message); }
      finally { addBtn.textContent = '➕ 添加新用户'; }
    };
  }

  // 绑定顶部退出按钮动态生成
  const setBtn = document.getElementById('settingsBtn');
  if (setBtn && !document.getElementById('logoutBtnTop')) {
    setBtn.insertAdjacentHTML('beforebegin', `
      <button class="icon-btn theme-btn" id="logoutBtnTop" title="退出登录" style="display:none; align-items:center; justify-content:center; height:36px; padding:0 12px; margin-right:8px; font-size:14px; font-weight:600; border-radius:8px; background:transparent; border:none; color:var(--text);">
        退出
      </button>
    `);
  }
  const logoutBtnTop = document.getElementById('logoutBtnTop');
  if (logoutBtnTop) {
    logoutBtnTop.onclick = () => { localStorage.clear(); location.reload(); };
  }


});

// ==========================================
// 🚀 终极抢救：强制接管进度条更新与歌词渲染
// ==========================================
setTimeout(() => {
    const audio = document.getElementById('audioEl');
    if (!audio) return;

    // 1. 强制重绑时间更新事件（覆盖原有失效事件）
    audio.ontimeupdate = function() {
        const pct = audio.duration ? (audio.currentTime / audio.duration * 100) : 0;
        const tStr = `${fmtTime(audio.currentTime)} / ${fmtTime(audio.duration)}`;
        
        const fill1 = document.getElementById('progressFill');
        const fill2 = document.getElementById('fsProgressFill');
        if (fill1) fill1.style.width = pct + '%';
        if (fill2) fill2.style.width = pct + '%';
        
        const time1 = document.getElementById('playerTime');
        const time2 = document.getElementById('fsTime');
        if (time1) time1.textContent = tStr;
        if (time2) time2.textContent = tStr;
        
        // 同步滚动歌词
        if (typeof window.renderLyric === 'function') {
            window.renderLyric(audio.currentTime);
        }
    };

    // 2. 强制重绑自动下一首事件
    audio.onended = function() {
        if (typeof playNext === 'function') playNext();
    };

    // 3. 重新实现歌词加载逻辑
    window._loadLyric = async function(song) {
        const el = document.getElementById('fsLyric');
        if (!el) return;
        el.innerHTML = '加载歌词中...';
        window.currentLyric = [];
        window.lastLyricIdx = -1;
        
        try {
            const src = song.source || 'kw';
            const sm = song.songmid || song.id;
            const res = await fetch(`/api/music/lyric?source=${src}&songmid=${sm}`, {
                headers: { 'x-frontend-auth': localStorage.getItem('nas_music_pwd') || '' }
            });
            const data = await res.json();
            const raw = data.lyric || data.content || '';
            
            window.currentLyric = raw.split('\n').filter(l => l.trim()).map(line => {
                const m = line.match(/\[(\d+):(\d+)(?:[.:](\d+))?\]/);
                if (!m) return null;
                const ms = m[3] ? (m[3].length === 2 ? +m[3]/100 : +m[3]/1000) : 0;
                const time = (+m[1]) * 60 + (+m[2]) + ms;
                const text = line.replace(/\[.*?\]/g, '').trim();
                return { time, text };
            }).filter(Boolean);
            
            if (window.currentLyric.length > 0) {
                window.renderLyric(0);
            } else {
                el.innerHTML = '暂无歌词';
            }
        } catch(e) {
            el.innerHTML = '歌词加载失败';
        }
    };

    // 4. 重新实现歌词渲染逻辑
    window.renderLyric = function(time) {
        const el = document.getElementById('fsLyric');
        if (!window.currentLyric || !window.currentLyric.length) return;
        
        let activeIdx = 0;
        for (let i = 0; i < window.currentLyric.length; i++) {
            if (window.currentLyric[i].time <= time) activeIdx = i;
            else break;
        }
        
        if (activeIdx === window.lastLyricIdx) return;
        window.lastLyricIdx = activeIdx;
        
        if (el.children.length !== window.currentLyric.length) {
            el.innerHTML = window.currentLyric.map((l, i) => 
                `<div class="${i === activeIdx ? 'active' : ''}" data-time="${l.time}" style="cursor:pointer;padding:8px 0;">${esc(l.text)}</div>`
            ).join('');
            
            // 点击歌词跳转
            el.onclick = (e) => {
                const d = e.target.closest('[data-time]');
                if (!d) return;
                const t = parseFloat(d.dataset.time);
                if (isFinite(t)) audio.currentTime = t;
            };
        } else {
            Array.from(el.children).forEach((c, i) => c.classList.toggle('active', i === activeIdx));
        }
        
        const activeEl = el.children[activeIdx];
        if (activeEl) activeEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
    };
    
    // 如果当前有正在播放的歌，立刻触发一次歌词加载
    if (typeof currentSongList !== 'undefined' && currentSongIdx >= 0) {
        window._loadLyric(currentSongList[currentSongIdx]);
    }
}, 1500);
