import React, { useCallback, useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '../../../../shared/components/Button';
import { Input } from '../../../../shared/components/Input';
import { useAuthStore } from '../../store/authStore';
import { spacing } from '../../../../shared/constants/theme';

const USERNAME_MIN = 3;
const USERNAME_MAX = 20;
const USERNAME_REGEX = /^[a-zA-Z0-9_]+$/;

export const UsernameScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const setUsernameAction = useAuthStore(s => s.setUsername);

  const handleSubmit = useCallback(async () => {
    const trimmed = username.trim();
    if (trimmed.length < USERNAME_MIN || !USERNAME_REGEX.test(trimmed)) {
      setError('Letters, numbers, and underscores only (3+ chars).');
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      await setUsernameAction(trimmed);
    } catch {
      setError('Username already taken.');
    } finally {
      setIsSubmitting(false);
    }
  }, [setUsernameAction, username]);

  const canSubmit = username.trim().length >= USERNAME_MIN && USERNAME_REGEX.test(username.trim());

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-background"
      style={{ paddingTop: insets.top + spacing.xl }}
    >
      <View
        className="flex-1 px-xxl gap-xxl"
        style={{ paddingBottom: insets.bottom + spacing.huge }}
      >
        <View className="gap-sm">
          <Text className="text-display font-display text-ink tracking-tight">
            Choose a username
          </Text>
          <Text className="text-sm font-body text-ink-muted">
            This is how others will find and tag you.
          </Text>
        </View>

        <Input
          placeholder="username"
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          maxLength={USERNAME_MAX}
          error={error ?? undefined}
          helperText={`${username.length} / ${USERNAME_MAX}`}
          leftAdornment={<Text className="text-md text-ink-muted">@</Text>}
          size="lg"
        />

        <View className="flex-1" />

        <Button
          label="Continue"
          variant="primary"
          size="lg"
          fullWidth
          disabled={!canSubmit}
          loading={isSubmitting}
          onPress={handleSubmit}
        />
      </View>
    </KeyboardAvoidingView>
  );
};
