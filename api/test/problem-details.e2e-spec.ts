import {
  Body,
  Controller,
  Get,
  type INestApplication,
  Post,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsInt,
  IsNotEmpty,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { configureApp } from '../src/app.setup.js';

class ProbeOptionDto {
  @IsString()
  @IsNotEmpty()
  text!: string;
}

class ProbeDto {
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsInt()
  @Min(1)
  count!: number;

  @ValidateNested({ each: true })
  @ArrayMinSize(1)
  @Type(() => ProbeOptionDto)
  options!: ProbeOptionDto[];
}

// Test-only controller: exercises the real global pipe and filter without
// shipping a debug endpoint in production code.
@Controller('probe')
class ProbeController {
  @Post()
  create(@Body() body: ProbeDto): ProbeDto {
    return body;
  }

  @Get('boom')
  boom(): never {
    throw new Error('database password is hunter2');
  }
}

describe('Problem details (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('accepts a valid body', async () => {
    const body = {
      title: 'Photosynthesis',
      count: 2,
      options: [{ text: 'A' }],
    };

    await request(app.getHttpServer())
      .post('/api/probe')
      .send(body)
      .expect(201)
      .expect(body);
  });

  it('returns validation errors as problem details', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/probe')
      .send({ title: '', count: 0, options: [{ text: 42 }], extra: true })
      .expect(400)
      .expect('Content-Type', /application\/problem\+json/);

    expect(response.body).toMatchObject({
      type: 'urn:quizforge:problem:validation-error',
      title: 'Validation failed',
      status: 400,
      detail: 'The request contains invalid fields.',
      instance: '/api/probe',
    });
    const pointers = (response.body.errors as { pointer: string }[]).map(
      (error) => error.pointer,
    );
    expect(pointers).toEqual(
      expect.arrayContaining([
        '#/title',
        '#/count',
        '#/options/0/text',
        '#/extra',
      ]),
    );
  });

  it('returns unknown routes as problem details', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/does-not-exist')
      .expect(404)
      .expect('Content-Type', /application\/problem\+json/);

    expect(response.body).toMatchObject({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      instance: '/api/does-not-exist',
    });
  });

  it('returns malformed JSON as problem details', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/probe')
      .set('Content-Type', 'application/json')
      .send('{"title": ')
      .expect(400)
      .expect('Content-Type', /application\/problem\+json/);

    expect(response.body).toMatchObject({ type: 'about:blank', status: 400 });
  });

  it('hides internal error details behind a generic 500', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/probe/boom')
      .expect(500)
      .expect('Content-Type', /application\/problem\+json/);

    expect(response.body.title).toBe('Internal Server Error');
    expect(JSON.stringify(response.body)).not.toContain('hunter2');
  });
});
