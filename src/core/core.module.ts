import { Module } from '@nestjs/common';
import { CoingeckoService } from './fetch/coingecko.service';
import { DefillamaService } from './fetch/defillama.service';
import { StoreService } from './store/store.service';

/**
 * Общий слой без HTTP: хранилище, валидатор и клиенты внешних API.
 * Импортируется всеми модулями, чтобы StoreService существовал в одном экземпляре.
 */
@Module({
  providers: [StoreService, CoingeckoService, DefillamaService],
  exports: [StoreService, CoingeckoService, DefillamaService],
})
export class CoreModule {}
