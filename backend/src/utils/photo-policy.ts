import type { PhotoAsset } from "../types.js";

export interface PhotoRightsMeta {
  sourceUrl: string;
  attributionUrl: string;
  credit: string;
  license: string;
}

const REUSABLE_LICENSE_HINTS: RegExp[] = [
  /\bcreative\s+commons\b/u,
  /\bcc[-\s]?by(?:[-\s]?[a-z0-9]+)?\b/u,
  /\bcc[-\s]?0\b/u,
  /\bpublic\s+domain\b/u,
  /\bpd\b/u,
  /\bgfdl\b/u,
  /\bwikimedia\s+commons\b/u,
];

const UNKNOWN_LICENSE_HINTS: RegExp[] = [
  /\blicense\s+unknown\b/u,
  /\bunknown\s+license\b/u,
  /\bright(?:s)?\s+unknown\b/u,
  /\bunknown\b/u,
  /\bnot\s+provided\b/u,
  /\bnot\s+specified\b/u,
  /\bmanual\s+review\b/u,
  /\bcheck\s+original\s+source\s+terms\b/u,
  /\bn\/a\b/u,
  /\btbd\b/u,
];

const EDITED_OR_MIRRORED_HINTS: RegExp[] = [
  /\bmirror(?:ed|ing)?\b/u,
  /\bflip(?:ped|ping)?\b/u,
  /\bedit(?:ed|ing)?\b/u,
  /\bphotoshop(?:ped|ping)?\b/u,
  /\bretouch(?:ed|ing)?\b/u,
  /\bremix(?:ed|ing)?\b/u,
  /\bupscal(?:e|ed|ing)\b/u,
  /\bai[-_\s]?(?:generated|edited|enhanced|upscaled)\b/u,
  /\bmidjourney\b/u,
  /\bstable[-_\s]?diffusion\b/u,
];

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function joinMetaText(meta: PhotoRightsMeta): string {
  return normalizeText(`${meta.sourceUrl} ${meta.attributionUrl} ${meta.credit}`);
}

export function isUnknownLicenseText(license: string): boolean {
  const normalized = normalizeText(license);
  if (!normalized) {
    return true;
  }

  if (REUSABLE_LICENSE_HINTS.some((pattern) => pattern.test(normalized))) {
    return false;
  }

  return UNKNOWN_LICENSE_HINTS.some((pattern) => pattern.test(normalized));
}

export function hasEditedOrMirroredMarkers(meta: PhotoRightsMeta): boolean {
  const combined = joinMetaText(meta);
  if (!combined) {
    return false;
  }

  return EDITED_OR_MIRRORED_HINTS.some((pattern) => pattern.test(combined));
}

export function violatesUnknownRightsEditedPolicy(meta: PhotoRightsMeta): boolean {
  return isUnknownLicenseText(meta.license) && hasEditedOrMirroredMarkers(meta);
}

export function isPhotoAssetAllowedByRightsPolicy(photo: PhotoAsset): boolean {
  return !violatesUnknownRightsEditedPolicy({
    sourceUrl: photo.source_url,
    attributionUrl: photo.attribution_url,
    credit: photo.credit,
    license: photo.license,
  });
}

