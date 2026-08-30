import { useState, useRef, useCallback } from 'react';

const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1/text-to-speech';
const DEFAULT_VOICE_ID = 'pNInz6obpgDQGcFmaJgB'; // Adam voice
// multilingual 模型支持中文；monolingual 只支持英文
const DEFAULT_MODEL_ID = 'eleven_multilingual_v2';

// 检测文本是否包含中文，用于选择 TTS 语言
function containsChinese(text: string): boolean {
  return /[\u4e00-\u9fff]/.test(text);
}

export function useElevenLabs() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  const speak = useCallback(async (text: string, onAudioStart?: () => void) => {
    if (!text.trim()) return;

    const apiKey = import.meta.env.VITE_ELEVENLABS_API_KEY;
    const voiceId = import.meta.env.VITE_ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;
    // 有 key 时用多语言模型支持中文；无 key 时走浏览器 TTS
    const modelId = import.meta.env.VITE_ELEVENLABS_MODEL_ID || DEFAULT_MODEL_ID;

    setIsSpeaking(true);
    setError(null);

    try {
      // No API key → browser speech synthesis (supports zh-CN voices)
      if (!apiKey) {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 0.95;
        utterance.pitch = 1.0;
        utterance.volume = 0.8;
        // 中文回复用中文语音朗读
        utterance.lang = containsChinese(text) ? 'zh-CN' : 'en-US';

        // 优先挑选匹配语言的系统语音
        const voices = speechSynthesis.getVoices();
        const preferred = voices.find((v) =>
          utterance.lang === 'zh-CN'
            ? v.lang.startsWith('zh')
            : v.lang.startsWith('en')
        );
        if (preferred) {
          utterance.voice = preferred;
        }

        utterance.onstart = () => {
          if (onAudioStart) {
            onAudioStart();
          }
        };

        utterance.onend = () => {
          setIsSpeaking(false);
        };

        utterance.onerror = () => {
          setError('语音合成失败 / Failed to synthesize speech');
          setIsSpeaking(false);
        };

        speechSynthesis.speak(utterance);
        return;
      }

      // ElevenLabs API call
      const response = await fetch(`${ELEVENLABS_API_URL}/${voiceId}`, {
        method: 'POST',
        headers: {
          Accept: 'audio/mpeg',
          'Content-Type': 'application/json',
          'xi-api-key': apiKey,
        },
        body: JSON.stringify({
          text: text,
          model_id: modelId,
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`ElevenLabs API error: ${response.status}`);
      }

      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);

      const audio = new Audio(audioUrl);
      audioRef.current = audio;

      await new Promise<void>((resolve, reject) => {
        audio.onended = () => {
          URL.revokeObjectURL(audioUrl);
          resolve();
        };

        audio.onerror = () => {
          setError('音频播放失败 / Failed to play audio');
          reject(new Error('Audio playback failed'));
        };

        audio.onplay = () => {
          if (onAudioStart) {
            onAudioStart();
          }
        };

        audio.play().catch(reject);
      });

      setIsSpeaking(false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : '语音生成失败 / Failed to generate speech'
      );
      setIsSpeaking(false);
    }
  }, []);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setIsSpeaking(false);
    }

    // Also stop browser speech synthesis
    speechSynthesis.cancel();
    setIsSpeaking(false);
  }, []);

  return {
    speak,
    stop,
    isSpeaking,
    error,
  };
}
