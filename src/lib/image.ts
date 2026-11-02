/** Resizes and re-encodes a chosen photo in the browser so uploads stay small and EXIF/location data is dropped. */
const MAX_SIDE = 1600;
const LIMIT = 2_300_000;

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(new Error('read failed'));
    r.readAsDataURL(blob);
  });
}

export async function prepareImage(file: File): Promise<{ base64: string; previewUrl: string } | { error: string }> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return { error: 'Choose a JPEG, PNG or WebP photo.' };
  if (file.size > 25_000_000) return { error: 'That file is too large. Choose a photo under 25 MB.' };
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return { error: 'That image could not be read.' };
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return { error: 'Your browser cannot process images.' };
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  // WebP where the browser can encode it (smaller), otherwise JPEG.
  for (const type of ['image/webp', 'image/jpeg']) {
    for (const quality of [0.85, 0.75, 0.6, 0.45]) {
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, type, quality));
      if (blob && blob.type === type && blob.size <= LIMIT) return { base64: await blobToBase64(blob), previewUrl: URL.createObjectURL(blob) };
    }
  }
  return { error: 'The photo is still too large after compression. Use a smaller image.' };
}
