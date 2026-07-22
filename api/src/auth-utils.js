import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { config } from './config.js';

const scrypt = promisify(scryptCallback);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_PATTERN = /^[a-z0-9_]{3,32}$/;

export function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function normalizeUsername(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function validateRegistration(input) {
  const email = normalizeEmail(input?.email);
  const username = normalizeUsername(input?.username);
  const password = String(input?.password ?? '');
  const errors = {};

  if (!email || email.length > 320 || !EMAIL_PATTERN.test(email)) errors.email = 'Enter a valid email address.';
  if (!USERNAME_PATTERN.test(username)) errors.username = 'Use 3–32 lowercase letters, numbers, or underscores.';
  if (password.length < 10) errors.password = 'Use at least 10 characters.';
  else if (password.length > 128) errors.password = 'Use no more than 128 characters.';

  return { ok: Object.keys(errors).length === 0, errors, value: { email, username, password } };
}

export function validateLogin(input) {
  const identifier = String(input?.identifier ?? '').trim().toLowerCase();
  const password = String(input?.password ?? '');
  const errors = {};
  if (!identifier || identifier.length > 320) errors.identifier = 'Enter your email or username.';
  if (!password) errors.password = 'Enter your password.';
  return { ok: Object.keys(errors).length === 0, errors, value: { identifier, password } };
}

export async function hashPassword(password, options = {}) {
  const cost = options.cost ?? config.password.scryptCost;
  const blockSize = options.blockSize ?? 8;
  const parallelization = options.parallelization ?? 1;
  const salt = randomBytes(16);
  const maxmem = Math.max(128 * cost * blockSize + 32 * 1024 * 1024, 64 * 1024 * 1024);
  const derived = await scrypt(password, salt, 64, { cost, blockSize, parallelization, maxmem });
  return `scrypt$${cost}$${blockSize}$${parallelization}$${salt.toString('base64url')}$${Buffer.from(derived).toString('base64url')}`;
}

export async function verifyPassword(password, encoded) {
  try {
    const [algorithm, costText, blockSizeText, parallelizationText, saltText, hashText] = String(encoded).split('$');
    if (algorithm !== 'scrypt') return false;
    const cost = Number(costText);
    const blockSize = Number(blockSizeText);
    const parallelization = Number(parallelizationText);
    if (![cost, blockSize, parallelization].every(Number.isInteger)) return false;
    const salt = Buffer.from(saltText, 'base64url');
    const expected = Buffer.from(hashText, 'base64url');
    const maxmem = Math.max(128 * cost * blockSize + 32 * 1024 * 1024, 64 * 1024 * 1024);
    const actual = Buffer.from(await scrypt(password, salt, expected.length, { cost, blockSize, parallelization, maxmem }));
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
