// Mirrors PHOTO_SLOT in renderer/public/psir-generator/template-data.js (the
// petitioner's 2x2 picture, replaced into word/media/image1.jpeg inside the
// generated .docx) — kept in sync by hand since that generator is a
// separate, largely frozen embedded tool, and public/ assets can't be
// import()ed as JS modules from renderer/src code.
export const PSIR_PHOTO_SLOT = { path: 'word/media/image1.jpeg', w: 620, h: 624, mime: 'image/jpeg' };

// Scales+letterboxes a photo onto a white canvas at the slot's exact pixel
// size, same as the PSIR Generator's own pickMedia() does for a picture
// uploaded directly inside it — so a photo attached on Case Info/New Case
// prints in the PSIR's photo frame exactly the way a direct upload would,
// instead of however the source image happened to be cropped.
export function fitImageToSlot(dataUrl, { w, h, mime, quality = 0.92 } = PSIR_PHOTO_SLOT) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      const scale = Math.min(w / img.width, h / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
      resolve(canvas.toDataURL(mime, quality));
    };
    img.onerror = () => reject(new Error('Could not read that image.'));
    img.src = dataUrl;
  });
}

export function dataUrlToBase64(dataUrl) {
  return (dataUrl || '').split(',')[1] || '';
}
