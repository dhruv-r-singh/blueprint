// Local-file uploads (project cover images, chat attachments) via Firebase
// Storage — separate from the Google Drive / GitHub integrations in
// lib/integrations.js. This is for files that live on the user's own
// device and get uploaded straight into the app, no third-party account
// needed.

import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from "firebase/storage";
import { storage } from "./firebase";

// No client-side size cap anymore (removed per request) — Firebase
// Storage/GCS itself doesn't meaningfully limit object size for this kind
// of use, and uploadBytesResumable streams in chunks rather than buffering
// the whole file in memory, so there's no real reason to block large
// files client-side. Bigger files just take longer, which the progress
// callback below already surfaces.

/**
 * Uploads `file` to `path` in Storage, reporting progress (0-100) via
 * onProgress. Resolves with the public download URL.
 */
export function uploadFile(path, file, onProgress) {
  return new Promise((resolve, reject) => {
    const storageRef = ref(storage, path);
    const task = uploadBytesResumable(storageRef, file, { contentType: file.type || undefined });
    task.on(
      "state_changed",
      (snap) => onProgress?.(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
      (err) => reject(err),
      async () => {
        try {
          const url = await getDownloadURL(task.snapshot.ref);
          resolve(url);
        } catch (err) {
          reject(err);
        }
      }
    );
  });
}

export async function deleteFile(path) {
  try {
    await deleteObject(ref(storage, path));
  } catch (err) {
    console.error("Couldn't delete stored file:", err);
  }
}

/** Sanitizes a filename for use as a Storage path segment. */
export function safeFileName(name) {
  return (name || "file").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-120);
}

/**
 * Downscales/re-encodes an image file client-side before it ever hits
 * uploadFile — this is the biggest lever on "uploads take forever" for
 * photos straight off a phone (often 4000px+ wide, 5-15MB) getting
 * uploaded as a project cover or chat attachment. Caps the longest edge at
 * `maxDimension` and re-encodes as JPEG at `quality`, which for a typical
 * phone photo cuts the upload size (and therefore time) by 80-95% with
 * no visible quality loss at the sizes this app actually displays images.
 * No-ops (returns the original file) for anything that isn't a plain
 * raster image (SVGs, HEIC before the browser decodes it, non-images) or
 * that's already smaller than the cap — compressing an already-small file
 * would just waste time and can even make it bigger.
 */
export async function compressImage(file, { maxDimension = 1600, quality = 0.82 } = {}) {
  if (!file || !file.type?.startsWith("image/") || file.type === "image/svg+xml") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    if (scale >= 1 && file.size < 800_000) {
      bitmap.close?.();
      return file; // already small enough — don't bother
    }
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob || blob.size >= file.size) return file; // compression didn't help — use the original
    const name = (file.name || "image").replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg" });
  } catch (err) {
    console.error("Image compression failed, uploading original file:", err);
    return file;
  }
}
