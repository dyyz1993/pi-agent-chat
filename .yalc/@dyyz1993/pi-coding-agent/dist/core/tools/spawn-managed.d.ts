import { type ChildProcess } from "child_process";
export interface SpawnedProcess {
    child: ChildProcess;
    pid: number | undefined;
    cleanup: () => void;
    isTimedOut: () => boolean;
}
export interface SpawnOptions {
    command: string;
    cwd: string;
    timeout?: number;
    signal?: AbortSignal;
    stdin?: "pipe" | "ignore";
    env?: NodeJS.ProcessEnv;
    shellPath?: string;
}
export declare function spawnManagedProcess(options: SpawnOptions): SpawnedProcess | Error;
//# sourceMappingURL=spawn-managed.d.ts.map