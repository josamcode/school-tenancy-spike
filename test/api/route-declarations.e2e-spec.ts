import { Controller, Get, INestApplication, Post, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { schoolA, userA } from '../../db/seed.js';
import { AppModule } from '../../src/app.module.js';
import { Core, RequiresModule } from '../../src/entitlements/decorators.js';
import { RouteDeclarations } from '../../src/entitlements/route-declarations.js';
import { tokenFor } from '../support/tokens.js';

const handlerRan = vi.fn();

@Controller('schools/:schoolId/undeclared')
class UndeclaredController {
  @Get()
  list() {
    handlerRan();
    return [];
  }
}

@Controller('schools/:schoolId/both')
@Core()
class DeclaresBothController {
  @Post()
  @RequiresModule('finance')
  create() {
    return {};
  }
}

@Controller('reports')
@RequiresModule('finance')
class ModuleWithoutSchoolController {
  @Get()
  list() {
    return [];
  }
}

@Controller('schools/:schoolId/declared')
class DeclaredPerHandlerController {
  @Get('core')
  @Core()
  core() {
    return [];
  }

  @Get('finance')
  @RequiresModule('finance')
  finance() {
    return [];
  }
}

async function boot(...controllers: Type[]): Promise<INestApplication<App>> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    controllers,
  }).compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>();
  try {
    await app.init();
  } catch (error) {
    await app.close();
    throw error;
  }
  return app;
}

describe('route declarations at startup', () => {
  it('lets the real app start', async () => {
    const app = await boot();
    await app.close();
  });

  it('lets an app start when every school route declares core or a module', async () => {
    const app = await boot(DeclaredPerHandlerController);
    await app.close();
  });

  it('refuses to start when a school route declares neither', async () => {
    await expect(boot(UndeclaredController)).rejects.toThrow(
      'GET /schools/:schoolId/undeclared',
    );
  });

  it('refuses to start when a school route declares both', async () => {
    await expect(boot(DeclaresBothController)).rejects.toThrow(
      'POST /schools/:schoolId/both',
    );
  });

  it('refuses to start when a route with no school declares a module', async () => {
    await expect(boot(ModuleWithoutSchoolController)).rejects.toThrow(
      'GET /reports',
    );
  });

  it('names every offending route in one error', async () => {
    const failed = boot(UndeclaredController, ModuleWithoutSchoolController);
    await expect(failed).rejects.toThrow('GET /schools/:schoolId/undeclared');
    await expect(failed).rejects.toThrow('GET /reports');
  });
});

describe('an undeclared school route when the startup check is bypassed', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [UndeclaredController],
    })
      .overrideProvider(RouteDeclarations)
      .useValue({})
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers 500 to a member and never runs the handler', async () => {
    handlerRan.mockClear();
    const response = await request(app.getHttpServer())
      .get(`/schools/${schoolA.id}/undeclared`)
      .set({ Authorization: `Bearer ${await tokenFor(userA.id)}` });
    expect(response.status).toBe(500);
    expect(handlerRan).not.toHaveBeenCalled();
  });
});
