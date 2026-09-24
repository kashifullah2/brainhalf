import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useModalFocus } from '../lib/use-modal-focus';
import PublicationControls from './PublicationControls';
import type { SourceFiles } from '../runtime/types';

export default function PublishDialog({ projectId, files, publishOnOpen, onClose, onManage }: { projectId: string; files: SourceFiles; publishOnOpen?: SourceFiles; onClose: () => void; onManage: () => void }) {
  const ref = useModalFocus(true, onClose);
  return createPortal(<div className="publication-dialog-backdrop"><div ref={ref} className="publication-dialog" role="dialog" aria-modal="true" aria-labelledby="publish-title" tabIndex={-1}>
    <header><h2 id="publish-title">Publish your app</h2><button type="button" aria-label="Close publishing" onClick={onClose}><X size={19} /></button></header>
    <PublicationControls key={projectId} projectId={projectId} files={files} publishOnOpen={publishOnOpen} onManage={onManage} />
  </div></div>, document.body);
}
