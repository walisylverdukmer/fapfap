// Script de génération des icônes PNG pour la PWA
// Usage : node generate-icons.js
// Nécessite : npm install canvas  (dans le dossier racine)

const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

const outDir = path.join(__dirname, 'client', 'icons');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

function drawIcon(size) {
    const canvas = createCanvas(size, size);
    const ctx    = canvas.getContext('2d');
    const r      = size * 0.175; // rayon des coins

    // Fond vert foncé avec coins arrondis
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(size - r, 0);
    ctx.quadraticCurveTo(size, 0, size, r);
    ctx.lineTo(size, size - r);
    ctx.quadraticCurveTo(size, size, size - r, size);
    ctx.lineTo(r, size);
    ctx.quadraticCurveTo(0, size, 0, size - r);
    ctx.lineTo(0, r);
    ctx.quadraticCurveTo(0, 0, r, 0);
    ctx.closePath();
    ctx.fillStyle = '#052c17';
    ctx.fill();

    // Feutrine intérieure
    const pad = size * 0.04;
    ctx.beginPath();
    const ir = r * 0.85;
    ctx.moveTo(pad + ir, pad);
    ctx.lineTo(size - pad - ir, pad);
    ctx.quadraticCurveTo(size - pad, pad, size - pad, pad + ir);
    ctx.lineTo(size - pad, size - pad - ir);
    ctx.quadraticCurveTo(size - pad, size - pad, size - pad - ir, size - pad);
    ctx.lineTo(pad + ir, size - pad);
    ctx.quadraticCurveTo(pad, size - pad, pad, size - pad - ir);
    ctx.lineTo(pad, pad + ir);
    ctx.quadraticCurveTo(pad, pad, pad + ir, pad);
    ctx.closePath();
    ctx.fillStyle = '#0a5c2f';
    ctx.fill();

    // Bordure or
    ctx.strokeStyle = '#d4af37';
    ctx.lineWidth   = size * 0.016;
    ctx.stroke();

    // Pique ♠
    ctx.fillStyle  = '#d4af37';
    ctx.font       = `bold ${Math.round(size * 0.52)}px serif`;
    ctx.textAlign  = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('♠', size / 2, size * 0.44);

    // Texte FAP FAP
    ctx.font      = `bold ${Math.round(size * 0.13)}px sans-serif`;
    ctx.letterSpacing = `${size * 0.008}px`;
    ctx.fillText('FAP FAP', size / 2, size * 0.83);

    return canvas;
}

[192, 512].forEach(size => {
    const canvas = drawIcon(size);
    const buf    = canvas.toBuffer('image/png');
    const file   = path.join(outDir, `icon-${size}.png`);
    fs.writeFileSync(file, buf);
    console.log(`✅ ${file} généré (${size}×${size})`);
});
