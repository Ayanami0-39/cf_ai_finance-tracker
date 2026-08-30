import { useState } from 'react';
import { accountApi, setSession } from '@/lib/account';
import { Loader2 } from 'lucide-react';

interface AccountLoginProps {
  onLogin: (account: { username: string; displayName: string; emoji: string; scopeId: string }) => void;
}

/** 登录/注册弹窗：打开应用时若无账号会话则强制展示 */
export function AccountLogin({ onLogin }: AccountLoginProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const name = username.trim();
    if (!name || !password) {
      setError('请输入用户名和密码');
      return;
    }
    if (mode === 'register' && password !== confirm) {
      setError('两次输入的密码不一致');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res =
        mode === 'login'
          ? await accountApi.login(name, password)
          : await accountApi.register(name, password);
      if (!res.success || !res.token) {
        setError(res.error || '操作失败，请重试');
        return;
      }
      setSession(res.token, res.account);
      onLogin(res.account);
    } catch {
      setError('网络错误，请重试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 text-slate-100"
      style={{
        background: 'radial-gradient(1200px 600px at 20% -10%, #1e293b, #0f172a 60%)',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
      }}
    >
      <div className="w-full max-w-[380px] rounded-2xl px-8 py-9"
        style={{
          background: 'rgba(30,41,59,.75)',
          border: '1px solid rgba(148,163,184,.15)',
          boxShadow: '0 24px 60px rgba(0,0,0,.45)',
          backdropFilter: 'blur(10px)',
        }}
      >
        <div className="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center text-3xl mb-4"
          style={{ background: 'linear-gradient(135deg,#f59e0b,#ef4444)' }}
        >
          💰
        </div>
        <h1 className="text-lg font-semibold text-center">Fiscus</h1>
        <p className="text-[13px] text-slate-400 text-center mt-1 mb-6">
          {mode === 'login' ? '登录你的账号，多设备数据同步' : '创建账号，开始多设备记账'}
        </p>

        <form onSubmit={submit} autoComplete="off">
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="用户名（字母/数字/下划线/中划线）"
            autoFocus
            autoCapitalize="none"
            maxLength={24}
            className="w-full h-[46px] rounded-xl px-3.5 text-[15px] text-slate-100 outline-none transition-colors"
            style={{ background: 'rgba(15,23,42,.6)', border: '1px solid rgba(148,163,184,.25)' }}
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="密码（至少 4 位）"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            className="w-full h-[46px] mt-3 rounded-xl px-3.5 text-[15px] text-slate-100 outline-none transition-colors"
            style={{ background: 'rgba(15,23,42,.6)', border: '1px solid rgba(148,163,184,.25)' }}
          />
          {mode === 'register' && (
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="确认密码"
              autoComplete="new-password"
              className="w-full h-[46px] mt-3 rounded-xl px-3.5 text-[15px] text-slate-100 outline-none transition-colors"
              style={{ background: 'rgba(15,23,42,.6)', border: '1px solid rgba(148,163,184,.25)' }}
            />
          )}
          <button
            type="submit"
            disabled={busy}
            className="w-full h-[46px] mt-4 rounded-xl text-[15px] font-semibold cursor-pointer transition-opacity disabled:opacity-55 flex items-center justify-center gap-2"
            style={{ background: 'linear-gradient(135deg,#f59e0b,#f97316)', color: '#1c1917', border: 'none' }}
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            {mode === 'login' ? '登录' : '注册并登录'}
          </button>
          <div className="mt-3.5 text-[13px] text-red-300 text-center min-h-[18px]">{error}</div>
        </form>

        <button
          type="button"
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login');
            setError('');
            setConfirm('');
          }}
          className="mt-2 w-full text-xs text-slate-400 hover:text-slate-200 text-center"
        >
          {mode === 'login' ? '没有账号？创建一个 →' : '已有账号？返回登录 →'}
        </button>
        <p className="mt-4 text-xs text-slate-500 text-center leading-relaxed">
          同一账号在手机、电脑登录，账单、聊天、昵称头像完全一致
        </p>
      </div>
    </div>
  );
}
