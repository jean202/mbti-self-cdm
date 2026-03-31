import { Injectable, NotFoundException } from '@nestjs/common';
import type { User } from '@prisma/client';

import { PrismaService } from '../../infra/prisma/prisma.service';

type UserCore = Pick<User, 'id' | 'timezone' | 'locale'>;

@Injectable()
export class UsersService {
  constructor(private readonly prismaService: PrismaService) {}

  async findByIdOrThrow(userId: string): Promise<UserCore> {
    const user = await this.prismaService.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        timezone: true,
        locale: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User was not found.');
    }

    return user;
  }

  async updateLastActive(userId: string): Promise<void> {
    await this.prismaService.user.update({
      where: { id: userId },
      data: { lastActiveAt: new Date() },
    });
  }
}
