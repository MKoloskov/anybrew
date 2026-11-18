/** Picture types we accept, with the file extension used on disk. */
export const IMAGE_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
/** Largest picture accepted. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
