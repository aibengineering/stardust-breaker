You are implementing chunk B of a small browser game, "Stardust Breaker" (asteroid shooter with upgrades), in /home/ben/me/code/2610_asteroid_shooter.

FIRST read /home/ben/me/code/2610_asteroid_shooter/BRIEF.md fully. It is the contract: module interfaces, colours, units, rules. Other agents are writing the other files in parallel against the same contract, so match the interfaces in the "entities.js (B)" and "audio.js (B)" sections EXACTLY (export names, parameter order, object field names).

Your files (create only these; do not touch any other file):
- site/js/entities.js
- site/js/audio.js

Requirements beyond the brief:
- Plain JS ES modules, no dependencies, no imports from other project files.
- Canvas 2D drawing in CSS pixels; every draw function must leave ctx state as it found it (use save/restore) and must reset shadowBlur.
- Wrap-around: when an object straddles an edge it is fine to draw it only once (no need for ghost copies).
- Make it look good: neon glow on the ship and bullets, jagged asteroid polygons stable per asteroid (shape generated once in createAsteroid), a flickering thrust flame, sparkly particle bursts, shield rings, pulsing green gems, little missile trails (store a short trail array on the missile).
- Performance: up to ~80 asteroids, 200 bullets, 300 gems, 600 particles at 60 fps on a phone. Avoid per-object shadowBlur in big loops (set it once per batch). Do not allocate inside hot loops more than necessary.
- updateParticles must remove dead particles IN PLACE from the same array (the game keeps a reference to it).
- audio.js: lazily create the AudioContext in unlock(); every method is a no-op before unlock or when muted, wrapped so it can never throw. Generate a white-noise AudioBuffer once and reuse it for explosions. Sounds should be pleasant, not harsh: soft square/triangle blips for shoot, a downward noise "thump" scaled by size for explode, a bright two-note arpeggio for levelUp, a sine "ding" for pickup that rises in pitch with successive pickups. audio.js must also be importable in a non-browser environment without throwing (guard `window`/`localStorage` access).
- Verify both files parse: `cd /home/ben/me/code/2610_asteroid_shooter && bun build --no-bundle site/js/entities.js >/dev/null && bun build --no-bundle site/js/audio.js >/dev/null && echo OK`.
- Write a quick throwaway sanity check in /tmp (NOT in the project) that imports entities.js with bun and exercises createShip/updateShip (with a fake input, both keyboard and stick), createAsteroid/splitAsteroid, createBullet/updateBullet, createGem/updateGem, createMissile/updateMissile, burst/ring/updateParticles, orbitalPositions, createStars, and asserts the field names from the brief exist and numbers stay finite. Run it, fix any problem, then delete it. Do not start any servers.

Final report (concise): files written, the exact export list of both files, and any deviations or concerns about the contract.
