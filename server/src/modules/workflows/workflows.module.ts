import { Module } from '@nestjs/common';
import { WorkflowsService } from './workflows.service';
import { WorkflowsController } from './workflows.controller';
import { EmailModule } from '../email/email.module';
import { SmsModule } from '../sms/sms.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { SequencesModule } from '../sequences/sequences.module';

/**
 * The engine consumes domain events rather than being called directly, so the
 * modules that emit them never have to import it.
 */
@Module({
  imports: [EmailModule, SmsModule, WhatsappModule, SequencesModule],
  controllers: [WorkflowsController],
  providers: [WorkflowsService],
  exports: [WorkflowsService],
})
export class WorkflowsModule {}
