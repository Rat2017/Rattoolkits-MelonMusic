// ── 手柄监控 ──
let bindings = {};
let lastButtonStates = {};
let listeningForBinding = false;
let listeningButtonIndex = null;

function pollGamepads() {
  const connected = navigator.getGamepads();
  for (const gp of connected) {
    if (!gp) continue;

    gp.buttons.forEach((button, index) => {
      const key = `${gp.index}:${index}`;
      const isPressed = button.pressed;
      const wasPressed = lastButtonStates[key] || false;

      // 检测按键从"未按下"变为"按下"的瞬间
      if (isPressed && !wasPressed) {
        handleButtonPress(gp.index, index);
      }
      lastButtonStates[key] = isPressed;
    });
  }

  requestAnimationFrame(pollGamepads);
}

function handleButtonPress(gamepadIndex, buttonIndex) {
  // 如果正在监听绑定，则将按键结果发回面板
  if (listeningForBinding) {
    listeningForBinding = false;
    window.api.sendGamepadButton(buttonIndex);
    return;
  }

  // 检查绑定的操作
  const key = `${gamepadIndex}:${buttonIndex}`;
  const action = bindings[key];
  if (action) {
    window.api.sendGamepadAction(action);
  }
}

// ── IPC 监听器 ──
window.api.onBindingsUpdate((data) => {
  bindings = data || {};
});

window.api.onStartBinding(() => {
  listeningForBinding = true;
});

// ── 手柄连接/断开事件 ──
window.addEventListener('gamepadconnected', (e) => {
  const gp = e.gamepad;
  window.api.sendGamepadConnected(gp.id, gp.index);
  pollGamepads();
});

window.addEventListener('gamepaddisconnected', (e) => {
  window.api.sendGamepadDisconnected(e.gamepad.index);
});

// 初始检测：检查是否已有已连接的手柄
setTimeout(() => {
  const gps = navigator.getGamepads();
  for (const gp of gps) {
    if (gp) {
      window.api.sendGamepadConnected(gp.id, gp.index);
    }
  }
}, 500);
