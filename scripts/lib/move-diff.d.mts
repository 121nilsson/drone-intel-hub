export interface Statement {
  name: string;
  text: string;
}
export function statementsOf(source: string, fileName?: string): Statement[];
export function diffMove(
  oldSources: [string, string][],
  newSources: [string, string][],
): { kept: number; lost: Statement[]; added: Statement[]; changed: string[] };
