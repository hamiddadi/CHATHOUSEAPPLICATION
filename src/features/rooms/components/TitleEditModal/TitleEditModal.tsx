import React, { memo, useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button } from '../../../../shared/components/Button';
import { colors, spacing } from '../../../../shared/constants/theme';
import { errorMessage } from '../../../../shared/utils/errorMessage';
import { useUpdateRoomTitle } from '../../hooks/useRooms';
// Shared title bounds — CreateRoomScreen and this modal must agree so an edited
// title can never exceed what the backend's create-time validation accepts.
import { ROOM_TITLE_MAX as MAX_TITLE, ROOM_TITLE_MIN as MIN_TITLE } from '../../constants';

interface TitleEditModalProps {
  visible: boolean;
  roomId: string;
  initialTitle: string;
  onClose: () => void;
}

export const TitleEditModal: React.FC<TitleEditModalProps> = memo(
  ({ visible, roomId, initialTitle, onClose }) => {
    const { t } = useTranslation();
    const [draft, setDraft] = useState(initialTitle);
    const updateTitle = useUpdateRoomTitle();

    // Resync the draft each time the modal opens — otherwise reopening
    // after a previous edit would show the stale local value.
    useEffect(() => {
      if (visible) setDraft(initialTitle);
    }, [initialTitle, visible]);

    const trimmed = draft.trim();
    const isValid = trimmed.length >= MIN_TITLE && trimmed.length <= MAX_TITLE;

    const handleSave = (): void => {
      if (!isValid || trimmed === initialTitle) {
        onClose();
        return;
      }
      updateTitle.mutate(
        { roomId, title: trimmed },
        {
          onSuccess: () => onClose(),
          onError: e =>
            Alert.alert(
              t('titleEdit.errorTitle', 'Error'),
              errorMessage(e, t('titleEdit.errorBody', 'Failed to update the title.')),
            ),
        },
      );
    };

    return (
      <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityLabel={t('titleEdit.closeA11y', 'Close')}
        >
          <Pressable style={styles.sheet} onPress={() => undefined}>
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
              style={styles.keyboardContent}
            >
              <View style={styles.handle} />
              <Text style={styles.title}>{t('titleEdit.title', 'Edit title')}</Text>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder={t('titleEdit.placeholder', 'Room title')}
                placeholderTextColor={colors.textMuted}
                style={styles.input}
                maxLength={MAX_TITLE}
                autoFocus
                accessibilityLabel={t('titleEdit.inputA11y', 'New room title')}
              />
              <Text style={styles.counter}>
                {trimmed.length} / {MAX_TITLE}
                {trimmed.length < MIN_TITLE
                  ? ` · ${t('titleEdit.min', 'min {{count}}', { count: MIN_TITLE })}`
                  : ''}
              </Text>
              <View style={styles.actions}>
                <Pressable
                  onPress={onClose}
                  style={styles.cancelBtn}
                  accessibilityRole="button"
                  accessibilityLabel={t('common.cancel', 'Cancel')}
                >
                  <Text style={styles.cancelLabel}>{t('common.cancel', 'Cancel')}</Text>
                </Pressable>
                <View style={styles.saveBtnWrap}>
                  <Button
                    label={t('common.save', 'Save')}
                    variant="primary"
                    fullWidth
                    disabled={!isValid || trimmed === initialTitle || updateTitle.isPending}
                    loading={updateTitle.isPending}
                    onPress={handleSave}
                  />
                </View>
              </View>
            </KeyboardAvoidingView>
          </Pressable>
        </Pressable>
      </Modal>
    );
  },
);
TitleEditModal.displayName = 'TitleEditModal';

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surfaceHigh,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: spacing.xxl,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  title: { color: colors.text, fontSize: 18, fontWeight: '700' },
  input: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    color: colors.text,
    borderRadius: 12,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    fontSize: 16,
  },
  counter: { color: colors.textMuted, fontSize: 11, textAlign: 'right' },
  actions: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  cancelBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  cancelLabel: { color: colors.textMuted, fontSize: 14, fontWeight: '600' },
  saveBtnWrap: { flex: 1 },
  keyboardContent: { gap: spacing.lg },
});
