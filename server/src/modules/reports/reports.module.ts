import { Module } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { DashboardsService } from './dashboards.service';
import { ReportsController } from './reports.controller';
import { EmailModule } from '../email/email.module';

@Module({
  // Email carries the scheduled report digests.
  imports: [EmailModule],
  controllers: [ReportsController],
  providers: [ReportsService, DashboardsService],
  exports: [ReportsService],
})
export class ReportsModule {}
