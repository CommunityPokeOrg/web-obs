/**
 * Canonical wire protocol for web-obs, shared by:
 *   - the studio web app (src/)
 *   - the relay server (server/server.mjs)
 *   - the capture daemon and control CLI (tools/)
 *
 * Pure ESM, zero dependencies — runs in browsers and Node.
 *
 * All messages are JSON text frames unless stated otherwise. Capture video
 * frames are binary frames (one JPEG per message) and are relayed verbatim.
 */

export const WIRE_VERSION = 1;

export const ROLES = /** @type {const} */ (['studio', 'controller', 'capture', 'viewer']);

export const COMMANDS = /** @type {const} */ ([
  'set_preview_scene',
  'transition',
  'set_item_visible',
  'set_item_transform',
  'set_source_enabled',
  'set_source_volume',
  'set_source_muted',
  'set_text',
  'trigger_overlay',
  'set_output',
]);

let counter = 0;

/** Short unique-enough message id (not cryptographic). */
export function makeId(prefix = 'm') {
  counter = (counter + 1) & 0xffff;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
}

/** @param {unknown} v @returns {v is Record<string, unknown>} */
function isObj(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isStr(v) {
  return typeof v === 'string';
}

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Validate a remote command object.
 * @param {unknown} c
 * @returns {c is import('./protocol.d.ts').Command} — false safe; see .d.ts for the type
 */
export function isCommand(c) {
  if (!isObj(c) || !isStr(c.type)) return false;
  switch (c.type) {
    case 'set_preview_scene':
      return isStr(c.sceneId);
    case 'transition':
      return c.mode === undefined || c.mode === 'cut' || c.mode === 'fade';
    case 'set_item_visible':
      return isStr(c.sourceId) && (c.sceneId === undefined || isStr(c.sceneId)) && typeof c.visible === 'boolean';
    case 'set_item_transform':
      return (
        isStr(c.sourceId) &&
        (c.sceneId === undefined || isStr(c.sceneId)) &&
        isObj(c.transform) &&
        ['x', 'y', 'width', 'height'].every((k) => c.transform[k] === undefined || isNum(c.transform[k]))
      );
    case 'set_source_enabled':
      return isStr(c.sourceId) && typeof c.enabled === 'boolean';
    case 'set_source_volume':
      return isStr(c.sourceId) && isNum(c.volume) && c.volume >= 0 && c.volume <= 1;
    case 'set_source_muted':
      return isStr(c.sourceId) && typeof c.muted === 'boolean';
    case 'set_text':
      return isStr(c.sourceId) && isStr(c.text);
    case 'trigger_overlay':
      return isStr(c.overlayId);
    case 'set_output':
      return isStr(c.output) && (c.action === 'start' || c.action === 'stop');
    default:
      return false;
  }
}

const SIMPLE_KINDS = {
  welcome: (m) => isStr(m.role) && isStr(m.room),
  error: (m) => isStr(m.code) && isStr(m.message),
  cmd: (m) => isStr(m.id) && isCommand(m.command) && (m.cid === undefined || isStr(m.cid)),
  ack: (m) => isStr(m.id) && typeof m.ok === 'boolean' && (m.error === undefined || isStr(m.error)),
  state: (m) => isObj(m.snapshot),
  feeds: (m) => Array.isArray(m.feeds) && m.feeds.every((f) => isObj(f) && isStr(f.id) && isStr(f.label)),
};

/**
 * Parse and validate a text frame.
 * @param {string|unknown} data raw frame (string) or already-parsed value
 * @returns {{ ok: true, msg: object } | { ok: false, error: string }}
 */
export function parseMessage(data) {
  let m = data;
  if (typeof data === 'string') {
    try {
      m = JSON.parse(data);
    } catch {
      return { ok: false, error: 'invalid JSON' };
    }
  }
  if (!isObj(m) || !isStr(m.kind)) return { ok: false, error: 'missing kind' };
  switch (m.kind) {
    case 'hello':
      if (m.v !== WIRE_VERSION) return { ok: false, error: `protocol version ${m.v} != ${WIRE_VERSION}` };
      if (!ROLES.includes(m.role)) return { ok: false, error: 'invalid role' };
      if (!isStr(m.room) || !isStr(m.token)) return { ok: false, error: 'hello needs room and token' };
      if ((m.role === 'capture' || m.role === 'viewer') && !isStr(m.feedId)) {
        return { ok: false, error: `${m.role} hello needs feedId` };
      }
      return { ok: true, msg: m };
    default: {
      const check = SIMPLE_KINDS[m.kind];
      if (!check) return { ok: false, error: `unknown kind ${m.kind}` };
      return check(m) ? { ok: true, msg: m } : { ok: false, error: `malformed ${m.kind}` };
    }
  }
}

/** @param {object} msg @returns {string} */
export function encode(msg) {
  return JSON.stringify(msg);
}

/** Build a hello message. */
export function hello(role, room, token, extra = {}) {
  return { kind: 'hello', v: WIRE_VERSION, role, room, token, ...extra };
}

/** Build a cmd message. */
export function cmd(command, id = makeId('c'), cid) {
  const m = { kind: 'cmd', id, command };
  if (cid) m.cid = cid;
  return m;
}

/** Build an ack message. */
export function ack(id, ok, error, cid) {
  const m = { kind: 'ack', id, ok };
  if (error !== undefined) m.error = error;
  if (cid) m.cid = cid;
  return m;
}

/** Build a state message. */
export function state(snapshot) {
  return { kind: 'state', snapshot };
}

/** Build an error message. */
export function err(code, message) {
  return { kind: 'error', code, message };
}
