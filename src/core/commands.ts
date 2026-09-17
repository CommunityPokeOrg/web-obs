import type { Command } from './protocol';
import type { StudioEngine } from './studio';

export class CommandError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CommandError';
  }
}

export interface CommandDeps {
  /** epoch ms; defaults to Date.now() — injectable for tests */
  now?: number;
  /** side-effecting output control (start/stop record/stream), wired by the host app */
  onOutput?: (output: string, action: 'start' | 'stop') => void;
}

/**
 * Apply a remote/UI command to the engine. The same entry point serves the
 * local UI, the remote WebSocket channel, and the control CLI, so every
 * command path is validated and dispatched identically.
 *
 * Throws CommandError for unknown targets or malformed payloads.
 */
export function applyCommand(engine: StudioEngine, command: Command, deps: CommandDeps = {}): void {
  const sceneId = (id: string | undefined) => id ?? engine.state.programSceneId ?? undefined;

  switch (command.type) {
    case 'set_preview_scene':
      engine.setPreviewScene(command.sceneId);
      return;
    case 'transition':
      engine.transition(command.mode ?? 'fade', deps.now);
      return;
    case 'set_item_visible': {
      const sid = sceneId(command.sceneId);
      if (!sid) throw new CommandError('no_program', 'no program scene to toggle in');
      engine.setItemVisible(sid, command.sourceId, command.visible);
      return;
    }
    case 'set_item_transform': {
      const sid = sceneId(command.sceneId);
      if (!sid) throw new CommandError('no_program', 'no program scene to transform in');
      engine.patchItemTransform(sid, command.sourceId, command.transform);
      return;
    }
    case 'set_source_enabled':
      engine.setSourceEnabled(command.sourceId, command.enabled);
      return;
    case 'set_source_volume':
      engine.setSourceVolume(command.sourceId, command.volume);
      return;
    case 'set_source_muted':
      engine.setSourceMuted(command.sourceId, command.muted);
      return;
    case 'set_text':
      engine.setSourceText(command.sourceId, command.text);
      return;
    case 'trigger_overlay':
      engine.triggerOverlay(command.overlayId, deps.now ?? Date.now());
      return;
    case 'set_output':
      if (!deps.onOutput) throw new CommandError('unsupported', 'output control not wired here');
      deps.onOutput(command.output, command.action);
      return;
    default: {
      const never: never = command;
      throw new CommandError('unknown_command', `unsupported command ${(never as { type: string }).type}`);
    }
  }
}
