import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { DOCUMENT_STORAGE } from './storage/storage.interface';
import { LocalDiskStorage } from './storage/local-disk.storage';

@Module({
  controllers: [DocumentsController],
  providers: [
    DocumentsService,
    // The local disk is the only driver today. An object store implements the
    // same three methods and is swapped in here.
    { provide: DOCUMENT_STORAGE, useClass: LocalDiskStorage },
  ],
  exports: [DocumentsService],
})
export class DocumentsModule {}
