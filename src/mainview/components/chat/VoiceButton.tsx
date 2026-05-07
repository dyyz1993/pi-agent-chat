import React, { useState, useCallback } from 'react';
import { Mic, MicOff } from 'lucide-react';
import { platformBridge } from '../../lib/platform/bridge';
import { haptic } from '../../lib/haptic';

interface VoiceButtonProps {
  onTranscript: (text: string) => void;
  disabled?: boolean;
  className?: string;
}

export const VoiceButton: React.FC<VoiceButtonProps> = ({
  onTranscript,
  disabled = false,
  className = '',
}) => {
  const [isListening, setIsListening] = useState(false);
  const [partialText, setPartialText] = useState('');
  const [isSupported, setIsSupported] = useState(true);

  const startListening = useCallback(async () => {
    try {
      if (!platformBridge.voice.isSupported()) {
        setIsSupported(false);
        return;
      }

      platformBridge.voice.onFinalResult?.((text, translation) => {
        setIsListening(false);
        setPartialText('');
        onTranscript(translation || text);
      });

      platformBridge.voice.onPartialResult?.((text) => {
        setPartialText(text);
      });

      await platformBridge.voice.startRecognition({
        language: 'auto',
        translateTo: 'zh',
      });
      haptic.medium();
      setIsListening(true);
    } catch (err) {
      console.warn('[VoiceButton] 语音识别启动失败:', err);
      setIsListening(false);
      setPartialText('');
    }
  }, [onTranscript]);

  const stopListening = useCallback(async () => {
    try {
      await platformBridge.voice.stopRecognition();
    } catch (err) {
      console.warn('[VoiceButton] 停止识别失败:', err);
    }
    setIsListening(false);
    if (partialText.trim()) {
      onTranscript(partialText.trim());
      setPartialText('');
    }
  }, [partialText, onTranscript]);

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  if (!isSupported) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={toggleListening}
        disabled={disabled}
        className={`
          flex items-center justify-center rounded-lg transition-all duration-200
          ${isListening 
            ? 'bg-red-500 hover:bg-red-600 text-white animate-pulse' 
            : 'bg-transparent hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400'
          }
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
          ${className}
        `}
        title={isListening ? '点击停止录音' : '点击开始语音输入'}
      >
        {isListening ? (
          <MicOff className="w-5 h-5" />
        ) : (
          <Mic className="w-5 h-5" />
        )}
      </button>

      {isListening && partialText && (
        <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 
                        bg-black/80 text-white text-sm px-3 py-1.5 rounded-lg 
                        max-w-[200px] whitespace-nowrap overflow-hidden text-ellipsis">
          {partialText}
        </div>
      )}

      {isListening && (
        <div className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full animate-ping" />
      )}
    </div>
  );
};
