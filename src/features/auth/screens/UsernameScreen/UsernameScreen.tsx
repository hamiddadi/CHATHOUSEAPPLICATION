import React, { useCallback, useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Text,
  View,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import MaterialIcons from '@react-native-vector-icons/material-icons';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { Button } from '../../../../shared/components/Button';
import { Input } from '../../../../shared/components/Input';
import { useFormApiErrors } from '../../../../shared/hooks/useFormApiErrors';
import { toAppError } from '../../../../shared/services/api/errorHandler';
import { useAuthStore } from '../../store/authStore';
import { authService } from '../../services/authService';
import { usernameFormSchema, type UsernameFormValues } from '../../schemas';
import { colors, spacing } from '../../../../shared/constants/theme';

const USERNAME_MAX = 24;

export const UsernameScreen: React.FC = () => {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const setUsernameAction = useAuthStore(s => s.setUsername);
  const { t } = useTranslation();

  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [suggestionsFailed, setSuggestionsFailed] = useState(false);

  const fetchSuggestions = useCallback(async () => {
    setLoadingSuggestions(true);
    setSuggestionsFailed(false);
    try {
      const res = await authService.suggestUsername();
      setSuggestions(res.suggestions.slice(0, 3));
    } catch {
      // Suggestions are a nicety — no toast, but leave a discreet retry link
      // instead of failing silently.
      setSuggestionsFailed(true);
    } finally {
      setLoadingSuggestions(false);
    }
  }, []);

  useEffect(() => {
    void fetchSuggestions();
  }, [fetchSuggestions]);

  // On a cold restart this screen can be the stack's only route (RootNavigator
  // routes username-less users straight here) — hide the arrow then.
  const canGoBack = navigation.canGoBack();
  const handleBack = useCallback(() => {
    if (navigation.canGoBack()) navigation.goBack();
  }, [navigation]);

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
        const e = toAppError(err);
        // 409 = username already taken: show it under the field (localized)
        // instead of a generic toast.
        if (e.kind === 'conflict') {
          setError('username', {
            type: 'server',
            message: t('auth.username.errors.taken', 'This username is already taken.'),
          });
          return;
        }
        handleApiError(err);
      }
    },
    [handleApiError, setError, setUsernameAction, t],
  );

  const usernameFieldError = errors.username?.message
    ? t(errors.username.message as string)
    : undefined;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-background"
      style={{ paddingTop: insets.top }}
    >
      <View className="flex-row items-center px-xxl py-lg">
        {canGoBack && (
          <Pressable
            onPress={handleBack}
            accessibilityRole="button"
            accessibilityLabel={t('common.back', 'Back')}
            hitSlop={12}
          >
            <MaterialIcons name="arrow-back" size={24} color={colors.text} />
          </Pressable>
        )}
      </View>

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
        ) : suggestionsFailed ? (
          <Pressable
            onPress={() => void fetchSuggestions()}
            accessibilityRole="button"
            accessibilityLabel={t(
              'auth.username.suggestionsRetry',
              "Couldn't load suggestions — tap to retry",
            )}
            hitSlop={8}
            className="pl-sm"
          >
            <Text className="text-xs font-body-medium text-ink-muted underline">
              {t('auth.username.suggestionsRetry', "Couldn't load suggestions — tap to retry")}
            </Text>
          </Pressable>
        ) : suggestions.length > 0 ? (
          <View className="flex-row flex-wrap gap-sm">
            {suggestions.map(sug => (
              <Pressable
                key={sug}
                onPress={() => setValue('username', sug, { shouldValidate: true })}
                accessibilityRole="button"
                accessibilityLabel={t('auth.username.suggestionA11y', {
                  defaultValue: 'Use suggestion @{{username}}',
                  username: sug,
                })}
                className="bg-surface px-md py-sm rounded-full border border-outline"
              >
                <Text className="text-md font-body-medium text-ink">@{sug}</Text>
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
