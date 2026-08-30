import { useState, useEffect, useRef } from "react";
import { Mic, MicOff, PhoneOff, Volume2, Loader2, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { AudioVisualizer } from "./AudioVisualizer";
import { useVoiceConversation, type VoiceExpensePayload } from "@/hooks/useVoiceConversation";

interface VoiceModeProps {
  isActive: boolean;
  onClose: () => void;
  onMessageReceived: (message: string, expense?: VoiceExpensePayload) => void;
  onUserMessage: (message: string) => void;
  scopeId?: string;
}

export function VoiceMode({
  isActive,
  onClose,
  onMessageReceived,
  onUserMessage,
  scopeId,
}: VoiceModeProps) {
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const { phase, transcription, isListening, start, stop, error } =
    useVoiceConversation({
      scopeId,
      onMessageReceived: (message: string, expense?: VoiceExpensePayload) => {
        onMessageReceived(message, expense);
      },
      onUserMessage: (message: string) => {
        onUserMessage(message);
      },
    });

  // Get microphone access for audio visualization
  useEffect(() => {
    if (!isActive) {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      setAudioStream(null);
      return;
    }

    const getMicrophoneStream = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        streamRef.current = stream;
        setAudioStream(stream);
      } catch {
        // Failed to get microphone access
      }
    };

    getMicrophoneStream();
  }, [isActive]);

  // Start voice conversation when active
  useEffect(() => {
    if (isActive && phase === "idle") {
      start();
    }
  }, [isActive, phase, start]);

  const handleClose = () => {
    stop();
    onClose();
  };

  const handleMuteToggle = () => {
    if (isListening) {
      stop();
    } else {
      start();
    }
  };

  const getPhaseIcon = () => {
    switch (phase) {
      case "listening":
        return <Mic className="w-8 h-8 text-white" />;
      case "thinking":
        return <Loader2 className="w-8 h-8 text-white animate-spin" />;
      case "speaking":
        return <Volume2 className="w-8 h-8 text-white" />;
      case "error":
        return <X className="w-8 h-8 text-white" />;
      default:
        return <Mic className="w-8 h-8 text-white" />;
    }
  };

  const getPhaseText = () => {
    switch (phase) {
      case "listening":
        return "正在聆听…";
      case "thinking":
        return "思考中…";
      case "speaking":
        return "正在回复…";
      case "error":
        return error || "出错了";
      default:
        return "准备中…";
    }
  };

  const getPhaseColor = () => {
    switch (phase) {
      case "listening":
        return "from-[#17483c] to-[#2f7e70]";
      case "thinking":
        return "from-[#2f7e70] to-[#17483c]";
      case "speaking":
        return "from-[#147a5a] to-[#2f7e70]";
      case "error":
        return "from-[#b14b46] to-[#b14b46]";
      default:
        return "from-[#64766f] to-[#64766f]";
    }
  };

  if (!isActive) return null;

  return (
    <AnimatePresence>
      {isActive && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="fixed inset-0 z-50 flex items-center justify-center"
        >
          {/* Backdrop - calm green tint */}
          <div
            className="absolute inset-0 bg-background/80 backdrop-blur-xl"
            onClick={handleClose}
          />

          {/* Voice Panel */}
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="relative w-[90%] max-w-md bg-card border rounded-3xl shadow-2xl p-8 md:p-8 max-md:rounded-b-none max-md:w-full max-md:max-w-full max-md:min-h-[85dvh] max-md:mt-auto max-md:rounded-t-3xl max-md:px-6 max-md:pt-8"
            style={{
              paddingBottom:
                "max(2rem, env(safe-area-inset-bottom) + 1.5rem)",
            }}
          >
            <div className="flex flex-col items-center gap-6">
              {/* Animated Voice Circle with Audio Visualization */}
              <div className="relative w-32 h-32 flex items-center justify-center">
                {isListening && (
                  <AudioVisualizer
                    audioStream={audioStream}
                    isActive={isListening}
                  />
                )}

                <div
                  className={`relative w-20 h-20 rounded-full bg-gradient-to-br ${getPhaseColor()} flex items-center justify-center shadow-lg z-10 ${
                    phase === "listening" || phase === "speaking"
                      ? "animate-pulse"
                      : ""
                  }`}
                >
                  {getPhaseIcon()}
                </div>

                {(phase === "listening" || phase === "thinking") && (
                  <>
                    <div
                      className={`absolute inset-0 rounded-full bg-gradient-to-br ${getPhaseColor()} opacity-30 animate-ping`}
                    />
                    <div
                      className={`absolute inset-0 rounded-full bg-gradient-to-br ${getPhaseColor()} opacity-20 animate-ping`}
                      style={{ animationDelay: "0.5s" }}
                    />
                  </>
                )}
              </div>

              {/* Status Text */}
              <div className="text-center">
                <p className="text-lg font-medium text-foreground mb-2">
                  {getPhaseText()}
                </p>
                {transcription && (
                  <p className="text-sm text-muted-foreground max-w-xs italic">
                    "{transcription}"
                  </p>
                )}
                {error && (
                  <p className="text-sm text-destructive max-w-xs mt-2">{error}</p>
                )}
              </div>

              {/* Hints */}
              <AnimatePresence mode="wait">
                {!transcription && phase === "listening" && (
                  <motion.div
                    key="hints"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-center mb-4"
                  >
                    <p className="text-xs text-muted-foreground/70 max-w-xs mb-2">
                      试试说：
                    </p>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">
                        「我在星巴克花了35块买拿铁」
                      </p>
                      <p className="text-xs text-muted-foreground">
                        「这个月花了多少钱」
                      </p>
                      <p className="text-xs text-muted-foreground">
                        「删除上一笔记录」
                      </p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Voice Controls */}
              <div className="flex items-center justify-center gap-6 mt-4">
                <motion.button
                  onClick={handleMuteToggle}
                  className={`w-14 h-14 md:w-16 md:h-16 rounded-full flex items-center justify-center transition-all shadow-lg ${
                    isListening
                      ? "bg-destructive hover:bg-destructive/90"
                      : "bg-primary hover:bg-primary/90"
                  }`}
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.95 }}
                  aria-label={isListening ? "暂停聆听" : "开始聆听"}
                >
                  {isListening ? (
                    <MicOff className="w-6 h-6 text-white" />
                  ) : (
                    <Mic className="w-6 h-6 text-white" />
                  )}
                </motion.button>

                <motion.button
                  onClick={handleClose}
                  className="w-14 h-14 md:w-16 md:h-16 rounded-full bg-destructive/90 hover:bg-destructive flex items-center justify-center transition-all shadow-lg"
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.95 }}
                  aria-label="结束语音"
                >
                  <PhoneOff className="w-6 h-6 text-white" />
                </motion.button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
