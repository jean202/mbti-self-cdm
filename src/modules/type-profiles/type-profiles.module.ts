import { Global, Module } from '@nestjs/common';

import { TypeProfileLoaderService } from './type-profile-loader.service';

@Global()
@Module({
  providers: [TypeProfileLoaderService],
  exports: [TypeProfileLoaderService],
})
export class TypeProfilesModule {}
