You are implementing chunk A of a small browser game, "Stardust Breaker" (asteroid shooter with upgrades), in /home/ben/me/code/2610_asteroid_shooter.

FIRST read /home/ben/me/code/2610_asteroid_shooter/BRIEF.md fully. It is the contract: module interfaces, DOM ids, colours, rules. Other agents are writing the other files in parallel against the same contract, so match the interfaces EXACTLY (export names, argument shapes, DOM ids, class names).

Your files (create only these; do not touch any other file):
- server.ts
- asteroid-shooter.service
- package.json
- site/index.html
- site/style.css
- site/js/ui.js
- site/js/input.js

Requirements beyond the brief:
- index.html loads `<script type="module" src="js/main.js"></script>` (main.js is written by someone else later) and `<link rel="stylesheet" href="style.css">`. Use relative paths.
- Make it look polished and arcade-y: neon cyan/magenta accents on deep navy (#070b1a), glowing title text, rounded translucent panels with backdrop blur, big thumb-friendly buttons. Phone first (390x844), fine on desktop.
- HUD must not cover much of the play area: a slim top bar (respect env(safe-area-inset-top)). The XP bar is a thin full-width bar.
- Title screen: big "STARDUST BREAKER" title, a short how-to line (e.g. "Drag anywhere to steer · ship fires automatically · collect green stardust to level up" and "Desktop: arrows/WASD, P to pause"), best score, big PLAY button.
- Game over screen: show the stats and the upgrades taken as small icon chips (icon + name + "Lv n").
- Overlays use the `hidden` attribute. Make sure your CSS does not override it (e.g. `[hidden]{display:none!important}`), since you will likely give overlays `display:flex`.
- Overlays must not block the canvas's pointer events while hidden; the HUD must not swallow the joystick drag (pointer-events:none on the HUD except its buttons).
- ui.js must not import any other project module. input.js must not import any other project module.
- Plain JS, no dependencies, no build step, no external fonts/CDNs.
- Verify your JS parses: run `cd /home/ben/me/code/2610_asteroid_shooter && for f in site/js/ui.js site/js/input.js; do bun build --no-bundle "$f" > /dev/null || echo "FAIL $f"; done` and `bun build --no-bundle server.ts >/dev/null`.
- Test the server briefly: start it on port 8789 in the background with `PORT=8789 bun server.ts & echo $! > /tmp/sb_a.pid`, curl `/`, `/style.css`, `/js/ui.js`, and `/../BRIEF.md` (must 404), then stop ONLY your own process with `kill $(cat /tmp/sb_a.pid)`. NEVER use pkill/killall or kill other processes: this machine runs many other live Bun services. Do NOT install or enable the systemd service.

Final report (concise): files written, the exact exports of ui.js and input.js, and any concerns about the contract.
