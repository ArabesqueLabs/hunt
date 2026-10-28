// The shapes the API sends, as the UI reads them. Records carry more than is
// named here: what a page doesn't name, it reads as `any`.

/** A record of any resource, as the API sends it. */
export type Row = Record<string, any>;

/** A field of a resource, from /api/meta. */
export interface FieldDef {
  name: string;
  label: string;
  type: string;
  required?: boolean;
  defaulted?: boolean;
  readonly?: boolean;
  placeholder?: string;
  options: [string, string][];
  resource?: string;
  suggest?: boolean;
  group?: string;
  short?: string;
}

/** A resource the API serves, from /api/meta. */
export interface ResourceDef {
  name: string;
  entity: string;
  title: string;
  fields: FieldDef[];
}

export interface Choice { value: string; label: string; stage_id?: number }

export interface Meta {
  version: string;
  access: { email: string | null } | null;
  tenancy: Row | null;
  terms: boolean;
  password: boolean;
  site: string | null;
  operator: string | null;
  /** What the admins say of this hunt, to everyone: its name, a notice on every page, an address for help. */
  about: { name: string | null; announcement: string | null; contact: string | null; url: string | null };
  /** How long a toast with Undo stays, in seconds; 0, until it's used or dismissed. */
  undo_seconds: number;
  experiments: string[];
  resources: ResourceDef[];
  archive_reasons: Choice[];
  closed_stages: { id: number; name: string }[];
  same_name: Choice[];
  tag_colors: Choice[];
  languages: Choice[];
  [key: string]: any;
}

export interface Tag { id: number; name: string; color: string | null; [key: string]: any }

export interface Cycle {
  id: number;
  name: string;
  description: string | null;
  started_on: string;
  ended_on: string | null;
  outcome: string | null;
  outcome_note: string | null;
  counts: Record<string, number>;
  [key: string]: any;
}

/** A process on the board, as a card. */
export type Card = Row;

export interface Stage {
  id: number;
  name: string;
  position: number;
  active: number;
  folded?: boolean | number | null;
  swimlane_id?: number | null;
  lanes?: Row[];
  cards: Card[];
  [key: string]: any;
}

export interface Board {
  stages: Stage[];
  closed_stages?: Stage[];
  archived: Card[];
  archived_total: number;
  swimlanes?: Row[];
  read_only?: boolean;
  [key: string]: any;
}
