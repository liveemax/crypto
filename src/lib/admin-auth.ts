export const ADMIN_SESSION_COOKIE = "research_admin_session";

const SESSION_VALUE = "authenticated";

function bytes(value: string) {
  return new TextEncoder().encode(value);
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;

  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }

  return difference === 0;
}

export async function passwordsMatch(candidate: string, expected: string): Promise<boolean> {
  const [candidateHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", bytes(candidate)),
    crypto.subtle.digest("SHA-256", bytes(expected)),
  ]);

  return constantTimeEqual(new Uint8Array(candidateHash), new Uint8Array(expectedHash));
}

async function signature(secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    bytes(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, bytes(SESSION_VALUE));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createAdminSession(secret: string): Promise<string> {
  return `${SESSION_VALUE}.${await signature(secret)}`;
}

export async function verifyAdminSession(value: string | undefined, secret: string): Promise<boolean> {
  if (!value) return false;

  const separator = value.indexOf(".");
  const payload = separator === -1 ? "" : value.slice(0, separator);
  const suppliedSignature = separator === -1 ? "" : value.slice(separator + 1);
  const expectedSignature = await signature(secret);

  return (
    payload === SESSION_VALUE &&
    constantTimeEqual(bytes(suppliedSignature), bytes(expectedSignature))
  );
}
