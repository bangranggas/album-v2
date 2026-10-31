const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const outDir = path.join(__dirname, "..", "public", "icons");
fs.mkdirSync(outDir, { recursive: true });

// A "link" motif: a rounded background with a chain-link glyph.
function svg(size, { maskable }) {
  // Maskable icons need a safe zone: padding keeps the glyph inside the
  // inner 80% circle that the OS may crop to.
  const pad = maskable ? size * 0.18 : size * 0.1;
  const inner = size - pad * 2;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${maskable ? 0 : size * 0.18}" fill="#0f172a"/>
  <g transform="translate(${pad},${pad}) scale(${inner / 100})" fill="none" stroke="#f8fafc" stroke-width="9" stroke-linecap="round" stroke-linejoin="round">
    <path d="M42 58 L58 42"/>
    <path d="M36 64 a13 13 0 0 1 0-18 l10-10 a13 13 0 0 1 18 0"/>
    <path d="M64 36 a13 13 0 0 1 0 18 l-10 10 a13 13 0 0 1-18 0"/>
  </g>
</svg>`);
}

(async () => {
  await sharp(svg(192, { maskable: false })).png().toFile(path.join(outDir, "icon-192.png"));
  await sharp(svg(512, { maskable: false })).png().toFile(path.join(outDir, "icon-512.png"));
  await sharp(svg(512, { maskable: true })).png().toFile(path.join(outDir, "maskable-512.png"));
  console.log("icons written");
})();
