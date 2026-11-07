@echo off
setlocal
rem Mirror this repo into the DSH profile packages directory and keep the node_modules junction.
rem Never declare the plugin as file:D:/... from outside the profile (see README).
set "NODE_EXE=node"
if exist "%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" (
  set "NODE_EXE=%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
)
"%NODE_EXE%" "%~dp0scripts\sync-to-profile.mjs" %*
exit /b %errorlevel%
