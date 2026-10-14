/** Align every candidate to the original by LCS, retaining insertions and deletions. */
export function alignStackKeys(stacks: number[][], same = (a: number, b: number) => a === b): (number | null)[][] {
  if (!stacks.length) return [];
  const base = stacks[0];
  const columns = stacks.slice(1).map(stack => {
    const dp = Array.from({length: base.length + 1}, () => new Uint32Array(stack.length + 1));
    for (let i = base.length - 1; i >= 0; i--) for (let j = stack.length - 1; j >= 0; j--)
      dp[i][j] = same(base[i], stack[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const gaps: number[][] = Array.from({length: base.length + 1}, () => []);
    const matches: (number | null)[] = Array(base.length).fill(null);
    let i = 0, j = 0;
    while (i < base.length && j < stack.length) {
      if (same(base[i], stack[j])) { matches[i++] = stack[j++]; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
      else gaps[i].push(stack[j++]);
    }
    while (j < stack.length) gaps[i].push(stack[j++]);
    return {gaps, matches};
  });
  const rows: (number | null)[][] = [];
  for (let i = 0; i <= base.length; i++) {
    const n = Math.max(0, ...columns.map(column => column.gaps[i].length));
    for (let j = 0; j < n; j++) rows.push([null, ...columns.map(column => column.gaps[i][j] ?? null)]);
    if (i < base.length) rows.push([base[i], ...columns.map(column => column.matches[i])]);
  }
  return rows;
}
