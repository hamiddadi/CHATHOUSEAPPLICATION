import { useQuery } from '@tanstack/react-query';
import { suggestionsApi } from '../api/suggestionsApi';

export const extSuggestionsKey = (limit: number) => ['ext', 'suggestions', limit] as const;

export const useExtSuggestions = (limit = 20) =>
  useQuery({
    queryKey: extSuggestionsKey(limit),
    queryFn: () => suggestionsApi.list(limit),
    staleTime: 60_000,
  });
