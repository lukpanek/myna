/**
 * Types of the mautrix bridgev2 provisioning API (`/_matrix/provision/v3`).
 * Source of truth: mautrix-go bridgev2/matrix/provisioning.yaml and bridgev2/login.go.
 */

export interface LoginFlow {
  id: string;
  name: string;
  description: string;
}

export interface BridgeName {
  displayname: string;
  network_url?: string;
  network_icon?: string;
  network_id: string;
  beeper_bridge_type?: string;
}

export type BridgeStateEvent =
  | 'STARTING'
  | 'UNCONFIGURED'
  | 'RUNNING'
  | 'BRIDGE_UNREACHABLE'
  | 'CONNECTING'
  | 'BACKFILLING'
  | 'CONNECTED'
  | 'TRANSIENT_DISCONNECT'
  | 'BAD_CREDENTIALS'
  | 'UNKNOWN_ERROR'
  | 'LOGGED_OUT'
  | '';

export interface BridgeState {
  state_event: BridgeStateEvent;
  timestamp?: number;
  ttl?: number;
  source?: string;
  error?: string;
  message?: string;
  user_action?: 'OPEN_NATIVE' | 'RELOGIN' | 'RESTART' | string;
  reason?: string;
  info?: Record<string, unknown>;
}

export interface RemoteProfile {
  name?: string;
  username?: string;
  phone?: string;
  email?: string;
  avatar?: string;
}

export interface WhoamiLogin {
  id: string;
  name: string;
  profile?: RemoteProfile;
  state?: BridgeState;
  space_room?: string;
}

export interface Whoami {
  network: BridgeName;
  login_flows: LoginFlow[];
  homeserver: string;
  bridge_bot: string;
  command_prefix: string;
  management_room?: string;
  logins: WhoamiLogin[] | null;
}

export interface ResolveIdentifierCapabilities {
  create_dm?: boolean;
  lookup_phone?: boolean;
  lookup_email?: boolean;
  lookup_username?: boolean;
  any_phone?: boolean;
  contact_list?: boolean;
  search?: boolean;
}

export interface ProvisioningCapabilities {
  resolve_identifier?: ResolveIdentifierCapabilities;
  group_creation?: Record<string, unknown>;
}

// ── Login steps ─────────────────────────────────────────────────────────────

export type InputFieldType =
  | 'username'
  | 'phone_number'
  | 'email'
  | 'password'
  | '2fa_code'
  | 'token'
  | 'url'
  | 'domain'
  | 'select'
  | 'captcha_code';

export interface InputField {
  type: InputFieldType;
  id: string;
  name: string;
  description?: string;
  default_value?: string;
  pattern?: string;
  min_length?: number;
  max_length?: number;
  options?: string[];
}

export interface InputAttachment {
  type?: string;
  filename?: string;
  /** Base64 (Go []byte). */
  content?: string;
  info?: { mimetype?: string; w?: number; h?: number; size?: number };
}

export interface UserInputParams {
  fields: InputField[];
  attachments?: InputAttachment[] | null;
  can_cancel?: boolean;
}

export interface DisplayAndWaitParams {
  type: 'qr' | 'emoji' | 'code' | 'nothing';
  data?: string;
  image_url?: string;
  can_cancel?: boolean;
}

export type CookieSourceType = 'cookie' | 'local_storage' | 'request_header' | 'request_body' | 'special';

export interface CookieFieldSource {
  type: CookieSourceType;
  name: string;
  request_url_regex?: string;
  cookie_domain?: string;
}

export interface CookieField {
  id: string;
  required: boolean;
  sources: CookieFieldSource[];
  pattern?: string;
}

export interface CookiesParams {
  url: string;
  user_agent?: string;
  fields: CookieField[];
  extract_js?: string;
  wait_for_url_pattern?: string;
  hidden?: boolean;
  initial_cookies?: { name: string; value: string; domain: string; path?: string }[];
}

export interface CompleteParams {
  user_login_id: string;
}

interface BaseStep {
  step_id: string;
  txn_id?: string;
  instructions?: string;
}

export type LoginStep =
  | (BaseStep & { type: 'user_input'; user_input: UserInputParams })
  | (BaseStep & { type: 'display_and_wait'; display_and_wait: DisplayAndWaitParams })
  | (BaseStep & { type: 'cookies'; cookies: CookiesParams })
  | (BaseStep & { type: 'complete'; complete?: CompleteParams })
  | (BaseStep & { type: 'webauthn' | 'client_http' });

/** Response of login/start and login/step: the next step plus the login process id. */
export type LoginStepResponse = LoginStep & { login_id: string };

export type SubmittableStepType = 'user_input' | 'cookies' | 'display_and_wait';

// ── Starting chats ──────────────────────────────────────────────────────────

export interface ResolvedIdentifier {
  /** Remote network user id. */
  id: string;
  name?: string;
  avatar_url?: string;
  /** e.g. `tel:+420…`, `username:…` */
  identifiers?: string[];
  /** Ghost Matrix user id. */
  mxid?: string;
  dm_room_mxid?: string;
}

export interface MautrixWellKnown {
  'fi.mau.bridges'?: unknown;
  'fi.mau.external_bridge_servers'?: unknown;
}
