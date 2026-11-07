@echo off
setlocal
rem 把本仓库镜像到 DSH profile 的 packages/ 目录，并维护 node_modules 联接（不要直接 file: 指向仓库外）。
set "NODE_EXE=node"
if exist "C:\Users\www22\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" (
  set "NODE_EXE=C:\Users\www22\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
)
"%NODE_EXE%" "%~dp0scripts\sync-to-profile.mjs" %*
exit /b %errorlevel%
