import type { SshConnectionErrorCode } from "../modules/project";

export function classifySshErrorMessage(message: string): SshConnectionErrorCode {
  const text = message.toLowerCase();
  if (text.includes("ssh host is required")) return "missing-host";
  if (
    text.includes("publickey") ||
    text.includes("authentication failed") ||
    text.includes("too many authentication failures")
  ) {
    return "auth-failed";
  }
  if (
    text.includes("operation timed out") ||
    text.includes("connect timeout") ||
    text.includes("connection timed out") ||
    text.includes("timed out")
  ) {
    return "timeout";
  }
  if (
    text.includes("could not resolve hostname") ||
    text.includes("name or service not known") ||
    text.includes("no route to host") ||
    text.includes("network is unreachable") ||
    text.includes("connection refused") ||
    text.includes("connection reset by peer") ||
    text.includes("connection closed by remote host")
  ) {
    return "host-unreachable";
  }
  if (
    text.includes("host key verification failed") ||
    text.includes("remote host identification")
  ) {
    return "host-key";
  }
  if (
    text.includes("bad configuration option") ||
    text.includes("bad configuration options") ||
    text.includes("terminating, ") ||
    text.includes("identity file") ||
    text.includes("no such identity")
  ) {
    return "ssh-config";
  }
  if (text.includes("command not found")) {
    return "command-failed";
  }
  if (text.includes("no such file or directory") || text.includes("not a directory")) {
    return "remote-path";
  }
  if (text.includes("operation not permitted") || text.includes("permission denied")) {
    return "permission-denied";
  }
  return "command-failed";
}
