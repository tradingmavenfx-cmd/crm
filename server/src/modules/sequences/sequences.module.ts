import { Module } from '@nestjs/common';
import { SequencesService } from './sequences.service';
import { SequencesController } from './sequences.controller';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [EmailModule],
  controllers: [SequencesController],
  providers: [SequencesService],
  exports: [SequencesService],
})
export class SequencesModule {}
