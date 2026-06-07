import React from 'react';
import { renderScreen, screen, fireEvent, waitFor } from '@/test-utils/renderScreen';
import { i18n } from '@/core/i18n';
import { useUpcomingEvents, useMyEvents, useRsvp, useCancelRsvp } from '../../hooks/useEvents';
import type { ScheduledEvent } from '../../services/eventService';
import { EventsScreen } from './EventsScreen';

jest.mock('../../hooks/useEvents', () => {
  const actual = jest.requireActual('../../hooks/useEvents');
  return {
    ...actual,
    useUpcomingEvents: jest.fn(),
    useMyEvents: jest.fn(),
    useRsvp: jest.fn(),
    useCancelRsvp: jest.fn(),
  };
});

const mockUseUpcomingEvents = useUpcomingEvents as unknown as jest.Mock;
const mockUseMyEvents = useMyEvents as unknown as jest.Mock;
const mockUseRsvp = useRsvp as unknown as jest.Mock;
const mockUseCancelRsvp = useCancelRsvp as unknown as jest.Mock;

const makeEvent = (over: Partial<ScheduledEvent> = {}): ScheduledEvent => ({
  id: 'e1',
  title: 'Building in public',
  description: null,
  hostId: 'u1',
  clubId: null,
  scheduledFor: new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
  isLive: false,
  isPrivate: false,
  rsvpCount: 3,
  host: {
    id: 'u1',
    username: 'jane',
    displayName: 'Jane Doe',
    avatarUrl: null,
  },
  ...over,
});

const queryState = (over: Record<string, unknown> = {}) => ({
  data: undefined,
  isLoading: false,
  isError: false,
  isFetching: false,
  isRefetching: false,
  error: null,
  refetch: jest.fn(),
  ...over,
});

const mutationState = (over: Record<string, unknown> = {}) => ({
  mutate: jest.fn(),
  mutateAsync: jest.fn().mockResolvedValue(undefined),
  isPending: false,
  isError: false,
  reset: jest.fn(),
  ...over,
});

describe('EventsScreen', () => {
  beforeEach(() => {
    mockUseUpcomingEvents.mockReset();
    mockUseMyEvents.mockReset();
    mockUseRsvp.mockReset();
    mockUseCancelRsvp.mockReset();

    mockUseUpcomingEvents.mockReturnValue(queryState());
    mockUseMyEvents.mockReturnValue(queryState({ data: [] }));
    mockUseRsvp.mockReturnValue(mutationState());
    mockUseCancelRsvp.mockReturnValue(mutationState());
  });

  it('renders the header title and both tabs', () => {
    mockUseUpcomingEvents.mockReturnValue(queryState({ data: [] }));
    renderScreen(<EventsScreen />);

    expect(screen.getByText(i18n.t('events.title'))).toBeTruthy();
    expect(screen.getByText(i18n.t('events.tabs.upcoming'))).toBeTruthy();
    expect(screen.getByText(i18n.t('events.tabs.mine'))).toBeTruthy();
  });

  it('shows the loader while the active list is loading', () => {
    mockUseUpcomingEvents.mockReturnValue(queryState({ isLoading: true }));
    renderScreen(<EventsScreen />);

    expect(screen.getByLabelText(i18n.t('events.title'))).toBeTruthy();
  });

  it('shows the empty state when there are no upcoming events', () => {
    mockUseUpcomingEvents.mockReturnValue(queryState({ data: [] }));
    renderScreen(<EventsScreen />);

    expect(screen.getByText(i18n.t('events.empty'))).toBeTruthy();
  });

  it('renders an event card with its RSVP action when loaded', async () => {
    const event = makeEvent();
    mockUseUpcomingEvents.mockReturnValue(queryState({ data: [event] }));
    renderScreen(<EventsScreen />);

    expect(await screen.findByText(event.title)).toBeTruthy();
    expect(screen.getByLabelText(`${i18n.t('events.notRsvp')} · ${event.title}`)).toBeTruthy();
  });

  it('calls the rsvp mutation when the RSVP button is pressed', async () => {
    const event = makeEvent();
    const mutate = jest.fn();
    mockUseUpcomingEvents.mockReturnValue(queryState({ data: [event] }));
    mockUseRsvp.mockReturnValue(mutationState({ mutate }));
    renderScreen(<EventsScreen />);

    fireEvent.press(await screen.findByLabelText(`${i18n.t('events.notRsvp')} · ${event.title}`));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith(event.id, expect.any(Object));
  });

  it('switches to the Mine tab and shows its empty state', async () => {
    mockUseUpcomingEvents.mockReturnValue(queryState({ data: [makeEvent()] }));
    mockUseMyEvents.mockReturnValue(queryState({ data: [] }));
    renderScreen(<EventsScreen />);

    fireEvent.press(screen.getByText(i18n.t('events.tabs.mine')));

    await waitFor(() => {
      expect(screen.getByText(i18n.t('events.emptyMine'))).toBeTruthy();
    });
  });

  it('goes back when the back button is pressed', () => {
    const { navigation } = renderScreen(<EventsScreen />);

    fireEvent.press(screen.getByLabelText(i18n.t('common.back')));

    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });
});
