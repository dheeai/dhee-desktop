/**
 * PlansOverlay — wraps PlansView. Reads the optional file-to-open
 * from the overlay's payload (set when chat or canvas opens this
 * overlay to focus a specific file).
 */
import PlansView from '../../components/preview/PlansView/PlansView';
import { useOverlay } from '../OverlayContext';

interface PlansPayload {
  filePath?: string;
}

export default function PlansOverlay() {
  const { payload, close } = useOverlay();
  const p = (payload ?? {}) as PlansPayload;
  return (
    <PlansView
      fileToOpen={p.filePath ?? null}
      onFileOpened={close}
    />
  );
}
