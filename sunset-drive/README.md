# Sunset Drive v2

Single-file open-city game (three.js r170, every model, animation and texture embedded). Open `index.html` in Chrome / Safari (needs internet for three.js from jsDelivr).

## What changed from v1
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
`WASD` move · `Shift` sprint · `Space` jump · mouse look · `LMB` fire · `RMB` aim · `R` reload · `Tab` (hold) weapon wheel · `1`–`6` weapons · `Q` / mouse wheel next weapon · `G` grenade · `V` 1st/3rd person · `F` enter/exit car · `H` horn · `C` look back · `Esc` menu
