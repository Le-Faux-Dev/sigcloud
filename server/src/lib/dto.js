// Sérialisation : seuls les champs destinés au client sortent. Jamais de storageKey, multipartId,
// passwordHash, tokenHash, csrfToken, ipHash. Les BigInt deviennent des nombres (taille max bien < 2^53).

import { FORMATS } from '../config/policy.js';

export const num = (v) => (v === null || v === undefined ? v : Number(v));

export function userDto(u) {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    role: u.role,
    quotaBytes: num(u.quotaBytes),
    usedBytes: num(u.usedBytes),
    createdAt: u.createdAt,
  };
}

export function folderDto(f) {
  return { id: f.id, name: f.name, parentId: f.parentId, createdAt: f.createdAt, updatedAt: f.updatedAt };
}

export function fileDto(f) {
  const fmt = FORMATS[f.extension];
  return {
    id: f.id,
    name: f.name,
    extension: f.extension,
    formatLabel: fmt?.label ?? f.extension.toUpperCase(),
    category: fmt?.category ?? 'document',
    sizeBytes: num(f.sizeBytes),
    folderId: f.folderId,
    uploadStatus: f.uploadStatus,
    securityStatus: f.securityStatus,
    previewStatus: f.previewStatus,
    previewReason: f.previewReason,
    previewKind: f.previewStatus === 'PREVIEWABLE' ? (fmt?.preview ?? null) : null,
    description: f.description,
    tags: f.tags ?? [],
    geoMeta: f.geoMeta ?? null,
    sha256: f.sha256,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
  };
}

/** Vue minimale pour un destinataire de lien anonyme : ni propriétaire, ni dossier parent, ni hash. */
export function publicFileDto(f) {
  const fmt = FORMATS[f.extension];
  return {
    id: f.id,
    name: f.name,
    extension: f.extension,
    formatLabel: fmt?.label ?? f.extension.toUpperCase(),
    category: fmt?.category ?? 'document',
    sizeBytes: num(f.sizeBytes),
    securityStatus: f.securityStatus,
    previewStatus: f.previewStatus,
    previewKind: f.previewStatus === 'PREVIEWABLE' ? (fmt?.preview ?? null) : null,
    geoMeta: f.geoMeta ?? null,
    createdAt: f.createdAt,
  };
}
