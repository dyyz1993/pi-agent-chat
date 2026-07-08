import type { RPCServer } from "@dyyz1993/rpc-core";
import type { HandlerOptions } from "../rpc-schema";
import { createRegister } from "../rpc-schema";
import {
  checkForUpdate,
  downloadUpdate,
  applyUpdate,
  getUpdateStatus,
} from "../lib/desktop-updater";

export function register(server: RPCServer, _options: HandlerOptions): void {
  const r = createRegister(server);

  r("updater.check", async () => {
    return checkForUpdate();
  });

  r("updater.download", async () => {
    return downloadUpdate();
  });

  r("updater.apply", async () => {
    return applyUpdate();
  });

  r("updater.status", async () => {
    return getUpdateStatus();
  });
}
