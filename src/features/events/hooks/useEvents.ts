import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { eventService, type ScheduledEvent } from '../services/eventService';

export const eventKeys = {
  all: ['events'] as const,
  upcoming: (clubId?: string) => [...eventKeys.all, 'upcoming', clubId ?? 'none'] as const,
  mine: () => [...eventKeys.all, 'mine'] as const,
};

export const useUpcomingEvents = (clubId?: string) =>
  useQuery<ScheduledEvent[]>({
    queryKey: eventKeys.upcoming(clubId),
    queryFn: () => eventService.listUpcoming(clubId),
  });

export const useMyEvents = () =>
  useQuery<ScheduledEvent[]>({
    queryKey: eventKeys.mine(),
    queryFn: () => eventService.listMine(),
  });

export const useRsvp = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (eventId: string) => eventService.rsvp(eventId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: eventKeys.all });
    },
  });
};

export const useCancelRsvp = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (eventId: string) => eventService.cancelRsvp(eventId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: eventKeys.all });
    },
  });
};
