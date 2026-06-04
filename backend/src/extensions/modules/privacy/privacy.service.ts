import { prisma } from '../../../config/database';

/**
 * Privacy settings extension — exposes a clean GET/PATCH surface over the
 * existing User fields:
 *   - isPrivateAccount → profile visibility (15.6 / SEC-010)
 *   - allowWaves       → Wave/ping permission (17.3 / SEC-012)
 *   - isVisible        → ghost mode for the map (existing)
 *
 * No schema change; we read/write the existing columns the original code
 * already exposes implicitly. This module gives the mobile client a single
 * canonical Settings panel.
 */

export interface PrivacySettings {
  isPrivateAccount: boolean;
  allowWaves: boolean;
  isVisibleOnMap: boolean;
}

// Maps a Prisma row (`isVisible`) to the public `PrivacySettings` shape
// (`isVisibleOnMap`). Centralises the column→field rename used by get/update.
const toSettings = (u: {
  isPrivateAccount: boolean;
  allowWaves: boolean;
  isVisible: boolean;
}): PrivacySettings => ({
  isPrivateAccount: u.isPrivateAccount,
  allowWaves: u.allowWaves,
  isVisibleOnMap: u.isVisible,
});

export const privacyService = {
  async get(userId: string): Promise<PrivacySettings> {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { isPrivateAccount: true, allowWaves: true, isVisible: true },
    });
    return toSettings({
      isPrivateAccount: u?.isPrivateAccount ?? false,
      allowWaves: u?.allowWaves ?? true,
      isVisible: u?.isVisible ?? false,
    });
  },

  async update(
    userId: string,
    patch: Partial<{
      isPrivateAccount: boolean;
      allowWaves: boolean;
      isVisibleOnMap: boolean;
    }>,
  ): Promise<PrivacySettings> {
    const data: Record<string, boolean> = {};
    if (typeof patch.isPrivateAccount === 'boolean') {
      data.isPrivateAccount = patch.isPrivateAccount;
    }
    if (typeof patch.allowWaves === 'boolean') {
      data.allowWaves = patch.allowWaves;
    }
    if (typeof patch.isVisibleOnMap === 'boolean') {
      data.isVisible = patch.isVisibleOnMap;
    }
    if (Object.keys(data).length === 0) {
      return this.get(userId);
    }
    const updated = await prisma.user.update({
      where: { id: userId },
      data,
      select: { isPrivateAccount: true, allowWaves: true, isVisible: true },
    });
    return toSettings(updated);
  },
};
