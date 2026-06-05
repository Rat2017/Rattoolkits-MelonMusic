MelonMusic 网易云音乐桌面悬浮窗

一个基于 Electron 的网易云音乐桌面辅助工具，提供悬浮窗展示当前播放歌曲，支持快捷键、鼠标侧键和手柄控制。

功能

**歌曲悬浮窗**   透明悬浮窗显示当前播放的歌曲名称、艺术家和专辑封面，置顶显示，可随意拖动调整位置
**多显示器支持** 完美支持多显示器环境，可指定悬浮窗显示在哪块屏幕
**多种检测方式** 自动检测网易云音乐客户端窗口标题，同时支持通过 API 轮询获取当前播放状态
**快捷键控制**   支持多媒体键（下一首/上一首/播放暂停）、自定义键盘快捷键
**鼠标侧键控制** 支持鼠标 XButton1/XButton2（这俩是侧键）绑定控制操作
**手柄控制**     支持游戏手柄按键绑定，无线操控音乐播放
**多种登录方式** 支持手机号密码登录、短信验证码登录、二维码扫码登录
**位置预设**     内置九宫格位置预设，一键将悬浮窗定位到屏幕的指定位置
**托盘运行**     关闭窗口时可最小化到系统托盘，后台常驻运行
**透明度调节**   支持悬浮窗透明度调节

项目结构

```
MelonMusic/
├── main.js              Electron 主进程入口，负责窗口管理、IPC、快捷键、登录和歌曲检测
├── preload.js           预加载脚本，通过 contextBridge 暴露安全的 API 给渲染进程
├── overlay.html         悬浮窗页面（HTML）
├── overlay.js           悬浮窗页面逻辑，展示歌曲信息和封面
├── overlay.css          悬浮窗样式
├── panel.html           控制面板页面（HTML）
├── panel.js             控制面板逻辑，位置调节、快捷键绑定、登录管理
├── panel.css            控制面板样式
├── gamepad.html         手柄后台页面（HTML）
├── gamepad.js           手柄轮询和按键绑定逻辑
├── build.ps1            构建脚本，使用 electron-builder 打包为 NSIS 安装包
├── launch.cmd           命令行启动脚本（CMD）
├── launch.ps1           命令行启动脚本（PowerShell）
└── package.json         项目配置和依赖
```

使用手册

系统要求

Windows 7 或更高版本
[Node.js](https://nodejs.org/) >= 18（仅开发/构建时需要）
网易云音乐 Windows 客户端（用于窗口标题检测）

快速启动

```bash
安装依赖
npm install

启动应用
npm start
```

构建安装包

```bash
生成 NSIS 安装包（x64）
.\build.ps1

仅打包目录（快速测试）
.\build.ps1 -Dev

构建 32 位版本
.\build.ps1 -Arch ia32
```

登录说明

应用需要登录网易云音乐账号后才能使用 API 轮询检测功能。支持三种登录方式：

1. **密码登录** 输入手机号和密码直接登录
2. **短信验证码登录** 输入手机号，获取短信验证码后登录
3. **二维码登录** 使用网易云音乐 App 扫码登录

登录信息会保存在本地设置文件中。

快捷键设置

在控制面板的"快捷键"标签页中，可以分别为键盘、鼠标、手柄绑定操作：

**键盘** 点击"绑定"按钮，然后按下想要绑定的按键组合
**鼠标** 从下拉菜单中选择鼠标侧键要触发的操作
**手柄** 连接手柄后，点击"绑定按键"，然后按下手柄上的按键

窗口位置

在"位置预设"标签页中，可以通过：
在虚拟桌面上直接拖拽悬浮窗图标
使用 X/Y 滑块精确定位
点击九宫格预设按钮快速定位

**关闭行为**：勾选"关闭退出"时，关闭面板窗口会退出整个应用；取消勾选则最小化到系统托盘。

技术栈

[Electron](https://www.electronjs.org/) 桌面应用框架
[NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi) 网易云音乐 API
[electron-builder](https://www.electron.build/) 应用打包工具

开源协议

**GNU Affero General Public License v3.0 (AGPL-3.0)**

本软件基于 AGPL-3.0 协议开源。您可以自由使用、修改和分发本软件，但任何修改后的版本在通过网络提供服务时，必须向用户提供修改后的完整源代码。

完整的协议文本请参见 [LICENSE](LICENSE) 文件。

---

Copyright © Rat2017 (Rattoolkits). Licensed under AGPL-3.0.
