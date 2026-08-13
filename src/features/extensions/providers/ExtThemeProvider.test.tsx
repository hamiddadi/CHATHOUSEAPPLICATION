import React from 'react';
import { renderHook } from '@testing-library/react-native';
import { ExtThemeProvider, useExtThemeMode } from './ExtThemeProvider';

describe('ExtThemeProvider', () => {
  it('reports the dark scheme backed by the application tokens', () => {
    const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
      <ExtThemeProvider initialMode="light">{children}</ExtThemeProvider>
    );

    const { result } = renderHook(() => useExtThemeMode(), { wrapper });

    expect(result.current.mode).toBe('dark');
    expect(result.current.effective).toBe('dark');
  });

  it('uses the same truthful fallback without a provider', () => {
    const { result } = renderHook(() => useExtThemeMode());
    expect(result.current.effective).toBe('dark');
  });
});
