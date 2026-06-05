const coverEl = document.getElementById('cover');
const songNameEl = document.getElementById('song-name');
const artistNameEl = document.getElementById('artist-name');
const prevNameEl = document.getElementById('prev-name');
const nextNameEl = document.getElementById('next-name');
const spinnerEl = document.getElementById('loading-spinner');
const controlsEl = document.getElementById('controls');
const lyricsEl = document.getElementById('lyrics');

let currentCoverUrl = null;
let showControls = false;
let showLyrics = false;
let showPrevNext = false;
let timedLyrics = [];      // [{time, text}]
let syncTimer = null;
let syncStart = 0;
let currentLineIdx = -1;
let lyricOffset = 0;       // 歌词同步偏移量（秒）

// ---- 控制按钮 ----
document.getElementById('ctrl-prev').addEventListener('click', () => window.api.controlAction('prev'));
document.getElementById('ctrl-playpause').addEventListener('click', () => window.api.controlAction('playpause'));
document.getElementById('ctrl-next').addEventListener('click', () => window.api.controlAction('next'));
document.getElementById('ctrl-random').addEventListener('click', () => window.api.playRandom());

// ---- 歌词同步 ----
function stopLyricsSync() {
  if (syncTimer) { clearInterval(syncTimer); syncTimer = null; }
}

function getCurrentLineIndex(elapsed) {
  let idx = -1;
  for (let i = 0; i < timedLyrics.length; i++) {
    if (elapsed >= timedLyrics[i].time) idx = i;
    else break;
  }
  return idx;
}

function updateSyncedLine() {
  if (!timedLyrics.length) return;
  const elapsed = (Date.now() - syncStart) / 1000;
  const idx = getCurrentLineIndex(elapsed);
  if (idx !== currentLineIdx) {
    currentLineIdx = idx;
    lyricsEl.textContent = idx >= 0 ? timedLyrics[idx].text : '';
  }
}

function startLyricsSync() {
  stopLyricsSync();
  if (!timedLyrics.length) return;
  syncStart = Date.now() - lyricOffset * 1000;
  currentLineIdx = -1;
  updateSyncedLine();
  syncTimer = setInterval(updateSyncedLine, 200);
}

// ---- 设置更新 ----
window.api.onOverlaySettings((data) => {
  if (!data) return;
  showControls = data.showControls || false;
  showLyrics = data.showLyrics || false;
  showPrevNext = data.showPrevNext || false;
  updateOverlayUI();
});

function updateOverlayUI() {
  controlsEl.style.display = showControls ? 'flex' : 'none';
  lyricsEl.style.right = showControls ? '80px' : '12px';
  if (!showLyrics) { stopLyricsSync(); lyricsEl.style.display = 'none'; }
  else { lyricsEl.style.display = timedLyrics.length > 0 ? 'block' : 'none'; startLyricsSync(); }
  prevNameEl.style.display = showPrevNext && prevNameEl.textContent ? 'block' : 'none';
  nextNameEl.style.display = showPrevNext && nextNameEl.textContent ? 'block' : 'none';
}

// ---- 歌词更新 ----
window.api.onLyricsUpdate((data) => {
  stopLyricsSync();
  if (data && data.lines && data.lines.length > 0) {
    timedLyrics = data.lines;
    lyricOffset = data.offset || 0;
    lyricsEl.textContent = timedLyrics[0].text || '';
    startLyricsSync();
  } else {
    timedLyrics = [];
    lyricOffset = 0;
    lyricsEl.textContent = '';
  }
  updateOverlayUI();
});

// ---- 上一曲/下一曲 ----
window.api.onPrevNext((data) => {
  if (data) {
    prevNameEl.textContent = data.previous ? `▲ ${data.previous.name}` : '';
    nextNameEl.textContent = data.next ? `▼ ${data.next.name}` : '';
    prevNameEl.style.display = showPrevNext && prevNameEl.textContent ? 'block' : 'none';
    nextNameEl.style.display = showPrevNext && nextNameEl.textContent ? 'block' : 'none';
  }
});

// ---- 歌曲更新 ----
window.api.onSongUpdate((data) => {
  coverEl.style.opacity = '0';

  setTimeout(() => {
    songNameEl.textContent = data.name || '未知歌曲';
    artistNameEl.textContent = data.artist || '';

    if (data.loading) {
      spinnerEl.style.display = 'block';
      return;
    }

    spinnerEl.style.display = 'none';

    if (data.coverUrl && data.coverUrl !== currentCoverUrl) {
      currentCoverUrl = data.coverUrl;
      coverEl.src = data.coverUrl;
      coverEl.onerror = () => {
        coverEl.src = 'data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 80 80\'%3E%3Crect width=\'80\' height=\'80\' fill=\'%23282c34\'/%3E%3Ctext x=\'40\' y=\'40\' text-anchor=\'middle\' dominant-baseline=\'central\' fill=\'%23555\' font-size=\'28\' font-family=\'sans-serif\'%3E%E2%99%AA%3C/text%3E%3C/svg%3E';
      };
    } else if (!data.coverUrl) {
      currentCoverUrl = null;
    }

    coverEl.style.opacity = '1';
  }, 200);
});
