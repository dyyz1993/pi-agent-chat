import { isNative } from "../index";
import type { IVoiceProvider } from "./types";

type PartialCallback = (text: string) => void;
type FinalCallback = (text: string, translation?: string) => void;

interface SpeechRecognitionEvent {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent {
  error: string;
}

interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  start: () => void;
  stop: () => void;
}

interface WindowWithSR extends Window {
  SpeechRecognition?: new () => SpeechRecognitionInstance;
  webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
}

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionInstance) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as WindowWithSR;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Web 降级实现 — 使用 Web Speech API (SpeechRecognition + SpeechSynthesis)
 */
class WebVoiceProvider implements IVoiceProvider {
  private recognition: SpeechRecognitionInstance | null = null;
  private synth: SpeechSynthesis | null = null;
  private _onPartial: PartialCallback | null = null;
  private _onFinal: FinalCallback | null = null;

  isSupported(): boolean {
    return getSpeechRecognitionCtor() !== null;
  }

  async startRecognition(options?: { language?: string; translateTo?: string }): Promise<void> {
    const SR = getSpeechRecognitionCtor();
    if (!SR) throw new Error("语音识别在当前浏览器中不可用");

    this.recognition = new SR();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = options?.language ?? "zh-CN";

    this.recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = "";
      let final = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          final += transcript;
        } else {
          interim += transcript;
        }
      }
      if (interim && this._onPartial) this._onPartial(interim);
      if (final && this._onFinal) this._onFinal(final);
    };

    this.recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.warn("[VoiceProvider] recognition error:", event.error);
    };

    this.recognition.start();
  }

  async stopRecognition(): Promise<void> {
    if (this.recognition) {
      this.recognition.stop();
      this.recognition = null;
    }
  }

  async speak(text: string, options?: { voice?: string; language?: string }): Promise<void> {
    if (typeof speechSynthesis === "undefined") {
      console.warn("[voice-provider] SpeechSynthesis API not available");
      return;
    }

    if (!this.synth) this.synth = window.speechSynthesis ?? null;
    if (!this.synth) return;

    if (typeof this.synth.cancel === "function") this.synth.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = options?.language ?? "zh-CN";
    if (options?.voice) {
      const voices = this.synth.getVoices();
      const match = voices.find((v) => v.name === options.voice);
      if (match) utterance.voice = match;
    }

    return new Promise((resolve) => {
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      this.synth?.speak(utterance);
      resolve(undefined);
    });
  }

  async stopSpeaking(): Promise<void> {
    if (this.synth && typeof this.synth.cancel === "function") {
      this.synth.cancel();
    }
  }

  onPartialResult(callback: (text: string) => void): void {
    this._onPartial = callback;
  }

  onFinalResult(callback: (text: string, translation?: string) => void): void {
    this._onFinal = callback;
  }
}

/**
 * 原生增强实现 — 可对接阿里云 ASR SDK 等原生语音服务
 * 当前阶段复用 Web Speech API，后续替换为原生 SDK
 */
class NativeVoiceProvider extends WebVoiceProvider {
  override isSupported(): boolean {
    // 原生平台始终可用（后续对接原生 ASR 后将返回 true）
    return true;
  }
}

export function createVoiceProvider(): IVoiceProvider {
  return isNative() ? new NativeVoiceProvider() : new WebVoiceProvider();
}
