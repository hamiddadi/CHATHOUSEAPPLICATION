import React, { useCallback } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { useExtJoinHouse } from '../hooks/useExtJoinHouse';
import { colors } from '../../../shared/constants/theme';

/**
 * Drop-in "Rejoindre" CTA that honours club privacy via the clubreq flow.
 *
 * Behaviour by club privacy (resolved server-side, see clubreq.service):
 *   - OPEN   → joins immediately, button reflects "Rejointe"
 *   - SOCIAL → queues an approval request, button flips to
 *              "Demande envoyée" and becomes disabled
 *   - PRIVATE→ the host should not render this (invitation-only); a stray
 *              press surfaces an error and the label reverts.
 *
 * Pure addition — a host screen (e.g. HouseDetailScreen) opts in by
 * rendering <ExtJoinHouseButton clubId={house.id} />. Pass `onJoined`
 * to refetch the host's own house cache once membership is confirmed.
 */
export interface ExtJoinHouseButtonProps {
  clubId: string;
  /** Hide/replace the button when the viewer is already a member. */
  alreadyMember?: boolean;
  /** Optional join request note (SOCIAL clubs). */
  message?: string;
  /** Fired when an OPEN-club join succeeds (host refetches membership). */
  onJoined?: (clubId: string) => void;
  /** Fired when a SOCIAL approval request is queued. */
  onPending?: (clubId: string) => void;
  testID?: string;
}

export const ExtJoinHouseButton: React.FC<ExtJoinHouseButtonProps> = ({
  clubId,
  alreadyMember = false,
  message,
  onJoined,
  onPending,
  testID,
}) => {
  const { phase, isSubmitting, isPending, isJoined, join } = useExtJoinHouse({
    onJoined,
    onPending,
  });

  const handlePress = useCallback(() => {
    void join(clubId, message);
  }, [join, clubId, message]);

  if (alreadyMember || isJoined) {
    return (
      <Text style={styles.memberLabel} accessibilityRole="text" testID={testID}>
        Membre
      </Text>
    );
  }

  const disabled = isSubmitting || isPending;
  const label = isPending
    ? 'Demande envoyée'
    : isSubmitting
      ? 'Envoi…'
      : phase === 'error'
        ? 'Réessayer'
        : 'Rejoindre';

  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled, busy: isSubmitting }}
      accessibilityLabel={isPending ? 'Demande envoyée, en attente d’approbation' : 'Rejoindre'}
      style={[styles.button, disabled && styles.buttonDisabled]}
      testID={testID}
    >
      {isSubmitting ? (
        <ActivityIndicator size="small" color={colors.onPrimary} />
      ) : (
        <Text style={[styles.label, isPending && styles.labelPending]}>{label}</Text>
      )}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  button: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 999,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 140,
    minHeight: 44,
  },
  buttonDisabled: {
    backgroundColor: colors.overlayWhite10,
  },
  label: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.onPrimary,
  },
  labelPending: {
    color: colors.textMuted,
  },
  memberLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.accent,
  },
});
