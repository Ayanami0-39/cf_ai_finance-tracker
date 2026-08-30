import { useState, useCallback, useRef, useEffect } from 'react';
import { useSpeechRecognition } from './useSpeechRecognition';
import { useElevenLabs } from './useElevenLabs';
import { api } from '@/lib/api';
import { getAccount } from '@/lib/account';

type Phase = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';

interface UseVoiceConversationOptions {
  onMessageReceived?: (message: string, expense?: unknown) => void;
  onUserMessage?: (message: string) => void;
}

interface UseVoiceConversationReturn {
  phase: Phase;
  transcription: string;
  isListening: boolean;
  isSpeaking: boolean;
  start: () => void;
  stop: () => void;
  error: string | null;
}

export function useVoiceConversation(
  options?: UseVoiceConversationOptions
): UseVoiceConversationReturn {
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);

  const previousSpeakingRef = useRef(false);
  const lastSentMessageRef = useRef('');
  const isActiveRef = useRef(false);

  const {
    transcript,
    isListening,
    isFinal,
    startListening,
    stopListening,
    resetTranscript,
  } = useSpeechRecognition();

  const { speak, isSpeaking, error: ttsError } = useElevenLabs();

  // Query the server with user input using our existing API
  const queryServer = useCallback(async (message: string): Promise<{ response: string; expense?: unknown }> => {
    try {
      const account = getAccount();
      if (!account) throw new Error('未登录，请先登录账号');
      const result = await api.sendVoiceCommand({
        userId: account.scopeId,
        input: message,
        memberName: account.displayName,
        memberId: account.username,
      });

      if (!result.success) {
        throw new Error(result.message || 'Server request failed');
      }

      const response = result.message;
      const expense = result.data?.expense;

      return { response, expense };
    } catch (err) {
      throw err;
    }
  }, []);

  // Handle AI speaking state changes (echo prevention + auto-resume)
  useEffect(() => {
    const wasSpeaking = previousSpeakingRef.current;
    const isCurrentlySpeaking = isSpeaking;

    previousSpeakingRef.current = isCurrentlySpeaking;

    // AI started speaking - stop mic to prevent echo
    if (!wasSpeaking && isCurrentlySpeaking) {
      if (isListening) {
        stopListening();
      }
    }

    // AI finished speaking
    if (wasSpeaking && !isCurrentlySpeaking) {
      // Only auto-resume if conversation is active
      if (isActiveRef.current) {
        setPhase('idle');

        setTimeout(() => {
          if (isActiveRef.current) {
            setPhase('listening');
            startListening();
          }
        }, 1000);
      }
    }
  }, [isSpeaking, isListening, stopListening, startListening]);

  // Handle sending messages when user pauses
  useEffect(() => {
    if (!isFinal || !transcript || !isActiveRef.current) return;
    if (phase === 'thinking' || phase === 'speaking') return;

    // Prevent duplicate sends
    if (transcript === lastSentMessageRef.current) {
      resetTranscript();
      return;
    }

    const sendMessage = async () => {
      lastSentMessageRef.current = transcript;

      // Send user's transcription to chat
      if (options?.onUserMessage) {
        options.onUserMessage(transcript);
      }

      setPhase('thinking');
      stopListening();

      try {
        const { response, expense } = await queryServer(transcript);

        if (!isActiveRef.current) return;

        // Trigger callback with response and expense data
        if (options?.onMessageReceived) {
          options.onMessageReceived(response, expense);
        }

        // Stay in 'thinking' phase until audio actually starts playing
        await speak(response, () => {
          // This callback is called when audio starts playing
          if (isActiveRef.current) {
            setPhase('speaking');
          }
        });
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to process message'
        );
        setPhase('error');

        // Auto-recover from error
        setTimeout(() => {
          if (isActiveRef.current) {
            setError(null);
            setPhase('listening');
            startListening();
          }
        }, 2000);
      } finally {
        resetTranscript();
      }
    };

    sendMessage();
  }, [
    isFinal,
    transcript,
    phase,
    queryServer,
    speak,
    stopListening,
    resetTranscript,
    startListening,
    options,
  ]);

  // Sync TTS errors
  useEffect(() => {
    if (ttsError) {
      setError(ttsError);
      setPhase('error');
    }
  }, [ttsError]);

  // Start voice conversation
  const start = useCallback(() => {
    if (isActiveRef.current) {
      return;
    }

    isActiveRef.current = true;
    setError(null);
    setPhase('listening');

    // Start listening after small delay
    setTimeout(() => {
      if (isActiveRef.current) {
        startListening();
      }
    }, 500);
  }, [startListening]);

  // Stop voice conversation
  const stop = useCallback(() => {
    isActiveRef.current = false;
    stopListening();
    setPhase('idle');
    resetTranscript();
    setError(null);
  }, [stopListening, resetTranscript]);

  return {
    phase,
    transcription: transcript,
    isListening,
    isSpeaking,
    start,
    stop,
    error,
  };
}
