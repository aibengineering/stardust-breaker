You are implementing chunk C of a small browser game, "Stardust Breaker" (asteroid shooter with roguelite upgrades), in /home/ben/me/code/2610_asteroid_shooter.

FIRST read /home/ben/me/code/2610_asteroid_shooter/BRIEF.md fully. It is the contract. Other agents are writing the other files in parallel against it, so match the "upgrades.js (C)" section EXACTLY: export names (baseStats, UPGRADES, rollChoices, applyUpgrade, getUpgrade, xpForLevel), the stat field names in baseStats, the upgrade ids, and the def shape { id, name, icon, rarity, maxLevel, desc(nextLevel), apply(stats, game) }.

Your file (create only this; do not touch any other file):
- site/js/upgrades.js

Requirements beyond the brief:
- Plain JS ES module, no imports.
- desc(nextLevel) returns a short, concrete, player-friendly string specific to that level (e.g. Orbital Blades level 1 "A blade orbits your ship", level 3 "+1 blade, blades hit harder"; Nova Pulse level 1 "Every 7s, a shockwave blasts nearby rocks"). Keep under ~50 characters.
- apply must guard `game` being null/undefined and `game.ship` missing.
- rollChoices: weighted sampling WITHOUT replacement (common 60, rare 30, epic 12), skip upgrades at maxLevel, use the passed rng.
- applyUpgrade must not let a level exceed maxLevel (throw or ignore; your choice, document it in a one-line comment).
- Verify with a throwaway test in /tmp (NOT in the project) run with bun: baseStats returns a fresh object each call; every id in the brief's table exists exactly once; applying every upgrade up to maxLevel on a stats object keeps all numbers finite and positive where expected; rollChoices returns distinct ids, never maxed ones, returns [] when everything is maxed, and works with a seeded rng; xpForLevel(1..20) is increasing. Run it, fix issues, delete the test. Also run `bun build --no-bundle /home/ben/me/code/2610_asteroid_shooter/site/js/upgrades.js >/dev/null && echo OK`. Do not start any servers.

Final report (concise): file written, exports, the upgrade list with rarities and max levels, any concerns.
