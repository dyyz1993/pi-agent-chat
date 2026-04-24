export interface Transport {
  send(message: unknown): Promise<void>;
  onMessage(handler: MessageHandler): () => void;
  onError(handler: ErrorHandler): () => void;
  onDisconnect?(handler: DisconnectHandler): () => void;
  isConnected(): boolean;
  close(): void;
}

export type MessageHandler = (message: unknown) => void;
export type ErrorHandler = (error: Error) => void;
export type DisconnectHandler = () => void;
