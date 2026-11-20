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

HOW TO WIN
- You wake up in your hospital bed (ward room, ground floor). You have 4 days.
- Find the HAMMER (random room, can be in the basement), go to the EMERGENCY EXIT room in the
  south-west corner of the lobby and smash the 2 planks nailed across the steel exit door.
- Find the EXIT KEY (random drawer in the records room or a storage cabinet in the annex).
- Unlock the door and escape.
- If the nun catches you, the day ends and you wake up in bed again; whatever you were
  holding drops where she caught you. Caught on Day 4 = game over.
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
