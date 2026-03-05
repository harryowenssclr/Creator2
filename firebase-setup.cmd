@echo off
echo === Firebase Setup ===
echo.
echo Step 1: Re-authenticate with Firebase (opens browser)...
echo        This refreshes your credentials if they've expired.
call npx firebase login --reauth
if errorlevel 1 (
  echo Login failed or cancelled.
  exit /b 1
)
echo.
echo Step 2: Link your Firebase project...
call npx firebase use --add
if errorlevel 1 (
  echo Project linking failed or cancelled.
  exit /b 1
)
echo.
echo Done! You can now run: npm run deploy
pause
