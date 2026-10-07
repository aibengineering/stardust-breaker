You are chunk U, the v2 integration chunk of a browser game, "Stardust Breaker", in /home/ben/me/code/2610_asteroid_shooter.

FIRST read BRIEF.md in full (the v2 contract). Then read the modules other agents have ALREADY written, because you must call their real exports (if they differ from the brief, the real code wins; list every mismatch in your report):
- site/js/entities.js, site/js/overlay.js, site/js/upgrades.js, site/js/sectors.js, site/js/systems.js, site/js/bosses.js, site/js/weapons.js, site/js/ui.js, site/js/audio.js, site/js/input.js
- site/index.html (DOM ids)
- the CURRENT site/js/game.js (v1) — reuse its proven pieces (loop with try/catch, resize, compaction, level-up queue, death flow, debug hooks, best score) while rewriting it for v2
- tools/smoke.ts (the test your code must pass)

Your files (edit only these): site/js/game.js (rewrite for v2) and site/js/main.js (extend).

Implement everything in "THE GAME OBJECT and game.api" and "game.js + main.js (U)": states title/map/playing/upgrade/pause/victory/over, sector runs, waves → boss → victory → endless, camera + zoom + bounded arena, main gun (+ Prism lances, Railstorm rails), collisions with asteroids AND bosses, game.api, weapons/systems/bosses hooks, level-ups with pool/slots/evolutions/rerolls, progress (best per sector, clearSector), render order, HUD + boss bar, debug hooks (old + new), resize/pause/visibility.

Important details:
- api.damageAsteroid must use entities.rockRewards(a) for score/gems, split via splitAsteroid (respecting kind), then call weapons.onKill and system.onKill?. Never let a rock die twice (check a.dead first).
- api.hurtShip must respect invuln, debug invincibility and a dead ship; shield → weapons.onShieldBreak(game).
- Bosses: contact damage + strong knockback; bullets/pierce work on bosses (hitIds by id); the boss-defeated flow runs once.
- The title and map screens animate a backdrop (drifting rocks in a view-sized world, cam 0, zoom 1).
- Reset input stick (input.cancel?.()) when entering upgrade/pause/victory/over/map.
- Keep the frame loop alive on errors (catch, console.error once).
- XP gems: keep v1 magnet behaviour (updateGem) inside the bounded arena.
- On resize during a run, keep the arena but recompute view/zoom/stars and clamp the camera.

Testing (required):
1. `cd /home/ben/me/code/2610_asteroid_shooter && for f in site/js/*.js; do bun build --no-bundle $f >/dev/null || echo FAIL $f; done`
2. Start a private server and run the smoke test, then the showcase:
   `PORT=8799 bun server.ts > /tmp/sb_u.log 2>&1 & echo $! > /tmp/sb_u.pid; sleep 1; BASE=http://127.0.0.1:8799 bun tools/smoke.ts; BASE=http://127.0.0.1:8799 bun tools/showcase.ts; kill $(cat /tmp/sb_u.pid)`
   Fix problems in YOUR files until smoke passes fully with no console errors and showcase has no FAILs. If a failure is caused by another chunk's file, do not edit it: give the exact file, line and fix in your report.
3. Read the screenshots in tools/out/ (map, play, upgrade, boss, victory, every sector-*.png and boss-*.png, a few evo-*.png) and check they render correctly: camera follows the ship, border visible, arrows + radar visible, sector backdrops distinct, bosses visible with HP bar.
Server hygiene: stop ONLY your own server by its saved PID. NEVER use pkill/killall or kill any other process; this machine runs many live Bun services.

Final report (concise): what you built, smoke + showcase output (PASS/FAIL lines, FPS, balance summary), mismatches/bugs found in other chunks (file:line + suggested fix), and what the screenshots showed.
