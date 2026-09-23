/* ============================================================
 * NAS歌曲下载 - 前端逻辑
 * ============================================================ */

const API = '';

let authPassword = localStorage.getItem('nas_music_pwd') || '';
let isGuest = localStorage.getItem('nas_music_guest') === '1';
let guestPasswords = []; // [{name, hash}] 访客密码哈希列表

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
const THEMES = ['classic', 'red', 'sunset', 'yellow', 'forest', 'deep', 'purple'];

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

  themeBtn.onclick = (e) => {
    e.stopPropagation();
    themePanel.classList.toggle('open');
  };

  themePanel.querySelectorAll('.theme-option').forEach(opt => {
    opt.onclick = () => {
      applyTheme(opt.dataset.theme);
      themePanel.classList.remove('open');
    };
  });

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
      throw new Error(`${res.status}: ${t.slice(0, 200)}`);
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
  const pwd = $('loginPassword').value;
  if (!pwd) return;
  $('loginError').textContent = '';
  try {
    const r = await api('/api/admin/verify', {
      method: 'POST',
      headers: { 'x-frontend-auth': pwd },
    });
    if (r && r.success) {
      saveAuth(pwd);
      showApp(); onAppReady();
      return;
    }
    $('loginError').textContent = '密码错误';
  } catch (err) {
    const isAuthFail = /^401/.test(err.message);
    $('loginError').textContent = isAuthFail ? '密码错误' : '登录失败，请检查网络或后端服务';
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
    el.innerHTML = '🔥 热搜：' + (data.list || []).map(w =>
      `<span data-w="${escAttr(w)}">${esc(w)}</span>`
    ).join('');
    el.onclick = (e) => {
      const w = e.target.dataset.w;
      if (w) { $('searchInput').value = w; doSearch(); }
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
      <input type="checkbox" class="song-check">
      <span class="song-num">${i + 1}</span>
      <div class="song-info">
        <div class="song-name">${esc(s.name)}</div>
        <div class="song-singer">${esc(s.singer)} · ${esc(s.albumName || s.album || '')}</div>
      </div>
      <span class="song-quality">${esc(types)}</span>
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
  // 用用户选择的音源搜索
  let searchSong = song;
  if (activeSource !== song.source) {
    const q = `${song.name} ${song.singer || ''}`.trim();
    const data = await api(`/api/music/search?name=${encodeURIComponent(q)}&source=${activeSource}&type=song&limit=1&page=1`);
    const results = Array.isArray(data) ? data : (data.data || data.songs || []);
    if (!results.length) throw new Error('未找到歌曲');
    searchSong = results[0];
  }
  const r = await api('/api/music/url', {
    method: 'POST',
    body: { songInfo: searchSong, quality, enableAutoSwitchApiSource: true },
  });
  if (!r.url) throw new Error('未获取到播放链接');
  return { url: r.url, song: searchSong, source: activeSource, sourceName: SOURCE_NAMES[activeSource], switched: activeSource !== song.source };
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

  if (window._loadLyric) window._loadLyric(song);

  try {
    $('playerSinger').textContent = song.singer + ' · 匹配音源...';
    const result = await getBestPlayUrl(song, currentQuality);
    song = result.song;
    if (result.switched) {
      $('playerSinger').textContent = song.singer + ' · 已切换到' + result.sourceName;
    }
    if (!result.url) {
      $('playerSinger').textContent = song.singer;
      alert('无法获取播放地址');
      return;
    }
    const audio = $('audioEl');
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
    alert('获取失败，请切换平台再试');
  }
}

function setPlayIcon(playing) {
  const icon = playing ? '⏸' : '▶';
  $('btnPlay').textContent = icon;
  $('fsPlay').textContent = icon;
  $('fsPlayOverlay').textContent = icon;
}
function togglePlay() {
  const audio = $('audioEl');
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
      <span class="song-quality">${meta}</span>
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
    const sources = await fetchSources();
    if (!sources.length) {
      el.innerHTML = '<div style="color:var(--text2);padding:8px">暂无音源</div>';
      return;
    }
    el.innerHTML = sources.map(s => {
      const broken = s.status === 'error';
      const badge = broken ? 'off' : (s.enabled ? 'on' : 'off');
      const badgeText = broken ? '加载失败' : (s.enabled ? '已启用' : '已禁用');
      return `
        <div class="source-item" data-id="${escAttr(s.id)}">
          <div class="source-info">
            <div class="source-name">${esc(s.name)} <span class="source-meta">v${esc(s.version || '')}</span></div>
          </div>
          <span class="source-badge ${badge}">${badgeText}</span>
          <button class="tool-btn src-toggle-btn" ${broken ? 'disabled' : ''}>${s.enabled ? '禁用' : '启用'}</button>
          <button class="tool-btn red src-del-btn">删除</button>
        </div>`;
    }).join('');
    el.onclick = async (e) => {
      const btn = e.target.closest('button');
      if (!btn || btn.disabled) return;
      const item = btn.closest('.source-item');
      if (!item) return;
      const id = item.dataset.id;
      try {
        if (btn.classList.contains('src-toggle-btn')) {
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
        } else if (btn.classList.contains('src-del-btn')) {
          if (!confirm('确认删除此音源？')) return;
          await deleteSourceById(id);
          loadSources();
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
      } else if (newSrc && !newSrc.enabled) {
        await toggleSourceById(newSrc.id);
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
            $('sourceSelect').value = src;
          }
          return;
        }
      } catch (e) {}
    }
    alert(`${SOURCE_NAMES[activeSource] || activeSource}音源不可用，请上传可用音源`);
  })();
}

function applyGuestMode() {
  // 隐藏歌单、下载tab
  document.querySelectorAll('[data-tab="playlist"]').forEach(el => el.style.display = 'none');
  document.querySelectorAll('[data-tab="download"]').forEach(el => el.style.display = 'none');
  // 隐藏下载到NAS、保存到歌单、设置、主题等按钮
  document.querySelectorAll('.guest-hide').forEach(el => el.style.display = 'none');
  // 顶部显示退出按钮
  let exitBtn = $('guestExitBtn');
  if (!exitBtn) {
    exitBtn = document.createElement('button');
    exitBtn.id = 'guestExitBtn';
    exitBtn.className = 'guest-exit-btn';
    exitBtn.textContent = '退出访客';
    exitBtn.onclick = () => {
      isGuest = false;
      localStorage.removeItem('nas_music_guest');
      location.reload();
    };
    document.querySelector('.topbar-right').appendChild(exitBtn);
  }
}

/* ---------- 歌词 ---------- */
let currentLyric = [];
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
      const m = line.match(/\[(\d+):(\d+)\.(\d+)\]/);
      if (!m) return null;
      const time = (+m[1]) * 60 + (+m[2]) + (+m[3]) / 100;
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
      `<div class="${i === activeIdx ? 'active' : ''}">${esc(l.text)}</div>`
    ).join('');
  } else {
    Array.from(el.children).forEach((c, i) => c.classList.toggle('active', i === activeIdx));
  }
  const activeEl = el.children[activeIdx];
  if (activeEl) activeEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
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

  // 从sidecar读取访客密码列表（无需认证）
  try {
    const resp = await fetch('/api/guest-config');
    const cfg = await resp.json();
    const serverName = cfg.serverName || '';
    if (serverName === '__guest_off__' || !serverName || serverName === 'lxserver') {
      guestPasswords = [];
    } else {
      guestPasswords = serverName.split(',').filter(Boolean).map(item => {
        const [name, hash] = item.split(':');
        return { name: name || '未命名', hash: hash || '' };
      });
    }
  } catch (e) {
    guestPasswords = [];
  }

  if (isGuest) {
    showApp();
    applyGuestMode();
    loadHotSearch();
    startAutoDetect();
  } else if (authPassword) {
    showApp(); onAppReady();
    startAutoDetect();
  } else {
    $('loginPage').classList.remove('hidden');
    $('app').classList.add('hidden');
    // 有访客密码才显示访客按钮
    $('guestBtn').style.display = guestPasswords.length ? '' : 'none';
  }

  // 音源选择
  const srcSel = $('sourceSelect');
  srcSel.value = activeSource;
  srcSel.onchange = async () => {
    activeSource = srcSel.value;
    localStorage.setItem('nas_music_source', activeSource);
    // 后台检测音源可用性：搜索+获取播放链接
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
      // 自动找下一个可用音源
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
      if (found) {
        alert(`${badSrc}音源不可用，已自动切换到${SOURCE_NAMES[activeSource] || activeSource}`);
      } else {
        alert(`${badSrc}音源不可用，请上传可用音源`);
      }
    }
  };

  $('loginBtn').onclick = doLogin;
  $('loginPassword').addEventListener('keydown', e => {
    if (e.key === 'Enter') doLogin();
  });
  // 访客模式
  $('guestBtn').onclick = async () => {
    const pwd = prompt('请输入访客密码：');
    if (pwd === null) return;
    const hash = await sha256(pwd);
    const found = guestPasswords.find(g => g.hash === hash);
    if (found) {
      isGuest = true;
      localStorage.setItem('nas_music_guest', '1');
      showApp();
      applyGuestMode();
      loadHotSearch();
      startAutoDetect();
    } else {
      alert('密码错误');
    }
  };

  document.querySelectorAll('.tab-btn').forEach(b => {
    b.onclick = () => switchTab(b.dataset.tab);
  });

  $('searchBtn').onclick = doSearch;
  $('searchInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') doSearch();
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
    const quality = await pickQuality('copylinks');
    if (!quality) return;

    const btn = $('rankCopyLinks');
    btn.textContent = '获取中...'; btn.disabled = true;
    const links = [];
    for (const s of songs) {
      try {
        const result = await getBestPlayUrl(s, quality);
        if (!result.url) { links.push(`${s.name} - ${s.singer}\t(失败)`); continue; }
        const srcTag = result.switched ? `[${result.sourceName}] ` : '';
        try {
          await api('/api/music/cache/download', {
            method: 'POST',
            body: { songInfo: result.song, url: result.url, quality, cacheLyric: false, embedLyric: false },
          });
          await new Promise(r => setTimeout(r, 1500));
          const cl = await api('/api/music/cache/list');
          const ok = (cl.data || []).some(x => x.name === s.name);
          links.push(ok ? `${srcTag}${s.name} - ${s.singer}\t${result.url}` : `${s.name} - ${s.singer}\t(链接不通)`);
        } catch (e) {
          links.push(`${s.name} - ${s.singer}\t(链接不通)`);
        }
      } catch (e) {
        links.push(`${s.name} - ${s.singer}\t(失败)`);
      }
    }
    showCopyDialog(links.join('\n'), links.length);
    btn.textContent = '获取链接';
    btn.disabled = false;
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
    renderGuestPwdList();
  };

  function renderGuestPwdList() {
    const el = $('guestPwdList');
    if (!el) return;
    if (!guestPasswords.length) {
      el.innerHTML = '<div style="color:var(--text2);font-size:12px">暂无访客密码</div>';
      return;
    }
    el.innerHTML = guestPasswords.map((g, i) =>
      `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)">
        <span><b>${esc(g.name)}</b></span>
        <button class="tool-btn red" style="padding:2px 8px;font-size:12px" data-del="${i}">删除</button>
      </div>`
    ).join('');
    el.querySelectorAll('[data-del]').forEach(btn => {
      btn.onclick = async () => {
        const i = parseInt(btn.dataset.del);
        guestPasswords.splice(i, 1);
        await saveGuestPasswords();
        renderGuestPwdList();
      };
    });
  }

  async function saveGuestPasswords() {
    try {
      const str = guestPasswords.length ? guestPasswords.map(g => `${g.name}:${g.hash}`).join(',') : '__guest_off__';
      await api('/api/config', { method: 'POST', body: { serverName: str } });
    } catch (e) {
      alert('保存失败：' + e.message);
    }
  }

  $('addGuestPwdBtn').onclick = async () => {
    const name = $('newGuestName').value.trim() || '未命名';
    const pwd = $('newGuestPwd').value.trim();
    if (!pwd) { alert('请输入密码'); return; }
    try {
      const hash = await sha256(pwd);
      if (guestPasswords.some(g => g.hash === hash)) { alert('密码已存在'); return; }
      guestPasswords.push({ name, hash });
      await saveGuestPasswords();
      $('newGuestName').value = '';
      $('newGuestPwd').value = '';
      renderGuestPwdList();
      alert('已添加：' + name + '（访客立即可用）');
    } catch (e) {
      alert('添加失败：' + e.message);
    }
  };
  $('closeSettings').onclick = () => $('settingsModal').classList.add('hidden');
  $('uploadSourceZone').onclick = () => $('sourceFileInput').click();
  $('sourceFileInput').onchange = (e) => {
    if (e.target.files[0]) uploadSource(e.target.files[0]);
    e.target.value = '';
  };
  $('importSourceBtn').onclick = importSource;

  $('changePwdBtn').onclick = async () => {
    const pwd = $('newPwdInput').value.trim();
    if (!pwd || pwd.length < 3) return alert('密码至少3位');
    try {
      await api('/api/admin/password', { method: 'POST', body: { newPassword: pwd } });
      authPassword = pwd;
      localStorage.setItem('nas_music_pwd', pwd);
      $('newPwdInput').value = '';
      alert('密码已修改');
    } catch (e) { alert('修改失败: ' + e.message); }
  };
  $('logoutBtn').onclick = () => {
    localStorage.removeItem('nas_music_pwd');
    location.reload();
  };

  $('btnPlay').onclick = togglePlay;
  $('fsPlay').onclick = togglePlay;
  $('fsPlayOverlay').onclick = togglePlay;
  $('btnNext').onclick = playNext;
  $('fsNext').onclick = playNext;
  $('btnPrev').onclick = playPrev;
  $('fsPrev').onclick = playPrev;

  $('playerBar').onclick = (e) => {
    if (e.target.closest('button')) return;
    $('playerFullscreen').classList.remove('hidden');
  };
  $('fsClose').onclick = () => $('playerFullscreen').classList.add('hidden');

  const audio = $('audioEl');
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
    if (e.target.classList.contains('song-check')) updateToolbarVisibility();
  });

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