import React, { useCallback, useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Text,
  View,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { Button } from '../../../../shared/components/Button';
import { Input } from '../../../../shared/components/Input';
import { useFormApiErrors } from '../../../../shared/hooks/useFormApiErrors';
import { useAuthStore } from '../../store/authStore';
import { authService } from '../../services/authService';
import { usernameFormSchema, type UsernameFormValues } from '../../schemas';
import { colors, spacing } from '../../../../shared/constants/theme';

const USERNAME_MAX = 24;

export const UsernameScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const setUsernameAction = useAuthStore(s => s.setUsername);
  const { t } = useTranslation();

  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);

  useEffect(() => {
    const fetchSuggestions = async () => {
      setLoadingSuggestions(true);
      try {
        const res = await authService.suggestUsername();
        setSuggestions(res.suggestions.slice(0, 3));
      } catch {
        // Silent fail
      } finally {
        setLoadingSuggestions(false);
      }
    };
    fetchSuggestions();
  }, []);

  const {
    control,
    handleSubmit,
    setError,
    setValue,
    watch,
    formState: { errors, isSubmitting, isValid },
  } = useForm<UsernameFormValues>({
    resolver: zodResolver(usernameFormSchema),
    mode: 'onChange',
    defaultValues: { username: '' },
  });

  const handleApiError = useFormApiErrors(setError);
  const usernameValue = watch('username');

  const onSubmit = useCallback(
    async ({ username }: UsernameFormValues) => {
      try {
        await setUsernameAction(username);
      } catch (err) {
        handleApiError(err);
      }
    },
    [handleApiError, setUsernameAction],
  );

  const usernameFieldError = errors.username?.message
    ? t(errors.username.message as string)
    : undefined;

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
        <Text className="text-display font-display text-ink tracking-tight">
          {t('auth.username.title')}
        </Text>

        <Controller
          control={control}
          name="username"
          render={({ field: { onChange, onBlur, value } }) => (
            <Input
              placeholder={t('auth.username.placeholder')}
              value={value}
              onChangeText={onChange}
              onBlur={onBlur}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              maxLength={USERNAME_MAX}
              error={usernameFieldError}
              helperText={`${usernameValue.length} / ${USERNAME_MAX}`}
              leftAdornment={<Text className="text-md text-ink-muted">@</Text>}
              size="lg"
            />
          )}
        />

        {loadingSuggestions ? (
          <View className="h-10 items-start justify-center pl-sm">
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : suggestions.length > 0 ? (
          <View className="flex-row flex-wrap gap-sm">
            {suggestions.map(sug => (
              <Pressable
                key={sug}
                onPress={() => setValue('username', sug, { shouldValidate: true })}
                className="bg-surface px-md py-sm rounded-full border border-surface-border"
              >
                <Text className="text-body font-body-medium text-ink">@{sug}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        <View className="flex-1" />

        <Button
          label={t('auth.username.submit')}
          variant="primary"
          size="lg"
          fullWidth
          disabled={!isValid || isSubmitting}
          loading={isSubmitting}
          onPress={handleSubmit(onSubmit)}
        />
      </View>
    </KeyboardAvoidingView>
  );
};
