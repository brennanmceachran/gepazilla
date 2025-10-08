export type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JsonValue }
  | JsonValue[];

export type GatewayProviderOptions = Record<string, Record<string, JsonValue>>;
