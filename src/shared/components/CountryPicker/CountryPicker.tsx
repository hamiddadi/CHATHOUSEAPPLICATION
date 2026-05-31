import React, { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, SafeAreaView, Text, TextInput, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import type { CountryCode } from 'libphonenumber-js';
import { useTranslation } from 'react-i18next';
import { colors } from '../../constants/theme';

export interface Country {
  cca2: CountryCode;
  name: string;
  callingCode: string;
  flag: string;
}

export const COUNTRIES: Country[] = [
  { cca2: 'DZ', name: 'Algeria', callingCode: '+213', flag: '🇩🇿' },
  { cca2: 'FR', name: 'France', callingCode: '+33', flag: '🇫🇷' },
  { cca2: 'US', name: 'United States', callingCode: '+1', flag: '🇺🇸' },
  { cca2: 'GB', name: 'United Kingdom', callingCode: '+44', flag: '🇬🇧' },
  { cca2: 'CA', name: 'Canada', callingCode: '+1', flag: '🇨🇦' },
  { cca2: 'MA', name: 'Morocco', callingCode: '+212', flag: '🇲🇦' },
  { cca2: 'TN', name: 'Tunisia', callingCode: '+216', flag: '🇹🇳' },
  { cca2: 'DE', name: 'Germany', callingCode: '+49', flag: '🇩🇪' },
  { cca2: 'IT', name: 'Italy', callingCode: '+39', flag: '🇮🇹' },
  { cca2: 'ES', name: 'Spain', callingCode: '+34', flag: '🇪🇸' },
  { cca2: 'BE', name: 'Belgium', callingCode: '+32', flag: '🇧🇪' },
  { cca2: 'CH', name: 'Switzerland', callingCode: '+41', flag: '🇨🇭' },
  { cca2: 'AE', name: 'United Arab Emirates', callingCode: '+971', flag: '🇦🇪' },
  { cca2: 'SA', name: 'Saudi Arabia', callingCode: '+966', flag: '🇸🇦' },
];

export interface CountryPickerProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (country: Country) => void;
}

export const CountryPicker: React.FC<CountryPickerProps> = ({ visible, onClose, onSelect }) => {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');

  const filteredCountries = useMemo(() => {
    if (!search.trim()) return COUNTRIES;
    const lower = search.toLowerCase();
    return COUNTRIES.filter(
      c =>
        c.name.toLowerCase().includes(lower) ||
        c.callingCode.includes(lower) ||
        c.cca2.toLowerCase().includes(lower),
    );
  }, [search]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView className="flex-1 bg-background">
        <View className="px-lg py-md flex-row items-center border-b border-surface-border">
          <Pressable onPress={onClose} hitSlop={10} className="mr-md">
            <MaterialIcons name="close" size={24} color={colors.text} />
          </Pressable>
          <Text className="text-h3 font-display text-ink flex-1">
            {t('common.select_country', 'Select Country')}
          </Text>
        </View>

        <View className="p-md">
          <TextInput
            className="bg-surface px-md py-sm rounded-lg text-ink font-body"
            placeholder={t('common.search', 'Search')}
            placeholderTextColor={colors.textMuted}
            value={search}
            onChangeText={setSearch}
            clearButtonMode="while-editing"
            returnKeyType="search"
          />
        </View>

        <FlatList
          data={filteredCountries}
          keyExtractor={item => item.cca2}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <Pressable
              onPress={() => {
                onSelect(item);
                onClose();
                setSearch('');
              }}
              className="flex-row items-center px-lg py-md border-b border-surface/50 active:bg-surface"
            >
              <Text className="text-display text-2xl mr-md">{item.flag}</Text>
              <Text className="text-body font-body text-ink flex-1">{item.name}</Text>
              <Text className="text-body font-body text-textMuted">{item.callingCode}</Text>
            </Pressable>
          )}
        />
      </SafeAreaView>
    </Modal>
  );
};
