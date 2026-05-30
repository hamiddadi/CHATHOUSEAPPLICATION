import { useCallback, useState } from 'react';
import { Share } from 'react-native';
import { invitesApi } from '../api/invitesApi';
import { errorMessage } from '../../../shared/utils/errorMessage';

/**
 * "Inviter des amis" via an invite link.
 *
 * Fetches the authenticated user's personal invite URL from the backend
 * (`GET /ext/invites/link`) and opens the native react-native `Share` sheet
 * so they can send it through any installed app (SMS, WhatsApp, etc.).
 *
 * The link encodes the inviter server-side, so attribution requires no
 * client-side bookkeeping. This hook complements `useExtContactsSync`
 * (which discovers contacts already on Chathouse): use this to invite the
 * ones who are NOT yet registered.
 */
export const useInvite = () => {
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shareInviteLink = useCallback(async (): Promise<boolean> => {
    setSharing(true);
    setError(null);
    try {
      const { url } = await invitesApi.getLink();
      const result = await Share.share({
        message: `Rejoins-moi sur Chathouse ! ${url}`,
        // iOS surfaces `url` separately from `message`; Android ignores it.
        url,
      });
      // `dismissedAction` means the user closed the sheet without sharing —
      // not an error, just a non-share. Treat only a thrown error as failure.
      return result.action === Share.sharedAction;
    } catch (e) {
      setError(errorMessage(e, 'Partage impossible'));
      return false;
    } finally {
      setSharing(false);
    }
  }, []);

  return { shareInviteLink, sharing, error };
};
