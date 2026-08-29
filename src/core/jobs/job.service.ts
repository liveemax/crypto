import { Injectable, Logger } from '@nestjs/common';
import { conflict, NEXT } from '../errors';
import type { JobProgressEvent, JobSnapshot, JobState, JobStep } from './job.types';

/**
 * Один слот на все сетевые задачи процесса и единственный владелец их состояния.
 * Минутный лимит CoinGecko общий, поэтому параллельные задачи не ускоряют работу,
 * а валят в 429 обе. Второй владелец состояния означал бы, что чужая задача видна
 * как idle — ровно этот баг чинится здесь.
 */
@Injectable()
export class JobService {
  private readonly logger = new Logger(JobService.name);

  private operation: string | null = null;
  private lastOperation: string | null = null;
  private state: JobState = 'idle';
  private step: JobStep = 'idle';
  private label = 'Ожидание';
  private doneUnits = 0;
  private totalUnits = 0;
  private loaded = 0;
  private failures = 0;
  private lastError: string | null = null;
  private startedAt: string | null = null;
  private finishedAt: string | null = null;
  private startedAtMs = 0;

  /** Занимает слот и обнуляет счётчик. false означает, что уже работает другая задача. */
  tryAcquire(name: string): boolean {
    if (this.operation !== null) return false;
    this.operation = name;
    this.lastOperation = name;
    this.state = 'running';
    this.step = 'idle';
    this.label = `Старт: ${name}`;
    this.doneUnits = 0;
    this.totalUnits = 0;
    this.loaded = 0;
    this.failures = 0;
    this.lastError = null;
    this.startedAtMs = Date.now();
    this.startedAt = new Date().toISOString();
    this.finishedAt = null;
    return true;
  }

  /** Занимает слот или отказывает вызывающему понятной 409 с переходом на GET /status. */
  acquireOrFail(name: string): void {
    const busy = this.current;
    if (busy) {
      throw conflict(
        'job_busy',
        `Уже идёт «${busy.name}», ${busy.elapsedSec} с. Одновременно выполняется одна ` +
          'сетевая задача: лимит источников общий на процесс.',
        { running: busy.name, requested: name, elapsedSec: busy.elapsedSec },
        NEXT.status,
      );
    }
    this.tryAcquire(name);
  }

  /** Занимает слот и объявляет первый шаг. false — слот занят другой задачей. */
  begin(name: string, step: JobStep, label: string): boolean {
    if (!this.tryAcquire(name)) return false;
    this.step = step;
    this.label = `Старт: ${label}`;
    return true;
  }

  /** Обновляет счётчик и пишет строку лога с номером шага и остатком времени. */
  report(event: JobProgressEvent): void {
    if (event.failed) this.failures += 1;
    this.step = event.step;
    this.label = event.label;
    this.doneUnits = event.current;
    this.totalUnits = event.total;
    this.loaded = event.loaded;
    if (event.error !== null) this.lastError = event.error;

    const now = this.snapshot();
    const counter = event.total > 1 ? ` ${event.current}/${event.total}` : '';
    const eta = now.etaSec === null ? '' : ` · осталось ~${now.etaSec} с`;
    const line =
      `${event.label}${counter} · строк ${event.loaded} · ошибок ${this.failures}` +
      ` · прошло ${now.elapsedSec} с${eta}`;

    if (event.failed) this.logger.warn(`${line} · ${event.error ?? 'ошибка'}`);
    else this.logger.log(line);
  }

  /** Успешное завершение. Слот освобождает вызывающий; результат остаётся видимым. */
  succeed(label: string): void {
    this.state = 'done';
    this.step = 'done';
    this.label = label;
    this.doneUnits = 1;
    this.totalUnits = 1;
    this.finishedAt = new Date().toISOString();
    this.logger.log(label);
  }

  /** Падение: сообщение остаётся в lastError до старта следующей задачи. */
  fail(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    this.state = 'error';
    this.step = 'failed';
    this.label = 'Прервано';
    this.lastError = message;
    this.finishedAt = new Date().toISOString();
    this.logger.error(`${this.operation ?? 'задача'} прервана: ${message}`);
    return message;
  }

  /** Освобождает слот. Чужой владелец сделать это не может. */
  release(name: string): void {
    if (this.operation !== name) return;
    if (this.state === 'running') {
      this.state = 'done';
      this.step = 'done';
      this.finishedAt = new Date().toISOString();
    }
    this.operation = null;
  }

  get current(): { name: string; elapsedSec: number } | null {
    if (this.operation === null) return null;
    return {
      name: this.operation,
      elapsedSec: Math.round((Date.now() - this.startedAtMs) / 1000),
    };
  }

  /** Состояние слота целиком. Единственный источник прогресса для GET /status. */
  snapshot(): JobSnapshot {
    const endMs = this.finishedAt === null ? Date.now() : Date.parse(this.finishedAt);
    const elapsedSec =
      this.startedAtMs === 0 ? 0 : Math.max(0, Math.round((endMs - this.startedAtMs) / 1000));
    const percent = this.totalUnits > 0 ? Math.round((this.doneUnits / this.totalUnits) * 100) : 0;
    // Остаток считается по темпу текущего шага и только пока задача идёт.
    const etaSec =
      this.state === 'running' && this.doneUnits > 0 && this.totalUnits > this.doneUnits && elapsedSec > 0
        ? Math.round((elapsedSec / this.doneUnits) * (this.totalUnits - this.doneUnits))
        : null;

    return {
      operation: this.operation ?? this.lastOperation,
      state: this.state,
      step: this.step,
      label: this.label,
      current: this.doneUnits,
      total: this.totalUnits,
      percent,
      loaded: this.loaded,
      failures: this.failures,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      elapsedSec,
      etaSec,
      lastError: this.lastError,
    };
  }
}