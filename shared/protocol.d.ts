/** Type declarations for shared/protocol.js */

export const WIRE_VERSION: number;
export const ROLES: readonly ['studio', 'controller', 'capture', 'viewer'];
export const COMMANDS: readonly string[];

export type Role = (typeof ROLES)[number];
export type TransitionMode = 'cut' | 'fade';

export interface TransformPatch {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export type Command =
  | { type: 'set_preview_scene'; sceneId: string }
  | { type: 'transition'; mode?: TransitionMode }
  | { type: 'set_item_visible'; sourceId: string; sceneId?: string; visible: boolean }
  | { type: 'set_item_transform'; sourceId: string; sceneId?: string; transform: TransformPatch }
  | { type: 'set_source_enabled'; sourceId: string; enabled: boolean }
  | { type: 'set_source_volume'; sourceId: string; volume: number }
  | { type: 'set_source_muted'; sourceId: string; muted: boolean }
  | { type: 'set_text'; sourceId: string; text: string }
  | { type: 'trigger_overlay'; overlayId: string }
  | { type: 'set_output'; output: string; action: 'start' | 'stop' };

export interface FeedInfo {
  id: string;
  label: string;
}

export type WireMessage =
  | { kind: 'hello'; v: number; role: Role; room: string; token: string; feedId?: string; label?: string }
  | { kind: 'welcome'; role: Role; room: string }
  | { kind: 'error'; code: string; message: string }
  | { kind: 'cmd'; id: string; command: Command; cid?: string }
  | { kind: 'ack'; id: string; ok: boolean; error?: string; cid?: string }
  | { kind: 'state'; snapshot: unknown }
  | { kind: 'feeds'; feeds: FeedInfo[] };

export type ParseResult = { ok: true; msg: WireMessage } | { ok: false; error: string };

export function makeId(prefix?: string): string;
export function isCommand(c: unknown): c is Command;
export function parseMessage(data: string | unknown): ParseResult;
export function encode(msg: WireMessage | Record<string, unknown>): string;
export function hello(
  role: Role,
  room: string,
  token: string,
  extra?: Record<string, unknown>,
): WireMessage;
export function cmd(command: Command, id?: string, cid?: string): WireMessage;
export function ack(id: string, ok: boolean, error?: string, cid?: string): WireMessage;
export function state(snapshot: unknown): WireMessage;
export function err(code: string, message: string): WireMessage;
