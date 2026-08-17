export type ContentReportReason = 'spam' | 'harassment' | 'other';

export interface ContentReportResult {
  reportId: string;
  alreadyReported: boolean;
}
