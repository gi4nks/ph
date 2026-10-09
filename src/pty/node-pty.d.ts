/**
 * Minimal type declaration for @lydell/node-pty.
 * The package ships node-pty.d.ts but its package.json "exports" field blocks
 * subpath/typings resolution under moduleResolution: Bundler (TS7016).
 * Covers only the API surface used by src/pty/wrapper.ts.
 */
declare module '@lydell/node-pty' {
  export interface IPtyProcess {
    onData(callback: (data: string) => void): { dispose(): void };
    onExit(callback: (event: { exitCode: number; signal?: number }) => void): { dispose(): void };
    write(data: string): void;
    resize(cols: number, rows: number): void;
    kill(signal?: string): void;
  }

  export interface IPtyForkOptions {
    name?: string;
    cols?: number;
    rows?: number;
    cwd?: string;
    env?: Record<string, string>;
    encoding?: string;
  }

  export function spawn(
    file: string,
    args: readonly string[],
    options?: IPtyForkOptions,
  ): IPtyProcess;

  const pty: {
    spawn: typeof spawn;
  };
  export default pty;
}
