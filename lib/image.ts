// ============================================================================
// Client-side image compression
// Target: long-edge ≤ 2048px, WebP quality 0.88, skip if already < 500KB.
// ============================================================================

const MAX_EDGE = 2048;
const QUALITY = 0.88;
const SKIP_COMPRESS_UNDER = 500 * 1024; // 500KB

export type CompressedImage = {
  blob: Blob;
  width: number;
  height: number;
  size: number;
  originalSize: number;
  filename: string;
  mimeType: string;
};

export async function compressImage(file: File | Blob, filename?: string): Promise<CompressedImage> {
  const originalSize = file.size;
  const originalName = (file as File).name || filename || 'image.png';
  const safeName = sanitizeFilename(originalName.replace(/\.\w+$/, ''));

  // Small images: skip compression, just pass through
  if (originalSize < SKIP_COMPRESS_UNDER) {
    const dims = await getImageDimensions(file);
    return {
      blob: file,
      width: dims.width,
      height: dims.height,
      size: originalSize,
      originalSize,
      filename: `${safeName}.${(file as File).type.split('/')[1] || 'png'}`,
      mimeType: (file as File).type || 'image/png',
    };
  }

  const img = await loadImage(file);
  let { width, height } = img;

  // Scale down if longest edge exceeds MAX_EDGE
  if (Math.max(width, height) > MAX_EDGE) {
    const scale = MAX_EDGE / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  ctx.drawImage(img, 0, 0, width, height);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('canvas toBlob failed'))),
      'image/webp',
      QUALITY
    );
  });

  return {
    blob,
    width,
    height,
    size: blob.size,
    originalSize,
    filename: `${safeName}.webp`,
    mimeType: 'image/webp',
  };
}

async function loadImage(file: File | Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

async function getImageDimensions(file: File | Blob): Promise<{ width: number; height: number }> {
  const img = await loadImage(file);
  return { width: img.width, height: img.height };
}

function sanitizeFilename(name: string): string {
  return name
    .replace(/[^\w\u4e00-\u9fff-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80) || 'image';
}

// Extract image blobs from clipboard paste event
export function extractImagesFromClipboard(e: ClipboardEvent): File[] {
  const items = e.clipboardData?.items || [];
  const files: File[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  return files;
}
