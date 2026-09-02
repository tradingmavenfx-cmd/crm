import { Module } from '@nestjs/common';
import { ProductsService } from './products.service';
import { QuotesService } from './quotes.service';
import { CpqController } from './cpq.controller';

@Module({
  controllers: [CpqController],
  providers: [ProductsService, QuotesService],
  exports: [ProductsService, QuotesService],
})
export class CpqModule {}
