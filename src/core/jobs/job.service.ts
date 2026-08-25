import { ConflictException, Injectable } from '@nestjs/common';

/**
 * Один слот на все сетевые задачи процесса. Минутный лимит CoinGecko общий,
 * поэтому параллельные задачи не ускоряют работу, а валят в 429 обе.
 */
@Injectable()
export class JobService {
  private owner: string | null = null;
  private startedAtMs = 0;

  /** Занимает слот. false означает, что уже работает другая задача. */
  tryAcquire(name: string): boolean {
    if (this.owner !== null) return false;
    this.owner = name;
    this.startedAtMs = Date.now();
    return true;
  }

  /** Занимает слот или отказывает вызывающему понятной 409. */
  acquireOrFail(name: string): void {
    const busy = this.current;
    if (busy) {
      throw new ConflictException(
        `Уже идёт «${busy.name}», ${busy.elapsedSec} с. Одновременно выполняется ` +
          'одна сетевая задача: лимит CoinGecko общий на процесс. ' +
          'Ход — в GET /universe/status',
      );
    }
    this.tryAcquire(name);
  }

  release(name: string): void {
    if (this.owner === name) {
      this.owner = null;
      this.startedAtMs = 0;
    }
  }

  get current(): { name: string; elapsedSec: number } | null {
    if (this.owner === null) return null;
    return {
      name: this.owner,
      elapsedSec: Math.round((Date.now() - this.startedAtMs) / 1000),
    };
  }
}