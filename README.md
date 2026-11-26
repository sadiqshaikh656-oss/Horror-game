# Ironyard: Tactical Ops

> **Third-person player:** you play Michael (`assets/models/michael.glb`) with an MP5 (`assets/models/mp5.glb`), seen from over the right shoulder. `js/tpsplayer.js` retargets the 43 Mixamo clips of the hidden Ch15 rig onto Michael's GTA-style `SKEL_*` skeleton every frame, fingers included. The MP5 is parented to his right hand with the pistol grip in his fist, and two-bone IK keeps his left hand wrapped on the handguard (it lets go during reloads). The camera pulls in when it hits a wall and moves closer while aiming. The loadout uses SMG stats (`WEAPONS.smg`, shown as MP5).
>
> Asset credits: "GTA V - Michael De Santa (2025)" by Zorg_Sinister on Sketchfab, licensed CC-BY-4.0. The MP5 model was supplied without license metadata. `tools/prep-mp5.mjs` strips its backdrop, lights and cameras and rescales it, then `gltf-transform optimize --compress meshopt --texture-compress webp --texture-size 1024 --simplify false` compresses both models.

> **First-person body:** you play the Ch15 operator (Mixamo rig) and see your own animated body and the M4 in its hands. `js/fpsbody.js` drives 43 Mixamo clips (8-way walk/run/crouch-walk, sprint, aim and relaxed idles, fire, reload, jump up/loop/land, run-to-stop, 6 directional deaths), with left-hand IK on the handguard and IK aim-down-sights. The `Viewmodels` class still runs invisibly as the weapon system (ammo, fire rate, spread, recoil, reload timing). The map has no clutter props and a clean concrete ground.

A mobile-first browser FPS built with Three.js. It runs on phones (touch controls, landscape) and on desktop (keyboard + mouse).

## Run it

The game is a set of static files, but browsers block loading ES modules and `.glb` models from `file://`, so serve the folder over http:

```bash
python3 -m http.server 8000
# open http://localhost:8000 on this machine, or http://<your-LAN-IP>:8000 on a phone on the same Wi-Fi
```

For a public link, enable **GitHub Pages** for this repository (Settings → Pages → deploy from branch). Fullscreen and landscape lock need https, which Pages provides.

## What's in it

**Weapons (first-person arms + gun models)**: M4 Carbine (scoped AR), MP45 SMG and P92 Pistol.
- Each GLB has a single baked animation timeline. `js/weapons.js` splits it into clips by time range: draw, holster, fire, tactical reload, empty reload (with bolt/slide), inspect and idle.
- Procedural layers run on top of the clips: walk bob (figure-eight), a separate **sprint** pose and cycle, aim-down-sights with live sight alignment, recoil springs, look sway, strafe roll, landing dip, crouch offset and breathing.
- Recoil climbs in a CS-style pattern and partly recovers like PUBG. Spread blooms while you fire, so firing on the move is less accurate. A muzzle flash lights the hands, shells eject using the casing models from the dungeon pack, and there are tracers, impacts and decals.

**Enemies**: the trooper model ships unrigged, so `js/enemies.js` builds a skeleton and skin weights in code. Two-bone IK puts the hands on a rifle made from the carbine parts. The soldiers walk and run, aim up and down, flinch when hit and fall when killed. Head, torso and legs are separate hitboxes with damage multipliers. The AI patrols on an A* grid, reacts to sight and to gunfire, strafes while firing in bursts and searches the last place it saw you.

**Map**: a container depot built from the containers/barrels pack and the dungeon props (crates, barrels, chests, tables, health and ammo boxes). It has jersey barriers, raised platforms with stairs, cranes and background buildings, and wooden crates you can destroy on Ultra and Cinematic.

**Mode**: CS-style elimination over 10 rounds. Each round brings more enemies and better aim. Health and ammo pickups respawn.

**UI**: compass, rotating radar minimap, round bar with timer, kill feed with headshot icons, dynamic crosshair, hit and kill markers, damage-direction arcs, health and armor bars, weapon slots, an ammo panel with a reload ring and a scoreboard.

## Graphics settings

Presets: **Low / Medium / High / Ultra / Cinematic**. Every option can also be set on its own:

| Option | Levels |
|---|---|
| Frame Rate | 30 / 60 / 90 / 120 / Max |
| Render Resolution | 50–125 % |
| Shadow Quality | Off → Ultra (4096 soft shadows) |
| Anti-Aliasing | Off / FXAA / SMAA / MSAA 4x |
| Ambient Occlusion | Off / GTAO / GTAO High |
| Reflections | Off / Environment (IBL) / Planar wet-ground / Planar Ultra |
| Texture Quality | Low → Ultra (texture resolution and anisotropic filtering) |
| Prop Quality | how many props are placed (barrels, furniture, lamps with lights, cranes, skyline) |
| Prop Structure | prop shadows, decal count, shell lifetime, destructible crates |
| View Distance, Effects, Bloom, Post Processing (filmic grade, grain, chromatic aberration), Sun Lens Flare, Show FPS | |

Lighting comes from a physically based sky. It is used for image-based lighting (PMREM) and for the sun's shadows, which follow the player.

## Mobile HUD

- **FIRE** (red, right side, plus an optional left FIRE): hold to fire. Automatic weapons keep firing while held, and the pistol repeats at a controlled rate. Firing stops the moment you lift your finger. Each shot uses one round, shows a muzzle flash and recoil, plays the gunshot sound, and sends a visible bullet tracer to the crosshair point. Hits on head, body and legs do different damage. Dragging on the FIRE button also turns the camera.
- **CROUCH**: tap to crouch, tap again to stand. Height, camera and speed change smoothly. You stay crouched if there is no room to stand.
- **JUMP**: a normal jump with gravity and collisions. Near a container, crate, barrier or other ledge up to about 2.4 m, the button turns into **CLIMB** and pulls you up on top. You can climb onto every container.
- **AIM**: toggles aim-down-sights and zoom. **RELOAD**: reloads the current weapon. **SPRINT**: toggles sprint, and runs forward on its own if you aren't touching the stick. **Weapon slots**: tap to switch guns. **PAUSE** and **SCORES**.
- **Move stick**: has a fixed home position, or floats to wherever you touch on the left side. Push it past the top to lock sprint.

**HUD layout editor**: open it from Lobby → HUD LAYOUT, Pause → CUSTOMIZE HUD, or Settings → Controls.
- Drag any control to move it, including the stick, the FIRE button and the weapon slots.
- Tap a control, then use the sliders to change its size and opacity.
- If a drop would overlap another control or the minimap, score bar or health bar, the control moves back.
- RESET restores the default layout. SAVE 1–3 and LOAD 1–3 store and recall layouts. SAVE & EXIT keeps the layout permanently (localStorage, the same storage as the other settings).
- Positions are stored as fractions of the screen, and sizes scale with screen height, so a layout adapts to any Android screen. On very small screens, an automatic pass pushes apart any controls that would overlap.

## Controls

**Touch**
- Left side: floating joystick. Push it past the top to lock sprint.
- Right side: drag to look.
- The fire buttons also steer while held, and the left fire button can be turned off.
- Buttons: ADS, jump, crouch, reload, inspect, weapon slots, scoreboard and pause.

**Desktop**
- WASD to move, Shift to sprint, Space to jump (or climb near a ledge), C to crouch.
- Left mouse to fire, right mouse to aim.
- R reload, F inspect, 1/2/3 or the mouse wheel to switch weapons.
- Tab for the scoreboard, Esc to pause.

## Project layout

```
index.html, css/style.css   UI shell and styling
js/main.js                  bootstrap, game loop, rounds, hit resolution
js/weapons.js               viewmodels, clip table, procedural animation, weapon stats
js/enemies.js               procedural rig, IK pose, AI, hitboxes
js/world.js                 map, sky/IBL/sun, wet-ground reflections, colliders, nav grid
js/graphics.js              render pipeline and post-processing
js/effects.js               particles, tracers, decals, shells, debris
js/player.js, js/input.js   movement, collision, touch, keyboard and mouse
js/ui.js, js/settings.js    HUD, menus, settings and presets
js/hudlayout.js             touch control layout, persistence and the HUD editor
js/audio.js                 synthesized sound (no audio files)
assets/models/*.glb         your models, compressed (meshopt + WebP, about 140 MB → 4.6 MB)
lib/three/                  vendored three.js r170
tools/animview.html         dev tool for sampling a GLB animation timeline
```

## Single-file version

`dist/ironyard.html` is the whole game in one file (code, three.js and models inlined, 7 MB). It opens by double-click with no server, and it can be copied to a phone and opened in Chrome. Rebuild it with `npm i esbuild && node tools/build-single.mjs`.

## SWAT Operator: retarget-ready T-pose export

`models-export/SWAT_Operator_TPose_Mixamo.glb` (28 MB, original textures) is the SWAT Operator model converted for retargeting (Mesh2Motion, Mixamo-style tools). It is not used by the game yet.

- **T-pose** rest pose (arms horizontal, legs straight). The mesh is re-baked, so rest pose = bind pose.
- **Mixamo bone names** (`mixamorig:Hips` … `mixamorig:RightHandPinky4`), 65 joints, with `mixamorig:Hips` as the skeleton root under an `Armature` node.
- **The rifle is part of the skin**, weighted 100% to `mixamorig:RightHand`. In the source file the rifle wasn't attached to any bone, so it floated or sank into the body when other animations were applied. The two cloth patches are skinned to their bones the same way.
- The grip offset and finger curl come from the artist's original "holding the rifle" frame, so the gun sits correctly in the hand. In T-pose the barrel lines up with the forearm, as it does in a real grip; a rifle animation brings it forward.
- The source's single baked animation is removed.

Rebuild it with `node tools/swat-tpose.mjs <source.glb> <out.glb> [pose.json]` (needs `@gltf-transform/core`, `@gltf-transform/extensions` and `three`). `tools/rigview.html?f=<glb>&posefile=tools/swat_rifle_pose.json` previews the export with the original rifle-holding pose applied.

### Rifle animations with a proper grip

`models-export/SWAT_Operator_Rifle_Animations.glb` (28 MB) is the same T-pose character plus five rifle clips: **Rifle_Fire, Rifle_Idle, Rifle_Reload, Rifle_Run and Rifle_Walk**. They come from the Mesh2Motion retarget of that rig, with the rifle grip corrected on every frame (30 fps):

- Mesh2Motion's retarget changes the right-hand angle by 20–40° between clips and makes the left arm too short for the handguard. No single gun position in the hand can look right in all clips, so the clips themselves are corrected.
- **Right wrist** (about 35% of the change goes into the forearm) is re-aimed so the barrel has the right pitch for each clip (Fire 0°, Walk −5°, Run −28°, Reload −25°, Idle −38°). It keeps the clip's own heading, and the optic stays up. Correction is at most 23°.
- **Left hand** is locked to the handguard with two-bone IK, using the artist's own left-hand grip. If the arm can't reach, the grip slides back along the handguard (up to 22 cm). During the reload's magazine swap the lock fades out automatically.
- **Fingers** keep the gripping curl of the rest pose.
- Preview: `models-export/SWAT_Operator_Rifle_Animations_preview.png`.

Pipeline: `tools/fixanims.html?rig=<T-pose glb>&anim=<retargeted glb>&grip=<grip json>` bakes the corrected keyframes, and `node tools/add-anims.mjs <rig.glb> <keys.json> <out.glb>` writes them into the full-quality GLB. `tools/fitgrip.html` and `tools/m2mview.html` are the measurement and preview tools. The grip JSON comes from `DUMP_GRIP=<file> node tools/swat-tpose.mjs …`.

## Player animations (Mixamo → Ch15)

The Mixamo FBX packs (Rifle 8-Way Locomotion, Shooter Pack, Running To Stop) are retargeted onto the Ch15 rig and baked into `assets/models/player.glb`:

1. `tools/retarget.html?target=<ch15 glb>` (job list in the runner) does rest-pose-relative retargeting at 30 fps and produces the keyframes JSON.
2. `tools/fitgrip.html` fits the M4 inside `mixamorig:RightHand` to the rifle clips (right palm on the grip, left palm on the handguard, aim clips pointing forward, optic up).
3. `node tools/build-player.mjs <Ch15_player_source.glb> <SWAT T-pose glb> <swat grip json> <ch15 grip json> <keys json> <out.glb>` assembles Ch15, the M4 and all the clips. Then run `gltf-transform optimize` (WebP and meshopt).

The Ch15 source model (from your build) is kept at `models-export/Ch15_player_source.glb`.
