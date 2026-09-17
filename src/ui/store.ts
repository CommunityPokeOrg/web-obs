import { useSyncExternalStore } from 'react';
import type { StudioEngine } from '../core/studio';
import type { StudioState } from '../core/types';

/** Subscribe a component to the whole studio state (re-renders on change). */
export function useStudio(engine: StudioEngine): StudioState {
  return useSyncExternalStore(
    (cb) => engine.changed.subscribe(cb),
    () => engine.state,
    () => engine.state,
  );
}
