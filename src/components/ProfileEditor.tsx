import { useState } from 'react';
import { accountApi, type AccountInfo } from '@/lib/account';
import { Loader2, X } from 'lucide-react';

const EMOJI_CHOICES = ['🙂', '😎', '👩', '👨', '👧', '👦', '👴', '👵', '🐱', '🐶'];

interface ProfileEditorProps {
  account: AccountInfo;
  onClose: () => void;
  onSaved: (account: AccountInfo) => void;
}

/** 修改昵称/头像（存服务端，所有设备生效） */
export function ProfileEditor({ account, onClose, onSaved }: ProfileEditorProps) {
  const [name, setName] = useState(account.displayName);
  const [emoji, setEmoji] = useState(account.emoji);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('昵称不能为空');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await accountApi.updateProfile({ displayName: trimmed, emoji });
      if (!res.success || !res.account) {
        setError(res.error || '保存失败，请重试');
        return;
      }
      onSaved(res.account);
      onClose();
    } catch {
      setError('网络错误，请重试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-xs bg-card border rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold text-foreground">编辑资料</span>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-lg hover:bg-muted flex items-center justify-center text-muted-foreground"
            aria-label="关闭"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-[10px] text-muted-foreground mb-1">
          账号 {account.username} · 资料存服务器，所有设备同步
        </p>

        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
          maxLength={12}
          className="w-full h-9 px-3 text-sm rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
          placeholder="昵称"
        />
        <div className="flex flex-wrap gap-1 mt-2.5">
          {EMOJI_CHOICES.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => setEmoji(e)}
              className={`w-8 h-8 rounded-lg text-base flex items-center justify-center transition-colors ${
                emoji === e ? 'bg-primary/15 ring-1 ring-primary' : 'hover:bg-muted'
              }`}
            >
              {e}
            </button>
          ))}
        </div>

        {error && <p className="text-[11px] text-destructive mt-2">{error}</p>}

        <button
          type="button"
          onClick={save}
          disabled={busy || !name.trim()}
          className="w-full h-9 mt-3 rounded-lg bg-primary text-primary-foreground text-xs font-medium disabled:opacity-40 flex items-center justify-center gap-1.5"
        >
          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          保存
        </button>
      </div>
    </div>
  );
}
