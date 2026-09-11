import type { RPCServer } from "@dyyz1993/rpc-core";
import type { HandlerOptions } from "../rpc-schema";
import { createRegister } from "../rpc-schema";
import {
  getNotificationSettings,
  setNotificationSetting,
} from "../lib/project-config";

export function register(server: RPCServer, _options: HandlerOptions): void {
  const r = createRegister(server);

  r("notification.getSettings", async () => {
    return getNotificationSettings();
  });

  r("notification.setAgentEndPushEnabled", async (params: { enabled: boolean }) => {
    await setNotificationSetting("agentEndPushEnabled", params.enabled === true);
  });

  r("notification.setAgentEndPushImmersive", async (params: { enabled: boolean }) => {
    await setNotificationSetting("immersiveOpen", params.enabled === true);
  });

  r("notification.setAgentEndPresenceSuppress", async (params: { enabled: boolean }) => {
    await setNotificationSetting("presenceSuppress", params.enabled === true);
  });
}
