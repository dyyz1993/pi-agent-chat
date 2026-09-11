import type { RPCServer } from "@dyyz1993/rpc-core";
import type { HandlerOptions } from "../rpc-schema";
import { createRegister } from "../rpc-schema";
import {
  getNotificationSettings,
  setNotificationSetting,
} from "../lib/project-config";

export function register(server: RPCServer, _options: HandlerOptions): void {
  const r = createRegister(server);

  r("app.getNotificationSettings", async () => {
    return getNotificationSettings();
  });

  r("app.setAgentEndPushEnabled", async (params: { enabled: boolean }) => {
    return setNotificationSetting("agentEndPushEnabled", params.enabled === true);
  });

  r("app.setAgentEndPushImmersive", async (params: { enabled: boolean }) => {
    return setNotificationSetting("immersiveOpen", params.enabled === true);
  });

  r("app.setAgentEndPresenceSuppress", async (params: { enabled: boolean }) => {
    return setNotificationSetting("presenceSuppress", params.enabled === true);
  });
}
