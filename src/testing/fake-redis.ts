// 단위 테스트용 최소 Redis. 서비스가 쓰는 명령만 흉내 낸다.
export class FakeRedis {
  readonly strings = new Map<string, string>();
  readonly sets = new Map<string, Set<string>>();
  readonly ttls = new Map<string, number>();

  async get(key: string): Promise<string | null> {
    return this.strings.get(key) ?? null;
  }

  async set(
    key: string,
    value: string,
    mode?: 'EX',
    ttlSeconds?: number,
  ): Promise<'OK'> {
    this.strings.set(key, value);
    if (mode === 'EX' && ttlSeconds !== undefined) {
      this.ttls.set(key, ttlSeconds);
    }

    return 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    let removed = 0;

    for (const key of keys) {
      if (this.strings.delete(key) || this.sets.delete(key)) {
        removed += 1;
      }
      this.ttls.delete(key);
    }

    return removed;
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    const set = this.sets.get(key) ?? new Set<string>();
    const before = set.size;

    members.forEach((member) => set.add(member));
    this.sets.set(key, set);

    return set.size - before;
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    const set = this.sets.get(key);

    if (!set) {
      return 0;
    }

    return members.filter((member) => set.delete(member)).length;
  }

  async smembers(key: string): Promise<string[]> {
    return [...(this.sets.get(key) ?? [])];
  }

  async expire(key: string, ttlSeconds: number): Promise<number> {
    this.ttls.set(key, ttlSeconds);

    return 1;
  }

  // 한 번에 전부 돌려주는 단순한 SCAN. MATCH는 '*' 와일드카드만 지원한다.
  async scan(
    _cursor: string,
    _match: 'MATCH',
    pattern: string,
  ): Promise<[string, string[]]> {
    const regex = new RegExp(
      `^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`,
    );

    return ['0', [...this.strings.keys()].filter((key) => regex.test(key))];
  }
}
