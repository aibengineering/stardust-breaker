You are implementing chunk D, the integration chunk, of a small browser game, "Stardust Breaker" (asteroid shooter with roguelite upgrades), in /home/ben/me/code/2610_asteroid_shooter.

FIRST read /home/ben/me/code/2610_asteroid_shooter/BRIEF.md fully. It is the contract. Then read the modules other agents have ALREADY written, because you must call their real exports (if they differ from the brief, the real code wins; mention every mismatch in your report):
- site/js/entities.js, site/js/audio.js, site/js/upgrades.js, site/js/ui.js, site/js/input.js
- site/index.html and site/style.css (DOM ids)
- tools/smoke.ts (the test your code must pass)

Your files (create only these; do not edit any other file):
- site/js/game.js
- site/js/main.js

Implement everything in the "game.js + main.js (D)" section of the brief. Additional requirements:
- `createGame` returns the game object; `game.state`, `game.wave`, `game.level`, `game.ship`, `game.score` must be readable from `window.__game` (the smoke test reads them). debug.levelUp() adds exactly enough XP to level up (so the normal level-up flow runs); debug.killShip() sets hull to 0 through the normal death path; debug.clearWave() kills all asteroids WITHOUT dropping gems so the next wave begins.
- The rAF loop: compute dt from timestamps, clamp to 0.05, never let an exception kill the loop silently (wrap the frame in try/catch, report the error with console.error ONCE, and keep going).
- Canvas resize: on window resize set canvas.width/height = innerWidth/innerHeight × devicePixelRatio (cap dpr at 2), keep world {w,h} in CSS px, keep the ship on-screen.
- Collision loops: keep them simple O(n·m) loops; remove dead objects with in-place compaction each frame (no repeated splice inside loops).
- The title screen shows a few drifting asteroids behind the overlay (state 'title'). On start(), clear them.
- Gems: cap at 300 live gems (merge value into an existing gem if over the cap).
- When the upgrade screen is open, the touch joystick must not keep the ship steering after resume: reset input.stick (active=false, x=y=0) when entering 'upgrade' and 'pause'.
- After choosing an upgrade, grant 0.6 s invulnerability.
- Best score in localStorage 'sb-best' (guard localStorage exceptions); call ui.setBest at boot and after game over.
- In main.js wire visibilitychange → game.pause() when playing.

Testing (required):
1. `cd /home/ben/me/code/2610_asteroid_shooter && bun build --no-bundle site/js/game.js >/dev/null && bun build --no-bundle site/js/main.js >/dev/null && echo OK`
2. Start the server on a private port and run the smoke test against it:
   `PORT=8791 bun server.ts > /tmp/sb_d_server.log 2>&1 & echo $! > /tmp/sb_d.pid; sleep 1; BASE=http://127.0.0.1:8791 bun tools/smoke.ts; kill $(cat /tmp/sb_d.pid)`
   Fix problems in YOUR files until every step passes with no console errors. If a failure is caused by another chunk's file, do not edit it: describe the exact bug (file, line, fix) in your report.
3. Look at the screenshots in tools/out/ (Read them) and check the game actually renders: ship, asteroids, HUD, upgrade cards, game-over screen.
Server hygiene: stop ONLY your own server by its saved PID. NEVER use pkill/killall or kill any other process; this machine runs many live Bun services.

Final report (concise): files written, smoke test result (paste the PASS/FAIL lines), mismatches found in other chunks, anything you are unsure about.
