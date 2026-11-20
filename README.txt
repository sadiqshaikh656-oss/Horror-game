Dusk Protocol - Hospital Annex (split build) + Evil Nun enemy

index.html            the game - open this
assets/models/        3D models (GLB data, base64)       *.js
  evilnun.js          the Evil Nun enemy (evil_nun.glb as base64, loaded by index.html)
  evil_nun.glb        original source model (kept for editing; the game reads evilnun.js)
assets/data/          level, characters, animations, kit  *.js
assets/textures/      material textures                  mtex.js
assets/audio/         sound effects + footsteps          sfxpack.js

Keep this folder structure exactly as it is. Works on GitHub Pages / any web server and
when opened as a normal file from a folder. It cannot run if only index.html is opened
(app file previews, content:// links) - the page then says the assets folder is missing.
three.js still loads from cdn.jsdelivr.net, so the first load needs internet.

EVIL NUN (enemy AI)
- Uses only evil_nun.glb and its own animation clips: idle1/2/3, idle_look, look_around,
  walk, walk_fast, run, attack, open (doors), look_fire (scream on spotting you),
  hit_wall + idle_pray (stunned). Scaled to ~1.8 m.
- Patrols the ground floor on the hospital nav grid, opens doors in her way, never walks
  through walls/doors (same collision as the player).
- Sight: vision cone + line of sight; farther when your torch is on or you stand under a lamp,
  shorter when crouched in the dark. Shining the torch at her gives you away.
- Hearing: running/walking footsteps, landing, doors you use, dropped guns, falling objects,
  doors slamming and gunshots (very loud).
- Chases, keeps tracking you for a moment after you break line of sight, then goes to the
  last known position and searches nearby rooms and corners before returning to patrol.
- Hammer attack ~30-38 damage; when your HP reaches 0 she catches you (jumpscare).
- Shooting her only stuns her for a few seconds.
- 3D positional audio: footsteps, breathing, whispers, moans, screams; heartbeat and colour
  grading react to how close she is.

PARANORMAL EVENTS (random, with cooldowns, never the same event twice in a row)
distant ghost, dark silhouette, shadow crossing the corridor, light flicker, power failure
with red emergency light, doors opening/slamming by themselves, rolling wheelchairs,
falling objects, unexplained footsteps behind you, whispers behind you, a figure that
appears behind you when you turn around, distant knocks/cries/radio.

Fixes to the original build: the handheld torch model (torchglb.js) had broken image
buffer views and never loaded; hospital doors had an uninitialised swing direction after
Start (invisible / non-solid until touched).

Credits: "Evil Nun" 3D model by Mr.Prizz (https://sketchfab.com/Rodolfoisreal1423),
licence CC BY 4.0 (http://creativecommons.org/licenses/by/4.0/).
