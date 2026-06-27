export type WriteClipboardTextFn = (text: string) => Promise<void> | void;
export type ReadClipboardTextFn = () => Promise<string | null> | string | null;
export type ReadClipboardImageFn = () => Promise<string | null> | string | null;

let _writeClipboardText: WriteClipboardTextFn | null = null;
let _readClipboardText: ReadClipboardTextFn | null = null;
let _readClipboardImage: ReadClipboardImageFn | null = null;

export function setWriteClipboardTextFn(fn: WriteClipboardTextFn): void {
  _writeClipboardText = fn;
}

export function setReadClipboardTextFn(fn: ReadClipboardTextFn): void {
  _readClipboardText = fn;
}

export function setReadClipboardImageFn(fn: ReadClipboardImageFn): void {
  _readClipboardImage = fn;
}

export async function writeClipboardText(text: string): Promise<boolean> {
  if (!_writeClipboardText) return false;
  await _writeClipboardText(text);
  return true;
}

export async function readClipboardText(): Promise<string | null> {
  if (!_readClipboardText) return null;
  return (await _readClipboardText()) ?? null;
}

export async function readClipboardImage(): Promise<string | null> {
  if (!_readClipboardImage) return null;
  return (await _readClipboardImage()) ?? null;
}
