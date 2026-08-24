import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

interface HealthResponse {
  status: 'ok';
  time: string;
  version: string;
}

@ApiTags('system')
@Controller('health')
export class HealthController {
  /** Возвращает состояние сервиса и его версию. */
  @Get()
  @ApiOperation({ summary: 'Проверить доступность сервиса' })
  @ApiOkResponse({ description: 'Сервис работает' })
  getHealth(): HealthResponse {
    return {
      status: 'ok',
      time: new Date().toISOString(),
      version: process.env.npm_package_version ?? '0.1.0',
    };
  }
}
