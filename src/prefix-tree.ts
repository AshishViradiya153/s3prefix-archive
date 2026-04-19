/**
 * Lightweight **prefix tree** over S3-style keys (`/` segments). Used for virtual-folder views and
 * incremental “lazy” tree building while listing — no full in-memory key array required if you insert
 * per yielded key.
 */

export interface PrefixTreeNode {
  readonly children: Map<string, PrefixTreeNode>;
  /** True when this node completes a full key (leaf path). */
  isKey: boolean;
}

function createNode(): PrefixTreeNode {
  return { children: new Map(), isKey: false };
}

/**
 * Insert one object key; segments split on `'/'`, empty segments skipped.
 */
export function insertKeyIntoPrefixTree(
  root: PrefixTreeNode,
  key: string,
): void {
  const parts = key.split("/").filter((p) => p.length > 0);
  let cur = root;
  for (const seg of parts) {
    let next = cur.children.get(seg);
    if (!next) {
      next = createNode();
      cur.children.set(seg, next);
    }
    cur = next;
  }
  cur.isKey = true;
}

/** Empty tree root. */
export function createPrefixTreeRoot(): PrefixTreeNode {
  return createNode();
}

/**
 * Build a tree from an iterable of keys (e.g. listing). For huge prefixes, prefer calling
 * {@link insertKeyIntoPrefixTree} per key from the async iterator instead of materializing all keys.
 */
export function buildPrefixTreeFromKeys(
  keys: Iterable<string>,
): PrefixTreeNode {
  const root = createPrefixTreeRoot();
  for (const k of keys) {
    insertKeyIntoPrefixTree(root, k);
  }
  return root;
}

/** Count leaf keys marked with `isKey`. */
export function countPrefixTreeKeys(root: PrefixTreeNode): number {
  let n = root.isKey ? 1 : 0;
  for (const child of root.children.values()) {
    n += countPrefixTreeKeys(child);
  }
  return n;
}
