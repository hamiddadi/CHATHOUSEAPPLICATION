/**
 * Render-test for EventsScreen. Mounts the "Upcoming" list (primed via
 * seedQueryData against `eventKeys.upcoming()`) and exercises the header back,
 * the Upcoming/Mine tab pills, the RSVP toggle, the host-only "Cancel event"
 * (which opens a confirm Alert), and the calendar export button. Native modules
 * are globally mocked in jest-setup.
 */
import React from 'react';
import { Alert } from 'react-native';
import { fireEvent } from '@testing-library/react-native';
import { eventKeys } from '../../hooks/useEvents';
import type { ScheduledEvent } from '../../services/eventService';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../../test-utils/renderScreen';
import { EventsScreen } from './EventsScreen';

const VIEWER_ID = 'user-test-1';

const makeEvent = (overrides: Partial<ScheduledEvent> = {}): ScheduledEvent => ({
  id: 'event-1',
  title: 'Friday Founders AMA',
  description: null,
  hostId: 'host-other',
  clubId: null,
  scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
  isLive: false,
  isPrivate: false,
  rsvpCount: 5,
  host: { id: 'host-other', username: 'host', displayName: 'The Host', avatarUrl: null },
  ...overrides,
});

const seedUpcoming = (events: ScheduledEvent[]) => [
  { key: [...eventKeys.upcoming()], data: events },
];

describe('EventsScreen', () => {
  beforeEach(() => {
    mockAuthenticated({ id: VIEWER_ID });
  });
  afterEach(() => {
    resetAuth();
    jest.restoreAllMocks();
  });

  it('mounts with the Events title and both tabs', () => {
    const { getByText, toJSON } = renderScreen(<EventsScreen />, {
      route: { name: 'Events', params: {} },
      seedQueryData: seedUpcoming([makeEvent()]),
    });
    expect(toJSON()).toBeTruthy();
    expect(getByText('Events')).toBeTruthy();
    expect(getByText('Upcoming')).toBeTruthy();
    expect(getByText('Mine')).toBeTruthy();
  });

  it('renders the seeded upcoming event card', () => {
    const { getByText } = renderScreen(<EventsScreen />, {
      route: { name: 'Events', params: {} },
      seedQueryData: seedUpcoming([makeEvent()]),
    });
    expect(getByText('Friday Founders AMA')).toBeTruthy();
  });

  it('shows the empty state when there are no upcoming events', () => {
    const { getByText } = renderScreen(<EventsScreen />, {
      route: { name: 'Events', params: {} },
      seedQueryData: seedUpcoming([]),
    });
    expect(getByText('No upcoming events')).toBeTruthy();
  });

  it('header back button calls navigation.goBack', () => {
    const { getByLabelText, navigation } = renderScreen(<EventsScreen />, {
      route: { name: 'Events', params: {} },
      seedQueryData: seedUpcoming([makeEvent()]),
    });
    fireEvent.press(getByLabelText('Back'));
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('switching to the "Mine" tab shows its empty state without crashing', () => {
    const { getByText } = renderScreen(<EventsScreen />, {
      route: { name: 'Events', params: {} },
      // Seed the 'mine' key with [] so the query resolves empty (an unseeded
      // query stays pending → loader, never the empty state).
      seedQueryData: [...seedUpcoming([makeEvent()]), { key: [...eventKeys.mine()], data: [] }],
    });
    fireEvent.press(getByText('Mine'));
    expect(getByText("You haven't RSVP'd to anything yet.")).toBeTruthy();
  });

  it('RSVP toggle fires without throwing', () => {
    const { getByLabelText } = renderScreen(<EventsScreen />, {
      route: { name: 'Events', params: {} },
      seedQueryData: seedUpcoming([makeEvent()]),
    });
    // Event not in "mine" → isMine false → label uses notRsvp ("RSVP").
    expect(() => fireEvent.press(getByLabelText('RSVP · Friday Founders AMA'))).not.toThrow();
  });

  it('calendar export button mounts and is pressable without throwing', () => {
    const { getByLabelText } = renderScreen(<EventsScreen />, {
      route: { name: 'Events', params: {} },
      seedQueryData: seedUpcoming([makeEvent()]),
    });
    expect(() => fireEvent.press(getByLabelText('Add to calendar'))).not.toThrow();
  });

  it('host-only "Cancel event" opens a confirmation Alert', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { getByLabelText } = renderScreen(<EventsScreen />, {
      route: { name: 'Events', params: {} },
      // hostId === viewer → isHost true → the cancel button renders.
      seedQueryData: seedUpcoming([makeEvent({ hostId: VIEWER_ID })]),
    });
    fireEvent.press(getByLabelText('Cancel event · Friday Founders AMA'));
    expect(alertSpy).toHaveBeenCalled();
  });

  it('renders the loader while the upcoming query is pending (no seed)', () => {
    const { getByLabelText } = renderScreen(<EventsScreen />, {
      route: { name: 'Events', params: {} },
    });
    expect(getByLabelText('Events')).toBeTruthy();
  });
});
