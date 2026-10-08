/** Verify both hash formats used by existing deployments without rehashing during migration/login. */
export async function verifyStoredPassword(usernameKey: string, password: string, stored: string): Promise<boolean> {
  if (/^[0-9a-f]{64}$/.test(stored)) {
    const bits = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${usernameKey}:${password}`));
    return equalHex(hex(bits), stored);
  }
  const match = /^pbkdf2\$(\d+)\$([0-9a-f]{32})\$([0-9a-f]{64})$/.exec(stored);
  if (!match) return false;
  const iterations = Number(match[1]);
  if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > 100000) return false;
  const salt = Uint8Array.from(match[2].match(/../g) ?? [], (byte) => parseInt(byte, 16));
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(`${usernameKey}:${password}`), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, material, 256);
  return equalHex(hex(bits), match[3]);
}

export async function hashPbkdf2Password(usernameKey: string, password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(`${usernameKey}:${password}`), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, material, 256);
  return `pbkdf2$100000$${hex(salt.buffer)}$${hex(bits)}`;
}

function hex(bits: ArrayBuffer): string {
  return [...new Uint8Array(bits)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function equalHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index++) difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return difference === 0;
}
