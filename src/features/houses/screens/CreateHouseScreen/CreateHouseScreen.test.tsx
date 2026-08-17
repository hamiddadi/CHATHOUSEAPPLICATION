/**
 * CreateHouseScreen render + button tests. The screen is form-driven (no remote
 * query gating mount), so it renders immediately. We exercise: the close
 * button (goBack), the icon picker (react-native-image-picker is globally
 * mocked), the privacy radio options, and the Create CTA — which is disabled
 * until the name is >= 2 chars, so we type one first and assert the press is
 * crash-free (the create mutation fires against the unmocked api → resolves or
 * rejects asynchronously, which the screen handles).
 */
import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../../test-utils/renderScreen';
import { houseService } from '../../services/houseService';
import type { House } from '../../../../shared/types/domain';
import { CreateHouseScreen } from './CreateHouseScreen';

const createdHouse = (): House => ({
  id: 'house-created',
  name: 'My House',
  description: '',
  category: 'tech',
  categoryEmoji: '💻',
  iconUrl: null,
  privacy: 'open',
  ownerId: 'user-test-1',
  membersCount: 1,
  liveRoomsCount: 0,
  isJoinedByMe: true,
  members: [],
  createdAt: new Date(0).toISOString(),
});

describe('CreateHouseScreen', () => {
  beforeEach(() => {
    mockAuthenticated();
  });
  afterEach(() => {
    resetAuth();
    jest.restoreAllMocks();
  });

  it('mounts and shows its title + Create CTA', () => {
    const { toJSON, getAllByText } = renderScreen(<CreateHouseScreen />, {
      route: { name: 'CreateHouse' },
    });
    expect(toJSON()).toBeTruthy();
    // i18n en.json intentionally gives the title and submit CTA the same
    // "Create House" copy, so the text appears twice (header + button).
    expect(getAllByText('Create House').length).toBeGreaterThanOrEqual(2);
  });

  it('close button calls navigation.goBack', () => {
    const { navigation, getByLabelText } = renderScreen(<CreateHouseScreen />, {
      route: { name: 'CreateHouse' },
    });
    fireEvent.press(getByLabelText('Close without creating'));
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('icon picker button is pressable without crashing', () => {
    const { getByLabelText, toJSON } = renderScreen(<CreateHouseScreen />, {
      route: { name: 'CreateHouse' },
    });
    fireEvent.press(getByLabelText('Upload house icon'));
    expect(toJSON()).toBeTruthy();
  });

  it('selecting a privacy option toggles its selected state', () => {
    const { getByLabelText } = renderScreen(<CreateHouseScreen />, {
      route: { name: 'CreateHouse' },
    });
    const privateRow = getByLabelText('Private: Invitation only');
    fireEvent.press(privateRow);
    expect(privateRow.props.accessibilityState.selected).toBe(true);
  });

  it('Create CTA waits for the mutation and navigates back', async () => {
    const createSpy = jest.spyOn(houseService, 'create').mockResolvedValue(createdHouse());
    const { getAllByText, getByPlaceholderText, navigation } = renderScreen(<CreateHouseScreen />, {
      route: { name: 'CreateHouse' },
    });
    // i18n en.json: houses.create.namePlaceholder === 'House Name'.
    fireEvent.changeText(getByPlaceholderText('House Name'), 'My House');
    // 'Create House' renders twice (header + CTA); the button is the last one.
    const matches = getAllByText('Create House');
    fireEvent.press(matches[matches.length - 1]);
    await waitFor(() => {
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'My House' }),
        expect.stringMatching(/^rn-/),
      );
      expect(navigation.goBack).toHaveBeenCalledTimes(1);
    });
  });

  it('coalesces two presses in the same tick into one house creation action', async () => {
    let resolveCreate!: (house: House) => void;
    const createSpy = jest
      .spyOn(houseService, 'create')
      .mockReturnValue(new Promise(resolve => (resolveCreate = resolve)));
    const { getAllByText, getByPlaceholderText } = renderScreen(<CreateHouseScreen />, {
      route: { name: 'CreateHouse' },
    });
    fireEvent.changeText(getByPlaceholderText('House Name'), 'One tap House');
    const matches = getAllByText('Create House');
    const submit = matches[matches.length - 1];

    act(() => {
      fireEvent.press(submit);
      fireEvent.press(submit);
    });
    await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1));

    await act(async () => resolveCreate(createdHouse()));
  });

  it('shows an inline error under the name field while it is too short', () => {
    const { getByPlaceholderText, getByText, queryByText } = renderScreen(<CreateHouseScreen />, {
      route: { name: 'CreateHouse' },
    });
    fireEvent.changeText(getByPlaceholderText('House Name'), 'A');
    // A greyed-out button alone gives no clue WHY creation is blocked.
    expect(getByText('The name must be at least 2 characters.')).toBeTruthy();
    fireEvent.changeText(getByPlaceholderText('House Name'), 'AB');
    expect(queryByText('The name must be at least 2 characters.')).toBeNull();
  });

  it('CLUB_006 quota rejection surfaces the dedicated message, not the generic one', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    // The interceptors reject with a PLAIN-OBJECT AppError (not instanceof
    // Error) — errorMessage must still resolve its code/message. When the
    // AppError carries a stable backend code, errorMessage resolves the
    // CURATED, localized copy (errors.codes.CLUB_006) rather than echoing the
    // raw backend string — see AppError.code docstring in errorHandler.ts. The
    // test harness runs in English (react-native-localize mock → 'en'), so the
    // dedicated message is the en.json copy for CLUB_006.
    jest.spyOn(houseService, 'create').mockRejectedValue({
      kind: 'forbidden',
      status: 403,
      code: 'CLUB_006',
      message: 'You already own the maximum number of houses.',
    });
    const { getAllByText, getByPlaceholderText } = renderScreen(<CreateHouseScreen />, {
      route: { name: 'CreateHouse' },
    });
    fireEvent.changeText(getByPlaceholderText('House Name'), 'My House');
    const matches = getAllByText('Create House');
    fireEvent.press(matches[matches.length - 1]);
    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    // The dedicated per-code copy — NOT the generic "Couldn't create the house."
    // fallback — proving the code path resolves errors.codes.CLUB_006.
    expect(alertSpy).toHaveBeenCalledWith('Error', "You've reached the maximum of 3 houses.");
  });
});
