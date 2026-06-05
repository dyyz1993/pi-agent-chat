/**
 * Extension system for lifecycle events and custom tools.
 */
export { createTypedChannel, defineChannel } from "./channel-factory.js";
export { ChannelManager } from "./channel-manager.js";
export { ClientChannel } from "./client-channel.js";
export { createExtensionRuntime, discoverAndLoadExtensions, loadExtensionFromFactory, loadExtensions, } from "./loader.js";
export { ExtensionRunner } from "./runner.js";
export { ServerChannel } from "./server-channel.js";
// Type guards
export { defineTool, isBashToolResult, isEditToolResult, isFindToolResult, isGrepToolResult, isLsToolResult, isReadToolResult, isToolCallEventType, isWriteToolResult, } from "./types.js";
export { wrapRegisteredTool, wrapRegisteredTools } from "./wrapper.js";
//# sourceMappingURL=index.js.map