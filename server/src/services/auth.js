import { hash, verify, Algorithm } from '@node-rs/argon2';
import { randomToken, sha256Hex } from '../lib/crypto.js';
import { hashIp } from '../lib/audit.js';
import { AppError, conflict, notFound, unauthorized, forbidden, badRequest } from '../lib/errors.js';
import { userDto, fileDto, folderDto } from '../lib/dto.js';

// Paramètres Argon2id recommandés par l'OWASP (19 Mio, 2 itérations, 1 thread).
const ARGON = { algorithm: Algorithm.Argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };
const hashPassword = (pw) => hash(pw, ARGON);

// Hash factice : on vérifie toujours un hash, même pour un compte inexistant (temps de réponse comparable).
let dummyHash;
const getDummyHash = async () => (dummyHash ??= await hashPassword('mot-de-passe-factice-sig-cloud'));

const COMMON = new Set([
  'password123', 'motdepasse1', 'azerty12345', 'qwertyuiop', '1234567890', 'azertyuiop', 'password1234', 'sigcloud123',
]);

export function checkPasswordPolicy(pw, email) {
  if (COMMON.has(pw.toLowerCase())) throw badRequest('WEAK_PASSWORD', 'Ce mot de passe est trop courant.');
  if (email && pw.toLowerCase().includes(email.split('@')[0]) && email.split('@')[0].length >= 4) {
    throw badRequest('WEAK_PASSWORD', "Le mot de passe ne doit pas contenir ton adresse e-mail.");
  }
}

export function createAuthService(ctx) {
  const { db, config } = ctx;

  async function createSession(user, req) {
    const token = randomToken(32);
    const csrfToken = randomToken(24);
    const session = await db.session.create({
      data: {
        userId: user.id,
        tokenHash: sha256Hex(token),
        csrfToken,
        userAgent: (req.headers['user-agent'] ?? '').slice(0, 200) || null,
        ipHash: hashIp(config, req.ip),
        expiresAt: new Date(Date.now() + config.sessionTtlMs),
      },
    });
    return { token, session };
  }

  return {
    hashPassword,

    async register(req, { email, password, displayName }) {
      checkPasswordPolicy(password, email);
      const passwordHash = await hashPassword(password);
      try {
        const user = await db.user.create({
          data: { email, displayName, passwordHash, quotaBytes: BigInt(config.limits.defaultQuotaBytes) },
        });
        const { token, session } = await createSession(user, req);
        return { user, token, session };
      } catch (err) {
        if (err?.code === 'P2002') {
          // Limite connue : sans vérification d'e-mail, l'inscription révèle qu'un compte existe (voir RESIDUAL_RISKS).
          throw conflict('EMAIL_TAKEN', 'Un compte existe déjà avec cette adresse e-mail.');
        }
        throw err;
      }
    },

    async login(req, { email, password }) {
      const user = await db.user.findUnique({ where: { email } });
      const ok = await verify(user?.passwordHash ?? (await getDummyHash()), password);
      if (!user || !ok || user.disabledAt) {
        throw new AppError(401, 'INVALID_CREDENTIALS', 'Adresse e-mail ou mot de passe incorrect.');
      }
      // Nouvelle session à chaque connexion (pas de fixation de session).
      const { token, session } = await createSession(user, req);
      return { user, token, session };
    },

    async logout(session) {
      await db.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    },

    async listSessions(user, currentSessionId) {
      const rows = await db.session.findMany({
        where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { lastSeenAt: 'desc' },
        take: 50,
      });
      return rows.map((s) => ({
        id: s.id,
        current: s.id === currentSessionId,
        userAgent: s.userAgent,
        createdAt: s.createdAt,
        lastSeenAt: s.lastSeenAt,
        expiresAt: s.expiresAt,
      }));
    },

    async revokeSession(user, sessionId) {
      const res = await db.session.updateMany({ where: { id: sessionId, userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
      if (res.count === 0) throw notFound();
    },

    async updateProfile(user, { displayName }) {
      return db.user.update({ where: { id: user.id }, data: { displayName } });
    },

    async changePassword(user, session, { currentPassword, newPassword }) {
      const fresh = await db.user.findUnique({ where: { id: user.id } });
      if (!(await verify(fresh.passwordHash, currentPassword))) {
        throw new AppError(401, 'INVALID_CREDENTIALS', 'Mot de passe actuel incorrect.');
      }
      checkPasswordPolicy(newPassword, fresh.email);
      const passwordHash = await hashPassword(newPassword);
      await db.$transaction([
        db.user.update({ where: { id: user.id }, data: { passwordHash } }),
        // Toutes les autres sessions sont révoquées.
        db.session.updateMany({ where: { userId: user.id, id: { not: session.id }, revokedAt: null }, data: { revokedAt: new Date() } }),
      ]);
    },

    /** Demande de réinitialisation : réponse identique que le compte existe ou non. */
    async requestPasswordReset(email) {
      // Sans e-mail configuré, on le dit clairement (indépendant de l'existence du compte).
      if (!ctx.mailer.enabled) {
        throw new AppError(501, 'MAIL_NOT_CONFIGURED', "La réinitialisation par e-mail n'est pas disponible sur ce serveur. Contacte l'administrateur.");
      }
      const user = await db.user.findUnique({ where: { email } });
      if (!user || user.disabledAt) return;
      const token = randomToken(32);
      await db.$transaction([
        db.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } }),
        db.passwordResetToken.create({
          data: { userId: user.id, tokenHash: sha256Hex(token), expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
        }),
      ]);
      await ctx.mailer.send({
        to: user.email,
        subject: 'Réinitialisation de ton mot de passe SIG-Cloud',
        // Le jeton est dans le fragment (#) : il n'est jamais envoyé au serveur ni dans un Referer.
        text: `Ouvre ce lien (valable 1 heure, usage unique) : ${config.appOrigin}/reset-password.html#${token}`,
      });
    },

    async confirmPasswordReset({ token, password }) {
      const rec = await db.passwordResetToken.findUnique({ where: { tokenHash: sha256Hex(token) }, include: { user: true } });
      if (!rec || rec.usedAt || rec.expiresAt <= new Date() || rec.user.disabledAt) {
        throw badRequest('INVALID_RESET_TOKEN', 'Ce lien est invalide ou expiré.');
      }
      checkPasswordPolicy(password, rec.user.email);
      const passwordHash = await hashPassword(password);
      await db.$transaction([
        db.passwordResetToken.update({ where: { id: rec.id }, data: { usedAt: new Date() } }),
        db.user.update({ where: { id: rec.userId }, data: { passwordHash } }),
        db.session.updateMany({ where: { userId: rec.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
      ]);
      return rec.user;
    },

    /** Suppression du compte : objets de stockage supprimés d'abord, puis la base (cascade sur dossiers, fichiers, partages). */
    async deleteAccount(user, { password }) {
      const fresh = await db.user.findUnique({ where: { id: user.id } });
      if (!(await verify(fresh.passwordHash, password))) {
        throw new AppError(401, 'INVALID_CREDENTIALS', 'Mot de passe incorrect.');
      }
      if (fresh.role === 'ADMIN') {
        const admins = await db.user.count({ where: { role: 'ADMIN', disabledAt: null } });
        if (admins <= 1) throw forbidden('Impossible de supprimer le dernier compte administrateur.');
      }
      await ctx.files.purgeAllForOwner(user.id);
      await db.user.delete({ where: { id: user.id } });
    },

    /** Export des données personnelles (métadonnées uniquement : les fichiers se téléchargent séparément). */
    async exportData(user) {
      const [files, folders, links, grants, audit] = await Promise.all([
        db.fileAsset.findMany({ where: { ownerId: user.id }, take: 5000 }),
        db.folder.findMany({ where: { ownerId: user.id }, take: 5000 }),
        db.shareLink.findMany({ where: { createdById: user.id }, take: 1000 }),
        db.shareGrant.findMany({ where: { ownerId: user.id }, take: 1000 }),
        db.auditLog.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 500 }),
      ]);
      return {
        exportedAt: new Date().toISOString(),
        profile: userDto(user),
        folders: folders.map(folderDto),
        files: files.map(fileDto),
        shareLinks: links.map((l) => ({ id: l.id, fileId: l.fileId, folderId: l.folderId, canDownload: l.canDownload, expiresAt: l.expiresAt, revokedAt: l.revokedAt, createdAt: l.createdAt })),
        shareGrants: grants.map((g) => ({ id: g.id, fileId: g.fileId, folderId: g.folderId, canDownload: g.canDownload, createdAt: g.createdAt })),
        auditLog: audit.map((a) => ({ action: a.action, targetType: a.targetType, targetId: a.targetId, createdAt: a.createdAt })),
      };
    },

    ensureEnabled(user) {
      if (!user || user.disabledAt) throw unauthorized();
    },
  };
}
