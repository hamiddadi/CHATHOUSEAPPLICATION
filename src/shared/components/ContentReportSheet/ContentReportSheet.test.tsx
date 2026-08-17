import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { i18n } from '../../../core/i18n';
import { ContentReportSheet } from './ContentReportSheet';

describe('ContentReportSheet accessibility', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('identifies the modal content and exposes enabled report actions', () => {
    const onClose = jest.fn();
    const onSelect = jest.fn();
    const { getByLabelText, getByRole, UNSAFE_getByProps } = render(
      <ContentReportSheet visible onClose={onClose} onSelect={onSelect} />,
    );

    expect(getByRole('header', { name: 'Report this message' })).toBeTruthy();
    expect(UNSAFE_getByProps({ accessibilityViewIsModal: true })).toBeTruthy();
    expect(getByLabelText('Close').props.accessibilityState).toEqual({ disabled: false });
    expect(getByLabelText('Spam').props.accessibilityState).toEqual({ disabled: false });

    fireEvent.press(getByLabelText('Spam'));
    expect(onSelect).toHaveBeenCalledWith('spam');
  });

  it('marks every action disabled and announces progress while submitting', () => {
    const { getByLabelText, getByRole } = render(
      <ContentReportSheet visible submitting onClose={jest.fn()} onSelect={jest.fn()} />,
    );

    expect(getByLabelText('Close').props.accessibilityState).toEqual({ disabled: true });
    expect(getByLabelText('Spam').props.accessibilityState).toEqual({ disabled: true });

    const progress = getByRole('progressbar', { name: 'Sending report…' });
    expect(progress.props.accessibilityLiveRegion).toBe('polite');
  });
});
