import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { APP_GUARD } from '@nestjs/core';
import configuration from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { ContactsModule } from './modules/contacts/contacts.module';
import { CompaniesModule } from './modules/companies/companies.module';
import { DealsModule } from './modules/deals/deals.module';
import { ActivitiesModule } from './modules/activities/activities.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { WhatsappModule } from './modules/whatsapp/whatsapp.module';
import { EmailModule } from './modules/email/email.module';
import { SmsModule } from './modules/sms/sms.module';
import { TrackingModule } from './modules/tracking/tracking.module';
import { RoutingModule } from './modules/routing/routing.module';
import { CampaignsModule } from './modules/campaigns/campaigns.module';
import { SequencesModule } from './modules/sequences/sequences.module';
import { ChatModule } from './modules/chat/chat.module';
import { WorkflowsModule } from './modules/workflows/workflows.module';
import { ReportsModule } from './modules/reports/reports.module';
import { VoiceModule } from './modules/voice/voice.module';
import { InboxModule } from './modules/inbox/inbox.module';
import { HealthController } from './modules/health/health.controller';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    // Drives scheduled campaigns and the sequence step runner.
    ScheduleModule.forRoot(),
    // Carries domain events to the workflow engine, so the modules that emit
    // them never have to depend on it.
    EventEmitterModule.forRoot(),
    PrismaModule,
    AuthModule,
    UsersModule,
    ContactsModule,
    CompaniesModule,
    DealsModule,
    ActivitiesModule,
    TasksModule,
    WhatsappModule,
    EmailModule,
    SmsModule,
    VoiceModule,
    TrackingModule,
    RoutingModule,
    CampaignsModule,
    SequencesModule,
    ChatModule,
    WorkflowsModule,
    ReportsModule,
    InboxModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
