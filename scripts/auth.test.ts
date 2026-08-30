import { deriveToken, verifyRequest, handleAuthVerify, loginPageResponse, authNotConfiguredResponse } from '../worker/auth.ts';

const PASSWORD = 'RgyX%je6S5C-iPLhZHFDLi4k';
let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`); }
}

// 1. 令牌派生：确定性 + 正确性
const t1 = await deriveToken(PASSWORD);
const t2 = await deriveToken(PASSWORD);
const t3 = await deriveToken('wrong-password');
check('令牌确定性（同密码同令牌）', t1 === t2);
check('不同密码令牌不同', t1 !== t3);
check('令牌为 base64url 格式（43 字符无填充）', /^[A-Za-z0-9_-]{43}$/.test(t1));

// 2. verifyRequest：Cookie 与 Bearer 双通道
const cookieReq = new Request('https://x.dev/api/expenses/u1', { headers: { Cookie: `foo=bar; app_auth=${t1}` } });
const bearerReq = new Request('https://x.dev/api/expenses/u1', { headers: { Authorization: `Bearer ${t1}` } });
const badReq = new Request('https://x.dev/', { headers: { Cookie: 'app_auth=tampered' } });
const noAuthReq = new Request('https://x.dev/');
check('Cookie 通道验证通过', verifyRequest(cookieReq, t1));
check('Bearer 通道验证通过', verifyRequest(bearerReq, t1));
check('篡改令牌被拒绝', !verifyRequest(badReq, t1));
check('无凭证被拒绝', !verifyRequest(noAuthReq, t1));

// 3. /auth 端点：POST 正确/错误密码
const okRes = await handleAuthVerify(new Request('https://x.dev/auth', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ password: PASSWORD }),
}), PASSWORD);
const okBody = await okRes.json();
check('正确密码返回 200 + 令牌', okRes.status === 200 && okBody.ok === true && okBody.token === t1);
const setCookie = okRes.headers.get('Set-Cookie') || '';
check('Set-Cookie 包含 HttpOnly+Secure+SameSite', /HttpOnly/.test(setCookie) && /Secure/.test(setCookie) && /SameSite=Lax/.test(setCookie) && /Max-Age=31536000/.test(setCookie));

const badRes = await handleAuthVerify(new Request('https://x.dev/auth', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ password: 'nope' }),
}), PASSWORD);
check('错误密码返回 401', badRes.status === 401);

// 4. GET /auth 续签：携带有效令牌应重新种 Cookie
const renewRes = await handleAuthVerify(new Request('https://x.dev/auth', { headers: { Cookie: `app_auth=${t1}` } }), PASSWORD);
const renewBody = await renewRes.json();
check('GET /auth 携带有效令牌续签成功', renewRes.status === 200 && renewBody.ok === true);
const renewRes2 = await handleAuthVerify(new Request('https://x.dev/auth', { headers: { Authorization: `Bearer ${t1}` } }), PASSWORD);
check('GET /auth Bearer 令牌续签成功', renewRes2.status === 200);

// 5. 登录页与未配置响应
const page = loginPageResponse();
const html = await page.text();
check('登录页返回 HTML 且含密码表单', page.headers.get('Content-Type').includes('text/html') && html.includes('type="password"') && html.includes("fetch('/auth'"));
const nc = authNotConfiguredResponse('/api/expenses/u1');
check('未配置密码时 API 返回 503 fail-closed', nc.status === 503);
const nc2 = authNotConfiguredResponse('/');
check('未配置密码时页面返回登录页', (await nc2.text()).includes('AUTH_PASSWORD'));

// 6. 静态资源路径也被拦截逻辑覆盖（由 index.ts 中间件处理，这里验证令牌函数对任意路径生效）
const assetReq = new Request('https://x.dev/assets/index-D_d2P6_M.js', { headers: { Cookie: `app_auth=${t1}` } });
check('静态资源路径验证通过', verifyRequest(assetReq, t1));

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
