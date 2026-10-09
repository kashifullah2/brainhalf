import { AlertTriangle } from 'lucide-react';

const MESSAGES: Record<'rows' | 'bytes', string> = {
  rows: 'Preview data has too many rows to save across restarts. Delete some rows to restore persistence.',
  bytes: 'One or more preview tables are too large to save across restarts. Remove large data to restore persistence.',
};

export function PreviewStoreCappedBanner({ reason }: { reason: 'rows' | 'bytes' | null }) {
  if (reason === null) return null;
  return (
    <div className="preview-health-strip has-warning" role="status">
      <AlertTriangle size={15} />
      <span>{MESSAGES[reason]}</span>
    </div>
  );
}
