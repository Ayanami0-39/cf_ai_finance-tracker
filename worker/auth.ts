/**
 * 密码鉴权模块（纯 Request/Response，不依赖 Hono 类型）
 *
 * 设计：
 * - 令牌 = base64url(SHA-256(password + 盐))，密码不变则令牌永不变化、永不过期
 * - 双通道凭证：HttpOnly Cookie（浏览器自动携带）+ Authorization: Bearer（localStorage 兜底）
 * - 未配置 AUTH_PASSWORD 时锁定所有内容（fail-closed），登录页会提示配置方法
 */

const COOKIE_NAME = 'app_auth';
const SALT = 'cf-ai-finance-tracker::auth-v1';

function jsonHeaders(): Record<string, string> {
	return { 'Content-Type': 'application/json; charset=utf-8' };
}

export async function deriveToken(password: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		'SHA-256',
		new TextEncoder().encode(`${password}::${SALT}`)
	);
	const bytes = new Uint8Array(digest);
	let bin = '';
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function safeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

function tokenFromRequest(req: Request): string | null {
	const auth = req.headers.get('Authorization');
	if (auth && auth.startsWith('Bearer ')) {
		const bearer = auth.slice(7).trim();
		if (bearer) return bearer;
	}
	const cookie = req.headers.get('Cookie');
	if (!cookie) return null;
	for (const pair of cookie.split(/;\s*/)) {
		const eq = pair.indexOf('=');
		if (eq === -1) continue;
		if (pair.slice(0, eq) === COOKIE_NAME) return pair.slice(eq + 1);
	}
	return null;
}

function makeAuthCookie(token: string): string {
	// Max-Age 取 1 年（浏览器上限）；令牌本身永不过期，
	// 过期后前端会用 localStorage 中的令牌经 /auth 重新续签 Cookie。
	return `${COOKIE_NAME}=${token}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`;
}

export function verifyRequest(req: Request, expectedToken: string): boolean {
	const provided = tokenFromRequest(req);
	return !!provided && safeEqual(provided, expectedToken);
}

export function authNotConfiguredResponse(pathname: string): Response {
	if (pathname.startsWith('/api/') || pathname === '/auth') {
		return new Response(
			JSON.stringify({ ok: false, configured: false, error: 'AUTH_PASSWORD is not configured' }),
			{ status: 503, headers: { ...jsonHeaders(), 'Cache-Control': 'no-store' } }
		);
	}
	return loginPageResponse();
}

export function loginPageResponse(): Response {
	return new Response(LOGIN_PAGE_HTML, {
		status: 200,
		headers: {
			'Content-Type': 'text/html; charset=utf-8',
			'Cache-Control': 'no-store',
		},
	});
}

/**
 * /auth 端点：
 * - POST { password }  → 验证密码，成功则 Set-Cookie 并返回令牌
 * - GET  （Cookie/Bearer）→ 已验证则续签 Cookie，用于前端静默重登
 */
export async function handleAuthVerify(req: Request, password: string): Promise<Response> {
	if (!password) {
		return new Response(
			JSON.stringify({
				ok: false,
				configured: false,
				error: '服务器未配置 AUTH_PASSWORD（运行 wrangler secret put AUTH_PASSWORD）',
			}),
			{ status: 503, headers: { ...jsonHeaders(), 'Cache-Control': 'no-store' } }
		);
	}

	const expected = await deriveToken(password);

	let provided: string | null = null;
	let isPassword = false;
	if (req.method === 'POST') {
		try {
			const body = (await req.json()) as { password?: unknown };
			provided = typeof body.password === 'string' ? body.password : null;
		} catch {
			provided = null;
		}
		isPassword = true;
	} else {
		// GET 续签：请求携带的是令牌本身，直接比对，不再二次哈希
		provided = tokenFromRequest(req);
	}

	const providedValid = provided
		? isPassword
			? safeEqual(await deriveToken(provided), expected)
			: safeEqual(provided, expected)
		: false;

	if (providedValid) {
		return new Response(JSON.stringify({ ok: true, token: expected }), {
			status: 200,
			headers: {
				...jsonHeaders(),
				'Set-Cookie': makeAuthCookie(expected),
				'Cache-Control': 'no-store',
			},
		});
	}

	// 轻量抗爆破：失败时随机小延迟
	await new Promise((r) => setTimeout(r, 150 + Math.floor(Math.random() * 150)));
	return new Response(JSON.stringify({ ok: false, error: '密码不正确' }), {
		status: 401,
		headers: { ...jsonHeaders(), 'Cache-Control': 'no-store' },
	});
}

const LOGIN_PAGE_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Finance Tracker · 访问验证</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:radial-gradient(1200px 600px at 20% -10%,#1e293b,#0f172a 60%);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:#e2e8f0;padding:16px}
.card{width:100%;max-width:380px;background:rgba(30,41,59,.75);border:1px solid rgba(148,163,184,.15);border-radius:18px;padding:36px 30px;box-shadow:0 24px 60px rgba(0,0,0,.45);backdrop-filter:blur(10px)}
.icon{width:56px;height:56px;border-radius:14px;background:linear-gradient(135deg,#f59e0b,#ef4444);display:flex;align-items:center;justify-content:center;font-size:28px;margin:0 auto 18px}
h1{font-size:19px;text-align:center;margin-bottom:6px;font-weight:600}
p.sub{font-size:13px;color:#94a3b8;text-align:center;margin-bottom:24px}
input{width:100%;height:46px;border-radius:12px;border:1px solid rgba(148,163,184,.25);background:rgba(15,23,42,.6);color:#e2e8f0;padding:0 14px;font-size:15px;outline:none;transition:border .15s}
input:focus{border-color:#f59e0b}
button{width:100%;height:46px;margin-top:14px;border:none;border-radius:12px;background:linear-gradient(135deg,#f59e0b,#f97316);color:#1c1917;font-size:15px;font-weight:600;cursor:pointer;transition:opacity .15s}
button:hover{opacity:.9}
button:disabled{opacity:.55;cursor:wait}
.err{margin-top:14px;font-size:13px;color:#fca5a5;text-align:center;min-height:18px}
.tip{margin-top:18px;font-size:12px;color:#64748b;text-align:center;line-height:1.6}
</style>
</head>
<body>
<div class="card">
<div class="icon">🔐</div>
<h1>Finance Tracker</h1>
<p class="sub">私人应用 · 请输入访问密码继续</p>
<form id="f" autocomplete="off">
<input id="p" type="password" placeholder="访问密码" autofocus autocomplete="current-password">
<button id="b" type="submit">解锁</button>
<div class="err" id="e"></div>
</form>
<p class="tip">解锁一次后长期有效，无需重复输入</p>
</div>
<script>
var f=document.getElementById('f'),p=document.getElementById('p'),b=document.getElementById('b'),e=document.getElementById('e');
f.addEventListener('submit',function(ev){
ev.preventDefault();
var v=p.value;
if(!v)return;
b.disabled=true;e.textContent='';
fetch('/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:v})}).then(function(r){
return r.json().then(function(j){return{ok:r.ok,j:j}})}).then(function(x){
if(x.ok){try{localStorage.setItem('auth_token',x.j.token||'')}catch(_){}location.reload()}
else{e.textContent=(x.j&&x.j.configured===false)?'服务器尚未配置 AUTH_PASSWORD（运行 wrangler secret put AUTH_PASSWORD）':'密码不正确，请重试';b.disabled=false}
}).catch(function(){e.textContent='网络错误，请重试';b.disabled=false})});
</script>
</body>
</html>`;
