import { useState, useCallback } from 'react';
import { Platform } from 'react-native';
import { contactsApi, type ContactMatch } from '../api/contactsApi';
import { errorMessage } from '../../../shared/utils/errorMessage';

// ─── Loose types for the optional native modules ───
interface ContactsPhone {
  number?: string;
}
interface ContactsContact {
  phoneNumbers?: ContactsPhone[];
}
interface ContactsModule {
  requestPermissionsAsync: () => Promise<{ status: string }>;
  getContactsAsync: (opts: { fields: unknown[] }) => Promise<{ data: ContactsContact[] }>;
  Fields: { PhoneNumbers: unknown };
}

/** Upper bound on phone numbers sent in a single contacts-match request. */
const MAX_CONTACTS_PER_SYNC = 2000;
/**
 * Hook that orchestrates the contacts sync:
 *  1. Ask runtime permission for contacts
 *  2. Pull phone numbers, normalize to E.164
 *  3. Send the (deduped) E.164 numbers over TLS to /ext/contacts/match
 *  4. Receive matched Chathouse users
 *
 * The previous client-side salted-hash step was removed: the salt was shared
 * with every authenticated client (and had a guessable default), so the
 * low-entropy phone-number space was trivially enumerable and the hashing
 * protected nothing. Matching is now an indexed server-side lookup; numbers
 * are sent over TLS and never persisted.
 *
 * We lazy-load `expo-contacts` so this module remains importable even if the
 * native package isn't available (e.g. on web preview builds).
 */
export const useExtContactsSync = () => {
  const [status, setStatus] = useState<'idle' | 'syncing' | 'done' | 'denied' | 'error'>('idle');
  const [matches, setMatches] = useState<ContactMatch[]>([]);
  const [error, setError] = useState<string | null>(null);

  const sync = useCallback(async () => {
    setStatus('syncing');
    setError(null);
    try {
      // Optional native module. We use a synchronous `require` (NOT dynamic
      // `import()`, which hermesc rejects in release builds — "Invalid
      // expression encountered"). When `expo-contacts` isn't installed,
      // metro.config resolves it to an empty stub, so the guard below treats
      // it as unavailable. Keeps the module loadable on web/tests too.
      let Contacts: ContactsModule | null = null;
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports, global-require
        Contacts = require('expo-contacts') as ContactsModule;
      } catch {
        Contacts = null;
      }
      if (!Contacts?.requestPermissionsAsync) {
        setStatus('error');
        setError('expo-contacts unavailable');
        return;
      }
      const { status: perm } = await Contacts.requestPermissionsAsync();
      if (perm !== 'granted') {
        setStatus('denied');
        return;
      }

      const { data } = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.PhoneNumbers],
      });

      const e164 = data
        .flatMap((c: ContactsContact) => c.phoneNumbers ?? [])
        .map((p: ContactsPhone) => normalizeToE164(p.number ?? ''))
        .filter((n: string | null): n is string => Boolean(n));

      if (e164.length === 0) {
        setMatches([]);
        setStatus('done');
        return;
      }

      const unique = Array.from(new Set(e164));
      const result = await contactsApi.match(unique.slice(0, MAX_CONTACTS_PER_SYNC));
      setMatches(result);
      setStatus('done');
    } catch (e) {
      setStatus('error');
      setError(errorMessage(e, 'unknown'));
    }
  }, []);

  return { status, matches, error, sync, platform: Platform.OS };
};

const normalizeToE164 = (raw: string): string | null => {
  const trimmed = raw.replace(/[\s().-]/g, '');
  if (trimmed.startsWith('+')) {
    return /^\+\d{6,15}$/.test(trimmed) ? trimmed : null;
  }
  // No country prefix → can't safely match. Caller should rely on the
  // device locale-aware library (libphonenumber-js) for production.
  return null;
};
