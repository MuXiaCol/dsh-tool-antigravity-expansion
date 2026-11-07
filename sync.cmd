@echo off
setlocal
rem 把本仓库同步进 DSH profile 的 node_modules（复制，不用软链），然后重启 DeepSeek Harness。
set "NODE_EXE=node"
if exist "C:\Users\www22\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" (
  set "NODE_EXE=C:\Users\www22\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
)
"%NODE_EXE%" "%~dp0scripts\sync-to-profile.mjs" %*
exit /b %errorlevel%
