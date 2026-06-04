@echo off
REM 取消设置 ELECTRON_RUN_AS_NODE 环境变量（否则 Electron 无法正常初始化）
set ELECTRON_RUN_AS_NODE=
REM 启动 Electron 应用
node_modules\.bin\electron.cmd %*
