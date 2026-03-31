import { Module } from '@nestjs/common';

import { ReflectController } from './reflect.controller';
import { ReflectService } from './reflect.service';

@Module({
  controllers: [ReflectController],
  providers: [ReflectService],
})
export class ReflectModule {}
