// 비밀번호 해시 전용 Durable Object.
// PBKDF2 10만 회는 약 50ms의 CPU를 쓰는데, Workers 무료 플랜의 요청당 CPU 한도(10ms)를 넘는다.
// Durable Object는 호출당 CPU 한도가 30초이므로 해시 계산만 이쪽에서 한다.

import { DurableObject } from "cloudflare:workers";
import { hashPassword, verifyPassword } from "./auth";
import type { Env } from "./env";

export class PasswordHasher extends DurableObject<Env> {
  async hash(password: string, iterations: number): Promise<string> {
    return hashPassword(password, iterations);
  }

  async verify(password: string, stored: string): Promise<boolean> {
    return verifyPassword(password, stored);
  }
}

/** 여러 인스턴스로 나눠 동시 로그인을 병렬 처리한다. */
const SHARDS = 4;

export function passwordHasher(env: Env) {
  const name = `hasher-${Math.floor(Math.random() * SHARDS)}`;
  return env.PASSWORD_HASHER.get(env.PASSWORD_HASHER.idFromName(name));
}
