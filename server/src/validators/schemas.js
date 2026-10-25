import { z } from 'zod';
import { CATEGORIES } from '../config/policy.js';

z.config(z.locales.fr());

const strict = (shape) => z.object(shape).strict();

export const id = z.uuid({ message: 'Identifiant invalide' });
const nullableId = z.union([id, z.null()]);

export const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email({ message: 'Adresse e-mail invalide' }));

export const password = z.string().min(10, 'Au moins 10 caractères').max(128, 'Au plus 128 caractères');
const displayName = z.string().trim().min(1, 'Nom requis').max(80);
const itemName = z.string().min(1).max(255);

export const schemas = {
  idParam: strict({ id }),
  tokenParam: strict({ token: z.string().min(20).max(200) }),

  register: strict({ email, password, displayName }),
  login: strict({ email, password: z.string().min(1).max(128) }),
  updateProfile: strict({ displayName }),
  changePassword: strict({ currentPassword: z.string().min(1).max(128), newPassword: password }),
  deleteAccount: strict({ password: z.string().min(1).max(128) }),
  resetRequest: strict({ email }),
  resetConfirm: strict({ token: z.string().min(20).max(200), password }),
  sessionParam: strict({ id }),

  folderCreate: strict({ name: itemName, parentId: nullableId.optional() }),
  folderUpdate: strict({ name: itemName.optional(), parentId: nullableId.optional() }).refine(
    (v) => v.name !== undefined || v.parentId !== undefined,
    { message: 'Rien à modifier' },
  ),
  folderContentsParam: strict({ id: z.union([id, z.literal('root')]) }),

  uploadInit: strict({ name: itemName, size: z.number().int().positive(), folderId: nullableId.optional() }),
  uploadParts: strict({ partNumbers: z.array(z.number().int().min(1).max(10000)).min(1).max(50) }),
  fileUpdate: strict({
    name: itemName.optional(),
    description: z.union([z.string().max(500), z.null()]).optional(),
    tags: z.array(z.string().trim().min(1).max(30)).max(10).optional(),
    folderId: nullableId.optional(),
  }).refine((v) => Object.keys(v).length > 0, { message: 'Rien à modifier' }),
  fileList: strict({
    folderId: z.union([id, z.literal('root'), z.literal('all')]).default('root'),
    q: z.string().trim().max(100).optional(),
    category: z.enum(CATEGORIES).optional(),
    ext: z.string().trim().toLowerCase().max(10).optional(),
    preview: z.enum(['yes', 'no']).optional(),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
    sort: z.enum(['name', 'size', 'date']).default('date'),
    order: z.enum(['asc', 'desc']).default('desc'),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(100000).default(0),
  }),
  downloadQuery: strict({ inline: z.enum(['1']).optional() }),
  trashEmpty: strict({ confirm: z.literal(true) }),

  shareLinkCreate: strict({
    fileId: id.optional(),
    folderId: id.optional(),
    canDownload: z.boolean().default(false),
    expiresInDays: z.union([z.number().int().min(1).max(365), z.null()]).optional(),
  }).refine((v) => Boolean(v.fileId) !== Boolean(v.folderId), { message: 'Indique soit fileId, soit folderId' }),
  shareGrantCreate: strict({
    fileId: id.optional(),
    folderId: id.optional(),
    email,
    canDownload: z.boolean().default(false),
  }).refine((v) => Boolean(v.fileId) !== Boolean(v.folderId), { message: 'Indique soit fileId, soit folderId' }),
  shareListQuery: strict({ fileId: id.optional(), folderId: id.optional() }).refine(
    (v) => Boolean(v.fileId) !== Boolean(v.folderId),
    { message: 'Indique soit fileId, soit folderId' },
  ),
  publicFileParam: strict({ fileId: id }),

  adminUserUpdate: strict({
    quotaBytes: z.number().int().min(0).max(1024 ** 4).optional(),
    disabled: z.boolean().optional(),
  }).refine((v) => v.quotaBytes !== undefined || v.disabled !== undefined, { message: 'Rien à modifier' }),
  adminList: strict({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(100000).default(0),
  }),
};
