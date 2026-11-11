// Runs compiler and program commands in a terminal that is not a shell: the extension spawns the
// processes itself, so quoting, `&&` and the user's shell (bash, zsh, PowerShell, cmd) do not matter.
// `xlc` only compiles; building a program and running it, or building and running every test file,
// is orchestrated here.

import { type ChildProcess, spawn } from "node:child_process";
import * as vscode from "vscode";

export interface Command {
  command: string;
  args: string[];
  cwd: string;
}

/** A job is a list of commands run in order; the first failing command fails the job. */
export interface Job {
  title: string;
  commands: Command[];
  /** Called after the job, whatever its result (removes temporary files). */
  cleanup?: () => void;
}

const bold = (text: string) => `\x1b[1m${text}\x1b[0m`;
const colored = (code: number, text: string) => `\x1b[${code}m${text}\x1b[0m`;
const crlf = (text: string) => text.replace(/\r?\n/g, "\r\n");
const shown = (c: Command) => [c.command, ...c.args].map((a) => (/[\s"']/.test(a) ? JSON.stringify(a) : a)).join(" ");

class JobTerminal implements vscode.Pseudoterminal {
  private readonly out = new vscode.EventEmitter<string>();
  private readonly closed = new vscode.EventEmitter<number | void>();
  readonly onDidWrite = this.out.event;
  readonly onDidClose = this.closed.event;

  private child: ChildProcess | undefined;
  private cancelled = false;
  private finished = false;

  constructor(
    private readonly jobs: Job[],
    private readonly onDone?: () => void
  ) {}

  open(): void {
    void this.run();
  }

  close(): void {
    this.cancelled = true;
    this.child?.kill();
  }

  /** Keystrokes go to the running program; after the last job any key closes the terminal. */
  handleInput(data: string): void {
    if (this.finished) {
      this.closed.fire();
      return;
    }
    this.child?.stdin?.write(data.replace(/\r/g, "\n"));
    this.out.fire(data.replace(/\r/g, "\r\n"));
  }

  private write(text: string): void {
    this.out.fire(crlf(text));
  }

  private spawnCommand(c: Command): Promise<number | null> {
    return new Promise((resolve) => {
      this.write(`${bold("$")} ${shown(c)}\n`);
      const child = spawn(c.command, c.args, { cwd: c.cwd });
      this.child = child;
      child.stdout.on("data", (chunk: Buffer) => this.write(chunk.toString()));
      child.stderr.on("data", (chunk: Buffer) => this.write(chunk.toString()));
      child.on("error", (error) => {
        this.write(colored(31, `${(error as NodeJS.ErrnoException).code === "ENOENT" ? `not found: ${c.command}` : error.message}\n`));
        resolve(null);
      });
      child.on("close", (code, signal) => resolve(signal ? null : code));
    });
  }

  private async run(): Promise<void> {
    let passed = 0;
    const failed: string[] = [];
    for (const job of this.jobs) {
      if (this.cancelled) {
        break;
      }
      if (this.jobs.length > 1) {
        this.write(`\n${bold(job.title)}\n`);
      }
      let ok = true;
      for (const command of job.commands) {
        const code = await this.spawnCommand(command);
        if (code !== 0) {
          ok = false;
          this.write(colored(31, `exit status ${code ?? "none"}\n`));
          break;
        }
      }
      job.cleanup?.();
      if (ok) {
        passed += 1;
      } else {
        failed.push(job.title);
      }
    }
    if (this.jobs.length > 1) {
      this.write(`\n${colored(failed.length ? 31 : 32, `${passed} passed, ${failed.length} failed`)}\n`);
      failed.forEach((title) => this.write(`  ${colored(31, "FAIL")} ${title}\n`));
    }
    this.write(`\n${colored(90, "Press any key to close the terminal.")}\n`);
    this.finished = true;
    this.child = undefined;
    this.onDone?.();
  }
}

/** Opens a terminal named `name` that runs the jobs one after another; `onDone` runs at the end. */
export function runJobs(name: string, jobs: Job[], onDone?: () => void): void {
  const terminal = vscode.window.createTerminal({ name, pty: new JobTerminal(jobs, onDone) });
  terminal.show();
}
