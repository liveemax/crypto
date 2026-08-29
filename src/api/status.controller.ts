import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { StatusService } from '../core/system/status.service';
import type { StatusReport } from '../core/system/status.types';
import { StatusReportDto } from './dto/status.dto';

@ApiTags('system')
@Controller('status')
export class StatusController {
  constructor(private readonly status: StatusService) {}

  @Get()
  @ApiOperation({
    summary: 'Что идёт, насколько свежо, какая выборка и что нажать дальше',
    description:
      'Единственный источник прогресса. job показывает любую фоновую задачу — состав ' +
      'вселенной, цены, календарь разлоков — потому что владелец состояния один.\n\n' +
      'data.prices.asOf и data.tokenomics.asOf — время источника, а не время нашего ' +
      'запроса. coveragePct считается по полной вселенной: доля, посчитанная по ' +
      'отфильтрованной выборке, улучшается включением фильтра.\n\n' +
      'evaluation.compatible покомпонентен: сменили фильтр — perToken остаётся true, ' +
      'comparative становится false, и пересчитать нужно только sectorPosition.\n\n' +
      'nextAction отвечает на вопрос «что делать» в каждом состоянии, включая «всё свежо».',
  })
  @ApiOkResponse({ type: StatusReportDto })
  async report(): Promise<StatusReport> {
    return this.status.report();
  }
}