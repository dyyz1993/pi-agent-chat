import { homedir } from "os";
import { join, resolve } from "path";

export const PI_HOME = process.env.PI_HOME ? resolve(process.env.PI_HOME) : join(homedir(), ".pi");

export const PI_CHAT_HOME = process.env.PI_CHAT_HOME
  ? resolve(process.env.PI_CHAT_HOME)
  : join(PI_HOME, "chat");

export const PI_APP_CONFIG_DIR = process.env.PI_APP_CONFIG_DIR
  ? resolve(process.env.PI_APP_CONFIG_DIR)
  : PI_CHAT_HOME;

export const PI_WORKTREE_STATE_DIR = process.env.PI_WORKTREE_STATE_DIR
  ? resolve(process.env.PI_WORKTREE_STATE_DIR)
  : join(PI_CHAT_HOME, "worktrees");

export const PI_WORKTREE_REGISTRY_DIR = process.env.PI_WORKTREE_REGISTRY_DIR
  ? resolve(process.env.PI_WORKTREE_REGISTRY_DIR)
  : join(PI_WORKTREE_STATE_DIR, "registry");
