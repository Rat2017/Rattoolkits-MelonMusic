const { app, BrowserWindow, ipcMain, globalShortcut, screen, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');
const { exec } = require('child_process');
const fs = require('fs');
const os = require('os');
const iconv = require('iconv-lite');

// ── 全局状态 ──
let overlayWindow = null;       // 悬浮窗窗口
let panelWindow = null;         // 控制面板窗口
let gamepadWindow = null;       // 手柄后台窗口
let currentSong = null;         // 当前歌曲信息
let previousSong = null;        // 上一曲
let nextSong = null;            // 下一曲
let neteaseCookie = null;       // 网易云登录 Cookie
let neteaseUid = null;          // 网易云用户 ID
let detectTimer = null;         // 检测定时器
let isDetecting = false;        // 是否正在检测歌曲
let lastSongKey = '';           // 上次检测到的歌曲标识（防重复）
const detectedSongs = new Set(); // 已检测过的歌曲 key，防 API 返回旧数据
let emptyPollCount = 0;         // 空轮询计数
let lastWinTitle = '';          // 上次窗口标题
let currentLyrics = '';        // 当前歌词文本
let currentLyricOffset = 0;    // 歌词同步偏移量（秒）
let currentLyricLines = [];    // 歌词时间行数组
const WIN_TITLE_INTERVAL = 800; // 窗口标题轮询间隔（毫秒）

let tray = null;
let settings = {
  opacity: 1, visible: true, x: 20, y: 200, width: 300, height: 110,
  phone: '', password: '', closeBehavior: 'quit',
  displayIndex: 0,
  showControls: false, showLyrics: false, showPrevNext: false,
  // autoRandom: false,
  lyricManualOffset: 0,
  overlayScale: 50,
  savedCookie: '', savedUid: null
};

// 默认键盘快捷键映射
const DEFAULT_KEYBOARD = {
  'MediaNextTrack': 'next',
  'MediaPreviousTrack': 'prev',
  'MediaPlayPause': 'playpause',
  'Ctrl+Shift+Right': 'next',
  'Ctrl+Shift+Left': 'prev',
  'Ctrl+Shift+Space': 'playpause'
};

let bindings = {
  keyboard: { ...DEFAULT_KEYBOARD },
  gamepad: {},
  mouse: {}
};

const ACTIONS = ['next', 'prev', 'playpause'];

// ── 自动随机播放 ──
// let autoRandomEnabled = false;
// let autoRandomTimer = null;

// function scheduleAutoRandom(durationMs) {
//   cancelAutoRandom();
//   if (!autoRandomEnabled || !durationMs || durationMs <= 0) return;
//   const delay = Math.max(5000, durationMs + 2000);
//   console.log(`自动随机: ${Math.round(delay/1000)}秒后随机下一首`);
//   autoRandomTimer = setTimeout(() => {
//     console.log('自动随机: 定时触发，播放随机歌曲');
//     playRandomSong();
//   }, delay);
// }

// function cancelAutoRandom() {
//   if (autoRandomTimer) {
//     clearTimeout(autoRandomTimer);
//     autoRandomTimer = null;
//   }
// }

// ── NeteaseCloudMusicApi（懒加载） ──
function getApi() {
  try { return require('NeteaseCloudMusicApi'); } catch (e) { return null; }
}

// ── 模拟媒体键 ──
// 使用 keybd_event 模拟多媒体按键，带 1 秒防重复保护
// keybd_event 虽已弃用，但在 Windows 10 上仍可用于媒体键注入
let mediaKeyGuard = 0;

function simulateMediaKey(action) {
  const now = Date.now();
  if (now - mediaKeyGuard < 1000) return; // 1 秒内忽略重复调用
  mediaKeyGuard = now;

  const keyMap = { next: '0xB0', prev: '0xB1', playpause: '0xB3' };
  const keyCode = keyMap[action];
  if (!keyCode) return;

  const script = [
    'Add-Type -TypeDefinition @"',
    'using System; using System.Runtime.InteropServices;',
    'public class MKS {',
    '  [DllImport("user32.dll")] public static extern void keybd_event(byte v, byte s, uint f, System.IntPtr e);',
    '  public static void Send(byte k) { keybd_event(k,0,1,System.IntPtr.Zero); System.Threading.Thread.Sleep(30); keybd_event(k,0,3,System.IntPtr.Zero); }',
    '}',
    '"@',
    `[MKS]::Send(${keyCode})`
  ].join('\n');

  const sp = path.join(os.tmpdir(), `mk_${Date.now()}.ps1`);
  fs.writeFileSync(sp, script, 'utf8');
  exec(
    `powershell -NoProfile -ExecutionPolicy Bypass -File "${sp}"`,
    { timeout: 5000 },
    (err) => { if (err) console.error('媒体键错误:', err.message); fs.unlink(sp, () => {}); }
  );
}

// ── 快捷键绑定系统 ──
function getEffectiveKeyboard() {
  return { ...DEFAULT_KEYBOARD, ...(bindings.keyboard || {}) };
}

function applyKeyboardBindings() {
  globalShortcut.unregisterAll();

  // 无条件注册默认媒体键
  const kb = getEffectiveKeyboard();
  for (const [accelerator, action] of Object.entries(kb)) {
    if (!ACTIONS.includes(action)) continue;
    try {
      globalShortcut.register(accelerator, () => simulateMediaKey(action));
    } catch (e) {
      console.log('绑定失败', accelerator, ':', e.message);
    }
  }
  console.log('键盘快捷键已应用:', Object.keys(kb).length);
}

function getKeyboardDisplay() {
  return getEffectiveKeyboard();
}

// ── 鼠标按键绑定（通过 PowerShell 轮询 XButton1/XButton2） ──
let lastMouseState = { XButton1: false, XButton2: false };
let mousePollTimer = null;

function startMousePoll() {
  if (mousePollTimer) return;
  const mouseBindings = bindings.mouse || {};
  if (Object.keys(mouseBindings).length === 0) return;

  const script = [
    'Add-Type -TypeDefinition @"',
    'using System; using System.Runtime.InteropServices;',
    'public class MK {',
    '  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int v);',
    '  public static bool IsDown(int v) { return (GetAsyncKeyState(v) & 0x8000) != 0; }',
    '}',
    '"@',
    `while(1) { $x1=[MK]::IsDown(5); $x2=[MK]::IsDown(6); if($x1){Write-Output "X1"}; if($x2){Write-Output "X2"}; Start-Sleep -Milliseconds 200 }`
  ].join('\n');

  const sp = path.join(os.tmpdir(), `mouse_${Date.now()}.ps1`);
  fs.writeFileSync(sp, script, 'utf8');

  const child = exec(
    `powershell -NoProfile -ExecutionPolicy Bypass -File "${sp}"`,
    { timeout: 0, encoding: 'buffer' },
    (err) => {
      if (err) console.log('鼠标轮询已停止:', err.message);
      mousePollTimer = null;
      try { fs.unlinkSync(sp); } catch(e) {}
    }
  );

  if (child && child.stdout) {
    child.stdout.on('data', (data) => {
      const lines = iconv.decode(data, 'utf8').trim().split('\n');
      for (const line of lines) {
        const btn = line.trim();
        if (btn === 'X1' || btn === 'X2') {
          const action = mouseBindings[btn === 'X1' ? 'XButton1' : 'XButton2'];
          if (action) {
            console.log('鼠标按键:', btn, '->', action);
            simulateMediaKey(action);
            // 防抖：短暂休眠避免重复触发
            exec('powershell -Command "Start-Sleep -Milliseconds 300"', () => {});
          }
        }
      }
    });
  }

  mousePollTimer = { child, sp };
}

function stopMousePoll() {
  if (mousePollTimer) {
    try {
      const pid = mousePollTimer.child.pid;
      mousePollTimer.child.kill('SIGTERM');
      // 强制杀死进程，确保不留孤儿进程
      require('child_process').exec(`taskkill /f /pid ${pid} 2>nul`, () => {});
    } catch(e) {}
    try { fs.unlinkSync(mousePollTimer.sp); } catch(e) {}
    mousePollTimer = null;
  }
}

// ── 绑定 IPC ──
function updateBindings(newBindings) {
  // 始终与默认值合并，确保键盘快捷键完整
  bindings = {
    keyboard: { ...DEFAULT_KEYBOARD, ...(newBindings.keyboard || {}) },
    gamepad: newBindings.gamepad || {},
    mouse: newBindings.mouse || {}
  };
  applyKeyboardBindings();
  stopMousePoll();
  startMousePoll();
  sendToGamepad('bindings:update', bindings.gamepad || {});
  saveBindings();
}

// ── 窗口标题检测 ──
function pollWindowTitle() {
  if (!isDetecting) return;
  const script = [
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
    '$names = @("cloudmusic","NeteaseCloudMusic","NeteaseCloudMusic_Music")',
    'foreach ($n in $names) {',
    '  $p = Get-Process -Name $n -ErrorAction SilentlyContinue',
    '  if (-not $p) { continue }',
    '  foreach ($proc in $p) {',
    '    $t = $proc.MainWindowTitle',
    '    if ($t -ne "") { Write-Output $t; return }',
    '  }',
    '}',
    'Write-Output ""'
  ].join('\n');

  const sp = path.join(os.tmpdir(), `wt_${Date.now()}.ps1`);
  fs.writeFileSync(sp, script, 'utf8');

  exec(
    `powershell -NoProfile -ExecutionPolicy Bypass -File "${sp}"`,
    { timeout: 5000, encoding: 'buffer' },
    (err, stdout) => {
      try { fs.unlinkSync(sp); } catch (e) {}
      if (err || !stdout.length) { scheduleWinTitlePoll(); return; }

      let title = iconv.decode(stdout, 'utf8').replace(/[\r\n]+/g, '').trim();
      if (title.includes('�') || title.includes('?'))
        title = iconv.decode(stdout, 'gbk').replace(/[\r\n]+/g, '').trim();

      if (title && !title.includes('SystemHint') && title !== lastWinTitle) {
        lastWinTitle = title;
        const parsed = parseWindowTitle(title);
        if (parsed) processDetectedSong(parsed.song, parsed.artist);
      }
      scheduleWinTitlePoll();
    }
  );
}

function parseWindowTitle(title) {
  const cleaned = title.replace(/\s*[-—–][\s-]*(网易云音乐|Netease Cloud Music|CloudMusic|netease)\s*$/i, '').trim();
  if (!cleaned || cleaned === title) {
    const parts = title.split(/\s*[-—–]\s*/);
    if (parts.length >= 2) { const a = parts.pop().trim(); const n = parts.join(' - ').trim(); if (n) return { song: n, artist: a || 'Unknown' }; }
    return null;
  }
  const parts = cleaned.split(/\s*[-—–]\s*/);
  if (parts.length >= 2) { const a = parts.pop().trim(); const n = parts.join(' - ').trim(); return { song: n, artist: a || 'Unknown' }; }
  if (parts.length === 1) return { song: parts[0].trim(), artist: 'Unknown' };
  return null;
}

function scheduleWinTitlePoll() { setTimeout(pollWindowTitle, WIN_TITLE_INTERVAL); }

// ── 封面获取 / 歌曲处理 / 歌词 ──
async function fetchCover(songName, artist) {
  try {
    const api = getApi();
    if (api && neteaseCookie) {
      try {
        const r = await api.cloudsearch({ keywords: `${songName} ${artist}`, limit: 1, type: 1, cookie: neteaseCookie });
        const s = r.body?.result?.songs?.[0];
        if (s?.al?.picUrl) {
          sendToOverlay('song:update', { name: songName, artist, coverUrl: s.al.picUrl.replace(/^http:/, 'https:'), loading: false });
          if (s.id) { fetchLyrics(s.id); fetchPrevNext(s.id, s.al?.id); } // if (s.dt) scheduleAutoRandom(s.dt);
          return;
        }
      } catch (e) {}
    }
    const res = await fetch(`https://music.163.com/api/cloudsearch/pc?s=${encodeURIComponent(songName + ' ' + artist)}&offset=0&limit=3&type=1`, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://music.163.com/' }
    });
    const d = await res.json();
    const s = d.result?.songs?.[0];
    if (s?.al?.picUrl) {
      sendToOverlay('song:update', { name: songName, artist, coverUrl: s.al.picUrl.replace(/^http:/, 'https:'), loading: false });
      if (s.id) { fetchLyrics(s.id); fetchPrevNext(s.id, s.al?.id); } // if (s.dt) scheduleAutoRandom(s.dt);
      return;
    }
  } catch (e) {}
  sendToOverlay('song:update', { name: songName, artist, coverUrl: null, loading: false });
}

function parseLrc(lrcText) {
  if (!lrcText) return { text: '', lines: [] };
  const raw = lrcText.split('\n');
  const timed = [];
  for (const line of raw) {
    // 提取所有时间戳 [mm:ss.xx] 或 [mm:ss.xxx]
    const stamps = [...line.matchAll(/\[(\d{2}):(\d{2})[\.\d]*\]/g)];
    // 提取时间戳后面的文本
    const text = line.replace(/\[(\d{2}):(\d{2})[\.\d]*\]/g, '').trim();
    if (!text) continue;
    for (const s of stamps) {
      const seconds = parseInt(s[1]) * 60 + parseFloat(s[2]);
      timed.push({ time: seconds, text });
    }
  }
  timed.sort((a, b) => a.time - b.time);
  // 去重：相同时刻的相同文本只保留一次
  const unique = [];
  for (const item of timed) {
    const prev = unique[unique.length - 1];
    if (!prev || prev.time !== item.time || prev.text !== item.text) unique.push(item);
  }
  return { text: unique.map(l => l.text).join('\n'), lines: unique };
}

async function fetchLyrics(songId, offset) {
  try {
    const api = getApi();
    let lrc = '';
    if (api && neteaseCookie) {
      try {
        const r = await api.lyric({ id: songId, cookie: neteaseCookie });
        lrc = r.body?.lrc?.lyric || '';
      } catch (e) {}
    }
    if (!lrc) {
      try {
        const res = await fetch(`https://music.163.com/api/song/lyric?id=${songId}&lv=-1&kv=-1&tv=-1`, {
          headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://music.163.com/' }
        });
        const d = await res.json();
        lrc = d.lrc?.lyric || d.tlyric?.lyric || '';
      } catch (e) {}
    }
    // 如果没有传入 offset 但已登录，尝试从 recent_listen_list 获取播放时间
    if (!offset && api && neteaseCookie) {
      try {
        const r = await api.recent_listen_list({ cookie: neteaseCookie });
        const items = r.body?.data?.list || r.body?.data || [];
        if (items.length) {
          const pt = items[0].lastPlayTime || items[0].playTime;
          if (pt) {
            const elapsed = (Date.now() - pt) / 1000;
            offset = (elapsed > 0 && elapsed < 86400) ? elapsed : 0;
          }
        }
      } catch (e) {}
    }
    if (lrc) {
      const parsed = parseLrc(lrc);
      currentLyrics = parsed.text;
      currentLyricLines = parsed.lines;
      currentLyricOffset = offset || 0;
      const totalOffset = currentLyricOffset + (settings.lyricManualOffset || 0);
      sendToOverlay('lyrics:update', { lyrics: parsed.text, lines: parsed.lines, offset: totalOffset });
    } else {
      currentLyrics = '';
      currentLyricLines = [];
      currentLyricOffset = 0;
      sendToOverlay('lyrics:update', { lyrics: '', lines: [], offset: 0 });
    }
  } catch (e) {
    currentLyrics = '';
    currentLyricOffset = 0;
    sendToOverlay('lyrics:update', { lyrics: '', lines: [], offset: 0 });
  }
}

let cachedPlaylistId = null;

async function findSongInPlaylists(songId, api) {
  if (!neteaseUid) return null;
  try {
    const r = await api.user_playlist({ uid: neteaseUid, cookie: neteaseCookie, limit: 30 });
    const playlists = r.body?.playlist || [];
    if (cachedPlaylistId) {
      const cached = playlists.find(p => p.id === cachedPlaylistId);
      if (cached) {
        const detail = await api.playlist_detail({ id: cached.id, s: 2000, cookie: neteaseCookie });
        const tracks = detail.body?.playlist?.tracks || [];
        const idx = tracks.findIndex(t => t.id === songId);
        if (idx !== -1) return { tracks, idx };
      }
    }
    for (const pl of playlists) {
      // 跳过超大歌单，"我喜欢的音乐" (specialType=5) 不受限
      if (pl.trackCount > 5000 && pl.specialType !== 5) continue;
      const detail = await api.playlist_detail({ id: pl.id, s: 2000, cookie: neteaseCookie });
      const tracks = detail.body?.playlist?.tracks || [];
      const idx = tracks.findIndex(t => t.id === songId);
      if (idx !== -1) {
        cachedPlaylistId = pl.id;
        return { tracks, idx };
      }
    }
  } catch (e) {}
  return null;
}

async function fetchPrevNext(songId, albumId) {
  if (!songId) return;
  try {
    let tracks = null;
    let idx = -1;

    const api = getApi();
    if (api && neteaseCookie) {
      const result = await findSongInPlaylists(songId, api);
      if (result) {
        tracks = result.tracks;
        idx = result.idx;
      }
    }

    if (!tracks && albumId) {
      if (api) {
        try {
          const r = await api.album({ id: albumId, cookie: neteaseCookie || '' });
          tracks = r.body?.songs || [];
        } catch (e) {}
      }
      if (!tracks || !tracks.length) {
        try {
          const res = await fetch(`https://music.163.com/api/v1/album/${albumId}`, {
            headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://music.163.com/' }
          });
          const d = await res.json();
          tracks = d.songs || d.album?.songs || [];
        } catch (e) {}
      }
      if (tracks && tracks.length) {
        idx = tracks.findIndex(t => t.id === songId);
      }
    }

    if (!tracks || !tracks.length || idx === -1) return;
    const nxt = idx < tracks.length - 1 ? { name: tracks[idx+1].name, artist: (tracks[idx+1].ar||[]).map(a=>a.name).join(',') } : null;
    nextSong = nxt;
    sendToOverlay('song:prev-next', { previous: previousSong, next: nxt });
    sendToPanel('prev-next', { previous: previousSong, next: nxt });
  } catch (e) {
    console.log('fetchPrevNext 错误:', e.message);
  }
}

// ── 随机播放 ──
// async function playRandomSong() {
//   cancelAutoRandom();
//   try {
//     const api = getApi();
//     if (!api || !neteaseCookie) {
//       sendToPanel('random:result', { success: false, error: '请先登录' });
//       return;
//     }
//
//     let playlistId = cachedPlaylistId;
//     let tracks = null;
//
//     if (playlistId) {
//       try {
//         const detail = await api.playlist_detail({ id: playlistId, s: 2000, cookie: neteaseCookie });
//         tracks = detail.body?.playlist?.tracks || [];
//       } catch (e) {}
//     }
//
//     if (!tracks || !tracks.length) {
//       if (!neteaseUid) {
//         sendToPanel('random:result', { success: false, error: '未获取到用户信息' });
//         return;
//       }
//       const r = await api.user_playlist({ uid: neteaseUid, cookie: neteaseCookie, limit: 30 });
//       const playlists = r.body?.playlist || [];
//       let targetPlaylist = playlists.find(p => p.specialType === 5);
//       if (!targetPlaylist) targetPlaylist = playlists[0];
//       if (!targetPlaylist) {
//         sendToPanel('random:result', { success: false, error: '没有找到歌单' });
//         return;
//       }
//       playlistId = targetPlaylist.id;
//       const detail = await api.playlist_detail({ id: playlistId, s: 2000, cookie: neteaseCookie });
//       tracks = detail.body?.playlist?.tracks || [];
//     }
//
//     if (!tracks || !tracks.length) {
//       sendToPanel('random:result', { success: false, error: '歌单为空' });
//       return;
//     }
//
//     const track = tracks[Math.floor(Math.random() * tracks.length)];
//     const songId = track.id;
//     const songName = track.name;
//     const artistName = (track.ar || []).map(a => a.name).join(', ');
//     console.log('随机播放:', songName, '-', artistName);
//
//     try {
//       await shell.openExternal(`orpheus://song/${songId}`);
//     } catch (_) {
//       exec(`start orpheus://song/${songId}`, (err) => {
//         if (err) console.error('orpheus 协议失败:', err.message);
//       });
//     }
//
//     if (currentSong) previousSong = { name: currentSong.song, artist: currentSong.artist };
//     lastSongKey = `${songId}:${songName}`;
//     currentSong = { song: songName, artist: artistName };
//     sendToOverlay('song:update', { name: songName, artist: artistName, coverUrl: null, loading: true });
//     sendToOverlay('song:prev-next', { previous: previousSong, next: null });
//     sendToOverlay('lyrics:update', { lyrics: '', lines: [], offset: 0 });
//     sendToPanel('now-playing', { name: songName, artist: artistName });
//     sendToPanel('random:result', { success: true });
//
//     fetchCover(songName, artistName);
//   } catch (e) {
//     console.error('随机播放错误:', e.message);
//     sendToPanel('random:result', { success: false, error: e.message });
//   }
// }

function processDetectedSong(name, artist) {
  if (!name) return;
  // 防止窗口标题和 API 轮询重复触发同一首歌
  if (currentSong && currentSong.song === name && currentSong.artist === artist) return;
  const key = `${name}|${artist}`;
  if (key === lastSongKey) return;
  // 保存上一曲
  if (currentSong) previousSong = { name: currentSong.song, artist: currentSong.artist };
  detectedSongs.add(name + '|' + artist);
  if (detectedSongs.size > 50) detectedSongs.clear();
  lastSongKey = key;
  console.log('歌曲:', name, '-', artist);
  currentSong = { song: name, artist };
  sendToOverlay('song:update', { name, artist, coverUrl: null, loading: true });
  sendToOverlay('song:prev-next', { previous: previousSong, next: null }); // 先清空下一曲
  sendToOverlay('lyrics:update', { lyrics: '', lines: [], offset: 0 }); // 清空旧歌词
  sendToPanel('now-playing', { name, artist });
  fetchCover(name, artist);
}

// ── API 轮询（窗口标题检测的补充方案） ──
async function pollCurrentSong() {
  if (!isDetecting || !neteaseCookie) return;
  try {
    const api = getApi();
    if (!api) return;
    let songData = null;

    // 依次尝试多个 API 接口获取当前播放歌曲
    for (const fetcher of [
      async () => {
        const r = await api.recent_listen_list({ cookie: neteaseCookie });
        const items = r.body?.data?.list || r.body?.data || [];
        if (items.length) { const i = items[0]; return { id: i.id, name: i.name || i.songName, artist: (i.ar||[]).map(a=>a.name).join(',') || i.artist, playTime: i.lastPlayTime || i.playTime || null }; }
      },
      async () => {
        const r = await api.record_recent_song({ cookie: neteaseCookie, limit: 1 });
        const list = r.body?.data || [];
        if (list.length) { const e = list[0]; const s = e.song || e; return { id: s.id, name: s.name, artist: (s.ar||[]).map(a=>a.name).join(',') || e.artist, playTime: e.playTime || null }; }
      },
      async () => {
        if (!neteaseUid) return null;
        const r = await api.user_record({ uid: neteaseUid, type: 1, cookie: neteaseCookie });
        const items = r.body?.weekData || [];
        if (items.length) { const s = items[0].song; return { id: s.id, name: s.name, artist: (s.ar||[]).map(a=>a.name).join(',') || (items[0].artists||[]).map(a=>a.name).join(',') }; }
      }
    ]) {
      songData = await fetcher();
      if (songData?.name) break;
    }

    if (!songData?.name) { emptyPollCount++; if (emptyPollCount % 12 === 0) console.log('API 轮询: 暂无歌曲'); return; }
    emptyPollCount = 0;

    const name = songData.name, artist = songData.artist || 'Unknown';
    if (currentSong && currentSong.song === name && currentSong.artist === artist) return;
    if (detectedSongs.has(name + '|' + artist)) return;
    detectedSongs.add(name + '|' + artist);
    if (detectedSongs.size > 50) detectedSongs.clear();
    const key = `${songData.id}:${songData.name}`;
    if (key === lastSongKey) return;
    if (currentSong) previousSong = { name: currentSong.song, artist: currentSong.artist };
    lastSongKey = key;
    console.log('API 检测到:', name, '-', artist);
    currentSong = { song: name, artist };
    sendToOverlay('song:update', { name, artist, coverUrl: null, loading: true });
    sendToOverlay('song:prev-next', { previous: previousSong, next: null });
    sendToOverlay('lyrics:update', { lyrics: '', lines: [], offset: 0 }); // 清空旧歌词
    sendToPanel('now-playing', { name, artist });

    try {
      const d = await api.song_detail({ ids: songData.id, cookie: neteaseCookie });
      const s = d.body?.songs?.[0];
      // 计算歌词偏移：获取 playTime，限制在歌曲时长内
      let songOffset = 0;
      if (songData.playTime) {
        const elapsed = (Date.now() - songData.playTime) / 1000;
        songOffset = (elapsed > 0 && elapsed < 86400) ? elapsed : 0; // 合理范围：1秒~24小时
      }
      const songDuration = s?.dt ? Math.floor(s.dt / 1000) : 0;
      if (songOffset > songDuration - 2) songOffset = 0; // 偏移超过歌曲时长则重置
      if (s?.al?.picUrl) { sendToOverlay('song:update', { name, artist, coverUrl: s.al.picUrl.replace(/^http:/, 'https:'), loading: false }); if (s?.id) { fetchLyrics(s.id, songOffset); fetchPrevNext(s.id, s.al?.id); } } // if (s.dt) scheduleAutoRandom(s.dt);
    } catch (e) { sendToOverlay('song:update', { name, artist, coverUrl: null, loading: false }); }
  } catch (e) {
    // 301 错误表示 Cookie 过期
    if (e.message?.includes('301')) { neteaseCookie = null; settings.savedCookie = ''; settings.savedUid = null; debounceSave(); sendToPanel('login:status', { loggedIn: false }); }
  }
}

function startDetectLoop() {
  if (isDetecting) return;
  isDetecting = true;
  emptyPollCount = 0;
  setTimeout(pollWindowTitle, 500);
  const poll = () => { if (!isDetecting) return; pollCurrentSong().then(() => setTimeout(poll, 2000)).catch(() => setTimeout(poll, 2000)); };
  setTimeout(poll, 3000);
}

function stopDetectLoop() {
  isDetecting = false;
  if (detectTimer) { clearTimeout(detectTimer); detectTimer = null; }
  stopMousePoll();
}

// ── 登录 ──
async function tryAutoLogin() {
  if (!settings.phone || !settings.password) return false;
  return await doLogin(settings.phone, settings.password);
}

async function doLogin(phone, password) {
  try {
    const api = getApi();
    if (!api) { sendToPanel('login:status', { loggedIn: false, error: 'API 未加载' }); return false; }
    const result = await api.login_cellphone({ phone, password });
    const cookie = result.body.cookie;
    if (cookie) {
      console.log('登录成功:', result.body.profile?.nickname);
      neteaseCookie = cookie;
      neteaseUid = result.body.account?.id || result.body.profile?.userId || null;
      settings.phone = phone; settings.password = password;
      settings.savedCookie = cookie; settings.savedUid = neteaseUid;
      debounceSave();
      sendToPanel('login:status', { loggedIn: true, nickname: result.body.profile?.nickname || '' });
      startDetectLoop();
      setTimeout(pollCurrentSong, 1000);
      return true;
    } else {
      sendToPanel('login:status', { loggedIn: false, error: '登录失败: ' + (result.body.msg || 'code: ' + result.body.code) });
      return false;
    }
  } catch (e) {
    sendToPanel('login:status', { loggedIn: false, error: '登录错误: ' + (e.message || e) });
    return false;
  }
}

// ── 显示器辅助函数 ──
function getDisplays() { return screen.getAllDisplays(); }
function getActiveDisplay() {
  const all = getDisplays();
  const idx = Math.min(settings.displayIndex || 0, all.length - 1);
  return all[idx] || screen.getPrimaryDisplay();
}
function getDisplayBounds() { return getActiveDisplay().workArea; }

// ── IPC 通信辅助 ──
function sendToOverlay(ch, data) { if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.webContents.send(ch, data); }
function sendToPanel(ch, data) { if (panelWindow && !panelWindow.isDestroyed()) panelWindow.webContents.send(ch, data); }
function sendToGamepad(ch, data) { if (gamepadWindow && !gamepadWindow.isDestroyed()) gamepadWindow.webContents.send(ch, data); }
function sendOverlaySettings() {
  sendToOverlay('overlay:settings', { showControls: settings.showControls, showLyrics: settings.showLyrics, showPrevNext: settings.showPrevNext });
}

// ── 窗口创建 ──
function createOverlayWindow() {
  // 将初始位置限制在选中的显示器范围内
  const b = getDisplayBounds();
  const ox = Math.max(b.x, Math.min(settings.x, b.x + b.width - settings.width));
  const oy = Math.max(b.y, Math.min(settings.y, b.y + b.height - settings.height));
  settings.x = ox; settings.y = oy;

  overlayWindow = new BrowserWindow({
    width: settings.width, height: settings.height,
    x: ox, y: oy,
    transparent: true, frame: false, alwaysOnTop: true,
    skipTaskbar: true, hasShadow: false,
    focusable: false, show: false, type: 'toolbar',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false, contextIsolation: true, sandbox: false }
  });
  overlayWindow.setMinimumSize(100, 40);
  overlayWindow.loadFile('overlay.html');
  overlayWindow.webContents.on('did-finish-load', () => {
    sendOverlaySettings();
  });
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  if (settings.visible) overlayWindow.show();
  if (settings.opacity < 1) overlayWindow.setOpacity(settings.opacity);
}

function createTray() {
  // 创建一个绿色的圆点托盘图标
  const size = 32;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - size/2, dy = y - size/2;
      const dist = Math.sqrt(dx*dx + dy*dy);
      const i = (y * size + x) * 4;
      if (dist < size/2 - 1) {
        buf[i] = 29; buf[i+1] = 185; buf[i+2] = 84; buf[i+3] = 255; // 绿色圆
      } else {
        buf[i] = 0; buf[i+1] = 0; buf[i+2] = 0; buf[i+3] = 0; // 透明
      }
    }
  }
  const icon = nativeImage.createFromBuffer(buf, { width: size, height: size });

  tray = new Tray(icon);
  tray.setToolTip('Rattoolkits-MelonMusic');

  const ctxMenu = Menu.buildFromTemplate([
    { label: '显示窗口', click: () => { if (panelWindow && !panelWindow.isDestroyed()) panelWindow.show(); if (overlayWindow && !overlayWindow.isDestroyed() && settings.visible) overlayWindow.show(); } },
    { type: 'separator' },
    { label: '退出', click: () => { app.isQuitting = true; app.quit(); } }
  ]);
  tray.setContextMenu(ctxMenu);
  tray.on('double-click', () => { if (panelWindow && !panelWindow.isDestroyed()) panelWindow.show(); });
}

function createPanelWindow() {
  panelWindow = new BrowserWindow({
    width: 860, height: 580, minWidth: 700, minHeight: 450,
    frame: false, transparent: true,
    titleBarStyle: 'hidden',
    title: 'Rattoolkits-MelonMusic',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false, contextIsolation: true, sandbox: false }
  });
  panelWindow.loadFile('panel.html');
  panelWindow.webContents.on('did-finish-load', () => {
    const { width: sw, height: sh } = getDisplayBounds();
    const [wx, wy] = overlayWindow && !overlayWindow.isDestroyed() ? overlayWindow.getPosition() : [settings.x, settings.y];
    // 同时传递工作区（screenSize）和完整显示器尺寸（screenFullSize），用于预设位置计算
    const activeDisplay = getActiveDisplay();
    const fullSize = activeDisplay.size || { width: sw, height: sh };
    panelWindow.webContents.send('init:state', {
      position: { x: wx, y: wy }, opacity: settings.opacity, visible: settings.visible,
      screenSize: { width: sw, height: sh }, screenFullSize: { width: fullSize.width, height: fullSize.height },
      overlaySize: { width: settings.width, height: settings.height },
      song: currentSong || { name: '等待音乐...', artist: '' }, loggedIn: !!neteaseCookie, savedPhone: settings.phone,
      displayIndex: settings.displayIndex || 0, displayBounds: getDisplayBounds(),
      displays: getDisplays().map((d,i) => ({ index: i, name: `屏幕 ${i+1}`, width: d.workAreaSize.width, height: d.workAreaSize.height, x: d.workArea.x, y: d.workArea.y })),
      closeBehavior: settings.closeBehavior || 'quit',
      showControls: settings.showControls || false, showLyrics: settings.showLyrics || false, showPrevNext: settings.showPrevNext || false,
      overlayScale: settings.overlayScale || 50,
      lyricManualOffset: settings.lyricManualOffset || 0
    });
  });

  // 处理关闭按钮
  panelWindow.on('close', (e) => {
    if (app.isQuitting) return; // 允许真正退出
    e.preventDefault();

    if (settings.closeBehavior === 'quit') {
      app.isQuitting = true;
      app.quit();
    } else {
      // 最小化到托盘
      panelWindow.hide();
      if (overlayWindow && !overlayWindow.isDestroyed() && settings.visible) {
        // 保持悬浮窗可见
      }
    }
  });

  if (process.argv.includes('--dev')) panelWindow.webContents.openDevTools();
}

// 悬浮窗关闭时仅隐藏而非退出
function patchOverlayClose() {
  if (overlayWindow) {
    overlayWindow.on('close', (e) => {
      if (app.isQuitting) return;
      e.preventDefault();
      overlayWindow.hide();
    });
  }
}

function createGamepadWindow() {
  gamepadWindow = new BrowserWindow({
    width: 1, height: 1, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false, contextIsolation: true, sandbox: false }
  });
  gamepadWindow.loadFile('gamepad.html');
}

const OVERLAY_BASE_W = 300, OVERLAY_BASE_H = 110;

function resizeOverlay(w, h) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  overlayWindow.setSize(w, h);
  settings.width = w;
  settings.height = h;
  debounceSave();
  // 确保窗口不超出屏幕边界
  const b = getDisplayBounds();
  const [cx, cy] = overlayWindow.getPosition();
  const clampedX = Math.max(b.x, Math.min(cx, b.x + b.width - w));
  const clampedY = Math.max(b.y, Math.min(cy, b.y + b.height - h));
  if (clampedX !== cx || clampedY !== cy) {
    overlayWindow.setPosition(clampedX, clampedY);
    settings.x = clampedX; settings.y = clampedY;
  }
  sendToPanel('overlay:size-updated', { width: w, height: h, scale: settings.overlayScale });
}

function applyOverlayScale(scale) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  const factor = Math.max(0.3, Math.min(3, scale / 100));
  settings.overlayScale = scale;
  debounceSave();
  overlayWindow.webContents.executeJavaScript(`
    document.getElementById('content').style.zoom = '${factor}';
  `);
  sendToPanel('overlay:size-updated', { width: settings.width, height: settings.height, scale });
}

// ── IPC 处理器 ──
function setupIPC() {
  // 位置变更（含显示器边界限制）
  ipcMain.on('position:change', (event, { x, y }) => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      const b = getDisplayBounds();
      const cx = Math.max(b.x, Math.min(x, b.x + b.width - settings.width));
      const cy = Math.max(b.y, Math.min(y, b.y + b.height - settings.height));
      overlayWindow.setPosition(cx, cy);
      settings.x = cx; settings.y = cy;
      sendToPanel('position:updated', { x: cx, y: cy });
      debounceSave();
    }
  });
  ipcMain.on('opacity:change', (event, { opacity }) => { settings.opacity = opacity; if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.setOpacity(opacity); debounceSave(); });
  ipcMain.on('visibility:toggle', (event, { visible }) => { settings.visible = visible; if (overlayWindow && !overlayWindow.isDestroyed()) { if (visible) overlayWindow.show(); else overlayWindow.hide(); } debounceSave(); });
  ipcMain.on('control:action', (event, { action }) => simulateMediaKey(action));
  ipcMain.on('overlay:show-controls', (event, { show }) => { settings.showControls = show; sendOverlaySettings(); debounceSave(); });
  ipcMain.on('overlay:show-lyrics', (event, { show }) => { settings.showLyrics = show; sendOverlaySettings(); debounceSave(); });
  ipcMain.on('overlay:show-prevnext', (event, { show }) => { settings.showPrevNext = show; sendOverlaySettings(); debounceSave(); });

  // 手柄
  ipcMain.on('gamepad:action', (event, { action }) => simulateMediaKey(action));
  ipcMain.on('gamepad:connected', (event, { id, index }) => sendToPanel('gamepad:status', { connected: true, id, index }));
  ipcMain.on('gamepad:disconnected', (event, { index }) => sendToPanel('gamepad:status', { connected: false, index }));
  ipcMain.on('gamepad:button-pressed', (event, { gamepadIndex, buttonIndex }) => sendToPanel('gamepad:binding-result', { gamepadIndex, buttonIndex }));

  // 快捷键绑定
  ipcMain.handle('bindings:load', () => bindings);
  ipcMain.handle('bindings:loadKeyboard', () => getKeyboardDisplay());
  ipcMain.on('bindings:save', (event, { bindings: b }) => {
    updateBindings(b);
    sendToPanel('bindings:saved', { success: true });
  });
  ipcMain.on('bindings:start-binding', () => sendToGamepad('start-binding'));

  // 窗口控制
  ipcMain.on('window:minimize', () => { if (panelWindow && !panelWindow.isDestroyed()) panelWindow.minimize(); });
  ipcMain.on('window:maximize', () => {
    if (panelWindow && !panelWindow.isDestroyed()) {
      panelWindow.isMaximized() ? panelWindow.unmaximize() : panelWindow.maximize();
    }
  });

  // 关闭行为
  ipcMain.on('closeBehavior:set', (event, { behavior }) => {
    if (behavior === 'quit' || behavior === 'minimize') {
      settings.closeBehavior = behavior;
      debounceSave();
    }
  });

  // 显示器切换
  ipcMain.handle('displays:list', () => {
    return getDisplays().map((d, i) => ({
      index: i, name: `屏幕 ${i + 1}`,
      width: d.workAreaSize.width, height: d.workAreaSize.height,
      x: d.workArea.x, y: d.workArea.y
    }));
  });

  ipcMain.on('display:set', (event, { index }) => {
    const all = getDisplays();
    if (index >= 0 && index < all.length) {
      settings.displayIndex = index;
      const b = all[index].workArea;
      const fullSize = all[index].size || b;
      // 将悬浮窗重新定位到新显示器
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        const ny = Math.max(b.y, Math.min(b.y + Math.round((b.height - settings.height) / 2), b.y + b.height - settings.height));
        overlayWindow.setPosition(b.x + 20, ny);
        settings.x = b.x + 20;
        settings.y = ny;
        sendToPanel('position:updated', { x: settings.x, y: settings.y });
      }
      // 通知面板新的显示器边界和完整尺寸（用于预设计算）
      sendToPanel('display:bounds', {
        x: b.x, y: b.y, width: b.width, height: b.height,
        fullWidth: fullSize.width, fullHeight: fullSize.height
      });
      debounceSave();
    }
  });

// 重置悬浮窗大小
  ipcMain.on('overlay:reset-size', () => {
    const defaultW = 300, defaultH = 110;
    settings.width = defaultW;
    settings.height = defaultH;
    settings.overlayScale = 50;
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.setSize(defaultW, defaultH);
      overlayWindow.webContents.executeJavaScript(`
        document.getElementById('content').style.zoom = '0.5';
      `);
      // 重新限制位置确保在显示范围内
      const b = getDisplayBounds();
      const [cx, cy] = overlayWindow.getPosition();
      const clampedX = Math.max(b.x, Math.min(cx, b.x + b.width - defaultW));
      const clampedY = Math.max(b.y, Math.min(cy, b.y + b.height - defaultH));
      overlayWindow.setPosition(clampedX, clampedY);
      settings.x = clampedX; settings.y = clampedY;
      sendToPanel('position:updated', { x: clampedX, y: clampedY });
    }
    debounceSave();
    sendToPanel('overlay:size-updated', { width: defaultW, height: defaultH, scale: 50 });
  });

  // 自定义缩放
  ipcMain.on('overlay:set-scale', (event, { scale }) => {
    applyOverlayScale(scale);
    debounceSave();
  });

  // 单独设置宽高（不触发 CSS zoom）
  ipcMain.on('overlay:set-size', (event, { width, height }) => {
    const w = Math.max(150, Math.min(700, width));
    const h = Math.max(50, Math.min(300, height));
    resizeOverlay(w, h);
    debounceSave();
  });

  // 歌词手动补偿
  ipcMain.on('lyrics:set-offset', (event, { offset }) => {
    settings.lyricManualOffset = offset;
    debounceSave();
    const total = (currentLyricOffset || 0) + offset;
    sendToOverlay('lyrics:update', { lyrics: currentLyrics, lines: currentLyricLines, offset: total });
    sendToPanel('lyrics:offset-updated', { offset });
  });

  // 状态查询
  ipcMain.handle('get:status', async () => {
    const pos = overlayWindow && !overlayWindow.isDestroyed() ? overlayWindow.getPosition() : [settings.x, settings.y];
    const activeDisplay = getActiveDisplay();
    const fullSize = activeDisplay.size || { width: 0, height: 0 };
    return {
      song: currentSong || { name: '等待音乐...', artist: '' }, position: { x: pos[0], y: pos[1] },
      opacity: settings.opacity, visible: settings.visible,
      screenSize: getDisplayBounds(), screenFullSize: { width: fullSize.width, height: fullSize.height },
      overlaySize: { width: settings.width, height: settings.height },
      loggedIn: !!neteaseCookie, displayIndex: settings.displayIndex || 0,
      showControls: settings.showControls || false, showLyrics: settings.showLyrics || false, showPrevNext: settings.showPrevNext || false,
      overlayScale: settings.overlayScale || 50,
      lyricManualOffset: settings.lyricManualOffset || 0
    };
  });
  ipcMain.handle('poll:now', async () => { await pollCurrentSong(); return currentSong || { song: '暂无数据', artist: '' }; });
  // ipcMain.handle('song:play-random', async () => { await playRandomSong(); });
  // ipcMain.handle('auto-random:toggle', async (event, { enabled }) => {
  //   autoRandomEnabled = !!enabled;
  //   settings.autoRandom = autoRandomEnabled;
  //   debounceSave();
  //   if (!autoRandomEnabled) cancelAutoRandom();
  //   else if (currentSong) {
  //     console.log('自动随机已开启');
  //   }
  //   sendToPanel('auto-random:status', { enabled: autoRandomEnabled });
  // });
  // ipcMain.handle('auto-random:status', async () => ({ enabled: autoRandomEnabled }));

  // 登录
  ipcMain.handle('login:submit', async (event, { phone, password }) => { return await doLogin(phone, password); });
  ipcMain.handle('login:logout', async () => {
    neteaseCookie = null; settings.phone = ''; settings.password = ''; settings.savedCookie = ''; settings.savedUid = null; stopDetectLoop(); lastSongKey = ''; currentSong = null;
    debounceSave();
    sendToOverlay('song:update', { name: '等待音乐...', artist: '', coverUrl: null, loading: false });
    sendToPanel('now-playing', { name: '等待音乐...', artist: '' });
    return true;
  });
  ipcMain.handle('login:status', async () => { return { loggedIn: !!neteaseCookie, phone: settings.phone }; });

  // 短信验证码登录
  ipcMain.handle('sms:send', async (event, { phone }) => {
    try {
      const api = getApi();
      if (!api) return { error: 'API 未加载' };
      const r = await api.captcha_sent({ phone });
      if (r.body?.code === 200) return { success: true };
      return { error: '发送失败: ' + (r.body?.msg || 'code: ' + r.body?.code) };
    } catch (e) { return { error: e.message }; }
  });

  ipcMain.handle('sms:login', async (event, { phone, captcha }) => {
    try {
      const api = getApi();
      if (!api) return { loggedIn: false, error: 'API not loaded' };
      const result = await api.login_cellphone({ phone, captcha, countrycode: '86' });
      const cookie = result.body.cookie;
      if (cookie) {
        neteaseCookie = cookie; neteaseUid = result.body.account?.id || result.body.profile?.userId || null;
        settings.phone = phone; settings.password = '';
        settings.savedCookie = cookie; settings.savedUid = neteaseUid;
        debounceSave();
        sendToPanel('login:status', { loggedIn: true, nickname: result.body.profile?.nickname || '' });
        startDetectLoop(); setTimeout(pollCurrentSong, 1000);
        return { loggedIn: true };
      }
      return { loggedIn: false, error: '登录失败: ' + (result.body.msg || 'code: ' + result.body.code) };
    } catch (e) { return { error: e.message }; }
  });

  // 二维码登录
  let qrPollTimer = null;
  ipcMain.handle('qr:start', async () => {
    try {
      const api = getApi();
      if (!api) return { error: 'API 未加载' };
      const keyResult = await api.login_qr_key({});
      const key = keyResult.body?.data?.unikey;
      if (!key) return { error: '获取二维码 key 失败' };
      const qrResult = await api.login_qr_create({ key, qrimg: true });
      const qrimg = qrResult.body?.data?.qrimg;
      if (!qrimg) return { error: '生成二维码失败' };
      if (qrPollTimer) clearInterval(qrPollTimer);
      qrPollTimer = setInterval(async () => {
        try {
          const check = await api.login_qr_check({ key });
          const code = check.body?.code || check.body?.data;
          if (code === 803 || code === 800) {
            clearInterval(qrPollTimer); qrPollTimer = null;
            const cookie = check.body?.cookie;
            if (cookie) {
              neteaseCookie = cookie; neteaseUid = check.body?.profile?.userId || null;
              settings.savedCookie = cookie; settings.savedUid = neteaseUid;
              sendToPanel('login:status', { loggedIn: true, nickname: check.body?.profile?.nickname || '' });
              startDetectLoop(); setTimeout(pollCurrentSong, 1000);
              settings.phone = settings.phone || 'qr_login'; settings.password = settings.password || '';
              debounceSave();
            }
            sendToPanel('qr:result', { status: 'success' });
          } else if (code === 802) sendToPanel('qr:result', { status: 'scanning' });
        } catch (e) {}
      }, 2000);
      return { qrimg, key };
    } catch (e) { return { error: e.message }; }
  });
  ipcMain.handle('qr:cancel', async () => { if (qrPollTimer) { clearInterval(qrPollTimer); qrPollTimer = null; } return true; });
}

// ── 数据持久化 ──
// 打包后设置存储在 <安装目录>/settings/ 下，便于便携使用
// 开发模式下使用 Electron 默认的 userData（%APPDATA%）
function getDataDir() {
  if (app.isPackaged) {
    return path.join(path.dirname(app.getPath('exe')), 'settings');
  }
  return app.getPath('userData');
}
function getSettingsPath() { const d = getDataDir(); ensureDir(d); return path.join(d, 'settings.json'); }
function getBindingsPath() { const d = getDataDir(); ensureDir(d); return path.join(d, 'bindings.json'); }
function ensureDir(d) { try { fs.mkdirSync(d, { recursive: true }); } catch (e) {} }

function saveSettings() { try { fs.writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2), 'utf8'); } catch (e) {} }

function loadSettings() {
  try {
    const p = getSettingsPath();
    if (fs.existsSync(p)) { const s = JSON.parse(fs.readFileSync(p, 'utf8')); settings = { ...settings, ...s }; }
  } catch (e) {}
}

function saveBindings() { try { fs.writeFileSync(getBindingsPath(), JSON.stringify(bindings, null, 2), 'utf8'); } catch (e) {} }

function loadBindings() {
  try {
    const p = getBindingsPath();
    if (fs.existsSync(p)) {
      const b = JSON.parse(fs.readFileSync(p, 'utf8'));
      bindings = {
        keyboard: { ...DEFAULT_KEYBOARD, ...(b.keyboard || {}) },
        gamepad: b.gamepad || {},
        mouse: b.mouse || {}
      };
    }
  } catch (e) {}
}

// ── 应用生命周期 ──
async function restoreLogin() {
  if (!settings.savedCookie) return false;
  neteaseCookie = settings.savedCookie;
  neteaseUid = settings.savedUid || null;
  try {
    const api = getApi();
    if (api) {
      const r = await api.login_status({ cookie: neteaseCookie });
      if (r.body?.data?.code !== 200) throw new Error('cookie expired');
      console.log('恢复登录成功:', r.body?.data?.profile?.nickname || '');
      sendToPanel('login:status', { loggedIn: true, nickname: r.body?.data?.profile?.nickname || '' });
      return true;
    }
  } catch (e) {
    console.log('Cookie 已失效，请重新登录');
    neteaseCookie = null;
    neteaseUid = null;
    settings.savedCookie = '';
    settings.savedUid = null;
    debounceSave();
  }
  return false;
}

app.whenReady().then(() => {
  loadSettings();
  loadBindings();

  createOverlayWindow();
  patchOverlayClose();
  createPanelWindow();
  createGamepadWindow();
  setupIPC();

  // 创建托盘图标
  createTray();

  // 界面显示后应用快捷键并开始检测
  setTimeout(async () => {
    applyKeyboardBindings();
    startMousePoll();
    startDetectLoop();
    const restored = await restoreLogin();
    if (!restored && settings.phone && settings.password) await tryAutoLogin();
    sendToGamepad('bindings:update', bindings.gamepad || {});
    // 恢复自动随机状态
    // if (settings.autoRandom) {
    //   autoRandomEnabled = true;
    //   sendToPanel('auto-random:status', { enabled: true });
    //   console.log('自动随机已恢复');
    // }
  }, 500);

  // 恢复缩放
  setTimeout(() => {
    applyOverlayScale(settings.overlayScale || 50);
    console.log('缩放已恢复:', (settings.overlayScale || 50) + '%');
  }, 800);
});

app.on('window-all-closed', () => {
  // Windows/Linux 下所有窗口关闭时退出
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
app.on('before-quit', () => {
  app.isQuitting = true;
  stopDetectLoop();
  stopMousePoll();
  globalShortcut.unregisterAll();
  saveSettings();
  if (tray) { tray.destroy(); tray = null; }
});
app.on('will-quit', () => {
  // 安全清理：杀死本应用可能遗留的 PowerShell 进程
  try {
    require('child_process').exec(
      'taskkill /f /fi "IMAGENAME eq powershell.exe" /fi "WINDOWTITLE ne *" 2>nul',
      () => {}
    );
  } catch (e) {}
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createOverlayWindow(); createPanelWindow(); createGamepadWindow();
    patchOverlayClose();
  } else {
    if (panelWindow && !panelWindow.isDestroyed()) panelWindow.show();
    if (overlayWindow && !overlayWindow.isDestroyed() && settings.visible) overlayWindow.show();
  }
});

let saveTimer = null;
function debounceSave() { if (saveTimer) clearTimeout(saveTimer); saveTimer = setTimeout(() => { saveSettings(); saveTimer = null; }, 2000); }
