const coverEl = document.getElementById('cover');
const songNameEl = document.getElementById('song-name');
const artistNameEl = document.getElementById('artist-name');
const spinnerEl = document.getElementById('loading-spinner');

let currentCoverUrl = null;

window.api.onSongUpdate((data) => {
  // 淡出当前封面
  coverEl.style.opacity = '0';

  setTimeout(() => {
    songNameEl.textContent = data.name || '未知歌曲';
    artistNameEl.textContent = data.artist || '';

    // 加载封面时显示加载动画
    if (data.loading) {
      spinnerEl.style.display = 'block';
      return;
    }

    spinnerEl.style.display = 'none';

    // 如果封面 URL 有变化则更新
    if (data.coverUrl && data.coverUrl !== currentCoverUrl) {
      currentCoverUrl = data.coverUrl;
      coverEl.src = data.coverUrl;
      coverEl.onerror = () => {
        // 加载失败时恢复为默认图标
        coverEl.src = 'data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 80 80\'%3E%3Crect width=\'80\' height=\'80\' fill=\'%23282c34\'/%3E%3Ctext x=\'40\' y=\'40\' text-anchor=\'middle\' dominant-baseline=\'central\' fill=\'%23555\' font-size=\'28\' font-family=\'sans-serif\'%3E%E2%99%AA%3C/text%3E%3C/svg%3E';
      };
    } else if (!data.coverUrl) {
      currentCoverUrl = null;
    }

    // 淡入新封面
    coverEl.style.opacity = '1';
  }, 200);
});
