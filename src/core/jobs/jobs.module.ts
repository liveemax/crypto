import { Global, Module } from '@nestjs/common';
import { JobService } from './job.service';

/**
 * Глобальный: замок обязан быть один на процесс. Прописанный в providers двух
 * модулей, он превратится в два независимых объекта, и защита от параллельных
 * сетевых задач исчезнет без единой ошибки.
 */
@Global()
@Module({
  providers: [JobService],
  exports: [JobService],
})
export class JobsModule {}