import type { CoordinatorChannelEvent, CoordinatorMethodCall } from "../modules/coordinator";
import { createLogger } from "../lib/logger";

const log = createLogger("agent");

interface CoordinatorResponseManaged {
  _activeSessionId: string;
  client: {
    channel(channelName: string): {
      send(payload: unknown): void;
    };
  };
}

interface CoordinatorResponseRoute<TManaged extends CoordinatorResponseManaged> {
  managed?: TManaged;
  matchedViaFallback?: boolean;
  projectPath?: string;
  processCount?: number;
}

export async function handleCoordinatorCallOperation<TManaged extends CoordinatorResponseManaged>(
  options: {
    sessionId: string;
    data: unknown;
    channelName: string;
    startInProgress: boolean;
    broadcastEvent: (
      eventName: string,
      data: Record<string, unknown>,
      filter: Record<string, unknown>,
    ) => Promise<void>;
    queueDelegateRequest: (args: {
      sessionId: string;
      msg: CoordinatorMethodCall;
      channelName: string;
    }) => Promise<unknown>;
    handleDelegate: (
      sessionId: string,
      msg: Extract<CoordinatorMethodCall, { __call: "session_delegate" }>,
    ) => Promise<unknown>;
    handleDelegateSend: (
      msg: Extract<CoordinatorMethodCall, { __call: "session_delegate_send" }>,
    ) => Promise<unknown>;
    handleDelegateSync: (
      sessionId: string,
      msg: Extract<CoordinatorMethodCall, { __call: "session_delegate_sync" }>,
    ) => Promise<unknown>;
    handleDelegateStatus: (
      msg: Extract<CoordinatorMethodCall, { __call: "session_delegate_status" }>,
    ) => Promise<unknown>;
    handleDelegateList: (sessionId: string) => unknown;
    handleDelegateStop: (
      sessionId: string,
      msg: Extract<CoordinatorMethodCall, { __call: "session_delegate_stop" }>,
    ) => Promise<unknown>;
    handleDelegateFork: (
      sessionId: string,
      msg: Extract<CoordinatorMethodCall, { __call: "session_delegate_fork" }>,
    ) => Promise<unknown>;
    handleClearStopped: (
      msg: Extract<CoordinatorMethodCall, { __call: "session_delegate_clear_stopped" }>,
    ) => unknown;
    handleRemove: (
      sessionId: string,
      msg: Extract<CoordinatorMethodCall, { __call: "session_delegate_remove" }>,
    ) => unknown;
    findResponseManaged: (sessionId: string) => CoordinatorResponseRoute<TManaged>;
  },
): Promise<void> {
  const msg = options.data as CoordinatorChannelEvent;

  if (!("__call" in msg)) {
    options
      .broadcastEvent("coordinator.event", { sessionId: options.sessionId, event: msg }, {
        sessionId: options.sessionId,
      })
      .catch((err: unknown) => {
        log.warn("broadcastEvent(coordinator.event) error", {
          sessionId: options.sessionId,
          err: err instanceof Error ? err.message : String(err),
        });
      });
    return;
  }

  const { __call: method, invokeId } = msg;
  let result: unknown;
  try {
    switch (method) {
      case "session_delegate":
        if (options.startInProgress) {
          log.info("[coordinator] session_delegate queued (start in progress)", {
            sessionId: options.sessionId,
          });
          result = await options.queueDelegateRequest({
            sessionId: options.sessionId,
            msg,
            channelName: options.channelName,
          });
        } else {
          result = await options.handleDelegate(options.sessionId, msg);
        }
        break;
      case "session_delegate_send":
        result = await options.handleDelegateSend(msg);
        break;
      case "session_delegate_sync":
        if (options.startInProgress) {
          log.info("[coordinator] session_delegate_sync queued (start in progress)", {
            sessionId: options.sessionId,
          });
          result = await options.queueDelegateRequest({
            sessionId: options.sessionId,
            msg,
            channelName: options.channelName,
          });
        } else {
          result = await options.handleDelegateSync(options.sessionId, msg);
        }
        break;
      case "session_delegate_status":
        result = await options.handleDelegateStatus(msg);
        break;
      case "session_delegate_list":
        result = options.handleDelegateList(options.sessionId);
        break;
      case "session_delegate_stop":
        result = await options.handleDelegateStop(options.sessionId, msg);
        break;
      case "session_delegate_fork":
        result = await options.handleDelegateFork(options.sessionId, msg);
        break;
      default:
        if (method === "session_delegate_clear_stopped") {
          result = options.handleClearStopped(msg);
        } else if (method === "session_delegate_remove") {
          result = options.handleRemove(options.sessionId, msg);
        } else {
          log.warn("Unknown coordinator method", { sessionId: options.sessionId, method });
          return;
        }
    }
  } catch (err: unknown) {
    result = { error: err instanceof Error ? err.message : String(err) };
  }

  if (!invokeId) return;

  const route = options.findResponseManaged(options.sessionId);
  const managed = route.managed;
  if (route.matchedViaFallback) {
    log.info("handleCoordinatorCall: routed response via processByCwd fallback", {
      sessionId: options.sessionId,
      projectPath: route.projectPath,
      activeSession: managed?._activeSessionId,
    });
  } else if (!managed && route.projectPath) {
    log.warn("handleCoordinatorCall: processByCwd fallback could not find matching process", {
      sessionId: options.sessionId,
      projectPath: route.projectPath,
      processCount: route.processCount ?? 0,
    });
  }
  if (managed) {
    managed.client.channel(options.channelName).send({ ...(result as object), invokeId });
  }
}
