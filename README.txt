Dusk Protocol - Hospital Annex (split build)

index.html            the game (0.29 MB) - open this
assets/models/        3D models (GLB data, base64)       *.js
assets/data/          level, characters, animations, kit  *.js
assets/textures/      material textures                  mtex.js
assets/audio/         sound effects + footsteps          sfxpack.js

Keep this folder structure exactly as it is. Works on GitHub Pages / any web server and
when opened as a normal file from a folder. It cannot run if only index.html is opened
(app file previews, content:// links) - the page then says the assets folder is missing.
three.js still loads from cdn.jsdelivr.net, so the first load needs internet.
