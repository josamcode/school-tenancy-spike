import { INestApplication } from '@nestjs/common';

export interface Route {
  method: string;
  path: string;
}

interface Layer {
  route?: { path: string; methods: Record<string, boolean> };
}

// Reads the routes from the running Express router, so nothing is listed by hand.
export function registeredRoutes(app: INestApplication): Route[] {
  const express = app.getHttpAdapter().getInstance() as {
    router: { stack: Layer[] };
  };
  return express.router.stack.flatMap((layer) =>
    layer.route
      ? Object.keys(layer.route.methods).map((method) => ({
          method: method.toUpperCase(),
          path: layer.route!.path,
        }))
      : [],
  );
}
