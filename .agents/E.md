You are implementing chunk E of a small browser game project, "Stardust Breaker", in /home/ben/me/code/2610_asteroid_shooter: a headless-browser smoke test.

FIRST read /home/ben/me/code/2610_asteroid_shooter/BRIEF.md fully, especially the "tools/smoke.ts (E)" section, the DOM ids in "index.html + style.css (A)", and the game object shape in "game.js + main.js (D)" (window.__game with .state, .wave, .debug.levelUp/killShip/clearWave). The game itself is being written by other agents in parallel and does not exist yet, so you cannot run the test end-to-end. Write it carefully against the contract.

Your file (create only this; do not touch any other file):
- tools/smoke.ts

Reference: a working sibling script that launches headless Chromium the same way is /home/ben/me/code/2610_manhattan_history/tools/shot.ts. Read it and reuse its chromePath() approach. `playwright-core` resolves via the project's node_modules symlink.

Requirements:
- Run as `bun tools/smoke.ts`. Saves screenshots to tools/out/ (mkdir -p). BASE env default http://127.0.0.1:8780.
- Each step is wrapped so a failure is recorded (PASS/FAIL line with reason) and later steps still try to run where sensible. Use explicit waits with timeouts (e.g. page.waitForFunction(() => window.__game?.state === 'playing', null, {timeout: 5000})), not just sleeps, for state assertions.
- For the touch joystick drag, use page.mouse (down/move with steps/up) on the canvas; input.js listens to pointer events. Also record ship x/y/angle before and after the drag and assert the ship moved or turned.
- For "visible" checks on overlays use `!el.hidden` plus a non-zero bounding box.
- Collect console messages of type 'error' and 'pageerror'; print them at the end; any of them => exit 1.
- Always close the browser (finally).
- Verify it at least parses: `cd /home/ben/me/code/2610_asteroid_shooter && bun build --no-bundle tools/smoke.ts --target=bun >/dev/null && echo OK`. Also run it once now (no server is running yet): it should fail cleanly with a clear "cannot reach BASE" style message, not hang. Do NOT start any servers, do NOT use pkill/killall.

Final report (concise): file written, how to run it, and what each step asserts.
