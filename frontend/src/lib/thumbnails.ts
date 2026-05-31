import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';

const THUMB_SIZE = 280;

export async function createThumbnail(file: File): Promise<string> {
  if (file.type.startsWith('image/')) {
    return imageThumbnail(file);
  }
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    return pdfThumbnail(file);
  }
  return '';
}

async function imageThumbnail(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    const scale = Math.min(THUMB_SIZE / bitmap.width, THUMB_SIZE / bitmap.height, 1);
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/webp', 0.68);
  } finally {
    bitmap.close();
  }
}

async function pdfThumbnail(file: File): Promise<string> {
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  try {
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const scale = Math.min(THUMB_SIZE / viewport.width, THUMB_SIZE / viewport.height, 1.4);
    const scaled = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(scaled.width));
    canvas.height = Math.max(1, Math.round(scaled.height));
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    await page.render({ canvas, canvasContext: ctx, viewport: scaled }).promise;
    return canvas.toDataURL('image/webp', 0.7);
  } finally {
    await (pdf as { destroy?: () => Promise<void> }).destroy?.();
  }
}
