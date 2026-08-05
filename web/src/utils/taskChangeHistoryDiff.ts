export type TaskChangeDiffKind = 'context' | 'added' | 'removed'

export interface TaskChangeDiffLine {
  kind: TaskChangeDiffKind
  value: string
}

export interface TaskChangeInlineDiffLine {
  before: TaskChangeDiffLine | null
  after: TaskChangeDiffLine | null
}

const MAX_LCS_CELLS = 160_000

function splitLines(value: string): string[] {
  return value.replace(/\r\n/g, '\n').split('\n')
}

/**
 * Produces a compact, line-oriented diff for task-description Markdown. A
 * bounded fallback avoids quadratic work for exceptionally large documents.
 */
export function diffTaskChangeMarkdown(before: string, after: string): TaskChangeDiffLine[] {
  const oldLines = splitLines(before)
  const newLines = splitLines(after)

  if (oldLines.length * newLines.length > MAX_LCS_CELLS) {
    return [
      ...oldLines.map(value => ({ kind: 'removed' as const, value })),
      ...newLines.map(value => ({ kind: 'added' as const, value })),
    ]
  }

  const rows = oldLines.length + 1
  const cols = newLines.length + 1
  const dp = Array.from({ length: rows }, () => new Uint32Array(cols))
  for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex -= 1) {
      dp[oldIndex][newIndex] = oldLines[oldIndex] === newLines[newIndex]
        ? dp[oldIndex + 1][newIndex + 1] + 1
        : Math.max(dp[oldIndex + 1][newIndex], dp[oldIndex][newIndex + 1])
    }
  }

  const output: TaskChangeDiffLine[] = []
  let oldIndex = 0
  let newIndex = 0
  while (oldIndex < oldLines.length && newIndex < newLines.length) {
    if (oldLines[oldIndex] === newLines[newIndex]) {
      output.push({ kind: 'context', value: oldLines[oldIndex] })
      oldIndex += 1
      newIndex += 1
    } else if (dp[oldIndex + 1][newIndex] >= dp[oldIndex][newIndex + 1]) {
      output.push({ kind: 'removed', value: oldLines[oldIndex] })
      oldIndex += 1
    } else {
      output.push({ kind: 'added', value: newLines[newIndex] })
      newIndex += 1
    }
  }
  while (oldIndex < oldLines.length) {
    output.push({ kind: 'removed', value: oldLines[oldIndex] })
    oldIndex += 1
  }
  while (newIndex < newLines.length) {
    output.push({ kind: 'added', value: newLines[newIndex] })
    newIndex += 1
  }
  return output
}

/** Pairs deletion/addition runs for the two-column Inline presentation. */
export function inlineTaskChangeDiff(lines: TaskChangeDiffLine[]): TaskChangeInlineDiffLine[] {
  const output: TaskChangeInlineDiffLine[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    if (line.kind === 'context') {
      output.push({ before: line, after: line })
      index += 1
      continue
    }

    const removed: TaskChangeDiffLine[] = []
    const added: TaskChangeDiffLine[] = []
    while (index < lines.length && lines[index].kind !== 'context') {
      if (lines[index].kind === 'removed') removed.push(lines[index])
      else added.push(lines[index])
      index += 1
    }
    const count = Math.max(removed.length, added.length)
    for (let pairIndex = 0; pairIndex < count; pairIndex += 1) {
      output.push({
        before: removed[pairIndex] ?? null,
        after: added[pairIndex] ?? null,
      })
    }
  }
  return output
}
