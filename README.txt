Dusk Protocol - Hospital Annex (split build) + Evil Nun enemy

index.html            the game - open this
assets/models/        3D models (GLB data, base64)       *.js
  questglb.js         exit door, bed, planks, key, hammer
  flashglb.js         first-person arm + flashlight (converted from Flashlight_Idle.blend)
  evilnun.js          the Evil Nun enemy (evil_nun.glb as base64, loaded by index.html)
  evil_nun.glb        original source model (kept for editing; the game reads evilnun.js)
assets/data/          level, characters, animations, kit  *.js
assets/textures/      material textures                  mtex.js
assets/audio/         sound effects + footsteps          sfxpack.js

Keep this folder structure exactly as it is. Works on GitHub Pages / any web server and
when opened as a normal file from a folder. It cannot run if only index.html is opened
(app file previews, content:// links) - the page then says the assets folder is missing.
three.js still loads from cdn.jsdelivr.net, so the first load needs internet.

DIFFICULTY (main menu, one tap starts the game)
- Practice: no nun, explore the map.   - Easy: 5 days, slower nun with weaker senses.
- Hard: 4 days (default).               - Extreme: 3 days, faster nun, sharper senses.
- Nightmare: 1 day, fastest nun, checks lockers often.

HOW TO WIN
- You wake up in your hospital bed (ward room, ground floor). You have 4 days.
- Find the HAMMER (on a workbench in one of the rooms), go to the EMERGENCY EXIT room in the
  south-west corner of the lobby and pull the 4 nails out of the 2 planks nailed across the steel exit door.
- Find the EXIT KEY (always in one of the records-room drawers).
- Carrying: the item is held in your right hand (the torch moves to your left hand). ONE item at a time: DROP (G / Q, or the DROP button) before picking up another.
- Unlock the door and escape: cinematic run into the forest, the nun watching from the doorway,
  then the credits (Made by Mohammed).
- If the nun catches you, the day ends and you wake up in bed again; whatever you were
  holding drops where she caught you. Caught on Day 4 = game over.
- Hide in the metal lockers (every room, corridors and the basement): you look out through
  the slits. If she saw you get in she pulls you out; otherwise she may still check while searching.
- Progress is saved automatically (also when the app is minimised). "Continue" on the main menu.

EVIL NUN (enemy AI)
- Uses only evil_nun.glb and its own animation clips: walk, walk_fast, run, attack, hit_wall,
  idle_pray (stunned), idle_look. Scaled to ~1.8 m.
- Walks a fixed patrol loop through every room of the ground floor, annex and basement and
  never stops: doors in her way are opened before she reaches them.
- Navigation grids are built from the real collision of each floor; the staircase links the
  ground floor and the basement, so she follows you downstairs. Anti-stuck recovery included.
- Sight (vision cone + line of sight; torch / lamps / crouching matter) and hearing (footsteps,
  doors, planks being hit, falling objects, gunshots). When she half-notices you she turns and
  walks toward you; when she is sure she runs.
- One hammer blow kills. Two jumpscare screens: blood splatter or shattered/glitched screen.
- Bullets only stun her.

SOUND
- assets/audio/nunsfx.js: 4 jumpscare clips cut from "Evil Nun jumpscare evolution", the horror
  hit (played when she spots you) and the suspense riser (chase start / escape).
- Procedural chase music while she hunts you, 3D positional footsteps/breath/voice, heartbeat.

PARANORMAL EVENTS (random, with cooldowns, never the same event twice in a row)
distant ghost, dark silhouette, shadow crossing the corridor, light flicker, power failure
with red emergency light, doors opening/slamming by themselves, rolling wheelchairs,
falling objects, unexplained footsteps behind you, whispers behind you, a figure that
appears behind you when you turn around, distant knocks/cries/radio.

Fixes to the original build: the handheld torch model (torchglb.js) had broken image
buffer views and never loaded; hospital doors had an uninitialised swing direction after
Start (invisible / non-solid until touched); "Resume" after pausing/minimising restarted
the whole game (wave counter was always 0).

New models (assets/models/questglb.js, textures resized for mobile): worn steel door,
hospital bed, wood planks pack, door key, hammer.

Credits: "Evil Nun" 3D model by Mr.Prizz (https://sketchfab.com/Rodolfoisreal1423),
licence CC BY 4.0 (http://creativecommons.org/licenses/by/4.0/).

"Unity 5 - Flashlight with Hand" (Blend Swap #88445) by Giovanni Cartella (John's Art),
licence CC BY-SA 3.0. Converted to glTF with Blender 4.0, materials recoloured; the
converted model (assets/source/flashlight_with_hand.glb, assets/models/flashglb.js) is
shared under the same CC BY-SA 3.0 licence.

"Metal Locker" by Teslov (https://sketchfab.com/Teslov), licence CC BY 4.0
(https://sketchfab.com/3d-models/metal-locker-1807cfeea89c4a57997cbe5fce569b53). The uploaded mesh is a
single solid block, so the in-game lockers are built as real hollow geometry in the same size and
style (hinged door with see-through slits at eye level, louvres, handle); the player can look around
inside.


Forest (escape cinematic) props, all CC BY 4.0 on Sketchfab: "Pine Tree" by EmreAlkan
(reduced for phones; far trees are flat impostors rendered from it), "Grass_green" by
nikitadyachik05, "Grass" by Cosmic_dust, "Low poly Stones" by rakutin.


Latest round: only the flashlight model's own hand is shown (no extra procedural hand); held hammer/key are shown big at the right like in Granny, torch at the left. Corridor lockers restored (5-7 hide spots). Hammer now sits on the nearest workbench to the start bed. Applying graphics settings no longer deletes rooms or the exit room (world is fully reset before rebuild). New setting: Motion blur 0-60% (camera-based, 9-tap). Better drop/pickup physics. Escape cinematic: real night fog that blends the forest, player runs straight out, turns back, camera zooms on the nun who walks to the door and stares, then credits.

Round 3: lockers are one clean slab (no joints) with six see-through slits, no top vents or black tag; they are no longer placed inside rooms (corridors/lobby/basement only). The dark hand-rail strips along the corridor walls are removed. Hammer is held upright like the reference (head on top) and lies flat on the workbench. Fixed: exit door disappeared after applying graphics (quest assets are now cloned on every world rebuild). Escape: no night picture behind the door, planks hidden, real low-poly 3D pines blending into bluer fog, 46 s watchdog so the cinematic can never hang.
