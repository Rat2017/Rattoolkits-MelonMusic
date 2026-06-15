// ── 状态 ──
let screenW = 1920, screenH = 1080;
let screenX = 0, screenY = 0;
let overlayW = 340, overlayH = 100;
let isDragging = false;
let bindings = { keyboard: {}, gamepad: {}, mouse: {} };
let isBinding = false;       // 当前是否正在绑定手柄按键
let bindingTarget = '';      // 正在绑定哪个动作

let xinputConnected = false; // XInput 手柄是否已连接（通过收到按键事件确认）

// DOM
const desktop = document.getElementById('virtual-desktop');
const desktopPanel = document.getElementById('desktop-panel');
const icon = document.getElementById('overlay-icon');
const tooltip = document.getElementById('pos-tooltip');
const screenSizeDisplay = document.getElementById('screen-size-display');
const overlayPosDisplay = document.getElementById('overlay-pos-display');

// 顶部栏
document.getElementById('win-close').addEventListener('click', () => window.close());
document.getElementById('win-min').addEventListener('click', () => window.electronAPI?.minimizeWindow?.() || window.api?.minimizeWindow?.());
document.getElementById('win-max').addEventListener('click', () => window.electronAPI?.maximizeWindow?.() || window.api?.maximizeWindow?.());
const userBtn = document.getElementById('user-btn');
const userDropdown = document.getElementById('user-dropdown');
const nowPlayingTop = document.getElementById('now-playing-name-top');

// 控件
const xSlider = document.getElementById('x-slider');
const ySlider = document.getElementById('y-slider');
const xDisplay = document.getElementById('x-display');
const yDisplay = document.getElementById('y-display');
const opacitySlider = document.getElementById('opacity-slider');
const opacityDisplay = document.getElementById('opacity-display');
const visibilityCheck = document.getElementById('visibility-check');
const closeQuitCheck = document.getElementById('close-quit-check');
const displaySelect = document.getElementById('display-select');
const nowPlayingName = document.getElementById('now-playing-name');
const nowPlayingArtist = document.getElementById('now-playing-artist');
const refreshBtn = document.getElementById('refresh-btn');

// 登录
const loginPhone = document.getElementById('login-phone');
const loginPassword = document.getElementById('login-password');
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const loginStatus = document.getElementById('login-status');
const loginError = document.getElementById('login-error');
const loginSwitch = document.getElementById('login-switch');
const loginPwdSection = document.getElementById('login-pwd-section');
const loginSmsSection = document.getElementById('login-sms-section');
const smsSendBtn = document.getElementById('sms-send-btn');
const smsTimer = document.getElementById('sms-timer');
const smsCode = document.getElementById('login-sms-code');
const smsLoginBtn = document.getElementById('sms-login-btn');
const qrLoginBtn = document.getElementById('qr-login-btn');
const qrDisplay = document.getElementById('qr-display');
const qrImage = document.getElementById('qr-image');
const qrStatus = document.getElementById('qr-status');
const qrCancelBtn = document.getElementById('qr-cancel-btn');

// 快捷键绑定
const keyboardList = document.getElementById('keyboard-list');
const mouseList = document.getElementById('mouse-list');
const gamepadStatus = document.getElementById('gamepad-status');
const gpPrevLabel = document.getElementById('gp-prev-label');
const gpPlayLabel = document.getElementById('gp-playpause-label');
const gpNextLabel = document.getElementById('gp-next-label');

const ACTIONS = ['next', 'prev', 'playpause'];
const ACTION_LABELS = { next: '下一首', prev: '上一首', playpause: '播放/暂停' };
const DEFAULT_KEYS = ['MediaNextTrack', 'MediaPreviousTrack', 'MediaPlayPause', 'Ctrl+Shift+Right', 'Ctrl+Shift+Left', 'Ctrl+Shift+Space'];

// ── Tab switching ──
document.querySelectorAll('.ctrl-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.ctrl-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.ctrl-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    const p = document.getElementById('ctrl-' + tab.dataset.tab);
    if (p) p.classList.add('active');
  });
});

// ── User dropdown ──
userBtn.addEventListener('click', () => {
  userDropdown.style.display = userDropdown.style.display === 'none' ? 'block' : 'none';
});
document.addEventListener('click', (e) => {
  if (!userBtn.contains(e.target) && !userDropdown.contains(e.target)) {
    userDropdown.style.display = 'none';
  }
});

// ── 坐标转换 ──
// 坐标约定：
//   绝对坐标 = screenX + 相对坐标（包含显示器原点的屏幕坐标）
//   相对坐标 = 0..screenW/H（显示器本地坐标，用于滑块）
//   main.js 使用绝对坐标；screenToDesktop 使用绝对坐标；updateSliders 使用相对坐标
function relToAbs(rx, ry) { return { x: rx + screenX, y: ry + screenY }; }
function absToRel(ax, ay) { return { x: ax - screenX, y: ay - screenY }; }
function screenToDesktop(sx, sy) {
  const r = desktop.getBoundingClientRect();
  return { x: ((sx - screenX) / screenW) * r.width, y: ((sy - screenY) / screenH) * r.height };
}
function desktopToScreen(dx, dy) {
  const r = desktop.getBoundingClientRect();
  return { x: screenX + Math.round((dx / r.width) * screenW), y: screenY + Math.round((dy / r.height) * screenH) };
}
function updateIconPosition(sx, sy) {
  const p = screenToDesktop(sx, sy);
  icon.style.left = p.x + 'px'; icon.style.top = p.y + 'px';
  updateTooltip(sx, sy);
}
function updateSliders(rx, ry) {
  xSlider.value = (rx / screenW) * 100; ySlider.value = (ry / screenH) * 100;
  xDisplay.textContent = Math.round(xSlider.value); yDisplay.textContent = Math.round(ySlider.value);
}
function updateTooltip(sx, sy) { tooltip.textContent = `x: ${sx}, y: ${sy}`; overlayPosDisplay.textContent = `悬浮窗: ${sx}, ${sy}`; }
// applyPosition 接收相对坐标，转换为绝对坐标后用于 IPC 和显示
function applyPosition(rx, ry) {
  const abs = relToAbs(rx, ry);
  window.api.changePosition(abs.x, abs.y);
  updateIconPosition(abs.x, abs.y);
  updateSliders(rx, ry);
}

// 预设位置基于完整显示器分辨率（非工作区）
// fullScreenW/H 由 main.js 的 init:state 设置；回退使用 screenW/H
let fullScreenW = 1920, fullScreenH = 1080;
function getPresets() {
  const pad = 20;
  const cx = Math.round((fullScreenW - overlayW) / 2);
  const cy = Math.round((fullScreenH - overlayH) / 2);
  const bx = fullScreenW - overlayW - pad;
  const by = fullScreenH - overlayH - pad;
  return {
    'tl': [pad, pad],           // 左上
    'tc': [cx, pad],           // 中上
    'tr': [bx, pad],           // 右上
    'ml': [pad, cy],           // 左中
    'mc': [cx, cy],           // 居中
    'mr': [bx, cy],           // 右中
    'bl': [pad, by],           // 左下
    'bc': [cx, by],           // 中下
    'br': [bx, by]            // 右下
  };
}
document.querySelectorAll('.preset-btn').forEach(b => b.addEventListener('click', () => {
  const [sx, sy] = getPresets()[b.dataset.pos] || [20, 540];
  applyPosition(sx, sy);
}));

// ── 拖拽 ──
icon.addEventListener('mousedown', (e) => { isDragging = true; icon.classList.add('dragging'); e.preventDefault(); });
document.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  const r = desktop.getBoundingClientRect();
  let dx = e.clientX - r.left - icon.offsetWidth / 2, dy = e.clientY - r.top - icon.offsetHeight / 2;
  dx = Math.max(0, Math.min(dx, r.width - icon.offsetWidth));
  dy = Math.max(0, Math.min(dy, r.height - icon.offsetHeight));
  icon.style.left = dx + 'px'; icon.style.top = dy + 'px';
  const { x: sx, y: sy } = desktopToScreen(dx, dy); const rel = absToRel(sx, sy);
  updateSliders(rel.x, rel.y); updateTooltip(sx, sy);
  window.api.changePosition(sx, sy);
});
document.addEventListener('mouseup', () => { if (isDragging) { isDragging = false; icon.classList.remove('dragging'); } });
desktop.addEventListener('click', (e) => {
  if (e.target === icon) return;
  const r = desktop.getBoundingClientRect();
  let dx = e.clientX - r.left - icon.offsetWidth / 2, dy = e.clientY - r.top - icon.offsetHeight / 2;
  dx = Math.max(0, Math.min(dx, r.width - icon.offsetWidth));
  dy = Math.max(0, Math.min(dy, r.height - icon.offsetHeight));
  icon.style.left = dx + 'px'; icon.style.top = dy + 'px';
  const { x: sx, y: sy } = desktopToScreen(dx, dy); const rel = absToRel(sx, sy);
  updateSliders(rel.x, rel.y); updateTooltip(sx, sy);
  window.api.changePosition(sx, sy);
});

// ── 滑块 ──
xSlider.addEventListener('input', () => {
  const rx = Math.round((xSlider.value / 100) * screenW), ry = Math.round((ySlider.value / 100) * screenH);
  xDisplay.textContent = Math.round(xSlider.value);
  const abs = relToAbs(rx, ry);
  updateIconPosition(abs.x, abs.y); updateTooltip(abs.x, abs.y);
  window.api.changePosition(abs.x, abs.y);
});
ySlider.addEventListener('input', () => {
  const rx = Math.round((xSlider.value / 100) * screenW), ry = Math.round((ySlider.value / 100) * screenH);
  yDisplay.textContent = Math.round(ySlider.value);
  const abs = relToAbs(rx, ry);
  updateIconPosition(abs.x, abs.y); updateTooltip(abs.x, abs.y);
  window.api.changePosition(abs.x, abs.y);
});
opacitySlider.addEventListener('input', () => { opacityDisplay.textContent = opacitySlider.value + '%'; window.api.changeOpacity(opacitySlider.value / 100); });
visibilityCheck.addEventListener('change', () => window.api.toggleVisibility(visibilityCheck.checked));
closeQuitCheck.addEventListener('change', () => { window.api.setCloseBehavior(closeQuitCheck.checked ? 'quit' : 'minimize'); });
displaySelect.addEventListener('change', function() { window.api.sendDisplayChange(parseInt(this.value)); });
document.getElementById('reset-size-btn').addEventListener('click', () => {
  window.api.resetOverlaySize();
  overlayW = 300; overlayH = 110;
  document.getElementById('scale-slider').value = 50;
  document.getElementById('scale-display').textContent = '50%';
  document.getElementById('width-slider').value = 300;
  document.getElementById('width-display').textContent = '300px';
  document.getElementById('height-slider').value = 110;
  document.getElementById('height-display').textContent = '110px';
});
document.getElementById('scale-slider').addEventListener('input', function() {
  const scale = parseInt(this.value);
  document.getElementById('scale-display').textContent = scale + '%';
  window.api.setOverlayScale(scale);
});
document.getElementById('width-slider').addEventListener('input', function() {
  const w = parseInt(this.value);
  overlayW = w;
  document.getElementById('width-display').textContent = w + 'px';
  window.api.setOverlaySize(w, parseInt(document.getElementById('height-slider').value));
});
document.getElementById('height-slider').addEventListener('input', function() {
  const h = parseInt(this.value);
  overlayH = h;
  document.getElementById('height-display').textContent = h + 'px';
  window.api.setOverlaySize(parseInt(document.getElementById('width-slider').value), h);
});
document.getElementById('show-controls-check').addEventListener('change', function() { window.api.setShowControls(this.checked); });
document.getElementById('show-lyrics-check').addEventListener('change', function() { window.api.setShowLyrics(this.checked); });
document.getElementById('show-prevnext-check').addEventListener('change', function() { window.api.setShowPrevNext(this.checked); });
document.getElementById('lyric-offset-slider').addEventListener('input', function() {
  const val = parseInt(this.value);
  document.getElementById('lyric-offset-display').textContent = (val / 10).toFixed(1) + 's';
  window.api.setLyricOffset(val / 10);
});
// document.getElementById('auto-random-check').addEventListener('change', function() {
//   window.api.setAutoRandom(this.checked);
// });

// ── 媒体按钮 ──
document.getElementById('btn-prev').addEventListener('click', () => window.api.controlAction('prev'));
document.getElementById('btn-playpause').addEventListener('click', () => window.api.controlAction('playpause'));
document.getElementById('btn-next').addEventListener('click', () => window.api.controlAction('next'));
// document.getElementById('btn-random').addEventListener('click', () => {
//   const btn = document.getElementById('btn-random');
//   btn.textContent = '...';
//   btn.disabled = true;
//   window.api.playRandom();
// });
// window.api.onRandomResult((data) => {
//   const btn = document.getElementById('btn-random');
//   btn.disabled = false;
//   if (data.success) {
//     btn.textContent = '✓';
//     setTimeout(() => { btn.textContent = '随机'; }, 2000);
//   } else {
//     btn.textContent = '✕';
//     setTimeout(() => { btn.textContent = '随机'; }, 2000);
//     if (data.error) console.log('随机播放失败:', data.error);
//   }
// });
refreshBtn.addEventListener('click', async () => {
  refreshBtn.disabled = true; refreshBtn.textContent = '...';
  try { const r = await window.api.pollNow(); if (r?.song) { nowPlayingName.textContent = r.song; nowPlayingArtist.textContent = r.artist || ''; } } catch (e) {}
  refreshBtn.disabled = false; refreshBtn.textContent = '刷新';
});

// ══════════════════════════════════════════════
// 快捷键系统
// ══════════════════════════════════════════════

// 快捷键标签页切换
document.querySelectorAll('.bind-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.bind-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.bind-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    const p = document.getElementById('bind-' + tab.dataset.tab);
    if (p) p.classList.add('active');
  });
});

// 键盘快捷键
function renderKeyboard(keyboard) {
  keyboardList.innerHTML = '';
  for (const action of ACTIONS) {
    const row = document.createElement('div');
    row.className = 'bind-row';

    // 找到绑定到此操作的按键（优先显示自定义按键）
    let boundKey = '';
    const customKeys = [];
    const defaultKeys = [];
    for (const [k, v] of Object.entries(keyboard || {})) {
      if (v !== action) continue;
      if (DEFAULT_KEYS.includes(k)) defaultKeys.push(k);
      else customKeys.push(k);
    }
    // 优先显示自定义按键；无则显示默认按键；都没有则显示"未绑定"
    boundKey = customKeys[0] || defaultKeys[0] || '(未绑定)';

    row.innerHTML = `<span class="bind-action">${ACTION_LABELS[action]}</span><span class="bind-key">${boundKey}</span><span class="bind-edit"><button class="bind-edit-btn" data-action="${action}">绑定</button></span>`;
    keyboardList.appendChild(row);
  }
}

let capturingAction = null;
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.bind-edit-btn');
  if (!btn || !btn.dataset.action) return;
  const kbdPanel = document.getElementById('bind-keyboard');
  if (!kbdPanel.classList.contains('active')) return;
  if (capturingAction) document.querySelectorAll('.bind-edit-btn.recording').forEach(b => b.classList.remove('recording'));
  capturingAction = btn.dataset.action;
  btn.classList.add('recording'); btn.textContent = '...';
  const hint = document.querySelector('#ctrl-bind .capture-hint');
  hint.style.display = 'block';
  hint.textContent = '按下按键组合...';
});

// 修饰键列表（按下这些键时不完成绑定，等待组合键按下）
const MODIFIER_KEYS = ['Control', 'Alt', 'Shift', 'Meta'];

document.addEventListener('keydown', (e) => {
  if (!capturingAction) return;
  e.preventDefault(); e.stopPropagation();

  // 如果按下的是修饰键（Ctrl/Alt/Shift/Meta），等待更多按键
  if (MODIFIER_KEYS.includes(e.key)) {
    const parts = [];
    if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    const hint = document.querySelector('#ctrl-bind .capture-hint');
    hint.textContent = `按下按键组合... (${parts.join('+')}+)`;
    return;
  }

  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');

  let key = '';
  if (e.key === ' ') key = 'Space';
  else if (e.key === 'ArrowLeft') key = 'Left';
  else if (e.key === 'ArrowRight') key = 'Right';
  else if (e.key === 'ArrowUp') key = 'Up';
  else if (e.key === 'ArrowDown') key = 'Down';
  else if (e.key === 'Enter') key = 'Enter';
  else if (e.key === 'Escape') { capturingAction = null; document.querySelectorAll('.bind-edit-btn').forEach(b => b.classList.remove('recording')); document.querySelector('#ctrl-bind .capture-hint').style.display = 'none'; return; }
  else if (e.key === 'Tab') key = 'Tab';
  else if (e.key === 'Backspace') key = 'Backspace';
  else if (e.key === 'Delete') key = 'Delete';
  else if (e.key === 'Insert') key = 'Insert';
  else if (e.key === 'Home') key = 'Home';
  else if (e.key === 'End') key = 'End';
  else if (e.key === 'PageUp') key = 'PageUp';
  else if (e.key === 'PageDown') key = 'PageDown';
  else if (e.key.startsWith('F') && e.key.length <= 3 && !isNaN(e.key.slice(1))) key = e.key;
  else if (e.key === '+' || e.key === '=') key = 'Plus';
  else if (e.key.length === 1) key = e.key.toUpperCase();
  else key = e.key;
  if (e.key === 'MediaNextTrack' || e.key === 'MediaPreviousTrack' || e.key === 'MediaPlayPause') key = e.key;
  if (!key || key === 'Escape') { capturingAction = null; document.querySelectorAll('.bind-edit-btn').forEach(b => b.classList.remove('recording')); document.querySelector('#ctrl-bind .capture-hint').style.display = 'none'; return; }

  const accelerator = parts.length > 0 ? parts.join('+') + '+' + key : key;
  const action = capturingAction;

  // 拒绝纯修饰键绑定
  if (['Ctrl','Alt','Shift','Ctrl+Shift','Ctrl+Alt','Alt+Shift','Meta','Ctrl+Meta'].includes(accelerator)) {
    capturingAction = null; document.querySelectorAll('.bind-edit-btn').forEach(b => b.classList.remove('recording')); document.querySelector('#ctrl-bind .capture-hint').style.display = 'none'; return;
  }

  // 移除该操作的旧绑定，以及该快捷键的旧绑定
  for (const [k, v] of Object.entries(bindings.keyboard || {})) { if (v === action) delete bindings.keyboard[k]; }
  delete bindings.keyboard[accelerator];
  bindings.keyboard[accelerator] = action;
  window.api.saveBindings(bindings);

  // 显示反馈
  const actionLabel = ACTION_LABELS[action] || action;
  const hint = document.querySelector('#ctrl-bind .capture-hint');
  hint.textContent = `已绑定: ${accelerator} → ${actionLabel}`;
  setTimeout(() => { hint.style.display = 'none'; }, 1500);

  renderKeyboard(bindings.keyboard);
  capturingAction = null;
  document.querySelectorAll('.bind-edit-btn').forEach(b => b.classList.remove('recording'));
});

// 鼠标按键
function renderMouse(mouse) {
  mouseList.innerHTML = '';
  const buttons = [
    { id: 'XButton1', label: 'XButton1（后退）' },
    { id: 'XButton2', label: 'XButton2（前进）' }
  ];
  for (const btn of buttons) {
    const row = document.createElement('div'); row.className = 'bind-row';
    const action = (mouse || {})[btn.id] || '(未绑定)';
    row.innerHTML = `<span class="bind-action">${btn.label}</span><span class="bind-key">${action !== '(未绑定)' ? ACTION_LABELS[action] || action : '(未绑定)'}</span><span class="bind-edit"><select class="bind-action-select" data-mouse-btn="${btn.id}"><option value="">未绑定</option>${ACTIONS.map(a => `<option value="${a}" ${action === a ? 'selected' : ''}>${ACTION_LABELS[a]}</option>`).join('')}</select></span>`;
    mouseList.appendChild(row);
  }
  mouseList.querySelectorAll('.bind-action-select').forEach(sel => {
    sel.addEventListener('change', function() {
      const id = this.dataset.mouseBtn;
      if (this.value) bindings.mouse[id] = this.value; else delete bindings.mouse[id];
      window.api.saveBindings(bindings); renderMouse(bindings.mouse);
    });
  });
}

// 手柄（XInput 方式，通过 main 进程 PowerShell 轮询）
function renderGamepadBindings() {
  const gp = bindings.gamepad || {};
  const btnMap = ['', '方向键下','方向键左','方向键右','Start','Back','左摇杆','右摇杆','LB','RB','','','A','B','X','Y'];
  gpPrevLabel.textContent = gp.prev ? (btnMap[gp.prev.button] || '按键'+gp.prev.button) : '未绑定';
  gpPlayLabel.textContent  = gp.playpause ? (btnMap[gp.playpause.button] || '按键'+gp.playpause.button) : '未绑定';
  gpNextLabel.textContent  = gp.next ? (btnMap[gp.next.button] || '按键'+gp.next.button) : '未绑定';
}

// 所有绑定按钮的绑定事件
document.querySelectorAll('.gp-bind-btn').forEach(btn => {
  btn.addEventListener('click', function() {
    const action = this.dataset.action;
    if (isBinding) {
      // 点击同一个按钮取消绑定
      if (bindingTarget === action) {
        isBinding = false;
        bindingTarget = '';
        this.textContent = '绑定';
        return;
      }
      // 切换到另一个动作
      document.querySelectorAll('.gp-bind-btn').forEach(b => b.textContent = '绑定');
    }
    isBinding = true;
    bindingTarget = action;
    this.textContent = '取消';
    gamepadStatus.textContent = '等待按键...';
  });
});

// 接收 main 进程发来的 XInput 手柄按键事件
window.api.onXInputButton((data) => {
  // 确保手柄状态显示已连接
  if (!xinputConnected) {
    xinputConnected = true;
    gamepadStatus.textContent = '✓ 已连接';
    gamepadStatus.className = 'status-on';
  }

  if (isBinding && bindingTarget) {
    // 绑定模式：保存按键映射
    const action = bindingTarget;
    isBinding = false;
    bindingTarget = '';
    document.querySelectorAll('.gp-bind-btn').forEach(b => b.textContent = '绑定');
    gamepadStatus.textContent = '✓ 已连接';

    bindings.gamepad[action] = { player: data.player, button: data.button };
    window.api.saveBindings(bindings);
    renderGamepadBindings();
    return;
  }

  // 执行模式：查找绑定并触发
  const gp = bindings.gamepad || {};
  for (const [action, binding] of Object.entries(gp)) {
    if (binding && binding.player === data.player && binding.button === data.button) {
      window.api.controlAction(action);
      break;
    }
  }
});

function renderAllBindings() { renderKeyboard(bindings.keyboard || {}); renderMouse(bindings.mouse || {}); renderGamepadBindings(); }

// ── 虚拟桌面尺寸 ──
function updateVirtualDesktopSize(bounds) {
  if (!bounds) return;
  screenW = bounds.width || screenW; screenH = bounds.height || screenH;
  screenX = bounds.x || 0; screenY = bounds.y || 0;
  fitDesktop();
  screenSizeDisplay.textContent = `屏幕 ${screenW}×${screenH}`;
}

function fitDesktop() {
  if (!desktopPanel || !screenW || !screenH) return;
  const pw = desktopPanel.clientWidth - 24;
  const ph = desktopPanel.clientHeight - 24 - 20; // 减去信息栏高度
  if (pw <= 0 || ph <= 0) return;
  const ratio = screenW / screenH;
  let w = pw, h = pw / ratio;
  if (h > ph) { h = ph; w = h * ratio; }
  desktop.style.width = Math.round(w) + 'px';
  desktop.style.height = Math.round(h) + 'px';
  const iw = icon.offsetWidth, ih = icon.offsetHeight;
  let lx = parseFloat(icon.style.left) || 0, ly = parseFloat(icon.style.top) || 0;
  if (lx + iw > w) icon.style.left = (w - iw) + 'px';
  if (ly + ih > h) icon.style.top = (h - ih) + 'px';
}
window.addEventListener('resize', fitDesktop);

// ── IPC 事件 ──
window.api.onInitState((data) => {
  screenW = data.screenSize?.width || screenW; screenH = data.screenSize?.height || screenH;
  fullScreenW = data.screenFullSize?.width || screenW; fullScreenH = data.screenFullSize?.height || screenH;
  overlayW = data.overlaySize?.width || overlayW; overlayH = data.overlaySize?.height || overlayH;
  if (data.position) { updateIconPosition(data.position.x, data.position.y); var r=absToRel(data.position.x,data.position.y); updateSliders(r.x,r.y); updateTooltip(data.position.x, data.position.y); }
  if (data.song) { nowPlayingName.textContent = data.song.name || '等待音乐...'; nowPlayingArtist.textContent = data.song.artist || ''; nowPlayingTop.textContent = data.song.name || ''; }
  opacitySlider.value = Math.round((data.opacity || 1) * 100); opacityDisplay.textContent = opacitySlider.value + '%';
  visibilityCheck.checked = data.visible !== false;
  document.getElementById('show-controls-check').checked = data.showControls || false;
  document.getElementById('show-lyrics-check').checked = data.showLyrics || false;
  if (data.overlayScale) {
    document.getElementById('scale-slider').value = data.overlayScale;
    document.getElementById('scale-display').textContent = data.overlayScale + '%';
  }
  const ow = data.overlaySize?.width || overlayW;
  const oh = data.overlaySize?.height || overlayH;
  document.getElementById('width-slider').value = ow;
  document.getElementById('width-display').textContent = ow + 'px';
  document.getElementById('height-slider').value = oh;
  document.getElementById('height-display').textContent = oh + 'px';
  if (data.lyricManualOffset !== undefined) {
    const v = Math.round(data.lyricManualOffset * 10);
    document.getElementById('lyric-offset-slider').value = v;
    document.getElementById('lyric-offset-display').textContent = (v / 10).toFixed(1) + 's';
  }
  document.getElementById('show-prevnext-check').checked = data.showPrevNext || false;
  if (data.savedPhone) loginPhone.value = data.savedPhone;
  if (data.closeBehavior === 'minimize') closeQuitCheck.checked = false;

  if (data.displays?.length) {
    displaySelect.innerHTML = data.displays.map(d => `<option value="${d.index}" ${d.index === (data.displayIndex || 0) ? 'selected' : ''}>屏幕${d.index+1} (${d.width}×${d.height})</option>`).join('');
    updateVirtualDesktopSize(data.displayBounds || data.screenSize);
  }
});

window.api.onNowPlaying((data) => {
  nowPlayingName.textContent = data.name || '等待音乐...';
  nowPlayingArtist.textContent = data.artist || '';
  nowPlayingTop.textContent = data.name || '';
});

// window.api.onAutoRandomStatus((data) => {
//   document.getElementById('auto-random-check').checked = data.enabled;
// });

window.api.onPositionUpdated((data) => { updateIconPosition(data.x, data.y); var r=absToRel(data.x,data.y); updateSliders(r.x,r.y); updateTooltip(data.x, data.y); });
window.api.onGamepadStatus((data) => {
  xinputConnected = data.connected;
  gamepadStatus.textContent = data.connected ? '✓ 已连接' : '等待按键...';
  gamepadStatus.className = data.connected ? 'status-on' : 'status-off';
});
window.api.onBindingsSaved(() => renderAllBindings());
window.api.onDisplayBounds((data) => {
  if (data) {
    if (data.fullWidth) fullScreenW = data.fullWidth;
    if (data.fullHeight) fullScreenH = data.fullHeight;
    updateVirtualDesktopSize(data);
    const r = desktop.getBoundingClientRect();
    let dx = parseFloat(icon.style.left) || 0, dy = parseFloat(icon.style.top) || 0;
    dx = Math.max(0, Math.min(dx, r.width - icon.offsetWidth));
    dy = Math.max(0, Math.min(dy, r.height - icon.offsetHeight));
    icon.style.left = dx + 'px'; icon.style.top = dy + 'px';
  }
});
window.api.onOverlaySizeUpdated((data) => {
  if (data) {
    overlayW = data.width || overlayW;
    overlayH = data.height || overlayH;
    document.getElementById('width-slider').value = overlayW;
    document.getElementById('width-display').textContent = overlayW + 'px';
    document.getElementById('height-slider').value = overlayH;
    document.getElementById('height-display').textContent = overlayH + 'px';
    if (data.scale) {
      document.getElementById('scale-slider').value = data.scale;
      document.getElementById('scale-display').textContent = data.scale + '%';
    }
  }
});
window.api.onLyricOffsetUpdated((data) => {
  if (data && data.offset !== undefined) {
    const v = Math.round(data.offset * 10);
    document.getElementById('lyric-offset-slider').value = v;
    document.getElementById('lyric-offset-display').textContent = (v / 10).toFixed(1) + 's';
  }
});

// ── 密码登录 ──
loginBtn.addEventListener('click', async () => {
  const phone = loginPhone.value.trim(), password = loginPassword.value.trim();
  if (!phone || !password) { loginError.textContent = '请输入手机号和密码'; loginError.style.display = 'block'; return; }
  loginBtn.disabled = true; loginBtn.textContent = '登录中...'; loginError.style.display = 'none'; loginStatus.textContent = '登录中...';
  try {
    const r = await window.api.loginSubmit(phone, password);
    if (r) { showLoggedIn(); } else { loginError.textContent = '登录失败，试试短信验证码登录'; loginError.style.display = 'block'; loginBtn.disabled = false; loginBtn.textContent = '密码登录'; }
  } catch (e) { loginError.textContent = '错误: ' + e.message; loginError.style.display = 'block'; loginBtn.disabled = false; loginBtn.textContent = '密码登录'; }
});

// ── 登录方式切换 ──
let smsMode = false;
loginSwitch.addEventListener('click', () => {
  if (!smsMode) {
    loginPwdSection.style.display = 'none';
    loginSmsSection.style.display = 'block';
    loginSwitch.textContent = '密码登录';
  } else {
    loginPwdSection.style.display = 'block';
    loginSmsSection.style.display = 'none';
    loginSwitch.textContent = '短信验证码登录';
  }
  smsMode = !smsMode;
  loginError.style.display = 'none';
});

// ── 发送短信验证码 ──
let smsCountdown = 0;
smsSendBtn.addEventListener('click', async () => {
  const phone = loginPhone.value.trim();
  if (!phone) { loginError.textContent = '请输入手机号'; loginError.style.display = 'block'; return; }
  smsSendBtn.disabled = true; smsSendBtn.textContent = '发送中...';
  loginError.style.display = 'none';
  try {
    const r = await window.api.smsSend(phone);
    if (r.success) {
      smsCountdown = 60;
      smsTimer.style.display = 'block';
      const tick = () => {
        smsCountdown--;
        if (smsCountdown > 0) { smsTimer.textContent = `重新发送(${smsCountdown}s)`; setTimeout(tick, 1000); }
        else { smsTimer.style.display = 'none'; smsSendBtn.disabled = false; smsSendBtn.textContent = '发送验证码'; }
      };
      tick();
    } else {
      loginError.textContent = r.error || '发送失败'; loginError.style.display = 'block';
      smsSendBtn.disabled = false; smsSendBtn.textContent = '发送验证码';
    }
  } catch (e) { loginError.textContent = '错误: ' + e.message; loginError.style.display = 'block'; smsSendBtn.disabled = false; smsSendBtn.textContent = '发送验证码'; }
});

// ── 短信验证码登录 ──
smsLoginBtn.addEventListener('click', async () => {
  const phone = loginPhone.value.trim(), code = smsCode.value.trim();
  if (!phone || !code) { loginError.textContent = '请输入手机号和验证码'; loginError.style.display = 'block'; return; }
  smsLoginBtn.disabled = true; smsLoginBtn.textContent = '登录中...'; loginError.style.display = 'none'; loginStatus.textContent = '登录中...';
  try {
    const r = await window.api.smsLogin(phone, code);
    if (r.loggedIn) { showLoggedIn(); }
    else { loginError.textContent = r.error || '登录失败'; loginError.style.display = 'block'; smsLoginBtn.disabled = false; smsLoginBtn.textContent = '验证码登录'; }
  } catch (e) { loginError.textContent = '错误: ' + e.message; loginError.style.display = 'block'; smsLoginBtn.disabled = false; smsLoginBtn.textContent = '验证码登录'; }
});

function showLoggedIn() {
  loginStatus.textContent = '已登录'; loginStatus.style.color = 'var(--accent)';
  loginBtn.style.display = 'none'; loginSwitch.style.display = 'none';
  loginPwdSection.style.display = 'none'; loginSmsSection.style.display = 'none';
  logoutBtn.style.display = 'block';
  loginPhone.disabled = true; loginPassword.disabled = true; smsCode.disabled = true;
  loginError.style.display = 'none';
  userBtn.classList.add('logged-in');
}

logoutBtn.addEventListener('click', async () => {
  await window.api.loginLogout();
  loginStatus.textContent = '未登录'; loginStatus.style.color = '';
  loginBtn.style.display = 'block'; loginSwitch.style.display = 'block'; loginPwdSection.style.display = 'block';
  logoutBtn.style.display = 'none'; loginSmsSection.style.display = 'none';
  loginPhone.disabled = false; loginPassword.disabled = false; smsCode.disabled = false;
  loginBtn.disabled = false; loginBtn.textContent = '密码登录'; smsMode = false;
  loginSwitch.textContent = '短信验证码登录';
  smsCode.value = '';
  userBtn.classList.remove('logged-in');
});

window.api.onLoginStatus((data) => {
  if (data.loggedIn) {
    loginStatus.textContent = data.nickname ? `已登录: ${data.nickname}` : '已登录';
    loginStatus.style.color = 'var(--accent)'; loginBtn.style.display = 'none'; loginSwitch.style.display = 'none';
    loginPwdSection.style.display = 'none'; loginSmsSection.style.display = 'none';
    logoutBtn.style.display = 'block'; loginPhone.disabled = true; loginPassword.disabled = true;
    loginError.style.display = 'none'; userBtn.classList.add('logged-in');
  } else if (data.error) {
    loginError.textContent = data.error; loginError.style.display = 'block';
    loginBtn.disabled = false; loginBtn.textContent = '密码登录';
  }
});

// QR
qrLoginBtn.addEventListener('click', async () => {
  qrLoginBtn.disabled = true; qrLoginBtn.textContent = '生成中...'; loginError.style.display = 'none';
  try {
    const r = await window.api.qrStart();
    if (r.error) { loginError.textContent = '二维码错误: ' + r.error; loginError.style.display = 'block'; qrLoginBtn.disabled = false; qrLoginBtn.textContent = '二维码登录'; return; }
    qrImage.src = r.qrimg; qrDisplay.style.display = 'block'; qrLoginBtn.style.display = 'none'; qrStatus.textContent = '请用网易云App扫码';
  } catch (e) { loginError.textContent = '二维码错误: ' + e.message; loginError.style.display = 'block'; qrLoginBtn.disabled = false; qrLoginBtn.textContent = '二维码登录'; }
});
qrCancelBtn.addEventListener('click', async () => { await window.api.qrCancel(); qrDisplay.style.display = 'none'; qrLoginBtn.style.display = 'block'; qrLoginBtn.disabled = false; qrLoginBtn.textContent = '二维码登录'; });
window.api.onQrResult((data) => {
  if (data.status === 'success') { qrStatus.textContent = '登录成功！'; qrDisplay.style.display = 'none'; qrLoginBtn.style.display = 'none'; userBtn.classList.add('logged-in'); }
  else if (data.status === 'scanning') qrStatus.textContent = '已扫码，登录中...';
});

// ── 初始化 ──
(async function init() {
  const status = await window.api.getStatus();
  if (status) {
    screenW = status.screenSize?.width || screenW; screenH = status.screenSize?.height || screenH;
    fullScreenW = status.screenFullSize?.width || screenW; fullScreenH = status.screenFullSize?.height || screenH;
    overlayW = status.overlaySize?.width || overlayW; overlayH = status.overlaySize?.height || overlayH;
    if (status.position) { updateIconPosition(status.position.x, status.position.y); var r=absToRel(status.position.x,status.position.y); updateSliders(r.x,r.y); updateTooltip(status.position.x, status.position.y); }
    if (status.song) { nowPlayingName.textContent = status.song.name || '等待音乐...'; nowPlayingArtist.textContent = status.song.artist || ''; nowPlayingTop.textContent = status.song.name || ''; }
    opacitySlider.value = Math.round((status.opacity || 1) * 100); opacityDisplay.textContent = opacitySlider.value + '%';
    visibilityCheck.checked = status.visible !== false;
    document.getElementById('show-controls-check').checked = status.showControls || false;
    document.getElementById('show-lyrics-check').checked = status.showLyrics || false;
    document.getElementById('show-prevnext-check').checked = status.showPrevNext || false;
    if (status.overlayScale) {
      document.getElementById('scale-slider').value = status.overlayScale;
      document.getElementById('scale-display').textContent = status.overlayScale + '%';
    }
    const sw = status.overlaySize?.width || overlayW;
    const sh = status.overlaySize?.height || overlayH;
    document.getElementById('width-slider').value = sw;
    document.getElementById('width-display').textContent = sw + 'px';
    document.getElementById('height-slider').value = sh;
    document.getElementById('height-display').textContent = sh + 'px';
    if (status.lyricManualOffset !== undefined) {
      const v = Math.round(status.lyricManualOffset * 10);
      document.getElementById('lyric-offset-slider').value = v;
      document.getElementById('lyric-offset-display').textContent = (v / 10).toFixed(1) + 's';
    }
  }
  const b = await window.api.loadBindings();
  if (b) { bindings = b; renderAllBindings(); }
  // 手柄状态等待 XInput IPC 事件，连接后 xinput:button 会自动触发状态更新
  gamepadStatus.textContent = '连接手柄后按任意键...';

  // 加载自动随机状态
  // const ar = await window.api.getAutoRandom();
  // if (ar) document.getElementById('auto-random-check').checked = ar.enabled;
})();
