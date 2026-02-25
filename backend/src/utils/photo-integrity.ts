import fs from "node:fs/promises";
import path from "node:path";
import type { PhotoAsset } from "../types.js";

function nonEmptyString(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function resolveWorkspacePhotoPath(localPath: string): string | null {
  const normalized = nonEmptyString(localPath);
  if (!normalized) {
    return null;
  }

  const workspace = path.resolve(process.cwd());
  const absolute = path.resolve(workspace, normalized);
  const relative = path.relative(workspace, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }

  return absolute;
}

async function isNonEmptyFile(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

export async function isPhotoLocalFileAvailable(photo: PhotoAsset): Promise<boolean> {
  const absolute = resolveWorkspacePhotoPath(photo.local_path);
  if (!absolute) {
    return false;
  }

  return isNonEmptyFile(absolute);
}

export async function filterPhotosWithExistingFiles(
  photos: PhotoAsset[],
): Promise<PhotoAsset[]> {
  if (!Array.isArray(photos) || photos.length === 0) {
    return [];
  }

  const checks = await Promise.all(photos.map((photo) => isPhotoLocalFileAvailable(photo)));
  return photos.filter((_, index) => checks[index]);
}
