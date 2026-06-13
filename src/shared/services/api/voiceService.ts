import { apiClient } from './apiClient';

/**
 * Uploads a recorded voice clip to the backend and returns the remote URL the
 * clip was stored at. The caller then posts that URL to messageService.sendVoice
 * / groupService.sendVoice. Mirrors mediaService (avatars): base64 JSON, no
 * multipart, no extra native dependency.
 *
 * Backend: POST /api/upload/voice → { success, data: { url } }.
 */
interface VoiceUploadEnvelope {
  success?: boolean;
  data?: { url?: string };
  url?: string;
}

// Recorded file extension → audio MIME the backend whitelists. The recorder
// (react-native-audio-recorder-player, MPEG-4/AAC) yields a .mp4 file on
// Android; the rest are tolerated so a different codec still uploads.
const EXT_MIME: Record<string, string> = {
  m4a: 'audio/m4a',
  mp4: 'audio/mp4',
  caf: 'audio/x-caf',
  aac: 'audio/aac',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  webm: 'audio/webm',
  '3gp': 'audio/3gpp',
};

const mimeForUri = (uri: string): string => {
  const path = uri.split('?')[0] ?? uri;
  const ext = (path.split('.').pop() ?? '').toLowerCase();
  return EXT_MIME[ext] ?? 'audio/m4a';
};

/**
 * Read a local `file://` URI into a base64 string without expo-file-system:
 * fetch() resolves local files in React Native, and FileReader.readAsDataURL
 * yields a `data:<mime>;base64,<payload>` URL whose payload we strip.
 */
const fileToBase64 = async (uri: string): Promise<string> => {
  const response = await fetch(uri);
  const blob = await response.blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const commaIndex = result.indexOf(',');
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error('Could not read the recording'));
    };
    reader.readAsDataURL(blob);
  });
};

export const voiceService = {
  /**
   * Upload a recorded clip (local file:// URI) and return the stored https URL.
   * Given a generous 60s timeout like the avatar upload, since a base64 audio
   * body is large and slow on a poor connection.
   */
  async upload(uri: string): Promise<string> {
    const base64 = await fileToBase64(uri);
    const mime = mimeForUri(uri);
    const res = await apiClient.post<VoiceUploadEnvelope>(
      '/upload/voice',
      { base64, mime },
      { timeout: 60_000 },
    );
    const url = res.data?.data?.url ?? res.data?.url;
    if (!url) {
      throw new Error('Voice upload failed: no URL returned');
    }
    return url;
  },
};
