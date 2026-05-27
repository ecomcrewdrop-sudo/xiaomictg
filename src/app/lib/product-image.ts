import imageCompression from 'browser-image-compression';
import { API_BASE_URL, fetchWithTimeout } from './api-base';

export async function compressImageDataUrl(imageString: string): Promise<string> {
  if (!imageString?.startsWith('data:image')) {
    return imageString;
  }

  const response = await fetch(imageString);
  const blob = await response.blob();
  const file = new File([blob], 'image.jpg', { type: blob.type || 'image/jpeg' });
  const compressedFile = await imageCompression(file, {
    maxSizeMB: 0.35,
    maxWidthOrHeight: 1000,
    useWebWorker: true,
  });
  return imageCompression.getDataUrlFromFile(compressedFile);
}

export async function compressImageFile(file: File): Promise<string> {
  const compressedFile = await imageCompression(file, {
    maxSizeMB: 0.35,
    maxWidthOrHeight: 1000,
    useWebWorker: true,
  });
  return imageCompression.getDataUrlFromFile(compressedFile);
}

export function isRemoteImageUrl(image: string): boolean {
  return (
    image.startsWith('http://') ||
    image.startsWith('https://') ||
    image.includes('/api/media/')
  );
}

export async function uploadProductImage(
  image: string,
  productId: string,
  filename: string
): Promise<string> {
  if (!image) {
    throw new Error('Imagen requerida');
  }
  if (isRemoteImageUrl(image)) {
    return image;
  }
  if (!image.startsWith('data:image')) {
    throw new Error('Formato de imagen no válido. Sube un archivo o ingresa una URL.');
  }

  const compressed = await compressImageDataUrl(image);
  const uploadRes = await fetchWithTimeout(
    `${API_BASE_URL}/upload`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: compressed,
        filename,
        productId,
        folder: 'productos',
      }),
    },
    90000
  );

  const data = (await uploadRes.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!uploadRes.ok) {
    throw new Error(data.error || `No se pudo subir la imagen (${uploadRes.status})`);
  }
  if (!data.url) {
    throw new Error('El servidor no devolvió la URL de la imagen');
  }
  return data.url;
}
