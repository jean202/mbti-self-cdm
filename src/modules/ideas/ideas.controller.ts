import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user.type';
import { ConvertIdeaToTaskDto } from './dto/convert-idea-to-task.dto';
import { CreateIdeaDto } from './dto/create-idea.dto';
import { ListIdeasQueryDto } from './dto/list-ideas-query.dto';
import { UpdateIdeaDto } from './dto/update-idea.dto';
import { IdeasService } from './ideas.service';

@ApiTags('Ideas')
@ApiBearerAuth()
@Controller('ideas')
@UseGuards(AuthGuard)
export class IdeasController {
  constructor(private readonly ideasService: IdeasService) {}

  @Post()
  createIdea(
    @CurrentUser() currentUser: RequestUser,
    @Body() body: CreateIdeaDto,
  ) {
    return this.ideasService.createIdea(currentUser.userId, body);
  }

  @Get()
  listIdeas(
    @CurrentUser() currentUser: RequestUser,
    @Query() query: ListIdeasQueryDto,
  ) {
    return this.ideasService.listIdeas(currentUser.userId, query);
  }

  @Get(':idea_id')
  getIdea(
    @CurrentUser() currentUser: RequestUser,
    @Param('idea_id', new ParseUUIDPipe()) ideaId: string,
  ) {
    return this.ideasService.getIdea(currentUser.userId, ideaId);
  }

  @Patch(':idea_id')
  updateIdea(
    @CurrentUser() currentUser: RequestUser,
    @Param('idea_id', new ParseUUIDPipe()) ideaId: string,
    @Body() body: UpdateIdeaDto,
  ) {
    return this.ideasService.updateIdea(currentUser.userId, ideaId, body);
  }

  @Post(':idea_id/convert-to-task')
  convertToTask(
    @CurrentUser() currentUser: RequestUser,
    @Param('idea_id', new ParseUUIDPipe()) ideaId: string,
    @Body() body: ConvertIdeaToTaskDto,
  ) {
    return this.ideasService.convertToTask(currentUser.userId, ideaId, body);
  }
}
