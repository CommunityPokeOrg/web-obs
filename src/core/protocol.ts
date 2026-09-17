/**
 * App-side view of the shared wire protocol. The canonical implementation
 * lives in shared/protocol.js so the Node server and CLI tools use the
 * exact same validators without a build step.
 */
export {
  WIRE_VERSION,
  ROLES,
  COMMANDS,
  makeId,
  isCommand,
  parseMessage,
  encode,
  hello,
  cmd,
  ack,
  state,
  err,
} from '../../shared/protocol.js';
export type {
  Command,
  WireMessage,
  ParseResult,
  Role,
  FeedInfo,
  TransformPatch,
  TransitionMode as WireTransitionMode,
} from '../../shared/protocol.js';
