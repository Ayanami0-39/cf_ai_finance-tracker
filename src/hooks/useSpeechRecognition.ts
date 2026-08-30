import { useCallback, useRef, useState } from 'react';

// 语音识别语言：zh-CN 优先中文识别，可通过环境变量切换
const SPEECH_LANG = import.meta.env.VITE_SPEECH_LANG || 'zh-CN';

export function useSpeechRecognition() {
  const [transcript, setTranscript] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isFinal, setIsFinal] = useState(false);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastSentTranscriptRef = useRef('');

  const startListening = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert('当前浏览器不支持语音识别 / Your browser does not support speech recognition');
      return;
    }

    const recognition = new SpeechRecognition();

    recognition.continuous = true;
    recognition.interimResults = true;
    // 中文优先：zh-CN 识别普通话；需要英文时设置 VITE_SPEECH_LANG=en-US
    recognition.lang = SPEECH_LANG;

    recognition.onresult = (event: any) => {
      let fullTranscript = '';

      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        fullTranscript += result[0].transcript;

        if (result.isFinal) {
          fullTranscript += ' ';
        }
      }

      fullTranscript = fullTranscript.trim();
      setTranscript(fullTranscript);
      setIsFinal(false);

      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
      }

      // 中文语句较短，2.5s 静音判定一句话结束
      silenceTimerRef.current = setTimeout(() => {
        if (fullTranscript && fullTranscript !== lastSentTranscriptRef.current) {
          lastSentTranscriptRef.current = fullTranscript;
          setIsFinal(true);
        }
      }, 2500);
    };

    recognition.onend = () => {
      setIsListening(false);

      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
      }
    };

    recognition.onerror = () => {
      // Recognition error
    };

    recognition.start();

    recognitionRef.current = recognition;
    setIsListening(true);
    setTranscript('');
    setIsFinal(false);
    lastSentTranscriptRef.current = '';
  }, []);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);

      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
      }

      lastSentTranscriptRef.current = '';
    }
  }, []);

  const resetTranscript = useCallback(() => {
    setTranscript('');
    setIsFinal(false);
  }, []);

  return {
    transcript,
    isListening,
    isFinal,
    startListening,
    stopListening,
    resetTranscript
  };
}
