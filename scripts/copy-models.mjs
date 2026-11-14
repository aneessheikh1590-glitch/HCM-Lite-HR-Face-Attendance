// Copies the pretrained face-api model files shipped inside the npm package to public/models (served at /models).
import fs from 'node:fs';
import path from 'node:path';
const src = path.resolve('node_modules/@vladmandic/face-api/model');
const dst = path.resolve('public/models');
const need = ['tiny_face_detector_model', 'face_landmark_68_model', 'face_recognition_model'];
if (!fs.existsSync(src)) {
  console.warn('[copy-models] @vladmandic/face-api not installed yet - skipping (run npm install).');
  process.exit(0);
}
fs.mkdirSync(dst, { recursive: true });
let n = 0;
for (const f of fs.readdirSync(src)) {
  if (need.some((p) => f.startsWith(p))) { fs.copyFileSync(path.join(src, f), path.join(dst, f)); n++; }
}
if (n < 6) { console.error(`[copy-models] expected model files missing (copied ${n}).`); process.exit(1); }
console.log(`[copy-models] copied ${n} model files to public/models`);
