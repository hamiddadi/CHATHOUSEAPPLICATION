export type LivekitParticipantPolicyEffect =
  | { kind: 'remove' }
  | { kind: 'permissions'; canPublish: boolean };

export interface LockedRoomPolicyState {
  hostId: string;
  isLive: boolean;
  endedAt: Date | null;
}

export interface LockedUserPolicyState {
  deletedAt: Date | null;
  suspendedUntil: Date | null;
  termsAcceptedVersion: string | null;
  termsAcceptedAt: Date | null;
  privacyNoticeAcknowledgedVersion: string | null;
  privacyNoticeAcknowledgedAt: Date | null;
  legalAcceptanceLocale: string | null;
}

export interface LockedParticipantPolicyState {
  role: 'HOST' | 'MODERATOR' | 'SPEAKER' | 'LISTENER';
  isMuted: boolean;
  leftAt: Date | null;
  admissionConfirmedAt: Date | null;
}

export interface LivekitParticipantPolicyStore<TTransaction> {
  transaction<T>(
    work: (transaction: TTransaction) => Promise<T>,
    options: { maxWait: number; timeout: number },
  ): Promise<T>;
  setLocalLockTimeout(transaction: TTransaction, milliseconds: number): Promise<void>;
  lockRoom(transaction: TTransaction, roomId: string): Promise<void>;
  lockUser(transaction: TTransaction, userId: string): Promise<void>;
  lockParticipant(transaction: TTransaction, roomId: string, userId: string): Promise<void>;
  readRoom(transaction: TTransaction, roomId: string): Promise<LockedRoomPolicyState | null>;
  readUser(transaction: TTransaction, userId: string): Promise<LockedUserPolicyState | null>;
  readParticipant(
    transaction: TTransaction,
    roomId: string,
    userId: string,
  ): Promise<LockedParticipantPolicyState | null>;
}

export interface LivekitParticipantPolicyProvider {
  removeParticipant(roomId: string, userId: string): Promise<void>;
  setParticipantCanPublish(roomId: string, userId: string, canPublish: boolean): Promise<void>;
}

export interface EnforceLivekitParticipantPolicyInput<TTransaction> {
  store: LivekitParticipantPolicyStore<TTransaction>;
  provider: LivekitParticipantPolicyProvider;
  legalDocumentVersion: string;
  roomId: string;
  userId: string;
  now?: Date;
}

/**
 * Linearize provider permissions with application membership state. The store
 * adapter owns SQL syntax, while this core owns the invariant and lock order so
 * the HTTP API and the standalone security worker cannot silently diverge.
 */
export const enforceLivekitParticipantPolicyLocked = async <TTransaction>({
  store,
  provider,
  legalDocumentVersion,
  roomId,
  userId,
  now = new Date(),
}: EnforceLivekitParticipantPolicyInput<TTransaction>): Promise<LivekitParticipantPolicyEffect> =>
  store.transaction(
    async transaction => {
      await store.setLocalLockTimeout(transaction, 1_000);
      await store.lockRoom(transaction, roomId);
      await store.lockUser(transaction, userId);
      await store.lockParticipant(transaction, roomId, userId);

      const [room, user, participant] = await Promise.all([
        store.readRoom(transaction, roomId),
        store.readUser(transaction, userId),
        store.readParticipant(transaction, roomId, userId),
      ]);
      const active =
        room !== null &&
        user !== null &&
        participant !== null &&
        participant.leftAt === null &&
        participant.admissionConfirmedAt !== null &&
        room.isLive &&
        room.endedAt === null &&
        user.deletedAt === null &&
        (!user.suspendedUntil || user.suspendedUntil <= now);
      if (!active) {
        await provider.removeParticipant(roomId, userId);
        return { kind: 'remove' };
      }

      // Room.hostId is the only authoritative host identity. A historical
      // Participant.role=HOST left by an older hand-off must be receive-only.
      const stageRole =
        room.hostId === userId ||
        participant.role === 'MODERATOR' ||
        participant.role === 'SPEAKER';
      const legalAccepted =
        user.termsAcceptedVersion === legalDocumentVersion &&
        user.termsAcceptedAt !== null &&
        user.privacyNoticeAcknowledgedVersion === legalDocumentVersion &&
        user.privacyNoticeAcknowledgedAt !== null;
      const canPublish = stageRole && !participant.isMuted && legalAccepted;
      await provider.setParticipantCanPublish(roomId, userId, canPublish);
      return { kind: 'permissions', canPublish };
    },
    { maxWait: 1_000, timeout: 17_000 },
  );
