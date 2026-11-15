import type { NextConfig } from 'next';

const development = process.env.NODE_ENV !== 'production';

const config: NextConfig = {
  // A file named page.dev.tsx or route.dev.ts is a route in development and
  // is not compiled into a production build at all. The demo sign-in is the
  // only such route.
  pageExtensions: development
    ? ['dev.tsx', 'dev.ts', 'tsx', 'ts']
    : ['tsx', 'ts'],
  // The headless browser that prints the PDF runs outside the bundle.
  serverExternalPackages: ['playwright'],
  poweredByHeader: false,
  // Arabic first.
  redirects: async () => [
    { source: '/', destination: '/ar', permanent: false },
  ],
};

export default config;
