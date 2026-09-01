/**
 * Condition tree evaluated against a trigger's record.
 *
 *   { all: [ { field: 'score', op: 'gte', value: 70 },
 *            { any: [ {...}, {...} ] } ] }
 *
 * An empty tree matches everything, so a workflow with no conditions always
 * runs.
 */

export type ConditionOp =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'contains'
  | 'not_contains'
  | 'is_empty'
  | 'is_not_empty'
  | 'in';

export interface ConditionLeaf {
  field: string;
  op: ConditionOp;
  value?: unknown;
}

export interface ConditionGroup {
  all?: ConditionNode[];
  any?: ConditionNode[];
}

export type ConditionNode = ConditionLeaf | ConditionGroup;

export const CONDITION_OPS: ConditionOp[] = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'contains',
  'not_contains',
  'is_empty',
  'is_not_empty',
  'in',
];

/** Reads "contact.owner.id" style paths off the record. */
function valueAt(record: Record<string, unknown>, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (acc, key) =>
        acc && typeof acc === 'object'
          ? (acc as Record<string, unknown>)[key]
          : undefined,
      record,
    );
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isNaN(n) ? null : n;
  }
  // Prisma Decimal and Date both serialise usefully via valueOf/toString.
  if (value instanceof Date) return value.getTime();
  return null;
}

function isEmpty(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  );
}

function compare(actual: unknown, op: ConditionOp, expected: unknown): boolean {
  switch (op) {
    case 'eq':
      return String(actual) === String(expected);
    case 'neq':
      return String(actual) !== String(expected);
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const a = asNumber(actual);
      const b = asNumber(expected);
      if (a === null || b === null) return false;
      if (op === 'gt') return a > b;
      if (op === 'gte') return a >= b;
      if (op === 'lt') return a < b;
      return a <= b;
    }
    case 'contains':
      return String(actual ?? '')
        .toLowerCase()
        .includes(String(expected ?? '').toLowerCase());
    case 'not_contains':
      return !String(actual ?? '')
        .toLowerCase()
        .includes(String(expected ?? '').toLowerCase());
    case 'is_empty':
      return isEmpty(actual);
    case 'is_not_empty':
      return !isEmpty(actual);
    case 'in':
      return Array.isArray(expected)
        ? expected.map(String).includes(String(actual))
        : false;
    default:
      return false;
  }
}

function isGroup(node: ConditionNode): node is ConditionGroup {
  return (
    Array.isArray((node as ConditionGroup).all) ||
    Array.isArray((node as ConditionGroup).any)
  );
}

/** True when the record satisfies the tree. An empty tree always matches. */
export function evaluateConditions(
  node: ConditionNode | null | undefined,
  record: Record<string, unknown>,
): boolean {
  if (!node) return true;

  if (isGroup(node)) {
    const { all, any } = node;
    if (
      all?.length &&
      !all.every((child) => evaluateConditions(child, record))
    ) {
      return false;
    }
    if (
      any?.length &&
      !any.some((child) => evaluateConditions(child, record))
    ) {
      return false;
    }
    return true;
  }

  if (!node.field || !node.op) return true;
  return compare(valueAt(record, node.field), node.op, node.value);
}
