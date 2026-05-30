import { apiClient } from './apiClient';

/**
 * Backend POST /api/upload/avatar returns the standard success envelope
 * `{ success: true, data: { url } }`. We tolerate a bare `{ url }` too in
 * case the route is ever changed to skip the envelope, so the screens don't
 * break on a backend tweak.
 */
interface AvatarUploadEnvelope {
  success?: boolean;
  data?: { url?: string };
  url?: string;
}

/**
 * Resolve the data URL prefix for an image. ImagePicker hands back a
 * `mimeType` like `image/jpeg`; default to jpeg when it's absent.
 */
const toDataUrl = (base64: string, mime?: string): string => {
  const type = mime && mime.length > 0 ? mime : 'image/jpeg';
  return `data:${type};base64,${base64}`;
};

export const mediaService = {
  /**
   * Upload a base64-encoded image as the user's avatar and return the REMOTE
   * https(s) URL the backend stored it at. `profileService.update` /
   * `completeOnboarding` only accept an http(s) URL (not a local `file://`
   * URI), so call this first and pass the returned URL through as avatarUrl.
   */
  async uploadAvatar(base64: string, mime?: string): Promise<string> {
    const res = await apiClient.post<AvatarUploadEnvelope>('/upload/avatar', {
      dataUrl: toDataUrl(base64, mime),
    });
    const url = res.data?.data?.url ?? res.data?.url;
    if (!url) {
      throw new Error('Upload failed: no URL returned');
    }
    return url;
  },
};
