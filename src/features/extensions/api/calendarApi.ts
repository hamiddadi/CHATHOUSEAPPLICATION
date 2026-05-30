import { apiClient } from '../../../shared/services/api/apiClient';

export const calendarApi = {
  /**
   * Returns the public `.ics` URL for a scheduled event. The mobile client
   * passes this URL to `Linking.openURL()` so iOS opens it in Calendar.app
   * and Android in Google Calendar.
   */
  icsUrl(roomId: string): string {
    const base = (apiClient.defaults.baseURL ?? '').replace(/\/+$/, '');
    return `${base}/ext/calendar/${roomId}.ics`;
  },

  /**
   * Fetches the ICS content as a string (server-rendered). Use this if
   * you need to inspect the payload or attach it programmatically. The
   * `.ics` deep-link via `icsUrl()` is what most consumers want.
   */
  async fetchIcs(roomId: string): Promise<string> {
    const { data } = await apiClient.get<string>(`/ext/calendar/${roomId}.ics`, {
      responseType: 'text',
      transformResponse: [d => d as unknown as string],
    });
    return data;
  },
};
