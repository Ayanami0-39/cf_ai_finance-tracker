import { useEffect, useState, useCallback } from 'react';

/**
 * 全局访问密码门：验证通过前不渲染任何应用内容。
 * - 已解锁（Cookie 有效）→ 静默通过
 * - 本地有令牌但 Cookie 过期 → 用令牌静默续期
 * - 两者都没有 → 显示登录页
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
	const [status, setStatus] = useState<'checking' | 'locked' | 'open'>('checking');

	const check = useCallback(async () => {
		try {
			const headers: Record<string, string> = {};
			try {
				const token = localStorage.getItem('auth_token');
				if (token) headers['Authorization'] = `Bearer ${token}`;
			} catch { /* localStorage 不可用则仅靠 Cookie */ }

			const res = await fetch('/auth', { headers });
			if (res.ok) {
				setStatus('open');
				return;
			}
			// 401 且本地有令牌 → Cookie 过期，用令牌续签一次
			if (res.status === 401) {
				const token = localStorage.getItem('auth_token');
				if (token) {
					const retry = await fetch('/auth', {
						headers: { Authorization: `Bearer ${token}` },
					});
					if (retry.ok) {
						setStatus('open');
						return;
					}
				}
			}
			setStatus('locked');
		} catch {
			setStatus('locked');
		}
	}, []);

	useEffect(() => { check(); }, [check]);

	if (status === 'open') return <>{children}</>;

	if (status === 'checking') {
		return (
			<div className="min-h-screen flex items-center justify-center bg-slate-900 text-slate-400 text-sm">
				验证访问权限…
			</div>
		);
	}

	return <LoginScreen />;
}

function LoginScreen() {
	const [password, setPassword] = useState('');
	const [error, setError] = useState('');
	const [busy, setBusy] = useState(false);

	const submit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!password || busy) return;
		setBusy(true);
		setError('');
		try {
			const res = await fetch('/auth', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ password }),
			});
			const data = await res.json().catch(() => ({}));
			if (res.ok) {
				try { localStorage.setItem('auth_token', data.token ?? ''); } catch { /* ignore */ }
				window.location.reload();
				return;
			}
			setError(
				data.configured === false
					? '服务器尚未配置 AUTH_PASSWORD（运行 wrangler secret put AUTH_PASSWORD）'
					: '密码不正确，请重试'
			);
		} catch {
			setError('网络错误，请重试');
		} finally {
			setBusy(false);
		}
	};

	return (
		<div
			className="min-h-screen flex items-center justify-center p-4 text-slate-100"
			style={{
				background:
					'radial-gradient(1200px 600px at 20% -10%, #1e293b, #0f172a 60%)',
				fontFamily:
					'-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
			}}
		>
			<div
				className="w-full max-w-[380px] rounded-2xl px-8 py-9"
				style={{
					background: 'rgba(30,41,59,.75)',
					border: '1px solid rgba(148,163,184,.15)',
					boxShadow: '0 24px 60px rgba(0,0,0,.45)',
					backdropFilter: 'blur(10px)',
				}}
			>
				<div
					className="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center text-3xl mb-4"
					style={{ background: 'linear-gradient(135deg,#f59e0b,#ef4444)' }}
				>
					🔐
				</div>
				<h1 className="text-lg font-semibold text-center">Finance Tracker</h1>
				<p className="text-[13px] text-slate-400 text-center mt-1 mb-6">
					私人应用 · 请输入访问密码继续
				</p>
				<form onSubmit={submit} autoComplete="off">
					<input
						type="password"
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						placeholder="访问密码"
						autoFocus
						autoComplete="current-password"
						className="w-full h-[46px] rounded-xl px-3.5 text-[15px] text-slate-100 outline-none transition-colors"
						style={{
							background: 'rgba(15,23,42,.6)',
							border: '1px solid rgba(148,163,184,.25)',
						}}
					/>
					<button
						type="submit"
						disabled={busy}
						className="w-full h-[46px] mt-3.5 rounded-xl text-[15px] font-semibold cursor-pointer transition-opacity disabled:opacity-55"
						style={{
							background: 'linear-gradient(135deg,#f59e0b,#f97316)',
							color: '#1c1917',
							border: 'none',
						}}
					>
						{busy ? '验证中…' : '解锁'}
					</button>
					<div className="mt-3.5 text-[13px] text-red-300 text-center min-h-[18px]">
						{error}
					</div>
				</form>
				<p className="mt-4 text-xs text-slate-500 text-center leading-relaxed">
					解锁一次后长期有效，无需重复输入
				</p>
			</div>
		</div>
	);
}
