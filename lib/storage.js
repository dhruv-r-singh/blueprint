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
