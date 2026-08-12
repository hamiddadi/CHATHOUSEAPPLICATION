import React from 'react';
import { View } from 'react-native';
import { render } from '@testing-library/react-native';
import { useNetworkStore } from '../../services/network/networkStore';
import { OfflineBanner } from './OfflineBanner';

describe('OfflineBanner', () => {
  afterEach(() => {
    useNetworkStore.setState({ isOnline: true, lastTransitionAt: Date.now() });
  });

  it('does not render while the device is online', () => {
    useNetworkStore.setState({ isOnline: true, lastTransitionAt: Date.now() });

    const { toJSON } = render(<OfflineBanner />);

    expect(toJSON()).toBeNull();
  });

  it('makes the entire offline banner transparent to touches', () => {
    useNetworkStore.setState({ isOnline: false, lastTransitionAt: Date.now() });

    const { getByText, UNSAFE_getByType } = render(<OfflineBanner />);

    // The banner is absolutely positioned over the current screen. `none`
    // disables hit testing for both the container and its Text child, so
    // controls underneath it (such as onboarding's Skip button) remain usable.
    const banner = UNSAFE_getByType(View);
    expect(banner.props.pointerEvents).toBe('none');
    expect(banner.props.accessibilityRole).toBe('alert');
    expect(banner.props.accessibilityLiveRegion).toBe('polite');
    expect(getByText(/Offline/)).toBeTruthy();
  });
});
