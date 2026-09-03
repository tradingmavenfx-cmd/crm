import { Module } from '@nestjs/common';
import { MarketingController } from './marketing.controller';
import { LeadsService } from './leads.service';
import { PagesService } from './pages.service';
import { AttributionService } from './attribution.service';

@Module({
  controllers: [MarketingController],
  providers: [LeadsService, PagesService, AttributionService],
  exports: [LeadsService],
})
export class MarketingModule {}
