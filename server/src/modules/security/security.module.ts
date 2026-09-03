import { Global, Module } from '@nestjs/common';
import { SecurityController } from './security.controller';
import { SecurityService } from './security.service';
import { AuditService } from './audit.service';
import { ComplianceService } from './compliance.service';

/**
 * Global, because auditing is something any module may need to do and
 * threading an import through every one of them would be noise.
 */
@Global()
@Module({
  controllers: [SecurityController],
  providers: [SecurityService, AuditService, ComplianceService],
  exports: [SecurityService, AuditService, ComplianceService],
})
export class SecurityModule {}
