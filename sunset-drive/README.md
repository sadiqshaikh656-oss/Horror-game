# Sunset Drive v3

Single-file open-city game (three.js r170, every model, animation and texture embedded). Open `index.html` in Chrome / Safari (needs internet for three.js from jsDelivr).

## What changed in v3
- **Weapon icons are renders of the real in-game 3D models** (Glock, M4, M4 with scope, grenade), made at load time with lighting and a soft shadow. Unarmed is a render of the character's own right hand closed into a fist. Empty slots say EMPTY.
- The grenade is now a frag grenade model (body, fuse cap, spoon and pin ring) in the hand, when thrown, and in its icon.
- **Map about 10x bigger**: 35×35 blocks (was 11×11) and 22 stunt ramps. The city is split into tiles; far tiles are not drawn, and far palms are cheap image stand-ins rendered from the 3D palm.
- **Ocean and beach instead of mountains**: sand slopes from the city edge into an animated, reflective sea, with a foam line, palms, umbrellas and towels. You can walk and drive on the sand.
- **In the car**: the driver now sits lower and further inside the cab, so the head no longer pokes through the roof and the arms stay inside the door.
- **1st-person aim**: the chest turns so the gun points exactly at the crosshair, and the eye sits on the sights (front sight on the crosshair for rifle and pistol).
- **Smoother driving**: steering ramps in and out instead of snapping, softer yaw response, and the player's car runs physics in sub-steps when the frame rate drops.
- **GTA-style walk**: the body leans into turns when running and forward when sprinting, turns follow wider arcs at speed, and `Alt` walks.
- **Weapon wheel**: time slows to 10%, the screen desaturates and blurs, it works in the car too, and touch has a wheel button (tap, then tap a weapon).
- Parked cars are moved from far away to streets near the player, so the big city doesn't feel empty.

## What changed in v2
- **Animation glitch fixed**: aiming no longer bends the character over. three.js's mixer only rewrites a bone when its keyed value changes, so the old spine-aim offset piled up every frame. Procedural bone offsets are now undone before the mixer runs.
- **Smooth, synced animation**: legs and arms share one walk/run phase; idle/walk/run are weight-blended by speed (no pops); upper body (aim, reload, draw) layers over the legs; strafing twists the hips while the chest keeps aiming; momentum on movement.
- **Car enter/exit**: the character walks around the car to the driver door and the enter clip starts from where the character stands (no teleport into the car).
- **1st and 3rd person** (`V` or the eye button): 1st person uses the character's eyes, shows the hands and gun, iron-sight aiming for pistol and rifle; works when driving too (cockpit view).
- **Shooting**: recoil kick that mostly recovers, spread bloom, crosshair that grows with spread and turns red over a target, hit markers, headshots, muzzle light, casings, per-weapon sound.
- **Weapon wheel** (hold `Tab` / hold the weapon card on touch): 8 slots with slow motion while open: Unarmed, Pistol, AP Pistol, Carbine Rifle, Sniper Rifle (scope), Grenades, empty Shotgun and Heavy slots.
- **Pedestrians** walk the sidewalks, flee from gunfire and speeding cars and can be shot or run over.
- **Bigger map**: 11×11 blocks (was 7×7): downtown towers, mid-rise ring, suburbs with houses, garages, lawns, driveways, hedges and fences, 6 stunt ramps.
- **Controls**: redesigned touch icons and a layout tuned for short landscape phones; car HUD speedo moved clear of the pedals.
- **Car camera**: higher chase camera that follows the direction of travel; `C` looks back.

## Keys
`WASD` move · `Alt` walk · `Shift` sprint · `Space` jump · mouse look · `LMB` fire · `RMB` aim · `R` reload · `Tab` (hold) weapon wheel · `1`–`6` weapons · `Q` / mouse wheel next weapon · `G` grenade · `V` 1st/3rd person · `F` enter/exit car · `H` horn · `C` look back · `Esc` menu
