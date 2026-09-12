/** Presentation only: stored taxonomy, post category IDs and legacy URLs stay intact. */
export function categoryDisplayId(id: string): string {
  return id === 'daily-stories' ? 'daily' : id;
}

export function categoryDisplayLabel(id: string, label: string): string {
  return id === 'daily' || id === 'daily-stories' ? '일상' : label;
}

export function categoryDisplayNodes<T extends { id: string; label: string; parentId: string | null }>(nodes: readonly T[]): T[] {
  const hasDaily = nodes.some((node) => node.id === 'daily');
  return nodes.filter((node) => node.id !== 'daily-stories' || !hasDaily).map((node) => ({
    ...node,
    label: categoryDisplayLabel(node.id, node.label),
    parentId: node.parentId ? categoryDisplayId(node.parentId) : null,
  }));
}

export function categoryDisplayNode<T extends { id: string; label: string; parentId: string | null }>(id: string, nodes: readonly T[]): T | undefined {
  const node = nodes.find((item) => item.id === categoryDisplayId(id)) ?? nodes.find((item) => item.id === id);
  return node ? { ...node, label: categoryDisplayLabel(node.id, node.label), parentId: node.parentId ? categoryDisplayId(node.parentId) : null } : undefined;
}

/** One editor choice, retaining the original ID when an existing alias post is saved. */
export function categoryEditorChoices<T extends { id: string; label: string; parentId: string | null }>(nodes: readonly T[], currentId?: string): T[] {
  // Self-contained so the editor can embed this same function in its client script.
  const hasDaily = nodes.some((node) => node.id === 'daily');
  return nodes.filter((node) => node.id !== 'daily-stories' || !hasDaily).map((node) => ({
    ...node,
    id: node.id === 'daily' && currentId === 'daily-stories' ? currentId : node.id,
    label: node.id === 'daily' || node.id === 'daily-stories' ? '일상' : node.label,
    parentId: node.parentId === 'daily-stories' ? 'daily' : node.parentId,
  }));
}
