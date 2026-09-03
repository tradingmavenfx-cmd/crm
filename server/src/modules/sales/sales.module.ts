import { Module } from '@nestjs/common';
import { SalesController } from './sales.controller';
import { TerritoriesService } from './territories.service';
import { ForecastService } from './forecast.service';
import { GamificationService } from './gamification.service';

@Module({
  controllers: [SalesController],
  providers: [TerritoriesService, ForecastService, GamificationService],
  exports: [ForecastService, TerritoriesService],
})
export class SalesModule {}
