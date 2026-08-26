import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { AgentInfo, AgentRunnerService } from '../agents/agent-runner.service';
import { AGENT_NAMES } from '../agents/agents.constants';
import { SnapshotService } from '../core/fetch/snapshot.service';
import { AgentContext, AgentResult } from '../core/types';
import { AgentInfoDto, AgentResultDto, AgentRunQueryDto } from './dto/agent.dto';

@ApiTags('agents')
@Controller('agents')
export class AgentsController {
  constructor(
    private readonly runner: AgentRunnerService,
    private readonly snapshots: SnapshotService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Какие агенты подключены',
    description:
      'Список берётся из DI. Пустой массив означает, что ни один агент ещё не ' +
      'зарегистрирован, и это не ошибка. Имя из выпадающего списка ' +
      'POST /agents/{name}/{token}, которого здесь нет, отвечает 404.',
  })
  @ApiOkResponse({ type: AgentInfoDto, isArray: true })
  list(): AgentInfo[] {
    return this.runner.list();
  }

  @Post(':name/:token')
  @ApiOperation({
    summary: 'Прогнать одного агента по одному токену',
    description:
      'Данные берутся из последнего снапшота. Токена в нём нет — строка собирается ' +
      'точечно, если не задан offline=true.\n\n' +
      'Результат кэшируется на сутки. Ключ кодового агента включает профиль: его балл ' +
      'зависит от порогов. У LLM-агента профиля в ключе нет, поэтому пятый профиль не ' +
      'стоит пятого прогона модели. Пересчитать принудительно — refresh=true.\n\n' +
      'asOf в ответе — время расчёта: пришло старое, значит ответ из кэша.',
  })
  @ApiParam({ name: 'name', enum: [...AGENT_NAMES], description: 'Имя агента' })
  @ApiParam({ name: 'token', example: 'AAVE', description: 'Тикер токена' })
  @ApiOkResponse({ type: AgentResultDto })
  async run(
    @Param('name') name: string,
    @Param('token') token: string,
    @Query() query: AgentRunQueryDto,
  ): Promise<AgentResult> {
    // Сначала агент, потом данные: 404 не должен стоить сетевого прогона.
    const agent = this.runner.byName(name);
    const profile = this.runner.resolveProfile(query.profileId);

    const row = await this.snapshots.getRow(token, { offline: query.offline });
    const base = await this.snapshots.buildContext(token, { offline: query.offline });
    const ctx: AgentContext = { ...base, profile };

    return this.runner.run(agent.name, token, row, ctx, { refresh: query.refresh });
  }
}