import { Controller, Get, INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { schoolA, userA } from '../../db/seed.js';
import { AppModule } from '../../src/app.module.js';
import { RequiresPermission } from '../../src/entitlements/decorators.js';
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

// A cast is the only way to get past the compiler with an undeclared permission.
@Controller('schools/:schoolId/transport')
@RequiresPermission('transport:read' as never)
class UnknownPermissionController {
  @Get()
  list() {
    return [];
  }
}

@Controller('reports')
@RequiresPermission('finance:read')
class PermissionWithoutSchoolController {
  @Get()
  list() {
    return [];
  }
}

@Controller('schools/:schoolId/declared')
class DeclaredPerHandlerController {
  @Get('core')
  @RequiresPermission('students:read')
  core() {
    return [];
  }

  @Get('finance')
  @RequiresPermission('finance:read')
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

  it('lets an app start when every school route declares a permission', async () => {
    const app = await boot(DeclaredPerHandlerController);
    await app.close();
  });

  it('refuses to start when a school route declares no permission', async () => {
    await expect(boot(UndeclaredController)).rejects.toThrow(
      'GET /schools/:schoolId/undeclared',
    );
  });

  it('refuses to start when a school route declares a permission that is not in the list', async () => {
    await expect(boot(UnknownPermissionController)).rejects.toThrow(
      'GET /schools/:schoolId/transport',
    );
  });

  it('refuses to start when a route with no school declares a permission', async () => {
    await expect(boot(PermissionWithoutSchoolController)).rejects.toThrow(
      'GET /reports',
    );
  });

  it('names every offending route in one error', async () => {
    const failed = boot(
      UndeclaredController,
      PermissionWithoutSchoolController,
    );
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
