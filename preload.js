const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // 歌曲更新
  onSongUpdate: (cb) => { const h = (_, d) => cb(d); ipcRenderer.on('song:update', h); return () => ipcRenderer.removeListener('song:update', h); },
  onPositionUpdated: (cb) => { const h = (_, d) => cb(d); ipcRenderer.on('position:updated', h); return () => ipcRenderer.removeListener('position:updated', h); },
  onInitState: (cb) => { const h = (_, d) => cb(d); ipcRenderer.on('init:state', h); return () => ipcRenderer.removeListener('init:state', h); },
  onNowPlaying: (cb) => { const h = (_, d) => cb(d); ipcRenderer.on('now-playing', h); return () => ipcRenderer.removeListener('now-playing', h); },
  onPrevNext: (cb) => { const h = (_, d) => cb(d); ipcRenderer.on('song:prev-next', h); return () => ipcRenderer.removeListener('song:prev-next', h); },

  // 手柄
  onGamepadStatus: (cb) => { const h = (_, d) => cb(d); ipcRenderer.on('gamepad:status', h); return () => ipcRenderer.removeListener('gamepad:status', h); },
  onGamepadBindingResult: (cb) => { const h = (_, d) => cb(d); ipcRenderer.on('gamepad:binding-result', h); return () => ipcRenderer.removeListener('gamepad:binding-result', h); },
  onBindingsSaved: (cb) => { const h = (_, d) => cb(d); ipcRenderer.on('bindings:saved', h); return () => ipcRenderer.removeListener('bindings:saved', h); },
  onDisplayBounds: (cb) => { const h = (_, d) => cb(d); ipcRenderer.on('display:bounds', h); return () => ipcRenderer.removeListener('display:bounds', h); },
  onOverlaySizeUpdated: (cb) => { const h = (_, d) => cb(d); ipcRenderer.on('overlay:size-updated', h); return () => ipcRenderer.removeListener('overlay:size-updated', h); },

  // 操作
  changePosition: (x, y) => ipcRenderer.send('position:change', { x, y }),
  changeOpacity: (opacity) => ipcRenderer.send('opacity:change', { opacity }),
  toggleVisibility: (visible) => ipcRenderer.send('visibility:toggle', { visible }),
  controlAction: (action) => ipcRenderer.send('control:action', { action }),

  // 悬浮窗设置
  onOverlaySettings: (cb) => { const h = (_, d) => cb(d); ipcRenderer.on('overlay:settings', h); return () => ipcRenderer.removeListener('overlay:settings', h); },
  onLyricsUpdate: (cb) => { const h = (_, d) => cb(d); ipcRenderer.on('lyrics:update', h); return () => ipcRenderer.removeListener('lyrics:update', h); },
  setShowControls: (show) => ipcRenderer.send('overlay:show-controls', { show }),
  setShowLyrics: (show) => ipcRenderer.send('overlay:show-lyrics', { show }),
  setShowPrevNext: (show) => ipcRenderer.send('overlay:show-prevnext', { show }),

  // 快捷键绑定（统一系统）
  loadBindings: () => ipcRenderer.invoke('bindings:load'),
  loadKeyboard: () => ipcRenderer.invoke('bindings:loadKeyboard'),
  saveBindings: (b) => ipcRenderer.send('bindings:save', { bindings: b }),

  // 手柄专用
  onBindingsUpdate: (cb) => { const h = (_, d) => cb(d); ipcRenderer.on('bindings:update', h); return () => ipcRenderer.removeListener('bindings:update', h); },
  onStartBinding: (cb) => { const h = () => cb(); ipcRenderer.on('start-binding', h); return () => ipcRenderer.removeListener('start-binding', h); },
  sendGamepadButton: (gi, bi) => ipcRenderer.send('gamepad:button-pressed', { gamepadIndex: gi, buttonIndex: bi }),
  sendGamepadConnected: (id, i) => ipcRenderer.send('gamepad:connected', { id, index: i }),
  sendGamepadDisconnected: (i) => ipcRenderer.send('gamepad:disconnected', { index: i }),
  sendGamepadAction: (a) => ipcRenderer.send('gamepad:action', { action: a }),

  // 窗口控制
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  maximizeWindow: () => ipcRenderer.send('window:maximize'),

  // 关闭行为
  setCloseBehavior: (b) => ipcRenderer.send('closeBehavior:set', { behavior: b }),

  // 显示器
  listDisplays: () => ipcRenderer.invoke('displays:list'),
  sendDisplayChange: (index) => ipcRenderer.send('display:set', { index }),

  // 重置悬浮窗大小
  resetOverlaySize: () => ipcRenderer.send('overlay:reset-size'),

  // 状态
  getStatus: () => ipcRenderer.invoke('get:status'),
  pollNow: () => ipcRenderer.invoke('poll:now'),

  // 登录
  loginSubmit: (p, pw) => ipcRenderer.invoke('login:submit', { phone: p, password: pw }),
  loginLogout: () => ipcRenderer.invoke('login:logout'),
  onLoginStatus: (cb) => { const h = (_, d) => cb(d); ipcRenderer.on('login:status', h); return () => ipcRenderer.removeListener('login:status', h); },

  // 短信验证码
  // 随机播放
  playRandom: () => ipcRenderer.invoke('song:play-random'),
  onRandomResult: (cb) => { const h = (_, d) => cb(d); ipcRenderer.on('random:result', h); return () => ipcRenderer.removeListener('random:result', h); },

  // 自动随机
  setAutoRandom: (enabled) => ipcRenderer.invoke('auto-random:toggle', { enabled }),
  getAutoRandom: () => ipcRenderer.invoke('auto-random:status'),
  onAutoRandomStatus: (cb) => { const h = (_, d) => cb(d); ipcRenderer.on('auto-random:status', h); return () => ipcRenderer.removeListener('auto-random:status', h); },

  smsSend: (phone) => ipcRenderer.invoke('sms:send', { phone }),
  smsLogin: (phone, captcha) => ipcRenderer.invoke('sms:login', { phone, captcha }),

  // 二维码
  qrStart: () => ipcRenderer.invoke('qr:start'),
  qrCancel: () => ipcRenderer.invoke('qr:cancel'),
  onQrResult: (cb) => { const h = (_, d) => cb(d); ipcRenderer.on('qr:result', h); return () => ipcRenderer.removeListener('qr:result', h); }
});
